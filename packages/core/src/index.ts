/** @comtaple/core — moteur métier déterministe et pur (aucun accès réseau, base ou fichier). */

// 1. montant
export { analyserMontantFr, dec, estChaineDecimale, estNul, schemaChaineDecimale, somme, versChaine } from './montant.js';
export type { ChaineDecimale } from './montant.js';

// 2. identifiants
export { SOURCES_IDENTIFIANTS, sirenDeTvaFr, validerIban, validerSiren, validerSiret, validerTvaIntracomFr } from './identifiants.js';
export type { ResultatValidation } from './identifiants.js';

// 3. fec
export { CHAMPS_FEC, CODES_ANOMALIES_FEC, CONTROLES_FEC_NON_IMPLEMENTES, PLAFOND_ANOMALIES_FEC, TAILLE_MAX_LIGNE_FEC, analyserFec, enBlocs, referentielFec } from './fec/analyser.js';
export type { CodeAnomalieFec } from './fec/analyser.js';
export type { AnomalieFec, LigneFec, OptionsAnalyseFec, RapportFec, ReferentielFec } from './fec/types.js';

// 4. controles
export { CATALOGUE_CONTROLES, executerControles, genererCatalogueMarkdown } from './controles/catalogue.js';
export type {
  Constat, ContexteControle, CycleControle, DefinitionControle, LigneEcriture, ResultatControle, SourceRegle, StatutControle,
} from './controles/types.js';
export { DATE_VERIFICATION_SOURCES, SOURCES } from './sources.js';

// 5. facture
export { extraireChampsFacture } from './facture/texte.js';
export { ErreurDocumentXml, SOURCE_FACTURE_XML, TAILLE_MAX_XML_FACTURE, extraireChampsFacturX, extraireChampsUbl } from './facture/xml.js';
export { TAUX_TVA_CONNUS, verifierCoherenceFacture } from './facture/verification.js';
export type { ChampExtrait, ChampsFacture, PageTexte, VerificationFacture } from './facture/types.js';

// 6. synthetique
export { SIREN_SYNTHETIQUE, genererFecSynthetique } from './synthetique/fec.js';
export type { AnomalieInjectee, AnomalieSynthetique, FecSynthetique, OptionsFecSynthetique } from './synthetique/fec.js';
export { genererTexteFactureSynthetique } from './synthetique/facture.js';
export type { AttenduFactureSynthetique, OptionsTexteFactureSynthetique, TexteFactureSynthetique } from './synthetique/facture.js';

// 7. banque (lot 2) — lecture de relevés
export { lireCamt053 } from './banque/camt053.js';
export { lireOfx } from './banque/ofx.js';
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
