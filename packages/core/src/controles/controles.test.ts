import { describe, expect, it } from 'vitest';
import { EXERCICE_2025, ecriture, ligne } from '../aides-tests.js';
import { CATALOGUE_CONTROLES, executerControles, genererCatalogueMarkdown } from './catalogue.js';
import type { LigneEcriture, ResultatControle } from './types.js';

function un(id: string, lignes: LigneEcriture[], parametres?: Record<string, unknown>, exercice: { debut: string; fin: string } | null = EXERCICE_2025): ResultatControle {
  const r = executerControles({ lignes, exercice }, { ids: [id], ...(parametres ? { parametres: { [id]: parametres } } : {}) });
  expect(r).toHaveLength(1);
  return r[0]!;
}

describe('catalogue', () => {
  it('contient les 12 contrôles prioritaires et les 7 contrôles du lot 2, tous documentés et sourcés', () => {
    expect(CATALOGUE_CONTROLES.map((d) => d.id)).toEqual([
      'GEN-001', 'GEN-002', 'GEN-003', 'GEN-004', 'GEN-005', 'TRE-001', 'TRE-002', 'TIE-001', 'TIE-002', 'TIE-003', 'CAP-001', 'TVA-001',
      'TRE-003', 'IMM-001', 'IMM-002', 'SOC-001', 'CLO-001', 'CLO-002', 'TVA-002',
    ]);
    for (const d of CATALOGUE_CONTROLES) {
      for (const texte of [d.titre, d.objectif, d.perimetre, d.logique, d.exceptions, d.resultatsAttendus, d.source.reference]) expect(texte.length).toBeGreaterThan(10);
      expect(d.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(d.donneesObligatoires.length).toBeGreaterThan(0);
      expect(d.schemaParametres.safeParse(d.parametresParDefaut).success).toBe(true);
      if (d.source.type === 'reglementaire') {
        expect(d.source).toMatchObject({ verification: 'verifiee', dateVerification: '2026-11-19' });
        expect(d.source.url).toMatch(/^https:\/\/(www\.legifrance\.gouv\.fr|www\.anc\.gouv\.fr|bofip\.impots\.gouv\.fr)\//);
        expect(d.source.periodeApplication).toBeTruthy();
      } else {
        expect(d.source).toMatchObject({ verification: 'sans_objet', url: null });
      }
    }
    const types = Object.fromEntries(CATALOGUE_CONTROLES.map((d) => [d.id, d.source.type]));
    expect(types).toMatchObject({ 'GEN-002': 'interne', 'TIE-003': 'interne', 'TVA-001': 'interne', 'GEN-005': 'reglementaire', 'TRE-001': 'reglementaire', 'CAP-001': 'reglementaire' });
  });

  it('genererCatalogueMarkdown documente chaque contrôle', () => {
    const md = genererCatalogueMarkdown();
    for (const d of CATALOGUE_CONTROLES) {
      expect(md).toContain(`## ${d.id} — ${d.titre}`);
      expect(md).toContain(d.logique);
    }
    for (const rubrique of ['**Objectif**', '**Périmètre**', '**Données obligatoires**', '**Logique**', '**Exceptions et limites**', '**Paramètres', '**Source**', '**Version**']) expect(md).toContain(rubrique);
    expect(md).toContain('L223-21');
  });
});

describe('executerControles', () => {
  const lignes = ecriture('OD000001', '2025-03-01', '60600000', '51200000', '10.00');
  it('sans écriture : tout est non_realise, jamais favorable', () => {
    const r = executerControles({ lignes: [], exercice: EXERCICE_2025 });
    expect(r).toHaveLength(19);
    for (const x of r) {
      expect(x.statut).toBe('non_realise');
      expect(x.motif).toMatch(/Aucune écriture/);
    }
  });
  it('ne lève jamais : identifiant inconnu, paramètre invalide, données corrompues → statut erreur', () => {
    expect(un('XXX-999', lignes)).toMatchObject({ statut: 'erreur', controleId: 'XXX-999' });
    expect(un('GEN-001', lignes, { tolerance: 0.5 })).toMatchObject({ statut: 'erreur' });
    expect(un('GEN-001', lignes, { parametreInconnu: true })).toMatchObject({ statut: 'erreur' });
    expect(un('TIE-003', lignes, { seuilJours: -1 })).toMatchObject({ statut: 'erreur' });
    const corrompue = [{ ...lignes[0]!, debit: '12,5' }];
    const r = executerControles({ lignes: corrompue, exercice: EXERCICE_2025 });
    expect(r).toHaveLength(19);
    expect(r.find((x) => x.controleId === 'GEN-001')).toMatchObject({ statut: 'erreur' });
    expect(r.find((x) => x.controleId === 'GEN-001')?.motif).toMatch(/Montant invalide/);
    expect(() => executerControles({ lignes: null as unknown as LigneEcriture[], exercice: null })).not.toThrow();
  });
  it('restitue les paramètres appliqués (défauts + surcharges) et ne modifie pas les lignes fournies', () => {
    const fige = Object.freeze(lignes.map((l) => Object.freeze({ ...l })));
    const r = executerControles({ lignes: fige, exercice: EXERCICE_2025 }, { parametres: { 'TIE-003': { seuilJours: 60 } } });
    expect(r.find((x) => x.controleId === 'TIE-003')?.parametresAppliques).toMatchObject({ seuilJours: 60, prefixesComptes: ['411', '401'] });
    expect(r.every((x) => x.statut !== 'erreur')).toBe(true);
  });
  it('résultats déterministes et clés de constat stables entre deux exécutions', () => {
    const jeu = [...ecriture('OD000001', '2025-03-01', '47100000', '51200000', '10.00'), ligne({ compteNum: '60600000', debit: '5.00', ecritureNum: 'OD000002' })];
    const a = executerControles({ lignes: jeu, exercice: EXERCICE_2025 });
    const b = executerControles({ lignes: [...jeu].reverse(), exercice: EXERCICE_2025 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(executerControles({ lignes: jeu, exercice: EXERCICE_2025 })));
    const cles = (r: ResultatControle[]): string[] => r.flatMap((x) => x.constats.map((c) => c.cle)).sort();
    expect(cles(a)).toEqual(cles(b));
    expect(new Set(cles(a)).size).toBe(cles(a).length);
  });
});

describe('GEN-001 équilibre', () => {
  it('sans anomalie sur des écritures équilibrées', () => {
    const r = un('GEN-001', [...ecriture('A1', '2025-01-10', '60600000', '51200000', '100.10'), ...ecriture('A2', '2025-01-11', '51200000', '70700000', '0.20')]);
    expect(r).toMatchObject({ statut: 'sans_anomalie', constats: [], mesures: { nbEcritures: '2', ecartGlobal: '0.00', totalDebit: '100.30' } });
  });
  it('écriture déséquilibrée : constat par écriture, par journal et global, avec le montant exact', () => {
    const l = [...ecriture('A1', '2025-01-10', '60600000', '51200000', '100.00'), ligne({ ecritureNum: 'A2', compteNum: '60600000', debit: '0.10' }), ligne({ ecritureNum: 'A2', compteNum: '51200000', credit: '0.30' })];
    const r = un('GEN-001', l);
    expect(r.statut).toBe('constat');
    expect(r.constats.map((c) => [c.cle, c.montant, c.gravite])).toEqual(expect.arrayContaining([
      ['GEN-001|ecriture|OD|A2', '0.20', 'elevee'], ['GEN-001|journal|OD', '0.20', 'elevee'], ['GEN-001|global', '0.20', 'critique'],
    ]));
    expect(r.constats).toHaveLength(3);
    expect(r.constats.find((c) => c.cle.includes('ecriture'))?.lignesConcernees).toHaveLength(2);
  });
  it('deux écritures déséquilibrées qui se compensent : pas de constat global mais deux constats d’écriture', () => {
    const l = [ligne({ ecritureNum: 'A1', compteNum: '60600000', debit: '5.00' }), ligne({ ecritureNum: 'A2', compteNum: '51200000', credit: '5.00' })];
    expect(un('GEN-001', l).constats.map((c) => c.cle).sort()).toEqual(['GEN-001|ecriture|OD|A1', 'GEN-001|ecriture|OD|A2']);
  });
  it('même numéro dans deux journaux : écritures distinctes', () => {
    const l = [...ecriture('1', '2025-01-10', '60600000', '51200000', '10.00', { journal: 'AC' }), ...ecriture('1', '2025-01-10', '51200000', '70700000', '20.00', { journal: 'VT' })];
    expect(un('GEN-001', l)).toMatchObject({ statut: 'sans_anomalie', mesures: { nbEcritures: '2', nbJournaux: '2' } });
  });
  it('tolérance paramétrable et plafonnement des constats', () => {
    const l = [ligne({ ecritureNum: 'A1', compteNum: '60600000', debit: '10.01' }), ligne({ ecritureNum: 'A1', compteNum: '51200000', credit: '10.00' })];
    expect(un('GEN-001', l, { tolerance: '0.01' }).statut).toBe('sans_anomalie');
    expect(un('GEN-001', l, { tolerance: '0.00' }).statut).toBe('constat');
    const beaucoup = Array.from({ length: 30 }, (_, i) => ligne({ ecritureNum: `B${i}`, compteNum: '60600000', debit: `${i + 1}.00` }));
    const r = un('GEN-001', beaucoup, { maxConstats: 5 });
    expect(r.constats).toHaveLength(5);
    expect(r.constats[0]?.montant).toBe('465.00'); // les plus forts montants d'abord (journal et global)
    expect(r.mesures).toMatchObject({ nbConstats: '32', nbConstatsOmis: '27' });
    expect(r.motif).toMatch(/27 constat/);
  });
});

describe('GEN-002 séquences', () => {
  const serie = (nums: number[], journal = 'VT', prefixe = 'VT'): LigneEcriture[] =>
    nums.flatMap((n) => ecriture(`${prefixe}${String(n).padStart(4, '0')}`, '2025-02-01', '41100000', '70700000', '10.00', { journal }));
  it('séquence continue : sans anomalie', () => {
    expect(un('GEN-002', serie([1, 2, 3, 4, 5]))).toMatchObject({ statut: 'sans_anomalie', mesures: { porteeRetenue: 'journal', nbSequencesAnalysees: '1' } });
  });
  it('trou dans un journal : constat avec bornes et nombre de numéros manquants', () => {
    const r = un('GEN-002', [...serie([1, 2, 3, 6, 7]), ...serie([1, 2, 3], 'AC', 'AC')]);
    expect(r.statut).toBe('constat');
    expect(r.constats).toHaveLength(1);
    expect(r.constats[0]).toMatchObject({ montant: null, cle: 'GEN-002|journal|VT|VT|3|6' });
    expect(r.constats[0]?.preuves).toContainEqual({ libelle: 'Numéros manquants', valeur: '2' });
    expect(r.constats[0]?.lignesConcernees).toHaveLength(4);
  });
  it('numérotation globale continue répartie sur plusieurs journaux : pas de faux positif en portée auto', () => {
    const l = [...serie([1, 3, 5, 7], 'VT', ''), ...serie([2, 4, 6, 8], 'AC', '')];
    expect(un('GEN-002', l)).toMatchObject({ statut: 'sans_anomalie', mesures: { porteeRetenue: 'globale' } });
    expect(un('GEN-002', l, { portee: 'journal' }).statut).toBe('constat');
  });
  it('numéros non numériques, trop peu d’écritures ou numérotation par date : non applicable plutôt que favorable', () => {
    expect(un('GEN-002', ecriture('ABC', '2025-01-01', '60600000', '51200000', '1.00')).statut).toBe('non_applicable');
    expect(un('GEN-002', serie([1, 2])).statut).toBe('non_applicable');
    expect(un('GEN-002', serie([20250101, 20250215, 20250301, 20250410], 'VT', ''))).toMatchObject({ statut: 'non_applicable', mesures: { nbSequencesNonAnalysees: '1' } });
  });
  it('le même numéro sur plusieurs lignes ne crée pas de rupture', () => {
    const l = serie([1, 2, 3]);
    expect(un('GEN-002', [...l, ...l]).statut).toBe('sans_anomalie');
  });
});

describe('GEN-003 dates hors exercice', () => {
  const l = [...ecriture('A1', '2024-12-31', '60600000', '51200000', '10.00'), ...ecriture('A2', '2025-01-01', '60600000', '51200000', '20.00'), ...ecriture('A3', '2025-12-31', '60600000', '51200000', '30.00'), ...ecriture('A4', '2026-01-01', '60600000', '51200000', '40.00')];
  it('exercice inconnu : non réalisé', () => {
    expect(un('GEN-003', l, undefined, null)).toMatchObject({ statut: 'non_realise', constats: [] });
  });
  it('bornes incluses ; veille de l’ouverture et lendemain de la clôture signalés avec leur montant', () => {
    const r = un('GEN-003', l);
    expect(r.statut).toBe('constat');
    expect(r.constats.map((c) => [c.cle, c.montant])).toEqual([['GEN-003|OD|A4|2026-01-01', '40.00'], ['GEN-003|OD|A1|2024-12-31', '10.00']]);
    expect(r.mesures['nbLignesHorsExercice']).toBe('4');
  });
  it('toutes les dates dans l’exercice : sans anomalie', () => {
    expect(un('GEN-003', l.slice(2, 6)).statut).toBe('sans_anomalie');
  });
});

describe('GEN-004 doublons potentiels', () => {
  const facture = (num: string, piece = 'FF-1', montant = '120.00', date = '2025-04-02'): LigneEcriture[] => ecriture(num, date, '60700000', '40100000', montant, { journal: 'AC', piece, auxCredit: 'F0001' });
  it('même journal, date, comptes, montants et pièce sous deux numéros : suspicion', () => {
    const r = un('GEN-004', [...facture('AC1'), ...facture('AC2'), ...facture('AC3', 'FF-2')]);
    expect(r.statut).toBe('constat');
    expect(r.constats).toHaveLength(1);
    expect(r.constats[0]).toMatchObject({ montant: '120.00', cle: 'GEN-004|AC|AC1+AC2', gravite: 'moyenne' });
    expect(r.constats[0]?.explication).toMatch(/Suspicion/);
    expect(r.constats[0]?.lignesConcernees).toHaveLength(4);
  });
  it.each([
    ['pièce différente', facture('AC2', 'FF-2')],
    ['montant différent', facture('AC2', 'FF-1', '120.01')],
    ['date différente', facture('AC2', 'FF-1', '120.00', '2025-04-03')],
    ['journal différent', facture('AC2').map((l) => ({ ...l, journalCode: 'OD' }))],
    ['tiers différent', facture('AC2').map((l) => ({ ...l, compAuxNum: l.compAuxNum ? 'F0002' : null }))],
  ])('pas de doublon si %s', (_nom, autre) => {
    expect(un('GEN-004', [...facture('AC1'), ...autre]).statut).toBe('sans_anomalie');
  });
  it('écriture montant 120.0 et 120.00 : même montant ; lignes identiques au sein d’une même écriture : pas un doublon', () => {
    expect(un('GEN-004', [...facture('AC1', 'FF-1', '120.0'), ...facture('AC2')]).statut).toBe('constat');
    expect(un('GEN-004', [...facture('AC1'), ...facture('AC1')]).statut).toBe('sans_anomalie');
  });
  it('paramètre inclureSansPiece', () => {
    const l = [...facture('AC1', ''), ...facture('AC2', '')];
    expect(un('GEN-004', l).statut).toBe('constat');
    expect(un('GEN-004', l, { inclureSansPiece: false }).statut).toBe('sans_anomalie');
  });
});

describe('GEN-005 comptes d’attente', () => {
  it('aucun compte 47x : non applicable', () => {
    expect(un('GEN-005', ecriture('A1', '2025-01-10', '60600000', '51200000', '10.00')).statut).toBe('non_applicable');
  });
  it('compte 471 soldé : sans anomalie ; non soldé : constat du solde', () => {
    const ouverture = ecriture('A1', '2025-03-01', '47100000', '51200000', '250.00');
    expect(un('GEN-005', [...ouverture, ...ecriture('A2', '2025-06-01', '60600000', '47100000', '250.00')]).statut).toBe('sans_anomalie');
    const r = un('GEN-005', [...ouverture, ...ecriture('A2', '2025-06-01', '60600000', '47100000', '100.00')]);
    expect(r.constats).toHaveLength(1);
    expect(r.constats[0]).toMatchObject({ montant: '150.00', gravite: 'moyenne', cle: 'GEN-005|47100000' });
    expect(r.constats[0]?.explication).toMatch(/débiteur.*1214-47/);
  });
  it('régularisation postérieure à la clôture : le compte reste non soldé à la clôture', () => {
    const l = [...ecriture('A1', '2025-03-01', '47100000', '51200000', '250.00'), ...ecriture('A2', '2026-01-15', '60600000', '47100000', '250.00')];
    expect(un('GEN-005', l).statut).toBe('constat');
    expect(un('GEN-005', l, undefined, null).statut).toBe('sans_anomalie'); // exercice inconnu : toutes les lignes
  });
  it('périmètre : 472/473 moyenne, 478 faible (convention), 4781 et 476 exclus', () => {
    const l = ['47200000', '47300000', '47800000', '47810000', '47600000'].flatMap((c, i) => ecriture(`A${i}`, '2025-03-01', c, '51200000', '10.00'));
    const r = un('GEN-005', l);
    expect(r.constats.map((c) => [c.cle, c.gravite]).sort()).toEqual([['GEN-005|47200000', 'moyenne'], ['GEN-005|47300000', 'moyenne'], ['GEN-005|47800000', 'faible']]);
  });
});

describe('TRE-001 caisse créditrice', () => {
  const caisse = (num: string, date: string, sens: 'entree' | 'sortie', montant: string): LigneEcriture[] =>
    sens === 'entree' ? ecriture(num, date, '53100000', '70700000', montant, { journal: 'CA' }) : ecriture(num, date, '60600000', '53100000', montant, { journal: 'CA' });
  it('pas de compte 53 : non applicable', () => {
    expect(un('TRE-001', ecriture('A1', '2025-01-10', '60600000', '51200000', '10.00')).statut).toBe('non_applicable');
  });
  it('caisse toujours débitrice ou nulle : sans anomalie (solde nul admis)', () => {
    expect(un('TRE-001', [...caisse('C1', '2025-01-02', 'entree', '100.00'), ...caisse('C2', '2025-01-03', 'sortie', '100.00')]).statut).toBe('sans_anomalie');
  });
  it('créditrice en cours d’année puis régularisée : détectée par le calcul chronologique, même si le fichier n’est pas trié', () => {
    const l = [...caisse('C4', '2025-03-01', 'entree', '500.00'), ...caisse('C2', '2025-01-05', 'sortie', '150.00'), ...caisse('C1', '2025-01-02', 'entree', '100.00'), ...caisse('C3', '2025-01-20', 'sortie', '30.00')];
    const r = un('TRE-001', l);
    expect(r.statut).toBe('constat');
    expect(r.constats[0]).toMatchObject({ montant: '80.00', gravite: 'elevee', cle: 'TRE-001|53100000' });
    expect(r.constats[0]?.preuves).toEqual(expect.arrayContaining([
      { libelle: 'Première date créditrice', valeur: '2025-01-05' }, { libelle: 'Solde à cette date', valeur: '-50.00' }, { libelle: 'Jours créditeurs', valeur: '2' },
    ]));
  });
  it('créditrice en cours de journée mais régularisée le jour même : non détectée (limite documentée)', () => {
    expect(un('TRE-001', [...caisse('C1', '2025-01-02', 'sortie', '100.00'), ...caisse('C2', '2025-01-02', 'entree', '100.00')]).statut).toBe('sans_anomalie');
  });
  it('chaque caisse est suivie séparément ; seuil paramétrable', () => {
    const l = [...ecriture('C1', '2025-01-02', '53100000', '70700000', '100.00'), ...ecriture('C2', '2025-01-03', '60600000', '53200000', '40.00')];
    const r = un('TRE-001', l);
    expect(r.constats.map((c) => c.cle)).toEqual(['TRE-001|53200000']);
    expect(un('TRE-001', l, { seuil: '40.00' }).statut).toBe('sans_anomalie');
  });
});

describe('TRE-002 banque créditrice à la clôture', () => {
  it('banque débitrice : sans anomalie ; créditrice : constat « à examiner » de gravité faible', () => {
    const l = ecriture('B1', '2025-01-02', '51200000', '10100000', '1000.00');
    expect(un('TRE-002', l).statut).toBe('sans_anomalie');
    const r = un('TRE-002', [...l, ...ecriture('B2', '2025-12-30', '60600000', '51200000', '1500.00')]);
    expect(r.constats[0]).toMatchObject({ montant: '500.00', gravite: 'faible' });
    expect(r.constats[0]?.titre).toMatch(/à examiner/);
  });
  it('découvert en cours d’année résorbé à la clôture : pas de constat ; pas de compensation entre banques', () => {
    const l = [...ecriture('B1', '2025-03-02', '60600000', '51200000', '500.00'), ...ecriture('B2', '2025-06-02', '51200000', '70700000', '800.00')];
    expect(un('TRE-002', l).statut).toBe('sans_anomalie');
    const deux = [...ecriture('B1', '2025-03-02', '51210000', '70700000', '5000.00'), ...ecriture('B2', '2025-06-02', '60600000', '51220000', '200.00')];
    expect(un('TRE-002', deux).constats.map((c) => c.cle)).toEqual(['TRE-002|51220000']);
  });
  it('pas de compte 512 : non applicable', () => {
    expect(un('TRE-002', ecriture('A1', '2025-01-10', '60600000', '53100000', '10.00')).statut).toBe('non_applicable');
  });
});

describe('TIE-001 / TIE-002 soldes anormaux de tiers', () => {
  const vente = (num: string, aux: string, montant: string): LigneEcriture[] => ecriture(num, '2025-05-01', '41100000', '70700000', montant, { auxDebit: aux });
  const encaissement = (num: string, aux: string, montant: string): LigneEcriture[] => ecriture(num, '2025-06-01', '51200000', '41100000', montant, { auxCredit: aux });
  it('client créditeur par compte auxiliaire, même si le collectif est débiteur', () => {
    const l = [...vente('V1', 'C1', '1000.00'), ...vente('V2', 'C2', '100.00'), ...encaissement('E1', 'C2', '130.00')];
    const r = un('TIE-001', l);
    expect(r.constats).toHaveLength(1);
    expect(r.constats[0]).toMatchObject({ montant: '30.00', cle: 'TIE-001|41100000|C2' });
    expect(r.mesures['nbTiersExamines']).toBe('2');
  });
  it('clients débiteurs ou soldés : sans anomalie ; aucun 411 : non applicable ; seuil paramétrable', () => {
    expect(un('TIE-001', [...vente('V1', 'C1', '100.00'), ...encaissement('E1', 'C1', '100.00')]).statut).toBe('sans_anomalie');
    expect(un('TIE-001', ecriture('A1', '2025-01-10', '60600000', '51200000', '10.00')).statut).toBe('non_applicable');
    const l = [...vente('V1', 'C1', '100.00'), ...encaissement('E1', 'C1', '100.50')];
    expect(un('TIE-001', l).statut).toBe('constat');
    expect(un('TIE-001', l, { seuil: '1.00' }).statut).toBe('sans_anomalie');
  });
  it('sans compte auxiliaire : regroupement par compte général', () => {
    const r = un('TIE-001', ecriture('E1', '2025-06-01', '51200000', '41100001', '50.00'));
    expect(r.constats[0]).toMatchObject({ montant: '50.00', cle: 'TIE-001|41100001|41100001' });
  });
  it('fournisseur débiteur (TIE-002) et fournisseur créditeur normal', () => {
    const achat = ecriture('A1', '2025-05-01', '60700000', '40100000', '200.00', { auxCredit: 'F1' });
    const paiement = ecriture('P1', '2025-06-01', '40100000', '51200000', '260.00', { auxDebit: 'F1' });
    expect(un('TIE-002', achat).statut).toBe('sans_anomalie');
    const r = un('TIE-002', [...achat, ...paiement]);
    expect(r.constats[0]).toMatchObject({ montant: '60.00', cle: 'TIE-002|40100000|F1' });
    // Le même jeu ne déclenche pas le contrôle « clients ».
    expect(un('TIE-001', [...achat, ...paiement]).statut).toBe('non_applicable');
  });
});

describe('TIE-003 ancienneté des non lettrés', () => {
  const facture = (num: string, date: string, aux: string, montant: string, lettre?: string): LigneEcriture[] =>
    ecriture(num, date, '41100000', '70700000', montant, { auxDebit: aux, ...(lettre ? { lettreDebit: lettre } : {}) });
  const lettree = facture('V0', '2025-01-10', 'C9', '10.00', 'AAA');
  it('exercice inconnu ou lettrage absent : non réalisé', () => {
    expect(un('TIE-003', [...lettree, ...facture('V1', '2025-02-01', 'C1', '100.00')], undefined, null)).toMatchObject({ statut: 'non_realise' });
    const r = un('TIE-003', facture('V1', '2025-02-01', 'C1', '100.00'));
    expect(r.statut).toBe('non_realise');
    expect(r.motif).toMatch(/lettrage/i);
  });
  it('seuil de 90 jours : 90 jours pile n’est pas un dépassement, 91 jours oui', () => {
    // 2025-12-31 − 90 j = 2025-10-02 ; − 91 j = 2025-10-01
    const r = un('TIE-003', [...lettree, ...facture('V1', '2025-10-02', 'C1', '100.00'), ...facture('V2', '2025-10-01', 'C2', '70.00')]);
    expect(r.constats).toHaveLength(1);
    expect(r.constats[0]).toMatchObject({ montant: '70.00', cle: 'TIE-003|41100000|C2', gravite: 'faible' });
    expect(r.constats[0]?.preuves).toContainEqual({ libelle: 'Ancienneté maximale (jours)', valeur: '91' });
  });
  it('les lignes lettrées anciennes ne comptent pas ; net par tiers ; seuil paramétrable ; date de pièce prioritaire', () => {
    const l = [
      ...facture('V1', '2025-02-01', 'C1', '100.00', 'AAB'),
      ...facture('V2', '2025-03-01', 'C2', '300.00'),
      ...ecriture('E2', '2025-03-15', '51200000', '41100000', '100.00', { auxCredit: 'C2' }),
      ...facture('V3', '2025-11-20', 'C3', '50.00').map((x) => ({ ...x, pieceDate: '2025-01-05' })),
    ];
    const r = un('TIE-003', l);
    expect(r.constats.map((c) => [c.cle, c.montant, c.gravite])).toEqual([['TIE-003|41100000|C2', '200.00', 'moyenne'], ['TIE-003|41100000|C3', '50.00', 'moyenne']]);
    expect(un('TIE-003', l, { seuilJours: 400 }).statut).toBe('sans_anomalie');
    expect(un('TIE-003', l, { seuilMontant: '100.00' }).constats).toHaveLength(1);
  });
  it('fournisseurs couverts ; soldes récents : sans anomalie', () => {
    const dette = ecriture('A1', '2025-01-15', '60700000', '40100000', '80.00', { auxCredit: 'F1' });
    expect(un('TIE-003', [...lettree, ...dette]).constats[0]).toMatchObject({ montant: '80.00', cle: 'TIE-003|40100000|F1' });
    expect(un('TIE-003', [...lettree, ...facture('V1', '2025-12-01', 'C1', '100.00')]).statut).toBe('sans_anomalie');
  });
});

describe('CAP-001 comptes courants d’associés', () => {
  const apport = ecriture('O1', '2025-01-02', '51200000', '45500000', '1000.00');
  it('compte courant créditeur : sans anomalie ; pas de 455 : non applicable', () => {
    expect(un('CAP-001', apport).statut).toBe('sans_anomalie');
    expect(un('CAP-001', ecriture('A1', '2025-01-10', '60600000', '51200000', '10.00')).statut).toBe('non_applicable');
  });
  it('débiteur à la clôture : constat élevé, formulé « à examiner », citant les trois articles', () => {
    const r = un('CAP-001', [...apport, ...ecriture('O2', '2025-11-02', '45500000', '51200000', '2500.00')]);
    expect(r.constats).toHaveLength(1);
    expect(r.constats[0]).toMatchObject({ montant: '1500.00', gravite: 'elevee', cle: 'CAP-001|cloture|45500000|45500000' });
    expect(r.constats[0]?.titre).toMatch(/à examiner/);
    expect(r.constats[0]?.explication).toMatch(/L223-21.*L225-43.*L227-12/);
  });
  it('débiteur en cours d’année, résorbé à la clôture : constat moyen, désactivable', () => {
    const l = [...apport, ...ecriture('O2', '2025-05-02', '45500000', '51200000', '1400.00'), ...ecriture('O3', '2025-09-02', '51200000', '45500000', '900.00')];
    const r = un('CAP-001', l);
    expect(r.constats[0]).toMatchObject({ montant: '400.00', gravite: 'moyenne', cle: 'CAP-001|periode|45500000|45500000' });
    expect(un('CAP-001', l, { controleInfraAnnuel: false }).statut).toBe('sans_anomalie');
  });
  it('un associé débiteur n’est pas masqué par un associé créditeur (comptes auxiliaires)', () => {
    const l = [...ecriture('O1', '2025-01-02', '51200000', '45500000', '5000.00', { auxCredit: 'A1' }), ...ecriture('O2', '2025-02-02', '45500000', '51200000', '300.00', { auxDebit: 'A2' })];
    const r = un('CAP-001', l);
    expect(r.constats.map((c) => [c.cle, c.montant])).toEqual([['CAP-001|cloture|45500000|A2', '300.00']]);
  });
});

describe('TVA-001 cadrage global (vraisemblance)', () => {
  const vente = (num: string, ht: string, tva: string | null, compte = '70700000'): LigneEcriture[] => {
    const commun = { ecritureNum: num, journalCode: 'VT', ecritureDate: '2025-05-01' };
    const ttc = (Number(ht) + Number(tva ?? 0)).toFixed(2);
    return [ligne({ ...commun, compteNum: '41100000', debit: ttc }), ligne({ ...commun, compteNum: compte, credit: ht }), ...(tva !== null ? [ligne({ ...commun, compteNum: '44571000', credit: tva })] : [])];
  };
  it('comptes nécessaires absents : non réalisé', () => {
    expect(un('TVA-001', ecriture('A1', '2025-01-10', '60600000', '51200000', '10.00'))).toMatchObject({ statut: 'non_realise' });
    const r = un('TVA-001', vente('V1', '100.00', null));
    expect(r.statut).toBe('non_realise');
    expect(r.motif).toMatch(/TVA collectée/);
  });
  it('taux apparent dans les bornes : sans anomalie, mesures restituées', () => {
    const r = un('TVA-001', [...vente('V1', '1000.00', '200.00'), ...vente('V2', '500.00', '50.00', '70600000')]);
    expect(r).toMatchObject({ statut: 'sans_anomalie', mesures: { base: '1500.00', tvaCollectee: '250.00', tauxApparent: '16.6667', tauxMin: '2.1', tauxMax: '20' } });
  });
  it('TVA supérieure au taux maximal : constat chiffré', () => {
    const r = un('TVA-001', vente('V1', '1000.00', '250.00'));
    expect(r.statut).toBe('constat');
    expect(r.constats[0]).toMatchObject({ montant: '50.00', cle: 'TVA-001|global' });
    expect(r.constats[0]?.explication).toMatch(/vraisemblance/);
  });
  it('TVA insuffisante : constat, sauf si les ventes sans TVA sont admises', () => {
    const l = [...vente('V1', '1000.00', '10.00'), ...vente('V2', '9000.00', null)];
    const r = un('TVA-001', l);
    expect(r.constats[0]?.montant).toBe('200.00'); // 10 000 × 2,1 % − 10
    expect(un('TVA-001', l, { ventesSansTvaAdmises: true }).statut).toBe('sans_anomalie');
  });
  it('les écritures de liquidation (4455) et les avoirs ne faussent pas le cadrage', () => {
    const liquidation = [
      ligne({ ecritureNum: 'OD9', compteNum: '44571000', debit: '180.00' }),
      ligne({ ecritureNum: 'OD9', compteNum: '44551000', credit: '180.00' }),
    ];
    const avoir = [
      ligne({ ecritureNum: 'V2', journalCode: 'VT', compteNum: '70700000', debit: '100.00' }),
      ligne({ ecritureNum: 'V2', journalCode: 'VT', compteNum: '44571000', debit: '20.00' }),
      ligne({ ecritureNum: 'V2', journalCode: 'VT', compteNum: '41100000', credit: '120.00' }),
    ];
    const r = un('TVA-001', [...vente('V1', '1000.00', '200.00'), ...avoir, ...liquidation]);
    expect(r).toMatchObject({ statut: 'sans_anomalie', mesures: { base: '900.00', tvaCollectee: '180.00', tauxApparent: '20.0000' } });
  });
  it('tolérance de taux et base négative', () => {
    expect(un('TVA-001', vente('V1', '1000.00', '200.40')).statut).toBe('sans_anomalie'); // 20,04 % ≤ 20 % + 0,05
    expect(un('TVA-001', vente('V1', '1000.00', '200.60')).statut).toBe('constat');
    const negatif = [ligne({ compteNum: '70900000', debit: '50.00' }), ligne({ compteNum: '44571000', debit: '10.00' }), ligne({ compteNum: '41100000', credit: '60.00' })];
    expect(un('TVA-001', negatif).statut).toBe('non_realise');
  });
});
