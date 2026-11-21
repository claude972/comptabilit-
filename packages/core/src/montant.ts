/**
 * Montants : aucun flottant. `Decimal` (decimal.js) en interne, chaînes décimales
 * validées aux frontières ("1234.56", point décimal, signe « - » optionnel,
 * ni exposant, ni séparateur de milliers).
 *
 * Bornes : 13 chiffres entiers et 6 décimales au plus (19 chiffres significatifs),
 * ce qui reste dans la précision par défaut de decimal.js (20 chiffres) : les
 * additions et soustractions du périmètre TPE/PME sont exactes.
 */
import { Decimal } from 'decimal.js';
import { z } from 'zod';

export type ChaineDecimale = string;

const MOTIF_CHAINE_DECIMALE = /^-?\d{1,13}(\.\d{1,6})?$/;

export const schemaChaineDecimale: z.ZodType<string> = z
  .string()
  .regex(
    MOTIF_CHAINE_DECIMALE,
    'Montant invalide : attendu une chaîne décimale du type "1234.56" (point décimal, signe - optionnel, sans exposant ni séparateur de milliers).',
  );

export function estChaineDecimale(v: unknown): v is ChaineDecimale {
  return typeof v === 'string' && MOTIF_CHAINE_DECIMALE.test(v);
}

/** Convertit une chaîne décimale validée (ou un Decimal) en Decimal. Lève si invalide. */
export function dec(v: ChaineDecimale | Decimal): Decimal {
  if (Decimal.isDecimal(v)) {
    const d = v as Decimal;
    if (!d.isFinite()) throw new Error('Montant invalide : valeur non finie.');
    return d;
  }
  if (typeof v !== 'string' || !MOTIF_CHAINE_DECIMALE.test(v)) {
    throw new Error(`Montant invalide : ${JSON.stringify(v)} n'est pas une chaîne décimale du type "1234.56".`);
  }
  return new Decimal(v);
}

/**
 * Chaîne décimale à `echelle` décimales (défaut 2). Arrondi « half-up » au sens
 * comptable : la demi-unité s'éloigne de zéro (0.005 → 0.01 ; -0.005 → -0.01).
 */
