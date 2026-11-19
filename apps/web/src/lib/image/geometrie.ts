/** Géométrie du recadrage et de la rotation (fonctions pures). Le cadre est exprimé en fractions de l'image affichée. */
export interface Cadre {
  x: number;
  y: number;
  l: number;
  h: number;
}
export type QuartsDeTour = 0 | 1 | 2 | 3;

export const CADRE_COMPLET: Cadre = { x: 0, y: 0, l: 1, h: 1 };
const MINIMUM = 0.1;

const borner = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Ramène un cadre dans l'image, avec une taille minimale. */
export function normaliserCadre(c: Cadre): Cadre {
  const l = borner(c.l, MINIMUM, 1);
  const h = borner(c.h, MINIMUM, 1);
  return { x: borner(c.x, 0, 1 - l), y: borner(c.y, 0, 1 - h), l, h };
}

/** Cadre après un quart de tour horaire de l'image : il suit le contenu. */
export function tournerCadre(c: Cadre): Cadre {
  return normaliserCadre({ x: 1 - c.y - c.h, y: c.x, l: c.h, h: c.l });
}

export function tournerQuart(q: QuartsDeTour): QuartsDeTour {
  return ((q + 1) % 4) as QuartsDeTour;
}

/** Dimensions de l'image après rotation. */
export function dimensionsTournees(largeur: number, hauteur: number, q: QuartsDeTour): { largeur: number; hauteur: number } {
  return q % 2 === 0 ? { largeur, hauteur } : { largeur: hauteur, hauteur: largeur };
}

/** Déplace un bord ou un coin du cadre (dx, dy en fractions) en conservant le bord opposé. */
export function ajusterCadre(c: Cadre, poignee: 'hg' | 'hd' | 'bg' | 'bd' | 'centre', dx: number, dy: number): Cadre {
  if (poignee === 'centre') return normaliserCadre({ ...c, x: c.x + dx, y: c.y + dy });
  let gauche = c.x;
  let haut = c.y;
  let droite = c.x + c.l;
  let bas = c.y + c.h;
  if (poignee === 'hg' || poignee === 'bg') gauche = borner(gauche + dx, 0, droite - MINIMUM);
  else droite = borner(droite + dx, gauche + MINIMUM, 1);
  if (poignee === 'hg' || poignee === 'hd') haut = borner(haut + dy, 0, bas - MINIMUM);
  else bas = borner(bas + dy, haut + MINIMUM, 1);
  return { x: gauche, y: haut, l: droite - gauche, h: bas - haut };
}

/** Réduit des dimensions pour que le grand côté ne dépasse pas `maximum`, sans jamais agrandir. */
export function reduire(largeur: number, hauteur: number, maximum: number): { largeur: number; hauteur: number } {
  const facteur = Math.min(1, maximum / Math.max(largeur, hauteur));
  return { largeur: Math.max(1, Math.round(largeur * facteur)), hauteur: Math.max(1, Math.round(hauteur * facteur)) };
}
