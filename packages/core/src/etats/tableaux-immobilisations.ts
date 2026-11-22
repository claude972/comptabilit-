/**
 * Tableaux d'immobilisations et d'amortissements de la liasse — PROJET (D-104) :
 *  - régime réel normal : 2054-SD « Immobilisations » (cadres A et B) et 2055-SD « Amortissements » (cadre A) ;
 *  - régime simplifié : 2033-C-SD, cadres I « Immobilisations » et II « Amortissements ».
 *
 * Sources des chiffres : la BALANCE importée (mouvements des comptes de classes 20 à 28, calcul partagé avec la rubrique 832-1 de
 * l'annexe : `suivreComptes`) et le FICHIER DES IMMOBILISATIONS saisi ou repris (rapprochement et moteur d'amortissements
 * `proposerEcrituresInventaire`). Lignes, colonnes et codes de cases sont ceux du formulaire du millésime 2026, lus le 2026-11-20
 * dans les PDF officiels (extraction de texte, non vérifiée visuellement : l'état des codes est « lu, à confirmer »).
 *
 * Règles :
 *  - une cellule non déductible de la balance (réévaluation, ventilation des diminutions, « dont composants ») vaut `null` avec son
 *    motif — jamais un chiffre supposé ; une cellule qui dépend des à-nouveaux vaut `null` si aucun journal d'à-nouveaux n'est identifié ;
 *  - un total n'est établi que si TOUTES les cellules qui le composent le sont ;
 *  - un compte qu'aucune ligne ne reprend est présenté à part (« non ventilé ») et n'entre dans aucun total du formulaire ;
 *  - les écarts entre la balance et le fichier des immobilisations sont AFFICHÉS, jamais corrigés ; le dégressif reste NON ACTIVÉ
 *    sauf décision de l'éditeur (option) ;
 *  - hors périmètre (mêmes règles que la liasse) : abstention motivée, aucun chiffre.
 */
import { Decimal } from 'decimal.js';
import type { LigneEcriture, SourceRegle } from '../controles/types.js';
import { estDateIso } from '../dates.js';
import { type ChaineDecimale, dec, estChaineDecimale, versChaine } from '../montant.js';
import { type SuiviCompte, suivreComptes } from './annexe.js';
import { calculerBalance } from './balance.js';
import { MOTIF_SANS_PRECEDENT, RESERVE_N1_NON_VALIDE, verifierExercicePrecedent } from './comparatif.js';
import { correspondancePour } from './correspondance.js';
import { type ImmobilisationAAmortir, MOTIF_DEGRESSIF_NON_ACTIVE, type RapprochementImmobilisations, proposerEcrituresInventaire } from './inventaire.js';
import { type ImpotSurLeResultat, type LiasseAbstention, PERIMETRE_LIASSE, type RegimeLiasse, type TerritoireFiscal, motifsAbstention } from './liasse.js';
import { projeterBilan } from './projection.js';
import { MENTION_PROJET, SOURCES_FISCALES } from './sources-fiscales.js';
import type { ControleEtat, CorrespondanceRubriques } from './types.js';

const ZERO = new Decimal(0);

// ───────────────────────────── Types publics ─────────────────────────────

export type CodeTableauImmobilisations = '2054' | '2055' | '2033-C';
export type StatutCellule = 'etabli' | 'a_saisir' | 'abstention';

export interface CelluleImmobilisation {
  /** Code de case lu sur le formulaire du millésime 2026 ; `null` quand le formulaire n'en porte pas ou que la cellule n'est pas sur le formulaire. */
  codeCase: string | null;
  /** `lu_verifie` : code extrait du PDF officiel (2026) ET vérifié sur le rendu image de la page (2026-11-22, D-152) ; `a_confirmer` : aucun code connu. */
  etatCodeCase: 'lu_verifie' | 'a_confirmer';
  montant: ChaineDecimale | null;
  /** Même cellule pour l'exercice précédent contigu ; `null` si la colonne N-1 est indisponible ou si la cellule n'y est pas établie. */
  n1: ChaineDecimale | null;
  statut: StatutCellule;
  /** Motif quand `montant` est `null`. */
  motif: string | null;
}

export interface CompteLigneImmobilisation {
  compteNum: string;
  compteLib: string;
  /** Sens naturel de la ligne (valeurs brutes : débit − crédit ; amortissements : crédit − débit). `null` : à-nouveaux non identifiés. */
  ouverture: ChaineDecimale | null;
  augmentations: ChaineDecimale | null;
  diminutions: ChaineDecimale | null;
  cloture: ChaineDecimale;
}

/** Ce que le fichier des immobilisations saisi dit d'une ligne de valeurs brutes. `null` partout où l'information manque. */
export interface FichierLigneBrut {
  nbImmobilisations: number;
  /** Valeur brute selon le fichier : immobilisations en service avant l'ouverture et non sorties avant l'ouverture. */
  valeurBruteOuverture: ChaineDecimale | null;
  valeurBruteCloture: ChaineDecimale | null;
  /** Balance − fichier (même convention que le rapprochement de l'inventaire). `null` : non comparable (motif dans `motifs`). */
  ecartOuverture: ChaineDecimale | null;
  ecartCloture: ChaineDecimale | null;
  sortiesDansExercice: { nombre: number; valeurBrute: ChaineDecimale };
  sortiesAvantExercice: { nombre: number };
  misesEnServicePosterieures: number;
  composants: { nombre: number; valeurBrute: ChaineDecimale };
  /** Immobilisations dont une donnée nécessaire (date, base) manque ou est invalide : exclues du rapprochement, jamais devinées. */
  nbDonneesManquantes: number;
  motifs: string[];
}

/** Ce que le fichier et le moteur d'amortissements disent d'une ligne d'amortissements. */
export interface FichierLigneAmortissements {
  nbImmobilisations: number;
  amortissementsOuverture: ChaineDecimale | null;
  ecartOuverture: ChaineDecimale | null;
  /** Dotation de l'exercice calculée par le moteur (somme des immobilisations de la ligne) ; `null` si aucune n'est calculable. */
  dotationCalculee: ChaineDecimale | null;
  /** Vrai si le moteur a calculé une dotation pour chaque immobilisation de la ligne en service à la clôture. */
  calculComplet: boolean;
  /** Dotation comptabilisée dans la balance (crédits hors à-nouveaux des comptes d'amortissement de la ligne). */
  dotationComptabilisee: ChaineDecimale | null;
  /** Comptabilisé − calculé ; `null` si le calcul est incomplet ou si les à-nouveaux ne sont pas identifiés. */
  ecartDotation: ChaineDecimale | null;
  nbAbstentionsMoteur: number;
  nbDonneesManquantes: number;
  motifs: string[];
}

export interface LigneTableauImmobilisations {
  id: string;
  libelle: string;
  /** Numérotation romaine du formulaire (« Total I »…), ou `null`. */
  numeroRomain: string | null;
  /** `poste` : ligne alimentée par des comptes ; `total` : somme de lignes ; `non_ventile` : comptes sans ligne, hors totaux. */
  nature: 'poste' | 'total' | 'non_ventile';
  cellules: Record<string, CelluleImmobilisation>;
  comptes: CompteLigneImmobilisation[];
  /** Cellule « dont composants » du formulaire (2054, cadre A) : jamais déduite ; saisie justifiée du cabinet (D-134). */
  dontComposants: { codeCase: string | null; etatCodeCase: 'lu_verifie' | 'a_confirmer'; montant: ChaineDecimale | null; statut: 'a_saisir' | 'etabli'; motif: string | null } | null;
  fichierBrut: FichierLigneBrut | null;
  fichierAmortissements: FichierLigneAmortissements | null;
  note: string | null;
}

export interface ColonneImmobilisations {
  cle: string;
  /** Numéro de colonne du formulaire, ou `null` pour une colonne ajoutée par Comtaple (information, hors formulaire). */
  numero: number | null;
  libelle: string;
  surFormulaire: boolean;
}

export interface CadreImmobilisations {
  id: 'A' | 'B' | 'I' | 'II';
  titre: string;
  colonnes: ColonneImmobilisations[];
  lignes: LigneTableauImmobilisations[];
}

export interface TableauImmobilisations {
  code: CodeTableauImmobilisations;
  intitule: string;
  cadres: CadreImmobilisations[];
  cadresNonCouverts: Array<{ cadre: string; intitule: string; motif: string }>;
}

export interface ImmobilisationAbstention {
  immobilisation: string;
  libelle: string;
  code: string;
  motif: string;
}

export interface DemandeTableauxImmobilisations {
  /** Écritures de l'exercice (à-nouveaux compris). */
  lignes: readonly LigneEcriture[];
  exercice: { debut: string; fin: string };
  regime: RegimeLiasse;
  territoire: TerritoireFiscal;
  impotSurLeResultat: ImpotSurLeResultat;
  referentielComptable: string;
  devise: string;
  societeCommerciale: boolean | null;
  /** Fichier des immobilisations saisi ou repris (D-092) pour le dossier. */
  immobilisations?: readonly ImmobilisationAAmortir[];
  /** Codes des journaux d'à-nouveaux (défaut : AN, ANO, RAN). */
  journauxANouveaux?: readonly string[];
  /** Exercice précédent (colonne N-1) : mêmes règles, mêmes tables ; non contigu ou hors périmètre : colonne indisponible. */
  precedent?: { lignes: readonly LigneEcriture[]; exercice: { debut: string; fin: string } } | null;
  motifPrecedentAbsent?: string | null;
  options?: { amortissementDegressifActive?: boolean };
  /** Saisies des cellules que la balance ne permet pas de déduire (réévaluation, ventilation des diminutions, « dont composants »), D-134. */
  saisiesCellules?: readonly SaisieCelluleImmobilisations[];
  /** Version des données de l'exercice : une saisie faite sur une autre version est « à revoir » et n'est pas retenue. */
  versionDonnees?: number;
}

export type ComparatifImmobilisations =
  | { statut: 'fourni'; exercice: { debut: string; fin: string }; reserves: string[] }
  | { statut: 'indisponible'; motifs: string[] };

