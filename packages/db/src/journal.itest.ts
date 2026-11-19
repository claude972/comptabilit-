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
import { type AccesBd, creerAccesBd, journaliser, notifier, notifierGestionnaires, schema as s, sql, urlBd } from './index.js';
import { migrer } from './migrer.js';
import { type AncreJournal, type LigneJournalExportee, empreinteAncre, empreinteLigne, etablirAncre, exporterJournal, lireEtatJournal, serialiserAncre, verifierExport } from './ancre-journal.js';
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

describe('ancres du journal : format et vérification hors base (aucun ancrage externe n’est réalisé)', () => {
  const toutLire = async (cabinet: string) => {
    const lignes: LigneJournalExportee[] = [];
    for await (const l of exporterJournal(admin, cabinet, 7)) lignes.push(l);
    return lignes;
  };
  const ecrire = async (cabinet: string, n: number) => {
    for (let i = 0; i < n; i++) await admin.query(`insert into journal_audit (cabinet_id, acteur_type, action, details) values ($1, 'systeme', 'essai.ancre', $2)`, [cabinet, JSON.stringify({ i, texte: 'accents é ù — « guillemets », "quotes", \\ barre', nombre: 1.5, vide: null, liste: [1, 'a'] })]);
  };
  /** Réécrit la fin d'un export en recalculant toutes les empreintes : ce que ferait qui maîtrise entièrement la base. */
  const reecrire = (lignes: LigneJournalExportee[], depuis: number, modifier: (l: LigneJournalExportee) => void) => {
    const copie = lignes.map((l) => ({ ...l }));
    for (let i = depuis; i < copie.length; i++) {
      if (i === depuis) modifier(copie[i]!);
      copie[i]!.empreintePrecedente = i === 0 ? null : copie[i - 1]!.empreinte;
      copie[i]!.empreinte = empreinteLigne(copie[i]!);
    }
    return copie;
  };

  it('l’export se vérifie hors base : le calcul hors base donne les mêmes empreintes que PostgreSQL, sur un journal réel', async () => {
    // Journal du cabinet de démonstration de la base neuve : écritures concurrentes, plusieurs rôles, détails variés.
    const lignes = await toutLire(DEMO.cabinetA);
    expect(lignes.length).toBeGreaterThan(100);
    expect(lignes.every((l) => l.empreinte === empreinteLigne(l))).toBe(true);
    const r = await verifierExport(lignes, []);
    expect(r.rupture, JSON.stringify(lignes.find((l) => l.id === r.rupture?.ligne))).toBeNull();
    expect(r).toMatchObject({ lignes: lignes.length, rupture: null, conforme: true });
    expect(await strict(DEMO.cabinetA)).toBeNull(); // même conclusion que la vérification stricte en base
    // Numéros de longueurs différentes (1 à plus de 100) : la dernière ligne lue en base est bien la plus récente, et
    // une ancre établie sur ce journal se vérifie.
    expect(new Set(lignes.map((l) => l.id.length)).size).toBeGreaterThan(1);
    const etat = await lireEtatJournal(admin, DEMO.cabinetA);
    expect(etat).toMatchObject({ derniereLigne: lignes.at(-1)!.id, empreinteTete: lignes.at(-1)!.empreinte, nombreLignes: lignes.length, verificationStricte: null });
    expect((await verifierExport(lignes, [etablirAncre(etat, null)])).conforme).toBe(true);
    // Cloisonnement de l'export : uniquement les lignes du cabinet demandé.
    expect(lignes.every((l) => l.cabinetId === DEMO.cabinetA)).toBe(true);
  });

  it('une rupture constatée en base l’est aussi hors base, à la même ligne', async () => {
    const c = await cabinetAvecLignes('Export avec rupture', 6);
    await sansDeclencheurs(async () => {
      await admin.query(`update journal_audit set details = '{"i": 999}' where id = $1`, [c.lignes[2]]);
    });
    const r = await verifierExport(await toutLire(c.id), []);
    expect(r.conforme).toBe(false);
    expect(r.rupture).toEqual({ ligne: await strict(c.id), motif: 'empreinte ne correspondant pas au contenu' });
  });

  let cabinet: string;
  let lignes: LigneJournalExportee[];
  let ancres: AncreJournal[];

  it('deux ancres successives s’enchaînent et se vérifient contre l’export', async () => {
    cabinet = (await cabinetAvecLignes('Journal ancré', 0)).id;
    const vide = etablirAncre(await lireEtatJournal(admin, cabinet), null, '2026-01-01T00:00:00.000Z');
    expect(vide).toMatchObject({ format: 'comtaple.ancre-journal/1', rang: 1, derniereLigne: null, empreinteTete: null, nombreLignes: 0, verificationStricte: null, ancrePrecedente: null });
    await ecrire(cabinet, 9);
    const a2 = etablirAncre(await lireEtatJournal(admin, cabinet), vide, '2026-01-02T00:00:00.000Z');
    await ecrire(cabinet, 8);
    const a3 = etablirAncre(await lireEtatJournal(admin, cabinet), a2, '2026-01-03T00:00:00.000Z');
    await ecrire(cabinet, 4); // lignes postérieures à la dernière ancre
    ancres = [vide, a2, a3];
    lignes = await toutLire(cabinet);
    expect(lignes).toHaveLength(21);
    expect(a2).toMatchObject({ rang: 2, nombreLignes: 9, derniereLigne: lignes[8]!.id, empreinteTete: lignes[8]!.empreinte, ancrePrecedente: empreinteAncre(vide) });
    expect(a3).toMatchObject({ rang: 3, nombreLignes: 17, derniereLigne: lignes[16]!.id, ancrePrecedente: empreinteAncre(a2) });
    // Sérialisation canonique : stable, et indépendante de l'ordre des clés de l'objet.
    expect(serialiserAncre(a2)).toBe(serialiserAncre(JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(a2).reverse())))));
    expect(empreinteAncre(a2)).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifierExport(lignes, ancres)).toEqual({ lignes: 21, rupture: null, ancres: [1, 2, 3].map((rang) => ({ rang, conforme: true, motif: null })), conforme: true });
  });

  it('fin du journal entièrement réécrite, empreintes recalculées : la chaîne paraît intègre, l’ancre révèle la réécriture', async () => {
    const reecrit = reecrire(lignes, 12, (l) => {
      l.detailsTexte = '{"i": 0, "falsifie": true}';
    });
    const r = await verifierExport(reecrit, ancres);
    expect(r.rupture).toBeNull(); // la chaîne seule ne voit rien : c'est la limite que l'ancre comble
    expect(r.ancres).toEqual([
      { rang: 1, conforme: true, motif: null },
      { rang: 2, conforme: true, motif: null }, // figée avant la réécriture
      { rang: 3, conforme: false, motif: 'la ligne figée par l’ancre n’a plus la même empreinte : le journal a été réécrit' },
    ]);
    expect(r.conforme).toBe(false);
  });

  it('dernières lignes supprimées, ligne retirée ou insérée avant une ancre : révélé par l’ancre', async () => {
    const tronque = await verifierExport(lignes.slice(0, 14), ancres);
    expect(tronque.rupture).toBeNull();
    expect(tronque.ancres[2]).toEqual({ rang: 3, conforme: false, motif: 'la dernière ligne figée par l’ancre est absente du journal' });
    // Une ligne retirée au milieu, chaîne recousue : la ligne figée par l'ancre 2 n'a plus la même empreinte.
    const sans = lignes.filter((_, i) => i !== 4);
    const recousu = await verifierExport(reecrire(sans, 4, () => undefined), ancres);
    expect(recousu.rupture).toBeNull();
    expect(recousu.ancres.map((a) => a.conforme)).toEqual([true, false, false]);
    // Sans recoudre, la chaîne elle-même rompt à la ligne suivante.
    expect((await verifierExport(sans, ancres)).rupture).toEqual({ ligne: lignes[5]!.id, motif: 'ne s’enchaîne pas à la ligne précédente' });
    // Lignes dans le désordre, ou d'un autre cabinet.
    expect((await verifierExport([lignes[1]!, lignes[0]!], [])).rupture?.motif).toBe('ne s’enchaîne pas à la ligne précédente');
    const etrangere = (await toutLire(DEMO.cabinetB))[0]!;
    expect((await verifierExport([...lignes, etrangere], ancres)).rupture).toMatchObject({ ligne: etrangere.id });
  });

  it('une ancre modifiée, manquante ou d’un autre cabinet est rejetée ; aucune ancre n’est établie sur un journal amputé', async () => {
    const [a1, a2, a3] = ancres as [AncreJournal, AncreJournal, AncreJournal];
    const modifiee = await verifierExport(lignes, [a1, { ...a2, nombreLignes: 8 }, a3]);
    expect(modifiee.ancres[1]).toMatchObject({ conforme: false, motif: 'le nombre de lignes jusqu’à l’ancre a changé : des lignes ont été retirées ou insérées' });
    expect(modifiee.ancres[2]).toMatchObject({ conforme: false, motif: 'ne s’enchaîne pas à l’ancre précédente' }); // l'ancre suivante dénonce la modification
    expect((await verifierExport(lignes, [a1, a3])).ancres[1]).toMatchObject({ conforme: false, motif: 'rang inattendu : une ancre manque ou l’ordre est faux' });
    expect((await verifierExport(lignes, [a1, a2, { ...a3, cabinetId: DEMO.cabinetB }])).ancres[2]).toMatchObject({ conforme: false, motif: 'ancre d’un autre cabinet' });
    expect((await verifierExport(lignes, [a1, a2, { ...a3, format: 'autre' as never }])).ancres[2]).toMatchObject({ conforme: false, motif: 'format inconnu' });
    const etat = await lireEtatJournal(admin, cabinet);
    expect(() => etablirAncre({ ...etat, nombreLignes: 3 }, a3)).toThrow(/amputé/);
    expect(() => etablirAncre({ ...etat, cabinetId: DEMO.cabinetB }, a3)).toThrow(/autre cabinet/);
  });

  it('réécriture complète de la fin du journal DANS LA BASE par son propriétaire : la vérification stricte ne voit rien, l’ancre si', async () => {
    // C'est la limite reconnue en D-038 : qui peut désactiver les déclencheurs peut recalculer toute la fin de la chaîne.
    const c = await cabinetAvecLignes('Réécriture en base', 8);
    const ancre = etablirAncre(await lireEtatJournal(admin, c.id), null);
    await sansDeclencheurs(async () => {
      for (const [i, id] of c.lignes.slice(4).entries()) {
        if (i === 0) await admin.query(`update journal_audit set action = 'essai.reecrite' where id = $1`, [id]);
        await admin.query(
          `update journal_audit j set empreinte_precedente = (select p.empreinte from journal_audit p where p.cabinet_id = j.cabinet_id and p.id < j.id order by p.id desc limit 1) where id = $1`,
          [id],
        );
        await admin.query('update journal_audit j set empreinte = journal_audit_empreinte(j.empreinte_precedente, j) where id = $1', [id]);
      }
    });
    expect(await strict(c.id)).toBeNull(); // la chaîne, recalculée, est cohérente : la base seule ne peut pas le voir
    const r = await verifierExport(await toutLire(c.id), [ancre]);
    expect(r.rupture).toBeNull();
    expect(r.ancres).toEqual([{ rang: 1, conforme: false, motif: 'la ligne figée par l’ancre n’a plus la même empreinte : le journal a été réécrit' }]);
    expect(r.conforme).toBe(false);
  });
});

