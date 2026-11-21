#!/usr/bin/env node
/**
 * ESSAI DE MISE À JOUR ET DE RETOUR ARRIÈRE de la base, sur RESSOURCE JETABLE (P4, D-102). Ne touche ni la base, ni le stockage, ni
 * Keycloak, ni les sauvegardes de l'application : un PostgreSQL d'essai (conteneur `comtaple-essai-maj-pg`, port 127.0.0.1:55433,
 * mot de passe aléatoire, détruit à la fin, même en cas d'échec) reçoit :
 *   1. la « version précédente » : les migrations moins les K dernières (K = 3 par défaut, qui comprend la migration de sécurité
 *      0047 des politiques RLS) ; des données sentinelles ;
 *   2. une sauvegarde `pg_dump` de cet état (la sauvegarde d'avant mise à jour) ;
 *   3. la MISE À JOUR : toutes les migrations, par le même code que la commande de migration livrée (`packages/db/dist/migrer.js`) ;
 *      contrôles : nombre de migrations, rejeu sans effet, sentinelles intactes, schéma purement ADDITIF (aucune table ni colonne
 *      retirée, aucun type changé : règle « ajouter avant de retirer », exploitation.md § 10), RLS forcée partout ;
 *   4. le RETOUR ARRIÈRE : restauration de la sauvegarde d'avant mise à jour dans une base neuve ; contrôles : même nombre de
 *      migrations qu'avant, schéma IDENTIQUE à l'empreinte d'avant, sentinelles intactes ; puis nouvelle mise à jour sur cette base
 *      restaurée (le retour n'interdit pas de réessayer).
 * Chaque phase est chronométrée. Sortie : tableau lisible ; code 0 si tout est conforme, 1 sinon.
 *
 * LIMITES : la version précédente du CODE (image) n'est pas démarrée ici : seule la base est éprouvée ; la compatibilité de
 * l'ancien code avec le schéma neuf repose sur le contrôle additif, pas sur une exécution. Base locale non managée, volumétrie
 * minime : les durées ne se transposent pas à la production.
 *
 *   node scripts/essai-mise-a-jour.mjs [--dernieres=3]
 */
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, createWriteStream, createReadStream, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const sh = promisify(execFile);
const K = Number((process.argv.find((a) => a.startsWith('--dernieres=')) ?? '--dernieres=3').split('=')[1]);
const NOM = 'comtaple-essai-maj-pg';
const PORT = 55433;
const IMAGE = 'pgvector/pgvector:0.8.7-pg18-trixie';
const MDP = randomBytes(16).toString('hex');
const pg = createRequire(join(racine, 'packages/db/package.json'))('pg');
const { migrer } = await import('../packages/db/dist/migrer.js');
const tmp = mkdtempSync(join(tmpdir(), 'essai-maj-'));
const ok = [];
const duree = [];
const verifier = (nom, condition, detail = '') => {
  ok.push(Boolean(condition));
  console.log(`[${condition ? 'CONFORME' : 'ÉCHEC   '}] ${nom}${detail ? ` — ${detail}` : ''}`);
};
const chrono = async (nom, fn) => {
  const d = Date.now();
  const r = await fn();
  duree.push([nom, (Date.now() - d) / 1000]);
  return r;
};
const envPour = (base) => ({ PG_HOST: '127.0.0.1', PG_PORT: String(PORT), PG_DATABASE: base, PG_ADMIN_USER: 'essai_admin', PG_ADMIN_PASSWORD: MDP, PG_APP_PASSWORD: randomBytes(16).toString('hex'), PG_WORKER_PASSWORD: randomBytes(16).toString('hex') });
const requete = async (base, sql) => {
  const c = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'essai_admin', password: MDP, database: base });
  await c.connect();
  try { return (await c.query(sql)).rows; } finally { await c.end(); }
};
const nettoyer = async () => {
  await sh('docker', ['rm', '-f', '-v', NOM]).catch(() => {});
  rmSync(tmp, { recursive: true, force: true });
};
process.on('SIGINT', async () => { await nettoyer(); process.exit(130); });

// Empreinte du SCHÉMA : tables, colonnes (type, nullabilité), politiques, fonctions (corps), RLS, index.
async function empreinte(base) {
  const lots = {
    colonnes: "select table_name, column_name, data_type, is_nullable, coalesce(column_default,'') d from information_schema.columns where table_schema='public' and table_name not in ('essai_sentinelle') order by 1,2",
    politiques: "select tablename, policyname, cmd, coalesce(qual,'') q, coalesce(with_check,'') w from pg_policies where schemaname='public' order by 1,2",
    fonctions: "select p.proname, pg_get_function_identity_arguments(p.oid) a, md5(pg_get_functiondef(p.oid)) m from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') order by 1,2",
    rls: "select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname not in ('essai_sentinelle') order by 1",
    index: "select indexname, md5(indexdef) from pg_indexes where schemaname='public' and tablename not in ('essai_sentinelle') order by 1",
  };
  const r = {};
  for (const [k, sql] of Object.entries(lots)) r[k] = await requete(base, sql);
  return r;
}
const hache = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);
const nbMigrations = async (base) => Number((await requete(base, 'select count(*) n from public.migrations_drizzle'))[0].n);
const sentinelles = async (base) => (await requete(base, "select count(*) n, md5(string_agg(v, ',' order by id)) h from essai_sentinelle"))[0];

