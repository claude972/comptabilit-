/**
 * Lots multi-dossiers et PLUSIEURS WORKERS (D-168) — pile réelle locale : l'API et le worker de la pile, plus DEUX workers
 * supplémentaires lancés sur les mêmes files (même base, même Redis, même stockage). Trois cabinets neufs, quatre dossiers
 * chacun, un FEC par dossier (douze imports déposés en même temps), d'abord avec le seul worker de la pile (référence), puis
 * avec trois workers. Exigences : tous les lots aboutissent, lignes exactes par lot, UNE seule exécution de contrôles par lot
 * (aucun traitement dédoublé entre workers), aucune ligne chez un autre cabinet, aucune erreur 5xx. Les durées sont affichées ;
 * l'accélération n'est pas une exigence (poste unique, base partagée), seule l'exactitude l'est.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genererFecSynthetique } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiCabinet, attendre, deposerCabinet, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const EX = { debut: '2025-01-01', fin: '2025-12-31' };
const racine = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const K = 3;
const PAR_CABINET = 4;
const fini = (r: { json: any }) => ['termine', 'termine_avec_erreurs', 'echec'].includes(r.json?.statut);
interface Cab { id: string; dossiers: Array<{ dossier: string; exercice: string }> }
let editeur: pg.Client;
const cabs: Cab[] = [];
const supplementaires: ChildProcess[] = [];
const mesures: Record<string, unknown> = {};

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  for (let k = 0; k < K; k++) {
    const id = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai workers ${k + 1} ${SEL} (fictif)`])).rows[0].id as string;
    await ouvrirEssai(editeur, id, 'demo-essentiel', new Date().toISOString().slice(0, 10));
    for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur']] as const) await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '120 minutes')`, [id, u, role]);
    cabs.push({ id, dossiers: [] });
  }
}, 120_000);

afterAll(async () => {
  console.log(`[mesure] ${JSON.stringify(mesures)}`);
  for (const p of supplementaires) p.kill('SIGKILL');
  for (const c of cabs) await editeur.query('update appartenances set actif = false where cabinet_id = $1', [c.id]);
  await editeur.end();
});

async function creerDossiers(): Promise<Array<{ c: Cab; dossier: string; exercice: string }>> {
  const out: Array<{ c: Cab; dossier: string; exercice: string }> = [];
  for (const c of cabs) {
    for (let j = 0; j < PAR_CABINET; j++) {
      const dossier = (await apiCabinet('alice', c.id, 'POST', '/v1/dossiers', { raisonSociale: `Société lots ${SEL} ${c.dossiers.length + 1} (fictive)`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id as string;
      for (const [u, n] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision']] as const) expect((await apiCabinet('alice', c.id, 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau: n })).statut).toBe(200);
      const exercice = (await apiCabinet('alice', c.id, 'POST', `/v1/dossiers/${dossier}/exercices`, EX)).json.id as string;
      c.dossiers.push({ dossier, exercice });
      out.push({ c, dossier, exercice });
    }
  }
  return out;
}

/** Douze FEC déposés en même temps ; renvoie la durée jusqu'aux contrôles terminés et vérifie l'exactitude. */
async function vague(nom: string, graine: number): Promise<number> {
  const ds = await creerDossiers();
  const fecs = ds.map((_, i) => genererFecSynthetique({ exercice: EX, nbEcritures: 3_000, graine: graine + i }));
  const t = performance.now();
  const res = await Promise.all(ds.map(async (d, i) => {
    const dep = await deposerCabinet('remi', d.c.id, d.dossier, Buffer.from(fecs[i]!.contenu), { usage: 'fec', exerciceId: d.exercice, statutDonnees: 'travail_avant_cloture' }, fecs[i]!.nomFichier);
    expect(dep.fin?.statut, JSON.stringify(dep.fin?.json)).toBe(200);
    const lot = await attendre(() => apiCabinet('remi', d.c.id, 'GET', `/v1/imports/${dep.fin!.json.lotImportId}`), fini, 600_000);
    const revue = await attendre(() => apiCabinet('remi', d.c.id, 'GET', `/v1/exercices/${d.exercice}/revue`), (r) => ['termine', 'echec'].includes(r.json?.execution?.statut), 600_000);
    return { lot, revue };
  }));
  const ms = performance.now() - t;
  for (const [i, r] of res.entries()) {
    expect(r.lot.json.statut, `${nom} dossier ${i + 1}`).toBe('termine');
    expect(r.revue.json.execution.statut, `${nom} contrôles ${i + 1}`).toBe('termine');
    const lotId = r.lot.json.id as string;
    expect(Number((await editeur.query(`select count(*) as n from lignes_ecriture where lot_import_id = $1`, [lotId])).rows[0].n)).toBe(fecs[i]!.nbLignes);
    expect(Number((await editeur.query(`select count(*) as n from lignes_ecriture where lot_import_id = $1 and (cabinet_id <> $2 or exercice_id <> $3)`, [lotId, ds[i]!.c.id, ds[i]!.exercice])).rows[0].n)).toBe(0);
    // Aucun traitement dédoublé entre workers : une seule exécution de contrôles et un seul lot par exercice et par vague.
    expect(Number((await editeur.query(`select count(*) as n from executions_controles where lot_import_id = $1`, [lotId])).rows[0].n), `exécutions du dossier ${i + 1}`).toBe(1);
    expect(Number((await editeur.query(`select count(*) as n from lots_import where exercice_id = $1`, [ds[i]!.exercice])).rows[0].n)).toBe(1);
  }
  return ms;
}

describe('douze imports simultanés dans trois cabinets (quatre dossiers chacun)', () => {
  it('référence : le seul worker de la pile', async () => {
    mesures.unWorker = { ms: Math.round(await vague('1 worker', 9900)), dossiers: K * PAR_CABINET };
  }, 900_000);

  it('trois workers sur les mêmes files : mêmes garanties, aucun traitement dédoublé', async () => {
    for (let i = 0; i < 2; i++) supplementaires.push(spawn(process.execPath, ['dist/main.js'], { cwd: join(racine, 'apps', 'worker'), env: { ...process.env, NODE_ENV: 'test', METRIQUES_PORT_WORKER: '0', NODE_OPTIONS: '--max-old-space-size=2048' }, stdio: 'ignore' }));
    await new Promise((r) => setTimeout(r, 6_000));
    expect(supplementaires.every((p) => p.exitCode === null)).toBe(true);
    mesures.troisWorkers = { ms: Math.round(await vague('3 workers', 9950)), dossiers: K * PAR_CABINET };
  }, 900_000);
});
