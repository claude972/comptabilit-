/**
 * Migration 0048 (D-096) : réglage de la tolérance de montant (`reglages_tiers_factures`), empreinte de clé VAPID des
 * abonnements, fonction d'alerte d'expiration de la preuve IA.
 *
 * Tout se passe dans UNE transaction d'administration TOUJOURS annulée : jeux d'essai, notifications et lignes du journal
 * n'existent que le temps du test ; rien n'est conservé dans la base locale. Les requêtes d'accès sont exécutées sous le
 * rôle applicatif (NOBYPASSRLS) avec le contexte posé comme le fait l'API.
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

const uuid = (n: number) => `0048e5e5-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CAB_X = uuid(1);
const CAB_Y = uuid(2);
const U = { admin: uuid(11), reviseur: uuid(12), collab: uuid(13), lecteur: uuid(14), deposant: uuid(15), autre: uuid(16), muet: uuid(17), associe: uuid(18), inactif: uuid(19) } as const;
const D = { d1: uuid(101), d2: uuid(102), dy: uuid(201) } as const;
const VERIF = uuid(901);

async function fixtures(): Promise<void> {
  const q = (t: string, p: unknown[] = []) => admin.query(t, p);
  await q(`insert into cabinets (id, nom) values ($1, 'Cabinet X 0048 (essai)'), ($2, 'Cabinet Y 0048 (essai)')`, [CAB_X, CAB_Y]);
  for (const [nom, id] of Object.entries(U)) await q(`insert into utilisateurs (id, sujet_oidc, email, nom) values ($1::uuid, $1::text, $2, $3)`, [id, `${nom}@essai-0048.test`, `Essai ${nom}`]);
  const app = (cab: string, u: string, role: string, actif = true) => q(`insert into appartenances (cabinet_id, utilisateur_id, role, actif) values ($1, $2, $3, $4)`, [cab, u, role, actif]);
  await app(CAB_X, U.admin, 'administrateur');
  await app(CAB_X, U.associe, 'associe');
  await app(CAB_X, U.muet, 'administrateur');
  await app(CAB_X, U.inactif, 'administrateur', false);
  await app(CAB_X, U.reviseur, 'reviseur');
  await app(CAB_X, U.collab, 'collaborateur');
  await app(CAB_X, U.lecteur, 'client_lecture');
  await app(CAB_X, U.deposant, 'client_deposant');
  await app(CAB_Y, U.autre, 'administrateur');
  for (const [k, d] of Object.entries(D)) await q(`insert into entites (id, cabinet_id, raison_sociale) values ($1, $2, $3)`, [d, k === 'dy' ? CAB_Y : CAB_X, `Dossier ${k} 0048 (essai)`]);
  const hab = (cab: string, d: string, u: string, niveau: string) => q(`insert into habilitations_dossier (cabinet_id, entite_id, utilisateur_id, niveau) values ($1, $2, $3, $4)`, [cab, d, u, niveau]);
  await hab(CAB_X, D.d1, U.reviseur, 'revision');
  await hab(CAB_X, D.d1, U.collab, 'collaboration');
  await hab(CAB_X, D.d1, U.lecteur, 'lecture');
  await hab(CAB_X, D.d1, U.deposant, 'depot');
  await hab(CAB_X, D.d2, U.collab, 'collaboration'); // d2 : le réviseur n'a aucune habilitation
  await hab(CAB_Y, D.dy, U.autre, 'validation');
}

async function dansTransactionAnnulee(fn: () => Promise<void>): Promise<void> {
  await admin.query('begin');
  try {
    await fixtures();
    await fn();
  } finally {
    await admin.query('rollback');
  }
}

async function sous<T>(role: 'comtaple_app' | 'comtaple_worker', cabinet: string, utilisateur: string, fn: () => Promise<T>): Promise<T> {
  await admin.query(`set local role ${role}`);
  await admin.query(`select set_config('app.cabinet_id', $1::text, true), set_config('app.utilisateur_id', $2::text, true), set_config('app.sujet', $2::text, true)`, [cabinet, utilisateur]);
  try {
    return await fn();
  } finally {
    await admin.query('reset role');
  }
}
/** Tente une écriture ; renvoie true si elle est acceptée (puis annulée), false si refusée. */
async function ecritureAcceptee(sql: string, params: unknown[]): Promise<boolean> {
  await admin.query('savepoint e');
  try {
    await admin.query(sql, params);
    return true;
  } catch {
    return false;
  } finally {
    await admin.query('rollback to savepoint e');
  }
}

