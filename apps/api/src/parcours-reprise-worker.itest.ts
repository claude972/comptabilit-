/**
 * Arrêt BRUTAL du worker en plein traitement, puis reprise (P3, D-101) — pile réelle locale, cabinet NEUF.
 * Une API et un worker d'essai (préfixe de files dédié : le worker de la pile normale ne voit jamais ces tâches) sont lancés
 * contre la base, le stockage et Redis réels. Le worker est tué par SIGKILL pendant la lecture d'un gros FEC puis d'un gros
 * relevé ; un nouveau worker est démarré. Exigence : le traitement aboutit, lignes exactes, sans doublon, sans qu'une
 * personne ait à intervenir, et un worker VIVANT n'est jamais dédoublé par la reprise.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genererFecSynthetique, genererReleveSynthetique } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiCabinet, apiSur, attendre, deposerCabinet, jetons, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const PREFIXE = `essai-reprise-${SEL}`;
const EX = { debut: '2025-01-01', fin: '2025-12-31' };
const racine = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let editeur: pg.Client;
let cabinet = '';
let dossier = '';
let exercice = '';
const processus: ChildProcess[] = [];
let apiUrl = '';

async function portLibre(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}
function lancer(dossierApp: 'api' | 'worker', env: Record<string, string>): ChildProcess {
  const p = spawn(process.execPath, ['dist/main.js'], { cwd: join(racine, 'apps', dossierApp), env: { ...process.env, NODE_ENV: 'test', FILES_PREFIXE: PREFIXE, METRIQUES_PORT_API: '0', METRIQUES_PORT_WORKER: '0', ...env }, stdio: 'ignore' });
  processus.push(p);
  return p;
}
const lotEtat = async (id: string) => (await editeur.query(`select statut, progression from lots_import where id = $1`, [id])).rows[0] as { statut: string; progression: number };
const lignes = async (lot: string) => Number((await editeur.query(`select count(*) as n from lignes_ecriture where lot_import_id = $1`, [lot])).rows[0].n);
const fini = (e: { statut: string }) => ['termine', 'termine_avec_erreurs', 'echec'].includes(e.statut);

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai reprise worker ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur']] as const) await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '90 minutes')`, [cabinet, u, role]);
  const port = await portLibre();
  apiUrl = `http://127.0.0.1:${port}`;
  lancer('api', { API_PORT: String(port) });
  await attendre(() => fetch(`${apiUrl}/v1/sante`).then((r) => r.ok, () => false), (ok) => ok, 40_000);
  dossier = (await apiCabinet('alice', cabinet, 'POST', '/v1/dossiers', { raisonSociale: `Société reprise ${SEL} (fictive)`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id;
  for (const [u, n] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision']] as const) expect((await apiCabinet('alice', cabinet, 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau: n })).statut).toBe(200);
  exercice = (await apiCabinet('alice', cabinet, 'POST', `/v1/dossiers/${dossier}/exercices`, EX)).json.id;
}, 120_000);

afterAll(async () => {
  for (const p of processus) p.kill('SIGKILL');
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

/** Dépôt par l'API d'essai (jeton de la pile, même royaume). */
async function deposerSurApiEssai(buf: Buffer, extra: Record<string, unknown>, nom: string): Promise<string> {
  // Les appels portent l'en-tête de cabinet : l'aide commune le gère par compte.
  const { choisirCabinet } = await import('./essais/outils.js');
  choisirCabinet('remi', cabinet);
  try {
    const o = await apiSur(apiUrl, 'remi', 'POST', '/v1/televersements', { entiteId: dossier, nomFichier: nom, taille: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), canal: 'ordinateur', ...extra });
    expect(o.statut).toBe(201);
    let decalage: number = o.json.octetsRecus;
    while (decalage < buf.length) {
      const m = await apiSur(apiUrl, 'remi', 'PUT', `/v1/televersements/${o.json.id}/morceaux?decalage=${decalage}`, buf.subarray(decalage, decalage + o.json.tailleMorceau));
      expect(m.statut).toBe(200);
      decalage = m.json.octetsRecus;
    }
    const fin = await apiSur(apiUrl, 'remi', 'POST', `/v1/televersements/${o.json.id}/terminer`);
    expect(fin.statut).toBe(200);
    return fin.json.lotImportId as string;
  } finally {
    choisirCabinet('remi', null);
  }
}

