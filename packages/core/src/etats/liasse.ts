/**
 * Préparation de la liasse fiscale — PROJET, pour un périmètre explicite :
 * société commerciale soumise à l'impôt sur les sociétés, PCG, euros, France métropolitaine.
 *
 * Tableaux préparés (ceux qui se déduisent de la balance) : régime réel normal 2050, 2051, 2052, 2053 ;
 * régime simplifié 2033-A et 2033-B (partie comptable). Tous les autres tableaux sont listés comme NON COUVERTS,
 * avec les informations complémentaires nécessaires : ils ne sont jamais présentés comme préparés.
 *
 * Règles :
 *  - hors périmètre (territoire, régime, référentiel, devise, exercice hors période de la table) : la fonction S'ABSTIENT
 *    avec ses motifs et ne produit aucun chiffre ;
 *  - les montants viennent des projets de bilan et de compte de résultat existants (table PCG-SYSTEME-DE-BASE) :
 *    une ligne de la liasse est un regroupement de rubriques de cette table, jamais une nouvelle affectation de comptes ;
 *  - un compte non affecté, ou une rubrique sans ligne certaine dans le tableau, reste « non affecté » et est listé ;
 *  - aucun écart n'est forcé : les contrôles l'affichent ;
 *  - les formulaires n'ayant pas pu être lus le 2026-11-19, AUCUN code de case n'est fourni (`codeCase: null`,
 *    `etatCodeCase: 'a_confirmer'`) : les identifiants de lignes sont internes ;
 *  - les montants sont restitués au centime ; l'arrondi à l'euro attendu par les formulaires n'est pas pratiqué.
 */
import { Decimal } from 'decimal.js';
import type { SourceRegle } from '../controles/types.js';
import { estDateIso } from '../dates.js';
import { MOTIF_SANS_PRECEDENT, verifierExercicePrecedent } from './comparatif.js';
import { type ChaineDecimale, dec, versChaine } from '../montant.js';
import { CORRESPONDANCE_PCG, correspondancePour } from './correspondance.js';
import { projeterBilan, projeterCompteDeResultat } from './projection.js';
import { MENTION_PROJET, SOURCES_FISCALES } from './sources-fiscales.js';
import { DATE_APPLICATION_REGLEMENT_2022_06 } from './sources.js';
import type { Balance, ControleEtat, CorrespondanceRubriques, EtatProjet, RubriqueDefinition, RubriqueProjetee } from './types.js';

const ZERO = new Decimal(0);

// ───────────────────────────── Types publics ─────────────────────────────

/** Mêmes valeurs que le type `territoire_fiscal` de la base. */
export type TerritoireFiscal = 'metropole' | 'guadeloupe' | 'martinique' | 'guyane' | 'reunion' | 'mayotte' | 'autre' | 'a_confirmer';
/** Impôt frappant le résultat. Seul `is` est dans le périmètre. */
export type ImpotSurLeResultat = 'is' | 'ir' | 'autre' | 'a_confirmer';
/** Régime d'imposition : donnée d'entrée fournie par le cabinet, jamais déduite d'un seuil. */
export type RegimeLiasse = 'reel_normal' | 'reel_simplifie';
export type CodeTableauLiasse = '2050' | '2051' | '2052' | '2053' | '2033-A' | '2033-B';

export interface LigneLiasseDefinition {
  /** Identifiant INTERNE et stable de la ligne (ce n'est pas un code de case du formulaire). */
  id: string;
  tableau: CodeTableauLiasse;
  ordre: number;
  libelle: string;
  /**
   * `modele_pcg` : libellé du poste du modèle de bilan ou de compte de résultat du PCG (art. 821-1 et 821-2), relu sur le texte ;
   * `trace_usuel_non_relu` : libellé usuel de la ligne du formulaire, NON relu sur le millésime (formulaire inaccessible).
   */
  origineLibelle: 'modele_pcg' | 'trace_usuel_non_relu';
  nature: 'poste' | 'total' | 'resultat';
  /** Colonnes brut / amortissements et dépréciations / net (actif du bilan). */
  avecColonnesActif: boolean;
  /** Postes : rubriques de la table de correspondance des comptes dont la ligne reprend le montant. */
  rubriquesPcg: string[];
  /** Totaux et résultats : lignes additionnées (signe 1) ou retranchées (signe -1). */
  formule: Array<{ ligne: string; signe: 1 | -1 }>;
  /** Toujours `null` dans cette version : aucun code de case n'a pu être vérifié sur le formulaire. */
  codeCase: string | null;
  etatCodeCase: 'a_confirmer' | 'verifie';
  /** Réserve propre à la ligne (ventilation du formulaire non reproduite, par exemple). */
  note: string | null;
}

export interface TableauNonCouvert {
  code: string;
  intitule: string;
  /** L'intitulé a-t-il été lu sur une source officielle le jour de la vérification ? */
  intituleVerifie: boolean;
  /** `non_couvert` : rien n'est préparé. `partiel` : le tableau est préparé en partie seulement (voir `motif`). */
  couverture: 'non_couvert' | 'partiel';
  motif: string;
  informationsComplementairesNecessaires: string[];
}

/** Table de correspondance rubriques → lignes de la liasse, versionnée. */
export interface TableLiasse {
  id: string;
  version: string;
  regime: RegimeLiasse;
  /** Millésime du formulaire visé. */
  millesimeFormulaire: string;
  formulaire: string;
  periodeApplication: {
    /** Premier jour d'ouverture des exercices couverts (inclus). */
    exercicesOuvertsAPartirDu: string;
    /** Dernier jour de clôture des exercices couverts (inclus). */
    exercicesClosAuPlusTardLe: string;
    libelle: string;
  };
  perimetre: string;
  /** Formulaire officiel visé (non lu : `verification: 'non_verifiee'`). */
  source: SourceRegle;
  sourcesComplementaires: SourceRegle[];
  /** Table de correspondance comptes → rubriques dont les lignes reprennent les montants. */
  correspondanceComptes: { id: string; version: string };
  etat: 'en_attente_de_validation_professionnelle';
  tableaux: Array<{ code: CodeTableauLiasse; intitule: string }>;
  lignes: LigneLiasseDefinition[];
  /** Rubriques de la table des comptes qui n'ont pas de ligne certaine dans ces tableaux : leur montant reste « non affecté ». */
  rubriquesSansLigne: Array<{ code: string; motif: string }>;
  tableauxNonCouverts: TableauNonCouvert[];
}

export interface CompteContributeur {
  compteNum: string;
  compteLib: string;
  /** Montant retenu, dans le sens naturel de la rubrique (colonne amortissements et dépréciations : montant négatif). */
  montant: ChaineDecimale;
  rubriquePcg: string;
  colonne: 'brut' | 'amortissements_depreciations' | null;
}

export interface CaseLiasse {
  ligne: string;
  tableau: CodeTableauLiasse;
  libelle: string;
  nature: 'poste' | 'total' | 'resultat';
  codeCase: string | null;
  etatCodeCase: 'a_confirmer' | 'verifie';
  /** Actif du bilan uniquement. */
  brut?: ChaineDecimale;
  /** Actif du bilan uniquement (montant à déduire, positif). */
  amortissementsDepreciations?: ChaineDecimale;
  /** Exercice précédent (N-1), même ligne, même table ; `null` quand la colonne est indisponible (voir `comparatif`). */
  n1: ValeurN1 | null;
  /** Actif : net. Passif et produits : crédit − débit. Charges : débit − crédit. Résultats : produits − charges. */
  montant: ChaineDecimale;
  /** Comptes de la balance qui composent la ligne (vide pour un total : voir `tracabilite.formule`). */
  comptes: CompteContributeur[];
  tracabilite: {
    table: { id: string; version: string };
    correspondanceComptes: { id: string; version: string };
    rubriquesPcg: string[];
    /** Formule lisible d'un total, sinon `null`. */
    formule: string | null;
  };
  note: string | null;
}

export interface DemandeLiasse {
  balance: Balance;
  exercice: { debut: string; fin: string };
  regime: RegimeLiasse;
  territoire: TerritoireFiscal;
  impotSurLeResultat: ImpotSurLeResultat;
  /** Référentiel comptable du dossier. Seul « PCG » est couvert. */
  referentielComptable: string;
  /** Devise de tenue des comptes. Seul « EUR » est couvert. */
  devise: string;
  /** La société est-elle une société commerciale ? `null` = non renseigné (abstention). */
  societeCommerciale: boolean | null;
  /**
   * Exercice précédent (colonne N-1), s'il existe et porte une comptabilité importée. Il est traité par la MÊME table et
   * les MÊMES règles que l'exercice demandé ; s'il sort du périmètre ou n'est pas contigu, la colonne est « indisponible »
   * avec son motif (jamais une colonne approximative).
   */
  precedent?: { balance: Balance; exercice: { debut: string; fin: string } } | null;
  /** Motif précis de l'absence de l'exercice précédent (plafond de volume, par exemple) ; sinon motif générique. */
  motifPrecedentAbsent?: string | null;
}

/** Valeurs d'une ligne pour l'exercice précédent. */
export interface ValeurN1 {
  montant: ChaineDecimale;
  brut?: ChaineDecimale;
  amortissementsDepreciations?: ChaineDecimale;
}

export type ComparatifLiasse =
  | {
      statut: 'fourni';
      exercice: { debut: string; fin: string };
      totaux: Record<string, ChaineDecimale>;
      controles: ControleEtat[];
      reserves: string[];
    }
  | { statut: 'indisponible'; motifs: string[] };

