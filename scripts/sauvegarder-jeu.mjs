#!/usr/bin/env node
/**
 * Sauvegarde LOCALE sous forme de JEU cohérent : base, export Keycloak et objets du stockage, décrits par un fichier
 * « <identifiant>.jeu.json » écrit en dernier (un jeu sans descripteur est une sauvegarde interrompue).
 *
 * Cohérence visée entre la base et Keycloak — sans prétendre à une capture atomique :
 *   1. Keycloak est FIGÉ (le conteneur est suspendu, pas arrêté) ;
 *   2. pendant ce gel, un instantané de la base est pris et gardé ouvert, et les fichiers de la base embarquée de
 *      Keycloak sont copiés ;
 *   3. Keycloak est repris (quelques dixièmes de seconde de gel) ;
 *   4. la base est exportée DEPUIS CET INSTANTANÉ, puis l'export Keycloak est produit à partir de la copie.
 * La base et Keycloak sont donc capturés au même instant du point de vue de Keycloak. Les objets du stockage sont
 * copiés ensuite : ils contiennent tout ce que la base référence (les originaux ne sont jamais réécrits ni supprimés),
 * et peuvent contenir des objets plus récents que la base.
 *
 * Rien n'est supprimé : les sauvegardes existantes restent en place. Usage : node scripts/sauvegarder-jeu.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const l of readFileSync(join(racine, '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const { default: pg } = await import('../packages/db/node_modules/pg/lib/index.js');
const { urlBd } = await import('../packages/db/dist/index.js');
const { FORMAT_JEU, sha256Fichier, verifierJeu } = await import('../packages/plateforme/dist/jeu-sauvegarde.js');

const SOURCE_KC = 'comtaple-keycloak-1';
const TEMPORAIRE = 'comtaple-sauvegarde-kc-export';
const ROYAUME = 'comtaple';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const horodatage = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const identifiant = `comtaple-${horodatage}`;
const dossier = join(racine, 'var', 'sauvegardes');
mkdirSync(dossier, { recursive: true });
const chemin = (suffixe) => join(dossier, `${identifiant}.${suffixe}`);
// Témoin d'une sauvegarde en cours : s'il reste sans descripteur, le jeu est interrompu.
writeFileSync(chemin('en-cours'), `${new Date().toISOString()}\n`);

// Si le processus est interrompu pendant le gel, Keycloak est repris avant de sortir.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { try { docker('unpause', SOURCE_KC); } catch { /* pas figé */ } process.exit(130); });
// Un gel resté d'une exécution tuée brutalement est levé avant toute chose.
if (docker('inspect', '-f', '{{.State.Status}}', SOURCE_KC) === 'paused') docker('unpause', SOURCE_KC);
if (docker('inspect', '-f', '{{.State.Status}}', SOURCE_KC) !== 'running') throw new Error('Keycloak local n’est pas en marche : le jeu ne peut pas être capturé');
try { docker('rm', '-f', TEMPORAIRE); } catch { /* absent */ }
docker('create', '--name', TEMPORAIRE, docker('inspect', '-f', '{{.Config.Image}}', SOURCE_KC), 'export', '--dir', '/opt/keycloak/data/export', '--realm', ROYAUME, '--users', 'realm_file');

const client = new pg.Client({ connectionString: urlBd('admin') });
await client.connect();
let gelDe;
let gelA;
let instantane;
let comptes;
try {
  gelDe = new Date();
  docker('pause', SOURCE_KC);
  try {
    // Instantané de la base pris PENDANT le gel de Keycloak, et gardé ouvert jusqu'à la fin de l'export de la base.
    await client.query('begin isolation level repeatable read read only');
    instantane = (await client.query('select pg_export_snapshot() as id, now() as instant')).rows[0];
    // Copie de conteneur à conteneur de la base embarquée de Keycloak (cohérence d'un arrêt brutal).
    execFileSync('sh', ['-c', `docker cp "${SOURCE_KC}:/opt/keycloak/data/h2" - | docker cp - ${TEMPORAIRE}:/opt/keycloak/data/`], { stdio: 'ignore' });
  } finally {
    docker('unpause', SOURCE_KC);
    gelA = new Date();
  }
  comptes = (await client.query('select sujet_oidc from utilisateurs')).rows.map((l) => l.sujet_oidc);

  // Export de la base depuis l'instantané pris pendant le gel.
  const sortie = createWriteStream(chemin('dump'), { mode: 0o600 });
  const dump = spawn('docker', ['compose', 'exec', '-T', 'postgres', 'pg_dump', '-U', process.env.PG_ADMIN_USER, '-d', 'comtaple', '-Fc', '--no-owner', `--snapshot=${instantane.id}`], { cwd: racine, stdio: ['ignore', 'pipe', 'inherit'] });
  // Les deux fins sont attendues ENSEMBLE : attendre l'une après l'autre peut manquer celle qui arrive la première.
  const finEcriture = once(sortie, 'finish');
  const finDump = once(dump, 'close');
  dump.stdout.pipe(sortie);
  const [[code]] = await Promise.all([finDump, finEcriture]);
  if (code !== 0) throw new Error(`pg_dump a échoué (code ${code})`);
} finally {
  await client.query('rollback').catch(() => undefined);
  await client.end();
}

