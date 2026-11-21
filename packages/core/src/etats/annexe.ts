/**
 * Projet d'annexe des comptes annuels — modèle structuré des informations du chapitre III du titre VIII du PCG
 * (art. 831-1 à 838-19, version consolidée au 1er janvier 2026), pour une personne morale.
 *
 * Pour chaque rubrique : l'article, ce que le moteur PRÉ-REMPLIT à partir des écritures (soldes, mouvements débit / crédit
 * hors à-nouveaux) et ce que le cabinet doit SAISIR. Statuts : `pre_rempli`, `a_completer`, `non_applicable_a_confirmer`.
 *
 * Règles :
 *  - le moteur ne rédige rien et n'interprète aucun libellé ; il ne connaît ni les méthodes, ni les engagements, ni l'effectif ;
 *  - les colonnes qui ne se déduisent pas des écritures (échéances, nature des mouvements, reprises utilisées…) valent `null` ;
 *  - une rubrique dont l'objet paraît absent de la balance est « non applicable, à confirmer » — jamais « non applicable » tout court ;
 *  - l'annexe n'est `complet: true` que si CHAQUE rubrique requise a été confirmée par le cabinet (`confirmations`) ;
 *    même alors elle reste un projet en attente de validation professionnelle ;
 *  - les allègements par taille reposent sur une catégorie FOURNIE par le cabinet ; `evaluerCategorieTaille` n'est qu'une aide,
 *    sur des seuils paramétrables marqués « seuil à confirmer ».
 */
import { Decimal } from 'decimal.js';
import { creditDe, debitDe } from '../controles/outils.js';
import type { LigneEcriture, SourceRegle } from '../controles/types.js';
import { estDateIso } from '../dates.js';
import { type ChaineDecimale, dec, versChaine } from '../montant.js';
import { calculerBalance } from './balance.js';
import { correspondancePour } from './correspondance.js';
import { colonneDuCompte } from './liasse.js';
import { projeterBilan, projeterCompteDeResultat } from './projection.js';
import { MENTION_PROJET, SOURCES_FISCALES } from './sources-fiscales.js';
import type { CorrespondanceRubriques, RubriqueDefinition, RubriqueProjetee } from './types.js';

const ZERO = new Decimal(0);

// ───────────────────────────── Types publics ─────────────────────────────

/**
 * Catégorie retenue PAR LE CABINET pour le contenu de l'annexe (personne morale) :
 *  - `micro_entreprise` : art. L. 123-16-1 du code de commerce (dispense possible, PCG art. 811-7) ;
 *  - `petite_entreprise` : art. L. 123-16 (PCG art. 811-9) ;
 *  - `personne_morale_regime_simplifie` : art. L. 123-25, régime réel simplifié d'imposition (PCG art. 811-8) ;
 *  - `moyenne_ou_grande_entreprise` : toutes les informations ;
 *  - `a_confirmer` : toutes les informations sont réputées requises, par prudence.
 */
export type CategorieEntiteAnnexe = 'micro_entreprise' | 'petite_entreprise' | 'personne_morale_regime_simplifie' | 'moyenne_ou_grande_entreprise' | 'a_confirmer';

export type StatutRubriqueAnnexe = 'pre_rempli' | 'a_completer' | 'non_applicable_a_confirmer';

export interface LigneTableauAnnexe {
  libelle: string;
  /** Rubrique de la table des comptes dont la ligne reprend les comptes, ou `null`. */
  rubriquePcg: string | null;
  /** Valeurs par clé de colonne. `null` : non déductible des écritures, à saisir. */
  valeurs: Record<string, ChaineDecimale | null>;
  /** Comptes composant la ligne, avec leur solde de clôture (débit − crédit). */
  comptes: Array<{ compteNum: string; compteLib: string; solde: ChaineDecimale }>;
  estTotal: boolean;
}

export interface TableauAnnexe {
  titre: string;
  colonnes: Array<{ cle: string; libelle: string; aSaisir: boolean }>;
  lignes: LigneTableauAnnexe[];
  reserves: string[];
}

export interface RubriqueAnnexe {
  /** Identifiant stable, ex. « ANX-832-1 ». */
  id: string;
  /** Référence précise, ex. « PCG (règlement ANC n° 2014-03), art. 832-1 ». */
  reference: string;
  article: string;
  section: string;
  titre: string;
  /** Ce que l'article demande (résumé fidèle, non limitatif : le texte de l'article fait foi). */
  objet: string;
  /** L'information est-elle requise pour la catégorie retenue ? */
  requise: boolean;
  motifApplicabilite: string;
  statut: StatutRubriqueAnnexe;
  motifStatut: string;
  /** Ce que le moteur a pu pré-remplir à partir des écritures. */
  preRemplissage: TableauAnnexe[];
  /** Ce que le cabinet doit saisir ou confirmer. */
  aSaisir: string[];
  /** Décision du cabinet transmise dans la demande, ou `null`. */
  confirmation: 'complete' | 'non_applicable' | null;
}

export interface DemandeAnnexe {
  /** Écritures de l'exercice (à-nouveaux compris). */
  lignes: readonly LigneEcriture[];
  exercice: { debut: string; fin: string };
  /** Seul « PCG » est couvert. */
  referentielComptable: string;
  categorie: CategorieEntiteAnnexe;
  /** Micro-entreprise uniquement : le cabinet a-t-il choisi de ne pas établir d'annexe (PCG art. 811-7) ? Défaut : non. */
  dispenseAnnexeMicro?: boolean;
  /** Codes des journaux d'à-nouveaux (défaut : AN, ANO, RAN). Sans à-nouveaux identifiés, les colonnes d'ouverture et de mouvements valent `null`. */
  journauxANouveaux?: readonly string[];
  /** Décisions du cabinet par identifiant de rubrique : `complete` (rubrique rédigée) ou `non_applicable` (sans objet, confirmé). */
  confirmations?: Readonly<Record<string, 'complete' | 'non_applicable'>>;
}

export interface AnnexeAbstention {
  statut: 'abstention';
  motifs: Array<{ code: 'referentiel_hors_perimetre' | 'exercice_invalide' | 'exercice_hors_periode'; message: string }>;
  mention: string;
}

export interface AnnexeProjet {
  statut: 'projet';
  /** Vrai seulement si chaque rubrique requise porte une confirmation du cabinet. */
  complet: boolean;
  manques: string[];
  mention: string;
  exercice: { debut: string; fin: string };
  categorie: CategorieEntiteAnnexe;
  /** `annexe` : annexe établie ; `mentions_a_la_suite_du_bilan` : micro-entreprise dispensée d'annexe (PCG art. 811-7). */
  forme: 'annexe' | 'mentions_a_la_suite_du_bilan';
  /** Les seuils de taille n'ont pas été relus sur le code de commerce : la catégorie est à confirmer par le cabinet. */
  seuilsAConfirmer: true;
  reserves: string[];
  modele: { id: string; version: string; periodeApplication: string };
  correspondanceComptes: { id: string; version: string };
  aNouveauxIdentifies: boolean;
  rubriques: RubriqueAnnexe[];
  sources: SourceRegle[];
}

export type ResultatAnnexe = AnnexeProjet | AnnexeAbstention;

// ───────────────────────────── Seuils de taille (paramétrables, à confirmer) ─────────────────────────────

export interface SeuilsCategorie { totalBilan: ChaineDecimale; chiffreAffairesNet: ChaineDecimale; effectifMoyen: number }
export interface SeuilsTaille {
  /** Toujours « seuil_a_confirmer » tant que l'article D. 123-200 du code de commerce n'a pas été relu. */
  etat: 'seuil_a_confirmer' | 'confirme_par_le_cabinet';
  source: SourceRegle;
  micro: SeuilsCategorie;
  petite: SeuilsCategorie;
  moyenne: SeuilsCategorie;
}

/** Seuils lus le 2026-11-19 sur entreprendre.service-public.gouv.fr (page du 5 mars 2024), PAS sur Légifrance : à confirmer. */
export const SEUILS_TAILLE_PAR_DEFAUT: SeuilsTaille = {
  etat: 'seuil_a_confirmer',
  source: SOURCES_FISCALES.seuilsTailleServicePublic,
  micro: { totalBilan: '450000.00', chiffreAffairesNet: '900000.00', effectifMoyen: 10 },
  petite: { totalBilan: '7500000.00', chiffreAffairesNet: '15000000.00', effectifMoyen: 50 },
  moyenne: { totalBilan: '25000000.00', chiffreAffairesNet: '50000000.00', effectifMoyen: 250 },
};

export interface EvaluationTaille {
  /** `a_confirmer` dès qu'une mesure manquante empêche de conclure. */
  categorie: 'micro_entreprise' | 'petite_entreprise' | 'moyenne_entreprise' | 'grande_entreprise' | 'a_confirmer';
  seuilsAConfirmer: boolean;
  /** Nombre de seuils dépassés par catégorie, parmi les mesures connues. */
  depassements: { micro: number; petite: number; moyenne: number };
  mesuresManquantes: string[];
  reserves: string[];
  source: SourceRegle;
}

