/**
 * D-095 / migration 0047 : politiques de dossier ENSEMBLISTES. Tests d'isolation AVANT/APRÈS.
 *
 * Tout se passe dans UNE transaction d'administration qui est TOUJOURS annulée (ROLLBACK) : les jeux d'essai (cabinets,
 * utilisateurs, dossiers) n'existent que le temps du test, aucune donnée ni aucune ligne du journal d'audit n'est conservée,
 * et le retour arrière de la migration (securite_restaurer_rls_ligne_a_ligne) n'est jamais visible hors de la transaction.
 * Les requêtes sont exécutées sous le rôle applicatif (NOBYPASSRLS), avec le contexte posé comme le fait l'API.
 *
 * Deux preuves : (1) une matrice d'accès EXPLICITE (attendue en dur : elle échoue si la nouvelle politique ouvre une fuite,
 * quelle que soit l'ancienne) ; (2) l'ÉQUIVALENCE : les mêmes lignes sont visibles et les mêmes écritures acceptées sous la
 * politique ligne à ligne rétablie (AVANT) et sous la politique ensembliste (APRÈS).
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

const uuid = (n: number) => `0047e5e5-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CAB_X = uuid(1);
const CAB_Y = uuid(2);
const U = {
  aucun: uuid(11), // membre actif de X, aucune habilitation
  multi: uuid(12), // X : lecture sur D1, collaboration sur D2, depot sur D3, validation sur D4, rien sur D5
  expire: uuid(13), // appartenance EXPIRÉE : validation sur D1 sans effet
  inactif: uuid(14), // appartenance désactivée : validation sur D1 sans effet
  deposant: uuid(15), // client déposant : depot sur D1
  temporaire: uuid(16), // accès temporaire encore valide (expire demain) : lecture sur D1
  autreCabinet: uuid(17), // membre de Y : validation sur DY1
  gestionnaire: uuid(18), // administrateur de X sans habilitation
} as const;
const D = { d1: uuid(101), d2: uuid(102), d3: uuid(103), d4: uuid(104), d5: uuid(105), dy1: uuid(201) } as const;
const ID_EX = (d: string) => `0047e5e5-1000-4000-8000-${d.slice(-12)}`;

type Profil = { nom: string; cabinet: string; utilisateur: string; ex: string[]; ecriture: string[]; collecte: string[]; depotAccepte: string[] };
const PROFILS: Profil[] = [
  // ex : dossiers dont les exercices sont visibles (niveau >= lecture) ; ecriture : dossiers où l'écriture d'un exercice est acceptée (>= collaboration) ;
  // collecte : dossiers où les dépôts (televersements) sont visibles (tout niveau habilité) ; depotAccepte : où un dépôt est accepté.
  { nom: 'utilisateur sans habilitation', cabinet: CAB_X, utilisateur: U.aucun, ex: [], ecriture: [], collecte: [], depotAccepte: [] },
  { nom: 'plusieurs niveaux (lecture, collaboration, depot, validation)', cabinet: CAB_X, utilisateur: U.multi, ex: [D.d1, D.d2, D.d4], ecriture: [D.d2, D.d4], collecte: [D.d1, D.d2, D.d3, D.d4], depotAccepte: [D.d1, D.d2, D.d3, D.d4] },
  { nom: 'appartenance expirée', cabinet: CAB_X, utilisateur: U.expire, ex: [], ecriture: [], collecte: [], depotAccepte: [] },
  { nom: 'appartenance désactivée', cabinet: CAB_X, utilisateur: U.inactif, ex: [], ecriture: [], collecte: [], depotAccepte: [] },
  { nom: 'client déposant (niveau depot)', cabinet: CAB_X, utilisateur: U.deposant, ex: [], ecriture: [], collecte: [D.d1], depotAccepte: [D.d1] },
  { nom: 'accès temporaire encore valide', cabinet: CAB_X, utilisateur: U.temporaire, ex: [D.d1], ecriture: [], collecte: [D.d1], depotAccepte: [D.d1] },
  { nom: 'membre d’un autre cabinet, dans son cabinet', cabinet: CAB_Y, utilisateur: U.autreCabinet, ex: [D.dy1], ecriture: [D.dy1], collecte: [D.dy1], depotAccepte: [D.dy1] },
  { nom: 'membre d’un autre cabinet qui usurpe le cabinet X', cabinet: CAB_X, utilisateur: U.autreCabinet, ex: [], ecriture: [], collecte: [], depotAccepte: [] },
  { nom: 'administrateur sans habilitation (gestionnaire, pas le contenu)', cabinet: CAB_X, utilisateur: U.gestionnaire, ex: [], ecriture: [], collecte: [], depotAccepte: [] },
  { nom: 'sans contexte', cabinet: '', utilisateur: '', ex: [], ecriture: [], collecte: [], depotAccepte: [] },
];

async function fixtures(): Promise<void> {
  const q = (t: string, p: unknown[] = []) => admin.query(t, p);
  await q(`insert into cabinets (id, nom) values ($1, 'Cabinet X 0047 (essai)'), ($2, 'Cabinet Y 0047 (essai)')`, [CAB_X, CAB_Y]);
  for (const [nom, id] of Object.entries(U)) await q(`insert into utilisateurs (id, sujet_oidc, email, nom) values ($1::uuid, $1::text, $2, $3)`, [id, `${nom}@essai-0047.test`, `Essai ${nom}`]);
  const app = (cab: string, u: string, role: string, extra = 'true, null') => q(`insert into appartenances (cabinet_id, utilisateur_id, role, actif, expire_le) values ($1, $2, $3, ${extra})`, [cab, u, role]);
  await app(CAB_X, U.aucun, 'collaborateur');
  await app(CAB_X, U.multi, 'reviseur');
  await app(CAB_X, U.expire, 'reviseur', `true, now() - interval '1 day'`);
  await app(CAB_X, U.inactif, 'reviseur', 'false, null');
  await app(CAB_X, U.deposant, 'client_deposant');
  await app(CAB_X, U.temporaire, 'client_lecture', `true, now() + interval '1 day'`);
  await app(CAB_Y, U.autreCabinet, 'reviseur');
  await app(CAB_X, U.gestionnaire, 'administrateur');
  for (const [k, d] of Object.entries(D)) {
    await q(`insert into entites (id, cabinet_id, raison_sociale) values ($1, $2, $3)`, [d, k === 'dy1' ? CAB_Y : CAB_X, `Dossier ${k} 0047 (essai)`]);
    await q(`insert into exercices (id, cabinet_id, entite_id, debut, fin) values ($1, $2, $3, '2025-01-01', '2025-12-31')`, [ID_EX(d), k === 'dy1' ? CAB_Y : CAB_X, d]);
    await q(`insert into televersements (cabinet_id, entite_id, utilisateur_id, canal, nom_fichier, taille_attendue, sha256_attendu, expire_le)
             values ($1, $2, $3, 'ordinateur', 'essai.pdf', 1, repeat('0', 64), now() + interval '1 day')`, [k === 'dy1' ? CAB_Y : CAB_X, d, k === 'dy1' ? U.autreCabinet : U.multi]);
  }
  const hab = (cab: string, d: string, u: string, niveau: string) => q(`insert into habilitations_dossier (cabinet_id, entite_id, utilisateur_id, niveau) values ($1, $2, $3, $4)`, [cab, d, u, niveau]);
  await hab(CAB_X, D.d1, U.multi, 'lecture');
  await hab(CAB_X, D.d2, U.multi, 'collaboration');
  await hab(CAB_X, D.d3, U.multi, 'depot');
  await hab(CAB_X, D.d4, U.multi, 'validation');
  await hab(CAB_X, D.d1, U.expire, 'validation');
  await hab(CAB_X, D.d1, U.inactif, 'validation');
  await hab(CAB_X, D.d1, U.deposant, 'depot');
  await hab(CAB_X, D.d1, U.temporaire, 'lecture');
  await hab(CAB_Y, D.dy1, U.autreCabinet, 'validation');
}

/** Exécute `fn` dans une transaction d'administration TOUJOURS annulée, jeux d'essai posés. */
async function dansTransactionAnnulee(fn: () => Promise<void>): Promise<void> {
  await admin.query('begin');
  try {
    await fixtures();
    await fn();
  } finally {
    await admin.query('rollback');
  }
}

