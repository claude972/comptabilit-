/** @comtaple/core — moteur métier déterministe et pur (aucun accès réseau, base ou fichier). */

// 1. montant
export { analyserMontantFr, arrondirALEuro, dec, estChaineDecimale, estNul, schemaChaineDecimale, somme, versChaine } from './montant.js';
export type { ChaineDecimale } from './montant.js';

// 2. identifiants
export { SOURCES_IDENTIFIANTS, sirenDeTvaFr, validerIban, validerSiren, validerSiret, validerTvaIntracomFr } from './identifiants.js';
export type { ResultatValidation } from './identifiants.js';

// 3. fec
export { CHAMPS_FEC, CODES_ANOMALIES_FEC, CONTROLES_FEC_NON_IMPLEMENTES, PLAFOND_ANOMALIES_FEC, TAILLE_MAX_LIGNE_FEC, analyserFec, enBlocs, referentielFec } from './fec/analyser.js';
export type { CodeAnomalieFec } from './fec/analyser.js';
export type { AnomalieFec, LigneFec, OptionsAnalyseFec, RapportFec, ReferentielFec } from './fec/types.js';

// 4. controles
export { CATALOGUE_CONTROLES, CONTROLES_EN_FLUX, executerControles, executerControlesFlux, genererCatalogueMarkdown } from './controles/catalogue.js';
export { reduireAuxEcrituresDeBanque, sourceEnMemoire } from './controles/flux.js';
export { DepassementBudget } from './controles/outils.js';
export { type Correspondance, type EtatAssociation, type EtatCorrespondance, cleCompteBancaire, etatCorrespondanceBanque, masquerCompteBancaire, verifierCorrespondances } from './controles/correspondance-banque.js';
export type {
  BudgetFlux, Constat, ContexteControle, ContexteControleFlux, CycleControle, DefinitionControle, DemandePassage, LigneEcriture, OrdrePassage, ResultatControle, SourceLignes, SourceRegle,
  StatutControle,
} from './controles/types.js';
export { DATE_VERIFICATION_SOURCES, SOURCES } from './sources.js';

// 5. facture
export { extraireChampsFacture } from './facture/texte.js';
export { determinerSensPiece, sirenDePartie } from './facture/sens.js';
export type { DemandeSensPiece, IdentifiantsPartie, SensPiece } from './facture/sens.js';
export { ErreurDocumentXml, SOURCE_FACTURE_ACHETEUR, SOURCE_FACTURE_XML, TAILLE_MAX_XML_FACTURE, extraireChampsFacturX, extraireChampsUbl } from './facture/xml.js';
export {
  CHAMPS_DESTINATAIRE, VERSION_ANALYSEUR_FACTURE, appliquerCorrectionDestinataire, desaccordsAvecLectureAutomatique, destinataireEffectif, destinataireNonLu, estChampHumain, fusionnerReanalyseDestinataire,
  incoherencesDestinataire, inchangeDepuis, lignesDestinataire, normaliserSaisieDestinataire,
} from './facture/destinataire-humain.js';
export type {
  ChampDestinataire, ChampDestinataireHumain, DesaccordDestinataire, LigneDestinataire, ResultatCorrectionDestinataire, ResultatFusionReanalyse, ResultatReanalyse, SaisieDestinataire,
  ValeurAutomatique, ValeursDestinataire,
} from './facture/destinataire-humain.js';
export { TAUX_TVA_CONNUS, verifierCoherenceFacture } from './facture/verification.js';
export { champsFactureVides } from './facture/types.js';
export type { ChampExtrait, ChampsFacture, PageTexte, VerificationFacture } from './facture/types.js';

// 6. synthetique
export { SIREN_SYNTHETIQUE, genererFecSynthetique } from './synthetique/fec.js';
export type { AnomalieInjectee, AnomalieSynthetique, FecSynthetique, OptionsFecSynthetique } from './synthetique/fec.js';
export { genererTexteFactureSynthetique } from './synthetique/facture.js';
export type { AttenduFactureSynthetique, OptionsTexteFactureSynthetique, TexteFactureSynthetique } from './synthetique/facture.js';