export interface TableauxImmobilisationsProjet {
  statut: 'projet';
  /** Toujours faux : des cellules restent à saisir et les codes de cases sont à confirmer. */
  complet: false;
  manques: string[];
  mention: string;
  regime: RegimeLiasse;
  exercice: { debut: string; fin: string };
  table: { id: string; version: string; millesimeFormulaire: string; etat: 'en_attente_de_validation_professionnelle' };
  reserves: string[];
  aNouveauxIdentifies: boolean;
  tableaux: TableauImmobilisations[];
  /** Totaux de contrôle (chaînes décimales) ; `null` quand ils ne sont pas établis. */
  totaux: Record<string, ChaineDecimale | null>;
  comparatif: ComparatifImmobilisations;
  fichier: {
    fourni: boolean;
    nbImmobilisations: number;
    degressif: { active: boolean; motif: string };
    /** Rapprochement du moteur d'amortissements (comptes, dotations, comptes sans immobilisation), tel quel ; `null` sans fichier. */
    rapprochementMoteur: RapprochementImmobilisations | null;
    /** Abstentions du moteur propres à une immobilisation (donnée manquante, sortie d'actif, composant invalide, dégressif non activé…). */
    abstentions: ImmobilisationAbstention[];
  };
  /** Écarts AFFICHÉS, jamais corrigés. */
  controles: ControleEtat[];
  sources: SourceRegle[];
  /** Lignes saisissables des cellules non déductibles de la balance (D-134), avec leur état. */
  saisiesCellules: LigneSaisieImmobilisationsProjet[];
}

export type ResultatTableauxImmobilisations = TableauxImmobilisationsProjet | LiasseAbstention;

// ───────────────────────────── Saisies des cellules non déductibles de la balance (D-134) ─────────────────────────────

export const CLE_DONT_COMPOSANTS = 'dont_composants';
export interface SaisieCelluleImmobilisations {
  /** « A03 », « B03 » (2054 cadres A et B) ou « I03 » (2033-C cadre I) : cadre + rang de la ligne dans le formulaire. */
  ligne: string;
  valeurs: Record<string, string>;
  note: string;
  qualifieePar: string;
  le: string;
  versionDonnees: number;
}
export interface LigneSaisieImmobilisations {
  ligne: string;
  cadre: 'A' | 'B' | 'I';
  ligneId: string;
  libelle: string;
  colonnes: Array<{ cle: string; libelle: string }>;
}
/** Lignes de postes (hors totaux) et colonnes que la balance ne déduit pas, par régime : réévaluation, ventilation des diminutions, valeur d'origine réévaluée, « dont composants ». */
export function lignesSaisieImmobilisations(regime: RegimeLiasse): LigneSaisieImmobilisations[] {
  const rang = (i: number) => String(i + 1).padStart(2, '0');
  const lib = (cols: ColonneDef[], cle: string) => cols.find((c) => c.cle === cle)!.libelle;
  if (regime === 'reel_normal') {
    const a = colonnesBrutA();
    const b = colonnesBrutB();
    const sorties: LigneSaisieImmobilisations[] = [];
    LIGNES_2054.forEach((l, i) => {
      if (l.id in SOMMES_2054) return;
      sorties.push({ ligne: `A${rang(i)}`, cadre: 'A', ligneId: l.id, libelle: l.libelle, colonnes: [{ cle: 'augmentation_reevaluation', libelle: lib(a, 'augmentation_reevaluation') }, ...(l.dont !== undefined ? [{ cle: CLE_DONT_COMPOSANTS, libelle: `Dont composants (case ${l.dont})` }] : [])] });
      sorties.push({ ligne: `B${rang(i)}`, cadre: 'B', ligneId: l.id, libelle: l.libelle, colonnes: ['diminution_virement', 'diminution_cession', 'reevaluation_valeur_origine'].map((cle) => ({ cle, libelle: lib(b, cle) })) });
    });
    return sorties;
  }
  return LIGNES_2033C.flatMap((l, i) => (l.id === 'TOTAL' ? [] : [{ ligne: `I${rang(i)}`, cadre: 'I' as const, ligneId: l.id, libelle: l.libelle, colonnes: [{ cle: 'reevaluation_valeur_origine', libelle: 'Réévaluation légale : valeur d’origine des immobilisations en fin d’exercice' }] }]));
}
/** Description d'une ligne de saisie (tous régimes) ; `null` si inconnue. */
export function descriptionLigneSaisieImmobilisations(ligne: string): LigneSaisieImmobilisations | null {
  return [...lignesSaisieImmobilisations('reel_normal'), ...lignesSaisieImmobilisations('reel_simplifie')].find((l) => l.ligne === ligne) ?? null;
}

export interface LigneSaisieImmobilisationsProjet extends LigneSaisieImmobilisations {
  statut: 'a_saisir' | 'saisi' | 'a_revoir';
  trace: { note: string; qualifieePar: string; le: string; versionDonnees: number } | null;
  valeurs: Record<string, string> | null;
}

export const TABLE_IMMOBILISATIONS = { id: 'LIASSE-IMMOBILISATIONS-AMORTISSEMENTS', version: '2026.1', millesimeFormulaire: '2026', etat: 'en_attente_de_validation_professionnelle' } as const;

// ───────────────────────────── Définition des formulaires (millésime 2026, lus le 2026-11-20) ─────────────────────────────

type OrigineColonne = 'ouverture' | 'augmentations' | 'diminutions' | 'diminutions_ventilees' | 'cloture' | 'a_saisir' | 'information_diminutions' | 'information_augmentations';

interface ColonneDef extends ColonneImmobilisations {
  origine: OrigineColonne;
}
interface LigneDef {
  id: string;
  libelle: string;
  romain?: string;
  nature: 'poste' | 'total';
  /** Lignes sommées (totaux). */
  somme?: readonly string[];
  /** Codes de cases, dans l'ordre des colonnes ; `null` : pas de code lisible. */
  codes: ReadonlyArray<string | null>;
  dont?: string;
  /** Fichier attendu pour cette ligne même sans immobilisation saisie (ligne amortissable). */
  amortissable?: boolean;
  note?: string;
}
interface CadreDef {
  id: CadreImmobilisations['id'];
  titre: string;
  /** `brut` : comptes 20 à 27 ; `amortissements` : comptes 28. */
  nature: 'brut' | 'amortissements';
  colonnes: ColonneDef[];
  lignes: LigneDef[];
  /** Préfixe de compte → identifiant de ligne ; le préfixe le plus long l'emporte. */
  rattachement: ReadonlyArray<readonly [string, string]>;
}
interface TableauDef {
  code: CodeTableauImmobilisations;
  intitule: string;
  cadres: CadreDef[];
  cadresNonCouverts: TableauImmobilisations['cadresNonCouverts'];
}

const col = (cle: string, numero: number | null, libelle: string, origine: OrigineColonne): ColonneDef => ({ cle, numero, libelle, origine, surFormulaire: numero !== null || origine === 'a_saisir' });
const info = (cle: string, libelle: string, origine: OrigineColonne): ColonneDef => ({ cle, numero: null, libelle, origine, surFormulaire: false });

const MOTIF_SANS_A_NOUVEAUX = 'Journal d’à-nouveaux non identifié dans les écritures : l’ouverture et les mouvements de l’exercice ne se calculent pas ; à saisir.';
const MOTIF_REEVALUATION = 'Réévaluation et mise en équivalence : information que les écritures ne permettent pas de déduire avec certitude ; à saisir (néant à confirmer par le cabinet).';
const MOTIF_VALEUR_ORIGINE = 'Valeur d’origine en fin d’exercice des immobilisations réévaluées ou mises en équivalence (notice 2032-NOT-SD) : information que la balance ne contient pas ; à saisir.';
const MOTIF_VENTILATION = 'Les mouvements de crédit des comptes ne distinguent pas virements de poste à poste, cessions et mises hors service : ventilation à saisir (la colonne « Diminutions totales » de Comtaple en donne le total).';
const MOTIF_DONT_COMPOSANTS = 'Montant « dont composants » : les comptes ne distinguent pas la structure de ses composants (PCG art. 214-9) et la colonne que cette case renseigne n’est pas établie : à saisir. Les composants saisis au fichier sont rappelés à titre d’information.';