/**
 * Aide au classement par taille : une catégorie est retenue si l'entité ne dépasse pas deux des trois seuils (dépassement strict).
 * Calcul sur UN exercice : la règle de franchissement sur deux exercices consécutifs n'est pas appliquée (texte non relu).
 * Le résultat est indicatif ; la catégorie utilisée par `preparerAnnexe` est celle que le cabinet fournit.
 */
export function evaluerCategorieTaille(
  mesures: { totalBilan: ChaineDecimale | null; chiffreAffairesNet: ChaineDecimale | null; effectifMoyen: number | null },
  seuils: SeuilsTaille = SEUILS_TAILLE_PAR_DEFAUT,
): EvaluationTaille {
  if (mesures.effectifMoyen !== null && (!Number.isFinite(mesures.effectifMoyen) || mesures.effectifMoyen < 0)) throw new Error('Effectif moyen invalide : nombre positif ou nul attendu.');
  const manquantes = [mesures.totalBilan === null ? 'total du bilan' : null, mesures.chiffreAffairesNet === null ? 'chiffre d’affaires net' : null, mesures.effectifMoyen === null ? 'nombre moyen de salariés' : null].filter((m): m is string => m !== null);
  const depasses = (s: SeuilsCategorie): number =>
    (mesures.totalBilan !== null && dec(mesures.totalBilan).greaterThan(dec(s.totalBilan)) ? 1 : 0) +
    (mesures.chiffreAffairesNet !== null && dec(mesures.chiffreAffairesNet).greaterThan(dec(s.chiffreAffairesNet)) ? 1 : 0) +
    (mesures.effectifMoyen !== null && mesures.effectifMoyen > s.effectifMoyen ? 1 : 0);
  const depassements = { micro: depasses(seuils.micro), petite: depasses(seuils.petite), moyenne: depasses(seuils.moyenne) };
  // « oui » : au plus un seuil dépassé même si les mesures manquantes le dépassaient toutes ; « non » : au moins deux seuils dépassés.
  const verdict = (n: number): 'oui' | 'non' | 'indetermine' => (n >= 2 ? 'non' : n + manquantes.length < 2 ? 'oui' : 'indetermine');
  const ordre: Array<[EvaluationTaille['categorie'], number]> = [['micro_entreprise', depassements.micro], ['petite_entreprise', depassements.petite], ['moyenne_entreprise', depassements.moyenne]];
  let categorie: EvaluationTaille['categorie'] = 'grande_entreprise';
  for (const [nom, n] of ordre) {
    const v = verdict(n);
    if (v === 'oui') { categorie = nom; break; }
    if (v === 'indetermine') { categorie = 'a_confirmer'; break; }
  }
  return {
    categorie,
    seuilsAConfirmer: seuils.etat !== 'confirme_par_le_cabinet',
    depassements,
    mesuresManquantes: manquantes,
    reserves: [
      'Classement indicatif calculé sur un seul exercice : la règle de franchissement des seuils sur deux exercices consécutifs n’est pas appliquée.',
      'Les définitions légales du total du bilan, du chiffre d’affaires net et du nombre moyen de salariés, ainsi que les entités exclues des allègements, n’ont pas été relues (Légifrance inaccessible le 2026-11-19).',
      ...(seuils.etat === 'confirme_par_le_cabinet' ? [] : ['Seuils à confirmer sur l’article D. 123-200 du code de commerce en vigueur.']),
    ],
    source: seuils.source,
  };
}

// ───────────────────────────── Modèle des rubriques ─────────────────────────────

export const MODELE_ANNEXE = {
  id: 'ANNEXE-PCG-PERSONNE-MORALE',
  version: '2025.1',
  periodeApplication: 'Exercices ouverts à compter du 2025-01-01 (PCG, règlement ANC n° 2014-03 consolidé au 1er janvier 2026, chapitre III du titre VIII).',
} as const;

const ARTICLES_REGIME_SIMPLIFIE = ['831-1', '831-2', '832-1', '832-3', '832-8', '832-9', '832-12', '832-13', '832-15', '834-2', '836-1', '836-3', '836-5'];
const ARTICLES_PETITE_ENTREPRISE = [
  '831-1', '831-2', '832-1', '832-2', '832-3', '832-4', '832-5', '832-6', '832-7', '832-8', '832-9', '832-10', '832-11', '832-12', '832-13', '832-14', '832-15', '832-17', '832-19', '832-21',
  '833-1', '833-2', '834-2', '835-1', '836-1', '836-2', '836-3', '836-5', '837-1',
];

/** Articles requis par catégorie (PCG art. 811-8 et 811-9, relus ; « 838-1 et suivants » toujours inclus). */
export function articlesRequisPourCategorie(categorie: CategorieEntiteAnnexe, tousLesArticles: readonly string[]): { articles: string[]; motif: string } {
  const autres = tousLesArticles.filter((a) => a.startsWith('838-'));
  switch (categorie) {
    case 'personne_morale_regime_simplifie':
      return { articles: [...ARTICLES_REGIME_SIMPLIFIE, ...autres], motif: 'PCG art. 811-8 : personne morale relevant de l’article L. 123-25 du code de commerce (régime réel simplifié d’imposition).' };
    case 'petite_entreprise':
      return { articles: [...ARTICLES_PETITE_ENTREPRISE, ...autres], motif: 'PCG art. 811-9 : personne morale répondant aux critères de la petite entreprise (art. L. 123-16 du code de commerce).' };
    case 'micro_entreprise':
      return { articles: [...ARTICLES_PETITE_ENTREPRISE, ...autres], motif: 'Micro-entreprise établissant une annexe : contenu de la petite entreprise (PCG art. 811-9) — lecture à confirmer, le PCG ne prévoyant pour la micro-entreprise que la dispense de l’art. 811-7.' };
    case 'moyenne_ou_grande_entreprise':
      return { articles: tousLesArticles.filter((a) => a !== '834-2'), motif: 'Moyenne entreprise ou autre personne morale : ensemble des informations du chapitre III (tableau de l’art. 811-12, à confirmer) ; l’art. 834-2 ne vise que les sociétés anonymes petites ou au régime simplifié.' };
    case 'a_confirmer':
      return { articles: [...tousLesArticles], motif: 'Catégorie de taille à confirmer : toutes les informations sont réputées requises, par prudence.' };
  }
}

interface CompteSuivi { compteNum: string; compteLib: string; ouverture: Decimal; debit: Decimal; credit: Decimal; cloture: Decimal }

interface Contexte {
  comptes: Map<string, CompteSuivi>;
  aNouveauxIdentifies: boolean;
  rubriques: Map<string, RubriqueProjetee>;
  definitions: Map<string, RubriqueDefinition>;
}

type Presence = 'presente' | 'absente' | 'inconnue';
interface Construction { tableaux: TableauAnnexe[]; presence: Presence; motif: string }

interface DefinitionRubrique {
  article: string;
  section: string;
  titre: string;
  objet: string;
  aSaisir: string[];
  /** Statut quand rien ne peut être déduit des écritures (défaut : `a_completer`). */
  parDefaut?: StatutRubriqueAnnexe;
  construire?: (ctx: Contexte) => Construction;
}

const RESERVE_SANS_A_NOUVEAUX = 'Journal d’à-nouveaux non identifié : les montants d’ouverture et les mouvements de l’exercice ne sont pas calculés (colonnes à saisir).';
const RESERVE_MOUVEMENTS = 'Augmentations et diminutions = mouvements débit et crédit des comptes hors à-nouveaux : ils comprennent les virements de poste à poste, les extournes et les corrections ; leur nature est à qualifier.';

const COLONNES_MOUVEMENTS = (ouverture: string, plus: string, moins: string, cloture: string): TableauAnnexe['colonnes'] => [
  { cle: 'ouverture', libelle: ouverture, aSaisir: false },
  { cle: 'augmentations', libelle: plus, aSaisir: false },
  { cle: 'diminutions', libelle: moins, aSaisir: false },
  { cle: 'cloture', libelle: cloture, aSaisir: false },
];

function comptesDe(ctx: Contexte, codeRubrique: string, colonne: 'brut' | 'amortissements_depreciations' | 'toutes' = 'toutes', filtre: (compteNum: string) => boolean = () => true): CompteSuivi[] {
  const r = ctx.rubriques.get(codeRubrique);
  if (r === undefined) return [];
  const definition = ctx.definitions.get(codeRubrique);
  const resultat: CompteSuivi[] = [];
  for (const c of r.comptes) {
    const suivi = ctx.comptes.get(c.compteNum);
    if (suivi === undefined || !filtre(c.compteNum)) continue; // ligne technique « 6-7 » : pas un compte
    if (colonne !== 'toutes' && (colonneDuCompte(definition, c.compteNum) ?? 'brut') !== colonne) continue;
    resultat.push(suivi);
  }
  return resultat;
}

