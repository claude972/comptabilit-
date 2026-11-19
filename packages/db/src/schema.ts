/**
 * Modèle de données Comtaple.
 *
 * Conventions :
 *  - toute table métier porte `cabinet_id` : c'est la clé d'isolation (RLS, voir migrations/…_securite.sql) ;
 *  - toute table rattachée à un dossier client porte en plus `entite_id` (habilitation par dossier) ;
 *  - les montants sont des NUMERIC(18,2), jamais des flottants ; Drizzle les expose en chaînes ;
 *  - les résultats (contrôles, extractions, validations) référencent la version exacte des données utilisées.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const horodatage = (nom: string) => timestamp(nom, { withTimezone: true, mode: 'string' });
const creeLe = () => horodatage('cree_le').notNull().defaultNow();
const montant = (nom: string) => numeric(nom, { precision: 18, scale: 2 });

// ───────────────────────────── Énumérations ─────────────────────────────

export const roleCabinet = pgEnum('role_cabinet', [
  'administrateur',
  'associe',
  'reviseur',
  'collaborateur',
  'client_deposant',
  'client_lecture',
  'support',
]);

/** Niveaux d'habilitation sur un dossier, du plus restreint au plus large. */
export const niveauHabilitation = pgEnum('niveau_habilitation', [
  'depot',
  'lecture',
  'collaboration',
  'revision',
  'validation',
]);

/** Le territoire fiscal est une donnée explicite : aucune règle métropolitaine n'est appliquée par défaut ailleurs. */
export const territoireFiscal = pgEnum('territoire_fiscal', [
  'metropole',
  'guadeloupe',
  'martinique',
  'guyane',
  'reunion',
  'mayotte',
  'autre',
  'a_confirmer',
]);

export const statutDonnees = pgEnum('statut_donnees', ['travail_avant_cloture', 'fec']);
export const statutLot = pgEnum('statut_lot', ['en_attente', 'en_cours', 'termine', 'termine_avec_erreurs', 'echec', 'annule']);
export const canalReception = pgEnum('canal_reception', ['telephone', 'ordinateur', 'mail', 'import_lot']);
export const natureDocument = pgEnum('nature_document', [
  'facture_achat',
  'facture_vente',
  'avoir',
  'releve_bancaire',
  'lettre_mission',
  'contrat',
  'autre',
  'a_qualifier',
]);
/** Statuts visibles par le déposant. « recu » n'est posé qu'après confirmation serveur (octets complets + empreinte vérifiée). */
export const statutDocument = pgEnum('statut_document', [
  'recu',
  'en_analyse',
  'a_completer',
  'a_controler',
  'traite',
  'quarantaine',
  'rejete',
]);
export const statutTeleversement = pgEnum('statut_televersement', ['ouvert', 'complet', 'abandonne', 'refuse']);
export const natureFichier = pgEnum('nature_fichier', ['original', 'derive']);
export const statutControle = pgEnum('statut_controle', ['sans_anomalie', 'constat', 'non_applicable', 'non_realise', 'erreur']);
export const graviteConstat = pgEnum('gravite_constat', ['critique', 'elevee', 'moyenne', 'faible']);
export const statutRevue = pgEnum('statut_revue', [
  'a_examiner',
  'en_cours',
  'piece_demandee',
  'accepte',
  'corrige',
  'rejete',
  'anomalie_confirmee',
  'cloture',
]);
export const fournisseurMail = pgEnum('fournisseur_mail', ['microsoft365', 'gmail']);
export const statutConnexion = pgEnum('statut_connexion', ['non_connecte', 'connecte', 'expire', 'revoque', 'erreur']);

// ───────────────────────────── Cabinets et identités ─────────────────────────────

export const cabinets = pgTable('cabinets', {
  id: id(),
  nom: text('nom').notNull(),
  siren: text('siren'),
  creeLe: creeLe(),
});

/** Utilisateur global (peut appartenir à plusieurs cabinets) ; `sujet_oidc` vient du jeton Keycloak. */
export const utilisateurs = pgTable('utilisateurs', {
  id: id(),
  sujetOidc: text('sujet_oidc').notNull().unique(),
  email: text('email').notNull(),
  nom: text('nom').notNull(),
  creeLe: creeLe(),
});

