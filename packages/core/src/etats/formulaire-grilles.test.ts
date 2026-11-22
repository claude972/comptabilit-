/** Recette des grilles 2059-B, 2059-C et 2059-D (D-122) : saisie ligne par ligne, calculs énoncés seulement à composantes saisies. */
import { describe, expect, it } from 'vitest';
import { GRILLE_2065, GRILLE_DATES_CVAE, GRILLES_2059, preparerGrille } from './formulaire-grilles.js';
import { type SaisieTableau, validerSaisieTableau } from './saisies-tableaux.js';

const TRACE = { note: 'Suivi des plus-values (essai)', qualifieePar: 'u-1', le: '2026-12-31T10:00:00Z', versionDonnees: 7 };
const s = (tableau: SaisieTableau['tableau'], ligne: string, valeurs: Record<string, string>, x: Partial<SaisieTableau> = {}): SaisieTableau => ({ tableau, ligne, valeurs, ...TRACE, ...x });
const def = (id: string) => GRILLES_2059.find((g) => g.id === id)!;
const prep = (id: string, l: SaisieTableau[] = []) => preparerGrille(def(id), { versionDonnees: 7, saisiesTableaux: l });
const ligneB = { a: '100.00', b: '10.00', c: '20.00', d: '70.00' };
const toutesB = [
  s('2059B_A', 'E3', { a: '100.00', c: '20.00', d: '80.00' }), s('2059B_A', 'E10', { a: '50.00', c: '5.00', d: '45.00' }), s('2059B_A', 'EDD', { a: '0.00', c: '0.00', d: '0.00' }),
  s('2059B_A', 'T3N1', ligneB), s('2059B_A', 'T3N2', ligneB),
  ...Array.from({ length: 9 }, (_, i) => s('2059B_A', `T10N${i + 1}`, ligneB)),
];

