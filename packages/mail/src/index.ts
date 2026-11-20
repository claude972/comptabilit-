/**
 * @comtaple/mail — connecteurs de messagerie EN LECTURE SEULE (Gmail / Google Workspace, Microsoft 365 / Outlook).
 * Le simulateur de test n'est PAS exporté ici : il n'est accessible que par `@comtaple/mail/simulateur`.
 */
export type {
  EtatConnexion,
  EtatCurseur,
  EtatSurveillance,
  ExtraitQualification,
  IdFournisseur,
  IssueSynchronisation,
  JeuDeJetons,
  MessageBrut,
  PieceJointeBrute,
  Provenance,
  ProvenanceDepot,
  Rattachement,
  ResultatSynchronisation,
  Signalement,
  StatutConnexion,
} from './types.js';
export type {
  EvenementJournal,
  Horloge,
  Http,
  InitHttp,
  Journal,
  MagasinConnexions,
  MemoireEmpreintes,
  RecepteurPieces,
  ValeurJournal,
} from './ports.js';
export { horlogeSysteme, httpNatif } from './ports.js';
export * from './erreurs.js';
export {
  clesSurveillees,
  JOURS_PAR_DEFAUT_AVANT_CONNEXION,
  resoudreDateDebut,
  schemaConfigurationConnexion,
  TAILLE_MAX_PIECE_PAR_DEFAUT,
  type ConfigurationConnexion,
  type ConfigurationConnexionEntree,
} from './configuration.js';
export { chiffrerJetons, dechiffrerJetons, doitEtreRechiffre, type CleChiffrement, type Trousseau } from './chiffrement.js';
export {
  defiPkceS256,
  genererVerifieurPkce,
  preparerAutorisation,
  SCOPE_GMAIL_LECTURE,
  SCOPE_MS_LECTURE,
  SCOPE_MS_LECTURE_PARTAGEE,
  SCOPES_MS_PROTOCOLE,
  scopesDemande,
  scopesDonneesRequis,
  scopesManquants,
  validerRetourAutorisation,
  type ClientOAuth,
  type DemandeAutorisation,
  type DemandeEnAttente,
  type ParametresAutorisation,
  type ParametresRetour,
  type ResultatRevocation,
  type TypeBoite,
} from './oauth.js';
export { decrirePerimetre, type FiltreLogiciel, type PermissionOAuth, type Perimetre } from './perimetre.js';
export { detecterFactureDerriereLien, extraitPourQualification, LIMITES_EXTRAIT, masquerAdresse } from './extrait.js';
export { assainirNomPiece, categoriserPiece, evaluerPiece, LIMITES_MESSAGE, lireDimensionsImage, REGLES_INTERNES_PIECES, type DecisionPiece, type MotifIgnore } from './pieces.js';
export { filtrerMessage, rattacher } from './rattachement.js';
export {
  chargerClesGoogle,
  repondreValidationGraph,
  URL_CLES_GOOGLE,
  validerNotificationsGraph,
  validerPushPubSub,
  type EvenementCycleDeVie,
  type NotificationGmail,
  type NotificationGraph,
  type ParametresPushPubSub,
} from './notifications.js';
export type { Jwk } from './jwt.js';
export {
  evaluerStatutIntegration,
  HOTES_OFFICIELS,
  STATUT_INTEGRATION_INITIAL,
  type PreuveConnexion,
  type StatutIntegration,
} from './statut.js';
export type { ContexteAppel, FournisseurMail, PageChangements } from './fournisseurs/commun.js';
export { creerFournisseurGmail, URLS_GMAIL_OFFICIELLES, type ConfigurationGmail, type UrlsGmail } from './fournisseurs/gmail.js';
export {
  creerFournisseurMicrosoft,
  URLS_MICROSOFT_OFFICIELLES,
  type ConfigurationMicrosoft,
  type UrlsMicrosoft,
} from './fournisseurs/microsoft.js';
export { REPRISE_PAR_DEFAUT, type OptionsReprise } from './http.js';
export { creerMoteurMail, MoteurMail, type DependancesMoteur } from './synchronisation.js';