export const appartenances = pgTable(
  'appartenances',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    utilisateurId: uuid('utilisateur_id').notNull().references(() => utilisateurs.id),
    role: roleCabinet('role').notNull(),
    actif: boolean('actif').notNull().default(true),
    /** Accès support : borné dans le temps et tracé. */
    expireLe: horodatage('expire_le'),
    creeLe: creeLe(),
  },
  (t) => [uniqueIndex('appartenances_unique').on(t.cabinetId, t.utilisateurId)],
);

// ───────────────────────────── Dossiers clients ─────────────────────────────

export const entites = pgTable(
  'entites',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    raisonSociale: text('raison_sociale').notNull(),
    siren: text('siren'),
    formeJuridique: text('forme_juridique'),
    /** Régime d'imposition des bénéfices : seul « IS » est couvert au lot initial. */
    regimeFiscal: text('regime_fiscal'),
    referentielComptable: text('referentiel_comptable').notNull().default('PCG'),
    territoireFiscal: territoireFiscal('territoire_fiscal').notNull().default('a_confirmer'),
    codeNaf: text('code_naf'),
    devise: text('devise').notNull().default('EUR'),
    actif: boolean('actif').notNull().default(true),
    creeLe: creeLe(),
  },
  (t) => [index('entites_cabinet').on(t.cabinetId)],
);

export const etablissements = pgTable('etablissements', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  siret: text('siret'),
  libelle: text('libelle').notNull(),
  territoireFiscal: territoireFiscal('territoire_fiscal').notNull().default('a_confirmer'),
});

export const exercices = pgTable(
  'exercices',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    entiteId: uuid('entite_id').notNull().references(() => entites.id),
    debut: date('debut', { mode: 'string' }).notNull(),
    fin: date('fin', { mode: 'string' }).notNull(),
    statut: text('statut').notNull().default('ouvert'),
    /** Incrémenté à chaque modification des données de l'exercice : sert à repérer les résultats obsolètes. */
    versionDonnees: integer('version_donnees').notNull().default(0),
    creeLe: creeLe(),
  },
  (t) => [uniqueIndex('exercices_unique').on(t.entiteId, t.debut, t.fin)],
);

export const habilitationsDossier = pgTable(
  'habilitations_dossier',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    entiteId: uuid('entite_id').notNull().references(() => entites.id),
    utilisateurId: uuid('utilisateur_id').notNull().references(() => utilisateurs.id),
    niveau: niveauHabilitation('niveau').notNull(),
    accordeePar: uuid('accordee_par').references(() => utilisateurs.id),
    creeLe: creeLe(),
  },
  (t) => [uniqueIndex('habilitations_unique').on(t.entiteId, t.utilisateurId)],
);

// ───────────────────────────── Missions ─────────────────────────────

export const missions = pgTable('missions', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  libelle: text('libelle').notNull(),
  debut: date('debut', { mode: 'string' }),
  fin: date('fin', { mode: 'string' }),
  creeLe: creeLe(),
});

/** Lettres de mission et avenants (un avenant référence la lettre qu'il modifie). */
export const lettresMission = pgTable('lettres_mission', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  missionId: uuid('mission_id').notNull().references(() => missions.id),
  avenantDe: uuid('avenant_de'),
  documentId: uuid('document_id'),
  dateEffet: date('date_effet', { mode: 'string' }),
  analyse: jsonb('analyse'),
  statut: text('statut').notNull().default('projet'),
  creeLe: creeLe(),
});

// ───────────────────────────── Fichiers, documents, réceptions ─────────────────────────────

/** Objet binaire stocké (S3). Un original n'est jamais modifié ; tout traitement produit un dérivé documenté. */
export const fichiers = pgTable(
  'fichiers',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    sha256: text('sha256').notNull(),
    taille: bigint('taille', { mode: 'number' }).notNull(),
    typeMimeDeclare: text('type_mime_declare'),
    typeMimeDetecte: text('type_mime_detecte'),
    cleStockage: text('cle_stockage').notNull(),
    nature: natureFichier('nature').notNull().default('original'),
    deriveDe: uuid('derive_de'),
    transformation: text('transformation'),
    analyseAntivirus: text('analyse_antivirus').notNull().default('non_analyse'),
    creeLe: creeLe(),
  },
  (t) => [index('fichiers_empreinte').on(t.cabinetId, t.sha256)],
);

