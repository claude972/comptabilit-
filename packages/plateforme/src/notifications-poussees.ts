/**
 * Notifications poussées DISCRÈTES — état d'après la configuration, protection des abonnements au repos, envoi.
 *
 * ÉTAT RÉEL : DÉSACTIVÉES par défaut. Sans clés VAPID, statut « non_configure » : aucun abonnement n'est accepté et
 * rien n'est envoyé. Avec des clés, statut « configure_non_verifie » : le chemin est prêt, mais aucun envoi à un service
 * réel ni aucune réception sur un appareil réel n'ont été constatés — il n'existe pas de statut « vérifié » ici, et il
 * n'en existera pas tant qu'un essai réel n'aura pas été fait et consigné. Avec `PUSH_SIMULATEUR_URL` (tests, refusé en
 * production), statut « simule » : SEULE l'origine du simulateur local est une destination admise.
 *
 * Ce qui sort vers le service de notification du navigateur (Google, Mozilla, Apple ou Microsoft) quand la fonction est
 * activée : l'adresse du point d'accès (propre à l'appareil), un corps CHIFFRÉ pour cet appareil (RFC 8291) qui ne
 * contient qu'un type générique et un identifiant opaque (voir @comtaple/core, `chargeUtilePoussee`), la clé publique
 * VAPID et le contact de l'éditeur, la durée de vie et un sujet de regroupement générique. Le service voit donc QUAND et
 * à QUEL appareil un message est adressé, jamais son contenu — et ce contenu ne dit de toute façon rien d'un dossier.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { type ChargeUtilePoussee, serialiserChargeUtilePoussee, verifierPointAcces } from '@comtaple/core';
import type { Config } from './config.js';
import { chiffrerMessagePousse, type ClesVapid, clesVapidCoherentes, enteteVapid } from './web-push.js';

export type StatutPoussees = 'non_configure' | 'simule' | 'configure_non_verifie';

interface CleRepos {
  id: string;
  cle: Buffer;
}

export interface EtatPoussees {
  statut: StatutPoussees;
  /** Phrase affichable. */
  detail: string;
  /** Clé publique VAPID à remettre au navigateur ; null si la fonction n'est pas activée. */
  clePublique: string | null;
  /** Jamais « vrai » : aucune réception sur un appareil réel n'a été constatée. */
  verifieSurAppareilReel: false;
  /** Origine du simulateur de test, seule destination admise quand elle est définie. */
  origineSimulateur: string | null;
  vapid: { cles: ClesVapid; sujet: string } | null;
  /** Clés de chiffrement des abonnements au repos (courante, puis anciennes pour déchiffrer seulement). */
  clesRepos: CleRepos[];
}

export type ConfigPoussees = Pick<Config, 'PUSH_VAPID_CLE_PUBLIQUE' | 'PUSH_VAPID_CLE_PRIVEE' | 'PUSH_VAPID_SUJET' | 'PUSH_SIMULATEUR_URL' | 'JETONS_CLE_CHIFFREMENT'> & Partial<Pick<Config, 'JETONS_CLES_ANCIENNES' | 'NODE_ENV'>>;

const NON_CONFIGURE = 'Les notifications poussées ne sont pas activées sur ce service.';

/** Clé AES-256 des abonnements, dérivée du secret de chiffrement de la plateforme (HKDF-SHA-256, usage propre). */
function cleRepos(secret: string): CleRepos {
  const cle = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from('comtaple-notifications-poussees', 'utf8'), 'abonnements-v1', 32));
  return { id: `p-${createHash('sha256').update(cle).digest('hex').slice(0, 12)}`, cle };
}

/**
 * État des notifications poussées d'après la configuration. Une configuration PARTIELLE ou incohérente est refusée au
 * démarrage (le nom des variables est donné, jamais leur valeur) : mieux vaut un arrêt explicite qu'une fonction
 * à moitié active. Le simulateur est refusé en production.
 */