export interface MotifAbstention {
  code: 'territoire_hors_perimetre' | 'territoire_a_confirmer' | 'impot_hors_perimetre' | 'impot_a_confirmer' | 'forme_hors_perimetre' | 'forme_a_confirmer'
    | 'referentiel_hors_perimetre' | 'devise_hors_perimetre' | 'exercice_invalide' | 'exercice_hors_periode';
  message: string;
}

export interface LiasseAbstention {
  statut: 'abstention';
  /** Aucun chiffre n'est produit. */
  motifs: MotifAbstention[];
  perimetreCouvert: string;
  mention: string;
}

export interface LiasseProjet {
  /** Toujours « projet » : jamais une déclaration, jamais un document validé. */
  statut: 'projet';
  /** Faux tant qu'une information manque (toujours faux dans cette version : des tableaux ne sont pas couverts). */
  complet: boolean;
  /** Liste des manques : tableaux non couverts, colonnes non alimentées, comptes non affectés, écarts. */
  manques: string[];
  mention: string;
  regime: RegimeLiasse;
  exercice: { debut: string; fin: string };
  table: { id: string; version: string; millesimeFormulaire: string; etat: 'en_attente_de_validation_professionnelle' };
  correspondanceComptes: { id: string; version: string };
  tableaux: Array<{ code: CodeTableauLiasse; intitule: string; lignes: CaseLiasse[] }>;
  totaux: Record<string, ChaineDecimale>;
  /** Colonne de l'exercice précédent (N-1) : fournie ou indisponible avec motifs. */
  comparatif: ComparatifLiasse;
  /** Écarts AFFICHÉS, jamais corrigés. */
  controles: ControleEtat[];
  /** Comptes de la balance qu'aucune rubrique ne reprend. Solde = débit − crédit. */
  comptesNonAffectes: Array<{ compteNum: string; compteLib: string; solde: ChaineDecimale }>;
  /** Rubriques portant un montant mais sans ligne certaine dans le tableau : elles ne figurent dans aucun total de la liasse. */
  rubriquesNonAffectees: Array<{ code: string; libelle: string; montant: ChaineDecimale; motif: string; comptes: CompteContributeur[] }>;
  tableauxNonCouverts: TableauNonCouvert[];
  sources: SourceRegle[];
}

export type ResultatLiasse = LiasseProjet | LiasseAbstention;

// ───────────────────────────── Tables ─────────────────────────────

export const PERIMETRE_LIASSE =
  'Société commerciale soumise à l’impôt sur les sociétés, comptes tenus en euros selon le plan comptable général, France métropolitaine ; ' +
  'exercices ouverts à compter du 1er janvier 2025 et relevant du millésime 2026 des formulaires.';

/**
 * Dernier jour de clôture couvert. Convention interne prudente : le millésime 2026 sert aux déclarations déposées en 2026 ;
 * un exercice clos le 31 décembre 2026 sera déclaré en 2027 sur un millésime qui n'existe pas encore.
 */
export const DERNIERE_CLOTURE_COUVERTE_LIASSE_2026 = '2026-12-30';

const PERIODE_TABLE = {
  exercicesOuvertsAPartirDu: DATE_APPLICATION_REGLEMENT_2022_06,
  exercicesClosAuPlusTardLe: DERNIERE_CLOTURE_COUVERTE_LIASSE_2026,
  libelle:
    `Exercices ouverts à compter du ${DATE_APPLICATION_REGLEMENT_2022_06} (plan de comptes et modèles issus du règlement ANC n° 2022-06) et clos au plus tard le ${DERNIERE_CLOTURE_COUVERTE_LIASSE_2026} ` +
    '(millésime 2026 des formulaires ; borne de clôture = convention interne à confirmer).',
};

const CORRESPONDANCE_COMPTES = { id: CORRESPONDANCE_PCG.id, version: CORRESPONDANCE_PCG.version };

type Brouillon = Pick<LigneLiasseDefinition, 'id' | 'tableau' | 'libelle' | 'origineLibelle' | 'nature'> & Partial<Pick<LigneLiasseDefinition, 'rubriquesPcg' | 'formule' | 'note'>>;

function finaliser(brouillons: Brouillon[]): LigneLiasseDefinition[] {
  return brouillons.map((b, i) => ({
    id: b.id,
    tableau: b.tableau,
    ordre: (i + 1) * 10,
    libelle: b.libelle,
    origineLibelle: b.origineLibelle,
    nature: b.nature,
    avecColonnesActif: b.tableau === '2050' || (b.tableau === '2033-A' && b.id.includes('_ACTIF_')),
    rubriquesPcg: b.rubriquesPcg ?? [],
    formule: b.formule ?? [],
    codeCase: null,
    etatCodeCase: 'a_confirmer',
    note: b.note ?? null,
  }));
}

const plus = (...lignes: string[]): Array<{ ligne: string; signe: 1 | -1 }> => lignes.map((ligne) => ({ ligne, signe: 1 }));
const moins = (...lignes: string[]): Array<{ ligne: string; signe: 1 | -1 }> => lignes.map((ligne) => ({ ligne, signe: -1 }));

// ── Régime réel normal : une ligne par poste des modèles du PCG (art. 821-1 et 821-2), que les tableaux 2050 à 2053 suivent selon le BOFiP.

const NOTE_TRACE_RN =
  'Poste du modèle du PCG (art. 821-1 ou 821-2). Le tracé du tableau millésime 2026 n’a pas pu être relu : la case correspondante, et une éventuelle ventilation ou un regroupement propre au formulaire, sont à confirmer.';

function ligneRn(tableau: CodeTableauLiasse, r: RubriqueDefinition, estRegroupement: boolean, enfants: readonly RubriqueDefinition[]): Brouillon {
  const id = `RN_${tableau}_${r.code}`;
  return estRegroupement
    ? { id, tableau, libelle: r.libelle, origineLibelle: 'modele_pcg', nature: 'total', formule: plus(...enfants.map((e) => `RN_${tableau}_${e.code}`)), note: NOTE_TRACE_RN }
    : { id, tableau, libelle: r.libelle, origineLibelle: 'modele_pcg', nature: 'poste', rubriquesPcg: [r.code], note: NOTE_TRACE_RN };
}

function lignesReelNormal(c: CorrespondanceRubriques): LigneLiasseDefinition[] {
  const tries = [...c.rubriques].sort((a, b) => a.ordre - b.ordre);
  const enfantsDe = (code: string): RubriqueDefinition[] => tries.filter((r) => r.parent === code);
  const versLignes = (tableau: CodeTableauLiasse, rubriques: readonly RubriqueDefinition[]): Brouillon[] =>
    rubriques.map((r) => {
      const enfants = enfantsDe(r.code);
      return ligneRn(tableau, r, enfants.length > 0, enfants);
    });
  const racines = (etat: RubriqueDefinition['etat']): string[] => tries.filter((r) => r.etat === etat && r.parent === null).map((r) => r.code);
  const dans = (etat: RubriqueDefinition['etat'], codesRacines: readonly string[]): RubriqueDefinition[] => {
    const retenus = new Set<string>(codesRacines);
    for (const r of tries) if (r.etat === etat && r.parent !== null && retenus.has(r.parent)) retenus.add(r.code); // l'ordre place les parents avant les enfants
    return tries.filter((r) => r.etat === etat && retenus.has(r.code));
  };
  const total = (id: string, tableau: CodeTableauLiasse, libelle: string, formule: Array<{ ligne: string; signe: 1 | -1 }>, nature: 'total' | 'resultat' = 'total'): Brouillon =>
    ({ id, tableau, libelle, origineLibelle: 'modele_pcg', nature, formule, note: NOTE_TRACE_RN });
  const r52 = (code: string): string => `RN_2052_${code}`;
  const r53 = (code: string): string => `RN_2053_${code}`;

  return finaliser([
    ...versLignes('2050', tries.filter((r) => r.etat === 'bilan_actif')),
    total('RN_2050_TOTAL_GENERAL', '2050', 'Total général de l’actif (I + II + III + IV + V + VI + VII)', plus(...racines('bilan_actif').map((code) => `RN_2050_${code}`))),
    ...versLignes('2051', tries.filter((r) => r.etat === 'bilan_passif')),
    total('RN_2051_TOTAL_GENERAL', '2051', 'Total général du passif (I + II + III + IV + V)', plus(...racines('bilan_passif').map((code) => `RN_2051_${code}`))),
    ...versLignes('2052', dans('resultat_produits', ['PE'])),
    ...versLignes('2052', dans('resultat_charges', ['CE'])),
    total('RN_2052_RESULTAT_EXPLOITATION', '2052', '1. Résultat d’exploitation (I - II)', [...plus(r52('PE')), ...moins(r52('CE'))], 'resultat'),
    ...versLignes('2052', dans('resultat_produits', ['QPP'])),
    ...versLignes('2052', dans('resultat_charges', ['QPC'])),
    ...versLignes('2052', dans('resultat_produits', ['PF'])),
    ...versLignes('2052', dans('resultat_charges', ['CF'])),
    total('RN_2052_RESULTAT_FINANCIER', '2052', '2. Résultat financier (V - VI)', [...plus(r52('PF')), ...moins(r52('CF'))], 'resultat'),
    total('RN_2052_RESULTAT_COURANT', '2052', '3. Résultat courant avant impôts (I - II + III - IV + V - VI)', [...plus(r52('PE'), r52('QPP'), r52('PF')), ...moins(r52('CE'), r52('QPC'), r52('CF'))], 'resultat'),
    ...versLignes('2053', dans('resultat_produits', ['PX'])),
    ...versLignes('2053', dans('resultat_charges', ['CX'])),
    total('RN_2053_RESULTAT_EXCEPTIONNEL', '2053', '4. Résultat exceptionnel (VII - VIII)', [...plus(r53('PX')), ...moins(r53('CX'))], 'resultat'),
    ...versLignes('2053', dans('resultat_charges', ['PART', 'IS'])),
    total('RN_2053_TOTAL_PRODUITS', '2053', 'Total des produits (I + III + V + VII)', plus(r52('PE'), r52('QPP'), r52('PF'), r53('PX'))),
    total('RN_2053_TOTAL_CHARGES', '2053', 'Total des charges (II + IV + VI + VIII + IX + X)', plus(r52('CE'), r52('QPC'), r52('CF'), r53('CX'), r53('PART'), r53('IS'))),
    total('RN_2053_RESULTAT', '2053', 'Bénéfice ou perte (total des produits - total des charges)', [...plus('RN_2053_TOTAL_PRODUITS'), ...moins('RN_2053_TOTAL_CHARGES')], 'resultat'),
  ]);
}

