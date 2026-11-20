/** Recette des propositions d'écritures d'inventaire : calculs, équilibre, sources, abstentions. */
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { ligne } from '../aides-tests.js';
import { CLO_001 } from '../controles/cloture.js';
import type { Constat, LigneEcriture } from '../controles/types.js';
import { jeuPrincipal } from '../jeux-etats-tests.js';
import {
  type DemandeInventaire, MOTIF_DEGRESSIF_NON_ACTIVE, type ImmobilisationAAmortir, type PropositionEcritureInventaire, REGLES_INVENTAIRE, type ResultatInventaire, lirePeriodeDansLibelle, proposerEcrituresInventaire,
} from './inventaire.js';
import { SOURCES_FISCALES } from './sources-fiscales.js';

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
    const demande: DemandeInventaire = { lignes: lignes.filter((l) => l.compteNum !== '681120'), exercice: EXERCICE, constatsCesure: constatsCesure(lignes), immobilisations: [{ id: 'IMMO-1', libelle: 'Matériel', compteImmobilisation: '218300', baseAmortissable: '10000.00', dateMiseEnService: '2024-01-01', dureeMois: 60, amortissementsAnterieurs: '2000.00' }] };
    const r = proposerEcrituresInventaire(demande);
    expect(JSON.stringify(lignes)).toBe(avant);
    expect(r.statut).toBe('projet');
    expect(r.mention).toMatch(/en attente de validation professionnelle/);
    expect(r.propositions.map((p) => p.type)).toEqual(['charge_constatee_avance', 'produit_constate_avance', 'facture_non_parvenue', 'facture_a_etablir', 'dotation_amortissement_lineaire']);
    r.propositions.forEach(verifierEquilibre);
    expect(r.abstentions).toEqual([]);
    // 897,53 − 1 810,00 − 1 000,00 + 2 000,00 − 2 000,00
    expect(r.totaux).toEqual({ nbPropositions: 5, nbAbstentions: 0, impactResultat: '-1912.47', impactTotalActif: '1497.53', impactTotalPassif: '1497.53' });
    expect(r.regles.map((x) => x.id)).toEqual(['INV-CCA', 'INV-PCA', 'INV-FNP', 'INV-FAE', 'INV-AMORT', 'INV-AMORT-DEG']);
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
    expect(REGLES_INVENTAIRE).toHaveLength(6);
    expect(REGLES_INVENTAIRE.every((r) => r.source.type === 'reglementaire' && r.source.verification === 'verifiee' && ['2026-11-19', '2026-11-20'].includes(r.source.dateVerification ?? ''))).toBe(true);
    // Les règles d'amortissement portent la date de consultation du 2026-11-20 ; le CGI art. 39 A reste « non vérifié en ligne ».
    expect(REGLES_INVENTAIRE.find((r) => r.id === 'INV-AMORT-DEG')?.source.dateVerification).toBe('2026-11-20');
    expect(SOURCES_FISCALES.cgiArticle39A).toMatchObject({ verification: 'non_verifiee', dateVerification: '2026-11-20' });
    expect(SOURCES_FISCALES.amortissementDegressif.periodeApplication).toMatch(/en vigueur du 12\/09\/2012 à aujourd/i);
    expect(SOURCES_FISCALES.cgiArticle39A.url).toBeNull();
    for (const cle of ['amortissementDegressif', 'bofipBiensEligibles', 'bofipBiensDecomposes', 'bofipEntreprisesConcernees', 'bofipLineaire'] as const) {
      expect(SOURCES_FISCALES[cle], cle).toMatchObject({ verification: 'verifiee', dateVerification: '2026-11-20' });
      expect(SOURCES_FISCALES[cle].url, cle).toMatch(/^https:\/\/bofip\.impots\.gouv\.fr\/bofip\/\d+-PGP\.html\/identifiant%3DBOI-BIC-AMT-/);
      expect(SOURCES_FISCALES[cle].periodeApplication, cle).toMatch(/non validée par un professionnel/);
    }
  });
});

// ───────────────────────────── Amortissement dégressif, résiduelle, sortie, composants, rapprochement ─────────────────────────────

const somme = (valeurs: string[]): string => valeurs.reduce((t, v) => t.plus(new Decimal(v)), new Decimal(0)).toFixed(2);
const immoDeg = (surcharge: Partial<ImmobilisationAAmortir> = {}): ImmobilisationAAmortir => ({
  id: 'DEG-1', libelle: 'Machine-outil', compteImmobilisation: '215400', baseAmortissable: '10000.00', dateMiseEnService: '2025-11-15', dureeMois: 120,
  // Date d'acquisition par défaut : novembre (BOFiP § 350 et 360) ; si le test déplace la mise en service, l'acquisition la suit (même date), sauf si elle est fixée.
  dateAcquisition: surcharge.dateMiseEnService ?? '2025-11-05',
  modeAmortissement: 'degressif', coefficientDegressif: '2.25', eligibiliteDegressifConfirmee: true, ...surcharge,
});
/** Le calcul du dégressif est ACTIVÉ EXPLICITEMENT ici : il est désactivé par défaut (aucune validation fiscale n'est revendiquée). */
const unDeg = (i: ImmobilisationAAmortir, exercice = EXERCICE, lignes: LigneEcriture[] = [], active = true): ResultatInventaire =>
  proposer({ lignes, exercice, immobilisations: [i], options: { amortissementDegressifActive: active } });