export const lotsImport = pgTable('lots_import', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  exerciceId: uuid('exercice_id').references(() => exercices.id),
  type: text('type').notNull(),
  statutDonnees: statutDonnees('statut_donnees'),
  fichierId: uuid('fichier_id').references(() => fichiers.id),
  /** Clé d'idempotence : relancer le même import (même fichier, même cible) ne duplique rien. */
  cleIdempotence: text('cle_idempotence').notNull(),
  version: integer('version').notNull().default(1),
  remplaceLotId: uuid('remplace_lot_id'),
  actif: boolean('actif').notNull().default(true),
  statut: statutLot('statut').notNull().default('en_attente'),
  progression: integer('progression').notNull().default(0),
  rapport: jsonb('rapport'),
  lancePar: uuid('lance_par').references(() => utilisateurs.id),
  creeLe: creeLe(),
  termineLe: horodatage('termine_le'),
}, (t) => [uniqueIndex('lots_idempotence').on(t.cabinetId, t.cleIdempotence)]);

/** Session de téléversement reprenable (téléphone ou ordinateur). */
export const televersements = pgTable('televersements', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  utilisateurId: uuid('utilisateur_id').notNull().references(() => utilisateurs.id),
  canal: canalReception('canal').notNull(),
  nomFichier: text('nom_fichier').notNull(),
  typeMimeDeclare: text('type_mime_declare'),
  tailleAttendue: bigint('taille_attendue', { mode: 'number' }).notNull(),
  sha256Attendu: text('sha256_attendu').notNull(),
  octetsRecus: bigint('octets_recus', { mode: 'number' }).notNull().default(0),
  nature: natureDocument('nature').notNull().default('a_qualifier'),
  commentaire: text('commentaire'),
  /** piece : devient un document ; fec : devient un lot d'import comptable. */
  usage: text('usage').notNull().default('piece'),
  exerciceId: uuid('exercice_id').references(() => exercices.id),
  statutDonnees: statutDonnees('statut_donnees'),
  lotImportId: uuid('lot_import_id'),
  statut: statutTeleversement('statut').notNull().default('ouvert'),
  documentId: uuid('document_id'),
  creeLe: creeLe(),
  expireLe: horodatage('expire_le').notNull(),
});

export const documents = pgTable(
  'documents',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    entiteId: uuid('entite_id').notNull().references(() => entites.id),
    exerciceId: uuid('exercice_id').references(() => exercices.id),
    fichierId: uuid('fichier_id').notNull().references(() => fichiers.id),
    nature: natureDocument('nature').notNull().default('a_qualifier'),
    statut: statutDocument('statut').notNull().default('recu'),
    nomOrigine: text('nom_origine').notNull(),
    commentaire: text('commentaire'),
    /** Nouvelle version d'un même document (≠ doublon binaire, ≠ suspicion de double comptabilisation). */
    version: integer('version').notNull().default(1),
    remplaceDocumentId: uuid('remplace_document_id'),
    nbPages: integer('nb_pages'),
    motifStatut: text('motif_statut'),
    creeLe: creeLe(),
    majLe: horodatage('maj_le').notNull().defaultNow(),
  },
  (t) => [index('documents_entite').on(t.cabinetId, t.entiteId, t.statut)],
);

/** Chaque arrivée d'un même binaire (mail, téléphone, import) est une occurrence de réception distincte. */
export const receptions = pgTable('receptions', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  documentId: uuid('document_id').notNull().references(() => documents.id),
  canal: canalReception('canal').notNull(),
  deposantId: uuid('deposant_id').references(() => utilisateurs.id),
  doublonBinaire: boolean('doublon_binaire').notNull().default(false),
  /** Provenance : connexion mail, identifiant fournisseur du message, pièce jointe, etc. */
  provenance: jsonb('provenance'),
  recuLe: horodatage('recu_le').notNull().defaultNow(),
});

export const pagesDocument = pgTable('pages_document', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  documentId: uuid('document_id').notNull().references(() => documents.id),
  numero: integer('numero').notNull(),
  texte: text('texte'),
  lignes: jsonb('lignes'),
  methode: text('methode').notNull(),
});

export const extractions = pgTable('extractions', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  documentId: uuid('document_id').notNull().references(() => documents.id),
  version: integer('version').notNull().default(1),
  /** structure (Factur-X/UBL), couche_texte, ocr, ia, saisie_humaine */
  methode: text('methode').notNull(),
  moteur: text('moteur'),
  champs: jsonb('champs').notNull(),
  verifications: jsonb('verifications').notNull(),
  /** projet → revu → valide ; une extraction non validée reste un projet. */
  statut: text('statut').notNull().default('projet'),
  actuelle: boolean('actuelle').notNull().default(true),
  creeLe: creeLe(),
});

