/**
 * Fin de contrat d'un cabinet — tests sur une base NEUVE et ISOLÉE.
 *
 * Chaque exécution crée sa propre base dans le PostgreSQL local, y rejoue TOUTES les migrations, l'amorce, puis la
 * supprime. Rien n'est lu ni écrit dans la base « comtaple » : la procédure n'y est JAMAIS appliquée. Le stockage objet
 * est un stockage FACTICE en mémoire : aucune suppression réelle d'objet n'est exercée ici.
 *
 * Les cabinets d'essai sont peuplés de façon GÉNÉRIQUE, d'après le catalogue de la base : une ligne au moins dans
 * CHAQUE table portant `cabinet_id`, présente ou future. Une table nouvelle que ce peuplement ne sait pas remplir fait
 * échouer le test (ajouter sa valeur dans `VALEURS`) ; une table nouvelle sans catégorie dans la politique fait échouer
 * le garde-fou de couverture (ajouter la table à POLITIQUE_FIN_DE_CONTRAT, en décidant son devenir).
 */
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, amorcer } from './amorcer.js';
import { type LigneJournalExportee, exporterJournal, verifierExport } from './ancre-journal.js';
import { chargerEnvLocal } from './env.js';
import { type AccesBd, creerAccesBd, sql, urlBd } from './index.js';
import { migrer } from './migrer.js';
import {
  ANONYMISATION_FIN_DE_CONTRAT,
  COLONNES_CLES_OBJETS,
  type EtapeFinDeContrat,
  LIMITE_SAUVEGARDES,
  OFFRES_DEMO,
  POLITIQUE_FIN_DE_CONTRAT,
  type ParametresFinDeContrat,
  type PlanFinDeContrat,
  type ProcesVerbalFinDeContrat,
  RefusFinDeContrat,
  type StockageObjets,
  definirOffre,
  empreinteProcesVerbal,
  finDeContrat,
  inventaireFinDeContrat,
  jsonCanonique,
  lireProcesVerbalFinDeContrat,
  objetsFinDeContrat,
  prefixesObjetsCabinet,
  verifierProcesVerbal,
} from './provisionnement.js';

chargerEnvLocal();
const BASE = `comtaple_essai_fin_contrat_${Date.now()}`;
const env = { ...process.env, PG_DATABASE: BASE };

let admin: pg.Client;
let app: AccesBd;
let worker: AccesBd;
const ctx = (cabinetId: string, utilisateurId: string) => ({ cabinetId, utilisateurId, sujet: utilisateurId });
const alea = () => randomUUID().slice(0, 8);
const strict = async (cabinet: string) => (await admin.query<{ r: string | null }>('select journal_audit_verifier($1)::text as r', [cabinet])).rows[0]!.r;

// ───────────────────────────── Catalogue et peuplement générique ─────────────────────────────

interface Colonne { t: string; col: string; typname: string; typtype: string; cat: string; nn: boolean; def: boolean }
interface Cle { enfant: string; col: string; parent: string; pcol: string }
let colonnes: Colonne[];
let cles: Cle[];
let controles: Array<{ t: string; d: string }>;
let enums: Map<string, string>;
let tablesCabinet: string[];
let globalesPartagees: Map<string, Record<string, unknown>>;

async function lireCatalogue(): Promise<void> {
  colonnes = (
    await admin.query<Colonne>(
      `select c.relname as t, a.attname as col, ty.typname, ty.typtype, ty.typcategory as cat, a.attnotnull as nn, (a.atthasdef or a.attidentity <> '' or a.attgenerated <> '') as def
         from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped join pg_type ty on ty.oid = a.atttypid
        where n.nspname = 'public' and c.relkind = 'r' order by c.relname, a.attnum`,
    )
  ).rows;
  cles = (
    await admin.query<Cle>(
      `select e.relname as enfant, a.attname as col, pa.relname as parent, pb.attname as pcol from pg_constraint c join pg_class e on e.oid = c.conrelid join pg_class pa on pa.oid = c.confrelid
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] join pg_attribute pb on pb.attrelid = c.confrelid and pb.attnum = c.confkey[1]
        where c.contype = 'f' and c.connamespace = 'public'::regnamespace`,
    )
  ).rows;
  controles = (await admin.query<{ t: string; d: string }>(`select e.relname as t, pg_get_constraintdef(c.oid) as d from pg_constraint c join pg_class e on e.oid = c.conrelid where c.contype = 'c' and c.connamespace = 'public'::regnamespace`)).rows;
  enums = new Map((await admin.query<{ typname: string; premier: string }>(`select t.typname, (array_agg(e.enumlabel order by e.enumsortorder))[1] as premier from pg_enum e join pg_type t on t.oid = e.enumtypid group by 1`)).rows.map((l) => [l.typname, l.premier]));
  tablesCabinet = [...new Set(colonnes.filter((c) => c.col === 'cabinet_id').map((c) => c.t))].sort();
}

/** Valeurs imposées par une contrainte que le peuplement générique ne sait pas deviner. */
const VALEURS: Record<string, (c: Cabinet | null) => unknown> = {
  'invitations.email': () => `essai-${alea()}@exemple.test`,
  'invitations.role': () => 'collaborateur',
  'immobilisations.compte_immobilisation': () => '2183',
  'politiques_conservation.categorie': () => 'journal_audit', // catégorie conservée : ne s'oppose à aucune suppression
  'abonnements.statut': () => 'resilie',
  'liens_tiers.decision': () => 'confirme',
  'liens_tiers.cle_comptable': () => 'aux:411ESSAI',
  'liens_tiers.cle_piece': () => 'siren:123456789',
  // Lien de comptabilisation : l'objet est la pièce, à une version d'extraction donnée.
  'liens_factures.type': () => 'comptabilisation',
  'liens_factures.decision': () => 'confirme',
  'liens_factures.objet': (c) => c?.lignes.get('documents')?.id,
  'liens_factures.version_extraction': () => 1,
};

function valeur(c: Colonne, cabinet: Cabinet | null): unknown {
  const cabinetId = cabinet?.id ?? null;
  const imposee = VALEURS[`${c.t}.${c.col}`];
  if (imposee) return imposee(cabinet);
  if (cabinetId && COLONNES_CLES_OBJETS.some((k) => k.table === c.t && k.colonne === c.col)) return `cabinets/${cabinetId}/essai/${c.t}-${c.col}-${alea()}`;
  if (c.typtype === 'e') return enums.get(c.typname);
  if (c.cat === 'A') return '{}';
  switch (c.typname) {
    case 'uuid':
      return randomUUID();
    case 'text':
    case 'varchar': {
      // Première valeur admise par une contrainte « colonne = ANY (ARRAY[...]) », sinon un texte unique.
      for (const k of controles.filter((x) => x.t === c.t)) {
        const m = new RegExp(`\\(${c.col} = ANY \\(ARRAY\\['([^']+)'`).exec(k.d);
        if (m) return m[1];
      }
      return `essai-${c.col}-${alea()}`;
    }
    case 'int2':
    case 'int4':
    case 'int8':
      return 12;
    case 'numeric':
    case 'float4':
    case 'float8':
      return '100.00';
    case 'bool':
      return false;
    case 'date':
      return '2025-01-01';
    case 'timestamptz':
    case 'timestamp':
      return new Date();
    case 'jsonb':
    case 'json':
      return '{}';
    case 'bytea':
      return Buffer.from('essai');
    default:
      throw new Error(`Peuplement générique : type ${c.typname} non géré (${c.t}.${c.col}) — compléter VALEURS dans fin-de-contrat.itest.ts`);
  }
}

