/**
 * Notifications poussées discrètes — émission par le worker. Rien n'est émis dans la transaction d'une requête :
 *  1. à la création d'une notification interne, un déclencheur de la base met UN envoi en attente par destinataire
 *     (table `envois_pousses`, migration 0040) ;
 *  2. `releverEnvoisPousses` (périodique) prend les envois en attente depuis au moins la fenêtre de regroupement et crée
 *     une tâche de livraison par appareil abonné (file BullMQ « pousses ») ;
 *  3. `livrerPoussee` chiffre et envoie à UN appareil ; une erreur temporaire est rejouée par la file, avec bornes.
 * Les journaux ne portent que des identifiants techniques et un code HTTP : jamais le point d'accès, ni les clés.
 */
import { chargeUtilePoussee } from '@comtaple/core';
import { journaliser, sql } from '@comtaple/db';
import { associeAbonnement, dechiffrerAbonnement, envoyerNotificationPoussee, type EtatPoussees, type OptionsEnvoiPousse, type TachePoussee, TENTATIVES_POUSSEE } from '@comtaple/plateforme';
import type { Contexte } from './contexte.js';

/** Refus consécutifs du service (400, 401, 403, 413…) au-delà desquels un abonnement est retiré. */
export const REFUS_MAX_ABONNEMENT = 5;
/** Un envoi resté en attente plus longtemps (worker arrêté, fonction désactivée entre-temps) n'est plus émis. */
const PEREMPTION_ENVOI_MS = 24 * 3600 * 1000;

export interface BilanReleve {
  envois: number;
  livraisons: number;
  ignores: number;
}

/** Relève les envois en attente et distribue chacun aux appareils du destinataire. */
export async function releverEnvoisPousses(c: Pick<Contexte, 'bd' | 'taches' | 'cfg'>, etat: EtatPoussees): Promise<BilanReleve> {
  const bilan: BilanReleve = { envois: 0, livraisons: 0, ignores: 0 };
  if (etat.statut === 'non_configure') return bilan;
  const { rows } = await c.bd.pool.query<{ cabinet_id: string; envoi_id: string }>('select * from worker_envois_pousses_a_distribuer($1, 200)', [c.cfg.PUSH_FENETRE_REGROUPEMENT_S]);
  for (const r of rows) {
    const n = await distribuerEnvoi(c, r.cabinet_id, r.envoi_id);
    bilan.envois++;
    if (n > 0) bilan.livraisons += n;
    else bilan.ignores++;
  }
  return bilan;
}

/**
 * Distribue UN envoi : une tâche de livraison par appareil abonné du destinataire. La préférence globale « notifications
 * poussées » est relue ici (elle a pu être coupée pendant la fenêtre de regroupement). Les tâches sont créées AVANT que
 * l'envoi soit marqué traité, et leur identifiant est déterministe : rejouée après une panne, la distribution ne livre
 * pas deux fois. Renvoie le nombre d'appareils servis.
 */
export async function distribuerEnvoi(c: Pick<Contexte, 'bd' | 'taches' | 'cfg'>, cabinetId: string, envoiId: string): Promise<number> {
  return c.bd.avecContexte({ cabinetId }, async (tx) => {
    const [envoi] = (await tx.execute(sql`select id, destinataire_id as "destinataireId", cree_le as "creeLe" from envois_pousses where id = ${envoiId}::uuid and traite_le is null for update`)).rows as Array<{ id: string; destinataireId: string; creeLe: string | Date }>;
    if (!envoi) return 0;
    const clore = (issue: string, appareils: number) => tx.execute(sql`update envois_pousses set traite_le = now(), issue = ${issue}, appareils = ${appareils} where id = ${envoiId}::uuid`);
    if (Date.now() - new Date(envoi.creeLe).getTime() > PEREMPTION_ENVOI_MS) {
      await clore('perime', 0);
      return 0;
    }
    const coupee = (await tx.execute(sql`select 1 from preferences_notification where utilisateur_id = ${envoi.destinataireId}::uuid and famille = 'poussees' and not active`)).rowCount;
    if (coupee) {
      await clore('preference_desactivee', 0);
      return 0;
    }
    const appareils = (await tx.execute(sql`select id from abonnements_pousses where utilisateur_id = ${envoi.destinataireId}::uuid order by id`)).rows as Array<{ id: string }>;
    for (const a of appareils) await c.taches.livrerPoussee({ cabinetId, envoiId, abonnementId: a.id }, c.cfg.PUSH_DELAI_REPRISE_S * 1000);
    await clore(appareils.length ? 'distribue' : 'sans_abonnement', appareils.length);
    return appareils.length;
  });
}

