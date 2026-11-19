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

export interface VueIa extends EtatIa {
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
