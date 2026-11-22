/** Recette du détail du compte de résultat (2052 France / exportations, 2053 exceptionnel, renvois) — D-106 : jamais de chiffre déduit sans qualification. */
import { describe, expect, it } from 'vitest';
import { piece } from '../jeux-etats-tests.js';
import { calculerBalance } from './balance.js';
import { type DemandeDetailResultat, type DetailResultatProjet, type QualificationRenvoi, type QualificationVentilation, preparerDetailResultat } from './detail-resultat.js';

const EX = { debut: '2026-01-01', fin: '2026-12-30' };
const PERIMETRE = { territoire: 'metropole', impotSurLeResultat: 'is', referentielComptable: 'PCG', devise: 'EUR', societeCommerciale: true } as const;
const TRACE = { note: 'Ventilation d’après les factures de l’exercice (fichier ventes).', qualifieePar: 'u-1', le: '2026-12-31T10:00:00Z', versionDonnees: 7 };

const lignes = () => [
  ...piece('2026-03-01', [['411000', '12000.00', '0.00'], ['707100', '0.00', '5000.00'], ['707200', '0.00', '1000.00'], ['701100', '0.00', '4000.00'], ['706000', '0.00', '2000.00']], 'VT'),
  ...piece('2026-03-02', [['709700', '200.00', '0.00'], ['411000', '0.00', '200.00']], 'VT'),
  ...piece('2026-06-30', [['671200', '300.00', '0.00'], ['675000', '1500.00', '0.00'], ['512000', '0.00', '1800.00']], 'OD'),
  ...piece('2026-06-30', [['775000', '0.00', '800.00'], ['777000', '0.00', '100.00'], ['512000', '900.00', '0.00']], 'OD'),
  ...piece('2026-07-01', [['612200', '2400.00', '0.00'], ['671300', '150.00', '0.00'], ['512000', '0.00', '2550.00']], 'AC'),
];
const qv = (compte: string, france: string, exportation: string, surcharge: Partial<QualificationVentilation> = {}): QualificationVentilation => ({ compte, montantFrance: france, montantExport: exportation, ...TRACE, ...surcharge });
const demande = (s: Partial<DemandeDetailResultat> = {}): DemandeDetailResultat => ({
  balance: calculerBalance(lignes()),
  exercice: EX,
  regime: 'reel_normal',
  ...PERIMETRE,
  versionDonnees: 7,
  ventilations: [],
  renvois: [],
  ...s,
});
const projet = (d: DemandeDetailResultat): DetailResultatProjet => {
  const r = preparerDetailResultat(d);
  if (r.statut !== 'projet') throw new Error(`Projet attendu : ${r.motifs.map((m) => m.code).join(', ')}`);
  return r;
};
const ligneCA = (p: DetailResultatProjet, id: string) => p.ventilationChiffreAffaires.lignes.find((l) => l.id === id)!;

