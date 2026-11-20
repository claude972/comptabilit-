#!/usr/bin/env node
/**
 * COMPARAISON des politiques de dossier ANCIENNE (ligne à ligne) et NOUVELLE (ensembliste, migration 0047, D-095) sur le
 * portefeuille de mesure du cabinet Bêta (fictif) : pour 6 profils, mêmes lignes visibles (nombre ET empreinte MD5 des
 * identifiants) sur 10 tables, mêmes écritures acceptées, et durées de lecture sous chaque politique.
 *
 *   node scripts/comparer-rls-portefeuille.mjs [--repetitions 5] [--sortie fichier.json]
 *
 * GARANTIES : tout se passe dans UNE transaction d'administration TOUJOURS annulée (ROLLBACK) : les utilisateurs et
 * habilitations de comparaison sont fictifs et disparaissent ; le retour arrière de la migration
 * (securite_restaurer_rls_ligne_a_ligne) et sa réapplication n'existent que dans cette transaction ; aucune donnée existante n'est
 * modifiée, le journal d'audit n'est pas touché. À lancer quand l'API est au repos : la transaction retient des verrous exclusifs
 * sur les tables concernées pendant sa durée (de l'ordre de la minute). Aucun secret n'est écrit.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const pg = (await import('../packages/db/node_modules/pg/lib/index.js')).default;
const { urlBd } = await import('../packages/db/dist/index.js');

const args = process.argv.slice(2);
const option = (nom, defaut) => (args.includes(`--${nom}`) ? args[args.indexOf(`--${nom}`) + 1] : defaut);
const REPETITIONS = Number(option('repetitions', '5'));
const SORTIE = option('sortie', fileURLToPath(new URL(`../var/mesures/rls-comparaison-${Date.now().toString(36)}.json`, import.meta.url)));

const CAB_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const CAB_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const BRUNO = '22222222-2222-4222-8222-222222222201';
const uid = (n) => `0047c0c0-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SYNTH = { aucun: uid(1), mixte: uid(2), expire: uid(3), deposant: uid(4), autre: uid(5) };
const TABLES = ['lignes_ecriture', 'lots_import', 'constats', 'pages_document', 'documents', 'exercices', 'mouvements_bancaires', 'resultats_controles', 'rapprochements', 'entites'];

const c = new pg.Client({ connectionString: urlBd('admin') });
await c.connect();
const rang = (t, p) => t[Math.min(t.length - 1, Math.max(0, Math.ceil((p / 100) * t.length) - 1))];
const profils = [
  { nom: 'Bruno (administrateur, validation sur tous les dossiers)', cab: CAB_B, u: BRUNO },
  { nom: 'sans aucune habilitation', cab: CAB_B, u: SYNTH.aucun },
  { nom: 'mixte (niveaux depot/lecture/collaboration/revision/validation en alternance)', cab: CAB_B, u: SYNTH.mixte },
  { nom: 'appartenance expirée (validation sur tous, sans effet)', cab: CAB_B, u: SYNTH.expire },
  { nom: 'déposant (depot sur le tiers des dossiers)', cab: CAB_B, u: SYNTH.deposant },
  { nom: 'membre du cabinet Alpha qui usurpe le contexte du cabinet Bêta', cab: CAB_B, u: SYNTH.autre },
];

async function observer(p) {
  await c.query('set local role comtaple_app');
  await c.query(`select set_config('app.cabinet_id', $1::text, true), set_config('app.utilisateur_id', $2::text, true), set_config('app.sujet', $2::text, true)`, [p.cab, p.u]);
  const sortie = { tables: {}, ecritures: [], dureesMs: {} };
  try {
    for (const t of TABLES) {
      let r;
      try {
        r = await c.query(`select count(*)::bigint n, coalesce(md5(string_agg(id::text, ',' order by id)), '') h from ${t}`);
      } catch (e) {
        throw new Error(`table ${t} : ${e.message}`);
      }
      sortie.tables[t] = `${r.rows[0].n}:${r.rows[0].h}`;
    }
    // Écritures : un exercice dans un dossier sur sept (tout cabinet confondu dans l'ordre des identifiants) ; acceptée ou refusée.
    await c.query('reset role');
    const ech = (await c.query(`select id, cabinet_id from entites where cabinet_id = $1 order by id`, [CAB_B])).rows.filter((_, i) => i % 7 === 0);
    await c.query('set local role comtaple_app');
    for (const e of ech) {
      await c.query('savepoint w');
      let ok = 'refusée';
      try {
        await c.query(`insert into exercices (cabinet_id, entite_id, debut, fin) values ($1, $2, '2031-01-01', '2031-12-31')`, [e.cabinet_id, e.id]);
        ok = 'acceptée';
      } catch { /* refusée */ }
      await c.query('rollback to savepoint w');
      sortie.ecritures.push(`${e.id}:${ok}`);
    }
    // Durées (ms) : comptage des lignes d'écriture et lecture d'un seul dossier.
    const un = (await c.query(`select id from entites where cabinet_id = $1 and raison_sociale like 'Mesure %' order by id limit 1`, [CAB_B])).rows[0]?.id;
    const mesure = async (nom, texte, params = []) => {
      const d = [];
      for (let i = 0; i < REPETITIONS; i++) {
        const t0 = performance.now();
        await c.query(texte, params);
        d.push(performance.now() - t0);
      }
      d.sort((a, b) => a - b);
      sortie.dureesMs[nom] = { p50: Math.round(rang(d, 50) * 10) / 10, p95: Math.round(rang(d, 95) * 10) / 10 };
    };
    await mesure('comptage de lignes_ecriture (tout le portefeuille)', 'select count(*) from lignes_ecriture');
    await mesure('recherche plein texte « facture » (écritures, tout le portefeuille)',
      `select l.entite_id, count(*) from lignes_ecriture l join lots_import i on i.id = l.lot_import_id and i.actif
       where to_tsvector('french', l.ecriture_lib || ' ' || l.piece_ref || ' ' || l.compte_lib || ' ' || coalesce(l.comp_aux_lib, '')) @@ websearch_to_tsquery('french', 'facture') group by 1`);
    // Lecture d'un lot par l'index du lot (le chemin de l'application) ; puis lecture par le seul dossier, SANS index sur entite_id (balayage de la table : pire cas).
    const lot = un ? (await c.query('select id from lots_import where entite_id = $1 and actif order by id limit 1', [un])).rows[0]?.id : null;
    if (lot) await mesure('lecture bornée d’un lot par son index (50 lignes)', 'select * from lignes_ecriture where lot_import_id = $1 order by id limit 50', [lot]);
    if (un) await mesure('lecture d’un dossier sans index sur entite_id (balayage de la table, pire cas)', 'select * from lignes_ecriture where entite_id = $1 order by id limit 50', [un]);
    if (un) await mesure('lecture d’une seule ligne par clé', 'select * from lots_import where entite_id = $1 limit 1', [un]);
  } catch (e) {
    console.error(`ERREUR (${p.nom}) : ${e.message}`);
    throw e;
  }
  await c.query('reset role');
  return sortie;
}