/** Plan complet tel que le moteur le publie sur l'exercice de mise en service. */
const planDe = (i: ImmobilisationAAmortir) => (unDeg(i).propositions[0] as PropositionEcritureInventaire).planAmortissement ?? [];

describe('dotations aux amortissements dégressifs', () => {
  it('retrouve l’exemple chiffré du BOFiP (BOI-BIC-AMT-20-20-30, § 350 et 360) : 10 000 €, 10 ans, taux 22,5 %, acquisition en novembre', () => {
    const r = unDeg(immoDeg());
    expect(r.abstentions).toEqual([]);
    const p = r.propositions[0] as PropositionEcritureInventaire;
    verifierEquilibre(p);
    expect(p).toMatchObject({ id: 'INV-AMORT-DEG|DEG-1', type: 'dotation_amortissement_degressif', totalDebit: '375.00', origine: { regle: 'INV-AMORT-DEG', versionRegle: '1.1.0' } });
    expect(p.lignes.map((l) => l.compteNum)).toEqual(['681120', '281540']);
    const plan = p.planAmortissement ?? [];
    expect(plan).toHaveLength(10);
    // Annuités du BOFiP, arrondies à l'euro dans la source : 375 ; 2 166 ; 1 678 ; 1 301 ; 1 008 ; 781 ; 673 ; 673 ; 673 ; 672.
    const bofip = [375, 2166, 1678, 1301, 1008, 781, 673, 673, 673, 672];
    plan.forEach((l, i) => expect(Math.abs(Number(l.dotation) - (bofip[i] as number)), `rang ${i + 1} : ${l.dotation}`).toBeLessThan(1));
    // Les neuf premières, arrondies à l'euro, sont celles de la source ; le BOFiP imprime 672 pour la dernière (solde de ses arrondis), le moteur 672,75 au centime.
    expect(plan.slice(0, 9).map((l) => Math.round(Number(l.dotation)))).toEqual(bofip.slice(0, 9));
    expect(plan.map((l) => l.methode)).toEqual(['degressif', 'degressif', 'degressif', 'degressif', 'degressif', 'degressif', 'lineaire', 'lineaire', 'lineaire', 'lineaire']);
    expect(plan.map((l) => Math.round(Number(l.vnc)))).toEqual([9625, 7459, 5781, 4480, 3472, 2691, 2018, 1345, 673, 0]);
    expect(plan.map((l) => l.exerciceFin)[0]).toBe('2025-12-31');
    expect(plan.at(-1)?.exerciceFin).toBe('2034-12-31');
    expect(plan[0]?.exerciceCourant).toBe(true);
    expect(somme(plan.map((l) => l.dotation))).toBe('10000.00');
    expect(plan.at(-1)?.vnc).toBe('0.00');
    expect(p.calcul.find((c) => c.libelle === 'Taux dégressif')?.valeur).toBe('22.5 %');
    expect(p.calcul.find((c) => c.libelle === 'Mois de la première année (mois de départ compris)')?.valeur).toBe('2 sur 12');
    expect(p.sourcesComplementaires.map((x) => x.verification)).toEqual(['verifiee', 'non_verifiee', 'verifiee', 'verifiee', 'verifiee', 'verifiee']);
    expect(p.source.url).toMatch(/BOI-BIC-AMT-20-20-30/);
  });

  it('calcule à la main un bien de trois ans (coefficient 1,25) avec bascule au linéaire dès la deuxième année', () => {
    // Taux 100/3 × 1,25 = 41,6667 % ; année 1 : 3 000 × 1/3 × 1,25 = 1 250,00 ; VNC 1 750 ; année 2 : dégressif 729,17 < linéaire 1 750 ÷ 2 = 875 → bascule ; année 3 : solde 875.
    const plan = planDe(immoDeg({ baseAmortissable: '3000.00', dureeMois: 36, coefficientDegressif: '1.25', dateMiseEnService: '2025-01-01' }));
    expect(plan.map((l) => l.dotation)).toEqual(['1250.00', '875.00', '875.00']);
    expect(plan.map((l) => l.methode)).toEqual(['degressif', 'lineaire', 'lineaire']);
    expect(plan.map((l) => l.vnc)).toEqual(['1750.00', '875.00', '0.00']);
  });

  it('applique le prorata au mois de mise en service (mois entamé compté) et conserve la somme exacte', () => {
    const mois = (date: string): string => (unDeg(immoDeg({ dateMiseEnService: date })).propositions[0] as PropositionEcritureInventaire).calcul.find((c) => c.libelle.startsWith('Mois de la première année'))?.valeur ?? '';
    expect(mois('2025-01-01')).toBe('12 sur 12');
    expect(mois('2025-01-31')).toBe('12 sur 12');
    expect(mois('2025-07-10')).toBe('6 sur 12');
    expect(mois('2025-12-31')).toBe('1 sur 12');
    expect(unDeg(immoDeg({ dateMiseEnService: '2025-01-01' })).propositions[0]?.totalDebit).toBe('2250.00');
    expect(unDeg(immoDeg({ dateMiseEnService: '2025-12-31' })).propositions[0]?.totalDebit).toBe('187.50');
  });

  it('ne dérive pas : somme des dotations = valeur brute − valeur résiduelle, au centime, quelles que soient la durée, la date et la résiduelle', () => {
    const cas: Array<[number, string, string, string | null]> = [
      [36, '1.25', '2025-03-17', null], [48, '1.25', '2025-09-02', '123.45'], [60, '1.75', '2025-01-01', null], [72, '1.75', '2025-05-31', '999.99'],
      [84, '2.25', '2025-11-30', null], [96, '2.25', '2025-02-14', '0.01'], [120, '2.25', '2025-08-08', null], [144, '2.25', '2025-06-06', '4567.89'], [180, '2.25', '2025-12-01', null],
    ];
    for (const [duree, coef, date, res] of cas) {
      for (const base of ['10000.00', '33333.33', '777.77', '1234567.89']) {
        const i = immoDeg({ baseAmortissable: base, dureeMois: duree, coefficientDegressif: coef, dateMiseEnService: date, ...(res !== null && Number(res) < Number(base) ? { valeurResiduelle: res } : {}) });
        const plan = planDe(i);
        const net = new Decimal(base).minus(new Decimal(i.valeurResiduelle ?? '0')).toFixed(2);
        expect(plan, `${duree} mois ${date}`).toHaveLength(duree / 12);
        expect(somme(plan.map((l) => l.dotation)), `${duree} mois ${base} ${date}`).toBe(net);
        expect(plan.at(-1)?.vnc).toBe('0.00');
        expect(plan.at(-1)?.cumul).toBe(net);
        // Jamais de dotation négative, jamais de VNC négative ; une fois basculé, le plan ne revient pas au dégressif.
        expect(plan.every((l) => Number(l.dotation) >= 0 && Number(l.vnc) >= 0)).toBe(true);
        const premiereBascule = plan.findIndex((l) => l.methode === 'lineaire');
        if (premiereBascule >= 0) expect(plan.slice(premiereBascule).every((l) => l.methode === 'lineaire')).toBe(true);
      }
    }
  });

  it('propose les exercices successifs d’un même plan, et refuse un historique qui s’en écarte', () => {
    const base = immoDeg();
    const plan = planDe(base);
    for (let rang = 2; rang <= 10; rang++) {
      const annee = 2024 + rang;
      const r = unDeg({ ...base, amortissementsAnterieurs: plan[rang - 2]?.cumul as string }, { debut: `${annee}-01-01`, fin: `${annee}-12-31` });
      expect(r.abstentions, `rang ${rang}`).toEqual([]);
      const p = r.propositions[0] as PropositionEcritureInventaire;
      expect(p.totalDebit, `rang ${rang}`).toBe(plan[rang - 1]?.dotation);
      expect(p.planAmortissement?.find((l) => l.exerciceCourant)?.rang).toBe(rang);
    }
    // Sans antérieurs : proposé, avec la réserve ; avec un historique différent : abstention, écart nommé.
    const sans = unDeg(base, { debut: '2027-01-01', fin: '2027-12-31' }).propositions[0] as PropositionEcritureInventaire;
    expect(sans.hypotheses.join(' ')).toMatch(/Amortissements antérieurs non fournis/);
    const ecart = unDeg({ ...base, amortissementsAnterieurs: '1000.00' }, { debut: '2027-01-01', fin: '2027-12-31' });
    expect(ecart.propositions).toEqual([]);
    expect(ecart.abstentions[0]).toMatchObject({ type: 'dotation_amortissement_degressif', code: 'ecart_plan_anterieurs' });
    expect(ecart.abstentions[0]?.motif).toMatch(/1000\.00.*diffèrent du cumul du plan dégressif à l’ouverture \(\d+\.\d{2}\)/);
    // Plan achevé.
    const achevee = unDeg(base, { debut: '2036-01-01', fin: '2036-12-31' });
    expect(achevee.abstentions[0]).toMatchObject({ code: 'plan_acheve' });
  });

  it('ne propose le dégressif que si le cabinet l’a déclaré, en a confirmé l’éligibilité et a déclaré un coefficient cohérent', () => {
    const cas: Array<[Partial<ImmobilisationAAmortir>, string, RegExp]> = [
      [{ eligibiliteDegressifConfirmee: null }, 'eligibilite_degressif_non_confirmee', /éligibilité non confirmée/],
      [{ eligibiliteDegressifConfirmee: undefined }, 'eligibilite_degressif_non_confirmee', /éligibilité non confirmée/],
      [{ eligibiliteDegressifConfirmee: false }, 'conditions_degressif_non_remplies', /ne remplit pas les conditions/],
      [{ coefficientDegressif: null }, 'coefficient_manquant', /2\.25 attendu/],
      [{ coefficientDegressif: '1.75' }, 'coefficient_incoherent', /différent de la règle générale pour une durée de 10 ans/],
      [{ coefficientDegressif: '2.5' }, 'coefficient_incoherent', /2\.25 attendu/],
      [{ coefficientDegressif: 'abc' }, 'coefficient_incoherent', /abc/],
      [{ dureeMois: 24, coefficientDegressif: '1.25' }, 'duree_inferieure_trois_ans', /inférieure à trois ans/],
      [{ dureeMois: 54, coefficientDegressif: '1.75' }, 'duree_non_annuelle', /multiple de 12/],
      [{ compteImmobilisation: '205000' }, 'bien_non_eligible', /biens corporels/],
      [{ dureeMois: 720, coefficientDegressif: '2.25' }, 'duree_hors_perimetre', /50 ans/],
    ];
    for (const [surcharge, code, motif] of cas) {
      const r = unDeg(immoDeg(surcharge));
      expect(r.propositions, code).toEqual([]);
      expect(r.abstentions, code).toHaveLength(1);
      expect(r.abstentions[0], code).toMatchObject({ type: 'dotation_amortissement_degressif', code, sources: { immobilisation: 'DEG-1' } });
      expect(r.abstentions[0]?.motif, code).toMatch(motif);
    }
    // Les coefficients du BOFiP par tranche de durée : 3-4 ans 1,25 ; 5-6 ans 1,75 ; au-delà 2,25.
    for (const [ans, coef] of [[3, '1.25'], [4, '1.25'], [5, '1.75'], [6, '1.75'], [7, '2.25'], [15, '2.25']] as const) {
      expect(unDeg(immoDeg({ dureeMois: ans * 12, coefficientDegressif: coef })).abstentions, `${ans} ans`).toEqual([]);
      const faux = coef === '1.25' ? '1.75' : '1.25';
      expect(unDeg(immoDeg({ dureeMois: ans * 12, coefficientDegressif: faux })).abstentions[0]?.code, `${ans} ans`).toBe('coefficient_incoherent');
    }
    // Exercice de douze mois courant, premier au dernier jour de mois, sinon abstention (le moteur ne modélise pas l'ajustement des exercices atypiques).
    expect(unDeg(immoDeg({ dateMiseEnService: '2025-02-01' }), { debut: '2025-01-01', fin: '2025-06-30' }).abstentions[0]).toMatchObject({ code: 'exercice_non_annuel' });
    expect(unDeg(immoDeg({ dateMiseEnService: '2025-02-01' }), { debut: '2025-01-15', fin: '2026-01-14' }).abstentions[0]).toMatchObject({ code: 'exercice_non_annuel' });
    expect(unDeg(immoDeg({ dateMiseEnService: '2025-07-01' }), { debut: '2025-07-01', fin: '2026-06-30' }).propositions[0]?.totalDebit).toBe('2250.00');
    // Sans mode déclaré, le moteur reste linéaire, même avec un coefficient saisi.
    const lineaire = unDeg({ ...immoDeg(), modeAmortissement: undefined });
    expect(lineaire.propositions[0]?.type).toBe('dotation_amortissement_lineaire');
    expect(unDeg({ ...immoDeg(), modeAmortissement: 'degresif' as never }).abstentions[0]).toMatchObject({ code: 'mode_invalide' });
  });

  it('signale l’amortissement dérogatoire possible sans fabriquer d’écriture', () => {
    const r = unDeg(immoDeg());
    expect(r.signalements).toHaveLength(1);
    expect(r.signalements[0]).toMatchObject({ code: 'amortissement_derogatoire', immobilisation: 'DEG-1' });
    expect(r.signalements[0]?.motif).toMatch(/145/);
    expect(r.signalements[0]?.motif).toMatch(/6872/);
    expect(r.signalements[0]?.motif).toMatch(/7872/);
    expect(r.signalements[0]?.motif).toMatch(/AUCUNE écriture dérogatoire/);
    expect(r.signalements[0]?.source).toMatchObject({ verification: 'verifiee', dateVerification: '2026-11-20' });
    // Aucune ligne de la proposition ne touche 145, 6872 ou 7872.
    expect((r.propositions[0] as PropositionEcritureInventaire).lignes.some((l) => /^(145|6872|7872)/.test(l.compteNum))).toBe(false);
    // Même quand le moteur s'abstient sur le bien, le point reste signalé ; un bien linéaire ne génère rien.
    expect(unDeg(immoDeg({ eligibiliteDegressifConfirmee: null })).signalements).toHaveLength(1);
    expect(unDeg(immoDeg({ modeAmortissement: 'lineaire' })).signalements).toEqual([]);
  });

  it('est NON ACTIVÉ par défaut : abstention motivée, aucun montant, aucune écriture', () => {
    for (const options of [undefined, {}, { amortissementDegressifActive: false }] as const) {
      const r = proposer({ immobilisations: [immoDeg()], ...(options === undefined ? {} : { options }) });
      expect(r.propositions).toEqual([]);
      expect(r.abstentions).toHaveLength(1);
      expect(r.abstentions[0]).toMatchObject({ type: 'dotation_amortissement_degressif', code: 'degressif_non_active', sources: { immobilisation: 'DEG-1' } });
      expect(r.abstentions[0]?.motif).toContain(MOTIF_DEGRESSIF_NON_ACTIVE);
      expect(r.abstentions[0]?.motif).toMatch(/CGI art\. 39 A\) n’a pas été vérifié/);
      expect(r.abstentions[0]?.motif).not.toMatch(/\d+[.,]\d{2}/);
      expect(r.totaux).toMatchObject({ nbPropositions: 0, impactResultat: '0.00' });
      expect(r.signalements).toEqual([]);
    }
    // Le linéaire n'est pas concerné.
    const lineaire = proposer({ immobilisations: [{ ...immoDeg(), modeAmortissement: 'lineaire', coefficientDegressif: null, eligibiliteDegressifConfirmee: null }] });
    expect(lineaire.propositions[0]?.type).toBe('dotation_amortissement_lineaire');
    // Activé explicitement : même immobilisation, plan calculé.
    expect(unDeg(immoDeg()).propositions[0]?.totalDebit).toBe('375.00');
  });

  it('part du premier jour du MOIS D’ACQUISITION, non de la mise en service', () => {
    // Acquisition en novembre, mise en service en décembre : 2/12 (novembre et décembre), et non 1/12.
    const p = unDeg(immoDeg({ dateAcquisition: '2025-11-05', dateMiseEnService: '2025-12-20' })).propositions[0] as PropositionEcritureInventaire;
    expect(p.totalDebit).toBe('375.00');
    expect(p.calcul.find((c) => c.libelle.startsWith('Mois de la première année'))?.valeur).toBe('2 sur 12');
    expect(p.calcul.find((c) => c.libelle === 'Date de départ du plan')?.valeur).toMatch(/2025-11-05/);
    expect(p.hypotheses.join(' ')).toMatch(/premier jour du mois d’acquisition/);
    // Exercice du 1er février 2025 au 31 janvier 2026 : acquisition en novembre, mise en service en janvier 2026 → 3/12 (et non 1/12).
    const decale = { debut: '2025-02-01', fin: '2026-01-31' };
    const q = unDeg(immoDeg({ dateAcquisition: '2025-11-30', dateMiseEnService: '2026-01-10' }), decale).propositions[0] as PropositionEcritureInventaire;
    expect(q.calcul.find((c) => c.libelle.startsWith('Mois de la première année'))?.valeur).toBe('3 sur 12');
    expect(q.totalDebit).toBe('562.50');
    // Acquisition le 1er et le dernier jour du même mois : même résultat.
    expect(unDeg(immoDeg({ dateAcquisition: '2025-11-01', dateMiseEnService: '2025-11-30' })).propositions[0]?.totalDebit).toBe('375.00');
    // Acquisition en janvier, mise en service en novembre : 12/12 (la mise en service n'intervient pas).
    expect(unDeg(immoDeg({ dateAcquisition: '2025-01-10', dateMiseEnService: '2025-11-15' })).propositions[0]?.totalDebit).toBe('2250.00');
  });

  it('s’abstient sans date d’acquisition, ou si elle est invalide ou incohérente', () => {
    const cas: Array<[Partial<ImmobilisationAAmortir>, string, RegExp]> = [
      [{ dateAcquisition: null }, 'date_acquisition_manquante', /premier jour du mois d’acquisition/],
      [{ dateAcquisition: undefined }, 'date_acquisition_manquante', /non fournie/],
      [{ dateAcquisition: '2025-13-40' }, 'donnee_invalide', /date d’acquisition invalide/],
      [{ dateAcquisition: '2025-12-01', dateMiseEnService: '2025-11-15' }, 'donnee_invalide', /postérieure à la mise en service/],
    ];
    for (const [surcharge, code, motif] of cas) {
      const r = unDeg(immoDeg(surcharge));
      expect(r.propositions, code).toEqual([]);
      expect(r.abstentions[0], code).toMatchObject({ type: 'dotation_amortissement_degressif', code });
      expect(r.abstentions[0]?.motif, code).toMatch(motif);
    }
    // Le linéaire n'exige pas de date d'acquisition.
    expect(proposer({ immobilisations: [{ ...immoDeg({ dateAcquisition: null }), modeAmortissement: 'lineaire', coefficientDegressif: null, eligibiliteDegressifConfirmee: null }] }).propositions[0]?.type).toBe('dotation_amortissement_lineaire');
  });

  it('s’abstient pour un coefficient hors règle générale (cas particuliers non gérés)', () => {
    for (const coefficientDegressif of ['1.5', '2.00', '2.5', '3.5']) {
      const r = unDeg(immoDeg({ coefficientDegressif }));
      expect(r.propositions, coefficientDegressif).toEqual([]);
      expect(r.abstentions[0], coefficientDegressif).toMatchObject({ code: 'coefficient_incoherent' });
      expect(r.abstentions[0]?.motif, coefficientDegressif).toMatch(/BOI-BIC-AMT-20-20-50, non analysé\) ne sont pas gérés/);
    }
  });

  it('écrit dans les hypothèses la faculté de bascule au linéaire et les limites', () => {
    const p = unDeg(immoDeg()).propositions[0] as PropositionEcritureInventaire;
    const h = p.hypotheses.join('\n');
    expect(h).toMatch(/Bascule au linéaire appliquée dès qu’elle devient plus favorable ; c’est une faculté de l’entreprise/);
    expect(h).toMatch(/BOI-BIC-AMT-20-20-50, non analysé\) ne sont pas gérés/);
    expect(h).toMatch(/n’ont pas été validées par un professionnel/);
    expect(p.sourcesComplementaires.map((c) => c.verification)).toContain('non_verifiee');
  });
});