const INSERT_REGLAGE = `insert into reglages_tiers_factures (cabinet_id, dossier_id, tolerance_montant, motif, regle_par) values ($1, $2, $3, 'essai', $4)`;

describe('migration 0048 : réglage de la tolérance de montant — politiques de la base', () => {
  it('RLS activée ET forcée ; ajout seul pour l’application ; lecture seule pour le worker', async () => {
    const r = (await admin.query(`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'reglages_tiers_factures'`)).rows[0];
    expect(r).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const droits = async (role: string) =>
      (await admin.query(`select privilege_type from information_schema.role_table_grants where table_name = 'reglages_tiers_factures' and grantee = $1 order by 1`, [role])).rows.map((x) => x.privilege_type as string);
    expect(await droits('comtaple_app')).toEqual(['INSERT', 'SELECT']);
    expect(await droits('comtaple_worker')).toEqual(['SELECT']); // lecture seule : les restitutions exportent l'historique
    const politiques = (await admin.query(`select policyname, permissive, cmd from pg_policies where tablename = 'reglages_tiers_factures' order by 1`)).rows;
    expect(politiques.map((p) => `${p.policyname}:${p.permissive}:${p.cmd}`)).toEqual(['isolation_cabinet:PERMISSIVE:ALL', 'reglage_ecriture:RESTRICTIVE:INSERT', 'reglage_lecture:RESTRICTIVE:SELECT']);
  });

  it('écriture : cabinet = gestionnaires seulement ; dossier = niveau révision ; jamais pour un autre cabinet', async () => {
    await dansTransactionAnnulee(async () => {
      const accepte = (cabinet: string, utilisateur: string, dossier: string | null, cabinetLigne = cabinet) => sous('comtaple_app', cabinet, utilisateur, () => ecritureAcceptee(INSERT_REGLAGE, [cabinetLigne, dossier, '5.00', utilisateur]));
      // Cabinet (dossier nul)
      expect(await accepte(CAB_X, U.admin, null)).toBe(true);
      expect(await accepte(CAB_X, U.associe, null)).toBe(true);
      for (const u of [U.reviseur, U.collab, U.lecteur, U.deposant]) expect(await accepte(CAB_X, u, null), `cabinet par ${u}`).toBe(false);
      // Dossier d1 : révision seulement (l'administrateur sans habilitation ne l'a pas)
      expect(await accepte(CAB_X, U.reviseur, D.d1)).toBe(true);
      for (const u of [U.collab, U.lecteur, U.deposant, U.admin]) expect(await accepte(CAB_X, u, D.d1), `dossier par ${u}`).toBe(false);
      // Dossier d2 : le réviseur n'y est pas habilité
      expect(await accepte(CAB_X, U.reviseur, D.d2)).toBe(false);
      // Un autre cabinet ne peut ni écrire dans X (cabinet usurpé), ni viser un dossier de X
      expect(await accepte(CAB_X, U.autre, null)).toBe(false);
      expect(await sous('comtaple_app', CAB_Y, U.autre, () => ecritureAcceptee(INSERT_REGLAGE, [CAB_X, null, '5.00', U.autre]))).toBe(false);
      expect(await sous('comtaple_app', CAB_Y, U.autre, () => ecritureAcceptee(INSERT_REGLAGE, [CAB_Y, D.d1, '5.00', U.autre]))).toBe(false);
      // Sans contexte
      expect(await sous('comtaple_app', '', '', () => ecritureAcceptee(INSERT_REGLAGE, [CAB_X, null, '5.00', U.admin]))).toBe(false);
    });
  });

  it('lecture : le réglage du cabinet est lisible par ses membres ; celui d’un dossier seulement avec le niveau « lecture » ; jamais entre cabinets', async () => {
    await dansTransactionAnnulee(async () => {
      await admin.query(`insert into reglages_tiers_factures (cabinet_id, dossier_id, tolerance_montant, motif, regle_par) values ($1, null, 2, 'cabinet', $2), ($1, $3, 7, 'dossier d1', $2), ($1, $4, 9, 'dossier d2', $2)`, [CAB_X, U.admin, D.d1, D.d2]);
      await admin.query(`insert into reglages_tiers_factures (cabinet_id, dossier_id, tolerance_montant, motif, regle_par) values ($1, null, 3, 'autre cabinet', $2)`, [CAB_Y, U.autre]);
      const vus = (cabinet: string, utilisateur: string) =>
        sous('comtaple_app', cabinet, utilisateur, async () => (await admin.query(`select motif from reglages_tiers_factures order by motif`)).rows.map((r) => r.motif as string));
      expect(await vus(CAB_X, U.admin)).toEqual(['cabinet']); // gestionnaire sans habilitation : pas le contenu des dossiers
      expect(await vus(CAB_X, U.lecteur)).toEqual(['cabinet', 'dossier d1']);
      expect(await vus(CAB_X, U.collab)).toEqual(['cabinet', 'dossier d1', 'dossier d2']);
      expect(await vus(CAB_X, U.reviseur)).toEqual(['cabinet', 'dossier d1']);
      expect(await vus(CAB_X, U.deposant)).toEqual(['cabinet']); // « depot » < « lecture »
      expect(await vus(CAB_Y, U.autre)).toEqual(['autre cabinet']);
      // Comme toute table de cabinet sans dossier (parametres_cabinet, regles_cabinet…), la lecture du réglage du CABINET ne dépend que du
      // cabinet du contexte, que l'API tire de l'appartenance vérifiée ; la protection des réglages de DOSSIER, elle, passe par l'habilitation.
      expect(await vus(CAB_X, U.deposant)).not.toContain('dossier d1');
      expect(await vus('', '')).toEqual([]);
    });
  });

  it('ajout seul : ni modification, ni suppression, ni troncature par l’application ; le worker ne fait que lire', async () => {
    await dansTransactionAnnulee(async () => {
      await admin.query(INSERT_REGLAGE, [CAB_X, null, '5.00', U.admin]);
      for (const sql of [`update reglages_tiers_factures set tolerance_montant = 0`, `delete from reglages_tiers_factures`, `truncate reglages_tiers_factures`]) {
        expect(await sous('comtaple_app', CAB_X, U.admin, () => ecritureAcceptee(sql, [])), sql).toBe(false);
      }
      expect(await sous('comtaple_worker', CAB_X, U.admin, () => ecritureAcceptee(`select 1 from reglages_tiers_factures`, [])), 'lecture par le worker (restitutions)').toBe(true);
      for (const sql of [`update reglages_tiers_factures set tolerance_montant = 0`, `delete from reglages_tiers_factures`, `truncate reglages_tiers_factures`]) {
        expect(await sous('comtaple_worker', CAB_X, U.admin, () => ecritureAcceptee(sql, [])), `worker : ${sql}`).toBe(false);
      }
      expect(await sous('comtaple_worker', CAB_X, U.admin, () => ecritureAcceptee(INSERT_REGLAGE, [CAB_X, null, '5.00', U.admin]))).toBe(false);
      expect((await admin.query(`select count(*)::int as n from reglages_tiers_factures where cabinet_id = $1`, [CAB_X])).rows[0].n).toBe(1);
    });
  });

  it('contraintes : tolérance entre 0 et 1000, motif non vide', async () => {
    await dansTransactionAnnulee(async () => {
      for (const [valeur, motif, attendu] of [['0', 'ok', true], ['1000', 'ok', true], ['1000.01', 'ok', false], ['-0.01', 'ok', false], ['5', '', false]] as const) {
        expect(await ecritureAcceptee(`insert into reglages_tiers_factures (cabinet_id, dossier_id, tolerance_montant, motif, regle_par) values ($1, null, $2, $3, $4)`, [CAB_X, valeur, motif, U.admin]), `${valeur}/${motif}`).toBe(attendu);
      }
    });
  });
});