describe('notifications internes : écriture contrôlée, lecture par le seul destinataire', () => {
  const lues = (cabinet: string, utilisateur: string) => app.avecContexte(ctx(cabinet, utilisateur), (tx) => tx.select().from(s.notifications));

  it('seuls les membres actifs du cabinet du contexte sont notifiés ; l’auteur ne se notifie pas ; chacun ne lit que les siennes', async () => {
    await app.avecContexte(ctx(DEMO.cabinetA, DEMO.chloe), async (tx) => {
      // Destinataires : une administratrice du cabinet, l'auteure elle-même, un membre d'un AUTRE cabinet, un inconnu.
      await notifier(tx, [DEMO.alice, DEMO.chloe, DEMO.bruno, '00000000-0000-4000-8000-000000000000', null], { type: 'essai.notification', cibleType: 'essai', cibleId: 'n1', donnees: { n: 1 } });
    });
    expect((await lues(DEMO.cabinetA, DEMO.alice)).filter((n) => n.cibleId === 'n1')).toHaveLength(1);
    expect((await lues(DEMO.cabinetA, DEMO.chloe)).filter((n) => n.cibleId === 'n1')).toHaveLength(0); // l'auteure
    expect((await lues(DEMO.cabinetA, DEMO.remi)).filter((n) => n.cibleId === 'n1')).toHaveLength(0); // non destinataire
    expect(await lues(DEMO.cabinetB, DEMO.bruno)).toEqual([]); // membre d'un autre cabinet : rien n'a été créé pour lui
    expect((await admin.query(`select count(*)::int as n from notifications where cible_id = 'n1'`)).rows[0].n).toBe(1);
    // Usurper l'identité d'un autre cabinet ne donne rien à lire.
    expect(await lues(DEMO.cabinetB, DEMO.alice)).toEqual([]);
  });

  it('aux gestionnaires : administrateurs et associés actifs seulement, l’auteur excepté', async () => {
    await app.avecContexte(ctx(DEMO.cabinetA, DEMO.chloe), (tx) => notifierGestionnaires(tx, { type: 'essai.gestionnaires', cibleId: 'g1' }));
    const destinataires = (await admin.query(`select destinataire_id from notifications where cible_id = 'g1'`)).rows.map((r) => r.destinataire_id);
    const gestionnaires = (await admin.query(`select utilisateur_id from appartenances where cabinet_id = $1 and actif and role in ('administrateur', 'associe')`, [DEMO.cabinetA])).rows.map((r) => r.utilisateur_id);
    expect(destinataires.sort()).toEqual(gestionnaires.sort());
    expect(destinataires).toContain(DEMO.alice);
    expect(destinataires).not.toContain(DEMO.remi);
    // Demandée par une gestionnaire : elle ne se notifie pas elle-même.
    await app.avecContexte(ctx(DEMO.cabinetA, DEMO.alice), (tx) => notifierGestionnaires(tx, { type: 'essai.gestionnaires', cibleId: 'g2' }));
    expect((await admin.query(`select destinataire_id from notifications where cible_id = 'g2'`)).rows.map((r) => r.destinataire_id)).not.toContain(DEMO.alice);
  });

  it('refus : écriture directe, dossier d’un autre cabinet, type invalide, données volumineuses, contexte absent', async () => {
    const direct = sql`insert into notifications (cabinet_id, destinataire_id, type) values (${DEMO.cabinetA}::uuid, ${DEMO.alice}::uuid, 'essai.direct')`;
    for (const acces of [app, worker]) await expect(acces.avecContexte(ctx(DEMO.cabinetA, DEMO.chloe), (tx) => tx.execute(direct))).rejects.toThrow();
    const dans = (fn: Parameters<AccesBd['avecContexte']>[1]) => app.avecContexte(ctx(DEMO.cabinetA, DEMO.chloe), fn);
    await expect(dans((tx) => notifier(tx, [DEMO.alice], { type: 'essai.etranger', entiteId: DEMO.leroy }))).rejects.toThrow(); // dossier du cabinet B
    await expect(dans((tx) => notifier(tx, [DEMO.alice], { type: 'Type Invalide' }))).rejects.toThrow();
    await expect(dans((tx) => notifier(tx, [DEMO.alice], { type: 'essai.gros', donnees: { x: 'y'.repeat(5000) } }))).rejects.toThrow();
    await expect(app.avecContexte({}, (tx) => notifier(tx, [DEMO.alice], { type: 'essai.sans_contexte' }))).rejects.toThrow();
    expect((await admin.query(`select count(*)::int as n from notifications where type in ('essai.direct', 'essai.etranger', 'essai.gros', 'essai.sans_contexte')`)).rows[0].n).toBe(0);
  });

  it('le destinataire ne peut que marquer « lue » ; ni réécrire, ni supprimer, ni lire ou marquer celles des autres', async () => {
    const [n] = (await lues(DEMO.cabinetA, DEMO.alice)).filter((x) => x.cibleId === 'n1');
    const alice = (requete: ReturnType<typeof sql>) => app.avecContexte(ctx(DEMO.cabinetA, DEMO.alice), (tx) => tx.execute(requete));
    await expect(alice(sql`update notifications set type = 'essai.reecrit' where id = ${n!.id}::uuid`)).rejects.toThrow();
    await expect(alice(sql`update notifications set destinataire_id = ${DEMO.remi}::uuid where id = ${n!.id}::uuid`)).rejects.toThrow();
    await expect(alice(sql`delete from notifications where id = ${n!.id}::uuid`)).rejects.toThrow();
    // Rémi ne peut pas marquer la notification d'Alice : elle n'existe pas pour lui.
    const parRemi = await app.avecContexte(ctx(DEMO.cabinetA, DEMO.remi), (tx) => tx.execute(sql`update notifications set lue_le = now() where id = ${n!.id}::uuid`));
    expect(parRemi.rowCount).toBe(0);
    expect((await alice(sql`update notifications set lue_le = now() where id = ${n!.id}::uuid`)).rowCount).toBe(1);
    const apres = (await admin.query('select type, destinataire_id, lue_le from notifications where id = $1', [n!.id])).rows[0];
    expect(apres).toMatchObject({ type: 'essai.notification', destinataire_id: DEMO.alice });
    expect(apres.lue_le).not.toBeNull();
  });
});

