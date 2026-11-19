/**
 * Contrôle de lisibilité INDICATIF d'une photo, calculé sur l'appareil à partir d'une image réduite en niveaux de gris.
 * Il avertit sans bloquer et ne garantit pas que la pièce sera lisible ou exploitable.
 */
export type CodeAvertissement = 'resolution' | 'flou' | 'sous_exposition' | 'sur_exposition';

export interface Avertissement {
  code: CodeAvertissement;
  message: string;
}
export interface MesuresLisibilite {
  /** Petit côté de l'image d'origine, en pixels. */
  petitCote: number;
  /** Variance du laplacien sur l'image réduite : faible quand l'image manque de contours nets. */
  varianceLaplacien: number;
  luminanceMoyenne: number;
  partSombre: number;
  partClaire: number;
}
export interface Lisibilite {
  mesures: MesuresLisibilite;
  avertissements: Avertissement[];
}

export const SEUILS = {
  petitCoteMinimal: 1000,
  varianceLaplacienMinimale: 60,
  luminanceMinimale: 60,
  luminanceMaximale: 235,
  partExtremeMaximale: 0.6,
} as const;

/** Luminance perceptuelle (Rec. 601) d'une image RGBA vers un tableau de niveaux de gris. */
export function versGris(rgba: Uint8ClampedArray | Uint8Array, largeur: number, hauteur: number): Uint8Array {
  const gris = new Uint8Array(largeur * hauteur);
  for (let i = 0, j = 0; i < gris.length; i++, j += 4) {
    gris[i] = Math.round(0.299 * (rgba[j] ?? 0) + 0.587 * (rgba[j + 1] ?? 0) + 0.114 * (rgba[j + 2] ?? 0));
  }
  return gris;
}

/** Variance du laplacien discret (noyau 4-voisins) : estimation classique de la netteté. */
export function varianceLaplacien(gris: Uint8Array, largeur: number, hauteur: number): number {
  if (largeur < 3 || hauteur < 3) return 0;
  let somme = 0;
  let sommeCarres = 0;
  let n = 0;
  for (let y = 1; y < hauteur - 1; y++) {
    for (let x = 1; x < largeur - 1; x++) {
      const i = y * largeur + x;
      const v = (gris[i - largeur] ?? 0) + (gris[i + largeur] ?? 0) + (gris[i - 1] ?? 0) + (gris[i + 1] ?? 0) - 4 * (gris[i] ?? 0);
      somme += v;
      sommeCarres += v * v;
      n++;
    }
  }
  const moyenne = somme / n;
  return sommeCarres / n - moyenne * moyenne;
}

export function analyserLisibilite(entree: { largeurOrigine: number; hauteurOrigine: number; gris: Uint8Array; largeur: number; hauteur: number }): Lisibilite {
  const { gris, largeur, hauteur } = entree;
  let total = 0;
  let sombres = 0;
  let claires = 0;
  for (const v of gris) {
    total += v;
    if (v < 40) sombres++;
    else if (v > 245) claires++;
  }
  const n = Math.max(1, gris.length);
  const mesures: MesuresLisibilite = {
    petitCote: Math.min(entree.largeurOrigine, entree.hauteurOrigine),
    varianceLaplacien: varianceLaplacien(gris, largeur, hauteur),
    luminanceMoyenne: total / n,
    partSombre: sombres / n,
    partClaire: claires / n,
  };
  const avertissements: Avertissement[] = [];
  if (mesures.petitCote < SEUILS.petitCoteMinimal) {
    avertissements.push({ code: 'resolution', message: 'Résolution faible : les petits caractères risquent d’être illisibles. Rapprochez-vous ou reprenez la photo.' });
  }
  if (mesures.varianceLaplacien < SEUILS.varianceLaplacienMinimale) {
    avertissements.push({ code: 'flou', message: 'La photo semble floue. Stabilisez l’appareil et refaites la mise au point si possible.' });
  }
  if (mesures.luminanceMoyenne < SEUILS.luminanceMinimale || mesures.partSombre > SEUILS.partExtremeMaximale) {
    avertissements.push({ code: 'sous_exposition', message: 'La photo semble trop sombre. Ajoutez de la lumière.' });
  }
  if (mesures.luminanceMoyenne > SEUILS.luminanceMaximale || mesures.partClaire > SEUILS.partExtremeMaximale) {
    avertissements.push({ code: 'sur_exposition', message: 'La photo semble surexposée (reflet ou flash). Évitez les reflets.' });
  }
  return { mesures, avertissements };
}
