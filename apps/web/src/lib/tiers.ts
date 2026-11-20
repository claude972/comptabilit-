/** Types des réponses de `v1/exercices/:id/tiers`, `/factures` et `/tiers-factures/a-traiter` (sous-ensemble affiché). */
import type { Ton } from '@/components/ui/base';
import type { Niveau } from '@/lib/types-api';

export interface EnteteTiers {
  niveau: Niveau;
  exercice: { id: string; entiteId: string; debut: string; fin: string };
  donnees: { lotImportId: string; version: number; statutDonnees: string | null } | null;
  dateAppreciation: string;
  origineDateAppreciation: 'cloture_exercice' | 'fournie';
  devise: string;
  reserves: string[];
  piecesEcartees: { horsExercice: number; extractionRejetee: number; sansExtraction: number; auDelaDuPlafond: number };
  /** Tolérance de montant en vigueur (D-096) : 0.00 par défaut = aucune tolérance. */
  tolerance: { montant: string; origine: 'dossier' | 'cabinet' | 'defaut' };
}
export interface Pagination {
  page: number;
  taillePage: number;
  total: number;
  suite: boolean;
}
export type TypeTiers = 'client' | 'fournisseur' | 'mixte' | 'indetermine';
export interface IdentifiantTiers {
  nature: 'siren' | 'siret' | 'tva' | 'nom';
  valeur: string;
  origine: 'piece' | 'compte_auxiliaire';
  documentIds: string[];
}
export interface FicheTiers {
  cle: string;
  origine: 'comptable' | 'piece';
  type: TypeTiers;
  nom: string;
  compteAuxiliaire: string | null;
  comptesGeneraux: string[];
  sansAuxiliaire: boolean;
  libelles: string[];
  identifiants: IdentifiantTiers[];
  tiersPieces: Array<{ cle: string; nom: string | null; lien: 'identifiant_fort' | 'confirme' }>;
  homonymes: string[];
  totalDebit: string | null;
  totalCredit: string | null;
  solde: string | null;
  nbLignes: number;
  nbEcritures: number;
  nbPieces?: number;
}
export interface PropositionTiers {
  clePiece: string;
  nomPiece: string | null;
  identifiantsPiece: IdentifiantTiers[];
  documentIds: string[];
  candidats: Array<{ cle: string; nom: string; type: TypeTiers; compteAuxiliaire: string | null }>;
  nomNormalise: string;
  statut: 'a_confirmer' | 'homonymes';
}
export interface RefEcriture {
  cle: string;
  journalCode: string;
  ecritureNum: string;
  ecritureDate: string;
  pieceRef: string;
  libelle: string;
  ligneId: string;
  compteNum: string;
  compAuxNum: string | null;
  montant: string;
  sens: 'debit' | 'credit';
  lettrage: string | null;
}
export interface Criteres {
  montant: 'exact' | 'ecart';
  reference: 'identique' | 'mentionnee' | 'absente';
  date: 'concordante' | 'ecart' | 'non_determinable';
  tiers: 'identifie' | 'propose' | 'homonymes' | 'non_determinable' | 'sans_lien' | 'different';
}
export interface CandidatEcriture {
  ecriture: RefEcriture;
  criteres: Criteres;
  niveau: 'fort' | 'proposable';
}
export interface Imputation {
  ecriture: RefEcriture;
  nature: 'reglement' | 'avoir' | 'autre';
  montant: string | null;
  mode: 'lettrage' | 'reference' | 'confirmation';
  partage: boolean;
  comptee: boolean;
  convention: 'ordre_chronologique' | null;
  avoirDocumentId: string | null;
  banque: { statut: 'valide' | 'non_rapproche'; rapprochementId: string | null; mouvements: Array<{ id: string; date: string; montant: string; libelle: string }> };
}
export interface PropositionImputation {
  ecriture: RefEcriture;
  nature: 'reglement' | 'avoir' | 'autre';
  critere: 'montant_exact' | 'avoir_meme_tiers' | 'reference_multiple' | 'ecart_tolere' | 'reglement_groupe_probable';
  ambigue: boolean;
  avoirDocumentId: string | null;
  /** `ecart_tolere` : écart signé (règlement − reste dû) et tolérance réglée. */
  ecart?: string | null;
  tolerance?: string | null;
  /** `reglement_groupe_probable` : pièces du groupe. */
  groupeDocumentIds?: string[];
}
export interface ReglementGroupeProbable {
  ecriture: RefEcriture;
  statut: 'a_confirmer';
  factures: Array<{ documentId: string; numero: string | null; resteDu: string }>;
  somme: string;
  explication: string;
}
export interface AbstentionReglementGroupe {
  ecriture: RefEcriture;
  motif: 'combinaisons_equivalentes' | 'facture_unique_equivalente' | 'trop_de_factures_ouvertes' | 'montant_non_decimal_2';
  nbCombinaisons: number | null;
  explication: string;
}
export type EtatFacture = 'non_echue' | 'echue_non_reglee' | 'partiellement_reglee' | 'reglee' | 'trop_percu' | 'non_determinable' | 'avoir_impute' | 'avoir_partiellement_impute' | 'avoir_non_impute';
export type StatutComptabilisation = 'apparie' | 'confirme' | 'a_confirmer' | 'ambigu' | 'non_trouve' | 'non_recherche';
export interface ResumeFacture {
  id: string;
  nomFichier: string;
  type: 'facture' | 'avoir';
  sens: 'achat' | 'vente' | 'indetermine';
  numero: string | null;
  dateEmission: string | null;
  dateEcheance: string | null;
  montant: string | null;
  devise: string | null;
  statutExtraction: 'valide' | 'projet';
  tiersCle: string | null;
  tiersNom: string | null;
  comptabilisation: StatutComptabilisation;
  montantRegle: string | null;
  resteDu: string | null;
  etat: EtatFacture;
  motifEtat: string | null;
  echue: boolean | null;
  joursDeRetard: number | null;
  nbSuspicions: number;
  nbPropositions: number;
}
export interface FicheFacture extends Omit<ResumeFacture, 'comptabilisation' | 'tiersNom' | 'nbSuspicions' | 'nbPropositions'> {
  versionPiece: number;
  versionExtraction: number;
  totalHt: string | null;
  totalTva: string | null;
  totalTtc: string | null;
  tiersPiece: { cle: string; nom: string | null; siren: string | null; tva: string | null } | null;
  motifTiers: string | null;
  comptabilisation: { statut: StatutComptabilisation; motif: string | null; ecriture: RefEcriture | null; criteres: Criteres | null; propositions: CandidatEcriture[] };
  imputations: Imputation[];
  propositionsImputation: PropositionImputation[];
  imputeSur: Array<{ factureId: string; montant: string | null }>;
  suspicions: string[];
  reserves: string[];
  preuves: Array<{ libelle: string; valeur: string }>;
}
export interface Suspicion {
  cle: string;
  type: 'ecritures_multiples' | 'pieces_multiples';
  tiers: string | null;
  reference: string | null;
  montant: string;
  ecritures: RefEcriture[];
  documentIds: string[];
  explication: string;
  statut: 'a_examiner' | 'confirmee' | 'ecartee';
}
export interface DecisionARevoir {
  type: string;
  objet: string;
  cible: string;
  motif: string;
}