const parPrefixes = (ctx: Contexte, prefixes: readonly string[]): CompteSuivi[] => [...ctx.comptes.values()].filter((c) => prefixes.some((p) => c.compteNum.startsWith(p)));

/** Ligne « ouverture / augmentations / diminutions / clôture » ; `sens` = 1 pour un poste débiteur par nature, -1 pour un poste créditeur. */
function ligneMouvements(ctx: Contexte, libelle: string, rubriquePcg: string | null, comptes: readonly CompteSuivi[], sens: 1 | -1, estTotal = false): LigneTableauAnnexe {
  const somme = (f: (c: CompteSuivi) => Decimal): Decimal => comptes.reduce((s, c) => s.plus(f(c)), ZERO);
  const connu = ctx.aNouveauxIdentifies;
  return {
    libelle,
    rubriquePcg,
    valeurs: {
      ouverture: connu ? versChaine(somme((c) => c.ouverture).times(sens)) : null,
      augmentations: connu ? versChaine(somme((c) => (sens === 1 ? c.debit : c.credit))) : null,
      diminutions: connu ? versChaine(somme((c) => (sens === 1 ? c.credit : c.debit))) : null,
      cloture: versChaine(somme((c) => c.cloture).times(sens)),
    },
    comptes: comptes.map((c) => ({ compteNum: c.compteNum, compteLib: c.compteLib, solde: versChaine(c.cloture) })),
    estTotal,
  };
}

/** Ligne à montant unique (solde de clôture dans le sens indiqué) et colonnes à saisir valant `null`. */
function ligneMontant(libelle: string, rubriquePcg: string | null, comptes: readonly CompteSuivi[], sens: 1 | -1, colonnesASaisir: readonly string[] = [], cle = 'montant', estTotal = false): LigneTableauAnnexe {
  const valeurs: Record<string, ChaineDecimale | null> = { [cle]: versChaine(comptes.reduce((s, c) => s.plus(c.cloture), ZERO).times(sens)) };
  for (const c of colonnesASaisir) valeurs[c] = null;
  return { libelle, rubriquePcg, valeurs, comptes: comptes.map((c) => ({ compteNum: c.compteNum, compteLib: c.compteLib, solde: versChaine(c.cloture) })), estTotal };
}

const libelleRubrique = (ctx: Contexte, code: string): string => ctx.definitions.get(code)?.libelle ?? code;
const feuillesSous = (ctx: Contexte, racine: string): string[] => {
  const tries = [...ctx.definitions.values()].sort((a, b) => a.ordre - b.ordre);
  const retenus = new Set<string>([racine]);
  for (const r of tries) if (r.parent !== null && retenus.has(r.parent)) retenus.add(r.code);
  const parents = new Set(tries.map((r) => r.parent));
  return tries.filter((r) => retenus.has(r.code) && !parents.has(r.code)).map((r) => r.code);
};
const reservesMouvements = (ctx: Contexte): string[] => (ctx.aNouveauxIdentifies ? [RESERVE_MOUVEMENTS] : [RESERVE_SANS_A_NOUVEAUX]);
const absent = (motif: string): Construction => ({ tableaux: [], presence: 'absente', motif });

function tableauParRubriques(ctx: Contexte, titre: string, codes: readonly string[], colonne: 'brut' | 'amortissements_depreciations' | 'toutes', sens: 1 | -1, colonnes: TableauAnnexe['colonnes'], filtre?: (compteNum: string) => boolean): TableauAnnexe | null {
  const lignes: LigneTableauAnnexe[] = [];
  const tous: CompteSuivi[] = [];
  for (const code of codes) {
    const comptes = comptesDe(ctx, code, colonne, filtre);
    if (comptes.length === 0) continue;
    tous.push(...comptes);
    lignes.push(ligneMouvements(ctx, libelleRubrique(ctx, code), code, comptes, sens));
  }
  if (lignes.length === 0) return null;
  lignes.push(ligneMouvements(ctx, 'Total', null, tous, sens, true));
  return { titre, colonnes, lignes, reserves: reservesMouvements(ctx) };
}

const codesImmobilisations = (ctx: Contexte): string[] => ['A_FRAIS_ETABLISSEMENT', ...feuillesSous(ctx, 'A_ACTIF_IMMOBILISE')];
const estAmortissement = (c: string): boolean => c.startsWith('28');
const estDepreciation = (c: string): boolean => c.startsWith('29') || c.startsWith('39') || c.startsWith('49') || c.startsWith('59');

function construireImmobilisations(ctx: Contexte): Construction {
  const codes = codesImmobilisations(ctx);
  const tableaux = [
    tableauParRubriques(ctx, 'Tableau des immobilisations - Cadre général', codes, 'brut', 1, COLONNES_MOUVEMENTS('Montant brut à l’ouverture de l’exercice', 'Augmentations', 'Diminutions', 'Montant brut à la clôture de l’exercice')),
    tableauParRubriques(ctx, 'Tableau des amortissements - Cadre général', codes, 'amortissements_depreciations', -1, COLONNES_MOUVEMENTS('Amortissements cumulés à l’ouverture de l’exercice', 'Augmentations : dotations de l’exercice', 'Diminutions', 'Amortissements cumulés à la clôture de l’exercice'), estAmortissement),
    tableauParRubriques(ctx, 'Tableau des dépréciations', [...codes, ...feuillesSous(ctx, 'A_STOCKS'), ...feuillesSous(ctx, 'A_CREANCES'), ...feuillesSous(ctx, 'A_VMP')], 'amortissements_depreciations', -1,
      COLONNES_MOUVEMENTS('Dépréciations à l’ouverture de l’exercice', 'Augmentations : dotations de l’exercice', 'Diminutions : reprises de l’exercice', 'Dépréciations à la clôture de l’exercice'), estDepreciation),
  ].filter((t): t is TableauAnnexe => t !== null);
  return tableaux.length === 0 ? absent('Aucun compte d’immobilisation, d’amortissement ou de dépréciation dans la balance.') : { tableaux, presence: 'presente', motif: 'Soldes et mouvements des comptes des classes 2, 3, 4 et 5 concernés.' };
}

function construireMontants(ctx: Contexte, titre: string, lignes: Array<{ libelle?: string; rubrique: string; colonne?: 'brut' | 'amortissements_depreciations' | 'toutes'; sens: 1 | -1 }>, colonnesASaisir: Array<{ cle: string; libelle: string }>, motifAbsence: string, libelleMontant = 'Montant'): Construction {
  const lignesTableau: LigneTableauAnnexe[] = [];
  const tous: Array<{ comptes: CompteSuivi[]; sens: 1 | -1 }> = [];
  for (const l of lignes) {
    const comptes = comptesDe(ctx, l.rubrique, l.colonne ?? 'toutes');
    if (comptes.every((c) => c.cloture.isZero())) continue;
    tous.push({ comptes, sens: l.sens });
    lignesTableau.push(ligneMontant(l.libelle ?? libelleRubrique(ctx, l.rubrique), l.rubrique, comptes, l.sens, colonnesASaisir.map((c) => c.cle)));
  }
  if (lignesTableau.length === 0) return absent(motifAbsence);
  const total = tous.reduce((s, t) => s.plus(t.comptes.reduce((x, c) => x.plus(c.cloture), ZERO).times(t.sens)), ZERO);
  const valeursTotal: Record<string, ChaineDecimale | null> = { montant: versChaine(total) };
  for (const c of colonnesASaisir) valeursTotal[c.cle] = null;
  lignesTableau.push({ libelle: 'Total', rubriquePcg: null, valeurs: valeursTotal, comptes: [], estTotal: true });
  return {
    tableaux: [{ titre, colonnes: [{ cle: 'montant', libelle: libelleMontant, aSaisir: false }, ...colonnesASaisir.map((c) => ({ ...c, aSaisir: true }))], lignes: lignesTableau, reserves: colonnesASaisir.length > 0 ? ['Les colonnes à saisir ne se déduisent pas des écritures.'] : [] }],
    presence: 'presente',
    motif: 'Soldes de clôture des comptes concernés.',
  };
}

function construireParPrefixes(ctx: Contexte, titre: string, groupes: Array<{ libelle: string; prefixes: string[]; sens: 1 | -1 }>, motifAbsence: string, reserves: string[] = []): Construction {
  const lignes: LigneTableauAnnexe[] = [];
  for (const g of groupes) {
    // Seuls les comptes dont le solde est dans le sens attendu sont repris.
    const comptes = parPrefixes(ctx, g.prefixes).filter((c) => (g.sens === 1 ? c.cloture.isPositive() : c.cloture.isNegative()) && !c.cloture.isZero());
    if (comptes.length > 0) lignes.push(ligneMontant(g.libelle, null, comptes, g.sens));
  }
  if (lignes.length === 0) return absent(motifAbsence);
  return { tableaux: [{ titre, colonnes: [{ cle: 'montant', libelle: 'Montant à la clôture', aSaisir: false }], lignes, reserves }], presence: 'presente', motif: 'Soldes de clôture des comptes concernés.' };
}