// 2054 — immobilisations (lignes : libellé du formulaire ; codes : colonnes 1 à 3 du cadre A, 1 à 4 du cadre B).
interface Ligne2054 { id: string; libelle: string; romain?: string; a: string[]; b: string[]; dont?: string; amortissable?: boolean; note?: string }
const LIGNES_2054: Ligne2054[] = [
  { id: 'FRAIS', libelle: 'Frais d’établissement et de développement', romain: 'Total I', a: ['CZ', 'D8', 'D9'], b: ['IN', 'CØ', 'DØ', 'D7'], amortissable: true },
  { id: 'AUTRES_INCORP', libelle: 'Autres postes d’immobilisations incorporelles', romain: 'Total II', a: ['KD', 'KE', 'KF'], b: ['IO', 'LV', 'LW', '1X'], amortissable: true },
  { id: 'TERRAINS', libelle: 'Terrains', a: ['KG', 'KH', 'KI'], b: ['IP', 'LX', 'LY', 'LZ'] },
  { id: 'CONSTR_PROPRE', libelle: 'Constructions sur sol propre', a: ['KJ', 'KK', 'KL'], b: ['IQ', 'MA', 'MB', 'MC'], dont: 'L9', amortissable: true },
  { id: 'CONSTR_AUTRUI', libelle: 'Constructions sur sol d’autrui', a: ['KM', 'KN', 'KO'], b: ['IR', 'MD', 'ME', 'MF'], dont: 'M1', amortissable: true },
  { id: 'CONSTR_INST', libelle: 'Constructions : installations générales, agencements et aménagements des constructions', a: ['KP', 'KQ', 'KR'], b: ['IS', 'MG', 'MH', 'MI'], dont: 'M2', amortissable: true },
  { id: 'INST_TECH', libelle: 'Installations techniques, matériel et outillage industriels', a: ['KS', 'KT', 'KU'], b: ['IT', 'MJ', 'MK', 'ML'], dont: 'M3', amortissable: true },
  { id: 'INST_DIVERS', libelle: 'Installations générales, agencements, aménagements divers', a: ['KV', 'KW', 'KX'], b: ['IU', 'MM', 'MN', 'MO'], amortissable: true },
  { id: 'TRANSPORT', libelle: 'Matériel de transport', a: ['KY', 'KZ', 'LA'], b: ['IV', 'MP', 'MQ', 'MR'], amortissable: true },
  { id: 'BUREAU', libelle: 'Matériel de bureau et informatique, mobilier', a: ['LB', 'LC', 'LD'], b: ['IW', 'MS', 'MT', 'MU'], amortissable: true },
  { id: 'EMBALLAGES', libelle: 'Emballages récupérables et divers', a: ['LE', 'LF', 'LG'], b: ['IX', 'MV', 'MW', 'MX'], amortissable: true, note: 'Reçoit aussi, par convention interne, les autres comptes 218 non rattachés à une ligne précise (à confirmer).' },
  { id: 'EN_COURS', libelle: 'Immobilisations corporelles en cours', a: ['LH', 'LI', 'LJ'], b: ['MY', 'MZ', 'NA', 'NB'] },
  { id: 'AVANCES', libelle: 'Avances et acomptes (immobilisations corporelles)', a: ['LK', 'LL', 'LM'], b: ['NC', 'ND', 'NE', 'NF'] },
  { id: 'TOTAL_III', libelle: 'Total III (immobilisations corporelles)', a: ['LN', 'LO', 'LP'], b: ['IY', 'NG', 'NH', 'NI'] },
  { id: 'MEE', libelle: 'Participations évaluées par mise en équivalence', a: ['8G', '8M', '8T'], b: ['IZ', 'ØU', 'M7', 'ØW'] },
  { id: 'AUTRES_PART', libelle: 'Autres participations', a: ['8U', '8V', '8W'], b: ['IØ', 'ØX', 'ØY', 'ØZ'] },
  { id: 'AUTRES_TITRES', libelle: 'Autres titres immobilisés', a: ['1P', '1R', '1S'], b: ['I1', '2B', '2C', '2D'] },
  { id: 'PRETS', libelle: 'Prêts et autres immobilisations financières', a: ['1T', '1U', '1V'], b: ['I2', '2E', '2F', '2G'], note: 'Reçoit aussi, par convention interne, les créances rattachées à des participations (comptes 267 et 268), à confirmer.' },
  { id: 'TOTAL_IV', libelle: 'Total IV (immobilisations financières)', a: ['LQ', 'LR', 'LS'], b: ['I3', 'NJ', 'NK', '2H'] },
  { id: 'TOTAL_GENERAL', libelle: 'Total général (I + II + III + IV)', a: ['ØG', 'ØH', 'ØJ'], b: ['I4', 'ØK', 'ØL', 'ØM'] },
];
const SOMMES_2054: Record<string, readonly string[]> = {
  TOTAL_III: ['TERRAINS', 'CONSTR_PROPRE', 'CONSTR_AUTRUI', 'CONSTR_INST', 'INST_TECH', 'INST_DIVERS', 'TRANSPORT', 'BUREAU', 'EMBALLAGES', 'EN_COURS', 'AVANCES'],
  TOTAL_IV: ['MEE', 'AUTRES_PART', 'AUTRES_TITRES', 'PRETS'],
  TOTAL_GENERAL: ['FRAIS', 'AUTRES_INCORP', 'TOTAL_III', 'TOTAL_IV'],
};
const RATTACHEMENT_BRUT_2054: ReadonlyArray<readonly [string, string]> = [
  ['201', 'FRAIS'], ['203', 'FRAIS'],
  ['205', 'AUTRES_INCORP'], ['206', 'AUTRES_INCORP'], ['207', 'AUTRES_INCORP'], ['208', 'AUTRES_INCORP'], ['232', 'AUTRES_INCORP'], ['237', 'AUTRES_INCORP'],
  ['211', 'TERRAINS'], ['212', 'TERRAINS'],
  ['213', 'CONSTR_PROPRE'], ['2135', 'CONSTR_INST'], ['214', 'CONSTR_AUTRUI'], ['2145', 'CONSTR_INST'],
  ['215', 'INST_TECH'],
  ['2181', 'INST_DIVERS'], ['2182', 'TRANSPORT'], ['2183', 'BUREAU'], ['2184', 'BUREAU'], ['218', 'EMBALLAGES'],
  ['231', 'EN_COURS'], ['238', 'AVANCES'],
  ['262', 'MEE'], ['261', 'AUTRES_PART'], ['266', 'AUTRES_PART'],
  ['271', 'AUTRES_TITRES'], ['272', 'AUTRES_TITRES'], ['273', 'AUTRES_TITRES'], ['27682', 'AUTRES_TITRES'],
  ['267', 'PRETS'], ['268', 'PRETS'], ['274', 'PRETS'], ['275', 'PRETS'], ['276', 'PRETS'],
];

// 2055 — amortissements (cadre A : colonnes 1 à 4).
interface Ligne2055 { id: string; libelle: string; romain?: string; codes: string[] }
const LIGNES_2055: Ligne2055[] = [
  { id: 'FRAIS', libelle: 'Frais d’établissement et de développement', codes: ['CY', 'EL', 'EM', 'EN'] },
  { id: 'FONDS', libelle: 'Fonds commercial', codes: ['RE', 'RF', 'RI', 'RJ'] },
  { id: 'AUTRES_INCORP', libelle: 'Autres immobilisations incorporelles', codes: ['PE', 'PF', 'PG', 'PH'] },
  { id: 'TOTAL_I', libelle: 'Total I (immobilisations incorporelles)', codes: ['RK', 'RM', 'RN', 'RO'] },
  { id: 'TERRAINS', libelle: 'Terrains', codes: ['PI', 'PJ', 'PK', 'PL'] },
  { id: 'CONSTR_PROPRE', libelle: 'Constructions sur sol propre', codes: ['PM', 'PN', 'PO', 'PQ'] },
  { id: 'CONSTR_AUTRUI', libelle: 'Constructions sur sol d’autrui', codes: ['PR', 'PS', 'PT', 'PU'] },
  { id: 'CONSTR_INST', libelle: 'Constructions : installations générales, agencements et aménagements des constructions', codes: ['PV', 'PW', 'PX', 'PY'] },
  { id: 'INST_TECH', libelle: 'Installations techniques, matériel et outillage industriels', codes: ['PZ', 'QA', 'QB', 'QC'] },
  { id: 'INST_DIVERS', libelle: 'Installations générales, agencements, aménagements divers', codes: ['QD', 'QE', 'QF', 'QG'] },
  { id: 'TRANSPORT', libelle: 'Matériel de transport', codes: ['QH', 'QI', 'QJ', 'QK'] },
  { id: 'BUREAU', libelle: 'Matériel de bureau et informatique, mobilier', codes: ['QL', 'QM', 'QN', 'QO'] },
  { id: 'EMBALLAGES', libelle: 'Emballages récupérables et divers', codes: ['QP', 'QR', 'QS', 'QT'] },
  { id: 'TOTAL_II', libelle: 'Total II (immobilisations corporelles)', codes: ['QU', 'QV', 'QW', 'QX'] },
  { id: 'TOTAL_GENERAL', libelle: 'Total général (I + II)', codes: ['ØN', 'ØP', 'ØQ', 'ØR'] },
];
const SOMMES_2055: Record<string, readonly string[]> = {
  TOTAL_I: ['FRAIS', 'FONDS', 'AUTRES_INCORP'],
  TOTAL_II: ['TERRAINS', 'CONSTR_PROPRE', 'CONSTR_AUTRUI', 'CONSTR_INST', 'INST_TECH', 'INST_DIVERS', 'TRANSPORT', 'BUREAU', 'EMBALLAGES'],
  TOTAL_GENERAL: ['TOTAL_I', 'TOTAL_II'],
};
const RATTACHEMENT_AMORT_2055: ReadonlyArray<readonly [string, string]> = [
  ['2801', 'FRAIS'], ['2803', 'FRAIS'], ['2807', 'FONDS'], ['2805', 'AUTRES_INCORP'], ['2808', 'AUTRES_INCORP'],
  ['2811', 'TERRAINS'], ['2812', 'TERRAINS'],
  ['2813', 'CONSTR_PROPRE'], ['28135', 'CONSTR_INST'], ['2814', 'CONSTR_AUTRUI'], ['28145', 'CONSTR_INST'],
  ['2815', 'INST_TECH'],
  ['28181', 'INST_DIVERS'], ['28182', 'TRANSPORT'], ['28183', 'BUREAU'], ['28184', 'BUREAU'], ['2818', 'EMBALLAGES'],
];

