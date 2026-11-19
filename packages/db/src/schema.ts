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
  /** Remplacé par une version plus récente : conservé et consultable, mais plus jamais la version de travail. */
  'remplace',
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
/** `active`, `expire`, `revoque`, `supprimee` sont les statuts du moteur @comtaple/mail (les autres valeurs sont historiques). */
export const statutConnexion = pgEnum('statut_connexion', ['non_connecte', 'connecte', 'expire', 'revoque', 'erreur', 'active', 'supprimee']);

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

/**
 * Lettres de mission et avenants (un avenant référence la lettre qu'il modifie).
 * `contenu` est la description structurée saisie et relue par le cabinet (périmètre, durée, honoraires, obligations,
 * livrables, mandats, limites, conditions de révision). Une lettre non validée est un projet et n'a aucun effet.
 */
export const lettresMission = pgTable('lettres_mission', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  missionId: uuid('mission_id').notNull().references(() => missions.id),
  avenantDe: uuid('avenant_de'),
  documentId: uuid('document_id'),
  dateEffet: date('date_effet', { mode: 'string' }).notNull(),
  contenu: jsonb('contenu').notNull(),
  /** saisie_humaine | proposition_avenant (préparée par le logiciel à partir d'un travail hors périmètre) */
  origine: text('origine').notNull().default('saisie_humaine'),
  version: integer('version').notNull().default(1),
  statut: text('statut').notNull().default('projet'), // projet | validee | remplacee
  redigeePar: uuid('redigee_par').references(() => utilisateurs.id),
  valideePar: uuid('validee_par').references(() => utilisateurs.id),
  valideeLe: horodatage('validee_le'),
  creeLe: creeLe(),
});

/** Travaux et demandes rattachés à la mission applicable à leur date. */
export const travaux = pgTable('travaux', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  dateTravail: date('date_travail', { mode: 'string' }).notNull(),
  /** Code de prestation du référentiel du cabinet (ex. tenue, revision, fiscal_tva). */
  prestation: text('prestation').notNull(),
  description: text('description').notNull(),
  /** Temps OBSERVÉ, saisi par son auteur ; jamais confondu avec une estimation. */
  tempsObserveMinutes: integer('temps_observe_minutes'),
  auteurId: uuid('auteur_id').notNull().references(() => utilisateurs.id),
  creeLe: creeLe(),
});

/** Barème de temps du cabinet par prestation : base explicite des estimations. */
export const baremesTemps = pgTable(
  'baremes_temps',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    prestation: text('prestation').notNull(),
    minutesReference: integer('minutes_reference').notNull(),
    definiPar: uuid('defini_par').references(() => utilisateurs.id),
    creeLe: creeLe(),
  },
  (t) => [uniqueIndex('baremes_unique').on(t.cabinetId, t.prestation)],
);

/**
 * Paramètres internes du cabinet. Le coût horaire interne sert au calcul de marge des missions ; il n'a aucune valeur
 * par défaut : tant qu'il n'est pas saisi, aucune marge n'est calculée.
 */
export const parametresCabinet = pgTable('parametres_cabinet', {
  cabinetId: uuid('cabinet_id').primaryKey().references(() => cabinets.id),
  coutHoraireInterneHt: montant('cout_horaire_interne_ht'),
  majPar: uuid('maj_par').references(() => utilisateurs.id),
  majLe: horodatage('maj_le').notNull().defaultNow(),
});

/** Registre des conseils : un conseil reste un projet jusqu'à sa validation, puis exige une autorisation d'envoi. */
export const conseils = pgTable('conseils', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  missionId: uuid('mission_id').references(() => missions.id),
  dateConseil: date('date_conseil', { mode: 'string' }).notNull(),
  auteurId: uuid('auteur_id').notNull().references(() => utilisateurs.id),
  objet: text('objet').notNull(),
  contenu: text('contenu').notNull(),
  destinataire: text('destinataire').notNull(),
  /** Identifiants de documents du dossier joints au conseil. */
  pieces: jsonb('pieces').notNull().default(sql`'[]'::jsonb`),
  version: integer('version').notNull().default(1),
  remplaceConseilId: uuid('remplace_conseil_id'),
  statut: text('statut').notNull().default('projet'), // projet | valide | envoi_autorise | remplace
  validePar: uuid('valide_par').references(() => utilisateurs.id),
  valideLe: horodatage('valide_le'),
  envoiAutorisePar: uuid('envoi_autorise_par').references(() => utilisateurs.id),
  envoiAutoriseLe: horodatage('envoi_autorise_le'),
  creeLe: creeLe(),
});

