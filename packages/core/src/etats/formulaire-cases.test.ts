/** Recette du moteur générique de formulaires par cases (D-118) et de la définition du 2058-A : intégrité, abstention, néant, calculs énoncés, imputation, contrôles indicatifs. */
import { describe, expect, it } from 'vitest';
import type { QualificationRenvoi } from './detail-resultat.js';
import { FORMULAIRE_2058_A, FORMULAIRE_2058_B, FORMULAIRE_2058_C } from './definitions-2058.js';
import { FORMULAIRE_2059_E } from './definitions-2059.js';
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

describe('2058-B : calculs énoncés, propositions reprises du 2058-A, rapprochements avec le 2058-A (D-119)', () => {
  const rvB = (code: string, montant: string, s: Partial<QualificationRenvoi> = {}): QualificationRenvoi => ({ code: cleCase('B58', code), montant, ...TRACE, ...s });
  const prepB = (renvois: QualificationRenvoi[] = [], valeursAutres: Record<string, string> = {}) => preparerFormulaireCases(FORMULAIRE_2058_B, { versionDonnees: 7, renvois, valeursAutres });
  const calcB = (f: ReturnType<typeof prepB>, code: string) => f.calculs.find((c) => c.code === code)!;

  it('intégrité : codes uniques, clés valides, calculs et propositions référant à des cases existantes', () => {
    const codes = FORMULAIRE_2058_B.cases.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBe(5 + 1 + 22 + 1); // I : 5 cases ; II : 1 ; III : 22 ; IV : 1
    expect(new Set(codes.map((c) => cleCase('B58', c))).size).toBe(codes.length);
    for (const c of codes) expect(cleCase('B58', c)).toMatch(/^B58_[0-9A-Z]{2,5}$/);
    expect(cleCase('B58', 'K4 bis')).toBe('B58_K4BIS');
    const connus = new Set([...codes, ...FORMULAIRE_2058_B.calculs.map((c) => c.code)]);
    for (const k of FORMULAIRE_2058_B.calculs) for (const x of k.composantes) expect(connus.has(x.code), x.code).toBe(true);
    for (const p of FORMULAIRE_2058_B.propositions ?? []) expect(connus.has(p.code)).toBe(true);
  });
  it('sans saisie : K6, YK, YN et YO en abstention sans chiffre', () => {
    const f = prepB();
    for (const k of ['K6', 'YK', 'YN', 'YO']) expect(calcB(f, k).statut).toBe('abstention');
    expect(f.cases.every((c) => c.statut === 'a_saisir' && c.proposition === null)).toBe(true);
  });
  it('K6 = K4 + K4 bis − K5 et YK = K6 + YJ (« différence », « somme »)', () => {
    const f = prepB([rvB('K4', '1000.00'), rvB('K4 bis', '200.00'), rvB('K5', '300.00'), rvB('YJ', '50.00')]);
    expect(calcB(f, 'K6')).toMatchObject({ statut: 'etabli', montant: '900.00' });
    expect(calcB(f, 'YK')).toMatchObject({ statut: 'etabli', montant: '950.00' });
  });
  it('K5 et YJ proposés par le 2058-A, jamais retenus sans saisie', () => {
    const f = prepB([], { A58_XB: '100.00', A58_XL: '250.00', A58_XO: '75.00' });
    expect(f.cases.find((c) => c.code === 'K5')).toMatchObject({ statut: 'a_saisir', montant: null, proposition: { montant: '350.00' } });
    expect(f.cases.find((c) => c.code === 'YJ')).toMatchObject({ statut: 'a_saisir', proposition: { montant: '75.00' } });
    expect(calcB(f, 'K6').statut).toBe('abstention');
    expect(prepB([], { A58_XB: '100.00' }).cases.find((c) => c.code === 'K5')!.proposition).toBeNull(); // source incomplète
    expect(prepB([rvB('K5', '1.00')], { A58_XB: '100.00', A58_XL: '250.00' }).cases.find((c) => c.code === 'K5')!.proposition).toBeNull(); // saisi : plus de proposition
  });
  it('YN = ZV à 9S et YO = ZW à 9T quand toutes les lignes sont saisies ; rapprochement indicatif avec WI et WU du 2058-A', () => {
    const lignes = FORMULAIRE_2058_B.calculs.find((k) => k.code === 'YN')!.composantes.map((x) => rvB(x.code, '10.00'));
    const reprises = FORMULAIRE_2058_B.calculs.find((k) => k.code === 'YO')!.composantes.map((x) => rvB(x.code, '5.00'));
    const f = prepB([...lignes, ...reprises], { A58_WI: '110.00', A58_WU: '50.00' });
    expect(calcB(f, 'YN')).toMatchObject({ statut: 'etabli', montant: '110.00' });
    expect(calcB(f, 'YO')).toMatchObject({ statut: 'etabli', montant: '55.00' });
    expect(f.controles.find((c) => c.code === 'B58_YN_WI')?.statut).toBe('coherent');
    expect(f.controles.find((c) => c.code === 'B58_YO_WU')).toMatchObject({ statut: 'ecart', ecart: '5.00' });
    expect(prepB([...lignes.slice(1), ...reprises]).calculs.find((k) => k.code === 'YN')!.statut).toBe('abstention'); // ZV manquante
  });
});

