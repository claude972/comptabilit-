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
    emetteurSiret: null, emetteurTva: null, totalHt: null, totalTva: null, totalTtc: null, devise: null, ventilationTva: [],
  };
}
