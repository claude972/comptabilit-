/**
 * Formes des réponses de l'API métier, relevées dans `apps/api/src/*.controller.ts` et `packages/db/src/schema.ts`.
 * Les montants sont des chaînes décimales. Les textes (libellés, noms de fichiers, extraits) sont des contenus non fiables.
 */
export type Role = 'administrateur' | 'associe' | 'reviseur' | 'collaborateur' | 'client_deposant' | 'client_lecture' | 'support';
export type Niveau = 'depot' | 'lecture' | 'collaboration' | 'revision' | 'validation';
export type NatureDocument = 'facture_achat' | 'facture_vente' | 'avoir' | 'releve_bancaire' | 'lettre_mission' | 'contrat' | 'autre' | 'a_qualifier';
/** « remplace » : une version plus récente de la pièce a été déposée ; l'ancienne et son fichier sont conservés. */
export type StatutDocument = 'recu' | 'en_analyse' | 'a_completer' | 'a_controler' | 'traite' | 'quarantaine' | 'rejete' | 'remplace';
export type StatutLot = 'en_attente' | 'en_cours' | 'termine' | 'termine_avec_erreurs' | 'echec' | 'annule';
export type StatutDonnees = 'travail_avant_cloture' | 'fec';
export type StatutControle = 'sans_anomalie' | 'constat' | 'non_applicable' | 'non_realise' | 'erreur';
export type Gravite = 'critique' | 'elevee' | 'moyenne' | 'faible';
export type StatutRevue = 'a_examiner' | 'en_cours' | 'piece_demandee' | 'accepte' | 'corrige' | 'rejete' | 'anomalie_confirmee' | 'cloture';
export type Canal = 'telephone' | 'ordinateur' | 'mail' | 'import_lot';

export const ORDRE_NIVEAUX: readonly Niveau[] = ['depot', 'lecture', 'collaboration', 'revision', 'validation'];
export function auMoins(n: Niveau | null | undefined, minimum: Niveau): boolean {
  return !!n && ORDRE_NIVEAUX.indexOf(n) >= ORDRE_NIVEAUX.indexOf(minimum);
}

export interface Moi {
  utilisateur: { id: string; nom: string; email: string };
  cabinet: { id: string; nom: string; siren: string | null; creeLe: string };
  role: Role;
}
export interface Dossier {
  id: string;
  raisonSociale: string;
  formeJuridique: string | null;
  regimeFiscal: string | null;
  territoireFiscal: string;
  niveau: Niveau | null;
}
export interface Exercice {
  id: string;
  entiteId: string;
  debut: string;
  fin: string;
  statut: string;
  versionDonnees: number;
}

export interface VueTeleversement {
  id: string;
  statut: 'ouvert' | 'complet' | 'abandonne' | 'refuse';
  octetsRecus: number;
  tailleAttendue: number;
  tailleMorceau: number;
  documentId: string | null;
  lotImportId: string | null;
  expireLe: string;
}
export interface VueTerminee extends VueTeleversement {
  recu: true;
  doublonBinaire: boolean;
  dejaImporte: boolean;
  /** Renseigné quand le dépôt a réellement créé une nouvelle version d'une pièce (jamais pour un doublon binaire). */
  nouvelleVersion?: { version: number; validationInvalidee: boolean } | null;
}

export interface DocumentListe {
  id: string;
  nomOrigine: string;
  nature: NatureDocument;
  statut: StatutDocument;
  /** Numéro de version de la pièce (1 pour un premier dépôt). */
  version: number;
  /** Identifiant de la version qui remplace celle-ci, le cas échéant. */
  remplacePar: string | null;
  motifStatut: string | null;
  creeLe: string;
  majLe: string;
  nbReceptions: number;
  demandesOuvertes: number;
}
export interface ListeDocuments {
  niveau: Niveau;
  page: number;
  taillePage: number;
  suite: boolean;
  documents: DocumentListe[];
}

export type MethodeChamp = 'structure' | 'regle' | 'ia' | 'saisie_humaine';
export interface ChampExtrait {
  valeur: string;
  page: number | null;
  extrait: string | null;
  boite: [number, number, number, number] | null;
  methode: MethodeChamp;
  confiance: string;
}
export const CHAMPS_FACTURE = [
  'typeDocument', 'numero', 'dateEmission', 'dateEcheance', 'emetteurNom', 'emetteurSiren', 'emetteurSiret', 'emetteurTva', 'totalHt', 'totalTva', 'totalTtc', 'devise',
] as const;
export type NomChamp = (typeof CHAMPS_FACTURE)[number];
export type ChampsFacture = Partial<Record<NomChamp, ChampExtrait | null>> & {
  ventilationTva?: Array<{ taux: string; base: string; montant: string }>;
};
export interface Verification {
  code: string;
  statut: 'ok' | 'ecart' | 'non_verifiable';
  message: string;
  ecart: string | null;
}
export interface Extraction {
  id: string;
  documentId: string;
  version: number;
  methode: string;
  moteur: string | null;
  champs: ChampsFacture;
  verifications: Verification[];
  statut: string;
  actuelle: boolean;
  creeLe: string;
}
export interface Echange {
  id: string;
  type: 'signalement_erreur' | 'demande_complement' | 'reponse';
  message: string;
  resolu: boolean;
  creeLe: string;
  auteur: string;
}
export interface DetailDocument {
  niveau: Niveau;
  document: {
    id: string;
    entiteId: string;
    exerciceId: string | null;
    nature: NatureDocument;
    statut: StatutDocument;
    nomOrigine: string;
    commentaire: string | null;
    version: number;
    remplacePar: string | null;
    remplaceDocumentId: string | null;
    nbPages: number | null;
    motifStatut: string | null;
    creeLe: string;
    majLe: string;
  };
  fichier: { sha256: string; taille: number; typeMimeDetecte: string | null; analyseAntivirus: string } | null;
  receptions: Array<{ id: string; canal: Canal; recuLe: string; doublonBinaire: boolean; parMoi: boolean }>;
  extraction: Extraction | null;
  /** Chaîne des versions de la pièce, de la plus ancienne à la plus récente (toutes conservées). */
  versions: VersionDocument[];
  estVersionCourante: boolean;
  echanges: Echange[];
}
export interface VersionDocument {
  id: string;
  version: number;
  statut: StatutDocument;
  creeLe: string;
}
/** Pièce jointe à un conseil, un fait, une lettre ou une écriture : champs nuls si la pièce n'est plus lisible. */
export interface PieceJointe {
  id: string;
  nomOrigine: string | null;
  statut: StatutDocument | null;
  version: number | null;
}

