import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { analyserMontantFr, arrondirALEuro, dec, estNul, schemaChaineDecimale, somme, versChaine } from './montant.js';
import { creerAlea } from './synthetique/alea.js';

describe('schemaChaineDecimale / dec', () => {
  it.each(['0', '1234.56', '-12.5', '0.000001', '9999999999999.99'])('accepte %s', (v) => {
    expect(schemaChaineDecimale.safeParse(v).success).toBe(true);
    expect(dec(v).toString()).toBe(new Decimal(v).toString());
  });
  it.each(['', '1,5', '1e3', '1 234.56', '+1', '.5', '5.', '--1', '1.2.3', 'NaN', 'Infinity', '12345678901234', '1.1234567', ' 1'])('refuse %j', (v) => {
    expect(schemaChaineDecimale.safeParse(v).success).toBe(false);
    expect(() => dec(v)).toThrow(/Montant invalide/);
  });
  it('refuse les nombres flottants et les valeurs non finies', () => {
    expect(() => dec(1.5 as unknown as string)).toThrow();
    expect(() => dec(new Decimal(NaN))).toThrow();
    expect(dec(new Decimal('3.10')).toString()).toBe('3.1');
  });
});

describe('propriétés arithmétiques', () => {
  it('0.1 + 0.2 = 0.3 exactement', () => {
    expect(somme(['0.1', '0.2']).equals(dec('0.3'))).toBe(true);
    expect(versChaine(somme(['0.1', '0.2']))).toBe('0.30');
    expect(0.1 + 0.2 === 0.3).toBe(false); // rappel : ce que l'on évite
  });
  it('la somme de 10 000 fois 0.01 vaut exactement 100', () => {
    expect(versChaine(somme(Array.from({ length: 10_000 }, () => '0.01')))).toBe('100.00');
  });
  it('arrondi half-up symétrique', () => {
    expect(versChaine(dec('0.005'))).toBe('0.01');
    expect(versChaine(dec('0.004999'))).toBe('0.00');
    expect(versChaine(dec('1.005'))).toBe('1.01');
    expect(versChaine(dec('2.675'))).toBe('2.68');
    expect(versChaine(dec('-0.005'))).toBe('-0.01');
    expect(versChaine(dec('-0.004'))).toBe('0.00');
    expect(versChaine(dec('2.5'), 0)).toBe('3');
    expect(versChaine(dec('1.23456'), 4)).toBe('1.2346');
    expect(() => versChaine(dec('1'), 9)).toThrow();
  });
  it('propriétés sur 2 000 tirages : aller-retour, commutativité, somme en centimes entiers, a − a = 0', () => {
    const alea = creerAlea(20261119);
    for (let i = 0; i < 2000; i++) {
      const ca = alea.entier(-99_999_999, 99_999_999);
      const cb = alea.entier(-99_999_999, 99_999_999);
      const a = versChaine(new Decimal(ca).div(100));
      const b = versChaine(new Decimal(cb).div(100));
      expect(schemaChaineDecimale.safeParse(a).success).toBe(true);
      expect(versChaine(dec(a))).toBe(a);
      expect(somme([a, b]).equals(somme([b, a]))).toBe(true);
      expect(versChaine(somme([a, b]))).toBe(versChaine(new Decimal(ca + cb).div(100)));
      expect(estNul(dec(a).minus(dec(a)))).toBe(true);
      expect(analyserMontantFr(a.replace('.', ','))?.equals(dec(a))).toBe(true);
    }
  });
  it('estNul avec et sans tolérance', () => {
    expect(estNul(dec('0'))).toBe(true);
    expect(estNul(dec('0.01'))).toBe(false);
    expect(estNul(dec('-0.01'), dec('0.01'))).toBe(true);
    expect(estNul(dec('0.011'), dec('0.01'))).toBe(false);
    expect(() => estNul(dec('0'), dec('-1'))).toThrow();
  });
  it('somme vide = 0 ; somme refuse une valeur invalide', () => {
    expect(somme([]).isZero()).toBe(true);
    expect(() => somme(['1.00', '1,00'])).toThrow();
  });
});

describe('analyserMontantFr', () => {
  it.each([
    ['1 234,56', '1234.56'], ['1.234,56', '1234.56'], ['1234.56', '1234.56'], ['-12,5', '-12.5'], ['1 234,56', '1234.56'],
    ['1 234 567,89', '1234567.89'], ['(12,00)', '-12'], ['12,00-', '-12'], ['1,234.56', '1234.56'], ['1.234.567', '1234567'],
    ['0.123', '0.123'], ['1 234', '1234'], ['12 €', '12'], ['1 234,56 EUR', '1234.56'], ['  42  ', '42'], ['+7,5', '7.5'], ['0,00', '0'], ['1234,567', '1234.567'],
  ])('%j → %s', (entree, attendu) => {
    expect(analyserMontantFr(entree)?.toString()).toBe(attendu);
  });
  it.each(['1.234', '12.345', '1 23,4', 'abc', '', '1,2,3', '.5', '5.', '1 2O0,00', '12,3,4', '1.23.456', '(−', '-(12,00)', '1 234 56', '1e3', '12 34', '--1'])(
    'ambigu ou illisible %j → null',
    (entree) => {
      expect(analyserMontantFr(entree)).toBeNull();
    },
  );
});

describe('arrondirALEuro : arrondi des tableaux fiscaux (notices 2032-NOT-SD / 2033-NOT-SD 2026)', () => {
  it.each([
    ['0.49', '0'],
    ['0.50', '1'],
    ['0.51', '1'],
    ['1234.49', '1234'],
    ['1234.50', '1235'],
    ['999.99', '1000'],
    ['10000.00', '10000'],
    ['0.00', '0'],
    ['-0.49', '0'],
    ['-0.50', '-1'],
    ['-1234.50', '-1235'],
  ])('%s → %s (la fraction 0,50 compte pour 1)', (entree, attendu) => {
    expect(arrondirALEuro(entree)).toBe(attendu);
  });

  it('refuse une valeur qui n’est pas une chaîne décimale (aucune devinette)', () => {
    expect(() => arrondirALEuro('12,50')).toThrow();
    expect(() => arrondirALEuro('')).toThrow();
  });

  it('ne passe par aucun flottant : 0.50 arrondi sur de grands montants reste exact', () => {
    expect(arrondirALEuro('999999999999.50')).toBe('1000000000000');
  });
});
