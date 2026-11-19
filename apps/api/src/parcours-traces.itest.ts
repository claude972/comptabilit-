/**
 * Traces OpenTelemetry de bout en bout, sur de VRAIS processus : une API et un worker (`dist/main.js`) lancés à part,
 * sur un port et un préfixe de files d'essai, exportent en OTLP/HTTP vers un collecteur de test tenu par ce fichier
 * (simple serveur HTTP local : aucun collecteur externe n'est nécessaire, en CI comme sur le poste).
 *
 * Prouvé ici : la requête de dépôt et l'analyse de la pièce par le worker portent le MÊME identifiant de trace ; rien
 * de ce qui est exporté ne contient le nom du fichier, le texte de la pièce, une adresse électronique ou un jeton ;
 * collecteur absent (port fermé), le dépôt et l'analyse aboutissent normalement.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO } from '@comtaple/db/amorcer';
import { ATTRIBUTS_ADMIS, connexionRedis, Files } from '@comtaple/plateforme';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attendre, COMPTES, jetons, ouvrirSessions, pdfTexte, sha } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
// Port libre et préfixe de files propres à CETTE exécution : deux exécutions simultanées de la suite ne se gênent pas.
let PORT = 0;
let API = '';
const PREFIXE = `essai-traces-${SEL}`;
const racineApi = join(dirname(fileURLToPath(import.meta.url)), '..');

interface SpanRecu {
  service: string;
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  attributs: Record<string, unknown>;
}

interface Pile {
  journaux: Record<'api' | 'worker', string>;
  arreter(): Promise<number>;
}

/** Lance une API et un worker réels, isolés de la pile normale ; `arreter` renvoie la durée de l'arrêt (SIGTERM → sortie). */
async function lancerPile(pointAcces: string): Promise<Pile> {
  const journaux = { api: '', worker: '' };
  const processus: ChildProcess[] = [];
  const env = { ...process.env, NODE_ENV: 'test', API_PORT: String(PORT), FILES_PREFIXE: PREFIXE, METRIQUES_PORT_API: '0', METRIQUES_PORT_WORKER: '0', OTEL_EXPORTER_OTLP_ENDPOINT: pointAcces, TRACES_TAUX_ECHANTILLONNAGE: '1', COMTAPLE_VERSION: `essai-${SEL}` };
  for (const [nom, dossier] of [['api', racineApi], ['worker', join(racineApi, '..', 'worker')]] as const) {
    const p = spawn(process.execPath, ['dist/main.js'], { cwd: dossier, env, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d: Buffer) => (journaux[nom] += d.toString()));
    p.stderr.on('data', (d: Buffer) => (journaux[nom] += d.toString()));
    processus.push(p);
  }
  try {
    await attendre(
      () => fetch(`${API}/v1/sante`).then((r) => r.ok, () => false),
      (ok) => ok && /Worker Comtaple démarré/.test(journaux.worker),
      40_000,
    );
  } catch (e) {
    for (const p of processus) p.kill('SIGKILL');
    throw new Error(`pile d'essai non démarrée : ${(e as Error).message}\n${journaux.api.slice(-1500)}\n${journaux.worker.slice(-1500)}`);
  }
  return {
    journaux,
    async arreter() {
      const debut = Date.now();
      await Promise.all(
        processus.map(
          (p) =>
            new Promise<void>((r) => {
              if (p.exitCode !== null || p.signalCode !== null) return r();
              const garde = setTimeout(() => p.kill('SIGKILL'), 30_000);
              p.once('exit', () => (clearTimeout(garde), r()));
              p.kill('SIGTERM');
            }),
        ),
      );
      return Date.now() - debut;
    },
  };
}

async function api(qui: string, methode: string, chemin: string, corps?: unknown) {
  const binaire = Buffer.isBuffer(corps);
  const debut = performance.now();
  const r = await fetch(`${API}${chemin}`, {
    method: methode,
    // Cabinet toujours précisé : un autre parcours peut rattacher temporairement ce compte à un second cabinet.
    headers: { authorization: `Bearer ${jetons[qui]}`, 'x-cabinet-id': DEMO.cabinetA, ...(corps !== undefined ? { 'content-type': binaire ? 'application/octet-stream' : 'application/json' } : {}) },
    body: corps === undefined ? undefined : binaire ? new Uint8Array(corps as Buffer) : JSON.stringify(corps),
  });
  const json = (await r.json().catch(() => null)) as any;
  return { statut: r.status, json, dureeMs: performance.now() - debut };
}

