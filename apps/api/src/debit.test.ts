import { describe, expect, it } from 'vitest';
import { limiterDebit } from './mail.controller.js';

describe('limitation de débit des notifications publiques', () => {
  it('accepte jusqu’à la limite par minute, refuse ensuite, puis rouvre quand la fenêtre a glissé', () => {
    const t0 = 1_800_000_000_000;
    for (let i = 0; i < 300; i++) limiterDebit('essai', t0 + i);
    expect(() => limiterDebit('essai', t0 + 400)).toThrow(/Trop de notifications/);
    expect(() => limiterDebit('autre-fournisseur', t0 + 400)).not.toThrow(); // limites indépendantes
    expect(() => limiterDebit('essai', t0 + 60_001)).not.toThrow(); // la première requête est sortie de la fenêtre
  });
});
