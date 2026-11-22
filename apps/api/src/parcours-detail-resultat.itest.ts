/**
 * Détail du compte de résultat (2052 France / exportations, 2053 exceptionnel, renvois ; 2033-B « dont export » et renvois) — D-106, D-107, pile réelle locale, cabinet NEUF.
 * La ventilation France / exportations n'est JAMAIS déduite : qualification par compte, tracée, refusée si la somme n'égale pas le
 * solde, « à revoir » si les données changent ; renvois saisis ou en abstention ; droits ; journal.
 */
import { randomBytes } from 'node:crypto';
import { genererFecSynthetique } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, attendreLot, choisirCabinet, deposer, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const COMPTES = ['alice', 'remi', 'chloe', 'client'] as const;
let editeur: pg.Client;
let cabinet = '';
let dossier = '';
let exN = '';

type Piece = [journal: string, num: string, date: string, lignes: Array<[compte: string, libelle: string, debit: string, credit: string]>];
const LIBELLES_JOURNAUX: Record<string, string> = { AN: 'A nouveaux', AC: 'Achats', OD: 'Operations diverses' };

/** FEC (tabulations, virgule décimale, 18 colonnes) à partir d'écritures équilibrées. */
function fec(pieces: Piece[]): Buffer {
  const lignes = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'].join('\t');
  const sortie = [lignes];
  for (const [journal, num, date, ls] of pieces) {
    const d = date.replaceAll('-', '');
    for (const [compte, libelle, debit, credit] of ls) sortie.push([journal, LIBELLES_JOURNAUX[journal] ?? journal, num, d, compte, libelle, '', '', `P-${num}`, d, libelle, debit.replace('.', ','), credit.replace('.', ','), '', '', d, '', ''].join('\t'));
  }
  return Buffer.from(`${sortie.join('\r\n')}\r\n`, 'utf8');
}


const FEC_2026: Piece[] = [
  ['VT', 'VT2601', '2026-03-01', [['411000', 'Clients', '12000.00', '0.00'], ['707100', 'Ventes de marchandises France', '0.00', '5000.00'], ['707200', 'Ventes de marchandises export', '0.00', '1000.00'], ['701100', 'Ventes de produits finis', '0.00', '4000.00'], ['706000', 'Prestations de services', '0.00', '2000.00']]],
  ['VT', 'VT2602', '2026-03-02', [['709700', 'RRR accordes sur marchandises', '200.00', '0.00'], ['411000', 'Clients', '0.00', '200.00']]],
  ['OD', 'OD2606', '2026-06-30', [['671200', 'Penalites', '300.00', '0.00'], ['675000', 'VNC elements cedes', '1500.00', '0.00'], ['512000', 'Banque', '0.00', '1800.00']]],
  ['OD', 'OD2607', '2026-06-30', [['775000', 'Produits des cessions', '0.00', '800.00'], ['512000', 'Banque', '800.00', '0.00']]],
  ['AC', 'AC2601', '2026-07-01', [['612200', 'Credit-bail mobilier', '2400.00', '0.00'], ['671300', 'Dons et liberalites', '150.00', '0.00'], ['512000', 'Banque', '0.00', '2550.00']]],
];

async function importer(d: string, ex: string, pieces: Piece[], fin: string) {
  const nom = genererFecSynthetique({ exercice: { debut: `${fin.slice(0, 4)}-01-01`, fin }, nbEcritures: 10, graine: 1 }).nomFichier;
  const depot = await deposer('remi', d, fec(pieces), { usage: 'fec', exerciceId: ex, statutDonnees: 'travail_avant_cloture' }, nom);
  expect(depot.fin.statut, JSON.stringify(depot.fin.json)).toBeLessThan(300);
  await attendreLot('remi', depot.fin.json.lotImportId);
}
const liasse = (ex: string, regime = 'reel_normal', qui = 'remi') => api(qui, 'GET', `/v1/exercices/${ex}/liasse?regime=${regime}`);
const detail = async () => (await liasse(exN)).json.detailResultat;
const ligneCA = (d: any, id: string) => d.ventilationChiffreAffaires.lignes.find((l: any) => l.id === id);
const qualifier = (compte: string, france: string, exportation: string, note = 'Ventilation d’après le fichier des ventes', qui = 'remi') =>
  api(qui, 'PUT', `/v1/exercices/${exN}/qualifications/ventilation/${compte}`, { montantFrance: france, montantExport: exportation, note });
