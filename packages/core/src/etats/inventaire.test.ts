/** Recette des propositions d'écritures d'inventaire : calculs, équilibre, sources, abstentions. */
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { ligne } from '../aides-tests.js';
import { CLO_001 } from '../controles/cloture.js';
import type { Constat, LigneEcriture } from '../controles/types.js';
import { jeuPrincipal } from '../jeux-etats-tests.js';
import {
  type DemandeInventaire, type ImmobilisationAAmortir, type PropositionEcritureInventaire, REGLES_INVENTAIRE, type ResultatInventaire, lirePeriodeDansLibelle, proposerEcrituresInventaire,
} from './inventaire.js';

const EXERCICE = { debut: '2025-01-01', fin: '2025-12-31' };
const proposer = (d: Partial<DemandeInventaire>): ResultatInventaire => proposerEcrituresInventaire({ lignes: [], exercice: EXERCICE, ...d });

/** Facture d'achat ou de vente à trois lignes (hors taxes, TVA, tiers), identifiants de lignes explicites. */
function facture(prefixe: string, sens: 'achat' | 'vente', date: string, pieceDate: string, compte: string, ht: string, tva: string, ttc: string, lib = 'Facture'): LigneEcriture[] {
  const commun = { ecritureNum: prefixe, ecritureDate: date, pieceDate, pieceRef: `PIECE-${prefixe}`, journalCode: sens === 'achat' ? 'AC' : 'VT', ecritureLib: lib };
  return sens === 'achat'
    ? [ligne({ ...commun, id: `${prefixe}-1`, compteNum: compte, debit: ht }), ligne({ ...commun, id: `${prefixe}-2`, compteNum: '445660', debit: tva }), ligne({ ...commun, id: `${prefixe}-3`, compteNum: '401000', credit: ttc, compAuxNum: 'F001' })]
    : [ligne({ ...commun, id: `${prefixe}-1`, compteNum: '411000', debit: ttc, compAuxNum: 'C001' }), ligne({ ...commun, id: `${prefixe}-2`, compteNum: compte, credit: ht }), ligne({ ...commun, id: `${prefixe}-3`, compteNum: '445710', credit: tva })];
}
function constatsCesure(lignes: readonly LigneEcriture[]): Constat[] {
  return CLO_001.executer({ lignes, exercice: EXERCICE, parametres: {} }).constats;
}
function verifierEquilibre(p: PropositionEcritureInventaire): void {
  const debit = p.lignes.reduce((s, l) => s.plus(new Decimal(l.debit)), new Decimal(0));
  const credit = p.lignes.reduce((s, l) => s.plus(new Decimal(l.credit)), new Decimal(0));
  expect(debit.equals(credit), p.id).toBe(true);
  expect(debit.toFixed(2)).toBe(p.totalDebit);
  expect(credit.toFixed(2)).toBe(p.totalCredit);
  expect(debit.isPositive() && !debit.isZero()).toBe(true);
  expect(p.equilibree).toBe(true);
  expect(p.statut).toBe('proposee');
  expect(p.hypotheses.length).toBeGreaterThan(1);
  expect(p.hypotheses.at(-1)).toMatch(/non comptabilisée/);
  expect(p.calcul.length).toBeGreaterThan(0);
  expect(p.justification.length).toBeGreaterThan(20);
  expect(p.lignes.every((l) => /^\d+\.\d{2}$/.test(l.debit) && /^\d+\.\d{2}$/.test(l.credit) && (l.debit === '0.00') !== (l.credit === '0.00'))).toBe(true);
  expect(p.source.verification).toBe('verifiee');
}

