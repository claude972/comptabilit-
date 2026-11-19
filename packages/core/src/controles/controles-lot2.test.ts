import { describe, expect, it } from 'vitest';
import { EXERCICE_2025, ecriture, ligne } from '../aides-tests.js';
import { lireCamt053 } from '../banque/camt053.js';
import type { RapportReleve } from '../banque/types.js';
import { CATALOGUE_CONTROLES, executerControles } from './catalogue.js';
import type { LigneEcriture, ResultatControle } from './types.js';

function un(
  id: string,
  lignes: LigneEcriture[],
  parametres?: Record<string, unknown>,
  contexte: { exercice?: { debut: string; fin: string } | null; releves?: RapportReleve[]; exercicePrecedent?: { lignes: LigneEcriture[] } } = {},
): ResultatControle {
  const { exercice = EXERCICE_2025, ...reste } = contexte;
  const r = executerControles({ lignes, exercice, ...reste }, { ids: [id], ...(parametres ? { parametres: { [id]: parametres } } : {}) });
  expect(r).toHaveLength(1);
  return r[0]!;
}

describe('catalogue — lot 2', () => {
  it('les sept nouveaux contrôles sont documentés, versionnés et sourcés', () => {
    const lot2 = CATALOGUE_CONTROLES.filter((d) => ['TRE-003', 'IMM-001', 'IMM-002', 'SOC-001', 'CLO-001', 'CLO-002', 'TVA-002'].includes(d.id));
    expect(lot2).toHaveLength(7);
    expect(Object.fromEntries(lot2.map((d) => [d.id, [d.cycle, d.source.type]]))).toEqual({
      'TRE-003': ['tresorerie', 'interne'], 'IMM-001': ['immobilisations', 'reglementaire'], 'IMM-002': ['immobilisations', 'reglementaire'], 'SOC-001': ['social', 'interne'],
      'CLO-001': ['cloture', 'interne'], 'CLO-002': ['cloture', 'reglementaire'], 'TVA-002': ['tva', 'interne'],
    });
    const imm2 = lot2.find((d) => d.id === 'IMM-002')!;
    expect(imm2.parametresParDefaut['seuil']).toBe('500.00');
    expect(imm2.source).toMatchObject({ verification: 'verifiee', dateVerification: '2026-11-19', url: 'https://bofip.impots.gouv.fr/bofip/2109-PGP.html' });
    expect(imm2.source.reference).toMatch(/BOI-BIC-CHG-20-30-10.*500 €.*HORS TAXES/s);
    for (const d of lot2) expect(d.logique.length).toBeGreaterThan(100);
  });
});

// --- TRE-003 --------------------------------------------------------------------------------
const IBAN = 'FR7630006000011234567890189';
function releve(ouverture: string, cloture: string, ecritures: Array<[string, 'CRDT' | 'DBIT', string, string?]>, options: { iban?: string; debut?: string; fin?: string } = {}): RapportReleve {
  const solde = (code: string, montant: string, date: string): string =>
    `<Bal><Tp><CdOrPrtry><Cd>${code}</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${montant.replace('-', '')}</Amt><CdtDbtInd>${montant.startsWith('-') ? 'DBIT' : 'CRDT'}</CdtDbtInd><Dt><Dt>${date}</Dt></Dt></Bal>`;
  return lireCamt053(
    `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Acct><Id><IBAN>${options.iban ?? IBAN}</IBAN></Id><Ccy>EUR</Ccy></Acct>` +
    `${solde('OPBD', ouverture, options.debut ?? '2025-01-01')}${solde('CLBD', cloture, options.fin ?? '2025-01-31')}` +
    ecritures.map(([montant, sens, date, ref], i) => `<Ntry><Amt Ccy="EUR">${montant}</Amt><CdtDbtInd>${sens}</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${date}</Dt></BookgDt><AcctSvcrRef>B${i}</AcctSvcrRef>` +
      `${ref ? `<NtryDtls><TxDtls><Refs><EndToEndId>${ref}</EndToEndId></Refs></TxDtls></NtryDtls>` : ''}<AddtlNtryInf>Libellé ${i}</AddtlNtryInf></Ntry>`).join('') +
    '</Stmt></BkToCstmrStmt></Document>');
}

