/**
 * Tiers, factures et avoirs suivis, échéances et règlements — types du moteur.
 *
 * Tout ce que le moteur rend est une AIDE À LA RÉVISION : rien n'est comptabilisé ni lettré, le logiciel de production
 * comptable reste la référence. Un lien déduit par le moteur porte ses critères ; un lien incertain est une PROPOSITION
 * tant qu'une personne habilitée ne l'a pas confirmé ; une donnée absente donne « non déterminable », jamais un état favorable.
 */
import type { LigneEcriture } from '../controles/types.js';
import type { ChaineDecimale } from '../montant.js';

export interface ParametresTiersFactures {
  /** Préfixes des comptes de tiers fournisseurs et clients (PCG). */
  prefixesFournisseurs: string[];
  prefixesClients: string[];
  /** Une écriture qui mouvemente un de ces comptes est une écriture de trésorerie (règlement). */
  prefixesTresorerie: string[];
  /** Une écriture de facture ou d'avoir mouvemente au moins un de ces comptes (charges, produits, immobilisations). */
  prefixesContrepartie: string[];
  /** Écart maximal, en jours, entre la date de la pièce et la date de l'écriture pour dire les dates « concordantes ». */
  toleranceDateJours: number;
  /** Longueur minimale d'un numéro de facture pour le rechercher DANS un libellé (au-dessous : égalité stricte seulement). */
  longueurMinReference: number;
}

export const PARAMETRES_TIERS_FACTURES_PAR_DEFAUT: ParametresTiersFactures = {
  prefixesFournisseurs: ['401', '403', '404', '405'],
  prefixesClients: ['411', '413', '416'],
  prefixesTresorerie: ['51', '53'],
  prefixesContrepartie: ['2', '6', '7'],
  toleranceDateJours: 31,
  longueurMinReference: 5,
};

/** Pièce (facture ou avoir) telle que lue par l'extraction en vigueur de sa version courante. */
export interface PieceFacture {
  documentId: string;
  nomFichier: string;
  versionPiece: number;
  versionExtraction: number;
  /** Nature qualifiée du document. */
  nature: 'facture_achat' | 'facture_vente' | 'avoir';
  /** valide : extraction validée par un réviseur ; projet : extraction exploitable mais non validée. */
  statutExtraction: 'valide' | 'projet';
  typeDocument: 'facture' | 'avoir' | 'inconnu' | null;
  numero: string | null;
  dateEmission: string | null;
  dateEcheance: string | null;
  emetteurNom: string | null;
  emetteurSiren: string | null;
  emetteurSiret: string | null;
  emetteurTva: string | null;
  /**
   * Destinataire lu sur la pièce (facultatif : absent pour une extraction antérieure à sa lecture, ou quand l'extraction
   * s'est abstenue). Sans destinataire, le client d'une pièce de vente n'est pas identifié par la pièce.
   */
  destinataireNom?: string | null;
  destinataireSiren?: string | null;
  destinataireSiret?: string | null;
  destinataireTva?: string | null;
  /**
   * Version de l'extraction depuis laquelle les champs HORS destinataire n'ont pas changé (D-091). Les décisions humaines
   * prises sur une version comprise entre celle-ci et la version en vigueur restent appliquées (signalées sur la fiche) ;
   * absent : seules les décisions prises sur la version en vigueur s'appliquent.
   */
  decisionsValablesDepuis?: number | null;
  totalHt: ChaineDecimale | null;
  totalTva: ChaineDecimale | null;
  totalTtc: ChaineDecimale | null;
  devise: string | null;
}

/** Rapprochement bancaire VALIDÉ par un réviseur (les propositions non validées ne sont jamais fournies au moteur). */
export interface RapprochementValide {
  id: string;
  /** Identifiants des lignes d'écriture de banque rapprochées. */
  lignesEcriture: string[];
  mouvements: Array<{ id: string; date: string; montant: ChaineDecimale; libelle: string }>;
}

/** Décision humaine enregistrée sur le lien tiers comptable ↔ tiers de pièce. */
export interface DecisionTiers {
  cleComptable: string;
  clePiece: string;
  decision: 'confirme' | 'infirme';
}

/**
 * Décision humaine enregistrée sur une facture.
 *  - comptabilisation : `objet` = identifiant de la pièce, `cible` = clé de l'écriture (« JOURNAL|NUMÉRO ») ;
 *  - imputation : `objet` = identifiant de la pièce, `cible` = clé de l'écriture de règlement ou d'avoir ;
 *  - suspicion : `objet` = clé de la suspicion, `cible` = « suspicion ».
 */
export interface DecisionFacture {
  type: 'comptabilisation' | 'imputation' | 'suspicion';
  objet: string;
  cible: string;
  decision: 'confirme' | 'infirme';
  /** Imputation seulement : montant imputé saisi par la personne (facultatif). */
  montant?: ChaineDecimale | null;
  /** Version de l'extraction de la pièce au moment de la décision ; différente de la version en vigueur → « à revoir ». */
  versionExtraction?: number | null;
}

