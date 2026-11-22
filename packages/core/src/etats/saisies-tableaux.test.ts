/** Recette des tableaux servis par saisie (D-112) : cadre III du 2033-C et tableau 2054 bis — jamais de chiffre inventé. */
import { describe, expect, it } from 'vitest';
import { piece } from '../jeux-etats-tests.js';
import { calculerBalance } from './balance.js';
import { type DemandeSaisiesTableaux, type SaisieTableau, type CadreIIIProjet, type EcartsReevaluationProjet, preparerSaisiesTableaux, validerSaisieTableau } from './saisies-tableaux.js';

const EX = { debut: '2026-01-01', fin: '2026-12-30' };
const PERIMETRE = { territoire: 'metropole', impotSurLeResultat: 'is', referentielComptable: 'PCG', devise: 'EUR', societeCommerciale: true } as const;
const TRACE = { note: 'Cession constatée au registre des immobilisations', qualifieePar: 'u-1', le: '2026-12-31T10:00:00Z', versionDonnees: 7 };
// Balance : cession d'une machine (prix 8 000 au 775, valeur nette comptable 7 500 au 675).
const balance = () => calculerBalance([...piece('2026-04-30', [['462000', '8000.00', '0.00'], ['775000', '0.00', '8000.00']], 'OD'), ...piece('2026-04-30', [['675000', '7500.00', '0.00'], ['512000', '0.00', '7500.00']], 'OD')]);
const s3 = (ligne: string, valeurs: Record<string, string>, extra: Partial<SaisieTableau> = {}): SaisieTableau => ({ tableau: '2033C_III', ligne, valeurs, ...TRACE, ...extra });
const sb = (tableau: SaisieTableau['tableau'], ligne: string, valeurs: Record<string, string>, extra: Partial<SaisieTableau> = {}): SaisieTableau => ({ tableau, ligne, valeurs, ...TRACE, ...extra });
const demande = (regime: 'reel_normal' | 'reel_simplifie', saisies: SaisieTableau[] = []): DemandeSaisiesTableaux => ({ balance: balance(), exercice: EX, regime, ...PERIMETRE, versionDonnees: 7, saisies });
const cadre3 = (saisies: SaisieTableau[] = []): CadreIIIProjet => {
  const r = preparerSaisiesTableaux(demande('reel_simplifie', saisies));
  if (r.statut !== 'projet' || r.cadreIII === null) throw new Error('cadre III attendu');
  return r.cadreIII;
};
const bis = (saisies: SaisieTableau[] = []): EcartsReevaluationProjet => {
  const r = preparerSaisiesTableaux(demande('reel_normal', saisies));
  if (r.statut !== 'projet' || r.ecartsReevaluation === null) throw new Error('2054 bis attendu');
  return r.ecartsReevaluation;
};
const CESSION = { nature: 'Machine de découpe', valeurActif: '10000.00', amortissements: '2500.00', prixCession: '8000.00', classement: 'court_terme' };

describe('périmètre', () => {
  it('le cadre III n’existe qu’au régime simplifié, le 2054 bis qu’au régime réel normal', () => {
    const rs = preparerSaisiesTableaux(demande('reel_simplifie'));
    const rn = preparerSaisiesTableaux(demande('reel_normal'));
    expect(rs.statut === 'projet' && rs.cadreIII !== null && rs.ecartsReevaluation === null).toBe(true);
    expect(rn.statut === 'projet' && rn.cadreIII === null && rn.ecartsReevaluation !== null).toBe(true);
  });
  it('hors périmètre : abstention motivée sans chiffre', () => {
    const r = preparerSaisiesTableaux({ ...demande('reel_simplifie'), territoire: 'a_confirmer' });
    expect(r.statut).toBe('abstention');
    expect(JSON.stringify(r)).not.toMatch(/"montant"/);
  });
});

