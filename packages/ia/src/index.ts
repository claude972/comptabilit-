/**
 * @comtaple/ia — passerelle IA interne unique, tâches IA et assistant documenté.
 * Le SIMULATEUR de test n'est PAS exporté ici : il n'est accessible que par `@comtaple/ia/simulateur`.
 * Le harnais d'évaluation et son corpus synthétique sont dans `@comtaple/ia/evaluation`.
 */
export { ENTETE_SIMULATEUR, HOTE_OFFICIEL_OVH, MODELES_IA, URL_BASE_OVH } from './modeles.js';
export * from './erreurs.js';
export type { EvenementTechnique, Horloge, Http, InitHttp, JournalTechnique } from './ports.js';
export { horlogeSysteme, httpNatif } from './ports.js';
export type {
  AppelFonctionBrut,
  DefinitionOutil,
  DemandeCompletion,
  DemandeEmbeddings,
  FournisseurIa,
  MessageIa,
  OrigineReponse,
  ReponseCompletion,
  ReponseEmbeddings,
} from './fournisseur.js';
export { creerFournisseurOvhDepuisEnv, FournisseurOvh, REPRISE_IA_PAR_DEFAUT } from './fournisseur-ovh.js';
export type { ConfigurationOvh, DependancesOvh, OptionsRepriseIa } from './fournisseur-ovh.js';
export { contientJeton, creerPseudonymiseur } from './pseudonymisation.js';
export type { Pseudonymiseur, TypePseudonyme } from './pseudonymisation.js';
export { empreinteSha256, estimerCout } from './audit.js';
export type { ContexteAppel, CoutEstime, EvenementAuditIa, JournalAuditIa, ResultatAppel, TarifsIa, TraceAppelIa, TraceFonctionMetier } from './audit.js';
export { evaluerStatutIa } from './statut.js';
export type { PreuveConnexionIa, StatutIa } from './statut.js';
export { PasserelleIa, versSchemaJson } from './passerelle.js';
export type {
  AppelFonction,
  ConfigurationPasserelle,
  DemandeConversation,
  DemandeJson,
  DemandeVecteurs,
  IssueConversation,
  IssueIndisponible,
  IssueJson,
  IssueVecteurs,
  ReferencePrompt,
  TourConversation,
  Verdict,
} from './passerelle.js';

export { extraireNombres, nombresAutorises, verifierNombres } from './garde-fous/nombres.js';
export type { VerdictNombres } from './garde-fous/nombres.js';
export { extraitPresent, LONGUEUR_MIN_EXTRAIT, normaliserPourCitation } from './garde-fous/citations.js';
export { detecterReferencesReglementaires, estAffirmationReglementaire } from './garde-fous/reglementaire.js';
export { delimiterDonnees, extraireUrls, tronquer } from './garde-fous/contenu.js';

export { confianceNonEvaluee, MENTION_CONFIANCE, REGLES_SYSTEME } from './taches/commun.js';
export type { Confiance, Repli, ResultatTache } from './taches/commun.js';
export * from './taches/classer-piece.js';
export * from './taches/rapprochements.js';
export * from './taches/lettre-mission.js';
export * from './taches/indicateurs.js';
export * from './taches/constat.js';

export * from './assistant/types.js';
export { creerFonctionsMetierTypes, normaliserMotsCles } from './assistant/fonctions-types.js';
export type { OptionsFonctionsTypes, PortsFonctionsMetier } from './assistant/fonctions-types.js';
export {
  construirePromptAssistant,
  ETIQUETTE_IA,
  FONCTION_REPONSE,
  OPTIONS_ASSISTANT_PAR_DEFAUT,
  PROMPT_ASSISTANT,
  repondreQuestion,
  schemaDemandeAssistant,
  schemaReponseModele,
} from './assistant/repondre.js';
export type { DemandeAssistant, DependancesAssistant, OptionsAssistant, ReponseModele } from './assistant/repondre.js';
export { ETIQUETTE_SANS_IA, repondreSansIa } from './assistant/sans-ia.js';
export type { DependancesSansIa } from './assistant/sans-ia.js';

export * from './recherche/index.js';