describe('2052 : ventilation du chiffre d’affaires', () => {
  it('sans qualification : les totaux viennent de la balance, France et exportations en abstention motivée, sans aucun chiffre', () => {
    const p = projet(demande());
    expect(p.statut).toBe('projet');
    expect(p.complet).toBe(false);
    // Marchandises : 707100 (5 000) + 707200 (1 000) - 709700 (200) = 5 800 ; biens : 4 000 ; services : 2 000.
    expect(ligneCA(p, 'MARCHANDISES').total).toMatchObject({ statut: 'etabli', montant: '5800.00', codeCase: 'FC', etatCodeCase: 'lu_verifie' });
    expect(ligneCA(p, 'BIENS').total).toMatchObject({ statut: 'etabli', montant: '4000.00', codeCase: 'FF' });
    expect(ligneCA(p, 'SERVICES').total).toMatchObject({ statut: 'etabli', montant: '2000.00', codeCase: 'FI' });
    expect(p.ventilationChiffreAffaires.chiffreAffairesNet!.total).toMatchObject({ statut: 'etabli', montant: '11800.00', codeCase: 'FL' });
    for (const l of p.ventilationChiffreAffaires.lignes) {
      expect(l.france).toMatchObject({ statut: 'abstention', etatCodeCase: 'lu_verifie' });
      expect(l.export.statut).toBe('abstention');
      expect(JSON.stringify(l.france)).not.toMatch(/montant/);
      expect(l.qualifiee).toBe(false);
    }
    expect(p.ventilationChiffreAffaires.chiffreAffairesNet!.france.statut).toBe('abstention');
    expect(p.ventilationChiffreAffaires.nbComptesAQualifier).toBe(5);
    expect(ligneCA(p, 'MARCHANDISES').comptes.map((c) => [c.compteNum, c.etat])).toEqual([['707100', 'a_qualifier'], ['707200', 'a_qualifier'], ['709700', 'a_qualifier']]);
  });

  it('qualification complète : France + exportations égalent le solde de chaque compte ; lignes et total net établis', () => {
    const p = projet(demande({ ventilations: [qv('707100', '5000.00', '0.00'), qv('707200', '0.00', '1000.00'), qv('709700', '-200.00', '0.00'), qv('701100', '3000.00', '1000.00'), qv('706000', '2000.00', '0.00')] }));
    expect(ligneCA(p, 'MARCHANDISES').france).toMatchObject({ statut: 'etabli', montant: '4800.00', codeCase: 'FA' });
    expect(ligneCA(p, 'MARCHANDISES').export).toMatchObject({ statut: 'etabli', montant: '1000.00', codeCase: 'FB' });
    expect(ligneCA(p, 'BIENS').france).toMatchObject({ montant: '3000.00' });
    expect(ligneCA(p, 'BIENS').export).toMatchObject({ montant: '1000.00' });
    expect(ligneCA(p, 'SERVICES').export).toMatchObject({ montant: '0.00' });
    const net = p.ventilationChiffreAffaires.chiffreAffairesNet!;
    expect(net.france).toMatchObject({ statut: 'etabli', montant: '9800.00', codeCase: 'FJ' });
    expect(net.export).toMatchObject({ statut: 'etabli', montant: '2000.00', codeCase: 'FK' });
    expect(p.ventilationChiffreAffaires.complete).toBe(true);
    expect(p.controles.find((c) => c.code === 'CA_FRANCE_EXPORT')?.statut).toBe('coherent');
    expect(p.complet).toBe(false);
  });

  it('une ligne qualifiée n’en débloque pas une autre ; le net reste en abstention tant qu’une ligne l’est', () => {
    const p = projet(demande({ ventilations: [qv('706000', '2000.00', '0.00')] }));
    expect(ligneCA(p, 'SERVICES').france.statut).toBe('etabli');
    expect(ligneCA(p, 'BIENS').france.statut).toBe('abstention');
    expect(p.ventilationChiffreAffaires.chiffreAffairesNet!.france.statut).toBe('abstention');
    expect(p.ventilationChiffreAffaires.nbComptesAQualifier).toBe(4);
  });

  it('une somme qui n’égale pas le solde du compte est un écart : non retenue, écart affiché, jamais corrigé', () => {
    const p = projet(demande({ ventilations: [qv('706000', '1500.00', '0.00')] }));
    const c = ligneCA(p, 'SERVICES').comptes[0]!;
    expect(c).toMatchObject({ etat: 'ecart', ecart: '500.00' });
    expect(ligneCA(p, 'SERVICES').france.statut).toBe('abstention');
  });

  it('une qualification donnée sur une autre version des données est « à revoir » et ne compte plus', () => {
    const p = projet(demande({ ventilations: [qv('706000', '2000.00', '0.00', { versionDonnees: 6 })] }));
    expect(ligneCA(p, 'SERVICES').comptes[0]!.etat).toBe('a_revoir');
    expect(ligneCA(p, 'SERVICES').france.statut).toBe('abstention');
  });

  it('une qualification sur un compte inexistant ou hors chiffre d’affaires est signalée et ignorée', () => {
    const p = projet(demande({ ventilations: [qv('707999', '10.00', '0.00'), qv('411000', '1.00', '0.00')] }));
    expect(p.ventilationChiffreAffaires.qualificationsOrphelines.map((o) => o.compte).sort()).toEqual(['411000', '707999']);
  });

  it('un compte de la classe 70 sans ligne certaine est listé et rend l’état incomplet, sans entrer dans les totaux', () => {
    const l = [...lignes(), ...piece('2026-09-01', [['700000', '0.00', '300.00'], ['411000', '300.00', '0.00']], 'VT')];
    const p = projet(demande({ balance: calculerBalance(l), ventilations: [qv('707100', '5000.00', '0.00'), qv('707200', '0.00', '1000.00'), qv('709700', '-200.00', '0.00'), qv('701100', '4000.00', '0.00'), qv('706000', '2000.00', '0.00')] }));
    expect(p.ventilationChiffreAffaires.comptesNonAffectes).toMatchObject([{ compteNum: '700000', solde: '300.00' }]);
    expect(p.ventilationChiffreAffaires.complete).toBe(false);
    expect(p.ventilationChiffreAffaires.chiffreAffairesNet!.total).toMatchObject({ montant: '11800.00' });
    expect(p.controles.find((c) => c.code === 'CA_COMPTES_70')).toMatchObject({ statut: 'ecart', ecart: '300.00' });
  });

  it('les montants se calculent en décimal exact (pas de flottant)', () => {
    const l = piece('2026-03-01', [['411000', '0.30', '0.00'], ['706000', '0.00', '0.10'], ['706100', '0.00', '0.20']], 'VT');
    const p = projet(demande({ balance: calculerBalance(l), ventilations: [qv('706000', '0.10', '0.00'), qv('706100', '0.00', '0.20')] }));
    expect(ligneCA(p, 'SERVICES').total).toMatchObject({ montant: '0.30' });
    expect(ligneCA(p, 'SERVICES').france).toMatchObject({ montant: '0.10' });
    expect(ligneCA(p, 'SERVICES').export).toMatchObject({ montant: '0.20' });
  });
});

