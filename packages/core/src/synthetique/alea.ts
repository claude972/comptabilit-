/** Générateur pseudo-aléatoire déterministe (mulberry32). Sert uniquement à choisir des entiers. */
export interface Alea {
  /** Entier uniforme dans [min, max]. */
  entier(min: number, max: number): number;
  /** Indice tiré selon des poids entiers. */
  pondere(poids: readonly number[]): number;
}

export function creerAlea(graine: number): Alea {
  if (!Number.isInteger(graine)) throw new Error('Graine invalide : entier attendu.');
  let etat = graine >>> 0;
  const suivant = (): number => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return {
    entier(min, max) {
      if (max < min) throw new Error('Intervalle invalide.');
      return min + (suivant() % (max - min + 1));
    },
    pondere(poids) {
      const total = poids.reduce((s, p) => s + p, 0);
      let tirage = suivant() % total;
      for (const [i, p] of poids.entries()) {
        if (tirage < p) return i;
        tirage -= p;
      }
      return poids.length - 1;
    },
  };
}

/** Complète une suite de chiffres par sa clé de Luhn. */
export function avecCleLuhn(chiffres: string): string {
  for (let cle = 0; cle <= 9; cle++) {
    const candidat = `${chiffres}${cle}`;
    let total = 0;
    let doubler = false;
    for (let i = candidat.length - 1; i >= 0; i--) {
      let n = candidat.charCodeAt(i) - 48;
      if (doubler) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      total += n;
      doubler = !doubler;
    }
    if (total % 10 === 0) return candidat;
  }
  throw new Error('Clé de Luhn introuvable.');
}