// 2033-C — régime simplifié : cadre I (valeurs brutes, codes numériques) et cadre II (amortissements).
interface Ligne2033C { id: string; libelle: string; codesI: Array<string | null>; codesII: string[] | null; amortissable?: boolean; note?: string }
const LIGNES_2033C: Ligne2033C[] = [
  { id: 'FONDS', libelle: 'Fonds commercial', codesI: ['400', '402', '404', '406', null], codesII: ['495', '497', '498', '499'], amortissable: false },
  { id: 'AUTRES_INCORP', libelle: 'Autres immobilisations incorporelles', codesI: ['410', '412', '414', '416', null], codesII: ['500', '502', '504', '506'], amortissable: true, note: 'Reçoit, par convention interne, les frais d’établissement et de développement (comptes 201 et 203), le formulaire n’ayant pas de ligne qui leur soit propre (à confirmer sur la notice 2033-NOT-SD).' },
  { id: 'TERRAINS', libelle: 'Terrains', codesI: ['420', '422', '424', '426', null], codesII: ['510', '512', '514', '516'] },
  { id: 'CONSTRUCTIONS', libelle: 'Constructions', codesI: ['430', '432', '434', '436', null], codesII: ['520', '522', '524', '526'], amortissable: true, note: 'Comprend les installations générales, agencements et aménagements des constructions (comptes 2135 et 2145), le formulaire n’ayant pas de ligne distincte.' },
  { id: 'INST_TECH', libelle: 'Installations techniques, matériel et outillage industriels', codesI: ['440', '442', '444', '446', null], codesII: ['530', '532', '534', '536'], amortissable: true },
  { id: 'INST_DIVERS', libelle: 'Installations générales, agencements, aménagements divers', codesI: ['450', '452', '454', '456', null], codesII: ['540', '542', '544', '546'], amortissable: true },
  { id: 'TRANSPORT', libelle: 'Matériel de transport', codesI: ['460', '462', '464', '466', null], codesII: ['550', '552', '554', '556'], amortissable: true },
  { id: 'AUTRES_CORPO', libelle: 'Autres immobilisations corporelles', codesI: ['470', '472', '474', '476', null], codesII: ['560', '562', '564', '566'], amortissable: true, note: 'Reçoit, par convention interne, les comptes 2183, 2184 et autres 218, ainsi que les immobilisations en cours et avances (231, 238), à confirmer.' },
  { id: 'FINANCIERES', libelle: 'Immobilisations financières', codesI: ['480', '482', '484', '486', null], codesII: null },
  { id: 'TOTAL', libelle: 'Total', codesI: ['490', '492', '494', '496', null], codesII: ['570', '572', '574', '576'] },
];
const SOMMES_2033C = ['FONDS', 'AUTRES_INCORP', 'TERRAINS', 'CONSTRUCTIONS', 'INST_TECH', 'INST_DIVERS', 'TRANSPORT', 'AUTRES_CORPO', 'FINANCIERES'];
const RATTACHEMENT_BRUT_2033C: ReadonlyArray<readonly [string, string]> = [
  ['207', 'FONDS'],
  ['201', 'AUTRES_INCORP'], ['203', 'AUTRES_INCORP'], ['205', 'AUTRES_INCORP'], ['206', 'AUTRES_INCORP'], ['208', 'AUTRES_INCORP'], ['232', 'AUTRES_INCORP'], ['237', 'AUTRES_INCORP'],
  ['211', 'TERRAINS'], ['212', 'TERRAINS'],
  ['213', 'CONSTRUCTIONS'], ['214', 'CONSTRUCTIONS'],
  ['215', 'INST_TECH'],
  ['2181', 'INST_DIVERS'], ['2182', 'TRANSPORT'], ['218', 'AUTRES_CORPO'], ['231', 'AUTRES_CORPO'], ['238', 'AUTRES_CORPO'],
  ['26', 'FINANCIERES'], ['27', 'FINANCIERES'],
];
const RATTACHEMENT_AMORT_2033C: ReadonlyArray<readonly [string, string]> = [
  ['2807', 'FONDS'], ['2801', 'AUTRES_INCORP'], ['2803', 'AUTRES_INCORP'], ['2805', 'AUTRES_INCORP'], ['2808', 'AUTRES_INCORP'],
  ['2811', 'TERRAINS'], ['2812', 'TERRAINS'], ['2813', 'CONSTRUCTIONS'], ['2814', 'CONSTRUCTIONS'], ['2815', 'INST_TECH'],
  ['28181', 'INST_DIVERS'], ['28182', 'TRANSPORT'], ['2818', 'AUTRES_CORPO'],
];

const colonnesBrutA = (): ColonneDef[] => [
  col('ouverture', 1, 'Valeur brute des immobilisations au début de l’exercice', 'ouverture'),
  col('augmentation_reevaluation', 2, 'Augmentations consécutives à une réévaluation pratiquée au cours de l’exercice ou résultant d’une mise en équivalence', 'a_saisir'),
  col('augmentation_acquisitions', 3, 'Augmentations : acquisitions, créations, apports et virements de poste à poste', 'augmentations'),
];
const colonnesBrutB = (): ColonneDef[] => [
  col('diminution_virement', 1, 'Diminutions : par virement de poste à poste', 'diminutions_ventilees'),
  col('diminution_cession', 2, 'Diminutions : par cession à des tiers ou mises hors service ou résultant d’une mise en équivalence', 'diminutions_ventilees'),
  col('cloture', 3, 'Valeur brute des immobilisations à la fin de l’exercice', 'cloture'),
  col('reevaluation_valeur_origine', 4, 'Réévaluation légale ou évaluation par mise en équivalence : valeur d’origine des immobilisations en fin d’exercice', 'a_saisir'),
  info('diminutions_totales', 'Diminutions totales (colonnes 1 + 2) — information Comtaple, hors formulaire', 'information_diminutions'),
];
const colonnesAmort = (): ColonneDef[] => [
  col('ouverture', 1, 'Montant des amortissements au début de l’exercice', 'ouverture'),
  col('dotations', 2, 'Augmentations : dotations de l’exercice', 'augmentations'),
  col('diminutions', 3, 'Diminutions : amortissements afférents aux éléments sortis de l’actif et reprises', 'diminutions'),
  col('cloture', 4, 'Montant des amortissements à la fin de l’exercice', 'cloture'),
];

function definitions(regime: RegimeLiasse): TableauDef[] {
  if (regime === 'reel_normal') {
    const lignesA: LigneDef[] = LIGNES_2054.map((l) => ({ id: l.id, libelle: l.libelle, ...(l.romain !== undefined ? { romain: l.romain } : {}), nature: l.id in SOMMES_2054 ? 'total' : 'poste', ...(SOMMES_2054[l.id] !== undefined ? { somme: SOMMES_2054[l.id] } : {}), codes: l.a, ...(l.dont !== undefined ? { dont: l.dont } : {}), ...(l.amortissable ? { amortissable: true } : {}), ...(l.note !== undefined ? { note: l.note } : {}) }));
    const lignesB: LigneDef[] = LIGNES_2054.map((l) => ({ id: l.id, libelle: l.libelle, ...(l.romain !== undefined ? { romain: l.romain } : {}), nature: l.id in SOMMES_2054 ? 'total' : 'poste', ...(SOMMES_2054[l.id] !== undefined ? { somme: SOMMES_2054[l.id] } : {}), codes: [...l.b, null], ...(l.amortissable ? { amortissable: true } : {}), ...(l.note !== undefined ? { note: l.note } : {}) }));
    const lignes55: LigneDef[] = LIGNES_2055.map((l) => ({ id: l.id, libelle: l.libelle, nature: l.id in SOMMES_2055 ? 'total' : 'poste', ...(SOMMES_2055[l.id] !== undefined ? { somme: SOMMES_2055[l.id] } : {}), codes: l.codes, ...(l.id in SOMMES_2055 ? {} : { amortissable: true }) }));
    return [
      {
        code: '2054', intitule: 'Immobilisations',
        cadres: [
          { id: 'A', titre: 'Cadre A — Immobilisations : valeur brute au début de l’exercice et augmentations', nature: 'brut', colonnes: colonnesBrutA(), lignes: lignesA, rattachement: RATTACHEMENT_BRUT_2054 },
          { id: 'B', titre: 'Cadre B — Immobilisations : diminutions et valeur brute à la fin de l’exercice', nature: 'brut', colonnes: colonnesBrutB(), lignes: lignesB, rattachement: RATTACHEMENT_BRUT_2054 },
        ],
        cadresNonCouverts: [{ cadre: '2054 bis', intitule: 'Écarts de réévaluation sur immobilisations amortissables', motif: 'Tableau exigé des seules entreprises ayant pratiqué la réévaluation légale ; il ne se déduit pas de la balance.' }],
      },
      {
        code: '2055', intitule: 'Amortissements',
        cadres: [{ id: 'A', titre: 'Cadre A — Situations et mouvements de l’exercice des amortissements techniques (ou venant en diminution de l’actif)', nature: 'amortissements', colonnes: colonnesAmort(), lignes: lignes55, rattachement: RATTACHEMENT_AMORT_2055 }],
        cadresNonCouverts: [
          { cadre: 'B', intitule: 'Ventilation des mouvements affectant la provision pour amortissements dérogatoires', motif: 'La ventilation par origine (différentiel de durée, dégressif, amortissement fiscal exceptionnel) ne se déduit pas de la balance : à saisir à partir du compte 145.' },
          { cadre: 'C', intitule: 'Mouvements de l’exercice affectant les charges réparties sur plusieurs exercices', motif: 'Frais d’émission d’emprunt et primes de remboursement : non préparés dans ce lot.' },
        ],
      },
    ];
  }
  const lignesI: LigneDef[] = LIGNES_2033C.map((l) => ({ id: l.id, libelle: l.libelle, nature: l.id === 'TOTAL' ? 'total' : 'poste', ...(l.id === 'TOTAL' ? { somme: SOMMES_2033C } : {}), codes: l.codesI, ...(l.amortissable ? { amortissable: true } : {}), ...(l.note !== undefined ? { note: l.note } : {}) }));
  const lignesII: LigneDef[] = LIGNES_2033C.filter((l) => l.codesII !== null).map((l) => ({ id: l.id, libelle: l.libelle, nature: l.id === 'TOTAL' ? 'total' : 'poste', ...(l.id === 'TOTAL' ? { somme: SOMMES_2033C.filter((x) => x !== 'FINANCIERES') } : {}), codes: l.codesII as string[], amortissable: true, ...(l.note !== undefined ? { note: l.note } : {}) }));
  return [
    {
      code: '2033-C', intitule: 'Immobilisations, amortissements, plus-values et moins-values',
      cadres: [
        {
          id: 'I', titre: 'Cadre I — Immobilisations', nature: 'brut',
          colonnes: [
            col('ouverture', 1, 'Valeur brute des immobilisations au début de l’exercice', 'ouverture'),
            col('augmentations', 2, 'Augmentations', 'augmentations'),
            col('diminutions', 3, 'Diminutions', 'diminutions'),
            col('cloture', 4, 'Valeur brute des immobilisations à la fin de l’exercice', 'cloture'),
            col('reevaluation_valeur_origine', 5, 'Réévaluation légale : valeur d’origine des immobilisations en fin d’exercice', 'a_saisir'),
          ],
          lignes: lignesI, rattachement: RATTACHEMENT_BRUT_2033C,
        },
        { id: 'II', titre: 'Cadre II — Amortissements', nature: 'amortissements', colonnes: colonnesAmort(), lignes: lignesII, rattachement: RATTACHEMENT_AMORT_2033C },
      ],
      cadresNonCouverts: [{ cadre: 'III', intitule: 'Plus-values, moins-values', motif: 'Prix de cession, nature des immobilisations cédées, qualification court ou long terme et régularisations ne se déduisent pas de la balance : cadre non préparé.' }],
    },
  ];
}

// ───────────────────────────── Calcul sur les comptes ─────────────────────────────

const NON_VENTILE = 'NON_VENTILE';
const LIBELLE_NON_VENTILE = 'Comptes non ventilés : aucune ligne du formulaire ne les reprend (hors totaux)';

