/**
 * Détail du compte de résultat de la liasse : ventilation du chiffre d'affaires entre la France et les exportations /
 * livraisons intracommunautaires (tableau 2052-SD du régime réel normal ; lignes « dont export et livraisons
 * intracommunautaires » du tableau 2033-B-SD du régime simplifié), détail des produits et charges exceptionnels (cadre (7) du
 * tableau 2053-SD) et renvois de bas de tableau qui demandent une information que la balance ne porte pas (D-106, D-107).
 *
 * Principes :
 *  - une écriture du FEC ne dit pas où se trouve le client ni si la vente est une exportation : cette information n'est JAMAIS
 *    déduite. Le cabinet la QUALIFIE, compte par compte (montant France + montant exportations et livraisons intracommunautaires,
 *    dont la somme doit égaler le solde du compte) avec une note obligatoire ; la qualification est tracée (qui, quand, sur
 *    quelle version des données) et devient « à revoir » dès que les données ont changé ;
 *  - tant qu'un compte du chiffre d'affaires n'est pas qualifié, les cellules France / exportations de la ligne concernée sont
 *    en ABSTENTION motivée (sans aucun chiffre) ; le total de la ligne, lui, vient toujours de la balance ;
 *  - le détail des produits et charges exceptionnels est lu dans la balance (comptes 67, 687, 77, 787) : c'est la même
 *    affectation que celle des tableaux 2052 / 2053 existants ; aucun libellé n'est interprété ;
 *  - un renvoi sans information dans la balance est à SAISIR (montant + note + trace) ; quand un compte du PCG le désigne
 *    sans ambiguïté, la balance fournit une PROPOSITION, jamais retenue tant que le cabinet ne l'a pas saisie ;
 *  - statut « projet » toujours, jamais « complet » ; aucune transmission ; aucune validation professionnelle.
 *
 * Codes de cases : lus sur le formulaire du millésime 2026 (PDF officiel 2050-liasse_5320.pdf, SHA-256 0bba3352…8453e1, et
 * 2033-sd_5394.pdf, SHA-256 ce4c5190…b6cb) par extraction de texte positionnée PUIS vérifiés sur le rendu image des pages
 * (2026-11-21) : « lu_verifie ». Notice : 2032-NOT-SD (SHA-256 68ac6083…26f39).
 * L'affectation des comptes de la classe 70 aux lignes « biens » et « services » reprend la table de correspondance existante
 * (production vendue) en la scindant : convention interne à faire valider par un professionnel.
 */
import { Decimal } from 'decimal.js';
import { type ChaineDecimale, versChaine } from '../montant.js';
import type { Balance } from './types.js';
import { type ImpotSurLeResultat, type LiasseAbstention, PERIMETRE_LIASSE, type RegimeLiasse, type TerritoireFiscal, motifsAbstention } from './liasse.js';
import { MENTION_PROJET } from './sources-fiscales.js';

const ZERO = new Decimal(0);

/** lu_verifie : lu par extraction de texte positionnée et vérifié sur le rendu image du PDF officiel ; lu_a_confirmer : extraction seule. */
export type EtatCodeCase = 'lu_a_confirmer' | 'lu_verifie';

/** Trace d'une saisie du cabinet. */
export interface TraceQualification {
  note: string;
  qualifieePar: string;
  le: string;
  versionDonnees: number;
}

export interface QualificationVentilation extends TraceQualification {
  compte: string;
  montantFrance: ChaineDecimale;
  montantExport: ChaineDecimale;
}

export interface QualificationRenvoi extends TraceQualification {
  code: string;
  montant: ChaineDecimale;
}

export interface DemandeDetailResultat {
  balance: Balance;
  exercice: { debut: string; fin: string };
  regime: RegimeLiasse;
  territoire: TerritoireFiscal;
  impotSurLeResultat: ImpotSurLeResultat;
  referentielComptable: string;
  devise: string;
  societeCommerciale: boolean | null;
  /** Version courante des données de l'exercice : une qualification donnée sur une autre version est « à revoir ». */
  versionDonnees: number;
  /** Résultat comptable de la ligne 310 du 2033-B (produits − charges, signé : bénéfice > 0, déficit < 0) ; null si la liasse s'abstient. Sert à la partie B (régime simplifié). */
  resultatComptable?: ChaineDecimale | null;
  ventilations: readonly QualificationVentilation[];
  renvois: readonly QualificationRenvoi[];
}

// ── Chiffre d'affaires (2052) ────────────────────────────────────────────────────────────────────────────────────────────

interface DefinitionLigneCA {
  id: 'MARCHANDISES' | 'BIENS' | 'SERVICES';
  libelle: string;
  /** Préfixes de comptes (la table de correspondance existante, scindée en biens et services). */
  prefixes: readonly string[];
  /** `france` est absent du formulaire du régime simplifié (qui ne demande que « dont export et livraisons intracommunautaires »). */
  codes: { france: string | null; export: string; total: string };
}

const COMPTES_CA = {
  MARCHANDISES: { libelle: 'Ventes de marchandises', prefixes: ['707', '7097'] },
  BIENS: { libelle: 'Production vendue — biens', prefixes: ['701', '702', '703', '7091', '7092'] },
  SERVICES: { libelle: 'Production vendue — services', prefixes: ['704', '705', '706', '708', '7094', '7095', '7096', '7098'] },
} as const;

/** Régime réel normal, tableau 2052-SD : France (FA, FD, FG), exportations et livraisons intracommunautaires (FB, FE, FH), total (FC, FF, FI). */
export const LIGNES_CA: readonly DefinitionLigneCA[] = [
  { id: 'MARCHANDISES', ...COMPTES_CA.MARCHANDISES, codes: { france: 'FA', export: 'FB', total: 'FC' } },
  { id: 'BIENS', ...COMPTES_CA.BIENS, codes: { france: 'FD', export: 'FE', total: 'FF' } },
  { id: 'SERVICES', ...COMPTES_CA.SERVICES, codes: { france: 'FG', export: 'FH', total: 'FI' } },
];
/** Régime simplifié, tableau 2033-B-SD : « dont export et livraisons intracommunautaires » (209, 215, 217) et total (210, 214, 218). */
export const LIGNES_CA_RSI: readonly DefinitionLigneCA[] = [
  { id: 'MARCHANDISES', ...COMPTES_CA.MARCHANDISES, codes: { france: null, export: '209', total: '210' } },
  { id: 'BIENS', ...COMPTES_CA.BIENS, codes: { france: null, export: '215', total: '214' } },
  { id: 'SERVICES', ...COMPTES_CA.SERVICES, codes: { france: null, export: '217', total: '218' } },
];
const CODES_CA_NET = { france: 'FJ', export: 'FK', total: 'FL' };

