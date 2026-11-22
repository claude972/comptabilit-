/** Recette du moteur générique de formulaires par cases (D-118) et de la définition du 2058-A : intégrité, abstention, néant, calculs énoncés, imputation, contrôles indicatifs. */
import { describe, expect, it } from 'vitest';
import type { QualificationRenvoi } from './detail-resultat.js';
import { FORMULAIRE_2058_A } from './definitions-2058.js';
import { cleCase, preparerFormulaireCases } from './formulaire-cases.js';

const TRACE = { note: 'Saisie du cabinet pour l’essai', qualifieePar: 'u-1', le: '2026-12-31T10:00:00Z', versionDonnees: 7 };
const rv = (code: string, montant: string, s: Partial<QualificationRenvoi> = {}): QualificationRenvoi => ({ code: cleCase('A58', code), montant, ...TRACE, ...s });
const prep = (renvois: QualificationRenvoi[] = []) => preparerFormulaireCases(FORMULAIRE_2058_A, { versionDonnees: 7, renvois });
const calc = (f: ReturnType<typeof prep>, code: string) => f.calculs.find((c) => c.code === code)!;
const cas = (f: ReturnType<typeof prep>, code: string) => f.cases.find((c) => c.code === code)!;
const XE = ['WD', 'WE', 'WF', 'WG', 'RA'];

describe('définition du 2058-A : intégrité', () => {
  it('codes uniques, clés valides pour l’API, contrôles référant à des cases existantes', () => {
    const codes = FORMULAIRE_2058_A.cases.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBe(73);
    for (const c of codes) expect(cleCase('A58', c)).toMatch(/^A58_[0-9A-Z]{2}$/);
    expect(new Set(codes.map((c) => cleCase('A58', c))).size).toBe(codes.length);
    const connus = new Set([...codes, ...FORMULAIRE_2058_A.calculs.map((c) => c.code)]);
    for (const k of FORMULAIRE_2058_A.controles) for (const x of [k.total, ...k.somme.map((y) => y.code)]) expect(connus.has(x), `${k.code} : ${x}`).toBe(true);
    for (const k of FORMULAIRE_2058_A.calculs) for (const x of k.composantes) expect(connus.has(x.code)).toBe(true);
    expect(cleCase('A58', 'ØV')).toBe('A58_0V');
  });
});

describe('2058-A : abstention, néant, à revoir', () => {
  it('sans saisie : XI, XJ et le résultat après imputation en abstention sans chiffre', () => {
    const f = prep();
    expect(f.cases.every((c) => c.statut === 'a_saisir' && c.montant === null)).toBe(true);
    expect(calc(f, 'XI').statut).toBe('abstention');
    expect(f.imputation?.avant.statut).toBe('abstention');
    expect(f.imputation?.apres.statut).toBe('abstention');
    expect(JSON.stringify(f.imputation)).not.toMatch(/"montant"/);
  });
  it('néant distinct du manque ; saisie sur une autre version : à revoir', () => {
    const f = prep([rv('WB', '0.00'), rv('WA', '5.00', { versionDonnees: 3 })]);
    expect(cas(f, 'WB')).toMatchObject({ statut: 'saisi', neant: true });
    expect(cas(f, 'WA')).toMatchObject({ statut: 'a_revoir', montant: null });
    expect(cas(f, 'WS')).toMatchObject({ statut: 'a_saisir', neant: false });
  });
});

describe('2058-A : calculs énoncés par le formulaire et imputation', () => {
  it('Bénéfice (I moins II) et Déficit (II moins I) à partir de TOTAL I et TOTAL II saisis', () => {
    const b = prep([rv('WR', '1500.00'), rv('XH', '500.00')]);
    expect(calc(b, 'XI')).toMatchObject({ statut: 'etabli', montant: '1000.00' });
    expect(calc(b, 'XJ')).toMatchObject({ statut: 'etabli', montant: '0.00' });
    const d = prep([rv('WR', '200.00'), rv('XH', '500.00')]);
    expect(calc(d, 'XI')).toMatchObject({ montant: '0.00' });
    expect(calc(d, 'XJ')).toMatchObject({ montant: '300.00' });
    expect(d.imputation?.avant).toMatchObject({ statut: 'etabli', sens: 'deficit', montant: '300.00', codeCase: 'XJ' });
  });
  it('après imputation : XN = XI − XL dans le plafond de la notice ; au-delà : refus ; report en arrière : abstention', () => {
    const base = [rv('WR', '3000000.00'), rv('XH', '0.00'), rv('ZL', '0.00')];
    const ok = prep([...base, rv('XL', '2000000.00')]);
    expect(ok.imputation?.plafond?.montant).toBe('2000000.00');
    expect(ok.imputation?.apres).toMatchObject({ statut: 'etabli', sens: 'benefice', montant: '1000000.00', codeCase: 'XN' });
    const trop = prep([...base, rv('XL', '2000000.01')]);
    expect(trop.imputation?.apres.statut).toBe('abstention');
    expect(trop.controles.find((c) => c.code === 'A58_IMPUTATION')).toMatchObject({ statut: 'ecart', ecart: '0.01' });
    const arriere = prep([rv('WR', '1000.00'), rv('XH', '0.00'), rv('ZL', '100.00'), rv('XL', '0.00')]);
    expect(arriere.imputation?.avant.statut).toBe('etabli');
    expect(arriere.imputation?.apres.statut).toBe('abstention');
    const deficit = prep([rv('WR', '0.00'), rv('XH', '50.00'), rv('ZL', '0.00'), rv('XL', '0.00')]);
    expect(deficit.imputation?.apres).toMatchObject({ statut: 'etabli', sens: 'deficit', montant: '50.00', codeCase: 'XO' });
    expect(prep([rv('WR', '0.00'), rv('XH', '50.00'), rv('ZL', '0.00'), rv('XL', '10.00')]).imputation?.apres.statut).toBe('abstention');
  });
});

describe('2058-A : contrôles indicatifs des cases de droite', () => {
  it('XE = WD + WE + WF + WG + RA − RB : cohérent puis écart, jamais corrigé', () => {
    const ok = prep([...XE.map((c) => rv(c, '10.00')), rv('RB', '10.00'), rv('XE', '40.00')]);
    expect(ok.controles.find((c) => c.code === 'A58_XE')?.statut).toBe('coherent');
    const ko = prep([...XE.map((c) => rv(c, '10.00')), rv('RB', '10.00'), rv('XE', '45.00')]);
    expect(ko.controles.find((c) => c.code === 'A58_XE')).toMatchObject({ statut: 'ecart', ecart: '5.00' });
    expect(cas(ko, 'XE').montant).toBe('45.00');
    expect(prep([rv('XE', '1.00')]).controles.some((c) => c.code === 'A58_XE')).toBe(false); // composantes manquantes : pas de contrôle
  });
  it('décimaux exacts', () => {
    expect(calc(prep([rv('WR', '0.30'), rv('XH', '0.10')]), 'XI')).toMatchObject({ montant: '0.20' });
  });
});