function ligneDuCompte(cadre: CadreDef, compteNum: string): string | null {
  const domaine = cadre.nature === 'brut' ? /^2[0-7]/ : /^28/;
  if (!domaine.test(compteNum)) return null;
  let meilleur: { longueur: number; id: string } | null = null;
  for (const [prefixe, id] of cadre.rattachement) if (compteNum.startsWith(prefixe) && (meilleur === null || prefixe.length > meilleur.longueur)) meilleur = { longueur: prefixe.length, id };
  return meilleur === null ? NON_VENTILE : meilleur.id;
}

interface CumulLigne { ouverture: Decimal; augmentations: Decimal; diminutions: Decimal; cloture: Decimal; comptes: SuiviCompte[] }
interface CalculExercice { aNouveaux: boolean; parLigne: Map<string, CumulLigne>; comptes: Map<string, SuiviCompte> }

function calculerExercice(lignes: readonly LigneEcriture[], fin: string, journaux: readonly string[], cadre: CadreDef): CalculExercice {
  const { comptes, aNouveauxIdentifies } = suivreComptes(lignes, fin, journaux);
  const sens = cadre.nature === 'brut' ? 1 : -1;
  const parLigne = new Map<string, CumulLigne>();
  for (const c of [...comptes.values()].sort((a, b) => (a.compteNum < b.compteNum ? -1 : a.compteNum > b.compteNum ? 1 : 0))) {
    const id = ligneDuCompte(cadre, c.compteNum);
    if (id === null) continue;
    const cumul = parLigne.get(id) ?? { ouverture: ZERO, augmentations: ZERO, diminutions: ZERO, cloture: ZERO, comptes: [] };
    cumul.ouverture = cumul.ouverture.plus(c.ouverture.times(sens));
    cumul.augmentations = cumul.augmentations.plus(sens === 1 ? c.debit : c.credit);
    cumul.diminutions = cumul.diminutions.plus(sens === 1 ? c.credit : c.debit);
    cumul.cloture = cumul.cloture.plus(c.cloture.times(sens));
    if (!c.ouverture.isZero() || !c.debit.isZero() || !c.credit.isZero() || !c.cloture.isZero()) cumul.comptes.push(c);
    parLigne.set(id, cumul);
  }
  return { aNouveaux: aNouveauxIdentifies, parLigne, comptes };
}

type ValeurCellule = { montant: Decimal | null; statut: StatutCellule; motif: string | null };
const etabli = (montant: Decimal): ValeurCellule => ({ montant, statut: 'etabli', motif: null });
const abstention = (motif: string): ValeurCellule => ({ montant: null, statut: 'abstention', motif });
const aSaisir = (motif: string): ValeurCellule => ({ montant: null, statut: 'a_saisir', motif });

function valeurPoste(c: ColonneDef, cumul: CumulLigne | undefined, aNouveaux: boolean): ValeurCellule {
  const v = cumul ?? { ouverture: ZERO, augmentations: ZERO, diminutions: ZERO, cloture: ZERO, comptes: [] };
  switch (c.origine) {
    case 'cloture': return etabli(v.cloture);
    case 'ouverture': return aNouveaux ? etabli(v.ouverture) : abstention(MOTIF_SANS_A_NOUVEAUX);
    case 'augmentations': return aNouveaux ? etabli(v.augmentations) : abstention(MOTIF_SANS_A_NOUVEAUX);
    case 'diminutions': return aNouveaux ? etabli(v.diminutions) : abstention(MOTIF_SANS_A_NOUVEAUX);
    case 'information_diminutions': return aNouveaux ? etabli(v.diminutions) : abstention(MOTIF_SANS_A_NOUVEAUX);
    case 'information_augmentations': return aNouveaux ? etabli(v.augmentations) : abstention(MOTIF_SANS_A_NOUVEAUX);
    case 'diminutions_ventilees':
      if (!aNouveaux) return abstention(MOTIF_SANS_A_NOUVEAUX);
      // Sans aucun mouvement de crédit, la ventilation est certaine : néant.
      return v.diminutions.isZero() ? etabli(ZERO) : aSaisir(MOTIF_VENTILATION);
    case 'a_saisir': return aSaisir(c.cle === 'reevaluation_valeur_origine' ? MOTIF_VALEUR_ORIGINE : MOTIF_REEVALUATION);
  }
}

/** Cellules d'une ligne : postes d'après les comptes, totaux d'après leurs composants (tout ou rien). */
function cellulesDuCadre(cadre: CadreDef, calcul: CalculExercice, saisies?: ReadonlyMap<string, Readonly<Record<string, string>>>): Map<string, Map<string, ValeurCellule>> {
  const resultat = new Map<string, Map<string, ValeurCellule>>();
  const ordre = [...cadre.lignes, { id: NON_VENTILE, nature: 'poste' } as LigneDef];
  for (const l of ordre) {
    const cellules = new Map<string, ValeurCellule>();
    for (const c of cadre.colonnes) {
      if (l.nature === 'poste') {
        const v = valeurPoste(c, calcul.parLigne.get(l.id), calcul.aNouveaux);
        const saisie = saisies?.get(l.id)?.[c.cle];
        // Une saisie justifiée du cabinet établit la cellule que la balance ne permet pas de déduire (réévaluation, ventilation des diminutions).
        cellules.set(c.cle, saisie !== undefined && v.statut === 'a_saisir' ? etabli(dec(saisie)) : v);
        continue;
      }
      let total = ZERO;
      let manque: string | null = null;
      for (const id of l.somme ?? []) {
        const v = resultat.get(id)?.get(c.cle);
        if (v === undefined || v.montant === null) { manque = v?.motif ?? 'Une des lignes composant ce total n’est pas établie.'; break; }
        total = total.plus(v.montant);
      }
      cellules.set(c.cle, manque === null ? etabli(total) : c.origine === 'a_saisir' ? aSaisir(`Total non établi tant qu'une ligne composante n'est pas saisie : ${manque}`) : { montant: null, statut: 'abstention', motif: `Total non établi : ${manque}` });
    }
    resultat.set(l.id, cellules);
  }
  return resultat;
}

// ───────────────────────────── Fichier des immobilisations ─────────────────────────────

interface Classee { immo: ImmobilisationAAmortir; base: Decimal | null; mes: string | null; sortie: string | null; manque: string | null }

function classer(immo: ImmobilisationAAmortir): Classee {
  const manques: string[] = [];
  const base = typeof immo.baseAmortissable === 'string' && estChaineDecimale(immo.baseAmortissable) && dec(immo.baseAmortissable).isPositive() ? dec(immo.baseAmortissable) : null;
  if (base === null) manques.push('base amortissable absente ou invalide');
  const mes = typeof immo.dateMiseEnService === 'string' && estDateIso(immo.dateMiseEnService) ? immo.dateMiseEnService : null;
  if (mes === null) manques.push('date de mise en service absente ou invalide');
  let sortie: string | null = null;
  if (immo.dateSortie !== undefined && immo.dateSortie !== null) {
    if (estDateIso(immo.dateSortie)) sortie = immo.dateSortie; else manques.push('date de sortie invalide');
  }
  return { immo, base, mes, sortie, manque: manques.length === 0 ? null : `immobilisation « ${immo.libelle} » (${immo.id}) : ${manques.join(', ')}` };
}

const m2 = (d: Decimal): ChaineDecimale => versChaine(d);

function fichierBrut(ligneId: string, classees: readonly Classee[], debut: string, fin: string, cumul: CumulLigne | undefined, aNouveaux: boolean): FichierLigneBrut {
  const motifs: string[] = [];
  const manquantes = classees.filter((c) => c.manque !== null);
  for (const c of manquantes) motifs.push(`Exclue du rapprochement : ${c.manque}.`);
  const valides = classees.filter((c) => c.manque === null && c.base !== null && c.mes !== null) as Array<Classee & { base: Decimal; mes: string }>;
  const somme = (liste: ReadonlyArray<Classee & { base: Decimal }>): Decimal => liste.reduce((s, c) => s.plus(c.base), ZERO);
  const ouvertes = valides.filter((c) => c.mes < debut && (c.sortie === null || c.sortie >= debut));
  const cloturees = valides.filter((c) => c.mes <= fin && (c.sortie === null || c.sortie > fin));
  const sortiesDans = valides.filter((c) => c.mes <= fin && c.sortie !== null && c.sortie >= debut && c.sortie <= fin);
  const sortiesAvant = valides.filter((c) => c.sortie !== null && c.sortie < debut);
  const posterieures = valides.filter((c) => c.mes > fin);
  const composants = cloturees.filter((c) => c.immo.composantDe !== undefined && c.immo.composantDe !== null);
  const comparable = manquantes.length === 0;
  if (!comparable) motifs.push(`Ligne ${ligneId} : rapprochement non établi tant qu’une immobilisation de la ligne est incomplète (aucune donnée n’est devinée).`);
  const ouv = comparable ? somme(ouvertes) : null;
  const clo = comparable ? somme(cloturees) : null;
  const ecartOuverture = ouv !== null && aNouveaux && cumul !== undefined ? cumul.ouverture.minus(ouv) : ouv !== null && aNouveaux ? ZERO.minus(ouv) : null;
  if (ouv !== null && !aNouveaux) motifs.push('Écart à l’ouverture non calculable : à-nouveaux non identifiés.');
  const ecartCloture = clo !== null ? (cumul?.cloture ?? ZERO).minus(clo) : null;
  if (sortiesDans.length > 0) motifs.push(`${sortiesDans.length} sortie(s) d’actif saisie(s) dans l’exercice (valeur brute ${m2(somme(sortiesDans))}) : cessions ou mises hors service à qualifier ; plus-values non calculées.`);
  if (composants.length > 0) motifs.push(`${composants.length} composant(s) saisi(s) (valeur brute ${m2(somme(composants))}) : leur montant n’est pas isolé dans les cellules du formulaire.`);
  if (posterieures.length > 0) motifs.push(`${posterieures.length} immobilisation(s) mise(s) en service après la clôture : ignorée(s).`);
  return {
    nbImmobilisations: classees.length,
    valeurBruteOuverture: ouv === null ? null : m2(ouv),
    valeurBruteCloture: clo === null ? null : m2(clo),
    ecartOuverture: ecartOuverture === null ? null : m2(ecartOuverture),
    ecartCloture: ecartCloture === null ? null : m2(ecartCloture),
    sortiesDansExercice: { nombre: sortiesDans.length, valeurBrute: m2(somme(sortiesDans)) },
    sortiesAvantExercice: { nombre: sortiesAvant.length },
    misesEnServicePosterieures: posterieures.length,
    composants: { nombre: composants.length, valeurBrute: m2(somme(composants)) },
    nbDonneesManquantes: manquantes.length,
    motifs,
  };
}

