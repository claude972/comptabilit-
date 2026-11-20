/**
 * Table `factures` obsolète (D-096) : elle est VIDE, jamais alimentée, et rien dans la base n'en dépend. Lecture seule.
 * Si ce test échoue, quelque chose a alimenté la table : voir docs/decisions.md, D-096 (elle n'est pas supprimée, mais ne doit
 * recevoir aucune ligne tant qu'aucune décision n'a remplacé le recalcul à la lecture, D-077).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chargerEnvLocal } from './env.js';
import { urlBd } from './index.js';

chargerEnvLocal();
let admin: pg.Client;
beforeAll(async () => {
  admin = new pg.Client({ connectionString: urlBd('admin') });
  await admin.connect();
});
afterAll(async () => {
  await admin.end();
});

describe('table « factures » obsolète', () => {
  it('existe encore (aucune suppression d’objet), est VIDE, et RLS y est forcée comme partout', async () => {
    const t = (await admin.query(`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'factures' and relnamespace = 'public'::regnamespace`)).rows[0];
    expect(t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect(Number((await admin.query('select count(*) as n from factures')).rows[0].n)).toBe(0);
  });

  it('aucune clé étrangère, vue, déclencheur ni fonction de la base ne la référence', async () => {
    expect((await admin.query(`select conrelid::regclass::text as t from pg_constraint where confrelid = 'factures'::regclass`)).rows).toEqual([]);
    expect((await admin.query(`select c.relname from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class c on c.oid = r.ev_class where d.refobjid = 'factures'::regclass and c.relname <> 'factures'`)).rows).toEqual([]);
    expect((await admin.query(`select tgname from pg_trigger where tgrelid = 'factures'::regclass and not tgisinternal`)).rows).toEqual([]);
    expect((await admin.query(`select proname from pg_proc where pronamespace = 'public'::regnamespace and prokind = 'f' and prosrc ~* '\\mfactures\\M'`)).rows.map((r) => r.proname)).toEqual([]);
  });
});
