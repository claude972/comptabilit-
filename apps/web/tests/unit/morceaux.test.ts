import { describe, expect, it } from 'vitest';
import { planMorceaux, prochainMorceau } from '@/lib/televersement/morceaux';

describe('découpage en morceaux', () => {
  it('couvre le fichier sans trou ni recouvrement', () => {
    const plan = planMorceaux(10, 4);
    expect(plan).toEqual([
      { decalage: 0, fin: 4 },
      { decalage: 4, fin: 8 },
      { decalage: 8, fin: 10 },
    ]);
  });
  it('gère les tailles multiples exactes et les fichiers plus petits qu’un morceau', () => {
    expect(planMorceaux(8, 4)).toHaveLength(2);
    expect(planMorceaux(3, 4)).toEqual([{ decalage: 0, fin: 3 }]);
  });
  it('reprend à un décalage quelconque, même non aligné', () => {
    expect(planMorceaux(10, 4, 5)).toEqual([
      { decalage: 5, fin: 9 },
      { decalage: 9, fin: 10 },
    ]);
    expect(prochainMorceau(10, 4, 10)).toBeNull();
  });
  it('refuse les entrées incohérentes', () => {
    expect(() => prochainMorceau(0, 4, 0)).toThrow();
    expect(() => prochainMorceau(10, 0, 0)).toThrow();
    expect(() => prochainMorceau(10, 4, 11)).toThrow();
    expect(() => prochainMorceau(10, 4, -1)).toThrow();
  });
  it('couvre exactement la taille pour des cas variés', () => {
    for (const [taille, morceau] of [[1, 1], [4 * 1024 * 1024 + 1, 4 * 1024 * 1024], [12345, 1000]] as const) {
      const plan = planMorceaux(taille, morceau);
      expect(plan.reduce((s, m) => s + (m.fin - m.decalage), 0)).toBe(taille);
      plan.forEach((m, i) => expect(m.decalage).toBe(i === 0 ? 0 : plan[i - 1]!.fin));
    }
  });
});