const presenceSiSolde = (ctx: Contexte, prefixes: readonly string[], motifPresent: string, motifAbsent: string): Construction =>
  parPrefixes(ctx, prefixes).some((c) => !c.cloture.isZero() || !c.debit.isZero() || !c.credit.isZero())
    ? { tableaux: [{ titre: 'Comptes concernés', colonnes: [{ cle: 'montant', libelle: 'Solde de clôture (débit − crédit)', aSaisir: false }], lignes: [ligneMontant('Comptes concernés', null, parPrefixes(ctx, prefixes), 1)], reserves: [] }], presence: 'presente', motif: motifPresent }
    : absent(motifAbsent);

const S1 = 'Principes et méthodes comptables';
const S2A = 'Informations relatives à l’actif';
const S2P = 'Informations relatives au passif';
const S2R = 'Informations relatives au compte de résultat';
const S3 = 'Informations relatives à la fiscalité';
const S4 = 'Transactions non conclues aux conditions normales de marché';
const S5 = 'Opérations et engagements envers les organes d’administration, de direction ou de surveillance';
const S6 = 'Opérations et engagements hors bilan';
const S7 = 'Informations relatives à l’effectif';
const S8 = 'Autres informations';

const AUTRES_INFORMATIONS: Array<[string, string]> = [
  ['838-1', 'Bons de souscription de titres en capital et bons de souscription d’obligations'],
  ['838-2', 'Plans d’options d’achat ou de souscription d’actions et plans assimilés (caractéristiques du plan)'],
  ['838-3', 'Certificats de valeur garantie, bons de cession de valeur garantie et instruments assimilés'],
  ['838-4', 'Contrats à long terme (modalités d’application des principes comptables)'],
  ['838-5', 'Opérations d’échange dont un lot concerne une prestation publicitaire'],
  ['838-6', 'Quotas d’émission (modèle économique retenu)'],
  ['838-7', 'Certificats d’économies d’énergie'],
  ['838-8', 'Remises ou réductions obtenues ou accordées et engagements financiers futurs donnés ou reçus (débiteur et créancier)'],
  ['838-9', 'Transfert du service de la dette'],
  ['838-10', 'Cession de titres avec engagement reçu du cessionnaire (nature des titres, prix convenu)'],
  ['838-11', 'Contrats de garantie financière avec droit de réutilisation'],
  ['838-12', 'Contrats de fiducie'],
  ['838-13', 'Instruments financiers dérivés'],
  ['838-14', 'Fusions et opérations assimilées (impact sur les principaux postes)'],
  ['838-15', 'Émission de jetons'],
  ['838-16', 'Prestataires de services sur actifs numériques'],
  ['838-17', 'Formation professionnelle (information facultative)'],
  ['838-18', 'Fonds non remboursables et avances conditionnées'],
  ['838-19', 'Rémunération d’un service au moyen d’un instrument de capitaux propres à émettre'],
];

const COLONNES_ECHEANCES_CREANCES = [{ cle: 'aUnAnAuPlus', libelle: 'Échéance à un an au plus' }, { cle: 'aPlusDunAn', libelle: 'Échéance à plus d’un an' }];
const COLONNES_ECHEANCES_DETTES = [{ cle: 'aUnAnAuPlus', libelle: 'Échéance à un an au plus' }, { cle: 'dePlusDunAnACinqAns', libelle: 'Échéance à plus d’un an et cinq ans au plus' }, { cle: 'aPlusDeCinqAns', libelle: 'Échéance à plus de cinq ans' }];

