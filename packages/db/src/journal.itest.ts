/**
 * Journal d'audit — tests de NON-RÉGRESSION sur une base NEUVE et ISOLÉE.
 *
 * Chaque exécution crée sa propre base dans le PostgreSQL local, y rejoue TOUTES les migrations depuis zéro, l'amorce,
 * puis la supprime. Rien n'est lu ni écrit dans la base « comtaple » : l'état historique dégradé de cette base fictive
 * (irrégularité d'ordre consignée, décision D-038) n'intervient pas ici, et ces tests ne le « réparent » pas.
 *
 * Référence : la vérification STRICTE (`journal_audit_verifier`). La vérification « hors anomalies consignées » n'est
 * qu'un diagnostic ; ces tests vérifient qu'elle ne masque ni un contenu altéré, ni un prédécesseur inexistant, et
 * qu'une consignation ne change jamais le résultat strict.
 *
 * Les scénarios d'altération utilisent le rôle d'administration (propriétaire) pour désactiver les déclencheurs de la
 * base jetable : c'est précisément l'attaque que la chaîne doit rendre visible.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, amorcer } from './amorcer.js';
import { chargerEnvLocal } from './env.js';
import { type AccesBd, creerAccesBd, journaliser, schema as s, sql, urlBd } from './index.js';
import { migrer } from './migrer.js';
import { consignerAnomalieJournal, ecartsJournal } from './provisionnement.js';

chargerEnvLocal();
const BASE = `comtaple_essai_journal_${Date.now()}`;
const env = { ...process.env, PG_DATABASE: BASE };
const CAUSE = 'Essai automatisé sur base jetable : irrégularité d’ordre construite pour le test.';

let admin: pg.Client;
let app: AccesBd;
let worker: AccesBd;
const ctx = (cabinetId: string, utilisateurId: string) => ({ cabinetId, utilisateurId, sujet: utilisateurId });

const strict = async (cabinet: string) => (await admin.query<{ r: string | null }>('select journal_audit_verifier($1) as r', [cabinet])).rows[0]!.r;
const horsAnomalies = async (cabinet: string) => (await admin.query<{ r: string | null }>('select journal_audit_verifier_hors_anomalies($1) as r', [cabinet])).rows[0]!.r;

/** Cabinet neuf portant `n` lignes régulièrement chaînées ; renvoie son identifiant et les numéros des lignes. */
async function cabinetAvecLignes(nom: string, n: number): Promise<{ id: string; lignes: string[] }> {
  const id = (await admin.query<{ id: string }>('insert into cabinets (nom) values ($1) returning id', [`${nom} (essai)`])).rows[0]!.id;
  const lignes: string[] = [];
  for (let i = 0; i < n; i++) {
    lignes.push((await admin.query<{ id: string }>(`insert into journal_audit (cabinet_id, acteur_type, action, details) values ($1, 'systeme', 'essai.ligne', $2) returning id`, [id, JSON.stringify({ i })])).rows[0]!.id);
  }
  return { id, lignes };
}

/** Exécute des requêtes avec les déclencheurs du journal désactivés (rôle propriétaire, base jetable uniquement). */
async function sansDeclencheurs(fn: () => Promise<void>): Promise<void> {
  await admin.query('alter table journal_audit disable trigger user');
  try {
    await fn();
  } finally {
    await admin.query('alter table journal_audit enable trigger user');
  }
}

/** Insère une ligne « forgée » (numéro et prédécesseur choisis), d'empreinte cohérente avec son contenu. */
async function forger(cabinet: string, numero: string, precedente: string | null): Promise<string> {
  await admin.query(`insert into journal_audit (id, cabinet_id, acteur_type, action, details, empreinte_precedente) values ($1, $2, 'systeme', 'essai.forgee', '{}', $3)`, [numero, cabinet, precedente]);
  return (await admin.query<{ e: string }>('update journal_audit j set empreinte = journal_audit_empreinte(j.empreinte_precedente, j) where id = $1 returning empreinte as e', [numero])).rows[0]!.e;
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
}, 120_000);

