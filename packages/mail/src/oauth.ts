/**
 * OAuth 2.0 : code d'autorisation + PKCE (S256) + `state` lié à la session + `nonce` (OIDC, Microsoft).
 * `preparerAutorisation` et `validerRetourAutorisation` sont des fonctions pures (aléa et heure injectables).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ErreurJetonRevoque, ErreurOAuth, ErreurTemporaire } from './erreurs.js';
import type { Http } from './ports.js';
import type { IdFournisseur } from './types.js';

/** Seul scope Gmail demandé. Scope RESTREINT (vérification Google obligatoire en diffusion publique). */
export const SCOPE_GMAIL_LECTURE = 'https://www.googleapis.com/auth/gmail.readonly';

const PREFIXE_GRAPH = 'https://graph.microsoft.com/';
export const SCOPE_MS_LECTURE = 'Mail.Read';
export const SCOPE_MS_LECTURE_PARTAGEE = 'Mail.Read.Shared';
/** Scopes de protocole Microsoft : identité (OIDC) et jeton de rafraîchissement. Aucun droit sur les données. */
export const SCOPES_MS_PROTOCOLE = ['openid', 'profile', 'offline_access'] as const;

export type TypeBoite = { type: 'personnelle' } | { type: 'partagee'; adresse: string };

/** Scopes de données nécessaires (forme normalisée) pour une boîte donnée. Jamais d'envoi, de modification ni de suppression. */
export function scopesDonneesRequis(fournisseur: IdFournisseur, boite: TypeBoite): string[] {
  if (fournisseur === 'gmail') return [SCOPE_GMAIL_LECTURE];
  // Mail.Read.Shared n'est demandé QUE si une boîte partagée est choisie.
  return boite.type === 'partagee' ? [SCOPE_MS_LECTURE, SCOPE_MS_LECTURE_PARTAGEE] : [SCOPE_MS_LECTURE];
}

/** Scopes à placer dans la demande d'autorisation. */
export function scopesDemande(fournisseur: IdFournisseur, boite: TypeBoite): string[] {
  if (fournisseur === 'gmail') return [SCOPE_GMAIL_LECTURE];
  return [...SCOPES_MS_PROTOCOLE, ...scopesDonneesRequis('microsoft', boite).map((s) => PREFIXE_GRAPH + s)];
}

/** Normalise une liste de scopes renvoyée par le fournisseur (Graph : avec ou sans préfixe d'URL). */
export function normaliserScopes(fournisseur: IdFournisseur, scopes: string): string[] {
  const liste = scopes.split(/\s+/).filter((s) => s.length > 0);
  if (fournisseur === 'gmail') return [...new Set(liste)];
  return [...new Set(liste.map((s) => (s.toLowerCase().startsWith(PREFIXE_GRAPH) ? s.slice(PREFIXE_GRAPH.length) : s)))];
}

/** Scopes de données requis par la configuration mais absents du consentement (comparaison insensible à la casse). */
export function scopesManquants(fournisseur: IdFournisseur, boite: TypeBoite, accordes: string[]): string[] {
  const possedes = new Set(accordes.map((s) => s.toLowerCase()));
  return scopesDonneesRequis(fournisseur, boite).filter((s) => !possedes.has(s.toLowerCase()));
}

export interface ClientOAuth {
  clientId: string;
  clientSecret: string;
  uriRedirection: string;
}

export type Aleatoire = (octets: number) => Uint8Array;
const aleatoireSysteme: Aleatoire = (octets) => randomBytes(octets);

const b64url = (octets: Uint8Array): string => Buffer.from(octets).toString('base64url');

/** Vérifieur PKCE : 43 caractères non réservés (32 octets aléatoires en base64url). */
export function genererVerifieurPkce(aleatoire: Aleatoire = aleatoireSysteme): string {
  return b64url(aleatoire(32));
}

/** Défi PKCE S256 : BASE64URL(SHA-256(vérifieur)), sans remplissage. */
export function defiPkceS256(verifieur: string): string {
  return createHash('sha256').update(verifieur, 'ascii').digest('base64url');
}