const MODELE: DefinitionRubrique[] = [
  { article: '831-1', section: S1, titre: 'Règles et méthodes comptables', objet: 'Règlement comptable utilisé, dérogations et leur influence, principales méthodes retenues lorsqu’il existe un choix, événements postérieurs à la clôture sans lien direct prépondérant avec une situation existant à la clôture, toute information significative nécessaire à la compréhension des comptes.',
    aSaisir: ['Mention du règlement appliqué (proposition à confirmer : règlement ANC n° 2014-03 relatif au plan comptable général).', 'Dérogations aux règles générales ou à la durée de l’exercice, avec leur justification et leur influence.', 'Principales méthodes comptables retenues (amortissements, stocks, provisions, reconnaissance du chiffre d’affaires…).', 'Événements postérieurs à la clôture.', 'Autres informations significatives.'] },
  { article: '831-2', section: S1, titre: 'Changements de réglementation, de méthode, d’estimation et corrections d’erreurs', objet: 'Impact à l’ouverture d’un changement de réglementation ; mention, justification et impact d’un changement de méthode ; mention et justification d’un changement d’estimation ; nature et impact d’une correction d’erreur.',
    aSaisir: ['Indiquer les changements et corrections de l’exercice, ou confirmer qu’il n’y en a pas.'] },
  { article: '831-3', section: S1, titre: 'Changements de réglementation ou de méthode : informations complémentaires', objet: 'Principaux postes des exercices antérieurs retraités (application rétrospective) ou impact sur les postes concernés (application prospective).',
    aSaisir: ['Compléter en cas de changement de réglementation ou de méthode, ou confirmer l’absence de changement.'] },
  { article: '831-4', section: S1, titre: 'Entité établissant les états financiers consolidés', objet: 'Nom, siège et numéro d’identification de l’entité qui consolide l’ensemble le plus grand et le plus petit dont l’entité est filiale ; lieu où les états consolidés peuvent être obtenus.',
    aSaisir: ['Identité de l’entité consolidante, ou confirmation que l’entité n’est filiale d’aucun ensemble consolidé.'] },

  { article: '832-1', section: S2A, titre: 'Mouvements des immobilisations, des amortissements et des dépréciations', objet: 'Détail des mouvements des postes d’immobilisations, d’amortissements et de dépréciations ; durées d’utilisation ou taux et modes d’amortissement.',
    aSaisir: ['Durées d’utilisation ou taux d’amortissement, modes d’amortissement.', 'Qualification des mouvements (acquisitions, cessions, virements).'], construire: construireImmobilisations },
  { article: '832-2', section: S2A, titre: 'État de l’actif immobilisé : entrées, sorties, réévaluations, amortissements et dépréciations', objet: 'Par catégorie d’immobilisations : entrées, sorties ou mises au rebut, réévaluations ; postes du compte de résultat recevant les dotations ; amortissements et dépréciations exceptionnels liés à la législation fiscale ; pour les dépréciations significatives, valeur actuelle retenue et circonstances.',
    aSaisir: ['Ventilation des augmentations (acquisitions, apports, créations, virements) et des diminutions (cessions, scissions, mises hors service, virements).', 'Ventilation des dotations (linéaire, autre mode, exceptionnelles).', 'Informations sur les dépréciations significatives.'],
    construire: (ctx) => {
      const c = construireImmobilisations(ctx);
      return c.presence === 'presente' ? { tableaux: [], presence: 'presente', motif: 'Immobilisations présentes : les totaux figurent dans la rubrique ANX-832-1 ; la ventilation par nature de mouvement ne se déduit pas des écritures.' } : c;
    } },
  { article: '832-3', section: S2A, titre: 'Réévaluation des immobilisations', objet: 'Variation de l’écart de réévaluation, montant incorporé au capital, informations en coûts historiques, part des produits de cession transférée en réserves distribuables.',
    aSaisir: ['Détail de la réévaluation et de ses conséquences.'], construire: (ctx) => presenceSiSolde(ctx, ['105'], 'Un écart de réévaluation (compte 105) figure dans les écritures.', 'Aucun écart de réévaluation (compte 105) dans la balance.') },
  { article: '832-4', section: S2A, titre: 'Frais de développement, fonds commercial, coûts d’emprunt incorporés', objet: 'Durée d’amortissement des frais de développement activés ou montant passé en charges ; montant, modalités d’amortissement et de dépréciation, durée d’utilisation et test de dépréciation du fonds commercial ; coûts d’emprunt incorporés au coût des immobilisations.',
    aSaisir: ['Frais de développement comptabilisés en charges au cours de l’exercice.', 'Modalités d’amortissement, de dépréciation et d’affectation du fonds commercial.', 'Coûts d’emprunt incorporés et taux de capitalisation, ou confirmation qu’aucun coût d’emprunt n’est incorporé.'],
    construire: (ctx) => construireMontants(ctx, 'Frais de développement et fonds commercial inscrits à l’actif (montants bruts)', [{ rubrique: 'A_FRAIS_DEVELOPPEMENT', colonne: 'brut', sens: 1 }, { rubrique: 'A_FONDS_COMMERCIAL', colonne: 'brut', sens: 1 }], [], 'Aucun frais de développement (203) ni fonds commercial (207) à l’actif ; les frais de développement passés en charges et les coûts d’emprunt incorporés ne se voient pas dans la balance.', 'Montant brut à la clôture') },
  { article: '832-5', section: S2A, titre: 'Tableau des filiales et participations', objet: 'Tableau des filiales et participations requis par l’article L. 233-15 du code de commerce.',
    aSaisir: ['Pour chaque filiale et participation : capitaux propres, quote-part détenue, valeur comptable brute et nette des titres, prêts et avances, engagements donnés, chiffre d’affaires, résultat, dividendes encaissés.'],
    construire: (ctx) => construireMontants(ctx, 'Titres de participation et créances rattachées (montants bruts)', [{ rubrique: 'A_PARTICIPATIONS', colonne: 'brut', sens: 1 }, { rubrique: 'A_CREANCES_PARTICIPATIONS', colonne: 'brut', sens: 1 }], [], 'Aucun titre de participation (261, 262, 266) ni créance rattachée (267, 268) dans la balance.', 'Montant brut à la clôture') },
  { article: '832-6', section: S2A, titre: 'Titres immobilisés de l’activité de portefeuille', objet: 'Valeur estimative du portefeuille de TIAP et variation de sa valeur au cours de l’exercice.',
    aSaisir: ['Valeur estimative du portefeuille et sa variation.'], construire: (ctx) => construireMontants(ctx, 'Titres immobilisés de l’activité de portefeuille (montant brut)', [{ rubrique: 'A_TIAP', colonne: 'brut', sens: 1 }], [], 'Aucun titre immobilisé de l’activité de portefeuille (273) dans la balance.', 'Montant brut à la clôture') },
  { article: '832-7', section: S2A, titre: 'Stocks et en-cours', objet: 'Valeur comptable globale et par catégorie ; méthodes de calcul des dépréciations et montants par catégorie ; coûts d’emprunt incorporés.',
    aSaisir: ['Méthodes d’évaluation et de dépréciation des stocks.', 'Coûts d’emprunt incorporés dans le coût des stocks, ou confirmation de leur absence.'],
    construire: (ctx) => {
      const colonnes = (n: string, n1: string): TableauAnnexe['colonnes'] => [{ cle: 'cloture', libelle: n, aSaisir: false }, { cle: 'ouverture', libelle: n1, aSaisir: false }];
      const restreindre = (t: TableauAnnexe | null): TableauAnnexe | null => (t === null ? null : { ...t, lignes: t.lignes.map((l) => ({ ...l, valeurs: { cloture: l.valeurs['cloture'] ?? null, ouverture: l.valeurs['ouverture'] ?? null } })), reserves: ctx.aNouveauxIdentifies ? [] : [RESERVE_SANS_A_NOUVEAUX] });
      const codes = feuillesSous(ctx, 'A_STOCKS');
      const tableaux = [
        restreindre(tableauParRubriques(ctx, 'Stocks et en-cours (valeurs brutes)', codes, 'brut', 1, colonnes('Exercice N', 'Exercice N-1 (à-nouveaux)'))),
        restreindre(tableauParRubriques(ctx, 'Dépréciations des stocks et en-cours', codes, 'amortissements_depreciations', -1, colonnes('Exercice N', 'Exercice N-1 (à-nouveaux)'))),
      ].filter((t): t is TableauAnnexe => t !== null);
      return tableaux.length === 0 ? absent('Aucun compte de stocks ou d’en-cours (classe 3) dans la balance.') : { tableaux, presence: 'presente', motif: 'Soldes des comptes de la classe 3.' };
    } },
  { article: '832-8', section: S2A, titre: 'Dépréciations de l’actif circulant', objet: 'Détail et justification des dépréciations de l’actif circulant.',
    aSaisir: ['Justification de chaque dépréciation (créances douteuses, stocks, titres de placement).'],
    construire: (ctx) => {
      const t = tableauParRubriques(ctx, 'Dépréciations de l’actif circulant', [...feuillesSous(ctx, 'A_STOCKS'), ...feuillesSous(ctx, 'A_CREANCES'), ...feuillesSous(ctx, 'A_VMP')], 'amortissements_depreciations', -1,
        COLONNES_MOUVEMENTS('Dépréciations à l’ouverture', 'Dotations de l’exercice', 'Reprises de l’exercice', 'Dépréciations à la clôture'), estDepreciation);
      return t === null ? absent('Aucun compte de dépréciation de l’actif circulant (39, 49, 59) dans la balance.') : { tableaux: [t], presence: 'presente', motif: 'Soldes et mouvements des comptes 39, 49 et 59.' };
    } },
  { article: '832-9', section: S2A, titre: 'État des échéances des créances', objet: 'Créances classées selon la durée restant à courir : à un an au plus, à plus d’un an.',
    aSaisir: ['Ventilation de chaque poste entre les échéances à un an au plus et à plus d’un an.'],
    construire: (ctx) => construireMontants(ctx, 'État des échéances des créances à la clôture de l’exercice',
      [{ rubrique: 'A_CREANCES_PARTICIPATIONS', colonne: 'brut', sens: 1 }, { rubrique: 'A_PRETS', colonne: 'brut', sens: 1 }, { rubrique: 'A_AUTRES_IMMOBILISATIONS_FINANCIERES', colonne: 'brut', sens: 1 },
        { rubrique: 'A_AVANCES_VERSEES', colonne: 'brut', sens: 1 }, { rubrique: 'A_CLIENTS', colonne: 'brut', sens: 1 }, { rubrique: 'A_AUTRES_CREANCES', colonne: 'brut', sens: 1 }, { rubrique: 'A_CAPITAL_APPELE_NON_VERSE', colonne: 'brut', sens: 1 }, { rubrique: 'A_CHARGES_CONSTATEES_AVANCE', colonne: 'brut', sens: 1 }],
      COLONNES_ECHEANCES_CREANCES, 'Aucune créance dans la balance.', 'Montant brut') },
  { article: '832-10', section: S2A, titre: 'Charges constatées d’avance, frais d’émission et primes de remboursement des emprunts, écarts de conversion actif', objet: 'Nature et rythme de reprise en résultat des charges constatées d’avance, des frais d’émission et des primes de remboursement des emprunts ; nature et montant des écarts de conversion et différences d’évaluation - actif.',
    aSaisir: ['Nature de chaque élément et rythme de reprise en résultat.'],
    construire: (ctx) => construireMontants(ctx, 'Comptes de régularisation et assimilés - actif', [{ rubrique: 'A_CHARGES_CONSTATEES_AVANCE', sens: 1 }, { rubrique: 'A_FRAIS_EMISSION_EMPRUNTS', sens: 1 }, { rubrique: 'A_PRIMES_REMBOURSEMENT', sens: 1 }, { rubrique: 'A_ECARTS_CONVERSION', sens: 1 }], [], 'Aucun solde aux comptes 486, 481, 169, 474 ou 476.') },

  { article: '832-11', section: S2P, titre: 'Capital et variation des capitaux propres', objet: 'Nombre et valeur nominale des actions ou parts sociales émises pendant l’exercice et composant le capital ; tableau des divergences entre la variation des capitaux propres et le résultat de l’exercice.',
    aSaisir: ['Nombre et valeur nominale des titres composant le capital et émis pendant l’exercice, par catégorie.', 'Explication des variations des capitaux propres autres que le résultat (affectation, distributions, augmentations de capital…).'],
    construire: (ctx) => {
      const t = tableauParRubriques(ctx, 'Capitaux propres : ouverture, mouvements et clôture (hors résultat de l’exercice en cours non encore viré)', feuillesSous(ctx, 'P_CAPITAUX_PROPRES'), 'toutes', -1,
        COLONNES_MOUVEMENTS('Montant à l’ouverture', 'Augmentations (mouvements crédit)', 'Diminutions (mouvements débit)', 'Montant à la clôture'));
      if (t === null) return absent('Aucun compte de capitaux propres dans la balance.');
      return { tableaux: [{ ...t, reserves: [...t.reserves, 'Le résultat de l’exercice tiré des comptes de charges et de produits non soldés n’est pas inclus dans ce tableau : voir le projet de bilan.'] }], presence: 'presente', motif: 'Soldes et mouvements des comptes 10 à 14.' };
    } },
  { article: '832-12', section: S2P, titre: 'Actions propres', objet: 'Nombre et valeur des actions propres détenues à la clôture et mouvements de l’exercice (comptes 502, 2771 et 2772) ; dépréciation théorique des titres destinés à être annulés ; réserves affectées en contrepartie.',
    aSaisir: ['Nombre d’actions propres, mouvements de l’exercice, réserves affectées.'], construire: (ctx) => presenceSiSolde(ctx, ['502', '2771', '2772'], 'Des comptes d’actions propres (502, 2771, 2772) sont mouvementés.', 'Aucun compte d’actions propres (502, 2771, 2772) dans la balance.') },
  { article: '832-13', section: S2P, titre: 'Provisions et passifs éventuels', objet: 'Par catégorie de provisions : valeur à l’ouverture et à la clôture, dotations, montants utilisés, montants non utilisés repris ; description des passifs éventuels.',
    aSaisir: ['Ventilation des reprises entre montants utilisés et montants non utilisés.', 'Passifs éventuels : nature, estimation des effets financiers, incertitudes — ou confirmation de leur absence.'],
    construire: (ctx) => {
      const t = tableauParRubriques(ctx, 'Tableau des provisions', ['P_PROVISIONS_RISQUES', 'P_PROVISIONS_CHARGES'], 'toutes', -1, [
        ...COLONNES_MOUVEMENTS('Montant à l’ouverture de l’exercice', 'Augmentations : dotations de l’exercice', 'Diminutions : reprises de l’exercice (total)', 'Montant à la clôture de l’exercice'),
        { cle: 'reprisesUtilisees', libelle: 'Dont reprises utilisées', aSaisir: true }, { cle: 'reprisesNonUtilisees', libelle: 'Dont reprises non utilisées', aSaisir: true }]);
      if (t === null) return { tableaux: [], presence: 'inconnue', motif: 'Aucune provision (151, 152) dans la balance ; l’existence de passifs éventuels ne se voit pas dans les écritures.' };
      return { tableaux: [{ ...t, lignes: t.lignes.map((l) => ({ ...l, valeurs: { ...l.valeurs, reprisesUtilisees: null, reprisesNonUtilisees: null } })) }], presence: 'presente', motif: 'Soldes et mouvements des comptes 151 et 152.' };
    } },
  { article: '832-14', section: S2P, titre: 'Provisions significatives et passifs non comptabilisés', objet: 'Pour les provisions individuellement significatives : nature de l’obligation, échéance attendue, incertitudes, remboursements attendus ; passifs non comptabilisés faute d’évaluation fiable.',
    aSaisir: ['Description de chaque provision significative, ou confirmation qu’aucune ne l’est.'], construire: (ctx) => presenceSiSolde(ctx, ['15'], 'Des provisions (compte 15) figurent dans les écritures.', 'Aucune provision (compte 15) dans la balance ; les passifs non comptabilisés ne se voient pas dans les écritures.') },
  { article: '832-15', section: S2P, titre: 'État des échéances des dettes', objet: 'Dettes classées selon la durée restant à courir : à un an au plus, à plus d’un an et cinq ans au plus, à plus de cinq ans.',
    aSaisir: ['Ventilation de chaque poste par échéance.'],
    construire: (ctx) => construireMontants(ctx, 'État des échéances des dettes à la clôture de l’exercice', feuillesSous(ctx, 'P_DETTES').map((rubrique) => ({ rubrique, sens: -1 as const })), COLONNES_ECHEANCES_DETTES, 'Aucune dette dans la balance.', 'Montant brut') },
  { article: '832-16', section: S2P, titre: 'Dettes garanties par des sûretés réelles', objet: 'Indication des dettes garanties par des sûretés réelles : montant à la clôture et montant garanti.',
    aSaisir: ['Liste des dettes garanties et montants garantis, ou confirmation de l’absence de sûreté réelle.'] },
  { article: '832-17', section: S2P, titre: 'Produits constatés d’avance et écarts de conversion passif', objet: 'Nature et rythme de reprise des produits constatés d’avance ; nature et montant des écarts de conversion et différences d’évaluation - passif.',
    aSaisir: ['Nature de chaque élément et rythme de reprise.'],
    construire: (ctx) => construireMontants(ctx, 'Comptes de régularisation et assimilés - passif', [{ rubrique: 'P_PRODUITS_CONSTATES_AVANCE', sens: -1 }, { rubrique: 'P_ECARTS_CONVERSION', sens: -1 }], [], 'Aucun solde aux comptes 487, 475 ou 477.') },

  { article: '832-18', section: S2R, titre: 'Ventilation du chiffre d’affaires', objet: 'Chiffre d’affaires ventilé par catégorie d’activités et par marchés géographiques, dans la mesure où ils diffèrent de façon très importante.',
    aSaisir: ['Ventilation par catégorie d’activités et par marché géographique, ou mention de son caractère incomplet.'],
    construire: (ctx) => construireMontants(ctx, 'Montant net du chiffre d’affaires par poste du compte de résultat', [{ rubrique: 'PE_VENTES_MARCHANDISES', sens: -1 }, { rubrique: 'PE_PRODUCTION_VENDUE', sens: -1 }], [], 'Aucun compte de chiffre d’affaires (70) dans la balance.') },
  { article: '832-19', section: S2R, titre: 'Produits à recevoir, charges à payer, produits et charges imputables à un autre exercice, quotes-parts de résultat', objet: 'Nature et montant des produits à recevoir et des charges à payer, des produits et charges imputables à un autre exercice, des quotes-parts de résultat sur opérations faites en commun.',
    aSaisir: ['Nature des produits à recevoir et des charges à payer.', 'Produits et charges imputables à un autre exercice.'],
    construire: (ctx) => construireParPrefixes(ctx, 'Charges à payer, produits à recevoir et comptes de régularisation (soldes de clôture)', [
      { libelle: 'Charges à payer : fournisseurs - factures non parvenues (408)', prefixes: ['408'], sens: -1 },
      { libelle: 'Charges à payer : rabais, remises, ristournes à accorder et avoirs à établir (4198)', prefixes: ['4198'], sens: -1 },
      { libelle: 'Charges à payer : personnel (428)', prefixes: ['428'], sens: -1 },
      { libelle: 'Charges à payer : organismes sociaux (438)', prefixes: ['438'], sens: -1 },
      { libelle: 'Charges à payer : État (4481)', prefixes: ['4481'], sens: -1 },
      { libelle: 'Divers comptes créditeurs et charges à payer (468) — à ventiler', prefixes: ['468'], sens: -1 },
      { libelle: 'Intérêts courus sur emprunts et dettes (1688, 5181)', prefixes: ['1688', '5181'], sens: -1 },
      { libelle: 'Produits à recevoir : clients - produits non encore facturés (418)', prefixes: ['418'], sens: 1 },
      { libelle: 'Produits à recevoir : rabais, remises, ristournes à obtenir et avoirs non encore reçus (4098)', prefixes: ['4098'], sens: 1 },
      { libelle: 'Produits à recevoir : organismes sociaux (439)', prefixes: ['439'], sens: 1 },
      { libelle: 'Produits à recevoir : État (4482)', prefixes: ['4482'], sens: 1 },
      { libelle: 'Divers comptes débiteurs et produits à recevoir (467) — à ventiler', prefixes: ['467'], sens: 1 },
      { libelle: 'Intérêts courus à recevoir (5188)', prefixes: ['5188'], sens: 1 },
      { libelle: 'Charges constatées d’avance (486)', prefixes: ['486'], sens: 1 },
      { libelle: 'Produits constatés d’avance (487)', prefixes: ['487'], sens: -1 },
      { libelle: 'Quote-part de résultat sur opérations faites en commun : produits (755)', prefixes: ['755'], sens: -1 },
      { libelle: 'Quote-part de résultat sur opérations faites en commun : charges (655)', prefixes: ['655'], sens: 1 },
    ], 'Aucun solde aux comptes de charges à payer, de produits à recevoir ou de régularisation repérés.', ['Seuls les comptes subdivisés selon le plan de comptes sont repris (un compte 448 non subdivisé, par exemple, ne l’est pas).', 'Les comptes 467 et 468 mêlent débiteurs ou créditeurs divers et produits à recevoir ou charges à payer : à ventiler.']) },
  { article: '832-20', section: S2R, titre: 'Honoraires des commissaires aux comptes', objet: 'Pour chaque commissaire aux comptes : honoraires de certification des comptes, de certification des informations de durabilité et des autres services (non fournis si la personne morale est incluse dans un périmètre de consolidation).',
    aSaisir: ['Honoraires par commissaire aux comptes et par nature, ou confirmation de l’absence de commissaire aux comptes.'] },
  { article: '832-21', section: S2R, titre: 'Résultat exceptionnel', objet: 'Nature des produits et charges inscrits en résultat exceptionnel : événement majeur et inhabituel (à décrire), écritures d’origine purement fiscale, changements de méthode comptabilisés en résultat pour raisons fiscales, corrections d’erreurs.',
    aSaisir: ['Nature de chaque produit et charge exceptionnel et description de l’événement majeur et inhabituel.'],
    construire: (ctx) => construireMontants(ctx, 'Produits et charges exceptionnels', [{ rubrique: 'PX', sens: -1 }, { rubrique: 'CX', sens: 1 }], [], 'Aucun produit ni charge exceptionnel (67, 687, 77, 787) dans la balance.') },

  { article: '833-1', section: S3, titre: 'Modification d’impôt votée après la clôture', objet: 'Incidence sur le résultat de toute modification d’impôt votée entre la date de clôture et la date d’établissement des comptes.', aSaisir: ['Incidence éventuelle, ou confirmation de son absence.'] },
  { article: '833-2', section: S3, titre: 'Crédits d’impôts', objet: 'Nature et montant des crédits d’impôts (crédit d’impôt recherche, autres).', aSaisir: ['Nature et montant de chaque crédit d’impôt, ou confirmation de leur absence.'] },
  { article: '833-3', section: S3, titre: 'Corrections exceptionnelles de valeurs liées à la législation fiscale', objet: 'Détail et justification des corrections exceptionnelles de valeurs des immobilisations et de l’actif circulant liées à la législation fiscale.', aSaisir: ['Détail des corrections, ou confirmation de leur absence.'] },
  { article: '833-4', section: S3, titre: 'Impôts sur les bénéfices : report en arrière, répartition, situation fiscale latente, intégration fiscale', objet: 'Créances de report en arrière des déficits ; répartition de l’impôt entre résultat courant et résultat exceptionnel ; allégements et accroissements de la dette future d’impôt ; évaluations dérogatoires ; informations des entités intégrées fiscalement.',
    aSaisir: ['Répartition de l’impôt, situation fiscale différée ou latente, informations d’intégration fiscale.'],
    construire: (ctx) => { const c = construireMontants(ctx, 'Impôts sur les bénéfices comptabilisés', [{ rubrique: 'IS', sens: 1 }], [], 'Aucun impôt sur les bénéfices (69) comptabilisé.'); return c.presence === 'absente' ? { ...c, presence: 'inconnue' } : c; } },

  { article: '834-1', section: S4, titre: 'Transactions significatives avec des parties liées', objet: 'Liste des transactions significatives avec des parties liées non conclues aux conditions normales de marché (hors filiales détenues en totalité et sociétés sœurs détenues en totalité).', aSaisir: ['Liste des transactions, ou confirmation de leur absence.'] },
  { article: '834-2', section: S4, titre: 'Sociétés anonymes petites ou au régime simplifié : transactions avec les principaux actionnaires et les dirigeants', objet: 'Liste des transactions significatives non conclues aux conditions normales de marché entre la société et ses principaux actionnaires ou les membres de ses organes d’administration, de direction ou de surveillance. Ne vise que les sociétés anonymes.',
    aSaisir: ['Si la société est une société anonyme : liste des transactions ou confirmation de leur absence ; sinon, confirmer que la rubrique est sans objet.'] },

  { article: '835-1', section: S5, titre: 'Avances, crédits et engagements de retraite au profit des dirigeants', objet: 'Montant global par catégorie des avances et crédits alloués aux membres des organes d’administration, de direction ou de surveillance, engagements pris pour leur compte, engagements de retraite contractés à leur profit.', aSaisir: ['Montants par catégorie, ou confirmation de leur absence.'] },
  { article: '835-2', section: S5, titre: 'Rémunérations allouées aux organes d’administration, de direction ou de surveillance', objet: 'Montant global par catégorie des rémunérations allouées au titre des fonctions (peut ne pas être fourni s’il permet d’identifier la situation d’un membre déterminé).', aSaisir: ['Montant global des rémunérations par catégorie, ou motif de l’omission.'] },

  { article: '836-1', section: S6, titre: 'Engagements financiers, garanties et éventualités hors bilan', objet: 'Cautionnements, avals et garanties donnés ; sûretés consenties ; engagements fermes sur titres de capital et portage ; engagements conditionnels ; engagements en matière de pensions ou indemnités assimilées.', aSaisir: ['État des engagements donnés et reçus, engagements de retraite, ou confirmation de leur absence.'] },
  { article: '836-2', section: S6, titre: 'Engagements consentis à l’égard d’entités liées', objet: 'Engagements consentis à l’égard d’entités susceptibles d’être incluses par intégration globale dans un même ensemble consolidable.', aSaisir: ['Engagements à l’égard d’entités liées, ou confirmation de leur absence.'] },
  { article: '836-3', section: S6, titre: 'Crédit-bail : redevances restant à payer et prix d’achat résiduel', objet: 'Redevances restant à payer et prix d’achat résiduel des biens pris en crédit-bail, en distinguant crédit-bail mobilier et immobilier.',
    aSaisir: ['Par contrat : redevances restant à payer et prix d’achat résiduel.'], construire: (ctx) => presenceSiSolde(ctx, ['612'], 'Des redevances de crédit-bail (compte 612) sont comptabilisées.', 'Aucune redevance de crédit-bail (compte 612) dans la balance.') },
  { article: '836-4', section: S6, titre: 'Crédit-bail : informations complémentaires', objet: 'Valeur des biens à la signature, redevances de l’exercice et cumulées, amortissements théoriques, redevances restant à payer par échéance et prix d’achat résiduel, ventilés par poste du bilan.',
    aSaisir: ['Par catégorie d’immobilisations : valeur d’origine, amortissements théoriques, redevances payées et restant à payer par échéance.'], construire: (ctx) => presenceSiSolde(ctx, ['612'], 'Des redevances de crédit-bail (compte 612) sont comptabilisées.', 'Aucune redevance de crédit-bail (compte 612) dans la balance.') },
  { article: '836-5', section: S6, titre: 'Autres opérations non inscrites au bilan', objet: 'Nature et objectifs, risques et avantages attendus, garanties données pour toute opération non inscrite au bilan présentant des risques et avantages significatifs.', aSaisir: ['Description des opérations, ou confirmation de leur absence.'] },

  { article: '837-1', section: S7, titre: 'Effectif employé pendant l’exercice', objet: 'Effectif employé pendant l’exercice, tel que défini à l’article D. 123-200 du code de commerce.', aSaisir: ['Effectif moyen employé pendant l’exercice.'] },
  { article: '837-2', section: S7, titre: 'Ventilation de l’effectif par catégorie', objet: 'Effectif moyen ventilé par catégorie (ouvriers ; employés, techniciens, agents de maîtrise ; cadres et ingénieurs).', aSaisir: ['Effectif moyen par catégorie.'] },

  ...AUTRES_INFORMATIONS.map(([article, titre]): DefinitionRubrique => ({
    article, section: S8, titre, objet: `${titre} : informations prévues par l’article ${article} du PCG, à fournir si l’entité est concernée.`,
    aSaisir: ['Compléter si l’entité est concernée, sinon confirmer que la rubrique est sans objet.'],
    parDefaut: 'non_applicable_a_confirmer',
    ...(article === '838-18' ? { construire: (ctx: Contexte): Construction => construireMontants(ctx, 'Fonds non remboursables et avances conditionnées', [{ rubrique: 'P_FONDS_NON_REMBOURSABLES', sens: -1 }, { rubrique: 'P_AVANCES_CONDITIONNEES', sens: -1 }], [], 'Aucun fonds non remboursable ni avance conditionnée (1671, 1673, 1674) dans la balance.') } : {}),
  })),
];