describe('TRE-003 rapprochement bancaire', () => {
  const compta = [
    ...ecriture('AN000001', '2025-01-01', '51200000', '10100000', '1000.00', { journal: 'AN' }),
    ...ecriture('BQ000001', '2025-01-10', '51200000', '41100000', '300.00', { journal: 'BQ', piece: 'RC-1' }),
    ...ecriture('BQ000002', '2025-01-20', '40100000', '51200000', '120.00', { journal: 'BQ', piece: 'RF-1' }),
  ];
  it('sans relevé, relevé illisible ou sans compte 512 : non réalisé / non applicable, jamais favorable', () => {
    expect(un('TRE-003', compta)).toMatchObject({ statut: 'non_realise', motif: expect.stringMatching(/Aucun relevé bancaire fourni/) });
    expect(un('TRE-003', compta, undefined, { releves: [] }).statut).toBe('non_realise');
    expect(un('TRE-003', compta, undefined, { releves: [lireCamt053('<!DOCTYPE x><Document/>')] })).toMatchObject({ statut: 'non_realise', motif: expect.stringMatching(/lisible/) });
    expect(un('TRE-003', ecriture('A', '2025-01-10', '60600000', '40100000', '10.00'), undefined, { releves: [releve('0.00', '0.00', [])] }).statut).toBe('non_applicable');
  });
  it('soldes concordants et tout rapproché : sans anomalie', () => {
    const r = un('TRE-003', compta, undefined, { releves: [releve('1000.00', '1180.00', [['300.00', 'CRDT', '2025-01-11'], ['120.00', 'DBIT', '2025-01-22', 'RF-1']])] });
    expect(r).toMatchObject({ statut: 'sans_anomalie', constats: [] });
    expect(r.mesures).toMatchObject({ '51200000.soldeComptable': '1180.00', '51200000.soldeReleve': '1180.00', '51200000.ecart': '0.00', '51200000.nbRapprochements': '2', nbComptesRapproches: '1' });
  });
  it('écart expliqué par les suspens : constat chiffré, décomposition exacte', () => {
    // Le chèque de 120,00 n'est pas encore débité ; la banque a prélevé 15,00 de frais non comptabilisés.
    const r = un('TRE-003', compta, undefined, { releves: [releve('1000.00', '1285.00', [['300.00', 'CRDT', '2025-01-11'], ['15.00', 'DBIT', '2025-01-25']])] });
    expect(r.statut).toBe('constat');
    expect(r.constats).toHaveLength(1);
    const c = r.constats[0]!;
    expect(c).toMatchObject({ montant: '105.00', gravite: 'faible', cle: 'TRE-003|51200000|2025-01-31' });
    expect(c.titre).toMatch(/écart de -105\.00/);
    expect(c.lignesConcernees).toEqual([compta[5]!.id]);
    const preuves = Object.fromEntries(c.preuves.map((p) => [p.libelle, p.valeur]));
    expect(preuves).toMatchObject({
      'Solde comptable (débit − crédit)': '1180.00', 'Solde du relevé': '1285.00', 'Écart (comptabilité − relevé)': '-105.00', 'Écart à l’ouverture': '0.00',
      'Écritures comptables non rapprochées': '1 pour -120.00', 'Mouvements bancaires non rapprochés': '1 pour -15.00', 'Rapprochements établis': '1',
    });
    expect(c.explication).toMatch(/non expliqué 0\.00/);
  });
  it('soldes égaux mais suspens qui se compensent, et écart à l’ouverture : constats', () => {
    const compense = un('TRE-003', compta, undefined, { releves: [releve('1000.00', '1180.00', [['300.00', 'CRDT', '2025-01-11'], ['120.00', 'DBIT', '2025-03-30']], { fin: '2025-03-31' })] });
    expect(compense.statut).toBe('constat');
    expect(compense.constats[0]).toMatchObject({ montant: '0.00' });
    expect(compense.constats[0]?.titre).toMatch(/soldes concordants.*suspens/);
    const ouverture = un('TRE-003', compta, undefined, { releves: [releve('900.00', '1080.00', [['300.00', 'CRDT', '2025-01-11'], ['120.00', 'DBIT', '2025-01-22']])] });
    expect(ouverture.constats[0]).toMatchObject({ montant: '100.00', gravite: 'moyenne' });
  });
  it('relevé non cadré, non contigu ou association indéterminée : non réalisé avec motif', () => {
    expect(un('TRE-003', compta, undefined, { releves: [releve('1000.00', '9999.00', [['300.00', 'CRDT', '2025-01-11']])] })).toMatchObject({ statut: 'non_realise', motif: expect.stringMatching(/non cadré/) });
    const janvier = releve('1000.00', '1300.00', [['300.00', 'CRDT', '2025-01-11']]);
    const fevrierDecale = releve('1250.00', '1130.00', [['120.00', 'DBIT', '2025-02-02']], { debut: '2025-02-01', fin: '2025-02-28' });
    expect(un('TRE-003', compta, undefined, { releves: [janvier, fevrierDecale] })).toMatchObject({ statut: 'non_realise', motif: expect.stringMatching(/non contigus/) });
    const fevrier = releve('1300.00', '1180.00', [['120.00', 'DBIT', '2025-02-02']], { debut: '2025-02-01', fin: '2025-02-28' });
    // La date d'arrêté est la clôture du dernier relevé : l'écriture du 20/01 et le débit du 02/02 sont à plus de 5 jours → suspens, soldes égaux.
    expect(un('TRE-003', compta, undefined, { releves: [janvier, fevrier] }).mesures).toMatchObject({ '51200000.dateArrete': '2025-02-28', '51200000.ecart': '0.00' });
    expect(un('TRE-003', compta, { fenetreJours: 15 }, { releves: [janvier, fevrier] }).statut).toBe('sans_anomalie');
    const autre = releve('0.00', '0.00', [], { iban: 'FR1420041010050500013M02606' });
    expect(un('TRE-003', compta, undefined, { releves: [janvier, autre] })).toMatchObject({ statut: 'non_realise', motif: expect.stringMatching(/correspondances/) });
    const ok = releve('1000.00', '1180.00', [['300.00', 'CRDT', '2025-01-11'], ['120.00', 'DBIT', '2025-01-22']]);
    expect(un('TRE-003', compta, { correspondances: [{ compteNum: '51200000', compteBancaire: 'FR76 3000 6000 0112 3456 7890 189' }] }, { releves: [ok, autre] }).statut).toBe('sans_anomalie');
    expect(un('TRE-003', compta, { correspondances: [{ compteNum: '51200000', compteBancaire: 'FR00INCONNU' }] }, { releves: [ok] })).toMatchObject({ statut: 'non_realise', motif: expect.stringMatching(/aucun relevé pour le compte bancaire associé/) });
  });
});