/**
 * Événements constatés autour d'un conseil. Envoi, remise, réception et lecture sont quatre faits distincts :
 * chacun n'est enregistré que s'il est réellement établi, avec son justificatif.
 */
export const evenementsConseil = pgTable('evenements_conseil', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  conseilId: uuid('conseil_id').notNull().references(() => conseils.id),
  type: text('type').notNull(), // envoi | remise | reception | lecture
  dateEvenement: horodatage('date_evenement').notNull(),
  canal: text('canal').notNull(),
  justificatif: text('justificatif').notNull(),
  justificatifDocumentId: uuid('justificatif_document_id'),
  saisiPar: uuid('saisi_par').notNull().references(() => utilisateurs.id),
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

/**
 * Campagne d'import : un même type de fichier importé pour de nombreux dossiers en une opération suivie.
 * Chaque dossier garde son propre lot, traité isolément : l'échec de l'un n'affecte pas les autres.
 */
export const campagnesImport = pgTable('campagnes_import', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  libelle: text('libelle').notNull(),
  type: text('type').notNull(), // fec | releve_bancaire
  /** ouverte | close | annulee */
  statut: text('statut').notNull().default('ouverte'),
  creePar: uuid('cree_par').notNull().references(() => utilisateurs.id),
  creeLe: creeLe(),
});

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
  campagneId: uuid('campagne_id').references(() => campagnesImport.id),
  /** Annulation RÉVERSIBLE : les données du lot sont conservées, seulement écartées ; ce champ permet de le rétablir. */
  statutAvantAnnulation: text('statut_avant_annulation'),
  annulePar: uuid('annule_par').references(() => utilisateurs.id),
  annuleLe: horodatage('annule_le'),
  motifAnnulation: text('motif_annulation'),
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
  /** Pièce : document dont ce dépôt est une nouvelle version. */
  remplaceDocumentId: uuid('remplace_document_id'),
  /** Campagne d'import à laquelle ce dépôt appartient, le cas échéant. */
  campagneId: uuid('campagne_id'),
  /** Paramètres propres à l'usage (ex. profil de colonnes confirmé pour un relevé CSV). */
  parametres: jsonb('parametres'),
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
    /** Version suivante de ce document, quand il a été remplacé. */
    remplacePar: uuid('remplace_par'),
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

/** Un relevé d'un compte bancaire tel que lu dans un fichier importé (un fichier peut contenir plusieurs relevés). */
export const relevesBancaires = pgTable('releves_bancaires', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  lotImportId: uuid('lot_import_id').notNull().references(() => lotsImport.id),
  format: text('format').notNull(),
  iban: text('iban'),
  identifiant: text('identifiant'),
  devise: text('devise'),
  soldeOuverture: montant('solde_ouverture'),
  dateOuverture: date('date_ouverture', { mode: 'string' }),
  soldeCloture: montant('solde_cloture'),
  dateCloture: date('date_cloture', { mode: 'string' }),
  totalMouvements: montant('total_mouvements').notNull(),
  nbMouvements: integer('nb_mouvements').notNull(),
  /** ok | ecart | non_verifiable — « non vérifiable » n'est jamais assimilé à « ok ». */
  cadrage: text('cadrage').notNull(),
  ecart: montant('ecart'),
  /** Relevé tel que produit par le moteur (sert à reconstituer l'entrée des contrôles). */
  brut: jsonb('brut').notNull(),
  creeLe: creeLe(),
});