/** Articles du chapitre III couverts par le modèle (831-1 à 838-19), dans l'ordre du PCG. */
export const ARTICLES_ANNEXE: readonly string[] = Object.freeze(MODELE.map((d) => d.article));

const MENTIONS_MICRO: Array<[string, string, string]> = [
  ['1', 'Référence au règlement comptable appliqué', 'Référence au règlement comptable de l’Autorité des normes comptables appliqué pour l’élaboration des comptes annuels (proposition à confirmer : règlement ANC n° 2014-03).'],
  ['2', 'Engagements financiers, garanties et passifs éventuels hors bilan', 'Montant global de tout engagement financier, toute garantie ou passif éventuel qui ne figure pas au bilan, notamment les engagements de crédit-bail ; nature et forme de toute sûreté réelle.'],
  ['3', 'Engagements de retraite et avantages similaires', 'Engagements en matière de pension, de compléments de retraite, d’indemnités et d’allocations de départ à la retraite ou avantages similaires des membres du personnel ou des mandataires sociaux.'],
  ['4', 'Engagements à l’égard d’entités liées ou associées', 'Engagements à l’égard d’entités liées ou associées.'],
  ['5', 'Avances et crédits alloués aux dirigeants', 'Montant des avances et crédits alloués aux membres des organes d’administration, de direction ou de surveillance, conditions consenties, remboursements opérés pendant l’exercice, engagements pris pour leur compte.'],
  ['6', 'Actions propres', 'Pour les personnes morales : nombre et valeur des actions propres détenues à la fin de l’exercice et mouvements intervenus au cours de l’exercice.'],
];