// --- IMM-001 --------------------------------------------------------------------------------
describe('IMM-001 immobilisations / amortissements', () => {
  const acquisition = ecriture('AN1', '2025-01-01', '21830000', '10100000', '3000.00', { journal: 'AN' });
  it('amortissements inférieurs ou égaux au brut : sans anomalie (limite : égalité)', () => {
    expect(un('IMM-001', [...acquisition, ...ecriture('OD1', '2025-12-31', '68112000', '28183000', '1000.00')])).toMatchObject({ statut: 'sans_anomalie', mesures: { nbComptesAmortissement: '1', nbComptesImmobilisation: '1' } });
    expect(un('IMM-001', [...acquisition, ...ecriture('OD1', '2025-12-31', '68112000', '28183000', '3000.00')]).statut).toBe('sans_anomalie');
  });
  it('amortissements cumulés supérieurs à la valeur brute : constat de l’excédent', () => {
    const r = un('IMM-001', [...acquisition, ...ecriture('OD1', '2025-12-31', '68112000', '28183000', '3000.01')]);
    expect(r.statut).toBe('constat');
    expect(r.constats.map((c) => [c.cle, c.montant, c.gravite])).toEqual([['IMM-001|excedent|2183', '0.01', 'elevee']]);
    expect(un('IMM-001', [...acquisition, ...ecriture('OD1', '2025-12-31', '68112000', '28183000', '3000.01')], { tolerance: '0.01' }).statut).toBe('sans_anomalie');
  });
  it('compte 28x sans compte 2x correspondant : constat ; correspondance cherchée en remontant les regroupements', () => {
    const orphelin = un('IMM-001', [...acquisition, ...ecriture('OD1', '2025-12-31', '68112000', '28150000', '500.00')]);
    expect(orphelin.constats.map((c) => [c.cle, c.montant])).toEqual([['IMM-001|orphelin|28150000', '500.00']]);
    // 28183 sans 2183 mais avec 2180 : rattaché au regroupement 218, pas de constat « orphelin ».
    const regroupe = un('IMM-001', [...ecriture('AN1', '2025-01-01', '21800000', '10100000', '3000.00', { journal: 'AN' }), ...ecriture('OD1', '2025-12-31', '68112000', '28183000', '500.00')]);
    expect(regroupe.statut).toBe('sans_anomalie');
    // 280 ↔ 20 : amortissement d'un logiciel (2805 ↔ 205).
    expect(un('IMM-001', [...ecriture('AN1', '2025-01-01', '20500000', '10100000', '900.00', { journal: 'AN' }), ...ecriture('OD1', '2025-12-31', '68111000', '28050000', '1000.00')]).constats.map((c) => [c.cle, c.montant]))
      .toEqual([['IMM-001|excedent|205', '100.00']]);
    // Un amortissement sur terrains nus n'a pas de sens, mais un 2815 ne s'impute pas sur un 2183.
    expect(un('IMM-001', [...acquisition, ...ecriture('OD1', '2025-12-31', '68112000', '28154000', '10.00')]).constats[0]?.cle).toBe('IMM-001|orphelin|28154000');
  });
  it('compte d’amortissement débiteur : sens anormal ; aucun compte 2x/28x : non applicable', () => {
    const r = un('IMM-001', [...acquisition, ...ecriture('OD1', '2025-12-31', '28183000', '68112000', '50.00')]);
    expect(r.constats.map((c) => c.cle)).toEqual(['IMM-001|sens|28183000']);
    expect(un('IMM-001', ecriture('A', '2025-03-01', '60600000', '51200000', '10.00')).statut).toBe('non_applicable');
    // Une écriture postérieure à la clôture n'entre pas dans le solde.
    expect(un('IMM-001', [...acquisition, ...ecriture('OD1', '2026-01-15', '68112000', '28183000', '9000.00')]).statut).toBe('sans_anomalie');
  });
});