describe('valeur résiduelle, sortie d’actif, composants', () => {
  const immo = (surcharge: Partial<ImmobilisationAAmortir> = {}): ImmobilisationAAmortir => ({ id: 'IMMO-1', libelle: 'Camion', compteImmobilisation: '218200', baseAmortissable: '10000.00', dateMiseEnService: '2025-01-01', dureeMois: 60, ...surcharge });
  const une = (i: ImmobilisationAAmortir) => proposer({ immobilisations: [i] });

  it('amortit la valeur brute diminuée de la valeur résiduelle (PCG art. 214-4)', () => {
    const p = une(immo({ valeurResiduelle: '1000.00' })).propositions[0] as PropositionEcritureInventaire;
    verifierEquilibre(p);
    expect(p.totalDebit).toBe('1800.00');
    expect(p.calcul.slice(0, 3)).toEqual([{ libelle: 'Valeur brute', valeur: '10000.00' }, { libelle: 'Valeur résiduelle (déduite)', valeur: '1000.00' }, { libelle: 'Montant amortissable', valeur: '9000.00' }]);
    expect(p.hypotheses.join(' ')).toMatch(/significative et mesurable/);
    expect(une(immo({ valeurResiduelle: '0.00' })).propositions[0]?.totalDebit).toBe('2000.00'); // résiduelle nulle = sans effet
    // Plan soldé : reste à amortir = montant amortissable − antérieurs.
    expect(une(immo({ valeurResiduelle: '1000.00', dateMiseEnService: '2021-01-01', amortissementsAnterieurs: '7200.00' })).propositions[0]?.totalDebit).toBe('1800.00');
    for (const [v, motif] of [['10000.00', /strictement inférieure à la valeur brute 10000\.00/], ['10001.00', /valeur résiduelle invalide/], ['-1.00', /valeur résiduelle invalide/], ['abc', /valeur résiduelle invalide/]] as const) {
      const r = une(immo({ valeurResiduelle: v }));
      expect(r.propositions, v).toEqual([]);
      expect(r.abstentions[0], v).toMatchObject({ code: 'donnee_invalide' });
      expect(r.abstentions[0]?.motif).toMatch(motif);
    }
    // Dégressif : la résiduelle réduit le montant à amortir.
    const plan = planDe(immoDeg({ valeurResiduelle: '2500.00' }));
    expect(somme(plan.map((l) => l.dotation))).toBe('7500.00');
  });

  it('s’abstient, motif à l’appui, quand une sortie d’actif est saisie dans ou avant l’exercice — sans l’ignorer', () => {
    for (const [date, motif] of [['2025-09-30', /en cours d’exercice/], ['2025-12-31', /en cours d’exercice/], ['2024-06-30', /avant l’ouverture de l’exercice/]] as const) {
      const r = une(immo({ dateMiseEnService: '2020-01-01', dateSortie: date }));
      expect(r.propositions, date).toEqual([]);
      expect(r.abstentions, date).toHaveLength(1);
      expect(r.abstentions[0], date).toMatchObject({ code: 'sortie_d_actif', sources: { immobilisation: 'IMMO-1' } });
      expect(r.abstentions[0]?.motif).toMatch(motif);
      expect(r.abstentions[0]?.motif).toMatch(/plus ou moins-value de cession/);
      expect(r.abstentions[0]?.motif).toMatch(/675 et 775/);
    }
    expect(unDeg(immoDeg({ dateSortie: '2025-12-15' })).abstentions[0]).toMatchObject({ type: 'dotation_amortissement_degressif', code: 'sortie_d_actif' });
    // Sortie postérieure à la clôture : dotation normale, avec mention.
    const apres = une(immo({ dateSortie: '2026-03-01' })).propositions[0] as PropositionEcritureInventaire;
    expect(apres.totalDebit).toBe('2000.00');
    expect(apres.hypotheses.join(' ')).toMatch(/Sortie de l’actif prévue au 2026-03-01, postérieure à la clôture/);
    expect(une(immo({ dateSortie: '2024-12-31' })).abstentions[0]).toMatchObject({ code: 'donnee_invalide' });
    expect(une(immo({ dateSortie: '2025-13-01' })).abstentions[0]).toMatchObject({ code: 'donnee_invalide' });
  });

  it('traite chaque composant avec son propre plan (PCG art. 214-9) et refuse un rattachement invalide', () => {
    const structure = immo({ id: 'STRUCT', libelle: 'Bâtiment — structure', compteImmobilisation: '213500', baseAmortissable: '150000.00', dureeMois: 480 });
    const toiture = immo({ id: 'TOIT', libelle: 'Bâtiment — toiture', compteImmobilisation: '213500', baseAmortissable: '30000.00', dureeMois: 240, composantDe: 'STRUCT' });
    const r = proposer({ immobilisations: [structure, toiture] });
    expect(r.abstentions).toEqual([]);
    const [a, b] = r.propositions as [PropositionEcritureInventaire, PropositionEcritureInventaire];
    expect([a.id, a.totalDebit]).toEqual(['INV-AMORT|STRUCT', '3750.00']);
    expect([b.id, b.totalDebit]).toEqual(['INV-AMORT|TOIT', '1500.00']);
    expect(b.hypotheses.join(' ')).toMatch(/Composant de l’immobilisation STRUCT/);
    // Orphelin, auto-référence, composant de composant : abstentions.
    for (const [surcharge, autres] of [[{ composantDe: 'INCONNU' }, []], [{ composantDe: 'IMMO-1' }, []], [{ composantDe: 'B' }, [immo({ id: 'B', composantDe: 'C' }), immo({ id: 'C' })]]] as const) {
      const rr = proposer({ immobilisations: [immo(surcharge), ...autres] });
      expect(rr.abstentions.find((x) => x.sources.immobilisation === 'IMMO-1'), JSON.stringify(surcharge)).toMatchObject({ code: 'composant_invalide' });
    }
  });
});