// ───────────────────────────── Calcul ─────────────────────────────

/** Suivi par compte à la clôture : ouverture (journaux d'à-nouveaux), mouvements hors à-nouveaux, solde de clôture. Partagé avec les tableaux 2054, 2055 et 2033-C. */
export interface SuiviCompte { compteNum: string; compteLib: string; ouverture: Decimal; debit: Decimal; credit: Decimal; cloture: Decimal }
export function suivreComptes(lignes: readonly LigneEcriture[], fin: string, journaux: readonly string[]): { comptes: Map<string, SuiviCompte>; aNouveauxIdentifies: boolean } {
  const comptes = new Map<string, CompteSuivi>();
  const aNouveaux = new Set(journaux);
  let aNouveauxIdentifies = false;
  for (const l of lignes) {
    if (l.ecritureDate > fin) continue;
    let c = comptes.get(l.compteNum);
    if (c === undefined) { c = { compteNum: l.compteNum, compteLib: l.compteLib, ouverture: ZERO, debit: ZERO, credit: ZERO, cloture: ZERO }; comptes.set(l.compteNum, c); }
    const debit = debitDe(l);
    const credit = creditDe(l);
    c.cloture = c.cloture.plus(debit).minus(credit);
    if (aNouveaux.has(l.journalCode)) { aNouveauxIdentifies = true; c.ouverture = c.ouverture.plus(debit).minus(credit); } else { c.debit = c.debit.plus(debit); c.credit = c.credit.plus(credit); }
  }
  return { comptes, aNouveauxIdentifies };
}