/** Signalement d'erreur par un déposant ou un collaborateur, demandes de complément. */
export const echangesDocument = pgTable('echanges_document', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  documentId: uuid('document_id').notNull().references(() => documents.id),
  type: text('type').notNull(), // signalement_erreur | demande_complement | reponse
  message: text('message').notNull(),
  auteurId: uuid('auteur_id').notNull().references(() => utilisateurs.id),
  resolu: boolean('resolu').notNull().default(false),
  creeLe: creeLe(),
});

// ───────────────────────────── Données comptables importées ─────────────────────────────

export const lignesEcriture = pgTable(
  'lignes_ecriture',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    entiteId: uuid('entite_id').notNull().references(() => entites.id),
    exerciceId: uuid('exercice_id').notNull().references(() => exercices.id),
    lotImportId: uuid('lot_import_id').notNull().references(() => lotsImport.id),
    numeroLigne: integer('numero_ligne').notNull(),
    journalCode: text('journal_code').notNull(),
    journalLib: text('journal_lib').notNull(),
    ecritureNum: text('ecriture_num').notNull(),
    ecritureDate: date('ecriture_date', { mode: 'string' }).notNull(),
    compteNum: text('compte_num').notNull(),
    compteLib: text('compte_lib').notNull(),
    compAuxNum: text('comp_aux_num'),
    compAuxLib: text('comp_aux_lib'),
    pieceRef: text('piece_ref').notNull(),
    pieceDate: date('piece_date', { mode: 'string' }),
    ecritureLib: text('ecriture_lib').notNull(),
    debit: montant('debit').notNull(),
    credit: montant('credit').notNull(),
    ecritureLet: text('ecriture_let'),
    dateLet: date('date_let', { mode: 'string' }),
    validDate: date('valid_date', { mode: 'string' }),
    montantDevise: montant('montant_devise'),
    idevise: text('idevise'),
  },
  (t) => [
    index('lignes_lot').on(t.lotImportId, t.numeroLigne),
    index('lignes_exercice_compte').on(t.exerciceId, t.compteNum),
  ],
);

export const mouvementsBancaires = pgTable('mouvements_bancaires', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  lotImportId: uuid('lot_import_id').references(() => lotsImport.id),
  iban: text('iban'),
  dateOperation: date('date_operation', { mode: 'string' }).notNull(),
  dateValeur: date('date_valeur', { mode: 'string' }),
  montant: montant('montant').notNull(),
  libelle: text('libelle').notNull(),
  referenceBanque: text('reference_banque'),
});

/** Factures, avoirs, échéances : alimenté par les extractions validées. */
export const factures = pgTable('factures', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  documentId: uuid('document_id').references(() => documents.id),
  sens: text('sens').notNull(), // achat | vente
  estAvoir: boolean('est_avoir').notNull().default(false),
  numero: text('numero'),
  tiersNom: text('tiers_nom'),
  tiersSiren: text('tiers_siren'),
  dateEmission: date('date_emission', { mode: 'string' }),
  dateEcheance: date('date_echeance', { mode: 'string' }),
  totalHt: montant('total_ht'),
  totalTva: montant('total_tva'),
  totalTtc: montant('total_ttc'),
  devise: text('devise').notNull().default('EUR'),
});

/** Liens pièce ↔ écriture ↔ mouvement (n-n), proposés ou validés, avec leurs critères. */
export const rapprochements = pgTable('rapprochements', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  niveau: text('niveau').notNull(), // exact | regle | suggestion_ia
  elements: jsonb('elements').notNull(),
  criteres: jsonb('criteres').notNull(),
  ecart: montant('ecart'),
  statut: text('statut').notNull().default('propose'),
  creeLe: creeLe(),
});

// ───────────────────────────── Contrôles, constats, décisions ─────────────────────────────

export const executionsControles = pgTable('executions_controles', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  exerciceId: uuid('exercice_id').notNull().references(() => exercices.id),
  lotImportId: uuid('lot_import_id').notNull().references(() => lotsImport.id),
  /** Version des données de l'exercice au moment de l'exécution. */
  versionDonnees: integer('version_donnees').notNull(),
  statut: statutLot('statut').notNull().default('en_attente'),
  obsolete: boolean('obsolete').notNull().default(false),
  lancePar: uuid('lance_par').references(() => utilisateurs.id),
  creeLe: creeLe(),
  termineLe: horodatage('termine_le'),
});