describe('2053 : détail des produits et charges exceptionnels', () => {
  it('liste les comptes 67/687 et 77/787 de la balance, avec totaux, sans interpréter les libellés', () => {
    const e = projet(demande()).detailExceptionnel!;
    expect(e.charges.map((c) => [c.compteNum, c.montant])).toEqual([['671200', '300.00'], ['671300', '150.00'], ['675000', '1500.00']]);
    expect(e.produits.map((c) => [c.compteNum, c.montant])).toEqual([['775000', '800.00'], ['777000', '100.00']]);
    expect(e.totalCharges).toBe('1950.00');
    expect(e.totalProduits).toBe('900.00');
    expect(e.resultatExceptionnel).toBe('-1050.00');
  });
});

describe('renvois : saisie tracée, proposition de la balance jamais retenue d’office', () => {
  const rv = (code: string, montant: string, s: Partial<QualificationRenvoi> = {}): QualificationRenvoi => ({ code, montant, ...TRACE, ...s });

  it('sans saisie : tout est « à saisir », aucun montant ; la balance propose seulement quand un compte du PCG le désigne', () => {
    const r = projet(demande()).renvois;
    expect(r.every((x) => x.statut === 'a_saisir' && x.montant === null && x.saisie === null)).toBe(true);
    expect(r.find((x) => x.code === 'HP')?.proposition).toMatchObject({ montant: '2400.00', comptes: ['612200'] });
    expect(r.find((x) => x.code === 'HX')?.proposition).toMatchObject({ montant: '150.00', comptes: ['671300'] });
    expect(r.find((x) => x.code === 'HQ')?.proposition).toBeNull();
    expect(r.find((x) => x.code === '1G')?.proposition).toBeNull();
    expect(r.every((x) => x.etatCodeCase === 'lu_verifie')).toBe(true);
  });

  it('une saisie est retenue avec sa trace ; la proposition reste distincte', () => {
    const r = projet(demande({ renvois: [rv('HP', '2000.00')] })).renvois.find((x) => x.code === 'HP')!;
    expect(r).toMatchObject({ statut: 'saisi', montant: '2000.00', saisie: { qualifieePar: 'u-1', versionDonnees: 7 }, proposition: { montant: '2400.00' } });
  });

  it('une saisie sur une autre version des données est « à revoir » : montant non retenu', () => {
    const r = projet(demande({ renvois: [rv('HP', '2000.00', { versionDonnees: 3 })] })).renvois.find((x) => x.code === 'HP')!;
    expect(r).toMatchObject({ statut: 'a_revoir', montant: null });
  });

  it('les renvois non préparés sont dits', () => {
    expect(projet(demande()).renvoisNonPrepares.join(' ')).toMatch(/exploitants individuels/);
  });
});

