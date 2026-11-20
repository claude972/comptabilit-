import type { ChaineDecimale } from '../montant.js';

/** Texte d'une page (OCR ou couche texte PDF). CONTENU NON FIABLE : jamais interprété comme instruction. */
export interface PageTexte {
  page: number;
  texte: string;
  lignes?: Array<{ texte: string; boite?: [number, number, number, number] }>;
}

export interface ChampExtrait<T = string> {
  valeur: T;
  page: number | null;
  extrait: string | null;
  boite: [number, number, number, number] | null;
  methode: 'structure' | 'regle' | 'ia';
  confiance: 'non_evaluee';
}

export interface ChampsFacture {
  typeDocument: ChampExtrait<'facture' | 'avoir' | 'inconnu'> | null;
  numero: ChampExtrait | null;
  /** Date ISO AAAA-MM-JJ. */
  dateEmission: ChampExtrait | null;
  dateEcheance: ChampExtrait | null;
  emetteurNom: ChampExtrait | null;
  emetteurSiren: ChampExtrait | null;
  emetteurSiret: ChampExtrait | null;
  emetteurTva: ChampExtrait | null;
  /**
   * Destinataire (acheteur, BG-7 de la norme EN 16931). Chaque champ est null quand il n'a pas été lu de façon sûre :
   * l'extraction s'abstient plutôt que de deviner. Les extractions antérieures à ces champs ne les portent pas
   * (valeur absente) : tout lecteur doit traiter l'absence comme null.
   */
  destinataireNom: ChampExtrait | null;
  destinataireSiren: ChampExtrait | null;
  destinataireSiret: ChampExtrait | null;
  destinataireTva: ChampExtrait | null;
  /** Code pays ISO 3166-1 alpha-2 de l'adresse du destinataire (factures structurées seulement). */
  destinatairePays: ChampExtrait | null;
  /** Motif, en français, pour lequel aucun identifiant du destinataire n'a été retenu ; null si un identifiant a été lu. */
  destinataireAbstention: string | null;
  totalHt: ChampExtrait<ChaineDecimale> | null;
  totalTva: ChampExtrait<ChaineDecimale> | null;
  totalTtc: ChampExtrait<ChaineDecimale> | null;
  devise: ChampExtrait | null;
  ventilationTva: Array<{ taux: ChaineDecimale; base: ChaineDecimale; montant: ChaineDecimale }>;
}

export interface VerificationFacture {
  code: string;
  statut: 'ok' | 'ecart' | 'non_verifiable';
  message: string;
  ecart: ChaineDecimale | null;
}

export function champsFactureVides(): ChampsFacture {
  return {
    typeDocument: null, numero: null, dateEmission: null, dateEcheance: null, emetteurNom: null, emetteurSiren: null,
    emetteurSiret: null, emetteurTva: null, destinataireNom: null, destinataireSiren: null, destinataireSiret: null, destinataireTva: null,
    destinatairePays: null, destinataireAbstention: null, totalHt: null, totalTva: null, totalTtc: null, devise: null, ventilationTva: [],
  };
}