export type EtatQualification = 'sans_montant' | 'a_qualifier' | 'qualifie' | 'ecart' | 'a_revoir';

export interface CompteChiffreAffaires {
  compteNum: string;
  compteLib: string;
  /** Solde créditeur net du compte (produit : crédit − débit). */
  solde: ChaineDecimale;
  etat: EtatQualification;
  qualification: QualificationVentilation | null;
  /** Écart entre le solde du compte et la somme France + exportations saisie (présent seulement s'il est non nul). */
  ecart?: ChaineDecimale;
}

export type CelluleVentilation =
  | { statut: 'etabli'; montant: ChaineDecimale; codeCase: string | null; etatCodeCase: EtatCodeCase }
  | { statut: 'abstention'; motif: string; codeCase: string | null; etatCodeCase: EtatCodeCase };

export interface LigneChiffreAffaires {
  id: string;
  libelle: string;
  comptes: CompteChiffreAffaires[];
  total: CelluleVentilation;
  france: CelluleVentilation;
  export: CelluleVentilation;
  /** Tous les comptes de la ligne qui portent un montant sont qualifiés (somme exacte, version courante). */
  qualifiee: boolean;
}

export interface CompteNonAffecte {
  compteNum: string;
  compteLib: string;
  solde: ChaineDecimale;
  motif: string;
}

export interface VentilationChiffreAffaires {
  lignes: LigneChiffreAffaires[];
  /** Ligne « chiffre d'affaires net » : propre au tableau 2052 ; null au régime simplifié (le formulaire 2033-B n'en a pas). */
  chiffreAffairesNet: { total: CelluleVentilation; france: CelluleVentilation; export: CelluleVentilation } | null;
  /** Comptes de la classe 70 qui portent un montant mais n'entrent dans aucune ligne : absents de tout total, dits. */
  comptesNonAffectes: CompteNonAffecte[];
  /** Qualifications saisies pour un compte qui n'existe pas ou ne porte aucun montant dans la balance : signalées, jamais comptées. */
  qualificationsOrphelines: Array<{ compte: string; motif: string }>;
  nbComptesAQualifier: number;
  complete: boolean;
}

// ── Détail des produits et charges exceptionnels (2053, cadre (7)) ───────────────────────────────────────────────────────

export interface LigneDetailExceptionnel {
  compteNum: string;
  compteLib: string;
  montant: ChaineDecimale;
}

export interface DetailExceptionnel {
  produits: LigneDetailExceptionnel[];
  charges: LigneDetailExceptionnel[];
  totalProduits: ChaineDecimale;
  totalCharges: ChaineDecimale;
  resultatExceptionnel: ChaineDecimale;
  origine: string;
}

// ── Renvois ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface DefinitionRenvoi {
  code: string;
  renvoi: string;
  tableau: '2052' | '2053' | '2033-B';
  libelle: string;
  nature: 'produit' | 'charge';
  /** Code de case du formulaire ; absent (null) quand le formulaire n'en porte pas (montant à inscrire sur des pointillés). Par défaut : `code`. */
  codeCase?: string | null;
  /** Comptes dont la balance donne une PROPOSITION (jamais retenue sans saisie). */
  comptesProposition?: readonly string[];
  /** Pourquoi la balance ne suffit pas, ou précision sur la proposition. */
  precision: string;
}

/** Régime réel normal, tableaux 2052 et 2053. */
export const RENVOIS: readonly DefinitionRenvoi[] = [
  { code: 'HO', renvoi: '(1)', tableau: '2052', libelle: 'Dont produits nets partiels sur opérations à long terme', nature: 'produit', precision: 'Information extra-comptable (avancement des opérations) : à saisir.' },
  { code: 'HY', renvoi: '(2)', tableau: '2052', libelle: 'Dont produits de locations immobilières', nature: 'produit', precision: 'Le compte 7083 (locations diverses) ne distingue pas la nature immobilière : à saisir.' },
  { code: '1G', renvoi: '(2)', tableau: '2052', libelle: 'Dont produits d’exploitation afférents à des exercices antérieurs (à détailler au (8) du tableau 2053)', nature: 'produit', precision: 'Un produit sur exercice antérieur est enregistré selon sa nature : la balance ne le distingue pas.' },
  { code: 'HP', renvoi: '(3)', tableau: '2052', libelle: 'Dont crédit-bail mobilier', nature: 'charge', comptesProposition: ['6122'], precision: 'Proposition : compte 6122 du PCG (redevances de crédit-bail mobilier).' },
  { code: 'HQ', renvoi: '(3)', tableau: '2052', libelle: 'Dont crédit-bail immobilier', nature: 'charge', comptesProposition: ['6125'], precision: 'Proposition : compte 6125 du PCG (redevances de crédit-bail immobilier).' },
  { code: '1H', renvoi: '(4)', tableau: '2052', libelle: 'Dont charges d’exploitation afférentes à des exercices antérieurs (à détailler au (8) du tableau 2053)', nature: 'charge', precision: 'Une charge sur exercice antérieur est enregistrée selon sa nature : la balance ne la distingue pas.' },
  { code: '1J', renvoi: '(5)', tableau: '2052', libelle: 'Dont produits concernant les entreprises liées', nature: 'produit', precision: 'Exige la qualification des tiers comme entreprises liées : à saisir.' },
  { code: '1K', renvoi: '(6)', tableau: '2052', libelle: 'Dont intérêts concernant les entreprises liées', nature: 'charge', precision: 'Exige la qualification des tiers comme entreprises liées : à saisir.' },
  { code: 'A3', renvoi: '(11)', tableau: '2052', libelle: 'Dont redevances pour concessions de brevets, de licences (produits)', nature: 'produit', comptesProposition: ['751'], precision: 'Proposition : compte 751 du PCG (redevances pour concessions, brevets, licences).' },
  { code: 'A4', renvoi: '(12)', tableau: '2052', libelle: 'Dont redevances pour concessions de brevets, de licences (charges)', nature: 'charge', comptesProposition: ['651'], precision: 'Proposition : compte 651 du PCG (redevances pour concessions, brevets, licences).' },
  { code: 'HS', renvoi: '(14)', tableau: '2052', libelle: 'Dont montant de l’amortissement du fonds de commerce (art. 39, 1-2°, al. 3 du CGI)', nature: 'charge', precision: 'Exige le suivi des fonds commerciaux concernés : à saisir.' },
  { code: 'HX', renvoi: '(6 bis)', tableau: '2053', libelle: 'Dont dons faits aux organismes d’intérêt général (art. 238 bis du CGI)', nature: 'charge', comptesProposition: ['6713'], precision: 'Proposition : compte 6713 du PCG (dons, libéralités). Code de case à confirmer en priorité (lecture par ordre d’apparition).' },
  { code: 'RC', renvoi: '(6 ter)', tableau: '2053', libelle: 'Dont amortissements des souscriptions dans des PME innovantes (art. 217 octies du CGI)', nature: 'charge', precision: 'Information fiscale non portée par la balance : à saisir. Code de case à confirmer (lecture par ordre d’apparition).' },
  { code: 'RD', renvoi: '(6 ter)', tableau: '2053', libelle: 'Dont amortissements exceptionnels de 25 % des constructions nouvelles (art. 39 quinquies D du CGI)', nature: 'charge', precision: 'Information fiscale non portée par la balance : à saisir. Code de case à confirmer (lecture par ordre d’apparition).' },
];

