/** Recette des grilles 2059-B, 2059-C et 2059-D (D-122) : saisie ligne par ligne, calculs énoncés seulement à composantes saisies. */
import { describe, expect, it } from 'vitest';
import { GRILLE_2053_DETAIL, GRILLE_2033D_982, GRILLE_2058A_FEUILLETS, GRILLE_2058B_K4BIS, GRILLE_2057, GRILLE_2065, GRILLE_2065_BIS, GRILLE_DATES_CVAE, GRILLES_2059, preparerGrille } from './formulaire-grilles.js';
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
  it('2057 : totaux VT/VU/VV et VY/VZ seulement quand toutes les lignes sont saisies ; ventilation par échéance contrôlée sans correction', () => {
    const lignesA = GRILLE_2057.cadres[0]!.lignes.map((l) => l.ligne);
    const toutes = lignesA.map((l) => s('2057_A', l, { c1: '100.00', c2: '60.00', c3: '40.00' }));
    const f = preparerGrille(GRILLE_2057, { versionDonnees: 7, saisiesTableaux: toutes });
    expect(lignesA).toHaveLength(15);
    expect(f.cadres[0]!.calculs[0]!.cellules).toMatchObject({ c1: { statut: 'etabli', montant: '1500.00' }, c2: { montant: '900.00' }, c3: { montant: '600.00' } });
    expect(f.controles.filter((c) => c.code.includes('_VENT_')).every((c) => c.statut === 'coherent')).toBe(true);
    const partiel = preparerGrille(GRILLE_2057, { versionDonnees: 7, saisiesTableaux: toutes.slice(1) });
    expect(partiel.cadres[0]!.calculs[0]!.cellules.c1!.statut).toBe('abstention');
    const ecart = preparerGrille(GRILLE_2057, { versionDonnees: 7, saisiesTableaux: [s('2057_A', 'UL', { c1: '100.00', c2: '60.00', c3: '30.00' })] });
    expect(ecart.controles.find((c) => c.code === '2057_VENT_UL')).toMatchObject({ statut: 'ecart', ecart: '10.00' });
    expect(ecart.cadres[0]!.lignes[0]!.valeurs!.c3).toBe('30.00');
    const dettes = GRILLE_2057.cadres[2]!.lignes.map((l) => s('2057_B', l.ligne, { c1: '10.00', c2: '4.00', c3: '3.00', c4: '3.00' }));
    expect(preparerGrille(GRILLE_2057, { versionDonnees: 7, saisiesTableaux: dettes }).cadres[2]!.calculs[0]!.cellules).toMatchObject({ c1: { montant: '170.00' }, c4: { montant: '51.00' } });
    expect(validerSaisieTableau('2057_AX', 'UO', { m: '5.00' })).toEqual([]);
    expect(validerSaisieTableau('2057_A', 'UO', { c1: '5.00', c2: '5.00', c3: '0.00' }).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2057_B', 'VG', { c1: '5.00', c2: '5.00', c3: '0.00' }).join(' ')).toMatch(/obligatoire/);
    expect(validerSaisieTableau('2057_A', 'NEANT', {})).toEqual([]);
  });
  it('2065 bis : total « a à h » seulement quand a à h sont saisis ; rémunérations H avec année ; textes ; MVLT', () => {
    const lettres = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((l, i) => s('2065B_G', l, { m: `${(i + 1) * 100}.00` }));
    const f = preparerGrille(GRILLE_2065_BIS, { versionDonnees: 7, saisiesTableaux: lettres });
    expect(f.cadres[0]!.calculs[0]!.cellules.m).toEqual({ statut: 'etabli', montant: '3600.00' });
    expect(preparerGrille(GRILLE_2065_BIS, { versionDonnees: 7, saisiesTableaux: lettres.slice(1) }).cadres[0]!.calculs[0]!.cellules.m!.statut).toBe('abstention');
    const H = { origine: 'Durand Paul, 5 rue du Test, gérant', c2: '100.00', c3: '2025', c4: '30000.00', c5: '0.00', c6: '0.00', c7: '0.00', c8: '0.00' };
    expect(validerSaisieTableau('2065B_H', '10', H)).toEqual([]);
    expect(validerSaisieTableau('2065B_H', '11', H).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2065B_H', '01', { ...H, c3: '25' }).join(' ')).toMatch(/année sur quatre chiffres/);
    expect(validerSaisieTableau('2065B_I', 'PROP', { t: 'SCI Exemple, 1 rue du Test' })).toEqual([]);
    expect(validerSaisieTableau('2065B_I', 'PROP', { t: '' }).join(' ')).toMatch(/texte de 1 à 500/);
    expect(validerSaisieTableau('2065B_J2', 'OUVERT', { m0: '1.00', m15: '0.00', m19: '0.00' })).toEqual([]);
    expect(validerSaisieTableau('2065B_J2', 'OUVERT', { m0: '1.00' }).join(' ')).toMatch(/obligatoire/);
    expect(validerSaisieTableau('2065B_K', 'RECUS', { m: '12' })).toEqual([]);
    expect(validerSaisieTableau('2065B_G', 'NEANT', {}).join(' ')).toMatch(/Ligne inconnue/);
  });
  it('feuillet des déficits transférés : total et nombre rapprochés des cases 982 bis et 982 ter, indicatif', () => {
    const ligne = (n: string, m: string) => s('2033D_982', n, { origine: `Société ${n} (fictive)`, siren: '123456789', date: '2025-03-01', m });
    const f = preparerGrille(GRILLE_2033D_982, { versionDonnees: 7, saisiesTableaux: [ligne('01', '1000.00'), ligne('02', '500.00')], valeursAutres: { D_982B: '1500.00', D_982T: '2' } });
    expect(f.controles.find((c) => c.code.endsWith('SOMME_982BIS'))?.statut).toBe('coherent');
    expect(f.controles.find((c) => c.code.endsWith('NOMBRE_982TER'))?.statut).toBe('coherent');
    expect(f.cadres[0]!.calculs[0]!.cellules.m).toEqual({ statut: 'etabli', montant: '1500.00' });
    const g = preparerGrille(GRILLE_2033D_982, { versionDonnees: 7, saisiesTableaux: [ligne('01', '1000.00')], valeursAutres: { D_982B: '1500.00', D_982T: '2' } });
    expect(g.controles.find((c) => c.code.endsWith('SOMME_982BIS'))).toMatchObject({ statut: 'ecart', ecart: '-500.00' });
    expect(preparerGrille(GRILLE_2033D_982, { versionDonnees: 7, saisiesTableaux: [ligne('01', '1.00')] }).controles.some((c) => c.code.endsWith('_982BIS') || c.code.endsWith('_982TER'))).toBe(false);
    expect(validerSaisieTableau('2033D_982', '20', { origine: 'Société vingt', siren: '123456789', date: '2025-03-01', m: '1.00' })).toEqual([]);
    expect(validerSaisieTableau('2033D_982', '21', { origine: 'Société', siren: '1', date: '2025-03-01', m: '1.00' }).join(' ')).toMatch(/Ligne inconnue/);
  });
  it('feuillets du réel normal : K4 bis rapproché de la case saisie ; détails 2058-A sans rapprochement ; pas de néant', () => {
    const op = (n: string, m: string) => s('2058B_K4BIS', n, { origine: `Société ${n}`, siren: '123456789', date: '2025-03-01', m });
    const f = preparerGrille(GRILLE_2058B_K4BIS, { versionDonnees: 7, saisiesTableaux: [op('01', '700.00')], valeursAutres: { B58_K4BIS: '700.00' } });
    expect(f.controles.find((c) => c.code.endsWith('SOMME_K4BIS'))?.statut).toBe('coherent');
    expect(f.neantPossible).toBe(false);
    const d = preparerGrille(GRILLE_2058A_FEUILLETS, { versionDonnees: 7, saisiesTableaux: [s('2058A_REINT', '01', { origine: 'Amende (fictive)', m: '120.00' }), s('2058A_REINT', '02', { origine: 'Pénalité (fictive)', m: '30.00' })] });
    expect(d.cadres[0]!.calculs[0]!.cellules.m).toEqual({ statut: 'etabli', montant: '150.00' });
    expect(d.controles.every((c) => !c.code.includes('EXTERNE') && !c.code.includes('SOMME'))).toBe(true);
    expect(d.cadres.map((c) => c.lignes.length)).toEqual([20, 20]);
    expect(validerSaisieTableau('2058A_DEDUC', 'NEANT', {}).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2058A_DEDUC', '01', { origine: 'Déduction (fictive)', m: '10.00' })).toEqual([]);
  });
  it('2053 (7) et (8) : détails saisis, totaux calculés, rapprochés indicativement du 2053 et des cases 1G et 1H', () => {
    const l = (t: string, n: string, c: string, p: string) => s(t as 'IMMO_CELL', n, { origine: `Nature ${n}`, c, p });
    const f = preparerGrille(GRILLE_2053_DETAIL, { versionDonnees: 7, saisiesTableaux: [l('2053_D7', '01', '300.00', '0.00'), l('2053_D7', '02', '0.00', '120.00'), l('2053_D8', '01', '45.00', '0.00')], valeursAutres: { R53_CX: '300.00', R53_PX: '100.00', Q_1H: '45.00' } });
    expect(f.cadres[0]!.calculs[0]!.cellules).toMatchObject({ c: { montant: '300.00' }, p: { montant: '120.00' } });
    expect(f.controles.find((c) => c.code.endsWith('CHARGES_EXC'))?.statut).toBe('coherent');
    expect(f.controles.find((c) => c.code.endsWith('PRODUITS_EXC'))).toMatchObject({ statut: 'ecart', ecart: '20.00' });
    expect(f.controles.find((c) => c.code.endsWith('CHARGES_ANT'))?.statut).toBe('coherent');
    expect(f.controles.some((c) => c.code.endsWith('PRODUITS_ANT'))).toBe(false);
    expect(validerSaisieTableau('2053_D8', '10', { origine: 'Nature', c: '1.00', p: '0.00' })).toEqual([]);
    expect(validerSaisieTableau('2053_D8', '11', { origine: 'Nature', c: '1.00', p: '0.00' }).join(' ')).toMatch(/Ligne inconnue/);
  });
});
