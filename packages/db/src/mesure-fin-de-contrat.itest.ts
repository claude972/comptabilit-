/**
 * MESURE de la transaction de fin de contrat sur un volume réaliste (D-099) — base JETABLE, jamais la base de développement.
 *
 * Désactivée par défaut (le peuplement et l'exécution prennent de longues minutes) : `MESURE_FIN_DE_CONTRAT=1`.
 * Réglages : MESURE_DOSSIERS (50), MESURE_LIGNES_PAR_DOSSIER (10000), MESURE_PIECES_PAR_DOSSIER (100).
 * Le test crée une base `comtaple_essai_mesure_…`, y peuple UN cabinet synthétique volumineux, exécute la fin de contrat
 * RÉELLE (`appliquer: true`) sur ce cabinet, mesure, consigne les chiffres dans var/mesures/fin-de-contrat-<date>.json,
 * puis supprime la base.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BaseJetable, creerBaseJetable } from './base-jetable.js';
import { chargerParametres } from './durees-conservation.js';
import { urlBd } from './index.js';
import { creerPeuplement } from './peuplement-essai.js';
import { OFFRES_DEMO, POLITIQUE_FIN_DE_CONTRAT, definirOffre, finDeContrat } from './provisionnement.js';
import { simulerConservationCabinet } from './simulation-conservation.js';

const ACTIF = process.env.MESURE_FIN_DE_CONTRAT === '1';
const N_DOSSIERS = Number(process.env.MESURE_DOSSIERS ?? 50);
const LIGNES = Number(process.env.MESURE_LIGNES_PAR_DOSSIER ?? 10_000);
const PIECES = Number(process.env.MESURE_PIECES_PAR_DOSSIER ?? 100);
const MOUVEMENTS = 400;
const JOURNAL = 20_000;
const REF = 'AVIS-ESSAI-MESURE-1';

let base: BaseJetable;
const ms = (t0: number) => Math.round(performance.now() - t0);

describe.skipIf(!ACTIF)('mesure de la transaction de fin de contrat', () => {
  beforeAll(async () => {
    base = await creerBaseJetable('mesure');
  }, 300_000);
  afterAll(async () => {
    await base?.detruire();
  }, 120_000);

  it('cabinet synthétique volumineux : durée, verrous, mémoire, volume écrit de la transaction réelle', async () => {
    const { admin } = base;
    expect((await admin.query<{ b: string }>('select current_database() as b')).rows[0]!.b).toMatch(/^comtaple_essai_mesure_/);
    for (const o of OFFRES_DEMO) await definirOffre(admin, o);
    const P = creerPeuplement(admin);
    await P.lireCatalogue();

    // ── 1. Peuplement ────────────────────────────────────────────────────────────────────────────────────────────
    const tPeuplement = performance.now();
    const c = await P.peupler('Cabinet volumineux');
    const ligne = (t: string) => c.lignes.get(t)!;
    const E0 = ligne('entites').id as string;
    const cab = c.id;
    const clone = async (table: string, n: number, surcharges: string, ou: string, source = table, params: unknown[] = []) =>
      admin.query(`insert into "${table}" select (jsonb_populate_record(null::"${table}", to_jsonb(x) || jsonb_build_object(${surcharges}))).* from "${source}" x, generate_series(1, ${n}) g where ${ou}`, params);
    const entites: string[] = [E0];
    for (let i = 1; i < N_DOSSIERS; i++) {
      const r = await admin.query<{ id: string }>(`insert into entites select (jsonb_populate_record(null::entites, to_jsonb(x) || jsonb_build_object('id', gen_random_uuid(), 'raison_sociale', 'Dossier synthétique ' || $2::text))).* from entites x where x.id = $1 returning id`, [E0, i]);
      entites.push(r.rows[0]!.id);
    }
    const X0 = ligne('exercices').id as string;
    const L0 = ligne('lots_import').id as string;
    const D0 = ligne('documents').id as string;
    const F0 = ligne('fichiers').id as string;
    const R0 = ligne('releves_bancaires').id as string;
    const uuidDe = (expr: string) => `md5(${expr})::uuid`;
    for (let i = 0; i < entites.length; i++) {
      const e = entites[i]!;
      const tag = `'${i}'`;
      const X = i === 0 ? X0 : (await admin.query<{ id: string }>(`insert into exercices select (jsonb_populate_record(null::exercices, to_jsonb(x) || jsonb_build_object('id', gen_random_uuid(), 'entite_id', $2::uuid))).* from exercices x where x.id = $1 returning id`, [X0, e])).rows[0]!.id;
      const L = i === 0 ? L0 : (await admin.query<{ id: string }>(`insert into lots_import select (jsonb_populate_record(null::lots_import, to_jsonb(x) || jsonb_build_object('id', gen_random_uuid(), 'entite_id', $2::uuid, 'exercice_id', $3::uuid, 'cle_idempotence', 'mesure-lot-' || $4::text))).* from lots_import x where x.id = $1 returning id`, [L0, e, X, i])).rows[0]!.id;
      // Pièces : fichiers → documents → extractions, pages, réceptions, passages de recherche (identifiants déterministes pour relier sans lecture).
      await clone('fichiers', PIECES, `'id', ${uuidDe(`${tag} || 'f' || g`)}, 'cle_stockage', 'cabinets/${cab}/essai/mesure-' || ${tag} || '-' || g`, 'x.id = $1', 'fichiers', [F0]);
      await clone('documents', PIECES, `'id', ${uuidDe(`${tag} || 'd' || g`)}, 'fichier_id', ${uuidDe(`${tag} || 'f' || g`)}, 'entite_id', '${e}', 'exercice_id', '${X}'`, 'x.id = $1', 'documents', [D0]);
      await clone('extractions', PIECES, `'id', ${uuidDe(`${tag} || 'x' || g`)}, 'document_id', ${uuidDe(`${tag} || 'd' || g`)}, 'entite_id', '${e}'`, `x.id = $1`, 'extractions', [ligne('extractions').id]);
      await clone('pages_document', PIECES * 2, `'id', gen_random_uuid(), 'document_id', ${uuidDe(`${tag} || 'd' || (1 + g % ${PIECES})`)}, 'entite_id', '${e}'`, `x.id = $1`, 'pages_document', [ligne('pages_document').id]);
      await clone('receptions', PIECES, `'id', gen_random_uuid(), 'document_id', ${uuidDe(`${tag} || 'd' || g`)}, 'entite_id', '${e}'`, `x.id = $1`, 'receptions', [ligne('receptions').id]);
      await clone('passages_recherche', PIECES, `'id', gen_random_uuid(), 'document_id', ${uuidDe(`${tag} || 'd' || g`)}, 'entite_id', '${e}'`, `x.id = $1`, 'passages_recherche', [ligne('passages_recherche').id]);
      // Écritures : le gros du volume.
      await clone('lignes_ecriture', LIGNES, `'id', gen_random_uuid(), 'entite_id', '${e}', 'exercice_id', '${X}', 'lot_import_id', '${L}', 'numero_ligne', g, 'ecriture_num', 'EC' || g`, `x.id = $1`, 'lignes_ecriture', [ligne('lignes_ecriture').id]);
      await clone('mouvements_bancaires', MOUVEMENTS, `'id', gen_random_uuid(), 'entite_id', '${e}', 'lot_import_id', '${L}', 'cle_idempotence', 'mesure-' || ${tag} || '-' || g`, `x.id = $1`, 'mouvements_bancaires', [ligne('mouvements_bancaires').id]);
      await clone('decisions', PIECES, `'id', gen_random_uuid(), 'entite_id', '${e}'`, `x.id = $1`, 'decisions', [ligne('decisions').id]);
    }
    await admin.query(`insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id, details) select $1, 'systeme', 'essai.volume', 'cabinet', g::text, '{}' from generate_series(1, $2) g`, [cab, JOURNAL]);
    await admin.query('analyze');
    const msPeuplement = ms(tPeuplement);
    await P.restituer(c);

    const compte = async (t: string) => Number((await admin.query<{ n: string }>(`select count(*) as n from "${t}" where cabinet_id = $1`, [cab])).rows[0]!.n);
    const volume = {
      dossiers: await compte('entites'),
      lignes_ecriture: await compte('lignes_ecriture'),
      fichiers: await compte('fichiers'),
      documents: await compte('documents'),
      extractions: await compte('extractions'),
      pages_document: await compte('pages_document'),
      receptions: await compte('receptions'),
      mouvements_bancaires: await compte('mouvements_bancaires'),
      decisions: await compte('decisions'),
      journal_audit: await compte('journal_audit'),
    };
    const totalLignes = (await admin.query<{ n: string }>(`select sum(n)::text as n from (${P.tablesCabinet.map((t) => `select count(*) as n from "${t}" where cabinet_id = '${cab}'`).join(' union all ')}) s`)).rows[0]!.n;
    const taille = (await admin.query<{ o: string }>(`select pg_size_pretty(pg_database_size(current_database())) as o`)).rows[0]!.o;
    const reglages = Object.fromEntries((await admin.query<{ name: string; setting: string; unit: string | null }>(`select name, setting, unit from pg_settings where name in ('shared_buffers','work_mem','maintenance_work_mem','max_locks_per_transaction','max_connections','synchronous_commit','wal_level','max_wal_size')`)).rows.map((r) => [r.name, `${r.setting}${r.unit ?? ''}`]));
    expect(volume.dossiers).toBe(N_DOSSIERS);
    expect(volume.lignes_ecriture).toBe(N_DOSSIERS * LIGNES + 1); // + la ligne modèle du peuplement générique

    // ── 2. Simulation (lecture seule) chronométrée ───────────────────────────────────────────────────────────────
    const t0sim = performance.now();
    const sim = await finDeContrat(admin, { cabinetId: cab, confirmation: { cabinetId: cab, nom: c.nom }, dureesValidees: REF });
    const msSimulation = ms(t0sim);
    expect(sim.simulation).toBe(true);
    expect(sim.plan.executable).toBe(true);
    const t0simcons = performance.now();
    await simulerConservationCabinet(admin, cab, chargerParametres(POLITIQUE_FIN_DE_CONTRAT.categories));
    const msSimulationConservation = ms(t0simcons);

    // ── 3. Exécution RÉELLE, instrumentée ────────────────────────────────────────────────────────────────────────
    const pidAdmin = (await admin.query<{ p: number }>('select pg_backend_pid() as p')).rows[0]!.p;
    const monitor = new pg.Client({ connectionString: urlBd('admin', base.env) });
    await monitor.connect();
    const autre = (await admin.query<{ id: string }>(`insert into cabinets (nom) values ('Autre cabinet (sonde)') returning id`)).rows[0]!.id;
    const lsn0 = (await admin.query<{ l: string }>('select pg_current_wal_lsn()::text as l')).rows[0]!.l;
    const stat0 = (await admin.query<{ tb: string; blks: string }>(`select temp_bytes::text as tb, (blks_read + blks_hit)::text as blks from pg_stat_database where datname = current_database()`)).rows[0]!;
    const rssNode0 = process.memoryUsage().rss;
    const echantillons: Array<{ t: number; verrous: number; rss: number; attente: string | null; xactMs: number | null }> = [];
    let pic = { verrous: 0, rssNode: rssNode0, heap: 0 };
    const t0 = performance.now();
    const minuteur = setInterval(() => {
      void (async () => {
        try {
          const r = await monitor.query<{ verrous: string; attente: string | null; xact: string | null }>(
            `select (select count(*) from pg_locks where pid = $1 and granted)::text as verrous, (select wait_event from pg_stat_activity where pid = $1) as attente, (select (extract(epoch from now() - xact_start) * 1000)::bigint::text from pg_stat_activity where pid = $1) as xact`,
            [pidAdmin],
          );
          const m = process.memoryUsage();
          pic = { verrous: Math.max(pic.verrous, Number(r.rows[0]!.verrous)), rssNode: Math.max(pic.rssNode, m.rss), heap: Math.max(pic.heap, m.heapUsed) };
          echantillons.push({ t: ms(t0), verrous: Number(r.rows[0]!.verrous), rss: m.rss, attente: r.rows[0]!.attente, xactMs: r.rows[0]!.xact === null ? null : Number(r.rows[0]!.xact) });
        } catch {
          // échantillon perdu
        }
      })();
    }, 200);

    // Sondes de concurrence, lancées à la première étape DE LA TRANSACTION (non attendues avant la fin).
    const sondes: Record<string, { demarreMs: number; dureeMs: number | null; erreur?: string }> = {};
    const clients: pg.Client[] = [];
    const lancer = async (nom: string, sql: string, params: unknown[]) => {
      const cl = new pg.Client({ connectionString: urlBd('admin', base.env) });
      clients.push(cl);
      await cl.connect();
      await cl.query(`set lock_timeout = '300s'`);
      sondes[nom] = { demarreMs: ms(t0), dureeMs: null };
      const t = performance.now();
      try {
        await cl.query(sql, params);
        sondes[nom]!.dureeMs = ms(t);
      } catch (e) {
        sondes[nom]!.erreur = (e as Error).message;
        sondes[nom]!.dureeMs = ms(t);
      }
    };
    const promesses: Promise<void>[] = [];
    const etapes: Array<{ operation: string; table: string | null; lignes: number | null; jusquaMs: number }> = [];
    let sondesLancees = false;
    let resultat: Awaited<ReturnType<typeof finDeContrat>>;
    try {
      resultat = await finDeContrat(admin, {
      cabinetId: cab,
      confirmation: { cabinetId: cab, nom: c.nom },
      dureesValidees: REF,
      appliquer: true,
      surEtape: (e) => {
        etapes.push({ operation: e.operation, table: e.table, lignes: e.lignes, jusquaMs: ms(t0) });
        if (!sondesLancees) {
          sondesLancees = true;
          promesses.push(lancer('lecture_meme_cabinet', 'select count(*) from lignes_ecriture where cabinet_id = $1', [cab]));
          promesses.push(lancer('ecriture_ligne_cabinet', 'update cabinets set nom = nom where id = $1', [cab]));
          promesses.push(lancer('ecriture_autre_cabinet', 'update cabinets set nom = nom where id = $1', [autre]));
          promesses.push(lancer('journal_autre_cabinet', `insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id) values ($1, 'systeme', 'essai.sonde', 'cabinet', 'x')`, [autre]));
        }
      },
    });
    } finally {
      clearInterval(minuteur);
      await Promise.allSettled(promesses);
      await monitor.end().catch(() => undefined);
      for (const cl of clients) await cl.end().catch(() => undefined);
    }
    const msTransaction = ms(t0);
    expect(resultat.simulation).toBe(false);

    // ── 4. Constats après coup ────────────────────────────────────────────────────────────────────────────────────
    const lsn1 = (await admin.query<{ l: string }>('select pg_current_wal_lsn()::text as l')).rows[0]!.l;
    const wal = Number((await admin.query<{ d: string }>('select pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn)::bigint::text as d', [lsn1, lsn0])).rows[0]!.d);
    const stat1 = (await admin.query<{ tb: string; blks: string }>(`select temp_bytes::text as tb, (blks_read + blks_hit)::text as blks from pg_stat_database where datname = current_database()`)).rows[0]!;
    // Mémoire du processus serveur de la transaction : pic de mémoire résidente (VmHWM) lu dans /proc, dans le conteneur.
    let backend: { vmhwmKo: number | null; vmrssKo: number | null } = { vmhwmKo: null, vmrssKo: null };
    try {
      const sortie = execFileSync('docker', ['exec', 'comtaple-postgres-1', 'sh', '-c', `grep -E '^(VmHWM|VmRSS):' /proc/${pidAdmin}/status`], { encoding: 'utf8' });
      backend = { vmhwmKo: Number(/VmHWM:\s+(\d+)/.exec(sortie)?.[1] ?? NaN), vmrssKo: Number(/VmRSS:\s+(\d+)/.exec(sortie)?.[1] ?? NaN) };
    } catch {
      // docker indisponible : non mesuré
    }
    const tStrict = performance.now();
    const strict = (await admin.query<{ r: string | null }>('select journal_audit_verifier($1)::text as r', [cab])).rows[0]!.r;
    const msVerifJournal = ms(tStrict);
    const reste = Number((await admin.query<{ n: string }>(`select sum(n)::text as n from (${P.tablesCabinet.map((t) => `select count(*) as n from "${t}" where cabinet_id = '${cab}'`).join(' union all ')}) s`)).rows[0]!.n);
    const pv = (resultat as Extract<typeof resultat, { simulation: false }>).procesVerbal;
    const supprimees = pv.categories.reduce((s, x) => s + (x.avant - x.apres), 0);
    const parEtape = etapes.map((e, i) => ({ ...e, dureeMs: e.jusquaMs - (i ? etapes[i - 1]!.jusquaMs : 0) })).sort((a, b) => b.dureeMs - a.dureeMs).slice(0, 8);
    const dockerVm = (() => {
      try {
        return execFileSync('docker', ['info', '--format', '{{.NCPU}} CPU, {{.MemTotal}} octets de mémoire'], { encoding: 'utf8' }).trim();
      } catch {
        return 'inconnu';
      }
    })();
    const mesures = {
      date: new Date().toISOString(),
      volume: { ...volume, lignesTousesTablesDuCabinet: Number(totalLignes), tailleBaseAvant: taille, peuplementMs: msPeuplement },
      machine: { hote: `${cpus().length} cœurs, ${Math.round(totalmem() / 2 ** 30)} Gio`, vmDocker: dockerVm, reglagesPostgres: reglages },
      simulation: { dureeMs: msSimulation, simulationConservationMs: msSimulationConservation },
      transaction: {
        dureeMs: msTransaction,
        lignesSupprimees: supprimees,
        lignesRestantes: reste,
        debitLignesParSeconde: Math.round((supprimees / msTransaction) * 1000),
        verrousPic: pic.verrous,
        walOctets: wal,
        tempOctets: Number(stat1.tb) - Number(stat0.tb),
        blocsLusOuEnCache: Number(stat1.blks) - Number(stat0.blks),
        memoireNode: { rssAvantMo: Math.round(rssNode0 / 2 ** 20), rssPicMo: Math.round(pic.rssNode / 2 ** 20), tasPicMo: Math.round(pic.heap / 2 ** 20) },
        memoireProcessusPostgres: { picResidentMo: backend.vmhwmKo === null ? null : Math.round(backend.vmhwmKo / 1024), residentFinMo: backend.vmrssKo === null ? null : Math.round(backend.vmrssKo / 1024) },
        etapesLesPlusLongues: parEtape,
        echantillons: echantillons.length,
      },
      verrous: { sondes, note: 'durée pendant laquelle chaque sonde, lancée au début de la transaction, a attendu' },
      apres: { verificationStrictJournal: strict, verificationJournalMs: msVerifJournal, journalLignes: pv.journal.lignesApres },
    };
    mkdirSync(join(process.cwd(), '..', '..', 'var', 'mesures'), { recursive: true });
    const chemin = join(process.cwd(), '..', '..', 'var', 'mesures', `fin-de-contrat-${new Date().toISOString().slice(0, 10)}.json`);
    writeFileSync(chemin, `${JSON.stringify(mesures, null, 2)}\n`);
    console.log(`MESURE ${readFileSync(chemin, 'utf8')}`);
    expect(strict).toBeNull();
    expect(supprimees).toBeGreaterThan(N_DOSSIERS * LIGNES);
    expect(sondes.lecture_meme_cabinet!.erreur).toBeUndefined();
  }, 3_600_000);
});