describe('notifications : fin d’import et préférences, au niveau de la base', () => {
  const lot = async (extra: { campagne?: boolean } = {}) => {
    const campagne = extra.campagne ? (await admin.query(`insert into campagnes_import (cabinet_id, libelle, type, cree_par) values ($1, 'Campagne d’essai', 'fec', $2) returning id`, [DEMO.cabinetA, DEMO.chloe])).rows[0].id : null;
    return (await admin.query(`insert into lots_import (cabinet_id, entite_id, type, cle_idempotence, lance_par, campagne_id) values ($1, $2, 'fec', gen_random_uuid()::text, $3, $4) returning id`, [DEMO.cabinetA, DEMO.dupain, DEMO.chloe, campagne])).rows[0].id as string;
  };
  /** Change le statut d'un lot comme le fait le worker : contexte du cabinet, sans utilisateur. */
  const passer = (id: string, statut: string) => worker.avecContexte({ cabinetId: DEMO.cabinetA }, (tx) => tx.execute(sql`update lots_import set statut = ${statut}::statut_lot where id = ${id}::uuid`));
  const recues = async (id: string) => (await admin.query('select type, destinataire_id, donnees from notifications where cible_id = $1 order by cree_le', [id])).rows;

  it('seule la fin d’un traitement notifie la personne qui a lancé l’import : ni la prise en charge, ni une annulation, ni un rétablissement', async () => {
    const id = await lot();
    await passer(id, 'en_cours');
    expect(await recues(id)).toEqual([]);
    await passer(id, 'termine_avec_erreurs');
    expect(await recues(id)).toEqual([{ type: 'import.termine', destinataire_id: DEMO.chloe, donnees: { type: 'fec', statut: 'termine_avec_erreurs', version: 1 } }]);
    // Annulation puis rétablissement par une personne : le statut repasse à « terminé » sans nouvelle notification.
    await passer(id, 'annule');
    await passer(id, 'termine_avec_erreurs');
    expect(await recues(id)).toHaveLength(1);
    const echec = await lot();
    await passer(echec, 'en_cours');
    await passer(echec, 'echec');
    expect((await recues(echec)).map((n) => n.type)).toEqual(['import.echec']);
  });

  it('les imports d’une campagne ne notifient pas un par un ; une notification impossible ne fait pas échouer l’import', async () => {
    const enCampagne = await lot({ campagne: true });
    await passer(enCampagne, 'en_cours');
    await passer(enCampagne, 'termine');
    expect(await recues(enCampagne)).toEqual([]);
    // Changement de statut hors de tout contexte de cabinet (rôle d'administration) : pas de notification, pas d'erreur.
    const horsContexte = await lot();
    await admin.query(`update lots_import set statut = 'en_cours' where id = $1`, [horsContexte]);
    await admin.query(`update lots_import set statut = 'termine' where id = $1`, [horsContexte]);
    expect((await admin.query('select statut from lots_import where id = $1', [horsContexte])).rows[0].statut).toBe('termine');
    expect(await recues(horsContexte)).toEqual([]);
  });

  it('préférences : chacun ne règle que les siennes, une famille désactivée n’est plus notifiée, une famille inconnue est refusée', async () => {
    const regler = (qui: string, pour: string, famille: string, active: boolean) =>
      app.avecContexte(ctx(DEMO.cabinetA, qui), (tx) =>
        tx.execute(sql`insert into preferences_notification (cabinet_id, utilisateur_id, famille, active) values (${DEMO.cabinetA}::uuid, ${pour}::uuid, ${famille}, ${active})
                       on conflict (cabinet_id, utilisateur_id, famille) do update set active = excluded.active`),
      );
    await expect(regler(DEMO.remi, DEMO.chloe, 'import', false)).rejects.toThrow(); // les préférences d'une autre personne
    await expect(regler(DEMO.chloe, DEMO.chloe, 'famille_inconnue', false)).rejects.toThrow();
    await regler(DEMO.chloe, DEMO.chloe, 'import', false);
    expect(await app.avecContexte(ctx(DEMO.cabinetA, DEMO.remi), (tx) => tx.select().from(s.preferencesNotification))).toEqual([]); // invisibles pour un autre
    const id = await lot();
    await passer(id, 'en_cours');
    await passer(id, 'termine');
    expect(await recues(id)).toEqual([]);
    // Les autres familles restent notifiées, et la réactivation rétablit la notification.
    await app.avecContexte(ctx(DEMO.cabinetA, DEMO.alice), (tx) => notifier(tx, [DEMO.chloe], { type: 'constat.affecte', cibleId: 'pref-1' }));
    expect(await recues('pref-1')).toHaveLength(1);
    await regler(DEMO.chloe, DEMO.chloe, 'import', true);
    const autre = await lot();
    await passer(autre, 'en_cours');
    await passer(autre, 'termine');
    expect((await recues(autre)).map((n) => n.type)).toEqual(['import.termine']);
    await expect(app.avecContexte(ctx(DEMO.cabinetA, DEMO.chloe), (tx) => tx.execute(sql`delete from preferences_notification`))).rejects.toThrow();
  });
});