// --- IMM-002 --------------------------------------------------------------------------------
describe('IMM-002 charges potentiellement immobilisables', () => {
  it('seuil de 500 € HT : égal au seuil non signalé, strictement supérieur signalé', () => {
    const lignes = [...ecriture('AC1', '2025-03-01', '60630000', '40100000', '500.00', { journal: 'AC' }), ...ecriture('AC2', '2025-03-02', '60630000', '40100000', '500.01', { journal: 'AC' }), ...ecriture('AC3', '2025-03-03', '61500000', '40100000', '2400.00', { journal: 'AC' })];
    const r = un('IMM-002', lignes);
    expect(r.statut).toBe('constat');
    expect(r.constats.map((c) => [c.cle, c.montant, c.gravite])).toEqual([['IMM-002|AC|AC3|61500000|2400.00', '2400.00', 'faible'], ['IMM-002|AC|AC2|60630000|500.01', '500.01', 'faible']]);
    expect(r.constats[0]?.lignesConcernees).toEqual([lignes[4]!.id]);
    expect(r.mesures).toMatchObject({ nbLignesExaminees: '3', totalAuDessusDuSeuil: '2900.01' });
    expect(un('IMM-002', lignes, { seuil: '3000.00' }).statut).toBe('sans_anomalie');
    expect(un('IMM-002', lignes, { seuil: '-1.00' }).statut).toBe('erreur');
  });
  it('comptes exclus (marchandises, énergie, loyers…), crédits et à-nouveaux ignorés ; lignes identiques distinguées', () => {
    const exclus = [...ecriture('AC1', '2025-03-01', '60700000', '40100000', '9000.00'), ...ecriture('AC2', '2025-03-01', '61300000', '40100000', '9000.00'), ...ecriture('AC3', '2025-03-01', '60610000', '40100000', '9000.00'), ...ecriture('AC4', '2025-03-01', '62200000', '40100000', '9000.00')];
    expect(un('IMM-002', exclus)).toMatchObject({ statut: 'non_applicable' });
    expect(un('IMM-002', ecriture('AC1', '2025-03-01', '40100000', '60630000', '9000.00')).statut).toBe('sans_anomalie'); // avoir : crédit
    expect(un('IMM-002', exclus, { prefixesExclus: [] }).constats).toHaveLength(3);
    const doubles = [ligne({ ecritureNum: 'AC9', compteNum: '60630000', debit: '800.00' }), ligne({ ecritureNum: 'AC9', compteNum: '60630000', debit: '800.00' })];
    expect(un('IMM-002', doubles).constats.map((c) => c.cle).sort()).toEqual(['IMM-002|OD|AC9|60630000|800.00', 'IMM-002|OD|AC9|60630000|800.00|2']);
  });
});

