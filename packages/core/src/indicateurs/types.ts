import type { LigneEcriture, SourceRegle } from '../controles/types.js';
import type { ChaineDecimale } from '../montant.js';

export interface DefinitionIndicateur {
  id: string;
  version: string;
  /** Pour la famille `signal` : une question à examiner, jamais un diagnostic. */
  libelle: string;
  famille: 'activite' | 'rentabilite' | 'bfr' | 'tresorerie' | 'structure' | 'signal';
  /** Formule explicite en comptes du PCG. */
  formule: string;
  /** Convention retenue et ses limites. */
  convention: string;
  /** Échelles de restitution : euros 2 décimales, jours 1 décimale, pourcentage 2 décimales, ratio 2 décimales (arrondi comptable). */
  unite: 'euros' | 'jours' | 'pourcentage' | 'ratio';
  entrees: string[];
  regleDonneeManquante: string;
  source: SourceRegle;
}

export interface ComposanteIndicateur {
  /** Préfixé par « (+) » ou « (−) » selon le sens de la contribution à la valeur. */
  libelle: string;
  montant: ChaineDecimale;
  /** Comptes retenus et solde retenu (dans le sens indiqué par le libellé de la composante). */
  comptes: Array<{ compteNum: string; montant: ChaineDecimale }>;
}

export interface ValeurIndicateur {
  id: string;
  version: string;
  statut: 'calcule' | 'non_calculable';
  /** Motif précis quand l'indicateur n'est pas calculable ; null sinon. */
  motif: string | null;
  /** Jamais de zéro par défaut : null quand l'indicateur n'est pas calculable. */
  valeur: ChaineDecimale | null;
  unite: DefinitionIndicateur['unite'];
  periode: { debut: string; fin: string };
  composantes: ComposanteIndicateur[];
  /** Absent ou null : exercice précédent non fourni. */
  precedent?: { valeur: ChaineDecimale | null; variation: ChaineDecimale | null; variationPourcent: ChaineDecimale | null } | null;
  /** Réserves de lecture (exercice ≠ 12 mois, écritures incomplètes, durées différentes, limites de convention…). */
  mentions: string[];
  /** Famille `signal` : vrai si la question mérite examen au vu des écritures, faux sinon ; null hors signal ou si non calculable. Jamais une conclusion. */
  aExaminer: boolean | null;
}

export interface ContexteIndicateurs {
  lignes: readonly LigneEcriture[];
  exercice: { debut: string; fin: string };
  exercicePrecedent?: { lignes: readonly LigneEcriture[]; exercice: { debut: string; fin: string } } | null;
  /** Taux moyens de TVA en POURCENTAGE (« 20 » = 20 %), nécessaires aux délais clients et fournisseurs. */
  tauxTvaMoyen?: { ventes?: ChaineDecimale; achats?: ChaineDecimale } | null;
}

export interface OptionsIndicateurs {
  ids?: string[];
  /** Seuil interne du signal « dettes fiscales et sociales en forte hausse », en pourcentage (défaut : 30). */
  seuilHausseDettesFiscalesSocialesPourcent?: ChaineDecimale;
}