export const resultatsControles = pgTable('resultats_controles', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  executionId: uuid('execution_id').notNull().references(() => executionsControles.id),
  controleId: text('controle_id').notNull(),
  versionControle: text('version_controle').notNull(),
  statut: statutControle('statut').notNull(),
  motif: text('motif'),
  parametres: jsonb('parametres').notNull(),
  mesures: jsonb('mesures').notNull(),
  source: jsonb('source').notNull(),
});

export const constats = pgTable(
  'constats',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    entiteId: uuid('entite_id').notNull().references(() => entites.id),
    exerciceId: uuid('exercice_id').notNull().references(() => exercices.id),
    executionId: uuid('execution_id').notNull().references(() => executionsControles.id),
    resultatId: uuid('resultat_id').notNull().references(() => resultatsControles.id),
    controleId: text('controle_id').notNull(),
    cle: text('cle').notNull(),
    gravite: graviteConstat('gravite').notNull(),
    titre: text('titre').notNull(),
    explication: text('explication').notNull(),
    actionProposee: text('action_proposee').notNull(),
    montant: montant('montant'),
    lignesConcernees: jsonb('lignes_concernees').notNull(),
    preuves: jsonb('preuves').notNull(),
    statutRevue: statutRevue('statut_revue').notNull().default('a_examiner'),
    affecteA: uuid('affecte_a').references(() => utilisateurs.id),
    /** Vrai lorsque les données ont changé depuis la décision : le travail est à revoir. */
    aRevoir: boolean('a_revoir').notNull().default(false),
    creeLe: creeLe(),
  },
  (t) => [index('constats_exercice').on(t.exerciceId, t.statutRevue)],
);

/** Dossier de révision exportable (PDF + données structurées + inventaire des pièces), figé sur une exécution donnée. */
export const exportsRevision = pgTable('exports_revision', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  exerciceId: uuid('exercice_id').notNull().references(() => exercices.id),
  executionId: uuid('execution_id').notNull().references(() => executionsControles.id),
  versionDonnees: integer('version_donnees').notNull(),
  statut: statutLot('statut').notNull().default('en_attente'),
  /** Toujours « projet » tant qu'aucune validation professionnelle n'a été enregistrée. */
  mention: text('mention').notNull().default('projet'),
  clePdf: text('cle_pdf'),
  cleDonnees: text('cle_donnees'),
  sha256Pdf: text('sha256_pdf'),
  sha256Donnees: text('sha256_donnees'),
  erreur: text('erreur'),
  demandePar: uuid('demande_par').references(() => utilisateurs.id),
  creeLe: creeLe(),
  termineLe: horodatage('termine_le'),
});

/** Décisions et validations humaines : toujours rattachées à une version déterminée de la cible. */
export const decisions = pgTable('decisions', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  cibleType: text('cible_type').notNull(), // constat | extraction | document | dossier_revision
  cibleId: uuid('cible_id').notNull(),
  versionCible: integer('version_cible').notNull(),
  action: text('action').notNull(),
  motif: text('motif'),
  auteurId: uuid('auteur_id').notNull().references(() => utilisateurs.id),
  creeLe: creeLe(),
});

export const commentaires = pgTable('commentaires', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  cibleType: text('cible_type').notNull(),
  cibleId: uuid('cible_id').notNull(),
  texte: text('texte').notNull(),
  auteurId: uuid('auteur_id').notNull().references(() => utilisateurs.id),
  creeLe: creeLe(),
});

/** Règles et paramètres propres au cabinet (versionnés, approuvés, réversibles). */
export const reglesCabinet = pgTable('regles_cabinet', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  controleId: text('controle_id').notNull(),
  entiteId: uuid('entite_id_cible'),
  parametres: jsonb('parametres').notNull(),
  version: integer('version').notNull().default(1),
  statut: text('statut').notNull().default('proposee'), // proposee | approuvee | retiree
  approuveePar: uuid('approuvee_par').references(() => utilisateurs.id),
  creeLe: creeLe(),
});

/** Propositions produites par l'IA : jamais appliquées sans décision humaine. */
export const propositionsIa = pgTable('propositions_ia', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  tache: text('tache').notNull(),
  modele: text('modele').notNull(),
  versionPrompt: text('version_prompt').notNull(),
  cibleType: text('cible_type').notNull(),
  cibleId: uuid('cible_id').notNull(),
  contenu: jsonb('contenu').notNull(),
  preuves: jsonb('preuves').notNull(),
  confiance: text('confiance').notNull().default('non_evaluee'),
  statut: text('statut').notNull().default('non_examinee'),
  creeLe: creeLe(),
});