export interface DemandeTiersFactures {
  /** Lignes du lot actif de l'exercice. */
  lignes: readonly LigneEcriture[];
  exercice: { debut: string; fin: string };
  /** Date à laquelle les échéances et les règlements sont appréciés : TOUJOURS explicite. */
  dateAppreciation: string;
  origineDateAppreciation: 'cloture_exercice' | 'fournie';
  /** Devise du dossier ; seul l'euro est traité. */
  deviseDossier: string;
  sirenDossier: string | null;
  pieces: readonly PieceFacture[];
  rapprochementsValides: readonly RapprochementValide[];
  decisionsTiers: readonly DecisionTiers[];
  decisionsFactures: readonly DecisionFacture[];
  parametres?: Partial<ParametresTiersFactures>;
}

export type TypeTiers = 'client' | 'fournisseur' | 'mixte' | 'indetermine';

export interface IdentifiantTiers {
  nature: 'siren' | 'siret' | 'tva' | 'nom';
  valeur: string;
  /** D'où vient l'identifiant : lu sur une pièce, ou trouvé dans le numéro ou le libellé du compte auxiliaire. */
  origine: 'piece' | 'compte_auxiliaire';
  documentIds: string[];
}

export interface FicheTiers {
  /** « aux:NUMÉRO » (compte auxiliaire), « general:COMPTE » (écritures sans compte auxiliaire) ou « piece:… » (tiers connu des seules pièces). */
  cle: string;
  origine: 'comptable' | 'piece';
  type: TypeTiers;
  nom: string;
  compteAuxiliaire: string | null;
  comptesGeneraux: string[];
  /** Vrai pour le regroupement des lignes d'un compte collectif SANS compte auxiliaire : le détail par tiers n'existe pas. */
  sansAuxiliaire: boolean;
  libelles: string[];
  identifiants: IdentifiantTiers[];
  /** Tiers de pièce rattachés, et comment : identifiant fort ou confirmation humaine. */
  tiersPieces: Array<{ cle: string; nom: string | null; lien: 'identifiant_fort' | 'confirme' }>;
  /** Autres tiers comptables portant le même nom normalisé : jamais fusionnés. */
  homonymes: string[];
  /** Null pour un tiers connu des seules pièces : aucune écriture, donc aucun solde. */
  totalDebit: ChaineDecimale | null;
  totalCredit: ChaineDecimale | null;
  /** Débit − crédit sur les écritures du lot. */
  solde: ChaineDecimale | null;
  nbLignes: number;
  nbEcritures: number;
  pieces: string[];
}

export interface PropositionTiers {
  clePiece: string;
  nomPiece: string | null;
  identifiantsPiece: IdentifiantTiers[];
  documentIds: string[];
  /** Tiers comptables candidats ; plusieurs = homonymes, aucun n'est retenu. */
  candidats: Array<{ cle: string; nom: string; type: TypeTiers; compteAuxiliaire: string | null }>;
  critere: 'nom_normalise_identique';
  nomNormalise: string;
  statut: 'a_confirmer' | 'homonymes';
}

export interface RefEcriture {
  /** « JOURNAL|NUMÉRO ». */
  cle: string;
  journalCode: string;
  ecritureNum: string;
  ecritureDate: string;
  pieceRef: string;
  pieceDate: string | null;
  libelle: string;
  ligneId: string;
  compteNum: string;
  compAuxNum: string | null;
  /** Montant de la ligne de tiers, toujours positif. */
  montant: ChaineDecimale;
  sens: 'debit' | 'credit';
  lettrage: string | null;
}

export interface CriteresAppariement {
  montant: 'exact' | 'ecart';
  reference: 'identique' | 'mentionnee' | 'absente';
  date: 'concordante' | 'ecart' | 'non_determinable';
  tiers: 'identifie' | 'propose' | 'homonymes' | 'non_determinable' | 'sans_lien' | 'different';
}

export interface CandidatEcriture {
  ecriture: RefEcriture;
  criteres: CriteresAppariement;
  /** fort : tous les critères concordent ; proposable : à confirmer par une personne. */
  niveau: 'fort' | 'proposable';
}

export interface BanqueImputation {
  /** valide : l'écriture de règlement est rapprochée d'un mouvement bancaire par un rapprochement VALIDÉ. */
  statut: 'valide' | 'non_rapproche';
  rapprochementId: string | null;
  mouvements: Array<{ id: string; date: string; montant: ChaineDecimale; libelle: string }>;
}