const renvoi = (code: string, montant: string, note = 'Relevé des loyers de crédit-bail', qui = 'remi') => api(qui, 'PUT', `/v1/exercices/${exN}/qualifications/renvois/${code}`, { montant, note });

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai détail résultat ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '25 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  dossier = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Société d’essai détail résultat ${SEL} SAS (fictive)`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id as string;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
  }
  exN = (await api('alice', 'POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2026-01-01', fin: '2026-12-30' })).json.id;
  await importer(dossier, exN, FEC_2026, '2026-12-30');
}, 180_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('2033-B (régime simplifié) : « dont export » et renvois, mêmes qualifications que le régime normal (D-107)', () => {
  const rsi = async () => (await liasse(exN, 'reel_simplifie')).json.detailResultat;

  it('totaux de la balance avec leurs cases, « dont export » en abstention tant que les comptes ne sont pas qualifiés, aucun net ni détail exceptionnel', async () => {
    const d = await rsi();
    expect(d).toMatchObject({ statut: 'projet', complet: false, regime: 'reel_simplifie', detailExceptionnel: null });
    expect(d.ventilationChiffreAffaires.chiffreAffairesNet).toBeNull();
    expect(ligneCA(d, 'MARCHANDISES').total).toMatchObject({ statut: 'etabli', montant: '5800.00', codeCase: '210', etatCodeCase: 'lu_verifie' });
    expect(ligneCA(d, 'BIENS').total).toMatchObject({ montant: '4000.00', codeCase: '214' });
    expect(ligneCA(d, 'SERVICES').total).toMatchObject({ montant: '2000.00', codeCase: '218' });
    expect(ligneCA(d, 'BIENS').export).toMatchObject({ statut: 'abstention', codeCase: '215' });
    expect(d.renvois.map((r: any) => r.code)).toEqual(['CB_MOB', 'CB_IMM', '243', '255', '259', '260', '347', '348']);
    expect(d.renvois.find((r: any) => r.code === 'CB_MOB')).toMatchObject({ codeCase: null, proposition: { montant: '2400.00' } });
  }, 120_000);

  it('la qualification d’un compte vaut pour les deux régimes ; un renvoi du 2033-B se saisit, se trace et se retire', async () => {
    expect((await qualifier('701100', '3000.00', '1000.00')).statut).toBeLessThan(300);
    expect((await api('remi', 'PUT', `/v1/exercices/${exN}/qualifications/renvois/255`, { montant: '1200.00', note: 'Amortissement du fonds acquis en 2023' })).statut).toBeLessThan(300);
    let d = await rsi();
    expect(ligneCA(d, 'BIENS').export).toMatchObject({ statut: 'etabli', montant: '1000.00', codeCase: '215' });
    expect(d.renvois.find((r: any) => r.code === '255')).toMatchObject({ statut: 'saisi', montant: '1200.00', codeCase: '255', saisie: { qualifieePar: DEMO.remi } });
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/qualifications/renvois/255`)).statut).toBeLessThan(300);
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/qualifications/ventilation/701100`)).statut).toBeLessThan(300);
    d = await rsi();
    expect(d.renvois.find((r: any) => r.code === '255')).toMatchObject({ statut: 'a_saisir', montant: null });
    expect(ligneCA(d, 'BIENS').export.statut).toBe('abstention');
  }, 120_000);
});

