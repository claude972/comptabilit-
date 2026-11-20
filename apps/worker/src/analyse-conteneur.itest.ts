/**
 * Exécution isolée des analyseurs dans des CONTENEURS dédiés (D-098) — moteur Docker réel (Colima en local).
 *
 * Activé par `ESSAIS_CONTENEUR=1` (sans cette variable, tout est ignoré : la CI GitHub n'exécute pas ces essais, voir
 * docs/architecture.md). Deux familles :
 *
 * 1. CONFINEMENT et cycle de vie, avec une image d'essai LOCALE (`python:3.12.16-slim-bookworm`, déjà présente : aucun
 *    téléchargement) et des enfants d'essai écrits en Python, lancés par EXACTEMENT le même code et les mêmes options
 *    de sécurité que l'enfant réel (seuls le point d'entrée et la commande changent : `ParametresConteneur.essai`).
 * 2. ÉQUIVALENCE des résultats entre le mode processus et le mode conteneur avec l'image RÉELLE d'analyse
 *    (`ANALYSE_CONTENEUR_IMAGE`, défaut `comtaple-analyse:dev`, construite par `docker build --target analyse`). Ignorée si
 *    cette image n'existe pas sur le moteur : elle exige une base Node pour Linux, qu'aucun téléchargement n'est venu fournir.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enBlocs, genererFecSynthetique, genererReleveSynthetique, type LigneFec } from '@comtaple/core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { compterConteneursAnalyse, ETIQUETTE, type ParametresConteneur, retirerConteneursAnalyseExpires } from './analyse-conteneur.js';
import { analyserFecIsole, analyserPieceIsolee, executerEnfant, lireReleveIsole, type OptionsAnalyse } from './analyse-isolee.js';

const ACTIF = process.env.ESSAIS_CONTENEUR === '1';
const IMAGE_ESSAI = process.env.ESSAIS_CONTENEUR_IMAGE ?? 'python:3.12.16-slim-bookworm';
const IMAGE_ANALYSE = process.env.ANALYSE_CONTENEUR_IMAGE ?? 'comtaple-analyse:dev';
const present = (image: string) => {
  try {
    execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const IMAGE_ESSAI_PRESENTE = ACTIF && present(IMAGE_ESSAI);
const IMAGE_ANALYSE_PRESENTE = ACTIF && present(IMAGE_ANALYSE);

const base = (): ParametresConteneur => ({ image: IMAGE_ESSAI, docker: 'docker', hote: '', cpus: 1, pidsMax: 64, tmpfsMo: 64 });
/** Options d'un enfant d'essai Python (même conteneur durci, autre commande). */
const sonde = (code: string, extra: Partial<OptionsAnalyse> = {}, params: Partial<ParametresConteneur> = {}): OptionsAnalyse => ({
  isolation: 'conteneur',
  conteneur: { ...base(), ...params, essai: { entrypoint: 'python3', commande: ['-I', '-c', code] } },
  dureeMaxMs: 30_000,
  memoireMaxMo: 256,
  ...extra,
});
const schemaLibre = z.record(z.string(), z.unknown());
const lancer = (code: string, corps: Buffer = Buffer.alloc(0), extra: Partial<OptionsAnalyse> = {}, params: Partial<ParametresConteneur> = {}) =>
  executerEnfant({ entete: { op: 'texte' }, corps, schema: schemaLibre }, sonde(code, extra, params));

// ── Enfants d'essai (Python) ─────────────────────────────────────────────────────────────────────────────────────────
const ENTETE = `
import sys, os, json, struct, hashlib
f = sys.stdin.buffer
n = struct.unpack('>I', f.read(4))[0]
entete = json.loads(f.read(n))
def sortie(o):
    sys.stdout.write(json.dumps(o)); sys.stdout.flush()
`;
const ENTREE = `${ENTETE}
corps = f.read()
`;
/** Interroge le conteneur de l'intérieur : identité, capacités, environnement, réseau, système de fichiers, hôte. */
const SONDE_CONFINEMENT = `${ENTREE}
import socket, subprocess, shutil, ctypes
def essai(fn):
    try:
        fn(); return 'ok'
    except BaseException as e:
        return type(e).__name__ + ':' + str(getattr(e, 'errno', ''))
st = open('/proc/self/status').read()
def champ(nom):
    for l in st.splitlines():
        if l.startswith(nom + ':'): return l.split(':', 1)[1].strip()
def ecrire(chemin, taille=1):
    with open(chemin, 'wb') as g: g.write(b'x' * taille)
def tmp_plein():
    with open('/tmp/plein', 'wb') as g:
        for _ in range(200): g.write(b'x' * (1 << 20)); g.flush()
shutil.copy('/bin/true', '/tmp/vrai')
os.chmod('/tmp/vrai', 0o755)
libc = ctypes.CDLL(None, use_errno=True)
r = {
  'uid': os.getuid(), 'gid': os.getgid(), 'euid': os.geteuid(),
  'capeff': champ('CapEff'), 'capbnd': champ('CapBnd'), 'capprm': champ('CapPrm'), 'nonewprivs': champ('NoNewPrivs'), 'seccomp': champ('Seccomp'),
  'env': sorted(os.environ.keys()),
  'tcp': essai(lambda: socket.create_connection(('1.1.1.1', 80), timeout=3)),
  'tcp_local': essai(lambda: socket.create_connection(('127.0.0.1', 5432), timeout=3)),
  'dns': essai(lambda: socket.getaddrinfo('example.com', 80)),
  'udp': essai(lambda: socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(b'x', ('8.8.8.8', 53))),
  'interfaces': sorted(os.listdir('/sys/class/net')),
  'ecrit_etc': essai(lambda: ecrire('/etc/comtaple-essai')),
  'ecrit_racine': essai(lambda: ecrire('/comtaple-essai')),
  'ecrit_tmp': essai(lambda: ecrire('/tmp/ok')),
  'tmp_plein': essai(tmp_plein),
  'exec_tmp': essai(lambda: subprocess.run(['/tmp/vrai'], check=True)),
  'setuid': essai(lambda: os.setuid(0)),
  'chown': essai(lambda: os.chown('/tmp/ok', 0, 0)),
  'mount': 'ok' if libc.mount(b'none', b'/mnt', b'tmpfs', 0, None) == 0 else 'echec:' + str(ctypes.get_errno()),
  'socket_docker': [p for p in ['/var/run/docker.sock', '/run/docker.sock', '/docker.sock'] if os.path.exists(p)],
  'hote': [p for p in ['/Volumes', '/Users', '/host', '/mnt/host', '/home'] if os.path.exists(p) and os.listdir(p)],
  'racine': sorted(os.listdir('/')),
  'montages_hote': [l for l in open('/proc/self/mountinfo').read().splitlines() if any(m in l for m in ('docker.sock', '/Users', '/Volumes', 'virtiofs'))],
  'dev': sorted(os.listdir('/dev')),
}
sortie(r)
`;