/** Régime simplifié, tableau 2033-B-SD : lignes « dont » du résultat comptable (codes 243, 255, 259, 260, 347, 348 ; crédit-bail sans code). */
export const RENVOIS_RSI: readonly DefinitionRenvoi[] = [
  { code: 'CB_MOB', codeCase: null, renvoi: 'dont', tableau: '2033-B', libelle: 'Autres charges externes, dont crédit-bail mobilier (montant à inscrire sur les pointillés du formulaire)', nature: 'charge', comptesProposition: ['6122'], precision: 'Proposition : compte 6122 du PCG. Le formulaire ne porte aucun code de case pour cette ligne.' },
  { code: 'CB_IMM', codeCase: null, renvoi: 'dont', tableau: '2033-B', libelle: 'Autres charges externes, dont crédit-bail immobilier (montant à inscrire sur les pointillés du formulaire)', nature: 'charge', comptesProposition: ['6125'], precision: 'Proposition : compte 6125 du PCG. Le formulaire ne porte aucun code de case pour cette ligne.' },
  { code: '243', renvoi: 'dont', tableau: '2033-B', libelle: 'Impôts, taxes et versements assimilés, dont CFE et CVAE', nature: 'charge', precision: 'La balance ne distingue pas la CFE et la CVAE des autres impôts directs : à saisir.' },
  { code: '255', renvoi: 'dont', tableau: '2033-B', libelle: 'Dotations aux amortissements, dont amortissement du fonds de commerce (art. 39, 1-2°, al. 3 du CGI)', nature: 'charge', precision: 'Exige le suivi des fonds commerciaux concernés : à saisir.' },
  { code: '259', renvoi: 'dont', tableau: '2033-B', libelle: 'Autres charges, dont provisions fiscales pour implantations commerciales à l’étranger', nature: 'charge', precision: 'Information fiscale non portée par la balance : à saisir.' },
  { code: '260', renvoi: 'dont', tableau: '2033-B', libelle: 'Autres charges, dont cotisations versées aux organisations syndicales et professionnelles', nature: 'charge', precision: 'La balance ne distingue pas ces cotisations des autres charges : à saisir.' },
  { code: '347', renvoi: 'dont', tableau: '2033-B', libelle: 'Charges exceptionnelles, dont amortissements des souscriptions dans des PME innovantes (art. 217 octies du CGI)', nature: 'charge', precision: 'Information fiscale non portée par la balance : à saisir.' },
  { code: '348', renvoi: 'dont', tableau: '2033-B', libelle: 'Charges exceptionnelles, dont amortissements exceptionnels de 25 % des constructions nouvelles (art. 39 quinquies D du CGI)', nature: 'charge', precision: 'Information fiscale non portée par la balance : à saisir.' },
];

// ── 2033-B, partie B « Résultat fiscal » (D-110) ─────────────────────────────────────────────────────────────────────────

/** Rôle d'une ligne de la partie B dans le calcul, tel que le formulaire le porte (réintégrations en colonne 1, déductions en colonne 2). */
type RoleResultatFiscal = 'reintegration' | 'deduction' | 'report_arriere' | 'imputation';

interface DefinitionLigneResultatFiscal {
  /** Clé de saisie (préfixe RF_ + code de case) ; la case est `codeCase`. */
  cle: string;
  codeCase: string;
  libelle: string;
  role: RoleResultatFiscal;
  precision: string;
}

