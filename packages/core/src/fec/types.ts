import type { SourceRegle } from '../controles/types.js';
import type { ChaineDecimale } from '../montant.js';

/** Ligne de FEC normalisée. */
export interface LigneFec {
  /** N° de ligne dans le fichier original (en-tête = 1). */
  numeroLigne: number;
  journalCode: string;
  journalLib: string;
  ecritureNum: string;
  /** Date ISO AAAA-MM-JJ. */
  ecritureDate: string;
  compteNum: string;
  compteLib: string;
  compAuxNum: string | null;
  compAuxLib: string | null;
  pieceRef: string;
  pieceDate: string | null;
  ecritureLib: string;
  /** Toujours ≥ 0 après normalisation (Montant/Sens et montants négatifs convertis). */
  debit: ChaineDecimale;
  credit: ChaineDecimale;
  ecritureLet: string | null;
  dateLet: string | null;
  validDate: string | null;
  montantDevise: ChaineDecimale | null;
  idevise: string | null;
}

export interface AnomalieFec {
  ligne: number | null;
  colonne: string | null;
  code: string;
  gravite: 'bloquante' | 'majeure' | 'mineure' | 'information';
  message: string;
}

/** Référentiel de conformité : source vérifiée + contrôles implémentés et non implémentés. */
export interface ReferentielFec extends SourceRegle {
  sourcesComplementaires: SourceRegle[];
  controlesImplementes: Array<{ code: string; description: string; ecartAuReferentiel: boolean }>;
  controlesNonImplementes: string[];
}

export interface RapportFec {
  /** 'ascii' | 'utf-8' | 'utf-8-bom' | 'iso-8859-15' | 'windows-1252' | 'inconnu' */
  encodage: string;
  separateur: 'tabulation' | 'pipe' | 'point_virgule' | 'inconnu';
  variante: 'debit_credit' | 'montant_sens';
  entetes: string[];
  /** Lignes de données non vides lues (hors en-tête). */
  nbLignesLues: number;
  nbLignesNormalisees: number;
  /** Détail plafonné (PLAFOND_ANOMALIES_FEC) ; le décompte complet est dans nbAnomaliesParCode. */
  anomalies: AnomalieFec[];
  nbAnomaliesParCode: Record<string, number>;
  /** On a pu lire et normaliser des lignes. */
  lisible: boolean;
  /** Aucun écart au référentiel A47 A-1 parmi les contrôles implémentés. */
  conforme: boolean;
  /** Données minimales présentes pour lancer les contrôles de révision. */
  suffisantPourTravaux: boolean;
  totalDebit: ChaineDecimale;
  totalCredit: ChaineDecimale;
  dateMin: string | null;
  dateMax: string | null;
  referentiel: ReferentielFec;
}

export interface OptionsAnalyseFec {
  siren?: string;
  exerciceDebut?: string;
  exerciceFin?: string;
  nomFichier?: string;
  surLigne?: (ligne: LigneFec) => void | Promise<void>;
}