/** Dépôt complet d'une pièce (ouverture, morceaux, fin) puis attente de la fin de son analyse par le worker. */
async function deposerEtAttendre(nomFichier: string, contenu: Buffer) {
  const durees: number[] = [];
  const o = await api('chloe', 'POST', '/v1/televersements', { entiteId: DEMO.dupain, nomFichier, taille: contenu.length, sha256: sha(contenu), canal: 'ordinateur' });
  expect(o.statut, JSON.stringify(o.json)).toBe(201);
  durees.push(o.dureeMs);
  const m = await api('chloe', 'PUT', `/v1/televersements/${o.json.id}/morceaux?decalage=0`, contenu);
  expect(m.statut, JSON.stringify(m.json)).toBe(200);
  durees.push(m.dureeMs);
  const fin = await api('chloe', 'POST', `/v1/televersements/${o.json.id}/terminer`);
  expect(fin.statut).toBeLessThan(300);
  durees.push(fin.dureeMs);
  const documentId = fin.json.documentId as string;
  const debutAnalyse = Date.now();
  const doc = await attendre(
    () => api('chloe', 'GET', `/v1/documents/${documentId}`),
    (r) => r.statut === 200 && !['recu', 'en_analyse'].includes(r.json.document.statut),
  );
  return { documentId, televersementId: o.json.id as string, statut: doc.json.document.statut as string, durees, analyseMs: Date.now() - debutAnalyse };
}

async function viderFiles() {
  const files = new Files(connexionRedis(process.env.REDIS_URL!), PREFIXE);
  for (const f of [files.mail, files.documents, files.comptabilite, files.exports]) await f.obliterate({ force: true }).catch(() => undefined);
  await files.fermer();
}

const NOM_FICHIER = `facture-sentinelle-${SEL}.pdf`;
const LIBELLE = `Boulangerie Sentinelle ${SEL}`;
const piece = (sel: string) => pdfTexte([`FACTURE N° F-${SEL}`, LIBELLE, 'Fournitures de bureau', 'Total TTC 123,45 €'], sel);

let collecteur: Server;
const corpsRecus: string[] = [];
let avecCollecteur: { documentId: string; televersementId: string; durees: number[]; analyseMs: number };

