/**
 * Propositions assistées d'écritures d'inventaire — déterministes, JAMAIS comptabilisées automatiquement (décision D-028).
 *
 * Quatre règles explicites, chacune versionnée :
 *  - INV-CCA / INV-PCA : charge ou produit de l'exercice dont la période couverte dépasse la clôture. La période vient d'une
 *    saisie du cabinet (`periodesCouvertes`) ou d'un libellé portant deux dates complètes (« du 01/10/2025 au 30/09/2026 ») ;
 *    prorata temporis en jours calendaires réels, bornes incluses ;
 *  - INV-FNP / INV-FAE : écriture passée après la clôture sur une pièce datée dans l'exercice, signalée par un constat du
 *    contrôle de césure CLO-001 ; l'écriture d'origine doit se réduire à « charge + TVA + fournisseur » (ou « produit + TVA + client ») ;
 *  - INV-AMORT : dotation linéaire, UNIQUEMENT si la base, la date de mise en service et la durée sont fournies ;
 *  - INV-AMORT-DEG : dotation dégressive, UNIQUEMENT si le cabinet a déclaré le mode dégressif, confirmé l'éligibilité du bien et
 *    déclaré un coefficient cohérent avec la durée ; plan année par année, bascule au linéaire, prorata au mois ;
 *  - rapprochement avec la comptabilité importée : une dotation déjà comptabilisée n'est JAMAIS reproposée en doublon, l'écart
 *    éventuel est affiché et jamais corrigé.
 *
 * Dès qu'une donnée manque ou qu'un cas est ambigu : abstention motivée, jamais d'estimation silencieuse.
 * Chaque proposition est équilibrée (débit = crédit, vérifié en décimal exact), porte le statut `proposee`, son calcul détaillé,
 * ses sources et ses hypothèses. Aucun montant n'est un flottant.
 */
import { Decimal } from 'decimal.js';
import { creditDe, debitDe } from '../controles/outils.js';
import type { Constat, LigneEcriture, SourceRegle } from '../controles/types.js';
import { dateCivileValide, ecartEnJours, estBissextile, estDateIso, isoDepuisJours, joursDepuisEpoque, versIso } from '../dates.js';
import { JUSTIFICATION_DEGRESSIF_MIN } from '../immobilisations/schema.js';
import { type ChaineDecimale, estChaineDecimale, versChaine } from '../montant.js';
import { MENTION_PROJET, SOURCES_FISCALES } from './sources-fiscales.js';

const ZERO = new Decimal(0);

// ───────────────────────────── Types publics ─────────────────────────────

export type TypePropositionInventaire = 'charge_constatee_avance' | 'produit_constate_avance' | 'facture_non_parvenue' | 'facture_a_etablir' | 'dotation_amortissement_lineaire' | 'dotation_amortissement_degressif';
/** Motif d'abstention exposé tel quel à l'utilisateur tant que le dégressif n'est pas activé. */
export const MOTIF_DEGRESSIF_NON_ACTIVE =
  'Calcul du dégressif non activé : le texte de loi (CGI art. 39 A) n’a pas été vérifié sur une source officielle et les règles n’ont pas été validées par un professionnel. L’activation relève de l’éditeur.';

/** Mode du plan d'amortissement COMPTABLE, choisi par le cabinet (PCG art. 214-13) : jamais deviné. */
export type ModeAmortissement = 'lineaire' | 'degressif';
export type ConventionJoursAmortissement = 'base_360' | 'jours_reels';

/** Période couverte par une ligne de charge ou de produit, fournie par le cabinet. */
export interface PeriodeCouverte {
  /** Identifiant de la ligne d'écriture (`LigneEcriture.id`). */
  ligneId: string;
  /** Premier jour couvert (ISO). Absent : abstention, le prorata n'est pas calculable. */
  debut?: string | null;
  /** Dernier jour couvert (ISO). */
  fin: string;
}

/** Données d'une immobilisation à amortir. Une donnée absente (`null`) provoque une abstention motivée. */
export interface ImmobilisationAAmortir {
  id: string;
  libelle: string;
  /** Compte d'immobilisation (20x ou 21x pour une dérivation automatique des comptes). */
  compteImmobilisation: string;
  /** VALEUR BRUTE à amortir ; le montant amortissable est cette valeur diminuée de la valeur résiduelle éventuelle (PCG art. 214-4). */
  baseAmortissable: ChaineDecimale | null;
  /** Mode du plan comptable (défaut : linéaire). Le dégressif n'est jamais proposé sans déclaration explicite. */
  modeAmortissement?: ModeAmortissement;
  /** Coefficient dégressif déclaré (1.25, 1.75 ou 2.25) : exigé en mode dégressif et vérifié contre la durée. */
  coefficientDegressif?: ChaineDecimale | null;
  /** Le cabinet confirme que le bien remplit les conditions du dégressif (neuf, durée d'au moins trois ans, bien visé par l'art. 39 A du CGI, hors exclusions). */
  eligibiliteDegressifConfirmee?: boolean | null;
  /** Justification écrite du cabinet (D-150) : exigée pour tout calcul dégressif ; reprise telle quelle dans les hypothèses de la proposition. */
  justificationDegressif?: string | null;
  /** Valeur résiduelle (PCG art. 214-4 : prise en compte seulement si significative et mesurable), strictement inférieure à la valeur brute. */
  valeurResiduelle?: ChaineDecimale | null;
  /** Date de sortie de l'actif (cession, mise au rebut) : si elle tombe dans ou avant l'exercice, le moteur s'abstient. */
  dateSortie?: string | null;
  /** Identifiant de l'immobilisation « structure » dont celle-ci est un composant (PCG art. 214-9) : chaque composant a son plan. */
  composantDe?: string | null;
  /**
   * Date d'acquisition (ou de construction), saisie par le cabinet. Point de départ du dégressif : le premier jour du MOIS d'acquisition
   * (BOFiP BOI-BIC-AMT-20-20-30 § 190 à 200). Exigée en mode dégressif ; sans effet sur le linéaire (point de départ : mise en service).
   */
  dateAcquisition?: string | null;
  dateMiseEnService: string | null;
  /** Durée d'amortissement en mois entiers. */
  dureeMois: number | null;
  /** Amortissements cumulés à l'ouverture de l'exercice, s'ils sont connus : ils plafonnent la dotation et soldent le plan. */
  amortissementsAnterieurs?: ChaineDecimale | null;
  /** Compte d'amortissement (28x). Défaut : dérivé du compte d'immobilisation. */
  compteAmortissement?: string;
  /** Compte de dotation. Défaut : 68111 (comptes 20x) ou 68112 (comptes 21x). */
  compteDotation?: string;
}

export interface ComptesInventaire {
  chargesConstateesAvance: string;
  produitsConstatesAvance: string;
  facturesNonParvenues: string;
  tvaSurFacturesNonParvenues: string;
  facturesAEtablir: string;
  tvaSurFacturesAEtablir: string;
}

export interface DemandeInventaire {
  /** Écritures du dossier. Les écritures postérieures à la clôture sont nécessaires aux factures non parvenues et à établir. */
  lignes: readonly LigneEcriture[];
  exercice: { debut: string; fin: string };
  periodesCouvertes?: readonly PeriodeCouverte[];
  /** Lire les périodes « du JJ/MM/AAAA au JJ/MM/AAAA » dans les libellés d'écriture (défaut : oui). */
  lireLibelles?: boolean;
  /** Constats du contrôle de césure CLO-001 (`ResultatControle.constats`). Les autres constats sont ignorés. */
  constatsCesure?: readonly Constat[];
  immobilisations?: readonly ImmobilisationAAmortir[];
  options?: {
    /** Défaut : `base_360` (année de 360 jours, mois de 30 jours). */
    conventionJoursAmortissement?: ConventionJoursAmortissement;
    /**
     * Calcul du dégressif activé par l'éditeur. DÉFAUT : false (non activé) — le texte de loi (CGI art. 39 A) n'a pas pu être vérifié sur une
     * source officielle et les règles n'ont pas été validées par un professionnel. Tant qu'il est faux, toute immobilisation déclarée en
     * dégressif reçoit une abstention motivée et aucun montant.
     */
    amortissementDegressifActive?: boolean;
    /** Comptes à utiliser ; à défaut ils sont repris des écritures ou construits à partir de la racine du plan de comptes. */
    comptes?: Partial<ComptesInventaire>;
  };
}

export interface LignePropositionInventaire { compteNum: string; libelle: string; debit: ChaineDecimale; credit: ChaineDecimale }

export interface PropositionEcritureInventaire {
  /** Clé stable entre deux exécutions sur les mêmes données. */
  id: string;
  type: TypePropositionInventaire;
  /** Toujours « proposee » : aucune écriture n'est comptabilisée par le moteur. */
  statut: 'proposee';
  /** Date de l'écriture proposée : date de clôture. */
  dateEcriture: string;
  libelle: string;
  origine: { regle: string; versionRegle: string; signal: string };
  justification: string;
  /** Calcul détaillé, étape par étape. */
  calcul: Array<{ libelle: string; valeur: string }>;
  lignes: LignePropositionInventaire[];
  totalDebit: ChaineDecimale;
  totalCredit: ChaineDecimale;
  /** Vérifié en décimal exact : une proposition déséquilibrée n'est jamais émise. */
  equilibree: true;
  sources: {
    /** Identifiants des lignes d'écriture sources. */
    lignesEcritures: string[];
    ecritures: Array<{ journalCode: string; ecritureNum: string; ecritureDate: string }>;
    pieces: string[];
    /** Clés des constats sources. */
    constats: string[];
    immobilisation: string | null;
  };
  /** Plan d'amortissement année par année (dégressif) ; `null` pour les autres propositions. */
  planAmortissement: LignePlanAmortissement[] | null;
  /** Autres sources de la règle (texte non lu en ligne, articles du PCG…). */
  sourcesComplementaires: SourceRegle[];
  /** Effets si l'écriture était comptabilisée. Positif = augmentation. */
  impacts: { resultat: ChaineDecimale; totalActif: ChaineDecimale; totalPassif: ChaineDecimale; commentaire: string };
  hypotheses: string[];
  /** L'écriture est à contre-passer à l'ouverture de l'exercice suivant (date indiquée), ou `null`. */
  extourneLe: string | null;
  source: SourceRegle;
}

export interface LignePlanAmortissement {
  /** Rang de l'exercice dans le plan (1 = exercice de mise en service). */
  rang: number;
  exerciceFin: string;
  methode: 'degressif' | 'lineaire';
  /** Valeur nette comptable en début d'exercice (montant amortissable pour le rang 1). */
  baseCalcul: ChaineDecimale;
  dotation: ChaineDecimale;
  cumul: ChaineDecimale;
  vnc: ChaineDecimale;
  formule: string;
  /** Vrai pour l'exercice proposé. */
  exerciceCourant: boolean;
}

/** Point à traiter par le professionnel que le moteur signale sans proposer d'écriture. */
export interface SignalementInventaire { code: string; immobilisation: string | null; titre: string; motif: string; source: SourceRegle }

