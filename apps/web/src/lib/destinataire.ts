/** Types des réponses de `v1/documents/:id/destinataire` et de la réanalyse du destinataire (sous-ensemble affiché). D-091. */
import type { Niveau } from '@/lib/types-api';

export const CHAMPS_DESTINATAIRE = ['destinataireNom', 'destinataireSiren', 'destinataireSiret', 'destinataireTva', 'destinatairePays'] as const;
export type ChampDestinataire = (typeof CHAMPS_DESTINATAIRE)[number];

export const LIBELLE_CHAMP_DESTINATAIRE: Record<ChampDestinataire, string> = {
  destinataireNom: 'Nom du destinataire',
  destinataireSiren: 'SIREN',
  destinataireSiret: 'SIRET',
  destinataireTva: 'N° de TVA intracommunautaire',
  destinatairePays: 'Pays (code à 2 lettres)',
};

export interface LigneDestinataire {
  champ: ChampDestinataire;
  effective: string | null;
  source: 'humain' | 'automatique' | 'non_lu';
  automatique: string | null;
  humain: string | null;
  desaccord: boolean;
  corrigePar: string | null;
  corrigeParNom?: string | null;
  corrigeLe: string | null;
  motif: string | null;
}
export interface DecisionAppariement {
  type: string;
  cible: string;
  decision: 'confirme' | 'infirme';
  versionExtraction: number | null;
  etat: 'appliquee' | 'conservee' | 'a_revoir';
}
export interface EffetsDestinataire {
  sensLu: { sens: 'achat' | 'vente' | 'indetermine'; incoherence: boolean; motif: string; sirenEmetteur: string | null; sirenDestinataire: string | null };
  natureQualifiee: string;
  conflitNature: boolean;
  decisions: DecisionAppariement[];
  signalements: string[];
  appariement: string;
}
export interface VersionDestinataire {
  id: string;
  version: number;
  actuelle: boolean;
  methode: string;
  moteur: string | null;
  versionAnalyseur: string | null;
  statut: string;
  creeLe: string;
  lectureAutomatiqueFaite: boolean;
  lignes: LigneDestinataire[];
  abstention: string | null;
}
export interface ReponseDestinataire {
  niveau: Niveau;
  documentId: string;
  nomFichier: string;
  remplace: boolean;
  original: { sha256: string; taille: number; inchange: string } | null;
  extractionCourante: { id: string; version: number; statut: string; methode: string } | null;
  lignes: LigneDestinataire[];
  abstention: string | null;
  lectureAutomatiqueFaite: boolean;
  historique: VersionDestinataire[];
  effets: EffetsDestinataire | null;
  reanalyses: Array<{ lotId: string; resultat: string | null; motif: string | null; execution: boolean; versionAnalyseur: string; traiteLe: string | null }>;
  versionAnalyseurCourante: string;
}

export const LIBELLE_SENS: Record<string, string> = { achat: 'Achat', vente: 'Vente', indetermine: 'Indéterminé' };
export const LIBELLE_SOURCE: Record<LigneDestinataire['source'], string> = { humain: 'Saisie humaine', automatique: 'Lecture automatique', non_lu: 'Non lu automatiquement' };
export const LIBELLE_ETAT_DECISION: Record<DecisionAppariement['etat'], string> = {
  appliquee: 'Appliquée',
  conservee: 'Conservée (prise avant la modification du destinataire)',
  a_revoir: 'À revoir (les autres champs ont changé : plus appliquée)',
};

// ───────────── Réanalyse ─────────────
export type ResultatReanalyse = 'inchangee' | 'destinataire_trouve' | 'abstention' | 'erreur';
export const LIBELLE_RESULTAT: Record<ResultatReanalyse | 'en_attente', string> = {
  en_attente: 'En attente',
  inchangee: 'Inchangée',
  destinataire_trouve: 'Destinataire trouvé',
  abstention: 'Abstention motivée',
  erreur: 'Erreur',
};
export interface DemandeReanalyse {
  id: string;
  mode: 'simulation' | 'execution';
  simulationId: string | null;
  versionAnalyseur: string;
  statut: 'en_attente' | 'en_cours' | 'termine';
  tailleLot: number;
  motif: string;
  nbPieces: number;
  resume: Record<string, number> | null;
  demandePar: string;
  creeLe: string;
  termineLe: string | null;
  demandeur?: string | null;
}
export interface ApercuReanalyse {
  niveau: Niveau;
  versionAnalyseur: string;
  tailleMaxLot: number;
  peutDemander: boolean;
  concernees: number;
  dejaReanalysees: number;
  dejaRelues: number;
  dansLeProchainLot: number;
  lotsNecessaires: number;
  extractionsValidees: number;
  corrigeesALaMain: number;
  demandes: DemandeReanalyse[];
  garanties: string[];
}
export interface PieceReanalysee {
  id: string;
  documentId: string;
  nomFichier: string;
  statut: 'en_attente' | 'termine';
  resultat: ResultatReanalyse | null;
  motif: string | null;
  versionExtractionAvant: number;
  versionExtractionApres: number | null;
  detail: { desaccords?: Array<{ champ: ChampDestinataire; humain: string | null; automatique: string | null }>; autresDivergences?: string[] } | null;
  traiteLe: string | null;
}
export interface RapportReanalyse {
  niveau: Niveau;
  demande: DemandeReanalyse;
  decomptes: Record<ResultatReanalyse | 'en_attente', number>;
  changeraient: number;
  executable: boolean;
  executionId: string | null;
  pieces: PieceReanalysee[];
}