// 7. banque (lot 2) — lecture de relevés
export { lireCamt053 } from './banque/camt053.js';
export { lireOfx } from './banque/ofx.js';
export { FORMAT_RELEVE_AGREGATION, lireReleveAgregation, schemaReleveAgregation, SOURCE_RELEVE_AGREGATION } from './banque/agregation.js';
export type { ReleveAgregation } from './banque/agregation.js';
export { lireCsvBanque, proposerProfilCsv, schemaProfilCsvBanque } from './banque/csv.js';
export type { ProfilCsvBanque } from './banque/csv.js';
export { decoderTexteReleve, detecterFormatReleve } from './banque/detection.js';
export { LONGUEUR_MAX_LIBELLE_BANCAIRE, PLAFOND_ANOMALIES_RELEVE, TAILLE_MAX_RELEVE } from './banque/commun.js';
export { SOURCE_CAMT053_CFONB, SOURCE_CAMT053_ISO, SOURCE_CSV_BANQUE, SOURCE_OFX, SOURCE_OFX_SGML } from './banque/sources.js';
export type { AnomalieReleve, CompteReleve, GraviteAnomalieReleve, MouvementBancaire, OptionsLectureReleve, RapportReleve } from './banque/types.js';

// 8. rapprochement (lot 2)
export { normaliserReference, rapprocher, verifierSuggestion } from './rapprochement/rapprocher.js';
export { elementDepuisLigneEcriture, elementDepuisMouvement, elementsBanqueDepuisEcritures } from './rapprochement/conversion.js';
export { PARAMETRES_RAPPROCHEMENT_PAR_DEFAUT, REGLES_RAPPROCHEMENT, schemaParametresRapprochement } from './rapprochement/types.js';
export type {
  CritereRapprochement, DescriptionRegle, ElementRapprochable, ParametresRapprochement, Rapprochement, ResultatRapprochement,
} from './rapprochement/types.js';

// 9. synthetique (lot 2) — relevés
export { IBAN_SYNTHETIQUE, genererReleveSynthetique } from './synthetique/releve.js';
export type { AttenduReleveSynthetique, MouvementAttendu, OptionsReleveSynthetique, ReleveSynthetique } from './synthetique/releve.js';

// 9. abonnement
export { calculerEcheance, etatQuota, schemaOffre, serviceOuvert, situationAbonnement, verifierOffre } from './abonnement.js';
export type { CalculEcheance, EtatAbonnement, EtatQuota, LigneEcheance, Offre, SituationAbonnement, StatutAbonnement } from './abonnement.js';

// 10. missions
export { PRESTATIONS, estimerTemps, lettreApplicable, schemaContenuLettre, situerTravail } from './missions.js';
export type { CodePrestation, ContenuLettre, EstimationTemps, LettreDatee, SituationTravail } from './missions.js';

// 11. veille
export { evaluerApplicabilite, identifierOperations, OPERATIONS_IDENTIFIABLES, RACINES_OPERATIONS, schemaCriteresEvolution, texteComparable } from './veille.js';
export type { Applicabilite, CriteresEvolution, OperationIdentifiable, ProfilDossier } from './veille.js';

// 12. etats — balance, projets de compte de résultat et de bilan (états de travail, jamais des comptes annuels)
export { calculerBalance } from './etats/balance.js';
export { CODES_RUBRIQUES_RESERVES, CORRESPONDANCE_PCG, correspondancePour, verifierCorrespondance } from './etats/correspondance.js';
export { MOTIF_SANS_PRECEDENT, RESERVE_N1_NON_VALIDE, projeterEtatsPrecedent, verifierExercicePrecedent } from './etats/comparatif.js';
export type { EtatsPrecedent } from './etats/comparatif.js';
export { COMPTE_RESULTAT_EN_COURS, projeterBilan, projeterCompteDeResultat } from './etats/projection.js';
export { DATE_APPLICATION_REGLEMENT_2022_06, SOURCES_ETATS } from './etats/sources.js';
export type {
  Balance, ControleEtat, CorrespondanceRubriques, EtatProjet, EtatRubrique, LigneBalance, LigneBalanceAuxiliaire, OptionsBalance, RegleAffectation, RubriqueDefinition, RubriqueProjetee,
} from './etats/types.js';

// 13. indicateurs — aide à la revue (jamais un diagnostic)
export {
  CATALOGUE_INDICATEURS, SEUIL_HAUSSE_DETTES_FISCALES_SOCIALES_PAR_DEFAUT, SEUIL_JOURS_SANS_ECRITURE_AVANT_CLOTURE, calculerIndicateurs, genererCatalogueIndicateursMarkdown,
} from './indicateurs/calcul.js';
export type { ComposanteIndicateur, ContexteIndicateurs, DefinitionIndicateur, OptionsIndicateurs, ValeurIndicateur } from './indicateurs/types.js';

// 14. rentabilité des missions
export { calculerRentabiliteMission } from './rentabilite.js';
export type { RentabiliteMission, TravailObserve } from './rentabilite.js';