export interface RapprochementDotation {
  /** Compte de dotation (racine) auquel les dotations des immobilisations sont rattachées. */
  compteDotation: string;
  immobilisations: string[];
  /** Somme des dotations calculées par le moteur ; `null` si aucune n'est calculable. */
  dotationCalculee: ChaineDecimale | null;
  /** Vrai si toutes les immobilisations du compte ont une dotation calculée. */
  calculComplet: boolean;
  /** Dotation déjà comptabilisée sur l'exercice (débit − crédit du compte de dotation). */
  dotationComptabilisee: ChaineDecimale;
  /** Comptabilisé − calculé ; `null` si le calcul n'est pas disponible. Jamais corrigé. */
  ecart: ChaineDecimale | null;
  etat: 'aucune_dotation_comptabilisee' | 'identique' | 'differente' | 'non_ventilee' | 'calcul_indisponible';
  propositionsEcartees: boolean;
  message: string;
}
export interface RapprochementCompteImmobilisation {
  compte: string;
  immobilisations: string[];
  valeurBruteSaisie: ChaineDecimale;
  soldeBalance: ChaineDecimale;
  ecart: ChaineDecimale;
  etat: 'concordant' | 'ecart' | 'absent_de_la_balance';
  message: string;
}
export interface CompteSansImmobilisation { compte: string; libelle: string; solde: ChaineDecimale; message: string }
export interface RapprochementImmobilisations {
  dotations: RapprochementDotation[];
  comptes: RapprochementCompteImmobilisation[];
  comptesSansImmobilisation: CompteSansImmobilisation[];
}

export interface AbstentionInventaire {
  type: TypePropositionInventaire | 'cesure';
  code: string;
  motif: string;
  sources: { lignesEcritures: string[]; constat: string | null; immobilisation: string | null };
}

export interface RegleInventaire { id: string; version: string; type: TypePropositionInventaire; description: string; source: SourceRegle }

/** Immobilisation du fichier telle que le moteur l'a suivie : valeur brute retenue et dotation calculée de l'exercice (`null` si le moteur s'est abstenu). Sert aux tableaux 2054, 2055 et 2033-C. */
export interface ImmobilisationSuivie {
  id: string;
  libelle: string;
  mode: ModeAmortissement;
  compteImmobilisation: string | null;
  valeurBrute: ChaineDecimale | null;
  dotationExercice: ChaineDecimale | null;
}

export interface ResultatInventaire {
  statut: 'projet';
  mention: string;
  exercice: { debut: string; fin: string };
  propositions: PropositionEcritureInventaire[];
  abstentions: AbstentionInventaire[];
  regles: RegleInventaire[];
  conventions: string[];
  /** Points à traiter par le professionnel (amortissement dérogatoire éventuel…) : jamais transformés en écriture. */
  signalements: SignalementInventaire[];
  /** Comparaison du fichier des immobilisations saisi avec la comptabilité importée. */
  rapprochement: RapprochementImmobilisations;
  /** Immobilisations suivies par le moteur (une par immobilisation fournie, hors doublons). */
  immobilisationsSuivies: ImmobilisationSuivie[];
  /** Cumul des impacts si TOUTES les propositions étaient retenues (elles ne le sont jamais d'office). */
  totaux: { nbPropositions: number; nbAbstentions: number; impactResultat: ChaineDecimale; impactTotalActif: ChaineDecimale; impactTotalPassif: ChaineDecimale };
}

// ───────────────────────────── Règles ─────────────────────────────

export const REGLES_INVENTAIRE: readonly RegleInventaire[] = Object.freeze([
  { id: 'INV-CCA', version: '1.0.0', type: 'charge_constatee_avance', source: SOURCES_FISCALES.chargesConstateesAvance,
    description: 'Ligne de charge (classe 6, hors 603, 68 et 69) datée dans l’exercice dont la période couverte s’achève après la clôture : débit 486, crédit du compte de charge, pour montant × jours postérieurs à la clôture ÷ jours de la période.' },
  { id: 'INV-PCA', version: '1.0.0', type: 'produit_constate_avance', source: SOURCES_FISCALES.produitsConstatesAvance,
    description: 'Ligne de produit (classe 7, hors 71, 72, 78 et 79) datée dans l’exercice dont la période couverte s’achève après la clôture : débit du compte de produit, crédit 487, même prorata.' },
  { id: 'INV-FNP', version: '1.0.0', type: 'facture_non_parvenue', source: SOURCES_FISCALES.facturesNonParvenues,
    description: 'Écriture passée après la clôture sur une pièce datée dans l’exercice (constat CLO-001), réductible à « charges + TVA déductible + fournisseur » : débit des comptes de charges et du compte 44586, crédit 408 toutes taxes comprises.' },
  { id: 'INV-FAE', version: '1.0.0', type: 'facture_a_etablir', source: SOURCES_FISCALES.facturesAEtablir,
    description: 'Écriture passée après la clôture sur une pièce datée dans l’exercice (constat CLO-001), réductible à « produits + TVA collectée + client » : débit 4181 toutes taxes comprises, crédit des comptes de produits et du compte 44587.' },
  { id: 'INV-AMORT', version: '1.1.0', type: 'dotation_amortissement_lineaire', source: SOURCES_FISCALES.amortissementLineaire,
    description: 'Dotation linéaire = montant amortissable (valeur brute − valeur résiduelle) × jours de l’exercice compris dans le plan ÷ jours du plan, à compter de la mise en service ; débit 6811x, crédit 28x. Uniquement si base, date de mise en service et durée sont fournies ; abstention si une sortie d’actif est saisie ; jamais reproposée si une dotation est déjà comptabilisée.' },
  { id: 'INV-AMORT-DEG', version: '1.1.0', type: 'dotation_amortissement_degressif', source: SOURCES_FISCALES.amortissementDegressif,
    description: 'Dotation dégressive = valeur nette comptable × (taux linéaire × coefficient 1,25 / 1,75 / 2,25 selon la durée), prorata au mois la première année à compter du premier jour du mois d’acquisition, bascule au linéaire (faculté de l’entreprise, appliquée systématiquement) quand la quote-part linéaire du reste à amortir devient supérieure ; calcul NON ACTIVÉ par défaut (abstention) ; débit 6811x, crédit 28x. Uniquement si l’éditeur a activé le calcul, le cabinet a déclaré le mode dégressif et la date d’acquisition, confirmé l’éligibilité (bien neuf, durée d’au moins trois ans, bien visé) et déclaré un coefficient cohérent avec la durée ; durée en années entières, exercices de douze mois.' },
]);

export const CONVENTIONS_INVENTAIRE: readonly string[] = Object.freeze([
  'Charges et produits constatés d’avance : prorata temporis en jours calendaires réels, premier et dernier jours de la période inclus ; part postérieure à la clôture = jours du lendemain de la clôture à la fin de la période.',
  'Amortissement linéaire, convention « base_360 » (défaut) : année de 360 jours, mois de 30 jours (le dernier jour d’un mois compte pour le 30) ; jour de mise en service inclus ; durée du plan = nombre de mois × 30 jours.',
  'Amortissement linéaire, convention « jours_reels » : jours calendaires réels ; le plan s’achève la veille du jour anniversaire de la mise en service, décalé du nombre de mois.',
  'Arrondi au centime, demi-unité éloignée de zéro. Le montant de la ligne d’écriture est pris hors taxes tel qu’il figure au compte de charge ou de produit.',
  'Une période n’est lue dans un libellé que si deux dates complètes (jour, mois, année sur quatre chiffres) y figurent, une seule fois ; sinon abstention.',
  'Amortissement dégressif : durée en années entières (au moins trois), exercices de douze mois du premier au dernier jour d’un mois ; première annuité = valeur à amortir × taux × (mois de l’exercice à compter du mois de la date d’acquisition saisie, mois entamé compté) ÷ 12 ; annuités suivantes = valeur nette comptable × taux ; bascule au linéaire dès que valeur nette ÷ nombre d’exercices restants est supérieure ; dernière annuité = solde, de sorte que la somme des dotations égale exactement le montant amortissable.',
  'Rapprochement : dotation déjà comptabilisée = débit − crédit du compte de dotation (68111 pour les comptes 20, 68112 pour les comptes 21) sur l’exercice ; si elle est non nulle, aucune dotation n’est reproposée pour ce compte et l’écart avec le calcul du moteur est affiché sans être corrigé. Solde d’un compte d’immobilisation = débit − crédit des écritures importées datées au plus tard de la clôture, à nouveaux compris.',
  'Les propositions sont indépendantes : elles ne tiennent pas compte les unes des autres ni des écritures d’inventaire déjà passées (un avertissement signale les comptes déjà mouvementés à la clôture) ; seules les dotations aux amortissements sont rapprochées de la comptabilité importée.',
]);

const regle = (id: string): RegleInventaire => REGLES_INVENTAIRE.find((r) => r.id === id) as RegleInventaire;

// ───────────────────────────── Outils ─────────────────────────────

const m2 = (d: Decimal): ChaineDecimale => versChaine(d, 2);
const arrondi = (d: Decimal): Decimal => new Decimal(versChaine(d, 2));
const estCompte = (c: unknown): c is string => typeof c === 'string' && /^\d{3,12}$/.test(c);
const cleEcriture = (l: LigneEcriture): string => `${l.journalCode}\u0001${l.ecritureNum}\u0001${l.ecritureDate}`;
const lendemain = (iso: string): string => isoDepuisJours(joursDepuisEpoque(iso) + 1);

function dernierJourDuMois(annee: number, mois: number): number {
  return mois === 2 ? (estBissextile(annee) ? 29 : 28) : [4, 6, 9, 11].includes(mois) ? 30 : 31;
}
function decomposer(iso: string): { a: number; m: number; j: number } {
  return { a: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), j: Number(iso.slice(8, 10)) };
}
/** Rang d'un jour dans un calendrier de 360 jours (mois de 30 jours ; le dernier jour d'un mois vaut 30). */
function rang360(iso: string): number {
  const { a, m, j } = decomposer(iso);
  return a * 360 + (m - 1) * 30 + (j >= dernierJourDuMois(a, m) ? 30 : Math.min(j, 30));
}
function ajouterMois(iso: string, mois: number): string {
  const { a, m, j } = decomposer(iso);
  const total = a * 12 + (m - 1) + mois;
  const annee = Math.floor(total / 12);
  const moisCible = (total % 12) + 1;
  return versIso(annee, moisCible, Math.min(j, dernierJourDuMois(annee, moisCible)));
}
const borner = (n: number, max: number): number => Math.max(0, Math.min(max, n));

const MOTIF_DATE = String.raw`(\d{1,2})[/.](\d{1,2})[/.](\d{4})`;
const PERIODE_COMPLETE = new RegExp(String.raw`(?<!\d)${MOTIF_DATE}\s*(?:au|à|a|-|–|—|>|→)\s*${MOTIF_DATE}(?!\d)`, 'giu');
const PERIODE_ANNEE_COURTE = /(?<!\d)\d{1,2}[/.]\d{1,2}[/.]\d{2}\s*(?:au|à|a|-|–|—|>|→)\s*\d{1,2}[/.]\d{1,2}[/.]\d{2}(?!\d)/iu;

type LecturePeriode = { etat: 'aucune' } | { etat: 'lue'; debut: string; fin: string; extrait: string } | { etat: 'illisible'; motif: string };

/** Lit une période « JJ/MM/AAAA au JJ/MM/AAAA » dans un libellé. N'interprète rien d'autre ; ambigu ou incomplet → `illisible`. */
export function lirePeriodeDansLibelle(libelle: string): LecturePeriode {
  if (typeof libelle !== 'string' || libelle.length > 500) return { etat: 'aucune' };
  const trouvees = [...libelle.matchAll(PERIODE_COMPLETE)];
  if (trouvees.length === 0) {
    return PERIODE_ANNEE_COURTE.test(libelle) ? { etat: 'illisible', motif: 'le libellé porte une période dont les années sont sur deux chiffres : elle n’est pas interprétée' } : { etat: 'aucune' };
  }
  if (trouvees.length > 1) return { etat: 'illisible', motif: 'le libellé porte plusieurs périodes : aucune n’est retenue' };
  const t = trouvees[0] as RegExpMatchArray;
  const n = (i: number): number => Number(t[i]);
  if (!dateCivileValide(n(3), n(2), n(1)) || !dateCivileValide(n(6), n(5), n(4))) return { etat: 'illisible', motif: 'le libellé porte une période dont une date n’existe pas' };
  const debut = versIso(n(3), n(2), n(1));
  const fin = versIso(n(6), n(5), n(4));
  if (fin < debut) return { etat: 'illisible', motif: 'le libellé porte une période dont la fin précède le début' };
  return { etat: 'lue', debut, fin, extrait: t[0] };
}