export interface Imputation {
  ecriture: RefEcriture;
  nature: 'reglement' | 'avoir' | 'autre';
  /** Montant imputé à CETTE facture ; null si le partage entre plusieurs factures n'est pas déterminable. */
  montant: ChaineDecimale | null;
  mode: 'lettrage' | 'reference' | 'confirmation';
  /** Vrai si la même écriture règle plusieurs factures (règlement groupé). */
  partage: boolean;
  /** Faux si l'écriture est postérieure à la date d'appréciation : listée, non comptée. */
  comptee: boolean;
  /** Convention appliquée quand le partage n'est pas donné par les données. */
  convention: 'ordre_chronologique' | null;
  /** Pièce de l'avoir, si l'avoir imputé est lui-même une pièce suivie. */
  avoirDocumentId: string | null;
  banque: BanqueImputation;
}

export interface PropositionImputation {
  ecriture: RefEcriture;
  nature: 'reglement' | 'avoir' | 'autre';
  critere: 'montant_exact' | 'avoir_meme_tiers' | 'reference_multiple';
  /** Vrai si la même écriture est proposée pour plusieurs factures, ou plusieurs écritures pour cette facture. */
  ambigue: boolean;
  avoirDocumentId: string | null;
}

export type EtatFacture =
  | 'non_echue'
  | 'echue_non_reglee'
  | 'partiellement_reglee'
  | 'reglee'
  | 'trop_percu'
  | 'non_determinable'
  | 'avoir_impute'
  | 'avoir_partiellement_impute'
  | 'avoir_non_impute';

export interface FicheFacture {
  /** Identifiant de la pièce (version courante). */
  id: string;
  nomFichier: string;
  versionPiece: number;
  versionExtraction: number;
  statutExtraction: 'valide' | 'projet';
  type: 'facture' | 'avoir';
  sens: 'achat' | 'vente' | 'indetermine';
  numero: string | null;
  dateEmission: string | null;
  dateEcheance: string | null;
  totalHt: ChaineDecimale | null;
  totalTva: ChaineDecimale | null;
  totalTtc: ChaineDecimale | null;
  /** Valeur absolue du TTC ; null si le TTC n'a pas été lu. */
  montant: ChaineDecimale | null;
  devise: string | null;
  tiersPiece: { cle: string; nom: string | null; siren: string | null; tva: string | null } | null;
  /** Rôle, sur la pièce, du tiers retenu : l'émetteur pour un achat, le destinataire pour une vente ; null sans tiers de pièce. */
  roleTiersPiece: 'emetteur' | 'destinataire' | null;
  /** Sens déduit des SEULS identifiants lus sur la pièce, comparés au SIREN du dossier (indépendant de la nature qualifiée). */
  sensLu: 'achat' | 'vente' | 'indetermine';
  motifSensLu: string;
  motifTiers: string | null;
  /** Fiche de tiers à laquelle la facture est rattachée (par l'écriture, sinon par le tiers de la pièce). */
  tiersCle: string | null;
  comptabilisation: {
    statut: 'apparie' | 'confirme' | 'a_confirmer' | 'ambigu' | 'non_trouve' | 'non_recherche';
    motif: string | null;
    ecriture: RefEcriture | null;
    criteres: CriteresAppariement | null;
    propositions: CandidatEcriture[];
  };
  imputations: Imputation[];
  propositionsImputation: PropositionImputation[];
  /** Pour un avoir : factures sur lesquelles il est imputé. */
  imputeSur: Array<{ factureId: string; montant: ChaineDecimale | null }>;
  montantRegle: ChaineDecimale | null;
  resteDu: ChaineDecimale | null;
  etat: EtatFacture;
  motifEtat: string | null;
  /** Échue à la date d'appréciation ; null si l'échéance n'est pas connue. */
  echue: boolean | null;
  joursDeRetard: number | null;
  suspicions: string[];
  reserves: string[];
  preuves: Array<{ libelle: string; valeur: string }>;
}

export interface SuspicionDoubleComptabilisation {
  /** Clé stable : « E:… » (plusieurs écritures) ou « P:… » (plusieurs pièces). */
  cle: string;
  type: 'ecritures_multiples' | 'pieces_multiples';
  tiers: string | null;
  reference: string | null;
  montant: ChaineDecimale;
  ecritures: RefEcriture[];
  documentIds: string[];
  explication: string;
  /** a_examiner tant qu'une personne habilitée n'a pas statué. */
  statut: 'a_examiner' | 'confirmee' | 'ecartee';
}

export interface DecisionARevoir {
  type: 'comptabilisation' | 'imputation' | 'suspicion' | 'tiers';
  objet: string;
  cible: string;
  motif: string;
}

export interface ResultatTiersFactures {
  dateAppreciation: string;
  origineDateAppreciation: 'cloture_exercice' | 'fournie';
  devise: string;
  parametres: ParametresTiersFactures;
  tiers: FicheTiers[];
  propositionsTiers: PropositionTiers[];
  factures: FicheFacture[];
  suspicions: SuspicionDoubleComptabilisation[];
  decisionsARevoir: DecisionARevoir[];
  /** Limites qui s'appliquent à l'ensemble du résultat. */
  reserves: string[];
  mesures: { nbLignes: number; nbLignesTiers: number; nbPieces: number; nbTiers: number; nbFactures: number };
}