export const LIGNES_RESULTAT_FISCAL: readonly DefinitionLigneResultatFiscal[] = [
  { cle: 'RF_316', codeCase: '316', libelle: 'Réintégrations : rémunérations et avantages personnels non déductibles', role: 'reintegration', precision: 'Décision fiscale du cabinet : la balance ne distingue pas ce qui n’est pas déductible.' },
  { cle: 'RF_318', codeCase: '318', libelle: 'Réintégrations : amortissements excédentaires (art. 39-4 du CGI) et autres amortissements non déductibles', role: 'reintegration', precision: 'Peut se rapprocher du fichier des immobilisations, sans en être déduit.' },
  { cle: 'RF_322', codeCase: '322', libelle: 'Réintégrations : provisions non déductibles', role: 'reintegration', precision: 'Décision fiscale du cabinet.' },
  { cle: 'RF_324', codeCase: '324', libelle: 'Réintégrations : impôts et taxes non déductibles', role: 'reintegration', precision: 'Décision fiscale du cabinet (voir la notice 2033-NOT-SD, page 7).' },
  { cle: 'RF_330', codeCase: '330', libelle: 'Réintégrations : divers (total de la ligne : intérêts excédentaires de comptes courants d’associés, écarts de valeurs liquidatives sur OPC, fraction des loyers de crédit-bail immobilier…)', role: 'reintegration', precision: 'Saisir le TOTAL de la ligne tel que le cabinet l’établit ; le détail (cases 247, 248, 249, 251) n’est pas préparé.' },
  { cle: 'RF_342', codeCase: '342', libelle: 'Déductions : total des déductions de zones et régimes (entreprises nouvelles, ZFU-TE, JEI, ZRD, ZRR, bassins d’emploi, FRR, ZFANG, outre-mer, BUD, ZDP)', role: 'deduction', precision: 'Saisir le TOTAL de la case 342 ; le détail par régime (cases 986 à 993, 127, 138, 181, 344, 345) n’est pas préparé.' },
  { cle: 'RF_350', codeCase: '350', libelle: 'Déductions : divers à déduire (total de la ligne : créance de report en arrière, déductions exceptionnelles 39 decies à 39 decies G…)', role: 'deduction', precision: 'Saisir le TOTAL de la case 350 ; le détail (cases 346, 655, 643, 645, 647, 648, 641, 990, 649) n’est pas préparé.' },
  { cle: 'RF_356', codeCase: '356', libelle: 'Déficit de l’exercice reporté en arrière (option, art. 220 quinquies du CGI)', role: 'report_arriere', precision: 'Option du cabinet, formalisée dans le délai de dépôt de la déclaration n° 2065-SD.' },
  { cle: 'RF_360', codeCase: '360', libelle: 'Déficits antérieurs reportables : dont imputés sur le résultat', role: 'imputation', precision: 'Montant imputé après plafonnement (art. 209, I du CGI) ; le stock de déficits disponibles est tenu par le cabinet, hors balance.' },
];
/** Lignes sans lesquelles le résultat fiscal AVANT imputation (352 / 354) n'est pas établi. */
const CLES_AVANT_IMPUTATION: readonly string[] = ['RF_316', 'RF_318', 'RF_322', 'RF_324', 'RF_330', 'RF_342', 'RF_350'];
/** Plafond d'imputation des déficits antérieurs (notice 2033-NOT-SD, page 13 ; art. 209, I du CGI) : 1 000 000 €, majoré de 50 % du bénéfice excédant ce montant. */
const SEUIL_IMPUTATION = new Decimal(1_000_000);

export interface LigneResultatFiscal {
  cle: string;
  codeCase: string;
  etatCodeCase: EtatCodeCase;
  libelle: string;
  role: RoleResultatFiscal;
  /** a_saisir : aucune saisie ; saisi : retenu ; a_revoir : saisi sur une autre version des données (non retenu). */
  statut: 'a_saisir' | 'saisi' | 'a_revoir';
  /** Vrai si la saisie retenue est un NÉANT explicite (montant 0,00 déclaré par le cabinet). */
  neant: boolean;
  montant: ChaineDecimale | null;
  saisie: QualificationRenvoi | null;
  precision: string;
}

/** Résultat signé du formulaire : un bénéfice se porte en colonne 1, un déficit en colonne 2 (cases 312 / 314, 352 / 354, 370 / 372). */
export type ResultatSigne =
  | { statut: 'etabli'; sens: 'benefice' | 'deficit' | 'nul'; montant: ChaineDecimale; codeCase: string; etatCodeCase: EtatCodeCase }
  | { statut: 'abstention'; motifs: string[]; codesCases: string[]; etatCodeCase: EtatCodeCase };

export interface ResultatFiscalProjet {
  /** Résultat comptable reporté (cases 312 bénéfice / 314 déficit). */
  resultatComptable: ResultatSigne;
  lignes: LigneResultatFiscal[];
  /** Résultat fiscal avant imputation des déficits antérieurs (352 bénéfice / 354 déficit). */
  avantImputation: ResultatSigne;
  /** Plafond d'imputation des déficits antérieurs sur ce bénéfice ; null si le bénéfice n'est pas établi ou nul. */
  plafondImputation: { montant: ChaineDecimale; regle: string } | null;
  /** Résultat fiscal après imputation des déficits (370 bénéfice / 372 déficit). */
  apresImputation: ResultatSigne;
  controles: ControleDetail[];
  /** Clés des lignes requises pour le résultat avant imputation et qui n'ont pas de saisie retenue. */
  lignesManquantes: string[];
  nonPrepare: string[];
}

export interface RenvoiDetail {
  code: string;
  renvoi: string;
  tableau: '2052' | '2053' | '2033-B';
  libelle: string;
  /** Code de case ; null quand le formulaire n'en porte pas. */
  codeCase: string | null;
  etatCodeCase: EtatCodeCase;
  /** a_saisir : aucune saisie ; saisi : retenu pour le projet ; a_revoir : saisi sur une autre version des données (non retenu). */
  statut: 'a_saisir' | 'saisi' | 'a_revoir';
  montant: ChaineDecimale | null;
  saisie: QualificationRenvoi | null;
  proposition: { montant: ChaineDecimale; comptes: string[]; precision: string } | null;
  precision: string;
}

/** Renvois de l'exercice que la préparation ne couvre pas du tout (dits, jamais omis en silence). */
const RENVOIS_NON_PREPARES_RSN: readonly string[] = [
  '(10), (13) : cotisations personnelles de l’exploitant et cotisations facultatives (cases A2, A5, A8, A10, A11) : propres aux exploitants individuels, hors périmètre (société commerciale).',
  'Renvois (7) et (8) du tableau 2053 : le détail des produits et charges sur exercices antérieurs n’est pas déduit ; seuls les montants des cases 1G et 1H se saisissent, l’explication va dans la note de la saisie.',
];
const RENVOIS_NON_PREPARES_RSI: readonly string[] = [
  'Ligne « dont cotisation personnelle de l’exploitant » (case 380) : propre aux exploitants individuels, hors périmètre (société commerciale).',
  'Partie « B – résultat fiscal » du tableau 2033-B (réintégrations, déductions, déficits) : non préparée, elle exige des décisions et des informations extra-comptables du cabinet.',
];
export const RENVOIS_NON_PREPARES = RENVOIS_NON_PREPARES_RSN;