function construireContexte(lignes: readonly LigneEcriture[], fin: string, journaux: readonly string[], correspondance: CorrespondanceRubriques): Contexte {
  const { comptes, aNouveauxIdentifies } = suivreComptes(lignes, fin, journaux);
  const balance = calculerBalance(lignes, { jusquau: fin });
  const rubriques = new Map<string, RubriqueProjetee>();
  for (const r of [...projeterBilan(balance, correspondance).rubriques, ...projeterCompteDeResultat(balance, correspondance).rubriques]) rubriques.set(r.code, r);
  return { comptes, aNouveauxIdentifies, rubriques, definitions: new Map(correspondance.rubriques.map((r) => [r.code, r])) };
}

/**
 * Prépare le projet d'annexe d'un exercice. S'abstient si le référentiel n'est pas le PCG ou si l'exercice est ouvert avant
 * le 1er janvier 2025 (articles et plan de comptes antérieurs non vérifiés). Résultat sérialisable en JSON.
 */
export function preparerAnnexe(demande: DemandeAnnexe): ResultatAnnexe {
  const motifs: AnnexeAbstention['motifs'] = [];
  if (demande.referentielComptable.trim().toUpperCase() !== 'PCG') motifs.push({ code: 'referentiel_hors_perimetre', message: `Référentiel comptable « ${demande.referentielComptable} » hors périmètre : seul le plan comptable général est couvert.` });
  const { debut, fin } = demande.exercice;
  let correspondance: CorrespondanceRubriques | null = null;
  if (!estDateIso(debut) || !estDateIso(fin) || fin < debut) motifs.push({ code: 'exercice_invalide', message: 'Exercice invalide : dates ISO AAAA-MM-JJ attendues, clôture postérieure ou égale à l’ouverture.' });
  else {
    correspondance = correspondancePour(debut);
    if (correspondance === null) motifs.push({ code: 'exercice_hors_periode', message: `Exercice ouvert le ${debut}, avant la période couverte par le modèle (${MODELE_ANNEXE.periodeApplication}) : aucune annexe n’est préparée.` });
  }
  if (motifs.length > 0 || correspondance === null) return { statut: 'abstention', motifs, mention: MENTION_PROJET };

  const ctx = construireContexte(demande.lignes, fin, demande.journauxANouveaux ?? ['AN', 'ANO', 'RAN'], correspondance);
  const confirmations = demande.confirmations ?? {};
  const confirmationDe = (id: string): RubriqueAnnexe['confirmation'] => (Object.hasOwn(confirmations, id) ? (confirmations[id] ?? null) : null);
  const dispense = demande.categorie === 'micro_entreprise' && demande.dispenseAnnexeMicro === true;
  const reserves = [
    'Les informations de l’annexe ne sont pas limitatives et celles sans importance significative ne sont pas à fournir (PCG art. 811-6) : l’appréciation du caractère significatif appartient au professionnel.',
    'La catégorie de taille est fournie par le cabinet ; les seuils du code de commerce n’ont pas été relus sur Légifrance (seuil à confirmer).',
    'Le modèle vise une personne morale ; les dispositions propres aux personnes physiques (PCG art. 811-10 et 811-11) ne sont pas couvertes.',
  ];
  if (demande.dispenseAnnexeMicro === true && demande.categorie !== 'micro_entreprise') reserves.push('La dispense d’annexe n’est prévue que pour la micro-entreprise (PCG art. 811-7) : elle est ignorée pour la catégorie fournie.');

  let rubriques: RubriqueAnnexe[];
  if (dispense) {
    reserves.push('Dispense d’annexe de la micro-entreprise (PCG art. 811-7) : les entités exclues de cette faculté par le code de commerce (art. L. 123-16-1, non relu) sont à vérifier.');
    rubriques = MENTIONS_MICRO.map(([n, titre, objet]): RubriqueAnnexe => {
      const id = `ANX-811-7-${n}`;
      const actions = n === '6' ? presenceSiSolde(ctx, ['502', '2771', '2772'], 'Des comptes d’actions propres sont mouvementés.', 'Aucun compte d’actions propres (502, 2771, 2772) dans la balance.') : null;
      const statut: StatutRubriqueAnnexe = actions === null ? 'a_completer' : actions.presence === 'presente' ? 'pre_rempli' : 'non_applicable_a_confirmer';
      return {
        id, reference: `PCG (règlement ANC n° 2014-03), art. 811-7, ${n}${n === '1' ? 're' : 'e'} mention`, article: '811-7', section: 'Mentions à la suite du bilan (micro-entreprise dispensée d’annexe)', titre, objet,
        requise: true, motifApplicabilite: 'PCG art. 811-7 : micro-entreprise n’établissant pas d’annexe.',
        statut, motifStatut: actions?.motif ?? 'Information que les écritures ne contiennent pas.', preRemplissage: actions?.tableaux ?? [], aSaisir: [objet], confirmation: confirmationDe(id),
      };
    });
  } else {
    const requis = articlesRequisPourCategorie(demande.categorie, ARTICLES_ANNEXE);
    const articlesRequis = new Set(requis.articles);
    rubriques = MODELE.map((d): RubriqueAnnexe => {
      const id = `ANX-${d.article}`;
      const requise = articlesRequis.has(d.article);
      const construction = d.construire?.(ctx) ?? null;
      let statut: StatutRubriqueAnnexe;
      let motifStatut: string;
      if (!requise) { statut = 'non_applicable_a_confirmer'; motifStatut = 'Information non requise pour la catégorie retenue ; elle peut être fournie volontairement.'; }
      else if (construction === null) { statut = d.parDefaut ?? 'a_completer'; motifStatut = statut === 'a_completer' ? 'Information que les écritures ne contiennent pas : à saisir par le cabinet.' : 'Rien dans les écritures ne permet de savoir si l’entité est concernée : sans objet sauf indication contraire, à confirmer.'; }
      else if (construction.presence === 'absente') { statut = 'non_applicable_a_confirmer'; motifStatut = construction.motif; }
      else if (construction.presence === 'presente' && construction.tableaux.length > 0) { statut = 'pre_rempli'; motifStatut = construction.motif; }
      else { statut = 'a_completer'; motifStatut = construction.motif; }
      return {
        id, reference: `PCG (règlement ANC n° 2014-03), art. ${d.article}`, article: d.article, section: d.section, titre: d.titre, objet: d.objet,
        requise, motifApplicabilite: requise ? requis.motif : `Article ${d.article} absent de la liste applicable — ${requis.motif}`,
        statut, motifStatut, preRemplissage: requise ? (construction?.tableaux ?? []) : [], aSaisir: d.aSaisir, confirmation: confirmationDe(id),
      };
    });
  }

  const connues = new Set(rubriques.map((r) => r.id));
  const inconnues = Object.keys(confirmations).filter((id) => !connues.has(id));
  const LIBELLES_STATUTS: Record<StatutRubriqueAnnexe, string> = { pre_rempli: 'pré-remplie, à compléter et à confirmer', a_completer: 'à compléter', non_applicable_a_confirmer: 'présumée sans objet, à confirmer' };
  const manques = [
    ...rubriques.filter((r) => r.requise && r.confirmation === null).map((r) => `${r.id} « ${r.titre} » (${r.reference}) : ${LIBELLES_STATUTS[r.statut]}.`),
    ...inconnues.map((id) => `Confirmation ignorée : ${id} ne désigne aucune rubrique de ce projet.`),
    ...(demande.categorie === 'a_confirmer' ? ['Catégorie de taille à confirmer : le contenu requis de l’annexe en dépend.'] : []),
  ];
  return {
    statut: 'projet',
    complet: manques.length === 0,
    manques,
    mention: MENTION_PROJET,
    exercice: { debut, fin },
    categorie: demande.categorie,
    forme: dispense ? 'mentions_a_la_suite_du_bilan' : 'annexe',
    seuilsAConfirmer: true,
    reserves,
    modele: { ...MODELE_ANNEXE },
    correspondanceComptes: { id: correspondance.id, version: correspondance.version },
    aNouveauxIdentifies: ctx.aNouveauxIdentifies,
    rubriques,
    sources: [SOURCES_FISCALES.annexeContenu, SOURCES_FISCALES.annexeAllegements, SOURCES_FISCALES.seuilsTailleServicePublic, SOURCES_FISCALES.seuilsTailleCodeDeCommerce, SOURCES_FISCALES.reglement2022_06],
  };
}
