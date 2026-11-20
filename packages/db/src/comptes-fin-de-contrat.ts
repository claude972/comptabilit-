/**
 * Comptes et fiches d'utilisateurs après la fin de contrat d'un cabinet (D-099).
 *
 * La procédure de fin de contrat (`finDeContrat`) supprime les appartenances du cabinet mais ne touche ni à la table
 * « utilisateurs » (sans `cabinet_id`) ni au fournisseur d'identité. Ce module :
 *
 *  - LISTE (lecture seule) les comptes qui ne devraient plus exister : ceux dont la SEULE appartenance est ce cabinet ;
 *  - établit un PLAN daté (désactivation, puis suppression du compte du fournisseur d'identité ; suppression ou
 *    pseudonymisation de la fiche) selon les paramètres de durées ;
 *  - EXÉCUTE la partie « fiches » (table utilisateurs) UNIQUEMENT sur une base d'essai isolée (`exigerBaseEssai`) ;
 *    la partie « fournisseur d'identité » est exécutée par `@comtaple/plateforme` (`FournisseurIdentiteEssai`),
 *    uniquement contre un royaume d'essai éphémère.
 *
 * Un compte qui appartient aussi à un AUTRE cabinet n'est jamais listé pour suppression : retirer l'accès à ce cabinet
 * a été fait par la suppression des appartenances. Une fiche encore référencée (par une table conservée) n'est pas
 * supprimée mais pseudonymisée : l'identifiant reste, la personne ne l'est plus.
 */
import type pg from 'pg';
import { type ParametresCharges, ajouterJours } from './durees-conservation.js';
import { ANONYMISATION_FIN_DE_CONTRAT, POLITIQUE_FIN_DE_CONTRAT, exigerAdministration } from './provisionnement.js';

export interface CompteACloturer {
  utilisateurId: string;
  /** Sujet OIDC : identifiant du compte dans le fournisseur d'identité (« sub »). */
  sujetOidc: string;
  email: string;
  nom: string;
  role: string;
  /** Accès support (borné dans le temps) ou appartenance ordinaire. */
  support: boolean;
  /** Références restantes vers la fiche après la fin de contrat (tables conservées, autres cabinets, tables sans cabinet). */
  referencesRestantes: number;
  /** Devenir de la fiche : supprimer (aucune référence) ou pseudonymiser (conservée sous un identifiant sans personne). */
  devenirFiche: 'supprimer' | 'pseudonymiser';
  /** Dates (AAAA-MM-JJ) : désactivation puis suppression du compte du fournisseur d'identité. null si l'abonnement n'est pas résilié. */
  desactiverLe: string | null;
  supprimerLe: string | null;
}

export interface PlanComptes {
  format: 'comtaple.plan-comptes-fin-de-contrat/1';
  cabinetId: string;
  simulation: true;
  parametres: { version: string; statut: string; empreinte: string };
  /** Comptes avec une autre appartenance : listés pour mémoire, JAMAIS touchés. */
  comptesConserves: Array<{ utilisateurId: string; email: string; autresCabinets: number }>;
  comptes: CompteACloturer[];
  avertissements: string[];
}

interface CleVersUtilisateur { enfant: string; colonne: string }

async function cles(client: pg.ClientBase): Promise<CleVersUtilisateur[]> {
  const r = await client.query<{ enfant: string; colonne: string }>(
    `select e.relname as enfant, a.attname as colonne from pg_constraint c join pg_class e on e.oid = c.conrelid join pg_class p on p.oid = c.confrelid
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey) where c.contype = 'f' and c.connamespace = 'public'::regnamespace and p.relname = 'utilisateurs' order by 1, 2`,
  );
  return r.rows;
}
async function aCabinetId(client: pg.ClientBase, table: string): Promise<boolean> {
  return (await client.query(`select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'cabinet_id'`, [table])).rowCount === 1;
}
const ident = (n: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error(`Identifiant SQL inattendu : ${n}`);
  return `"${n}"`;
};

/**
 * Références restantes vers chaque fiche. `aprèsFinDeContratDe` : on ignore les lignes du cabinet qui seront supprimées
 * (ou dont la colonne sera mise à vide) par la fin de contrat ; sans lui, on compte tout (état après exécution).
 */