// ───────────────────────────── Sources réglementaires (référentiel partagé, sans donnée client) ─────────────────────────────

export const sourcesReglementaires = pgTable('sources_reglementaires', {
  id: id(),
  reference: text('reference').notNull(),
  emetteur: text('emetteur').notNull(),
  url: text('url'),
  version: text('version'),
  datePublication: date('date_publication', { mode: 'string' }),
  dateEffet: date('date_effet', { mode: 'string' }),
  periodeApplication: text('periode_application'),
  passage: text('passage'),
  resume: text('resume'),
  etatVerification: text('etat_verification').notNull().default('non_verifiee'),
  dateVerification: date('date_verification', { mode: 'string' }),
  creeLe: creeLe(),
});

// ───────────────────────────── Connexions mail ─────────────────────────────

export const connexionsMail = pgTable('connexions_mail', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  fournisseur: fournisseurMail('fournisseur').notNull(),
  adresse: text('adresse').notNull(),
  statut: statutConnexion('statut').notNull().default('non_connecte'),
  /** Permissions OAuth réellement accordées (≠ filtres fonctionnels ci-dessous). */
  scopesAccordes: jsonb('scopes_accordes'),
  /** Jetons chiffrés applicativement (AES-256-GCM) ; jamais journalisés. */
  jetonsChiffres: text('jetons_chiffres'),
  filtres: jsonb('filtres'),
  dateDebutRecuperation: date('date_debut_recuperation', { mode: 'string' }),
  curseur: text('curseur'),
  derniereSynchro: horodatage('derniere_synchro'),
  derniereErreur: text('derniere_erreur'),
  creePar: uuid('cree_par').references(() => utilisateurs.id),
  creeLe: creeLe(),
});

export const messagesMail = pgTable(
  'messages_mail',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    connexionId: uuid('connexion_id').notNull().references(() => connexionsMail.id),
    idFournisseur: text('id_fournisseur').notNull(),
    recuLe: horodatage('recu_le'),
    expediteur: text('expediteur'),
    statut: text('statut').notNull(),
    detail: jsonb('detail'),
  },
  (t) => [uniqueIndex('messages_mail_unique').on(t.connexionId, t.idFournisseur)],
);

// ───────────────────────────── Abonnements ─────────────────────────────

export const abonnements = pgTable('abonnements', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  offre: text('offre').notNull(),
  statut: text('statut').notNull(), // essai | actif | suspendu | resilie
  debut: date('debut', { mode: 'string' }).notNull(),
  finEssai: date('fin_essai', { mode: 'string' }),
  fin: date('fin', { mode: 'string' }),
  quotas: jsonb('quotas').notNull(),
  creeLe: creeLe(),
});

export const evenementsFacturation = pgTable('evenements_facturation', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  abonnementId: uuid('abonnement_id').notNull().references(() => abonnements.id),
  type: text('type').notNull(),
  montant: montant('montant'),
  detail: jsonb('detail'),
  creeLe: creeLe(),
});

// ───────────────────────────── Audit et conservation ─────────────────────────────

/** Journal en ajout seul, chaîné par empreinte (voir le déclencheur dans la migration de sécurité). */
export const journalAudit = pgTable(
  'journal_audit',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    cabinetId: uuid('cabinet_id').notNull(),
    acteurId: uuid('acteur_id'),
    acteurType: text('acteur_type').notNull().default('utilisateur'), // utilisateur | systeme
    action: text('action').notNull(),
    cibleType: text('cible_type'),
    cibleId: text('cible_id'),
    entiteId: uuid('entite_id_cible'),
    details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
    horodatage: horodatage('horodatage').notNull().defaultNow(),
    empreintePrecedente: text('empreinte_precedente'),
    empreinte: text('empreinte'),
  },
  (t) => [index('journal_audit_cabinet').on(t.cabinetId, t.id)],
);

export const politiquesConservation = pgTable('politiques_conservation', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  categorie: text('categorie').notNull(),
  dureeJours: integer('duree_jours'),
  fondement: text('fondement'),
  /** L'immuabilité (Object Lock) n'est jamais activée par défaut : elle exige une durée et un responsable définis. */
  immuable: boolean('immuable').notNull().default(false),
  valideePar: uuid('validee_par').references(() => utilisateurs.id),
  creeLe: creeLe(),
});