describe('détail du compte de résultat : qualification tracée, abstention sans qualification', () => {
  it('sans qualification : totaux de la balance, France et exportations en abstention, renvois à saisir, exceptionnel détaillé', async () => {
    const d = await detail();
    expect(d).toMatchObject({ statut: 'projet', complet: false, regime: 'reel_normal' });
    expect(d.mention).toMatch(/en attente de validation professionnelle/);
    expect(ligneCA(d, 'MARCHANDISES').total).toMatchObject({ statut: 'etabli', montant: '5800.00', codeCase: 'FC' });
    expect(ligneCA(d, 'BIENS').total.montant).toBe('4000.00');
    expect(ligneCA(d, 'SERVICES').total.montant).toBe('2000.00');
    expect(d.ventilationChiffreAffaires.chiffreAffairesNet.total.montant).toBe('11800.00');
    for (const l of d.ventilationChiffreAffaires.lignes) {
      expect(l.france.statut).toBe('abstention');
      expect(JSON.stringify(l.france)).not.toMatch(/montant/);
    }
    expect(d.ventilationChiffreAffaires.nbComptesAQualifier).toBe(5);
    expect(d.detailExceptionnel).toMatchObject({ totalProduits: '800.00', totalCharges: '1950.00', resultatExceptionnel: '-1150.00' });
    expect(d.renvois.every((r: any) => r.statut === 'a_saisir' && r.montant === null)).toBe(true);
    expect(d.renvois.find((r: any) => r.code === 'HP').proposition).toMatchObject({ montant: '2400.00' });
  }, 120_000);

  it('une somme qui n’égale pas le solde est refusée en 409 avec l’écart, rien n’est enregistré', async () => {
    const r = await qualifier('706000', '1500.00', '0.00');
    expect(r.statut).toBe(409);
    expect(JSON.stringify(r.json)).toMatch(/écart 500\.00/);
    expect(ligneCA(await detail(), 'SERVICES').comptes[0].etat).toBe('a_qualifier');
  });

  it('refuse : note absente ou trop courte, montant mal formé, compte inconnu ou hors chiffre d’affaires, compte sans montant', async () => {
    expect((await qualifier('706000', '2000.00', '0.00', 'ok')).statut).toBe(400);
    expect((await qualifier('706000', '2 000,00', '0.00')).statut).toBe(400);
    expect((await qualifier('706999', '1.00', '0.00')).statut).toBe(404);
    expect((await qualifier('411000', '1.00', '0.00')).statut).toBe(400);
    expect((await api('remi', 'PUT', `/v1/exercices/${exN}/qualifications/renvois/ZZ`, { montant: '1.00', note: 'inconnu ici' })).statut).toBe(404);
  });

  it('qualification complète : lignes et net établis, trace (auteur, version) et journal', async () => {
    for (const [c, f, e] of [['707100', '5000.00', '0.00'], ['707200', '0.00', '1000.00'], ['709700', '-200.00', '0.00'], ['701100', '3000.00', '1000.00']] as const) {
      const r = await qualifier(c, f, e);
      expect(r.statut, JSON.stringify(r.json)).toBeLessThan(300);
    }
    let d = await detail();
    expect(ligneCA(d, 'SERVICES').france.statut).toBe('abstention');
    expect(d.ventilationChiffreAffaires.chiffreAffairesNet.france.statut).toBe('abstention');
    expect((await qualifier('706000', '2000.00', '0.00')).statut).toBeLessThan(300);
    d = await detail();
    expect(ligneCA(d, 'MARCHANDISES').france).toMatchObject({ statut: 'etabli', montant: '4800.00', codeCase: 'FA' });
    expect(ligneCA(d, 'MARCHANDISES').export).toMatchObject({ statut: 'etabli', montant: '1000.00', codeCase: 'FB' });
    expect(d.ventilationChiffreAffaires.chiffreAffairesNet).toMatchObject({ france: { montant: '9800.00', codeCase: 'FJ' }, export: { montant: '2000.00', codeCase: 'FK' } });
    expect(d.ventilationChiffreAffaires.complete).toBe(true);
    expect(d.controles.find((c: any) => c.code === 'CA_FRANCE_EXPORT').statut).toBe('coherent');
    const q = ligneCA(d, 'BIENS').comptes[0];
    expect(q).toMatchObject({ etat: 'qualifie', qualification: { montantFrance: '3000.00', montantExport: '1000.00', qualifieePar: DEMO.remi, versionDonnees: expect.any(Number) } });
    const journal = await editeur.query(`select action, details from journal_audit where cabinet_id = $1 and action = 'resultat.ventilation_qualifiee' order by id`, [cabinet]);
    expect(journal.rows.length).toBe(6); // 5 qualifications de ce test + 1 jouée par l'essai du 2033-B (retirée depuis, mais journalisée)
  }, 120_000);

  it('renvoi : saisi avec sa trace, proposition de la balance distincte ; retrait possible', async () => {
    expect((await renvoi('HP', '2000.00')).statut).toBeLessThan(300);
    let d = await detail();
    const hp = d.renvois.find((r: any) => r.code === 'HP');
    expect(hp).toMatchObject({ statut: 'saisi', montant: '2000.00', proposition: { montant: '2400.00' }, saisie: { qualifieePar: DEMO.remi, note: 'Relevé des loyers de crédit-bail' } });
    expect(d.renvois.find((r: any) => r.code === 'HQ')).toMatchObject({ statut: 'a_saisir', montant: null });
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/qualifications/renvois/HP`)).statut).toBeLessThan(300);
    d = await detail();
    expect(d.renvois.find((r: any) => r.code === 'HP')).toMatchObject({ statut: 'a_saisir', montant: null });
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/qualifications/renvois/HP`)).statut).toBe(404);
  });

  it('droits : la collaboration lit mais ne qualifie pas ; le déposant n’a aucun accès', async () => {
    expect((await qualifier('706000', '2000.00', '0.00', 'Essai collaborateur', 'chloe')).statut).toBeGreaterThanOrEqual(400);
    expect((await renvoi('HP', '1.00', 'Essai collaborateur', 'chloe')).statut).toBeGreaterThanOrEqual(400);
    expect((await liasse(exN, 'reel_normal', 'chloe')).statut).toBe(200);
    expect((await liasse(exN, 'reel_normal', 'client')).statut).toBe(404);
    expect((await qualifier('706000', '2000.00', '0.00', 'Essai déposant', 'client')).statut).toBe(404);
  });

  it('les données changent (nouvel import) : la qualification devient « à revoir » et ne compte plus', async () => {
    // Un FEC différent (une écriture de plus, sans effet sur la classe 70) : la version des données change, les soldes des comptes de ventes non.
    await importer(dossier, exN, [...FEC_2026, ['OD', 'OD2612', '2026-12-30', [['512000', 'Banque', '100.00', '0.00'], ['411000', 'Clients', '0.00', '100.00']]]], '2026-12-30');
    const d = await detail();
    expect(ligneCA(d, 'SERVICES').comptes[0].etat).toBe('a_revoir');
    expect(ligneCA(d, 'SERVICES').france.statut).toBe('abstention');
    expect(d.ventilationChiffreAffaires.chiffreAffairesNet.france.statut).toBe('abstention');
  }, 120_000);
});