// --- SOC-001 --------------------------------------------------------------------------------
describe('SOC-001 cohérence sociale', () => {
  const paie = [ligne({ ecritureNum: 'PA1', compteNum: '64110000', debit: '2000.00' }), ligne({ ecritureNum: 'PA1', compteNum: '64510000', debit: '800.00' }), ligne({ ecritureNum: 'PA1', compteNum: '42100000', credit: '1560.00' }), ligne({ ecritureNum: 'PA1', compteNum: '43100000', credit: '1240.00' })];
  it('salaires et charges présents, comptes créditeurs : sans anomalie ; aucun compte social : non applicable', () => {
    expect(un('SOC-001', paie)).toMatchObject({ statut: 'sans_anomalie', mesures: { totalSalaires: '2000.00', totalChargesSociales: '800.00' } });
    expect(un('SOC-001', ecriture('A', '2025-03-01', '60600000', '51200000', '10.00')).statut).toBe('non_applicable');
  });
  it('salaires sans charges sociales, et l’inverse', () => {
    const sans = [ligne({ ecritureNum: 'PA1', compteNum: '64110000', debit: '2000.00' }), ligne({ ecritureNum: 'PA1', compteNum: '42100000', credit: '2000.00' })];
    expect(un('SOC-001', sans).constats.map((c) => [c.cle, c.montant])).toEqual([['SOC-001|salaires_sans_charges', '2000.00']]);
    const inverse = [ligne({ ecritureNum: 'OD1', compteNum: '64510000', debit: '800.00' }), ligne({ ecritureNum: 'OD1', compteNum: '43100000', credit: '800.00' })];
    expect(un('SOC-001', inverse).constats.map((c) => [c.cle, c.montant])).toEqual([['SOC-001|charges_sans_salaires', '800.00']]);
    // Charges entièrement extournées : équivalent à l'absence.
    const extourne = [...paie, ligne({ ecritureNum: 'OD2', compteNum: '64510000', credit: '800.00' }), ligne({ ecritureNum: 'OD2', compteNum: '43100000', debit: '800.00' })];
    expect(un('SOC-001', extourne).constats.map((c) => c.cle)).toEqual(['SOC-001|salaires_sans_charges']);
  });
  it('comptes 421 et 431 débiteurs à la clôture : constat par compte ; soldés : rien (limite)', () => {
    const tropPaye = [...paie, ...ecriture('BQ1', '2025-06-30', '42100000', '51200000', '1700.00'), ...ecriture('BQ2', '2025-07-15', '43100000', '51200000', '1240.00')];
    const r = un('SOC-001', tropPaye);
    expect(r.constats.map((c) => [c.cle, c.montant])).toEqual([['SOC-001|debiteur|42100000', '140.00']]);
    expect(un('SOC-001', tropPaye, { seuil: '140.00' }).statut).toBe('sans_anomalie');
    expect(un('SOC-001', [...paie, ...ecriture('BQ2', '2025-07-15', '43100000', '51200000', '1300.00')]).constats.map((c) => [c.cle, c.montant])).toEqual([['SOC-001|debiteur|43100000', '60.00']]);
  });
});

