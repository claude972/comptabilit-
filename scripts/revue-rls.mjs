#!/usr/bin/env node
/**
 * REVUE DES CHANGEMENTS RLS (P4, D-102) : compare les politiques de sécurité par ligne et les tables sensibles d'une base à une
 * référence versionnée (docs/rls-reference.json), et contrôle les invariants. LECTURE SEULE (session `read_only`).
 *
 *   node scripts/revue-rls.mjs                      compare la base configurée (.env) à docs/rls-reference.json
 *   node scripts/revue-rls.mjs --ecrire-reference   (re)écrit la référence APRÈS relecture humaine d'un changement voulu
 *   node scripts/revue-rls.mjs --base=<nom>         vise une autre base du même serveur (ex. une base jetable)
 *   node scripts/revue-rls.mjs --json
 *
 * Invariants (écart = MANQUANT, code de sortie 1) : (1) toute table portant `cabinet_id` a RLS activée ET forcée ; (2) chacune a une politique PERMISSIVE « isolation_cabinet » ALL
 * `(cabinet_id = app_cabinet_id())`, et AUCUNE autre politique permissive (qui élargirait l'accès par OU) ; (3) aucune politique restrictive
 * à condition littéralement vraie ; (4) les rôles applicatifs n'ont ni BYPASSRLS ni superutilisateur et ne possèdent aucune table ;
 * (5) aucune fonction SECURITY DEFINER n'est exécutable par PUBLIC (hors fonctions de déclencheur, non appelables) ; (6) pas d'écart avec la référence (ajout, retrait ou
 * modification d'une politique, d'une table sans `cabinet_id` accessible aux rôles applicatifs, d'une fonction à droits du
 * propriétaire) : un écart est un CHANGEMENT À RELIRE, pas forcément une faute.
 *
 * CE QUE CE N'EST PAS : une revue automatisée ne remplace pas un audit de sécurité INDÉPENDANT (R3, R16 : toujours à faire). Elle dit
 * que la structure n'a pas changé sans trace et que des invariants simples tiennent ; elle ne dit pas que les conditions des
 * politiques sont JUSTES. La justesse de l'isolation est éprouvée par les tests d'intégration (isolation.itest.ts, matrice des droits) ;
 * leur rejeu est `scripts/essai-isolation-rejouee.sh`.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (n) => args.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3);
const REFERENCE = join(racine, 'docs', 'rls-reference.json');
const pg = createRequire(join(racine, 'packages/db/package.json'))('pg');
const { urlBd } = await import('../packages/db/dist/index.js');
const { chargerEnvLocal } = await import('../packages/db/dist/env.js');
chargerEnvLocal();
const env = { ...process.env, ...(option('base') ? { PG_DATABASE: option('base') } : {}) };
const h = (t) => createHash('sha256').update(String(t)).digest('hex').slice(0, 12);

const c = new pg.Client({ connectionString: urlBd('admin', env) });
await c.connect();
await c.query('SET default_transaction_read_only = on');
const q = async (sql) => (await c.query(sql)).rows;

const tables = await q(`select c.relname nom, c.relrowsecurity rls, c.relforcerowsecurity force_rls,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'cabinet_id' and not a.attisdropped) a_cabinet,
    (select r.rolname from pg_roles r where r.oid = c.relowner) proprietaire,
    (has_table_privilege('comtaple_app', c.oid, 'select,insert,update,delete') or has_table_privilege('comtaple_worker', c.oid, 'select,insert,update,delete')) acces_app
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`);
const politiques = await q(`select tablename t, policyname p, permissive perm, cmd, roles::text r, coalesce(qual,'') q, coalesce(with_check,'') w from pg_policies where schemaname = 'public' order by 1, 2`);
const definer = await q(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' sig, md5(pg_get_functiondef(p.oid)) corps,
    has_function_privilege('public', p.oid, 'execute') public_exec, (p.prorettype = 'trigger'::regtype) est_declencheur, (select rolname from pg_roles where oid = p.proowner) proprietaire
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and p.prokind = 'f' order by 1`);
const fonctionsContexte = await q(`select p.proname nom, pg_get_functiondef(p.oid) corps from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'app\\_%' and p.prokind = 'f'`);
const roles = await q(`select rolname, rolsuper, rolbypassrls, (select count(*)::int from pg_tables where tableowner = rolname) possede from pg_roles where rolname in ('comtaple_app','comtaple_worker') order by 1`);
const migrations = Number((await q('select count(*) n from public.migrations_drizzle'))[0].n);
await c.end();

const parTable = new Map();
for (const p of politiques) {
  const l = parTable.get(p.t) ?? {};
  l[p.p] = h(`${p.perm}|${p.cmd}|${p.r}|${p.q}|${p.w}`);
  parTable.set(p.t, l);
}
const etat = {
  migrations,
  tablesACabinet: Object.fromEntries(tables.filter((t) => t.a_cabinet).map((t) => [t.nom, { rls: t.rls, force: t.force_rls, politiques: parTable.get(t.nom) ?? {} }])),
  tablesSansCabinetAccessibles: Object.fromEntries(tables.filter((t) => !t.a_cabinet && t.acces_app).map((t) => [t.nom, { rls: t.rls, force: t.force_rls, politiques: parTable.get(t.nom) ?? {} }])),
  fonctionsADroitsDuProprietaire: Object.fromEntries(definer.map((d) => [d.sig, d.corps.slice(0, 12)])),
};

const manquants = [];
const infos = [];
const ecart = (m) => manquants.push(m);
// Invariants
for (const [nom, t] of Object.entries(etat.tablesACabinet)) {
  if (!(t.rls && t.force)) ecart(`${nom} : RLS ${t.rls ? '' : 'non activée'}${t.rls && !t.force ? 'non forcée' : ''}`);
  if (Object.keys(t.politiques).length === 0) ecart(`${nom} : aucune politique`);
}
// Modèle de sécurité (D-012, D-095) : sur chaque table à cabinet_id, UNE politique PERMISSIVE « isolation_cabinet » (ALL) borne les
// lignes au cabinet du contexte ; les autres politiques sont RESTRICTIVES (elles ne font que RÉDUIRE : dossier, gestionnaire, auteur).
// Une seconde politique PERMISSIVE s'ajouterait par OU et ÉLARGIRAIT l'accès : elle est refusée ici. Une politique restrictive dont la
// condition est littéralement vraie ne restreint rien : refusée aussi.
const ISOLATION = /^\(cabinet_id = app_cabinet_id\(\)\)$/;
// EXCEPTION DOCUMENTÉE : `appartenances` (migration 0001). Une personne doit pouvoir lire ses PROPRES appartenances dans tous ses cabinets
// (résolution du cabinet courant avant tout contexte) ; l'écriture reste bornée au cabinet du contexte ET au gestionnaire. Vérifiée à
// l'identique, politique par politique : tout autre libellé est un écart.
const EXCEPTIONS = {
  appartenances: {
    lecture_appartenances: (p) => p.cmd === 'SELECT' && p.q === '((utilisateur_id = app_utilisateur_id()) OR (cabinet_id = app_cabinet_id()))',
    ecriture_appartenances_i: (p) => p.cmd === 'INSERT' && p.w === '((cabinet_id = app_cabinet_id()) AND app_est_gestionnaire())',
    ecriture_appartenances_u: (p) => p.cmd === 'UPDATE' && p.q === '((cabinet_id = app_cabinet_id()) AND app_est_gestionnaire())' && p.w === p.q,
  },
};
for (const t of Object.keys(etat.tablesACabinet)) {
  const pt = politiques.filter((p) => p.t === t);
  if (EXCEPTIONS[t]) {
    const attendues = EXCEPTIONS[t];
    for (const p of pt) if (!attendues[p.p]?.(p)) ecart(`${t}.${p.p} : politique non prévue par l'exception documentée`);
    for (const nom of Object.keys(attendues)) if (!pt.some((p) => p.p === nom)) ecart(`${t}.${nom} : politique de l'exception documentée absente`);
    continue;
  }
  const permissives = pt.filter((p) => p.perm === 'PERMISSIVE');
  const iso = permissives.find((p) => p.p === 'isolation_cabinet');
  if (!iso) ecart(`${t} : pas de politique PERMISSIVE « isolation_cabinet »`);
  else if (iso.cmd !== 'ALL' || !ISOLATION.test(iso.q.trim()) || !ISOLATION.test(iso.w.trim())) ecart(`${t}.isolation_cabinet : condition ou commande inattendue`);
  if (permissives.length > 1) ecart(`${t} : politique(s) PERMISSIVE supplémentaire(s) qui élargirait(ent) l'accès : ${permissives.filter((p) => p !== iso).map((p) => p.p).join(', ')}`);
  for (const p of pt.filter((x) => x.perm === 'RESTRICTIVE')) if (/^\(?true\)?$/i.test(p.q.trim()) || /^\(?true\)?$/i.test(p.w.trim())) ecart(`${t}.${p.p} : politique restrictive littéralement vraie`);
}
for (const r of roles) {
  if (r.rolsuper || r.rolbypassrls) ecart(`rôle ${r.rolname} : superutilisateur ou BYPASSRLS`);
  if (r.possede > 0) ecart(`rôle ${r.rolname} : possède ${r.possede} table(s)`);
}
if (roles.length < 2) ecart(`rôles applicatifs trouvés : ${roles.length} sur 2`);
const declencheursPublics = definer.filter((d) => d.public_exec && d.est_declencheur).map((d) => d.sig);
for (const d of definer) if (d.public_exec && !d.est_declencheur) ecart(`fonction à droits du propriétaire exécutable par PUBLIC : ${d.sig}`);
const sansRlsAccessibles = Object.entries(etat.tablesSansCabinetAccessibles).filter(([, t]) => !(t.rls && t.force));
infos.push(`${Object.keys(etat.tablesACabinet).length} table(s) à cabinet_id, ${politiques.filter((p) => etat.tablesACabinet[p.t]).length} politique(s) sur celles-ci`);
infos.push(`${sansRlsAccessibles.length} table(s) SANS cabinet_id accessibles aux rôles applicatifs et sans RLS forcée (référentiels, tables liées par une autre clé : à justifier une à une dans la revue humaine) : ${sansRlsAccessibles.map(([n]) => n).join(', ') || 'aucune'}`);
infos.push(`${definer.length} fonction(s) SECURITY DEFINER (R16) ; aucune exécutable par PUBLIC hors fonctions de déclencheur${declencheursPublics.length ? ` (${declencheursPublics.join(', ')} : une fonction de déclencheur ne peut pas être appelée directement)` : ''}`);
infos.push(`Exception documentée : ${Object.keys(EXCEPTIONS).join(', ')} (lecture de ses propres appartenances dans tous ses cabinets ; écriture bornée au cabinet et au gestionnaire)`);
infos.push(`${politiques.filter((p) => etat.tablesACabinet[p.t] && p.perm === 'RESTRICTIVE').length} politique(s) restrictives (dossier, gestionnaire, auteur) en plus de l'isolation par cabinet`);

// Comparaison à la référence
const differences = [];
if (args.includes('--ecrire-reference')) {
  writeFileSync(REFERENCE, `${JSON.stringify({ format: 'comtaple.rls-reference/1', note: 'Référence de la revue des changements RLS (scripts/revue-rls.mjs). Réécrite SEULEMENT après relecture humaine d\'un changement voulu. Ce n\'est pas un audit indépendant.', ...etat }, null, 2)}\n`);
  infos.push(`Référence ÉCRITE : ${REFERENCE} (${migrations} migrations)`);
} else if (!existsSync(REFERENCE)) {
  ecart('docs/rls-reference.json absent : aucune base de comparaison (node scripts/revue-rls.mjs --ecrire-reference après relecture)');
} else {
  const ref = JSON.parse(readFileSync(REFERENCE, 'utf8'));
  const comparer = (nom, a, b, formater = (x) => x) => {
    for (const k of Object.keys(b)) if (!(k in a)) differences.push(`${nom} RETIRÉ(E) : ${k}`);
    for (const k of Object.keys(a)) if (!(k in b)) differences.push(`${nom} AJOUTÉ(E) : ${k}`);
    for (const k of Object.keys(a)) if (k in b && JSON.stringify(formater(a[k])) !== JSON.stringify(formater(b[k]))) differences.push(`${nom} MODIFIÉ(E) : ${k}`);
  };
  comparer('table à cabinet_id', etat.tablesACabinet, ref.tablesACabinet);
  comparer('table sans cabinet_id accessible', etat.tablesSansCabinetAccessibles, ref.tablesSansCabinetAccessibles);
  comparer('fonction à droits du propriétaire', etat.fonctionsADroitsDuProprietaire, ref.fonctionsADroitsDuProprietaire);
  if (ref.migrations !== migrations) differences.push(`nombre de migrations : référence ${ref.migrations}, base ${migrations}`);
}

if (args.includes('--json')) console.log(JSON.stringify({ migrations, manquants, differences, infos }, null, 2));
else {
  console.log(`Revue des changements RLS — base ${env.PG_DATABASE ?? 'comtaple'} — ${migrations} migration(s) — LECTURE SEULE`);
  console.log('Revue AUTOMATISÉE de structure : ce n\'est PAS un audit indépendant (R3, R16).');
  console.log('\n== Invariants ==');
  console.log(manquants.length ? manquants.map((m) => `[MANQUANT] ${m}`).join('\n') : '[PRÊT] tous les invariants tiennent');
  console.log('\n== Écarts avec docs/rls-reference.json ==');
  console.log(differences.length ? differences.map((m) => `[À RELIRE] ${m}`).join('\n') + '\n→ relire le changement ; s\'il est voulu : node scripts/revue-rls.mjs --ecrire-reference et commiter la référence avec le changement.' : '[PRÊT] aucun écart avec la référence');
  console.log('\n== Constats ==');
  for (const i of infos) console.log(`- ${i}`);
}
process.exit(manquants.length || differences.length ? 1 : 0);
