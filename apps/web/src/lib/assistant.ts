/**
 * Types et libellés de l'assistant documenté et des tâches IA (formes renvoyées par `assistant.controller.ts` et
 * `ia-taches.controller.ts`). Tout texte venu d'une pièce, d'une écriture ou d'un modèle est affiché en TEXTE BRUT.
 */
export type StatutIa = 'non_connecte' | 'configure_non_verifie' | 'connecte' | 'simule';
export type NatureSource = 'piece' | 'ecriture' | 'constat' | 'resultat_moteur' | 'source_officielle';
export type TypeSegment = 'fait' | 'calcul' | 'hypothese' | 'interpretation';
export type ModeEchange = 'sans_ia' | 'simulateur' | 'ia';

export interface EtatIa {
  statut: StatutIa;
  raisons: string[];
  /** Phrase d'état produite par l'API à partir du statut RÉEL de la passerelle. */
  message: string;
  modeleSollicite: boolean;
}

export interface Citation {
  id: string;
  nature: NatureSource;
  libelle: string;
  reference: { titre: string; url: string | null; dateVersion: string | null } | null;
}

export interface Segment {
  type: TypeSegment;
  texte: string;
  citations: Citation[];
  reglementaire: boolean;
}

export interface ReponseAssistant {
  statut: 'repondu' | 'abstention';
  motifAbstention: string | null;
  mode: 'ia' | 'sans_ia';
  etiquette: string;
  segments: Segment[];
  perimetre: { cabinetId: string; dossierIds: string[]; periode: { debut: string; fin: string } };
  donneesManquantes: string[];
  pointsEcartes: Array<{ index: number; type: TypeSegment; motif: string }>;
  abstentionsPartielles: Array<{ index: number; motif: string }>;
  refus: Array<{ fonction: string; code: string; etape: number }>;
  sources: Citation[];
  etapes: number;
  confiance: { statut: 'non_evaluee'; mention: string };
  iaIndisponible: { code: string } | null;
  prompt: { id: string; version: string } | null;
}

export interface ReponseQuestion {
  echangeId: string | null;
  echangeEnregistre: boolean;
  mode: ModeEchange;
  exercice: { id: string; debut: string; fin: string } | null;
  reponse: ReponseAssistant;
  ia: EtatIa;
}

export interface EchangeAssistant {
  id: string;
  exerciceId: string | null;
  question: string;
  mode: ModeEchange;
  statut: string;
  reponse: ReponseAssistant;
  creeLe: string;
}

export interface HistoriqueAssistant {
  page: number;
  taillePage: number;
  total: number;
  echanges: EchangeAssistant[];
}

export interface LigneMesureIa {
  nature: 'reel' | 'simulateur' | 'sans_ia';
  type: 'appel_ia' | 'fonction_metier';
  tache: string;
  resultat: string;
  nombre: number;
  dureeTotaleMs: number;
  dureeMoyenneMs: number | null;
  jetonsEntree: number | null;
  jetonsSortie: number | null;
  coutEstime: string | null;
  devise: string | null;
  premierLe: string;
  dernierLe: string;
}

export interface TotauxNatureIa {
  appelsModele: number;
  reussis: number;
  abstentions: number;
  rejets: number;
  erreurs: number;
  indisponibles: number;
  fonctionsExecutees: number;
  fonctionsRefusees: number;
}

/** Preuve de connexion persistée de la passerelle, telle que l'API la décrit (ni prompt ni réponse). */
export interface VerificationIa {
  etat: 'sans_objet' | 'absente' | 'valide' | 'perimee' | 'autre_configuration' | 'non_concluante' | 'non_conforme';
  detail: string;
  verifieeLe: string | null;
  valideJusquAu: string | null;
  atteste: { hote: string; modeleLangage: string | null; modeleEmbeddings: string | null; dimensionsEmbeddings: number | null } | null;
  validiteJours: number | null;
  /** Qui peut vérifier, et comment : jamais depuis l'écran. */
  declenchement: string;
}

export interface VueIa extends EtatIa {
  verification?: VerificationIa;
  fournisseur: string;
  modeles: { langage: { id: string; temperature: number; maxJetonsSortie: number }; embeddings: { id: string; dimensions: number } };
  prompts: Array<{ tache: string; id: string; version: string }>;
  etiquettes: { sansIa: string; ia: string; confiance: string };
  tarifs: { relevesLe: string; devise: string; source: string; modeles: string[] } | null;
  mesures: { mention: string; totaux: Record<'reel' | 'simulateur' | 'sans_ia', TotauxNatureIa>; parTache: LigneMesureIa[] } | null;
  mesuresReservees?: string;
}

