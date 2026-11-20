import { describe, expect, it } from 'vitest';
import { dateReelle, erreurPeriode, nombreDeTranches, periodeDeLAdresse } from '@/lib/assistant';

describe('période commune de l’assistant de portefeuille', () => {
  it('n’accepte que des dates qui existent au calendrier', () => {
    expect(['2025-02-28', '2024-02-29', '2025-12-31', '1900-01-01'].map(dateReelle)).toEqual([true, true, true, true]);
    expect(['2025-02-30', '2025-02-29', '2025-13-01', '2025-00-10', '2025-04-31', '0000-01-01', '2025-1-1', '', 'demain', '2025-01-01T00:00'].map(dateReelle)).toEqual(Array(10).fill(false));
  });

  it('exige les deux dates ou aucune, réelles et ordonnées', () => {
    expect(erreurPeriode('', '')).toBeNull();
    expect(erreurPeriode('2025-01-01', '2025-01-01')).toBeNull();
    expect(erreurPeriode('2025-01-01', '')).toBe('Renseignez les deux dates de la période, ou aucune.');
    expect(erreurPeriode('', '2025-01-01')).toBe('Renseignez les deux dates de la période, ou aucune.');
    expect(erreurPeriode('2025-02-30', '2025-03-01')).toBe('La date de début n’existe pas au calendrier.');
    expect(erreurPeriode('2025-02-01', '2025-02-30')).toBe('La date de fin n’existe pas au calendrier.');
    expect(erreurPeriode('2025-03-02', '2025-03-01')).toBe('La date de début doit précéder ou égaler la date de fin.');
  });

  it('ne reprend de l’adresse qu’une période valide', () => {
    expect(periodeDeLAdresse('2025-01-01', '2025-03-31')).toEqual({ debut: '2025-01-01', fin: '2025-03-31' });
    for (const [d, f] of [['2025-01-01', undefined], [undefined, '2025-03-31'], ['2025-03-31', '2025-01-01'], ['2025-02-30', '2025-03-31'], ['x', 'y']] as const) expect(periodeDeLAdresse(d, f)).toBeNull();
  });

  it('compte les tranches de dossiers', () => {
    expect([0, 1, 20, 21, 40, 41, 200].map((n) => nombreDeTranches(n, 20))).toEqual([1, 1, 1, 2, 2, 3, 10]);
  });
});
