/**
 * LANCEUR RESTREINT des conteneurs d'analyse (D-098) : un proxy FILTRANT de l'API du moteur de conteneurs.
 *
 * Pourquoi : en production le worker est lui-même un conteneur. Lui monter le socket du moteur reviendrait à lui donner les
 * droits du moteur (donc de l'hôte) : un worker compromis créerait un conteneur privilégié. Le worker ne voit donc PAS le
 * socket du moteur ; il parle, avec le client `docker` ordinaire (DOCKER_HOST), à CE lanceur, seul détenteur du socket.
 *
 * Ce que le lanceur accepte (tout le reste : 403) :
 *   - `/_ping`, `/version` (négociation du client) ;
 *   - `POST /containers/create` : le corps est VÉRIFIÉ (image, utilisateur, réseau coupé, aucune capacité, racine en lecture
 *     seule, aucun montage ni périphérique, bornes de mémoire / processus / processeurs / tmpfs sous des plafonds) puis
 *     RECONSTRUIT par le lanceur à partir de valeurs écrites en dur : ce que le client ajouterait en plus est ignoré ;
 *   - sur un conteneur D'ANALYSE seulement (étiquette `comtaple.analyse`, nom `comtaple-analyse-<uuid>`) : `start`,
 *     `attach` (flux de l'entrée et de la sortie), `wait`, `json` (inspection), `logs`, `kill`, suppression (`DELETE`) ;
 *   - la liste des conteneurs, restreinte aux conteneurs d'analyse.
 * Il refuse l'accès aux images, volumes, réseaux, exécutions (`exec`), au système, et à tout conteneur sans l'étiquette.
 * Nombre de conteneurs d'analyse simultanés plafonné (LANCEUR_MAX_CONTENEURS).
 *
 * Aucune dépendance. Configuration par l'environnement :
 *   LANCEUR_ECOUTE   socket d'écoute (défaut /run/lanceur/docker.sock), droits 0660
 *   LANCEUR_MOTEUR   socket du moteur (défaut /var/run/docker.sock)
 *   LANCEUR_IMAGE    image d'analyse imposée (obligatoire)
 *   LANCEUR_MEMOIRE_MAX_MO (4096), LANCEUR_PIDS_MAX (256), LANCEUR_CPUS_MAX (4), LANCEUR_TMPFS_MAX_MO (256), LANCEUR_MAX_CONTENEURS (8)
 *   LANCEUR_ESSAI    ESSAIS UNIQUEMENT : « python » remplace l'entrée Node imposée par `python3 -I -c <code>` (image d'essai) ;
 *                    jamais défini en production (le compose de production ne le transmet pas).
 *
 * LIMITE : ce lanceur détient le socket du moteur. Sa compromission serait celle de l'hôte ; il doit donc rester minuscule,
 * sans dépendance, non joignable depuis Internet, et n'être joignable que par le worker (socket partagé, droits 0660).
 */
import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname } from 'node:path';