export const mouvementsBancaires = pgTable(
  'mouvements_bancaires',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    entiteId: uuid('entite_id').notNull().references(() => entites.id),
    /** Lot qui a introduit le mouvement ; un réimport ou un relevé chevauchant ne le duplique pas. */
    lotImportId: uuid('lot_import_id').references(() => lotsImport.id),
    releveId: uuid('releve_id').references(() => relevesBancaires.id),
    rang: integer('rang').notNull().default(0),
    cleIdempotence: text('cle_idempotence').notNull(),
    iban: text('iban'),
    identifiantCompte: text('identifiant_compte'),
    devise: text('devise'),
    dateOperation: date('date_operation', { mode: 'string' }).notNull(),
    dateValeur: date('date_valeur', { mode: 'string' }),
    /** Signé : positif = encaissement sur le compte, négatif = décaissement. */
    montant: montant('montant').notNull(),
    libelle: text('libelle').notNull(),
    referenceBanque: text('reference_banque'),
    referenceBoutEnBout: text('reference_bout_en_bout'),
    contrepartieNom: text('contrepartie_nom'),
    brut: jsonb('brut').notNull(),
    creeLe: creeLe(),
  },
  (t) => [uniqueIndex('mouvements_idempotence').on(t.entiteId, t.cleIdempotence), index('mouvements_date').on(t.entiteId, t.dateOperation)],
);

/**
 * Chaque lot dans lequel un mouvement bancaire a été vu. Un mouvement est PRIS EN COMPTE tant qu'au moins un des lots
 * qui le contiennent est actif : annuler un relevé n'efface rien et ne retire pas un mouvement présent dans un autre.
 */
export const mouvementsLots = pgTable(
  'mouvements_lots',
  {
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    entiteId: uuid('entite_id').notNull().references(() => entites.id),
    mouvementId: uuid('mouvement_id').notNull().references(() => mouvementsBancaires.id),
    lotImportId: uuid('lot_import_id').notNull().references(() => lotsImport.id),
  },
  (t) => [uniqueIndex('mouvements_lots_unique').on(t.mouvementId, t.lotImportId), index('mouvements_lots_lot').on(t.lotImportId)],
);

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

/** Exécution du rapprochement banque ↔ comptabilité d'un exercice, figée sur une version des données. */
export const executionsRapprochement = pgTable('executions_rapprochement', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  exerciceId: uuid('exercice_id').notNull().references(() => exercices.id),
  lotImportId: uuid('lot_import_id').notNull().references(() => lotsImport.id),
  versionDonnees: integer('version_donnees').notNull(),
  statut: statutLot('statut').notNull().default('en_attente'),
  obsolete: boolean('obsolete').notNull().default(false),
  parametres: jsonb('parametres').notNull().default(sql`'{}'::jsonb`),
  mesures: jsonb('mesures'),
  /** Identifiants des lignes d'écriture de banque et des mouvements bancaires restés sans rapprochement. */
  nonRapprochesEcritures: jsonb('non_rapproches_ecritures'),
  nonRapprochesMouvements: jsonb('non_rapproches_mouvements'),
  /** Plusieurs solutions équivalentes : aucune n'est retenue. */
  ambiguites: jsonb('ambiguites'),
  /** Recherches abandonnées (budget de combinaisons épuisé) : dit explicitement, jamais silencieux. */
  abandons: jsonb('abandons'),
  erreur: text('erreur'),
  lancePar: uuid('lance_par').references(() => utilisateurs.id),
  creeLe: creeLe(),
  termineLe: horodatage('termine_le'),
});

/** Liens écritures ↔ mouvements (n-n) proposés par le moteur, avec leurs critères ; validés ou rejetés par un humain. */
export const rapprochements = pgTable(
  'rapprochements',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    entiteId: uuid('entite_id').notNull().references(() => entites.id),
    exerciceId: uuid('exercice_id').notNull().references(() => exercices.id),
    executionId: uuid('execution_id').notNull().references(() => executionsRapprochement.id),
    niveau: text('niveau').notNull(), // exact | regle
    regle: text('regle').notNull(),
    /** Identifiants de lignes d'écriture (côté comptabilité). */
    cotesEcritures: jsonb('cotes_ecritures').notNull(),
    /** Identifiants de mouvements bancaires (côté banque). */
    cotesMouvements: jsonb('cotes_mouvements').notNull(),
    criteres: jsonb('criteres').notNull(),
    explication: text('explication').notNull(),
    ecart: montant('ecart').notNull(),
    /** propose → valide | rejete ; une proposition n'est jamais une validation. */
    statut: text('statut').notNull().default('propose'),
    motif: text('motif'),
    decidePar: uuid('decide_par').references(() => utilisateurs.id),
    decideLe: horodatage('decide_le'),
    creeLe: creeLe(),
  },
  (t) => [index('rapprochements_execution').on(t.executionId, t.statut)],
);

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