// 15. états et fiscalité (lot 5) — liasse fiscale, projet d'annexe, propositions d'écritures d'inventaire : toujours des PROJETS
export {
  DERNIERE_CLOTURE_COUVERTE_LIASSE_2026, PERIMETRE_LIASSE, TABLES_LIASSE, TABLE_LIASSE_REEL_NORMAL_2026, TABLE_LIASSE_REEL_SIMPLIFIE_2026, preparerLiasse, tableLiassePour, verifierTableLiasse,
} from './etats/liasse.js';
export type {
  CaseLiasse, CodeTableauLiasse, ComparatifLiasse, CompteContributeur, ValeurN1, DemandeLiasse, ImpotSurLeResultat, LiasseAbstention, LiasseProjet, LigneLiasseDefinition, MotifAbstention, RegimeLiasse, ResultatLiasse, TableLiasse,
  TableauNonCouvert, TerritoireFiscal,
} from './etats/liasse.js';
export { ARTICLES_ANNEXE, MODELE_ANNEXE, SEUILS_TAILLE_PAR_DEFAUT, articlesRequisPourCategorie, evaluerCategorieTaille, preparerAnnexe } from './etats/annexe.js';
export type {
  AnnexeAbstention, AnnexeProjet, CategorieEntiteAnnexe, DemandeAnnexe, EvaluationTaille, LigneTableauAnnexe, ResultatAnnexe, RubriqueAnnexe, SeuilsCategorie, SeuilsTaille, StatutRubriqueAnnexe, TableauAnnexe,
} from './etats/annexe.js';
export { CONVENTIONS_INVENTAIRE, MOTIF_DEGRESSIF_NON_ACTIVE, REGLES_INVENTAIRE, lirePeriodeDansLibelle, proposerEcrituresInventaire } from './etats/inventaire.js';
export type {
  AbstentionInventaire, ComptesInventaire, CompteSansImmobilisation, ConventionJoursAmortissement, DemandeInventaire, ImmobilisationAAmortir, ImmobilisationSuivie, LignePlanAmortissement, LignePropositionInventaire, ModeAmortissement,
  PeriodeCouverte, PropositionEcritureInventaire, RapprochementCompteImmobilisation, RapprochementDotation, RapprochementImmobilisations, RegleInventaire, ResultatInventaire, SignalementInventaire,
  TypePropositionInventaire,
} from './etats/inventaire.js';
export { MENTION_PROJET, SOURCES_FISCALES } from './etats/sources-fiscales.js';
export { TABLE_IMMOBILISATIONS, preparerTableauxImmobilisations } from './etats/tableaux-immobilisations.js';
export type {
  CadreImmobilisations, CelluleImmobilisation, CodeTableauImmobilisations, ColonneImmobilisations, CompteLigneImmobilisation, ComparatifImmobilisations, DemandeTableauxImmobilisations, FichierLigneAmortissements,
  FichierLigneBrut, ImmobilisationAbstention, LigneTableauImmobilisations, ResultatTableauxImmobilisations, StatutCellule, TableauImmobilisations, TableauxImmobilisationsProjet,
} from './etats/tableaux-immobilisations.js';
export { LIGNES_CA, LIGNES_CA_RSI, DETAIL_RESULTAT_FISCAL, LIGNES_RESULTAT_FISCAL, RENVOIS, RENVOIS_RSI, preparerDetailResultat } from './etats/detail-resultat.js';
export type {
  CelluleVentilation, CompteChiffreAffaires, ControleDetail, DemandeDetailResultat, DetailExceptionnel, DetailResultatProjet, EtatQualification, LigneChiffreAffaires, QualificationRenvoi, QualificationVentilation, RenvoiDetail,
  LigneDetailResultatFiscal, LigneResultatFiscal, ResultatDetailResultat, ResultatFiscalProjet, ResultatSigne, VentilationChiffreAffaires,
} from './etats/detail-resultat.js';
export { CLASSEMENTS, LIBELLES_COLONNES_2055_B, LIBELLE_CLASSEMENT, LIBELLES_2054_BIS, LIGNES_2055_B, LIGNES_2055_C, LIGNES_CESSIONS, TABLEAUX_SAISIS, preparerSaisiesTableaux, validerSaisieTableau } from './etats/saisies-tableaux.js';
export type {
  AmortissementsDerogatoiresProjet, CadreIIIProjet, CelluleCase, CelluleMontant, ChargesRepartiesProjet, LigneChargeRepartie, LigneDerogatoire, ClassementPlusValue, DemandeSaisiesTableaux, EcartsReevaluationProjet, LigneCession, LigneEcartReevaluation, ResultatSaisiesTableaux, SaisieTableau, StatutLigneSaisie, TableauSaisi, TraceSaisie,
} from './etats/saisies-tableaux.js';
export { CASES_2033_D, CLES_2033_D, COLONNES_PROVISIONS, LIGNES_CADRE_C, LIGNES_DEROGATOIRES, LIGNES_PROVISIONS, preparerFormulaire2033D } from './etats/formulaire-2033d.js';
export type { CaseSaisie2033D, DemandeFormulaire2033D, Formulaire2033DProjet, LigneCadreC } from './etats/formulaire-2033d.js';
export { CASES_2033_E, CLES_2033_E, dureeEnMois, preparerFormulaire2033E } from './etats/formulaire-2033e.js';
export type { CaseSaisie2033E, DemandeFormulaire2033E, Formulaire2033EProjet } from './etats/formulaire-2033e.js';
export { LIBELLES_NOMBRES, preparerFormulaire2033F } from './etats/formulaire-2033f.js';
export type { CaseNombre, DemandeFormulaire2033F, Formulaire2033FProjet, LigneAssocie } from './etats/formulaire-2033f.js';
export { preparerFormulaire2033G } from './etats/formulaire-2033g.js';
export type { DemandeFormulaire2033G, Formulaire2033GProjet, LigneFiliale } from './etats/formulaire-2033g.js';