describe('worker tué par SIGKILL pendant un import', () => {
  it('FEC : le lot reste « en cours » sans ligne, puis un nouveau worker le reprend et le termine, lignes exactes, sans doublon', async () => {
    void jetons;
    const fec = genererFecSynthetique({ exercice: EX, nbEcritures: 95_000, graine: 9800 });
    const w1 = lancer('worker', { NODE_OPTIONS: '--max-old-space-size=2048' });
    await new Promise((r) => setTimeout(r, 4_000)); // démarrage du worker d'essai
    const lot = await deposerSurApiEssai(Buffer.from(fec.contenu), { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
    await attendre(() => lotEtat(lot), (e) => e.statut === 'en_cours', 60_000);
    await new Promise((r) => setTimeout(r, 1_500));
    expect(fini(await lotEtat(lot))).toBe(false); // l'import est bien en cours au moment du coup
    w1.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 2_000));
    const apresCoup = await lotEtat(lot);
    console.log(`[mesure] après SIGKILL : ${JSON.stringify(apresCoup)}, lignes en base : ${await lignes(lot)}`);
    expect(await lignes(lot)).toBe(0); // la transaction d'import est abandonnée : aucune ligne partielle
    // Nouveau worker : la tâche calée est reprise par la file (détection des tâches calées), sans intervention humaine.
    lancer('worker', { NODE_OPTIONS: '--max-old-space-size=2048' });
    const t = Date.now();
    const e = await attendre(() => lotEtat(lot), fini, 240_000);
    console.log(`[mesure] reprise après SIGKILL : ${e.statut} en ${Date.now() - t} ms après le nouveau worker`);
    expect(e.statut).toBe('termine');
    expect(await lignes(lot)).toBe(fec.nbLignes);
    expect(Number((await editeur.query(`select count(*) as n from lignes_ecriture where exercice_id = $1`, [exercice])).rows[0].n)).toBe(fec.nbLignes);
  }, 600_000);

  it('un second worker VIVANT ne dédouble pas un import en cours (la reprise ne s’applique qu’à un worker mort)', async () => {
    const releve = genererReleveSynthetique({ graine: 9801, format: 'camt.053', debut: EX.debut, fin: EX.fin, nbMouvements: 40_000 });
    const lot = await deposerSurApiEssai(Buffer.from(releve.contenu, 'utf8'), { usage: 'banque' }, releve.nomFichier);
    // Deux workers actifs (le premier du test précédent, le second) : le lot est traité une seule fois.
    lancer('worker', { NODE_OPTIONS: '--max-old-space-size=2048' });
    const e = await attendre(() => lotEtat(lot), fini, 240_000);
    expect(['termine', 'termine_avec_erreurs']).toContain(e.statut);
    const n = Number((await editeur.query(`select count(*) as n from mouvements_bancaires where entite_id = $1`, [dossier])).rows[0].n);
    expect(n).toBe(releve.attendu.nbMouvements);
  }, 600_000);

  it('worker tué par SIGKILL pendant l’exécution des CONTRÔLES : un nouveau worker les reprend, un seul jeu de résultats, sans doublon (D-162)', async () => {
    // Dossier et exercice neufs : le FEC précédent a déjà été importé sur le premier exercice.
    const dossier2 = (await apiCabinet('alice', cabinet, 'POST', '/v1/dossiers', { raisonSociale: `Société reprise contrôles ${SEL} (fictive)`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id as string;
    for (const [u, n] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision']] as const) expect((await apiCabinet('alice', cabinet, 'PUT', `/v1/dossiers/${dossier2}/habilitations/${u}`, { niveau: n })).statut).toBeLessThan(300);
    const exercice2 = (await apiCabinet('alice', cabinet, 'POST', `/v1/dossiers/${dossier2}/exercices`, EX)).json.id as string;
    const [ancienDossier, ancienExercice] = [dossier, exercice];
    dossier = dossier2;
    exercice = exercice2;
    try {
      const fec = genererFecSynthetique({ exercice: EX, nbEcritures: 95_000, graine: 9802 });
      const w1 = lancer('worker', { NODE_OPTIONS: '--max-old-space-size=2048' });
      await new Promise((r) => setTimeout(r, 4_000));
      const lot = await deposerSurApiEssai(Buffer.from(fec.contenu), { usage: 'fec', exerciceId: exercice2, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
      const execution = async () => (await editeur.query(`select id, statut from executions_controles where lot_import_id = $1`, [lot])).rows[0] as { id: string; statut: string } | undefined;
      // Dès que l'exécution des contrôles existe et n'est pas terminée : coup de SIGKILL.
      const e0 = await attendre(execution, (e) => e !== undefined && e.statut !== 'termine', 240_000);
      w1.kill('SIGKILL');
      await new Promise((r) => setTimeout(r, 2_000));
      const apres = (await execution())!;
      const nbApres = Number((await editeur.query(`select count(*) as n from resultats_controles where execution_id = $1`, [e0!.id])).rows[0].n);
      console.log(`[mesure] contrôles après SIGKILL : ${apres.statut}, résultats en base : ${nbApres}`);
      expect(apres.statut).not.toBe('termine'); // le coup est bien tombé AVANT la fin (sinon l'essai ne prouverait rien)
      expect(nbApres).toBe(0); // transaction abandonnée : aucun résultat partiel
      lancer('worker', { NODE_OPTIONS: '--max-old-space-size=2048' });
      const t = Date.now();
      const fin = await attendre(execution, (e) => e?.statut === 'termine', 300_000);
      console.log(`[mesure] contrôles repris après SIGKILL : ${fin!.statut} en ${Date.now() - t} ms après le nouveau worker`);
      const r = (await editeur.query(`select count(*)::int as n, count(distinct controle_id)::int as distincts from resultats_controles where execution_id = $1`, [fin!.id])).rows[0];
      expect(r.n).toBeGreaterThan(0);
      expect(r.n).toBe(r.distincts); // un seul résultat par contrôle
      const c = (await editeur.query(`select count(*)::int as n, count(distinct (controle_id, cle))::int as distincts from constats where execution_id = $1`, [fin!.id])).rows[0];
      expect(c.n).toBe(c.distincts); // aucun constat en double
      expect(Number((await editeur.query(`select count(*) as n from executions_controles where lot_import_id = $1`, [lot])).rows[0].n)).toBe(1); // pas de seconde exécution
    } finally {
      dossier = ancienDossier;
      exercice = ancienExercice;
    }
  }, 900_000);
});