function liaison(secretEtat: Uint8Array, state: string, sessionId: string, fournisseur: IdFournisseur): string {
  return createHmac('sha256', secretEtat).update(`${fournisseur}\n${sessionId}\n${state}`, 'utf8').digest('base64url');
}

function egalConstant(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

export const DUREE_VALIDITE_DEMANDE_MS = 10 * 60 * 1000;

/** À conserver côté serveur, dans la session de l'utilisateur, jusqu'au retour. Contient le vérifieur PKCE (secret). */
export interface DemandeEnAttente {
  fournisseur: IdFournisseur;
  state: string;
  /** HMAC(secretEtat, fournisseur, sessionId, state) : lie le `state` à la session qui a lancé la demande. */
  liaisonSession: string;
  codeVerifier: string;
  /** `nonce` OIDC (Microsoft). `null` pour Gmail : aucun id_token n'est demandé. */
  nonce: string | null;
  scopesDemandes: string[];
  boite: TypeBoite;
  expireLe: string;
}

export interface DemandeAutorisation {
  url: string;
  aConserver: DemandeEnAttente;
}

export interface ParametresAutorisation {
  fournisseur: IdFournisseur;
  /** Point d'autorisation du fournisseur. */
  urlAutorisation: string;
  client: Pick<ClientOAuth, 'clientId' | 'uriRedirection'>;
  boite: TypeBoite;
  /** Identifiant de la session de l'utilisateur connecté à Comtaple. */
  sessionId: string;
  /** Secret serveur (≥ 32 octets) servant à lier le `state` à la session. */
  secretEtat: Uint8Array;
  maintenant: Date;
  aleatoire?: Aleatoire;
  /** Adresse à préremplir (facultatif). */
  indiceConnexion?: string;
}

/** Construit l'URL d'autorisation (fonction pure). */
export function preparerAutorisation(p: ParametresAutorisation): DemandeAutorisation {
  if (p.secretEtat.byteLength < 32) throw new ErreurOAuth('secret_trop_court', 'Le secret de state doit faire au moins 32 octets.');
  if (p.boite.type === 'partagee' && p.fournisseur !== 'microsoft') {
    throw new ErreurOAuth('boite_non_prise_en_charge', 'Les boîtes partagées ne concernent que Microsoft 365.');
  }
  const aleatoire = p.aleatoire ?? aleatoireSysteme;
  const state = b64url(aleatoire(32));
  const codeVerifier = genererVerifieurPkce(aleatoire);
  const scopes = scopesDemande(p.fournisseur, p.boite);
  const url = new URL(p.urlAutorisation);
  const q = url.searchParams;
  q.set('client_id', p.client.clientId);
  q.set('redirect_uri', p.client.uriRedirection);
  q.set('response_type', 'code');
  q.set('scope', scopes.join(' '));
  q.set('state', state);
  q.set('code_challenge', defiPkceS256(codeVerifier));
  q.set('code_challenge_method', 'S256');
  let nonce: string | null = null;
  if (p.fournisseur === 'gmail') {
    q.set('access_type', 'offline'); // jeton de rafraîchissement
    q.set('prompt', 'consent'); // le jeton de rafraîchissement n'est renvoyé qu'à la première autorisation sinon
    q.set('include_granted_scopes', 'false'); // pas d'accumulation de scopes accordés ailleurs
  } else {
    nonce = b64url(aleatoire(16));
    q.set('response_mode', 'query');
    q.set('nonce', nonce);
    // Boîte partagée : nouveau consentement explicite, jamais silencieux.
    q.set('prompt', p.boite.type === 'partagee' ? 'consent' : 'select_account');
  }
  if (p.indiceConnexion !== undefined) q.set('login_hint', p.indiceConnexion);
  return {
    url: url.toString(),
    aConserver: {
      fournisseur: p.fournisseur,
      state,
      liaisonSession: liaison(p.secretEtat, state, p.sessionId, p.fournisseur),
      codeVerifier,
      nonce,
      scopesDemandes: scopes,
      boite: p.boite,
      expireLe: new Date(p.maintenant.getTime() + DUREE_VALIDITE_DEMANDE_MS).toISOString(),
    },
  };
}

export interface ParametresRetour {
  /** Paramètres de requête reçus sur l'URI de redirection. */
  retour: URLSearchParams | Record<string, string | undefined>;
  /** Demande retrouvée dans la session courante (`null` si absente). */
  attendu: DemandeEnAttente | null;
  /** Session de l'utilisateur qui présente le retour. */
  sessionId: string;
  secretEtat: Uint8Array;
  maintenant: Date;
}

/** Valide le retour d'autorisation (fonction pure). Lève `ErreurOAuth` ; renvoie le code à échanger. */
export function validerRetourAutorisation(p: ParametresRetour): { code: string } {
  const lire = (cle: string): string | undefined =>
    p.retour instanceof URLSearchParams ? (p.retour.get(cle) ?? undefined) : p.retour[cle];
  if (!p.attendu) throw new ErreurOAuth('demande_inconnue', 'Aucune demande d’autorisation en attente pour cette session.');
  const state = lire('state');
  // Le state est vérifié AVANT toute autre chose : un retour forgé ne doit rien déclencher.
  if (state === undefined || !egalConstant(state, p.attendu.state)) {
    throw new ErreurOAuth('state_invalide', 'Le paramètre state ne correspond pas à la demande en attente.');
  }
  if (!egalConstant(liaison(p.secretEtat, state, p.sessionId, p.attendu.fournisseur), p.attendu.liaisonSession)) {
    throw new ErreurOAuth('state_autre_session', 'Le paramètre state n’appartient pas à cette session.');
  }
  if (new Date(p.attendu.expireLe).getTime() < p.maintenant.getTime()) {
    throw new ErreurOAuth('demande_expiree', 'La demande d’autorisation a expiré.');
  }
  const erreur = lire('error');
  if (erreur !== undefined) {
    const code = /^[a-z_]{1,40}$/.test(erreur) ? erreur : 'erreur_inconnue';
    throw new ErreurOAuth(`refus_fournisseur:${code}`, 'Le fournisseur a refusé l’autorisation.');
  }
  const code = lire('code');
  if (code === undefined || code.length === 0) throw new ErreurOAuth('code_absent', 'Code d’autorisation absent.');
  return { code };
}

const schemaReponseJeton = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});
export type ReponseJeton = z.infer<typeof schemaReponseJeton>;

