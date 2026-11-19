import { describe, expect, it } from 'vitest';
import { CADRE_COMPLET, ajusterCadre, dimensionsTournees, normaliserCadre, reduire, tournerCadre } from '@/lib/image/geometrie';
import { analyserLisibilite, varianceLaplacien, versGris } from '@/lib/image/lisibilite';

const proche = (a: object, b: object) => {
  for (const [k, v] of Object.entries(b)) expect((a as Record<string, number>)[k]).toBeCloseTo(v as number, 9);
};

describe('géométrie du recadrage', () => {
  it('quatre quarts de tour ramènent le cadre à l’identique', () => {
    const c = { x: 0.1, y: 0.2, l: 0.5, h: 0.3 };
    proche(tournerCadre(tournerCadre(tournerCadre(tournerCadre(c)))), c);
    proche(tournerCadre(c), { x: 0.5, y: 0.1, l: 0.3, h: 0.5 });
    expect(tournerCadre(CADRE_COMPLET)).toEqual(CADRE_COMPLET);
  });
  it('borne le cadre dans l’image avec une taille minimale', () => {
    expect(normaliserCadre({ x: -1, y: 2, l: 5, h: 0 })).toEqual({ x: 0, y: 0.9, l: 1, h: 0.1 });
    proche(ajusterCadre(CADRE_COMPLET, 'hg', 0.2, 0.3), { x: 0.2, y: 0.3, l: 0.8, h: 0.7 });
    proche(ajusterCadre(CADRE_COMPLET, 'bd', -2, -2), { x: 0, y: 0, l: 0.1, h: 0.1 });
    proche(ajusterCadre({ x: 0.2, y: 0.2, l: 0.4, h: 0.4 }, 'centre', 1, 1), { x: 0.6, y: 0.6, l: 0.4, h: 0.4 });
  });
  it('calcule les dimensions tournées et réduites', () => {
    expect(dimensionsTournees(400, 300, 1)).toEqual({ largeur: 300, hauteur: 400 });
    expect(dimensionsTournees(400, 300, 2)).toEqual({ largeur: 400, hauteur: 300 });
    expect(reduire(4000, 3000, 2000)).toEqual({ largeur: 2000, hauteur: 1500 });
    expect(reduire(800, 600, 2000)).toEqual({ largeur: 800, hauteur: 600 });
  });
});

describe('contrôle de lisibilité indicatif', () => {
  const L = 64;
  const image = (f: (x: number, y: number) => number) => Uint8Array.from({ length: L * L }, (_, i) => f(i % L, Math.floor(i / L)));
  const analyser = (gris: Uint8Array, cote = 2000) => analyserLisibilite({ largeurOrigine: cote, hauteurOrigine: cote * 1.4, gris, largeur: L, hauteur: L });
  const codes = (gris: Uint8Array, cote?: number) => analyser(gris, cote).avertissements.map((a) => a.code);

  it('ne signale rien pour une image nette, contrastée et bien exposée', () => {
    const damier = image((x, y) => ((x >> 1) + (y >> 1)) % 2 === 0 ? 210 : 60);
    expect(codes(damier)).toEqual([]);
  });
  it('signale un flou probable sur un dégradé sans contours', () => {
    const degrade = image((x) => 100 + x);
    expect(varianceLaplacien(degrade, L, L)).toBeLessThan(1);
    expect(codes(degrade)).toContain('flou');
  });
  it('signale la sous-exposition et la surexposition', () => {
    expect(codes(image(() => 12))).toContain('sous_exposition');
    expect(codes(image(() => 252))).toContain('sur_exposition');
  });
  it('signale une résolution insuffisante sans tenir compte du contenu', () => {
    const damier = image((x, y) => ((x >> 1) + (y >> 1)) % 2 === 0 ? 210 : 60);
    expect(codes(damier, 600)).toEqual(['resolution']);
  });
  it('convertit en niveaux de gris', () => {
    expect(Array.from(versGris(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1))).toEqual([255, 0]);
  });
});