const INFOS_COMMUNES_PARTIEL = [
  'Montants de l’exercice précédent (colonne N-1) : non alimentés.',
  'Renvois et cadres de bas de tableau (« dont… », parts à plus ou moins d’un an, crédit-bail, etc.) : non alimentés.',
  'Arrondi à l’euro : l’API restitue les montants au centime ; l’écran propose l’affichage en euros entiers (arrondi à l’euro le plus proche, 0,50 compté pour 1, notices 2026), sans modifier les montants exacts.',
  'Codes de cases du formulaire : à confirmer sur le millésime.',
];

const partiel = (code: string, intitule: string, intituleVerifie: boolean, motif: string, infos: string[] = INFOS_COMMUNES_PARTIEL): TableauNonCouvert =>
  ({ code, intitule, intituleVerifie, couverture: 'partiel', motif, informationsComplementairesNecessaires: infos });
const nonCouvert = (code: string, intitule: string, intituleVerifie: boolean, infos: string[]): TableauNonCouvert =>
  ({ code, intitule, intituleVerifie, couverture: 'non_couvert', motif: 'Ce tableau ne se déduit pas de la balance : il n’est pas préparé.', informationsComplementairesNecessaires: infos });

const INFOS_RESULTAT_FISCAL = [
  'Réintégrations extra-comptables (charges non déductibles, amortissements excédentaires, amendes et pénalités, impôt sur les sociétés, provisions non déductibles…).',
  'Déductions extra-comptables (produits non imposables, régime des sociétés mères, plus-values à long terme, reprises de provisions non déductibles…).',
  'Déficits reportables et leur imputation.',
];
const MOTIF_IMMOBILISATIONS_PARTIEL =
  'Cadres A et B préparés à part (D-104, champ « tableauxImmobilisations » de la réponse) : valeurs brutes, augmentations et diminutions totales déduites de la balance et du fichier des immobilisations ; la ventilation des diminutions et les réévaluations ne se déduisent pas et restent à saisir.';
const MOTIF_AMORTISSEMENTS_PARTIEL =
  'Cadre A préparé à part (D-104) : amortissements à l’ouverture, dotations, diminutions et clôture déduits de la balance ; les cadres B (amortissements dérogatoires) et C (charges réparties) ne sont pas préparés.';
const MOTIF_2033C_PARTIEL =
  'Cadres I (immobilisations) et II (amortissements) préparés à part (D-104) ; le cadre III (plus-values et moins-values de cession) n’est pas préparé : prix de cession, qualification court ou long terme et régularisations ne se déduisent pas de la balance.';
const INFOS_2054_RESTE = [
  'Ventilation des diminutions entre virements de poste à poste et cessions ou mises hors service lorsque les mouvements de crédit ne sont pas nuls.',
  'Réévaluations (colonne 2 du cadre A, colonne 4 du cadre B) et mises en équivalence ; montants « dont composants ».',
  'Codes de cases : lus sur le formulaire du millésime 2026 par extraction de texte, à confirmer visuellement ; affichage en euros entiers proposé à l’écran (montants exacts inchangés).',
];
const INFOS_2055_RESTE = [
  'Cadre B : ventilation des mouvements de la provision pour amortissements dérogatoires (compte 145) par origine ; cadre C : charges réparties sur plusieurs exercices.',
  'Ligne de suivi de la déductibilité des amortissements des fonds commerciaux acquis du 1er janvier 2022 au 31 décembre 2025 (notice 2032-NOT-SD) : non préparée.',
  'Codes de cases : lus sur le formulaire du millésime 2026 par extraction de texte, à confirmer visuellement ; affichage en euros entiers proposé à l’écran (montants exacts inchangés).',
];
const INFOS_2033C_RESTE = [
  'Cadre III : nature des immobilisations cédées, valeur d’actif, amortissements, prix de cession, plus-values et moins-values à court et long terme, régularisations.',
  'Réévaluation légale (colonne 5 du cadre I), sans code de case au formulaire : à saisir.',
  'Codes de cases : lus sur le formulaire du millésime 2026 par extraction de texte, à confirmer visuellement ; affichage en euros entiers proposé à l’écran (montants exacts inchangés).',
];
const INFOS_PROVISIONS = ['Dotations et reprises de l’exercice par nature de provision, distinction des reprises utilisées et non utilisées.', 'Caractère déductible ou non de chaque provision.'];
const INFOS_ECHEANCES = ['Ventilation de chaque créance et de chaque dette par échéance (à un an au plus, à plus d’un an, à plus de cinq ans).', 'Emprunts souscrits et remboursés dans l’exercice, prêts accordés et remboursements obtenus.'];
const INFOS_PLUS_VALUES = ['Détail de chaque cession d’immobilisation : date d’acquisition, valeur d’origine, amortissements pratiqués, prix de cession.', 'Qualification à court terme ou à long terme et régime fiscal applicable.'];
const INFOS_VALEUR_AJOUTEE = ['Ventilation fiscale de la production et des consommations au sens de la cotisation sur la valeur ajoutée (retraitements propres à cette cotisation).', 'Effectifs.'];
const INFOS_CAPITAL = ['Composition du capital : identité des associés ou actionnaires, nombre de titres et pourcentage de détention.'];
const INFOS_FILIALES = ['Liste des filiales et participations : dénomination, adresse, SIREN, pourcentage de détention.'];
const INFOS_AFFECTATION = ['Décision d’affectation du résultat de l’exercice précédent (dividendes, réserves, report à nouveau).', 'Renseignements divers : engagements de crédit-bail, effectif, rémunérations, sous-traitance, etc.'];

const TABLEAUX_NON_COUVERTS_RN: TableauNonCouvert[] = [
  partiel('2050', 'Bilan-actif', true, 'Seuls les montants de l’exercice (brut, amortissements et dépréciations, net) sont préparés, à partir de la balance.'),
  partiel('2051', 'Bilan-passif', true, 'Seuls les montants de l’exercice sont préparés, à partir de la balance (bilan avant répartition).'),
  partiel('2052', 'Compte de résultat', true, 'Seuls les montants de l’exercice sont préparés ; la ventilation France / exportation du chiffre d’affaires n’est pas faite.', [...INFOS_COMMUNES_PARTIEL, 'Ventilation du chiffre d’affaires entre la France et les exportations et livraisons intracommunautaires.']),
  partiel('2053', 'Compte de résultat (suite)', true, 'Seuls les montants de l’exercice sont préparés ; le détail des produits et charges exceptionnels et sur exercices antérieurs n’est pas fait.', [...INFOS_COMMUNES_PARTIEL, 'Détail des produits et charges exceptionnels et des produits et charges sur exercices antérieurs.']),
  partiel('2054', 'Immobilisations', true, MOTIF_IMMOBILISATIONS_PARTIEL, INFOS_2054_RESTE),
  nonCouvert('2054 bis', 'Tableau des écarts de réévaluation sur immobilisations amortissables', true, ['Réévaluations pratiquées, écarts de réévaluation et suppléments d’amortissement correspondants.']),
  partiel('2055', 'Amortissements', true, MOTIF_AMORTISSEMENTS_PARTIEL, INFOS_2055_RESTE),
  nonCouvert('2056', 'Provisions inscrites au bilan', true, INFOS_PROVISIONS),
  nonCouvert('2057', 'État des échéances des créances et des dettes à la clôture de l’exercice', true, INFOS_ECHEANCES),
  nonCouvert('2058-A', 'Détermination du résultat fiscal', true, INFOS_RESULTAT_FISCAL),
  nonCouvert('2058-B', 'Déficits, indemnités de congés payés et provisions non déductibles', true, ['Suivi des déficits reportables.', 'Indemnités pour congés à payer et charges correspondantes, provisions et charges à payer non déductibles.']),
  nonCouvert('2058-C', 'Tableau d’affectation du résultat et renseignements divers', true, INFOS_AFFECTATION),
  nonCouvert('2059-A', 'Détermination des plus-values et moins-values', true, INFOS_PLUS_VALUES),
  nonCouvert('2059-B', 'Affectation des plus-values à court terme et de fusion ou d’apport', true, INFOS_PLUS_VALUES),
  nonCouvert('2059-C', 'Suivi des moins-values à long terme', true, ['Moins-values à long terme des exercices antérieurs restant à reporter et leur imputation.']),
  nonCouvert('2059-D', 'Affectation des plus-values à long terme ; réserve spéciale pour fluctuations des cours', true, ['Réserve spéciale des plus-values à long terme et ses mouvements.']),
  nonCouvert('2059-E', 'Détermination de la valeur ajoutée produite au cours de l’exercice', true, INFOS_VALEUR_AJOUTEE),
  nonCouvert('2059-F', 'Composition du capital social', true, INFOS_CAPITAL),
  nonCouvert('2059-G', 'Filiales et participation', true, INFOS_FILIALES),
  nonCouvert('2065', 'Déclaration de résultats à l’impôt sur les sociétés et ses annexes', false, ['Résultat fiscal (issu du tableau 2058-A), identification de la société, régime d’imposition, répartition des produits des actions et parts sociales, rémunérations.', 'Liquidation de l’impôt sur les sociétés : hors périmètre.']),
];