interface Brouillon {
  id: string;
  type: TypePropositionInventaire;
  libelle: string;
  regleId: string;
  signal: string;
  justification: string;
  calcul: Array<{ libelle: string; valeur: string }>;
  lignes: Array<{ compteNum: string; libelle: string; debit: Decimal; credit: Decimal }>;
  lignesSources: readonly LigneEcriture[];
  constats: string[];
  immobilisation: string | null;
  impacts: { resultat: Decimal; totalActif: Decimal; totalPassif: Decimal; commentaire: string };
  hypotheses: string[];
  extourne: boolean;
  plan?: LignePlanAmortissement[];
  complementaires?: SourceRegle[];
}

// ───────────────────────────── Amortissement dégressif ─────────────────────────────

const ONE = new Decimal(1);

interface LigneDegressive { rang: number; exerciceFin: string; methode: 'degressif' | 'lineaire'; baseCalcul: Decimal; dotation: Decimal; cumul: Decimal; vnc: Decimal; formule: string }
type PlanDegressif =
  | { code: string; motif: string }
  | { lignes: LigneDegressive[]; rangCourant: number; nbAnnees: number; coefficient: Decimal; taux: Decimal; moisPremiereAnnee: number };

const finDeMois = (a: number, m: number): string => versIso(a, m, dernierJourDuMois(a, m));

/**
 * Plan dégressif complet (BOFiP BOI-BIC-AMT-20-20-30) : taux = (100 ÷ durée en années) × coefficient ; première annuité au prorata des mois
 * (mois d'acquisition compris, à compter du premier jour de ce mois : § 190 à 200) ; annuités suivantes sur la valeur nette comptable ; bascule au linéaire quand valeur nette ÷ exercices restants
 * dépasse l'annuité dégressive ; dernière annuité = solde. Chaque annuité est arrondie au centime, le solde absorbe l'arrondi : la somme des
 * dotations égale EXACTEMENT le montant amortissable. Renvoie un code d'abstention si une condition déclarée n'est pas remplie.
 */
function calculerPlanDegressif(p: { base: Decimal; acquisition: string; dureeMois: number; coefficient: string | null | undefined; eligible: boolean | null | undefined; compteImmo: string; debut: string; fin: string }): PlanDegressif {
  if (p.eligible !== true) {
    return p.eligible === false
      ? { code: 'conditions_degressif_non_remplies', motif: 'le cabinet a déclaré que le bien ne remplit pas les conditions du dégressif (bien neuf, durée d’au moins trois ans, bien visé par l’art. 39 A du CGI, hors exclusions) : aucune dotation dégressive n’est proposée.' }
      : { code: 'eligibilite_degressif_non_confirmee', motif: 'mode dégressif déclaré mais éligibilité non confirmée par le cabinet (bien neuf, durée d’au moins trois ans, bien visé par l’art. 39 A du CGI, hors exclusions) : le moteur ne la devine pas, aucune dotation n’est proposée.' };
  }
  if (!p.compteImmo.startsWith('21')) return { code: 'bien_non_eligible', motif: `le dégressif ne vise que des biens corporels (matériels, outillages, installations, certains immeubles : comptes de la classe 21) ; le compte ${p.compteImmo} n’en est pas un : aucune dotation dégressive n’est proposée.` };
  if (p.dureeMois % 12 !== 0) return { code: 'duree_non_annuelle', motif: `durée de ${p.dureeMois} mois : le plan dégressif raisonne en années entières, la durée doit être un multiple de 12 mois.` };
  const n = p.dureeMois / 12;
  if (n < 3) return { code: 'duree_inferieure_trois_ans', motif: `durée de ${n} an(s) : les biens dont la durée normale d’utilisation est inférieure à trois ans sont exclus du dégressif (BOFiP BOI-BIC-AMT-20-10 § 90).` };
  if (n > 50) return { code: 'duree_hors_perimetre', motif: `durée de ${n} ans : au-delà de 50 ans, le plan dégressif n’est pas calculé.` };
  const attendu = n <= 4 ? '1.25' : n <= 6 ? '1.75' : '2.25';
  if (p.coefficient === null || p.coefficient === undefined) return { code: 'coefficient_manquant', motif: `coefficient dégressif non déclaré (${attendu} attendu pour une durée de ${n} ans) : le moteur ne le choisit pas à la place du cabinet.` };
  if (!estChaineDecimale(p.coefficient) || !new Decimal(p.coefficient).equals(attendu)) return { code: 'coefficient_incoherent', motif: `coefficient déclaré « ${p.coefficient} » différent de la règle générale pour une durée de ${n} ans (${attendu} attendu : 1,25 pour 3 ou 4 ans, 1,75 pour 5 ou 6 ans, 2,25 au-delà de 6 ans). Les coefficients majorés ou diminués de certains biens d’équipement (BOFiP BOI-BIC-AMT-20-20-50, non analysé) ne sont pas gérés : aucune dotation n’est proposée.` };
  const d = decomposer(p.debut);
  const f = decomposer(p.fin);
  if (d.j !== 1 || f.j !== dernierJourDuMois(f.a, f.m) || f.a * 12 + f.m - (d.a * 12 + d.m) !== 11) return { code: 'exercice_non_annuel', motif: 'l’exercice n’est pas un exercice de douze mois courant du premier jour au dernier jour de mois : l’ajustement de la durée de l’exercice (BOFiP BOI-BIC-AMT-20-20-30 § 280 à 300) n’est pas modélisé.' };
  const coefficient = new Decimal(p.coefficient);
  const taux = coefficient.dividedBy(n);
  const m = decomposer(p.acquisition);
  const moisMes = m.a * 12 + m.m - 1;
  const moisDebut = d.a * 12 + d.m - 1;
  const decalage = Math.floor((moisMes - moisDebut) / 12);
  const rangCourant = 1 - decalage;
  const debutPremier = moisDebut + 12 * decalage;
  const moisPremiereAnnee = debutPremier + 11 - moisMes + 1;
  if (rangCourant > n) return { code: 'plan_acheve', motif: `le plan dégressif de ${n} ans est achevé avant l’ouverture de l’exercice (rang ${rangCourant}) : aucune dotation.` };
  const lignes: LigneDegressive[] = [];
  let vnc = p.base;
  let cumul = ZERO;
  let fixe: Decimal | null = null;
  const pct = taux.times(100).toDecimalPlaces(4).toString();
  for (let rang = 1; rang <= n; rang++) {
    const baseCalcul = vnc;
    let dotation: Decimal;
    let methode: 'degressif' | 'lineaire' = 'degressif';
    let formule: string;
    const restants = n - rang + 1;
    if (rang === 1) {
      dotation = arrondi(p.base.times(taux).times(moisPremiereAnnee).dividedBy(12));
      formule = `${m2(p.base)} × ${pct} % × ${moisPremiereAnnee} ÷ 12`;
    } else if (rang === n) {
      dotation = vnc;
      methode = 'lineaire';
      formule = `solde du plan : ${m2(vnc)}`;
    } else if (fixe !== null) {
      dotation = fixe;
      methode = 'lineaire';
      formule = `annuité linéaire constante ${m2(fixe)}`;
    } else if (vnc.times(taux).lessThan(vnc.dividedBy(restants))) {
      fixe = arrondi(vnc.dividedBy(restants));
      dotation = fixe;
      methode = 'lineaire';
      formule = `${m2(vnc)} ÷ ${restants} (bascule au linéaire)`;
    } else {
      dotation = arrondi(vnc.times(taux));
      formule = `${m2(vnc)} × ${pct} %`;
    }
    if (dotation.greaterThan(vnc)) dotation = vnc;
    cumul = cumul.plus(dotation);
    vnc = vnc.minus(dotation);
    const idx = debutPremier + 12 * (rang - 1) + 11;
    lignes.push({ rang, exerciceFin: finDeMois(Math.floor(idx / 12), (idx % 12) + 1), methode, baseCalcul, dotation, cumul, vnc, formule });
  }
  return { lignes, rangCourant, nbAnnees: n, coefficient, taux, moisPremiereAnnee };
}

// ───────────────────────────── Rapprochement avec la comptabilité importée ─────────────────────────────

interface Suivi { id: string; libelle: string; mode: ModeAmortissement; compteImmo: string | null; compteDotation: string | null; brute: Decimal | null; dotation: Decimal | null; brouillon: Brouillon | null }

/** Racine d'un numéro de compte : zéros de remplissage finaux retirés, trois chiffres au moins. */
function racineCompte(c: string): string {
  let r = c;
  while (r.length > 3 && r.endsWith('0')) r = r.slice(0, -1);
  return r;
}

const SANS_AMORTISSEMENT = ['206', '207', '211'];