// --- CLO-001 --------------------------------------------------------------------------------
describe('CLO-001 césure', () => {
  const facture = (num: string, dateEcriture: string, datePiece: string | null, montant = '600.00'): LigneEcriture[] => [
    ligne({ ecritureNum: num, journalCode: 'AC', ecritureDate: dateEcriture, pieceDate: datePiece, compteNum: '61300000', debit: montant }),
    ligne({ ecritureNum: num, journalCode: 'AC', ecritureDate: dateEcriture, pieceDate: datePiece, compteNum: '40100000', credit: montant }),
  ];
  it('pièce et écriture dans l’exercice : sans anomalie ; bornes incluses', () => {
    expect(un('CLO-001', [...facture('A1', '2025-06-10', '2025-06-08'), ...facture('A2', '2025-12-31', '2025-12-31'), ...facture('A3', '2025-01-01', '2025-01-01')])).toMatchObject({ statut: 'sans_anomalie', mesures: { nbLignesExaminees: '3' } });
  });
  it('pièce postérieure à la clôture ou antérieure à l’ouverture pour une écriture de l’exercice : constat à examiner', () => {
    const r = un('CLO-001', [...facture('A1', '2025-12-20', '2026-01-05'), ...facture('A2', '2025-01-03', '2024-12-28', '250.00'), ...facture('A3', '2025-06-10', '2025-06-08')]);
    expect(r.statut).toBe('constat');
    expect(r.constats.map((c) => [c.cle, c.montant])).toEqual([['CLO-001|AC|A1|2025-12-20|2026-01-05', '600.00'], ['CLO-001|AC|A2|2025-01-03|2024-12-28', '250.00']]);
    expect(r.constats[0]?.titre).toMatch(/postérieure à la clôture.*à examiner/);
    expect(r.constats[1]?.titre).toMatch(/antérieure à l’ouverture/);
    expect(r.constats[0]?.lignesConcernees).toHaveLength(1); // seule la ligne de charge, pas la ligne fournisseur
  });
  it('l’inverse : écriture hors exercice pour une pièce de l’exercice', () => {
    const r = un('CLO-001', facture('A1', '2026-01-08', '2025-12-15'));
    expect(r.constats.map((c) => c.cle)).toEqual(['CLO-001|AC|A1|2026-01-08|2025-12-15']);
    expect(r.constats[0]?.titre).toMatch(/Écriture du 2026-01-08 hors exercice/);
  });
  it('tolérance en jours : limite incluse', () => {
    const l = facture('A1', '2025-12-20', '2026-01-05'); // 5 jours après la clôture
    expect(un('CLO-001', l, { toleranceJours: 5 }).statut).toBe('sans_anomalie');
    expect(un('CLO-001', l, { toleranceJours: 4 }).statut).toBe('constat');
    expect(un('CLO-001', l, { toleranceJours: -1 }).statut).toBe('erreur');
  });
  it('données manquantes : exercice inconnu ou aucune date de pièce → non réalisé ; dates partielles → signalé', () => {
    expect(un('CLO-001', facture('A1', '2025-12-20', '2026-01-05'), undefined, { exercice: null })).toMatchObject({ statut: 'non_realise', motif: expect.stringMatching(/Exercice non précisé/) });
    expect(un('CLO-001', facture('A1', '2025-12-20', null))).toMatchObject({ statut: 'non_realise', motif: expect.stringMatching(/date de pièce/) });
    const partiel = un('CLO-001', [...facture('A1', '2025-06-10', null), ...facture('A2', '2025-06-10', '2025-06-08')]);
    expect(partiel).toMatchObject({ statut: 'sans_anomalie', motif: expect.stringMatching(/1 ligne\(s\).*sans date de pièce/), mesures: { nbLignesSansDatePiece: '1' } });
    expect(un('CLO-001', ecriture('A', '2025-03-01', '51200000', '41100000', '10.00')).statut).toBe('non_applicable');
  });
});

