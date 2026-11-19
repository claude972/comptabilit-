import type { SourceRegle } from '../controles/types.js';
import type { ChaineDecimale } from '../montant.js';

/** Mouvement d'un relevé bancaire, ramené à une forme commune quel que soit le format d'origine. */
export interface MouvementBancaire {
  /** Ordre dans le fichier (à partir de 1). */
  rang: number;
  compte: { iban: string | null; bic: string | null; identifiant: string | null; devise: string | null };
  /** ISO AAAA-MM-JJ (date de comptabilisation par la banque). */
  dateOperation: string;
  dateValeur: string | null;
  /** Signé : positif = encaissement (crédit du compte bancaire du client), négatif = décaissement. */
  montant: ChaineDecimale;
  /** Nettoyé (caractères de contrôle retirés, espaces réduits) et borné en longueur. Contenu NON FIABLE, jamais interprété. */
  libelle: string;
  /** Identifiant d'opération fourni par la banque (AcctSvcrRef, FITID, colonne « référence » d'un CSV). */
  referenceBanque: string | null;
  /** EndToEndId, référence structurée du créancier, numéro de remise ou de chèque. */
  referenceBoutEnBout: string | null;
  contrepartie: { nom: string | null; iban: string | null } | null;
  codeOperation: string | null;
  /**
   * Clé stable : le même mouvement réimporté depuis le même fichier donne la même clé.
   * Empreinte SHA-256 de (compte + date + montant + référence banque), ou à défaut de référence, de
   * (compte + date + montant + libellé + date de valeur + référence de bout en bout + contrepartie + code),
   * complétée du rang parmi les mouvements de même empreinte (homonymes).
   */
  cleIdempotence: string;
}

export type GraviteAnomalieReleve = 'bloquante' | 'majeure' | 'mineure' | 'information';

export interface AnomalieReleve {
  rang: number | null;
  code: string;
  gravite: GraviteAnomalieReleve;
  message: string;
}

/** Un relevé d'un compte (dans un camt.053 : un élément Stmt ; un même compte peut donc apparaître plusieurs fois). */
export interface CompteReleve {
  iban: string | null;
  identifiant: string | null;
  devise: string | null;
  soldeOuverture: ChaineDecimale | null;
  dateOuverture: string | null;
  soldeCloture: ChaineDecimale | null;
  dateCloture: string | null;
  totalMouvements: ChaineDecimale;
  nbMouvements: number;
  /** ouverture + mouvements = clôture ? `non_verifiable` si un des deux soldes manque : jamais `ok` par défaut. */
  cadrage: 'ok' | 'ecart' | 'non_verifiable';
  /** ouverture + mouvements − clôture ; null si non vérifiable. */
  ecart: ChaineDecimale | null;
}

export interface RapportReleve {
  format: 'camt.053' | 'ofx' | 'csv';
  version: string | null;
  comptes: CompteReleve[];
  mouvements: MouvementBancaire[];
  anomalies: AnomalieReleve[];
  /** Vrai si la structure a pu être lue sans anomalie bloquante. Ne dit rien du cadrage. */
  lisible: boolean;
  source: SourceRegle;
}

/**
 * Compléments facultatifs fournis par l'appelant quand le format ne porte pas l'information
 * (OFX : pas de solde d'ouverture ; CSV : aucun solde normalisé).
 */
export interface OptionsLectureReleve {
  soldeOuverture?: ChaineDecimale;
  dateOuverture?: string;
  soldeCloture?: ChaineDecimale;
  dateCloture?: string;
}
