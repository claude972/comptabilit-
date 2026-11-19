/**
 * Validation des notifications entrantes. Une notification ne sert qu'à DÉCLENCHER une récupération
 * par l'API : son contenu n'est jamais utilisé comme donnée (ni message, ni curseur).
 */
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ErreurNotification } from './erreurs.js';
import { ErreurJwt, verifierJwtRs256, verifierValidite, type Jwk } from './jwt.js';
import type { Http } from './ports.js';

/** Clés publiques de Google (valeur `jwks_uri` du document de découverte OpenID de Google). */
export const URL_CLES_GOOGLE = 'https://www.googleapis.com/oauth2/v3/certs';
const EMETTEURS_GOOGLE = new Set(['https://accounts.google.com', 'accounts.google.com']);

export interface ParametresPushPubSub {
  /** Valeur de l'en-tête `Authorization` de la requête push. */
  autorisation: string | undefined;
  /** Corps JSON de la requête push (déjà analysé ou brut). */
  corps: unknown;
  /** Audience configurée sur l'abonnement push. */
  audienceAttendue: string;
  /** Compte de service configuré pour l'authentification du push. */
  compteServiceAttendu: string;
  /** Clés publiques de Google ; à récupérer avec `chargerClesGoogle` et à mettre en cache par l'appelant. */
  cles: Jwk[];
  maintenant: Date;
}

export interface NotificationGmail {
  /** Boîte concernée : sert uniquement à retrouver la connexion à synchroniser. */
  adresse: string;
  /** Informatif. Le moteur repart toujours de SON curseur mémorisé, jamais de cette valeur. */
  idHistorique: string;
}

const schemaPush = z.object({
  message: z.object({ data: z.string().min(1).max(4096) }),
});
const schemaDonnees = z.object({
  emailAddress: z.string().max(320).regex(/^[^\s@]+@[^\s@]+$/),
  historyId: z.union([z.string().regex(/^\d{1,20}$/), z.number().int().nonnegative()]),
});

export async function chargerClesGoogle(http: Http, url: string = URL_CLES_GOOGLE): Promise<Jwk[]> {
  const reponse = await http(url);
  if (!reponse.ok) throw new ErreurNotification('cles_indisponibles', 'Clés publiques de Google indisponibles.');
  const corps = (await reponse.json()) as { keys?: Jwk[] };
  return Array.isArray(corps.keys) ? corps.keys : [];
}

/**
 * Valide un push Pub/Sub de Gmail : jeton OIDC signé par Google (RS256), émetteur, audience,
 * compte de service, adresse vérifiée, validité. Lève `ErreurNotification` sinon.
 */
export function validerPushPubSub(p: ParametresPushPubSub): NotificationGmail {
  const jeton = /^Bearer\s+(\S+)$/i.exec(p.autorisation ?? '')?.[1];
  if (jeton === undefined) throw new ErreurNotification('jeton_absent', 'Jeton OIDC absent de la notification.');
  let charge: Record<string, unknown>;
  try {
    charge = verifierJwtRs256(jeton, p.cles);
    verifierValidite(charge, p.maintenant);
  } catch (erreur) {
    if (erreur instanceof ErreurJwt) throw new ErreurNotification('jeton_invalide', 'Jeton OIDC de la notification invalide.');
    throw erreur;
  }
  if (typeof charge['iss'] !== 'string' || !EMETTEURS_GOOGLE.has(charge['iss'])) {
    throw new ErreurNotification('emetteur_invalide', 'Émetteur du jeton OIDC inattendu.');
  }
  if (charge['aud'] !== p.audienceAttendue) throw new ErreurNotification('audience_invalide', 'Audience du jeton OIDC inattendue.');
  if (charge['email'] !== p.compteServiceAttendu || charge['email_verified'] !== true) {
    throw new ErreurNotification('compte_service_invalide', 'Compte de service du jeton OIDC inattendu.');
  }
  const corps: unknown = typeof p.corps === 'string' ? JSON.parse(p.corps) : p.corps;
  const push = schemaPush.safeParse(corps);
  if (!push.success) throw new ErreurNotification('corps_invalide', 'Corps de notification Pub/Sub invalide.');
  let donnees: unknown;
  try {
    donnees = JSON.parse(Buffer.from(push.data.message.data, 'base64url').toString('utf8'));
  } catch {
    throw new ErreurNotification('corps_invalide', 'Données de notification illisibles.');
  }
  const analyse = schemaDonnees.safeParse(donnees);
  if (!analyse.success) throw new ErreurNotification('corps_invalide', 'Données de notification Gmail invalides.');
  return { adresse: analyse.data.emailAddress.toLowerCase(), idHistorique: String(analyse.data.historyId) };
}

/**
 * Validation du point de notification Graph à la création d'un abonnement : Graph envoie
 * `POST …?validationToken=…` et attend, sous 10 secondes, un 200 `text/plain` contenant le jeton décodé.
 * Renvoie la réponse à émettre, ou `null` si la requête n'est pas une validation.
 */
export function repondreValidationGraph(parametres: URLSearchParams): { statut: 200; typeContenu: 'text/plain'; corps: string } | null {
  const jeton = parametres.get('validationToken'); // déjà décodé par URLSearchParams
  if (jeton === null) return null;
  // Renvoyé en text/plain uniquement : jamais interprété comme HTML.
  return { statut: 200, typeContenu: 'text/plain', corps: jeton };
}

export type EvenementCycleDeVie = 'reauthorizationRequired' | 'subscriptionRemoved' | 'missed';

export interface NotificationGraph {
  idAbonnement: string;
  nature: 'changement' | 'cycle_de_vie';
  evenement: EvenementCycleDeVie | null;
}

const schemaGraph = z.object({
  value: z
    .array(
      z.object({
        subscriptionId: z.string().min(1).max(200),
        clientState: z.string().max(128).optional(),
        lifecycleEvent: z.enum(['reauthorizationRequired', 'subscriptionRemoved', 'missed']).optional(),
      }),
    )
    .max(1000),
});

function egalConstant(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Valide un lot de notifications Graph (changement ou cycle de vie). Pour chaque élément, `clientState`
 * doit être celui de l'abonnement ; sinon l'élément est écarté. `etatClientAttendu` retrouve le secret
 * à partir de l'identifiant d'abonnement (`null` si l'abonnement est inconnu).
 * Seuls l'identifiant d'abonnement et la nature de l'événement sont conservés.
 */
export function validerNotificationsGraph(
  corps: unknown,
  etatClientAttendu: (idAbonnement: string) => string | null,
): { acceptees: NotificationGraph[]; rejetees: number } {
  const analyse = schemaGraph.safeParse(typeof corps === 'string' ? JSON.parse(corps) : corps);
  if (!analyse.success) throw new ErreurNotification('corps_invalide', 'Corps de notification Graph invalide.');
  const acceptees: NotificationGraph[] = [];
  let rejetees = 0;
  for (const element of analyse.data.value) {
    const attendu = etatClientAttendu(element.subscriptionId);
    if (attendu === null || element.clientState === undefined || !egalConstant(element.clientState, attendu)) {
      rejetees++;
      continue;
    }
    acceptees.push({
      idAbonnement: element.subscriptionId,
      nature: element.lifecycleEvent !== undefined ? 'cycle_de_vie' : 'changement',
      evenement: element.lifecycleEvent ?? null,
    });
  }
  return { acceptees, rejetees };
}
