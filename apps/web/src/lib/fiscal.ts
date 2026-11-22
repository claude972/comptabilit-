/** Types des réponses de `v1/exercices/:id/liasse`, `/annexe` et `/inventaire/propositions` (sous-ensemble affiché). */
export interface SourceRegle {
  reference: string;
  url?: string | null;
  verification?: string;
}
export interface CaseLiasse {
  ligne: string;
  libelle: string;
  nature: 'poste' | 'total' | 'resultat';
  codeCase: string | null;
  etatCodeCase: 'a_confirmer' | 'verifie';
  brut?: string;
  amortissementsDepreciations?: string;
  montant: string;
  /** Exercice précédent (N-1), même ligne ; `null` si la colonne est indisponible. */
  n1: { montant: string; brut?: string; amortissementsDepreciations?: string } | null;
  comptes: Array<{ compteNum: string; compteLib: string; montant: string }>;
  note: string | null;
}
export interface ControleEtat {
  code: string;
  statut: 'ok' | 'ecart' | 'non_verifiable';
  message: string;
  ecart: string | null;
}
export interface LiasseProjet {
  statut: 'projet';
  complet: boolean;
  manques: string[];
  mention: string;
  regime: 'reel_normal' | 'reel_simplifie';
  table: { id: string; version: string; millesimeFormulaire: string; etat: string };
  tableaux: Array<{ code: string; intitule: string; lignes: CaseLiasse[] }>;
  comparatif: { statut: 'fourni'; exercice: { debut: string; fin: string }; reserves: string[] } | { statut: 'indisponible'; motifs: string[] };
  controles: ControleEtat[];
  comptesNonAffectes: Array<{ compteNum: string; compteLib: string; solde: string }>;
  rubriquesNonAffectees: Array<{ code: string; libelle: string; montant: string; motif: string }>;
  tableauxNonCouverts: Array<{ code: string; intitule: string; couverture: 'non_couvert' | 'partiel'; motif: string; informationsComplementairesNecessaires: string[] }>;
}
export interface Abstention {
  statut: 'abstention';
  motifs: Array<{ code: string; message: string }>;
  perimetreCouvert?: string;
  mention: string;
}
/** Tableaux 2054, 2055 et 2033-C (D-104) : champ `tableauxImmobilisations` de la réponse de la liasse. */
export interface CelluleImmobilisation {
  codeCase: string | null;
  etatCodeCase: 'lu_a_confirmer' | 'a_confirmer';
  montant: string | null;
  n1: string | null;
  statut: 'etabli' | 'a_saisir' | 'abstention';
  motif: string | null;
}
export interface FichierLigneBrut {
  nbImmobilisations: number;
  valeurBruteOuverture: string | null;
  valeurBruteCloture: string | null;
  ecartOuverture: string | null;
  ecartCloture: string | null;
  sortiesDansExercice: { nombre: number; valeurBrute: string };
  composants: { nombre: number; valeurBrute: string };
  nbDonneesManquantes: number;
  motifs: string[];
}
export interface FichierLigneAmortissements {
  nbImmobilisations: number;
  amortissementsOuverture: string | null;
  ecartOuverture: string | null;
  dotationCalculee: string | null;
  calculComplet: boolean;
  dotationComptabilisee: string | null;
  ecartDotation: string | null;
  nbAbstentionsMoteur: number;
  motifs: string[];
}
export interface LigneImmobilisations {
  id: string;
  libelle: string;
  numeroRomain: string | null;
  nature: 'poste' | 'total' | 'non_ventile';
  cellules: Record<string, CelluleImmobilisation>;
  comptes: Array<{ compteNum: string; compteLib: string; ouverture: string | null; augmentations: string | null; diminutions: string | null; cloture: string }>;
  dontComposants: { codeCase: string | null; motif: string } | null;
  fichierBrut: FichierLigneBrut | null;
  fichierAmortissements: FichierLigneAmortissements | null;
  note: string | null;
}
export interface TableauImmobilisations {
  code: string;
  intitule: string;
  cadres: Array<{ id: string; titre: string; colonnes: Array<{ cle: string; numero: number | null; libelle: string; surFormulaire: boolean }>; lignes: LigneImmobilisations[] }>;
  cadresNonCouverts: Array<{ cadre: string; intitule: string; motif: string }>;
}
export interface TableauxImmobilisationsProjet {
  statut: 'projet';
  complet: false;
  manques: string[];
  mention: string;
  regime: 'reel_normal' | 'reel_simplifie';
  reserves: string[];
  aNouveauxIdentifies: boolean;
  tableaux: TableauImmobilisations[];
  totaux: Record<string, string | null>;
  comparatif: { statut: 'fourni'; exercice: { debut: string; fin: string }; reserves: string[] } | { statut: 'indisponible'; motifs: string[] };
  fichier: { fourni: boolean; nbImmobilisations: number; degressif: { active: boolean; motif: string }; abstentions: Array<{ immobilisation: string; libelle: string; code: string; motif: string }> };
  controles: ControleEtat[];
}
export interface ReponseLiasse {
  exercice: { id: string; debut: string; fin: string };
  regimeDemande: 'reel_normal' | 'reel_simplifie';
  resultat: LiasseProjet | Abstention;
  /** Absent d'une API plus ancienne. */
  tableauxImmobilisations?: TableauxImmobilisationsProjet | Abstention;
  /** Détail 2052 / 2053 (régime réel normal, D-106) ou « dont export » et renvois du 2033-B (régime simplifié, D-107). */
  detailResultat?: DetailResultatProjet | Abstention | null;
  /** Cadre III du 2033-C (régime simplifié) ou 2054 bis (régime réel normal), saisies ligne par ligne (D-112). */
  tableauxSaisis?: TableauxSaisisProjet | Abstention;
  /** Tableau 2033-D (régime simplifié, D-114) ; null au régime réel normal. */
  formulaire2033D?: Formulaire2033DProjet | null;
  /** Tableau 2033-E (effectifs, valeur ajoutée, CVAE) ; null au régime réel normal (D-115). */
  formulaire2033E?: Formulaire2033EProjet | null;
}
export interface RubriqueAnnexe {
  id: string;
  reference: string;
  section: string;
  titre: string;
  objet: string;
  requise: boolean;
  motifApplicabilite: string;
  statut: 'pre_rempli' | 'a_completer' | 'non_applicable_a_confirmer';
  motifStatut: string;
  preRemplissage: Array<{ titre: string; colonnes: Array<{ cle: string; libelle: string; aSaisir: boolean }>; lignes: Array<{ libelle: string; valeurs: Record<string, string | null>; estTotal: boolean }>; reserves: string[] }>;
  aSaisir: string[];
  confirmation: 'complete' | 'non_applicable' | null;
}
export interface AnnexeProjet {
  statut: 'projet';
  complet: boolean;
  manques: string[];
  mention: string;
  categorie: string;
  forme: 'annexe' | 'mentions_a_la_suite_du_bilan';
  reserves: string[];
  modele: { id: string; version: string; periodeApplication: string };
  rubriques: RubriqueAnnexe[];
}
export interface ReponseAnnexe {
  exercice: { id: string; debut: string; fin: string };
  categorieDeclaree: string | null;
  categorieIndicative: { categorie?: string; mention: string; [cle: string]: unknown };
  confirmations: Array<{ rubrique: string; etat: 'complete' | 'non_applicable'; note: string | null; creeLe: string; aRevoir: boolean }>;
  resultat: AnnexeProjet | Abstention;
}
export interface PropositionInventaire {
  id: string;
  type: string;
  dateEcriture: string;
  libelle: string;
  origine: { regle: string; versionRegle: string; signal: string };
  justification: string;
  calcul: Array<{ libelle: string; valeur: string }>;
  lignes: Array<{ compteNum: string; libelle: string; debit: string; credit: string }>;
  totalDebit: string;
  impacts: { resultat: string; totalActif: string; totalPassif: string; commentaire: string };
  hypotheses: string[];
  extourneLe: string | null;
  reprise: { ecritureInventaireId: string; statut: string } | null;
  planAmortissement?: LignePlanAmortissement[] | null;
  source?: SourceInventaire;
  sourcesComplementaires?: SourceInventaire[];
}
export interface SourceInventaire {
  type: string;
  reference: string;
  url: string | null;
  dateVerification: string | null;
  verification: 'verifiee' | 'non_verifiee' | 'sans_objet';
  periodeApplication: string | null;
}
export interface LignePlanAmortissement {
  rang: number;
  exerciceFin: string;
  methode: 'degressif' | 'lineaire';
  baseCalcul: string;
  dotation: string;
  cumul: string;
  vnc: string;
  formule: string;
  exerciceCourant: boolean;
}
export interface RapprochementDotation {
  compteDotation: string;
  immobilisations: string[];
  dotationCalculee: string | null;
  calculComplet: boolean;
  dotationComptabilisee: string;
  ecart: string | null;
  etat: 'aucune_dotation_comptabilisee' | 'identique' | 'differente' | 'non_ventilee' | 'calcul_indisponible';
  propositionsEcartees: boolean;
  message: string;
}
export interface RapprochementImmobilisations {
  dotations: RapprochementDotation[];
  comptes: Array<{ compte: string; immobilisations: string[]; valeurBruteSaisie: string; soldeBalance: string; ecart: string; etat: 'concordant' | 'ecart' | 'absent_de_la_balance'; message: string }>;
  comptesSansImmobilisation: Array<{ compte: string; libelle: string; solde: string; message: string }>;
}
export interface ReponsePropositions {
  signalements?: Array<{ code: string; immobilisation: string | null; titre: string; motif: string; source: SourceInventaire }>;
  rapprochement?: RapprochementImmobilisations;
  signalCesure: 'disponible' | 'controles_obsoletes' | 'controles_non_executes';
  amortissements: { proposes: boolean; motif: string };
  /** État du calcul du dégressif : non activé par défaut (décision de l'éditeur, AMORTISSEMENT_DEGRESSIF_ACTIVE). */
  degressif: { active: boolean; motif: string };
  mention: string;
  propositions: PropositionInventaire[];
  abstentions: Array<{ type: string; code: string; motif: string }>;
  conventions: string[];
  totaux: { nbPropositions: number; nbAbstentions: number; impactResultat: string };
}