/** Réponse commune des tâches IA : une proposition (ou son absence), jamais une action appliquée. */
export interface ReponseTacheIa<P> {
  tache: string;
  statut: 'propose' | 'abstention' | 'rejete' | 'ia_indisponible';
  origine: 'ia' | 'simulateur' | 'repli_deterministe' | 'aucune';
  etiquette: string;
  proposition: P | null;
  preuves: unknown[];
  confiance: { statut: 'non_evaluee'; mention: string; indiceModele: number | null };
  avertissements: string[];
  motif: string | null;
  codes: string[];
  propositionId: string | null;
  applique: false;
  ia: { statut: StatutIa; message: string };
}

export interface PropositionClassement {
  type: string;
  dossierId: string | null;
  preuves: string[];
  justification: string;
}
export type ReponseClassement = ReponseTacheIa<PropositionClassement> & { libelles: { type: string | null; dossier: string | null }; pieceActuelle: { nature: string; entiteId: string } };
export type ReponseExplication = ReponseTacheIa<{ constatId: string; explication: string }>;

export const QUESTION_MIN = 3;
export const QUESTION_MAX = 1000;

export const LIBELLE_SEGMENT: Record<TypeSegment, string> = { fait: 'Fait', calcul: 'Calcul', hypothese: 'Hypothèse', interpretation: 'Interprétation' };
export const LIBELLE_NATURE_SOURCE: Record<NatureSource, string> = { piece: 'Pièce', ecriture: 'Écriture', constat: 'Constat', resultat_moteur: 'Calcul du moteur', source_officielle: 'Source officielle' };
export const LIBELLE_MODE: Record<ModeEchange, string> = { sans_ia: 'Sans IA', simulateur: 'SIMULATEUR de test', ia: 'Rédigé par une IA' };
export const LIBELLE_ORIGINE: Record<ReponseTacheIa<unknown>['origine'], string> = {
  ia: 'Proposition d’une IA, à vérifier',
  simulateur: 'SIMULATEUR de test (aucune IA réelle)',
  repli_deterministe: 'Repli déterministe, sans IA',
  aucune: 'Aucune proposition',
};
export const LIBELLE_NATURE_MESURE: Record<LigneMesureIa['nature'], string> = { reel: 'Modèle réel', simulateur: 'Simulateur de test', sans_ia: 'Sans IA' };

const MOTIFS_ECART: Record<string, string> = {
  citation_inconnue: 'source citée inconnue',
  citation_absente: 'aucune source citée',
  calcul_sans_resultat_moteur: 'calcul sans résultat du moteur',
  chiffre_non_source: 'chiffre absent des sources citées',
  url_non_sourcee: 'lien absent des sources citées',
  reglementaire_sans_source_officielle: 'affirmation réglementaire sans source officielle',
  jeton_non_restaure: 'donnée masquée non restituée',
};
export const libelleMotifEcart = (motif: string): string => MOTIFS_ECART[motif] ?? motif;

const REFUS: Record<string, string> = {
  fonction_non_autorisee: 'fonction hors de la liste autorisée',
  arguments_invalides: 'arguments invalides',
  changement_de_contexte_refuse: 'tentative de changer de cabinet ou d’utilisateur',
  dossier_hors_perimetre: 'dossier hors du périmètre',
  dossier_a_preciser: 'dossier non précisé',
  periode_hors_perimetre: 'période hors du périmètre',
  habilitation_refusee: 'habilitation insuffisante',
  habilitations_indisponibles: 'habilitations non vérifiables',
  fonction_en_echec: 'fonction en échec',
  reponse_prematuree: 'réponse prématurée',
  trop_d_appels: 'trop d’appels',
};
export const libelleRefus = (code: string): string => REFUS[code] ?? code;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Destination d'une citation. Pièce → page de la pièce ; constat → page du constat ; source officielle → lien externe
 * (https uniquement : une adresse d'un autre schéma n'est jamais rendue cliquable). Écriture et calcul : référence seule.
 */
export function lienCitation(base: string, c: Citation): { href: string; externe: boolean } | null {
  if (c.nature === 'piece') {
    const m = new RegExp(`^piece:(${UUID}):p\\d+$`, 'i').exec(c.id);
    return m ? { href: `${base}/pieces/${m[1]}`, externe: false } : null;
  }
  if (c.nature === 'constat') {
    const m = new RegExp(`^constat:(${UUID})$`, 'i').exec(c.id);
    return m ? { href: `${base}/revision/constats/${m[1]}`, externe: false } : null;
  }
  if (c.nature === 'source_officielle') {
    const url = c.reference?.url ?? '';
    try {
      return new URL(url).protocol === 'https:' ? { href: url, externe: true } : null;
    } catch {
      return null;
    }
  }
  return null;
}

// ───────────────────────────── Assistant sur un portefeuille de dossiers ─────────────────────────────