function fichierAmortissements(
  classees: readonly Classee[], debut: string, fin: string, cumul: CumulLigne | undefined, aNouveaux: boolean,
  dotations: ReadonlyMap<string, ChaineDecimale | null>, nbAbstentions: number,
): FichierLigneAmortissements {
  const motifs: string[] = [];
  const manquantes = classees.filter((c) => c.manque !== null);
  for (const c of manquantes) motifs.push(`Exclue du rapprochement : ${c.manque}.`);
  const valides = classees.filter((c) => c.manque === null && c.mes !== null) as Array<Classee & { mes: string }>;
  const ouvertes = valides.filter((c) => c.mes < debut && (c.sortie === null || c.sortie >= debut));
  const enService = valides.filter((c) => c.mes <= fin && (c.sortie === null || c.sortie > fin));
  const sansAnterieurs = ouvertes.filter((c) => c.immo.amortissementsAnterieurs === undefined || c.immo.amortissementsAnterieurs === null || !estChaineDecimale(c.immo.amortissementsAnterieurs));
  let ouverture: Decimal | null = null;
  if (manquantes.length > 0) motifs.push('Amortissements à l’ouverture selon le fichier non établis : immobilisation incomplète.');
  else if (sansAnterieurs.length > 0) motifs.push(`Amortissements à l’ouverture selon le fichier non établis : ${sansAnterieurs.length} immobilisation(s) sans amortissements antérieurs saisis.`);
  else ouverture = ouvertes.reduce((s, c) => s.plus(dec(c.immo.amortissementsAnterieurs as string)), ZERO);
  const ecartOuverture = ouverture !== null && aNouveaux ? (cumul?.ouverture ?? ZERO).minus(ouverture) : null;
  if (ouverture !== null && !aNouveaux) motifs.push('Écart à l’ouverture non calculable : à-nouveaux non identifiés.');
  const calculables = enService.filter((c) => dotations.get(c.immo.id) !== undefined && dotations.get(c.immo.id) !== null);
  const calculComplet = manquantes.length === 0 && enService.length > 0 && calculables.length === enService.length;
  const calculee = calculables.length === 0 ? null : calculables.reduce((s, c) => s.plus(dec(dotations.get(c.immo.id) as string)), ZERO);
  if (enService.length > 0 && !calculComplet) motifs.push(`Dotation calculée incomplète : le moteur n’a pu calculer que ${calculables.length} dotation(s) sur ${enService.length} immobilisation(s) en service (voir les abstentions).`);
  const comptabilisee = aNouveaux ? (cumul?.augmentations ?? ZERO) : null;
  const ecartDotation = calculComplet && calculee !== null && comptabilisee !== null ? comptabilisee.minus(calculee) : null;
  return {
    nbImmobilisations: classees.length,
    amortissementsOuverture: ouverture === null ? null : m2(ouverture),
    ecartOuverture: ecartOuverture === null ? null : m2(ecartOuverture),
    dotationCalculee: calculee === null ? null : m2(calculee),
    calculComplet,
    dotationComptabilisee: comptabilisee === null ? null : m2(comptabilisee),
    ecartDotation: ecartDotation === null ? null : m2(ecartDotation),
    nbAbstentionsMoteur: nbAbstentions,
    nbDonneesManquantes: manquantes.length,
    motifs,
  };
}

// ───────────────────────────── Construction des tableaux ─────────────────────────────

interface ContexteFichier {
  fournies: readonly ImmobilisationAAmortir[];
  classees: Classee[];
  dotations: Map<string, ChaineDecimale | null>;
  abstentionsParImmobilisation: Map<string, number>;
}

function construireTableau(def: TableauDef, p: { saisies?: ReadonlyMap<string, ReadonlyMap<string, Readonly<Record<string, string>>>>; lignes: readonly LigneEcriture[]; exercice: { debut: string; fin: string }; journaux: readonly string[]; precedent: { lignes: readonly LigneEcriture[]; exercice: { debut: string; fin: string } } | null; fichier: ContexteFichier }): TableauImmobilisations {
  const cadres = def.cadres.map((cadre): CadreImmobilisations => {
    const n = calculerExercice(p.lignes, p.exercice.fin, p.journaux, cadre);
    const n1 = p.precedent === null ? null : calculerExercice(p.precedent.lignes, p.precedent.exercice.fin, p.journaux, cadre);
    const valeursN = cellulesDuCadre(cadre, n, p.saisies?.get(cadre.id));
    const valeursN1 = n1 === null ? null : cellulesDuCadre(cadre, n1);
    // Fichier : immobilisations regroupées par ligne du cadre (le compte d'amortissement se déduit du compte d'immobilisation : 2xyz → 28xyz).
    const parLigne = new Map<string, Classee[]>();
    for (const c of p.fichier.classees) {
      const compte = c.immo.compteImmobilisation;
      const id = ligneDuCompte(cadre, cadre.nature === 'brut' ? compte : `28${compte.slice(1)}`) ?? NON_VENTILE;
      parLigne.set(id, [...(parLigne.get(id) ?? []), c]);
    }
    const avecFichier = p.fichier.fournies.length > 0;
    const construireLigne = (l: LigneDef): LigneTableauImmobilisations => {
      const cumul = n.parLigne.get(l.id);
      const cellules: Record<string, CelluleImmobilisation> = {};
      cadre.colonnes.forEach((c, i) => {
        const v = valeursN.get(l.id)?.get(c.cle) as ValeurCellule;
        const code = l.codes[i] ?? null;
        cellules[c.cle] = {
          codeCase: code,
          etatCodeCase: code === null ? 'a_confirmer' : 'lu_verifie',
          montant: v.montant === null ? null : m2(v.montant),
          n1: valeursN1 === null ? null : ((): ChaineDecimale | null => { const x = valeursN1.get(l.id)?.get(c.cle); return x === undefined || x.montant === null ? null : m2(x.montant); })(),
          statut: v.statut,
          motif: v.motif,
        };
      });
      const sens = cadre.nature === 'brut' ? 1 : -1;
      const comptes: CompteLigneImmobilisation[] = (cumul?.comptes ?? []).map((c) => ({
        compteNum: c.compteNum, compteLib: c.compteLib,
        ouverture: n.aNouveaux ? m2(c.ouverture.times(sens)) : null,
        augmentations: n.aNouveaux ? m2(sens === 1 ? c.debit : c.credit) : null,
        diminutions: n.aNouveaux ? m2(sens === 1 ? c.credit : c.debit) : null,
        cloture: m2(c.cloture.times(sens)),
      }));
      const classees = parLigne.get(l.id) ?? [];
      let fb: FichierLigneBrut | null = null;
      let fa: FichierLigneAmortissements | null = null;
      if (l.nature === 'poste' && avecFichier) {
        if (cadre.nature === 'brut') {
          if (classees.length > 0 || l.amortissable === true) fb = fichierBrut(l.id, classees, p.exercice.debut, p.exercice.fin, cumul, n.aNouveaux);
        } else {
          const nonNul = cumul !== undefined && (!cumul.cloture.isZero() || !cumul.augmentations.isZero() || !cumul.ouverture.isZero());
          if (classees.length > 0 || nonNul) {
            const nbAbst = classees.reduce((s, c) => s + (p.fichier.abstentionsParImmobilisation.get(c.immo.id) ?? 0), 0);
            fa = fichierAmortissements(classees, p.exercice.debut, p.exercice.fin, cumul, n.aNouveaux, p.fichier.dotations, nbAbst);
          }
        }
      }
      return {
        id: l.id, libelle: l.libelle, numeroRomain: l.romain ?? null, nature: l.nature, cellules, comptes,
        dontComposants: l.dont === undefined ? null : ((): NonNullable<LigneTableauImmobilisations['dontComposants']> => {
          const saisi = p.saisies?.get(cadre.id)?.get(l.id)?.[CLE_DONT_COMPOSANTS];
          return saisi === undefined ? { codeCase: l.dont, etatCodeCase: 'lu_verifie', montant: null, statut: 'a_saisir', motif: MOTIF_DONT_COMPOSANTS } : { codeCase: l.dont, etatCodeCase: 'lu_verifie', montant: m2(dec(saisi)), statut: 'etabli', motif: null };
        })(),
        fichierBrut: fb, fichierAmortissements: fa, note: l.note ?? null,
      };
    };
    const lignes = cadre.lignes.map(construireLigne);
    const nv = construireLigne({ id: NON_VENTILE, libelle: LIBELLE_NON_VENTILE, nature: 'poste', codes: [] });
    const nonVentile = { ...nv, nature: 'non_ventile' as const };
    const aDesComptes = nonVentile.comptes.length > 0;
    return { id: cadre.id, titre: cadre.titre, colonnes: cadre.colonnes.map(({ cle, numero, libelle, surFormulaire }) => ({ cle, numero, libelle, surFormulaire })), lignes: aDesComptes ? [...lignes, nonVentile] : lignes };
  });
  return { code: def.code, intitule: def.intitule, cadres, cadresNonCouverts: def.cadresNonCouverts };
}

function brutImmobiliseAuBilan(correspondance: CorrespondanceRubriques, lignes: readonly LigneEcriture[], fin: string): Decimal {
  const balance = calculerBalance(lignes, { jusquau: fin });
  const bilan = projeterBilan(balance, correspondance);
  const parent = new Map(correspondance.rubriques.map((r) => [r.code, r.parent]));
  const regroupements = new Set(correspondance.rubriques.map((r) => r.parent).filter((c): c is string => c !== null));
  const estImmobilise = (code: string): boolean => {
    for (let c: string | null | undefined = code, i = 0; c !== null && c !== undefined && i < 10; c = parent.get(c), i++) if (c === 'A_ACTIF_IMMOBILISE' || c === 'A_FRAIS_ETABLISSEMENT') return true;
    return false;
  };
  return bilan.rubriques.filter((r) => !regroupements.has(r.code) && estImmobilise(r.code)).reduce((s, r) => s.plus(dec(r.brut ?? r.montant)), ZERO);
}

