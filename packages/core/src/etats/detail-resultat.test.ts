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
