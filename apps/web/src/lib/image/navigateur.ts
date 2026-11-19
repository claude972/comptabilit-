/**
 * Traitements d'image dans le navigateur (canvas) : décodage, rotation par quarts de tour, recadrage, ré-encodage JPEG,
 * mesure de lisibilité, assemblage PDF. Rien n'est envoyé : tout est calculé sur l'appareil.
 */
import { type Cadre, type QuartsDeTour, dimensionsTournees, normaliserCadre, reduire } from './geometrie';
import { type Lisibilite, analyserLisibilite, versGris } from './lisibilite';

/** Grand côté maximal d'une page ré-encodée : suffisant pour la lecture, raisonnable pour l'envoi sur réseau mobile. */
export const COTE_MAXIMAL = 2600;
const QUALITE_JPEG = 0.85;
const COTE_ANALYSE = 480;

export class ErreurImage extends Error {}

export interface ImageDecodee {
  source: CanvasImageSource;
  largeur: number;
  hauteur: number;
  liberer(): void;
}

/** Décode un fichier image en respectant l'orientation EXIF. Lève `ErreurImage` si le navigateur ne sait pas le lire. */
export async function decoder(fichier: Blob): Promise<ImageDecodee> {
  if (typeof createImageBitmap === 'function') {
    try {
      const b = await createImageBitmap(fichier, { imageOrientation: 'from-image' });
      return { source: b, largeur: b.width, hauteur: b.height, liberer: () => b.close() };
    } catch {
      // repli sur <img> ci-dessous
    }
  }
  const url = URL.createObjectURL(fichier);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, largeur: img.naturalWidth, hauteur: img.naturalHeight, liberer: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new ErreurImage('Ce navigateur ne sait pas lire ce format d’image. Essayez une photo JPEG ou PNG.');
  }
}

function contexte(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new ErreurImage('Le traitement d’image (canvas) n’est pas disponible dans ce navigateur.');
  return ctx;
}

/** Dessine l'image tournée (et éventuellement recadrée) dans un canvas dont le grand côté est borné. */
export function dessiner(image: ImageDecodee, rotation: QuartsDeTour, cadre: Cadre | null, coteMaximal: number): HTMLCanvasElement {
  const tournee = dimensionsTournees(image.largeur, image.hauteur, rotation);
  const c = normaliserCadre(cadre ?? { x: 0, y: 0, l: 1, h: 1 });
  const zone = { x: c.x * tournee.largeur, y: c.y * tournee.hauteur, l: c.l * tournee.largeur, h: c.h * tournee.hauteur };
  const sortie = reduire(zone.l, zone.h, coteMaximal);
  const canvas = document.createElement('canvas');
  canvas.width = sortie.largeur;
  canvas.height = sortie.hauteur;
  const ctx = contexte(canvas);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const echelle = sortie.largeur / zone.l;
  ctx.scale(echelle, echelle);
  ctx.translate(-zone.x, -zone.y);
  // Repère de l'image tournée → repère de l'image d'origine.
  if (rotation === 1) ctx.transform(0, 1, -1, 0, tournee.largeur, 0);
  else if (rotation === 2) ctx.transform(-1, 0, 0, -1, tournee.largeur, tournee.hauteur);
  else if (rotation === 3) ctx.transform(0, -1, 1, 0, 0, tournee.hauteur);
  ctx.drawImage(image.source, 0, 0);
  return canvas;
}

export function versBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', qualite = QUALITE_JPEG): Promise<Blob> {
  return new Promise((resoudre, rejeter) =>
    canvas.toBlob((b) => (b ? resoudre(b) : rejeter(new ErreurImage('Encodage de l’image impossible dans ce navigateur.'))), type, qualite),
  );
}

/** Mesure indicative de lisibilité de l'image d'origine (sur une copie réduite). */
export function mesurerLisibilite(image: ImageDecodee): Lisibilite {
  const canvas = dessiner(image, 0, null, COTE_ANALYSE);
  const donnees = contexte(canvas).getImageData(0, 0, canvas.width, canvas.height);
  return analyserLisibilite({
    largeurOrigine: image.largeur,
    hauteurOrigine: image.hauteur,
    gris: versGris(donnees.data, canvas.width, canvas.height),
    largeur: canvas.width,
    hauteur: canvas.height,
  });
}

/** Page finale : rotation et recadrage appliqués, ré-encodée en JPEG. */
export async function produirePage(fichier: Blob, rotation: QuartsDeTour, cadre: Cadre): Promise<{ jpeg: Blob; largeur: number; hauteur: number }> {
  const image = await decoder(fichier);
  try {
    const canvas = dessiner(image, rotation, cadre, COTE_MAXIMAL);
    return { jpeg: await versBlob(canvas), largeur: canvas.width, hauteur: canvas.height };
  } finally {
    image.liberer();
  }
}

/** Assemble les pages JPEG en un seul PDF, sur l'appareil (bibliothèque pdf-lib chargée à la demande). */
export async function assemblerPdf(pages: Array<{ jpeg: Blob; largeur: number; hauteur: number }>, titre: string): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle(titre);
  pdf.setProducer('Comtaple — assemblage local de photos');
  pdf.setCreator('Comtaple');
  for (const p of pages) {
    const image = await pdf.embedJpg(await p.jpeg.arrayBuffer());
    // Page au format de l'image, grand côté ramené à celui d'un A4 (842 points).
    const facteur = 842 / Math.max(p.largeur, p.hauteur);
    const page = pdf.addPage([p.largeur * facteur, p.hauteur * facteur]);
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }
  const octets = await pdf.save();
  return new Blob([octets as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}