describe('lecture d’une période dans un libellé', () => {
  it('ne retient qu’une période complète et unique', () => {
    expect(lirePeriodeDansLibelle('Loyer du 01/10/2025 au 30/09/2026')).toEqual({ etat: 'lue', debut: '2025-10-01', fin: '2026-09-30', extrait: '01/10/2025 au 30/09/2026' });
    expect(lirePeriodeDansLibelle('ASSURANCE 1/7/2025 - 30/6/2026 RC PRO')).toMatchObject({ etat: 'lue', debut: '2025-07-01', fin: '2026-06-30' });
    expect(lirePeriodeDansLibelle('Abonnement 01.01.2026-31.12.2026')).toMatchObject({ etat: 'lue', debut: '2026-01-01', fin: '2026-12-31' });
    expect(lirePeriodeDansLibelle('Facture du 12/03/2025')).toEqual({ etat: 'aucune' });
    expect(lirePeriodeDansLibelle('Loyer T4')).toEqual({ etat: 'aucune' });
    expect(lirePeriodeDansLibelle('')).toEqual({ etat: 'aucune' });
  });

  it('s’abstient sur une période ambiguë, incomplète ou impossible', () => {
    expect(lirePeriodeDansLibelle('Loyer du 01/10/25 au 30/09/26')).toMatchObject({ etat: 'illisible', motif: expect.stringMatching(/deux chiffres/) });
    expect(lirePeriodeDansLibelle('du 01/01/2026 au 31/03/2026 et du 01/04/2026 au 30/06/2026')).toMatchObject({ etat: 'illisible', motif: expect.stringMatching(/plusieurs périodes/) });
    expect(lirePeriodeDansLibelle('du 31/02/2026 au 31/03/2026')).toMatchObject({ etat: 'illisible', motif: expect.stringMatching(/n’existe pas/) });
    expect(lirePeriodeDansLibelle('du 01/10/2026 au 30/09/2026')).toMatchObject({ etat: 'illisible', motif: expect.stringMatching(/fin précède/) });
  });
});

