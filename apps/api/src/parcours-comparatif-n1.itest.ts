/**
 * Colonne N-1 (comparatif) des états projetés et de la liasse — pile réelle locale, cabinet NEUF.
 * Exercice précédent contigu importé : colonne fournie ; non contigu ou sans données : colonne indisponible avec motif.
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
const COMPTES = ['alice', 'remi', 'client'] as const;
let editeur: pg.Client;
let cabinet = '';
let dossier = '';
let exN1 = '';
let exN = '';
let exApres = '';

async function importer(ex: string, debut: string, fin: string, graine: number) {
  const fec = genererFecSynthetique({ exercice: { debut, fin }, nbEcritures: 120, graine });
  const depot = await deposer('remi', dossier, Buffer.from(fec.contenu), { usage: 'fec', exerciceId: ex, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
  await attendreLot('remi', depot.fin.json.lotImportId);
}

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai N-1 ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '20 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  const cree = await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Société d’essai N-1 ${SEL} SAS (fictive)`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' });
  expect(cree.statut, JSON.stringify(cree.json)).toBeLessThan(300);
  dossier = cree.json.id;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.client, 'depot']] as const) {
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
  }
  const e1 = await api('alice', 'POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' });
  expect(e1.statut, JSON.stringify(e1.json)).toBeLessThan(300);
  exN1 = e1.json.id;
  exN = (await api('alice', 'POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2026-01-01', fin: '2026-06-30' })).json.id;
  exApres = (await api('alice', 'POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2026-07-01', fin: '2026-12-30' })).json.id;
}, 120_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('colonne N-1', () => {
  it('sans exercice précédent importé : indisponible avec motif, jamais de chiffre inventé', async () => {
    await importer(exN1, '2025-01-01', '2025-12-31', 11);
    const r = await api('remi', 'GET', `/v1/exercices/${exN1}/liasse`);
    expect(r.statut).toBe(200);
    expect(r.json.resultat.comparatif.statut).toBe('indisponible');
    expect(r.json.resultat.tableaux.flatMap((t: any) => t.lignes).every((l: any) => l.n1 === null)).toBe(true);
    const e = (await api('remi', 'GET', `/v1/exercices/${exN1}/etats`)).json;
    expect(e.comparatif.statut).toBe('indisponible');
  }, 120_000);

  it('exercice précédent contigu importé : liasse et états portent N-1, égal à ce que donne l’exercice précédent seul', async () => {
    await importer(exN, '2026-01-01', '2026-06-30', 22);
    const seule = (await api('remi', 'GET', `/v1/exercices/${exN1}/liasse`)).json.resultat;
    const r = await api('remi', 'GET', `/v1/exercices/${exN}/liasse`);
    expect(r.statut).toBe(200);
    expect(r.json.donnees.exercicePrecedentFourni).toBe(true);
    const l = r.json.resultat;
    expect(l.statut).toBe('projet');
    expect(l.complet).toBe(false);
    expect(l.comparatif).toMatchObject({ statut: 'fourni', exercice: { debut: '2025-01-01', fin: '2025-12-31' } });
    expect(l.comparatif.totaux).toEqual(seule.totaux);
    const ref = new Map(seule.tableaux.flatMap((t: any) => t.lignes).map((x: any) => [x.ligne, x.montant]));
    for (const x of l.tableaux.flatMap((t: any) => t.lignes)) expect(x.n1.montant).toBe(ref.get(x.ligne));
    expect(l.tableaux.flatMap((t: any) => t.lignes).every((x: any) => /^-?\d+\.\d{2}$/.test(x.n1.montant))).toBe(true);
    // Régime simplifié : même colonne.
    const s2 = (await api('remi', 'GET', `/v1/exercices/${exN}/liasse?regime=reel_simplifie`)).json.resultat;
    expect(s2.comparatif.statut).toBe('fourni');
    // États projetés : N-1 par rubrique, totaux de l'exercice précédent.
    const etatsN1 = (await api('remi', 'GET', `/v1/exercices/${exN1}/etats`)).json;
    const etats = (await api('remi', 'GET', `/v1/exercices/${exN}/etats`)).json;
    expect(etats.comparatif.statut).toBe('fourni');
    expect(etats.comparatif.bilan.totaux.total_actif).toBe(etatsN1.bilan.totaux.total_actif);
    expect(etats.comparatif.compteDeResultat.totaux.resultat).toBe(etatsN1.compteDeResultat.totaux.resultat);
    expect(etats.comparatif.reserves.join(' ')).toMatch(/AVANT écritures d’inventaire/);
  }, 120_000);

  it('exercice précédent non contigu (aucun exercice entre les deux) : indisponible', async () => {
    // exApres suit exN ; on ne lui importe rien : sans comptabilité, 409, et exN n'a pas de N-1 « sauté ».
    expect((await api('remi', 'GET', `/v1/exercices/${exApres}/liasse`)).statut).toBe(409);
  });

  it('droits : le déposant n’y accède pas', async () => {
    expect((await api('client', 'GET', `/v1/exercices/${exN}/etats`)).statut).toBe(404);
    expect((await api('client', 'GET', `/v1/exercices/${exN}/liasse`)).statut).toBe(404);
  });
});
