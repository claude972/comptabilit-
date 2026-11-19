/**
 * Tests d'intégration sur un PostgreSQL réel : isolation entre cabinets, habilitation par dossier, journal d'audit.
 * Prérequis : services démarrés, migrations et amorçage appliqués (voir README).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO } from './amorcer.js';
import { chargerEnvLocal } from './env.js';
import { type AccesBd, creerAccesBd, eq, journaliser, schema as s, sql, urlBd } from './index.js';

chargerEnvLocal();
let app: AccesBd;
let worker: AccesBd;

const ctx = (cabinetId: string, utilisateurId: string) => ({ cabinetId, utilisateurId, sujet: utilisateurId });

beforeAll(() => {
  app = creerAccesBd(urlBd('app'));
  worker = creerAccesBd(urlBd('worker'));
});
afterAll(async () => {
  await app.fermer();
  await worker.fermer();
});

describe('rôles techniques', () => {
  it('le rôle applicatif ne peut pas contourner RLS et ne possède aucune table', async () => {
    const r = await app.pool.query(
      `select rolsuper, rolbypassrls, (select count(*)::int from pg_tables where tableowner = current_user) as tables
       from pg_roles where rolname = current_user`,
    );
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, tables: 0 });
  });

  it('toutes les tables portant cabinet_id ont RLS activé ET forcé', async () => {
    const r = await app.pool.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'cabinet_id' and not a.attisdropped)
         and not (c.relrowsecurity and c.relforcerowsecurity)`,
    );
    expect(r.rows).toEqual([]);
  });
});

describe('isolation entre cabinets', () => {
  it('sans contexte, aucune donnée n’est visible', async () => {
    const n = await app.avecContexte({}, (tx) => tx.select().from(s.entites));
    expect(n).toHaveLength(0);
  });

  it('un utilisateur du cabinet B ne voit aucun dossier du cabinet A', async () => {
    const vus = await app.avecContexte(ctx(DEMO.cabinetB, DEMO.bruno), (tx) => tx.select().from(s.entites));
    expect(vus.map((e) => e.id)).toEqual([DEMO.leroy]);
  });

  it('usurper le cabinet A avec un utilisateur du cabinet B ne donne accès à rien', async () => {
    const vus = await app.avecContexte(ctx(DEMO.cabinetA, DEMO.bruno), (tx) => tx.select().from(s.entites));
    expect(vus).toHaveLength(0);
    const exos = await app.avecContexte(ctx(DEMO.cabinetA, DEMO.bruno), (tx) => tx.select().from(s.exercices));
    expect(exos).toHaveLength(0);
  });

  it('écrire dans un autre cabinet est refusé', async () => {
    await expect(
      app.avecContexte(ctx(DEMO.cabinetB, DEMO.bruno), (tx) =>
        tx.insert(s.exercices).values({ cabinetId: DEMO.cabinetA, entiteId: DEMO.dupain, debut: '2030-01-01', fin: '2030-12-31' }),
      ),
    ).rejects.toThrow();
  });
});

describe('habilitation par dossier', () => {
  it('l’administratrice voit la liste des dossiers mais pas le contenu d’un dossier où elle n’est pas habilitée', async () => {
    const r = await app.avecContexte(ctx(DEMO.cabinetA, DEMO.alice), async (tx) => ({
      entites: await tx.select().from(s.entites),
      exercicesMartin: await tx.select().from(s.exercices).where(eq(s.exercices.entiteId, DEMO.martin)),
      exercicesDupain: await tx.select().from(s.exercices).where(eq(s.exercices.entiteId, DEMO.dupain)),
    }));
    // D'autres parcours créent des dossiers d'essai : on vérifie la présence des dossiers de démonstration, pas la liste exacte.
    expect(r.entites.map((e) => e.id)).toEqual(expect.arrayContaining([DEMO.dupain, DEMO.martin, DEMO.bellevue]));
    expect(r.entites.every((e) => e.cabinetId === DEMO.cabinetA)).toBe(true);
    expect(r.exercicesMartin).toHaveLength(0);
    expect(r.exercicesDupain).toHaveLength(1);
  });

  it('le client déposant ne voit que son dossier et aucune donnée de révision', async () => {
    const r = await app.avecContexte(ctx(DEMO.cabinetA, DEMO.client), async (tx) => ({
      entites: await tx.select().from(s.entites),
      exercices: await tx.select().from(s.exercices),
      constats: await tx.select().from(s.constats),
    }));
    expect(r.entites.map((e) => e.id)).toContain(DEMO.dupain);
    expect(r.entites.map((e) => e.id)).not.toContain(DEMO.martin);
    expect(r.entites.map((e) => e.id)).not.toContain(DEMO.bellevue);
    expect(r.exercices).toHaveLength(0);
    expect(r.constats).toHaveLength(0);
  });

  it('le client déposant ne peut pas s’accorder une habilitation', async () => {
    await expect(
      app.avecContexte(ctx(DEMO.cabinetA, DEMO.client), (tx) =>
        tx.insert(s.habilitationsDossier).values({ cabinetId: DEMO.cabinetA, entiteId: DEMO.martin, utilisateurId: DEMO.client, niveau: 'validation' }),
      ),
    ).rejects.toThrow();
  });

  it('le worker est borné au cabinet de son contexte', async () => {
    const a = await worker.avecContexte({ cabinetId: DEMO.cabinetA }, (tx) => tx.select().from(s.exercices));
    const b = await worker.avecContexte({ cabinetId: DEMO.cabinetB }, (tx) => tx.select().from(s.exercices));
    expect(a.every((x) => x.cabinetId === DEMO.cabinetA)).toBe(true);
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(b.every((x) => x.cabinetId === DEMO.cabinetB)).toBe(true);
  });
});

describe('journal d’audit', () => {
  it('est chaîné, vérifiable, et refuse modification et suppression', async () => {
    await app.avecContexte(ctx(DEMO.cabinetA, DEMO.alice), async (tx) => {
      await journaliser(tx, { cabinetId: DEMO.cabinetA, acteurId: DEMO.alice, action: 'test.audit', details: { n: 1 } });
      await journaliser(tx, { cabinetId: DEMO.cabinetA, acteurId: DEMO.alice, action: 'test.audit', details: { n: 2 } });
    });
    const verif = await app.avecContexte(ctx(DEMO.cabinetA, DEMO.alice), (tx) =>
      tx.execute(sql`select journal_audit_verifier(${DEMO.cabinetA}::uuid) as rupture, (select count(*)::int from journal_audit) as n`),
    );
    expect(verif.rows[0]!.rupture).toBeNull();
    expect(Number(verif.rows[0]!.n)).toBeGreaterThanOrEqual(2);
    await expect(
      app.avecContexte(ctx(DEMO.cabinetA, DEMO.alice), (tx) => tx.execute(sql`update journal_audit set action = 'falsifie'`)),
    ).rejects.toThrow();
    await expect(
      app.avecContexte(ctx(DEMO.cabinetA, DEMO.alice), (tx) => tx.execute(sql`delete from journal_audit`)),
    ).rejects.toThrow();
  });

  it('le journal d’un cabinet est invisible depuis un autre', async () => {
    const r = await app.avecContexte(ctx(DEMO.cabinetB, DEMO.bruno), (tx) =>
      tx.select().from(s.journalAudit).where(eq(s.journalAudit.cabinetId, DEMO.cabinetA)),
    );
    expect(r).toHaveLength(0);
  });
});
