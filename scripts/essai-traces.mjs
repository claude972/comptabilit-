#!/usr/bin/env node
/**
 * Parcours et contrôles de l'essai des traces (lancé par scripts/essai-traces.sh, qui tient le collecteur et Tempo).
 *
 * 1. Lance une SECONDE API et un SECOND worker (`dist/main.js`), à part de ceux de scripts/applis.sh : port libre,
 *    préfixe de files propre, métriques sur un port libre, export OTLP vers ESSAI_POINT_ACCES, échantillonnage à 1.
 * 2. Dépose une pièce réelle (PDF) par l'API et attend son analyse par le worker ; fait une requête avec un
 *    paramètre de requête sensible ; arrête les deux processus (les spans en attente partent à l'arrêt).
 * 3. Interroge l'entrepôt (API HTTP de Tempo, ESSAI_TEMPO_URL) : la trace de la requête de dépôt est retrouvée par
 *    service, nom de span et durée, côté API et côté worker, avec le MÊME identifiant ; le traitement du worker est
 *    l'enfant de la mise en file, elle-même enfant de la requête.
 * 4. Relit TOUT ce que l'entrepôt a stocké pendant l'essai et y cherche les données interdites (nom du fichier,
 *    contenu, adresses, jeton, mot de passe, paramètres de requête, texte SQL) ; contrôle la liste blanche des attributs.
 *
 * Laisse dans la base locale la pièce déposée (dossier de démonstration), comme les tests d'intégration.
 * Code de sortie : 0 tout est constaté ; 1 un contrôle a échoué ; 2 essai impossible.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const ligne of readFileSync(join(racine, '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(ligne.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const POINT_ACCES = process.env.ESSAI_POINT_ACCES;
const TEMPO = process.env.ESSAI_TEMPO_URL;
if (!POINT_ACCES || !TEMPO) {
  console.error('ESSAI_POINT_ACCES et ESSAI_TEMPO_URL sont requis (voir scripts/essai-traces.sh).');
  process.exit(2);
}

// Identifiants du jeu de démonstration (packages/db/src/amorcer.ts).
const CABINET = 'aaaaaaaa-0000-4000-8000-000000000001';
const DOSSIER = 'aaaaaaaa-0000-4000-8000-0000000000e1';
const COMPTE = 'chloe.collab@cabinet-a.test';
const ADRESSES = ['alice.admin@cabinet-a.test', 'remi.reviseur@cabinet-a.test', COMPTE, 'client.depot@client-a.test', 'bruno.admin@cabinet-b.test'];

const SEL = randomBytes(4).toString('hex');
const PREFIXE = `essai-traces-${SEL}`;
const NOM_FICHIER = `facture-sentinelle-${SEL}.pdf`;
const LIBELLE = `Boulangerie Sentinelle ${SEL}`;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const echecs = [];
function controle(libelle, ok, detail = '') {
  console.log(`${ok ? '  ok    ' : '  ÉCHEC '} ${libelle}${detail ? ` — ${detail}` : ''}`);
  if (!ok) echecs.push(libelle);
}

async function attendre(lire, pret, delaiMs, quoi) {
  const fin = Date.now() + delaiMs;
  for (;;) {
    const v = await lire().catch(() => undefined);
    if (v !== undefined && pret(v)) return v;
    if (Date.now() > fin) throw new Error(`délai dépassé : ${quoi}`);
    await pause(500);
  }
}

async function portLibre() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

/** PDF minimal à couche texte : suffit à exercer la lecture réelle du worker. */
function pdfTexte(lignes, sel) {
  const enc = (t) => Buffer.from([...t].map((ch) => (ch === '€' ? 0x80 : ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 0x3f))).toString('latin1').replace(/[\\()]/g, (m) => `\\${m}`);
  const flux = `BT /F1 10 Tf 50 800 Td 14 TL\n${lignes.map((l) => `(${enc(l)}) Tj T*`).join('\n')}\nET`;
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(flux, 'latin1')} >>\nstream\n${flux}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let corps = `%PDF-1.4\n%${sel}\n`;
  const decalages = [];
  objets.forEach((o, i) => {
    decalages.push(Buffer.byteLength(corps, 'latin1'));
    corps += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(corps, 'latin1');
  corps += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${decalages.map((d) => `${String(d).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corps, 'latin1');
}

// ───────────────────────── Seconde pile API + worker ─────────────────────────

const PORT = await portLibre();
const API = `http://127.0.0.1:${PORT}`;
const journaux = { api: '', worker: '' };
const processus = [];

function lancerPile() {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    API_PORT: String(PORT),
    FILES_PREFIXE: PREFIXE,
    METRIQUES_PORT_API: '0',
    METRIQUES_PORT_WORKER: '0',
    OTEL_EXPORTER_OTLP_ENDPOINT: POINT_ACCES,
    TRACES_TAUX_ECHANTILLONNAGE: '1',
    TRACES_ENVIRONNEMENT: 'essai',
    COMTAPLE_VERSION: `essai-${SEL}`,
  };
  for (const nom of ['api', 'worker']) {
    const p = spawn(process.execPath, ['dist/main.js'], { cwd: join(racine, 'apps', nom), env, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => (journaux[nom] += d.toString()));
    p.stderr.on('data', (d) => (journaux[nom] += d.toString()));
    processus.push(p);
  }
}

async function arreterPile() {
  await Promise.all(
    processus.map(
      (p) =>
        new Promise((r) => {
          if (p.exitCode !== null || p.signalCode !== null) return r();
          const garde = setTimeout(() => p.kill('SIGKILL'), 30_000);
          p.once('exit', () => (clearTimeout(garde), r()));
          p.kill('SIGTERM');
        }),
    ),
  );
}

/** Supprime de Redis les seules clés du préfixe de files de cet essai. */
async function viderFiles() {
  try {
    const exiger = createRequire(join(racine, 'packages', 'plateforme', 'package.json'));
    const IORedis = exiger('ioredis');
    const redis = new (IORedis.default ?? IORedis)(process.env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });
    await redis.connect();
    let curseur = '0';
    let supprimees = 0;
    do {
      const [suivant, cles] = await redis.scan(curseur, 'MATCH', `${PREFIXE}:*`, 'COUNT', 500);
      curseur = suivant;
      if (cles.length) supprimees += await redis.del(...cles);
    } while (curseur !== '0');
    await redis.quit();
    console.log(`Files de l'essai vidées (${supprimees} clés « ${PREFIXE}:* » supprimées de Redis).`);
  } catch (e) {
    console.log(`Files de l'essai NON vidées (${e.message}) : clés « ${PREFIXE}:* » à supprimer de Redis.`);
  }
}

let jeton = '';
async function api(methode, chemin, corps) {
  const binaire = Buffer.isBuffer(corps);
  const r = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: { authorization: `Bearer ${jeton}`, 'x-cabinet-id': CABINET, ...(corps !== undefined ? { 'content-type': binaire ? 'application/octet-stream' : 'application/json' } : {}) },
    body: corps === undefined ? undefined : binaire ? new Uint8Array(corps) : JSON.stringify(corps),
  });
  return { statut: r.status, json: await r.json().catch(() => null) };
}

// ───────────────────────── Entrepôt (API HTTP de Tempo) ─────────────────────────

const debutS = Math.floor(Date.now() / 1000) - 60;
async function chercher(traceql, limite = 20) {
  const u = new URL(`${TEMPO}/api/search`);
  u.searchParams.set('q', traceql);
  u.searchParams.set('limit', String(limite));
  u.searchParams.set('start', String(debutS));
  u.searchParams.set('end', String(Math.floor(Date.now() / 1000) + 60));
  const r = await fetch(u);
  if (!r.ok) throw new Error(`recherche Tempo ${r.status} : ${(await r.text()).slice(0, 300)}`);
  return ((await r.json()).traces ?? []).map((t) => t.traceID);
}
// La recherche rend les identifiants de trace en hexadécimal SANS zéros de tête ; la lecture d'une trace, en base64.
const idRecherche = (v) => String(v).toLowerCase().padStart(32, '0');
const hex = (v) => (/^[0-9a-f]+$/i.test(v ?? '') && [16, 32].includes(v.length) ? v.toLowerCase() : Buffer.from(v ?? '', 'base64').toString('hex'));
const valeur = (v) => v?.stringValue ?? (v?.intValue !== undefined ? Number(v.intValue) : (v?.doubleValue ?? v?.boolValue));
async function lireTrace(id) {
  const r = await fetch(`${TEMPO}/api/v2/traces/${id}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`lecture de la trace ${id} : ${r.status}`);
  const brut = await r.text();
  const d = JSON.parse(brut);
  const lots = d.trace?.resourceSpans ?? d.trace?.batches ?? d.resourceSpans ?? d.batches ?? [];
  const spans = [];
  for (const rs of lots) {
    const service = String(valeur(rs.resource?.attributes?.find((a) => a.key === 'service.name')?.value));
    for (const ss of rs.scopeSpans ?? rs.instrumentationLibrarySpans ?? [])
      for (const s of ss.spans ?? [])
        spans.push({
          service,
          traceId: hex(s.traceId),
          spanId: hex(s.spanId),
          parentSpanId: s.parentSpanId ? hex(s.parentSpanId) : '',
          name: s.name,
          dureeMs: (Number(BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano)) / 1e6).toFixed(1),
          attributs: Object.fromEntries((s.attributes ?? []).map((a) => [a.key, valeur(a.value)])),
          ressource: Object.fromEntries((rs.resource?.attributes ?? []).map((a) => [a.key, valeur(a.value)])),
        });
  }
  return { brut, spans };
}

// ───────────────────────── Déroulé ─────────────────────────

let code = 0;
let televersementId = '';
let documentId = '';
const idInconnu = randomUUID();
try {
  console.log(`Seconde pile : API ${API}, files « ${PREFIXE} », export vers ${POINT_ACCES}`);
  const rj = await fetch(`${process.env.OIDC_ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'comtaple-tests', username: COMPTE, password: process.env.DEV_MDP_UTILISATEURS, scope: 'openid' }),
  });
  jeton = (await rj.json()).access_token ?? '';
  if (!jeton) throw new Error('jeton Keycloak non obtenu (pile locale démarrée ?)');

  lancerPile();
  await attendre(() => fetch(`${API}/v1/sante`).then((r) => r.ok), (ok) => ok && /Worker Comtaple démarré/.test(journaux.worker), 60_000, 'démarrage de la seconde pile').catch((e) => {
    throw new Error(`${e.message}\n${journaux.api.slice(-1200)}\n${journaux.worker.slice(-1200)}`);
  });
  controle('API et worker de l’essai : traces actives', /Traces OpenTelemetry actives/.test(journaux.api) && /Traces OpenTelemetry actives/.test(journaux.worker));

  const contenu = pdfTexte([`FACTURE N° F-${SEL}`, LIBELLE, 'Fournitures de bureau', 'Total TTC 123,45 €'], SEL);
  const o = await api('POST', '/v1/televersements', { entiteId: DOSSIER, nomFichier: NOM_FICHIER, taille: contenu.length, sha256: sha(contenu), canal: 'ordinateur' });
  if (o.statut !== 201) throw new Error(`ouverture du dépôt : ${o.statut} ${JSON.stringify(o.json)}`);
  televersementId = o.json.id;
  const m = await api('PUT', `/v1/televersements/${televersementId}/morceaux?decalage=0`, contenu);
  if (m.statut !== 200) throw new Error(`envoi du morceau : ${m.statut}`);
  const fin = await api('POST', `/v1/televersements/${televersementId}/terminer`);
  if (fin.statut >= 300) throw new Error(`fin du dépôt : ${fin.statut}`);
  documentId = fin.json.documentId;
  const doc = await attendre(() => api('GET', `/v1/documents/${documentId}`), (r) => r.statut === 200 && !['recu', 'en_analyse'].includes(r.json.document.statut), 120_000, 'analyse de la pièce par le worker');
  console.log(`Pièce déposée et analysée : document ${documentId}, statut « ${doc.json.document.statut} ».`);
  // Requête portant un paramètre sensible : il ne doit pas se retrouver dans l'entrepôt.
  const inconnue = await api('GET', `/v1/documents/${idInconnu}?apercu=${encodeURIComponent(LIBELLE)}`);
  controle('requête sur un document inconnu : 404', inconnue.statut === 404, String(inconnue.statut));
} catch (e) {
  console.error(`ESSAI IMPOSSIBLE : ${e.message}`);
  code = 2;
} finally {
  await arreterPile();
  await viderFiles();
}
if (code) process.exit(code);
controle('aucune panne d’export journalisée par l’API ou le worker', !/export impossible/.test(journaux.api + journaux.worker));