export function notificationsPoussees(cfg: ConfigPoussees): EtatPoussees {
  const renseignees = [cfg.PUSH_VAPID_CLE_PUBLIQUE, cfg.PUSH_VAPID_CLE_PRIVEE, cfg.PUSH_VAPID_SUJET].filter((v) => v !== '').length;
  const simulateur = cfg.PUSH_SIMULATEUR_URL.replace(/\/$/, '');
  if (simulateur !== '' && (cfg.NODE_ENV ?? process.env.NODE_ENV) === 'production') throw new Error('PUSH_SIMULATEUR_URL est interdit avec NODE_ENV=production');
  if (renseignees === 0) {
    if (simulateur !== '') throw new Error('Configuration refusée : PUSH_SIMULATEUR_URL est défini sans clés VAPID (PUSH_VAPID_CLE_PUBLIQUE, PUSH_VAPID_CLE_PRIVEE, PUSH_VAPID_SUJET).');
    return { statut: 'non_configure', detail: NON_CONFIGURE, clePublique: null, verifieSurAppareilReel: false, origineSimulateur: null, vapid: null, clesRepos: [] };
  }
  if (renseignees !== 3) throw new Error('Configuration refusée : PUSH_VAPID_CLE_PUBLIQUE, PUSH_VAPID_CLE_PRIVEE et PUSH_VAPID_SUJET vont ensemble (les trois, ou aucune).');
  const cles: ClesVapid = { publique: cfg.PUSH_VAPID_CLE_PUBLIQUE, privee: cfg.PUSH_VAPID_CLE_PRIVEE };
  if (!clesVapidCoherentes(cles)) throw new Error('Configuration refusée : PUSH_VAPID_CLE_PUBLIQUE et PUSH_VAPID_CLE_PRIVEE ne forment pas une paire de clés P-256 valide.');
  if (!/^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s]+)$/.test(cfg.PUSH_VAPID_SUJET)) throw new Error('Configuration refusée : PUSH_VAPID_SUJET doit être un contact « mailto:… » ou « https://… ».');
  if (cfg.JETONS_CLE_CHIFFREMENT.length < 32) throw new Error('Configuration refusée : les notifications poussées exigent JETONS_CLE_CHIFFREMENT (32 caractères au moins) pour chiffrer les abonnements au repos.');
  const anciennes = (cfg.JETONS_CLES_ANCIENNES ?? '').split(',').map((x) => x.trim()).filter((x) => x.length >= 32 && x !== cfg.JETONS_CLE_CHIFFREMENT);
  const commun = { clePublique: cles.publique, verifieSurAppareilReel: false as const, vapid: { cles, sujet: cfg.PUSH_VAPID_SUJET }, clesRepos: [cleRepos(cfg.JETONS_CLE_CHIFFREMENT), ...anciennes.map(cleRepos)] };
  if (simulateur !== '') {
    return { ...commun, statut: 'simule', detail: 'SIMULATEUR de test : aucun service de notification réel n’est contacté, aucun appareil réel ne reçoit quoi que ce soit.', origineSimulateur: new URL(simulateur).origin };
  }
  return {
    ...commun,
    statut: 'configure_non_verifie',
    detail: 'Notifications poussées configurées. La réception sur un appareil réel n’a pas été vérifiée : ce chemin n’a été exercé que contre un simulateur de service de notification.',
    origineSimulateur: null,
  };
}

// ───────────────────────────── Abonnements au repos ─────────────────────────────

/** Ce que le navigateur remet à l'abonnement. Le point d'accès est une adresse à capacité : qui la connaît peut écrire à l'appareil. */
export interface SecretsAbonnement {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Empreinte du point d'accès (SHA-256, hexadécimal) : identifie l'appareil en base sans y laisser l'adresse en clair. */
export const empreintePointAcces = (endpoint: string): string => createHash('sha256').update(endpoint, 'utf8').digest('hex');
/** Données associées : un chiffré ne peut pas être rejoué sur l'abonnement d'un autre cabinet, d'une autre personne ou d'un autre appareil. */
export const associeAbonnement = (cabinetId: string, utilisateurId: string, empreinte: string): string => `comtaple-pousse|${cabinetId}|${utilisateurId}|${empreinte}`;

/** Chiffre le point d'accès et les clés d'un abonnement (AES-256-GCM). Format : `a1.<idCle>.<iv>.<chiffré>.<étiquette>`. */
export function chiffrerAbonnement(etat: Pick<EtatPoussees, 'clesRepos'>, secrets: SecretsAbonnement, associe: string): string {
  const courante = etat.clesRepos[0];
  if (!courante) throw new Error('Notifications poussées non configurées : aucun abonnement ne peut être enregistré.');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', courante.cle, iv);
  c.setAAD(Buffer.from(`${associe}|${courante.id}`, 'utf8'));
  const chiffre = Buffer.concat([c.update(JSON.stringify({ endpoint: secrets.endpoint, p256dh: secrets.p256dh, auth: secrets.auth }), 'utf8'), c.final()]);
  return ['a1', courante.id, iv.toString('base64url'), chiffre.toString('base64url'), c.getAuthTag().toString('base64url')].join('.');
}

/** Déchiffre un abonnement ; `null` si l'enveloppe est illisible (clé retirée, enveloppe altérée ou déplacée). */
export function dechiffrerAbonnement(etat: Pick<EtatPoussees, 'clesRepos'>, enveloppe: string, associe: string): SecretsAbonnement | null {
  const [version, idCle, iv, chiffre, etiquette] = enveloppe.split('.');
  const cle = etat.clesRepos.find((k) => k.id === idCle);
  if (version !== 'a1' || !cle || !iv || !chiffre || !etiquette) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', cle.cle, Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(`${associe}|${cle.id}`, 'utf8'));
    d.setAuthTag(Buffer.from(etiquette, 'base64url'));
    const v = JSON.parse(Buffer.concat([d.update(Buffer.from(chiffre, 'base64url')), d.final()]).toString('utf8')) as Partial<SecretsAbonnement>;
    return typeof v.endpoint === 'string' && typeof v.p256dh === 'string' && typeof v.auth === 'string' ? { endpoint: v.endpoint, p256dh: v.p256dh, auth: v.auth } : null;
  } catch {
    return null;
  }
}

