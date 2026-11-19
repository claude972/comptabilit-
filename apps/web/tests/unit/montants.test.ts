import { describe, expect, it } from 'vitest';
import { formaterDate, formaterMontant } from '@/lib/montants';

const F = ' ';

describe('formaterMontant (sans flottant)', () => {
  it('sépare les milliers et utilise la virgule décimale', () => {
    expect(formaterMontant('1234.56')).toBe(`1${F}234,56`);
    expect(formaterMontant('1234567.5')).toBe(`1${F}234${F}567,50`);
    expect(formaterMontant('12')).toBe('12,00');
    expect(formaterMontant('0.00')).toBe('0,00');
    expect(formaterMontant('999.99')).toBe('999,99');
    expect(formaterMontant('1000')).toBe(`1${F}000,00`);
  });
  it('conserve exactement des valeurs qu’un flottant altérerait', () => {
    // 9007199254740993 n'est pas représentable en double ; 0.1 + 0.2 non plus.
    expect(formaterMontant('9007199254740993.01')).toBe(`9${F}007${F}199${F}254${F}740${F}993,01`);
    expect(formaterMontant('1234567890123.123456')).toBe(`1${F}234${F}567${F}890${F}123,123456`);
    expect(formaterMontant('0.30000000000000004')).toBe('0,30000000000000004');
  });
  it('ne fait aucun arrondi', () => {
    expect(formaterMontant('1.005')).toBe('1,005');
    expect(formaterMontant('2.675')).toBe('2,675');
  });
  it('gère le signe, y compris le zéro négatif', () => {
    expect(formaterMontant('-1234.5')).toBe(`−1${F}234,50`);
    expect(formaterMontant('-0.00')).toBe('0,00');
  });
  it('ajoute la devise et rend tel quel ce qui n’est pas une chaîne décimale', () => {
    expect(formaterMontant('10.00', 'EUR')).toBe('10,00 EUR');
    expect(formaterMontant('1e5')).toBe('1e5');
    expect(formaterMontant('<b>12</b>')).toBe('<b>12</b>');
    expect(formaterMontant(null)).toBe('—');
  });
  it('supprime les zéros de tête sans toucher aux décimales', () => {
    expect(formaterMontant('000123.40')).toBe('123,40');
  });
});

describe('formaterDate', () => {
  it('convertit une date ISO par manipulation de chaîne', () => {
    expect(formaterDate('2025-12-31')).toBe('31/12/2025');
    expect(formaterDate(null)).toBe('—');
  });
});