export const SOURCES_DETAIL_RESULTAT = [
  'Formulaires 2052-SD et 2053-SD du millésime 2026 (2050-liasse_5320.pdf, SHA-256 0bba33528b893ba8aa581d97bbc6ddb7d59a78fdbc234920596bce228f8453e1) : lignes FA à FL, renvois et cadres (7) et (8), lus par extraction de texte, non vérifiés visuellement.',
  'Notice 2032-NOT-SD du millésime 2026 (2032-not-sd_5323.pdf, SHA-256 68ac608323f7dfca3fa86606856f115db800a20c5cb7c0505d69f56c50f26f39) : définition du chiffre d’affaires net, des ventes de marchandises, de la production vendue de biens et de services.',
  'Plan comptable général consolidé (ANC) : comptes 70, 67, 77, 612, 651, 751.',
] as const;

export interface ControleDetail {
  code: string;
  statut: 'coherent' | 'ecart' | 'non_verifie';
  message: string;
  ecart?: ChaineDecimale;
}

export interface DetailResultatProjet {
  statut: 'projet';
  complet: false;
  regime: RegimeLiasse;
  exercice: { debut: string; fin: string };
  ventilationChiffreAffaires: VentilationChiffreAffaires;
  /** Cadre (7) du tableau 2053 ; null au régime simplifié (le tableau 2033-B n'a pas ce cadre). */
  detailExceptionnel: DetailExceptionnel | null;
  renvois: RenvoiDetail[];
  /** Partie B du 2033-B ; null au régime réel normal. */
  resultatFiscal: ResultatFiscalProjet | null;
  renvoisNonPrepares: readonly string[];
  controles: ControleDetail[];
  limites: string[];
  sources: readonly string[];
  mention: string;
  perimetreCouvert: string;
}

export type ResultatDetailResultat = DetailResultatProjet | LiasseAbstention;

const PREFIXES_TOUS_CA = LIGNES_CA.flatMap((l) => l.prefixes);
const lignesCA = (regime: RegimeLiasse): readonly DefinitionLigneCA[] => (regime === 'reel_simplifie' ? LIGNES_CA_RSI : LIGNES_CA);
const commencePar = (compte: string, prefixes: readonly string[]): boolean => prefixes.some((p) => compte.startsWith(p));
const soldeCrediteur = (l: { totalCredit: string; totalDebit: string }): Decimal => new Decimal(l.totalCredit).minus(l.totalDebit);
const soldeDebiteur = (l: { totalCredit: string; totalDebit: string }): Decimal => new Decimal(l.totalDebit).minus(l.totalCredit);

function etablie(montant: Decimal, codeCase: string | null): CelluleVentilation {
  return { statut: 'etabli', montant: versChaine(montant), codeCase, etatCodeCase: 'lu_verifie' };
}
function abstention(motif: string, codeCase: string | null): CelluleVentilation {
  return { statut: 'abstention', motif, codeCase, etatCodeCase: 'lu_verifie' };
}

function qualifierComptes(demande: DemandeDetailResultat): { lignes: LigneChiffreAffaires[]; nonAffectes: CompteNonAffecte[]; orphelines: Array<{ compte: string; motif: string }> } {
  const parCompte = new Map(demande.ventilations.map((q) => [q.compte, q]));
  const vus = new Set<string>();
  const lignes: LigneChiffreAffaires[] = lignesCA(demande.regime).map((def) => {
    const comptes: CompteChiffreAffaires[] = demande.balance.lignes
      .filter((l) => commencePar(l.compteNum, def.prefixes))
      .map((l) => {
        vus.add(l.compteNum);
        const solde = soldeCrediteur(l);
        const q = parCompte.get(l.compteNum) ?? null;
        if (solde.isZero()) return { compteNum: l.compteNum, compteLib: l.compteLib, solde: versChaine(solde), etat: 'sans_montant' as const, qualification: q };
        if (q === null) return { compteNum: l.compteNum, compteLib: l.compteLib, solde: versChaine(solde), etat: 'a_qualifier' as const, qualification: null };
        const ecart = solde.minus(new Decimal(q.montantFrance)).minus(q.montantExport);
        if (!ecart.isZero()) return { compteNum: l.compteNum, compteLib: l.compteLib, solde: versChaine(solde), etat: 'ecart' as const, qualification: q, ecart: versChaine(ecart) };
        if (q.versionDonnees !== demande.versionDonnees) return { compteNum: l.compteNum, compteLib: l.compteLib, solde: versChaine(solde), etat: 'a_revoir' as const, qualification: q };
        return { compteNum: l.compteNum, compteLib: l.compteLib, solde: versChaine(solde), etat: 'qualifie' as const, qualification: q };
      });
    const total = comptes.reduce((s, c) => s.plus(c.solde), ZERO);
    const aQualifier = comptes.filter((c) => c.etat === 'a_qualifier' || c.etat === 'ecart' || c.etat === 'a_revoir');
    const qualifiee = aQualifier.length === 0;
    const motif = qualifiee ? '' : `${aQualifier.length} compte(s) à qualifier ou à revoir (${aQualifier.map((c) => c.compteNum).join(', ')}) : la répartition France / exportations n’est pas déduite des écritures.`;
    const france = comptes.filter((c) => c.etat !== 'sans_montant').reduce((s, c) => s.plus(c.qualification?.montantFrance ?? 0), ZERO);
    const export_ = comptes.filter((c) => c.etat !== 'sans_montant').reduce((s, c) => s.plus(c.qualification?.montantExport ?? 0), ZERO);
    return {
      id: def.id,
      libelle: def.libelle,
      comptes,
      total: etablie(total, def.codes.total),
      france: qualifiee ? etablie(france, def.codes.france) : abstention(motif, def.codes.france),
      export: qualifiee ? etablie(export_, def.codes.export) : abstention(motif, def.codes.export),
      qualifiee,
    };
  });
  const nonAffectes: CompteNonAffecte[] = demande.balance.lignes
    .filter((l) => l.compteNum.startsWith('70') && !vus.has(l.compteNum))
    .map((l) => ({ compteNum: l.compteNum, compteLib: l.compteLib, solde: versChaine(soldeCrediteur(l)), motif: 'Compte de la classe 70 sans ligne certaine (ni marchandises, ni production vendue) : absent de tous les totaux ci-dessous.' }))
    .filter((c) => c.solde !== '0.00');
  const existants = new Map(demande.balance.lignes.map((l) => [l.compteNum, l]));
  const orphelines = demande.ventilations
    .filter((q) => {
      const l = existants.get(q.compte);
      return l === undefined || !commencePar(q.compte, PREFIXES_TOUS_CA) || soldeCrediteur(l).isZero();
    })
    .map((q) => ({ compte: q.compte, motif: 'Le compte n’existe pas dans la balance de l’exercice, n’appartient à aucune ligne du chiffre d’affaires ou ne porte aucun montant : qualification ignorée.' }));
  return { lignes, nonAffectes, orphelines };
}

