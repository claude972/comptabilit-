/**
 * Dépendances indisponibles (P3, D-101) — pile réelle locale, cabinet NEUF, API supplémentaires lancées contre la même base
 * avec une dépendance volontairement injoignable (port fermé) : la pile normale n'est JAMAIS arrêtée ni perturbée.
 * Exigence : une panne de dépendance donne un échec explicite et borné dans le temps (jamais une requête pendue, jamais un 500
 * muet), ne perd aucun octet déjà confirmé, et le travail reprend dès que la dépendance revient (par les voies normales).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, type Server, type Socket, connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, apiSur, attendre, choisirCabinet, deposer, ouvrirSessions, pdfTexte, sha } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const COMPTES = ['alice', 'remi', 'chloe', 'client'] as const;
const racineApi = join(dirname(fileURLToPath(import.meta.url)), '..');

let editeur: pg.Client;
let cabinet = '';
let dossier = '';
interface Pile { url: string; processus: ChildProcess; journal: string }
const piles: Pile[] = [];

async function portFerme(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

async function lancerApi(variables: Record<string, string>, attenteMs = 40_000): Promise<Pile> {
  const port = await portFerme();
  const pile: Pile = { url: `http://127.0.0.1:${port}`, journal: '', processus: null as unknown as ChildProcess };
  const env = { ...process.env, NODE_ENV: 'test', API_PORT: String(port), METRIQUES_PORT_API: '0', FILES_PREFIXE: `essai-dep-${SEL}-${port}`, ...variables };
  pile.processus = spawn(process.execPath, ['dist/main.js'], { cwd: racineApi, env, stdio: ['ignore', 'pipe', 'pipe'] });
  pile.processus.stdout?.on('data', (d: Buffer) => (pile.journal += d.toString()));
  pile.processus.stderr?.on('data', (d: Buffer) => (pile.journal += d.toString()));
  piles.push(pile);
  try {
    await attendre(() => fetch(`${pile.url}/v1/sante`).then((r) => r.ok, () => false), (ok) => ok, attenteMs);
  } catch (e) {
    throw new Error(`API d'essai non démarrée : ${(e as Error).message}\n${pile.journal.slice(-1500)}`);
  }
  return pile;
}
const sur = (p: Pile, qui: string, methode: string, chemin: string, corps?: unknown) => apiSur(p.url, qui, methode, chemin, corps);

/**
 * Relais TCP coupable : l'API d'essai parle à la dépendance RÉELLE à travers lui ; `couper()` ferme les connexions et
 * refuse les nouvelles (panne en cours de fonctionnement), `retablir()` rouvre le même port (retour de la dépendance).
 * La dépendance réelle de la pile normale n'est jamais arrêtée.
 */
class Relais {
  private serveur: Server | null = null;
  private readonly sockets = new Set<Socket>();
  constructor(readonly port: number, private readonly cibleHote: string, private readonly ciblePort: number) {}
  async ouvrir(): Promise<void> {
    const serveur = createServer((entrant) => {
      const sortant = connect({ host: this.cibleHote, port: this.ciblePort });
      this.sockets.add(entrant).add(sortant);
      entrant.pipe(sortant).pipe(entrant);
      for (const x of [entrant, sortant]) x.on('error', () => x.destroy()).on('close', () => { this.sockets.delete(entrant); this.sockets.delete(sortant); entrant.destroy(); sortant.destroy(); });
    });
    await new Promise<void>((r, e) => serveur.once('error', e).listen(this.port, '127.0.0.1', () => r()));
    this.serveur = serveur;
  }
  async couper(): Promise<void> {
    const s = this.serveur;
    this.serveur = null;
    for (const x of this.sockets) x.destroy();
    this.sockets.clear();
    if (s) await new Promise<void>((r) => s.close(() => r()));
  }
  retablir(): Promise<void> {
    return this.ouvrir();
  }
}
async function relaisVers(url: string): Promise<Relais> {
  const u = new URL(url);
  const r = new Relais(await portFerme(), u.hostname, Number(u.port));
  await r.ouvrir();
  return r;
}

/** Mesure la durée d'un appel : une panne doit se manifester vite. */
async function chrono<T>(f: () => Promise<T>): Promise<{ v: T; ms: number }> {
  const t = Date.now();
  const v = await f();
  return { v, ms: Date.now() - t };
}

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai dépendances ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '40 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  dossier = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Société d’essai dépendances ${SEL} SAS (fictive)`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
  }
}, 120_000);