// --- CLO-002 --------------------------------------------------------------------------------
describe('CLO-002 cohérence entre exercices', () => {
  const n1 = [
    ...ecriture('AN1', '2024-01-01', '51200000', '10100000', '5000.00', { journal: 'AN' }),
    ...ecriture('VT1', '2024-06-01', '41100000', '70600000', '1200.00', { journal: 'VT' }),
    ...ecriture('AC1', '2024-07-01', '60600000', '40100000', '300.00', { journal: 'AC' }),
  ];
  const an = (compte: string, sens: 'debit' | 'credit', montant: string): LigneEcriture => ligne({ journalCode: 'AN', ecritureNum: 'AN000001', ecritureDate: '2025-01-01', compteNum: compte, [sens]: montant });
  const ouverture = [an('51200000', 'debit', '5000.00'), an('41100000', 'debit', '1200.00'), an('40100000', 'credit', '300.00'), an('10100000', 'credit', '5000.00'), an('12000000', 'credit', '900.00')];
  it('exercice précédent absent ou journal d’à-nouveaux introuvable : non réalisé', () => {
    expect(un('CLO-002', ouverture)).toMatchObject({ statut: 'non_realise', motif: expect.stringMatching(/exercice précédent non fournies/) });
    expect(un('CLO-002', ouverture, undefined, { exercicePrecedent: { lignes: [] } }).statut).toBe('non_realise');
    expect(un('CLO-002', ouverture.map((l) => ({ ...l, journalCode: 'OUV' })), undefined, { exercicePrecedent: { lignes: n1 } })).toMatchObject({ statut: 'non_realise', motif: expect.stringMatching(/journaux d'à-nouveaux paramétrés \(AN, ANO, RAN\)/) });
  });
  it('à-nouveaux conformes, résultat N-1 non encore viré compris : sans anomalie', () => {
    const r = un('CLO-002', [...ouverture, ...ecriture('VT9', '2025-02-01', '41100000', '70600000', '50.00', { journal: 'VT' })], undefined, { exercicePrecedent: { lignes: n1 } });
    expect(r).toMatchObject({ statut: 'sans_anomalie', mesures: { nbComptesCompares: '5', resultatN1NonVire: '-900.00' } });
    expect(un('CLO-002', ouverture.map((l) => ({ ...l, journalCode: 'OUV' })), { journauxANouveaux: ['OUV'] }, { exercicePrecedent: { lignes: n1 } }).statut).toBe('sans_anomalie');
    // FEC N-1 fourni APRÈS écritures de clôture (résultat déjà en 120, classes 6 et 7 soldées).
    const cloture = [...n1, ligne({ ecritureNum: 'CL1', ecritureDate: '2024-12-31', compteNum: '70600000', debit: '1200.00' }), ligne({ ecritureNum: 'CL1', ecritureDate: '2024-12-31', compteNum: '60600000', credit: '300.00' }), ligne({ ecritureNum: 'CL1', ecritureDate: '2024-12-31', compteNum: '12000000', credit: '900.00' })];
    expect(un('CLO-002', ouverture, undefined, { exercicePrecedent: { lignes: cloture } }).statut).toBe('sans_anomalie');
  });
  it('écart sur un compte, compte non repris, compte apparu : constats par compte', () => {
    const fausse = [an('51200000', 'debit', '4990.00'), an('41100000', 'debit', '1200.00'), an('10100000', 'credit', '5000.00'), an('12000000', 'credit', '900.00'), an('45500000', 'credit', '10.00')];
    const r = un('CLO-002', fausse, undefined, { exercicePrecedent: { lignes: n1 } });
    expect(r.statut).toBe('constat');
    expect(r.constats.map((c) => [c.cle, c.montant]).sort()).toEqual([['CLO-002|40100000', '300.00'], ['CLO-002|45500000', '10.00'], ['CLO-002|51200000', '10.00']]);
    expect(r.constats.every((c) => c.gravite === 'elevee')).toBe(true);
    expect(un('CLO-002', fausse, { tolerance: '300.00' }, { exercicePrecedent: { lignes: n1 } }).statut).toBe('sans_anomalie');
    const resultatFaux = un('CLO-002', ouverture.map((l) => (l.compteNum === '12000000' ? { ...l, credit: '800.00' } : l)), undefined, { exercicePrecedent: { lignes: n1 } });
    expect(resultatFaux.constats.map((c) => [c.cle, c.montant])).toEqual([['CLO-002|résultat (12)', '100.00']]);
    const horsBilan = un('CLO-002', [...ouverture, an('60600000', 'debit', '1.00'), an('70600000', 'credit', '1.00')], undefined, { exercicePrecedent: { lignes: n1 } });
    expect(horsBilan.constats.map((c) => c.cle)).toEqual(['CLO-002|hors_bilan']);
  });
});

// --- TVA-002 --------------------------------------------------------------------------------
describe('TVA-002 TVA déductible (vraisemblance)', () => {
  const achat = (num: string, compte: string, ht: string, tva: string | null): LigneEcriture[] => [
    ligne({ ecritureNum: num, journalCode: 'AC', compteNum: compte, debit: ht }),
    ...(tva === null ? [] : [ligne({ ecritureNum: num, journalCode: 'AC', compteNum: '44566000', debit: tva })]),
  ];
  it('taux apparent sous le maximum : sans anomalie (y compris avec des charges sans TVA)', () => {
    const r = un('TVA-002', [...achat('A1', '60700000', '1000.00', '200.00'), ...achat('A2', '61300000', '500.00', null), ...achat('A3', '21830000', '2000.00', '400.00')]);
    expect(r).toMatchObject({ statut: 'sans_anomalie', mesures: { base: '3500.00', tvaDeductible: '600.00', tauxApparent: '17.1429', tauxMax: '20' } });
    expect(r.constats).toEqual([]);
  });
  it('TVA déduite supérieure au maximum théorique : constat de l’excédent ; tolérance en points', () => {
    const r = un('TVA-002', [...achat('A1', '60700000', '1000.00', '260.00')]);
    expect(r.statut).toBe('constat');
    expect(r.constats.map((c) => [c.cle, c.montant, c.gravite])).toEqual([['TVA-002|global', '60.00', 'moyenne']]);
    expect(r.constats[0]?.explication).toMatch(/vraisemblance/);
    expect(un('TVA-002', achat('A1', '60700000', '1000.00', '200.50')).statut).toBe('sans_anomalie'); // 20,05 % = borne + tolérance
    expect(un('TVA-002', achat('A1', '60700000', '1000.00', '200.51')).statut).toBe('constat');
    expect(un('TVA-002', achat('A1', '60700000', '1000.00', '260.00'), { toleranceTaux: '6.00' }).statut).toBe('sans_anomalie');
  });
  it('plancher facultatif, liquidation, à-nouveaux et crédit de TVA exclus', () => {
    const faible = achat('A1', '60700000', '1000.00', '10.00');
    expect(un('TVA-002', faible).statut).toBe('sans_anomalie');
    expect(un('TVA-002', faible, { tauxPlancher: '5' }).constats.map((c) => c.montant)).toEqual(['40.00']);
    const avecLiquidation = [...achat('A1', '60700000', '1000.00', '200.00'),
      ligne({ ecritureNum: 'OD1', compteNum: '44566000', credit: '200.00' }), ligne({ ecritureNum: 'OD1', compteNum: '44551000', debit: '200.00' }),
      ligne({ ecritureNum: 'AN1', journalCode: 'AN', compteNum: '44566000', debit: '5000.00' }), ligne({ ecritureNum: 'AN1', journalCode: 'AN', compteNum: '21830000', debit: '90000.00' }),
      ligne({ ecritureNum: 'OD2', compteNum: '44567000', debit: '7000.00' })];
    expect(un('TVA-002', avecLiquidation)).toMatchObject({ statut: 'sans_anomalie', mesures: { base: '1000.00', tvaDeductible: '200.00' } });
  });
  it('données insuffisantes : non réalisé, jamais favorable', () => {
    expect(un('TVA-002', ecriture('A', '2025-03-01', '51200000', '41100000', '10.00'))).toMatchObject({ statut: 'non_realise', motif: expect.stringMatching(/cadrage impossible/) });
    expect(un('TVA-002', achat('A1', '60700000', '1000.00', null))).toMatchObject({ statut: 'non_realise', motif: expect.stringMatching(/TVA déductible/) });
    expect(un('TVA-002', [ligne({ compteNum: '60700000', credit: '100.00' }), ligne({ compteNum: '44566000', debit: '5.00' })])).toMatchObject({ statut: 'non_realise', motif: expect.stringMatching(/Base nulle ou négative/) });
  });
});