/** Citation d'une réponse de portefeuille : elle porte le dossier de sa source (`null` pour une source officielle). */
export type CitationPortefeuille = Citation & { dossierId: string | null };
export interface SegmentPortefeuille extends Omit<Segment, 'citations'> {
  citations: CitationPortefeuille[];
}
export interface ReponsePortefeuilleAssistant extends Omit<ReponseAssistant, 'perimetre' | 'segments' | 'sources'> {
  segments: SegmentPortefeuille[];
  sources: CitationPortefeuille[];
}
export interface DossierInterroge {
  id: string;
  nom: string;
  exercice: { id: string; debut: string; fin: string } | null;
  /** Période effectivement analysée dans ce dossier ; null si aucun exercice ne s'y prête. */
  periode: { debut: string; fin: string } | null;
  donneesManquantes: string[];
  sources: number;
  nonRestitues: number;
}
/** Tranche de dossiers interrogée (absente des échanges conservés avant les tranches : une seule). */
export interface TranchePortefeuille {
  numero: number;
  total: number;
  premier: number;
  dernier: number;
  retenus: number;
}
export interface PerimetrePortefeuille {
  borne: number;
  tranche?: TranchePortefeuille;
  /** Critère de classement des dossiers entre les tranches, tel que l'API le dit. */
  ordre?: string;
  elementsParDossier: number;
  autorises: number;
  dossiers: DossierInterroge[];
  nonInterroges: Array<{ id: string; nom: string }>;
  horsPerimetre: string[];
  periodeCommune: { debut: string; fin: string } | null;
}
export interface MasqueRelecture {
  dossiers: number;
  redactionRetiree: boolean;
}
export interface ReponsePortefeuille {
  echangeId: string | null;
  echangeEnregistre: boolean;
  mode: ModeEchange;
  perimetre: PerimetrePortefeuille;
  reponse: ReponsePortefeuilleAssistant;
  ia: EtatIa;
}
export interface EchangePortefeuille {
  id: string;
  question: string;
  mode: ModeEchange;
  statut: string;
  creeLe: string;
  perimetre: PerimetrePortefeuille;
  reponse: ReponsePortefeuilleAssistant;
  masque: MasqueRelecture | null;
}
export interface HistoriquePortefeuille {
  page: number;
  taillePage: number;
  total: number;
  echanges: EchangePortefeuille[];
}
export interface PerimetreAssistant {
  borne: number;
  elementsParDossier: number;
  dossiers: Array<{ id: string; nom: string; niveau: string }>;
}

/** Destination d'une citation de portefeuille : la pièce ou le constat DU dossier de la source ; jamais d'un autre. */
export function lienCitationPortefeuille(c: CitationPortefeuille): { href: string; externe: boolean } | null {
  if (c.nature === 'source_officielle') return lienCitation('', c);
  if (!c.dossierId || !new RegExp(`^${UUID}$`, 'i').test(c.dossierId)) return null;
  return lienCitation(`/dossiers/${c.dossierId}`, c);
}

// ───────────────────────────── Période commune et tranches ─────────────────────────────

/** Vrai pour une date AAAA-MM-JJ qui existe au calendrier (le 31/02 et le 2025-13-01 sont refusés, pas corrigés). */
export function dateReelle(valeur: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur);
  if (!m) return false;
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (annee < 1900 || annee > 2200) return false;
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  return d.getUTCFullYear() === annee && d.getUTCMonth() === mois - 1 && d.getUTCDate() === jour;
}

/**
 * Valide la période commune saisie : toutes deux vides (pas de période), ou toutes deux renseignées, réelles et
 * ordonnées. Renvoie le message à afficher, ou null si la saisie est acceptable.
 */
export function erreurPeriode(debut: string, fin: string): string | null {
  if (!debut && !fin) return null;
  if (!debut || !fin) return 'Renseignez les deux dates de la période, ou aucune.';
  if (!dateReelle(debut)) return 'La date de début n’existe pas au calendrier.';
  if (!dateReelle(fin)) return 'La date de fin n’existe pas au calendrier.';
  if (debut > fin) return 'La date de début doit précéder ou égaler la date de fin.';
  return null;
}

/** Période lue dans l'adresse : uniquement si elle est valide, sinon rien (jamais une période fabriquée). */
export function periodeDeLAdresse(debut: string | undefined, fin: string | undefined): { debut: string; fin: string } | null {
  return debut && fin && erreurPeriode(debut, fin) === null ? { debut, fin } : null;
}

/** Nombre de tranches de dossiers pour `n` dossiers retenus et une borne par question. */
export const nombreDeTranches = (n: number, borne: number): number => Math.max(1, Math.ceil(n / Math.max(1, borne)));