describe('régime simplifié — tableau 2033-B : « dont export » (209, 215, 217), total (210, 214, 218), renvois (D-107)', () => {
  const rsi = (s: Partial<DemandeDetailResultat> = {}) => projet(demande({ regime: 'reel_simplifie', ...s }));

  it('sans qualification : totaux de la balance avec leurs cases, « dont export » en abstention, aucune part France ni net ni détail exceptionnel', () => {
    const p = rsi();
    expect(p.regime).toBe('reel_simplifie');
    expect(ligneCA(p, 'MARCHANDISES').total).toMatchObject({ statut: 'etabli', montant: '5800.00', codeCase: '210', etatCodeCase: 'lu_verifie' });
    expect(ligneCA(p, 'BIENS').total).toMatchObject({ montant: '4000.00', codeCase: '214' });
    expect(ligneCA(p, 'SERVICES').total).toMatchObject({ montant: '2000.00', codeCase: '218' });
    expect(ligneCA(p, 'MARCHANDISES').export).toMatchObject({ statut: 'abstention', codeCase: '209' });
    expect(ligneCA(p, 'BIENS').export).toMatchObject({ statut: 'abstention', codeCase: '215' });
    expect(ligneCA(p, 'SERVICES').export).toMatchObject({ statut: 'abstention', codeCase: '217' });
    expect(JSON.stringify(ligneCA(p, 'BIENS').export)).not.toMatch(/montant/);
    expect(ligneCA(p, 'BIENS').france.codeCase).toBeNull();
    expect(p.ventilationChiffreAffaires.chiffreAffairesNet).toBeNull();
    expect(p.detailExceptionnel).toBeNull();
    expect(p.controles.some((c) => c.code === 'EXCEPTIONNEL_RESULTAT')).toBe(false);
  });

  it('qualification complète : « dont export » établi par ligne avec la même saisie que la liasse du régime normal', () => {
    const p = rsi({ ventilations: [qv('707100', '5000.00', '0.00'), qv('707200', '0.00', '1000.00'), qv('709700', '-200.00', '0.00'), qv('701100', '3000.00', '1000.00'), qv('706000', '2000.00', '0.00')] });
    expect(ligneCA(p, 'MARCHANDISES').export).toMatchObject({ statut: 'etabli', montant: '1000.00', codeCase: '209' });
    expect(ligneCA(p, 'BIENS').export).toMatchObject({ montant: '1000.00', codeCase: '215' });
    expect(ligneCA(p, 'SERVICES').export).toMatchObject({ montant: '0.00', codeCase: '217' });
    expect(p.ventilationChiffreAffaires.complete).toBe(true);
  });

  it('renvois du 2033-B : cases lues et vérifiées, propositions de la balance pour le crédit-bail seul, aucun code pour les pointillés', () => {
    const r = rsi().renvois;
    expect(r.map((x) => x.code)).toEqual(['CB_MOB', 'CB_IMM', '243', '255', '259', '260', '347', '348']);
    expect(r.every((x) => x.tableau === '2033-B' && x.statut === 'a_saisir' && x.montant === null && x.etatCodeCase === 'lu_verifie')).toBe(true);
    expect(r.find((x) => x.code === 'CB_MOB')).toMatchObject({ codeCase: null, proposition: { montant: '2400.00', comptes: ['612200'] } });
    expect(r.find((x) => x.code === 'CB_IMM')?.proposition).toBeNull();
    expect(r.find((x) => x.code === '347')).toMatchObject({ codeCase: '347', proposition: null });
    expect(rsi().renvoisNonPrepares.join(' ')).toMatch(/résultat fiscal/);
  });

  it('une saisie de renvoi 2033-B est retenue avec sa trace, puis « à revoir » si les données changent', () => {
    const rv = (montant: string, versionDonnees: number) => ({ code: '255', montant, ...TRACE, versionDonnees });
    expect(rsi({ renvois: [rv('1200.00', 7)] }).renvois.find((x) => x.code === '255')).toMatchObject({ statut: 'saisi', montant: '1200.00', saisie: { qualifieePar: 'u-1' } });
    expect(rsi({ renvois: [rv('1200.00', 6)] }).renvois.find((x) => x.code === '255')).toMatchObject({ statut: 'a_revoir', montant: null });
  });
});