function detailExceptionnel(balance: Balance): DetailExceptionnel {
  const produits = balance.lignes.filter((l) => l.compteNum.startsWith('77') || l.compteNum.startsWith('787')).map((l) => ({ compteNum: l.compteNum, compteLib: l.compteLib, montant: versChaine(soldeCrediteur(l)) })).filter((l) => l.montant !== '0.00');
  const charges = balance.lignes.filter((l) => l.compteNum.startsWith('67') || l.compteNum.startsWith('687')).map((l) => ({ compteNum: l.compteNum, compteLib: l.compteLib, montant: versChaine(soldeDebiteur(l)) })).filter((l) => l.montant !== '0.00');
  const tp = produits.reduce((s, l) => s.plus(l.montant), ZERO);
  const tc = charges.reduce((s, l) => s.plus(l.montant), ZERO);
  return { produits, charges, totalProduits: versChaine(tp), totalCharges: versChaine(tc), resultatExceptionnel: versChaine(tp.minus(tc)), origine: 'Comptes 67, 687 (charges) et 77, 787 (produits) de la balance, tels qu’affectés aux lignes VII et VIII du tableau 2053 ; aucun libellé interprété.' };
}

function renvoisDetail(demande: DemandeDetailResultat): RenvoiDetail[] {
  const saisies = new Map(demande.renvois.map((r) => [r.code, r]));
  return (demande.regime === 'reel_simplifie' ? RENVOIS_RSI : RENVOIS).map((def) => {
    const saisie = saisies.get(def.code) ?? null;
    let proposition: RenvoiDetail['proposition'] = null;
    if (def.comptesProposition !== undefined) {
      const lignes = demande.balance.lignes.filter((l) => commencePar(l.compteNum, def.comptesProposition!));
      const m = lignes.reduce((s, l) => s.plus(def.nature === 'charge' ? soldeDebiteur(l) : soldeCrediteur(l)), ZERO);
      if (lignes.length > 0 && !m.isZero()) proposition = { montant: versChaine(m), comptes: lignes.map((l) => l.compteNum), precision: def.precision };
    }
    const statut = saisie === null ? 'a_saisir' : saisie.versionDonnees !== demande.versionDonnees ? 'a_revoir' : 'saisi';
    return { code: def.code, renvoi: def.renvoi, tableau: def.tableau, libelle: def.libelle, codeCase: def.codeCase === undefined ? def.code : def.codeCase, etatCodeCase: 'lu_verifie', statut, montant: statut === 'saisi' ? saisie!.montant : null, saisie, proposition, precision: def.precision };
  });
}

const NON_PREPARE_RESULTAT_FISCAL: readonly string[] = [
  'Détail de la ligne « Divers » des réintégrations (cases 247, 248, 249, 251), des déductions de zones (cases 986 à 993, 127, 138, 181, 344, 345) et du détail des divers à déduire (cases 346, 655, 643, 645, 647, 648, 641, 990, 649) : seuls les TOTAUX de ligne (330, 342, 350) se saisissent.',
  'Activité relevant du régime optionnel de taxation au tonnage des entreprises de transport maritime (cases 997, 998, 999) : non préparée ; si l’entreprise a opté pour ce régime, ce calcul ne s’applique pas.',
  'Aucune décision fiscale n’est prise par Comtaple : chaque réintégration ou déduction est une saisie justifiée du cabinet ; le calcul se borne à l’arithmétique du formulaire (résultat comptable + réintégrations − déductions, puis imputation saisie).',
];