async function referencesRestantes(client: pg.ClientBase, ids: readonly string[], apresFinDeContratDe?: string): Promise<Map<string, number>> {
  const total = new Map(ids.map((i) => [i, 0]));
  if (!ids.length) return total;
  const supprimees = new Set(POLITIQUE_FIN_DE_CONTRAT.categories.filter((c) => c.devenir === 'supprimer' || c.devenir === 'restituer_puis_supprimer').flatMap((c) => c.tables));
  for (const k of await cles(client)) {
    let condition = '';
    const params: unknown[] = [ids];
    if (apresFinDeContratDe) {
      if (supprimees.has(k.enfant)) {
        condition = ' and cabinet_id <> $2';
        params.push(apresFinDeContratDe);
      } else if ((ANONYMISATION_FIN_DE_CONTRAT[k.enfant] ?? []).includes(k.colonne) && (await aCabinetId(client, k.enfant))) {
        condition = ' and cabinet_id <> $2';
        params.push(apresFinDeContratDe);
      }
    }
    const r = await client.query<{ u: string; n: string }>(`select ${ident(k.colonne)}::text as u, count(*)::text as n from ${ident(k.enfant)} where ${ident(k.colonne)} = any ($1::uuid[])${condition} group by 1`, params);
    for (const l of r.rows) total.set(l.u, (total.get(l.u) ?? 0) + Number(l.n));
  }
  return total;
}

/**
 * Comptes qui ne devraient plus exister après la fin de contrat de `cabinetId` : leur seule appartenance est ce cabinet.
 * LECTURE SEULE (transaction `read only`). Utilisable avant ou après l'exécution de la fin de contrat.
 */
export async function planComptesFinDeContrat(client: pg.ClientBase, cabinetId: string, chargees: ParametresCharges): Promise<PlanComptes> {
  await client.query('begin transaction read only');
  try {
    await exigerAdministration(client);
    if (!(await client.query('select 1 from cabinets where id = $1', [cabinetId])).rowCount) throw new Error(`Cabinet introuvable : ${cabinetId}`);
    const ab = (await client.query<{ statut: string; fin: string | null }>('select statut, fin::text from abonnements where cabinet_id = $1', [cabinetId])).rows[0];
    const fin = ab?.statut === 'resilie' ? ab.fin : null;
    const c = chargees.parametres.comptes;
    // Après exécution, les appartenances du cabinet n'existent plus : on retrouve alors les comptes par la table de fin de contrat ? Non :
    // le plan se lit AVANT (appartenances présentes) ; après, `planFichesOrphelines` prend le relais (fiches sans aucune appartenance).
    const membres = (await client.query<{ id: string; sujet: string; email: string; nom: string; role: string; support: boolean; autres: string }>(
      `select u.id::text as id, u.sujet_oidc as sujet, u.email, u.nom, a.role::text as role, (a.expire_le is not null) as support,
              (select count(*) from appartenances b where b.utilisateur_id = u.id and b.cabinet_id <> $1)::text as autres
         from appartenances a join utilisateurs u on u.id = a.utilisateur_id where a.cabinet_id = $1 order by u.email`,
      [cabinetId],
    )).rows;
    const aCloturer = membres.filter((m) => Number(m.autres) === 0);
    const refs = await referencesRestantes(client, aCloturer.map((m) => m.id), cabinetId);
    const avertissements: string[] = [];
    if (chargees.nonValide) avertissements.push('Durées : PROPOSITION NON VALIDÉE. Aucune valeur juridique.');
    if (!fin) avertissements.push('Abonnement non résilié (ou sans date de fin) : dates de désactivation et de suppression non calculables.');
    return {
      format: 'comtaple.plan-comptes-fin-de-contrat/1',
      cabinetId,
      simulation: true,
      parametres: { version: chargees.parametres.version, statut: chargees.parametres.statut, empreinte: chargees.empreinte },
      comptesConserves: membres.filter((m) => Number(m.autres) > 0).map((m) => ({ utilisateurId: m.id, email: m.email, autresCabinets: Number(m.autres) })),
      comptes: aCloturer.map((m) => {
        const desactiverLe = fin ? ajouterJours(fin, chargees.parametres.delaiGraceJours + c.delaiDesactivationJours) : null;
        const nb = refs.get(m.id) ?? 0;
        return { utilisateurId: m.id, sujetOidc: m.sujet, email: m.email, nom: m.nom, role: m.role, support: m.support, referencesRestantes: nb, devenirFiche: nb === 0 ? 'supprimer' : 'pseudonymiser', desactiverLe, supprimerLe: desactiverLe ? ajouterJours(desactiverLe, c.delaiSuppressionApresDesactivationJours) : null };
      }),
      avertissements,
    };
  } finally {
    await client.query('rollback');
  }
}

// ───────────────────────────── Fiches orphelines ─────────────────────────────

export interface FicheOrpheline {
  utilisateurId: string;
  sujetOidc: string;
  email: string;
  nom: string;
  referencesRestantes: number;
  devenir: 'supprimer' | 'pseudonymiser';
  dejaPseudonymisee: boolean;
}
export interface PlanFiches { format: 'comtaple.plan-fiches-orphelines/1'; simulation: boolean; fiches: FicheOrpheline[] }

const FICHE_PSEUDONYMISEE = /^supprime:[0-9a-f-]{36}$/;

