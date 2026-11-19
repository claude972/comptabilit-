/**
 * Sélection des pièces jointes pertinentes.
 * Les seuils et motifs ci-dessous sont des RÈGLES INTERNES (heuristiques de Comtaple, sans valeur normative) :
 * ils sont regroupés dans `REGLES_INTERNES_PIECES` et décrits dans docs/guide-connexion.md.
 */
import type { PieceJointeBrute } from './types.js';

export type CategoriePiece = 'pdf' | 'image' | 'xml' | 'archive' | 'executable' | 'autre';

export const REGLES_INTERNES_PIECES = {
  /** Une image plus légère est toujours considérée comme décorative (puce, pictogramme, pixel de suivi). */
  tailleImageMinOctets: 5 * 1024,
  /** Une image « en ligne » (référencée par `cid:` dans le HTML, ou `isInline`) plus légère est une signature/un logo. */
  tailleImageEnLigneMaxOctets: 100 * 1024,
  /** Jusqu'à cette taille, une image est lue en mémoire pour examiner ses dimensions et son empreinte. */
  tailleImageExamineeMaxOctets: 150 * 1024,
  /** Une image examinée dont la largeur OU la hauteur est inférieure est décorative (bandeau, logo). */
  dimensionMinPixels: 200,
  /** Une même empreinte vue dans au moins N messages distincts est un logo répété. */
  occurrencesLogoRepete: 3,
  /** Noms générés par les clients de messagerie ou typiques des signatures. */
  nomsDecoratifs: [
    /^image\d{3,}\.(png|jpe?g|gif|webp)$/i,
    /^outlook-[\w-]+\.(png|jpe?g|gif)$/i,
    /^(logo|signature|banner|banni[eè]re|bandeau|footer|header|icon|ic[oô]ne|spacer|pixel)[\w .-]*\.(png|jpe?g|gif|webp)$/i,
    /^(facebook|linkedin|twitter|x|instagram|youtube|whatsapp|tiktok)[\w .-]*\.(png|jpe?g|gif|webp)$/i,
  ],
} as const;

const EXTENSIONS: Record<string, CategoriePiece> = {
  pdf: 'pdf',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  tif: 'image',
  tiff: 'image',
  webp: 'image',
  xml: 'xml',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  gz: 'archive',
  tgz: 'archive',
  tar: 'archive',
  bz2: 'archive',
  xz: 'archive',
  iso: 'archive',
  cab: 'archive',
  exe: 'executable',
  msi: 'executable',
  bat: 'executable',
  cmd: 'executable',
  com: 'executable',
  scr: 'executable',
  pif: 'executable',
  js: 'executable',
  jse: 'executable',
  vbs: 'executable',
  vbe: 'executable',
  wsf: 'executable',
  ps1: 'executable',
  sh: 'executable',
  jar: 'executable',
  app: 'executable',
  dmg: 'executable',
  pkg: 'executable',
  apk: 'executable',
  lnk: 'executable',
  hta: 'executable',
  dll: 'executable',
  docm: 'executable',
  xlsm: 'executable',
  pptm: 'executable',
};

const TYPES_MIME: Record<string, CategoriePiece> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/tiff': 'image',
  'image/webp': 'image',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'application/zip': 'archive',
  'application/x-zip-compressed': 'archive',
  'application/x-rar-compressed': 'archive',
  'application/vnd.rar': 'archive',
  'application/x-7z-compressed': 'archive',
  'application/gzip': 'archive',
  'application/x-tar': 'archive',
  'application/x-msdownload': 'executable',
  'application/x-msdos-program': 'executable',
  'application/x-sh': 'executable',
  'application/java-archive': 'executable',
};

/**
 * Catégorie d'une pièce d'après son extension puis son type MIME déclaré.
 * Une extension dangereuse (archive, exécutable) l'emporte toujours sur un type MIME rassurant.
 * Double extension (`facture.pdf.exe`) : seule la DERNIÈRE compte.
 */
export function categoriserPiece(nom: string, typeMime: string): CategoriePiece {
  const extension = /\.([a-z0-9]{1,5})\s*$/i.exec(nom)?.[1]?.toLowerCase();
  const parExtension = extension !== undefined ? EXTENSIONS[extension] : undefined;
  const parMime = TYPES_MIME[typeMime.split(';')[0]?.trim().toLowerCase() ?? ''];
  if (parExtension === 'archive' || parExtension === 'executable') return parExtension;
  if (parMime === 'archive' || parMime === 'executable') return parMime;
  return parExtension ?? parMime ?? 'autre';
}