function rapprocherImmobilisations(p: { lignes: readonly LigneEcriture[]; debut: string; fin: string; suivis: readonly Suivi[] }): RapprochementImmobilisations {
  const { lignes, debut, fin, suivis } = p;
  const solde = (racine: string, depuis: string | null): Decimal =>
    lignes.reduce((s, l) => (l.compteNum.startsWith(racine) && l.ecritureDate <= fin && (depuis === null || l.ecritureDate >= depuis) ? s.plus(new Decimal(l.debit)).minus(new Decimal(l.credit)) : s), ZERO);

  // Dotations : regroupées par compte de dotation, car plusieurs immobilisations alimentent le même compte.
  const parDotation = new Map<string, Suivi[]>();
  for (const s of suivis) {
    if (s.compteDotation === null) continue;
    const r = racineCompte(s.compteDotation);
    parDotation.set(r, [...(parDotation.get(r) ?? []), s]);
  }
  const dotations: RapprochementDotation[] = [];
  for (const [racine, groupe] of [...parDotation.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const calcules = groupe.filter((s) => s.dotation !== null);
    const calculComplet = calcules.length === groupe.length;
    const calculee = calcules.length === 0 ? null : calcules.reduce((t, s) => t.plus(s.dotation as Decimal), ZERO);
    const comptabilisee = solde(racine, debut);
    const generique = racine.length >= 5 && racine.startsWith('6811')
      ? lignes.reduce((s, l) => (l.compteNum.startsWith('6811') && !l.compteNum.startsWith('68111') && !l.compteNum.startsWith('68112') && l.ecritureDate >= debut && l.ecritureDate <= fin ? s.plus(new Decimal(l.debit)).minus(new Decimal(l.credit)) : s), ZERO)
      : ZERO;
    const ids = groupe.map((s) => s.id);
    let etat: RapprochementDotation['etat'];
    let message: string;
    let ecartees = true;
    let ecart: Decimal | null = null;
    if (comptabilisee.isZero() && generique.isZero()) {
      etat = 'aucune_dotation_comptabilisee';
      ecartees = false;
      message = `Aucune dotation n’est comptabilisée sur l’exercice au compte ${racine} : les dotations calculées${calculee === null ? ' (aucune n’est calculable)' : ` (${m2(calculee)})`} peuvent être proposées.`;
    } else if (comptabilisee.isZero()) {
      etat = 'non_ventilee';
      message = `Une dotation de ${m2(generique)} est comptabilisée sur l’exercice à un compte 6811 non ventilé entre immobilisations incorporelles (68111) et corporelles (68112) : elle ne peut pas être rapprochée du calcul (${calculee === null ? 'non disponible' : m2(calculee)}) et une nouvelle dotation risquerait de la doubler.`;
    } else if (calculee === null) {
      etat = 'calcul_indisponible';
      message = `Une dotation de ${m2(comptabilisee)} est déjà comptabilisée sur l’exercice au compte ${racine} ; le moteur ne peut calculer aucune dotation pour ces immobilisations (données manquantes ou abstention) : aucun écart n’est calculable.`;
    } else {
      ecart = comptabilisee.minus(calculee);
      if (ecart.isZero() && calculComplet) {
        etat = 'identique';
        message = `Une dotation de ${m2(comptabilisee)} est déjà comptabilisée sur l’exercice au compte ${racine}, identique au calcul du moteur (${m2(calculee)}).`;
      } else {
        etat = 'differente';
        message = `Une dotation de ${m2(comptabilisee)} est déjà comptabilisée sur l’exercice au compte ${racine} ; le moteur calcule ${m2(calculee)}${calculComplet ? '' : ' (calcul incomplet : certaines immobilisations du compte n’ont pas de dotation calculable)'} : écart de ${m2(ecart)} (comptabilisé − calculé), à analyser par le professionnel.`;
      }
    }
    dotations.push({ compteDotation: racine, immobilisations: ids, dotationCalculee: calculee === null ? null : m2(calculee), calculComplet, dotationComptabilisee: m2(comptabilisee), ecart: ecart === null ? null : m2(ecart), etat, propositionsEcartees: ecartees, message });
  }

  // Comptes d'immobilisation : valeur brute saisie rapprochée du solde de la balance.
  const parCompte = new Map<string, Suivi[]>();
  for (const s of suivis) {
    if (s.compteImmo === null) continue;
    const r = racineCompte(s.compteImmo);
    parCompte.set(r, [...(parCompte.get(r) ?? []), s]);
  }
  const comptes: RapprochementCompteImmobilisation[] = [];
  for (const [racine, groupe] of [...parCompte.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const brute = groupe.reduce((t, s) => t.plus(s.brute ?? ZERO), ZERO);
    const soldeBalance = solde(racine, null);
    const ecart = soldeBalance.minus(brute);
    let etat: RapprochementCompteImmobilisation['etat'];
    let message: string;
    if (soldeBalance.lessThanOrEqualTo(0)) {
      etat = 'absent_de_la_balance';
      message = `Le compte ${racine} n’a aucun solde débiteur dans la balance importée alors que ${m2(brute)} d’immobilisation(s) sont saisis : immobilisation(s) du fichier absente(s) de la comptabilité (ou compte différent).`;
    } else if (ecart.isZero()) {
      etat = 'concordant';
      message = `Solde du compte ${racine} (${m2(soldeBalance)}) égal à la valeur brute saisie.`;
    } else {
      etat = 'ecart';
      message = `Solde du compte ${racine} : ${m2(soldeBalance)} ; valeur brute saisie : ${m2(brute)} ; écart de ${m2(ecart)} (balance − saisie) : immobilisations non saisies, sorties ou erreur de saisie, à analyser.`;
    }
    comptes.push({ compte: racine, immobilisations: groupe.map((s) => s.id), valeurBruteSaisie: m2(brute), soldeBalance: m2(soldeBalance), ecart: m2(ecart), etat, message });
  }

  // Comptes 20x et 21x de la balance sans aucune immobilisation saisie.
  const racinesSaisies = [...parCompte.keys()];
  const soldes = new Map<string, { solde: Decimal; libelle: string }>();
  for (const l of lignes) {
    if (!(l.compteNum.startsWith('20') || l.compteNum.startsWith('21')) || l.ecritureDate > fin) continue;
    const courant = soldes.get(l.compteNum) ?? { solde: ZERO, libelle: l.compteLib };
    soldes.set(l.compteNum, { solde: courant.solde.plus(new Decimal(l.debit)).minus(new Decimal(l.credit)), libelle: courant.libelle || l.compteLib });
  }
  const comptesSansImmobilisation: CompteSansImmobilisation[] = [];
  for (const [compte, v] of [...soldes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (v.solde.lessThanOrEqualTo(0) || SANS_AMORTISSEMENT.some((x) => compte.startsWith(x))) continue;
    if (racinesSaisies.some((r) => compte.startsWith(r) || r.startsWith(compte))) continue;
    comptesSansImmobilisation.push({ compte, libelle: v.libelle, solde: m2(v.solde), message: `Le compte ${compte} présente un solde de ${m2(v.solde)} dans la balance sans immobilisation saisie : à saisir pour calculer sa dotation (ou à écarter si le bien n’est pas amortissable).` });
    if (comptesSansImmobilisation.length >= 200) break;
  }
  return { dotations, comptes, comptesSansImmobilisation };
}

// ───────────────────────────── Calcul ─────────────────────────────

/**
 * Propose des écritures d'inventaire à partir des écritures et des données fournies. Ne comptabilise rien.
 * Lève une erreur si l'exercice est invalide ; tout le reste (donnée manquante, cas ambigu) est une abstention motivée.
 */
export function proposerEcrituresInventaire(demande: DemandeInventaire): ResultatInventaire {
  const { debut, fin } = demande.exercice;
  if (!estDateIso(debut) || !estDateIso(fin) || fin < debut) throw new Error('Exercice invalide : dates ISO AAAA-MM-JJ attendues, clôture postérieure ou égale à l’ouverture.');
  const lignes = demande.lignes;
  const parId = new Map(lignes.map((l) => [l.id, l]));
  const dansExercice = (d: string): boolean => d >= debut && d <= fin;
  const ouvertureSuivante = lendemain(fin);
  const brouillons: Brouillon[] = [];
  const abstentions: AbstentionInventaire[] = [];
  const sAbstenir = (type: AbstentionInventaire['type'], code: string, motif: string, sources: Partial<AbstentionInventaire['sources']> = {}): void => {
    abstentions.push({ type, code, motif, sources: { lignesEcritures: sources.lignesEcritures ?? [], constat: sources.constat ?? null, immobilisation: sources.immobilisation ?? null } });
  };

  // Comptes de régularisation : option explicite, sinon compte déjà utilisé dans les écritures, sinon racine complétée de zéros.
  const comptesUtilises = [...new Set(lignes.map((l) => l.compteNum))].sort();
  const cles: Record<keyof ComptesInventaire, string> = { chargesConstateesAvance: '486', produitsConstatesAvance: '487', facturesNonParvenues: '408', tvaSurFacturesNonParvenues: '44586', facturesAEtablir: '4181', tvaSurFacturesAEtablir: '44587' };
  const compteDe = (cle: keyof ComptesInventaire, modele: string): { compte: string; hypothese: string } => {
    const racine = cles[cle];
    const impose = demande.options?.comptes?.[cle];
    if (impose !== undefined) {
      if (!estCompte(impose)) throw new Error(`Option « comptes.${cle} » invalide : numéro de compte de 3 à 12 chiffres attendu.`);
      return { compte: impose, hypothese: `Compte ${impose} fourni par le cabinet.` };
    }
    const existants = comptesUtilises.filter((c) => c.startsWith(racine));
    if (existants.length === 1) return { compte: existants[0] as string, hypothese: `Compte ${existants[0]} repris des écritures du dossier.` };
    if (existants.length > 1) return { compte: existants[0] as string, hypothese: `Plusieurs comptes ${racine} existent dans le dossier (${existants.slice(0, 5).join(', ')}) : le premier par ordre de numéro est proposé, à confirmer.` };
    const compte = racine.padEnd(Math.max(racine.length, modele.length), '0');
    return { compte, hypothese: `Aucun compte ${racine} dans les écritures : le compte ${compte} est construit à partir de la racine du plan de comptes, à adapter au plan du dossier.` };
  };
  const dejaMouvemente = (racine: string): string[] =>
    lignes.some((l) => l.compteNum.startsWith(racine) && l.ecritureDate === fin) ? [`Le compte ${racine} est déjà mouvementé à la date de clôture : vérifier que la régularisation n’a pas déjà été passée (risque de doublon).`] : [];

  // ── 1. Charges et produits constatés d'avance ──────────────────────────────────────────────
  const periodes = new Map<string, PeriodeCouverte>();
  const periodesEnDouble = new Set<string>();
  for (const p of demande.periodesCouvertes ?? []) {
    if (periodes.has(p.ligneId)) periodesEnDouble.add(p.ligneId);
    else periodes.set(p.ligneId, p);
  }
  for (const ligneId of periodesEnDouble) {
    periodes.delete(ligneId);
    sAbstenir('charge_constatee_avance', 'periode_en_double', `Plusieurs périodes fournies pour la ligne ${ligneId} : aucune n’est retenue.`, { lignesEcritures: [ligneId] });
  }
  for (const ligneId of periodes.keys()) {
    if (!parId.has(ligneId)) sAbstenir('charge_constatee_avance', 'ligne_introuvable', `Période fournie pour la ligne ${ligneId}, absente des écritures.`, { lignesEcritures: [ligneId] });
  }
  const EXCLUS_CHARGES = ['603', '68', '69'];
  const EXCLUS_PRODUITS = ['71', '72', '78', '79'];
  const lireLibelles = demande.lireLibelles ?? true;
  for (const l of lignes) {
    const charge = l.compteNum.startsWith('6');
    const produit = l.compteNum.startsWith('7');
    const fournie = periodes.get(l.id);
    if (periodesEnDouble.has(l.id)) continue;
    const type: TypePropositionInventaire = produit ? 'produit_constate_avance' : 'charge_constatee_avance';
    const src = { lignesEcritures: [l.id] };
    if (!charge && !produit) {
      if (fournie !== undefined) sAbstenir(type, 'compte_hors_perimetre', `Période fournie pour la ligne ${l.id} au compte ${l.compteNum}, qui n’est ni un compte de charges ni un compte de produits.`, src);
      continue;
    }
    if (!dansExercice(l.ecritureDate)) {
      if (fournie !== undefined) sAbstenir(type, 'ecriture_hors_exercice', `Période fournie pour la ligne ${l.id}, datée du ${l.ecritureDate}, hors de l’exercice.`, src);
      continue;
    }
    let periode: { debut: string; fin: string } | null = null;
    let signal: string;
    if (fournie !== undefined) {
      if (!estDateIso(fournie.fin) || (fournie.debut !== undefined && fournie.debut !== null && !estDateIso(fournie.debut))) { sAbstenir(type, 'periode_invalide', `Période fournie pour la ligne ${l.id} invalide : dates ISO AAAA-MM-JJ attendues.`, src); continue; }
      if (fournie.fin <= fin) { sAbstenir(type, 'periode_dans_exercice', `La période fournie pour la ligne ${l.id} s’achève le ${fournie.fin}, au plus tard à la clôture : aucune régularisation.`, src); continue; }
      if (fournie.debut === undefined || fournie.debut === null) { sAbstenir(type, 'debut_de_periode_manquant', `La période fournie pour la ligne ${l.id} s’achève le ${fournie.fin}, après la clôture, mais son premier jour n’est pas fourni : prorata non calculable.`, src); continue; }
      if (fournie.fin < fournie.debut) { sAbstenir(type, 'periode_invalide', `Période fournie pour la ligne ${l.id} invalide : la fin précède le début.`, src); continue; }
      periode = { debut: fournie.debut, fin: fournie.fin };
      signal = `Période couverte du ${periode.debut} au ${periode.fin} fournie par le cabinet.`;
    } else {
      if (!lireLibelles) continue;
      const lecture = lirePeriodeDansLibelle(l.ecritureLib);
      if (lecture.etat === 'aucune') continue;
      if (lecture.etat === 'illisible') { sAbstenir(type, 'periode_illisible', `Ligne ${l.id} (${l.journalCode} ${l.ecritureNum}, compte ${l.compteNum}) : ${lecture.motif}. Fournir la période couverte pour obtenir une proposition.`, src); continue; }
      if (lecture.fin <= fin) continue;
      periode = { debut: lecture.debut, fin: lecture.fin };
      signal = `Période « ${lecture.extrait} » lue dans le libellé de l’écriture.`;
    }
    if ((charge ? EXCLUS_CHARGES : EXCLUS_PRODUITS).some((p) => l.compteNum.startsWith(p))) { sAbstenir(type, 'compte_exclu', `Ligne ${l.id} : le compte ${l.compteNum} (variation de stocks, dotations, reprises, production stockée ou immobilisée, impôts sur les bénéfices) n’est pas régularisé par cette règle.`, src); continue; }
    const net = charge ? debitDe(l).minus(creditDe(l)) : creditDe(l).minus(debitDe(l));
    if (!net.isPositive() || net.isZero()) { sAbstenir(type, 'sens_inverse', `Ligne ${l.id} : le compte ${l.compteNum} est mouvementé en sens inverse (avoir, annulation ou montant nul) : non traité.`, src); continue; }
    const joursPeriode = ecartEnJours(periode.debut, periode.fin) + 1;
    const debutApres = periode.debut > ouvertureSuivante ? periode.debut : ouvertureSuivante;
    const joursApres = ecartEnJours(debutApres, periode.fin) + 1;
    const montant = arrondi(net.times(joursApres).dividedBy(joursPeriode));
    if (montant.isZero()) { sAbstenir(type, 'montant_nul', `Ligne ${l.id} : la part postérieure à la clôture est nulle après arrondi.`, src); continue; }
    const cr = compteDe(charge ? 'chargesConstateesAvance' : 'produitsConstatesAvance', l.compteNum);
    const hypotheses = [
      signal.startsWith('Période «') ? 'La période est lue dans un libellé d’écriture, contenu non fiable : à rapprocher de la pièce.' : 'La période couverte est celle fournie par le cabinet.',
      'La charge ou le produit est réputé acquis uniformément sur la période (prorata en jours calendaires réels, bornes incluses).',
      'Le montant de la ligne est réputé hors taxes et porter sur la seule période indiquée.',
      ...(periode.debut < debut ? [`La période commence le ${periode.debut}, avant l’ouverture de l’exercice : la part antérieure n’est pas examinée.`] : []),
      cr.hypothese,
      ...dejaMouvemente(charge ? '486' : '487'),
    ];
    const calcul = [
      { libelle: 'Montant de la ligne (hors taxes)', valeur: m2(net) },
      { libelle: 'Période couverte', valeur: `${periode.debut} au ${periode.fin}` },
      { libelle: 'Jours de la période (bornes incluses)', valeur: String(joursPeriode) },
      { libelle: 'Jours postérieurs à la clôture', valeur: `${joursApres} (du ${debutApres} au ${periode.fin})` },
      { libelle: 'Formule', valeur: `${m2(net)} × ${joursApres} ÷ ${joursPeriode}` },
      { libelle: charge ? 'Charge constatée d’avance' : 'Produit constaté d’avance', valeur: m2(montant) },
    ];
    const piece = l.pieceRef === '' ? `${l.journalCode} ${l.ecritureNum}` : l.pieceRef;
    brouillons.push(charge
      ? {
        id: `INV-CCA|${l.id}`, type, regleId: 'INV-CCA', signal, libelle: `Charge constatée d’avance - pièce ${piece} - ${joursApres}/${joursPeriode} jours`,
        justification: `La charge enregistrée au compte ${l.compteNum} le ${l.ecritureDate} couvre une période qui s’achève le ${periode.fin}, après la clôture du ${fin} : la part correspondant à une fourniture ou une prestation postérieure à la clôture est une charge constatée d’avance (PCG art. 211-8 et 1214-48).`,
        calcul, lignesSources: [l], constats: [], immobilisation: null, hypotheses, extourne: true,
        lignes: [{ compteNum: cr.compte, libelle: 'Charges constatées d’avance', debit: montant, credit: ZERO }, { compteNum: l.compteNum, libelle: l.compteLib, debit: ZERO, credit: montant }],
        impacts: { resultat: montant, totalActif: montant, totalPassif: montant, commentaire: 'Diminue les charges de l’exercice ; augmente l’actif (charges constatées d’avance) et, par le résultat, le passif.' },
      }
      : {
        id: `INV-PCA|${l.id}`, type, regleId: 'INV-PCA', signal, libelle: `Produit constaté d’avance - pièce ${piece} - ${joursApres}/${joursPeriode} jours`,
        justification: `Le produit enregistré au compte ${l.compteNum} le ${l.ecritureDate} couvre une période qui s’achève le ${periode.fin}, après la clôture du ${fin} : la part correspondant à une prestation ou une fourniture non encore effectuée à la clôture est un produit constaté d’avance (PCG art. 1214-48).`,
        calcul, lignesSources: [l], constats: [], immobilisation: null, hypotheses, extourne: true,
        lignes: [{ compteNum: l.compteNum, libelle: l.compteLib, debit: montant, credit: ZERO }, { compteNum: cr.compte, libelle: 'Produits constatés d’avance', debit: ZERO, credit: montant }],
        impacts: { resultat: montant.negated(), totalActif: ZERO, totalPassif: ZERO, commentaire: 'Diminue les produits de l’exercice ; le passif augmente des produits constatés d’avance et diminue d’autant par le résultat (total du bilan inchangé).' },
      });
  }

  // ── 2. Factures non parvenues et factures à établir, à partir des constats de césure ─────────
  const parEcriture = new Map<string, LigneEcriture[]>();
  for (const l of lignes) { const k = cleEcriture(l); const g = parEcriture.get(k); if (g === undefined) parEcriture.set(k, [l]); else g.push(l); }
  const ecrituresTraitees = new Set<string>();
  for (const constat of demande.constatsCesure ?? []) {
    if (!constat.cle.startsWith('CLO-001|')) continue;
    const src = { constat: constat.cle, lignesEcritures: [...constat.lignesConcernees] };
    const concernees = constat.lignesConcernees.map((id) => parId.get(id)).filter((l): l is LigneEcriture => l !== undefined);
    if (concernees.length === 0) { sAbstenir('cesure', 'lignes_introuvables', `Constat ${constat.cle} : aucune des lignes concernées n’est dans les écritures fournies.`, src); continue; }
    const premiere = concernees[0] as LigneEcriture;
    const cle = cleEcriture(premiere);
    if (concernees.some((l) => cleEcriture(l) !== cle)) { sAbstenir('cesure', 'constat_sur_plusieurs_ecritures', `Constat ${constat.cle} : les lignes concernées relèvent de plusieurs écritures.`, src); continue; }
    if (ecrituresTraitees.has(cle)) continue;
    ecrituresTraitees.add(cle);
    const piece = premiere.pieceDate;
    const mention = `Écriture ${premiere.journalCode} ${premiere.ecritureNum} du ${premiere.ecritureDate}`;
    if (piece === null) { sAbstenir('cesure', 'date_de_piece_absente', `${mention} : date de pièce absente.`, src); continue; }
    if (dansExercice(premiere.ecritureDate)) {
      sAbstenir('cesure', piece > fin ? 'piece_posterieure_a_la_cloture' : 'piece_anterieure_a_l_ouverture',
        piece > fin
          ? `${mention}, comptabilisée dans l’exercice sur une pièce du ${piece} postérieure à la clôture : une charge ou un produit constaté d’avance est possible, mais la période couverte n’est pas connue. Fournir la période couverte de la ligne pour obtenir une proposition.`
          : `${mention}, comptabilisée dans l’exercice sur une pièce du ${piece} antérieure à l’ouverture : charge ou produit d’un exercice antérieur, aucune écriture d’inventaire de la clôture ne s’en déduit.`, src);
      continue;
    }
    if (premiere.ecritureDate < debut || !dansExercice(piece)) { sAbstenir('cesure', 'cas_non_traite', `${mention} sur une pièce du ${piece} : situation hors des cas traités (écriture postérieure à la clôture sur une pièce datée dans l’exercice).`, src); continue; }
    const ecriture = parEcriture.get(cle) ?? [];
    const idsEcriture = ecriture.map((l) => l.id);
    const srcEcriture = { constat: constat.cle, lignesEcritures: idsEcriture };
    const solde = (ls: readonly LigneEcriture[]): Decimal => ls.reduce((s, l) => s.plus(debitDe(l)).minus(creditDe(l)), ZERO);
    if (!solde(ecriture).isZero()) { sAbstenir('cesure', 'ecriture_desequilibree', `${mention} : écriture d’origine non équilibrée dans les données fournies.`, srcEcriture); continue; }
    const de = (f: (c: string) => boolean): LigneEcriture[] => ecriture.filter((l) => f(l.compteNum));
    const charges = de((c) => c.startsWith('6'));
    const produits = de((c) => c.startsWith('7'));
    const tvaDeductible = de((c) => c.startsWith('4456'));
    const tvaCollectee = de((c) => c.startsWith('4457'));
    const fournisseurs = de((c) => c.startsWith('40') && !c.startsWith('404') && !c.startsWith('405'));
    const clients = de((c) => c.startsWith('41'));
    const reconnues = new Set([...charges, ...produits, ...tvaDeductible, ...tvaCollectee, ...fournisseurs, ...clients]);
    const autres = ecriture.filter((l) => !reconnues.has(l));
    const estAchat = charges.length > 0 && produits.length === 0 && tvaCollectee.length === 0 && clients.length === 0 && fournisseurs.length > 0 && autres.length === 0;
    const estVente = produits.length > 0 && charges.length === 0 && tvaDeductible.length === 0 && fournisseurs.length === 0 && clients.length > 0 && autres.length === 0;
    if (!estAchat && !estVente) {
      sAbstenir('cesure', 'ecriture_non_reductible', `${mention} : l’écriture ne se réduit ni à « charges + TVA déductible + fournisseur » ni à « produits + TVA collectée + client » (comptes : ${[...new Set(ecriture.map((l) => l.compteNum))].sort().slice(0, 12).join(', ')}).`, srcEcriture);
      continue;
    }
    const type: TypePropositionInventaire = estAchat ? 'facture_non_parvenue' : 'facture_a_etablir';
    // Montants par compte, dans le sens naturel (charges et TVA déductible au débit ; produits et TVA collectée au crédit).
    const sens = estAchat ? 1 : -1;
    const parCompte = new Map<string, { lib: string; montant: Decimal }>();
    for (const l of estAchat ? charges : produits) {
      const c = parCompte.get(l.compteNum) ?? { lib: l.compteLib, montant: ZERO };
      c.montant = c.montant.plus(debitDe(l).minus(creditDe(l)).times(sens));
      parCompte.set(l.compteNum, c);
    }
    const tva = solde(estAchat ? tvaDeductible : tvaCollectee).times(sens);
    const horsTaxes = [...parCompte.values()].reduce((s, c) => s.plus(c.montant), ZERO);
    if ([...parCompte.values()].some((c) => c.montant.lessThan(0) || c.montant.isZero()) || tva.lessThan(0)) {
      sAbstenir(type, 'sens_inverse', `${mention} : un compte de ${estAchat ? 'charges' : 'produits'} ou de TVA est mouvementé en sens inverse (avoir ou annulation) : non traité.`, srcEcriture);
      continue;
    }
    const ttc = horsTaxes.plus(tva);
    const modele = (estAchat ? fournisseurs : clients)[0]?.compteNum ?? premiere.compteNum;
    const tiers = compteDe(estAchat ? 'facturesNonParvenues' : 'facturesAEtablir', modele);
    const compteTva = tva.isZero() ? null : compteDe(estAchat ? 'tvaSurFacturesNonParvenues' : 'tvaSurFacturesAEtablir', modele);
    const detail = [...parCompte.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([compteNum, c]) => ({ compteNum, libelle: c.lib, montant: c.montant }));
    const lignesProposees: Brouillon['lignes'] = estAchat
      ? [...detail.map((d) => ({ compteNum: d.compteNum, libelle: d.libelle, debit: d.montant, credit: ZERO })),
        ...(compteTva === null ? [] : [{ compteNum: compteTva.compte, libelle: 'Taxes sur le chiffre d’affaires sur factures non parvenues', debit: tva, credit: ZERO }]),
        { compteNum: tiers.compte, libelle: 'Fournisseurs - Factures non parvenues', debit: ZERO, credit: ttc }]
      : [{ compteNum: tiers.compte, libelle: 'Clients - Factures à établir', debit: ttc, credit: ZERO },
        ...detail.map((d) => ({ compteNum: d.compteNum, libelle: d.libelle, debit: ZERO, credit: d.montant })),
        ...(compteTva === null ? [] : [{ compteNum: compteTva.compte, libelle: 'Taxes sur le chiffre d’affaires sur factures à établir', debit: ZERO, credit: tva }])];
    const pieceRef = premiere.pieceRef === '' ? `${premiere.journalCode} ${premiere.ecritureNum}` : premiere.pieceRef;
    brouillons.push({
      id: `${estAchat ? 'INV-FNP' : 'INV-FAE'}|${premiere.journalCode}|${premiere.ecritureNum}|${premiere.ecritureDate}`,
      type, regleId: estAchat ? 'INV-FNP' : 'INV-FAE',
      signal: `Constat de césure ${constat.cle} : écriture du ${premiere.ecritureDate}, postérieure à la clôture, sur une pièce datée du ${piece}, dans l’exercice.`,
      libelle: `${estAchat ? 'Facture non parvenue' : 'Facture à établir'} - pièce ${pieceRef} du ${piece}`,
      justification: estAchat
        ? `La pièce est datée du ${piece}, dans l’exercice, mais la charge n’a été comptabilisée que le ${premiere.ecritureDate}, après la clôture du ${fin}. Si la livraison ou la prestation est bien intervenue avant la clôture, la charge est à rattacher à l’exercice par le compte 408 (PCG art. 1214-40).`
        : `La pièce est datée du ${piece}, dans l’exercice, mais le produit n’a été comptabilisé que le ${premiere.ecritureDate}, après la clôture du ${fin}. Si la livraison ou la prestation est bien intervenue avant la clôture, le produit est à rattacher à l’exercice par le compte 4181.`,
      calcul: [
        ...detail.map((d) => ({ libelle: `${estAchat ? 'Charge' : 'Produit'} hors taxes, compte ${d.compteNum}`, valeur: m2(d.montant) })),
        { libelle: 'Total hors taxes', valeur: m2(horsTaxes) },
        { libelle: `TVA de l’écriture d’origine (${estAchat ? 'comptes 4456' : 'comptes 4457'})`, valeur: m2(tva) },
        { libelle: 'Total toutes taxes comprises', valeur: `${m2(horsTaxes)} + ${m2(tva)} = ${m2(ttc)}` },
      ],
      lignes: lignesProposees, lignesSources: ecriture, constats: [constat.cle], immobilisation: null, extourne: true,
      impacts: estAchat
        ? { resultat: horsTaxes.negated(), totalActif: tva, totalPassif: tva, commentaire: 'Augmente les charges de l’exercice ; la dette fournisseurs augmente du montant toutes taxes comprises, l’actif de la TVA à régulariser.' }
        : { resultat: horsTaxes, totalActif: ttc, totalPassif: ttc, commentaire: 'Augmente les produits de l’exercice ; la créance clients augmente du montant toutes taxes comprises, le passif de la TVA à régulariser et du résultat.' },
      hypotheses: [
        'La date de pièce n’est qu’un indice : le rattachement à l’exercice dépend de la date de livraison ou d’exécution de la prestation, à vérifier sur la pièce.',
        'Les montants hors taxes et de TVA sont repris tels quels de l’écriture passée après la clôture.',
        'L’exigibilité et la déductibilité de la TVA à la clôture ne sont pas appréciées.',
        'L’écriture est à contre-passer à l’ouverture de l’exercice suivant ; si l’exercice suivant est déjà comptabilisé, l’écriture d’origine y fait double emploi avec la charge ou le produit rattaché tant que l’extourne n’est pas passée.',
        tiers.hypothese,
        ...(compteTva === null ? [] : [compteTva.hypothese]),
        ...dejaMouvemente(estAchat ? '408' : '418'),
      ],
    });
  }

  // ── 3. Dotations aux amortissements (linéaire ou dégressif déclaré) ────────────────────────
  const convention: ConventionJoursAmortissement = demande.options?.conventionJoursAmortissement ?? 'base_360';
  const degressifActive = demande.options?.amortissementDegressifActive === true;
  const idsImmobilisations = new Set<string>();
  const fournies = demande.immobilisations ?? [];
  const parentDe = new Map(fournies.map((i) => [i.id, i.composantDe ?? null]));
  const suivis: Suivi[] = [];
  const signalements: SignalementInventaire[] = [];
  for (const immo of fournies) {
    const mention = `Immobilisation ${immo.id}`;
    const src = { immobilisation: immo.id };
    const modeDemande = immo.modeAmortissement ?? 'lineaire';
    const mode: ModeAmortissement = modeDemande === 'degressif' ? 'degressif' : 'lineaire';
    const type = mode === 'degressif' ? ('dotation_amortissement_degressif' as const) : ('dotation_amortissement_lineaire' as const);
    if (idsImmobilisations.has(immo.id)) { sAbstenir(type, 'immobilisation_en_double', `${mention} fournie plusieurs fois : seule la première occurrence est traitée.`, src); continue; }
    idsImmobilisations.add(immo.id);
    const suivi: Suivi = {
      id: immo.id, libelle: immo.libelle, mode, compteImmo: estCompte(immo.compteImmobilisation) ? immo.compteImmobilisation : null,
      compteDotation: immo.compteDotation !== undefined ? (estCompte(immo.compteDotation) ? immo.compteDotation : null) : estCompte(immo.compteImmobilisation) ? (immo.compteImmobilisation.startsWith('20') ? '68111' : immo.compteImmobilisation.startsWith('21') ? '68112' : null) : null,
      brute: null, dotation: null, brouillon: null,
    };
    suivis.push(suivi);
    if (modeDemande !== 'lineaire' && modeDemande !== 'degressif') { sAbstenir(type, 'mode_invalide', `${mention} : mode d’amortissement « ${String(modeDemande)} » non géré (linéaire ou dégressif attendu) : aucune dotation n’est estimée.`, src); continue; }
    if (mode === 'degressif' && !degressifActive) { sAbstenir(type, 'degressif_non_active', `${mention} : ${MOTIF_DEGRESSIF_NON_ACTIVE}`, src); continue; }
    if (mode === 'degressif' && (immo.justificationDegressif ?? '').trim().length < JUSTIFICATION_DEGRESSIF_MIN) { sAbstenir(type, 'justification_degressif_manquante', `${mention} : le dégressif est déclaré sans justification écrite du cabinet (au moins ${JUSTIFICATION_DEGRESSIF_MIN} caractères : nature du bien, bien neuf, durée normale d’utilisation, motif du mode). Aucune dotation n’est calculée : le choix et l’éligibilité doivent être justifiés par le cabinet, le moteur ne les présume pas.`, src); continue; }
    if (mode === 'degressif') {
      signalements.push({
        code: 'amortissement_derogatoire', immobilisation: immo.id, titre: `Amortissement dérogatoire éventuel — ${immo.libelle}`,
        motif: `Le mode dégressif est ici déclaré comme mode du plan d’amortissement COMPTABLE. Si, au contraire, le plan comptable est linéaire (ou d’une autre durée) et que le dégressif n’est retenu que pour la déduction fiscale, le complément d’amortissement se comptabilise en amortissement dérogatoire (compte 145, dotation au 6872, reprise au 7872 ; PCG art. 214-8) : le moteur ne propose AUCUNE écriture dérogatoire, à traiter par le professionnel.`,
        source: SOURCES_FISCALES.amortissementDerogatoire,
      });
    }
    const manquantes = [immo.baseAmortissable === null || immo.baseAmortissable === undefined ? 'base amortissable' : null, immo.dateMiseEnService === null || immo.dateMiseEnService === undefined ? 'date de mise en service' : null, immo.dureeMois === null || immo.dureeMois === undefined ? 'durée d’amortissement' : null].filter((m): m is string => m !== null);
    if (manquantes.length > 0) { sAbstenir(type, 'donnee_manquante', `${mention} : ${manquantes.join(', ')} non fournie(s) : aucune dotation n’est estimée.`, src); continue; }
    if (mode === 'degressif' && (immo.dateAcquisition === null || immo.dateAcquisition === undefined)) { sAbstenir(type, 'date_acquisition_manquante', `${mention} : date d’acquisition (ou de construction) non fournie : le point de départ du dégressif est le premier jour du mois d’acquisition (BOFiP BOI-BIC-AMT-20-20-30 § 190 à 200), le moteur ne le remplace pas par la mise en service ; aucune dotation n’est estimée.`, src); continue; }
    const baseTexte = immo.baseAmortissable as string;
    const mes = immo.dateMiseEnService as string;
    const duree = immo.dureeMois as number;
    const anterieursTexte = immo.amortissementsAnterieurs ?? null;
    if (!estChaineDecimale(baseTexte) || !new Decimal(baseTexte).isPositive() || new Decimal(baseTexte).isZero()) { sAbstenir(type, 'donnee_invalide', `${mention} : base amortissable invalide (chaîne décimale strictement positive attendue).`, src); continue; }
    if (!estDateIso(mes)) { sAbstenir(type, 'donnee_invalide', `${mention} : date de mise en service invalide (date ISO AAAA-MM-JJ attendue).`, src); continue; }
    if (!Number.isInteger(duree) || duree < 1 || duree > 1200) { sAbstenir(type, 'donnee_invalide', `${mention} : durée invalide (nombre entier de mois de 1 à 1200 attendu).`, src); continue; }
    if (anterieursTexte !== null && (!estChaineDecimale(anterieursTexte) || new Decimal(anterieursTexte).lessThan(0))) { sAbstenir(type, 'donnee_invalide', `${mention} : amortissements antérieurs invalides (chaîne décimale positive ou nulle attendue).`, src); continue; }
    if (!estCompte(immo.compteImmobilisation)) { sAbstenir(type, 'donnee_invalide', `${mention} : compte d’immobilisation invalide.`, src); continue; }
    const acquisition = mode === 'degressif' ? (immo.dateAcquisition as string) : null;
    if (acquisition !== null) {
      if (!estDateIso(acquisition)) { sAbstenir(type, 'donnee_invalide', `${mention} : date d’acquisition invalide (date ISO AAAA-MM-JJ attendue).`, src); continue; }
      if (acquisition > mes) { sAbstenir(type, 'donnee_invalide', `${mention} : date d’acquisition (${acquisition}) postérieure à la mise en service (${mes}).`, src); continue; }
      if (acquisition > fin) { sAbstenir(type, 'acquisition_posterieure', `${mention} : acquisition le ${acquisition}, après la clôture : aucune dotation sur l’exercice.`, src); continue; }
    }
    const brute = new Decimal(baseTexte);
    suivi.brute = brute;
    const residuelleTexte = immo.valeurResiduelle ?? null;
    let residuelle = ZERO;
    if (residuelleTexte !== null) {
      if (!estChaineDecimale(residuelleTexte) || new Decimal(residuelleTexte).lessThan(0) || new Decimal(residuelleTexte).greaterThanOrEqualTo(brute)) {
        sAbstenir(type, 'donnee_invalide', `${mention} : valeur résiduelle invalide (chaîne décimale positive ou nulle, strictement inférieure à la valeur brute ${m2(brute)}).`, src); continue;
      }
      residuelle = new Decimal(residuelleTexte);
    }
    const dateSortie = immo.dateSortie ?? null;
    if (dateSortie !== null) {
      if (!estDateIso(dateSortie)) { sAbstenir(type, 'donnee_invalide', `${mention} : date de sortie invalide (date ISO AAAA-MM-JJ attendue).`, src); continue; }
      if (dateSortie < mes) { sAbstenir(type, 'donnee_invalide', `${mention} : date de sortie (${dateSortie}) antérieure à la mise en service (${mes}).`, src); continue; }
    }
    if (mes > fin) { sAbstenir(type, 'mise_en_service_posterieure', `${mention} : mise en service le ${mes}, après la clôture : aucune dotation sur l’exercice.`, src); continue; }
    if (dateSortie !== null && dateSortie <= fin) {
      sAbstenir(type, 'sortie_d_actif', `${mention} : sortie de l’actif saisie au ${dateSortie}${dateSortie < debut ? ' (avant l’ouverture de l’exercice)' : ' (en cours d’exercice)'}. Le moteur ne calcule NI la dotation prorata jusqu’à la sortie, NI la plus ou moins-value de cession (comptes 675 et 775, solde du compte d’amortissement) : l’immobilisation n’est pas ignorée, elle est à traiter par le professionnel ; aucune dotation n’est proposée.`, src);
      continue;
    }
    if (immo.composantDe !== undefined && immo.composantDe !== null) {
      const parent = immo.composantDe;
      if (typeof parent !== 'string' || parent === immo.id || !parentDe.has(parent) || parentDe.get(parent) !== null) {
        sAbstenir(type, 'composant_invalide', `${mention} : rattachement à un composant invalide (la structure « ${String(parent)} » doit figurer au fichier, être distincte et ne pas être elle-même un composant) : aucune dotation n’est proposée.`, src); continue;
      }
    }
    // Comptes.
    const compteImmo = immo.compteImmobilisation;
    let compteAmortissement = immo.compteAmortissement;
    let compteDotation = immo.compteDotation;
    const hypothesesComptes: string[] = [];
    if (compteAmortissement === undefined) {
      if (!(compteImmo.startsWith('20') || compteImmo.startsWith('21'))) { sAbstenir(type, 'compte_a_fournir', `${mention} : le compte d’amortissement ne se déduit pas avec certitude du compte ${compteImmo} : fournir « compteAmortissement ».`, src); continue; }
      const derive = `28${compteImmo.slice(1)}`;
      // Même longueur que le compte d'immobilisation quand le dernier chiffre est un zéro de remplissage ; sinon un chiffre de plus.
      compteAmortissement = derive.endsWith('0') && compteImmo.length > 3 ? derive.slice(0, compteImmo.length) : derive;
      hypothesesComptes.push(`Compte d’amortissement ${compteAmortissement} déduit du compte ${compteImmo} (« même ventilation » que le compte d’immobilisation), à confirmer.`);
    }
    if (compteDotation === undefined) {
      if (!(compteImmo.startsWith('20') || compteImmo.startsWith('21'))) { sAbstenir(type, 'compte_a_fournir', `${mention} : le compte de dotation ne se déduit pas du compte ${compteImmo} : fournir « compteDotation ».`, src); continue; }
      const racine = compteImmo.startsWith('20') ? '68111' : '68112';
      compteDotation = racine.padEnd(Math.max(racine.length, compteImmo.length), '0');
      hypothesesComptes.push(`Compte de dotation ${compteDotation} construit à partir de la racine ${racine} du plan de comptes, à adapter au plan du dossier.`);
    }
    if (!estCompte(compteAmortissement) || !estCompte(compteDotation)) { sAbstenir(type, 'donnee_invalide', `${mention} : compte d’amortissement ou de dotation invalide.`, src); continue; }
    suivi.compteDotation = compteDotation;
    if (immo.composantDe) hypothesesComptes.push(`Composant de l’immobilisation ${immo.composantDe} : plan d’amortissement propre à chaque composant (PCG art. 214-9).`);
    const base = brute.minus(residuelle);
    const calculBase = residuelle.isZero()
      ? [{ libelle: 'Base amortissable', valeur: m2(base) }]
      : [{ libelle: 'Valeur brute', valeur: m2(brute) }, { libelle: 'Valeur résiduelle (déduite)', valeur: m2(residuelle) }, { libelle: 'Montant amortissable', valeur: m2(base) }];
    const hypothesesResiduelle = residuelle.isZero() ? [] : ['Valeur résiduelle saisie par le cabinet, déduite du montant amortissable (PCG art. 214-4 : elle n’est prise en compte que lorsqu’elle est à la fois significative et mesurable : appréciation du cabinet).'];
    const hypothesesSortie = dateSortie !== null ? [`Sortie de l’actif prévue au ${dateSortie}, postérieure à la clôture : sans effet sur cet exercice.`] : [];

    if (mode === 'degressif') {
      const plan = calculerPlanDegressif({ base, acquisition: acquisition as string, dureeMois: duree, coefficient: immo.coefficientDegressif, eligible: immo.eligibiliteDegressifConfirmee, compteImmo, debut, fin });
      if ('code' in plan) { sAbstenir(type, plan.code, `${mention} : ${plan.motif}`, src); continue; }
      const courant = plan.lignes[plan.rangCourant - 1] as LigneDegressive;
      const cumulAvant = plan.rangCourant === 1 ? ZERO : (plan.lignes[plan.rangCourant - 2] as LigneDegressive).cumul;
      const vncOuverture = base.minus(cumulAvant);
      if (anterieursTexte !== null && !new Decimal(anterieursTexte).equals(cumulAvant)) {
        sAbstenir(type, 'ecart_plan_anterieurs', `${mention} : les amortissements antérieurs fournis (${m2(new Decimal(anterieursTexte))}) diffèrent du cumul du plan dégressif à l’ouverture (${m2(cumulAvant)}). L’annuité dégressive dépend de la valeur nette comptable : le plan n’est pas recalculé sur un historique différent, l’écart est à analyser par le professionnel ; aucune dotation n’est proposée.`, src);
        continue;
      }
      const dotation = courant.dotation;
      suivi.dotation = dotation;
      if (dotation.isZero()) { sAbstenir(type, 'montant_nul', `${mention} : dotation nulle après arrondi.`, src); continue; }
      const pct = (d: Decimal): string => `${d.times(100).toDecimalPlaces(4).toString()} %`;
      const calcul: Array<{ libelle: string; valeur: string }> = [
        ...calculBase,
        { libelle: 'Mode d’amortissement', valeur: 'dégressif (déclaré par le cabinet)' },
        { libelle: 'Date de départ du plan', valeur: `${acquisition as string} (acquisition saisie ; départ au premier jour du mois)` },
        { libelle: 'Durée', valeur: `${plan.nbAnnees} ans` },
        { libelle: 'Taux linéaire', valeur: `100 ÷ ${plan.nbAnnees} = ${pct(ONE.dividedBy(plan.nbAnnees))}` },
        { libelle: 'Coefficient déclaré', valeur: plan.coefficient.toString() },
        { libelle: 'Taux dégressif', valeur: pct(plan.taux) },
        { libelle: 'Mois de la première année (mois de départ compris)', valeur: `${plan.moisPremiereAnnee} sur 12` },
        { libelle: 'Rang de l’exercice dans le plan', valeur: `${plan.rangCourant} sur ${plan.nbAnnees}` },
        { libelle: 'Amortissements cumulés à l’ouverture (plan)', valeur: m2(cumulAvant) },
        { libelle: 'Valeur nette comptable à l’ouverture', valeur: m2(vncOuverture) },
        { libelle: courant.methode === 'degressif' ? 'Annuité dégressive' : 'Annuité linéaire (bascule)', valeur: `${courant.formule} = ${m2(dotation)}` },
        { libelle: 'Dotation de l’exercice', valeur: m2(dotation) },
      ];
      const lignesPlan: LignePlanAmortissement[] = plan.lignes.map((l) => ({ rang: l.rang, exerciceFin: l.exerciceFin, methode: l.methode, baseCalcul: m2(l.baseCalcul), dotation: m2(l.dotation), cumul: m2(l.cumul), vnc: m2(l.vnc), formule: l.formule, exerciceCourant: l.rang === plan.rangCourant }));
      const hypotheses = [
        'Mode dégressif DÉCLARÉ par le cabinet comme mode du plan d’amortissement comptable (PCG art. 214-13 : le mode doit traduire au mieux la consommation des avantages économiques) ; il n’est jamais deviné.',
        `Justification écrite du cabinet : « ${(immo.justificationDegressif ?? '').trim()} » (reprise telle quelle, non évaluée par le moteur ; auteur et date : fiche de l’immobilisation).`,
        'Éligibilité au dégressif CONFIRMÉE par le cabinet (bien neuf, durée d’au moins trois ans, bien visé par l’art. 39 A du CGI, hors exclusions : voitures de tourisme, mobilier de bureau, locaux professionnels…) : le moteur ne la vérifie pas, le cabinet en répond.',
        `Coefficient ${plan.coefficient.toString()} déclaré, cohérent avec la durée de ${plan.nbAnnees} ans (1,25 pour 3 ou 4 ans, 1,75 pour 5 ou 6 ans, 2,25 au-delà de 6 ans) ; un coefficient différent de la règle générale provoque une abstention.`,
        `Point de départ : le premier jour du mois d’acquisition ou de construction (${acquisition as string} saisie), mois d’acquisition compris (BOFiP BOI-BIC-AMT-20-20-30 § 190 à 200), et non la mise en service.`,
        'Bascule au linéaire appliquée dès qu’elle devient plus favorable ; c’est une faculté de l’entreprise (BOFiP BOI-BIC-AMT-20-20-30).',
        'Cas particuliers non pris en charge : les coefficients majorés ou diminués de certains biens d’équipement (BOFiP BOI-BIC-AMT-20-20-50, non analysé) ne sont pas gérés.',
        'Le texte de loi (CGI art. 39 A) n’a pas été vérifié sur une source officielle et les règles n’ont pas été validées par un professionnel : le calcul ne s’affiche que parce que l’éditeur l’a activé.',
        'Exercices de douze mois, du premier au dernier jour d’un mois ; aucune dépréciation, cession ou révision du plan n’est prise en compte.',
        'Le dégressif fiscal s’applique au prix de revient ; la valeur résiduelle éventuelle n’intervient que dans le plan comptable ci-dessus.',
        ...hypothesesResiduelle, ...hypothesesSortie, ...hypothesesComptes,
      ];
      if (anterieursTexte === null && plan.rangCourant > 1) hypotheses.push(`Amortissements antérieurs non fournis : le cumul du plan à l’ouverture (${m2(cumulAvant)}) n’est pas rapproché du cumul comptabilisé.`);
      suivi.brouillon = {
        id: `INV-AMORT-DEG|${immo.id}`, type, regleId: 'INV-AMORT-DEG',
        signal: `Mode dégressif, coefficient et éligibilité déclarés par le cabinet pour l’immobilisation ${immo.id} (compte ${compteImmo}).`,
        libelle: `Dotation aux amortissements dégressifs - immobilisation ${immo.id}`,
        justification: `Une dotation est comptabilisée à la clôture conformément au plan d’amortissement de chaque actif amortissable (PCG art. 214-11) ; le plan est dégressif, mode choisi par le cabinet (art. 214-13) : taux linéaire × coefficient ${plan.coefficient.toString()} appliqué à la valeur nette comptable, avec bascule au linéaire quand il devient plus favorable (BOFiP BOI-BIC-AMT-20-20-30).`,
        calcul, lignesSources: [], constats: [], immobilisation: immo.id, hypotheses, extourne: false,
        lignes: [{ compteNum: compteDotation, libelle: 'Dotations aux amortissements sur immobilisations', debit: dotation, credit: ZERO }, { compteNum: compteAmortissement, libelle: `Amortissements - ${immo.libelle}`.slice(0, 120), debit: ZERO, credit: dotation }],
        impacts: { resultat: dotation.negated(), totalActif: dotation.negated(), totalPassif: dotation.negated(), commentaire: 'Augmente les charges de l’exercice ; diminue l’actif net immobilisé et, par le résultat, le passif.' },
        plan: lignesPlan,
        complementaires: [SOURCES_FISCALES.amortissementDegressifPcg, SOURCES_FISCALES.cgiArticle39A, SOURCES_FISCALES.bofipBiensEligibles, SOURCES_FISCALES.bofipBiensDecomposes, SOURCES_FISCALES.bofipEntreprisesConcernees, SOURCES_FISCALES.bofipLineaire],
      };
      continue;
    }

    // Jours du plan et jours de l'exercice compris dans le plan.
    let joursPlan: number;
    let consommesAvant: number;
    let consommesFin: number;
    let finPlan: string | null = null;
    if (convention === 'base_360') {
      joursPlan = duree * 30;
      consommesAvant = borner(rang360(debut) - rang360(mes), joursPlan);
      consommesFin = borner(rang360(fin) - rang360(mes) + 1, joursPlan);
    } else {
      finPlan = isoDepuisJours(joursDepuisEpoque(ajouterMois(mes, duree)) - 1);
      joursPlan = ecartEnJours(mes, finPlan) + 1;
      consommesAvant = borner(ecartEnJours(mes, debut), joursPlan);
      consommesFin = borner(ecartEnJours(mes, fin) + 1, joursPlan);
    }
    const joursExercice = consommesFin - consommesAvant;
    const theoriqueAnterieur = arrondi(base.times(consommesAvant).dividedBy(joursPlan));
    let dotation = arrondi(base.times(joursExercice).dividedBy(joursPlan));
    const calcul = [
      ...calculBase,
      { libelle: 'Mise en service', valeur: mes },
      { libelle: 'Durée', valeur: `${duree} mois` },
      { libelle: 'Convention de décompte des jours', valeur: convention === 'base_360' ? 'année de 360 jours (mois de 30 jours)' : `jours réels (fin du plan le ${finPlan})` },
      { libelle: 'Jours du plan', valeur: String(joursPlan) },
      { libelle: 'Jours du plan écoulés avant l’ouverture de l’exercice', valeur: String(consommesAvant) },
      { libelle: 'Jours de l’exercice compris dans le plan', valeur: String(joursExercice) },
      { libelle: 'Formule', valeur: `${m2(base)} × ${joursExercice} ÷ ${joursPlan} = ${m2(dotation)}` },
    ];
    const hypotheses = [
      'Mode linéaire, sur la base, la date de mise en service et la durée fournies par le cabinet ; aucune dépréciation, cession ou révision du plan n’est prise en compte.',
      convention === 'base_360' ? 'Décompte des jours sur une année de 360 jours (convention interne, paramétrable).' : 'Décompte des jours en jours calendaires réels (convention interne, paramétrable).',
      ...hypothesesResiduelle, ...hypothesesSortie, ...hypothesesComptes,
    ];
    if (anterieursTexte === null) {
      if (joursExercice === 0) { suivi.dotation = ZERO; sAbstenir(type, 'plan_acheve', `${mention} : le plan d’amortissement est achevé avant l’ouverture de l’exercice : aucune dotation.`, src); continue; }
      hypotheses.push(`Amortissements antérieurs non fournis : la dotation n’est pas rapprochée du cumul comptabilisé (cumul théorique à l’ouverture : ${m2(theoriqueAnterieur)}).`);
    } else {
      const anterieurs = new Decimal(anterieursTexte);
      const restant = base.minus(anterieurs);
      calcul.push({ libelle: 'Amortissements antérieurs fournis', valeur: m2(anterieurs) }, { libelle: 'Cumul théorique à l’ouverture', valeur: m2(theoriqueAnterieur) }, { libelle: 'Reste à amortir à l’ouverture', valeur: m2(restant) });
      if (!restant.isPositive() || restant.isZero()) { suivi.dotation = ZERO; sAbstenir(type, 'totalement_amorti', `${mention} : les amortissements antérieurs fournis (${m2(anterieurs)}) atteignent ou dépassent la base (${m2(base)}) : aucune dotation.`, src); continue; }
      if (!anterieurs.equals(theoriqueAnterieur)) hypotheses.push(`Les amortissements antérieurs fournis (${m2(anterieurs)}) diffèrent du cumul théorique à l’ouverture (${m2(theoriqueAnterieur)}) : le plan fourni et le plan comptabilisé sont à rapprocher.`);
      if (consommesFin === joursPlan && joursExercice > 0) {
        dotation = restant;
        calcul.push({ libelle: 'Le plan s’achève dans l’exercice : dotation = reste à amortir', valeur: m2(dotation) });
      } else if (dotation.greaterThan(restant)) {
        dotation = restant;
        calcul.push({ libelle: 'Dotation plafonnée au reste à amortir', valeur: m2(dotation) });
      } else if (joursExercice === 0) { sAbstenir(type, 'plan_acheve', `${mention} : le plan d’amortissement fourni est achevé avant l’ouverture de l’exercice alors qu’il reste ${m2(restant)} à amortir : plan à revoir, aucune dotation n’est proposée.`, src); continue; }
    }
    if (dotation.isZero()) { sAbstenir(type, 'montant_nul', `${mention} : dotation nulle après arrondi.`, src); continue; }
    suivi.dotation = dotation;
    calcul.push({ libelle: 'Dotation de l’exercice', valeur: m2(dotation) });
    suivi.brouillon = {
      id: `INV-AMORT|${immo.id}`, type, regleId: 'INV-AMORT',
      signal: `Données d’amortissement fournies par le cabinet pour l’immobilisation ${immo.id} (compte ${compteImmo}).`,
      libelle: `Dotation aux amortissements - immobilisation ${immo.id}`,
      justification: `Une dotation est comptabilisée à la clôture conformément au plan d’amortissement de chaque actif amortissable ; l’amortissement commence à la mise en service (${mes}) et le mode linéaire s’applique à défaut de mode mieux adapté (PCG art. 214-11 à 214-13).`,
      calcul, lignesSources: [], constats: [], immobilisation: immo.id, hypotheses, extourne: false,
      lignes: [{ compteNum: compteDotation, libelle: 'Dotations aux amortissements sur immobilisations', debit: dotation, credit: ZERO }, { compteNum: compteAmortissement, libelle: `Amortissements - ${immo.libelle}`.slice(0, 120), debit: ZERO, credit: dotation }],
      impacts: { resultat: dotation.negated(), totalActif: dotation.negated(), totalPassif: dotation.negated(), commentaire: 'Augmente les charges de l’exercice ; diminue l’actif net immobilisé et, par le résultat, le passif.' },
    };
  }

  // ── 3 bis. Rapprochement avec la comptabilité importée ────────────────────────────────────
  const rapprochement = rapprocherImmobilisations({ lignes, debut, fin, suivis });
  for (const g of rapprochement.dotations) {
    if (!g.propositionsEcartees) continue;
    for (const sv of suivis.filter((x) => g.immobilisations.includes(x.id) && x.brouillon !== null)) {
      const type: TypePropositionInventaire = sv.mode === 'degressif' ? 'dotation_amortissement_degressif' : 'dotation_amortissement_lineaire';
      sAbstenir(type, 'dotation_deja_comptabilisee', `Immobilisation ${sv.id} : ${g.message} Aucune dotation n’est reproposée ; l’écart éventuel n’est pas corrigé.`, { immobilisation: sv.id });
      sv.brouillon = null;
    }
  }
  for (const sv of suivis) if (sv.brouillon !== null) brouillons.push(sv.brouillon);

  // ── Finalisation : équilibre vérifié, tri déterministe ─────────────────────────────────────
  const ORDRE: TypePropositionInventaire[] = ['charge_constatee_avance', 'produit_constate_avance', 'facture_non_parvenue', 'facture_a_etablir', 'dotation_amortissement_lineaire', 'dotation_amortissement_degressif'];
  const propositions: PropositionEcritureInventaire[] = [];
  for (const b of brouillons) {
    const totalDebit = b.lignes.reduce((s, l) => s.plus(l.debit), ZERO);
    const totalCredit = b.lignes.reduce((s, l) => s.plus(l.credit), ZERO);
    if (!totalDebit.equals(totalCredit) || totalDebit.isZero() || b.lignes.some((l) => l.debit.lessThan(0) || l.credit.lessThan(0))) {
      sAbstenir(b.type, 'proposition_desequilibree', `Proposition ${b.id} écartée : débit ${m2(totalDebit)} différent du crédit ${m2(totalCredit)}, ou montant négatif.`, { lignesEcritures: b.lignesSources.map((l) => l.id), immobilisation: b.immobilisation });
      continue;
    }
    const r = regle(b.regleId);
    const ecritures = new Map<string, { journalCode: string; ecritureNum: string; ecritureDate: string }>();
    for (const l of b.lignesSources) ecritures.set(cleEcriture(l), { journalCode: l.journalCode, ecritureNum: l.ecritureNum, ecritureDate: l.ecritureDate });
    propositions.push({
      id: b.id, type: b.type, statut: 'proposee', dateEcriture: fin, libelle: b.libelle,
      origine: { regle: r.id, versionRegle: r.version, signal: b.signal },
      justification: b.justification, calcul: b.calcul,
      lignes: b.lignes.map((l) => ({ compteNum: l.compteNum, libelle: l.libelle, debit: m2(l.debit), credit: m2(l.credit) })),
      totalDebit: m2(totalDebit), totalCredit: m2(totalCredit), equilibree: true,
      sources: { lignesEcritures: b.lignesSources.map((l) => l.id), ecritures: [...ecritures.values()], pieces: [...new Set(b.lignesSources.map((l) => l.pieceRef).filter((p) => p !== ''))], constats: b.constats, immobilisation: b.immobilisation },
      planAmortissement: b.plan ?? null,
      sourcesComplementaires: b.complementaires ?? [],
      impacts: { resultat: m2(b.impacts.resultat), totalActif: m2(b.impacts.totalActif), totalPassif: m2(b.impacts.totalPassif), commentaire: b.impacts.commentaire },
      hypotheses: [...b.hypotheses, 'Proposition non comptabilisée : elle n’a d’effet qu’après approbation par un réviseur.'],
      extourneLe: b.extourne ? ouvertureSuivante : null,
      source: r.source,
    });
  }
  propositions.sort((a, b) => ORDRE.indexOf(a.type) - ORDRE.indexOf(b.type) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const cumul = (f: (p: PropositionEcritureInventaire) => string): ChaineDecimale => m2(propositions.reduce((s, p) => s.plus(new Decimal(f(p))), ZERO));
  return {
    statut: 'projet',
    mention: MENTION_PROJET,
    exercice: { debut, fin },
    propositions,
    abstentions,
    regles: [...REGLES_INVENTAIRE],
    conventions: [...CONVENTIONS_INVENTAIRE],
    signalements,
    rapprochement,
    immobilisationsSuivies: suivis.map((sv) => ({ id: sv.id, libelle: sv.libelle, mode: sv.mode, compteImmobilisation: sv.compteImmo, valeurBrute: sv.brute === null ? null : m2(sv.brute), dotationExercice: sv.dotation === null ? null : m2(sv.dotation) })),
    totaux: { nbPropositions: propositions.length, nbAbstentions: abstentions.length, impactResultat: cumul((p) => p.impacts.resultat), impactTotalActif: cumul((p) => p.impacts.totalActif), impactTotalPassif: cumul((p) => p.impacts.totalPassif) },
  };
}
