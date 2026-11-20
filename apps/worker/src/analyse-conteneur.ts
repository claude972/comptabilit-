/**
 * Exécution d'un analyseur dans un CONTENEUR dédié (mode `ANALYSE_ISOLATION=conteneur`, D-098).
 *
 * Ce module est du code de CONFIANCE, côté worker : lui seul parle au moteur de conteneurs (par le client `docker`, dont
 * l'hôte est la configuration du worker : socket du moteur en local, lanceur restreint en production). Le conteneur
 * d'analyse, lui, ne voit jamais de socket : il ne reçoit que des octets sur son entrée standard et ne rend que des
 * octets sur sa sortie standard, exactement comme l'enfant du mode « processus ».
 *
 * Toutes les options de sécurité sont ÉCRITES EN DUR ici. Rien de ce qui vient d'un fichier (contenu, nom, en-tête de la
 * demande) n'entre dans la ligne de commande ; les seuls paramètres variables sont des nombres bornés de la configuration.
 *
 * Cycle de vie : chaque conteneur est nommé `comtaple-analyse-<uuid>` et porte l'étiquette `comtaple.analyse=<uuid>`.
 * Il est supprimé à la fin de CHAQUE analyse (succès, délai, erreur) ; seul un conteneur dont l'étiquette porte l'uuid de
 * l'analyse est supprimé : aucun nettoyage global, jamais de `prune`. Un conteneur oublié par un worker tué brutalement
 * porte en plus une date d'expiration : `retirerConteneursAnalyseExpires` ne retire que ceux dont la date est dépassée.
 */
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** Utilisateur et groupe du conteneur d'analyse : numériques, non root, sans compte dans l'image (Dockerfile). */
const UTILISATEUR = '65532:65532';
/** Répertoire de l'application DANS l'image d'analyse (même disposition que le dépôt : voir le Dockerfile). */
export const RACINE_IMAGE = '/app';
export const ETIQUETTE = 'comtaple.analyse';
const ETIQUETTE_EXPIRATION = 'comtaple.analyse.expire';
/** Marge entre la durée autorisée et la date d'expiration inscrite sur le conteneur (démarrage, nettoyage). */
const MARGE_EXPIRATION_MS = 60_000;

export interface ParametresConteneur {
  /** Image d'analyse locale ; jamais téléchargée (`--pull never`). */
  image: string;
  /** Client Docker (nom ou chemin). */
  docker: string;
  /** Hôte du moteur (DOCKER_HOST) ; vide = celui du worker. */
  hote: string;
  cpus: number;
  pidsMax: number;
  tmpfsMo: number;
  /** ESSAIS SEULEMENT : remplace le point d'entrée et la commande de l'image (image d'essai, comportements hostiles). */
  essai?: { entrypoint: string; commande: string[] };
}

export interface LimitesConteneur {
  dureeMaxMs: number;
  memoireMaxMo: number;
}

/** Variables transmises au CLIENT docker (jamais au conteneur) : de quoi joindre le moteur, rien du reste de l'environnement. */
function environnementClient(p: ParametresConteneur): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const nom of ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'COLIMA_HOME']) {
    if (process.env[nom] !== undefined) env[nom] = process.env[nom];
  }
  if (p.hote) env.DOCKER_HOST = p.hote;
  return env;
}

function nombre(v: number, min: number, max: number): string {
  if (!Number.isFinite(v)) throw new Error('Paramètre de conteneur invalide');
  return String(Math.min(max, Math.max(min, v)));
}

/**
 * Ligne de commande de `docker run` : options de sécurité imposées. Exportée pour les essais, qui vérifient qu'aucune option
 * ne dépend de l'entrée.
 */