beforeAll(async () => {
  const libre = createServer();
  await new Promise<void>((r) => libre.listen(0, '127.0.0.1', () => r()));
  PORT = (libre.address() as AddressInfo).port;
  API = `http://127.0.0.1:${PORT}`;
  await new Promise<void>((r) => libre.close(() => r()));
  await ouvrirSessions();
  await viderFiles();
  collecteur = createServer((req, res) => {
    const morceaux: Buffer[] = [];
    req.on('data', (m: Buffer) => morceaux.push(m));
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/v1/traces') corpsRecus.push(Buffer.concat(morceaux).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  await new Promise<void>((r) => collecteur.listen(0, '127.0.0.1', () => r()));
});

afterAll(async () => {
  collecteur?.closeAllConnections();
  await new Promise<void>((r) => collecteur.close(() => r()));
  await viderFiles();
});

function spansRecus(): SpanRecu[] {
  const valeur = (v: any): unknown => v?.stringValue ?? (v?.intValue !== undefined ? Number(v.intValue) : (v?.doubleValue ?? v?.boolValue));
  const spans: SpanRecu[] = [];
  for (const corps of corpsRecus) {
    for (const rs of JSON.parse(corps).resourceSpans ?? []) {
      const service = String(valeur(rs.resource.attributes.find((a: any) => a.key === 'service.name')?.value));
      for (const ss of rs.scopeSpans ?? [])
        for (const s of ss.spans ?? [])
          spans.push({ service, traceId: s.traceId, spanId: s.spanId, parentSpanId: s.parentSpanId ?? '', name: s.name, attributs: Object.fromEntries((s.attributes ?? []).map((a: any) => [a.key, valeur(a.value)])) });
    }
  }
  return spans;
}

describe('traces : requête de dépôt → travail → worker, collecteur présent', () => {
  const idInconnu = randomUUID();

  it('la pièce est déposée et analysée ; les spans en attente sont envoyés à l’arrêt des processus', async () => {
    const pile = await lancerPile(`http://127.0.0.1:${(collecteur.address() as AddressInfo).port}`);
    try {
      expect(pile.journaux.api).toMatch(/Traces OpenTelemetry actives/);
      expect(pile.journaux.worker).toMatch(/Traces OpenTelemetry actives/);
      avecCollecteur = await deposerEtAttendre(NOM_FICHIER, piece(`${SEL}-a`));
      // Dernière requête, juste avant l'arrêt : son span ne peut arriver que par le vidage à l'arrêt.
      expect((await api('chloe', 'GET', `/v1/documents/${idInconnu}?apercu=${encodeURIComponent(LIBELLE)}`)).statut).toBe(404);
    } finally {
      await pile.arreter();
    }
    expect(`${pile.journaux.api}${pile.journaux.worker}`).not.toMatch(/export impossible/);
  });

  it('la requête « terminer » et le traitement « analyser » du worker appartiennent à la même trace, en filiation directe', () => {
    const spans = spansRecus();
    const requete = spans.find((s) => s.service === 'comtaple-api' && s.name === 'POST /v1/televersements/:id/terminer' && s.attributs['comtaple.route.id'] === avecCollecteur.televersementId)!;
    expect(requete, 'span de la requête de fin de dépôt').toBeDefined();
    expect(requete.parentSpanId).toBe('');
    expect(requete.attributs).toMatchObject({ 'http.request.method': 'POST', 'http.route': '/v1/televersements/:id/terminer', 'http.response.status_code': 200 });

    const miseEnFile = spans.find((s) => s.name === 'mettre en file documents analyser' && s.attributs['comtaple.document.id'] === avecCollecteur.documentId)!;
    expect(miseEnFile, 'span de mise en file').toBeDefined();
    expect(miseEnFile.service).toBe('comtaple-api');
    expect(miseEnFile.traceId).toBe(requete.traceId);
    expect(miseEnFile.parentSpanId).toBe(requete.spanId);

    const traitement = spans.find((s) => s.name === 'traiter documents analyser' && s.attributs['comtaple.document.id'] === avecCollecteur.documentId)!;
    expect(traitement, 'span du traitement par le worker').toBeDefined();
    expect(traitement.service).toBe('comtaple-worker');
    expect(traitement.traceId).toBe(requete.traceId);
    expect(traitement.parentSpanId).toBe(miseEnFile.spanId);
    expect(traitement.attributs).toMatchObject({ 'messaging.destination.name': 'documents', 'comtaple.travail.nom': 'analyser', 'comtaple.travail.contexte_recu': true, 'comtaple.cabinet.id': DEMO.cabinetA });

    // La même trace réunit des spans des deux services, dont les accès à la base et au stockage faits par le worker.
    const trace = spans.filter((s) => s.traceId === requete.traceId);
    expect(new Set(trace.map((s) => s.service))).toEqual(new Set(['comtaple-api', 'comtaple-worker']));
    const duWorker = trace.filter((s) => s.service === 'comtaple-worker').map((s) => s.name);
    expect(duWorker).toContain('bd transaction');
    expect(duWorker.some((n) => n.startsWith('stockage '))).toBe(true);
    expect(trace.filter((s) => s.service === 'comtaple-api').map((s) => s.name)).toContain('bd transaction');

    // Chaque requête ouvre sa propre trace ; la dernière, émise juste avant l'arrêt, a bien été vidée.
    const derniere = spans.find((s) => s.attributs['comtaple.route.id'] === idInconnu)!;
    expect(derniere, 'span de la dernière requête avant arrêt').toBeDefined();
    expect(derniere.name).toBe('GET /v1/documents/:id');
    expect(derniere.attributs['http.response.status_code']).toBe(404);
    expect(derniere.traceId).not.toBe(requete.traceId);
    // Un travail sans requête d'origine (planifié) ouvre une trace neuve.
    for (const s of spans.filter((x) => x.name.startsWith('traiter ') && x.attributs['comtaple.travail.contexte_recu'] === false)) expect(s.parentSpanId).toBe('');
  });

  it('rien de ce qui a été exporté ne contient de donnée interdite ; tous les attributs sont dans la liste blanche', () => {
    const tout = corpsRecus.join('\n');
    expect(tout.length).toBeGreaterThan(1_000);
    const interdits: Record<string, string> = {
      'nom du fichier': NOM_FICHIER,
      'libellé de la pièce': LIBELLE,
      'sel du libellé': `F-${SEL}`,
      'montant de la pièce': '123,45',
      'jeton complet': jetons.chloe!,
      'signature du jeton': jetons.chloe!.split('.')[2]!,
      'charge du jeton': jetons.chloe!.split('.')[1]!,
      'mot de passe des comptes de test': process.env.DEV_MDP_UTILISATEURS!,
      'paramètre de requête': 'apercu',
      'paramètre de requête (décalage)': 'decalage',
    };
    for (const adresse of Object.values(COMPTES)) interdits[`adresse ${adresse}`] = adresse;
    for (const [nature, valeur] of Object.entries(interdits)) expect(tout.includes(valeur), nature).toBe(false);
    expect(tout).not.toMatch(/@|Bearer|authorization|cookie|select |insert |update |\?/i);

    const spans = spansRecus();
    const horsListe = new Set<string>();
    for (const s of spans) for (const cle of Object.keys(s.attributs)) if (!ATTRIBUTS_ADMIS.has(cle) && !/^comtaple\.route\.[A-Za-z]{1,40}$/.test(cle)) horsListe.add(cle);
    expect([...horsListe]).toEqual([]);
    // Les noms de spans sont des gabarits ou des noms techniques : jamais d'identifiant ni d'URL reçue.
    for (const s of spans) expect(s.name).toMatch(/^[A-Za-z0-9 _.:/*()-]+$/);
    expect(spans.some((s) => /[0-9a-f]{8}-[0-9a-f]{4}-/.test(s.name))).toBe(false);
  });
});

describe('traces : collecteur absent (point d’accès vers un port fermé)', () => {
  it('le dépôt et l’analyse aboutissent sans ralentissement notable ; la panne est journalisée une seule fois ; l’arrêt est borné', async () => {
    // Port fermé : celui d'un serveur ouvert puis refermé.
    const s = createServer();
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
    const portFerme = (s.address() as AddressInfo).port;
    await new Promise<void>((r) => s.close(() => r()));

    const pile = await lancerPile(`http://127.0.0.1:${portFerme}`);
    let sansCollecteur: Awaited<ReturnType<typeof deposerEtAttendre>>;
    let dureeArret: number;
    try {
      sansCollecteur = await deposerEtAttendre(`facture-sans-collecteur-${SEL}.pdf`, piece(`${SEL}-b`));
      // Quelques requêtes de plus, le temps de plusieurs lots d'export en échec.
      for (let i = 0; i < 20; i++) {
        const r = await api('chloe', 'GET', `/v1/documents/${sansCollecteur.documentId}`);
        expect(r.statut, JSON.stringify(r.json)).toBe(200);
        expect(r.dureeMs).toBeLessThan(2_000);
        await new Promise((x) => setTimeout(x, 250));
      }
    } finally {
      dureeArret = await pile.arreter();
    }
    expect(['recu', 'en_analyse']).not.toContain(sansCollecteur.statut);
    // Aucune requête du dépôt n'attend le collecteur (le délai d'un export est de 3 s) ; l'analyse n'est pas retardée.
    for (const d of sansCollecteur.durees) expect(d).toBeLessThan(2_000);
    expect(sansCollecteur.analyseMs).toBeLessThan(Math.max(3 * avecCollecteur.analyseMs, avecCollecteur.analyseMs + 10_000));
    expect(dureeArret).toBeLessThan(20_000);
    // Journalisée UNE fois par processus, sans l'adresse du collecteur ni rafale.
    for (const nom of ['api', 'worker'] as const) {
      const messages = pile.journaux[nom].split('\n').filter((l) => /traces : export impossible/.test(l));
      expect(messages.length, `messages de panne du ${nom}`).toBe(1);
      expect(pile.journaux[nom]).not.toContain(String(portFerme));
      expect(pile.journaux[nom]).not.toMatch(/ECONNREFUSED|UnhandledPromiseRejection|unhandled/i);
    }
  });
});