const cellule = (t: TableauImmobilisations, cadre: string, ligne: string, cle: string): CelluleImmobilisation | undefined => t.cadres.find((c) => c.id === cadre)?.lignes.find((l) => l.id === ligne)?.cellules[cle];
const montantDe = (c: CelluleImmobilisation | undefined): Decimal | null => (c === undefined || c.montant === null ? null : dec(c.montant));

function ctrl(code: string, ecart: Decimal | null, ok: string, ko: string, nonVerifiable: string): ControleEtat {
  if (ecart === null) return { code, statut: 'non_verifiable', message: nonVerifiable, ecart: null };
  return ecart.isZero() ? { code, statut: 'ok', message: ok, ecart: '0.00' } : { code, statut: 'ecart', message: `${ko} Écart : ${versChaine(ecart)}. Aucun ajustement n’est pratiqué.`, ecart: versChaine(ecart) };
}

const RESERVES = [
  'Projet calculé sur les écritures importées, AVANT écritures d’inventaire : les dotations de la clôture non encore comptabilisées n’y figurent pas.',
  'Lignes, colonnes et codes de cases : relus sur le formulaire du millésime 2026 (PDF officiel du 2026-11-20) par extraction de texte ; les codes sont « lus, à confirmer » (le symbole Ø est un zéro barré). Montants restitués au centime ; l’écran propose l’affichage en euros entiers (montants exacts inchangés).',
  'Rattachement des comptes aux lignes : convention interne fondée sur la numérotation du PCG, non validée par un professionnel ; les comptes non rattachés sont affichés « non ventilés », hors totaux.',
  'Augmentations et diminutions = mouvements débit et crédit des comptes hors à-nouveaux : ils comprennent virements de poste à poste, extournes et corrections ; les réévaluations ne sont pas distinguées.',
  'Les dotations aux dépréciations (comptes 29) relèvent du tableau 2056, non couvert : elles ne figurent pas dans les amortissements.',
];