export interface ReponseTiers extends EnteteTiers {
  pagination: Pagination & { parType: Record<string, number>; totalSansFiltre: number };
  nbPropositions: number;
  tiers: FicheTiers[];
}
export interface ReponseFicheTiers extends EnteteTiers {
  tiers: FicheTiers;
  mouvements: Array<{ id: string; cle: string; journalCode: string; ecritureNum: string; date: string; compteNum: string; pieceRef: string; libelle: string; debit: string; credit: string; lettrage: string | null }>;
  paginationMouvements: Pagination;
  factures: ResumeFacture[];
  resteDuTotal: string;
  propositions: PropositionTiers[];
}
export interface ReponseFactures extends EnteteTiers {
  pagination: Pagination & { parEtat: Record<string, { n: number; resteDu: string }>; totalSansFiltre: number };
  factures: ResumeFacture[];
}
export interface ReponseFacture extends EnteteTiers {
  facture: FicheFacture;
  tiers: { cle: string; nom: string; type: TypeTiers; compteAuxiliaire: string | null } | null;
  lignesEcritures: Record<string, Array<{ id: string; compteNum: string; compteLib: string; compAuxNum: string | null; libelle: string; debit: string; credit: string; lettrage: string | null }>>;
  suspicions: Suspicion[];
  decisions: Array<{ type: string; cible: string; decision: string; montant: string | null; motif: string | null; creeLe: string; auteur: string }>;
}
export interface ReponseATraiter extends EnteteTiers {
  totaux: { propositionsTiers: number; liensAConfirmer: number; reglementsProposes: number; reglementsGroupesProbables: number; abstentionsReglementsGroupes: number; suspicions: number; suspicionsAExaminer: number; decisionsARevoir: number };
  propositionsTiers: PropositionTiers[];
  liensAConfirmer: Array<ResumeFacture & { motif: string | null; propositions: CandidatEcriture[] }>;
  reglementsProposes: Array<ResumeFacture & { propositions: PropositionImputation[] }>;
  reglementsGroupesProbables: ReglementGroupeProbable[];
  abstentionsReglementsGroupes: AbstentionReglementGroupe[];
  suspicions: Suspicion[];
  decisionsARevoir: DecisionARevoir[];
}