describe('2059-E : mêmes calculs que le 2033-E avec les codes du régime réel normal (D-120)', () => {
  const rvE = (code: string, montant: string, s: Partial<QualificationRenvoi> = {}): QualificationRenvoi => ({ code: cleCase('E59', code), montant, ...TRACE, ...s });
  const prepE = (renvois: QualificationRenvoi[] = [], dureeMois = 12) => preparerFormulaireCases(FORMULAIRE_2059_E, { versionDonnees: 7, renvois, dureeMois });
  const T1 = ['OA', 'OK', 'OL'], T2 = ['OH', 'OE', 'OF', 'OD', 'XT'], T3 = ['ON', 'OQ', 'OR', 'OS', 'OZ', 'OW', 'OU', 'O9', 'OY'];
  it('intégrité : 25 cases, clés uniques et valides', () => {
    const codes = FORMULAIRE_2059_E.cases.map((c) => c.code);
    expect(codes).toHaveLength(25);
    expect(new Set(codes.map((c) => cleCase('E59', c))).size).toBe(25);
    for (const c of codes) expect(cleCase('E59', c)).toMatch(/^E59_[0-9A-Z]{2}$/);
  });
  it('sans saisie : totaux en abstention ; avec tout : OX, OM, OJ, OG et SA calculés ; valeur ajoutée négative : SA = 0', () => {
    expect(prepE().calculs.every((k) => k.statut === 'abstention')).toBe(true);
    const f = prepE([...T1.map((c) => rvE(c, '1000.00')), ...T2.map((c) => rvE(c, '100.00')), ...T3.map((c) => rvE(c, '200.00'))]);
    expect(f.calculs.find((k) => k.code === 'OX')).toMatchObject({ montant: '3000.00' });
    expect(f.calculs.find((k) => k.code === 'OG')).toMatchObject({ statut: 'etabli', montant: '1700.00' });
    expect(f.calculs.find((k) => k.code === 'SA')).toMatchObject({ montant: '1700.00' });
    const neg = prepE([...T1.map((c) => rvE(c, '10.00')), ...T2.map((c) => rvE(c, '0.00')), ...T3.map((c) => rvE(c, '100.00'))]);
    expect(neg.calculs.find((k) => k.code === 'OG')).toMatchObject({ montant: '-870.00' });
    expect(neg.calculs.find((k) => k.code === 'SA')).toMatchObject({ montant: '0.00' });
  });
  it('GX proposée (= OX) pour un exercice de 12 mois seulement, jamais retenue sans saisie', () => {
    const t1 = T1.map((c) => rvE(c, '100.00'));
    expect(prepE(t1).cases.find((c) => c.code === 'GX')).toMatchObject({ statut: 'a_saisir', montant: null, proposition: { montant: '300.00' } });
    expect(prepE(t1, 9).cases.find((c) => c.code === 'GX')!.proposition).toBeNull();
    expect(prepE([...t1, rvE('GX', '300.00')]).cases.find((c) => c.code === 'GX')!.proposition).toBeNull();
  });
});

describe('2058-C : rapprochements ZJ / FW et YX / FX avec le 2052 déduit de la balance (D-127)', () => {
  const rc = (code: string, montant: string): QualificationRenvoi => ({ code: cleCase('C58', code), montant, ...TRACE });
  const ZJ = ['YT', 'XQ', 'YU', 'SS', 'YV', 'ST'].map((c) => rc(c, '100.00'));
  const prepC = (renvois: QualificationRenvoi[], valeursAutres?: Record<string, string>) => preparerFormulaireCases(FORMULAIRE_2058_C, { versionDonnees: 7, renvois, ...(valeursAutres ? { valeursAutres } : {}) });
  it('ZJ égal à FW : cohérent ; différent : écart indicatif jamais corrigé ; sans valeur du 2052 ou sans ZJ : aucun contrôle', () => {
    expect(prepC(ZJ, { R52_FW: '600.00' }).controles.find((c) => c.code === 'C58_ZJ_FW')?.statut).toBe('coherent');
    const e = prepC(ZJ, { R52_FW: '650.00' });
    expect(e.controles.find((c) => c.code === 'C58_ZJ_FW')).toMatchObject({ statut: 'ecart', ecart: '-50.00' });
    expect(e.calculs.find((c) => c.code === 'ZJ')).toMatchObject({ statut: 'etabli', montant: '600.00' });
    expect(prepC(ZJ).controles.some((c) => c.code === 'C58_ZJ_FW')).toBe(false);
    expect(prepC([], { R52_FW: '600.00' }).controles.some((c) => c.code === 'C58_ZJ_FW')).toBe(false);
  });
  it('YX égal à FX', () => {
    expect(prepC([rc('YW', '30.00'), rc('9Z', '12.00')], { R52_FX: '42.00' }).controles.find((c) => c.code === 'C58_YX_FX')?.statut).toBe('coherent');
  });
});
