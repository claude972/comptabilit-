/**
 * Rattrapage et purge — PostgreSQL et stockage objet réels ; file de tâches réelle mais sous un préfixe d'essai, pour
 * que le worker en service ne consomme pas les tâches créées ici.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { creerAccesBd, urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { chargerEnvLocal } from '@comtaple/db/env';
import { cles, connexionRedis, Files, lireConfig, Stockage } from '@comtaple/plateforme';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Contexte } from './contexte.js';
import { purgerTeleversements, rattraper } from './rattrapage.js';

chargerEnvLocal();
const cfg = lireConfig();
const SEL = randomBytes(4).toString('hex');
let admin: pg.Client;
let c: Contexte;
const televersementId = randomUUID();
const restitutionId = randomUUID();
const recent = randomUUID();

beforeAll(async () => {
  admin = new pg.Client({ connectionString: urlBd('admin') });
  await admin.connect();
  c = { cfg, bd: creerAccesBd(urlBd('worker')), stockage: new Stockage(cfg), taches: new Files(connexionRedis(cfg.REDIS_URL), `essai-rattrapage-${SEL}`) };
});
afterAll(async () => {
  await admin.query('delete from restitutions where id = any($1)', [[restitutionId, recent]]);
  await admin.query('delete from televersements where id = $1', [televersementId]);
  for (const file of [c.taches.documents, c.taches.comptabilite, c.taches.exports, c.taches.mail]) await file.obliterate({ force: true }).catch(() => undefined);
  await c.taches.fermer();
  await c.bd.fermer();
  await admin.end();
});

describe('purge des téléversements abandonnés', () => {
  it('supprime les morceaux d’un téléversement expiré et le marque abandonné ; ne touche pas aux téléversements en cours', async () => {
    const cle = cles.morceau(DEMO.cabinetA, televersementId, 0);
    await c.stockage.deposer(cle, Buffer.from('morceau orphelin'));
    await admin.query(
      `insert into televersements (id, cabinet_id, entite_id, utilisateur_id, canal, nom_fichier, taille_attendue, sha256_attendu, octets_recus, expire_le, cree_le)
       values ($1, $2, $3, $4, 'telephone', 'abandon.pdf', 1000, $5, 16, now() - interval '1 hour', now() - interval '8 days')`,
      [televersementId, DEMO.cabinetA, DEMO.dupain, DEMO.client, 'a'.repeat(64)],
    );
    const ouvertsAvant = Number((await admin.query(`select count(*)::int as n from televersements where statut = 'ouvert' and expire_le > now()`)).rows[0].n);
    expect(await c.stockage.existe(cle)).toBe(true);
    expect(await purgerTeleversements(c)).toBeGreaterThanOrEqual(1);
    expect(await c.stockage.existe(cle)).toBe(false);
    expect((await admin.query('select statut from televersements where id = $1', [televersementId])).rows[0].statut).toBe('abandonne');
    expect(Number((await admin.query(`select count(*)::int as n from televersements where statut = 'ouvert' and expire_le > now()`)).rows[0].n)).toBe(ouvertsAvant);
    expect(await purgerTeleversements(c)).toBe(0); // rien à refaire
  });
});

describe('rattrapage des traitements en attente', () => {
  it('remet en file un traitement confirmé en base mais absent de la file, et laisse les traitements récents', async () => {
    await admin.query(`insert into restitutions (id, cabinet_id, entite_id, statut, demande_par, cree_le) values ($1, $2, $3, 'en_attente', $4, now() - interval '30 minutes')`, [restitutionId, DEMO.cabinetB, DEMO.leroy, DEMO.bruno]);
    await admin.query(`insert into restitutions (id, cabinet_id, entite_id, statut, demande_par) values ($1, $2, $3, 'en_attente', $4)`, [recent, DEMO.cabinetB, DEMO.leroy, DEMO.bruno]);
    const bilan = await rattraper(c);
    expect(bilan.traitements.restitution).toBeGreaterThanOrEqual(1);
    const enFile = await c.taches.exports.getJobs(['waiting', 'delayed', 'prioritized']);
    const ids = enFile.filter((j) => j.name === 'restitution').map((j) => j.data.restitutionId);
    expect(ids).toContain(restitutionId);
    expect(ids).not.toContain(recent); // moins de dix minutes : pas encore considéré comme perdu
    // Les charges utiles ne portent que des identifiants.
    expect(Object.keys(enFile.find((j) => j.data.restitutionId === restitutionId)!.data).sort()).toEqual(['cabinetId', 'restitutionId']);
    // Un second passage ne duplique pas la tâche (même identifiant de tâche).
    await rattraper(c);
    expect((await c.taches.exports.getJobs(['waiting', 'delayed', 'prioritized'])).filter((j) => j.data.restitutionId === restitutionId)).toHaveLength(1);
  });

  it('D-101 : un import resté « en cours » depuis longtemps (worker mort, file perdue) est remis en file ; un import récent en cours ne l\u2019est pas', async () => {
    const ancien = randomUUID();
    const recentEnCours = randomUUID();
    try {
      await admin.query(`insert into lots_import (id, cabinet_id, entite_id, type, statut, cle_idempotence, cree_le) values ($1, $2, $3, 'fec', 'en_cours', $4, now() - interval '40 minutes')`, [ancien, DEMO.cabinetB, DEMO.leroy, `essai-rattrapage:${ancien}`]);
      await admin.query(`insert into lots_import (id, cabinet_id, entite_id, type, statut, cle_idempotence) values ($1, $2, $3, 'fec', 'en_cours', $4)`, [recentEnCours, DEMO.cabinetB, DEMO.leroy, `essai-rattrapage:${recentEnCours}`]);
      const bilan = await rattraper(c);
      expect(bilan.traitements.import_fec).toBeGreaterThanOrEqual(1);
      const ids = (await c.taches.comptabilite.getJobs(['waiting', 'delayed', 'prioritized'])).filter((j) => j.name === 'importer-fec').map((j) => j.data.lotImportId);
      expect(ids).toContain(ancien);
      expect(ids).not.toContain(recentEnCours);
    } finally {
      await admin.query('delete from lots_import where id = any($1)', [[ancien, recentEnCours]]);
    }
  });

  it('le rôle du worker ne peut appeler que ses fonctions de rattrapage, qui ne renvoient que des identifiants', async () => {
    const r = await c.bd.pool.query('select * from worker_traitements_en_attente(10, 5)');
    for (const ligne of r.rows) expect(Object.keys(ligne).sort()).toEqual(['cabinet_id', 'identifiant', 'nature']);
    const app = new pg.Client({ connectionString: urlBd('app') });
    await app.connect();
    await expect(app.query('select * from worker_traitements_en_attente(10, 5)')).rejects.toThrow(/permission|droit/i);
    await app.end();
  });
});