export function argumentsDockerRun(p: ParametresConteneur, limites: LimitesConteneur, uuid: string, argumentsNode: string[]): string[] {
  const memoire = `${Math.round(Math.min(16_384, Math.max(64, limites.memoireMaxMo)))}m`;
  const expiration = Date.now() + limites.dureeMaxMs + MARGE_EXPIRATION_MS;
  const options = [
    'run',
    '-i', // entrée standard attachée : c'est le seul canal d'entrée
    '--name', `comtaple-analyse-${uuid}`,
    '--label', `${ETIQUETTE}=${uuid}`,
    '--label', `${ETIQUETTE_EXPIRATION}=${expiration}`,
    '--pull', 'never', // l'image est construite localement, jamais téléchargée
    '--network', 'none', // aucune interface réseau (ni DNS, ni TCP, ni UDP)
    '--cap-drop', 'ALL', // aucune capacité
    '--security-opt', 'no-new-privileges', // ni setuid ni élévation
    // seccomp : profil par défaut du moteur (aucune option `seccomp=unconfined`) ; AppArmor par défaut du moteur aussi.
    '--user', UTILISATEUR,
    '--read-only', // système de fichiers racine en lecture seule
    '--tmpfs', `/tmp:rw,noexec,nosuid,nodev,size=${nombre(p.tmpfsMo, 1, 1024)}m,mode=1777`, // seule zone inscriptible, bornée, en mémoire
    '--pids-limit', nombre(p.pidsMax, 16, 1024), // borne les processus ET les fils d'exécution (bombe de processus)
    '--memory', memoire,
    '--memory-swap', memoire, // pas de swap : le dépassement est un arrêt, pas un ralentissement
    '--cpus', nombre(p.cpus, 0.1, 8),
    '--ulimit', 'nofile=256:256',
    '--ulimit', 'core=0',
    '--ipc', 'none',
    '--log-driver', 'none', // la sortie n'est pas conservée par le moteur : rien de la pièce ne reste sur l'hôte
    '--restart', 'no',
    '--no-healthcheck',
    '--workdir', p.essai ? '/' : RACINE_IMAGE,
    '--entrypoint', p.essai ? p.essai.entrypoint : 'node',
    p.image,
    ...(p.essai ? p.essai.commande : argumentsNode),
  ];
  return options;
}

/** Lance un client docker court ; ne rejette jamais (la sortie vide et le code non nul disent l'échec). */
function docker(p: ParametresConteneur, args: string[], delaiMs = 20_000): Promise<{ code: number; sortie: string }> {
  return new Promise((rendre) => {
    execFile(p.docker, args, { env: environnementClient(p), timeout: delaiMs, maxBuffer: 1024 * 1024 }, (erreur, sortie) => {
      const code = erreur ? (typeof (erreur as { code?: unknown }).code === 'number' ? ((erreur as { code: number }).code) : 1) : 0;
      rendre({ code, sortie: String(sortie) });
    });
  });
}

/** Conteneurs en cours de ce worker (nom → paramètres) : supprimés à l'arrêt du processus. */
const enCours = new Map<string, ParametresConteneur>();
process.once('exit', () => {
  for (const [nom, p] of enCours) {
    try {
      execFileSync(p.docker, ['rm', '-f', nom], { env: environnementClient(p), timeout: 10_000, stdio: 'ignore' });
    } catch {
      /* meilleur effort : l'expiration inscrite sur le conteneur permet de le retirer au prochain démarrage */
    }
  }
});

export interface Conteneur {
  uuid: string;
  /** Le client docker : ses flux d'entrée, de sortie et d'erreur sont ceux de l'analyseur. */
  client: ChildProcess;
  /** Supprime le conteneur sans attendre (arrêt forcé : délai, sortie excessive, annulation). */
  arreter(): void;
  /**
   * À appeler quand le client a fini : constate l'état du conteneur, le supprime, puis rend ce qu'on en a appris.
   * `absent` : aucun conteneur n'a existé (le moteur a refusé le lancement : image absente, moteur injoignable).
   */
  nettoyer(): Promise<{ absent: boolean; memoire: boolean; erreurClient: string }>;
}