/** Table du régime réel normal, millésime 2026 : lignes dérivées de la table PCG-SYSTEME-DE-BASE. */
export const TABLE_LIASSE_REEL_NORMAL_2026: TableLiasse = {
  id: 'LIASSE-BIC-IS-RN',
  version: '2026.1',
  regime: 'reel_normal',
  millesimeFormulaire: '2026',
  formulaire: 'n° 2050-LIASSE (tableaux n° 2050-SD à 2053-SD)',
  periodeApplication: PERIODE_TABLE,
  perimetre: PERIMETRE_LIASSE,
  source: SOURCES_FISCALES.liasseReelNormalFormulaire,
  sourcesComplementaires: [SOURCES_FISCALES.bofipListeTableauxReelNormal, SOURCES_FISCALES.liasseReelNormalNotice, SOURCES_FISCALES.conventionLiasse],
  correspondanceComptes: CORRESPONDANCE_COMPTES,
  etat: 'en_attente_de_validation_professionnelle',
  tableaux: [
    { code: '2050', intitule: 'Bilan-actif' },
    { code: '2051', intitule: 'Bilan-passif' },
    { code: '2052', intitule: 'Compte de résultat' },
    { code: '2053', intitule: 'Compte de résultat (suite)' },
  ],
  lignes: lignesReelNormal(CORRESPONDANCE_PCG),
  rubriquesSansLigne: [],
  tableauxNonCouverts: TABLEAUX_NON_COUVERTS_RN,
};

// ── Régime simplifié : lignes agrégées selon le tracé usuel des tableaux 2033-A et 2033-B (non relu sur le millésime 2026).

const NOTE_TRACE_RSI = 'Libellé et contenu de la ligne repris du tracé usuel du tableau, NON relus sur le millésime 2026 : à confirmer sur le formulaire et sa notice.';
const posteRsi = (id: string, tableau: CodeTableauLiasse, libelle: string, rubriquesPcg: string[], note: string = NOTE_TRACE_RSI): Brouillon =>
  ({ id, tableau, libelle, origineLibelle: 'trace_usuel_non_relu', nature: 'poste', rubriquesPcg, note });
const totalRsi = (id: string, tableau: CodeTableauLiasse, libelle: string, formule: Array<{ ligne: string; signe: 1 | -1 }>, nature: 'total' | 'resultat' = 'total'): Brouillon =>
  ({ id, tableau, libelle, origineLibelle: 'trace_usuel_non_relu', nature, formule, note: NOTE_TRACE_RSI });

const RSI_ACTIF_I = ['RSI_2033A_ACTIF_FONDS_COMMERCIAL', 'RSI_2033A_ACTIF_AUTRES_INCORPORELLES', 'RSI_2033A_ACTIF_CORPORELLES', 'RSI_2033A_ACTIF_FINANCIERES'];
const RSI_ACTIF_II = ['RSI_2033A_ACTIF_STOCKS_MATIERES_EN_COURS', 'RSI_2033A_ACTIF_STOCKS_MARCHANDISES', 'RSI_2033A_ACTIF_AVANCES_VERSEES', 'RSI_2033A_ACTIF_CLIENTS', 'RSI_2033A_ACTIF_AUTRES_CREANCES', 'RSI_2033A_ACTIF_VMP', 'RSI_2033A_ACTIF_DISPONIBILITES', 'RSI_2033A_ACTIF_CHARGES_CONSTATEES_AVANCE'];
const RSI_PASSIF_I = ['RSI_2033A_PASSIF_CAPITAL', 'RSI_2033A_PASSIF_ECARTS_REEVALUATION', 'RSI_2033A_PASSIF_RESERVE_LEGALE', 'RSI_2033A_PASSIF_RESERVES_REGLEMENTEES', 'RSI_2033A_PASSIF_AUTRES_RESERVES', 'RSI_2033A_PASSIF_REPORT_A_NOUVEAU', 'RSI_2033A_PASSIF_RESULTAT', 'RSI_2033A_PASSIF_PROVISIONS_REGLEMENTEES'];
const RSI_PASSIF_III = ['RSI_2033A_PASSIF_EMPRUNTS', 'RSI_2033A_PASSIF_AVANCES_RECUES', 'RSI_2033A_PASSIF_FOURNISSEURS', 'RSI_2033A_PASSIF_AUTRES_DETTES', 'RSI_2033A_PASSIF_PRODUITS_CONSTATES_AVANCE'];
const RSI_PRODUITS_EXPLOITATION = ['RSI_2033B_VENTES_MARCHANDISES', 'RSI_2033B_PRODUCTION_VENDUE', 'RSI_2033B_PRODUCTION_STOCKEE', 'RSI_2033B_PRODUCTION_IMMOBILISEE', 'RSI_2033B_SUBVENTIONS', 'RSI_2033B_AUTRES_PRODUITS'];
const RSI_CHARGES_EXPLOITATION = ['RSI_2033B_ACHATS_MARCHANDISES', 'RSI_2033B_VARIATION_STOCK_MARCHANDISES', 'RSI_2033B_ACHATS_MATIERES', 'RSI_2033B_VARIATION_STOCK_MATIERES', 'RSI_2033B_AUTRES_CHARGES_EXTERNES', 'RSI_2033B_IMPOTS_TAXES', 'RSI_2033B_REMUNERATIONS', 'RSI_2033B_CHARGES_SOCIALES', 'RSI_2033B_DOTATIONS_AMORTISSEMENTS', 'RSI_2033B_DOTATIONS_PROVISIONS', 'RSI_2033B_AUTRES_CHARGES'];