describe('périmètre : abstention motivée, sans chiffre', () => {
  it.each([
    ['territoire à confirmer', { territoire: 'a_confirmer' as const }, 'territoire_a_confirmer'],
    ['hors IS', { impotSurLeResultat: 'ir' as never }, 'impot_hors_perimetre'],
    ['forme non renseignée', { societeCommerciale: null }, 'forme_a_confirmer'],
  ])('%s', (_nom, surcharge, code) => {
    const r = preparerDetailResultat(demande(surcharge));
    expect(r.statut).toBe('abstention');
    if (r.statut === 'abstention') expect(r.motifs.map((m) => m.code)).toContain(code);
    expect(JSON.stringify(r)).not.toMatch(/montant/);
  });
});

describe('2033-B, partie B « Résultat fiscal » (D-110) : saisie justifiée, néant explicite, abstention, aucune décision inventée', () => {
  // Résultat comptable de la balance d'essai : produits 11 800 + 800 − charges (2 400 + 300 + 1 500 + 150) = 8 250 + ... voir resultatComptable fourni explicitement.
  const rf = (cle: string, montant: string, s: Partial<QualificationRenvoi> = {}): QualificationRenvoi => ({ code: cle, montant, ...TRACE, ...s });
  const AVANT = ['316', '318', '322', '324', '330', '342', '350'].map((c) => rf(`RF_${c}`, '0.00'));
  const demandeRf = (resultatComptable: string | null, renvois: QualificationRenvoi[]) => demande({ regime: 'reel_simplifie', resultatComptable, renvois });
  const pf = (d: DemandeDetailResultat) => projet(d).resultatFiscal!;

  it('absent au régime réel normal ; présent au régime simplifié', () => {
    expect(projet(demande()).resultatFiscal).toBeNull();
    expect(pf(demandeRf('1000.00', [])).lignes.map((l) => l.codeCase)).toEqual(['316', '318', '322', '324', '330', '342', '350', '356', '360']);
  });

  it('sans aucune saisie : abstention explicite, rien n’est présumé nul, le motif liste les cases manquantes', () => {
    const r = pf(demandeRf('1000.00', []));
    expect(r.resultatComptable).toMatchObject({ statut: 'etabli', sens: 'benefice', montant: '1000.00', codeCase: '312' });
    expect(r.avantImputation).toMatchObject({ statut: 'abstention', codesCases: ['352', '354'] });
    expect(JSON.stringify(r.avantImputation)).toMatch(/316, 318, 322, 324, 330, 342, 350/);
    expect(JSON.stringify(r.avantImputation)).not.toMatch(/"montant"/);
    expect(r.apresImputation.statut).toBe('abstention');
    expect(r.lignes.every((l) => l.statut === 'a_saisir' && l.montant === null && !l.neant)).toBe(true);
    expect(r.lignesManquantes).toHaveLength(7);
  });

  it('un « néant » explicite (0,00 saisi) est distinct d’une case non renseignée ; la saisie est retenue avec sa trace', () => {
    const r = pf(demandeRf('1000.00', [...AVANT, rf('RF_316', '0.00')]));
    expect(r.lignes.find((l) => l.cle === 'RF_316')).toMatchObject({ statut: 'saisi', neant: true, montant: '0.00', saisie: { qualifieePar: 'u-1', versionDonnees: 7 } });
    expect(r.lignes.find((l) => l.cle === 'RF_356')).toMatchObject({ statut: 'a_saisir', neant: false });
    expect(r.avantImputation).toMatchObject({ statut: 'etabli', sens: 'benefice', montant: '1000.00', codeCase: '352' });
  });

  it('bénéfice fiscal = résultat comptable + réintégrations − déductions saisies (cases 352) ; après imputation saisie (370)', () => {
    const r = pf(demandeRf('1000.00', [...AVANT.filter((x) => !['RF_316', 'RF_324', 'RF_342'].includes(x.code)), rf('RF_316', '200.50'), rf('RF_324', '99.50'), rf('RF_342', '300.00'), rf('RF_356', '0.00'), rf('RF_360', '400.00')]));
    expect(r.avantImputation).toMatchObject({ statut: 'etabli', sens: 'benefice', montant: '1000.00', codeCase: '352' });
    expect(r.plafondImputation?.montant).toBe('1000.00'); // plafond 1 000 000 > bénéfice : borné au bénéfice
    expect(r.apresImputation).toMatchObject({ statut: 'etabli', sens: 'benefice', montant: '600.00', codeCase: '370' });
  });

  it('déficit fiscal (case 354) quand les déductions excèdent le résultat comptable plus les réintégrations ; aucune imputation possible', () => {
    const r = pf(demandeRf('100.00', [...AVANT.filter((x) => x.code !== 'RF_350'), rf('RF_350', '350.00'), rf('RF_356', '0.00'), rf('RF_360', '0.00')]));
    expect(r.avantImputation).toMatchObject({ statut: 'etabli', sens: 'deficit', montant: '250.00', codeCase: '354' });
    expect(r.plafondImputation).toBeNull();
    expect(r.apresImputation).toMatchObject({ statut: 'etabli', sens: 'deficit', montant: '250.00', codeCase: '372' });
    const avecImputes = pf(demandeRf('100.00', [...AVANT.filter((x) => x.code !== 'RF_350'), rf('RF_350', '350.00'), rf('RF_356', '0.00'), rf('RF_360', '10.00')]));
    expect(avecImputes.apresImputation.statut).toBe('abstention');
    expect(avecImputes.controles.find((c) => c.code === 'RF_IMPUTATION')?.statut).toBe('ecart');
  });

  it('plafond d’imputation : 1 000 000 € majoré de 50 % du bénéfice excédant ; une imputation au-delà est refusée avec l’écart', () => {
    const base = [...AVANT, rf('RF_356', '0.00')];
    const r = pf(demandeRf('3000000.00', [...base, rf('RF_360', '2000000.00')]));
    expect(r.plafondImputation?.montant).toBe('2000000.00'); // 1 000 000 + 50 % × 2 000 000
    expect(r.apresImputation).toMatchObject({ statut: 'etabli', montant: '1000000.00', codeCase: '370' });
    const trop = pf(demandeRf('3000000.00', [...base, rf('RF_360', '2000000.01')]));
    expect(trop.apresImputation.statut).toBe('abstention');
    expect(trop.controles.find((c) => c.code === 'RF_IMPUTATION')).toMatchObject({ statut: 'ecart', ecart: '0.01' });
  });

  it('un déficit reporté en arrière (356 > 0) : l’effet sur le résultat après imputation n’est pas établi, abstention', () => {
    const r = pf(demandeRf('1000.00', [...AVANT, rf('RF_356', '500.00'), rf('RF_360', '0.00')]));
    expect(r.avantImputation.statut).toBe('etabli');
    expect(r.apresImputation.statut).toBe('abstention');
    expect(JSON.stringify(r.apresImputation)).toMatch(/report(é)? en arrière/);
  });

  it('une saisie donnée sur une autre version des données est « à revoir » et ne compte plus : abstention', () => {
    const r = pf(demandeRf('1000.00', [...AVANT.filter((x) => x.code !== 'RF_330'), rf('RF_330', '0.00', { versionDonnees: 6 })]));
    expect(r.lignes.find((l) => l.cle === 'RF_330')).toMatchObject({ statut: 'a_revoir', montant: null });
    expect(r.avantImputation.statut).toBe('abstention');
  });

  it('résultat comptable absent (liasse en abstention) : aucun résultat fiscal', () => {
    const r = pf(demandeRf(null, AVANT));
    expect(r.resultatComptable.statut).toBe('abstention');
    expect(r.avantImputation.statut).toBe('abstention');
  });

  it('un montant négatif saisi est refusé par le moteur (écart, abstention)', () => {
    const r = pf(demandeRf('1000.00', [...AVANT.filter((x) => x.code !== 'RF_316'), rf('RF_316', '-5.00')]));
    expect(r.avantImputation.statut).toBe('abstention');
    expect(r.controles.some((c) => c.code === 'RF_NEGATIF_316' && c.statut === 'ecart')).toBe(true);
  });

  it('décimaux exacts : 0,1 + 0,2 réintégrés à un résultat de 0,00', () => {
    const r = pf(demandeRf('0.00', [...AVANT.filter((x) => !['RF_316', 'RF_318'].includes(x.code)), rf('RF_316', '0.10'), rf('RF_318', '0.20')]));
    expect(r.avantImputation).toMatchObject({ statut: 'etabli', montant: '0.30' });
  });

  describe('détail des totaux 330, 342 et 350 (D-111) : saisies justifiées, contrôle indicatif, jamais de correction du total', () => {
    const base = [...AVANT.filter((x) => !['RF_330', 'RF_342'].includes(x.code))];
    const detail = (r: ReturnType<typeof pf>, cle: string) => r.lignes.flatMap((l) => l.detail).find((x) => x.cle === cle)!;
    const ligne = (r: ReturnType<typeof pf>, cle: string) => r.lignes.find((l) => l.cle === cle)!;

    it('chaque total porte ses cases de détail, sans saisie au départ ; contrôle indicatif non vérifiable', () => {
      const r = pf(demandeRf('1000.00', []));
      expect(ligne(r, 'RF_330').detail.map((x) => x.codeCase)).toEqual(['247', '248', '251', '249']);
      expect(ligne(r, 'RF_342').detail.map((x) => x.codeCase)).toEqual(['986', '987', '989', '127', '138', '991', '181', '345', '344', '992', '993']);
      expect(ligne(r, 'RF_350').detail.map((x) => x.codeCase)).toEqual(['346', '655', '643', '645', '647', '648', '641', '990', '649']);
      expect(ligne(r, 'RF_316').detail).toEqual([]);
      expect(ligne(r, 'RF_330').detail.every((x) => x.statut === 'a_saisir' && x.montant === null && x.etatCodeCase === 'lu_verifie')).toBe(true);
      expect(ligne(r, 'RF_330').controleDetail?.statut).toBe('non_verifie');
    });

    it('détail saisi et égal au total : contrôle cohérent ; la case 248 peut être négative ; la case 249 n’est pas additionnée', () => {
      const r = pf(demandeRf('1000.00', [...base, rf('RF_330', '300.00'), rf('RF_342', '0.00'), rf('RF_247', '200.00'), rf('RF_248', '-50.00'), rf('RF_251', '150.00'), rf('RF_249', '999.00')]));
      expect(detail(r, 'RF_248')).toMatchObject({ statut: 'saisi', montant: '-50.00', negatifPossible: true });
      expect(detail(r, 'RF_249')).toMatchObject({ additionne: false, montant: '999.00' });
      expect(ligne(r, 'RF_330').controleDetail).toMatchObject({ statut: 'coherent' });
      // Le résultat fiscal repose sur le TOTAL saisi, jamais sur le détail.
      expect(r.avantImputation).toMatchObject({ statut: 'etabli', montant: '1300.00' });
    });

    it('détail différent du total : écart affiché, total retenu inchangé', () => {
      const r = pf(demandeRf('1000.00', [...base, rf('RF_330', '300.00'), rf('RF_342', '0.00'), rf('RF_247', '200.00'), rf('RF_248', '0.00'), rf('RF_251', '0.00')]));
      expect(ligne(r, 'RF_330').controleDetail).toMatchObject({ statut: 'ecart', ecart: '100.00' });
      expect(ligne(r, 'RF_330').montant).toBe('300.00');
      expect(r.avantImputation).toMatchObject({ montant: '1300.00' });
    });

    it('détail incomplet : contrôle non vérifiable, rien n’est présumé nul ; un détail sans total saisi n’est pas rapproché', () => {
      const r = pf(demandeRf('1000.00', [...base, rf('RF_330', '300.00'), rf('RF_342', '0.00'), rf('RF_247', '300.00')]));
      expect(ligne(r, 'RF_330').controleDetail).toMatchObject({ statut: 'non_verifie' });
      expect(ligne(r, 'RF_330').controleDetail?.message).toMatch(/248, 251/);
      const sansTotal = pf(demandeRf('1000.00', [rf('RF_247', '300.00')]));
      expect(ligne(sansTotal, 'RF_330').controleDetail?.message).toMatch(/total de la case 330 n’est pas saisi/);
    });

    it('détail saisi sur une autre version des données : « à revoir », non retenu', () => {
      const r = pf(demandeRf('1000.00', [rf('RF_986', '10.00', { versionDonnees: 3 })]));
      expect(detail(r, 'RF_986')).toMatchObject({ statut: 'a_revoir', montant: null });
    });
  });
});