const resultat = { version: 1, debut: new Date().toISOString(), repetitions: REPETITIONS, profils: [] };
await c.query('begin');
try {
  // Utilisateurs de comparaison (fictifs, annulés en fin de transaction).
  for (const [nom, id] of Object.entries(SYNTH)) await c.query(`insert into utilisateurs (id, sujet_oidc, email, nom) values ($1::uuid, $1::text, $2, $3)`, [id, `${nom}@comparaison-0047.test`, `Comparaison ${nom}`]);
  const ap = (cab, u, role, extra) => c.query(`insert into appartenances (cabinet_id, utilisateur_id, role, actif, expire_le) values ($1, $2, $3, ${extra})`, [cab, u, role]);
  await ap(CAB_B, SYNTH.aucun, 'collaborateur', 'true, null');
  await ap(CAB_B, SYNTH.mixte, 'reviseur', 'true, null');
  await ap(CAB_B, SYNTH.expire, 'reviseur', `true, now() - interval '1 day'`);
  await ap(CAB_B, SYNTH.deposant, 'client_deposant', 'true, null');
  await ap(CAB_A, SYNTH.autre, 'reviseur', 'true, null');
  const niveaux = ['depot', 'lecture', 'collaboration', 'revision', 'validation'];
  const ents = (await c.query(`select id, row_number() over (order by id)::int rn from entites where cabinet_id = $1`, [CAB_B])).rows;
  const hab = (u, e, n, cab = CAB_B) => c.query(`insert into habilitations_dossier (cabinet_id, entite_id, utilisateur_id, niveau) values ($1, $2, $3, $4)`, [cab, e, u, n]);
  for (const e of ents) {
    await hab(SYNTH.mixte, e.id, niveaux[e.rn % 5]);
    await hab(SYNTH.expire, e.id, 'validation');
    if (e.rn % 3 === 0) await hab(SYNTH.deposant, e.id, 'depot');
    await hab(SYNTH.autre, e.id, 'validation'); // habilitation « orpheline » : le membre n'appartient pas à Bêta
  }
  resultat.dossiersCabinet = ents.length;
  const mesurer = async () => {
    const r = [];
    for (const p of profils) r.push({ profil: p.nom, ...(await observer(p)) });
    return r;
  };
  const apres = await mesurer();
  const restaurees = (await c.query(`select securite_restaurer_rls_ligne_a_ligne() n`)).rows[0].n;
  const avant = await mesurer();
  const reecrites = (await c.query(`select securite_reecrire_acces_dossier('ensembliste') n`)).rows[0].n;
  resultat.politiquesRestaurees = restaurees;
  resultat.politiquesReecrites = reecrites;
  let identique = true;
  for (let i = 0; i < profils.length; i++) {
    const a = avant[i], n = apres[i];
    const tablesEgales = JSON.stringify(a.tables) === JSON.stringify(n.tables);
    const ecrituresEgales = JSON.stringify(a.ecritures) === JSON.stringify(n.ecritures);
    identique &&= tablesEgales && ecrituresEgales;
    resultat.profils.push({
      profil: a.profil,
      lignesVisibles: Object.fromEntries(Object.entries(n.tables).map(([t, v]) => [t, Number(v.split(':')[0])])),
      memesLignesVisibles: tablesEgales,
      memesEcritures: ecrituresEgales,
      ecrituresAcceptees: n.ecritures.filter((x) => x.endsWith('acceptée')).length,
      ecrituresTestees: n.ecritures.length,
      dureesAvantMs: a.dureesMs,
      dureesApresMs: n.dureesMs,
    });
  }
  resultat.identique = identique;
} finally {
  await c.query('rollback');
  await c.end();
}
mkdirSync(new URL('../var/mesures/', import.meta.url), { recursive: true });
writeFileSync(SORTIE, JSON.stringify(resultat, null, 2));
console.log(JSON.stringify(resultat, null, 2));
console.log(`\nRésultat identique pour les ${profils.length} profils : ${resultat.identique ? 'OUI' : 'NON'} (sortie : ${SORTIE})`);
process.exit(resultat.identique ? 0 : 1);