let code = 1;
try {
  console.log(`Essai de mise à jour et de retour arrière — ${new Date().toISOString().slice(0, 19)}Z — ressource jetable ${NOM} (127.0.0.1:${PORT})`);
  const existants = (await sh('docker', ['ps', '-a', '--format', '{{.Names}}'])).stdout.split('\n');
  if (existants.includes(NOM)) throw new Error(`${NOM} existe déjà : essai précédent à examiner, rien n'a été fait.`);

  // Jeu de migrations de la « version précédente ».
  const dossier = join(racine, 'packages/db/migrations');
  const journal = JSON.parse(readFileSync(join(dossier, 'meta/_journal.json'), 'utf8'));
  const total = journal.entries.length;
  const precedent = join(tmp, 'migrations-precedentes');
  cpSync(dossier, precedent, { recursive: true });
  const retirees = journal.entries.slice(total - K);
  for (const e of retirees) rmSync(join(precedent, `${e.tag}.sql`));
  writeFileSync(join(precedent, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.slice(0, total - K) }, null, 2));
  console.log(`Migrations : ${total} au total ; version précédente = ${total - K} ; mise à jour = ${retirees.map((e) => e.tag.split('_')[0]).join(', ')}`);

  // Réseau d'essai dédié (le pont par défaut de la VM peut manquer : voir essai-restauration.sh).
  await sh('docker', ['network', 'inspect', 'comtaple_essai_reseau']).catch(() => sh('docker', ['network', 'create', 'comtaple_essai_reseau']));
  await sh('docker', ['run', '-d', '--network', 'comtaple_essai_reseau', '--name', NOM, '--init', '--memory', '1g', '-p', `127.0.0.1:${PORT}:5432`, '-e', 'POSTGRES_USER=essai_admin', '-e', `POSTGRES_PASSWORD=${MDP}`, '-e', 'POSTGRES_DB=comtaple', IMAGE]);
  for (let i = 0; ; i++) {
    try { await requete('comtaple', 'select 1'); break; } catch { if (i > 60) throw new Error('PostgreSQL d\'essai ne démarre pas'); await new Promise((r) => setTimeout(r, 1000)); }
  }

  // 1. Version précédente
  const env1 = envPour('comtaple');
  await chrono('Installation de la version précédente (migrations)', () => migrer(env1, precedent));
  verifier('Version précédente installée', (await nbMigrations('comtaple')) === total - K, `${total - K} migration(s)`);
  await requete('comtaple', "create table essai_sentinelle(id int primary key, v text); insert into essai_sentinelle select g, 'valeur-' || g from generate_series(1, 5000) g");
  const avant = await empreinte('comtaple');
  const sentAvant = await sentinelles('comtaple');
  verifier('Données sentinelles posées', sentAvant.n === '5000' || Number(sentAvant.n) === 5000, '5 000 lignes');

  // 2. Sauvegarde d'avant mise à jour
  const dump = join(tmp, 'avant-maj.dump');
  await chrono('Sauvegarde d\'avant mise à jour (pg_dump -Fc)', () => new Promise((res, rej) => {
    const p = spawn('docker', ['exec', NOM, 'pg_dump', '-U', 'essai_admin', '-d', 'comtaple', '-Fc'], { stdio: ['ignore', 'pipe', 'inherit'] });
    p.stdout.pipe(createWriteStream(dump)).on('finish', res);
    p.on('exit', (c) => c !== 0 && rej(new Error(`pg_dump a échoué (${c})`)));
  }));
  console.log(`Sauvegarde : ${(statSync(dump).size / 2 ** 20).toFixed(1)} Mio`);

  // 3. Mise à jour
  await chrono('Mise à jour (migrations restantes)', () => migrer(env1));
  verifier('Mise à jour appliquée', (await nbMigrations('comtaple')) === total, `${total} migration(s)`);
  await chrono('Rejeu de la migration (sans effet attendu)', () => migrer(env1));
  verifier('Rejeu sans effet', (await nbMigrations('comtaple')) === total);
  const apres = await empreinte('comtaple');
  const s1 = await sentinelles('comtaple');
  verifier('Données sentinelles intactes après mise à jour', s1.n === sentAvant.n && s1.h === sentAvant.h);
  // Schéma additif : toute colonne d'avant existe encore, même type ; toute table d'avant existe encore ; fonctions : mêmes signatures.
  const cle = (r) => `${r.table_name}.${r.column_name}`;
  const colApres = new Map(apres.colonnes.map((r) => [cle(r), r]));
  const retirees2 = avant.colonnes.filter((r) => !colApres.has(cle(r))).map(cle);
  const typesChanges = avant.colonnes.filter((r) => colApres.has(cle(r)) && colApres.get(cle(r)).data_type !== r.data_type).map(cle);
  const ajoutees = apres.colonnes.length - avant.colonnes.length;
  verifier('Schéma additif : aucune colonne ni table retirée', retirees2.length === 0, retirees2.length ? retirees2.join(', ') : `${ajoutees} colonne(s) ajoutée(s)`);
  verifier('Schéma additif : aucun type de colonne changé', typesChanges.length === 0, typesChanges.join(', '));
  const sigApres = new Set(apres.fonctions.map((f) => `${f.proname}(${f.a})`));
  const fonctionsRetirees = avant.fonctions.filter((f) => !sigApres.has(`${f.proname}(${f.a})`)).map((f) => f.proname);
  verifier('Aucune fonction retirée', fonctionsRetirees.length === 0, fonctionsRetirees.join(', '));
  const polAvant = new Map(avant.politiques.map((p) => [`${p.tablename}.${p.policyname}`, hache(p)]));
  const polApres = new Map(apres.politiques.map((p) => [`${p.tablename}.${p.policyname}`, hache(p)]));
  const polModifiees = [...polAvant].filter(([k, h]) => polApres.get(k) !== h).length;
  console.log(`Information : politiques RLS avant ${polAvant.size}, après ${polApres.size} ; modifiées ou retirées par la mise à jour : ${polModifiees} ; fonctions modifiées : ${apres.fonctions.filter((f) => avant.fonctions.find((g) => g.proname === f.proname && g.a === f.a)?.m !== f.m).length}`);
  const sansRls = apres.rls.filter((r) => !(r.relrowsecurity && r.relforcerowsecurity) && apres.colonnes.some((c) => c.table_name === r.relname && c.column_name === 'cabinet_id'));
  verifier('RLS forcée sur toutes les tables à cabinet_id après mise à jour', sansRls.length === 0, sansRls.map((r) => r.relname).join(', '));

  // 4. Retour arrière : restauration de la sauvegarde d'avant mise à jour dans une base neuve
  await requete('postgres', 'create database comtaple_retour');
  await requete('comtaple_retour', 'create extension if not exists vector');
  await chrono('Retour arrière : restauration de la sauvegarde d\'avant mise à jour', () => new Promise((res, rej) => {
    const p = spawn('docker', ['exec', '-i', NOM, 'pg_restore', '-U', 'essai_admin', '-d', 'comtaple_retour', '--no-owner', '--exit-on-error'], { stdio: ['pipe', 'inherit', 'inherit'] });
    createReadStream(dump).pipe(p.stdin);
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`pg_restore a échoué (${c})`))));
  }));
  verifier('Retour arrière : même nombre de migrations qu’avant la mise à jour', (await nbMigrations('comtaple_retour')) === total - K, `${total - K}`);
  const retour = await empreinte('comtaple_retour');
  verifier('Retour arrière : schéma identique à celui d’avant la mise à jour', hache(retour) === hache(avant), `empreinte ${hache(retour)}`);
  const s2 = await sentinelles('comtaple_retour');
  verifier('Retour arrière : données sentinelles intactes', s2.n === sentAvant.n && s2.h === sentAvant.h);
  // Le schéma restauré n'est plus celui de la mise à jour : preuve par différence d'empreinte.
  verifier('Le retour a bien défait la mise à jour (empreinte différente de celle d’après)', hache(retour) !== hache(apres));
  await chrono('Nouvelle mise à jour sur la base restaurée', () => migrer(envPour('comtaple_retour')));
  verifier('Nouvelle mise à jour possible après retour', (await nbMigrations('comtaple_retour')) === total && hache(await empreinte('comtaple_retour')) === hache(apres));

  console.log('\n== Durées mesurées (secondes) ==');
  for (const [n, s] of duree) console.log(`${s.toFixed(1).padStart(7)} s  ${n}`);
  code = ok.every(Boolean) ? 0 : 1;
  console.log(`\nRésultat : ${ok.filter(Boolean).length} contrôle(s) conforme(s) sur ${ok.length} — ${code === 0 ? 'ESSAI RÉUSSI' : 'ÉCHEC'}. Ressource jetable détruite.`);
} catch (e) {
  console.error(`ÉCHEC DE L'ESSAI : ${String(e.message).split(MDP).join('***')}`);
} finally {
  await nettoyer();
}
process.exit(code);