async function sousRoleApp<T>(p: Profil, fn: () => Promise<T>): Promise<T> {
  await admin.query('set local role comtaple_app');
  await admin.query(`select set_config('app.cabinet_id', $1::text, true), set_config('app.utilisateur_id', $2::text, true), set_config('app.sujet', $2::text, true)`, [p.cabinet, p.utilisateur]);
  try {
    return await fn();
  } finally {
    await admin.query('reset role');
  }
}
interface Observation {
  exercicesVisibles: string[];
  collecteVisible: string[];
  ecritureExercice: string[];
  depotAccepte: string[];
  lectureEntites: string[];
}
const dossiersEssai = Object.values(D);
async function observer(p: Profil): Promise<Observation> {
  return sousRoleApp(p, async () => {
    const ex = (await admin.query(`select entite_id from exercices where entite_id = any($1::uuid[]) order by 1`, [dossiersEssai])).rows.map((r) => r.entite_id as string);
    const col = (await admin.query(`select distinct entite_id from televersements where entite_id = any($1::uuid[]) order by 1`, [dossiersEssai])).rows.map((r) => r.entite_id as string);
    const en = (await admin.query(`select id from entites where id = any($1::uuid[]) order by 1`, [dossiersEssai])).rows.map((r) => r.id as string);
    const ecriture: string[] = [];
    const depot: string[] = [];
    for (const d of dossiersEssai) {
      const cab = d === D.dy1 ? CAB_Y : CAB_X;
      // Écrire dans exercices : exige collaboration (WITH CHECK) ; la ligne insérée est ensuite abandonnée (savepoint annulé).
      await admin.query('savepoint w');
      try {
        await admin.query(`insert into exercices (cabinet_id, entite_id, debut, fin) values ($1, $2, '2030-01-01', '2030-12-31')`, [cab, d]);
        ecriture.push(d);
      } catch {
        /* refusé */
      }
      await admin.query('rollback to savepoint w');
      await admin.query('savepoint w2');
      try {
        await admin.query(`insert into televersements (cabinet_id, entite_id, utilisateur_id, canal, nom_fichier, taille_attendue, sha256_attendu, expire_le)
                           values ($1, $2, $3, 'ordinateur', 'x.pdf', 1, repeat('1', 64), now() + interval '1 day')`, [cab, d, p.utilisateur || null]);
        depot.push(d);
      } catch {
        /* refusé */
      }
      await admin.query('rollback to savepoint w2');
    }
    return { exercicesVisibles: [...new Set(ex)], collecteVisible: col, ecritureExercice: ecriture, depotAccepte: depot, lectureEntites: en };
  });
}