/**
 * Appel du point de jetons (échange du code ou rafraîchissement).
 * `invalid_grant` sur un rafraîchissement → `ErreurJetonRevoque`.
 */
export async function appelerPointJeton(
  http: Http,
  urlJeton: string,
  parametres: Record<string, string>,
  nature: 'echange' | 'rafraichissement',
): Promise<ReponseJeton> {
  const reponse = await http(urlJeton, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(parametres).toString(),
  });
  let corps: unknown = null;
  try {
    corps = await reponse.json();
  } catch {
    corps = null;
  }
  if (reponse.ok) {
    const analyse = schemaReponseJeton.safeParse(corps);
    if (!analyse.success) throw new ErreurOAuth('reponse_jeton_invalide', 'Réponse inattendue du point de jetons.');
    return analyse.data;
  }
  const brut = typeof corps === 'object' && corps !== null ? (corps as Record<string, unknown>)['error'] : undefined;
  const code = typeof brut === 'string' && /^[a-z_]{1,40}$/.test(brut) ? brut : 'erreur_inconnue';
  if (code === 'invalid_grant') {
    if (nature === 'rafraichissement') throw new ErreurJetonRevoque();
    throw new ErreurOAuth('code_refuse', 'Le fournisseur refuse le code d’autorisation ou le vérifieur PKCE.');
  }
  if (reponse.status >= 500 || reponse.status === 429) throw new ErreurTemporaire(reponse.status, null);
  throw new ErreurOAuth(`jeton_refuse:${code}`, 'Le point de jetons a refusé la demande.');
}

export interface ResultatRevocation {
  /** `true` seulement si le fournisseur a confirmé la révocation. */
  revoqueChezFournisseur: boolean;
  /** Ce qui reste à faire par l'utilisateur ou l'administrateur (texte affichable). */
  actionsRestantes: string[];
}