afterAll(async () => {
  await app?.fermer();
  await worker?.fermer();
  await admin?.end();
  const racine = new pg.Client({ connectionString: urlBd('admin', { ...process.env, PG_DATABASE: 'postgres' }) });
  await racine.connect();
  await racine.query(`drop database if exists ${BASE} with (force)`);
  await racine.end();
});

describe('base neuve : migrations rejouées depuis zéro', () => {
  it('toutes les migrations s’appliquent sur une base vide ; RLS activé et forcé partout ; journaux intègres après amorçage', async () => {
    const versions = await admin.query('select count(*)::int as n from migrations_drizzle');
    const fichiers = (await import('node:fs')).readdirSync(new URL('../migrations', import.meta.url)).filter((f) => f.endsWith('.sql')).length;
    expect(versions.rows[0].n).toBe(fichiers);
    const sansRls = await admin.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
         and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'cabinet_id' and not a.attisdropped)
         and not (c.relrowsecurity and c.relforcerowsecurity)`,
    );
    expect(sansRls.rows).toEqual([]);
    expect(await strict(DEMO.cabinetA)).toBeNull();
    expect(await strict(DEMO.cabinetB)).toBeNull();
  });
});

describe('correctif de concurrence', () => {
  it('240 écritures simultanées, par deux rôles et sur deux cabinets, laissent deux chaînes strictement linéaires', async () => {
    const ecrire = (acces: AccesBd, cabinet: string, acteur: string, i: number) =>
      acces.avecContexte(ctx(cabinet, acteur), async (tx) => {
        await journaliser(tx, { cabinetId: cabinet, acteurId: acteur, action: 'essai.concurrence', details: { i } });
        // Certaines transactions écrivent deux lignes et durent plus longtemps : c'est ce croisement qui bifurquait la chaîne.
        if (i % 5 === 0) {
          await tx.execute(sql`select pg_sleep(0.005)`);
          await journaliser(tx, { cabinetId: cabinet, acteurId: acteur, action: 'essai.concurrence', details: { i, bis: true } });
        }
      });
    await Promise.all(
      Array.from({ length: 240 }, (_, i) => {
        const [cabinet, acteur] = i % 2 ? [DEMO.cabinetA, DEMO.alice] : [DEMO.cabinetB, DEMO.bruno];
        return ecrire(i % 3 ? app : worker, cabinet, acteur, i);
      }),
    );
    for (const cabinet of [DEMO.cabinetA, DEMO.cabinetB]) {
      expect(await strict(cabinet)).toBeNull();
      expect(await ecartsJournal(admin, cabinet)).toEqual([]);
      // Chaîne linéaire : aucun prédécesseur n'est déclaré deux fois, et les numéros suivent l'ordre de la chaîne.
      const doubles = await admin.query('select empreinte_precedente from journal_audit where cabinet_id = $1 group by 1 having count(*) > 1', [cabinet]);
      expect(doubles.rows).toEqual([]);
    }
    const n = await admin.query(`select count(*)::int as n from journal_audit where action = 'essai.concurrence'`);
    expect(n.rows[0].n).toBe(240 + 48);
  });
});

describe('tentatives d’altération par les rôles applicatifs', () => {
  it('modification, suppression et troncature sont refusées à l’application et au worker', async () => {
    for (const acces of [app, worker]) {
      for (const requete of [sql`update journal_audit set action = 'falsifie'`, sql`delete from journal_audit`, sql`truncate journal_audit`]) {
        await expect(acces.avecContexte(ctx(DEMO.cabinetA, DEMO.alice), (tx) => tx.execute(requete))).rejects.toThrow();
      }
      for (const requete of [
        sql`insert into anomalies_journal (cabinet_id, premiere_ligne, derniere_ligne, cause) values (${DEMO.cabinetA}::uuid, 1, 2, 'x')`,
        sql`update anomalies_journal set cause = 'x'`,
        sql`delete from anomalies_journal`,
      ]) {
        await expect(acces.avecContexte(ctx(DEMO.cabinetA, DEMO.alice), (tx) => tx.execute(requete))).rejects.toThrow();
      }
    }
    expect(await strict(DEMO.cabinetA)).toBeNull();
  });

  it('un numéro, une empreinte, un prédécesseur ou un horodatage fournis par l’appelant sont ignorés', async () => {
    await app.avecContexte(ctx(DEMO.cabinetA, DEMO.alice), (tx) =>
      tx.execute(sql`insert into journal_audit (id, cabinet_id, acteur_id, action, details, horodatage, empreinte_precedente, empreinte)
                     values (1, ${DEMO.cabinetA}::uuid, ${DEMO.alice}::uuid, 'essai.forge_par_appelant', '{}', '2001-01-01', 'aaaa', 'bbbb')`),
    );
    const l = (await admin.query(`select id, empreinte, empreinte_precedente, horodatage from journal_audit where action = 'essai.forge_par_appelant'`)).rows[0];
    expect(Number(l.id)).toBeGreaterThan(1);
    expect(l.empreinte).toMatch(/^[0-9a-f]{64}$/);
    expect(l.empreinte_precedente).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(l.horodatage).getUTCFullYear()).toBeGreaterThan(2001);
    expect(await strict(DEMO.cabinetA)).toBeNull();
  });

  it('écrire dans le journal d’un autre cabinet est refusé', async () => {
    await expect(
      app.avecContexte(ctx(DEMO.cabinetB, DEMO.bruno), (tx) => journaliser(tx, { cabinetId: DEMO.cabinetA, acteurId: DEMO.bruno, action: 'essai.intrusion' })),
    ).rejects.toThrow();
    expect((await admin.query(`select count(*)::int as n from journal_audit where action = 'essai.intrusion'`)).rows[0].n).toBe(0);
  });
});

describe('altérations faites avec les droits du propriétaire : toujours détectées', () => {
  it('contenu modifié : la vérification stricte désigne la ligne, et rien ne permet de la consigner', async () => {
    const c = await cabinetAvecLignes('Contenu modifié', 8);
    expect(await strict(c.id)).toBeNull();
    await sansDeclencheurs(async () => {
      await admin.query(`update journal_audit set details = '{"i": 999}' where id = $1`, [c.lignes[3]]);
    });
    expect(await strict(c.id)).toBe(c.lignes[3]);
    expect(await horsAnomalies(c.id)).toBe(c.lignes[3]);
    expect(await ecartsJournal(admin, c.id)).toEqual([{ ligne: Number(c.lignes[3]), empreinteValide: false, enchainementValide: true }]);
    await expect(consignerAnomalieJournal(admin, c.id, Number(c.lignes[3]), Number(c.lignes[3]), CAUSE)).rejects.toThrow(/empreinte fausse/);
    expect((await admin.query('select count(*)::int as n from anomalies_journal where cabinet_id = $1', [c.id])).rows[0].n).toBe(0);
  });

  it('contenu modifié ET empreinte recalculée : la ligne suivante ne s’enchaîne plus', async () => {
    const c = await cabinetAvecLignes('Empreinte recalculée', 8);
    await sansDeclencheurs(async () => {
      await admin.query(`update journal_audit set details = '{"i": 999}' where id = $1`, [c.lignes[3]]);
      await admin.query('update journal_audit j set empreinte = journal_audit_empreinte(j.empreinte_precedente, j) where id = $1', [c.lignes[3]]);
    });
    expect(await strict(c.id)).toBe(c.lignes[4]);
    expect(await horsAnomalies(c.id)).toBe(c.lignes[4]);
    // Consigner la ligne suivante est refusé : son prédécesseur déclaré n'existe plus dans le journal.
    await expect(consignerAnomalieJournal(admin, c.id, Number(c.lignes[4]), Number(c.lignes[4]), CAUSE)).rejects.toThrow(/n’explique pas la rupture/);
    expect((await admin.query('select count(*)::int as n from anomalies_journal where cabinet_id = $1', [c.id])).rows[0].n).toBe(0);
  });

  it('ligne supprimée : la rupture est désignée à la ligne suivante et ne se consigne pas', async () => {
    const c = await cabinetAvecLignes('Ligne supprimée', 8);
    await sansDeclencheurs(async () => {
      await admin.query('delete from journal_audit where id = $1', [c.lignes[2]]);
    });
    expect(await strict(c.id)).toBe(c.lignes[3]);
    expect(await horsAnomalies(c.id)).toBe(c.lignes[3]);
    await expect(consignerAnomalieJournal(admin, c.id, Number(c.lignes[3]), Number(c.lignes[3]), CAUSE)).rejects.toThrow(/n’explique pas la rupture/);
  });

  it('première ligne supprimée (troncature du début) : détectée', async () => {
    const c = await cabinetAvecLignes('Début tronqué', 5);
    await sansDeclencheurs(async () => {
      await admin.query('delete from journal_audit where id = $1', [c.lignes[0]]);
    });
    expect(await strict(c.id)).toBe(c.lignes[1]);
    expect(await horsAnomalies(c.id)).toBe(c.lignes[1]);
  });
});

describe('liens de prédécesseur invalides', () => {
  it('ligne insérée avec un prédécesseur inexistant : détectée, non consignable', async () => {
    const c = await cabinetAvecLignes('Prédécesseur inexistant', 5);
    const numero = (await admin.query<{ n: string }>(`select nextval('journal_audit_id_seq') as n`)).rows[0]!.n;
    await sansDeclencheurs(async () => {
      await forger(c.id, numero, 'f'.repeat(64));
    });
    expect(await strict(c.id)).toBe(numero);
    expect(await horsAnomalies(c.id)).toBe(numero);
    await expect(consignerAnomalieJournal(admin, c.id, Number(numero), Number(numero), CAUSE)).rejects.toThrow(/n’explique pas la rupture/);
    expect((await admin.query('select count(*)::int as n from anomalies_journal where cabinet_id = $1', [c.id])).rows[0].n).toBe(0);
  });

  it('ligne rattachée au journal d’un AUTRE cabinet : détectée, non consignable', async () => {
    const source = await cabinetAvecLignes('Source du lien', 3);
    const cible = await cabinetAvecLignes('Lien vers un autre cabinet', 3);
    const empreinteEtrangere = (await admin.query<{ e: string }>('select empreinte as e from journal_audit where id = $1', [source.lignes[2]])).rows[0]!.e;
    const numero = (await admin.query<{ n: string }>(`select nextval('journal_audit_id_seq') as n`)).rows[0]!.n;
    await sansDeclencheurs(async () => {
      await forger(cible.id, numero, empreinteEtrangere);
    });
    expect(await strict(cible.id)).toBe(numero);
    expect(await horsAnomalies(cible.id)).toBe(numero);
    await expect(consignerAnomalieJournal(admin, cible.id, Number(numero), Number(numero), CAUSE)).rejects.toThrow(/n’explique pas la rupture/);
    expect(await strict(source.id)).toBeNull();
  });

  it('prédécesseur effacé (mis à vide) sur une ligne du milieu : détecté', async () => {
    const c = await cabinetAvecLignes('Prédécesseur vidé', 5);
    await sansDeclencheurs(async () => {
      await admin.query('update journal_audit set empreinte_precedente = null where id = $1', [c.lignes[2]]);
      await admin.query('update journal_audit j set empreinte = journal_audit_empreinte(j.empreinte_precedente, j) where id = $1', [c.lignes[2]]);
    });
    expect(await strict(c.id)).toBe(c.lignes[2]);
    expect(await horsAnomalies(c.id)).toBe(c.lignes[2]);
  });
});

describe('consignation : un diagnostic, jamais une preuve d’intégrité', () => {
  let cabinet: string;
  let x: string;
  let y: string;

  it('irrégularité d’ordre de la forme du défaut historique : consignable, mais le résultat strict ne change pas', async () => {
    // Deux lignes chaînées dans l'ordre inverse de leurs numéros, puis une écriture normale : forme exacte du défaut corrigé.
    const c = await cabinetAvecLignes('Ordre inversé', 4);
    cabinet = c.id;
    const derniere = (await admin.query<{ e: string }>('select empreinte as e from journal_audit where id = $1', [c.lignes[3]])).rows[0]!.e;
    x = (await admin.query<{ n: string }>(`select nextval('journal_audit_id_seq') as n`)).rows[0]!.n;
    y = (await admin.query<{ n: string }>(`select nextval('journal_audit_id_seq') as n`)).rows[0]!.n;
    await sansDeclencheurs(async () => {
      const empreinteY = await forger(cabinet, y, derniere);
      await forger(cabinet, x, empreinteY);
    });
    await admin.query(`insert into journal_audit (cabinet_id, acteur_type, action) values ($1, 'systeme', 'essai.suite')`, [cabinet]);
    expect(await strict(cabinet)).toBe(x);

    // Refus : plage sans irrégularité, plage inversée, plage trop large, cause non décrite.
    await expect(consignerAnomalieJournal(admin, cabinet, Number(c.lignes[0]), Number(c.lignes[1]), CAUSE)).rejects.toThrow(/Aucune irrégularité/);
    await expect(consignerAnomalieJournal(admin, cabinet, Number(y), Number(x), CAUSE)).rejects.toThrow(/invalide/);
    await expect(consignerAnomalieJournal(admin, cabinet, Number(x), Number(x) + 500, CAUSE)).rejects.toThrow(/trop large/);
    await expect(consignerAnomalieJournal(admin, cabinet, Number(x), Number(y), 'trop court')).rejects.toThrow(/cause/);
    // Une plage qui ne couvre qu'une partie de l'irrégularité ne l'explique pas.
    await expect(consignerAnomalieJournal(admin, cabinet, Number(x), Number(x), CAUSE)).rejects.toThrow(/n’explique pas la rupture/);

    await consignerAnomalieJournal(admin, cabinet, Number(x), Number(y), CAUSE);
    // La référence reste en échec : la consignation n'a rendu « vert » aucun contrôle.
    expect(await strict(cabinet)).toBe(x);
    expect(await horsAnomalies(cabinet)).toBeNull();
    // La consignation est elle-même inscrite au journal du cabinet, et les écritures suivantes s'enchaînent normalement.
    const trace = await admin.query(`select details from journal_audit where cabinet_id = $1 and action = 'journal.anomalie_consignee'`, [cabinet]);
    expect(trace.rows).toHaveLength(1);
    expect(trace.rows[0].details).toMatchObject({ premiereLigne: Number(x), derniereLigne: Number(y) });
    expect((await ecartsJournal(admin, cabinet)).map((e) => e.ligne)).toEqual([Number(x), Number(y)]);
  });

  it('une consignation est en ajout seul, même pour le propriétaire', async () => {
    await expect(admin.query(`update anomalies_journal set cause = 'réécrite' where cabinet_id = $1`, [cabinet])).rejects.toThrow(/ajout seul/);
    await expect(admin.query('delete from anomalies_journal where cabinet_id = $1', [cabinet])).rejects.toThrow(/ajout seul/);
  });

  it('un contenu altéré DANS une plage consignée reste détecté par le diagnostic', async () => {
    await sansDeclencheurs(async () => {
      await admin.query(`update journal_audit set action = 'essai.falsifie' where id = $1`, [y]);
    });
    expect(await horsAnomalies(cabinet)).toBe(y);
    expect(await strict(cabinet)).toBe(x);
  });

  it('une altération APRÈS une plage consignée reste détectée par le diagnostic', async () => {
    const c = await cabinetAvecLignes('Altération après consignation', 3);
    const derniere = (await admin.query<{ e: string }>('select empreinte as e from journal_audit where id = $1', [c.lignes[2]])).rows[0]!.e;
    const a = (await admin.query<{ n: string }>(`select nextval('journal_audit_id_seq') as n`)).rows[0]!.n;
    const b = (await admin.query<{ n: string }>(`select nextval('journal_audit_id_seq') as n`)).rows[0]!.n;
    await sansDeclencheurs(async () => {
      await forger(c.id, a, await forger(c.id, b, derniere));
    });
    const suite: string[] = [];
    for (let i = 0; i < 4; i++) suite.push((await admin.query<{ id: string }>(`insert into journal_audit (cabinet_id, acteur_type, action) values ($1, 'systeme', 'essai.suite') returning id`, [c.id])).rows[0]!.id);
    await consignerAnomalieJournal(admin, c.id, Number(a), Number(b), CAUSE);
    expect(await horsAnomalies(c.id)).toBeNull();
    await sansDeclencheurs(async () => {
      await admin.query(`update journal_audit set action = 'essai.falsifie' where id = $1`, [suite[2]]);
    });
    expect(await horsAnomalies(c.id)).toBe(suite[2]);
    expect(await strict(c.id)).toBe(a);
  });
});

describe('isolation des cabinets', () => {
  it('les altérations et consignations des autres cabinets n’affectent ni ne révèlent rien aux cabinets voisins', async () => {
    expect(await strict(DEMO.cabinetA)).toBeNull();
    expect(await strict(DEMO.cabinetB)).toBeNull();
    for (const [acces, cabinet, acteur] of [
      [app, DEMO.cabinetB, DEMO.bruno],
      [worker, DEMO.cabinetB, DEMO.bruno],
      [app, DEMO.cabinetA, DEMO.alice],
    ] as const) {
      const vu = await acces.avecContexte(ctx(cabinet, acteur), async (tx) => ({
        lignes: await tx.select({ cabinetId: s.journalAudit.cabinetId }).from(s.journalAudit),
        anomalies: await tx.select().from(s.anomaliesJournal),
        ecartsAilleurs: await tx.execute(sql`select count(*)::int as n from journal_audit j where j.cabinet_id <> ${cabinet}::uuid`),
      }));
      expect(vu.lignes.length).toBeGreaterThan(0);
      expect(vu.lignes.every((l) => l.cabinetId === cabinet)).toBe(true);
      expect(vu.anomalies).toEqual([]); // des anomalies existent dans la base, pour d'autres cabinets seulement
      expect(vu.ecartsAilleurs.rows[0]!.n).toBe(0);
    }
    expect((await admin.query('select count(*)::int as n from anomalies_journal')).rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('la lecture du journal est réservée aux gestionnaires dans la base elle-même ; l’écriture d’un non-gestionnaire s’enchaîne quand même', async () => {
    // Chloé (collaboratrice) et le client déposant écrivent des lignes, sans pouvoir lire le journal.
    for (const acteur of [DEMO.chloe, DEMO.client, DEMO.chloe]) {
      const vu = await app.avecContexte(ctx(DEMO.cabinetA, acteur), async (tx) => {
        await journaliser(tx, { cabinetId: DEMO.cabinetA, acteurId: acteur, action: 'essai.non_gestionnaire' });
        return { lignes: await tx.select().from(s.journalAudit), anomalies: await tx.select().from(s.anomaliesJournal) };
      });
      expect(vu).toEqual({ lignes: [], anomalies: [] });
    }
    // Leurs lignes sont chaînées à la suite des autres (le chaînage ne dépend pas du droit de lecture de l'appelant).
    expect(await strict(DEMO.cabinetA)).toBeNull();
    const lues = await app.avecContexte(ctx(DEMO.cabinetA, DEMO.alice), (tx) => tx.select().from(s.journalAudit));
    expect(lues.filter((l) => l.action === 'essai.non_gestionnaire')).toHaveLength(3);
    expect(lues.filter((l) => l.empreintePrecedente === null)).toHaveLength(1); // une seule première ligne
  });

  it('usurper le contexte d’un autre cabinet ne donne accès à aucune ligne de son journal', async () => {
    const vu = await app.avecContexte(ctx(DEMO.cabinetA, DEMO.bruno), (tx) => tx.select().from(s.journalAudit));
    expect(vu).toEqual([]);
  });
});