const tri = (x: string[]) => [...x].sort();
const attendu = (p: Profil) => ({ ex: tri(p.ex), col: tri(p.collecte), ecr: tri(p.ecriture), dep: tri(p.depotAccepte) });
const vu = (o: Observation) => ({ ex: tri(o.exercicesVisibles), col: tri(o.collecteVisible), ecr: tri(o.ecritureExercice), dep: tri(o.depotAccepte) });

describe('politiques de dossier ensemblistes (migration 0047)', () => {
  it('la migration est en place : fonction ensembliste présente, plus aucune politique « acces_dossier » ligne à ligne hors entites', async () => {
    const f = await admin.query(`select count(*)::int n from pg_proc where proname = 'app_entites_niveau_min'`);
    expect(f.rows[0].n).toBe(1);
    const r = await admin.query(
      `select c.relname from pg_policy o join pg_class c on c.oid = o.polrelid
       where o.polname = 'acces_dossier' and c.relname <> 'entites'
         and (coalesce(pg_get_expr(o.polqual, o.polrelid), '') || coalesce(pg_get_expr(o.polwithcheck, o.polrelid), '')) like '%app_niveau_entite(%'`,
    );
    expect(r.rows.map((x) => x.relname)).toEqual([]);
    // La politique d'entites (clé « id », OU gestionnaire) n'a pas été touchée.
    const e = await admin.query(`select pg_get_expr(polqual, polrelid) q from pg_policy where polrelid = 'entites'::regclass and polname = 'acces_dossier'`);
    expect(e.rows[0].q).toContain('app_niveau_entite(id)');
  });

  it('la fonction ensembliste est exécutée sous l’identité de l’appelant (ni SECURITY DEFINER, ni leakproof) et STABLE', async () => {
    const r = await admin.query(`select prosecdef, provolatile::text v, proleakproof, proretset from pg_proc where proname = 'app_entites_niveau_min'`);
    expect(r.rows[0]).toEqual({ prosecdef: false, v: 's', proleakproof: false, proretset: true });
  });

  describe('matrice d’accès attendue en dur (échoue à la moindre fuite)', () => {
    for (const p of PROFILS) {
      it(p.nom, async () => {
        await dansTransactionAnnulee(async () => {
          expect(vu(await observer(p))).toEqual(attendu(p));
        });
      });
    }
    it('niveau insuffisant : « lecture » ne permet pas d’écrire, « depot » ne permet pas de lire un exercice', async () => {
      await dansTransactionAnnulee(async () => {
        const o = await observer(PROFILS.find((x) => x.utilisateur === U.multi)!);
        expect(o.ecritureExercice).not.toContain(D.d1); // lecture
        expect(o.ecritureExercice).not.toContain(D.d3); // depot
        expect(o.exercicesVisibles).not.toContain(D.d3); // depot : pas de lecture des exercices
        expect(o.exercicesVisibles).not.toContain(D.d5); // aucune habilitation
      });
    });
    it('un dossier d’un autre cabinet reste invisible même pour un utilisateur habilité ailleurs', async () => {
      await dansTransactionAnnulee(async () => {
        const o = await observer(PROFILS.find((x) => x.utilisateur === U.multi)!);
        expect(o.lectureEntites).not.toContain(D.dy1);
        expect(o.exercicesVisibles).not.toContain(D.dy1);
        expect(o.collecteVisible).not.toContain(D.dy1);
        expect(o.depotAccepte).not.toContain(D.dy1);
      });
    });
  });

  describe('équivalence AVANT/APRÈS : politique ligne à ligne rétablie puis politique ensembliste', () => {
    it('mêmes lignes visibles et mêmes écritures acceptées pour chaque profil, et retour arrière + réapplication fidèles', async () => {
      await dansTransactionAnnulee(async () => {
        const apres = new Map<string, Observation>();
        for (const p of PROFILS) apres.set(p.nom, await observer(p));
        // Retour arrière de la migration : le même état que AVANT 0047.
        const restaurees = (await admin.query(`select securite_restaurer_rls_ligne_a_ligne() n`)).rows[0].n as number;
        expect(restaurees).toBeGreaterThanOrEqual(40);
        const reste = await admin.query(
          `select count(*)::int n from pg_policy o join pg_class c on c.oid = o.polrelid
           where o.polname = 'acces_dossier' and pg_get_expr(o.polqual, o.polrelid) like '%app_entites_niveau_min%'`,
        );
        expect(reste.rows[0].n).toBe(0);
        for (const p of PROFILS) expect(vu(await observer(p)), `AVANT, ${p.nom}`).toEqual(vu(apres.get(p.nom)!));
        for (const p of PROFILS) expect((await observer(p)).lectureEntites, `entites, ${p.nom}`).toEqual(apres.get(p.nom)!.lectureEntites);
        // Réapplication : retour à la forme ensembliste.
        const reecrites = (await admin.query(`select securite_reecrire_acces_dossier('ensembliste') n`)).rows[0].n as number;
        expect(reecrites).toBe(restaurees);
        for (const p of PROFILS) expect(vu(await observer(p)), `APRÈS réapplication, ${p.nom}`).toEqual(vu(apres.get(p.nom)!));
      });
    });
  });

  it('securite_appliquer_rls() pose la forme ensembliste sur une table future, et le retour arrière rétablit l’ancienne', async () => {
    await admin.query('begin');
    try {
      await admin.query(`create table essai_0047 (id uuid primary key default gen_random_uuid(), cabinet_id uuid not null, entite_id uuid not null)`);
      await admin.query(`select securite_appliquer_rls()`);
      const lire = async () =>
        (await admin.query(`select pg_get_expr(polqual, polrelid) q, pg_get_expr(polwithcheck, polrelid) w from pg_policy where polrelid = 'essai_0047'::regclass and polname = 'acces_dossier'`)).rows[0];
      const nouvelle = await lire();
      expect(nouvelle.q).toContain(`app_entites_niveau_min('lecture'`);
      expect(nouvelle.w).toContain(`app_entites_niveau_min('collaboration'`);
      await admin.query(`select securite_restaurer_rls_ligne_a_ligne()`);
      await admin.query(`drop table essai_0047`);
      await admin.query(`create table essai_0047 (id uuid primary key default gen_random_uuid(), cabinet_id uuid not null, entite_id uuid not null)`);
      await admin.query(`select securite_appliquer_rls()`);
      const ancienne = await lire();
      expect(ancienne.q).toContain('app_niveau_entite(entite_id)');
      expect(ancienne.w).toContain(`'collaboration'`);
    } finally {
      await admin.query('rollback');
    }
  });

  it('le rôle applicatif ne contourne pas la politique : une requête sans filtre de dossier ne rend que les dossiers autorisés', async () => {
    await dansTransactionAnnulee(async () => {
      const p = PROFILS.find((x) => x.utilisateur === U.multi)!;
      const r = await sousRoleApp(p, async () => (await admin.query(`select distinct entite_id from exercices where entite_id = any($1::uuid[])`, [dossiersEssai])).rows.map((x) => x.entite_id as string));
      expect(tri(r)).toEqual(tri([D.d1, D.d2, D.d4]));
      // Une habilitation retirée est sans effet immédiat sur les lignes d'un AUTRE utilisateur : vérifie que la politique suit la table.
      await admin.query(`delete from habilitations_dossier where entite_id = $1 and utilisateur_id = $2`, [D.d4, U.multi]);
      const apres = await sousRoleApp(p, async () => (await admin.query(`select distinct entite_id from exercices where entite_id = any($1::uuid[])`, [dossiersEssai])).rows.map((x) => x.entite_id as string));
      expect(tri(apres)).toEqual(tri([D.d1, D.d2]));
    });
  });
});