const LIGNES_RSI: LigneLiasseDefinition[] = finaliser([
  posteRsi('RSI_2033A_ACTIF_FONDS_COMMERCIAL', '2033-A', 'Immobilisations incorporelles : fonds commercial', ['A_FONDS_COMMERCIAL']),
  posteRsi('RSI_2033A_ACTIF_AUTRES_INCORPORELLES', '2033-A', 'Immobilisations incorporelles : autres', ['A_FRAIS_DEVELOPPEMENT', 'A_CONCESSIONS_BREVETS', 'A_AUTRES_INCORPORELLES', 'A_INCORPORELLES_EN_COURS']),
  posteRsi('RSI_2033A_ACTIF_CORPORELLES', '2033-A', 'Immobilisations corporelles', ['A_TERRAINS', 'A_CONSTRUCTIONS', 'A_INSTALLATIONS_TECHNIQUES', 'A_AUTRES_CORPORELLES', 'A_CORPORELLES_EN_COURS']),
  posteRsi('RSI_2033A_ACTIF_FINANCIERES', '2033-A', 'Immobilisations financières', ['A_PARTICIPATIONS', 'A_CREANCES_PARTICIPATIONS', 'A_TIAP', 'A_AUTRES_TITRES_IMMOBILISES', 'A_PRETS', 'A_AUTRES_IMMOBILISATIONS_FINANCIERES']),
  totalRsi('RSI_2033A_ACTIF_TOTAL_I', '2033-A', 'Total I : actif immobilisé', plus(...RSI_ACTIF_I)),
  posteRsi('RSI_2033A_ACTIF_STOCKS_MATIERES_EN_COURS', '2033-A', 'Stocks : matières premières, approvisionnements, en cours de production', ['A_STOCKS_MATIERES', 'A_STOCKS_EN_COURS', 'A_STOCKS_PRODUITS_FINIS'], `${NOTE_TRACE_RSI} Le rattachement des produits finis à cette ligne est une lecture à confirmer.`),
  posteRsi('RSI_2033A_ACTIF_STOCKS_MARCHANDISES', '2033-A', 'Stocks : marchandises', ['A_STOCKS_MARCHANDISES']),
  posteRsi('RSI_2033A_ACTIF_AVANCES_VERSEES', '2033-A', 'Avances et acomptes versés sur commandes', ['A_AVANCES_VERSEES']),
  posteRsi('RSI_2033A_ACTIF_CLIENTS', '2033-A', 'Créances : clients et comptes rattachés', ['A_CLIENTS']),
  posteRsi('RSI_2033A_ACTIF_AUTRES_CREANCES', '2033-A', 'Créances : autres', ['A_AUTRES_CREANCES']),
  posteRsi('RSI_2033A_ACTIF_VMP', '2033-A', 'Valeurs mobilières de placement', ['A_VMP_ACTIONS_PROPRES', 'A_VMP_AUTRES_TITRES']),
  posteRsi('RSI_2033A_ACTIF_DISPONIBILITES', '2033-A', 'Disponibilités', ['A_DISPONIBILITES']),
  posteRsi('RSI_2033A_ACTIF_CHARGES_CONSTATEES_AVANCE', '2033-A', 'Charges constatées d’avance', ['A_CHARGES_CONSTATEES_AVANCE']),
  totalRsi('RSI_2033A_ACTIF_TOTAL_II', '2033-A', 'Total II : actif circulant', plus(...RSI_ACTIF_II)),
  totalRsi('RSI_2033A_ACTIF_TOTAL_GENERAL', '2033-A', 'Total général de l’actif (I + II)', plus('RSI_2033A_ACTIF_TOTAL_I', 'RSI_2033A_ACTIF_TOTAL_II')),
  posteRsi('RSI_2033A_PASSIF_CAPITAL', '2033-A', 'Capital social ou individuel', ['P_CAPITAL']),
  posteRsi('RSI_2033A_PASSIF_ECARTS_REEVALUATION', '2033-A', 'Écarts de réévaluation', ['P_ECARTS_REEVALUATION']),
  posteRsi('RSI_2033A_PASSIF_RESERVE_LEGALE', '2033-A', 'Réserve légale', ['P_RESERVE_LEGALE']),
  posteRsi('RSI_2033A_PASSIF_RESERVES_REGLEMENTEES', '2033-A', 'Réserves réglementées', ['P_RESERVES_REGLEMENTEES']),
  posteRsi('RSI_2033A_PASSIF_AUTRES_RESERVES', '2033-A', 'Autres réserves', ['P_RESERVES_STATUTAIRES', 'P_AUTRES_RESERVES']),
  posteRsi('RSI_2033A_PASSIF_REPORT_A_NOUVEAU', '2033-A', 'Report à nouveau', ['P_REPORT_A_NOUVEAU']),
  posteRsi('RSI_2033A_PASSIF_RESULTAT', '2033-A', 'Résultat de l’exercice', ['P_RESULTAT']),
  posteRsi('RSI_2033A_PASSIF_PROVISIONS_REGLEMENTEES', '2033-A', 'Provisions réglementées', ['P_PROVISIONS_REGLEMENTEES']),
  totalRsi('RSI_2033A_PASSIF_TOTAL_I', '2033-A', 'Total I : capitaux propres', plus(...RSI_PASSIF_I)),
  posteRsi('RSI_2033A_PASSIF_PROVISIONS', '2033-A', 'Provisions pour risques et charges (II)', ['P_PROVISIONS_RISQUES', 'P_PROVISIONS_CHARGES']),
  posteRsi('RSI_2033A_PASSIF_EMPRUNTS', '2033-A', 'Emprunts et dettes assimilées', ['P_EMPRUNTS_OBLIGATAIRES_CONVERTIBLES', 'P_AUTRES_EMPRUNTS_OBLIGATAIRES', 'P_EMPRUNTS_ETABLISSEMENTS_CREDIT', 'P_EMPRUNTS_DETTES_FINANCIERES_DIVERSES']),
  posteRsi('RSI_2033A_PASSIF_AVANCES_RECUES', '2033-A', 'Avances et acomptes reçus sur commandes en cours', ['P_AVANCES_RECUES']),
  posteRsi('RSI_2033A_PASSIF_FOURNISSEURS', '2033-A', 'Fournisseurs et comptes rattachés', ['P_FOURNISSEURS']),
  posteRsi('RSI_2033A_PASSIF_AUTRES_DETTES', '2033-A', 'Autres dettes', ['P_DETTES_FISCALES_SOCIALES', 'P_DETTES_IMMOBILISATIONS', 'P_AUTRES_DETTES'], `${NOTE_TRACE_RSI} Les comptes courants d’associés créditeurs sont, dans la table des comptes, classés en « Emprunts et dettes financières diverses » : leur mention distincte sur le formulaire est à faire à la main.`),
  posteRsi('RSI_2033A_PASSIF_PRODUITS_CONSTATES_AVANCE', '2033-A', 'Produits constatés d’avance', ['P_PRODUITS_CONSTATES_AVANCE']),
  totalRsi('RSI_2033A_PASSIF_TOTAL_III', '2033-A', 'Total III : dettes', plus(...RSI_PASSIF_III)),
  totalRsi('RSI_2033A_PASSIF_TOTAL_GENERAL', '2033-A', 'Total général du passif (I + II + III)', plus('RSI_2033A_PASSIF_TOTAL_I', 'RSI_2033A_PASSIF_PROVISIONS', 'RSI_2033A_PASSIF_TOTAL_III')),
  posteRsi('RSI_2033B_VENTES_MARCHANDISES', '2033-B', 'Ventes de marchandises', ['PE_VENTES_MARCHANDISES']),
  posteRsi('RSI_2033B_PRODUCTION_VENDUE', '2033-B', 'Production vendue (biens et services)', ['PE_PRODUCTION_VENDUE'], `${NOTE_TRACE_RSI} Le formulaire distingue les biens et les services : cette ventilation ne se déduit pas avec certitude des comptes et n’est pas faite.`),
  posteRsi('RSI_2033B_PRODUCTION_STOCKEE', '2033-B', 'Production stockée', ['PE_PRODUCTION_STOCKEE']),
  posteRsi('RSI_2033B_PRODUCTION_IMMOBILISEE', '2033-B', 'Production immobilisée', ['PE_PRODUCTION_IMMOBILISEE']),
  posteRsi('RSI_2033B_SUBVENTIONS', '2033-B', 'Subventions d’exploitation', ['PE_SUBVENTIONS']),
  posteRsi('RSI_2033B_AUTRES_PRODUITS', '2033-B', 'Autres produits', ['PE_REPRISES', 'PE_CESSIONS_IMMOBILISATIONS', 'PE_AUTRES_PRODUITS'], `${NOTE_TRACE_RSI} Y sont regroupés les reprises d’exploitation et les produits des cessions d’immobilisations incorporelles et corporelles (classés en exploitation depuis le règlement ANC n° 2022-06).`),
  totalRsi('RSI_2033B_TOTAL_PRODUITS_EXPLOITATION', '2033-B', 'Total des produits d’exploitation hors TVA (I)', plus(...RSI_PRODUITS_EXPLOITATION)),
  posteRsi('RSI_2033B_ACHATS_MARCHANDISES', '2033-B', 'Achats de marchandises', ['CE_ACHATS_MARCHANDISES']),
  posteRsi('RSI_2033B_VARIATION_STOCK_MARCHANDISES', '2033-B', 'Variation de stock (marchandises)', ['CE_VARIATION_STOCKS_MARCHANDISES']),
  posteRsi('RSI_2033B_ACHATS_MATIERES', '2033-B', 'Achats de matières premières et autres approvisionnements', ['CE_ACHATS_MATIERES']),
  posteRsi('RSI_2033B_VARIATION_STOCK_MATIERES', '2033-B', 'Variation de stock (matières premières et approvisionnements)', ['CE_VARIATION_STOCKS_MATIERES']),
  posteRsi('RSI_2033B_AUTRES_CHARGES_EXTERNES', '2033-B', 'Autres charges externes', ['CE_AUTRES_ACHATS_CHARGES_EXTERNES']),
  posteRsi('RSI_2033B_IMPOTS_TAXES', '2033-B', 'Impôts, taxes et versements assimilés', ['CE_IMPOTS_TAXES']),
  posteRsi('RSI_2033B_REMUNERATIONS', '2033-B', 'Rémunérations du personnel', ['CE_SALAIRES']),
  posteRsi('RSI_2033B_CHARGES_SOCIALES', '2033-B', 'Charges sociales', ['CE_COTISATIONS_SOCIALES']),
  posteRsi('RSI_2033B_DOTATIONS_AMORTISSEMENTS', '2033-B', 'Dotations aux amortissements', ['CE_DOTATIONS_AMORTISSEMENTS']),
  posteRsi('RSI_2033B_DOTATIONS_PROVISIONS', '2033-B', 'Dotations aux provisions', ['CE_DOTATIONS_DEPRECIATIONS_IMMOBILISATIONS', 'CE_DOTATIONS_DEPRECIATIONS_ACTIF_CIRCULANT', 'CE_DOTATIONS_PROVISIONS'], `${NOTE_TRACE_RSI} Y sont regroupées les dotations aux dépréciations et aux provisions d’exploitation.`),
  posteRsi('RSI_2033B_AUTRES_CHARGES', '2033-B', 'Autres charges', ['CE_VALEURS_COMPTABLES_CESSIONS', 'CE_AUTRES_CHARGES'], `${NOTE_TRACE_RSI} Y sont regroupées les valeurs comptables des immobilisations incorporelles et corporelles cédées (classées en exploitation depuis le règlement ANC n° 2022-06).`),
  totalRsi('RSI_2033B_TOTAL_CHARGES_EXPLOITATION', '2033-B', 'Total des charges d’exploitation (II)', plus(...RSI_CHARGES_EXPLOITATION)),
  totalRsi('RSI_2033B_RESULTAT_EXPLOITATION', '2033-B', 'Résultat d’exploitation (I - II)', [...plus('RSI_2033B_TOTAL_PRODUITS_EXPLOITATION'), ...moins('RSI_2033B_TOTAL_CHARGES_EXPLOITATION')], 'resultat'),
  posteRsi('RSI_2033B_PRODUITS_FINANCIERS', '2033-B', 'Produits financiers (III)', ['PF_PARTICIPATION', 'PF_AUTRES_VALEURS_MOBILIERES', 'PF_AUTRES_INTERETS', 'PF_REPRISES', 'PF_DIFFERENCES_CHANGE', 'PF_CESSIONS_IMMOBILISATIONS_FINANCIERES', 'PF_CESSIONS_VMP']),
  posteRsi('RSI_2033B_PRODUITS_EXCEPTIONNELS', '2033-B', 'Produits exceptionnels (IV)', ['PX']),
  posteRsi('RSI_2033B_CHARGES_FINANCIERES', '2033-B', 'Charges financières (V)', ['CF_DOTATIONS', 'CF_INTERETS', 'CF_DIFFERENCES_CHANGE', 'CF_VALEURS_COMPTABLES_IMMOBILISATIONS_FINANCIERES', 'CF_CESSIONS_VMP']),
  posteRsi('RSI_2033B_CHARGES_EXCEPTIONNELLES', '2033-B', 'Charges exceptionnelles (VI)', ['CX']),
  posteRsi('RSI_2033B_IMPOTS_BENEFICES', '2033-B', 'Impôts sur les bénéfices (VII)', ['IS']),
  totalRsi('RSI_2033B_RESULTAT', '2033-B', 'Bénéfice ou perte : produits (I + III + IV) - charges (II + V + VI + VII)',
    [...plus('RSI_2033B_TOTAL_PRODUITS_EXPLOITATION', 'RSI_2033B_PRODUITS_FINANCIERS', 'RSI_2033B_PRODUITS_EXCEPTIONNELS'), ...moins('RSI_2033B_TOTAL_CHARGES_EXPLOITATION', 'RSI_2033B_CHARGES_FINANCIERES', 'RSI_2033B_CHARGES_EXCEPTIONNELLES', 'RSI_2033B_IMPOTS_BENEFICES')], 'resultat'),
]);