/**
 * Écritures d'inventaire PROPOSÉES : strictement séparées des écritures importées (qui ne sont jamais modifiées).
 * Préparer, approuver, exporter et intégrer dans le logiciel comptable sont des étapes distinctes ; l'intégration
 * dans un logiciel tiers n'est pas réalisée par ce logiciel.
 */
export const ecrituresInventaire = pgTable('ecritures_inventaire', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  exerciceId: uuid('exercice_id').notNull().references(() => exercices.id),
  dateEcriture: date('date_ecriture', { mode: 'string' }).notNull(),
  libelle: text('libelle').notNull(),
  /** saisie_humaine (seule origine à ce jour) */
  origine: text('origine').notNull().default('saisie_humaine'),
  justification: text('justification').notNull(),
  /** Détail du calcul du montant, rédigé par l'auteur. */
  calcul: text('calcul').notNull(),
  pieces: jsonb('pieces').notNull().default(sql`'[]'::jsonb`),
  /** Lignes [{ compteNum, compteLib, debit, credit }] en chaînes décimales, équilibrées (vérifié par le moteur). */
  lignes: jsonb('lignes').notNull(),
  totalDebit: montant('total_debit').notNull(),
  statut: text('statut').notNull().default('proposee'), // proposee | approuvee | rejetee | exportee
  versionDonnees: integer('version_donnees').notNull(),
  proposeePar: uuid('proposee_par').notNull().references(() => utilisateurs.id),
  decideePar: uuid('decidee_par').references(() => utilisateurs.id),
  decideeLe: horodatage('decidee_le'),
  motifDecision: text('motif_decision'),
  exporteeLe: horodatage('exportee_le'),
  creeLe: creeLe(),
});

/** Export de restitution complet d'un dossier (originaux + données + décisions), archive ZIP avec manifeste d'empreintes. */
export const restitutions = pgTable('restitutions', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  entiteId: uuid('entite_id').notNull().references(() => entites.id),
  statut: statutLot('statut').notNull().default('en_attente'),
  cleArchive: text('cle_archive'),
  sha256: text('sha256'),
  taille: bigint('taille', { mode: 'number' }),
  /** Résumé du contenu : nombre d'éléments par catégorie, originaux exclus et pourquoi. */
  resume: jsonb('resume'),
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
  /** null = préférence de tout le cabinet ; sinon exception propre à un dossier. */
  entiteId: uuid('entite_id_cible'),
  parametres: jsonb('parametres').notNull(),
  version: integer('version').notNull().default(1),
  statut: text('statut').notNull().default('proposee'), // proposee | approuvee | retiree | refusee
  motif: text('motif').notNull().default(''),
  /** Mesure d'impact réalisée avant activation (avant / après sur un exercice donné). */
  impact: jsonb('impact'),
  proposeePar: uuid('proposee_par').references(() => utilisateurs.id),
  approuveePar: uuid('approuvee_par').references(() => utilisateurs.id),
  decideeLe: horodatage('decidee_le'),
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

/** Pages officielles surveillées (référentiel de l'éditeur). Le suivi dit quand une source est indisponible. */
export const surveillancesSources = pgTable('surveillances_sources', {
  id: id(),
  emetteur: text('emetteur').notNull(),
  libelle: text('libelle').notNull(),
  url: text('url').notNull().unique(),
  actif: boolean('actif').notNull().default(true),
  dernierEssaiLe: horodatage('dernier_essai_le'),
  /** Dernière vérification RÉUSSIE : au-delà d'un certain délai, la veille sur cette source n'est plus assurée. */
  dernierSuccesLe: horodatage('dernier_succes_le'),
  dernierStatut: text('dernier_statut').notNull().default('jamais_verifiee'), // jamais_verifiee | inchangee | changement_detecte | indisponible
  dernierDetail: text('dernier_detail'),
  empreinteContenu: text('empreinte_contenu'),
  creeLe: creeLe(),
});

/**
 * Évolutions réglementaires. Une détection automatique crée une ligne « detectee_a_qualifier » SANS résumé :
 * le résumé, les dates, les conditions et les critères sont saisis par une personne, après lecture de la source.
 * Aucune évolution ne modifie une règle de production.
 */
export const evolutionsReglementaires = pgTable('evolutions_reglementaires', {
  id: id(),
  surveillanceId: uuid('surveillance_id').references(() => surveillancesSources.id),
  emetteur: text('emetteur').notNull(),
  reference: text('reference').notNull(),
  url: text('url').notNull(),
  passage: text('passage'),
  datePublication: date('date_publication', { mode: 'string' }),
  dateEffet: date('date_effet', { mode: 'string' }),
  conditions: text('conditions'),
  resume: text('resume'),
  criteres: jsonb('criteres').notNull().default(sql`'{}'::jsonb`),
  etatVerification: text('etat_verification').notNull().default('detectee_a_qualifier'), // detectee_a_qualifier | verifiee | ecartee
  verifieeLe: date('verifiee_le', { mode: 'string' }),
  detecteeLe: horodatage('detectee_le').notNull().defaultNow(),
});

/** Suivi d'une évolution par un cabinet pour un dossier (propre au cabinet, jamais mutualisé). */
export const suivisEvolution = pgTable(
  'suivis_evolution',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    entiteId: uuid('entite_id').notNull().references(() => entites.id),
    evolutionId: uuid('evolution_id').notNull().references(() => evolutionsReglementaires.id),
    statut: text('statut').notNull(), // a_examiner | pris_en_compte | sans_objet
    note: text('note'),
    auteurId: uuid('auteur_id').notNull().references(() => utilisateurs.id),
    majLe: horodatage('maj_le').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('suivis_evolution_unique').on(t.entiteId, t.evolutionId)],
);

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
  /** État du moteur @comtaple/mail (configuration, curseurs, surveillance) ; ne contient aucun jeton. */
  etat: jsonb('etat'),
  /** Échéance de la surveillance (watch Gmail, abonnements Graph), pour l'entretien planifié. */
  surveillanceEcheance: horodatage('surveillance_echeance'),
  /** Issue de la dernière synchronisation (terminee, interrompue, arretee…). */
  derniereIssue: text('derniere_issue'),
  /** Trace du dernier appel de lecture réussi, évaluée par `evaluerStatutIntegration`. */
  preuve: jsonb('preuve'),
});