describe('charges et produits constatés d’avance', () => {
  it('propose une charge constatée d’avance au prorata des jours, à partir du libellé', () => {
    const lignes = facture('AC1', 'achat', '2025-10-01', '2025-10-01', '613000', '1200.00', '240.00', '1440.00', 'Loyer du 01/10/2025 au 30/09/2026');
    const r = proposer({ lignes });
    expect(r.abstentions).toEqual([]);
    expect(r.propositions).toHaveLength(1);
    const p = r.propositions[0] as PropositionEcritureInventaire;
    verifierEquilibre(p);
    // 365 jours du 01/10/2025 au 30/09/2026, dont 273 après le 31/12/2025 : 1 200 × 273 ÷ 365 = 897,534… → 897,53.
    expect(p).toMatchObject({
      id: 'INV-CCA|AC1-1', type: 'charge_constatee_avance', dateEcriture: '2025-12-31', extourneLe: '2026-01-01',
      origine: { regle: 'INV-CCA', versionRegle: '1.0.0', signal: 'Période « 01/10/2025 au 30/09/2026 » lue dans le libellé de l’écriture.' },
      lignes: [{ compteNum: '486000', libelle: 'Charges constatées d’avance', debit: '897.53', credit: '0.00' }, { compteNum: '613000', libelle: 'Compte 613000', debit: '0.00', credit: '897.53' }],
      totalDebit: '897.53', totalCredit: '897.53',
      sources: { lignesEcritures: ['AC1-1'], ecritures: [{ journalCode: 'AC', ecritureNum: 'AC1', ecritureDate: '2025-10-01' }], pieces: ['PIECE-AC1'], constats: [], immobilisation: null },
      impacts: { resultat: '897.53', totalActif: '897.53', totalPassif: '897.53' },
    });
    expect(p.calcul).toEqual([
      { libelle: 'Montant de la ligne (hors taxes)', valeur: '1200.00' }, { libelle: 'Période couverte', valeur: '2025-10-01 au 2026-09-30' }, { libelle: 'Jours de la période (bornes incluses)', valeur: '365' },
      { libelle: 'Jours postérieurs à la clôture', valeur: '273 (du 2026-01-01 au 2026-09-30)' }, { libelle: 'Formule', valeur: '1200.00 × 273 ÷ 365' }, { libelle: 'Charge constatée d’avance', valeur: '897.53' },
    ]);
    expect(p.hypotheses.join(' ')).toMatch(/libellé d’écriture, contenu non fiable/);
    expect(p.hypotheses.join(' ')).toMatch(/Aucun compte 486 dans les écritures/);
    expect(r.totaux).toEqual({ nbPropositions: 1, nbAbstentions: 0, impactResultat: '897.53', impactTotalActif: '897.53', impactTotalPassif: '897.53' });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('propose un produit constaté d’avance sur une période fournie par le cabinet', () => {
    const lignes = facture('VT1', 'vente', '2025-07-01', '2025-07-01', '706000', '3650.00', '730.00', '4380.00', 'Contrat de maintenance annuel');
    const r = proposer({ lignes, periodesCouvertes: [{ ligneId: 'VT1-2', debut: '2025-07-01', fin: '2026-06-30' }] });
    expect(r.abstentions).toEqual([]);
    const p = r.propositions[0] as PropositionEcritureInventaire;
    verifierEquilibre(p);
    // 365 jours, dont 181 du 01/01/2026 au 30/06/2026 : 3 650 × 181 ÷ 365 = 1 810,00.
    expect(p).toMatchObject({
      id: 'INV-PCA|VT1-2', type: 'produit_constate_avance', extourneLe: '2026-01-01',
      lignes: [{ compteNum: '706000', debit: '1810.00', credit: '0.00' }, { compteNum: '487000', libelle: 'Produits constatés d’avance', debit: '0.00', credit: '1810.00' }],
      impacts: { resultat: '-1810.00', totalActif: '0.00', totalPassif: '0.00' },
    });
    expect(p.origine.signal).toBe('Période couverte du 2025-07-01 au 2026-06-30 fournie par le cabinet.');
  });

  it('retient 100 % d’une charge dont la période commence après la clôture, et reprend le compte 486 du dossier', () => {
    const lignes = [
      ...facture('AC2', 'achat', '2025-12-15', '2025-12-15', '616000', '600.00', '0.00', '600.00', 'Assurance du 01/01/2026 au 31/12/2026'),
      ligne({ id: 'OD-1', compteNum: '486100', debit: '10.00', ecritureDate: '2025-12-31', ecritureNum: 'OD9' }), ligne({ id: 'OD-2', compteNum: '606000', credit: '10.00', ecritureDate: '2025-12-31', ecritureNum: 'OD9' }),
    ];
    const p = proposer({ lignes }).propositions[0] as PropositionEcritureInventaire;
    verifierEquilibre(p);
    expect(p.lignes[0]).toEqual({ compteNum: '486100', libelle: 'Charges constatées d’avance', debit: '600.00', credit: '0.00' });
    expect(p.hypotheses.join(' ')).toMatch(/Compte 486100 repris des écritures du dossier/);
    expect(p.hypotheses.join(' ')).toMatch(/déjà mouvementé à la date de clôture.*doublon/);
  });

  it('ne propose rien quand la période s’achève avant la clôture ou quand les libellés ne sont pas lus', () => {
    const dansExercice = facture('AC3', 'achat', '2025-03-01', '2025-03-01', '613000', '900.00', '180.00', '1080.00', 'Loyer du 01/03/2025 au 31/05/2025');
    expect(proposer({ lignes: dansExercice })).toMatchObject({ propositions: [], abstentions: [] });
    const apres = facture('AC4', 'achat', '2025-10-01', '2025-10-01', '613000', '1200.00', '240.00', '1440.00', 'Loyer du 01/10/2025 au 30/09/2026');
    expect(proposer({ lignes: apres, lireLibelles: false })).toMatchObject({ propositions: [], abstentions: [] });
    // Une écriture de l'exercice suivant n'est pas régularisée à la clôture.
    const suivant = facture('AC5', 'achat', '2026-01-05', '2026-01-05', '613000', '1200.00', '240.00', '1440.00', 'Loyer du 01/01/2026 au 31/12/2026');
    expect(proposer({ lignes: suivant })).toMatchObject({ propositions: [], abstentions: [] });
  });

  it('s’abstient avec un motif dès qu’une donnée manque ou qu’un cas est ambigu', () => {
    const lignes = [
      ...facture('A', 'achat', '2025-10-01', '2025-10-01', '613000', '1200.00', '240.00', '1440.00', 'Loyer du 01/10/25 au 30/09/26'),
      ...facture('B', 'achat', '2025-11-01', '2025-11-01', '616000', '500.00', '0.00', '500.00'),
      ...facture('C', 'achat', '2025-11-02', '2025-11-02', '615000', '400.00', '80.00', '480.00'),
      ligne({ id: 'D-1', compteNum: '613000', credit: '300.00', ecritureDate: '2025-11-03', ecritureNum: 'D', ecritureLib: 'Avoir loyer du 01/11/2025 au 31/01/2026' }),
      ligne({ id: 'E-1', compteNum: '681120', debit: '300.00', ecritureDate: '2025-12-31', ecritureNum: 'E', ecritureLib: 'Dotation du 01/01/2025 au 31/12/2026' }),
      ...facture('F', 'achat', '2026-02-01', '2026-02-01', '613000', '100.00', '20.00', '120.00'),
      ...facture('G', 'achat', '2025-06-01', '2025-06-01', '613000', '100.00', '20.00', '120.00'),
      ...facture('H', 'achat', '2025-06-02', '2025-06-02', '613000', '100.00', '20.00', '120.00'),
    ];
    const r = proposer({
      lignes,
      periodesCouvertes: [
        { ligneId: 'B-1', fin: '2026-10-31' }, { ligneId: 'C-1', debut: '2025-01-01', fin: '2025-12-31' }, { ligneId: 'C-3', debut: '2025-11-01', fin: '2026-10-31' }, { ligneId: 'F-1', debut: '2026-02-01', fin: '2027-01-31' },
        { ligneId: 'INCONNUE', debut: '2025-11-01', fin: '2026-10-31' }, { ligneId: 'G-1', debut: '2026-11-01', fin: '2026-10-31' }, { ligneId: 'H-1', debut: '2025-06-02', fin: '2026-06-01' }, { ligneId: 'H-1', debut: '2025-06-02', fin: '2026-12-01' },
      ],
    });
    expect(r.propositions).toEqual([]);
    expect(r.abstentions.map((a) => [a.code, a.sources.lignesEcritures[0]]).sort()).toEqual([
      ['compte_exclu', 'E-1'], ['compte_hors_perimetre', 'C-3'], ['debut_de_periode_manquant', 'B-1'], ['ecriture_hors_exercice', 'F-1'], ['ligne_introuvable', 'INCONNUE'],
      ['periode_dans_exercice', 'C-1'], ['periode_en_double', 'H-1'], ['periode_illisible', 'A-1'], ['periode_invalide', 'G-1'], ['sens_inverse', 'D-1'],
    ]);
    expect(r.abstentions.find((a) => a.code === 'debut_de_periode_manquant')?.motif).toMatch(/premier jour n’est pas fourni : prorata non calculable/);
    expect(r.abstentions.every((a) => a.motif.length > 20)).toBe(true);
    expect(r.totaux).toMatchObject({ nbPropositions: 0, nbAbstentions: 10, impactResultat: '0.00' });
  });
});

describe('factures non parvenues et factures à établir', () => {
  it('propose une facture non parvenue à partir d’un constat de césure', () => {
    const lignes = [...jeuPrincipal(2025), ...facture('AC900', 'achat', '2026-01-10', '2025-12-20', '606000', '1000.00', '200.00', '1200.00')];
    const constats = constatsCesure(lignes);
    expect(constats).toHaveLength(1);
    const r = proposer({ lignes, constatsCesure: constats });
    expect(r.abstentions).toEqual([]);
    const p = r.propositions[0] as PropositionEcritureInventaire;
    verifierEquilibre(p);
    expect(p).toMatchObject({
      id: 'INV-FNP|AC|AC900|2026-01-10', type: 'facture_non_parvenue', dateEcriture: '2025-12-31', extourneLe: '2026-01-01',
      lignes: [
        { compteNum: '606000', libelle: 'Compte 606000', debit: '1000.00', credit: '0.00' },
        { compteNum: '445860', libelle: 'Taxes sur le chiffre d’affaires sur factures non parvenues', debit: '200.00', credit: '0.00' },
        { compteNum: '408000', libelle: 'Fournisseurs - Factures non parvenues', debit: '0.00', credit: '1200.00' },
      ],
      sources: { lignesEcritures: ['AC900-1', 'AC900-2', 'AC900-3'], pieces: ['PIECE-AC900'], constats: ['CLO-001|AC|AC900|2026-01-10|2025-12-20'], immobilisation: null },
      impacts: { resultat: '-1000.00', totalActif: '200.00', totalPassif: '200.00' },
    });
    expect(p.origine.signal).toMatch(/postérieure à la clôture, sur une pièce datée du 2025-12-20/);
    expect(p.hypotheses[0]).toMatch(/La date de pièce n’est qu’un indice/);
    expect(p.calcul.at(-1)).toEqual({ libelle: 'Total toutes taxes comprises', valeur: '1000.00 + 200.00 = 1200.00' });
  });

  it('propose une facture à établir, sans ligne de TVA quand l’écriture n’en porte pas', () => {
    const vente = facture('VT900', 'vente', '2026-01-05', '2025-12-28', '706000', '2000.00', '400.00', '2400.00');
    const sansTva = [
      ligne({ id: 'X-1', compteNum: '411000', debit: '500.00', ecritureDate: '2026-01-06', pieceDate: '2025-12-30', ecritureNum: 'VT901', journalCode: 'VT', pieceRef: '' }),
      ligne({ id: 'X-2', compteNum: '706000', credit: '500.00', ecritureDate: '2026-01-06', pieceDate: '2025-12-30', ecritureNum: 'VT901', journalCode: 'VT', pieceRef: '' }),
    ];
    const lignes = [...vente, ...sansTva];
    const r = proposer({ lignes, constatsCesure: constatsCesure(lignes) });
    expect(r.abstentions).toEqual([]);
    expect(r.propositions.map((p) => p.id)).toEqual(['INV-FAE|VT|VT900|2026-01-05', 'INV-FAE|VT|VT901|2026-01-06']);
    r.propositions.forEach(verifierEquilibre);
    expect(r.propositions[0]).toMatchObject({
      type: 'facture_a_etablir',
      lignes: [{ compteNum: '418100', debit: '2400.00', credit: '0.00' }, { compteNum: '706000', debit: '0.00', credit: '2000.00' }, { compteNum: '445870', debit: '0.00', credit: '400.00' }],
      impacts: { resultat: '2000.00', totalActif: '2400.00', totalPassif: '2400.00' },
    });
    expect(r.propositions[1]?.lignes).toEqual([{ compteNum: '418100', libelle: 'Clients - Factures à établir', debit: '500.00', credit: '0.00' }, { compteNum: '706000', libelle: 'Compte 706000', debit: '0.00', credit: '500.00' }]);
    expect(r.propositions[1]?.libelle).toBe('Facture à établir - pièce VT VT901 du 2025-12-30');
    expect(r.totaux).toMatchObject({ nbPropositions: 2, impactResultat: '2500.00', impactTotalActif: '2900.00', impactTotalPassif: '2900.00' });
  });

  it('utilise les comptes fournis par le cabinet', () => {
    const lignes = facture('AC900', 'achat', '2026-01-10', '2025-12-20', '606000', '1000.00', '200.00', '1200.00');
    const p = proposer({ lignes, constatsCesure: constatsCesure(lignes), options: { comptes: { facturesNonParvenues: '40810000', tvaSurFacturesNonParvenues: '44586000' } } }).propositions[0] as PropositionEcritureInventaire;
    expect(p.lignes.map((l) => l.compteNum)).toEqual(['606000', '44586000', '40810000']);
    expect(() => proposer({ lignes, constatsCesure: constatsCesure(lignes), options: { comptes: { facturesNonParvenues: '408-A' } } })).toThrow(/comptes\.facturesNonParvenues/);
  });

  it('s’abstient sur les situations de césure qu’il ne sait pas traduire en écriture', () => {
    const lignes = [
      // Comptabilisée dans l'exercice sur une pièce postérieure à la clôture : période couverte inconnue.
      ...facture('A', 'achat', '2025-12-28', '2026-01-03', '613000', '900.00', '180.00', '1080.00'),
      // Pièce de l'exercice précédent comptabilisée dans l'exercice.
      ...facture('B', 'achat', '2025-01-08', '2024-12-18', '606000', '100.00', '20.00', '120.00'),
      // Écriture postérieure à la clôture, non réductible (règlement comptant par la banque).
      ligne({ id: 'C-1', compteNum: '625000', debit: '80.00', ecritureDate: '2026-01-04', pieceDate: '2025-12-30', ecritureNum: 'BQ7', journalCode: 'BQ' }),
      ligne({ id: 'C-2', compteNum: '512000', credit: '80.00', ecritureDate: '2026-01-04', pieceDate: '2025-12-30', ecritureNum: 'BQ7', journalCode: 'BQ' }),
      // Avoir fournisseur passé après la clôture.
      ligne({ id: 'D-1', compteNum: '401000', debit: '60.00', ecritureDate: '2026-01-07', pieceDate: '2025-12-29', ecritureNum: 'AC8', journalCode: 'AC' }),
      ligne({ id: 'D-2', compteNum: '607000', credit: '50.00', ecritureDate: '2026-01-07', pieceDate: '2025-12-29', ecritureNum: 'AC8', journalCode: 'AC' }),
      ligne({ id: 'D-3', compteNum: '445660', credit: '10.00', ecritureDate: '2026-01-07', pieceDate: '2025-12-29', ecritureNum: 'AC8', journalCode: 'AC' }),
    ];
    const constats = constatsCesure(lignes);
    expect(constats).toHaveLength(4);
    const etranger: Constat = { ...(constats[0] as Constat), cle: 'TVA-001|x' };
    const orphelin: Constat = { ...(constats[0] as Constat), cle: 'CLO-001|ZZ|1|2026-01-01|2025-12-01', lignesConcernees: ['ABSENTE'] };
    const r = proposer({ lignes, constatsCesure: [...constats, etranger, orphelin, constats[0] as Constat] });
    expect(r.propositions).toEqual([]);
    expect(r.abstentions.map((a) => a.code).sort()).toEqual(['ecriture_non_reductible', 'lignes_introuvables', 'piece_anterieure_a_l_ouverture', 'piece_posterieure_a_la_cloture', 'sens_inverse']);
    expect(r.abstentions.find((a) => a.code === 'piece_posterieure_a_la_cloture')?.motif).toMatch(/Fournir la période couverte/);
    expect(r.abstentions.every((a) => a.sources.constat !== null)).toBe(true);
    // Avec la période fournie, la situation devient une charge constatée d'avance calculable.
    const avecPeriode = proposer({ lignes, constatsCesure: constats, periodesCouvertes: [{ ligneId: 'A-1', debut: '2025-12-01', fin: '2026-02-28' }] });
    expect(avecPeriode.propositions.map((p) => [p.id, p.totalDebit])).toEqual([['INV-CCA|A-1', '590.00']]);
  });
});

describe('dotations aux amortissements linéaires', () => {
  const immo = (surcharge: Partial<ImmobilisationAAmortir> = {}): ImmobilisationAAmortir => ({ id: 'IMMO-1', libelle: 'Matériel informatique', compteImmobilisation: '218300', baseAmortissable: '10000.00', dateMiseEnService: '2025-01-01', dureeMois: 60, ...surcharge });
  const une = (i: ImmobilisationAAmortir, options?: DemandeInventaire['options']): ResultatInventaire => proposer(options === undefined ? { immobilisations: [i] } : { immobilisations: [i], options });

  it('calcule une annuité complète en base 360 et dérive les comptes', () => {
    const r = une(immo());
    expect(r.abstentions).toEqual([]);
    const p = r.propositions[0] as PropositionEcritureInventaire;
    verifierEquilibre(p);
    expect(p).toMatchObject({
      id: 'INV-AMORT|IMMO-1', type: 'dotation_amortissement_lineaire', extourneLe: null,
      lignes: [{ compteNum: '681120', debit: '2000.00', credit: '0.00' }, { compteNum: '281830', libelle: 'Amortissements - Matériel informatique', debit: '0.00', credit: '2000.00' }],
      sources: { lignesEcritures: [], ecritures: [], pieces: [], constats: [], immobilisation: 'IMMO-1' },
      impacts: { resultat: '-2000.00', totalActif: '-2000.00', totalPassif: '-2000.00' },
    });
    expect(p.calcul.find((c) => c.libelle === 'Formule')?.valeur).toBe('10000.00 × 360 ÷ 1800 = 2000.00');
    expect(p.hypotheses.join(' ')).toMatch(/année de 360 jours/);
    expect(p.hypotheses.join(' ')).toMatch(/Amortissements antérieurs non fournis/);
  });

  it('applique le prorata à compter de la mise en service', () => {
    expect(une(immo({ dateMiseEnService: '2025-07-01' })).propositions[0]?.totalDebit).toBe('1000.00');
    // 16 jours en mars (du 15 au 30) + 9 mois de 30 jours = 286 jours : 10 000 × 286 ÷ 1 800 = 1 588,888… → 1 588,89.
    expect(une(immo({ dateMiseEnService: '2025-03-15' })).propositions[0]?.totalDebit).toBe('1588.89');
    // Le dernier jour d'un mois compte pour le 30 : mise en service le 31 décembre = 1 jour.
    expect(une(immo({ dateMiseEnService: '2025-12-31' })).propositions[0]?.totalDebit).toBe('5.56');
    // Exercice suivant une mise en service antérieure : annuité complète.
    expect(une(immo({ dateMiseEnService: '2023-04-10' })).propositions[0]?.totalDebit).toBe('2000.00');
  });

  it('sait compter en jours réels', () => {
    // Plan du 01/01/2025 au 31/12/2029 = 1 826 jours ; exercice 2025 = 365 jours : 10 000 × 365 ÷ 1 826 = 1 998,904… → 1 998,90.
    const p = une(immo(), { conventionJoursAmortissement: 'jours_reels' }).propositions[0] as PropositionEcritureInventaire;
    verifierEquilibre(p);
    expect(p.totalDebit).toBe('1998.90');
    expect(p.calcul.find((c) => c.libelle === 'Jours du plan')?.valeur).toBe('1826');
    expect(p.calcul.find((c) => c.libelle === 'Convention de décompte des jours')?.valeur).toBe('jours réels (fin du plan le 2029-12-31)');
  });

  it('solde le plan sur les amortissements antérieurs fournis et signale les écarts', () => {
    const fin = une(immo({ dateMiseEnService: '2021-01-01', amortissementsAnterieurs: '8000.01' })).propositions[0] as PropositionEcritureInventaire;
    verifierEquilibre(fin);
    expect(fin.totalDebit).toBe('1999.99');
    expect(fin.calcul.map((c) => c.libelle)).toContain('Le plan s’achève dans l’exercice : dotation = reste à amortir');
    expect(fin.hypotheses.join(' ')).toMatch(/diffèrent du cumul théorique à l’ouverture \(8000\.00\)/);
    const plafonnee = une(immo({ dateMiseEnService: '2023-01-01', amortissementsAnterieurs: '9000.00' })).propositions[0] as PropositionEcritureInventaire;
    expect(plafonnee.totalDebit).toBe('1000.00');
    expect(plafonnee.calcul.map((c) => c.libelle)).toContain('Dotation plafonnée au reste à amortir');
    const conforme = une(immo({ dateMiseEnService: '2024-01-01', amortissementsAnterieurs: '2000.00' })).propositions[0] as PropositionEcritureInventaire;
    expect(conforme.totalDebit).toBe('2000.00');
    expect(conforme.hypotheses.join(' ')).not.toMatch(/diffèrent/);
  });

  it('s’abstient, motif à l’appui, si une donnée manque ou est invalide — jamais d’estimation', () => {
    const cas: Array<[Partial<ImmobilisationAAmortir>, string, RegExp]> = [
      [{ baseAmortissable: null }, 'donnee_manquante', /base amortissable non fournie/],
      [{ dateMiseEnService: null, dureeMois: null }, 'donnee_manquante', /date de mise en service, durée d’amortissement non fournie/],
      [{ baseAmortissable: '0.00' }, 'donnee_invalide', /base amortissable invalide/],
      [{ baseAmortissable: '1e4' }, 'donnee_invalide', /base amortissable invalide/],
      [{ dateMiseEnService: '2025-02-30' }, 'donnee_invalide', /date de mise en service invalide/],
      [{ dureeMois: 0 }, 'donnee_invalide', /durée invalide/],
      [{ dureeMois: 12.5 }, 'donnee_invalide', /durée invalide/],
      [{ amortissementsAnterieurs: '-1.00' }, 'donnee_invalide', /amortissements antérieurs invalides/],
      [{ compteImmobilisation: '21' }, 'donnee_invalide', /compte d’immobilisation invalide/],
      [{ dateMiseEnService: '2026-01-01' }, 'mise_en_service_posterieure', /après la clôture/],
      [{ dateMiseEnService: '2019-01-01' }, 'plan_acheve', /achevé avant l’ouverture/],
      [{ dateMiseEnService: '2019-01-01', amortissementsAnterieurs: '9000.00' }, 'plan_acheve', /plan à revoir/],
      [{ dateMiseEnService: '2022-01-01', amortissementsAnterieurs: '10000.00' }, 'totalement_amorti', /atteignent ou dépassent la base/],
      [{ compteImmobilisation: '261000' }, 'compte_a_fournir', /fournir « compteAmortissement »/],
      [{ compteImmobilisation: '261000', compteAmortissement: '296100' }, 'compte_a_fournir', /fournir « compteDotation »/],
    ];
    for (const [surcharge, code, motif] of cas) {
      const r = une(immo(surcharge));
      expect(r.propositions, code).toEqual([]);
      expect(r.abstentions, code).toHaveLength(1);
      expect(r.abstentions[0], code).toMatchObject({ type: 'dotation_amortissement_lineaire', code, sources: { immobilisation: 'IMMO-1', lignesEcritures: [], constat: null } });
      expect(r.abstentions[0]?.motif).toMatch(motif);
    }
    const doublon = proposer({ immobilisations: [immo(), immo()] });
    expect(doublon.propositions).toHaveLength(1);
    expect(doublon.abstentions.map((a) => a.code)).toEqual(['immobilisation_en_double']);
  });

  it('accepte des comptes fournis et un compte d’immobilisation court', () => {
    const fournis = une(immo({ compteImmobilisation: '261000', compteAmortissement: '280000', compteDotation: '681100' })).propositions[0] as PropositionEcritureInventaire;
    expect(fournis.lignes.map((l) => l.compteNum)).toEqual(['681100', '280000']);
    const court = une(immo({ compteImmobilisation: '2183' })).propositions[0] as PropositionEcritureInventaire;
    expect(court.lignes.map((l) => l.compteNum)).toEqual(['68112', '28183']);
    const incorporel = une(immo({ compteImmobilisation: '205000' })).propositions[0] as PropositionEcritureInventaire;
    expect(incorporel.lignes.map((l) => l.compteNum)).toEqual(['681110', '280500']);
  });
});

describe('ensemble', () => {
  it('trie les propositions, les équilibre toutes et ne comptabilise rien', () => {
    const lignes = [
      ...jeuPrincipal(2025),
      ...facture('AC1', 'achat', '2025-10-01', '2025-10-01', '613000', '1200.00', '240.00', '1440.00', 'Loyer du 01/10/2025 au 30/09/2026'),
      ...facture('VT1', 'vente', '2025-07-01', '2025-07-01', '706000', '3650.00', '730.00', '4380.00', 'Maintenance du 01/07/2025 au 30/06/2026'),
      ...facture('AC900', 'achat', '2026-01-10', '2025-12-20', '606000', '1000.00', '200.00', '1200.00'),
      ...facture('VT900', 'vente', '2026-01-05', '2025-12-28', '706000', '2000.00', '400.00', '2400.00'),
    ];
    const avant = JSON.stringify(lignes);
    const demande: DemandeInventaire = { lignes, exercice: EXERCICE, constatsCesure: constatsCesure(lignes), immobilisations: [{ id: 'IMMO-1', libelle: 'Matériel', compteImmobilisation: '218300', baseAmortissable: '10000.00', dateMiseEnService: '2024-01-01', dureeMois: 60, amortissementsAnterieurs: '2000.00' }] };
    const r = proposerEcrituresInventaire(demande);
    expect(JSON.stringify(lignes)).toBe(avant);
    expect(r.statut).toBe('projet');
    expect(r.mention).toMatch(/en attente de validation professionnelle/);
    expect(r.propositions.map((p) => p.type)).toEqual(['charge_constatee_avance', 'produit_constate_avance', 'facture_non_parvenue', 'facture_a_etablir', 'dotation_amortissement_lineaire']);
    r.propositions.forEach(verifierEquilibre);
    expect(r.abstentions).toEqual([]);
    // 897,53 − 1 810,00 − 1 000,00 + 2 000,00 − 2 000,00
    expect(r.totaux).toEqual({ nbPropositions: 5, nbAbstentions: 0, impactResultat: '-1912.47', impactTotalActif: '1497.53', impactTotalPassif: '1497.53' });
    expect(r.regles.map((x) => x.id)).toEqual(['INV-CCA', 'INV-PCA', 'INV-FNP', 'INV-FAE', 'INV-AMORT']);
    expect(r.conventions.length).toBeGreaterThan(3);
    // Déterminisme : même demande, même résultat.
    expect(proposerEcrituresInventaire(demande)).toEqual(r);
    // Le compte 681120 est déjà mouvementé à la clôture dans le jeu : la proposition CCA n'en dit rien, mais reprend bien un compte existant pour 28.
    expect(r.propositions[4]?.lignes[1]?.compteNum).toBe('281830');
  });

  it('ne produit rien sans signal et refuse un exercice invalide', () => {
    expect(proposer({ lignes: jeuPrincipal(2025) })).toMatchObject({ propositions: [], abstentions: [], totaux: { nbPropositions: 0, nbAbstentions: 0, impactResultat: '0.00' } });
    expect(proposer({})).toMatchObject({ propositions: [], abstentions: [] });
    expect(() => proposerEcrituresInventaire({ lignes: [], exercice: { debut: '2025-12-31', fin: '2025-01-01' } })).toThrow(/Exercice invalide/);
    expect(() => proposerEcrituresInventaire({ lignes: [], exercice: { debut: '2025', fin: '2025-12-31' } })).toThrow(/Exercice invalide/);
  });

  it('documente ses règles avec des sources vérifiées', () => {
    expect(REGLES_INVENTAIRE).toHaveLength(5);
    expect(REGLES_INVENTAIRE.every((r) => r.version === '1.0.0' && r.source.type === 'reglementaire' && r.source.verification === 'verifiee' && r.source.dateVerification === '2026-11-19')).toBe(true);
  });
});