export const LIBELLE_CATEGORIE: Record<string, string> = {
  micro_entreprise: 'Micro-entreprise',
  petite_entreprise: 'Petite entreprise',
  personne_morale_regime_simplifie: 'Personne morale au régime simplifié',
  moyenne_ou_grande_entreprise: 'Moyenne ou grande entreprise',
  a_confirmer: 'À confirmer',
};
export const LIBELLE_TYPE_PROPOSITION: Record<string, string> = {
  charge_constatee_avance: 'Charge constatée d’avance',
  produit_constate_avance: 'Produit constaté d’avance',
  facture_non_parvenue: 'Facture non parvenue',
  facture_a_etablir: 'Facture à établir',
  dotation_amortissement_lineaire: 'Dotation aux amortissements (linéaire)',
  dotation_amortissement_degressif: 'Dotation aux amortissements (dégressif)',
  cesure: 'Césure',
};

export const LIBELLE_MODE_AMORTISSEMENT: Record<string, string> = { lineaire: 'Linéaire', degressif: 'Dégressif' };
export const LIBELLE_ETAT_DOTATION: Record<string, string> = {
  aucune_dotation_comptabilisee: 'Aucune dotation comptabilisée',
  identique: 'Dotation déjà comptabilisée, identique au calcul',
  differente: 'Dotation déjà comptabilisée, écart avec le calcul',
  non_ventilee: 'Dotation comptabilisée à un compte non ventilé',
  calcul_indisponible: 'Dotation comptabilisée, calcul indisponible',
};
export const LIBELLE_ETAT_COMPTE_IMMOBILISATION: Record<string, string> = {
  concordant: 'Solde égal à la valeur saisie',
  ecart: 'Écart entre le solde et la valeur saisie',
  absent_de_la_balance: 'Absent de la balance',
};
export const LIBELLE_VERIFICATION_SOURCE: Record<string, string> = { verifiee: 'lue en ligne', non_verifiee: 'non vérifiée en ligne', sans_objet: 'convention interne' };

