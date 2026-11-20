import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { Budget, lignesReserveesMaintenant, refusVolume } from './plafonds.js';

describe('refus de volume', () => {
  it('409 motivé en français, avec volume, plafond et variable', () => {
    const e = refusVolume({ ecran: 'États de travail', objet: 'lignes d’écriture dans l’exercice', volume: 500_001, plafond: 400_000, variable: 'API_LIGNES_MAX_CALCUL' });
    expect(e).toBeInstanceOf(HttpException);
    expect(e.getStatus()).toBe(409);
    const corps = e.getResponse() as Record<string, unknown>;
    expect(corps).toMatchObject({ code: 'volume_trop_important', volume: 500_001, plafond: 400_000, variable: 'API_LIGNES_MAX_CALCUL' });
    expect(corps.message).toMatch(/^États de travail refusé : 500\s001 lignes d’écriture dans l’exercice, au-delà du plafond de 400\s000/);
    expect(corps.message).toContain('Aucun résultat partiel');
  });
});

describe('budget de lignes en mémoire (calculs simultanés)', () => {
  it('un calcul seul n’est jamais refusé par le total ; les autres sont reportés sans rien charger ; la libération rend le budget', () => {
    expect(lignesReserveesMaintenant()).toBe(0);
    const a = new Budget();
    a.reserver(500, 600, 'A');
    expect(lignesReserveesMaintenant()).toBe(500);
    const b = new Budget();
    expect(() => b.reserver(200, 600, 'B')).toThrowError(/reporté/);
    expect(lignesReserveesMaintenant()).toBe(500); // un refus ne réserve rien
    try {
      b.reserver(200, 600, 'B');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(503);
      expect((e as HttpException).getResponse()).toMatchObject({ code: 'calculs_simultanes_trop_lourds', variable: 'API_LIGNES_MAX_SIMULTANEES', reessayerDansSecondes: 5 });
    }
    b.reserver(100, 600, 'B'); // 500 + 100 = 600 : tient
    expect(lignesReserveesMaintenant()).toBe(600);
    a.liberer();
    expect(lignesReserveesMaintenant()).toBe(100);
    a.liberer(); // idempotent
    expect(lignesReserveesMaintenant()).toBe(100);
    b.liberer();
    expect(lignesReserveesMaintenant()).toBe(0);
    // Seul, un calcul plus gros que le total est accepté (son plafond propre le borne) ; une même requête qui réserve deux fois ne se bloque pas elle-même.
    const c = new Budget();
    c.reserver(900, 600, 'C');
    c.reserver(900, 600, 'C');
    expect(lignesReserveesMaintenant()).toBe(1800);
    c.liberer();
    expect(lignesReserveesMaintenant()).toBe(0);
  });
});
