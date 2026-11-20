import type { Contexte } from './contexte.js';

export interface BilanAlerteIa {
  /** Pourquoi rien n'a été signalé (ou « signalee »). */
  issue: 'signalee' | 'sans_fournisseur_reel' | 'aucune_preuve' | 'preuve_non_valide' | 'pas_encore';
  /** Notifications internes créées (une par gestionnaire et par preuve ; 0 si déjà signalée). */
  notifications: number;
  joursRestants: number | null;
}

/**
 * Alerte d'expiration de la preuve de connexion de la passerelle IA (D-096).
 *
 * LECTURE SEULE de la preuve persistée (`rafraichirPreuve` ne fait que lire `verifications_connexion_ia`) : AUCUN appel à
 * l'IA, aucune vérification, aucune dépense, aucun jeton lu. Tant qu'aucune preuve valide n'existe (aucun fournisseur
 * réel, preuve absente, périmée ou d'une autre configuration), il n'y a rien à signaler. Quand la preuve valide expire dans
 * le seuil (`IA_PREUVE_ALERTE_JOURS`, 7 jours par défaut), une notification interne est créée pour les gestionnaires, UNE FOIS
 * par preuve (la fonction de la base ignore une preuve déjà signalée) : l'appel est donc rejouable sans doublon.
 */
export async function signalerExpirationPreuveIa(c: Contexte): Promise<BilanAlerteIa> {
  if (!c.ia || c.ia.natureFournisseur !== 'reel') return { issue: 'sans_fournisseur_reel', notifications: 0, joursRestants: null };
  await c.ia.rafraichirPreuve();
  const vue = c.ia.preuve();
  if (!vue || vue.etat === 'absente' || vue.etat === 'autre_configuration') return { issue: 'aucune_preuve', notifications: 0, joursRestants: null };
  if (vue.etat !== 'valide' || !vue.expiration || !vue.verificationId) return { issue: 'preuve_non_valide', notifications: 0, joursRestants: null };
  if (!vue.expiration.expireBientot) return { issue: 'pas_encore', notifications: 0, joursRestants: vue.expiration.restantJours };
  const r = await c.bd.pool.query<{ n: number }>('select worker_notifier_expiration_preuve_ia($1::uuid, $2::int, $3::timestamptz, $4::int) as n', [
    vue.verificationId, vue.expiration.restantJours, vue.expiration.expireLe, vue.expiration.seuilJours,
  ]);
  return { issue: 'signalee', notifications: Number(r.rows[0]?.n ?? 0), joursRestants: vue.expiration.restantJours };
}