describe('grilles 2059', () => {
  it('sans saisie : à saisir, totaux en abstention ; nombres de lignes lus sur les formulaires', () => {
    const b = prep('2059-B');
    expect(b.etat).toBe('a_saisir');
    expect(b.cadres[0]!.lignes).toHaveLength(14);
    expect(b.cadres[1]!.lignes).toHaveLength(14);
    expect(b.cadres[0]!.calculs[0]!.cellules.a!.statut).toBe('abstention');
    expect(prep('2059-C').cadres.map((c) => c.lignes.length)).toEqual([11, 11]);
    expect(prep('2059-D').cadres.map((c) => c.lignes.length)).toEqual([4, 1]);
  });
  it('2059-B : totaux 1 et 2 seulement quand toutes les lignes sont saisies ; cadre B sur les lignes saisies ; à revoir', () => {
    const partiel = prep('2059-B', toutesB.slice(1));
    expect(partiel.cadres[0]!.calculs[0]!.cellules.a!.statut).toBe('abstention');
    const f = prep('2059-B', [...toutesB, s('2059B_B', '01', { origine: 'Fusion 2020 (fictive)', ...ligneB })]);
    expect(f.cadres[0]!.calculs[0]!.cellules).toMatchObject({ a: { montant: '150.00' }, c: { montant: '25.00' }, d: { montant: '125.00' } });
    expect(f.cadres[0]!.calculs[0]!.cellules.b).toBeUndefined(); // colonne grisée
    expect(f.cadres[0]!.calculs[1]!.cellules.a).toMatchObject({ statut: 'etabli', montant: '1100.00' });
    expect(f.cadres[1]!.calculs[0]!.cellules.d).toMatchObject({ statut: 'etabli', montant: '70.00' });
    const r = prep('2059-B', toutesB.map((x, i) => (i === 3 ? { ...x, versionDonnees: 1 } : x)));
    expect(r.cadres[0]!.lignes[3]!.statut).toBe('a_revoir');
    expect(r.cadres[0]!.calculs[1]!.cellules.a!.statut).toBe('abstention');
  });
  it('2059-C : solde (2 + 3 − 4 − 5) calculé par ligne, colonne grisée ignorée ; néant', () => {
    const f = prep('2059-C', [s('2059C_II', 'N', { c2: '100.00', c3: '10.00', c5: '30.00' }), s('2059C_II', 'N1', { c2: '200.00', c3: '0.00', c4: '50.00', c5: '20.00' })]);
    const l = f.cadres[1]!.lignes;
    expect(l[0]!.calculee).toEqual({ statut: 'etabli', montant: '80.00' });
    expect(l[1]!.calculee).toEqual({ statut: 'etabli', montant: '130.00' });
    expect(l[2]!.calculee!.statut).toBe('abstention');
    expect(prep('2059-C', [s('2059C_I', 'NEANT', {})]).etat).toBe('neant');
    expect(prep('2059-C', [s('2059C_I', 'NEANT', {}), s('2059C_I', 'N', { c2: '1.00', c4: '1.00' })]).controles.some((c) => c.code.endsWith('NEANT_ET_LIGNES'))).toBe(true);
  });
  it('2059-D : lignes 3, 6 et 7 calculées comme le formulaire', () => {
    const c = (a: string, b: string) => ({ t10: a, t15: b, t18: '0.00', t19: '0.00', t25: '0.00' });
    const f = prep('2059-D', [s('2059D_I', 'L1', c('100.00', '50.00')), s('2059D_I', 'L2', c('10.00', '0.00')), s('2059D_I', 'L4', c('20.00', '5.00')), s('2059D_I', 'L5', c('0.00', '0.00'))]);
    const k = Object.fromEntries(f.cadres[0]!.calculs.map((x) => [x.id, x.cellules]));
    expect(k.L3!.t10).toMatchObject({ montant: '110.00' });
    expect(k.L6!.t15).toMatchObject({ montant: '5.00' });
    expect(k.L7!.t10).toMatchObject({ montant: '90.00' });
    expect(k.L7!.t15).toMatchObject({ montant: '45.00' });
    expect(prep('2059-D', [s('2059D_I', 'L1', c('1.00', '1.00'))]).cadres[0]!.calculs[2]!.cellules.t10!.statut).toBe('abstention');
  });
  it('forme des saisies', () => {
    expect(validerSaisieTableau('2059B_A', 'E3', { a: '1.00', c: '1.00', d: '1.00' })).toEqual([]);
    expect(validerSaisieTableau('2059B_A', 'E3', { a: '1.00', b: '1.00', c: '1.00', d: '1.00' }).join(' ')).toMatch(/champ inconnu/);
    expect(validerSaisieTableau('2059B_A', 'E3', { a: '1.00' }).join(' ')).toMatch(/obligatoire/);
    expect(validerSaisieTableau('2059B_B', '15', { origine: 'X1', ...ligneB }).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2059B_B', '14', { origine: 'Fusion', ...ligneB })).toEqual([]);
    expect(validerSaisieTableau('2059B_B', '01', { origine: '', ...ligneB }).join(' ')).toMatch(/origine/);
    expect(validerSaisieTableau('2059B_B', 'NEANT', {}).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2059C_I', 'NEANT', {})).toEqual([]);
    expect(validerSaisieTableau('2059C_II', 'N', { c2: '1.00', c3: '1.00', c4: '1.00', c5: '1.00' }).join(' ')).toMatch(/champ inconnu/);
    expect(validerSaisieTableau('2059C_II', 'N11', { c2: '1.00' }).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2059D_I', 'L3', { t10: '1.00' }).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2059D_II', 'U', { c1: '1.00', c2: '0.00', c3: '0.00', c4: '0.00', c5: '1.00' })).toEqual([]);
  });
  it('2065 : rubriques saisies une à une, montants signés seulement où le formulaire le demande, aucun néant', () => {
    const f = preparerGrille(GRILLE_2065, { versionDonnees: 7, saisiesTableaux: [s('2065_C1', 'BN', { m: '12345.00' })] });
    expect(f.etat).toBe('saisi');
    expect(f.cadres.map((c) => c.tableau)).toEqual(['2065_C1', '2065_C2', '2065_C3', '2065_C4', '2065_F', '2065_I', '2065_D', '2065_E']);
    expect(f.cadres[0]!.lignes.map((l) => l.statut)).toEqual(['saisi', 'a_saisir', 'a_saisir', 'a_saisir']);
    expect(f.cadres.every((c) => c.calculs.length === 0)).toBe(true);
    expect(preparerGrille(GRILLE_2065, { versionDonnees: 7, saisiesTableaux: [] }).etat).toBe('a_saisir');
    expect(validerSaisieTableau('2065_C4', 'SIIC', { m: '-500.00' })).toEqual([]);
    expect(validerSaisieTableau('2065_C1', 'DEF', { m: '-500.00' }).join(' ')).toMatch(/positif/);
    expect(validerSaisieTableau('2065_C1', 'NEANT', {}).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2065_F', 'TAUX', { m: '0.25' })).toEqual([]);
    expect(validerSaisieTableau('2065_E', 'X', { m: '1.00' }).join(' ')).toMatch(/Ligne inconnue/);
  });
  it('dates du 2033-E / 2059-E : période de référence et cessation saisies en AAAA-MM-JJ, ordre contrôlé sans correction', () => {
    const f = preparerGrille(GRILLE_DATES_CVAE, { versionDonnees: 7, saisiesTableaux: [s('2033E_DATES', 'PER', { debut: '2025-01-01', fin: '2025-12-31' })] });
    expect(f.cadres[0]!.lignes.map((l) => l.statut)).toEqual(['saisi', 'a_saisir']);
    expect(f.controles.some((c) => c.code.includes('ORDRE'))).toBe(false);
    const g = preparerGrille(GRILLE_DATES_CVAE, { versionDonnees: 7, saisiesTableaux: [s('2033E_DATES', 'PER', { debut: '2025-12-31', fin: '2025-01-01' })] });
    expect(g.controles.find((c) => c.code.includes('ORDRE'))?.statut).toBe('ecart');
    expect(g.cadres[0]!.lignes[0]!.valeurs).toEqual({ debut: '2025-12-31', fin: '2025-01-01' });
    expect(validerSaisieTableau('2033E_DATES', 'CES', { cessation: '2025-06-30' })).toEqual([]);
    expect(validerSaisieTableau('2033E_DATES', 'CES', { cessation: '30/06/2025' }).join(' ')).toMatch(/date AAAA-MM-JJ/);
    expect(validerSaisieTableau('2033E_DATES', 'CES', { cessation: '2025-02-30' }).join(' ')).toMatch(/date AAAA-MM-JJ/);
    expect(validerSaisieTableau('2033E_DATES', 'PER', { debut: '2025-01-01' }).join(' ')).toMatch(/obligatoire/);
    expect(validerSaisieTableau('2033E_DATES', 'NEANT', {}).join(' ')).toMatch(/Ligne inconnue/);
  });
});