/** Détail du compte de résultat (2052 France / exportations, 2053 exceptionnel, renvois) : champ `detailResultat` de la réponse de la liasse (D-106). */
export type CelluleVentilation = { statut: 'etabli'; montant: string; codeCase: string | null; etatCodeCase: string } | { statut: 'abstention'; motif: string; codeCase: string | null; etatCodeCase: string };
export interface TraceQualification {
  note: string;
  qualifieePar: string;
  le: string;
  versionDonnees: number;
}
export interface CompteChiffreAffaires {
  compteNum: string;
  compteLib: string;
  solde: string;
  etat: 'sans_montant' | 'a_qualifier' | 'qualifie' | 'ecart' | 'a_revoir';
  qualification: (TraceQualification & { compte: string; montantFrance: string; montantExport: string }) | null;
  ecart?: string;
}
export interface LigneChiffreAffaires {
  id: string;
  libelle: string;
  comptes: CompteChiffreAffaires[];
  total: CelluleVentilation;
  france: CelluleVentilation;
  export: CelluleVentilation;
  qualifiee: boolean;
}
export interface RenvoiDetail {
  code: string;
  renvoi: string;
  tableau: '2052' | '2053' | '2033-B';
  libelle: string;
  codeCase: string | null;
  etatCodeCase: string;
  statut: 'a_saisir' | 'saisi' | 'a_revoir';
  montant: string | null;
  saisie: (TraceQualification & { code: string; montant: string }) | null;
  proposition: { montant: string; comptes: string[]; precision: string } | null;
  precision: string;
}
export interface DetailResultatProjet {
  statut: 'projet';
  complet: false;
  regime: 'reel_normal' | 'reel_simplifie';
  exercice: { debut: string; fin: string };
  ventilationChiffreAffaires: {
    lignes: LigneChiffreAffaires[];
    chiffreAffairesNet: { total: CelluleVentilation; france: CelluleVentilation; export: CelluleVentilation } | null;
    comptesNonAffectes: Array<{ compteNum: string; compteLib: string; solde: string; motif: string }>;
    qualificationsOrphelines: Array<{ compte: string; motif: string }>;
    nbComptesAQualifier: number;
    complete: boolean;
  };
  detailExceptionnel: null | { produits: Array<{ compteNum: string; compteLib: string; montant: string }>; charges: Array<{ compteNum: string; compteLib: string; montant: string }>; totalProduits: string; totalCharges: string; resultatExceptionnel: string; origine: string };
  renvois: RenvoiDetail[];
  /** Partie B du 2033-B ; null au régime réel normal. */
  resultatFiscal: ResultatFiscalProjet | null;
  renvoisNonPrepares: string[];
  controles: Array<{ code: string; statut: 'coherent' | 'ecart' | 'non_verifie'; message: string; ecart?: string }>;
  limites: string[];
  sources: string[];
  mention: string;
}
export const LIBELLE_ETAT_QUALIFICATION: Record<string, string> = {
  sans_montant: 'Sans montant',
  a_qualifier: 'À qualifier',
  qualifie: 'Qualifié',
  ecart: 'Écart : somme ≠ solde',
  a_revoir: 'À revoir : données modifiées',
};