afterAll(async () => {
  for (const pile of piles) pile.processus.kill('SIGKILL');
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

const piece = (marque: string) => pdfTexte(['Facture d’essai', `Référence ${SEL}-${marque}`, 'Total TTC : 120,00 €'], `${SEL}-${marque}`);

describe('Redis (file des travaux) : panne EN COURS de fonctionnement, puis retour', () => {
  let pile: Pile;
  let relais: Relais;
  let docId = '';
  const deposer1 = async (qui: Pile, marque: string) => {
    const contenu = piece(marque);
    const o = await sur(qui, 'client', 'POST', '/v1/televersements', { entiteId: dossier, nomFichier: `${marque}.pdf`, taille: contenu.length, sha256: sha(contenu), canal: 'ordinateur' });
    expect(o.statut).toBe(201);
    expect((await sur(qui, 'client', 'PUT', `/v1/televersements/${o.json.id}/morceaux?decalage=0`, contenu)).statut).toBe(200);
    return chrono(() => sur(qui, 'client', 'POST', `/v1/televersements/${o.json.id}/terminer`));
  };
  beforeAll(async () => {
    const r = new URL(process.env.REDIS_URL!);
    relais = await relaisVers(`redis://${r.hostname}:${r.port}`);
    pile = await lancerApi({ REDIS_URL: `redis://:${decodeURIComponent(r.password)}@127.0.0.1:${relais.port}` });
  });
  afterAll(() => relais.couper());

  it('Redis disponible : la clôture met la tâche en file (réponse sans erreur)', async () => {
    const { v, ms } = await deposer1(pile, 'redis-0');
    console.log(`[mesure] clôture, Redis disponible via relais : ${v.statut} en ${ms} ms`);
    expect(v.statut).toBe(200);
  });

  it('Redis coupé : la clôture d’un dépôt répond vite, pièce « reçue » et conservée ; « réanalyser » refuse en 503 explicite ; lectures intactes', async () => {
    await relais.couper();
    const { v: fin, ms } = await deposer1(pile, 'redis-1');
    console.log(`[mesure] clôture avec Redis coupé : ${fin.statut} en ${ms} ms`);
    expect(fin.statut).toBe(200);
    expect(fin.json.recu).toBe(true);
    expect(ms).toBeLessThan(15_000);
    docId = fin.json.documentId as string;
    expect((await api('remi', 'GET', `/v1/documents/${docId}`)).json.document.statut).toBe('recu'); // rien analysé, rien perdu
    const { v, ms: ms2 } = await chrono(() => sur(pile, 'chloe', 'POST', `/v1/documents/${docId}/reanalyse`));
    console.log(`[mesure] réanalyse avec Redis coupé : ${v.statut} en ${ms2} ms`);
    expect(v.statut).toBe(503);
    expect(v.json.message).toMatch(/files de travaux indisponible/i);
    expect(ms2).toBeLessThan(15_000);
    expect((await sur(pile, 'remi', 'GET', `/v1/documents/${docId}`)).statut).toBe(200); // mode dégradé : lectures
    expect((await sur(pile, 'alice', 'GET', '/v1/audit?limite=5')).statut).toBe(200);
  });

  it('Redis rétabli : la même API reprend sans redémarrage ; la pièce restée « reçue » est alors traitée', async () => {
    await relais.retablir();
    const r = await attendre(() => sur(pile, 'chloe', 'POST', `/v1/documents/${docId}/reanalyse`), (x) => x.statut !== 503, 30_000);
    expect([200, 202]).toContain(r.statut);
  });
});

describe('Stockage objet (S3) : panne EN COURS de fonctionnement, puis retour', () => {
  let pile: Pile;
  let relais: Relais;
  beforeAll(async () => {
    relais = await relaisVers(process.env.S3_ENDPOINT!);
    pile = await lancerApi({ S3_ENDPOINT: `http://127.0.0.1:${relais.port}` });
  });
  afterAll(() => relais.couper());

  it('un morceau pendant la panne : échec explicite et borné, aucun octet compté, pas de fuite de détail ; le dépôt est repris tel quel après retour', async () => {
    const contenu = piece('s3');
    const o = await sur(pile, 'client', 'POST', '/v1/televersements', { entiteId: dossier, nomFichier: 's3.pdf', taille: contenu.length, sha256: sha(contenu), canal: 'ordinateur' });
    expect(o.statut).toBe(201);
    await relais.couper();
    const { v: m, ms } = await chrono(() => sur(pile, 'client', 'PUT', `/v1/televersements/${o.json.id}/morceaux?decalage=0`, contenu));
    console.log(`[mesure] morceau avec S3 coupé : ${m.statut} en ${ms} ms : ${JSON.stringify(m.json)}`);
    expect(m.statut).toBe(503);
    expect(m.json.message).toMatch(/Stockage des documents indisponible/);
    expect(ms).toBeLessThan(30_000);
    expect(JSON.stringify(m.json)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|stack/i);
    const etat = await api('client', 'GET', `/v1/televersements/${o.json.id}`);
    expect(etat.json.octetsRecus).toBe(0); // le serveur fait foi
    await relais.retablir();
    // Même séance, même API, après retour : la reprise aboutit.
    const m2 = await attendre(() => sur(pile, 'client', 'PUT', `/v1/televersements/${o.json.id}/morceaux?decalage=0`, contenu), (x) => x.statut === 200, 30_000);
    expect(m2.statut).toBe(200);
    const fin = await sur(pile, 'client', 'POST', `/v1/televersements/${o.json.id}/terminer`);
    expect(fin.statut).toBe(200);
    expect(fin.json.recu).toBe(true);
  });

  it('la lecture d’un original pendant la panne refuse explicitement (aucun résultat partiel) ; elle fonctionne après retour', async () => {
    const contenu = piece('s3-lecture');
    const dep = await deposer('chloe', dossier, contenu, {}, 's3-lecture.pdf');
    const id = dep.fin.json.documentId as string;
    await attendre(() => api('remi', 'GET', `/v1/documents/${id}`), (x) => x.statut === 200 && !['recu', 'en_analyse'].includes(x.json.document.statut));
    await relais.couper();
    const { v, ms } = await chrono(() => sur(pile, 'remi', 'GET', `/v1/documents/${id}/contenu`));
    console.log(`[mesure] contenu avec S3 coupé : ${v.statut} en ${ms} ms`);
    expect(v.statut).toBe(503);
    expect(v.json.message).toMatch(/Stockage des documents indisponible/);
    expect(ms).toBeLessThan(30_000);
    await relais.retablir();
    const ok = await attendre(() => sur(pile, 'remi', 'GET', `/v1/documents/${id}/contenu`), (x) => x.statut === 200, 30_000);
    expect(ok.brut.length).toBeGreaterThan(50);
  });
});

describe('Fournisseur d’identité (Keycloak) injoignable côté API', () => {
  it('une session valide est refusée sans vérification possible, avec un message qui nomme la panne (503), jamais acceptée ; /v1/sante répond encore', async () => {
    const port = await portFerme();
    const pile = await lancerApi({ OIDC_ISSUER: `http://127.0.0.1:${port}/realms/inexistant` });
    const { v, ms } = await chrono(() => sur(pile, 'remi', 'GET', '/v1/dossiers'));
    console.log(`[mesure] session avec Keycloak injoignable : ${v.statut} en ${ms} ms : ${JSON.stringify(v.json)}`);
    expect(v.statut).toBe(503);
    expect(v.json.message).toMatch(/identité indisponible/);
    expect(ms).toBeLessThan(15_000);
    expect((await fetch(`${pile.url}/v1/sante`)).status).toBe(200);
  });
});

describe('Base de données : coupure EN COURS de fonctionnement, puis retour', () => {
  it('requêtes refusées en 503 explicite et rapide, processus de l’API vivant ; reprise sans redémarrage ; aucune donnée altérée', async () => {
    const relais = await relaisVers(`http://${process.env.PG_HOST ?? '127.0.0.1'}:${process.env.PG_PORT ?? '5432'}`);
    try {
      const pile = await lancerApi({ PG_HOST: '127.0.0.1', PG_PORT: String(relais.port) });
      expect((await sur(pile, 'remi', 'GET', '/v1/dossiers')).statut).toBe(200);
      const avant = (await sur(pile, 'remi', 'GET', '/v1/dossiers')).json.length;
      await relais.couper();
      const { v, ms } = await chrono(() => sur(pile, 'remi', 'GET', '/v1/dossiers'));
      console.log(`[mesure] lecture avec la base coupée : ${v.statut} en ${ms} ms : ${JSON.stringify(v.json)}`);
      expect(v.statut).toBe(503);
      expect(v.json.message).toMatch(/Base de données indisponible/);
      expect(ms).toBeLessThan(35_000);
      const e = await sur(pile, 'alice', 'PATCH', `/v1/dossiers/${dossier}`, { territoireFiscal: 'metropole' });
      expect(e.statut).toBe(503);
      expect(pile.processus.exitCode).toBeNull(); // l'API n'est pas tombée
      expect((await fetch(`${pile.url}/v1/sante`)).status).toBeGreaterThanOrEqual(500); // la sonde dit la vérité : base indisponible
      await relais.retablir();
      const ok = await attendre(() => sur(pile, 'remi', 'GET', '/v1/dossiers'), (x) => x.statut === 200, 30_000);
      expect(ok.json.length).toBe(avant);
      expect((await fetch(`${pile.url}/v1/sante`)).status).toBe(200);
      expect(pile.processus.exitCode).toBeNull();
    } finally {
      await relais.couper();
    }
  });
});