describe('migration 0048 : empreinte de la clé VAPID des abonnements', () => {
  it('colonne facultative au format SHA-256 ; la fonction à quatre arguments subsiste (empreinte inconnue), celle à cinq l’enregistre', async () => {
    await dansTransactionAnnulee(async () => {
      const secrets = 'a1.p-essai.aaaa.bbbb.cccc';
      const enregistrer = (empreinteAppareil: string, vapid: string | null) =>
        sous('comtaple_app', CAB_X, U.collab, async () => {
          const r = vapid === undefined ? null : await admin.query(`select abonnement_pousse_enregistrer($1, 'fcm', $2, 'Chrome sur Android', $3) as id`, [empreinteAppareil, secrets, vapid]);
          return r!.rows[0].id as string;
        });
      const a = await enregistrer('a'.repeat(64), 'b'.repeat(64));
      expect((await admin.query(`select empreinte_cle_vapid from abonnements_pousses where id = $1`, [a])).rows[0].empreinte_cle_vapid).toBe('b'.repeat(64));
      // Réabonnement du même appareil : l'empreinte est mise à jour.
      await enregistrer('a'.repeat(64), 'c'.repeat(64));
      expect((await admin.query(`select empreinte_cle_vapid from abonnements_pousses where id = $1`, [a])).rows[0].empreinte_cle_vapid).toBe('c'.repeat(64));
      // Ancienne signature : empreinte inconnue (nulle).
      const ancienne = await sous('comtaple_app', CAB_X, U.collab, async () => (await admin.query(`select abonnement_pousse_enregistrer($1, 'fcm', $2, 'Chrome sur Android') as id`, ['d'.repeat(64), secrets])).rows[0].id as string);
      expect((await admin.query(`select empreinte_cle_vapid from abonnements_pousses where id = $1`, [ancienne])).rows[0].empreinte_cle_vapid).toBeNull();
      // Forme contrôlée par la base.
      expect(await sous('comtaple_app', CAB_X, U.collab, () => ecritureAcceptee(`select abonnement_pousse_enregistrer($1, 'fcm', $2, 'Chrome sur Android', 'pas-une-empreinte')`, ['e'.repeat(64), secrets]))).toBe(false);
    });
  });
});