export interface SourceRegle {
  type?: 'reglementaire' | 'interne';
  reference?: string;
  url?: string | null;
  dateVerification?: string | null;
  verification?: 'verifiee' | 'non_verifiee' | 'sans_objet';
  periodeApplication?: string | null;
  titre?: string;
  cycle?: string;
  /** Règle du cabinet (ou exception du dossier) dont viennent les paramètres appliqués ; null : paramètres par défaut. */
  regleCabinet?: { regleId: string; version: number; portee: 'cabinet' | 'dossier' } | null;
}
export interface AnomalieFec {
  ligne: number | null;
  colonne: string | null;
  code: string;
  gravite: 'bloquante' | 'majeure' | 'mineure' | 'information';
  message: string;
}
/** Rapport d'import : complet après analyse, réduit à `nomFichier` (ou `erreurTechnique`) avant ou en cas d'échec technique. */
export interface RapportFec {
  nomFichier?: string;
  erreurTechnique?: string;
  encodage?: string;
  separateur?: string;
  variante?: string;
  nbLignesLues?: number;
  nbLignesNormalisees?: number;
  anomalies?: AnomalieFec[];
  nbAnomaliesParCode?: Record<string, number>;
  lisible?: boolean;
  conforme?: boolean;
  suffisantPourTravaux?: boolean;
  totalDebit?: string;
  totalCredit?: string;
  dateMin?: string | null;
  dateMax?: string | null;
  referentiel?: SourceRegle & {
    controlesImplementes?: Array<{ code: string; description: string; ecartAuReferentiel: boolean }>;
    controlesNonImplementes?: string[];
  };
}
export interface LotImport {
  id: string;
  entiteId: string;
  exerciceId: string | null;
  type: string;
  statutDonnees: StatutDonnees | null;
  version: number;
  actif: boolean;
  statut: StatutLot;
  progression: number;
  rapport: RapportFec | null;
  creeLe: string;
  termineLe: string | null;
  /** Annulation réversible (imports.controller.ts) : rien n'est supprimé, l'import est seulement écarté. */
  statutAvantAnnulation?: string | null;
  annulePar?: string | null;
  annuleLe?: string | null;
  motifAnnulation?: string | null;
  campagneId?: string | null;
}

export interface Execution {
  id: string;
  exerciceId: string;
  lotImportId: string;
  versionDonnees: number;
  statut: StatutLot;
  obsolete: boolean;
  creeLe: string;
  termineLe: string | null;
}
export interface ResultatControle {
  id: string;
  executionId: string;
  controleId: string;
  versionControle: string;
  statut: StatutControle;
  motif: string | null;
  parametres: Record<string, unknown>;
  mesures: Record<string, string>;
  source: SourceRegle;
}
export interface Constat {
  id: string;
  entiteId: string;
  exerciceId: string;
  executionId: string;
  resultatId: string;
  controleId: string;
  cle: string;
  gravite: Gravite;
  titre: string;
  explication: string;
  actionProposee: string;
  montant: string | null;
  lignesConcernees: string[];
  preuves: Array<{ libelle: string; valeur: string }>;
  statutRevue: StatutRevue;
  affecteA: string | null;
  aRevoir: boolean;
  creeLe: string;
}
export interface Revue {
  exercice: Exercice;
  execution: Execution | null;
  resultats: ResultatControle[];
  constats: Constat[];
}
/** Ligne d'écriture concernée par un constat (sélection de `lignes_ecriture`, noms en camelCase). */
export interface LigneEcritureBrute {
  id: string;
  numeroLigne: number;
  journalCode: string;
  ecritureNum: string;
  ecritureDate: string;
  compteNum: string;
  compteLib: string;
  compAuxNum: string | null;
  pieceRef: string;
  ecritureLib: string;
  debit: string;
  credit: string;
}
export interface DetailConstat {
  constat: Constat;
  lignes: LigneEcritureBrute[];
  nbLignesTotal: number;
  decisions: Array<{ action: string; motif: string | null; versionCible: number; creeLe: string; auteur: string }>;
  controle: ResultatControle | undefined;
}
export interface ExportRevision {
  id: string;
  exerciceId: string;
  executionId: string;
  versionDonnees: number;
  statut: StatutLot;
  mention: string;
  sha256Pdf: string | null;
  sha256Donnees: string | null;
  erreur: string | null;
  creeLe: string;
  termineLe: string | null;
}
export interface ControleCatalogue {
  id: string;
  version: string;
  cycle: string;
  titre: string;
  objectif: string;
  perimetre: string;
  donneesObligatoires: string[];
  logique: string;
  parametresParDefaut: Record<string, unknown>;
  exceptions: string;
  source: SourceRegle;
  resultatsAttendus: string;
}