function resultatFiscal(demande: DemandeDetailResultat): ResultatFiscalProjet {
  const saisies = new Map(demande.renvois.map((r) => [r.code, r]));
  const lignes: LigneResultatFiscal[] = LIGNES_RESULTAT_FISCAL.map((def) => {
    const saisie = saisies.get(def.cle) ?? null;
    const statut = saisie === null ? 'a_saisir' : saisie.versionDonnees !== demande.versionDonnees ? 'a_revoir' : 'saisi';
    const montant = statut === 'saisi' ? saisie!.montant : null;
    return { cle: def.cle, codeCase: def.codeCase, etatCodeCase: 'lu_verifie', libelle: def.libelle, role: def.role, statut, neant: montant !== null && new Decimal(montant).isZero(), montant, saisie, precision: def.precision };
  });
  const ligne = (cle: string) => lignes.find((l) => l.cle === cle)!;
  const controles: ControleDetail[] = [];
  const abst = (motifs: string[], codes: string[]): ResultatSigne => ({ statut: 'abstention', motifs, codesCases: codes, etatCodeCase: 'lu_verifie' });
  const signe = (v: Decimal, codeBenefice: string, codeDeficit: string): ResultatSigne =>
    v.isNegative() ? { statut: 'etabli', sens: 'deficit', montant: versChaine(v.negated()), codeCase: codeDeficit, etatCodeCase: 'lu_verifie' } : { statut: 'etabli', sens: v.isZero() ? 'nul' : 'benefice', montant: versChaine(v), codeCase: codeBenefice, etatCodeCase: 'lu_verifie' };

  // Résultat comptable (ligne 310 du 2033-B) reporté en 312 / 314.
  const rc = demande.resultatComptable ?? null;
  const resultatComptable: ResultatSigne = rc === null ? abst(['Le résultat comptable (ligne 310 du tableau 2033-B) n’est pas établi : la liasse s’abstient ou n’est pas préparée pour cet exercice.'], ['312', '314']) : signe(new Decimal(rc), '312', '314');

  // Valeurs négatives : une réintégration ou une déduction se saisit en positif (le sens est celui du formulaire).
  const negatives = lignes.filter((l) => l.montant !== null && new Decimal(l.montant).isNegative());
  for (const l of negatives) controles.push({ code: `RF_NEGATIF_${l.codeCase}`, statut: 'ecart', message: `Case ${l.codeCase} : un montant négatif est refusé (réintégrations et déductions se saisissent en positif).`, ecart: l.montant! });

  // Avant imputation : requiert le résultat comptable et les sept lignes (néant explicite accepté).
  const manquantes = CLES_AVANT_IMPUTATION.filter((c) => ligne(c).statut !== 'saisi');
  const motifsAvant: string[] = [];
  if (resultatComptable.statut === 'abstention') motifsAvant.push(...resultatComptable.motifs);
  if (manquantes.length > 0) motifsAvant.push(`${manquantes.length} ligne(s) sans saisie retenue (${manquantes.map((c) => ligne(c).codeCase).join(', ')}) : rien n’est présumé nul ; saisir un montant ou déclarer « néant ».`);
  if (negatives.length > 0) motifsAvant.push('Au moins un montant négatif saisi : à corriger.');
  let avantImputation: ResultatSigne = abst(motifsAvant, ['352', '354']);
  if (motifsAvant.length === 0 && resultatComptable.statut === 'etabli') {
    const b = new Decimal(rc!);
    const somme = (role: RoleResultatFiscal) => lignes.filter((l) => l.role === role && CLES_AVANT_IMPUTATION.includes(l.cle)).reduce((s, l) => s.plus(l.montant!), ZERO);
    avantImputation = signe(b.plus(somme('reintegration')).minus(somme('deduction')), '352', '354');
  }
  controles.push(avantImputation.statut === 'etabli'
    ? { code: 'RF_AVANT_IMPUTATION', statut: 'coherent', message: `Résultat fiscal avant imputation : ${avantImputation.sens === 'deficit' ? 'déficit' : avantImputation.sens === 'nul' ? 'nul' : 'bénéfice'} de ${avantImputation.montant} (case ${avantImputation.codeCase}) = résultat comptable + réintégrations − déductions saisies.` }
    : { code: 'RF_AVANT_IMPUTATION', statut: 'non_verifie', message: 'Résultat fiscal avant imputation non établi (abstention) : voir les motifs.' });

  // Plafond d'imputation des déficits antérieurs (notice 2033-NOT-SD p. 13).
  let plafond: ResultatFiscalProjet['plafondImputation'] = null;
  if (avantImputation.statut === 'etabli' && avantImputation.sens === 'benefice') {
    const ben = new Decimal(avantImputation.montant);
    const p = SEUIL_IMPUTATION.plus(Decimal.max(ZERO, ben.minus(SEUIL_IMPUTATION)).times('0.5'));
    plafond = { montant: versChaine(Decimal.min(p, ben)), regle: 'Déficits antérieurs imputables dans la limite de 1 000 000 €, majorée de 50 % du bénéfice excédant ce montant, sans excéder le bénéfice (notice 2033-NOT-SD, page 13 ; art. 209, I du CGI).' };
  }

  // Après imputation : requiert 356 et 360 saisis ; l'effet d'un report en arrière n'est pas établi.
  const motifsApres: string[] = [];
  if (avantImputation.statut === 'abstention') motifsApres.push('Le résultat avant imputation n’est pas établi.');
  const manquantesApres = ['RF_356', 'RF_360'].filter((c) => ligne(c).statut !== 'saisi');
  if (manquantesApres.length > 0) motifsApres.push(`Ligne(s) sans saisie retenue (${manquantesApres.map((c) => ligne(c).codeCase).join(', ')}) : saisir un montant ou déclarer « néant ».`);
  const reporte = ligne('RF_356').montant;
  if (reporte !== null && !new Decimal(reporte).isZero()) motifsApres.push('Un déficit est reporté en arrière (case 356) : son effet sur le résultat après imputation n’est pas établi par Comtaple (créance, déclaration 2039-SD) : abstention.');
  const imputes = ligne('RF_360').montant;
  let apresImputation: ResultatSigne = abst(motifsApres, ['370', '372']);
  if (motifsApres.length === 0 && avantImputation.statut === 'etabli') {
    const i = new Decimal(imputes!);
    if (avantImputation.sens === 'benefice') {
      const ben = new Decimal(avantImputation.montant);
      if (i.greaterThan(new Decimal(plafond!.montant))) {
        controles.push({ code: 'RF_IMPUTATION', statut: 'ecart', message: `Déficits imputés (${versChaine(i)}) supérieurs au plafond d’imputation (${plafond!.montant}) : non retenu, à corriger.`, ecart: versChaine(i.minus(plafond!.montant)) });
        apresImputation = abst([`Les déficits imputés dépassent le plafond d’imputation de ${plafond!.montant}.`], ['370', '372']);
      } else {
        apresImputation = signe(ben.minus(i), '370', '372');
        controles.push({ code: 'RF_IMPUTATION', statut: 'coherent', message: `Imputation de ${versChaine(i)} (plafond ${plafond!.montant}) : résultat fiscal après imputation ${versChaine(ben.minus(i))}.` });
      }
    } else if (!i.isZero()) {
      controles.push({ code: 'RF_IMPUTATION', statut: 'ecart', message: `Des déficits sont imputés (${versChaine(i)}) alors que le résultat avant imputation n’est pas un bénéfice : non retenu.`, ecart: versChaine(i) });
      apresImputation = abst(['Des déficits sont imputés alors que le résultat avant imputation n’est pas un bénéfice.'], ['370', '372']);
    } else apresImputation = signe(avantImputation.sens === 'deficit' ? new Decimal(avantImputation.montant).negated() : ZERO, '370', '372');
  }
  controles.push(apresImputation.statut === 'etabli'
    ? { code: 'RF_APRES_IMPUTATION', statut: 'coherent', message: `Résultat fiscal après imputation : ${apresImputation.sens === 'deficit' ? 'déficit' : apresImputation.sens === 'nul' ? 'nul' : 'bénéfice'} de ${apresImputation.montant} (case ${apresImputation.codeCase}).` }
    : { code: 'RF_APRES_IMPUTATION', statut: 'non_verifie', message: 'Résultat fiscal après imputation non établi (abstention) : voir les motifs.' });

  return { resultatComptable, lignes, avantImputation, plafondImputation: plafond, apresImputation, controles, lignesManquantes: manquantes.map((c) => ligne(c).codeCase), nonPrepare: [...NON_PREPARE_RESULTAT_FISCAL] };
}