/** Fiches « utilisateurs » sans AUCUNE appartenance : lecture seule. Une fiche déjà pseudonymisée est signalée, pas refaite. */
export async function planFichesOrphelines(client: pg.ClientBase): Promise<PlanFiches> {
  await client.query('begin transaction read only');
  try {
    await exigerAdministration(client);
    const l = (await client.query<{ id: string; sujet: string; email: string; nom: string }>(`select u.id::text as id, u.sujet_oidc as sujet, u.email, u.nom from utilisateurs u where not exists (select 1 from appartenances a where a.utilisateur_id = u.id) order by u.email`)).rows;
    const refs = await referencesRestantes(client, l.map((x) => x.id));
    return { format: 'comtaple.plan-fiches-orphelines/1', simulation: true, fiches: l.map((x) => ({ utilisateurId: x.id, sujetOidc: x.sujet, email: x.email, nom: x.nom, referencesRestantes: refs.get(x.id) ?? 0, devenir: (refs.get(x.id) ?? 0) === 0 ? 'supprimer' : 'pseudonymiser', dejaPseudonymisee: FICHE_PSEUDONYMISEE.test(x.sujet) })) };
  } finally {
    await client.query('rollback');
  }
}

/** Refuse toute base qui n'est pas une base d'ESSAI isolée : nom `comtaple_essai_…` et différente de la base configurée. */
export async function exigerBaseEssai(client: pg.ClientBase, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const b = (await client.query<{ b: string }>('select current_database() as b')).rows[0]!.b;
  if (!/^comtaple_essai_[a-z0-9_]+$/.test(b) || b === (env.PG_DATABASE ?? 'comtaple') || b === 'comtaple') throw new Error(`Refus : la base « ${b} » n’est pas une base d’essai isolée (nom comtaple_essai_…). Cette exécution n’est permise que sur une base jetable créée par un test.`);
  return b;
}

export interface RapportFiches { traitees: Array<{ utilisateurId: string; action: 'supprimee' | 'pseudonymisee' | 'deja_pseudonymisee' }>; supprimees: number; pseudonymisees: number; dejaPseudonymisees: number }

/**
 * Exécute le plan des fiches orphelines (base d'ESSAI isolée seulement) : supprime la fiche sans référence, pseudonymise
 * celle qui reste référencée (e-mail, nom et sujet OIDC remplacés ; l'identifiant demeure). Une transaction par fiche ;
 * idempotente (une fiche déjà pseudonymisée n'est pas refaite). Ne touche à aucune fiche ayant une appartenance.
 */
export async function appliquerFichesOrphelinesEssai(client: pg.ClientBase, p: { appliquer: boolean; limite?: number; env?: NodeJS.ProcessEnv; /** Ne traite que ces fiches (celles du plan d'un cabinet) : les autres fiches sans appartenance restent intactes. */ seulement?: readonly string[] }): Promise<RapportFiches> {
  await exigerBaseEssai(client, p.env);
  const plan = await planFichesOrphelines(client);
  if (p.seulement) plan.fiches = plan.fiches.filter((f) => p.seulement!.includes(f.utilisateurId));
  const rapport: RapportFiches = { traitees: [], supprimees: 0, pseudonymisees: 0, dejaPseudonymisees: 0 };
  if (!p.appliquer) return rapport;
  for (const f of plan.fiches.slice(0, p.limite ?? plan.fiches.length)) {
    if (f.dejaPseudonymisee) {
      rapport.traitees.push({ utilisateurId: f.utilisateurId, action: 'deja_pseudonymisee' });
      rapport.dejaPseudonymisees++;
      continue;
    }
    await client.query('begin');
    try {
      // Revérifie dans la transaction : la fiche est toujours sans appartenance, et ses références n'ont pas changé.
      const encore = await client.query('select 1 from utilisateurs u where u.id = $1 and not exists (select 1 from appartenances a where a.utilisateur_id = u.id) for update', [f.utilisateurId]);
      if (!encore.rowCount) {
        await client.query('rollback');
        continue;
      }
      const refs = (await referencesRestantes(client, [f.utilisateurId])).get(f.utilisateurId) ?? 0;
      if (refs === 0) {
        await client.query('delete from utilisateurs where id = $1', [f.utilisateurId]);
        rapport.supprimees++;
        rapport.traitees.push({ utilisateurId: f.utilisateurId, action: 'supprimee' });
      } else {
        await client.query(`update utilisateurs set sujet_oidc = 'supprime:' || id::text, email = 'supprime-' || left(id::text, 8) || '@invalide.test', nom = 'Compte supprimé' where id = $1`, [f.utilisateurId]);
        rapport.pseudonymisees++;
        rapport.traitees.push({ utilisateurId: f.utilisateurId, action: 'pseudonymisee' });
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    }
  }
  return rapport;
}