// Export Keycloak à partir de la copie, dans un conteneur temporaire (le Keycloak local n'est plus sollicité).
try {
  execFileSync('docker', ['start', '-a', TEMPORAIRE], { stdio: 'ignore' });
  execFileSync('docker', ['cp', `${TEMPORAIRE}:/opt/keycloak/data/export/${ROYAUME}-realm.json`, chemin('keycloak.json')], { stdio: 'ignore' });
} finally {
  try { docker('rm', '-f', TEMPORAIRE); } catch { /* déjà retiré */ }
}
execFileSync('chmod', ['600', chemin('keycloak.json')]);

// Objets du stockage : copiés APRÈS la base.
execFileSync('node', [join(racine, 'scripts', 'objets.mjs'), 'sauvegarder', chemin('objets.json')], { stdio: 'inherit' });

const exportKc = JSON.parse(readFileSync(chemin('keycloak.json'), 'utf8'));
const idsKeycloak = new Set((exportKc.users ?? []).map((u) => u.id));
const fichiers = [];
for (const [role, suffixe] of [['base', 'dump'], ['objets', 'objets.json'], ['keycloak', 'keycloak.json']]) {
  const sha256 = await sha256Fichier(chemin(suffixe));
  // Même forme que les sauvegardes précédentes : chemin relatif à la racine du dépôt.
  writeFileSync(`${chemin(suffixe)}.sha256`, `${sha256}  var/sauvegardes/${identifiant}.${suffixe}\n`);
  fichiers.push({ role, nom: `${identifiant}.${suffixe}`, taille: statSync(chemin(suffixe)).size, sha256 });
}
const jeu = {
  format: FORMAT_JEU,
  identifiant,
  cree: new Date().toISOString(),
  fichiers,
  coherence: {
    instantaneBase: new Date(instantane.instant).toISOString(),
    keycloakFigeDe: gelDe.toISOString(),
    keycloakFigeA: gelA.toISOString(),
    comptesBase: comptes.length,
    comptesBaseDansKeycloak: comptes.filter((id) => idsKeycloak.has(id)).length,
    garanties: [
      'L’instantané de la base a été pris pendant que Keycloak était figé : aucun compte n’a pu être créé, modifié ou supprimé dans Keycloak entre les deux captures.',
      'La base est exportée depuis un instantané unique : elle est cohérente avec elle-même.',
      'Les objets sont copiés après la base : tout objet référencé par la base figure dans le jeu.',
    ],
    limites: [
      'Ce n’est pas une capture atomique de l’ensemble : la base et Keycloak sont alignés à l’instant du gel, les objets sont postérieurs.',
      'La base embarquée de Keycloak est copiée telle qu’elle est sur disque, avec la cohérence d’un arrêt brutal : une écriture de Keycloak encore en mémoire au moment du gel peut manquer.',
      'Les comptes de la base sans compte Keycloak (créés hors de Keycloak, par exemple les accès de support d’essai) sont comptés, pas corrigés.',
      'Le jeu peut contenir des objets plus récents que la base, donc non référencés par elle.',
    ],
  },
};
// Descripteur écrit en dernier, par renommage : sa présence signifie que le jeu est complet.
writeFileSync(chemin('jeu.json.partiel'), `${JSON.stringify(jeu, null, 2)}\n`);
renameSync(chemin('jeu.json.partiel'), chemin('jeu.json'));
rmSync(chemin('en-cours'), { force: true });
const v = await verifierJeu(chemin('jeu.json'));
if (!v.conforme) throw new Error(`Jeu non conforme juste après sa création : ${v.ecarts.join(' ; ')}`);
console.log(`Jeu ${identifiant} : Keycloak figé ${gelA - gelDe} ms ; instantané de la base pris pendant le gel ; ${jeu.coherence.comptesBaseDansKeycloak} compte(s) de la base sur ${jeu.coherence.comptesBase} présents dans l'export Keycloak.`);
console.log(`var/sauvegardes/${identifiant}.dump`);