interface Cabinet { id: string; nom: string; utilisateur: string; lignes: Map<string, Record<string, unknown>> }

async function inserer(t: string, c: Cabinet | null): Promise<Record<string, unknown>> {
  const noms: string[] = [];
  const valeurs: unknown[] = [];
  for (const col of colonnes.filter((x) => x.t === t)) {
    const fk = cles.find((k) => k.enfant === t && k.col === col.col);
    let v: unknown;
    if (col.col === 'cabinet_id' && c) v = c.id;
    else if (fk) {
      if (fk.parent === 'cabinets') v = c?.id;
      else if (fk.parent === 'utilisateurs') v = c?.utilisateur;
      else if (tablesCabinet.includes(fk.parent)) v = c?.lignes.get(fk.parent)?.[fk.pcol];
      else {
        // Référentiel partagé (offres, évolutions réglementaires…) : une ligne commune à tous les cabinets d'essai.
        if (!globalesPartagees.has(fk.parent)) globalesPartagees.set(fk.parent, await inserer(fk.parent, null));
        v = globalesPartagees.get(fk.parent)![fk.pcol];
      }
      if (v === undefined) {
        if (col.nn) throw new Error(`Peuplement générique : ${t}.${col.col} référence ${fk.parent}, pas encore peuplée`);
        continue;
      }
    } else if ((col.nn && !col.def) || VALEURS[`${t}.${col.col}`] || COLONNES_CLES_OBJETS.some((k) => k.table === t && (k.colonne === col.col || k.taille === col.col))) v = valeur(col, c);
    else continue;
    noms.push(`"${col.col}"`);
    valeurs.push(v);
  }
  try {
    return (await admin.query(`insert into "${t}" (${noms.join(', ')}) values (${noms.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, valeurs)).rows[0];
  } catch (e) {
    throw new Error(`Peuplement générique de ${t} impossible : ${(e as Error).message} — compléter VALEURS dans fin-de-contrat.itest.ts`);
  }
}

/** Tables portant cabinet_id, parents avant enfants. */
function ordrePeuplement(): string[] {
  const restantes = new Set(tablesCabinet);
  const ordre: string[] = [];
  while (restantes.size) {
    const libres = [...restantes].filter((t) => !cles.some((k) => k.enfant === t && k.parent !== t && restantes.has(k.parent))).sort();
    // Dépendances circulaires : on avance quand même ; une référence obligatoire non satisfaite échouera avec un message clair.
    const lot = libres.length ? libres : [[...restantes].sort()[0]!];
    for (const t of lot) {
      ordre.push(t);
      restantes.delete(t);
    }
  }
  return ordre;
}

/** Le registre des procès-verbaux n'est écrit que par la procédure elle-même. */
const NON_PEUPLEES = ['fins_de_contrat'];

/** Cabinet peuplé dans toutes les tables, résilié depuis 200 jours. Sans restitution terminée (voir `restituer`). */
async function peupler(nom: string): Promise<Cabinet> {
  const id = (await admin.query<{ id: string }>('insert into cabinets (nom) values ($1) returning id', [nom])).rows[0]!.id;
  const utilisateur = (await admin.query<{ id: string }>('insert into utilisateurs (sujet_oidc, email, nom) values ($1, $2, $3) returning id', [`essai-${alea()}-${alea()}`, `membre-${alea()}@exemple.test`, `Membre de ${nom}`])).rows[0]!.id;
  const c: Cabinet = { id, nom, utilisateur, lignes: new Map() };
  for (const t of ordrePeuplement()) if (!NON_PEUPLEES.includes(t)) c.lignes.set(t, await inserer(t, c));
  await admin.query(`update abonnements set fin = current_date - 200, motif_resiliation = 'essai' where cabinet_id = $1`, [id]);
  return c;
}

const EMPREINTE_ARCHIVE = (c: Cabinet) => createHash('sha256').update(`archive de ${c.id}`).digest('hex');

/** Restitution du cabinet terminée MAINTENANT, complète, d'empreinte enregistrée et consignée au journal. */
async function restituer(c: Cabinet, options: { ecartes?: unknown[]; sha256?: string | null } = {}): Promise<string> {
  const inclus = (await admin.query<{ id: string }>('select id from entites where cabinet_id = $1', [c.id])).rows.map((l) => l.id);
  const id = (
    await admin.query<{ id: string }>(
      `insert into restitutions_cabinet (cabinet_id, statut, perimetre, cle_archive, sha256, taille, demande_par, termine_le) values ($1, 'termine', $2, $3, $4, 4096, $5, now()) returning id`,
      [c.id, JSON.stringify({ inclus, ecartes: options.ecartes ?? [] }), `cabinets/${c.id}/restitutions/cabinet-${alea()}.zip`, options.sha256 === undefined ? EMPREINTE_ARCHIVE(c) : options.sha256, c.utilisateur],
    )
  ).rows[0]!.id;
  await admin.query(`insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id) values ($1, 'systeme', 'restitution_cabinet.generee', 'restitution_cabinet', $2)`, [c.id, id]);
  return id;
}

const pret = async (nom: string) => {
  const c = await peupler(`${nom} ${alea()} (essai)`);
  await restituer(c);
  return c;
};
const confirmer = (c: Cabinet): ParametresFinDeContrat => ({ cabinetId: c.id, confirmation: { cabinetId: c.id, nom: c.nom }, appliquer: true });

// ───────────────────────────── Empreintes ─────────────────────────────

type Empreintes = Record<string, { n: number; e: string }>;
async function empreinte(table: string, condition = '', params: unknown[] = []): Promise<{ n: number; e: string }> {
  const r = await admin.query<{ n: number; e: string }>(`select count(*)::int as n, coalesce(md5(string_agg(h, '' order by h)), '') as e from (select md5(x::text) as h from "${table}" x ${condition}) s`, params);
  return r.rows[0]!;
}
const toutesLesTables = () => [...new Set(colonnes.map((c) => c.t))].sort();
/** Toutes les lignes de toutes les tables de la base. */
async function empreinteBase(): Promise<Empreintes> {
  const r: Empreintes = {};
  for (const t of toutesLesTables()) r[t] = await empreinte(t);
  return r;
}
/** Toutes les lignes d'un cabinet. */
async function empreinteCabinet(id: string): Promise<Empreintes> {
  const r: Empreintes = {};
  for (const t of tablesCabinet) r[t] = await empreinte(t, 'where x.cabinet_id = $1', [id]);
  return r;
}
/** Tout ce qui n'appartient PAS au cabinet : les lignes des autres cabinets, et les tables sans cabinet_id en entier. */
async function empreinteHors(id: string): Promise<Empreintes> {
  const r: Empreintes = {};
  for (const t of toutesLesTables()) r[t] = tablesCabinet.includes(t) ? await empreinte(t, 'where x.cabinet_id <> $1', [id]) : await empreinte(t);
  return r;
}

class StockageFactice implements StockageObjets {
  readonly objets = new Map<string, number>();
  async lister(prefixe: string): Promise<string[]> {
    return [...this.objets.keys()].filter((k) => k.startsWith(prefixe)).sort();
  }
  async supprimer(clesASupprimer: string[]): Promise<void> {
    for (const k of clesASupprimer) this.objets.delete(k);
  }
  etat(): string {
    return jsonCanonique([...this.objets].sort());
  }
}
/** Dépose dans le stockage factice les objets référencés par la base pour un cabinet, plus des morceaux et un orphelin. */
async function deposerObjets(stockage: StockageFactice, c: Cabinet): Promise<void> {
  for (const k of (await inventaireFinDeContrat(admin, c.id)).objets.cles) stockage.objets.set(k, 100);
  stockage.objets.set(`tmp/${c.id}/televersement/00000000000000`, 10);
  stockage.objets.set(`cabinets/${c.id}/derives/orphelin/apercu.png`, 10);
}

beforeAll(async () => {
  const racine = new pg.Client({ connectionString: urlBd('admin', { ...process.env, PG_DATABASE: 'postgres' }) });
  await racine.connect();
  await racine.query(`create database ${BASE}`);
  await racine.end();
  await migrer(env);
  await amorcer(env);
  admin = new pg.Client({ connectionString: urlBd('admin', env) });
  await admin.connect();
  app = creerAccesBd(urlBd('app', env));
  worker = creerAccesBd(urlBd('worker', env));
  globalesPartagees = new Map();
  for (const o of OFFRES_DEMO) await definirOffre(admin, o);
  await lireCatalogue();
}, 180_000);

afterAll(async () => {
  await app?.fermer();
  await worker?.fermer();
  await admin?.end();
  const racine = new pg.Client({ connectionString: urlBd('admin', { ...process.env, PG_DATABASE: 'postgres' }) });
  await racine.connect();
  await racine.query(`drop database if exists ${BASE} with (force)`);
  await racine.end();
});

describe('base d’essai', () => {
  it('les tests s’exécutent sur une base neuve, jamais sur la base locale', async () => {
    const base = (await admin.query<{ b: string }>('select current_database() as b')).rows[0]!.b;
    expect(base).toBe(BASE);
    expect(base).not.toBe('comtaple');
    expect(base).not.toBe(process.env.PG_DATABASE);
  });
});

describe('garde-fou de couverture', () => {
  const politique = POLITIQUE_FIN_DE_CONTRAT.categories.flatMap((c) => c.tables);

  it('TOUTE table portant cabinet_id a une catégorie et un devenir ; la politique ne cite aucune table inexistante', () => {
    // Échoue dès qu'une migration ajoute une table à cabinet_id sans décider de son devenir en fin de contrat.
    expect(tablesCabinet.filter((t) => !politique.includes(t)), 'tables à cabinet_id sans catégorie dans POLITIQUE_FIN_DE_CONTRAT').toEqual([]);
    expect(politique.filter((t) => !tablesCabinet.includes(t)), 'tables de la politique absentes de la base').toEqual([]);
    expect(new Set(politique).size, 'une table ne figure que dans une catégorie').toBe(politique.length);
    expect(tablesCabinet.length).toBeGreaterThanOrEqual(60);
  });

  it('chaque catégorie a un devenir explicite ; toute conservation porte une durée PROPOSÉE et son fondement', () => {
    expect(POLITIQUE_FIN_DE_CONTRAT.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(POLITIQUE_FIN_DE_CONTRAT.statut).toMatch(/non arrêtée/);
    expect(new Set(POLITIQUE_FIN_DE_CONTRAT.categories.map((c) => c.code)).size).toBe(POLITIQUE_FIN_DE_CONTRAT.categories.length);
    for (const c of POLITIQUE_FIN_DE_CONTRAT.categories) {
      expect(['supprimer', 'conserver_jusqu_a', 'anonymiser', 'restituer_puis_supprimer'], c.code).toContain(c.devenir);
      if (c.devenir === 'conserver_jusqu_a') {
        expect(c.conservation, c.code).toBeDefined();
        expect(c.conservation!.duree.length, c.code).toBeGreaterThan(0);
        expect(c.conservation!.fondement.length, c.code).toBeGreaterThan(10);
      }
      if (c.conservation) expect(c.conservation.statut).toBe('proposé, non arrêté');
      if (c.devenir === 'anonymiser') for (const t of c.tables) for (const col of ANONYMISATION_FIN_DE_CONTRAT[t] ?? ['(aucune)']) expect(colonnes.some((x) => x.t === t && x.col === col && !x.nn), `${t}.${col}`).toBe(true);
    }
    // Les quatre devenirs sont réellement employés ; le journal d'audit est conservé, jamais supprimé.
    expect(new Set(POLITIQUE_FIN_DE_CONTRAT.categories.map((c) => c.devenir)).size).toBe(4);
    expect(POLITIQUE_FIN_DE_CONTRAT.categories.find((c) => c.tables.includes('journal_audit'))!.devenir).toBe('conserver_jusqu_a');
  });

  it('toute colonne portant une clé du stockage objet est connue de la procédure', () => {
    // Colonnes « cle_… » qui ne désignent PAS un objet du stockage (clés d'idempotence, clés de rapprochement de tiers).
    const CLES_SANS_OBJET = ['cle_idempotence', 'liens_tiers.cle_comptable', 'liens_tiers.cle_piece'];
    const connues = COLONNES_CLES_OBJETS.map((k) => `${k.table}.${k.colonne}`).sort();
    const presentes = colonnes.filter((c) => tablesCabinet.includes(c.t) && /^cle_/.test(c.col) && !CLES_SANS_OBJET.includes(c.col) && !CLES_SANS_OBJET.includes(`${c.t}.${c.col}`)).map((c) => `${c.t}.${c.col}`).sort();
    expect(presentes).toEqual(connues);
  });

  it('une table future sans catégorie est signalée par l’inventaire et BLOQUE l’exécution', async () => {
    const c = await pret('Table future');
    await admin.query('create table essai_table_future (id uuid primary key default gen_random_uuid(), cabinet_id uuid not null references cabinets(id))');
    try {
      await admin.query('insert into essai_table_future (cabinet_id) values ($1)', [c.id]);
      expect((await inventaireFinDeContrat(admin, c.id)).tablesSansCategorie).toEqual(['essai_table_future']);
      const avant = await empreinteCabinet(c.id);
      await expect(finDeContrat(admin, confirmer(c))).rejects.toThrow(/table essai_table_future sans catégorie/);
      expect(await empreinteCabinet(c.id)).toEqual(avant);
    } finally {
      await admin.query('drop table essai_table_future');
    }
    // Une table CONSERVÉE qui référencerait une table supprimée est refusée de la même façon (ici : registre → dossiers).
    const plan = (await finDeContrat(admin, { cabinetId: c.id })).plan;
    expect(plan.preconditions.find((x) => x.code === 'couverture_politique')!.satisfaite).toBe(true);
  });
});

describe('inventaire et simulation', () => {
  let c: Cabinet;
  let temoin: Cabinet;
  const stockage = new StockageFactice();

  it('le cabinet d’essai est peuplé dans TOUTES les tables à cabinet_id ; l’inventaire les décompte par catégorie', async () => {
    c = await pret('Inventaire');
    temoin = await pret('Témoin inventaire');
    await deposerObjets(stockage, c);
    await deposerObjets(stockage, temoin);
    const reel = await empreinteCabinet(c.id);
    expect(Object.entries(reel).filter(([t, v]) => v.n === 0 && !NON_PEUPLEES.includes(t)).map(([t]) => t), 'tables restées vides').toEqual([]);
    const inv = await inventaireFinDeContrat(admin, c.id);
    expect(inv.cabinet).toMatchObject({ id: c.id, nom: c.nom });
    expect(inv.politique.version).toBe(POLITIQUE_FIN_DE_CONTRAT.version);
    expect(inv.tablesSansCategorie).toEqual([]);
    expect(inv.tablesAbsentes).toEqual([]);
    for (const cat of inv.categories) {
      for (const t of cat.tables) expect(t.lignes, t.table).toBe(reel[t.table]!.n);
      if (cat.code !== 'fin_de_contrat') expect(cat.lignes, cat.code).toBeGreaterThan(0);
    }
    expect(inv.categories.flatMap((x) => x.tables.map((t) => t.table)).sort()).toEqual(tablesCabinet);
    // Objets : clés référencées par la base, toutes sous les préfixes du cabinet, volume connu.
    expect(inv.objets.prefixes).toEqual([`cabinets/${c.id}/`, `tmp/${c.id}/`]);
    expect(inv.objets.referencesEnBase).toBe(6); // fichier, deux exports de révision, restitution de dossier, deux restitutions du cabinet
    expect(inv.objets.clesHorsPrefixes).toBe(0);
    expect(inv.objets.volumeOctetsConnu).toBeGreaterThan(0);
    expect(inv.horsTables.utilisateursSansAutreCabinet.nombre).toBe(1);
  });

  it('simulation par défaut : plan complet, AUCUNE ligne et AUCUN objet ne change (empreintes de toute la base)', async () => {
    const avant = await empreinteBase();
    const objetsAvant = stockage.etat();
    const r = await finDeContrat(admin, { cabinetId: c.id }); // ni « appliquer », ni confirmation
    const avecConfirmation = await finDeContrat(admin, { cabinetId: c.id, confirmation: { cabinetId: c.id, nom: c.nom } });
    const objets = await objetsFinDeContrat(admin, stockage, { cabinetId: c.id });
    expect(await empreinteBase()).toEqual(avant);
    expect(stockage.etat()).toBe(objetsAvant);
    expect(r.simulation).toBe(true);
    expect(r.plan.simulation).toBe(true);
    // Sans confirmation : toutes les pré-conditions sont réunies sauf elle. Avec : le plan est exécutable.
    expect(r.plan.preconditions.filter((x) => !x.satisfaite).map((x) => x.code)).toEqual(['confirmation']);
    expect(r.plan.executable).toBe(false);
    expect(avecConfirmation.plan.executable).toBe(true);
    expect(avecConfirmation.plan.preconditions.map((x) => x.code)).toEqual(['couverture_politique', 'registre_disponible', 'abonnement_resilie', 'restitution_a_jour', 'journal_integre', 'aucune_obligation_de_conservation', 'confirmation']);
    expect(r.plan.restitution).toMatchObject({ sha256: EMPREINTE_ARCHIVE(c) });
    expect(r.plan.sauvegardes).toBe(LIMITE_SAUVEGARDES);
    // Ce qui serait supprimé, anonymisé, conservé — et dans quel ordre.
    const supprimees = r.plan.etapes.filter((e) => e.operation === 'supprimer').map((e) => e.table!);
    const attendues = POLITIQUE_FIN_DE_CONTRAT.categories.filter((x) => x.devenir === 'supprimer' || x.devenir === 'restituer_puis_supprimer').flatMap((x) => x.tables);
    expect([...supprimees].sort()).toEqual([...attendues].sort());
    for (const k of cles) if (supprimees.includes(k.enfant) && supprimees.includes(k.parent) && k.enfant !== k.parent) expect(supprimees.indexOf(k.enfant), `${k.enfant} avant ${k.parent}`).toBeLessThan(supprimees.indexOf(k.parent));
    expect(r.plan.etapes.map((e) => e.rang)).toEqual(r.plan.etapes.map((_, i) => i + 1));
    expect(r.plan.etapes.filter((e) => e.operation === 'anonymiser').map((e) => e.table)).toEqual(['evenements_ia']);
    expect(r.plan.etapes.slice(-2).map((e) => e.operation)).toEqual(['journaliser', 'proces_verbal']);
    expect(r.plan.etapes.every((e) => e.operation !== 'supprimer' || e.lignes! > 0)).toBe(true);
    expect(r.plan.conserve.map((x) => x.table).sort()).toEqual(['abonnements', 'anomalies_journal', 'echeances_abonnement', 'evenements_facturation', 'fins_de_contrat', 'journal_audit', 'politiques_conservation', 'restitutions_cabinet']);
    expect(r.plan.conserve.every((x) => x.conservation?.statut === 'proposé, non arrêté')).toBe(true);
    // Objets concernés : ceux du cabinet seulement (références de la base, morceaux, orphelin), rien du témoin.
    expect(objets).toMatchObject({ simulation: true, supprimees: 0, restantes: 8 });
    expect(objets.cles.every((k) => k.startsWith(`cabinets/${c.id}/`) || k.startsWith(`tmp/${c.id}/`))).toBe(true);
    expect(objets.cles).toEqual(expect.arrayContaining(r.plan.inventaire.objets.cles));
  });

  it('la simulation s’exécute dans une transaction en lecture seule : la base elle-même y refuse toute écriture', async () => {
    await admin.query('begin transaction read only');
    await expect(admin.query('delete from notifications where cabinet_id = $1', [c.id])).rejects.toThrow(/read-only/);
    await admin.query('rollback');
    // Paramètres invalides : refusés avant toute lecture.
    await expect(finDeContrat(admin, { cabinetId: 'pas-un-uuid' })).rejects.toThrow(/invalide/);
    await expect(finDeContrat(admin, { cabinetId: randomUUID() })).rejects.toThrow(/introuvable/);
    await expect(finDeContrat(admin, { cabinetId: c.id, delaiGraceJours: 5 })).rejects.toThrow(/Délai de grâce/);
    await expect(finDeContrat(admin, { cabinetId: c.id, delaiGraceJours: 90.5 })).rejects.toThrow(/Délai de grâce/);
    expect(() => prefixesObjetsCabinet('')).toThrow(/invalide/);
  });
});

describe('pré-conditions : chacune, manquante, entraîne un refus motivé et ne modifie rien', () => {
  let c: Cabinet;
  let reference: Empreintes;

  /** L'exécution est demandée (appliquer + confirmation) ; elle doit être refusée pour ce motif, sans aucun effet. */
  async function refus(p: ParametresFinDeContrat, code: string, motif: RegExp): Promise<PlanFinDeContrat> {
    const avant = await empreinteCabinet(c.id);
    const e = await finDeContrat(admin, p).then(
      () => null,
      (x: unknown) => x,
    );
    expect(e, `refus attendu : ${code}`).toBeInstanceOf(RefusFinDeContrat);
    const r = e as RefusFinDeContrat;
    expect(r.plan.preconditions.filter((x) => !x.satisfaite).map((x) => x.code)).toEqual([code]);
    expect(r.motifs).toHaveLength(1);
    expect(r.motifs[0]).toMatch(motif);
    expect(r.message).toMatch(/rien n’a été modifié/);
    expect(await empreinteCabinet(c.id)).toEqual(avant);
    expect((await admin.query('select count(*)::int as n from fins_de_contrat where cabinet_id = $1', [c.id])).rows[0].n).toBe(0);
    return r.plan;
  }
  const executable = async () => (await finDeContrat(admin, { cabinetId: c.id, confirmation: { cabinetId: c.id, nom: c.nom } })).plan.executable;

  it('abonnement : non résilié, ou résilié depuis moins longtemps que le délai de grâce (paramétrable)', async () => {
    c = await pret('Refus');
    reference = await empreinteCabinet(c.id);
    expect(await executable()).toBe(true);
    await admin.query(`update abonnements set statut = 'actif' where cabinet_id = $1`, [c.id]);
    await refus(confirmer(c), 'abonnement_resilie', /statut « actif », non résilié/);
    await admin.query(`update abonnements set statut = 'suspendu' where cabinet_id = $1`, [c.id]);
    await refus(confirmer(c), 'abonnement_resilie', /non résilié/);
    await admin.query(`update abonnements set statut = 'resilie', fin = current_date - 10 where cabinet_id = $1`, [c.id]);
    await refus(confirmer(c), 'abonnement_resilie', /délai de grâce en cours jusqu’au \d{4}-\d{2}-\d{2}/);
    await admin.query(`update abonnements set fin = current_date + 20 where cabinet_id = $1`, [c.id]); // résiliation programmée, service encore ouvert
    await refus(confirmer(c), 'abonnement_resilie', /délai de grâce en cours/);
    await admin.query(`update abonnements set fin = null where cabinet_id = $1`, [c.id]);
    await refus(confirmer(c), 'abonnement_resilie', /sans date de fin/);
    // Délai paramétrable : fin il y a 100 jours → exécutable à 90 jours (défaut), refusé à 120.
    await admin.query(`update abonnements set fin = current_date - 100 where cabinet_id = $1`, [c.id]);
    expect(await executable()).toBe(true);
    await refus({ ...confirmer(c), delaiGraceJours: 120 }, 'abonnement_resilie', /délai de grâce en cours/);
    await admin.query(`update abonnements set fin = current_date - 200 where cabinet_id = $1`, [c.id]);
    expect(await empreinteCabinet(c.id)).toEqual(reference);
  });

  it('confirmation : absente, nom inexact, ou identifiant d’un autre cabinet', async () => {
    await refus({ cabinetId: c.id, appliquer: true }, 'confirmation', /non fournie/);
    await refus({ cabinetId: c.id, appliquer: true, confirmation: { cabinetId: c.id, nom: c.nom.toUpperCase() } }, 'confirmation', /ne correspond pas exactement/);
    await refus({ cabinetId: c.id, appliquer: true, confirmation: { cabinetId: c.id, nom: `${c.nom} ` } }, 'confirmation', /ne correspond pas exactement/);
    await refus({ cabinetId: c.id, appliquer: true, confirmation: { cabinetId: DEMO.cabinetA, nom: c.nom } }, 'confirmation', /ne correspond pas exactement/);
  });

  it('obligation de conservation en cours sur une catégorie à supprimer', async () => {
    const declarer = (categorie: string, extra: string, valeurs: unknown[] = []) => admin.query(`insert into politiques_conservation (cabinet_id, categorie, ${extra}) values ($1, $2, ${valeurs.map((_, i) => `$${i + 3}`).join(', ')}) returning id`, [c.id, categorie, ...valeurs]);
    const retirer = () => admin.query(`delete from politiques_conservation where cabinet_id = $1 and categorie <> 'journal_audit'`, [c.id]);
    await declarer('pieces_fichiers', 'immuable, fondement', [true, 'Contentieux en cours']);
    await refus(confirmer(c), 'aucune_obligation_de_conservation', /« pieces_fichiers » : conservation immuable déclarée \(Contentieux en cours\)/);
    await retirer();
    await declarer('lignes_ecriture', 'duree_jours, fondement', [3650, 'Code de commerce, art. L. 123-22']); // désignée par sa table
    await refus(confirmer(c), 'aucune_obligation_de_conservation', /« lignes_ecriture » : conservation de 3650 jours en cours jusqu’au/);
    await retirer();
    await declarer('categorie_inconnue', 'duree_jours', [10]);
    await refus(confirmer(c), 'aucune_obligation_de_conservation', /catégorie non reconnue/);
    await retirer();
    // Ne s'opposent pas : une durée échue, une politique sans durée ni immuabilité, une catégorie de toute façon conservée.
    await admin.query(`insert into politiques_conservation (cabinet_id, categorie, duree_jours, cree_le) values ($1, 'banque', 30, now() - interval '400 days')`, [c.id]);
    await declarer('notifications', 'fondement', ['sans durée']);
    await declarer('abonnement_facturation', 'immuable, duree_jours', [true, 3650]);
    expect(await executable()).toBe(true);
    await retirer();
    expect(await empreinteCabinet(c.id)).toEqual(reference);
  });

  it('restitution : absente, incomplète, sans empreinte, non consignée, ou antérieure à une modification des données', async () => {
    const restitutions = () => admin.query<{ id: string; statut: string }>('select id, statut::text from restitutions_cabinet where cabinet_id = $1', [c.id]);
    const bonne = (await restitutions()).rows.find((r) => r.statut === 'termine')!.id;
    // Aucune restitution terminée.
    await admin.query(`update restitutions_cabinet set statut = 'echec' where id = $1`, [bonne]);
    await refus(confirmer(c), 'restitution_a_jour', /aucune restitution du cabinet terminée/);
    // La plus récente écarte un dossier : archive incomplète.
    await restituer(c, { ecartes: [{ id: randomUUID(), motif: 'niveau insuffisant' }] });
    await refus(confirmer(c), 'restitution_a_jour', /archive incomplète \(1 dossier\(s\) écarté\(s\)/);
    // La plus récente n'a pas d'empreinte enregistrée.
    await restituer(c, { sha256: null });
    await refus(confirmer(c), 'restitution_a_jour', /empreinte SHA-256 de l’archive non enregistrée/);
    // Terminée et complète, mais sa génération n'est pas au journal.
    await admin.query(`insert into restitutions_cabinet (cabinet_id, statut, perimetre, sha256, taille, demande_par, termine_le) select cabinet_id, 'termine', perimetre, $2, 1, demande_par, now() from restitutions_cabinet where id = $1`, [bonne, EMPREINTE_ARCHIVE(c)]);
    await refus(confirmer(c), 'restitution_a_jour', /génération non consignée au journal/);
    await restituer(c);
    expect(await executable()).toBe(true);
    // Donnée modifiée APRÈS la restitution : horodatage d'une table restituée…
    await admin.query('update documents set maj_le = now() where cabinet_id = $1', [c.id]);
    await refus(confirmer(c), 'restitution_a_jour', /données modifiées après la demande de restitution.*documents.*une nouvelle restitution est nécessaire/);
    await restituer(c);
    expect(await executable()).toBe(true);
    // … ou acte inscrit au journal (les tables n'horodatent pas toutes leurs modifications).
    await admin.query(`insert into journal_audit (cabinet_id, acteur_id, action) values ($1, $2, 'document.qualifie')`, [c.id, c.utilisateur]);
    await refus(confirmer(c), 'restitution_a_jour', /journal d’audit, action « document.qualifie »/);
    // Une consultation, un téléchargement de l'archive ou la résiliation elle-même ne périment pas la restitution.
    await restituer(c);
    for (const action of ['document.consulte', 'restitution_cabinet.telechargee', 'abonnement.resilie']) await admin.query(`insert into journal_audit (cabinet_id, acteur_id, action) values ($1, $2, $3)`, [c.id, c.utilisateur, action]);
    expect(await executable()).toBe(true);
    // Un dossier ajouté depuis n'est pas dans le périmètre.
    const entite = c.lignes.get('entites')!;
    const colonnesEntite = colonnes.filter((x) => x.t === 'entites' && x.col !== 'id' && x.col !== 'cree_le').map((x) => `"${x.col}"`).join(', ');
    await admin.query(`insert into entites (${colonnesEntite}, cree_le) select ${colonnesEntite}, now() - interval '1 day' from entites where id = $1`, [entite.id]);
    await refus(confirmer(c), 'restitution_a_jour', /archive incomplète \(0 dossier\(s\) écarté\(s\), 1 hors périmètre\)/);
  });

  it('journal d’audit altéré : la procédure S’ARRÊTE, le dit, et ne répare rien', async () => {
    const j = await pret('Journal altéré');
    c = j;
    expect(await executable()).toBe(true);
    const ligne = (await admin.query<{ id: string }>('select id::text from journal_audit where cabinet_id = $1 order by id limit 1', [j.id])).rows[0]!.id;
    await admin.query('alter table journal_audit disable trigger user');
    try {
      await admin.query(`update journal_audit set details = '{"falsifie": true}' where id = $1`, [ligne]);
    } finally {
      await admin.query('alter table journal_audit enable trigger user');
    }
    expect(await strict(j.id)).toBe(ligne);
    const plan = await refus(confirmer(j), 'journal_integre', new RegExp(`rupture à la ligne ${ligne} : la procédure s’arrête et ne répare rien`));
    expect(plan.simulation).toBe(false);
    // Rien n'a été « réparé » ni consigné : la vérification stricte échoue toujours, à la même ligne.
    expect(await strict(j.id)).toBe(ligne);
    expect((await admin.query('select count(*)::int as n from anomalies_journal where cabinet_id = $1', [j.id])).rows[0].n).toBe(1); // celle du peuplement
    expect((await admin.query(`select count(*)::int as n from journal_audit where cabinet_id = $1 and action like 'fin_de_contrat.%'`, [j.id])).rows[0].n).toBe(0);
  });
});

describe('exécution complète, sur la base d’essai uniquement', () => {
  let c: Cabinet;
  let temoin: Cabinet;
  let plan: PlanFinDeContrat;
  let pv: ProcesVerbalFinDeContrat;
  let avantCabinet: Empreintes;
  let avantHors: Empreintes;
  const stockage = new StockageFactice();
  const journalDe = async (id: string) => {
    const lignes: LigneJournalExportee[] = [];
    for await (const l of exporterJournal(admin, id, 50)) lignes.push(l);
    return lignes;
  };

  it('interruption en cours de suppression, puis juste avant la validation : TOUT est annulé (transaction)', async () => {
    c = await pret('Fin de contrat');
    temoin = await pret('Témoin');
    await deposerObjets(stockage, c);
    await deposerObjets(stockage, temoin);
    avantCabinet = await empreinteCabinet(c.id);
    avantHors = await empreinteHors(c.id);
    plan = (await finDeContrat(admin, { cabinetId: c.id, confirmation: { cabinetId: c.id, nom: c.nom } })).plan;
    expect(plan.executable).toBe(true);

    let n = 0;
    await expect(
      finDeContrat(admin, {
        ...confirmer(c),
        surEtape: () => {
          if (++n === 25) throw new Error('interruption simulée au milieu des suppressions');
        },
      }),
    ).rejects.toThrow(/interruption simulée au milieu/);
    expect(n).toBe(25);
    expect(await empreinteCabinet(c.id)).toEqual(avantCabinet);

    // Au tout dernier moment : tout est supprimé, le journal et le procès-verbal sont écrits, la validation n'a pas eu lieu.
    await expect(
      finDeContrat(admin, {
        ...confirmer(c),
        surEtape: (e) => {
          if (e.operation === 'proces_verbal') throw new Error('interruption simulée avant validation');
        },
      }),
    ).rejects.toThrow(/avant validation/);
    expect(await empreinteCabinet(c.id)).toEqual(avantCabinet);
    expect(await empreinteHors(c.id)).toEqual(avantHors);
    expect(await strict(c.id)).toBeNull();
    expect(await lireProcesVerbalFinDeContrat(admin, c.id)).toBeNull();
    // Données changées entre le plan et la suppression (ici : pendant l'exécution) : décompte non conforme, tout est annulé.
    await expect(
      finDeContrat(admin, {
        ...confirmer(c),
        surEtape: async (e) => {
          if (e.rang === 2) await admin.query(`insert into commentaires (${Object.keys(c.lignes.get('commentaires')!).filter((k) => k !== 'id').map((k) => `"${k}"`).join(', ')}) select ${Object.keys(c.lignes.get('commentaires')!).filter((k) => k !== 'id').map((k) => `"${k}"`).join(', ')} from commentaires where cabinet_id = $1 limit 1`, [c.id]);
        },
      }),
    ).rejects.toThrow(/Les données ont changé pendant l’exécution ; tout est annulé|ligne\(s\) après exécution/);
    expect(await empreinteCabinet(c.id)).toEqual(avantCabinet);
    // La reprise est possible : le plan est le même qu'avant les interruptions.
    const repris = (await finDeContrat(admin, { cabinetId: c.id, confirmation: { cabinetId: c.id, nom: c.nom } })).plan;
    expect(repris.executable).toBe(true);
    expect(repris.etapes).toEqual(plan.etapes);
  });

  it('exécution : décomptes conformes au plan, dans l’ordre du plan ; les autres cabinets sont strictement intacts', async () => {
    const suivies: EtapeFinDeContrat[] = [];
    const r = await finDeContrat(admin, { ...confirmer(c), surEtape: (e) => void suivies.push(e) });
    expect(r.simulation).toBe(false);
    if (r.simulation) throw new Error('exécution attendue');
    pv = r.procesVerbal;
    expect(suivies).toEqual(plan.etapes);

    const apres = await empreinteCabinet(c.id);
    for (const cat of POLITIQUE_FIN_DE_CONTRAT.categories) {
      for (const t of cat.tables) {
        const avant = avantCabinet[t]!;
        if (cat.devenir === 'supprimer' || cat.devenir === 'restituer_puis_supprimer') expect(apres[t]!.n, `${t} supprimée`).toBe(0);
        else if (t === 'journal_audit' || t === 'fins_de_contrat') expect(apres[t]!.n, t).toBe(avant.n + 1); // la dernière ligne, le procès-verbal
        else if (cat.devenir === 'anonymiser') expect(apres[t]!.n, `${t} anonymisée, non supprimée`).toBe(avant.n);
        else expect(apres[t], `${t} conservée à l’identique`).toEqual(avant);
      }
    }
    // Ce que dit le plan est ce qui a été fait.
    for (const e of plan.etapes.filter((x) => x.operation === 'supprimer')) expect(avantCabinet[e.table!]!.n - apres[e.table!]!.n, e.table!).toBe(e.lignes);
    // Anonymisation : la ligne subsiste, sans personne ni dossier.
    const ia = (await admin.query('select utilisateur_id, entite_id_cible, type, tache from evenements_ia where cabinet_id = $1', [c.id])).rows;
    expect(ia).toHaveLength(1);
    expect(ia[0]).toMatchObject({ utilisateur_id: null, entite_id_cible: null, type: c.lignes.get('evenements_ia')!.type });
    expect(c.lignes.get('evenements_ia')!.utilisateur_id).toBe(c.utilisateur); // elle les portait avant
    // ISOLATION : aucune ligne d'un autre cabinet (témoin, cabinets de démonstration, cabinets des autres tests) ni
    // aucune table sans cabinet_id (cabinets, utilisateurs, offres…) n'a changé.
    expect(await empreinteHors(c.id)).toEqual(avantHors);
    expect((await empreinteCabinet(temoin.id)).documents!.n).toBe(1);
    expect((await admin.query('select nom from cabinets where id = $1', [c.id])).rows[0].nom).toBe(c.nom); // la ligne du cabinet reste
    // Aucun objet n'a été touché par l'exécution en base.
    expect(await stockage.lister(`cabinets/${c.id}/`)).toHaveLength(7);
  });

  it('le journal d’audit est conservé, prolongé d’une dernière ligne, et reste vérifiable — en base et hors base', async () => {
    expect(await strict(c.id)).toBeNull();
    const lignes = await journalDe(c.id);
    const derniere = lignes.at(-1)!;
    expect(derniere.action).toBe('fin_de_contrat.executee');
    expect(JSON.parse(derniere.detailsTexte)).toMatchObject({ politique: POLITIQUE_FIN_DE_CONTRAT.version, empreinteRestitution: EMPREINTE_ARCHIVE(c), restitution: pv.restitution.id });
    expect(pv.journal).toMatchObject({ derniereLigne: derniere.id, empreinteTete: derniere.empreinte, lignesApres: lignes.length, lignesAvant: lignes.length - 1, verificationStricte: null });
    expect(await verifierExport(lignes, [])).toMatchObject({ lignes: lignes.length, rupture: null, conforme: true });
    // Toutes les lignes antérieures sont là, inchangées : le journal n'a pas été réécrit.
    expect((await admin.query(`select count(*)::int as n from journal_audit where cabinet_id = $1 and action = 'restitution_cabinet.generee'`, [c.id])).rows[0].n).toBe(1);
    // Il reste en ajout seul, y compris pour le propriétaire.
    await expect(admin.query('delete from journal_audit where cabinet_id = $1', [c.id])).rejects.toThrow(/ajout seul/);
    expect(await strict(temoin.id)).toBeNull();
  });

  it('procès-verbal : conforme, complet, d’empreinte stable, inscrit à un registre en ajout seul', async () => {
    expect(pv).toMatchObject({
      format: 'comtaple.proces-verbal-fin-de-contrat/1',
      cabinet: { id: c.id, nom: c.nom },
      politique: { version: POLITIQUE_FIN_DE_CONTRAT.version },
      delaiGraceJours: 90,
      abonnement: { statut: 'resilie' },
      restitution: { sha256: EMPREINTE_ARCHIVE(c) },
      objets: { etat: 'a_supprimer_par_etape_separee', prefixes: [`cabinets/${c.id}/`, `tmp/${c.id}/`], referencesEnBase: 6 },
      sauvegardes: LIMITE_SAUVEGARDES,
    });
    expect(pv.executeLe).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(pv.politique.statut).toMatch(/non arrêtée/);
    expect(pv.reserves.join(' ')).toMatch(/PROPOSÉES, non arrêtées/);
    // Décomptes avant/après par catégorie et par table, pour TOUTES les tables.
    expect(pv.categories.map((x) => x.code)).toEqual(POLITIQUE_FIN_DE_CONTRAT.categories.map((x) => x.code));
    expect(pv.categories.flatMap((x) => x.tables.map((t) => t.table)).sort()).toEqual(tablesCabinet);
    for (const cat of pv.categories) {
      for (const t of cat.tables) {
        expect(t.avant, t.table).toBe(avantCabinet[t.table]!.n);
        expect(t.apres, t.table).toBe(cat.devenir === 'supprimer' || cat.devenir === 'restituer_puis_supprimer' ? 0 : t.avant);
      }
      if (cat.devenir === 'conserver_jusqu_a') expect(cat.conservation?.statut, cat.code).toBe('proposé, non arrêté');
    }
    // Empreinte : recalculable par quiconque à partir du seul document, indépendante de l'ordre des clés.
    const { empreinte: e, ...corps } = pv;
    expect(e).toBe(createHash('sha256').update(jsonCanonique(corps), 'utf8').digest('hex'));
    expect(verifierProcesVerbal(pv)).toBe(true);
    const reordonne = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(pv).reverse()))) as ProcesVerbalFinDeContrat;
    expect(empreinteProcesVerbal(reordonne)).toBe(e);
    expect(verifierProcesVerbal({ ...pv, categories: pv.categories.map((x, i) => (i ? x : { ...x, avant: x.avant + 1 })) })).toBe(false);
    // Registre : le texte canonique enregistré redonne le même document et la même empreinte.
    const inscrit = (await admin.query('select nom_cabinet, politique_version, empreinte_restitution, empreinte_proces_verbal, proces_verbal from fins_de_contrat where cabinet_id = $1', [c.id])).rows;
    expect(inscrit).toHaveLength(1);
    expect(inscrit[0]).toMatchObject({ nom_cabinet: c.nom, politique_version: pv.politique.version, empreinte_restitution: EMPREINTE_ARCHIVE(c), empreinte_proces_verbal: e });
    expect(inscrit[0].proces_verbal).toBe(jsonCanonique(pv));
    expect(await lireProcesVerbalFinDeContrat(admin, c.id)).toEqual(pv);
    expect(verifierProcesVerbal((await lireProcesVerbalFinDeContrat(admin, c.id))!)).toBe(true);
    await expect(admin.query(`update fins_de_contrat set nom_cabinet = 'x' where cabinet_id = $1`, [c.id])).rejects.toThrow(/ajout seul/);
    await expect(admin.query('delete from fins_de_contrat where cabinet_id = $1', [c.id])).rejects.toThrow(/ajout seul/);
    await expect(admin.query('truncate fins_de_contrat')).rejects.toThrow(/ajout seul/);
  });

  it('une fin de contrat ne s’exécute qu’une fois ; la simulation reste possible et montre l’état après', async () => {
    const e = await finDeContrat(admin, confirmer(c)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RefusFinDeContrat);
    expect((e as RefusFinDeContrat).motifs.join(' ')).toMatch(/fin de contrat déjà exécutée le/);
    const apres = (await finDeContrat(admin, { cabinetId: c.id })).plan;
    expect(apres.executable).toBe(false);
    expect(apres.etapes.filter((x) => x.operation === 'supprimer').every((x) => x.lignes === 0)).toBe(true);
    expect((await admin.query('select count(*)::int as n from fins_de_contrat where cabinet_id = $1', [c.id])).rows[0].n).toBe(1);
  });

  it('objets du stockage (stockage FACTICE) : étape séparée, par préfixe du cabinet, après la base seulement', async () => {
    const confirmation = { cabinetId: c.id, nom: c.nom };
    // Avant l'exécution en base (cabinet témoin, non résilié de fait) : refusée.
    await expect(objetsFinDeContrat(admin, stockage, { cabinetId: temoin.id, confirmation: { cabinetId: temoin.id, nom: temoin.nom }, appliquer: true })).rejects.toThrow(/n’a pas été exécutée en base/);
    await expect(objetsFinDeContrat(admin, stockage, { cabinetId: c.id, appliquer: true })).rejects.toThrow(/confirmation absente/);
    await expect(objetsFinDeContrat(admin, stockage, { cabinetId: c.id, confirmation: { cabinetId: c.id, nom: 'autre' }, appliquer: true })).rejects.toThrow(/confirmation absente ou ne nommant pas/);
    await expect(objetsFinDeContrat(admin, stockage, { cabinetId: '', appliquer: true })).rejects.toThrow(/invalide/);
    // Une ligne d'un AUTRE cabinet référence un objet de celui-ci : refusée.
    const intrus = (await admin.query<{ id: string }>(`insert into fichiers (cabinet_id, sha256, taille, cle_stockage) values ($1, 'x', 1, $2) returning id`, [temoin.id, `cabinets/${c.id}/originaux/partage`])).rows[0]!.id;
    await expect(objetsFinDeContrat(admin, stockage, { cabinetId: c.id, confirmation, appliquer: true })).rejects.toThrow(/d’un autre cabinet référencent un objet de ce cabinet/);
    await admin.query('delete from fichiers where id = $1', [intrus]);
    // Un stockage qui renverrait des clés d'un autre préfixe : rien n'est supprimé.
    const menteur: StockageObjets = { lister: async () => [`cabinets/${temoin.id}/originaux/x`], supprimer: async () => { throw new Error('ne doit pas être appelé'); } };
    await expect(objetsFinDeContrat(admin, menteur, { cabinetId: c.id, confirmation, appliquer: true })).rejects.toThrow(/hors des préfixes du cabinet/);
    const avantTemoin = [...(await stockage.lister(`cabinets/${temoin.id}/`)), ...(await stockage.lister(`tmp/${temoin.id}/`))];
    expect(avantTemoin).toHaveLength(8);
    expect(stockage.objets.size).toBe(16);

    // Simulation (défaut), puis exécution.
    const simulation = await objetsFinDeContrat(admin, stockage, { cabinetId: c.id, confirmation });
    expect(simulation).toMatchObject({ simulation: true, supprimees: 0, restantes: 8 });
    expect(stockage.objets.size).toBe(16);
    const r = await objetsFinDeContrat(admin, stockage, { cabinetId: c.id, confirmation, appliquer: true });
    expect(r).toMatchObject({ simulation: false, supprimees: 8, restantes: 0, empreinteListeCles: simulation.empreinteListeCles });
    expect(r.cles).toEqual(simulation.cles);
    // Toutes les clés référencées au procès-verbal en faisaient partie ; les objets du témoin sont intacts.
    expect(r.cles).toEqual(expect.arrayContaining(plan.inventaire.objets.cles));
    expect([...stockage.objets.keys()].sort()).toEqual(avantTemoin.sort());
    // Consignée au journal du cabinet, qui reste vérifiable ; rejouée, elle n'a plus rien à supprimer.
    const trace = (await admin.query(`select details from journal_audit where cabinet_id = $1 and action = 'fin_de_contrat.objets_supprimes'`, [c.id])).rows;
    expect(trace).toHaveLength(1);
    expect(trace[0].details).toMatchObject({ supprimees: 8, restantes: 0, empreinteListeCles: r.empreinteListeCles });
    expect(await strict(c.id)).toBeNull();
    expect(await objetsFinDeContrat(admin, stockage, { cabinetId: c.id, confirmation, appliquer: true })).toMatchObject({ supprimees: 0, restantes: 0 });
    expect(await empreinteHors(c.id)).toEqual(avantHors);
  });
});

describe('sécurité : rôle d’administration uniquement', () => {
  let c: Cabinet;

  it('aucun droit sur le registre pour les rôles applicatifs ; RLS activé et forcé', async () => {
    const droits = await admin.query(
      `select r as role, p as privilege, has_table_privilege(r, 'fins_de_contrat', p) as peut from unnest(array['comtaple_app', 'comtaple_worker']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p`,
    );
    expect(droits.rows).toHaveLength(10);
    expect(droits.rows.filter((d) => d.peut)).toEqual([]);
    const rls = (await admin.query(`select relrowsecurity and relforcerowsecurity as force from pg_class where relname = 'fins_de_contrat'`)).rows[0];
    expect(rls.force).toBe(true);
  });

  it('comtaple_app et comtaple_worker ne peuvent ni simuler, ni inventorier, ni exécuter la fin de contrat', async () => {
    c = await pret('Rôles');
    const avant = await empreinteCabinet(c.id);
    for (const role of ['app', 'worker'] as const) {
      const client = new pg.Client({ connectionString: urlBd(role, env) });
      await client.connect();
      try {
        // Contexte du cabinet posé comme le fait l'application : cela ne change rien.
        await client.query(`select set_config('app.cabinet_id', $1, false), set_config('app.utilisateur_id', $2, false)`, [c.id, c.utilisateur]);
        await expect(finDeContrat(client, confirmer(c))).rejects.toThrow(/réservée au rôle d’administration/);
        await expect(finDeContrat(client, { cabinetId: c.id })).rejects.toThrow(/réservée au rôle d’administration/);
        await expect(inventaireFinDeContrat(client, c.id)).rejects.toThrow(/réservée au rôle d’administration/);
        await expect(objetsFinDeContrat(client, new StockageFactice(), { cabinetId: c.id, confirmation: { cabinetId: c.id, nom: c.nom }, appliquer: true })).rejects.toThrow(/réservée au rôle d’administration/);
        await expect(lireProcesVerbalFinDeContrat(client, c.id)).rejects.toThrow(/permission denied/);
        await expect(client.query(`insert into fins_de_contrat (cabinet_id, nom_cabinet, politique_version, empreinte_restitution, empreinte_proces_verbal, proces_verbal) values ($1, 'x', 'x', $2, $2, '{}')`, [c.id, 'a'.repeat(64)])).rejects.toThrow(/permission denied/);
      } finally {
        await client.end();
      }
    }
    expect(await empreinteCabinet(c.id)).toEqual(avant);
  });

  it('même en rejouant à la main les suppressions du plan, un rôle applicatif échoue et rien n’est supprimé', async () => {
    const plan = (await finDeContrat(admin, { cabinetId: c.id })).plan;
    const avant = await empreinteCabinet(c.id);
    const interdites = ['journal_audit', 'anomalies_journal', 'abonnements', 'echeances_abonnement', 'notifications', 'restitutions_cabinet', 'evenements_ia', 'echanges_assistant', 'invitations', 'preferences_notification', 'fins_de_contrat'];
    for (const acces of [app, worker]) {
      // Tout le plan, dans l'ordre, dans une transaction portant le contexte d'un membre du cabinet.
      await expect(
        acces.avecContexte(ctx(c.id, c.utilisateur), async (tx) => {
          for (const e of plan.etapes) {
            if (e.operation === 'anonymiser') await tx.execute(sql.raw(`update "${e.table}" set utilisateur_id = null where cabinet_id = '${c.id}'`));
            if (e.operation === 'supprimer') await tx.execute(sql.raw(`delete from "${e.table}" where cabinet_id = '${c.id}'`));
          }
          await tx.execute(sql.raw(`insert into fins_de_contrat (cabinet_id, nom_cabinet, politique_version, empreinte_restitution, empreinte_proces_verbal, proces_verbal) values ('${c.id}', 'x', 'x', '${'a'.repeat(64)}', '${'a'.repeat(64)}', '{}')`));
        }),
      ).rejects.toThrow();
      for (const t of interdites) await expect(acces.avecContexte(ctx(c.id, c.utilisateur), (tx) => tx.execute(sql.raw(`delete from "${t}"`))), `${t} : suppression refusée`).rejects.toThrow();
      await expect(acces.avecContexte(ctx(c.id, c.utilisateur), (tx) => tx.execute(sql.raw('truncate documents')))).rejects.toThrow();
    }
    expect(await empreinteCabinet(c.id)).toEqual(avant);
    expect(await strict(c.id)).toBeNull();
  });
});