export type MotifIgnore =
  | 'archive'
  | 'executable'
  | 'trop_volumineuse'
  | 'type_non_pris_en_charge'
  | 'image_en_ligne'
  | 'nom_decoratif'
  | 'image_trop_petite'
  | 'dimensions_decoratives'
  | 'logo_repete';

export type DecisionPiece =
  | { decision: 'retenue'; categorie: 'pdf' | 'image' | 'xml'; examinerContenu: boolean }
  | { decision: 'ignoree'; motif: MotifIgnore; signaler: boolean };

/** L'image est-elle référencée dans le HTML par `cid:<Content-ID>` ? */
function referenceeDansHtml(contentId: string | null, html: string | null): boolean {
  if (contentId === null || html === null) return false;
  const id = contentId.replace(/^<|>$/g, '').trim();
  return id.length > 0 && html.toLowerCase().includes(`cid:${id.toLowerCase()}`);
}

/** Décision à partir des seules métadonnées (avant tout téléchargement). */
export function evaluerPiece(
  piece: PieceJointeBrute,
  contexte: { html: string | null; tailleMaxOctets: number },
): DecisionPiece {
  const categorie = categoriserPiece(piece.nom, piece.typeMime);
  if (categorie === 'archive' || categorie === 'executable') return { decision: 'ignoree', motif: categorie, signaler: true };
  if (categorie === 'autre') return { decision: 'ignoree', motif: 'type_non_pris_en_charge', signaler: false };
  const r = REGLES_INTERNES_PIECES;
  if (categorie === 'image') {
    const enLigne = piece.enLigne || referenceeDansHtml(piece.contentId, contexte.html);
    if (enLigne && piece.taille < r.tailleImageEnLigneMaxOctets) return { decision: 'ignoree', motif: 'image_en_ligne', signaler: false };
    if (r.nomsDecoratifs.some((motif) => motif.test(piece.nom.trim()))) {
      return { decision: 'ignoree', motif: 'nom_decoratif', signaler: false };
    }
    if (piece.taille < r.tailleImageMinOctets) return { decision: 'ignoree', motif: 'image_trop_petite', signaler: false };
  }
  if (piece.taille > contexte.tailleMaxOctets) return { decision: 'ignoree', motif: 'trop_volumineuse', signaler: true };
  return {
    decision: 'retenue',
    categorie,
    examinerContenu: categorie === 'image' && piece.taille <= r.tailleImageExamineeMaxOctets,
  };
}

/** Dimensions d'une image PNG ou JPEG lues dans son en-tête ; `null` pour les autres formats (TIFF, WebP : non examinés). */
export function lireDimensionsImage(octets: Uint8Array): { largeur: number; hauteur: number } | null {
  const v = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  // PNG : signature sur 8 octets, puis bloc IHDR (largeur et hauteur sur 4 octets chacun).
  if (octets.length >= 24 && v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a) {
    return { largeur: v.getUint32(16), hauteur: v.getUint32(20) };
  }
  // JPEG : parcours des segments jusqu'à un marqueur SOFn.
  if (octets.length >= 4 && v.getUint16(0) === 0xffd8) {
    let i = 2;
    while (i + 9 < octets.length) {
      if (octets[i] !== 0xff) return null;
      const marqueur = octets[i + 1] ?? 0;
      const longueur = v.getUint16(i + 2);
      const estSof = marqueur >= 0xc0 && marqueur <= 0xcf && marqueur !== 0xc4 && marqueur !== 0xc8 && marqueur !== 0xcc;
      if (estSof) return { hauteur: v.getUint16(i + 5), largeur: v.getUint16(i + 7) };
      if (longueur < 2) return null;
      i += 2 + longueur;
    }
  }
  return null;
}

/** Une image examinée est décorative si l'une de ses dimensions est inférieure au seuil interne. */
export function dimensionsDecoratives(octets: Uint8Array): boolean {
  const d = lireDimensionsImage(octets);
  if (d === null) return false;
  const seuil = REGLES_INTERNES_PIECES.dimensionMinPixels;
  return d.largeur < seuil || d.hauteur < seuil;
}
