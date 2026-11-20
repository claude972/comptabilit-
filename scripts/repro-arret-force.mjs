#!/usr/bin/env node
/**
 * Reproduction BORNÉE du blocage de dockerd 29.5.2 (D-098 bis, point 4) : arrêt forcé d'un conteneur d'analyse dont l'entrée
 * est encore écrite. Joue le VRAI code du worker (apps/worker/dist : executerEnfant, demarrerConteneur) contre le moteur désigné
 * par DOCKER_HOST, avec :
 *   - un délai dur par essai (HARD_MS) : un essai qui ne rend pas la main dans ce délai est déclaré BLOQUÉ ;
 *   - arrêt à la première anomalie (essai bloqué ou conteneur résiduel) ; nettoyage final des SEULS conteneurs étiquetés
 *     `comtaple.analyse` (jamais d'autre conteneur, jamais de prune) ;
 *   - refus de démarrer si l'espace libre du disque de la VM Colima est sous 8 Go (VERIFIER_DISQUE=commande, facultatif).
 *
 * Usage : node scripts/repro-arret-force.mjs <scenario> <essais> <duree_ms> [taille_Mo]
 *   scenarios : py-sleep   (Python qui ne lit jamais son entrée, entrée volumineuse, arrêt par délai)
 *               py-lit1m   (Python qui lit 1 Mo puis cesse de lire)
 *               reel-camt  (vrai enfant Node, relevé camt.053 à 50 000 niveaux, arrêt par délai court)
 *               reel-gros  (vrai enfant Node, grosse pièce XML, arrêt par délai court)
 *               flux-annule (flux : l'enfant Python écrit sans cesse des trames et ne lit plus son entrée, le parent l'alimente en continu
 *                            puis l'analyse est ANNULÉE par le parent pendant un lot — le cas de « annulation demandée pendant l'import d'un FEC »)
 *   Image d'essai Python : ESSAIS_CONTENEUR_IMAGE (défaut python:3.12.16-slim-bookworm) ; image réelle : ANALYSE_CONTENEUR_IMAGE.
 * Sortie : une ligne de bilan JSON ; code 0 si aucun blocage, 3 si un blocage a été observé, 9 si le disque est insuffisant.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const dist = process.env.WORKER_DIST ? resolve(process.env.WORKER_DIST) : resolve(ici, '..', 'apps', 'worker', 'dist'); // WORKER_DIST : comparer deux versions compilées
const { executerEnfant, executerEnfantFlux, lireReleveIsole } = await import(pathToFileURL(join(dist, 'analyse-isolee.js')).href);
const { compterConteneursAnalyse, ETIQUETTE } = await import(pathToFileURL(join(dist, 'analyse-conteneur.js')).href);

const [scenario = 'py-sleep', nEssais = '10', dureeMs = '1000', tailleMo = '64'] = process.argv.slice(2);
const N = Number(nEssais);
const DUREE = Number(dureeMs);
const HARD_MS = Number(process.env.HARD_MS ?? 60_000);
const IMAGE_ESSAI = process.env.ESSAIS_CONTENEUR_IMAGE ?? 'python:3.12.16-slim-bookworm';
const IMAGE_ANALYSE = process.env.ANALYSE_CONTENEUR_IMAGE ?? 'comtaple-analyse:dev';
const base = { docker: 'docker', hote: '', cpus: 1, pidsMax: 64, tmpfsMo: 64 };

if (process.env.VERIFIER_DISQUE) {
  const sortie = execFileSync('sh', ['-c', process.env.VERIFIER_DISQUE], { encoding: 'utf8', timeout: 30_000 });
  const libreGo = Number(sortie.trim().split(/\s+/).pop()?.replace(/[^0-9.]/g, ''));
  if (!(libreGo >= 8)) {
    console.error(`Disque de la VM insuffisant (${sortie.trim()}) : arrêt, moins de 8 Go libres.`);
    process.exit(9);
  }
}

// Schéma minimal compatible avec l'usage de executerEnfant (safeParse) : évite de dépendre de zod depuis ce dossier.
const courts = (p) => new Promise((r) => setTimeout(r, p));
const schemaLibre = { safeParse: (v) => ({ success: v !== null && typeof v === 'object', data: v }) };
const python = (code, extra = {}) => ({
  isolation: 'conteneur',
  conteneur: { ...base, image: IMAGE_ESSAI, essai: { entrypoint: 'python3', commande: ['-I', '-c', code] } },
  dureeMaxMs: DUREE,
  memoireMaxMo: 256,
  ...extra,
});
const corpsGros = () => Buffer.alloc(Number(tailleMo) * 1024 * 1024, 0x20);
const camtProfond = () => Buffer.from(`<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>${'<a>'.repeat(50_000)}x${'</a>'.repeat(50_000)}</BkToCstmrStmt></Document>`);
const reel = { isolation: 'conteneur', conteneur: { ...base, image: IMAGE_ANALYSE }, dureeMaxMs: DUREE };

const trame = (o) => { const b = Buffer.from(JSON.stringify(o)); const l = Buffer.alloc(4); l.writeUInt32BE(b.length); return Buffer.concat([l, b]); };
async function* flot(octets) { const bloc = Buffer.alloc(64 * 1024, 0x41); for (let i = 0; i < octets; i += bloc.length) yield bloc; }
const fluxAnnule = () =>
  executerEnfantFlux(
    {
      entete: { op: 'fec' },
      corps: flot(Number(tailleMo) * 1024 * 1024),
      schemaLot: schemaLibre,
      schemaFin: schemaLibre,
      // Le parent traite un lot (délai), puis l'annulation est demandée : même séquence que l'annulation d'un import de FEC.
      surLot: async () => {
        await courts(Number(process.env.ANNULATION_MS ?? 300));
        throw new Error('annulation');
      },
    },
    python(
      "import sys,time,json,struct\nl=json.dumps({'t':'lignes','lignes':{'a':1}}).encode()\nfr=struct.pack('>I',len(l))+l\nsys.stdin.buffer.read(65536)\nwhile True:\n    sys.stdout.buffer.write(fr*2000); sys.stdout.buffer.flush()",
      { dureeMaxMs: Number(process.env.DUREE_FLUX ?? 60_000) },
    ),
  ).catch(() => ({ ok: false, cause: 'annule' }));

const essais = {
  'flux-annule': fluxAnnule,
  'py-sleep': () => executerEnfant({ entete: { op: 'texte' }, corps: corpsGros(), schema: schemaLibre }, python('import time; time.sleep(120)')),
  'py-lit1m': () => executerEnfant({ entete: { op: 'texte' }, corps: corpsGros(), schema: schemaLibre }, python('import sys,time; sys.stdin.buffer.read(1<<20); time.sleep(120)')),
  'reel-camt': () => lireReleveIsole(camtProfond(), { profilCsv: null, profilInvalide: false }, reel),
  'reel-gros': () => executerEnfant({ entete: { op: 'piece', type: 'application/xml' }, corps: corpsGros(), schema: schemaLibre }, reel),
};
if (!essais[scenario]) {
  console.error(`scénario inconnu : ${scenario}`);
  process.exit(2);
}

const avecDelaiDur = (promesse, ms) => Promise.race([promesse.then((v) => ({ v })), courts(ms).then(() => ({ bloque: true }))]);
const bilan = { scenario, essais: N, dureeMs: DUREE, tailleMo: Number(tailleMo), reussis: 0, bloques: 0, residuels: 0, causes: {}, dureesMs: [] };
let anomalie = false;
for (let i = 1; i <= N && !anomalie; i++) {
  const t = Date.now();
  const r = await avecDelaiDur(essais[scenario]().catch((e) => ({ ok: false, cause: `exception:${e.message.slice(0, 80)}` })), HARD_MS);
  const ecoule = Date.now() - t;
  if (r.bloque) {
    bilan.bloques += 1;
    anomalie = true;
    console.error(`essai ${i} : BLOQUÉ (aucune issue en ${HARD_MS} ms)`);
    break;
  }
  const cause = r.v.ok ? 'ok' : r.v.cause;
  bilan.causes[cause] = (bilan.causes[cause] ?? 0) + 1;
  bilan.dureesMs.push(ecoule);
  // PARALLELE=1 : plusieurs instances de ce script tournent ensemble ; le contrôle de résidus est alors fait par l'appelant à la fin.
  const restants = process.env.PARALLELE === '1' ? 0 : await compterConteneursAnalyse({ ...base, image: IMAGE_ESSAI });
  if (restants > 0) {
    bilan.residuels += restants;
    anomalie = true;
    console.error(`essai ${i} : ${restants} conteneur(s) résiduel(s) après l'issue ${cause}`);
    break;
  }
  bilan.reussis += 1;
  await courts(Number(process.env.PAUSE_MS ?? 200));
}
// Nettoyage garanti : seuls NOS conteneurs étiquetés, avec un délai dur (sauf en mode PARALLELE : l'appelant s'en charge).
if (process.env.PARALLELE !== '1') try {
  const ids = execFileSync('docker', ['ps', '-a', '-q', '--filter', `label=${ETIQUETTE}`], { encoding: 'utf8', timeout: 20_000 }).split('\n').filter(Boolean);
  for (const id of ids) {
    try {
      execFileSync('docker', ['rm', '-f', id], { timeout: 20_000, stdio: 'ignore' });
    } catch {
      console.error(`nettoyage : le moteur n'a pas supprimé ${id}`);
    }
  }
} catch {
  console.error('nettoyage : moteur injoignable ou bloqué');
}
const d = [...bilan.dureesMs].sort((a, b) => a - b);
bilan.p50 = d[Math.floor(d.length / 2)] ?? null;
bilan.max = d[d.length - 1] ?? null;
delete bilan.dureesMs;
console.log(JSON.stringify(bilan));
process.exit(anomalie ? 3 : 0);