describe('validation d’une saisie (forme seulement)', () => {
  it('cadre III : ligne de cession valide, puis erreurs de forme', () => {
    expect(validerSaisieTableau('2033C_III', '01', CESSION)).toEqual([]);
    expect(validerSaisieTableau('2033C_III', '01', { ...CESSION, prixCession: '8 000,00' }).join(' ')).toMatch(/prixCession/);
    expect(validerSaisieTableau('2033C_III', '01', { ...CESSION, valeurActif: '-1.00' }).join(' ')).toMatch(/positif/);
    expect(validerSaisieTableau('2033C_III', '01', { ...CESSION, classement: 'long_terme_42' }).join(' ')).toMatch(/classement/);
    expect(validerSaisieTableau('2033C_III', '01', { nature: 'x', valeurActif: '1.00' }).join(' ')).toMatch(/obligatoire/);
    expect(validerSaisieTableau('2033C_III', '01', { ...CESSION, inconnu: '1' }).join(' ')).toMatch(/inconnu/);
    expect(validerSaisieTableau('2033C_III', '11', CESSION)).toEqual([]); // ligne d’état joint
    expect(validerSaisieTableau('2033C_III', '31', CESSION).join(' ')).toMatch(/Ligne inconnue/);
  });
  it('régularisations signées, case 579 positive, néant sans valeur ; 2054 bis : colonnes positives, cadre B', () => {
    expect(validerSaisieTableau('2033C_III', 'REG', { c5: '-10.00', c6: '0.00', c7: '0.00', c8: '5.00' })).toEqual([]);
    expect(validerSaisieTableau('2033C_III', 'PV19', { montant: '-1.00' }).join(' ')).toMatch(/positif/);
    expect(validerSaisieTableau('2033C_III', 'NEANT', {})).toEqual([]);
    expect(validerSaisieTableau('2033C_III', 'NEANT', { a: '1' }).join(' ')).toMatch(/inconnu/);
    expect(validerSaisieTableau('2054BIS_A', '03', { c1: '1.00', c2: '0.00', c3: '0.00', c4: '0.00', c5: '0.00' })).toEqual([]);
    expect(validerSaisieTableau('2054BIS_A', '10', { c1: '1.00' }).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2054BIS_B', 'B1', { montant: '100.00' })).toEqual([]);
    expect(validerSaisieTableau('autre', '01', {}).join(' ')).toMatch(/Tableau inconnu/);
    expect(validerSaisieTableau('2054BIS_A', '01', 'pas un objet').join(' ')).toMatch(/objet/);
  });
});

describe('cadre III du 2033-C : plus-values et moins-values', () => {
  it('sans saisie ni néant : totaux en abstention, sans chiffre, cessions de la balance signalées', () => {
    const c = cadre3();
    expect(c.etat).toBe('a_saisir');
    expect(c.totaux.valeurActif).toMatchObject({ statut: 'abstention', codeCase: '578', etatCodeCase: 'lu_verifie' });
    expect(JSON.stringify(c.totaux)).not.toMatch(/"montant"/);
    expect(c.totalGeneral.c5.statut).toBe('abstention');
    expect(c.controles.find((x) => x.code === 'III_CESSIONS_A_DETAILLER')?.statut).toBe('non_verifie');
    expect(c.lignes.every((l) => l.statut === 'a_saisir' && l.plusOuMoinsValue === null)).toBe(true);
  });

  it('une cession : valeur résiduelle et plus-value calculées par le formulaire, placées dans la colonne choisie', () => {
    const c = cadre3([s3('01', CESSION), s3('REG', { c5: '0.00', c6: '0.00', c7: '0.00', c8: '0.00' })]);
    expect(c.etat).toBe('saisi');
    expect(c.lignes[0]).toMatchObject({ statut: 'saisi', valeurResiduelle: '7500.00', plusOuMoinsValue: '500.00', colonnePlusValue: 'c5' });
    expect(c.totaux.valeurActif).toMatchObject({ statut: 'etabli', montant: '10000.00', codeCase: '578' });
    expect(c.totaux.amortissements).toMatchObject({ montant: '2500.00', codeCase: '580' });
    expect(c.totaux.valeurResiduelle).toMatchObject({ montant: '7500.00', codeCase: '582' });
    expect(c.totaux.prixCession).toMatchObject({ montant: '8000.00', codeCase: '584' });
    expect(c.totaux.c5).toMatchObject({ montant: '500.00', codeCase: '586' });
    expect(c.totaux.c6).toMatchObject({ montant: '0.00', codeCase: '581' });
    expect(c.totalGeneral.c5).toMatchObject({ statut: 'etabli', montant: '500.00', codeCase: '596' });
    expect(c.controles.find((x) => x.code === 'III_PRIX_775')?.statut).toBe('coherent');
    expect(c.controles.find((x) => x.code === 'III_VNC_675')?.statut).toBe('coherent');
  });

  it('plusieurs cessions, moins-value négative, classements distincts, régularisations signées', () => {
    const c = cadre3([
      s3('01', CESSION),
      s3('02', { nature: 'Titres de participation', valeurActif: '1000.00', amortissements: '0.00', prixCession: '700.00', classement: 'long_terme_15_12_8' }),
      s3('03', { nature: 'Véhicule', valeurActif: '3000.00', amortissements: '3000.00', prixCession: '400.00', classement: 'long_terme_19' }),
      s3('REG', { c5: '-100.00', c6: '10.00', c7: '0.00', c8: '0.00' }),
    ]);
    expect(c.lignes[1]).toMatchObject({ plusOuMoinsValue: '-300.00', colonnePlusValue: 'c7' });
    expect(c.totaux.c5.statut === 'etabli' && c.totaux.c5.montant).toBe('500.00');
    expect(c.totaux.c7).toMatchObject({ montant: '-300.00', codeCase: '587' });
    expect(c.totaux.c6).toMatchObject({ montant: '400.00', codeCase: '581' });
    expect(c.totalGeneral.c5).toMatchObject({ montant: '400.00', codeCase: '596' }); // 500 + (−100)
    expect(c.totalGeneral.c6).toMatchObject({ montant: '410.00', codeCase: '585' });
    expect(c.totalGeneral.c7).toMatchObject({ montant: '-300.00', codeCase: '597' });
    expect(c.totalGeneral.c8).toMatchObject({ montant: '0.00', codeCase: '599' });
    expect(c.controles.find((x) => x.code === 'III_PRIX_775')?.statut).toBe('ecart'); // 8 000 + 700 + 400 ≠ 8 000
  });

  it('sans régularisation saisie : les totaux de colonnes sont établis, le TOTAL général reste en abstention', () => {
    const c = cadre3([s3('01', CESSION)]);
    expect(c.totaux.c5.statut).toBe('etabli');
    expect(c.totalGeneral.c5.statut).toBe('abstention');
    expect(JSON.stringify(c.totalGeneral.c5)).toMatch(/590, 583, 594, 595/);
    expect(c.regularisations.statut).toBe('a_saisir');
  });

  it('néant explicite : totaux à zéro établis ; néant alors que la balance porte des cessions : écart signalé, non corrigé', () => {
    const c = cadre3([s3('NEANT', {}), s3('REG', { c5: '0.00', c6: '0.00', c7: '0.00', c8: '0.00' })]);
    expect(c.etat).toBe('neant');
    expect(c.totaux.prixCession).toMatchObject({ statut: 'etabli', montant: '0.00' });
    expect(c.controles.find((x) => x.code === 'III_NEANT_CESSIONS_COMPTABILISEES')?.statut).toBe('ecart');
  });

  it('néant ET lignes : les lignes sont retenues, incohérence signalée', () => {
    const c = cadre3([s3('NEANT', {}), s3('01', CESSION)]);
    expect(c.etat).toBe('saisi');
    expect(c.controles.some((x) => x.code === 'III_NEANT_ET_LIGNES')).toBe(true);
  });

  it('saisie « à revoir » après changement des données : ne compte plus, totaux en abstention', () => {
    const c = cadre3([s3('01', CESSION, { versionDonnees: 6 })]);
    expect(c.lignes[0]).toMatchObject({ statut: 'a_revoir', plusOuMoinsValue: null });
    expect(c.etat).toBe('a_saisir');
    expect(c.totaux.prixCession.statut).toBe('abstention');
    expect(JSON.stringify(c.totaux.prixCession)).toMatch(/à revoir/);
  });

  it('amortissements supérieurs à la valeur d’actif : signalé ; décimaux exacts', () => {
    const c = cadre3([s3('01', { nature: 'Bien', valeurActif: '0.10', amortissements: '0.30', prixCession: '0.20', classement: 'court_terme' }), s3('REG', { c5: '0.00', c6: '0.00', c7: '0.00', c8: '0.00' })]);
    expect(c.lignes[0]).toMatchObject({ valeurResiduelle: '-0.20', plusOuMoinsValue: '0.40' });
    expect(c.controles.some((x) => x.code === 'III_AMORT_EXCEDE_ACTIF')).toBe(true);
  });

  it('case 579 saisie et tracée', () => {
    const c = cadre3([s3('PV19', { montant: '120.00' })]);
    expect(c.plusValues19).toMatchObject({ statut: 'saisi', montant: '120.00', codeCase: '579', trace: { qualifieePar: 'u-1' } });
  });
});

describe('2054 bis : écarts de réévaluation', () => {
  const ligneBis = (ligne: string, c: [string, string, string, string, string], extra: Partial<SaisieTableau> = {}) => sb('2054BIS_A', ligne, { c1: c[0], c2: c[1], c3: c[2], c4: c[3], c5: c[4] }, extra);

  it('sans saisie ni néant : abstention sans chiffre ; neuf lignes nommées comme le formulaire', () => {
    const t = bis();
    expect(t.etat).toBe('a_saisir');
    expect(t.lignes.map((l) => l.libelle)).toHaveLength(9);
    expect(t.lignes[2]!.libelle).toBe('Terrains');
    expect(t.totaux.c6.statut).toBe('abstention');
    expect(JSON.stringify(t.totaux)).not.toMatch(/"montant"/);
    expect(t.cadreB.b3.statut).toBe('abstention');
  });

  it('colonne 6 = (col. 1 − col. 2) − col. 5 et écart = col. 1 − col. 2 ; ligne 10 = somme des lignes saisies', () => {
    const t = bis([ligneBis('03', ['5000.00', '0.00', '100.00', '50.00', '1200.00']), ligneBis('04', ['8000.00', '3000.00', '200.00', '0.00', '2000.00'])]);
    expect(t.lignes[2]).toMatchObject({ statut: 'saisi', ecart: '5000.00', c6: '3800.00' });
    expect(t.lignes[3]).toMatchObject({ ecart: '5000.00', c6: '3000.00' });
    expect(t.totaux.c1).toMatchObject({ statut: 'etabli', montant: '13000.00' });
    expect(t.totaux.c2).toMatchObject({ montant: '3000.00' });
    expect(t.totaux.c3).toMatchObject({ montant: '300.00' });
    expect(t.totaux.c5).toMatchObject({ montant: '3200.00' });
    expect(t.totaux.c6).toMatchObject({ montant: '6800.00' });
    expect(t.lignes[0]!.statut).toBe('a_saisir'); // une ligne non saisie n'est jamais présumée nulle
  });

  it('néant explicite : totaux à zéro ; colonne 6 négative signalée ; à revoir : abstention', () => {
    expect(bis([sb('2054BIS_A', 'NEANT', {})]).totaux.c6).toMatchObject({ statut: 'etabli', montant: '0.00' });
    const neg = bis([ligneBis('01', ['100.00', '0.00', '0.00', '0.00', '150.00'])]);
    expect(neg.lignes[0]!.c6).toBe('-50.00');
    expect(neg.controles.some((x) => x.code === 'BIS_PROVISION_NEGATIVE')).toBe(true);
    const revoir = bis([ligneBis('01', ['100.00', '0.00', '0.00', '0.00', '0.00'], { versionDonnees: 5 })]);
    expect(revoir.lignes[0]!.statut).toBe('a_revoir');
    expect(revoir.totaux.c1.statut).toBe('abstention');
  });

  it('cadre B : ligne 3 = ligne 1 − ligne 2, seulement quand les deux sont saisies', () => {
    expect(bis([sb('2054BIS_B', 'B1', { montant: '900.00' })]).cadreB.b3.statut).toBe('abstention');
    const t = bis([sb('2054BIS_B', 'B1', { montant: '900.00' }), sb('2054BIS_B', 'B2', { montant: '250.50' })]);
    expect(t.cadreB.b3).toMatchObject({ statut: 'etabli', montant: '649.50' });
    expect(bis([sb('2054BIS_B', 'B1', { montant: '10.00' }), sb('2054BIS_B', 'B2', { montant: '20.00' })]).controles.some((x) => x.code === 'BIS_B3_NEGATIVE')).toBe(true);
  });
});

describe('2055 cadre B : amortissements dérogatoires (D-113)', () => {
  const lb = (ligne: string, c: [string, string, string, string, string, string], extra: Partial<SaisieTableau> = {}) => sb('2055_B', ligne, { c1: c[0], c2: c[1], c3: c[2], c4: c[3], c5: c[4], c6: c[5] }, extra);
  const derog = (saisies: SaisieTableau[] = [], bal?: ReturnType<typeof balance>) => {
    const r = preparerSaisiesTableaux({ ...demande('reel_normal', saisies), ...(bal ? { balance: bal } : {}) });
    if (r.statut !== 'projet' || r.amortissementsDerogatoires === null) throw new Error('cadre B attendu');
    return r.amortissementsDerogatoires;
  };
  const cell = (c: { statut: string; montant?: string } | null | undefined) => (c && c.statut === 'etabli' ? c.montant : c?.statut);

  it('sans saisie ni néant : treize lignes nommées, totaux et non ventilé en abstention, sans chiffre', () => {
    const t = derog();
    expect(t.etat).toBe('a_saisir');
    expect(t.lignes).toHaveLength(13);
    expect(t.lignes[0]!.colonnes.map((c) => c?.codeCase)).toEqual(['M9', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6']);
    expect(t.lignes[12]!.colonnes.map((c) => c?.codeCase ?? null)).toEqual(['NL', null, null, 'NM', null, null, 'NO']);
    expect(t.totaux.general.map((c) => c?.codeCase)).toEqual(['NP', 'NQ', 'NR', 'NS', 'NT', 'NU', 'NV']);
    expect(t.totaux.general[0]!.statut).toBe('abstention');
    expect(t.nonVentile.NZ.statut).toBe('abstention');
    expect(JSON.stringify(t.totaux)).not.toMatch(/"montant"/);
  });

  it('colonne 7 = (1 + 2 + 3) − (4 + 5 + 6) ; totaux I, II, III et général ; non ventilé NW, NY, NZ', () => {
    const t = derog([
      lb('01', ['100.00', '0.00', '0.00', '20.00', '0.00', '0.00']),
      lb('04', ['50.00', '30.00', '10.00', '5.00', '5.00', '5.00']),
      sb('2055_B', '13', { c1: '40.00', c4: '15.00' }),
    ]);
    expect(t.lignes[0]!.colonnes[6]).toEqual({ codeCase: 'N6', montant: '80.00' });
    expect(t.lignes[3]!.colonnes[6]).toEqual({ codeCase: 'Q8', montant: '75.00' }); // 90 − 15
    expect(t.lignes[12]!.colonnes[6]).toEqual({ codeCase: 'NO', montant: '25.00' });
    expect(cell(t.totaux.I[0])).toBe('100.00');
    expect(cell(t.totaux.I[6])).toBe('80.00');
    expect(cell(t.totaux.II[1])).toBe('30.00');
    expect(cell(t.totaux.III[0])).toBe('40.00');
    expect(t.totaux.III[1]).toBeNull();
    expect(cell(t.totaux.general[0])).toBe('190.00'); // 100 + 50 + 40
    expect(cell(t.totaux.general[3])).toBe('40.00'); // 20 + 5 + 15
    expect(cell(t.totaux.general[6])).toBe('180.00'); // 80 + 75 + 25
    expect(t.nonVentile.NW).toMatchObject({ statut: 'etabli', montant: '230.00', codeCase: 'NW' }); // NP + NQ + NR = 190 + 30 + 10
    expect(t.nonVentile.NY).toMatchObject({ montant: '50.00', codeCase: 'NY' }); // NS + NT + NU = 40 + 5 + 5
    expect(t.nonVentile.NZ).toMatchObject({ montant: '180.00', codeCase: 'NZ' });
    expect(t.lignes[1]!.statut).toBe('a_saisir'); // jamais présumée nulle
  });

  it('néant explicite : totaux à zéro ; néant et lignes : incohérence signalée ; à revoir : abstention', () => {
    expect(cell(derog([sb('2055_B', 'NEANT', {})]).totaux.general[6])).toBe('0.00');
    expect(derog([sb('2055_B', 'NEANT', {}), lb('01', ['1.00', '0.00', '0.00', '0.00', '0.00', '0.00'])]).controles.some((c) => c.code === 'B2055_NEANT_ET_LIGNES')).toBe(true);
    const r = derog([lb('01', ['1.00', '0.00', '0.00', '0.00', '0.00', '0.00'], { versionDonnees: 3 })]);
    expect(r.lignes[0]!.statut).toBe('a_revoir');
    expect(r.totaux.general[0]!.statut).toBe('abstention');
  });

  it('contrôles indicatifs avec la balance : comptes 6872 (dotations) et 7872 (reprises)', () => {
    const bal = calculerBalance([...piece('2026-12-30', [['687200', '100.00', '0.00'], ['145000', '0.00', '100.00']], 'OD'), ...piece('2026-12-30', [['145000', '20.00', '0.00'], ['787200', '0.00', '20.00']], 'OD')]);
    const ok = derog([lb('01', ['100.00', '0.00', '0.00', '20.00', '0.00', '0.00'])], bal);
    expect(ok.controles.find((c) => c.code === 'B2055_DOTATIONS_6872')?.statut).toBe('coherent');
    expect(ok.controles.find((c) => c.code === 'B2055_REPRISES_7872')?.statut).toBe('coherent');
    const ko = derog([lb('01', ['90.00', '0.00', '0.00', '20.00', '0.00', '0.00'])], bal);
    expect(ko.controles.find((c) => c.code === 'B2055_DOTATIONS_6872')).toMatchObject({ statut: 'ecart', ecart: '10.00' });
  });

  it('validation de forme : colonnes 1 à 6 positives, ligne 13 colonnes 1 et 4 seulement', () => {
    expect(validerSaisieTableau('2055_B', '04', { c1: '1.00', c2: '0.00', c3: '0.00', c4: '0.00', c5: '0.00', c6: '0.00' })).toEqual([]);
    expect(validerSaisieTableau('2055_B', '04', { c1: '1.00' }).join(' ')).toMatch(/obligatoire/);
    expect(validerSaisieTableau('2055_B', '13', { c1: '1.00', c4: '0.00' })).toEqual([]);
    expect(validerSaisieTableau('2055_B', '13', { c1: '1.00', c4: '0.00', c2: '1.00' }).join(' ')).toMatch(/inconnu/);
    expect(validerSaisieTableau('2055_B', '14', {}).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2055_B', '01', { c1: '-1.00', c2: '0', c3: '0.00', c4: '0.00', c5: '0.00', c6: '0.00' }).join(' ')).toMatch(/c1/);
  });
});

describe('2055 cadre C : charges réparties sur plusieurs exercices (D-113)', () => {
  const lc = (ligne: string, debut: string, augmentations: string, dotations: string, extra: Partial<SaisieTableau> = {}) => sb('2055_C', ligne, { debut, augmentations, dotations }, extra);
  const repart = (saisies: SaisieTableau[] = [], bal?: ReturnType<typeof balance>) => {
    const r = preparerSaisiesTableaux({ ...demande('reel_normal', saisies), ...(bal ? { balance: bal } : {}) });
    if (r.statut !== 'projet' || r.chargesRepartiesPlusieursExercices === null) throw new Error('cadre C attendu');
    return r.chargesRepartiesPlusieursExercices;
  };

  it('sans saisie : deux lignes à saisir, aucune présumée nulle ; colonne 4 = 1 + 2 − 3 (Z8, SR), dotations Z9, SP', () => {
    const t = repart();
    expect(t.etat).toBe('a_saisir');
    expect(t.lignes.map((l) => [l.ligne, l.caseDotations, l.caseFin, l.fin])).toEqual([['01', 'Z9', 'Z8', null], ['02', 'SP', 'SR', null]]);
    const r = repart([lc('01', '1000.00', '500.00', '300.00'), lc('02', '0.00', '0.00', '0.00')]);
    expect(r.lignes[0]).toMatchObject({ statut: 'saisi', fin: '1200.00' });
    expect(r.lignes[1]).toMatchObject({ fin: '0.00' });
  });

  it('contrôle indicatif avec les comptes 481 et 169 ; fin négative signalée ; néant avec solde en balance signalé', () => {
    const bal = calculerBalance(piece('2026-01-01', [['481600', '1200.00', '0.00'], ['101000', '0.00', '1200.00']], 'AN'));
    expect(repart([lc('01', '1000.00', '500.00', '300.00')], bal).controles.find((c) => c.code === 'C2055_COMPTE_481')?.statut).toBe('coherent');
    expect(repart([lc('01', '1000.00', '0.00', '300.00')], bal).controles.find((c) => c.code === 'C2055_COMPTE_481')).toMatchObject({ statut: 'ecart', ecart: '500.00' });
    expect(repart([lc('01', '100.00', '0.00', '300.00')]).controles.some((c) => c.code === 'C2055_FIN_NEGATIVE_01')).toBe(true);
    expect(repart([sb('2055_C', 'NEANT', {})], bal).controles.some((c) => c.code === 'C2055_NEANT_COMPTE_481')).toBe(true);
  });

  it('à revoir : la ligne ne compte plus ; validation de forme', () => {
    expect(repart([lc('01', '1.00', '0.00', '0.00', { versionDonnees: 2 })]).lignes[0]).toMatchObject({ statut: 'a_revoir', fin: null });
    expect(validerSaisieTableau('2055_C', '01', { debut: '1.00', augmentations: '0.00', dotations: '0.00' })).toEqual([]);
    expect(validerSaisieTableau('2055_C', '03', {}).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2055_C', '01', { debut: '1.00', augmentations: 'x', dotations: '0.00' }).join(' ')).toMatch(/augmentations/);
  });
});