/** Demande d'autorisation OAuth en attente, liée à l'utilisateur et au cabinet qui l'ont lancée. */
export const demandesConnexionMail = pgTable('demandes_connexion_mail', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  utilisateurId: uuid('utilisateur_id').notNull().references(() => utilisateurs.id),
  /** SHA-256 du paramètre `state` (le state lui-même n'est pas conservé en clair). */
  empreinteState: text('empreinte_state').notNull().unique(),
  /** Demande (vérifieur PKCE compris) et configuration choisie, chiffrées (AES-256-GCM). */
  donneesChiffrees: text('donnees_chiffrees').notNull(),
  expireLe: horodatage('expire_le').notNull(),
  creeLe: creeLe(),
});

/** Idempotence de la collecte : une pièce jointe (connexion, message, pièce) n'est reçue qu'une fois. */
export const piecesMailVues = pgTable(
  'pieces_mail_vues',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    connexionId: uuid('connexion_id').notNull().references(() => connexionsMail.id),
    idMessage: text('id_message').notNull(),
    idPieceJointe: text('id_piece_jointe').notNull(),
    /** document | doublon_binaire | a_qualifier */
    issue: text('issue').notNull(),
    documentId: uuid('document_id'),
    nomFichier: text('nom_fichier'),
    creeLe: creeLe(),
  },
  (t) => [uniqueIndex('pieces_mail_vues_unique').on(t.connexionId, t.idMessage, t.idPieceJointe)],
);