// 16. tiers, factures et avoirs suivis, échéances et règlements — aide à la révision, recalculée à la lecture
export { estDateIso } from './dates.js';
export { cleEcriture, normaliserNomTiers, suivreTiersEtFactures } from './tiers/moteur.js';
export { PARAMETRES_TIERS_FACTURES_PAR_DEFAUT, TOLERANCE_MONTANT_MAX } from './tiers/types.js';
export type {
  AbstentionReglementGroupe, BanqueImputation, CandidatEcriture, CriteresAppariement, DecisionARevoir, DecisionFacture, DecisionTiers, DemandeTiersFactures, EtatFacture, FicheFacture, FicheTiers, IdentifiantTiers, Imputation,
  ParametresTiersFactures, PieceFacture, PropositionImputation, PropositionTiers, RapprochementValide, ReglementGroupeProbable, RefEcriture, ResultatTiersFactures, SuspicionDoubleComptabilisation, TypeTiers,
} from './tiers/types.js';

// Amélioration contrôlée : suggestions déterministes tirées des décisions de revue d'un cabinet.
export type {
  CategorieAmelioration,
  ControleAmelioration,
  CorrectionExtraction,
  CriteresAmelioration,
  DecisionAnterieure,
  DecisionConstatRevue,
  DecisionRapprochementRevue,
  EntreeAmelioration,
  FondementControle,
  PreuveDecision,
  ResultatAmelioration,
  SuggestionAmelioration,
} from './amelioration.js';
export { CATEGORIES_AMELIORATION, CRITERES_AMELIORATION, PARAMETRES_SEUIL_MONTANT, controlesPourAmelioration, fondementControle, suggererAmeliorations } from './amelioration.js';

// Notifications poussées discrètes : charge utile sans donnée, liste blanche des services de notification.
export { PAGE_POUSSEE, PHRASES_POUSSEES, SERVICES_NOTIFICATION, TITRE_POUSSEE, TYPES_POUSSES, chargeUtilePoussee, reduireAgentUtilisateur, serialiserChargeUtilePoussee, verifierPointAcces } from './notifications-poussees.js';
export type { ChargeUtilePoussee, RefusPointAcces, ServiceNotification, TypePousse, VerificationPointAcces } from './notifications-poussees.js';

// Reprise du fichier des immobilisations par import CSV (D-092) : schéma commun à la saisie, lecture, correspondance, contrôle.
export { COEFFICIENTS_DEGRESSIFS, MODES_AMORTISSEMENT, coefficientDegressifAttendu, schemaImmobilisation, schemaImmobilisationBase } from './immobilisations/schema.js';
export type { ImmobilisationSaisie } from './immobilisations/schema.js';
export {
  CHAMPS_REPRISE,
  CODES_CHAMPS_REPRISE,
  ErreurReprise,
  LIGNES_MAX_REPRISE,
  LONGUEUR_MAX_VALEUR_LUE,
  TAILLE_MAX_REPRISE,
  VERSION_REPRISE_IMMOBILISATIONS,
  analyserReprise,
  cleDoublon,
  controlerLigne,
  lireFichierReprise,
  neutraliserCellule,
  normaliserDesignation,
  problemesCorrespondance,
  proposerCorrespondance,
} from './immobilisations/reprise.js';
export type {
  CauseDoublon,
  ChampReprise,
  CodeChampReprise,
  CodeErreurReprise,
  ContexteReprise,
  CorrespondanceColonnes,
  EncodageReprise,
  FichierLu,
  ImmobilisationReprise,
  LigneReprise,
  OptionsLectureReprise,
  PropositionCorrespondance,
  ResultatAnalyseReprise,
  Separateur,
  StatutLigneReprise,
} from './immobilisations/reprise.js';
