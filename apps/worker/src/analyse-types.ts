/**
 * Types et bornes partagés entre le processus du worker (parent) et le processus enfant d'analyse.
 * Ce module ne charge AUCUN lecteur de fichier : le parent peut l'importer sans faire entrer pdf.js ni le lecteur XML
 * dans son propre processus.
 */
import type { ChampsFacture, PageTexte } from '@comtaple/core';

/** Types de pièce dont le décodage a lieu dans l'enfant. Les images ne sont décodées que par le service OCR. */
export type TypePieceDecodee = 'application/pdf' | 'application/xml';

export type MethodeLecture = 'structure' | 'couche_texte' | 'aucune';

/** Résultat structuré du décodage d'une pièce, tel que l'enfant le renvoie (puis validé par schéma côté parent). */
export interface ResultatPiece {
  pages: PageTexte[];
  nbPages: number | null;
  champs: ChampsFacture | null;
  methode: MethodeLecture;
  moteur: string | null;
  /** Le lecteur a refusé le fichier (endommagé, hostile, format inattendu) ; l'état partiel déjà lu est conservé. */
  lectureImpossible: boolean;
}

export interface ResultatTexte {
  champs: ChampsFacture | null;
}

/** En-tête de la demande transmise à l'enfant (les octets du fichier suivent, sans être interprétés par le parent). */
export type DemandeAnalyse = { op: 'piece'; type: TypePieceDecodee } | { op: 'texte' };

/** Nombre minimal de caractères utiles pour considérer qu'une couche texte PDF existe réellement. */
export const SEUIL_COUCHE_TEXTE = 40;
/** Nombre maximal de pages lues dans un PDF (les suivantes sont ignorées ; le nombre total de pages reste connu). */
export const PAGES_MAX = 60;
/** Nombre maximal de pages acceptées en sortie de l'OCR pour l'extraction des champs. */
export const PAGES_MAX_TEXTE = 500;
/** Nombre maximal de lignes par page acceptées dans un résultat. */
export const LIGNES_MAX_PAR_PAGE = 20_000;

export const caracteresUtiles = (pages: PageTexte[]): number => pages.reduce((n, p) => n + p.texte.replace(/\s/g, '').length, 0);