export function versChaine(d: Decimal, echelle = 2): ChaineDecimale {
  if (!Decimal.isDecimal(d) || !d.isFinite()) throw new Error('Montant invalide : valeur non finie.');
  if (!Number.isInteger(echelle) || echelle < 0 || echelle > 6) {
    throw new Error('Échelle invalide : entier de 0 à 6 attendu.');
  }
  const s = d.toFixed(echelle, Decimal.ROUND_HALF_UP);
  // Pas de zéro négatif ("-0.00").
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

/**
 * Arrondit une chaîne décimale à l'euro le plus proche, comme l'exigent les tableaux fiscaux (notices 2032-NOT-SD et
 * 2033-NOT-SD, millésime 2026 : « arrondies à l'euro le plus proche ; la fraction d'euro égale 0,50 est comptée pour 1 »).
 * Valeur pour l'AFFICHAGE de présentation : jamais un remplacement du montant exact. La notice ne dit rien des montants
 * négatifs : la demi-unité s'éloigne de zéro, comme partout dans Comtaple, et c'est une convention, pas une règle lue.
 */
export function arrondirALEuro(v: ChaineDecimale): ChaineDecimale {
  return versChaine(dec(v), 0);
}

const ESPACES = /[     ]/g;

function groupesDeTroisValides(partieEntiere: string, sep: string): boolean {
  const groupes = partieEntiere.split(sep);
  if (groupes.length < 2) return false;
  const premier = groupes[0] ?? '';
  if (!/^\d{1,3}$/.test(premier)) return false;
  return groupes.slice(1).every((g) => /^\d{3}$/.test(g));
}

/**
 * Lit un montant saisi « à la française » : "1 234,56", "1.234,56", "1234.56",
 * "-12,5", espaces insécables, "(12,00)" (négatif comptable), signe à droite
 * ("12,00-"), symbole € ou code EUR accolé.
 * Retourne `null` si la chaîne est illisible ou AMBIGUË (ex. "1.234" : mille deux
 * cent trente-quatre ou un virgule deux cent trente-quatre ?). Ne devine jamais.
 */
export function analyserMontantFr(s: string): Decimal | null {
  if (typeof s !== 'string') return null;
  let t = s.replace(ESPACES, ' ').trim();
  if (t === '' || t.length > 40) return null;
  t = t.replace(/^(?:€|EUR)\s*/i, '').replace(/\s*(?:€|EUR)$/i, '').trim();
  let negatif = false;
  const parentheses = /^\((.*)\)$/.exec(t);
  if (parentheses) {
    negatif = true;
    t = (parentheses[1] ?? '').trim();
    t = t.replace(/^(?:€|EUR)\s*/i, '').replace(/\s*(?:€|EUR)$/i, '').trim();
  }
  const signeGauche = /^([+\-−])\s*(.*)$/.exec(t);
  if (signeGauche) {
    if (negatif) return null;
    negatif = signeGauche[1] !== '+';
    t = signeGauche[2] ?? '';
  } else {
    const signeDroite = /^(.*\d)\s*([+\-−])$/.exec(t);
    if (signeDroite) {
      if (negatif) return null;
      negatif = signeDroite[2] !== '+';
      t = signeDroite[1] ?? '';
    }
  }
  if (!/^[\d .,]+$/.test(t) || !/^\d/.test(t) || !/\d$/.test(t)) return null;

  let entier: string;
  let decimales = '';
  const aVirgule = t.includes(',');
  const aPoint = t.includes('.');
  const aEspace = t.includes(' ');

  if (aVirgule && aPoint) {
    const dernierSep = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
    const sepDecimal = t.charAt(dernierSep);
    const sepMilliers = sepDecimal === ',' ? '.' : ',';
    if (aEspace) return null;
    const avant = t.slice(0, dernierSep);
    decimales = t.slice(dernierSep + 1);
    if (decimales.includes(sepMilliers) || avant.includes(sepDecimal)) return null;
    if (!groupesDeTroisValides(avant, sepMilliers)) return null;
    entier = avant.split(sepMilliers).join('');
  } else if (aVirgule) {
    const morceaux = t.split(',');
    if (morceaux.length !== 2) return null;
    const avant = morceaux[0] ?? '';
    decimales = morceaux[1] ?? '';
    if (aEspace) {
      if (decimales.includes(' ') || !groupesDeTroisValides(avant, ' ')) return null;
      entier = avant.split(' ').join('');
    } else {
      entier = avant;
    }
  } else if (aPoint) {
    const morceaux = t.split('.');
    if (aEspace) {
      // "1 234.56" : espace = milliers, point = décimale.
      if (morceaux.length !== 2) return null;
      const avant = morceaux[0] ?? '';
      decimales = morceaux[1] ?? '';
      if (decimales.includes(' ') || !groupesDeTroisValides(avant, ' ')) return null;
      entier = avant.split(' ').join('');
    } else if (morceaux.length === 2) {
      const avant = morceaux[0] ?? '';
      decimales = morceaux[1] ?? '';
      // "1.234" : séparateur de milliers français ou décimale ? Ambigu → abstention.
      if (decimales.length === 3 && /^[1-9]\d{0,2}$/.test(avant)) return null;
      entier = avant;
    } else {
      // "1.234.567" : points = milliers.
      if (!groupesDeTroisValides(t, '.')) return null;
      entier = morceaux.join('');
    }
  } else if (aEspace) {
    if (!groupesDeTroisValides(t, ' ')) return null;
    entier = t.split(' ').join('');
  } else {
    entier = t;
  }

  if (!/^\d+$/.test(entier) || (decimales !== '' && !/^\d+$/.test(decimales))) return null;
  entier = entier.replace(/^0+(?=\d)/, '');
  if (entier.length > 13 || decimales.length > 6) return null;
  const d = new Decimal(decimales === '' ? entier : `${entier}.${decimales}`);
  return negatif ? d.negated() : d;
}

/** Somme exacte. */
export function somme(valeurs: Iterable<ChaineDecimale | Decimal>): Decimal {
  let total = new Decimal(0);
  for (const v of valeurs) total = total.plus(dec(v));
  return total;
}

/** Vrai si |d| ≤ tolérance (tolérance par défaut : 0, égalité stricte). */
export function estNul(d: Decimal, tolerance?: Decimal): boolean {
  const tol = tolerance ?? new Decimal(0);
  if (tol.isNegative()) throw new Error('Tolérance invalide : valeur négative.');
  return d.abs().lessThanOrEqualTo(tol);
}

export const ZERO = new Decimal(0);