describe('migration 0048 : alerte d’expiration de la preuve IA (fonction du worker)', () => {
  const insererVerification = (resultat = 'connecte') =>
    admin.query(
      `insert into verifications_connexion_ia (id, verifiee_le, resultat, raisons, url_base, hote, urls_appelees, modele_langage, modele_embeddings, dimensions_embeddings, reponse_simulateur, empreinte_configuration, valide_jusqu_au)
       values ($1, now() - interval '25 days', $2, '[]'::jsonb, 'https://essai.exemple.test/v1', 'essai.exemple.test', '["https://essai.exemple.test/v1/chat"]'::jsonb, 'm', 'e', 1024, false, repeat('a', 64), now() + interval '5 days')`,
      [VERIF, resultat],
    );
  const notifier = (jours = 5) => admin.query(`select worker_notifier_expiration_preuve_ia($1::uuid, $2::int, now() + interval '5 days', 7) as n`, [VERIF, jours]).then((r) => Number(r.rows[0].n));
  const lues = async () => (await admin.query(`select cabinet_id::text, destinataire_id::text, type, cible_type, cible_id, donnees from notifications where cible_id = $1 order by destinataire_id`, [VERIF])).rows;

  it('crée UNE notification par gestionnaire actif et par preuve, ne dit rien d’autre, respecte la préférence « ia » et ne se rejoue pas', async () => {
    await dansTransactionAnnulee(async () => {
      await insererVerification();
      await admin.query(`insert into preferences_notification (cabinet_id, utilisateur_id, famille, active) values ($1, $2, 'ia', false)`, [CAB_X, U.muet]);
      const avant = Number((await admin.query(`select count(*) as n from appartenances where actif and role in ('administrateur', 'associe') and (expire_le is null or expire_le > now())`)).rows[0].n);
      const n = await notifier(5);
      expect(n).toBe(avant - 1); // tous les gestionnaires actifs de la base, sauf celui qui a coupé la famille « ia »
      const l = (await lues()).filter((x) => [CAB_X, CAB_Y].includes(x.cabinet_id));
      expect(l.map((x) => x.destinataire_id).sort()).toEqual([U.admin, U.associe, U.autre].sort());
      expect(l.every((x) => x.type === 'ia.preuve_expire_bientot' && x.cible_type === 'verification_ia')).toBe(true);
      expect(l[0]!.donnees).toMatchObject({ joursRestants: 5, seuilJours: 7 });
      expect(Object.keys(l[0]!.donnees).sort()).toEqual(['expireLe', 'joursRestants', 'seuilJours']); // aucune autre donnée
      // Ni réviseur, ni collaborateur, ni client, ni membre désactivé.
      for (const u of [U.reviseur, U.collab, U.lecteur, U.deposant, U.inactif, U.muet]) expect(l.some((x) => x.destinataire_id === u)).toBe(false);
      // Rejeu : aucune seconde notification pour la même preuve.
      expect(await notifier(4)).toBe(0);
      expect((await lues()).length).toBe(n);
    });
  });

  it('refuse une preuve inconnue ou non concluante et des paramètres invalides ; réservée au worker', async () => {
    await dansTransactionAnnulee(async () => {
      await insererVerification('echec');
      const refuse = async (sql: string, params: unknown[]) => !(await ecritureAcceptee(sql, params));
      expect(await refuse(`select worker_notifier_expiration_preuve_ia($1::uuid, 5, now(), 7)`, [VERIF])).toBe(true); // non concluante
      await admin.query('delete from verifications_connexion_ia where id = $1', [VERIF]);
      await insererVerification();
      for (const [jours, seuil] of [[-1, 7], [91, 7], [5, 0], [5, 91]]) expect(await refuse(`select worker_notifier_expiration_preuve_ia($1::uuid, $2::int, now(), $3::int)`, [VERIF, jours, seuil]), `${jours}/${seuil}`).toBe(true);
      expect(await refuse(`select worker_notifier_expiration_preuve_ia($1::uuid, 5, now(), 7)`, [uuid(999)])).toBe(true); // inconnue
      expect((await lues()).length).toBe(0);
      // Droits : le worker peut l'appeler, l'application non.
      expect(await sous('comtaple_app', CAB_X, U.admin, () => ecritureAcceptee(`select worker_notifier_expiration_preuve_ia($1::uuid, 5, now(), 7)`, [VERIF]))).toBe(false);
      expect(await sous('comtaple_worker', CAB_X, U.admin, () => ecritureAcceptee(`select worker_notifier_expiration_preuve_ia($1::uuid, 5, now() + interval '5 days', 7)`, [VERIF]))).toBe(true);
    });
  });

  it('la préférence « ia » est une famille admise ; une famille inconnue reste refusée', async () => {
    await dansTransactionAnnulee(async () => {
      expect(await ecritureAcceptee(`insert into preferences_notification (cabinet_id, utilisateur_id, famille, active) values ($1, $2, 'ia', false)`, [CAB_X, U.admin])).toBe(true);
      expect(await ecritureAcceptee(`insert into preferences_notification (cabinet_id, utilisateur_id, famille, active) values ($1, $2, 'inconnue', false)`, [CAB_X, U.admin])).toBe(false);
    });
  });
});
