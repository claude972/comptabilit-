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
export interface ReponseLiasse {
  exercice: { id: string; debut: string; fin: string };
  regimeDemande: 'reel_normal' | 'reel_simplifie';
  resultat: LiasseProjet | Abstention;
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
}
export interface ReponsePropositions {
  signalCesure: 'disponible' | 'controles_obsoletes' | 'controles_non_executes';
  amortissements: { proposes: boolean; motif: string };
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
  cesure: 'Césure',
};