const env = process.env;
const ECOUTE = env.LANCEUR_ECOUTE ?? '/run/lanceur/docker.sock';
const MOTEUR = env.LANCEUR_MOTEUR ?? '/var/run/docker.sock';
const IMAGE = env.LANCEUR_IMAGE ?? '';
const ESSAI = env.LANCEUR_ESSAI === 'python';
const nombre = (nom, defaut) => {
  const v = Number(env[nom] ?? defaut);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${nom} invalide`);
  return v;
};
const MEMOIRE_MAX = nombre('LANCEUR_MEMOIRE_MAX_MO', 4096) * 1024 * 1024;
const PIDS_MAX = nombre('LANCEUR_PIDS_MAX', 256);
const CPUS_MAX = nombre('LANCEUR_CPUS_MAX', 4) * 1e9;
const TMPFS_MAX = nombre('LANCEUR_TMPFS_MAX_MO', 256);
const CONTENEURS_MAX = nombre('LANCEUR_MAX_CONTENEURS', 8);
const ETIQUETTE = 'comtaple.analyse';
const ETIQUETTE_EXPIRATION = 'comtaple.analyse.expire';
const UTILISATEUR = '65532:65532';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const NOM = new RegExp(`^comtaple-analyse-(${UUID})$`);
const ID = /^[0-9a-f]{64}$/;
const CORPS_MAX = 64 * 1024;

/** Arguments Node autorisés pour l'enfant d'analyse (mêmes que apps/worker/src/analyse-isolee.ts, dans l'image). */
const ARGUMENT_NODE = [
  /^--max-old-space-size=\d{2,5}$/,
  /^--permission$/,
  /^--allow-fs-read=\/app\/[A-Za-z0-9_.\/@+-]+$/,
  /^--disallow-code-generation-from-strings$/,
];
const POINT_ENTREE = '/app/apps/worker/dist/analyse-enfant.js';

class Refus extends Error {
  constructor(message, code = 403) {
    super(message);
    this.code = code;
  }
}
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const vide = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/** Vérifie la demande de création du client, puis construit le corps ENVOYÉ AU MOTEUR (valeurs imposées, pas celles du client). */
function construireCreation(nom, brut) {
  const m = NOM.exec(nom ?? '');
  if (!m) throw new Refus('nom de conteneur refusé');
  const uuid = m[1];
  let d;
  try {
    d = JSON.parse(brut);
  } catch {
    throw new Refus('corps illisible', 400);
  }
  const h = d.HostConfig ?? {};
  const tmpfs = h.Tmpfs ?? {};
  const taille = /^\/tmp:?$/.test(Object.keys(tmpfs)[0] ?? '') ? Object.values(tmpfs)[0] : '';
  const tailleTmpfs = /size=(\d+)m/.exec(String(taille))?.[1];
  // Écarts de sécurité : refus net (et non correction silencieuse), pour qu'un client détourné le sache et soit journalisé.
  if (d.Image !== IMAGE) throw new Refus('image refusée');
  if ((d.User ?? '') !== UTILISATEUR) throw new Refus('utilisateur refusé');
  if (h.Privileged) throw new Refus('conteneur privilégié refusé');
  if (h.NetworkMode !== 'none') throw new Refus('le réseau doit être coupé');
  if (!egal(h.CapDrop, ['ALL']) || !vide(h.CapAdd)) throw new Refus('capacités refusées');
  if (!egal(h.SecurityOpt, ['no-new-privileges']) && !egal(h.SecurityOpt, ['no-new-privileges:true'])) throw new Refus('options de sécurité refusées');
  if (h.ReadonlyRootfs !== true) throw new Refus('racine en lecture seule imposée');
  if (!vide(h.Binds) || !vide(h.Mounts) || !vide(h.Devices) || !vide(h.DeviceRequests) || !vide(h.VolumesFrom) || !vide(h.Links)) throw new Refus('montage ou périphérique refusé');
  const cgroupnsConforme = vide(h.CgroupnsMode) || h.CgroupnsMode === 'private';
  if (!vide(h.PidMode) || !vide(h.UsernsMode) || !vide(h.UTSMode) || !cgroupnsConforme || h.IpcMode !== 'none') throw new Refus('espaces de noms partagés refusés');
  if (!vide(h.PortBindings) || h.PublishAllPorts || !vide(h.ExtraHosts) || !vide(h.Dns) || !vide(h.GroupAdd) || !vide(h.Sysctls)) throw new Refus('option refusée');
  if (!(h.Memory > 0 && h.Memory <= MEMOIRE_MAX) || h.MemorySwap !== h.Memory) throw new Refus('mémoire hors plafond');
  if (!(h.PidsLimit > 0 && h.PidsLimit <= PIDS_MAX)) throw new Refus('nombre de processus hors plafond');
  if (!(h.NanoCpus > 0 && h.NanoCpus <= CPUS_MAX)) throw new Refus('processeurs hors plafond');
  if (!(Number(tailleTmpfs) > 0 && Number(tailleTmpfs) <= TMPFS_MAX)) throw new Refus('tmpfs hors plafond');
  if (!vide(d.Env)) throw new Refus('variables d’environnement refusées');
  const etiquettes = d.Labels ?? {};
  if (etiquettes[ETIQUETTE] !== uuid) throw new Refus('étiquette absente ou incohérente avec le nom');
  const expire = Number(etiquettes[ETIQUETTE_EXPIRATION]);
  if (!Number.isFinite(expire) || expire > Date.now() + 2 * 3600_000 + 120_000) throw new Refus('expiration hors plafond');
  // Entrée : Node + arguments contrôlés (production) ; en essai, `python3 -I -c <code>`.
  const cmd = d.Cmd ?? [];
  if (!Array.isArray(cmd) || cmd.some((x) => typeof x !== 'string')) throw new Refus('commande refusée');
  let entrypoint;
  if (ESSAI) {
    if (!egal(d.Entrypoint, ['python3']) || cmd[0] !== '-I' || cmd[1] !== '-c' || cmd.length !== 3) throw new Refus('commande d’essai refusée');
    entrypoint = ['python3'];
  } else {
    if (!egal(d.Entrypoint, ['node'])) throw new Refus('point d’entrée refusé');
    if (cmd.length < 2 || cmd[cmd.length - 1] !== POINT_ENTREE) throw new Refus('commande refusée');
    for (const a of cmd.slice(0, -1)) if (a.includes('..') || !ARGUMENT_NODE.some((r) => r.test(a))) throw new Refus('argument refusé');
    entrypoint = ['node'];
  }
  return JSON.stringify({
    Image: IMAGE,
    User: UTILISATEUR,
    Entrypoint: entrypoint,
    Cmd: cmd,
    WorkingDir: ESSAI ? '/' : '/app',
    Env: [],
    Labels: { [ETIQUETTE]: uuid, [ETIQUETTE_EXPIRATION]: String(expire) },
    OpenStdin: true,
    StdinOnce: true,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    NetworkDisabled: true,
    Healthcheck: { Test: ['NONE'] },
    HostConfig: {
      NetworkMode: 'none',
      Privileged: false,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      ReadonlyRootfs: true,
      Tmpfs: { '/tmp': `rw,noexec,nosuid,nodev,size=${Number(tailleTmpfs)}m,mode=1777` },
      Memory: h.Memory,
      MemorySwap: h.Memory,
      NanoCpus: h.NanoCpus,
      PidsLimit: h.PidsLimit,
      Ulimits: [
        { Name: 'nofile', Soft: 256, Hard: 256 },
        { Name: 'core', Soft: 0, Hard: 0 },
      ],
      IpcMode: 'none',
      LogConfig: { Type: 'none', Config: {} },
      RestartPolicy: { Name: 'no', MaximumRetryCount: 0 },
      AutoRemove: false,
    },
  });
}

/** Appel court au moteur (corps entier en mémoire, réponses petites). */
function moteur(methode, chemin, corps) {
  return new Promise((ok, ko) => {
    const r = http.request({ socketPath: MOTEUR, method: methode, path: chemin, headers: corps ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(corps) } : {} }, (rep) => {
      const morceaux = [];
      rep.on('data', (c) => morceaux.push(c));
      rep.on('end', () => ok({ code: rep.statusCode ?? 502, corps: Buffer.concat(morceaux).toString('utf8') }));
    });
    r.on('error', ko);
    r.end(corps);
  });
}

const sansVersion = (url) => url.replace(/^\/v\d+\.\d+(?=\/)/, '');

/** Le conteneur désigné est-il un conteneur d'analyse ? (étiquette ET nom conformes, lus auprès du moteur) */
async function estConteneurAnalyse(ref) {
  if (!ID.test(ref) && !NOM.test(ref)) return false;
  const r = await moteur('GET', `/containers/${encodeURIComponent(ref)}/json`);
  if (r.code !== 200) return false;
  try {
    const j = JSON.parse(r.corps);
    return typeof j.Config?.Labels?.[ETIQUETTE] === 'string' && NOM.test(String(j.Name ?? '').replace(/^\//, ''));
  } catch {
    return false;
  }
}

/** Décide d'une requête : `null` si elle est refusée, sinon la manière de la traiter. */
function classer(methode, url) {
  const u = new URL(sansVersion(url), 'http://x');
  const p = u.pathname;
  if (p === '/_ping' && (methode === 'GET' || methode === 'HEAD')) return { type: 'libre' };
  if (p === '/version' && methode === 'GET') return { type: 'libre' };
  if (p === '/containers/create' && methode === 'POST') return { type: 'creation', nom: u.searchParams.get('name') };
  if (p === '/containers/json' && methode === 'GET') return { type: 'liste', u };
  const m = /^\/containers\/([^/]+)\/(start|attach|wait|json|logs|kill)$/.exec(p);
  const verbe = { start: 'POST', attach: 'POST', wait: 'POST', json: 'GET', logs: 'GET', kill: 'POST' };
  if (m && verbe[m[2]] === methode) return { type: 'sur-conteneur', ref: decodeURIComponent(m[1]) };
  const d = /^\/containers\/([^/]+)$/.exec(p);
  if (d && methode === 'DELETE') return { type: 'sur-conteneur', ref: decodeURIComponent(d[1]) };
  return null;
}

function repondre(res, code, message) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ message }));
}

async function lire(req) {
  const morceaux = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > CORPS_MAX) throw new Refus('corps trop volumineux', 413);
    morceaux.push(c);
  }
  return Buffer.concat(morceaux).toString('utf8');
}

/** Remplace le filtre de liste : seuls les conteneurs d'analyse sont jamais listés. */
function urlListe(u) {
  let filtres = {};
  try {
    filtres = JSON.parse(u.searchParams.get('filters') ?? '{}');
  } catch {
    throw new Refus('filtre illisible', 400);
  }
  // Forme canonique du moteur (clé → { valeur : true }) ; la forme ancienne (tableaux) est convertie. L'étiquette d'analyse est imposée.
  const normalise = {};
  for (const [cle, v] of Object.entries(filtres ?? {})) normalise[cle] = Array.isArray(v) ? Object.fromEntries(v.map((x) => [String(x), true])) : v;
  normalise.label = { ...(normalise.label ?? {}), [ETIQUETTE]: true };
  filtres = normalise;
  u.searchParams.set('filters', JSON.stringify(filtres));
  return `/containers/json${u.search}`;
}

async function traiter(req, res) {
  if (env.LANCEUR_DEBUG) console.error(`[lanceur] ${req.method} ${req.url}`);
  const c = classer(req.method ?? '', req.url ?? '');
  if (!c) return repondre(res, 403, 'requête refusée par le lanceur');
  if (c.type === 'sur-conteneur' && !(await estConteneurAnalyse(c.ref))) return repondre(res, 403, 'ce conteneur n’est pas un conteneur d’analyse');
  if (c.type === 'creation') {
    const corps = await lire(req);
    const liste = await moteur('GET', `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ label: [ETIQUETTE] }))}`);
    if (liste.code === 200 && JSON.parse(liste.corps).length >= CONTENEURS_MAX) return repondre(res, 429, 'trop de conteneurs d’analyse simultanés');
    const nouveau = construireCreation(c.nom, corps);
    const r = await moteur('POST', `/containers/create?name=${encodeURIComponent(c.nom)}`, nouveau);
    res.writeHead(r.code, { 'content-type': 'application/json' });
    return res.end(r.corps);
  }
  const chemin = c.type === 'liste' ? urlListe(c.u) : req.url;
  const amont = http.request({ socketPath: MOTEUR, method: req.method, path: chemin, headers: { ...req.headers, host: 'docker' } }, (rep) => {
    res.writeHead(rep.statusCode ?? 502, rep.headers);
    // `wait` répond ses en-têtes tout de suite et le corps à la fin du conteneur : le client attend ces en-têtes pour lancer `start`.
    res.flushHeaders();
    rep.pipe(res);
  });
  amont.on('error', () => repondre(res, 502, 'moteur injoignable'));
  req.pipe(amont);
}

const serveur = http.createServer((req, res) => {
  traiter(req, res).catch((e) => {
    if (!res.headersSent) repondre(res, e instanceof Refus ? e.code : 502, e instanceof Refus ? e.message : 'erreur du lanceur');
    else res.destroy();
    if (e instanceof Refus) console.error(`[lanceur] refus : ${req.method} ${sansVersion(req.url ?? '').split('?')[0]} : ${e.message}`);
  });
});

// `attach` : le client demande un changement de protocole (flux bidirectionnel brut) ; le lanceur ne le relaie que pour un
// conteneur d'analyse, puis laisse passer les octets dans les deux sens (fermeture d'un sens propagée).
serveur.on('upgrade', (req, socket, head) => {
  if (env.LANCEUR_DEBUG) console.error(`[lanceur] UPGRADE ${req.method} ${req.url}`);
  void (async () => {
    const c = classer(req.method ?? '', req.url ?? '');
    if (!c || c.type !== 'sur-conteneur' || !/\/attach(\?|$)/.test(req.url ?? '') || !(await estConteneurAnalyse(c.ref))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{"message":"requête refusée par le lanceur"}');
      return;
    }
    const amont = net.connect({ path: MOTEUR, allowHalfOpen: true });
    amont.on('error', () => socket.destroy());
    socket.on('error', () => amont.destroy());
    amont.on('connect', () => {
      const entetes = Object.entries({ ...req.headers, host: 'docker' }).map(([k, v]) => `${k}: ${v}`);
      amont.write(`${req.method} ${req.url} HTTP/1.1\r\n${entetes.join('\r\n')}\r\n\r\n`);
      if (head.length > 0) amont.write(head);
      if (env.LANCEUR_DEBUG) amont.once('data', (d) => console.error(`[lanceur] amont répond : ${d.toString('latin1').slice(0, 120).replace(/\r\n/g, ' | ')}`));
      socket.pipe(amont);
      amont.pipe(socket);
    });
  })();
});

if (!IMAGE) {
  console.error('[lanceur] LANCEUR_IMAGE est obligatoire');
  process.exit(2);
}
mkdirSync(dirname(ECOUTE), { recursive: true });
if (existsSync(ECOUTE)) unlinkSync(ECOUTE);
serveur.listen(ECOUTE, () => {
  chmodSync(ECOUTE, 0o660);
  console.log(`[lanceur] à l'écoute sur ${ECOUTE}, moteur ${MOTEUR}, image ${IMAGE}${ESSAI ? ' (MODE ESSAI)' : ''}`);
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => serveur.close(() => process.exit(0)));