try {
  console.log(`\nRecherche dans l'entrepôt (${TEMPO}) :`);
  const qApi = `{ resource.service.name = "comtaple-api" && name = "POST /v1/televersements/:id/terminer" && span.comtaple.route.id = "${televersementId}" }`;
  const qWorker = `{ resource.service.name = "comtaple-worker" && name = "traiter documents analyser" && span.comtaple.document.id = "${documentId}" && duration > 1ms }`;
  // Le collecteur transmet par lots et Tempo rend les traces cherchables après quelques secondes.
  const [cApi, cWorker] = await attendre(async () => [await chercher(qApi), await chercher(qWorker)], ([a, w]) => a.length > 0 && w.length > 0, 90_000, 'trace du dépôt introuvable dans Tempo (côté API ou côté worker)');
  const idApi = idRecherche(cApi[0]);
  const idWorker = idRecherche(cWorker[0]);
  console.log(`  identifiant de trace trouvé par la requête de l'API   : ${idApi}`);
  console.log(`  identifiant de trace trouvé par le span du worker      : ${idWorker}`);
  controle('MÊME identifiant de trace côté API et côté worker', cApi.length === 1 && cWorker.length === 1 && idApi === idWorker);

  // La recherche par service, nom de span et durée (celle du tableau Grafana « Comtaple — traces ») retrouve la trace.
  const parGabarit = await chercher('{ resource.service.name =~ "comtaple-worker" && name =~ "traiter documents analyser" && duration > 0ms }', 200);
  controle('recherche par service + nom de span + durée minimale : trace retrouvée', parGabarit.some((t) => idRecherche(t) === idApi), `${parGabarit.length} trace(s)`);
  const tropLongues = await chercher('{ name =~ "traiter documents analyser" && duration > 1h }', 200);
  controle('recherche avec une durée minimale d’une heure : aucune trace', tropLongues.length === 0, `${tropLongues.length} trace(s)`);

  const { spans } = await attendre(() => lireTrace(idApi), (t) => t.spans.some((s) => s.name === 'traiter documents analyser'), 30_000, 'lecture de la trace commune');
  const requete = spans.find((s) => s.name === 'POST /v1/televersements/:id/terminer');
  const miseEnFile = spans.find((s) => s.name === 'mettre en file documents analyser');
  const traitement = spans.find((s) => s.name === 'traiter documents analyser');
  controle('span de la requête : service comtaple-api, racine de la trace', requete?.service === 'comtaple-api' && requete.parentSpanId === '');
  controle('span de mise en file : enfant de la requête', !!miseEnFile && miseEnFile.parentSpanId === requete?.spanId && miseEnFile.service === 'comtaple-api');
  controle('span du traitement : service comtaple-worker, enfant de la mise en file', traitement?.service === 'comtaple-worker' && traitement.parentSpanId === miseEnFile?.spanId);
  controle('la trace réunit les deux services', new Set(spans.map((s) => s.service)).size === 2 && spans.every((s) => s.traceId === idApi), `${spans.length} spans`);
  console.log('  Spans de la trace commune :');
  for (const s of spans) console.log(`    ${s.service.padEnd(16)} ${s.name.padEnd(42)} ${s.dureeMs.padStart(9)} ms`);

  // Tout ce que l'entrepôt a stocké pendant l'essai.
  console.log('\nDonnées interdites dans ce qui est stocké :');
  // La dernière requête n'est exportée qu'à l'arrêt de l'API : attendre qu'elle soit, elle aussi, cherchable.
  await attendre(() => chercher(`{ span.comtaple.route.id = "${idInconnu}" }`), (t) => t.length > 0, 60_000, 'trace de la dernière requête (vidage à l’arrêt) introuvable dans Tempo');
  const toutes = await chercher('{ }', 2000);
  let texte = '';
  const tousSpans = [];
  for (const id of toutes) {
    const t = await lireTrace(idRecherche(id));
    // Les identifiants de trace et de span (aléatoires, en base64) sont retirés : ils produiraient de faux motifs.
    texte += `${t.brut.replace(/"(traceId|spanId|parentSpanId)"\s*:\s*"[^"]*"/g, '')}\n`;
    tousSpans.push(...t.spans);
  }
  console.log(`  ${toutes.length} trace(s), ${tousSpans.length} span(s), ${texte.length} caractères relus par l'API de Tempo.`);
  controle('contenu relu non vide, dont la requête au paramètre sensible', texte.length > 1000 && tousSpans.some((s) => s.attributs['comtaple.route.id'] === idInconnu));
  const interdits = {
    'nom du fichier': NOM_FICHIER,
    'libellé de la pièce': LIBELLE,
    'sel du libellé': `F-${SEL}`,
    'montant de la pièce': '123,45',
    'jeton complet': jeton,
    'signature du jeton': jeton.split('.')[2],
    'charge du jeton': jeton.split('.')[1],
    'mot de passe des comptes de test': process.env.DEV_MDP_UTILISATEURS,
    'mot de passe de Redis': process.env.REDIS_PASSWORD,
    'paramètre de requête « apercu »': 'apercu',
    'paramètre de requête « decalage »': 'decalage',
  };
  for (const a of ADRESSES) interdits[`adresse ${a.replace(/@.*/, '@…')}`] = a;
  const trouves = Object.entries(interdits).filter(([, v]) => v && texte.includes(v)).map(([n]) => n);
  controle(`aucune des ${Object.keys(interdits).length} valeurs interdites connues`, trouves.length === 0, trouves.join(', '));
  const motif = /@|Bearer|authorization|cookie|select |insert |update |delete from|\?/i.exec(texte) ?? /eyJ[A-Za-z0-9_-]{10}/.exec(texte);
  controle('aucune adresse (« @ »), jeton, en-tête, paramètre de requête (« ? ») ni texte SQL', !motif, motif ? `« ${motif[0]} » à la position ${motif.index}` : '');
  const nomsDouteux = tousSpans.filter((s) => !/^[A-Za-z0-9 _.:/*()-]+$/.test(s.name) || /[0-9a-f]{8}-[0-9a-f]{4}-/.test(s.name)).map((s) => s.name);
  controle('noms de spans : gabarits et noms techniques seulement', nomsDouteux.length === 0, nomsDouteux.slice(0, 3).join(' | '));
  try {
    const { ATTRIBUTS_ADMIS } = await import(pathToFileURL(join(racine, 'packages', 'plateforme', 'dist', 'traces.js')).href);
    const hors = new Set();
    for (const s of tousSpans) for (const cle of Object.keys(s.attributs)) if (!ATTRIBUTS_ADMIS.has(cle) && !/^comtaple\.route\.[A-Za-z]{1,40}$/.test(cle)) hors.add(cle);
    controle(`attributs de span : tous dans la liste blanche (${new Set(tousSpans.flatMap((s) => Object.keys(s.attributs))).size} clés distinctes)`, hors.size === 0, [...hors].join(', '));
  } catch (e) {
    console.log(`  (liste blanche non contrôlée : ${e.message})`);
  }
  const ressources = new Set(tousSpans.flatMap((s) => Object.keys(s.ressource)));
  console.log(`  Attributs de ressource stockés : ${[...ressources].sort().join(', ')}`);
  controle('ressource : ni nom d’hôte, ni ligne de commande, ni utilisateur système', ![...ressources].some((c) => /^(host|process|os|user)\./.test(c)));

  // Volume reçu par Tempo (indication pour le dimensionnement ; non mesuré sous charge).
  const metriques = await fetch(`${TEMPO}/metrics`).then((r) => r.text()).catch(() => '');
  const somme = (nom) => [...metriques.matchAll(new RegExp(`^${nom}(?:\\{[^}]*\\})? ([0-9.e+]+)$`, 'gm'))].reduce((t, x) => t + Number(x[1]), 0);
  const octets = somme('tempo_distributor_bytes_received_total');
  const recus = somme('tempo_distributor_spans_received_total');
  if (recus > 0) console.log(`\nReçu par Tempo : ${recus} spans, ${octets} octets, soit ${(octets / recus).toFixed(0)} octets par span (essai court, non représentatif).`);
} catch (e) {
  console.error(`  ÉCHEC : ${e.message}`);
  echecs.push(e.message);
}

if (echecs.length) {
  console.error(`\nESSAI EN ÉCHEC (${echecs.length}) : ${echecs.join(' ; ')}`);
  process.exit(1);
}
console.log('\nESSAI RÉUSSI : la trace commune à l’API et au worker est dans l’entrepôt, sans donnée interdite.');