/** Pièces reçues par mail dont le rattachement est ambigu : rattachées à AUCUN dossier tant qu'un gestionnaire ne les a pas affectées. */
export const piecesAQualifier = pgTable('pieces_a_qualifier', {
  id: id(),
  cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
  connexionId: uuid('connexion_id').notNull().references(() => connexionsMail.id),
  fichierId: uuid('fichier_id').notNull().references(() => fichiers.id),
  nomFichier: text('nom_fichier').notNull(),
  provenance: jsonb('provenance').notNull(),
  raisons: jsonb('raisons').notNull(),
  candidats: jsonb('candidats').notNull(),
  /** Expéditeur, objet et court extrait du message : contenu NON FIABLE, pour la qualification humaine. */
  extrait: jsonb('extrait'),
  /** en_attente | affectee */
  statut: text('statut').notNull().default('en_attente'),
  /** Dossier choisi par le gestionnaire (volontairement pas nommé entite_id : la pièce n'appartient à aucun dossier avant). */
  dossierAffecteId: uuid('dossier_affecte_id').references(() => entites.id),
  documentId: uuid('document_id').references(() => documents.id),
  affecteePar: uuid('affectee_par').references(() => utilisateurs.id),
  affecteeLe: horodatage('affectee_le'),
  creeLe: creeLe(),
});

/** Signalements de la collecte mail à traiter par un humain (facture derrière un lien, pièce ignorée). */
export const signalementsMail = pgTable(
  'signalements_mail',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    connexionId: uuid('connexion_id').notNull().references(() => connexionsMail.id),
    idMessage: text('id_message').notNull(),
    type: text('type').notNull(),
    idPieceJointe: text('id_piece_jointe').notNull().default(''),
    /** Domaines des liens (jamais l'URL complète), ou nom et motif de la pièce ignorée. */
    detail: jsonb('detail').notNull(),
    creeLe: creeLe(),
  },
  (t) => [uniqueIndex('signalements_mail_unique').on(t.connexionId, t.idMessage, t.type, t.idPieceJointe)],
);

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

/**
 * Grille tarifaire de l'éditeur (référentiel partagé, sans donnée de cabinet ; lecture seule pour l'application).
 * Les grilles de démonstration portent `fictif = true` : leurs montants ne sont pas des tarifs commerciaux.
 */
export const offresAbonnement = pgTable('offres_abonnement', {
  code: text('code').primaryKey(),
  /** Définition complète de l'offre (forfait, tranches, quotas, jours d'essai), validée par le moteur. */
  definition: jsonb('definition').notNull(),
  fictif: boolean('fictif').notNull().default(true),
  proposee: boolean('proposee').notNull().default(true),
  creeLe: creeLe(),
});

export const abonnements = pgTable(
  'abonnements',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    offre: text('offre').notNull().references(() => offresAbonnement.code),
    statut: text('statut').notNull(), // essai | actif | suspendu | resilie
    debut: date('debut', { mode: 'string' }).notNull(),
    finEssai: date('fin_essai', { mode: 'string' }),
    fin: date('fin', { mode: 'string' }),
    /** Changement d'offre demandé, appliqué à la prochaine échéance par l'éditeur. */
    offreDemandee: text('offre_demandee').references(() => offresAbonnement.code),
    motifResiliation: text('motif_resiliation'),
    quotas: jsonb('quotas').notNull(),
    creeLe: creeLe(),
  },
  (t) => [uniqueIndex('abonnements_cabinet').on(t.cabinetId)],
);

/** Échéance mensuelle : lignes calculées par le moteur, paiement par virement suivi et rapproché par l'éditeur. */
export const echeancesAbonnement = pgTable(
  'echeances_abonnement',
  {
    id: id(),
    cabinetId: uuid('cabinet_id').notNull().references(() => cabinets.id),
    abonnementId: uuid('abonnement_id').notNull().references(() => abonnements.id),
    periodeDebut: date('periode_debut', { mode: 'string' }).notNull(),
    periodeFin: date('periode_fin', { mode: 'string' }).notNull(),
    offre: text('offre').notNull(),
    dossiersActifs: integer('dossiers_actifs').notNull(),
    lignes: jsonb('lignes').notNull(),
    totalHt: montant('total_ht').notNull(),
    fictif: boolean('fictif').notNull(),
    /** en_attente_virement | paye | en_retard | annulee */
    statutPaiement: text('statut_paiement').notNull().default('en_attente_virement'),
    referenceVirement: text('reference_virement').notNull(),
    payeLe: date('paye_le', { mode: 'string' }),
    creeLe: creeLe(),
  },
  (t) => [uniqueIndex('echeances_periode').on(t.cabinetId, t.periodeDebut)],
);

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