// ───────────────────────────── Envoi ─────────────────────────────

/**
 * Issue d'un envoi. `statut` est le code HTTP du service (null : pas de réponse). Rien d'autre n'est rapporté : ni le
 * point d'accès, ni les clés, ni le corps de la réponse.
 *  - accepte : le service a pris le message (ce n'est PAS une preuve d'affichage sur l'appareil) ;
 *  - abonnement_perime : 404 ou 410 — l'abonnement n'existe plus chez le service, il doit être retiré ;
 *  - temporaire : 429, 5xx, délai dépassé ou service injoignable — à rejouer, avec bornes ;
 *  - refuse : requête refusée (400, 401, 403, 413…) ou destination non admise — rejouer ne changerait rien.
 */
export type IssueEnvoiPousse = { issue: 'accepte' | 'abonnement_perime' | 'temporaire' | 'refuse'; statut: number | null; motif?: 'destination_non_admise' | 'cles_invalides' | 'injoignable' };

export interface OptionsEnvoiPousse {
  /** Durée pendant laquelle le service garde le message pour un appareil hors ligne, en secondes (RFC 8030, en-tête TTL). */
  dureeDeVieS?: number;
  delaiMs?: number;
  /** Instant courant en millisecondes (tests). */
  maintenant?: number;
}

const DUREE_DE_VIE_S = 24 * 3600;
/** Validité du jeton VAPID : 12 heures (la RFC 8292 admet 24 heures au plus). */
const VALIDITE_JETON_S = 12 * 3600;

/**
 * Envoie UNE notification poussée à UN abonnement. La destination est revérifiée ici contre la liste blanche (ou
 * l'origine du simulateur) : même une adresse entrée en base par un autre chemin ne serait pas appelée. Aucune
 * redirection n'est suivie. La fonction ne lève pas : elle rapporte une issue.
 */
export async function envoyerNotificationPoussee(etat: EtatPoussees, abonnement: SecretsAbonnement, charge: ChargeUtilePoussee, options: OptionsEnvoiPousse = {}): Promise<IssueEnvoiPousse> {
  if (!etat.vapid) return { issue: 'refuse', statut: null, motif: 'destination_non_admise' };
  const destination = verifierPointAcces(abonnement.endpoint, etat.origineSimulateur ?? undefined);
  if (!destination.ok) return { issue: 'refuse', statut: null, motif: 'destination_non_admise' };
  let corps: Buffer;
  try {
    corps = chiffrerMessagePousse(Buffer.from(serialiserChargeUtilePoussee(charge), 'utf8'), abonnement);
  } catch {
    return { issue: 'refuse', statut: null, motif: 'cles_invalides' };
  }
  const maintenantS = Math.floor((options.maintenant ?? Date.now()) / 1000);
  let reponse: Response;
  try {
    reponse = await fetch(destination.url, {
      method: 'POST',
      headers: {
        authorization: enteteVapid({ audience: destination.origine, sujet: etat.vapid.sujet, cles: etat.vapid.cles, expiration: maintenantS + VALIDITE_JETON_S }),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(options.dureeDeVieS ?? DUREE_DE_VIE_S),
        urgency: 'normal',
        // Sujet de regroupement côté service (RFC 8030, section 5.4) : pour un appareil hors ligne, un message plus récent
        // du même type générique remplace le précédent. Valeur générique : elle ne dit rien d'un dossier.
        topic: `comtaple-${charge.t}`,
      },
      body: new Uint8Array(corps),
      redirect: 'error',
      signal: AbortSignal.timeout(options.delaiMs ?? 15_000),
    });
  } catch {
    return { issue: 'temporaire', statut: null, motif: 'injoignable' };
  }
  // Le corps de la réponse n'est ni lu ni conservé.
  await reponse.body?.cancel().catch(() => undefined);
  const s = reponse.status;
  if (s >= 200 && s < 300) return { issue: 'accepte', statut: s };
  if (s === 404 || s === 410) return { issue: 'abonnement_perime', statut: s };
  if (s === 429 || s >= 500) return { issue: 'temporaire', statut: s };
  return { issue: 'refuse', statut: s };
}