export function preparerTableauxImmobilisations(demande: DemandeTableauxImmobilisations): ResultatTableauxImmobilisations {
  const perimetre = { exercice: demande.exercice, regime: demande.regime, territoire: demande.territoire, impotSurLeResultat: demande.impotSurLeResultat, referentielComptable: demande.referentielComptable, devise: demande.devise, societeCommerciale: demande.societeCommerciale };
  const motifs = motifsAbstention(perimetre);
  if (motifs.length > 0) return { statut: 'abstention', motifs, perimetreCouvert: PERIMETRE_LIASSE, mention: MENTION_PROJET };
  const correspondance = correspondancePour(demande.exercice.debut) as CorrespondanceRubriques;
  const journaux = demande.journauxANouveaux ?? ['AN', 'ANO', 'RAN'];
  const degressifActive = demande.options?.amortissementDegressifActive === true;

  // Exercice précédent : contigu et dans le périmètre, sinon colonne indisponible avec son motif.
  let precedent: { lignes: readonly LigneEcriture[]; exercice: { debut: string; fin: string } } | null = null;
  let comparatif: ComparatifImmobilisations;
  if (demande.precedent === undefined || demande.precedent === null) comparatif = { statut: 'indisponible', motifs: [demande.motifPrecedentAbsent ?? MOTIF_SANS_PRECEDENT] };
  else {
    const v = verifierExercicePrecedent(demande.exercice, demande.precedent.exercice);
    const horsPerimetre = v.motif === null ? motifsAbstention({ ...perimetre, exercice: demande.precedent.exercice }) : [];
    if (v.motif !== null) comparatif = { statut: 'indisponible', motifs: [v.motif] };
    else if (horsPerimetre.length > 0) comparatif = { statut: 'indisponible', motifs: ['L’exercice précédent sort du périmètre couvert : ' + horsPerimetre.map((m) => m.message).join(' ')] };
    else { precedent = demande.precedent; comparatif = { statut: 'fourni', exercice: demande.precedent.exercice, reserves: v.reserves.length > 0 ? v.reserves : [RESERVE_N1_NON_VALIDE] }; }
  }

  // Fichier des immobilisations et moteur d'amortissements (dégressif non activé sauf décision de l'éditeur).
  const fournies = demande.immobilisations ?? [];
  const fichier: ContexteFichier = { fournies, classees: fournies.map(classer), dotations: new Map(), abstentionsParImmobilisation: new Map() };
  let rapprochementMoteur: RapprochementImmobilisations | null = null;
  const abstentions: ImmobilisationAbstention[] = [];
  if (fournies.length > 0) {
    const moteur = proposerEcrituresInventaire({ lignes: demande.lignes, exercice: demande.exercice, lireLibelles: false, immobilisations: fournies, options: { amortissementDegressifActive: degressifActive } });
    rapprochementMoteur = moteur.rapprochement;
    for (const s of moteur.immobilisationsSuivies) fichier.dotations.set(s.id, s.dotationExercice);
    const libelles = new Map(fournies.map((i) => [i.id, i.libelle]));
    for (const a of moteur.abstentions) {
      const id = a.sources.immobilisation;
      if (id === null) continue;
      abstentions.push({ immobilisation: id, libelle: libelles.get(id) ?? id, code: a.code, motif: a.motif });
      fichier.abstentionsParImmobilisation.set(id, (fichier.abstentionsParImmobilisation.get(id) ?? 0) + 1);
    }
  }

  // Saisies des cellules non déductibles (D-134) : seules celles faites sur la version courante des données sont retenues.
  const lignesSaisissables = lignesSaisieImmobilisations(demande.regime);
  const saisiesRetenues = new Map<string, Map<string, Record<string, string>>>();
  const saisiesProjet: LigneSaisieImmobilisationsProjet[] = lignesSaisissables.map((d) => {
    const s = (demande.saisiesCellules ?? []).find((x) => x.ligne === d.ligne);
    const statut: LigneSaisieImmobilisationsProjet['statut'] = s === undefined ? 'a_saisir' : demande.versionDonnees !== undefined && s.versionDonnees !== demande.versionDonnees ? 'a_revoir' : 'saisi';
    if (statut === 'saisi') saisiesRetenues.set(d.cadre, (saisiesRetenues.get(d.cadre) ?? new Map()).set(d.ligneId, s!.valeurs));
    return { ...d, statut, trace: s === undefined ? null : { note: s.note, qualifieePar: s.qualifieePar, le: s.le, versionDonnees: s.versionDonnees }, valeurs: statut === 'saisi' ? s!.valeurs : null };
  });
  const tableaux = definitions(demande.regime).map((def) => construireTableau(def, { saisies: saisiesRetenues, lignes: demande.lignes, exercice: demande.exercice, journaux, precedent, fichier }));

  // Totaux de contrôle.
  const rn = demande.regime === 'reel_normal';
  const brutT = rn ? tableaux.find((t) => t.code === '2054') : tableaux.find((t) => t.code === '2033-C');
  const amortT = rn ? tableaux.find((t) => t.code === '2055') : tableaux.find((t) => t.code === '2033-C');
  const cadreBrut = rn ? 'B' : 'I';
  const cadreAmort = rn ? 'A' : 'II';
  const ligneTotalBrut = rn ? 'TOTAL_GENERAL' : 'TOTAL';
  const ligneTotalAmort = rn ? 'TOTAL_GENERAL' : 'TOTAL';
  const brutCloture = brutT === undefined ? null : montantDe(cellule(brutT, cadreBrut, ligneTotalBrut, 'cloture'));
  const amortCloture = amortT === undefined ? null : montantDe(cellule(amortT, cadreAmort, ligneTotalAmort, 'cloture'));
  const totaux: Record<string, ChaineDecimale | null> = {
    valeur_brute_cloture: brutCloture === null ? null : m2(brutCloture),
    amortissements_cloture: amortCloture === null ? null : m2(amortCloture),
    valeur_nette_cloture: brutCloture === null || amortCloture === null ? null : m2(brutCloture.minus(amortCloture)),
  };

  const controles: ControleEtat[] = [];
  const nonVentileBrut = brutT?.cadres.find((c) => c.id === cadreBrut)?.lignes.find((l) => l.id === NON_VENTILE);
  const ecartBilan = brutT === undefined || brutCloture === null ? null : brutCloture.plus(montantDe(nonVentileBrut?.cellules['cloture']) ?? ZERO).minus(brutImmobiliseAuBilan(correspondance, demande.lignes, demande.exercice.fin));
  controles.push(ctrl('valeur_brute_egale_projet_de_bilan', ecartBilan,
    'Le total des valeurs brutes (lignes du formulaire et comptes non ventilés) reprend la valeur brute de l’actif immobilisé du projet de bilan.',
    'Le total des valeurs brutes diffère de la valeur brute de l’actif immobilisé du projet de bilan : un compte d’immobilisation n’est pas repris de la même façon par la table des comptes (par exemple un compte 206 ou un compte au solde inversé).',
    'Valeur brute au bilan non vérifiable.'));
  if (comparatif.statut === 'fourni') {
    const nOuvBrut = brutT === undefined ? null : montantDe(cellule(brutT, rn ? 'A' : 'I', ligneTotalBrut, 'ouverture'));
    const clotureN1 = brutT === undefined ? undefined : cellule(brutT, cadreBrut, ligneTotalBrut, 'cloture')?.n1;
    const n1Brut = clotureN1 === undefined || clotureN1 === null ? null : dec(clotureN1);
    controles.push(ctrl('ouverture_brute_egale_cloture_n1', nOuvBrut !== null && n1Brut !== null ? nOuvBrut.minus(n1Brut) : null,
      'Les valeurs brutes à l’ouverture reprennent celles de la clôture de l’exercice précédent.',
      'Les valeurs brutes à l’ouverture diffèrent de celles de la clôture de l’exercice précédent (calculées avant écritures d’inventaire) : écritures d’inventaire ou de reprise des à-nouveaux à examiner.',
      'Reprise des valeurs brutes non vérifiable (à-nouveaux non identifiés ou colonne N-1 indisponible).'));
    const nOuvAmort = amortT === undefined ? null : montantDe(cellule(amortT, cadreAmort, ligneTotalAmort, 'ouverture'));
    const n1AmortCellule = amortT === undefined ? undefined : cellule(amortT, cadreAmort, ligneTotalAmort, 'cloture');
    const n1Amort = n1AmortCellule?.n1 === null || n1AmortCellule === undefined ? null : dec(n1AmortCellule.n1);
    controles.push(ctrl('ouverture_amortissements_egale_cloture_n1', nOuvAmort !== null && n1Amort !== null ? nOuvAmort.minus(n1Amort) : null,
      'Les amortissements à l’ouverture reprennent ceux de la clôture de l’exercice précédent.',
      'Les amortissements à l’ouverture diffèrent de ceux de la clôture de l’exercice précédent (calculés avant écritures d’inventaire) : écritures d’inventaire ou de reprise des à-nouveaux à examiner.',
      'Reprise des amortissements non vérifiable (à-nouveaux non identifiés ou colonne N-1 indisponible).'));
  }
  // Fichier : écarts affichés.
  const lignesBrut = brutT?.cadres.find((c) => c.id === (rn ? 'A' : 'I'))?.lignes ?? [];
  const lignesAmort = amortT?.cadres.find((c) => c.id === cadreAmort)?.lignes ?? [];
  if (fournies.length === 0) {
    controles.push({ code: 'fichier_valeurs_brutes', statut: 'non_verifiable', message: 'Aucune immobilisation saisie pour ce dossier : valeurs brutes non rapprochées du fichier.', ecart: null });
    controles.push({ code: 'fichier_dotations', statut: 'non_verifiable', message: 'Aucune immobilisation saisie pour ce dossier : dotations non rapprochées du moteur d’amortissements.', ecart: null });
  } else {
    const ecartsBrut = lignesBrut.filter((l) => l.fichierBrut !== null && l.fichierBrut.ecartCloture !== null && !dec(l.fichierBrut.ecartCloture).isZero());
    const incomparablesBrut = lignesBrut.filter((l) => l.fichierBrut !== null && l.fichierBrut.ecartCloture === null);
    controles.push(ecartsBrut.length === 0 && incomparablesBrut.length === 0
      ? { code: 'fichier_valeurs_brutes', statut: 'ok', message: 'Les valeurs brutes de clôture concordent avec le fichier des immobilisations sur toutes les lignes rapprochées.', ecart: '0.00' }
      : ecartsBrut.length === 0
        ? { code: 'fichier_valeurs_brutes', statut: 'non_verifiable', message: `${incomparablesBrut.length} ligne(s) non rapprochée(s) du fichier (donnée manquante) : ${incomparablesBrut.map((l) => l.libelle).join(' ; ')}.`, ecart: null }
        : { code: 'fichier_valeurs_brutes', statut: 'ecart', message: `Écart entre la balance et le fichier des immobilisations sur ${ecartsBrut.length} ligne(s) : ${ecartsBrut.map((l) => `${l.libelle} (${(l.fichierBrut as FichierLigneBrut).ecartCloture})`).join(' ; ')}.${incomparablesBrut.length > 0 ? ` ${incomparablesBrut.length} autre(s) ligne(s) non rapprochée(s) (donnée manquante) : ${incomparablesBrut.map((l) => l.libelle).join(' ; ')}.` : ''} Aucun ajustement n’est pratiqué.`, ecart: m2(ecartsBrut.reduce((s, l) => s.plus(dec((l.fichierBrut as FichierLigneBrut).ecartCloture as string)), ZERO)) });
    const ecartsDot = lignesAmort.filter((l) => l.fichierAmortissements?.ecartDotation !== null && l.fichierAmortissements?.ecartDotation !== undefined && !dec(l.fichierAmortissements.ecartDotation).isZero());
    const sansCalcul = lignesAmort.filter((l) => l.fichierAmortissements !== null && l.fichierAmortissements.ecartDotation === null);
    controles.push(ecartsDot.length > 0
      ? { code: 'fichier_dotations', statut: 'ecart', message: `Dotation comptabilisée différente de la dotation calculée par le moteur sur ${ecartsDot.length} ligne(s) : ${ecartsDot.map((l) => `${l.libelle} (${(l.fichierAmortissements as FichierLigneAmortissements).ecartDotation})`).join(' ; ')}. Aucun ajustement n’est pratiqué.`, ecart: m2(ecartsDot.reduce((s, l) => s.plus(dec((l.fichierAmortissements as FichierLigneAmortissements).ecartDotation as string)), ZERO)) }
      : sansCalcul.length > 0
        ? { code: 'fichier_dotations', statut: 'non_verifiable', message: `Dotation non rapprochable sur ${sansCalcul.length} ligne(s) (calcul incomplet ou à-nouveaux non identifiés) : voir les abstentions du moteur.`, ecart: null }
        : { code: 'fichier_dotations', statut: 'ok', message: 'Les dotations comptabilisées égalent les dotations calculées par le moteur sur toutes les lignes rapprochées.', ecart: '0.00' });
  }
  // Ventilation des diminutions saisie : virements + cessions doivent égaler les diminutions totales de la balance (indicatif, jamais corrigé).
  if (rn) {
    const cadreB = brutT?.cadres.find((c) => c.id === 'B');
    for (const l of cadreB?.lignes.filter((x) => x.nature === 'poste') ?? []) {
      const vir = montantDe(l.cellules['diminution_virement']);
      const ces = montantDe(l.cellules['diminution_cession']);
      const tot = montantDe(l.cellules['diminutions_totales']);
      const saisie = saisiesProjet.find((x) => x.cadre === 'B' && x.ligneId === l.id && x.statut === 'saisi' && x.valeurs !== null && ('diminution_virement' in x.valeurs || 'diminution_cession' in x.valeurs));
      if (saisie === undefined || vir === null || ces === null || tot === null) continue;
      controles.push(ctrl(`ventilation_diminutions_${l.id}`, vir.plus(ces).minus(tot),
        `${l.libelle} : virements + cessions saisis égalent les diminutions de la balance.`,
        `${l.libelle} : virements + cessions saisis diffèrent des diminutions de la balance.`,
        `${l.libelle} : ventilation non vérifiable.`));
    }
  }
  // Dotations des amortissements au regard du compte 6811.
  const dot = amortT === undefined ? null : montantDe(cellule(amortT, cadreAmort, ligneTotalAmort, 'dotations'));
  const compte6811 = [...suivreComptes(demande.lignes, demande.exercice.fin, journaux).comptes.values()].filter((c) => c.compteNum.startsWith('6811')).reduce((s, c) => s.plus(c.debit).minus(c.credit), ZERO);
  controles.push(ctrl('dotations_egales_compte_6811', dot === null ? null : dot.minus(compte6811),
    'Les dotations aux comptes d’amortissement égalent la dotation comptabilisée au compte 6811.',
    'Les crédits de l’exercice des comptes d’amortissement diffèrent de la dotation comptabilisée au compte 6811 : reprises, virements, cessions ou comptes d’amortissement hors immobilisations à examiner.',
    'Dotations non vérifiables (à-nouveaux non identifiés).'));

  const aNouveaux = suivreComptes(demande.lignes, demande.exercice.fin, journaux).aNouveauxIdentifies;
  const manques: string[] = [
    ...(aNouveaux ? [] : [MOTIF_SANS_A_NOUVEAUX]),
    ...(saisiesProjet.some((x) => x.statut !== 'saisi') ? ['Cellules à saisir : réévaluations, valeur d’origine, ventilation des diminutions lorsque des crédits existent, « dont composants » (voir le motif de chaque cellule et les lignes de saisie en dessous).'] : []),
    ...tableaux.flatMap((t) => t.cadresNonCouverts.map((c) => `${t.code === '2033-C' ? '2033-C' : t.code} cadre ${c.cadre} « ${c.intitule} » non préparé : ${c.motif}`)),
    ...tableaux.flatMap((t) => t.cadres.flatMap((c) => c.lignes.filter((l) => l.nature === 'non_ventile').map((l) => `Tableau ${t.code}, cadre ${c.id} : ${l.comptes.length} compte(s) non ventilé(s) (${l.comptes.map((x) => x.compteNum).join(', ')}), hors totaux : à rattacher à une ligne.`))),
    ...controles.filter((c) => c.statut === 'ecart').map((c) => `Écart au contrôle ${c.code} : ${c.message}`),
    ...(fournies.length === 0 ? ['Aucune immobilisation saisie : rapprochement avec le fichier et dotation du moteur indisponibles.'] : []),
    ...abstentions.map((a) => `Fichier : « ${a.libelle} » (${a.immobilisation}) — ${a.motif}`),
    ...(comparatif.statut === 'indisponible' ? comparatif.motifs.map((m) => `Colonne N-1 indisponible : ${m}`) : []),
    'Codes de cases lus sur le formulaire du millésime 2026 par extraction de texte : à confirmer visuellement.',
    'Rattachement des comptes aux lignes du formulaire et table de correspondance en attente de validation professionnelle.',
  ];
  const sources: SourceRegle[] = [
    ...(rn ? [SOURCES_FISCALES.formulaires2054_2055Lus] : [SOURCES_FISCALES.formulaire2033CLu]),
    SOURCES_FISCALES.noticesImmobilisationsLues,
    SOURCES_FISCALES.conventionRattachementImmobilisations,
    rn ? SOURCES_FISCALES.bofipListeTableauxReelNormal : SOURCES_FISCALES.bofipListeTableauxReelSimplifie,
    SOURCES_FISCALES.amortissementLineaire,
    SOURCES_FISCALES.amortissementDegressif,
    correspondance.source,
  ];
  return {
    statut: 'projet',
    complet: false,
    manques,
    mention: MENTION_PROJET,
    regime: demande.regime,
    exercice: { debut: demande.exercice.debut, fin: demande.exercice.fin },
    table: { ...TABLE_IMMOBILISATIONS },
    reserves: RESERVES,
    aNouveauxIdentifies: aNouveaux,
    tableaux,
    totaux,
    comparatif,
    fichier: {
      fourni: fournies.length > 0,
      nbImmobilisations: fournies.length,
      degressif: degressifActive
        ? { active: true, motif: 'Calcul du dégressif activé par l’éditeur ; le texte de loi (CGI art. 39 A) reste non vérifié et les règles non validées par un professionnel.' }
        : { active: false, motif: MOTIF_DEGRESSIF_NON_ACTIVE },
      rapprochementMoteur,
      abstentions,
    },
    controles,
    sources,
    saisiesCellules: saisiesProjet,
  };
}