const SANS_LIGNE_BILAN_SIMPLIFIE = 'Le bilan simplifié ne comporte pas de ligne certaine pour ce poste (tracé non relu) : la ligne d’accueil est à déterminer sur le formulaire et sa notice.';
const SANS_LIGNE_RESULTAT_SIMPLIFIE = 'Le compte de résultat simplifié ne comporte pas de ligne certaine pour ce poste (tracé non relu) : la ligne d’accueil est à déterminer sur le formulaire et sa notice.';

const TABLEAUX_NON_COUVERTS_RSI: TableauNonCouvert[] = [
  partiel('2033-A', 'Bilan simplifié actif et passif', true, 'Seuls les montants de l’exercice sont préparés ; certains postes du bilan n’ont pas de ligne certaine dans le tableau et restent non affectés.'),
  partiel('2033-B', 'Compte de résultat simplifié de l’exercice', true, 'Seule la partie comptable (résultat comptable) est préparée ; la partie « résultat fiscal » (réintégrations, déductions, déficits) ne l’est pas.', [...INFOS_COMMUNES_PARTIEL, ...INFOS_RESULTAT_FISCAL, 'Ventilation de la production vendue entre biens et services, exportations et livraisons intracommunautaires.']),
  partiel('2033-C', 'Immobilisations, amortissements, plus-values et moins-values', true, MOTIF_2033C_PARTIEL, INFOS_2033C_RESTE),
  nonCouvert('2033-D', 'Relevé des provisions, amortissements dérogatoires, déficits reportables et divers', true, [...INFOS_PROVISIONS, 'Amortissements dérogatoires.', 'Déficits reportables et leur imputation.']),
  nonCouvert('2033-E', 'Tableau de détermination de la valeur ajoutée produite au cours de l’exercice et des effectifs', true, INFOS_VALEUR_AJOUTEE),
  nonCouvert('2033-F', 'Tableau de composition du capital social', true, INFOS_CAPITAL),
  nonCouvert('2033-G', 'Filiales et participations', true, INFOS_FILIALES),
  nonCouvert('2065', 'Déclaration de résultats à l’impôt sur les sociétés et ses annexes', false, ['Résultat fiscal, identification de la société, régime d’imposition, répartition des produits des actions et parts sociales, rémunérations.', 'Liquidation de l’impôt sur les sociétés : hors périmètre.']),
];

/** Table du régime simplifié, millésime 2026. */
export const TABLE_LIASSE_REEL_SIMPLIFIE_2026: TableLiasse = {
  id: 'LIASSE-BIC-IS-RSI',
  version: '2026.1',
  regime: 'reel_simplifie',
  millesimeFormulaire: '2026',
  formulaire: 'n° 2033-SD (tableaux n° 2033-A-SD et 2033-B-SD)',
  periodeApplication: PERIODE_TABLE,
  perimetre: PERIMETRE_LIASSE,
  source: SOURCES_FISCALES.liasseReelSimplifieFormulaire,
  sourcesComplementaires: [SOURCES_FISCALES.bofipListeTableauxReelSimplifie, SOURCES_FISCALES.bofipSeuilsRegimeSimplifie, SOURCES_FISCALES.conventionLiasse],
  correspondanceComptes: CORRESPONDANCE_COMPTES,
  etat: 'en_attente_de_validation_professionnelle',
  tableaux: [
    { code: '2033-A', intitule: 'Bilan simplifié actif et passif' },
    { code: '2033-B', intitule: 'Compte de résultat simplifié de l’exercice' },
  ],
  lignes: LIGNES_RSI,
  rubriquesSansLigne: [
    ...['A_CAPITAL_SOUSCRIT_NON_APPELE', 'A_FRAIS_ETABLISSEMENT', 'A_CAPITAL_APPELE_NON_VERSE', 'A_INSTRUMENTS_FINANCIERS_JETONS', 'A_FRAIS_EMISSION_EMPRUNTS', 'A_PRIMES_REMBOURSEMENT', 'A_ECARTS_CONVERSION',
      'P_PRIMES', 'P_ECART_EQUIVALENCE', 'P_SUBVENTIONS_INVESTISSEMENT', 'P_FONDS_NON_REMBOURSABLES', 'P_AVANCES_CONDITIONNEES', 'P_DROITS_CONCEDANT', 'P_INSTRUMENTS_FINANCIERS', 'P_ECARTS_CONVERSION',
    ].map((code) => ({ code, motif: SANS_LIGNE_BILAN_SIMPLIFIE })),
    ...['QPP', 'QPC', 'PART'].map((code) => ({ code, motif: SANS_LIGNE_RESULTAT_SIMPLIFIE })),
  ],
  tableauxNonCouverts: TABLEAUX_NON_COUVERTS_RSI,
};

export const TABLES_LIASSE: readonly TableLiasse[] = Object.freeze([TABLE_LIASSE_REEL_NORMAL_2026, TABLE_LIASSE_REEL_SIMPLIFIE_2026]);

/** Table applicable à un régime et à un exercice, ou `null` si aucune table ne couvre l'exercice. */
export function tableLiassePour(regime: RegimeLiasse, exercice: { debut: string; fin: string }): TableLiasse | null {
  if (!estDateIso(exercice.debut) || !estDateIso(exercice.fin)) throw new Error('Exercice invalide : dates ISO AAAA-MM-JJ attendues.');
  return TABLES_LIASSE.find((t) => t.regime === regime && exercice.debut >= t.periodeApplication.exercicesOuvertsAPartirDu && exercice.fin <= t.periodeApplication.exercicesClosAuPlusTardLe) ?? null;
}

/**
 * Contrôle de forme d'une table de liasse au regard de la table des comptes : identifiants uniques, rubriques connues,
 * chaque rubrique porteuse de comptes reprise par UNE ligne au plus ou déclarée sans ligne, formules résolues et sans cycle.
 * Liste d'erreurs (vide si la table est cohérente).
 */
export function verifierTableLiasse(table: TableLiasse, correspondance: CorrespondanceRubriques = CORRESPONDANCE_PCG): string[] {
  const erreurs: string[] = [];
  if (table.correspondanceComptes.id !== correspondance.id || table.correspondanceComptes.version !== correspondance.version) {
    erreurs.push(`La table vise la correspondance ${table.correspondanceComptes.id} ${table.correspondanceComptes.version}, pas ${correspondance.id} ${correspondance.version}.`);
  }
  const parId = new Map<string, LigneLiasseDefinition>();
  for (const l of table.lignes) {
    if (parId.has(l.id)) erreurs.push(`Identifiant de ligne en double : ${l.id}.`);
    parId.set(l.id, l);
    if (!table.tableaux.some((t) => t.code === l.tableau)) erreurs.push(`Ligne ${l.id} : tableau ${l.tableau} absent de la table.`);
    if (l.nature === 'poste' && (l.rubriquesPcg.length === 0 || l.formule.length > 0)) erreurs.push(`Ligne ${l.id} : un poste reprend des rubriques et n’a pas de formule.`);
    if (l.nature !== 'poste' && (l.formule.length === 0 || l.rubriquesPcg.length > 0)) erreurs.push(`Ligne ${l.id} : un total a une formule et ne reprend aucune rubrique.`);
  }
  const parents = new Set(correspondance.rubriques.map((r) => r.parent).filter((p): p is string => p !== null));
  const feuilles = correspondance.rubriques.filter((r) => !parents.has(r.code));
  const codesFeuilles = new Set(feuilles.map((r) => r.code));
  const reprises = new Map<string, string>();
  for (const l of table.lignes) {
    for (const code of l.rubriquesPcg) {
      if (!codesFeuilles.has(code)) erreurs.push(`Ligne ${l.id} : ${code} n’est pas une rubrique porteuse de comptes de la table ${correspondance.id}.`);
      const deja = reprises.get(code);
      if (deja !== undefined) erreurs.push(`Rubrique ${code} reprise deux fois (${deja} et ${l.id}).`);
      reprises.set(code, l.id);
    }
    for (const f of l.formule) if (!parId.has(f.ligne)) erreurs.push(`Ligne ${l.id} : formule visant une ligne inconnue ${f.ligne}.`);
  }
  const sansLigne = new Set<string>();
  for (const s of table.rubriquesSansLigne) {
    if (!codesFeuilles.has(s.code)) erreurs.push(`Rubrique sans ligne inconnue : ${s.code}.`);
    if (reprises.has(s.code)) erreurs.push(`Rubrique ${s.code} à la fois reprise par une ligne et déclarée sans ligne.`);
    if (sansLigne.has(s.code)) erreurs.push(`Rubrique sans ligne en double : ${s.code}.`);
    sansLigne.add(s.code);
  }
  for (const r of feuilles) if (!reprises.has(r.code) && !sansLigne.has(r.code)) erreurs.push(`Rubrique ${r.code} ni reprise par une ligne ni déclarée sans ligne.`);
  // Cycles dans les formules.
  const etat = new Map<string, 'en_cours' | 'fait'>();
  const visiter = (id: string): void => {
    if (etat.get(id) === 'fait') return;
    if (etat.get(id) === 'en_cours') { erreurs.push(`Formule cyclique passant par ${id}.`); return; }
    etat.set(id, 'en_cours');
    for (const f of parId.get(id)?.formule ?? []) visiter(f.ligne);
    etat.set(id, 'fait');
  };
  for (const l of table.lignes) visiter(l.id);
  return erreurs;
}