/** Partie B « Résultat fiscal » du 2033-B (D-110). */
export type ResultatSigne =
  | { statut: 'etabli'; sens: 'benefice' | 'deficit' | 'nul'; montant: string; codeCase: string; etatCodeCase: string }
  | { statut: 'abstention'; motifs: string[]; codesCases: string[]; etatCodeCase: string };
export interface LigneResultatFiscal {
  cle: string;
  codeCase: string;
  etatCodeCase: string;
  libelle: string;
  role: 'reintegration' | 'deduction' | 'report_arriere' | 'imputation';
  statut: 'a_saisir' | 'saisi' | 'a_revoir';
  neant: boolean;
  montant: string | null;
  saisie: (TraceQualification & { code: string; montant: string }) | null;
  precision: string;
  detail: LigneDetailResultatFiscal[];
  controleDetail: { statut: 'coherent' | 'ecart' | 'non_verifie'; message: string; ecart?: string } | null;
}
export interface LigneDetailResultatFiscal {
  cle: string;
  codeCase: string;
  etatCodeCase: string;
  libelle: string;
  statut: 'a_saisir' | 'saisi' | 'a_revoir';
  neant: boolean;
  montant: string | null;
  saisie: (TraceQualification & { code: string; montant: string }) | null;
  precision: string;
  negatifPossible: boolean;
  additionne: boolean;
}
export interface ResultatFiscalProjet {
  resultatComptable: ResultatSigne;
  lignes: LigneResultatFiscal[];
  avantImputation: ResultatSigne;
  plafondImputation: { montant: string; regle: string } | null;
  apresImputation: ResultatSigne;
  controles: Array<{ code: string; statut: 'coherent' | 'ecart' | 'non_verifie'; message: string; ecart?: string }>;
  lignesManquantes: string[];
  nonPrepare: string[];
}
export interface EvenementQualification {
  nature: 'ventilation_ca' | 'renvoi' | 'tableau';
  cle: string;
  action: 'saisie' | 'retrait';
  montant: string | null;
  montantExport: string | null;
  note: string | null;
  versionDonnees: number;
  auteurId: string;
  le: string;
}
export interface ReponseHistorique {
  exerciceId: string;
  evenements: EvenementQualification[];
}

