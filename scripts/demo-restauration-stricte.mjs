#!/usr/bin/env node
/**
 * Démonstration d'une restauration STRICTE sur une petite base et un stockage NEUFS, dédiés et jetables (D-145), avec des données synthétiques COHÉRENTES.
 * Rien de l'application, de sa base, de son stockage ni de ses sauvegardes n'est lu ni écrit : quatre conteneurs `comtaple-demo-*` (base d'origine, stockage d'origine,
 * base restaurée, stockage restauré), leurs volumes et un dossier temporaire, tous détruits à la fin. Aucune référence n'est exclue.
 *
 * Étapes : migrations réelles sur la base d'origine ; jeu synthétique (cabinet, N fichiers dont les objets sont RÉELLEMENT déposés avec leur SHA-256,
 * journal d'audit chaîné par la base) ; sauvegarde (pg_dump + copie des objets avec manifeste) ; restauration dans des instances séparées ; vérification STRICTE de
 * chaque référence (`scripts/objets.mjs verifier`, inchangé) ; journal d'audit intègre, identique à l'origine ; RLS forcé ; PREUVE DE LECTURE (lecture des objets par la
 * classe de stockage de l'application et des lignes en base restaurée) ; CONTRÔLE NÉGATIF : un objet retiré du stockage restauré fait échouer le même vérificateur.
 *   node scripts/demo-restauration-stricte.mjs [nombre d'objets, 24 par défaut]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const racine = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const requirePf = createRequire(join(racine, 'packages/plateforme/package.json'));
const requireDb = createRequire(join(racine, 'packages/db/package.json'));
const { S3Client, PutObjectCommand, CreateBucketCommand, DeleteObjectCommand } = requirePf('@aws-sdk/client-s3');
const pg = requireDb('pg');
const env0 = {};
for (const l of readFileSync(join(racine, '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m) env0[m[1]] = m[2];
}
const IMAGE_PG = 'pgvector/pgvector:0.8.7-pg18-trixie';
const IMAGE_S3 = 'chrislusf/seaweedfs:4.54';
const N = Number(process.argv[2] ?? 24);
const admin = env0.PG_ADMIN_USER ?? 'comtaple_admin';
const alea = (n) => randomBytes(n).toString('hex');
const mdp = { pgSrc: alea(16), pgRest: alea(16), app: alea(16), worker: alea(16) };
const s3Src = { cle: `demo${alea(6)}`, secret: alea(20), port: 55433, bucket: 'demo-origine' };
const s3Rest = { cle: `demo${alea(6)}`, secret: alea(20), port: 55435, bucket: 'demo-restaure' };
const tmp = mkdtempSync(join(tmpdir(), 'comtaple-demo-'));
const conteneurs = ['comtaple-demo-pg-src', 'comtaple-demo-s3-src', 'comtaple-demo-pg-rest', 'comtaple-demo-s3-rest'];
const volumes = ['comtaple_demo_pg_src', 'comtaple_demo_s3_src', 'comtaple_demo_pg_rest', 'comtaple_demo_s3_rest'];
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
const dire = (m) => console.log(m);
const nettoyer = () => {
  for (const c of conteneurs) spawnSync('docker', ['rm', '-f', c], { stdio: 'ignore' });
  for (const v of volumes) spawnSync('docker', ['volume', 'rm', v], { stdio: 'ignore' });
  rmSync(tmp, { recursive: true, force: true });
};
const attendre = async (fn, quoi, n = 90) => {
  for (let i = 0; i < n; i++) {
    try {
      if (await fn()) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Délai dépassé : ${quoi}`);
};
const client = (s) => new S3Client({ endpoint: `http://127.0.0.1:${s.port}`, region: 'local', forcePathStyle: true, credentials: { accessKeyId: s.cle, secretAccessKey: s.secret } });
function demarrerS3(nom, vol, s) {
  writeFileSync(join(tmp, `${nom}.json`), JSON.stringify({ identities: [{ name: 'demo', credentials: [{ accessKey: s.cle, secretKey: s.secret }], actions: ['Admin', 'Read', 'Write', 'List'] }] }));
  sh('docker', ['create', '--name', nom, '--init', '--cpus', '1', '--memory', '1g', '-p', `127.0.0.1:${s.port}:8333`, '-v', `${vol}:/data`, IMAGE_S3, 'server', '-dir=/data', '-ip.bind=0.0.0.0', '-volume.max=20', '-master.volumeSizeLimitMB=64', '-s3', '-s3.port=8333', '-s3.config=/etc/seaweedfs/s3.json']);
  sh('docker', ['cp', join(tmp, `${nom}.json`), `${nom}:/etc/seaweedfs/s3.json`]);
  sh('docker', ['start', nom]);
}
async function s3Pret(s) {
  await attendre(async () => (await fetch(`http://127.0.0.1:${s.port}`).catch(() => null)) !== null, `stockage ${s.port}`);
  await new Promise((r) => setTimeout(r, 3000));
  await client(s).send(new CreateBucketCommand({ Bucket: s.bucket })).catch((e) => { if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(String(e.name))) throw e; });
}
function demarrerPg(nom, vol, motDePasse, port) {
  sh('docker', ['create', '--name', nom, '--init', '--cpus', '1.5', '--memory', '1g', ...(port ? ['-p', `127.0.0.1:${port}:5432`] : []), '-e', `POSTGRES_USER=${admin}`, '-e', `POSTGRES_PASSWORD=${motDePasse}`, '-e', 'POSTGRES_DB=comtaple', '-v', `${vol}:/var/lib/postgresql`, IMAGE_PG]);
  sh('docker', ['start', nom]);
}
const pgPret = (nom) => attendre(() => { sh('docker', ['exec', nom, 'psql', '-U', admin, '-d', 'comtaple', '-Atc', 'select 1']); return true; }, `PostgreSQL ${nom}`);
const psql = (nom, sql) => sh('docker', ['exec', '-i', nom, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', admin, '-At', '-d', 'comtaple', '-c', sql]).trim();
const verdicts = [];
const verdict = (ok, texte) => {
  verdicts.push(ok);
  dire(`${ok ? 'OK    ' : 'ÉCHEC '} ${texte}`);
};

try {
  nettoyer();
  mkdirSync(tmp, { recursive: true });
  dire(`Démonstration de restauration stricte : ${N} objets synthétiques, instances dédiées et jetables.`);
  // ── Origine : base migrée + stockage ──
  demarrerPg('comtaple-demo-pg-src', 'comtaple_demo_pg_src', mdp.pgSrc, 55432);
  demarrerS3('comtaple-demo-s3-src', 'comtaple_demo_s3_src', s3Src);
  await pgPret('comtaple-demo-pg-src');
  const envSrc = { ...process.env, ...env0, PG_HOST: '127.0.0.1', PG_PORT: '55432', PG_DATABASE: 'comtaple', PG_ADMIN_USER: admin, PG_ADMIN_PASSWORD: mdp.pgSrc, PG_APP_PASSWORD: mdp.app, PG_WORKER_PASSWORD: mdp.worker };
  const { migrer } = await import(pathToFileURL(join(racine, 'packages/db/dist/migrer.js')).href);
  await migrer(envSrc);
  const nbMig = Number(psql('comtaple-demo-pg-src', 'select count(*) from migrations_drizzle'));
  verdict(nbMig > 60, `migrations réelles appliquées sur la base d'origine neuve : ${nbMig}`);
  await s3Pret(s3Src);
  // ── Jeu synthétique cohérent ──
  const c = new pg.Client({ connectionString: `postgres://${admin}:${mdp.pgSrc}@127.0.0.1:55432/comtaple` });
  await c.connect();
  const cab = (await c.query(`insert into cabinets (nom) values ('Cabinet de démonstration de restauration (fictif)') returning id`)).rows[0].id;
  const origine = client(s3Src);
  for (let i = 0; i < N; i++) {
    const contenu = Buffer.concat([Buffer.from(`pièce synthétique n° ${i}\n`), randomBytes(2048 + i * 137)]);
    const cle = `demo/${cab}/${String(i).padStart(3, '0')}-piece.bin`;
    await origine.send(new PutObjectCommand({ Bucket: s3Src.bucket, Key: cle, Body: contenu }));
    await c.query('insert into fichiers (cabinet_id, sha256, taille, cle_stockage) values ($1, $2, $3, $4)', [cab, createHash('sha256').update(contenu).digest('hex'), contenu.length, cle]);
  }
  for (let i = 0; i < 8; i++) await c.query(`insert into journal_audit (cabinet_id, acteur_type, action, details) values ($1, 'systeme', 'demo.restauration', $2)`, [cab, JSON.stringify({ rang: i })]);
  const ruptureOrigine = (await c.query('select journal_audit_verifier($1) as r', [cab])).rows[0].r;
  verdict(ruptureOrigine === null, `jeu synthétique : ${N} fichiers déposés avec leur empreinte réelle, journal d'audit de 8 lignes, chaîne intègre à l'origine`);
  await c.end();
  // ── Sauvegarde ──
  const dump = join(tmp, 'demo.dump');
  const dumpOctets = spawnSync('docker', ['exec', 'comtaple-demo-pg-src', 'pg_dump', '-U', admin, '-d', 'comtaple', '-Fc'], { maxBuffer: 1 << 30 });
  if (dumpOctets.status !== 0) throw new Error(`pg_dump : ${dumpOctets.stderr}`);
  writeFileSync(dump, dumpOctets.stdout);
  const manifeste = join(tmp, 'demo.objets.json');
  const envObjets = { ...process.env, S3_ENDPOINT: `http://127.0.0.1:${s3Src.port}`, S3_ACCESS_KEY: s3Src.cle, S3_SECRET_KEY: s3Src.secret, S3_BUCKET: s3Src.bucket, S3_REGION: 'local', SAUVEGARDE_DEPOT_OBJETS: join(tmp, 'depot') };
  dire(sh('node', [join(racine, 'scripts/objets.mjs'), 'sauvegarder', manifeste], { env: envObjets }).trim());
  // ── Restauration dans des instances séparées ──
  demarrerPg('comtaple-demo-pg-rest', 'comtaple_demo_pg_rest', mdp.pgRest, null);
  demarrerS3('comtaple-demo-s3-rest', 'comtaple_demo_s3_rest', s3Rest);
  await pgPret('comtaple-demo-pg-rest');
  psql('comtaple-demo-pg-rest', 'CREATE ROLE comtaple_app NOLOGIN; CREATE ROLE comtaple_worker NOLOGIN; CREATE EXTENSION IF NOT EXISTS vector');
  sh('docker', ['exec', '-i', 'comtaple-demo-pg-rest', 'pg_restore', '-U', admin, '-d', 'comtaple', '--no-owner', '--exit-on-error'], { input: readFileSync(dump), maxBuffer: 1 << 28 });
  await s3Pret(s3Rest);
  const envRest = { ...envObjets, ESSAI_S3_ENDPOINT: `http://127.0.0.1:${s3Rest.port}`, ESSAI_S3_ACCESS_KEY: s3Rest.cle, ESSAI_S3_SECRET_KEY: s3Rest.secret, ESSAI_S3_BUCKET: s3Rest.bucket };
  dire(sh('node', [join(racine, 'scripts/objets.mjs'), 'restaurer', manifeste], { env: envRest }).trim());
  // ── Vérification STRICTE : toutes les références de la base restaurée, sans exclusion ──
  const refs = join(tmp, 'references.txt');
  writeFileSync(refs, psql('comtaple-demo-pg-rest', 'select cle_stockage, sha256 from fichiers').split('\n').map((l) => l.replace('|', ' ')).join('\n') + '\n');
  const nbRef = Number(psql('comtaple-demo-pg-rest', 'select count(*) from fichiers'));
  const v = spawnSync('node', [join(racine, 'scripts/objets.mjs'), 'verifier', refs, manifeste], { env: envRest, encoding: 'utf8' });
  dire(v.stdout.trim());
  verdict(v.status === 0 && nbRef === N, `vérification stricte (scripts/objets.mjs, inchangé, aucune exclusion) : ${nbRef} références, code de sortie ${v.status}`);
  // ── Journal, volumes, RLS ──
  const ruptRest = psql('comtaple-demo-pg-rest', `select coalesce(journal_audit_verifier('${cab}')::text, 'intègre')`);
  const nbJournal = Number(psql('comtaple-demo-pg-rest', 'select count(*) from journal_audit'));
  verdict(ruptRest === 'intègre' && nbJournal === 8, `journal d'audit restauré : ${nbJournal} lignes, chaîne ${ruptRest} (vérification stricte)`);
  const sansRls = Number(psql('comtaple-demo-pg-rest', `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'cabinet_id' and not a.attisdropped) and not (c.relrowsecurity and c.relforcerowsecurity)`));
  verdict(sansRls === 0, `RLS activé et forcé sur toutes les tables portant cabinet_id (${sansRls} sans RLS)`);
  // ── Preuve de lecture : par la classe de stockage de l'application, avec les empreintes de la base restaurée ──
  const { Stockage } = await import(pathToFileURL(join(racine, 'packages/plateforme/dist/index.js')).href);
  const stockageRest = new Stockage({ S3_ENDPOINT: envRest.ESSAI_S3_ENDPOINT, S3_REGION: 'local', S3_BUCKET: s3Rest.bucket, S3_ACCESS_KEY: s3Rest.cle, S3_SECRET_KEY: s3Rest.secret });
  const lignes = psql('comtaple-demo-pg-rest', 'select cle_stockage, sha256, taille from fichiers order by cle_stockage').split('\n').map((l) => l.split('|'));
  let lus = 0;
  for (const [cle, sha, taille] of lignes) {
    const octets = await stockageRest.lire(cle, 1 << 26);
    if (createHash('sha256').update(octets).digest('hex') === sha && octets.length === Number(taille)) lus++;
  }
  verdict(lus === N, `preuve de lecture : ${lus}/${N} objets relus par la classe de stockage de l'application dans le stockage restauré, empreinte et taille conformes à la base restaurée`);
  // ── Contrôle négatif : le même vérificateur doit échouer si un objet manque ──
  await client(s3Rest).send(new DeleteObjectCommand({ Bucket: s3Rest.bucket, Key: lignes[0][0] }));
  const neg = spawnSync('node', [join(racine, 'scripts/objets.mjs'), 'verifier', refs, manifeste], { env: envRest, encoding: 'utf8' });
  dire(neg.stdout.trim());
  verdict(neg.status !== 0 && /ABSENTS du stockage restauré : 1/.test(neg.stdout), `contrôle négatif : un objet retiré du stockage restauré fait échouer le vérificateur (code ${neg.status})`);
} catch (e) {
  verdicts.push(false);
  dire(`ÉCHEC : ${e.message}`);
} finally {
  nettoyer();
  dire('Instances, volumes et dossier temporaire de démonstration détruits (aucune donnée de l\'application touchée).');
}
const ok = verdicts.length > 0 && verdicts.every(Boolean);
dire(ok ? 'DÉMONSTRATION RÉUSSIE : restauration stricte, aucune référence exclue.' : 'DÉMONSTRATION EN ÉCHEC.');
process.exit(ok ? 0 : 1);