afterEach(async () => {
  // Chaque essai doit laisser le moteur propre : aucun conteneur d'analyse résiduel (vérifié par étiquette).
  if (ACTIF) expect(await compterConteneursAnalyse(base()), 'conteneur(s) d’analyse résiduel(s)').toBe(0);
});

describe.skipIf(!ACTIF)('prérequis', () => {
  it('l’image d’essai locale est présente (aucun téléchargement n’est tenté)', () => {
    expect(IMAGE_ESSAI_PRESENTE, `image ${IMAGE_ESSAI} absente du moteur local`).toBe(true);
  });
});

describe.skipIf(!IMAGE_ESSAI_PRESENTE)('confinement du conteneur d’analyse', () => {
  it('sans réseau, non root, sans capacité, seccomp actif, sans variable d’environnement du worker, sans socket ni fichier de l’hôte', async () => {
    process.env.COMTAPLE_JETON_SECRET_ESSAI = 'ne-doit-jamais-etre-visible';
    process.env.DATABASE_URL_WORKER = 'postgres://secret@hote/base';
    let issue;
    try {
      issue = await lancer(SONDE_CONFINEMENT);
    } finally {
      delete process.env.COMTAPLE_JETON_SECRET_ESSAI;
      delete process.env.DATABASE_URL_WORKER;
    }
    expect(issue.ok, JSON.stringify(issue)).toBe(true);
    if (!issue.ok) return;
    const r = issue.valeur as Record<string, unknown>;
    // Identité : non root, sans aucune capacité (ensemble effectif, permis et limite), sans élévation, seccomp en mode filtre (2).
    expect(r.uid).toBe(65532);
    expect(r.euid).toBe(65532);
    expect(r.gid).toBe(65532);
    expect(r.capeff).toBe('0000000000000000');
    expect(r.capprm).toBe('0000000000000000');
    expect(r.capbnd).toBe('0000000000000000');
    expect(r.nonewprivs).toBe('1');
    expect(r.seccomp).toBe('2');
    // Environnement : rien du worker.
    // (seules figurent les variables DE L'IMAGE : GPG_KEY, HOME, HOSTNAME, LANG, PATH, PYTHON_* pour l'image d'essai)
    expect(r.env as string[]).not.toEqual(expect.arrayContaining(['COMTAPLE_JETON_SECRET_ESSAI']));
    expect(JSON.stringify(r.env)).not.toMatch(/DATABASE|REDIS|S3_|JETON|TOKEN|PASSWORD|COMTAPLE|SECRET/i);
    expect((r.env as string[]).filter((v) => !/^(GPG_KEY|HOME|HOSTNAME|LANG|PATH|PYTHON_\w+|PYTHONUNBUFFERED|PYTHONDONTWRITEBYTECODE)$/.test(v))).toEqual([]);
    // Réseau : aucune connexion (TCP externe, TCP local, DNS, UDP) ; aucune interface autre que la boucle locale.
    for (const cle of ['tcp', 'tcp_local', 'dns', 'udp']) expect(r[cle], cle).not.toBe('ok');
    expect(r.interfaces).toEqual(['lo']);
    // Système de fichiers : racine en lecture seule (EROFS = 30), écriture permise dans le seul tmpfs, borné à 64 Mo, sans exécution.
    expect(r.ecrit_etc).toBe('OSError:30');
    expect(r.ecrit_racine).toBe('OSError:30');
    expect(r.ecrit_tmp).toBe('ok');
    expect(r.tmp_plein).toBe('OSError:28'); // ENOSPC : le tmpfs est borné
    expect(r.exec_tmp).not.toBe('ok'); // noexec
    // Privilèges : refusés.
    expect(r.setuid).toMatch(/PermissionError/);
    expect(r.chown).toMatch(/PermissionError/);
    expect(String(r.mount)).toMatch(/^echec:1$/); // EPERM
    // Hôte : ni socket Docker, ni dossier de l'hôte, ni montage issu de l'hôte.
    expect(r.socket_docker).toEqual([]);
    expect(r.hote).toEqual([]);
    expect(r.montages_hote).toEqual([]);
    expect(r.racine as string[]).not.toContain('Volumes');
    expect(r.dev as string[]).not.toContain('docker.sock');
  });

  it('le moteur confirme les options réelles du conteneur (inspection pendant l’exécution)', async () => {
    // Conteneur d'essai qui attend, pour pouvoir l'inspecter vivant.
    const attente = lancer('import time; time.sleep(60)', Buffer.alloc(0), { dureeMaxMs: 8_000 });
    let inspection: Record<string, unknown> | null = null;
    for (let i = 0; i < 40 && !inspection; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const ids = execFileSync('docker', ['ps', '-q', '--filter', `label=${ETIQUETTE}`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
      if (ids.length === 1) inspection = (JSON.parse(execFileSync('docker', ['inspect', ids[0]!], { encoding: 'utf8' })) as Array<Record<string, unknown>>)[0]!;
    }
    expect(inspection, 'conteneur introuvable pendant son exécution').not.toBeNull();
    const h = inspection!.HostConfig as Record<string, unknown>;
    const c = inspection!.Config as Record<string, unknown>;
    expect(h.NetworkMode).toBe('none');
    expect(h.Privileged).toBe(false);
    expect(h.CapDrop).toEqual(['ALL']);
    expect(h.CapAdd).toBeNull();
    expect(h.ReadonlyRootfs).toBe(true);
    expect(h.SecurityOpt).toEqual(['no-new-privileges']); // aucun `seccomp=unconfined` : profil par défaut du moteur
    expect(h.PidsLimit).toBe(64);
    expect(h.Memory).toBe(256 * 1024 * 1024);
    expect(h.MemorySwap).toBe(256 * 1024 * 1024);
    expect(h.NanoCpus).toBe(1_000_000_000);
    expect(h.IpcMode).toBe('none');
    expect(h.PidMode).toBe('');
    expect(h.UsernsMode).toBe('');
    expect(h.Binds).toBeNull();
    expect(h.Mounts ?? null).toBeNull();
    expect(JSON.stringify(h.Devices ?? [])).toBe('[]');
    expect(c.User).toBe('65532:65532');
    expect(c.Env as string[]).not.toEqual(expect.arrayContaining([expect.stringMatching(/SECRET|DATABASE|REDIS/)]));
    expect(inspection!.Mounts).toEqual([]);
    expect(JSON.stringify(h.Tmpfs)).toContain('size=64m');
    const issue = await attente;
    expect(issue).toMatchObject({ ok: false, cause: 'delai' });
  }, 60_000);

  it('l’entrée circule intacte (5 Mo) et le résultat revient validé ; mêmes issues qu’en mode processus', async () => {
    const corps = randomBytes(5 * 1024 * 1024);
    const issue = await lancer(`${ENTREE}\nsortie({'sha': hashlib.sha256(corps).hexdigest(), 'taille': len(corps), 'op': entete['op']})`, corps);
    expect(issue).toMatchObject({ ok: true, valeur: { sha: createHash('sha256').update(corps).digest('hex'), taille: corps.length, op: 'texte' } });
  });

  it('délai dépassé : conteneur tué et supprimé, cause « delai »', async () => {
    const debut = Date.now();
    const issue = await lancer('import time; time.sleep(600)', Buffer.alloc(0), { dureeMaxMs: 2_000 });
    expect(issue).toMatchObject({ ok: false, cause: 'delai' });
    expect(Date.now() - debut).toBeLessThan(15_000);
  });

  it('mémoire dépassée : arrêt par le noyau (OOM), cause « memoire », conteneur supprimé', async () => {
    const issue = await lancer(`${ENTREE}\nb = []\nwhile True: b.append(b'x' * (16 << 20))`, Buffer.alloc(0), { memoireMaxMo: 128, dureeMaxMs: 30_000 });
    expect(issue).toMatchObject({ ok: false, cause: 'memoire' });
  });

  it('bombe de processus : le nombre de processus est borné, le conteneur est supprimé, le moteur reste réactif', async () => {
    const compte = await lancer(
      `${ENTREE}
import time
enfants = 0; refus = None
for _ in range(400):
    try:
        pid = os.fork()
    except OSError as e:
        refus = e.errno; break
    if pid == 0:
        time.sleep(20); os._exit(0)
    enfants += 1
sortie({'enfants': enfants, 'refus': refus})`,
      Buffer.alloc(0),
      { dureeMaxMs: 20_000 },
    );
    expect(compte.ok, JSON.stringify(compte)).toBe(true);
    if (compte.ok) {
      expect(compte.valeur.refus).toBe(11); // EAGAIN : la limite de processus a refusé la création
      expect(Number(compte.valeur.enfants)).toBeLessThan(64);
    }
    // Bombe qui ne s'arrête pas : arrêtée par la durée, tous ses processus emportés avec le conteneur.
    const bombe = await lancer('import os\nwhile True:\n    try: os.fork()\n    except OSError: pass', Buffer.alloc(0), { dureeMaxMs: 3_000 });
    expect(bombe).toMatchObject({ ok: false, cause: 'delai' });
    expect(execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).trim()).not.toBe('');
  }, 60_000);

  it('sortie excessive, sortie invalide, plantage : mêmes causes que le mode processus', async () => {
    expect(await lancer(`${ENTREE}\nsys.stdout.write('x' * (20 << 20)); sys.stdout.flush()`, Buffer.alloc(0), { sortieMaxOctets: 1024 * 1024 })).toMatchObject({ ok: false, cause: 'sortie_trop_grande' });
    expect(await lancer(`${ENTREE}\nsys.stdout.write('pas du json')`)).toMatchObject({ ok: false, cause: 'sortie_invalide' });
    expect(await lancer(`${ENTREE}\nsys.stdout.write('[1,2]')`)).toMatchObject({ ok: false, cause: 'sortie_invalide' });
    const sortie3 = await lancer(`${ENTREE}\nraise SystemExit(3)`);
    expect(sortie3, JSON.stringify(sortie3)).toMatchObject({ ok: false, cause: 'plantage' });
    // Défaut de segmentation réel (un signal envoyé par le processus à lui-même est ignoré par le PID 1 d'un conteneur).
    const segv = await lancer(`${ENTREE}\nimport ctypes; ctypes.string_at(0)`);
    expect(segv, JSON.stringify(segv)).toMatchObject({ ok: false, cause: 'plantage' });
  }, 60_000);

  it('lancement impossible (image absente) : erreur de lancement, jamais une pièce « interrompue » ; aucun conteneur créé', async () => {
    await expect(lancer('pass', Buffer.alloc(0), {}, { image: 'comtaple-analyse-inexistante:essai' })).rejects.toThrow(/Lancement du conteneur d'analyse impossible/);
    await expect(lancer('pass', Buffer.alloc(0), {}, { docker: '/nonexistent/docker' })).rejects.toThrow(/Lancement/);
  });

  it('le nom du fichier et son contenu n’entrent jamais dans la ligne de commande du moteur', async () => {
    // Un contenu qui ressemble à des options ne change pas le conteneur : il n'est lu que sur l'entrée standard.
    const hostile = Buffer.from('--privileged -v /var/run/docker.sock:/var/run/docker.sock --network host');
    const issue = await lancer(`${ENTREE}\nsortie({'lu': corps.decode(), 'socket': os.path.exists('/var/run/docker.sock'), 'net': sorted(os.listdir('/sys/class/net'))})`, hostile);
    expect(issue).toMatchObject({ ok: true, valeur: { socket: false, net: ['lo'] } });
  });

  it('analyses simultanées : chacune dans son conteneur, aucun conteneur résiduel', async () => {
    const issues = await Promise.all(Array.from({ length: 6 }, (_, i) => lancer(`${ENTREE}\nsortie({'i': ${i}, 'pid': os.getpid(), 'hn': os.uname().nodename})`)));
    expect(issues.every((x) => x.ok)).toBe(true);
    const noms = new Set(issues.map((x) => (x.ok ? x.valeur.hn : '')));
    expect(noms.size).toBe(6); // six conteneurs distincts (nom d'hôte = identifiant du conteneur)
  }, 60_000);

  it('conteneurs orphelins : seul un conteneur d’analyse EXPIRÉ est retiré ; jamais un conteneur en cours ni un conteneur sans étiquette', async () => {
    const p = base();
    const demarrer = (etiquettes: string[]) =>
      execFileSync('docker', ['run', '-d', '--network', 'none', '--pull', 'never', ...etiquettes.flatMap((e) => ['--label', e]), '--entrypoint', 'sleep', IMAGE_ESSAI, '120'], { encoding: 'utf8' }).trim();
    const expire = demarrer([`${ETIQUETTE}=11111111-2222-4333-8444-000000000001`, `${ETIQUETTE}.expire=${Date.now() - 1000}`]);
    const enCours = demarrer([`${ETIQUETTE}=11111111-2222-4333-8444-000000000002`, `${ETIQUETTE}.expire=${Date.now() + 3_600_000}`]);
    const autre = demarrer(['comtaple.essai=autre']);
    const avant = execFileSync('docker', ['ps', '-q'], { encoding: 'utf8' }).trim().split('\n').length;
    try {
      expect(await retirerConteneursAnalyseExpires(p)).toBe(1);
      const vivants = execFileSync('docker', ['ps', '-q', '--no-trunc'], { encoding: 'utf8' });
      expect(vivants).not.toContain(expire);
      expect(vivants).toContain(enCours);
      expect(vivants).toContain(autre);
      expect(execFileSync('docker', ['ps', '-q'], { encoding: 'utf8' }).trim().split('\n').length).toBe(avant - 1);
    } finally {
      execFileSync('docker', ['rm', '-f', enCours, autre], { stdio: 'ignore' });
      try {
        execFileSync('docker', ['rm', '-f', expire], { stdio: 'ignore' });
      } catch {
        /* déjà retiré par le nettoyage testé */
      }
    }
  }, 60_000);
});

// ── Lanceur restreint (proxy filtrant de l'API du moteur) : l'architecture de production, jouée en local ─────────────
const LANCEUR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../scripts/lanceur-analyse.mjs');
const SOCKET_MOTEUR = process.env.DOCKER_HOST?.replace(/^unix:\/\//, '') ?? join(homedir(), '.comtaple-outils/colima/default/docker.sock');

interface LanceurEnCours {
  socket: string;
  processus: ChildProcess;
  journal: () => string;
  arreter: () => Promise<void>;
}
async function demarrerLanceur(extra: Record<string, string> = {}): Promise<LanceurEnCours> {
  const dossier = `/tmp/cl-${randomBytes(4).toString('hex')}`; // chemin court : limite des sockets Unix
  mkdirSync(dossier, { recursive: true });
  const socket = join(dossier, 'l.sock');
  let journal = '';
  const processus = spawn(process.execPath, [LANCEUR], {
    env: { PATH: process.env.PATH ?? '', LANCEUR_ECOUTE: socket, LANCEUR_MOTEUR: SOCKET_MOTEUR, LANCEUR_IMAGE: IMAGE_ESSAI, LANCEUR_ESSAI: 'python', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processus.stdout!.on('data', (d: Buffer) => (journal += d.toString()));
  processus.stderr!.on('data', (d: Buffer) => (journal += d.toString()));
  for (let i = 0; i < 50 && !journal.includes("à l'écoute"); i++) await new Promise((r) => setTimeout(r, 100));
  expect(journal).toContain("à l'écoute");
  return {
    socket,
    processus,
    journal: () => journal,
    arreter: async () => {
      processus.kill('SIGTERM');
      await new Promise((r) => processus.once('exit', r));
      rmSync(dossier, { recursive: true, force: true });
    },
  };
}
/** Requête brute à l'API du lanceur (comme le ferait un client détourné). */
function api(l: LanceurEnCours, methode: string, chemin: string, corps?: unknown): Promise<{ code: number; corps: string }> {
  return new Promise((ok, ko) => {
    const donnees = corps === undefined ? undefined : typeof corps === 'string' ? corps : JSON.stringify(corps);
    const r = http.request({ socketPath: l.socket, method: methode, path: chemin, headers: donnees ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(donnees) } : {} }, (rep) => {
      const m: Buffer[] = [];
      rep.on('data', (c: Buffer) => m.push(c));
      rep.on('end', () => ok({ code: rep.statusCode ?? 0, corps: Buffer.concat(m).toString('utf8') }));
    });
    r.on('error', ko);
    r.end(donnees);
  });
}
const parametresViaLanceur = (l: LanceurEnCours): Partial<ParametresConteneur> => ({ hote: `unix://${l.socket}` });

describe.skipIf(!IMAGE_ESSAI_PRESENTE)('lanceur restreint : le worker ne voit jamais le socket du moteur (architecture de production)', () => {
  let l: LanceurEnCours;
  let temoin = '';
  const demarrerTemoin = () => {
    // Conteneur SANS étiquette d'analyse, propre à ce test : il joue « le reste de l'hôte » que le lanceur doit protéger.
    temoin = execFileSync('docker', ['run', '-d', '--network', 'none', '--pull', 'never', '--name', `essai-lanceur-${randomBytes(4).toString('hex')}`, '--label', 'comtaple.essai=temoin', '--entrypoint', 'sleep', IMAGE_ESSAI, '300'], { encoding: 'utf8' }).trim();
  };
  const vivant = (id: string) => execFileSync('docker', ['ps', '-q', '--no-trunc', '--filter', `id=${id}`], { encoding: 'utf8' }).trim() === id;
  const corpsValide = (uuid: string) => ({
    Image: IMAGE_ESSAI,
    User: '65532:65532',
    Entrypoint: ['python3'],
    Cmd: ['-I', '-c', 'pass'],
    Labels: { [ETIQUETTE]: uuid, [`${ETIQUETTE}.expire`]: String(Date.now() + 120_000) },
    HostConfig: { NetworkMode: 'none', CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], ReadonlyRootfs: true, IpcMode: 'none', Memory: 256 * 1048576, MemorySwap: 256 * 1048576, NanoCpus: 1e9, PidsLimit: 64, Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=64m,mode=1777' } },
  });

  it('une analyse complète passe par le lanceur ; le conteneur créé a exactement les options imposées', async () => {
    l = await demarrerLanceur();
    demarrerTemoin();
    const attente = lancer('import time; time.sleep(60)', Buffer.alloc(0), { dureeMaxMs: 6_000 }, parametresViaLanceur(l));
    let inspection: Record<string, unknown> | null = null;
    for (let i = 0; i < 30 && !inspection; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const ids = execFileSync('docker', ['ps', '-q', '--filter', `label=${ETIQUETTE}`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
      if (ids.length === 1) inspection = (JSON.parse(execFileSync('docker', ['inspect', ids[0]!], { encoding: 'utf8' })) as Array<Record<string, unknown>>)[0]!;
    }
    const h = inspection!.HostConfig as Record<string, unknown>;
    expect(h).toMatchObject({ NetworkMode: 'none', Privileged: false, CapDrop: ['ALL'], ReadonlyRootfs: true, IpcMode: 'none', PidsLimit: 64, Memory: 256 * 1048576, MemorySwap: 256 * 1048576, NanoCpus: 1e9 });
    expect(h.SecurityOpt).toEqual(['no-new-privileges']);
    expect(h.Binds).toBeNull();
    expect((inspection!.Config as { User: string }).User).toBe('65532:65532');
    expect(await attente).toMatchObject({ ok: false, cause: 'delai' });
    const sain = await lancer(`${ENTREE}\nsortie({'socket': os.path.exists('/var/run/docker.sock'), 'uid': os.getuid()})`, Buffer.from('x'), {}, parametresViaLanceur(l));
    expect(sain).toMatchObject({ ok: true, valeur: { socket: false, uid: 65532 } });
  }, 60_000);

  it('refuse toute création qui s’écarte des options imposées (conteneur privilégié, montage du socket, réseau, image, variables, plafonds)', async () => {
    const uuid = randomUUID();
    const creer = (corps: unknown, nom = `comtaple-analyse-${uuid}`) => api(l, 'POST', `/v1.54/containers/create?name=${nom}`, corps);
    const v = corpsValide(uuid);
    const variantes: Array<[string, unknown]> = [
      ['privilégié', { ...v, HostConfig: { ...v.HostConfig, Privileged: true } }],
      ['socket monté', { ...v, HostConfig: { ...v.HostConfig, Binds: ['/var/run/docker.sock:/var/run/docker.sock'] } }],
      ['montage', { ...v, HostConfig: { ...v.HostConfig, Mounts: [{ Type: 'bind', Source: '/', Target: '/hote' }] } }],
      ['réseau de l’hôte', { ...v, HostConfig: { ...v.HostConfig, NetworkMode: 'host' } }],
      ['réseau par défaut', { ...v, HostConfig: { ...v.HostConfig, NetworkMode: 'bridge' } }],
      ['capacité ajoutée', { ...v, HostConfig: { ...v.HostConfig, CapAdd: ['SYS_ADMIN'] } }],
      ['toutes les capacités', { ...v, HostConfig: { ...v.HostConfig, CapDrop: [] } }],
      ['seccomp relâché', { ...v, HostConfig: { ...v.HostConfig, SecurityOpt: ['seccomp=unconfined'] } }],
      ['racine inscriptible', { ...v, HostConfig: { ...v.HostConfig, ReadonlyRootfs: false } }],
      ['espace de processus de l’hôte', { ...v, HostConfig: { ...v.HostConfig, PidMode: 'host' } }],
      ['périphérique', { ...v, HostConfig: { ...v.HostConfig, Devices: [{ PathOnHost: '/dev/kvm', PathInContainer: '/dev/kvm', CgroupPermissions: 'rwm' }] } }],
      ['mémoire démesurée', { ...v, HostConfig: { ...v.HostConfig, Memory: 64 * 1024 ** 3, MemorySwap: 64 * 1024 ** 3 } }],
      ['sans limite de mémoire', { ...v, HostConfig: { ...v.HostConfig, Memory: 0 } }],
      ['processus illimités', { ...v, HostConfig: { ...v.HostConfig, PidsLimit: -1 } }],
      ['autre image', { ...v, Image: 'alpine:3' }],
      ['root', { ...v, User: 'root' }],
      ['variables d’environnement', { ...v, Env: ['DATABASE_URL=secret'] }],
      ['étiquette incohérente avec le nom', { ...v, Labels: { [ETIQUETTE]: randomUUID(), [`${ETIQUETTE}.expire`]: String(Date.now() + 1000) } }],
      ['commande d’essai non autorisée', { ...v, Cmd: ['-c', 'pass'] }],
      ['point d’entrée autre', { ...v, Entrypoint: ['sh'] }],
    ];
    for (const [nom, corps] of variantes) {
      const r = await creer(corps);
      expect(r.code, `${nom} : ${r.corps}`).toBe(403);
    }
    expect((await creer(v, 'autre-nom')).code).toBe(403);
    expect((await creer(v, `comtaple-analyse-${uuid}`.replace(/.$/, 'Z'))).code).toBe(403);
    expect((await api(l, 'POST', `/containers/create?name=comtaple-analyse-${uuid}`, 'x'.repeat(100_000))).code).toBe(413);
    expect((await api(l, 'POST', `/containers/create?name=comtaple-analyse-${uuid}`, '{pas du json')).code).toBe(400);
    // Rien n'a été créé par ces refus.
    expect(await compterConteneursAnalyse(base())).toBe(0);
  });

  it('ne donne accès à rien d’autre : ni images, volumes, réseaux, exécutions, système, ni conteneurs sans étiquette ; ne liste que les conteneurs d’analyse', async () => {
    for (const [m, c] of [
      ['GET', '/images/json'], ['POST', '/images/create?fromImage=alpine'], ['GET', '/volumes'], ['POST', '/volumes/create'], ['GET', '/networks'], ['GET', '/info'], ['GET', '/system/df'], ['POST', '/build'],
      ['POST', `/containers/${temoin}/exec`], ['POST', '/exec/abc/start'], ['GET', `/containers/${temoin}/json`], ['GET', `/containers/${temoin}/logs?stdout=1`], ['POST', `/containers/${temoin}/start`],
      ['POST', `/containers/${temoin}/kill`], ['POST', `/containers/${temoin}/stop`], ['POST', `/containers/${temoin}/wait`], ['DELETE', `/containers/${temoin}?force=1`], ['DELETE', '/containers/prune'], ['POST', '/containers/prune'],
      ['GET', `/containers/${temoin}/archive?path=/etc`], ['PUT', `/containers/${temoin}/archive?path=/`], ['POST', `/containers/${temoin}/update`], ['POST', `/containers/${temoin}/rename?name=x`],
    ] as const) {
      const r = await api(l, m, `/v1.54${c}`);
      expect(r.code, `${m} ${c}`).toBe(403);
    }
    expect(vivant(temoin), 'le conteneur témoin doit être intact').toBe(true);
    // Liste : filtres arbitraires ramenés aux seuls conteneurs d'analyse (aucun conteneur d'analyse ne tourne : liste vide).
    for (const filtres of ['{}', '{"label":["comtaple.essai=temoin"]}', '{"name":["essai-lanceur"]}', '{"status":["running"]}']) {
      const r = await api(l, 'GET', `/v1.54/containers/json?all=1&filters=${encodeURIComponent(filtres)}`);
      expect(r.code).toBe(200);
      expect(JSON.parse(r.corps), `filtre ${filtres}`).toEqual([]);
    }
    // Attache à un conteneur sans étiquette : refusée aussi (changement de protocole).
    const rep = await new Promise<number>((ok) => {
      const r = http.request({ socketPath: l.socket, method: 'POST', path: `/v1.54/containers/${temoin}/attach?stream=1&stdin=1&stdout=1`, headers: { Connection: 'Upgrade', Upgrade: 'tcp' } });
      r.on('upgrade', () => ok(101));
      r.on('response', (x) => ok(x.statusCode ?? 0));
      r.on('error', () => ok(-1));
      r.end();
    });
    expect(rep).toBe(403);
    expect(vivant(temoin)).toBe(true);
  });

  it('un client docker ordinaire détourné ne peut pas lancer de conteneur privilégié ni monter le socket via le lanceur', () => {
    const env = { ...process.env, DOCKER_HOST: `unix://${l.socket}` };
    for (const args of [
      ['run', '--rm', '--privileged', '--pull', 'never', IMAGE_ESSAI, 'true'],
      ['run', '--rm', '-v', '/var/run/docker.sock:/var/run/docker.sock', '--pull', 'never', IMAGE_ESSAI, 'true'],
      ['run', '--rm', '--pull', 'never', '--network', 'host', IMAGE_ESSAI, 'true'],
    ]) {
      expect(() => execFileSync('docker', args, { env, stdio: 'pipe' }), args.join(' ')).toThrow();
    }
  });

  it('plafond de conteneurs simultanés : une analyse en trop est refusée (429), jamais lancée', async () => {
    const limite = await demarrerLanceur({ LANCEUR_MAX_CONTENEURS: '1' });
    try {
      const longue = lancer('import time; time.sleep(60)', Buffer.alloc(0), { dureeMaxMs: 6_000 }, parametresViaLanceur(limite));
      await new Promise((r) => setTimeout(r, 2_000));
      await expect(lancer('pass', Buffer.alloc(0), {}, parametresViaLanceur(limite))).rejects.toThrow(/Lancement du conteneur d'analyse impossible/);
      expect(await longue).toMatchObject({ ok: false, cause: 'delai' });
    } finally {
      await limite.arreter();
    }
  }, 60_000);

  it('arrêt : le conteneur témoin n’a jamais été touché ; le journal du lanceur nomme les refus', async () => {
    expect(vivant(temoin)).toBe(true);
    expect(l.journal()).toContain('refus');
    execFileSync('docker', ['rm', '-f', temoin], { stdio: 'ignore' });
    await l.arreter();
  });
});

// ── FEC en flux : contre-pression et débit à travers le conteneur (enfant d'essai Python) ───────────────────────────
const FEC_ESSAI = `${ENTETE}
def trame(o):
    b = json.dumps(o).encode(); sys.stdout.buffer.write(struct.pack('>I', len(b)) + b); sys.stdout.buffer.flush()
def ligne(i):
    return {'numeroLigne': i, 'journalCode': 'VT', 'journalLib': 'Ventes', 'ecritureNum': 'E%d' % i, 'ecritureDate': '2025-06-30', 'compteNum': '411000', 'compteLib': 'Clients',
            'compAuxNum': None, 'compAuxLib': None, 'pieceRef': 'P', 'pieceDate': '2025-06-30', 'ecritureLib': 'x' * 300, 'debit': '1.00', 'credit': '0.00',
            'ecritureLet': None, 'dateLet': None, 'validDate': None, 'montantDevise': None, 'idevise': None}
nl = 0
while True:
    b = f.read1(4096)
    if not b: break
    nl += 1
    trame({'t': 'lignes', 'lignes': [ligne(nl)]})
trame({'t': 'rapport', 'rapport': {'encodage': 'utf-8', 'separateur': 'tabulation', 'variante': 'debit_credit', 'entetes': [], 'nbLignesLues': nl, 'nbLignesNormalisees': nl,
       'anomalies': [], 'nbAnomaliesParCode': {}, 'lisible': True, 'conforme': True, 'suffisantPourTravaux': True, 'totalDebit': '0.00', 'totalCredit': '0.00', 'dateMin': None, 'dateMax': None}})
`;

describe.skipIf(!IMAGE_ESSAI_PRESENTE)('FEC en flux à travers un conteneur (enfant d’essai) : contre-pression et débit', () => {
  const source = (blocs: number, taille = 65_536, compteur?: { lus: number }) =>
    (async function* () {
      const bloc = Buffer.alloc(taille, 0x41);
      for (let i = 0; i < blocs; i++) {
        if (compteur) compteur.lus += taille;
        yield bloc;
      }
    })();
  const demande = { exerciceDebut: '2025-01-01', exerciceFin: '2025-12-31', nomFichier: null };
  const options = (extra: Partial<OptionsAnalyse> = {}): OptionsAnalyse => sonde(FEC_ESSAI, { dureeMaxMs: 120_000, sortieMaxOctets: 16 * 1024 * 1024, ...extra });

  it('les lots arrivent dans l’ordre, le rapport est accepté, aucun conteneur ne reste', async () => {
    const vus: number[] = [];
    const issue = await analyserFecIsole(source(40), { ...demande, surLot: async (l: LigneFec[]) => void vus.push(...l.map((x) => x.numeroLigne)) }, options());
    expect(issue.ok, JSON.stringify(issue)).toBe(true);
    expect(vus.length).toBeGreaterThanOrEqual(640);
    expect(vus).toEqual(Array.from({ length: vus.length }, (_, i) => i + 1));
  });

  it('contre-pression : parent arrêté 2 s sur un lot, la lecture de la source plafonne (mémoire tampon bornée, indépendante de la taille du fichier)', async () => {
    const mesure = async (blocs: number) => {
      const compteur = { lus: 0 };
      let lusPendantPause = -1;
      let premier = true;
      const issue = await analyserFecIsole(
        source(blocs, 65_536, compteur),
        {
          ...demande,
          surLot: async () => {
            if (!premier) return;
            premier = false;
            await new Promise((r) => setTimeout(r, 2_000));
            lusPendantPause = compteur.lus;
          },
        },
        options(),
      );
      expect(issue.ok, JSON.stringify(issue)).toBe(true);
      return lusPendantPause;
    };
    const p64 = await mesure(1024); // 64 Mo
    const p160 = await mesure(2560); // 160 Mo
    console.log(`[mesure] contre-pression à travers le conteneur : ${(p64 / 1048576).toFixed(1)} Mo lus sur 64 Mo, ${(p160 / 1048576).toFixed(1)} Mo lus sur 160 Mo, pendant 2 s de pause du parent`);
    expect(p64).toBeGreaterThan(0);
    expect(p64).toBeLessThan(40 * 1048576); // le fichier de 64 Mo n'est pas lu en entier
    expect(p160).toBeLessThan(p64 * 1.5 + 4 * 1048576); // le plafond ne croît pas avec la taille du fichier
  }, 240_000);

  it('débit : 256 Mo traversent le conteneur (entrée) sans lot à insérer', async () => {
    const debut = performance.now();
    const compteur = { lus: 0 };
    const issue = await analyserFecIsole(source(4096, 65_536, compteur), { ...demande, surLot: async () => undefined }, options());
    const s = (performance.now() - debut) / 1000;
    expect(issue.ok, JSON.stringify(issue)).toBe(true);
    console.log(`[mesure] débit d'entrée à travers le conteneur : ${(compteur.lus / 1048576 / s).toFixed(0)} Mo/s (256 Mo en ${s.toFixed(1)} s, une trame de sortie par 4 Ko lus)`);
  }, 300_000);

  it('annulation par le parent (erreur dans surLot) : conteneur arrêté et supprimé, erreur relancée telle quelle', async () => {
    await expect(
      analyserFecIsole(source(1024), { ...demande, surLot: async () => Promise.reject(new Error('import annulé')) }, options()),
    ).rejects.toThrow('import annulé');
  });
});

describe.skipIf(!IMAGE_ESSAI_PRESENTE)('coût du mécanisme de conteneur (enfant d’essai minimal)', () => {
  it('latence d’un conteneur d’analyse (création, démarrage, exécution, suppression) : médiane de 15', async () => {
    const durees: number[] = [];
    for (let i = 0; i < 15; i++) {
      const d = performance.now();
      const r = await lancer(`${ENTREE}\nsortie({'ok': 1})`);
      expect(r.ok).toBe(true);
      durees.push(performance.now() - d);
    }
    durees.sort((a, b) => a - b);
    console.log(`[mesure] conteneur d'essai minimal : médiane ${durees[7]!.toFixed(0)} ms, min ${durees[0]!.toFixed(0)} ms, max ${durees[14]!.toFixed(0)} ms (15 lancements)`);
    expect(durees[7]).toBeLessThan(5_000);
  }, 120_000);
});

// ── Équivalence des résultats, image RÉELLE d'analyse ───────────────────────────────────────────────────────────────
const EXERCICE = { debut: '2025-01-01', fin: '2025-12-31' };
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const conteneurReel = (): OptionsAnalyse => ({ isolation: 'conteneur', conteneur: { ...base(), image: IMAGE_ANALYSE }, dureeMaxMs: 60_000 });

describe.skipIf(!IMAGE_ANALYSE_PRESENTE)('équivalence processus / conteneur — image réelle d’analyse', () => {
  const UBL =
    '<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"><cbc:ID>F-2025-001</cbc:ID><cbc:IssueDate>2025-03-14</cbc:IssueDate><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode></Invoice>';
  const pdfMinimal = () => {
    const objets = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R] /Count 1 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>'];
    const flux = 'BT /F1 10 Tf 50 800 Td 14 TL (Facture numero F-2025-001 du 14/03/2025) Tj T* (Total TTC : 120,00 EUR) Tj T* (Vendeur : Atelier Test SARL, SIREN 552100554) Tj ET';
    objets.push(`<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`);
    let out = '%PDF-1.7\n';
    const pos: number[] = [];
    objets.forEach((o, i) => {
      pos.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const x = out.length;
    out += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  };

  it('pièces (XML, PDF) : même résultat dans les deux modes ; entrées piégées : échec propre ou résultat identique, conteneur supprimé', async () => {
    for (const [type, contenu] of [['application/xml', Buffer.from(UBL)], ['application/pdf', pdfMinimal()]] as const) {
      const a = await analyserPieceIsolee(type, contenu, {});
      const b = await analyserPieceIsolee(type, contenu, conteneurReel());
      expect(a.ok && b.ok).toBe(true);
      expect(b.ok && json(b.valeur)).toEqual(a.ok && json(a.valeur));
    }
    const xxe = Buffer.from(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY r SYSTEM "http://127.0.0.1:9/dtd">]><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>&xxe;&r;</ID></Invoice>`);
    const x = await analyserPieceIsolee('application/xml', xxe, conteneurReel());
    expect(x.ok ? JSON.stringify(x.valeur) : x.cause).not.toContain('root:');
    const bombe = Buffer.from(`<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaaaaaaaa">${'<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">'}]><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>&b;</ID></Invoice>`);
    expect((await analyserPieceIsolee('application/xml', bombe, conteneurReel())).ok === (await analyserPieceIsolee('application/xml', bombe, {})).ok).toBe(true);
    const faux = await analyserPieceIsolee('application/pdf', Buffer.from('%PDF-1.7\n1 0 obj\n<< /Length 99999999 >>\nstream\n'), conteneurReel());
    expect(faux.ok ? faux.valeur.lectureImpossible : faux.cause).toBeTruthy();
  }, 180_000);

  it('relevés (camt.053, OFX, CSV) : même résultat dans les deux modes', async () => {
    for (const format of ['camt.053', 'ofx', 'csv'] as const) {
      const r = genererReleveSynthetique({ graine: 7, format, debut: EXERCICE.debut, fin: EXERCICE.fin, nbMouvements: 200 });
      const contenu = Buffer.from(r.contenu, 'utf8');
      const a = await lireReleveIsole(contenu, { profilCsv: null, profilInvalide: false }, {});
      const b = await lireReleveIsole(contenu, { profilCsv: null, profilInvalide: false }, conteneurReel());
      expect(a.ok && b.ok, format).toBe(true);
      expect(b.ok && json(b.valeur), format).toEqual(a.ok && json(a.valeur));
    }
  }, 180_000);

  it('FEC : mêmes lignes dans le même ordre, même rapport dans les deux modes', async () => {
    const jeu = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 3000, graine: 3 });
    const passer = async (options: OptionsAnalyse) => {
      const lignes: LigneFec[] = [];
      const issue = await analyserFecIsole(enBlocs(jeu.contenu, 7919), { exerciceDebut: EXERCICE.debut, exerciceFin: EXERCICE.fin, nomFichier: jeu.nomFichier, surLot: async (l) => void lignes.push(...l) }, options);
      return { issue, lignes };
    };
    const a = await passer({});
    const b = await passer(conteneurReel());
    expect(a.issue.ok && b.issue.ok).toBe(true);
    expect(b.lignes).toEqual(a.lignes);
    expect(b.issue.ok && json(b.issue.valeur)).toEqual(a.issue.ok && json(a.issue.valeur));
  }, 180_000);

  it('coût réel par pièce : médiane de 15 lectures en mode processus puis en mode conteneur', async () => {
    const mesurer = async (options: OptionsAnalyse) => {
      const t: number[] = [];
      for (let i = 0; i < 15; i++) {
        const d = performance.now();
        await analyserPieceIsolee('application/pdf', pdfMinimal(), options);
        t.push(performance.now() - d);
      }
      return t.sort((a, b) => a - b)[7]!;
    };
    console.log(`[mesure] PDF 1 page : processus ${(await mesurer({})).toFixed(0)} ms, conteneur ${(await mesurer(conteneurReel())).toFixed(0)} ms (médiane de 15)`);
  }, 300_000);
});