// ───────────────────────────── Calcul ─────────────────────────────

const LIBELLES_TERRITOIRES: Record<TerritoireFiscal, string> = {
  metropole: 'France métropolitaine', guadeloupe: 'Guadeloupe', martinique: 'Martinique', guyane: 'Guyane', reunion: 'La Réunion', mayotte: 'Mayotte', autre: 'autre territoire', a_confirmer: 'à confirmer',
};

/** Caractéristiques du dossier qui bornent le périmètre : partagées avec les tableaux 2054, 2055 et 2033-C (même abstention). */
export type PerimetreLiasse = Pick<DemandeLiasse, 'exercice' | 'regime' | 'territoire' | 'impotSurLeResultat' | 'referentielComptable' | 'devise' | 'societeCommerciale'>;
export function motifsAbstention(d: PerimetreLiasse): MotifAbstention[] {
  const motifs: MotifAbstention[] = [];
  if (d.territoire === 'a_confirmer') motifs.push({ code: 'territoire_a_confirmer', message: 'Territoire fiscal à confirmer : la liasse n’est préparée que pour la France métropolitaine.' });
  else if (d.territoire !== 'metropole') motifs.push({ code: 'territoire_hors_perimetre', message: `Territoire fiscal hors périmètre (${LIBELLES_TERRITOIRES[d.territoire] ?? String(d.territoire)}) : la liasse n’est préparée que pour la France métropolitaine.` });
  if (d.impotSurLeResultat === 'a_confirmer') motifs.push({ code: 'impot_a_confirmer', message: 'Impôt sur le résultat à confirmer : la liasse n’est préparée que pour une société soumise à l’impôt sur les sociétés.' });
  else if (d.impotSurLeResultat !== 'is') motifs.push({ code: 'impot_hors_perimetre', message: 'Résultat non soumis à l’impôt sur les sociétés : hors périmètre.' });
  if (d.societeCommerciale === null) motifs.push({ code: 'forme_a_confirmer', message: 'Forme de l’entité non renseignée : la liasse n’est préparée que pour une société commerciale.' });
  else if (!d.societeCommerciale) motifs.push({ code: 'forme_hors_perimetre', message: 'L’entité n’est pas une société commerciale : hors périmètre.' });
  if (d.referentielComptable.trim().toUpperCase() !== 'PCG') motifs.push({ code: 'referentiel_hors_perimetre', message: `Référentiel comptable « ${d.referentielComptable} » hors périmètre : seul le plan comptable général est couvert.` });
  if (d.devise.trim().toUpperCase() !== 'EUR') motifs.push({ code: 'devise_hors_perimetre', message: `Devise « ${d.devise} » hors périmètre : seuls les comptes tenus en euros sont couverts.` });
  if (!estDateIso(d.exercice.debut) || !estDateIso(d.exercice.fin) || d.exercice.fin < d.exercice.debut) {
    motifs.push({ code: 'exercice_invalide', message: 'Exercice invalide : dates ISO AAAA-MM-JJ attendues, clôture postérieure ou égale à l’ouverture.' });
  } else if (tableLiassePour(d.regime, d.exercice) === null || correspondancePour(d.exercice.debut) === null) {
    motifs.push({
      code: 'exercice_hors_periode',
      message: `Exercice du ${d.exercice.debut} au ${d.exercice.fin} hors de la période couverte par la table de correspondance (${PERIODE_TABLE.libelle}) : aucun chiffre n’est produit.`,
    });
  }
  return motifs;
}

interface Cumul { brut: Decimal; deduction: Decimal; net: Decimal }

/** Colonne de l'actif (brut ou amortissements et dépréciations) dans laquelle la table des comptes range un compte. */
export function colonneDuCompte(definition: RubriqueDefinition | undefined, compteNum: string): 'brut' | 'amortissements_depreciations' | null {
  if (definition === undefined || definition.etat !== 'bilan_actif') return null;
  const deduction = definition.regles.some((g) => g.colonne === 'amortissements_depreciations' && g.prefixes.some((p) => compteNum.startsWith(p)) && !(g.saufPrefixes ?? []).some((p) => compteNum.startsWith(p)));
  return deduction ? 'amortissements_depreciations' : 'brut';
}

function controle(code: string, ecart: Decimal | null, ok: string, ko: string, nonVerifiable: string): ControleEtat {
  if (ecart === null) return { code, statut: 'non_verifiable', message: nonVerifiable, ecart: null };
  return ecart.isZero() ? { code, statut: 'ok', message: ok, ecart: '0.00' } : { code, statut: 'ecart', message: `${ko} Écart : ${versChaine(ecart)}. Aucun ajustement n’est pratiqué.`, ecart: versChaine(ecart) };
}

const LIGNES_CLES: Record<RegimeLiasse, { actif: string; passif: string; resultatBilan: string; resultat: string }> = {
  reel_normal: { actif: 'RN_2050_TOTAL_GENERAL', passif: 'RN_2051_TOTAL_GENERAL', resultatBilan: 'RN_2051_P_RESULTAT', resultat: 'RN_2053_RESULTAT' },
  reel_simplifie: { actif: 'RSI_2033A_ACTIF_TOTAL_GENERAL', passif: 'RSI_2033A_PASSIF_TOTAL_GENERAL', resultatBilan: 'RSI_2033A_PASSIF_RESULTAT', resultat: 'RSI_2033B_RESULTAT' },
};

/**
 * Prépare le projet de liasse fiscale d'un exercice à partir de sa balance. S'abstient hors périmètre.
 * Le résultat est sérialisable en JSON ; tous les montants sont des chaînes décimales à deux décimales.
 */
/**
 * Colonne N-1 : l'exercice précédent est préparé par la même fonction (même table, mêmes règles, mêmes abstentions).
 * Il doit être CONTIGU (clôture N-1 + 1 jour = ouverture N) ; sinon aucune colonne.
 */
function calculerPrecedent(demande: DemandeLiasse): { projet: LiasseProjet | null; motifs: string[]; reserves: string[] } {
  const p = demande.precedent;
  if (p === undefined || p === null) return { projet: null, motifs: [demande.motifPrecedentAbsent ?? MOTIF_SANS_PRECEDENT], reserves: [] };
  const v = verifierExercicePrecedent(demande.exercice, p.exercice);
  if (v.motif !== null) return { projet: null, motifs: [v.motif], reserves: [] };
  const r = preparerLiasse({ ...demande, balance: p.balance, exercice: p.exercice, precedent: null });
  if (r.statut !== 'projet') return { projet: null, motifs: ['L’exercice précédent sort du périmètre couvert : ' + r.motifs.map((m) => m.message).join(' ')], reserves: [] };
  return { projet: r, motifs: [], reserves: v.reserves };
}