export type IssueLivraison = 'accepte' | 'abonnement_absent' | 'abonnement_retire' | 'abonnement_illisible' | 'refuse' | 'abandonne';

/** Erreur temporaire : la file rejoue la tâche (délai doublé à chaque tentative, TENTATIVES_POUSSEE au plus). */
export class LivraisonARejouer extends Error {}

/**
 * Livre UN envoi à UN appareil. Le point d'accès et les clés sont déchiffrés ici, en mémoire, le temps de l'envoi.
 *  - accepté par le service : date notée (ce n'est pas une preuve d'affichage sur l'appareil) ;
 *  - 404 / 410 : l'abonnement n'existe plus — il est RETIRÉ, et le retrait est journalisé ;
 *  - erreur temporaire (429, 5xx, injoignable) : `LivraisonARejouer`, sauf à la dernière tentative (abandon consigné) ;
 *  - refus (400, 401, 403, 413…) : compté ; au-delà de REFUS_MAX_ABONNEMENT refus consécutifs, l'abonnement est retiré.
 */
export async function livrerPoussee(c: Pick<Contexte, 'bd'>, etat: EtatPoussees, t: TachePoussee, tentative: { numero: number; options?: OptionsEnvoiPousse } = { numero: 1 }): Promise<IssueLivraison> {
  const ctx = { cabinetId: t.cabinetId };
  const lu = await c.bd.avecContexte(ctx, async (tx) => {
    const [a] = (await tx.execute(sql`select id, utilisateur_id as "utilisateurId", empreinte_point_acces as empreinte, secrets_chiffres as secrets, service from abonnements_pousses where id = ${t.abonnementId}::uuid`)).rows as Array<{ id: string; utilisateurId: string; empreinte: string; secrets: string; service: string }>;
    const [e] = (await tx.execute(sql`select id, type, destinataire_id as "destinataireId" from envois_pousses where id = ${t.envoiId}::uuid`)).rows as Array<{ id: string; type: string; destinataireId: string }>;
    return { a, e };
  });
  // Abonnement retiré entre-temps (par la personne ou par une livraison précédente), ou envoi purgé : rien à faire.
  if (!lu.a || !lu.e || lu.a.utilisateurId !== lu.e.destinataireId) return 'abonnement_absent';
  const { a, e } = lu;
  const retirer = (motif: string, statut: number | null) =>
    c.bd.avecContexte(ctx, async (tx) => {
      const r = await tx.execute(sql`delete from abonnements_pousses where id = ${a.id}::uuid`);
      if (r.rowCount) await journaliser(tx, { cabinetId: t.cabinetId, acteurType: 'systeme', action: 'notification_poussee.appareil_retire', cibleType: 'abonnement_pousse', cibleId: a.id, details: { service: a.service, par: 'service', motif, statut } });
    });

  const secrets = dechiffrerAbonnement(etat, a.secrets, associeAbonnement(t.cabinetId, a.utilisateurId, a.empreinte));
  if (!secrets) {
    // Clé de chiffrement retirée ou enveloppe altérée : l'abonnement est inutilisable, la personne devra se réabonner.
    await retirer('illisible', null);
    return 'abonnement_illisible';
  }
  const r = await envoyerNotificationPoussee(etat, secrets, chargeUtilePoussee({ type: e.type }, e.id), tentative.options);
  if (r.issue === 'accepte') {
    await c.bd.avecContexte(ctx, (tx) => tx.execute(sql`update abonnements_pousses set dernier_succes_le = now(), echecs = 0 where id = ${a.id}::uuid`));
    return 'accepte';
  }
  if (r.issue === 'abonnement_perime') {
    await retirer('perime', r.statut);
    return 'abonnement_retire';
  }
  if (r.issue === 'temporaire') {
    await c.bd.avecContexte(ctx, (tx) => tx.execute(sql`update abonnements_pousses set dernier_echec_le = now() where id = ${a.id}::uuid`));
    if (tentative.numero >= TENTATIVES_POUSSEE) return 'abandonne';
    throw new LivraisonARejouer(`service de notification momentanément indisponible (${r.statut === null ? 'sans réponse' : `HTTP ${r.statut}`})`);
  }
  const [maj] = (await c.bd.avecContexte(ctx, (tx) => tx.execute(sql`update abonnements_pousses set dernier_echec_le = now(), echecs = echecs + 1 where id = ${a.id}::uuid returning echecs`))).rows as Array<{ echecs: number }>;
  if ((maj?.echecs ?? 0) >= REFUS_MAX_ABONNEMENT) {
    await retirer('refus_repetes', r.statut);
    return 'abonnement_retire';
  }
  return 'refuse';
}