describe('rapprochement avec la comptabilité importée', () => {
  const dotationComptabilisee = (montant: string, compte = '681120', date = '2025-12-31'): LigneEcriture[] => [
    ligne({ id: `D-${montant}-1`, ecritureNum: 'DOT1', ecritureDate: date, compteNum: compte, debit: montant }),
    ligne({ id: `D-${montant}-2`, ecritureNum: 'DOT1', ecritureDate: date, compteNum: '281830', credit: montant }),
  ];
  const brut = (compte = '218300', montant = '10000.00'): LigneEcriture[] => [
    ligne({ id: `B-${compte}-1`, ecritureNum: 'AN1', ecritureDate: '2025-01-01', journalCode: 'AN', compteNum: compte, debit: montant }),
    ligne({ id: `B-${compte}-2`, ecritureNum: 'AN1', ecritureDate: '2025-01-01', journalCode: 'AN', compteNum: '101000', credit: montant }),
  ];
  const immo = (surcharge: Partial<ImmobilisationAAmortir> = {}): ImmobilisationAAmortir => ({ id: 'IMMO-1', libelle: 'Matériel informatique', compteImmobilisation: '218300', baseAmortissable: '10000.00', dateMiseEnService: '2025-01-01', dureeMois: 60, ...surcharge });

  it('ne repropose pas une dotation déjà comptabilisée et montre l’écart quand elle diffère', () => {
    const identique = proposer({ lignes: [...brut(), ...dotationComptabilisee('2000.00')], immobilisations: [immo()] });
    expect(identique.propositions).toEqual([]);
    expect(identique.abstentions).toHaveLength(1);
    expect(identique.abstentions[0]).toMatchObject({ code: 'dotation_deja_comptabilisee', type: 'dotation_amortissement_lineaire', sources: { immobilisation: 'IMMO-1' } });
    expect(identique.rapprochement.dotations).toEqual([{ compteDotation: '68112', immobilisations: ['IMMO-1'], dotationCalculee: '2000.00', calculComplet: true, dotationComptabilisee: '2000.00', ecart: '0.00', etat: 'identique', propositionsEcartees: true, message: expect.stringMatching(/identique au calcul du moteur \(2000\.00\)/) }]);
    const differente = proposer({ lignes: [...brut(), ...dotationComptabilisee('1500.00')], immobilisations: [immo()] });
    expect(differente.propositions).toEqual([]);
    expect(differente.rapprochement.dotations[0]).toMatchObject({ etat: 'differente', dotationCalculee: '2000.00', dotationComptabilisee: '1500.00', ecart: '-500.00', propositionsEcartees: true });
    expect(differente.rapprochement.dotations[0]?.message).toMatch(/écart de -500\.00 \(comptabilisé − calculé\)/);
    expect(differente.abstentions[0]?.motif).toMatch(/n’est pas corrigé/);
    // Le dégressif n'est pas non plus reproposé.
    const deg = proposer({ lignes: [...brut('215400'), ...dotationComptabilisee('375.00')], immobilisations: [immoDeg()], options: { amortissementDegressifActive: true } });
    expect(deg.propositions).toEqual([]);
    expect(deg.abstentions[0]).toMatchObject({ type: 'dotation_amortissement_degressif', code: 'dotation_deja_comptabilisee' });
    expect(deg.rapprochement.dotations[0]).toMatchObject({ etat: 'identique', dotationCalculee: '375.00' });
    // Aucune dotation comptabilisée : proposée ; une dotation d'une autre période n'entre pas dans l'exercice.
    const aucune = proposer({ lignes: [...brut(), ...dotationComptabilisee('2000.00', '681120', '2024-12-31')], immobilisations: [immo()] });
    expect(aucune.propositions).toHaveLength(1);
    expect(aucune.rapprochement.dotations[0]).toMatchObject({ etat: 'aucune_dotation_comptabilisee', propositionsEcartees: false, dotationComptabilisee: '0.00' });
    // Dotation sur un compte 6811 non ventilé : prudence, pas de doublon.
    const nonVentilee = proposer({ lignes: [...brut(), ...dotationComptabilisee('2000.00', '681100')], immobilisations: [immo()] });
    expect(nonVentilee.propositions).toEqual([]);
    expect(nonVentilee.rapprochement.dotations[0]).toMatchObject({ etat: 'non_ventilee' });
  });

  it('additionne les immobilisations d’un même compte de dotation et signale un calcul incomplet', () => {
    const lignes = [...brut(), ...brut('218400', '5000.00'), ...dotationComptabilisee('3000.00')];
    const complet = proposer({ lignes, immobilisations: [immo(), immo({ id: 'IMMO-2', compteImmobilisation: '218400', baseAmortissable: '5000.00' })] });
    expect(complet.propositions).toEqual([]);
    expect(complet.abstentions.map((a) => a.code)).toEqual(['dotation_deja_comptabilisee', 'dotation_deja_comptabilisee']);
    expect(complet.rapprochement.dotations[0]).toMatchObject({ immobilisations: ['IMMO-1', 'IMMO-2'], dotationCalculee: '3000.00', dotationComptabilisee: '3000.00', etat: 'identique' });
    const partiel = proposer({ lignes, immobilisations: [immo(), immo({ id: 'IMMO-2', compteImmobilisation: '218400', baseAmortissable: '5000.00', dateSortie: '2025-06-30' })] });
    expect(partiel.rapprochement.dotations[0]).toMatchObject({ calculComplet: false, etat: 'differente', dotationCalculee: '2000.00', ecart: '1000.00' });
    expect(partiel.rapprochement.dotations[0]?.message).toMatch(/calcul incomplet/);
    // Aucun calcul possible : dotation passée, écart non calculable.
    const indisponible = proposer({ lignes, immobilisations: [immo({ dureeMois: null })] });
    expect(indisponible.rapprochement.dotations[0]).toMatchObject({ etat: 'calcul_indisponible', dotationCalculee: null, ecart: null });
    expect(indisponible.abstentions.map((a) => a.code)).toEqual(['donnee_manquante']);
  });

  it('signale une immobilisation du fichier absente de la balance, un écart de valeur et un compte 2xx sans immobilisation saisie', () => {
    const lignes = [...brut('218300', '10000.00'), ...brut('215400', '40000.00'), ...brut('211000', '90000.00'), ...brut('206000', '5000.00'), ...brut('205000', '1200.00'), ...brut('231000', '7000.00')];
    const r = proposer({ lignes, immobilisations: [immo(), immo({ id: 'IMMO-2', compteImmobilisation: '218400', baseAmortissable: '777.00' }), immo({ id: 'IMMO-3', compteImmobilisation: '218300', baseAmortissable: '1.00' })] });
    expect(r.rapprochement.comptes).toEqual([
      expect.objectContaining({ compte: '2183', immobilisations: ['IMMO-1', 'IMMO-3'], valeurBruteSaisie: '10001.00', soldeBalance: '10000.00', ecart: '-1.00', etat: 'ecart' }),
      expect.objectContaining({ compte: '2184', immobilisations: ['IMMO-2'], valeurBruteSaisie: '777.00', soldeBalance: '0.00', etat: 'absent_de_la_balance' }),
    ]);
    expect(r.rapprochement.comptes[1]?.message).toMatch(/absente\(s\) de la comptabilité/);
    // 2154 (corporel) et 2050 (incorporel) sans immobilisation saisie ; 211 (terrains), 206 (droit au bail) et 231 (en cours) ne sont pas listés.
    expect(r.rapprochement.comptesSansImmobilisation.map((c) => [c.compte, c.solde])).toEqual([['205000', '1200.00'], ['215400', '40000.00']]);
    expect(r.rapprochement.comptesSansImmobilisation[1]?.message).toMatch(/à saisir/);
    const concordant = proposer({ lignes: brut(), immobilisations: [immo()] });
    expect(concordant.rapprochement.comptes[0]).toMatchObject({ etat: 'concordant', ecart: '0.00' });
    expect(concordant.rapprochement.comptesSansImmobilisation).toEqual([]);
    // Les écritures postérieures à la clôture n'entrent pas dans le solde.
    const posterieure = proposer({ lignes: [ligne({ compteNum: '218300', ecritureDate: '2026-02-01', debit: '999.00' })], immobilisations: [immo()] });
    expect(posterieure.rapprochement.comptes[0]?.etat).toBe('absent_de_la_balance');
  });

  it('n’altère ni les écritures fournies ni la reproductibilité, et rend un rapprochement vide sans immobilisation', () => {
    const lignes = [...brut(), ...dotationComptabilisee('1500.00')];
    const avant = JSON.stringify(lignes);
    const demande: DemandeInventaire = { lignes, exercice: EXERCICE, immobilisations: [immo(), immoDeg({ id: 'DEG-9', compteImmobilisation: '215500' })] };
    expect(proposerEcrituresInventaire(demande)).toEqual(proposerEcrituresInventaire(demande));
    expect(JSON.stringify(lignes)).toBe(avant);
    expect(proposer({}).rapprochement).toEqual({ dotations: [], comptes: [], comptesSansImmobilisation: [] });
    expect(proposer({}).signalements).toEqual([]);
  });
});