export function preparerLiasse(demande: DemandeLiasse): ResultatLiasse {
  const motifs = motifsAbstention(demande);
  if (motifs.length > 0) return { statut: 'abstention', motifs, perimetreCouvert: PERIMETRE_LIASSE, mention: MENTION_PROJET };
  const table = tableLiassePour(demande.regime, demande.exercice) as TableLiasse;
  const correspondance = correspondancePour(demande.exercice.debut) as CorrespondanceRubriques;
  const erreursTable = verifierTableLiasse(table, correspondance);

  const { balance } = demande;
  const resultat = projeterCompteDeResultat(balance, correspondance);
  const resultatProjete = resultat.totaux['resultat'];
  const bilan = projeterBilan(balance, correspondance, resultatProjete === undefined ? {} : { resultatExercice: resultatProjete });
  const definitions = new Map(correspondance.rubriques.map((r) => [r.code, r]));
  const projetees = new Map<string, RubriqueProjetee>();
  for (const r of [...bilan.rubriques, ...resultat.rubriques]) projetees.set(r.code, r);

  const contributeurs = (code: string): CompteContributeur[] =>
    (projetees.get(code)?.comptes ?? []).map((c) => ({ compteNum: c.compteNum, compteLib: c.compteLib, montant: c.montant, rubriquePcg: code, colonne: colonneDuCompte(definitions.get(code), c.compteNum) }));
  const cumulRubrique = (code: string): Cumul => {
    const r = projetees.get(code);
    if (r === undefined) return { brut: ZERO, deduction: ZERO, net: ZERO };
    const net = dec(r.montant);
    return r.brut === undefined || r.amortissementsDepreciations === undefined ? { brut: net, deduction: ZERO, net } : { brut: dec(r.brut), deduction: dec(r.amortissementsDepreciations), net };
  };

  const definitionsLignes = new Map(table.lignes.map((l) => [l.id, l]));
  const cumuls = new Map<string, Cumul>();
  const calculer = (id: string, pile: ReadonlySet<string>): Cumul => {
    const connu = cumuls.get(id);
    if (connu !== undefined) return connu;
    const l = definitionsLignes.get(id);
    let brut = ZERO;
    let deduction = ZERO;
    if (l !== undefined && !pile.has(id)) {
      for (const code of l.rubriquesPcg) { const c = cumulRubrique(code); brut = brut.plus(c.brut); deduction = deduction.plus(c.deduction); }
      for (const f of l.formule) { const c = calculer(f.ligne, new Set([...pile, id])); brut = brut.plus(c.brut.times(f.signe)); deduction = deduction.plus(c.deduction.times(f.signe)); }
    }
    const cumul = { brut, deduction, net: brut.minus(deduction) };
    cumuls.set(id, cumul);
    return cumul;
  };

  const precedentCalcule = calculerPrecedent(demande);
  const n1Projet = precedentCalcule.projet;
  const valeurN1 = (id: string): ValeurN1 | null => {
    if (n1Projet === null) return null;
    const c = n1Projet.tableaux.flatMap((t) => t.lignes).find((x) => x.ligne === id);
    if (c === undefined) return null;
    return { montant: c.montant, ...(c.brut !== undefined ? { brut: c.brut } : {}), ...(c.amortissementsDepreciations !== undefined ? { amortissementsDepreciations: c.amortissementsDepreciations } : {}) };
  };

  const versCase = (l: LigneLiasseDefinition): CaseLiasse => {
    const c = calculer(l.id, new Set());
    const formule = l.formule.length === 0 ? null : l.formule.map((f, i) => `${f.signe === 1 ? (i === 0 ? '' : '+ ') : '- '}${f.ligne}`).join(' ');
    return {
      ligne: l.id,
      tableau: l.tableau,
      libelle: l.libelle,
      nature: l.nature,
      codeCase: l.codeCase,
      etatCodeCase: l.etatCodeCase,
      ...(l.avecColonnesActif ? { brut: versChaine(c.brut), amortissementsDepreciations: versChaine(c.deduction) } : {}),
      n1: valeurN1(l.id),
      montant: versChaine(c.net),
      comptes: l.rubriquesPcg.flatMap(contributeurs),
      tracabilite: { table: { id: table.id, version: table.version }, correspondanceComptes: { id: correspondance.id, version: correspondance.version }, rubriquesPcg: l.rubriquesPcg, formule },
      note: l.note,
    };
  };
  const tries = [...table.lignes].sort((a, b) => a.ordre - b.ordre);
  const tableaux = table.tableaux.map((t) => ({ code: t.code, intitule: t.intitule, lignes: tries.filter((l) => l.tableau === t.code).map(versCase) }));

  const rubriquesNonAffectees = table.rubriquesSansLigne
    .map((s) => ({ code: s.code, libelle: definitions.get(s.code)?.libelle ?? s.code, montant: versChaine(cumulRubrique(s.code).net), motif: s.motif, comptes: contributeurs(s.code) }))
    .filter((r) => r.comptes.length > 0 || r.montant !== '0.00');

  const cles = LIGNES_CLES[table.regime];
  const net = (id: string): Decimal => calculer(id, new Set()).net;
  const totalActif = net(cles.actif);
  const totalPassif = net(cles.passif);
  const resultatBilan = net(cles.resultatBilan);
  const resultatLiasse = net(cles.resultat);
  const totaux: Record<string, ChaineDecimale> = {
    total_actif_brut: versChaine(calculer(cles.actif, new Set()).brut),
    total_actif_amortissements_depreciations: versChaine(calculer(cles.actif, new Set()).deduction),
    total_actif: versChaine(totalActif),
    total_passif: versChaine(totalPassif),
    resultat_bilan: versChaine(resultatBilan),
    resultat_compte_de_resultat: versChaine(resultatLiasse),
  };

  const vide = balance.lignes.length === 0;
  const reprendre = (source: EtatProjet, code: string): ControleEtat => source.controles.find((c) => c.code === code) ?? { code, statut: 'non_verifiable', message: 'Contrôle absent de l’état source.', ecart: null };
  const total = (source: EtatProjet, cle: string): Decimal | null => (source.totaux[cle] === undefined || vide ? null : dec(source.totaux[cle] as string));
  const ecartAvec = (valeur: Decimal, reference: Decimal | null): Decimal | null => (reference === null ? null : valeur.minus(reference));
  const tableauBilan = table.regime === 'reel_normal' ? '2050 et 2051' : '2033-A';
  const tableauResultat = table.regime === 'reel_normal' ? '2053' : '2033-B';
  const controles: ControleEtat[] = [
    reprendre(bilan, 'balance_equilibree'),
    controle('total_actif_egal_total_passif', vide ? null : totalActif.minus(totalPassif),
      `Tableau ${tableauBilan} : total de l’actif égal au total du passif.`,
      `Tableau ${tableauBilan} : total de l’actif (${versChaine(totalActif)}) différent du total du passif (${versChaine(totalPassif)}) : balance déséquilibrée, comptes non affectés ou postes sans ligne.`,
      'Balance vide : égalité actif / passif non vérifiable.'),
    controle('resultat_compte_de_resultat_egal_resultat_bilan', vide ? null : resultatLiasse.minus(resultatBilan),
      `Le résultat du tableau ${tableauResultat} est égal au résultat porté au bilan.`,
      `Résultat du tableau ${tableauResultat} (${versChaine(resultatLiasse)}) différent du résultat porté au bilan (${versChaine(resultatBilan)}) : comptes de gestion non affectés ou postes sans ligne.`,
      'Balance vide : concordance des résultats non vérifiable.'),
    controle('report_total_actif_projet_de_bilan', ecartAvec(totalActif, total(bilan, 'total_actif')),
      'Le total de l’actif de la liasse reprend le total de l’actif du projet de bilan.',
      `Le total de l’actif de la liasse (${versChaine(totalActif)}) diffère de celui du projet de bilan (${bilan.totaux['total_actif'] ?? '—'}) : des postes du bilan n’ont pas de ligne dans le tableau.`,
      'Report du total de l’actif non vérifiable.'),
    controle('report_total_passif_projet_de_bilan', ecartAvec(totalPassif, total(bilan, 'total_passif')),
      'Le total du passif de la liasse reprend le total du passif du projet de bilan.',
      `Le total du passif de la liasse (${versChaine(totalPassif)}) diffère de celui du projet de bilan (${bilan.totaux['total_passif'] ?? '—'}) : des postes du bilan n’ont pas de ligne dans le tableau.`,
      'Report du total du passif non vérifiable.'),
    controle('report_resultat_projet_de_compte_de_resultat', ecartAvec(resultatLiasse, total(resultat, 'resultat')),
      'Le résultat de la liasse reprend le résultat du projet de compte de résultat.',
      `Le résultat de la liasse (${versChaine(resultatLiasse)}) diffère de celui du projet de compte de résultat (${resultat.totaux['resultat'] ?? '—'}) : des postes du compte de résultat n’ont pas de ligne dans le tableau.`,
      'Report du résultat non vérifiable.'),
    reprendre(resultat, 'resultat_egal_solde_des_classes_6_et_7'),
    reprendre(bilan, 'tiers_soldes_inverses_non_reclasses'),
  ];

  const comptesNonAffectes = [...bilan.comptesNonAffectes, ...resultat.comptesNonAffectes].sort((a, b) => (a.compteNum < b.compteNum ? -1 : a.compteNum > b.compteNum ? 1 : 0));
  const manques: string[] = [
    ...erreursTable.map((e) => `Table de liasse incohérente : ${e}`),
    ...new Set([...bilan.motifsIncompletude, ...resultat.motifsIncompletude]),
    ...rubriquesNonAffectees.filter((r) => r.montant !== '0.00').map((r) => `Poste « ${r.libelle} » (${r.montant}) sans ligne certaine dans le tableau : non affecté, absent de tout total de la liasse.`),
    ...controles.filter((c) => c.statut === 'ecart').map((c) => `Écart au contrôle ${c.code} : ${c.message}`),
    'Codes de cases non fournis : le formulaire du millésime n’a pas pu être lu ; les identifiants de lignes sont internes et la correspondance avec les cases est à confirmer.',
    ...table.tableauxNonCouverts.map((t) => `Tableau ${t.code} « ${t.intitule} » ${t.couverture === 'partiel' ? 'partiellement couvert' : 'non couvert'} : ${t.informationsComplementairesNecessaires.join(' ')}`),
    ...(n1Projet === null ? precedentCalcule.motifs.map((m) => `Colonne N-1 indisponible : ${m}`) : []),
    ...(n1Projet !== null ? n1Projet.controles.filter((c) => c.statut === 'ecart').map((c) => `Exercice N-1, écart au contrôle ${c.code} : ${c.message}`) : []),
    ...(n1Projet !== null ? n1Projet.comptesNonAffectes.map((c) => `Exercice N-1 : compte ${c.compteNum} ${c.compteLib} (solde ${c.solde}) non affecté.`) : []),
    'Table de correspondance en attente de validation professionnelle.',
  ];

  const comparatif: ComparatifLiasse =
    n1Projet === null
      ? { statut: 'indisponible', motifs: precedentCalcule.motifs }
      : { statut: 'fourni', exercice: n1Projet.exercice, totaux: n1Projet.totaux, controles: n1Projet.controles, reserves: precedentCalcule.reserves };

  return {
    statut: 'projet',
    complet: manques.length === 0,
    manques,
    mention: MENTION_PROJET,
    regime: table.regime,
    exercice: { debut: demande.exercice.debut, fin: demande.exercice.fin },
    table: { id: table.id, version: table.version, millesimeFormulaire: table.millesimeFormulaire, etat: table.etat },
    correspondanceComptes: { id: correspondance.id, version: correspondance.version },
    tableaux,
    totaux,
    comparatif,
    controles,
    comptesNonAffectes,
    rubriquesNonAffectees,
    tableauxNonCouverts: table.tableauxNonCouverts,
    sources: [table.source, ...table.sourcesComplementaires, correspondance.source],
  };
}
