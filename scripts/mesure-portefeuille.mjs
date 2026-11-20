#!/usr/bin/env node
/**
 * MESURE (environnement local) d'un GROS PORTEFEUILLE : 300 dossiers du cabinet de démonstration Bêta (fictif), par l'API
 * réelle, le worker réel et la base locale. Reproductible ; EN SIMULATION PAR DÉFAUT (D-094).
 *
 *   node scripts/mesure-portefeuille.mjs                       # SIMULATION : inventaire en lecture seule et plan ; rien n'est créé ni mesuré
 *   node scripts/mesure-portefeuille.mjs --executer            # crée les dossiers manquants (préfixe unique) et mesure
 *   node scripts/mesure-portefeuille.mjs --executer --etapes lecture,recherche   # seulement certaines étapes
 *   node scripts/mesure-portefeuille.mjs --nettoyer            # SIMULE le retrait des données de CE script (transaction annulée), avec les décomptes
 *   node scripts/mesure-portefeuille.mjs --nettoyer --executer # retire VRAIMENT les seules données portant le préfixe « Mesure portefeuille »
 *
 * Options : --dossiers 300 (taille visée) ; --repetitions 15 (mesures répétées par route) ; --tas-api 1024 (Mo, tas de
 * l'API dédiée de l'étape « ecrans » ; l'image de production fixe 2 048 Mo dans une limite de conteneur de 1 Go) ;
 *  * --sortie fichier.json (défaut var/mesures/portefeuille-<horodatage>.json).
 *
 * Étapes (défaut : toutes sauf « restitution-cabinet » et « reprise-apercu ») : inventaire, creer, lecture, recherche, assistant, ecrans, flux, restitution,
 * reprise (aperçus de 5 000 lignes PUIS validation dans un dossier préfixé), reprise-apercu (les aperçus seuls : aucune écriture), restitution-cabinet
 * (l'archive du cabinet ENTIER : plusieurs centaines de Mo ajoutés au stockage).
 *
 * GARANTIES : ne supprime JAMAIS de donnée existante. Les 200 dossiers « Mesure <marque> n° NNN (fictif) » de la campagne
 * du 2026-11-19 sont réutilisés TELS QUELS (lecture seule : aucune pièce ni aucun constat ajouté). Les dossiers manquants
 * sont créés sous le préfixe unique « Mesure portefeuille » (marque horodatée) avec pièces, écritures et constats. Le seul
 * retrait possible est celui de ces dossiers-là, par --nettoyer --executer ; il ne touche ni au journal d'audit (ajout
 * seul), ni aux objets du stockage, ni aux dossiers de la campagne. Le dossier « Mesure restitution … » (264 957 lignes)
 * sert aux mesures de gros volume : il n'est ni modifié ni retiré (l'étape « flux » y ajoute une exécution de contrôles).
 * Aucun secret n'est écrit : les jetons restent en mémoire. Données SYNTHÉTIQUES. Les chiffres décrivent CE poste, CETTE
 * base et CE moment : ils ne sont pas une garantie de production.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { cpus, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';

for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const pg = (await import('../packages/db/node_modules/pg/lib/index.js')).default;
const { urlBd } = await import('../packages/db/dist/index.js');
const { genererFecSynthetique, genererTexteFactureSynthetique } = await import('../packages/core/dist/index.js');

const args = process.argv.slice(2);
const option = (nom, defaut) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 ? args[i + 1] : defaut;
};
const drapeau = (nom) => args.includes(`--${nom}`);
const EXECUTER = drapeau('executer');
const NETTOYER = drapeau('nettoyer');
const CIBLE = Number(option('dossiers', '300'));
const REPETITIONS = Number(option('repetitions', '15'));
const TAS_API = Number(option('tas-api', '1024'));
const ETAPES = new Set((option('etapes', 'inventaire,creer,lecture,recherche,assistant,ecrans,flux,restitution,reprise')).split(','));
const API = process.env.API_URL;
const CABINET_NOM = 'Cabinet Bêta Conseil (fictif)';
const PREFIXE = 'Mesure portefeuille';
const marque = Date.now().toString(36);
const NOM_NOUVEAU = `${PREFIXE} ${marque}`;
const MOTIF_CAMPAGNE = String.raw`^Mesure [a-z0-9]+ n° [0-9]{3} \(fictif\)$`;
const MOTIF_CREES = String.raw`^Mesure portefeuille [a-z0-9]+ n° [0-9]{3} \(fictif\)$`;
const MOTIF_TOUS = String.raw`^Mesure ([a-z0-9]+|portefeuille [a-z0-9]+) n° [0-9]{3} \(fictif\)$`;
const FEC_ECRITURES = 600;
const ANOMALIES = ['caisse_crediteur', 'client_crediteur', 'doublon', 'attente_non_solde'];
const Mo = (o) => Math.round(o / 1024 / 1024);
const rapport = { version: 1, simulation: !EXECUTER, marque, debut: new Date().toISOString(), etapes: {}, limites: [] };
const dire = (...t) => console.log(...t);

// ───────────────────────────── Outils ─────────────────────────────
async function jeton() {
  const r = await fetch(`${process.env.OIDC_ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'comtaple-tests', username: 'bruno.admin@cabinet-b.test', password: process.env.DEV_MDP_UTILISATEURS, scope: 'openid' }),
  });
  return (await r.json()).access_token;
}
let acces = null;
let obtenuLe = 0;
async function entete() {
  if (!acces || Date.now() - obtenuLe > 120_000) {
    acces = await jeton();
    obtenuLe = Date.now();
  }
  return { authorization: `Bearer ${acces}` };
}
/** Un appel complet (corps lu en entier) ; renvoie statut, octets reçus, JSON éventuel et durée en ms. */
async function appel(methode, chemin, corps, base = API) {
  const binaire = Buffer.isBuffer(corps);
  const t0 = performance.now();
  const r = await fetch(`${base}${chemin}`, {
    method: methode,
    headers: { ...(await entete()), ...(corps !== undefined ? { 'content-type': binaire ? 'application/octet-stream' : 'application/json' } : {}) },
    body: corps === undefined ? undefined : binaire ? new Uint8Array(corps) : JSON.stringify(corps),
  });
  const tampon = Buffer.from(await r.arrayBuffer());
  const ms = performance.now() - t0;
  let json = null;
  try { json = JSON.parse(tampon.toString('utf8')); } catch { /* binaire ou vide */ }
  return { statut: r.status, octets: tampon.length, json, ms };
}
async function api(methode, chemin, corps) {
  const r = await appel(methode, chemin, corps);
  if (r.statut >= 400) throw new Error(`${methode} ${chemin} → ${r.statut} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}
const rang = (tries, p) => tries[Math.min(tries.length - 1, Math.max(0, Math.ceil((p / 100) * tries.length) - 1))];
const arrondi = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
/** Répète `n` fois une mesure ; durées en ms (p50, p95 par rang le plus proche), taille maximale de réponse, statuts vus. */
async function repeter(nom, n, fn, { pause = 0 } = {}) {
  const durees = [];
  const statuts = {};
  let octetsMax = 0;
  for (let i = 0; i < n; i++) {
    const r = await fn(i);
    durees.push(r.ms);
    statuts[r.statut] = (statuts[r.statut] ?? 0) + 1;
    octetsMax = Math.max(octetsMax, r.octets ?? 0);
    if (pause) await new Promise((ok) => setTimeout(ok, pause));
  }
  const tries = [...durees].sort((a, b) => a - b);
  const s = { n, p50Ms: arrondi(rang(tries, 50)), p95Ms: arrondi(rang(tries, 95)), minMs: arrondi(tries[0]), maxMs: arrondi(tries.at(-1)), octetsReponseMax: octetsMax, statuts };
  dire(`  ${nom} : ${n} appels, p50 ${s.p50Ms} ms, p95 ${s.p95Ms} ms, max ${s.maxMs} ms, réponse max ${(octetsMax / 1024).toFixed(1)} Kio, statuts ${JSON.stringify(statuts)}`);
  return s;
}
const rssMo = (pid) => {
  try { return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) / 1024; } catch { return 0; }
};
/** Exécute `fn` en relevant la mémoire résidente du processus `pid` toutes les 100 ms ; renvoie aussi le résultat de `fn`. */
async function avecMemoire(pid, fn) {
  const depart = rssMo(pid);
  let pic = depart;
  const releve = setInterval(() => { pic = Math.max(pic, rssMo(pid)); }, 100);
  try {
    const resultat = await fn();
    return { resultat, rssDepartMo: Math.round(depart), rssPicMo: Math.round(Math.max(pic, rssMo(pid))) };
  } finally {
    clearInterval(releve);
  }
}
const pidFichier = (nom) => Number(readFileSync(new URL(`../var/${nom}.pid`, import.meta.url), 'utf8').trim());
const admin = new pg.Client({ connectionString: urlBd('admin') });
await admin.connect();
const q = async (sql, params = []) => (await admin.query(sql, params)).rows;

/** PDF minimal à couche texte (Helvetica) : suffit à la lecture PDF réelle du worker. */
function pdfTexte(lignes, sel = '') {
  const enc = (t) => Buffer.from([...t].map((ch) => (ch === '€' ? 0x80 : ch === ' ' || ch === ' ' ? 0x20 : ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 0x3f))).toString('latin1').replace(/[\\()]/g, (m) => `\\${m}`);
  const flux = `BT /F1 10 Tf 50 800 Td 14 TL\n${lignes.map((l) => `(${enc(l)}) Tj T*`).join('\n')}\nET`;
  const objets = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${Buffer.byteLength(flux, 'latin1')} >>\nstream\n${flux}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  let corps = `%PDF-1.4\n%${sel}\n`;
  const decalages = [];
  objets.forEach((o, i) => { decalages.push(Buffer.byteLength(corps, 'latin1')); corps += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(corps, 'latin1');
  corps += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${decalages.map((d) => `${String(d).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corps, 'latin1');
}
async function deposer(entiteId, contenu, extra, nomFichier) {
  const o = await api('POST', '/v1/televersements', { entiteId, nomFichier, taille: contenu.length, sha256: createHash('sha256').update(contenu).digest('hex'), canal: 'ordinateur', ...extra });
  for (let p = o.octetsRecus ?? 0; p < contenu.length; p += o.tailleMorceau) await api('PUT', `/v1/televersements/${o.id}/morceaux?decalage=${p}`, contenu.subarray(p, p + o.tailleMorceau));
  return api('POST', `/v1/televersements/${o.id}/terminer`);
}
const attendreSql = async (nom, pret, delaiMs = 600_000) => {
  const fin = Date.now() + delaiMs;
  for (;;) {
    const v = await pret();
    if (v) return v;
    if (Date.now() > fin) throw new Error(`Délai dépassé en attendant : ${nom}`);
    await new Promise((ok) => setTimeout(ok, 1000));
  }
};

// ───────────────────────────── Nettoyage (données de ce script seulement) ─────────────────────────────
/**
 * Retire les dossiers dont le nom commence par « Mesure portefeuille » ET leurs données, dans UNE transaction. Les
 * dépendances sont découvertes dans le catalogue de PostgreSQL (clés étrangères) : on supprime d'abord les lignes qui
 * référencent, puis les lignes référencées. En simulation, la transaction est ANNULÉE (rien n'est retiré) et les décomptes
 * sont affichés. Le journal d'audit (ajout seul) et le stockage objet ne sont pas touchés.
 */
async function nettoyer() {
  const cabinet = (await q('select id from cabinets where nom = $1', [CABINET_NOM]))[0];
  if (!cabinet) throw new Error(`Cabinet « ${CABINET_NOM} » introuvable.`);
  const entites = (await q(`select id, raison_sociale from entites where cabinet_id = $1 and raison_sociale like $2 escape '\\'`, [cabinet.id, `${PREFIXE.replace(/[%_\\]/g, '\\$&')} %`])).map((e) => e.id);
  dire(`${entites.length} dossier(s) portant le préfixe « ${PREFIXE} » (cabinet ${CABINET_NOM}).`);
  if (entites.length === 0) return { dossiers: 0, tables: {}, simulation: !EXECUTER };
  const fk = await q(`
    select c.conrelid::regclass::text as enfant, a.attname as colonne_enfant, c.confrelid::regclass::text as parent, pa.attname as colonne_parent
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
     where c.contype = 'f' and array_length(c.conkey, 1) = 1 and c.connamespace = 'public'::regnamespace`);
  const parParent = new Map();
  for (const f of fk) parParent.set(f.parent, [...(parParent.get(f.parent) ?? []), f]);
  const retirees = {};
  const vus = new Set();
  /** Retire les lignes de `table` qui satisfont `condition` (SQL sur la table), après celles qui les référencent. */
  async function retirer(table, condition, params, profondeur = 0) {
    const cle = `${table}|${condition}`;
    if (vus.has(cle) || profondeur > 12) return;
    vus.add(cle);
    for (const f of parParent.get(table) ?? []) {
      if (f.enfant === table) continue; // auto-référence (ex. version remplacée) : traitée avec la table
      await retirer(f.enfant, `${f.colonne_enfant} in (select ${f.colonne_parent} from ${table} where ${condition})`, params, profondeur + 1);
    }
    // Auto-références : on les met à null avant de retirer.
    for (const f of (parParent.get(table) ?? []).filter((x) => x.enfant === table)) await admin.query(`update ${table} set ${f.colonne_enfant} = null where ${condition}`, params);
    const r = await admin.query(`delete from ${table} where ${condition}`, params);
    if (r.rowCount) retirees[table] = (retirees[table] ?? 0) + r.rowCount;
  }
  await admin.query('begin');
  try {
    await retirer('entites', 'id = any($1::uuid[])', [entites]);
    // Les tables sans clé étrangère vers `entites` mais rattachées au dossier par une colonne `entite_id` sont couvertes par les clés ci-dessus ;
    // ce qui reste référencé échouerait ici (violation de clé) et annulerait tout.
    if (EXECUTER) {
      await admin.query('commit');
      dire('Retrait VALIDÉ.');
    } else {
      await admin.query('rollback');
      dire('SIMULATION : transaction annulée, rien n\'a été retiré.');
    }
  } catch (e) {
    await admin.query('rollback');
    throw new Error(`Retrait impossible (transaction annulée, rien n'a été retiré) : ${e.message}`);
  }
  for (const [t, n] of Object.entries(retirees).sort((a, b) => b[1] - a[1])) dire(`  ${EXECUTER ? 'retiré' : 'à retirer'} : ${n} ligne(s) de ${t}`);
  dire('Le journal d\'audit (ajout seul) et les objets du stockage ne sont pas touchés.');
  return { dossiers: entites.length, tables: retirees, simulation: !EXECUTER };
}

// ───────────────────────────── Programme ─────────────────────────────
dire(`Mesure d'un portefeuille — ${EXECUTER ? 'EXÉCUTION' : 'SIMULATION (rien n\'est créé ni mesuré ; --executer pour exécuter)'}`);
if (NETTOYER) {
  rapport.nettoyage = await nettoyer();
  await admin.end();
  process.exit(0);
}

// 1. Inventaire (lecture seule)
const cabinet = (await q('select id from cabinets where nom = $1', [CABINET_NOM]))[0];
if (!cabinet) throw new Error(`Cabinet « ${CABINET_NOM} » introuvable.`);
const campagne = await q(`select id, raison_sociale from entites where cabinet_id = $1 and raison_sociale ~ $2 order by raison_sociale`, [cabinet.id, MOTIF_CAMPAGNE]);
let crees = await q(`select id, raison_sociale from entites where cabinet_id = $1 and raison_sociale ~ $2 order by raison_sociale`, [cabinet.id, MOTIF_CREES]);
const gros = (await q(`select e.id as entite, e.cabinet_id as cabinet, x.id as exercice, l.id as lot, l.progression as lignes from entites e join exercices x on x.entite_id = e.id join lots_import l on l.exercice_id = x.id and l.actif and l.type = 'fec' where e.cabinet_id = $1 and e.raison_sociale like 'Mesure restitution %' order by l.progression desc limit 1`, [cabinet.id]))[0] ?? null;
const total = campagne.length + crees.length;
const manquants = Math.max(0, CIBLE - total);
const [sys] = await q(`select version() as v, pg_size_pretty(pg_database_size(current_database())) as taille, (select count(*) from entites) as entites_base, (select count(*) from lignes_ecriture) as lignes_base`);
rapport.environnement = {
  machine: `${cpus()[0]?.model ?? 'inconnue'}, ${cpus().length} cœurs, ${Mo(totalmem())} Mo de mémoire`,
  systeme: `${process.platform} ${process.arch}`,
  node: process.version,
  postgresql: sys.v.split(' ').slice(0, 2).join(' '),
  tailleBase: sys.taille,
  lignesEcritureDansLaBase: Number(sys.lignes_base),
  entitesDansLaBase: Number(sys.entites_base),
};
rapport.etapes.inventaire = {
  cabinet: CABINET_NOM,
  dossiersCampagne: campagne.length,
  dossiersDeCeScript: crees.length,
  cible: CIBLE,
  aCreer: manquants,
  grosDossier: gros ? { lignes: gros.lignes } : null,
};
dire(`Environnement : ${rapport.environnement.machine} ; Node ${process.version} ; ${rapport.environnement.postgresql} ; base ${sys.taille}.`);
dire(`Inventaire : ${campagne.length} dossier(s) de la campagne (réutilisés tels quels), ${crees.length} dossier(s) déjà créés par ce script, cible ${CIBLE} → ${manquants} à créer (préfixe « ${NOM_NOUVEAU} »).`);
dire(`Gros dossier pour les écrans de calcul : ${gros ? `${gros.lignes} lignes d'écriture` : 'ABSENT (étapes « ecrans » et « flux » non mesurables)'}.`);
if (!EXECUTER) {
  dire(`Plan : ${manquants} dossier(s) × (1 exercice, un FEC de ${FEC_ECRITURES} écritures avec anomalies injectées ${JSON.stringify(ANOMALIES)}, 2 pièces PDF) ; puis étapes ${[...ETAPES].filter((e) => e !== 'inventaire').join(', ')}.`);
  dire('Simulation terminée : aucune donnée créée, aucune mesure faite. Relancer avec --executer.');
  await admin.end();
  process.exit(0);
}

const moi = await api('GET', '/v1/moi');
dire(`Connecté : ${moi.utilisateur.nom} (${moi.cabinet.nom}).`);

// 2. Création des dossiers manquants : écritures, constats (contrôles du worker) et pièces
if (ETAPES.has('creer') && manquants > 0) {
  dire(`\n== Création de ${manquants} dossier(s) ==`);
  const t0 = performance.now();
  const nouveaux = [];
  const debutIndice = crees.length;
  for (let i = 0; i < manquants; i++) {
    const e = await api('POST', '/v1/dossiers', { raisonSociale: `${NOM_NOUVEAU} n° ${String(debutIndice + i + 1).padStart(3, '0')} (fictif)`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' });
    await api('PUT', `/v1/dossiers/${e.id}/habilitations/${moi.utilisateur.id}`, { niveau: 'validation' });
    const ex = await api('POST', `/v1/dossiers/${e.id}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' });
    nouveaux.push({ entiteId: e.id, exerciceId: ex.id, indice: debutIndice + i });
  }
  const tPrepare = performance.now();
  const camp = await api('POST', '/v1/campagnes', { libelle: `${NOM_NOUVEAU} — ${manquants} dossiers`, type: 'fec' });
  let lignes = 0;
  for (const d of nouveaux) {
    const f = genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: FEC_ECRITURES, graine: 50_000 + d.indice, anomalies: ANOMALIES });
    lignes += f.nbLignes;
    await deposer(d.entiteId, Buffer.from(f.contenu), { usage: 'fec', exerciceId: d.exerciceId, statutDonnees: 'travail_avant_cloture', campagneId: camp.id }, f.nomFichier);
  }
  const ids = nouveaux.map((d) => d.entiteId);
  await attendreSql('imports FEC', async () => Number((await q(`select count(*)::int as n from lots_import where entite_id = any($1::uuid[]) and type = 'fec' and statut in ('termine', 'termine_avec_erreurs', 'echec')`, [ids]))[0].n) >= ids.length);
  await attendreSql('contrôles', async () => Number((await q(`select count(distinct entite_id)::int as n from executions_controles where entite_id = any($1::uuid[]) and statut = 'termine'`, [ids]))[0].n) >= ids.length);
  const tFec = performance.now();
  for (const d of nouveaux) {
    for (const k of [0, 1]) {
      const base = genererTexteFactureSynthetique({ graine: 700 + d.indice * 2 + k }).pages[0].texte.split('\n').slice(0, 10);
      const pdf = pdfTexte([...base, `FACTURE N° MP-${d.indice}-${k}`, `Date de facture : 1${k}/03/2025`, "Date d'échéance : 31/12/2025", '', 'Désignation                 Montant HT', 'Prestation de service       100,00', '', 'Total HT : 100,00 €', 'TVA 20 % sur 100,00 : 20,00', 'Total TVA : 20,00 €', 'Total TTC : 120,00 €'], `${marque}-${d.indice}-${k}`);
      await deposer(d.entiteId, pdf, { nature: 'facture_achat' }, `facture-${d.indice}-${k}.pdf`);
    }
  }
  await attendreSql('analyse des pièces', async () => Number((await q(`select count(*)::int as n from documents where entite_id = any($1::uuid[]) and statut in ('recu', 'en_analyse')`, [ids]))[0].n) === 0);
  const tPieces = performance.now();
  const [c] = await q(`select (select count(*)::int from constats where entite_id = any($1::uuid[])) as constats, (select count(*)::int from documents where entite_id = any($1::uuid[])) as pieces, (select count(*)::int from lignes_ecriture where entite_id = any($1::uuid[])) as lignes`, [ids]);
  rapport.etapes.creer = { dossiersCrees: manquants, lignesEcritureGenerees: lignes, lignesEcritureEnBase: c.lignes, pieces: c.pieces, constats: c.constats, secondes: { dossiers: arrondi((tPrepare - t0) / 1000), importsEtControles: arrondi((tFec - tPrepare) / 1000), pieces: arrondi((tPieces - tFec) / 1000) } };
  dire(`  ${manquants} dossiers : ${c.lignes} lignes d'écriture, ${c.pieces} pièces, ${c.constats} constats ; ${JSON.stringify(rapport.etapes.creer.secondes)} s.`);
}

// État final du portefeuille mesuré
crees = await q(`select id, raison_sociale from entites where cabinet_id = $1 and raison_sociale ~ $2 order by raison_sociale`, [cabinet.id, MOTIF_CREES]);
const [etat] = await q(`
  select (select count(*)::int from entites where cabinet_id = $1 and actif) as dossiers_cabinet,
         (select count(*)::int from entites where cabinet_id = $1 and raison_sociale ~ $2) as dossiers_portefeuille,
         (select count(*)::int from lignes_ecriture l join entites e on e.id = l.entite_id where e.cabinet_id = $1 and e.raison_sociale ~ $2) as lignes,
         (select count(*)::int from documents d join entites e on e.id = d.entite_id where e.cabinet_id = $1 and e.raison_sociale ~ $2) as pieces,
         (select count(*)::int from constats c join entites e on e.id = c.entite_id where e.cabinet_id = $1 and e.raison_sociale ~ $2) as constats,
         (select count(*)::int from lignes_ecriture l join entites e on e.id = l.entite_id where e.cabinet_id = $1) as lignes_cabinet`,
  [cabinet.id, MOTIF_TOUS]);
rapport.portefeuille = { dossiersMesures: etat.dossiers_portefeuille, dossiersDuCabinet: etat.dossiers_cabinet, lignesEcritureDuPortefeuille: etat.lignes, pieces: etat.pieces, constats: etat.constats, lignesEcritureDuCabinet: etat.lignes_cabinet };
dire(`\nPortefeuille mesuré : ${etat.dossiers_portefeuille} dossiers (cabinet : ${etat.dossiers_cabinet} dossiers actifs, ${etat.lignes_cabinet} lignes d'écriture), ${etat.lignes} lignes, ${etat.pieces} pièces, ${etat.constats} constats.`);
if (etat.dossiers_portefeuille < CIBLE) rapport.limites.push(`Le portefeuille compte ${etat.dossiers_portefeuille} dossiers, sous la cible de ${CIBLE}.`);

// 3. Liste et tableau de bord
if (ETAPES.has('lecture')) {
  dire('\n== Liste des dossiers et tableau de bord ==');
  rapport.etapes.lecture = {
    listeDesDossiers: await repeter('GET /v1/dossiers', REPETITIONS, () => appel('GET', '/v1/dossiers')),
    piecesEnAttente: await repeter('GET /v1/tableau-de-bord/pieces', REPETITIONS, () => appel('GET', '/v1/tableau-de-bord/pieces')),
    indicateursDuCabinet: await repeter('GET /v1/cabinet/indicateurs', REPETITIONS, () => appel('GET', '/v1/cabinet/indicateurs?du=2025-01-01&au=2026-12-31')),
    exercicesDUnDossier: await repeter('GET /v1/dossiers/:id/exercices', REPETITIONS, () => appel('GET', `/v1/dossiers/${campagne[0]?.id ?? crees[0].id}/exercices`)),
  };
}

// 4. Recherche multi-dossiers (D-088)
if (ETAPES.has('recherche')) {
  dire('\n== Recherche multi-dossiers ==');
  const termes = [['courant', 'facture'], ['courant 2', 'fournisseur'], ['rare', 'doublon'], ['sans résultat', 'xyzzyqwertz']];
  const r = {};
  for (const [nom, mot] of termes) r[nom] = await repeter(`GET /v1/recherche?q=${mot} (page 1)`, REPETITIONS, () => appel('GET', `/v1/recherche?q=${encodeURIComponent(mot)}`));
  const premiere = await appel('GET', '/v1/recherche?q=facture');
  const nbPages = Math.min(40, Math.max(1, Math.ceil((premiere.json?.dossiersAvecResultats ?? 0) / (premiere.json?.dossiersParPage ?? 10))));
  rapport.etapes.recherche = { parTerme: r, exemple: { statut: premiere.statut, dossiersAutorises: premiere.json?.dossiersAutorises ?? null, dossiersAvecResultats: premiere.json?.dossiersAvecResultats ?? null, dossiersSansResultat: premiere.json?.dossiersSansResultat ?? null, limites: premiere.json?.limites ?? null }, nbPages };
  rapport.etapes.recherche.toutesLesPages = await repeter(`GET /v1/recherche?q=facture, pages 1 à ${nbPages}`, nbPages, (i) => appel('GET', `/v1/recherche?q=facture&page=${i + 1}`));
}

// 5. Assistant de portefeuille par tranches (D-088)
if (ETAPES.has('assistant')) {
  dire('\n== Assistant de portefeuille, tranche par tranche ==');
  const perimetre = await api('GET', '/v1/assistant/perimetre');
  const nbDossiers = perimetre.dossiers?.length ?? perimetre.perimetre?.length ?? 0;
  const nbTranches = Math.max(1, Math.ceil(nbDossiers / 20));
  dire(`  périmètre : ${nbDossiers} dossier(s), ${nbTranches} tranche(s) de 20.`);
  const QUESTIONS = [['constats', 'Quels constats ont été relevés par les contrôles ?'], ['indicateur', 'Quel est le chiffre d’affaires de l’exercice ?']];
  rapport.etapes.assistant = { dossiersDuPerimetre: nbDossiers, tranches: nbTranches, parQuestion: {} };
  for (const [cle, question] of QUESTIONS) {
    const durees = [];
    let octetsMax = 0;
    const statuts = {};
    for (let t = 1; t <= nbTranches; t++) {
      let r = await appel('POST', '/v1/assistant/questions', { question, tranche: t });
      // Au plus 20 questions par minute et par personne (limite de débit de l'assistant) : on attend la fenêtre suivante.
      if (r.statut === 429) {
        await new Promise((ok) => setTimeout(ok, 61_000));
        r = await appel('POST', '/v1/assistant/questions', { question, tranche: t });
      }
      durees.push(r.ms);
      octetsMax = Math.max(octetsMax, r.octets);
      statuts[r.statut] = (statuts[r.statut] ?? 0) + 1;
    }
    const tries = [...durees].sort((x, y) => x - y);
    rapport.etapes.assistant.parQuestion[cle] = { question, p50Ms: arrondi(rang(tries, 50)), p95Ms: arrondi(rang(tries, 95)), maxMs: arrondi(tries.at(-1)), octetsReponseMax: octetsMax, statuts, dureeTotaleS: arrondi(durees.reduce((x, y) => x + y, 0) / 1000) };
    dire(`  ${nbTranches} questions de portefeuille « ${cle} » : p50 ${arrondi(rang(tries, 50))} ms, p95 ${arrondi(rang(tries, 95))} ms, max ${arrondi(tries.at(-1))} ms ; réponse max ${(octetsMax / 1024).toFixed(1)} Kio ; statuts ${JSON.stringify(statuts)}.`);
  }
}

// 6. Écrans de calcul sur un gros exercice, avec une API DÉDIÉE dont le tas est plafonné (D-093)
if (ETAPES.has('ecrans') && gros) {
  dire(`\n== Écrans de calcul sur ${gros.lignes} lignes, API dédiée à tas plafonné à ${TAS_API} Mo ==`);
  const libre = createServer();
  await new Promise((ok) => libre.listen(0, '127.0.0.1', () => ok()));
  const port = libre.address().port;
  await new Promise((ok) => libre.close(() => ok()));
  const base = `http://127.0.0.1:${port}`;
  const racine = fileURLToPath(new URL('../apps/api/', import.meta.url));
  const enfant = spawn(process.execPath, [`--max-old-space-size=${TAS_API}`, 'dist/main.js'], { cwd: racine, env: { ...process.env, NODE_ENV: 'test', API_PORT: String(port), METRIQUES_PORT_API: '0', FILES_PREFIXE: `mesure-portefeuille-${marque}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  let journal = '';
  enfant.stdout.on('data', (d) => (journal += d));
  enfant.stderr.on('data', (d) => (journal += d));
  try {
    await attendreSql('API dédiée', async () => fetch(`${base}/v1/sante`).then((r) => r.ok, () => false), 60_000);
    const ex = gros.exercice;
    const routes = [
      ['états de travail', 'GET', `/v1/exercices/${ex}/etats`],
      ['indicateurs', 'GET', `/v1/exercices/${ex}/indicateurs`],
      ['liasse (projet)', 'GET', `/v1/exercices/${ex}/liasse`],
      ['balance ajustée', 'GET', `/v1/exercices/${ex}/balance-ajustee`],
      ['tiers et factures', 'GET', `/v1/exercices/${ex}/tiers`],
      ['propositions d’inventaire', 'GET', `/v1/exercices/${ex}/inventaire/propositions`],
      ['revue (constats)', 'GET', `/v1/exercices/${ex}/revue`],
    ];
    const repos = rssMo(enfant.pid);
    const resultats = {};
    const echantillon = Math.min(REPETITIONS, 5);
    for (const [nom, methode, chemin] of routes) {
      const { resultat, rssPicMo } = await avecMemoire(enfant.pid, () => repeter(`${methode} ${nom}`, echantillon, () => appel(methode, chemin, undefined, base)));
      resultats[nom] = { ...resultat, rssPicMo };
      dire(`    mémoire résidente de l'API après « ${nom} » : pic ${rssPicMo} Mo (au repos ${Math.round(repos)} Mo)`);
    }
    // Deux calculs lourds SIMULTANÉS sur la même API : le total admis (API_LIGNES_MAX_SIMULTANEES) en reporte un, ou les deux tiennent.
    const { resultat: duo, rssPicMo: picDuo } = await avecMemoire(enfant.pid, () => Promise.all([appel('GET', `/v1/exercices/${ex}/etats`, undefined, base), appel('GET', `/v1/exercices/${ex}/etats`, undefined, base)]));
    resultats['deux états simultanés'] = { statuts: duo.map((r) => r.statut), msMax: arrondi(Math.max(...duo.map((r) => r.ms))), rssPicMo: picDuo };
    dire(`    deux états simultanés : statuts ${JSON.stringify(duo.map((r) => r.statut))}, pic ${picDuo} Mo`);
    rapport.etapes.ecrans = { lignes: gros.lignes, tasApiMo: TAS_API, rssAuReposMo: Math.round(repos), routes: resultats, journalApiExceptions: /FATAL|heap out of memory|Unhandled/.test(journal) };
    if (rapport.etapes.ecrans.journalApiExceptions) rapport.limites.push('L’API dédiée a journalisé un épuisement de mémoire ou une exception non gérée pendant l’étape « ecrans ».');
  } finally {
    enfant.kill('SIGKILL');
  }
} else if (ETAPES.has('ecrans')) rapport.limites.push('Étape « ecrans » non mesurée : aucun gros dossier « Mesure restitution … » dans le cabinet.');

// 7. Contrôles en flux (D-075) : un processus enfant par passe, sur le gros dossier existant
if (ETAPES.has('flux') && gros) {
  dire(`\n== Contrôles sur ${gros.lignes} lignes : chemin en mémoire, puis chemin en flux ==`);
  const lancer = (tasMo, seuil) =>
    new Promise((resoudre) => {
      const e = spawn(process.execPath, [...(tasMo > 0 ? [`--max-old-space-size=${tasMo}`] : []), '--expose-gc', fileURLToPath(new URL('./mesure-controles-flux.mjs', import.meta.url)), '--executer', '--cabinet', gros.cabinet, '--entite', gros.entite, '--exercice', gros.exercice, '--lot', gros.lot, ...(seuil ? ['--seuil', String(seuil)] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
      let sortie = '';
      let erreurs = '';
      e.stdout.on('data', (d) => (sortie += d));
      e.stderr.on('data', (d) => (erreurs += d));
      e.on('close', (code, signal) => {
        const ligne = sortie.split('\n').find((l) => l.startsWith('RESULTAT '));
        resoudre(ligne ? JSON.parse(ligne.slice(9)) : { erreur: `processus terminé sans résultat (code ${code}, signal ${signal}) ${erreurs.slice(-200)}` });
      });
    });
  const resume = (r) => (r.erreur ? { erreur: r.erreur } : { chemin: r.chemin, lignes: r.lignes, dureeS: r.dureeS, tasPlafondMo: r.tasPlafondMo, picTasMo: r.picTasMo, picResidenteMo: r.picResidenteSystemeMo, controlesRealises: r.nbRealises, controles: r.nbControles, constats: r.nbConstats, nonRealises: r.nonRealises.length });
  const memoire = resume(await lancer(0, null));
  const flux = resume(await lancer(384, 100_000));
  rapport.etapes.flux = { memoire, flux };
  dire(`  en mémoire : ${JSON.stringify(memoire)}\n  en flux (seuil 100 000, tas 384 Mo) : ${JSON.stringify(flux)}`);
} else if (ETAPES.has('flux')) rapport.limites.push('Étape « flux » non mesurée : aucun gros dossier.');

// 8. Restitution (D-056)
if (ETAPES.has('restitution') || ETAPES.has('restitution-cabinet')) {
  dire('\n== Restitution ==');
  const pidWorker = pidFichier('worker');
  const demander = async (nom, chemin, listeChemin, entite) => {
    const repos = rssMo(pidWorker);
    const t0 = performance.now();
    const { resultat, rssPicMo } = await avecMemoire(pidWorker, async () => {
      const cree = await api('POST', chemin);
      for (;;) {
        await new Promise((ok) => setTimeout(ok, 500));
        const liste = await api('GET', listeChemin);
        const r = liste.find((x) => x.id === cree.id);
        if (r && ['termine', 'echec'].includes(r.statut)) return r;
      }
    });
    const s = { statut: resultat.statut, secondes: arrondi((performance.now() - t0) / 1000), tailleArchiveMo: resultat.taille ? arrondi(resultat.taille / 1e6) : null, workerRssRepos: Math.round(repos), workerRssPicMo: rssPicMo, resume: resultat.resume ? { originaux: resultat.resume.originaux, octetsOriginauxMo: arrondi((resultat.resume.octetsOriginaux ?? 0) / 1e6), lignesEcriture: resultat.resume.lignesEcriture } : null, erreur: resultat.erreur ?? null };
    dire(`  ${nom} : ${JSON.stringify(s)}`);
    return s;
  };
  const r = {};
  const petit = crees[0] ?? campagne[0];
  if (ETAPES.has('restitution')) {
    r.dossierDuPortefeuille = await demander('restitution d’un dossier du portefeuille', `/v1/dossiers/${petit.id}/restitutions`, `/v1/dossiers/${petit.id}/restitutions`);
    if (gros) r.grosDossier = await demander(`restitution du gros dossier (${gros.lignes} lignes)`, `/v1/dossiers/${gros.entite}/restitutions`, `/v1/dossiers/${gros.entite}/restitutions`);
  }
  if (ETAPES.has('restitution-cabinet')) r.cabinetEntier = await demander('restitution du cabinet entier', '/v1/cabinet/restitutions', '/v1/cabinet/restitutions');
  else rapport.limites.push('Restitution du cabinet entier non mesurée (étape « restitution-cabinet », à demander : plusieurs centaines de Mo ajoutés au stockage).');
  rapport.etapes.restitution = r;
}

// 9. Reprise des immobilisations : plus grande réponse JSON de l'aperçu et du rapport (D-092)
if (ETAPES.has('reprise') || ETAPES.has('reprise-apercu')) {
  dire('\n== Reprise des immobilisations : 5 000 lignes ==');
  const ENTETE = 'Désignation;Compte;Valeur brute;Date d’acquisition;Date de mise en service;Durée (mois);Mode d’amortissement;Coefficient dégressif;Éligibilité dégressif;Valeur résiduelle';
  const b64 = (t) => Buffer.from(t).toString('base64');
  const corps = (texte, extra = {}) => ({ nomFichier: 'immobilisations.csv', contenuBase64: b64(texte), ...extra });
  const nominal = [ENTETE, ...Array.from({ length: 5000 }, (_, i) => `Bien ${marque} ${i};218300;${100 + i},00;;01/01/2024;12;;;;`)].join('\n');
  // Pire cas : 5 000 lignes de 1 000 octets environ (la limite est de 5 Mio), désignations de 190 caractères, chacune AVEC des motifs de rejet.
  const longue = (i) => `${`Désignation très longue ${i} `.repeat(8).slice(0, 190)};231000;${'9'.repeat(40)},00;;99/99/2024;abc;dégressif;x;peut-être;${'z'.repeat(400)}`;
  const pire = [ENTETE, ...Array.from({ length: 5000 }, (_, i) => longue(i))].join('\n');
  // Au plafond du fichier : 5 000 lignes d'environ 1 020 octets, soit un peu moins de 5 Mio (limite : 5 242 880 octets).
  const auPlafond = [ENTETE, ...Array.from({ length: 5000 }, (_, i) => `${`Désignation très longue ${i} `.repeat(8).slice(0, 190)};231000;${'9'.repeat(40)},00;;99/99/2024;abc;dégressif;x;peut-être;${'z'.repeat(723)}`)].join('\n');
  const cible = crees[0] ?? campagne[0];
  const reprise = {};
  const ap = await appel('POST', `/v1/dossiers/${cible.id}/reprises-immobilisations/apercu`, corps(nominal));
  reprise.apercuNominal = { statut: ap.statut, octetsFichier: Buffer.byteLength(nominal), octetsReponse: ap.octets, ms: arrondi(ap.ms), lignes: ap.json?.fichier?.nbLignes ?? null };
  const apPire = await appel('POST', `/v1/dossiers/${cible.id}/reprises-immobilisations/apercu`, corps(pire));
  reprise.apercuPireCas = { statut: apPire.statut, octetsFichier: Buffer.byteLength(pire), octetsReponse: apPire.octets, ms: arrondi(apPire.ms), lignes: apPire.json?.fichier?.nbLignes ?? null, message: apPire.statut >= 400 ? JSON.stringify(apPire.json).slice(0, 200) : null };
  const apPlafond = await appel('POST', `/v1/dossiers/${cible.id}/reprises-immobilisations/apercu`, corps(auPlafond));
  reprise.apercuAuPlafondDuFichier = { statut: apPlafond.statut, octetsFichier: Buffer.byteLength(auPlafond), octetsReponse: apPlafond.octets, ms: arrondi(apPlafond.ms), lignes: apPlafond.json?.fichier?.nbLignes ?? null, message: apPlafond.statut >= 400 ? JSON.stringify(apPlafond.json).slice(0, 200) : null };
  dire(`  aperçu nominal : ${JSON.stringify(reprise.apercuNominal)}\n  aperçu pire cas : ${JSON.stringify(reprise.apercuPireCas)}\n  aperçu au plafond du fichier : ${JSON.stringify(reprise.apercuAuPlafondDuFichier)}`);
  if (ap.statut === 200 && ETAPES.has('reprise')) {
    // Validation : crée 5 000 immobilisations dans UN dossier portant le préfixe (retirables par --nettoyer).
    const dossierReprise = await api('POST', '/v1/dossiers', { raisonSociale: `${NOM_NOUVEAU} reprise immobilisations (fictif)`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' });
    await api('PUT', `/v1/dossiers/${dossierReprise.id}/habilitations/${moi.utilisateur.id}`, { niveau: 'validation' });
    const ap2 = await appel('POST', `/v1/dossiers/${dossierReprise.id}/reprises-immobilisations/apercu`, corps(nominal));
    const v = await appel('POST', `/v1/dossiers/${dossierReprise.id}/reprises-immobilisations`, corps(nominal, { correspondance: ap2.json.correspondance, empreinteApercu: ap2.json.empreinteApercu, confirmation: true }));
    reprise.validation = { statut: v.statut, ms: arrondi(v.ms), octetsReponse: v.octets, creees: v.json?.nbCreees ?? null };
    if (v.statut === 201 || v.statut === 200) {
      const id = v.json.id;
      const pageMax = await repeter('GET rapport, page de 200 lignes', REPETITIONS, (i) => appel('GET', `/v1/dossiers/${dossierReprise.id}/reprises-immobilisations/${id}?page=${(i % 25) + 1}`));
      const csv = await appel('GET', `/v1/dossiers/${dossierReprise.id}/reprises-immobilisations/${id}/rapport.csv`);
      reprise.rapport = { pageDe200Lignes: pageMax, csvComplet: { statut: csv.statut, octets: csv.octets, ms: arrondi(csv.ms) } };
      dire(`  validation : ${JSON.stringify(reprise.validation)} ; rapport CSV de 5 000 lignes : ${(csv.octets / 1024).toFixed(0)} Kio en ${arrondi(csv.ms)} ms`);
    }
  }
  rapport.etapes.reprise = reprise;
}

// Sortie
rapport.fin = new Date().toISOString();
mkdirSync(new URL('../var/mesures/', import.meta.url), { recursive: true });
const sortie = option('sortie', fileURLToPath(new URL(`../var/mesures/portefeuille-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.json`, import.meta.url)));
writeFileSync(sortie, JSON.stringify(rapport, null, 2));
dire(`\nRésultats écrits dans ${sortie}`);
if (rapport.limites.length) dire(`Non mesuré ou limité :\n- ${rapport.limites.join('\n- ')}`);
await admin.end();
process.exit(0);