export function demarrerConteneur(p: ParametresConteneur, limites: LimitesConteneur, argumentsNode: string[]): Conteneur {
  const uuid = randomUUID();
  const nom = `comtaple-analyse-${uuid}`;
  const client = spawn(p.docker, argumentsDockerRun(p, limites, uuid, argumentsNode), { env: environnementClient(p), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  enCours.set(nom, p);
  let erreurClient = '';
  client.stderr!.on('data', (m: Buffer) => {
    if (erreurClient.length < 4096) erreurClient += m.toString('utf8').slice(0, 4096 - erreurClient.length);
  });
  let suppressionDemandee: Promise<unknown> | null = null;
  /** Retire le conteneur de CETTE analyse : on retrouve son identifiant par l'étiquette ET le nom, jamais autrement. */
  const supprimer = async (): Promise<{ absent: boolean; memoire: boolean }> => {
    const trouve = await docker(p, ['ps', '-a', '-q', '--no-trunc', '--filter', `label=${ETIQUETTE}=${uuid}`, '--filter', `name=^${nom}$`]);
    const ids = trouve.sortie.split('\n').map((l) => l.trim()).filter((l) => /^[0-9a-f]{64}$/.test(l));
    if (ids.length === 0) return { absent: true, memoire: false };
    let memoire = false;
    for (const id of ids) {
      const etat = await docker(p, ['inspect', '--format', '{{.State.OOMKilled}}', id]);
      if (etat.sortie.trim() === 'true') memoire = true;
      const retrait = await docker(p, ['rm', '-f', id]);
      // Moteur bloqué sur ce conteneur (constaté avec dockerd 29.5.2 : arrêt forcé pendant que le flux d'entrée est plein, voir D-098 bis) :
      // la suppression n'aboutit pas dans le délai. Le conteneur reste « Up » côté moteur ; seul un redémarrage du moteur le libère. Alerte explicite,
      // sans contenu de pièce, pour que l'exploitant ne découvre pas le problème par le plafond de conteneurs du lanceur (429).
      if (retrait.code !== 0) console.error(`[analyse-conteneur] ALERTE : le moteur n'a pas supprimé le conteneur ${nom} (rm -f sans effet) ; moteur à vérifier, voir docs/exploitation.md § 17.`);
    }
    return { absent: false, memoire };
  };
  return {
    uuid,
    client,
    arreter() {
      client.kill('SIGKILL');
      // Tuer le client n'arrête PAS le conteneur : on le supprime explicitement (rm -f envoie SIGKILL puis retire).
      suppressionDemandee ??= supprimer();
    },
    async nettoyer() {
      try {
        const r = suppressionDemandee ? await suppressionDemandee.then(() => supprimer()) : await supprimer();
        // Si la suppression demandée à l'arrêt a déjà emporté le conteneur, `memoire` a été perdu : l'arrêt forcé a sa propre cause.
        return { ...r, erreurClient };
      } finally {
        enCours.delete(nom);
      }
    },
  };
}

/**
 * Retire les conteneurs d'analyse EXPIRÉS (étiquette `comtaple.analyse.expire` dépassée) : ceux qu'un worker tué
 * brutalement n'a pas pu supprimer. N'agit que sur les conteneurs portant nos étiquettes ET dont la date, écrite par
 * le worker au lancement, est passée : un conteneur d'un autre worker en cours de travail n'est jamais touché.
 */
export async function retirerConteneursAnalyseExpires(p: ParametresConteneur, maintenant = Date.now()): Promise<number> {
  const liste = await docker(p, ['ps', '-a', '--no-trunc', '--filter', `label=${ETIQUETTE}`, '--format', `{{.ID}} {{.Label "${ETIQUETTE}"}} {{.Label "${ETIQUETTE_EXPIRATION}"}}`]);
  let retires = 0;
  for (const ligne of liste.sortie.split('\n')) {
    const m = /^([0-9a-f]{64}) ([0-9a-f-]{36}) (\d+)$/.exec(ligne.trim());
    if (!m || Number(m[3]) > maintenant) continue;
    if ((await docker(p, ['rm', '-f', m[1]!])).code === 0) retires += 1;
  }
  return retires;
}

/** Nombre de conteneurs d'analyse existants portant l'étiquette (essais : vérifier qu'aucun ne reste). */
export async function compterConteneursAnalyse(p: ParametresConteneur): Promise<number> {
  const r = await docker(p, ['ps', '-a', '-q', '--filter', `label=${ETIQUETTE}`]);
  return r.sortie.split('\n').filter((l) => l.trim()).length;
}