/** Cadre III du 2033-C et 2054 bis : champ `tableauxSaisis` de la réponse de la liasse (D-112). */
export type CelluleMontantSaisie = { statut: 'etabli'; montant: string; codeCase: string | null; etatCodeCase: string } | { statut: 'abstention'; motifs: string[]; codeCase: string | null; etatCodeCase: string };
export interface TraceSaisie {
  note: string;
  qualifieePar: string;
  le: string;
  versionDonnees: number;
}
export type StatutLigneSaisie = 'a_saisir' | 'saisi' | 'a_revoir';
export interface LigneCession {
  ligne: string;
  statut: StatutLigneSaisie;
  trace: TraceSaisie | null;
  nature: string | null;
  valeurActif: string | null;
  amortissements: string | null;
  valeurResiduelle: string | null;
  prixCession: string | null;
  classement: 'court_terme' | 'long_terme_19' | 'long_terme_15_12_8' | 'long_terme_0' | null;
  plusOuMoinsValue: string | null;
  colonnePlusValue: 'c5' | 'c6' | 'c7' | 'c8' | null;
}
export interface CadreIIIProjet {
  statut: 'projet';
  etat: 'a_saisir' | 'neant' | 'saisi';
  lignes: LigneCession[];
  totaux: { valeurActif: CelluleMontantSaisie; amortissements: CelluleMontantSaisie; valeurResiduelle: CelluleMontantSaisie; prixCession: CelluleMontantSaisie; c5: CelluleMontantSaisie; c6: CelluleMontantSaisie; c7: CelluleMontantSaisie; c8: CelluleMontantSaisie };
  plusValues19: { statut: StatutLigneSaisie; montant: string | null; trace: TraceSaisie | null; codeCase: string };
  regularisations: { statut: StatutLigneSaisie; trace: TraceSaisie | null; c5: string | null; c6: string | null; c7: string | null; c8: string | null; codes: { c5: string; c6: string; c7: string; c8: string } };
  totalGeneral: { c5: CelluleMontantSaisie; c6: CelluleMontantSaisie; c7: CelluleMontantSaisie; c8: CelluleMontantSaisie };
  controles: Array<{ code: string; statut: 'coherent' | 'ecart' | 'non_verifie'; message: string; ecart?: string }>;
  limites: string[];
  neant: TraceSaisie | null;
  mention: string;
}
export interface LigneEcartReevaluation {
  ligne: string;
  libelle: string;
  statut: StatutLigneSaisie;
  trace: TraceSaisie | null;
  c1: string | null;
  c2: string | null;
  c3: string | null;
  c4: string | null;
  c5: string | null;
  ecart: string | null;
  c6: string | null;
}
export interface EcartsReevaluationProjet {
  statut: 'projet';
  etat: 'a_saisir' | 'neant' | 'saisi';
  lignes: LigneEcartReevaluation[];
  totaux: { c1: CelluleMontantSaisie; c2: CelluleMontantSaisie; c3: CelluleMontantSaisie; c4: CelluleMontantSaisie; c5: CelluleMontantSaisie; c6: CelluleMontantSaisie };
  cadreB: { b1: { statut: StatutLigneSaisie; montant: string | null; trace: TraceSaisie | null }; b2: { statut: StatutLigneSaisie; montant: string | null; trace: TraceSaisie | null }; b3: CelluleMontantSaisie };
  controles: Array<{ code: string; statut: 'coherent' | 'ecart' | 'non_verifie'; message: string; ecart?: string }>;
  limites: string[];
  neant: TraceSaisie | null;
  mention: string;
}
export interface CelluleCase {
  codeCase: string | null;
  montant: string | null;
}
export interface LigneDerogatoire {
  ligne: string;
  libelle: string;
  groupe: 'I' | 'II' | 'III';
  statut: StatutLigneSaisie;
  trace: TraceSaisie | null;
  colonnes: Array<CelluleCase | null>;
}
export interface AmortissementsDerogatoiresProjet {
  statut: 'projet';
  etat: 'a_saisir' | 'neant' | 'saisi';
  lignes: LigneDerogatoire[];
  totaux: { I: Array<CelluleMontantSaisie | null>; II: Array<CelluleMontantSaisie | null>; III: Array<CelluleMontantSaisie | null>; general: Array<CelluleMontantSaisie | null> };
  nonVentile: { NW: CelluleMontantSaisie; NY: CelluleMontantSaisie; NZ: CelluleMontantSaisie };
  controles: Array<{ code: string; statut: 'coherent' | 'ecart' | 'non_verifie'; message: string; ecart?: string }>;
  limites: string[];
  neant: TraceSaisie | null;
  mention: string;
}
export interface LigneChargeRepartie {
  ligne: string;
  libelle: string;
  statut: StatutLigneSaisie;
  trace: TraceSaisie | null;
  debut: string | null;
  augmentations: string | null;
  dotations: string | null;
  fin: string | null;
  caseDotations: string;
  caseFin: string;
}
export interface ChargesRepartiesProjet {
  statut: 'projet';
  etat: 'a_saisir' | 'neant' | 'saisi';
  lignes: LigneChargeRepartie[];
  controles: Array<{ code: string; statut: 'coherent' | 'ecart' | 'non_verifie'; message: string; ecart?: string }>;
  limites: string[];
  neant: TraceSaisie | null;
  mention: string;
}
export interface TableauxSaisisProjet {
  statut: 'projet';
  cadreIII: CadreIIIProjet | null;
  ecartsReevaluation: EcartsReevaluationProjet | null;
  amortissementsDerogatoires: AmortissementsDerogatoiresProjet | null;
  chargesRepartiesPlusieursExercices: ChargesRepartiesProjet | null;
}
export const LIBELLES_COLONNES_2055_B = [
  'Dotations : différentiel de durée et autres (1)',
  'Dotations : mode dégressif (2)',
  'Dotations : amortissement fiscal exceptionnel (3)',
  'Reprises : différentiel de durée et autres (4)',
  'Reprises : mode dégressif (5)',
  'Reprises : amortissement fiscal exceptionnel (6)',
  'Mouvement net à la fin de l’exercice (7)',
] as const;
export const LIBELLE_CLASSEMENT: Record<string, string> = {
  court_terme: 'Court terme (colonne 5)',
  long_terme_19: 'Long terme à 19 % (colonne 6)',
  long_terme_15_12_8: 'Long terme à 15 % ou 12,8 % (colonne 7)',
  long_terme_0: 'Long terme à 0 % (colonne 8)',
};

