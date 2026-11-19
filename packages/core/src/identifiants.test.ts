import { describe, expect, it } from 'vitest';
import { sirenDeTvaFr, validerIban, validerSiren, validerSiret, validerTvaIntracomFr } from './identifiants.js';

describe('validerSiren', () => {
  it('accepte une clé de Luhn correcte, avec ou sans espaces', () => {
    expect(validerSiren('732829320')).toEqual({ valide: true });
    expect(validerSiren('732 829 320').valide).toBe(true);
  });
  it.each(['732829321', '73282932', '7328293200', 'ABCDEFGHI', '', '000000000'])('refuse %j avec un motif', (v) => {
    const r = validerSiren(v);
    expect(r.valide).toBe(false);
    expect(r.motif).toBeTruthy();
  });
});

describe('validerSiret', () => {
  it('accepte un SIRET correct et refuse une clé fausse ou une mauvaise longueur', () => {
    expect(validerSiret('73282932000074').valide).toBe(true);
    expect(validerSiret('732 829 320 00074').valide).toBe(true);
    expect(validerSiret('73282932000075').valide).toBe(false);
    expect(validerSiret('7328293200007').valide).toBe(false);
    expect(validerSiret('00000000000000').valide).toBe(false);
  });
  it('exception La Poste : somme des chiffres multiple de 5, signalée dans le motif', () => {
    const r = validerSiret('35600000049639');
    expect(r.valide).toBe(true);
    expect(r.motif).toMatch(/La Poste/);
    expect(validerSiret('35600000000048')).toEqual({ valide: true }); // siège : Luhn classique
    expect(validerSiret('35600000049638').valide).toBe(false);
    // La dérogation ne s'applique à aucun autre SIREN.
    expect(validerSiret('73282932000005').valide).toBe(false);
  });
});

describe('validerTvaIntracomFr', () => {
  it('vérifie la clé numérique', () => {
    expect(validerTvaIntracomFr('FR44732829320')).toEqual({ valide: true });
    expect(validerTvaIntracomFr('fr 44 732 829 320').valide).toBe(true);
    expect(validerTvaIntracomFr('FR45732829320').valide).toBe(false);
    expect(validerTvaIntracomFr('FR44732829321').valide).toBe(false);
    expect(validerTvaIntracomFr('DE123456789').valide).toBe(false);
  });
  it('clé alphanumérique : non contrôlée, donc jamais déclarée valide', () => {
    const r = validerTvaIntracomFr('FRK7732829320');
    expect(r.valide).toBe(false);
    expect(r.motif).toMatch(/non implémenté/);
  });
  it('sirenDeTvaFr', () => {
    expect(sirenDeTvaFr('FR 44 732829320')).toBe('732829320');
    expect(sirenDeTvaFr('NL820098395B01')).toBeNull();
  });
});

describe('validerIban', () => {
  it('mod 97', () => {
    expect(validerIban('FR76 3000 6000 0112 3456 7890 189')).toEqual({ valide: true });
    expect(validerIban('GB82WEST12345698765432').valide).toBe(true);
    expect(validerIban('FR7630006000011234567890188').valide).toBe(false);
    expect(validerIban('FR76300060000112345678901').valide).toBe(false); // longueur FR ≠ 27
    expect(validerIban('pas un iban').valide).toBe(false);
  });
});
