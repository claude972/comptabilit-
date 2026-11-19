import type { SourceRegle } from '../controles/types.js';
import type { ChaineDecimale } from '../montant.js';

export interface LigneBalance {
  compteNum: string;
  /** Premier libellé rencontré pour le compte. Contenu NON FIABLE : restitué tel quel, jamais interprété. */
  compteLib: string;
  totalDebit: ChaineDecimale;
  totalCredit: ChaineDecimale;
  /** Solde si débiteur, sinon "0.00". */
  soldeDebiteur: ChaineDecimale;
  /** Solde si créditeur, sinon "0.00". */
  soldeCrediteur: ChaineDecimale;
  nbLignes: number;
}

export interface LigneBalanceAuxiliaire extends LigneBalance {
  compAuxNum: string;
  /** Contenu NON FIABLE, jamais interprété. */
  compAuxLib: string;
}

export interface Balance {
  lignes: LigneBalance[];
  totalDebit: ChaineDecimale;
  totalCredit: ChaineDecimale;
  /** Vrai si total des débits = total des crédits (égalité stricte). Une balance vide est arithmétiquement équilibrée : les états projetés la signalent comme non vérifiable. */
  equilibree: boolean;
  /** Total des débits − total des crédits. */
  ecart: ChaineDecimale;
  /** Détail par compte général et compte auxiliaire (lignes portant un CompAuxNum), si demandé. */
  parAuxiliaire?: LigneBalanceAuxiliaire[];
}

export interface OptionsBalance {
  /** Date ISO : seules les écritures datées au plus tard de ce jour sont retenues. */
  jusquau?: string;
  auxiliaire?: boolean;
  /** Codes de journaux à écarter (comparaison exacte). */
  exclureJournaux?: readonly string[];
}

export type EtatRubrique = 'bilan_actif' | 'bilan_passif' | 'resultat_charges' | 'resultat_produits';

export interface RegleAffectation {
  /** Préfixes de numéros de comptes inclus. */
  prefixes: string[];
  /** Préfixes exclus (prioritaires). */
  saufPrefixes?: string[];
  /**
   * `debiteur` : le compte n'est affecté que si son solde est débiteur ; `crediteur` : que s'il est créditeur ;
   * `solde` : quel que soit le sens (le montant est alors signé dans le sens naturel de la rubrique).
   * Un compte soldé (solde nul) est rattaché à la première règle dont les préfixes correspondent, sans condition de sens.
   */
  sens: 'debiteur' | 'crediteur' | 'solde';
  /** Bilan actif uniquement : `brut` (défaut) ou `amortissements_depreciations` (porté en déduction du brut). */
  colonne?: 'brut' | 'amortissements_depreciations';
}

export interface RubriqueDefinition {
  code: string;
  libelle: string;
  etat: EtatRubrique;
  ordre: number;
  /** Code de la rubrique de regroupement, ou null. Une rubrique de regroupement n'a pas de règle : son montant est la somme de ses filles. */
  parent: string | null;
  regles: RegleAffectation[];
}

/** Table de correspondance comptes → rubriques, versionnée et documentée. */
export interface CorrespondanceRubriques {
  id: string;
  version: string;
  periodeApplication: string;
  source: SourceRegle;
  /** La table n'a pas été validée par un professionnel : tout état qui en découle est un projet. */
  etat: 'en_attente_de_validation_professionnelle';
  rubriques: RubriqueDefinition[];
}

export interface RubriqueProjetee {
  code: string;
  libelle: string;
  /** Bilan actif uniquement. */
  brut?: ChaineDecimale;
  /** Bilan actif uniquement (montant à déduire, positif). */
  amortissementsDepreciations?: ChaineDecimale;
  /** Actif : net (brut − amortissements et dépréciations). Passif et produits : crédit − débit. Charges : débit − crédit. */
  montant: ChaineDecimale;
  /** Comptes composant la rubrique, avec le montant retenu (même convention de signe ; pour la colonne amortissements et dépréciations, montant négatif). */
  comptes: Array<{ compteNum: string; compteLib: string; montant: ChaineDecimale }>;
}

export interface ControleEtat {
  code: string;
  statut: 'ok' | 'ecart' | 'non_verifiable';
  message: string;
  ecart: ChaineDecimale | null;
}

export interface EtatProjet {
  /** Toujours « projet » : ni comptes annuels, ni validation, ni certification. */
  statut: 'projet';
  complet: boolean;
  motifsIncompletude: string[];
  correspondance: { id: string; version: string };
  rubriques: RubriqueProjetee[];
  totaux: Record<string, ChaineDecimale>;
  /** Solde = débit − crédit (positif : débiteur). */
  comptesNonAffectes: Array<{ compteNum: string; compteLib: string; solde: ChaineDecimale }>;
  controles: ControleEtat[];
}