export function preparerDetailResultat(demande: DemandeDetailResultat): ResultatDetailResultat {
  const motifs = motifsAbstention({ exercice: demande.exercice, regime: demande.regime, territoire: demande.territoire, impotSurLeResultat: demande.impotSurLeResultat, referentielComptable: demande.referentielComptable, devise: demande.devise, societeCommerciale: demande.societeCommerciale });
  if (motifs.length > 0) return { statut: 'abstention', motifs, perimetreCouvert: PERIMETRE_LIASSE, mention: MENTION_PROJET };

  const { lignes, nonAffectes, orphelines } = qualifierComptes(demande);
  const tousQualifies = lignes.every((l) => l.qualifiee);
  const totalNet = lignes.reduce((s, l) => s.plus(l.total.statut === 'etabli' ? l.total.montant : 0), ZERO);
  const franceNet = lignes.reduce((s, l) => s.plus(l.france.statut === 'etabli' ? l.france.montant : 0), ZERO);
  const exportNet = lignes.reduce((s, l) => s.plus(l.export.statut === 'etabli' ? l.export.montant : 0), ZERO);
  const motifNet = 'Le chiffre d’affaires net n’est ventilé que lorsque toutes les lignes le sont : au moins un compte reste à qualifier.';
  const nbAQualifier = lignes.flatMap((l) => l.comptes).filter((c) => c.etat === 'a_qualifier' || c.etat === 'ecart' || c.etat === 'a_revoir').length;
  const simplifie = demande.regime === 'reel_simplifie';
  const ventilation: VentilationChiffreAffaires = {
    lignes,
    chiffreAffairesNet: simplifie
      ? null
      : {
          total: etablie(totalNet, CODES_CA_NET.total),
          france: tousQualifies ? etablie(franceNet, CODES_CA_NET.france) : abstention(motifNet, CODES_CA_NET.france),
          export: tousQualifies ? etablie(exportNet, CODES_CA_NET.export) : abstention(motifNet, CODES_CA_NET.export),
        },
    comptesNonAffectes: nonAffectes,
    qualificationsOrphelines: orphelines,
    nbComptesAQualifier: nbAQualifier,
    complete: tousQualifies && nonAffectes.length === 0,
  };

  const exceptionnel = simplifie ? null : detailExceptionnel(demande.balance);
  const renvois = renvoisDetail(demande);

  const controles: ControleDetail[] = [];
  const tousComptes70 = demande.balance.lignes.filter((l) => l.compteNum.startsWith('70')).reduce((s, l) => s.plus(soldeCrediteur(l)), ZERO);
  const ecart70 = tousComptes70.minus(totalNet);
  controles.push(ecart70.isZero()
    ? { code: 'CA_COMPTES_70', statut: 'coherent', message: 'Le chiffre d’affaires net ventilé reprend le solde de tous les comptes de la classe 70.' }
    : { code: 'CA_COMPTES_70', statut: 'ecart', message: 'Le chiffre d’affaires net ventilé diffère du solde des comptes de la classe 70 : comptes sans ligne certaine, listés ci-dessus. Aucun ajustement n’est pratiqué.', ecart: versChaine(ecart70) });
  if (tousQualifies) {
    const ecartVentil = totalNet.minus(franceNet).minus(exportNet);
    controles.push(ecartVentil.isZero()
      ? { code: 'CA_FRANCE_EXPORT', statut: 'coherent', message: 'France + exportations et livraisons intracommunautaires = chiffre d’affaires net.' }
      : { code: 'CA_FRANCE_EXPORT', statut: 'ecart', message: 'France + exportations diffèrent du chiffre d’affaires net.', ecart: versChaine(ecartVentil) });
  } else {
    controles.push({ code: 'CA_FRANCE_EXPORT', statut: 'non_verifie', message: `Répartition France / exportations non vérifiable : ${nbAQualifier} compte(s) à qualifier.` });
  }
  if (exceptionnel !== null) controles.push({ code: 'EXCEPTIONNEL_RESULTAT', statut: 'coherent', message: `Résultat exceptionnel du détail : ${exceptionnel.resultatExceptionnel} (produits ${exceptionnel.totalProduits}, charges ${exceptionnel.totalCharges}).` });
  const sansSaisie = renvois.filter((r) => r.statut !== 'saisi').length;
  controles.push({ code: 'RENVOIS', statut: 'non_verifie', message: `${sansSaisie} renvoi(s) sur ${renvois.length} sans saisie retenue : aucun montant n’est présumé ; une case sans saisie reste vide.` });

  return {
    statut: 'projet',
    complet: false,
    regime: demande.regime,
    exercice: demande.exercice,
    ventilationChiffreAffaires: ventilation,
    detailExceptionnel: exceptionnel,
    renvois,
    resultatFiscal: simplifie ? resultatFiscal(demande) : null,
    renvoisNonPrepares: simplifie ? RENVOIS_NON_PREPARES_RSI : RENVOIS_NON_PREPARES_RSN,
    controles,
    limites: [
      'Calcul sur les écritures importées, AVANT écritures d’inventaire.',
      'La ventilation France / exportations est une saisie du cabinet : Comtaple la trace et en vérifie l’arithmétique (somme égale au solde du compte), pas la réalité de la destination des ventes ni la notion fiscale d’exportation ou de livraison intracommunautaire.',
      'Les montants d’une qualification sont exprimés dans le sens du produit : un compte débiteur de rabais, remises et ristournes (709x) se qualifie avec des montants NÉGATIFS.',
      'La scission des comptes de la classe 70 entre biens et services est une convention interne tirée de la table de correspondance existante : à faire valider.',
      ...(simplifie ? ['Au régime simplifié (tableau 2033-B), le formulaire ne demande que la part « dont export et livraisons intracommunautaires » (cases 209, 215, 217) et le total ; la part France se déduit (total − export) mais n’a pas de case et n’est pas présentée.'] : []),
      'Codes de cases lus par extraction de texte positionnée des formulaires 2026 puis vérifiés sur le rendu image des pages (2026-11-21) ; les lignes « crédit-bail » du tableau 2033-B n’ont pas de code.',
    ],
    sources: SOURCES_DETAIL_RESULTAT,
    mention: MENTION_PROJET,
    perimetreCouvert: PERIMETRE_LIASSE,
  };
}