/** Tableau 2033-D (D-114) : champ `formulaire2033D` de la réponse de la liasse. */
export interface CaseSaisie2033D {
  cle: string;
  codeCase: string;
  etatCodeCase: string;
  libelle: string;
  cadre: 'I-A' | 'I-B' | 'II' | 'III';
  type: 'montant' | 'entier';
  statut: 'a_saisir' | 'saisi' | 'a_revoir';
  neant: boolean;
  montant: string | null;
  saisie: (TraceQualification & { code: string; montant: string }) | null;
  precision: string | null;
  proposition: { montant: string; origine: string } | null;
}
export interface Formulaire2033DProjet {
  statut: 'projet';
  cases: CaseSaisie2033D[];
  cadreC: { etat: 'a_saisir' | 'neant' | 'saisi'; lignes: Array<{ ligne: string; statut: StatutLigneSaisie; trace: TraceSaisie | null; nature: string | null; montant: string | null }>; total780: CelluleCalculee2033D; neant: TraceSaisie | null };
  total870: CelluleCalculee2033D;
  controles: Array<{ code: string; statut: 'coherent' | 'ecart' | 'non_verifie'; message: string; ecart?: string }>;
  nonPrepare: string[];
  limites: string[];
  mention: string;
}
export type CelluleCalculee2033D = { statut: 'etabli'; montant: string; codeCase: string; etatCodeCase: string; calcul: string } | { statut: 'abstention'; motifs: string[]; codeCase: string; etatCodeCase: string };
export const LIGNES_PROVISIONS_2033D: Array<{ id: string; libelle: string; cases: [string, string, string, string] }> = [
  { id: 'AD', libelle: 'Provisions réglementées : amortissements dérogatoires', cases: ['600', '602', '604', '606'] },
  { id: 'AD30', libelle: 'dont majorations exceptionnelles de 30 %', cases: ['601', '603', '605', '607'] },
  { id: 'APR', libelle: 'Provisions réglementées : autres provisions réglementées', cases: ['610', '612', '614', '616'] },
  { id: 'PRC', libelle: 'Provisions pour risques et charges', cases: ['620', '622', '624', '626'] },
  { id: 'DIM', libelle: 'Provisions pour dépréciation : sur immobilisations', cases: ['630', '632', '634', '636'] },
  { id: 'DST', libelle: 'Provisions pour dépréciation : sur stocks et en cours', cases: ['640', '642', '644', '646'] },
  { id: 'DCL', libelle: 'Provisions pour dépréciation : sur comptes clients', cases: ['650', '652', '654', '656'] },
  { id: 'DAU', libelle: 'Provisions pour dépréciation : autres', cases: ['660', '662', '664', '666'] },
  { id: 'TOTAL', libelle: 'TOTAL', cases: ['680', '682', '684', '686'] },
];
export const LIGNES_DEROGATOIRES_2033D: Array<{ id: string; libelle: string; cases: [string, string] }> = [
  { id: 'FC', libelle: 'Fonds commercial', cases: ['681', '683'] },
  { id: 'INC', libelle: 'Autres immobilisations incorporelles', cases: ['700', '705'] },
  { id: 'TER', libelle: 'Terrains', cases: ['710', '715'] },
  { id: 'CON', libelle: 'Constructions', cases: ['720', '725'] },
  { id: 'ITM', libelle: 'Installations techniques, matériel et outillage', cases: ['730', '735'] },
  { id: 'IGA', libelle: 'Installations générales, agencements et aménagements divers', cases: ['740', '745'] },
  { id: 'MTR', libelle: 'Matériel de transport', cases: ['750', '755'] },
  { id: 'AIC', libelle: 'Autres immobilisations corporelles', cases: ['760', '765'] },
  { id: 'TOTAL', libelle: 'TOTAL', cases: ['770', '775'] },
];

/** Tableau 2033-E (D-115) : champ `formulaire2033E` de la réponse de la liasse. */
export interface CaseSaisie2033E {
  cle: string;
  codeCase: string;
  etatCodeCase: string;
  libelle: string;
  groupe: 'effectifs' | 'I' | 'II' | 'III' | 'mono';
  type: 'montant' | 'effectif' | 'oui_non';
  precision?: string;
  statut: 'a_saisir' | 'saisi' | 'a_revoir';
  neant: boolean;
  montant: string | null;
  saisie: (TraceQualification & { code: string; montant: string }) | null;
  proposition: { montant: string; origine: string } | null;
}
export interface Formulaire2033EProjet {
  statut: 'projet';
  exercice: { debut: string; fin: string; dureeMois: number };
  cases: CaseSaisie2033E[];
  total1: CelluleCalculee2033D;
  total2: CelluleCalculee2033D;
  total3: CelluleCalculee2033D;
  valeurAjoutee137: CelluleCalculee2033D;
  valeurAjoutee117: CelluleCalculee2033D;
  controles: Array<{ code: string; statut: 'coherent' | 'ecart' | 'non_verifie'; message: string; ecart?: string }>;
  nonPrepare: string[];
  limites: string[];
  mention: string;
}