export const LIBELLE_TYPE_TIERS: Record<TypeTiers, string> = { client: 'Client', fournisseur: 'Fournisseur', mixte: 'Client et fournisseur', indetermine: 'Indéterminé' };
export const LIBELLE_ETAT: Record<EtatFacture, string> = {
  non_echue: 'Non échue',
  echue_non_reglee: 'Échue non réglée',
  partiellement_reglee: 'Partiellement réglée',
  reglee: 'Réglée',
  trop_percu: 'Trop-perçu',
  non_determinable: 'Non déterminable',
  avoir_impute: 'Avoir imputé',
  avoir_partiellement_impute: 'Avoir partiellement imputé',
  avoir_non_impute: 'Avoir non imputé',
};
export const TON_ETAT: Record<EtatFacture, Ton> = {
  non_echue: 'info',
  echue_non_reglee: 'danger',
  partiellement_reglee: 'attention',
  reglee: 'succes',
  trop_percu: 'attention',
  non_determinable: 'vide',
  avoir_impute: 'succes',
  avoir_partiellement_impute: 'attention',
  avoir_non_impute: 'attention',
};
export const LIBELLE_COMPTABILISATION: Record<StatutComptabilisation, string> = {
  apparie: 'Écriture identifiée par le moteur',
  confirme: 'Écriture confirmée par une personne',
  a_confirmer: 'Écriture proposée, à confirmer',
  ambigu: 'Ambiguïté à lever',
  non_trouve: 'Aucune écriture correspondante',
  non_recherche: 'Non recherché',
};
export const LIBELLE_CRITERE = {
  montant: { exact: 'montant identique', ecart: 'montant différent' },
  reference: { identique: 'référence identique', mentionnee: 'référence citée dans le libellé', absente: 'référence absente' },
  date: { concordante: 'dates concordantes', ecart: 'dates éloignées', non_determinable: 'date de la pièce inconnue' },
  tiers: { identifie: 'tiers identifié', propose: 'tiers proposé par son nom', homonymes: 'tiers homonymes', non_determinable: 'tiers non lu sur la pièce', sans_lien: 'tiers sans lien établi', different: 'tiers différent' },
} as const;
export const criteresEnClair = (c: Criteres): string => [LIBELLE_CRITERE.montant[c.montant], LIBELLE_CRITERE.reference[c.reference], LIBELLE_CRITERE.date[c.date], LIBELLE_CRITERE.tiers[c.tiers]].join(' ; ');
export const LIBELLE_MODE = { lettrage: 'Lettrage de la comptabilité', reference: 'Référence de la facture citée', confirmation: 'Confirmé par une personne' } as const;
export const LIBELLE_NATURE_IMPUTATION = { reglement: 'Règlement', avoir: 'Avoir', autre: 'Autre écriture' } as const;
export const LIBELLE_SUSPICION = { a_examiner: 'À examiner', confirmee: 'Confirmée', ecartee: 'Écartée' } as const;
/** « siren:123 » → « SIREN 123 » ; « nom:DUPONT » → « nom DUPONT ». */
export function clePieceEnClair(cle: string): string {
  const [nature = '', ...reste] = cle.split(':');
  return `${nature === 'siren' ? 'SIREN' : nature === 'tva' ? 'TVA' : 'nom'} ${reste.join(':')}`;
}

export interface ReglageTolerance {
  id: string;
  toleranceMontant: string;
  motif: string;
  creeLe: string;
  auteur: string;
}
export interface ReponseReglagesTolerance {
  dossierId: string;
  enVigueur: { montant: string; origine: 'dossier' | 'cabinet' | 'defaut'; reglage: { id: string; creeLe: string; reglePar: string; motif: string } | null };
  maximum: string;
  historiqueDossier: ReglageTolerance[];
  historiqueCabinet: ReglageTolerance[];
  note: string;
}
export const LIBELLE_ORIGINE_TOLERANCE = { dossier: 'réglage du dossier', cabinet: 'réglage du cabinet', defaut: 'aucun réglage : aucune tolérance' } as const;
export const LIBELLE_ABSTENTION_GROUPE: Record<AbstentionReglementGroupe['motif'], string> = {
  combinaisons_equivalentes: 'Plusieurs combinaisons de factures donnent ce montant : aucune n’est proposée',
  facture_unique_equivalente: 'Une facture seule explique aussi ce montant : aucun règlement groupé n’est proposé',
  trop_de_factures_ouvertes: 'Trop de factures ouvertes pour ce tiers : aucune combinaison n’est cherchée',
  montant_non_decimal_2: 'Montant non exprimé au centime : aucune combinaison n’est cherchée',
};
