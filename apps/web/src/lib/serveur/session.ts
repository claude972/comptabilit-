/**
 * Session côté serveur : les jetons OIDC ne quittent jamais le serveur Next autrement que chiffrés dans des cookies
 * `HttpOnly`. Le navigateur ne peut ni les lire ni les déchiffrer.
 */
import { chiffrer, dechiffrer, decouper, deriverCle, nomsMorceaux, recomposer } from '../session-chiffrement';
import { env, estLocal } from './env';

export const COOKIE_SESSION = 'comtaple_session';
export const COOKIE_OIDC = 'comtaple_oidc';
/** Durée de vie absolue d'une session, quel que soit le nombre de renouvellements de jeton. */
export const DUREE_MAX_SESSION_S = 10 * 3600;
const DUREE_TRANSACTION_OIDC_S = 600;

export interface Session {
  /** Jeton d'accès présenté à l'API. */
  acces: string;
  rafraichissement: string | null;
  /** Jeton d'identité, conservé pour la déconnexion auprès du fournisseur. */
  identite: string | null;
  /** Expiration du jeton d'accès (secondes Unix). */
  expireA: number;
  /** Début de la session (secondes Unix) : borne la durée totale. */
  debut: number;
  sujet: string;
  /** Cabinet choisi par un compte membre de plusieurs cabinets (transmis à l'API par `X-Cabinet-Id`). */
  cabinet?: string | null;
}

export interface TransactionOidc {
  verificateur: string;
  etat: string;
  nonce: string;
  retour: string;
}

interface LecteurCookies {
  get(nom: string): { value: string } | undefined;
}
export interface OptionsCookie {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
}
export interface CookieAPoser {
  nom: string;
  valeur: string;
  options: OptionsCookie;
}

const maintenant = () => Math.floor(Date.now() / 1000);
let cles: { session: Promise<Uint8Array>; oidc: Promise<Uint8Array> } | undefined;
function clefs() {
  cles ??= { session: deriverCle(env().SESSION_SECRET), oidc: deriverCle(env().SESSION_SECRET, 'comtaple-oidc-v1') };
  return cles;
}

function options(maxAge: number, path = '/'): OptionsCookie {
  return { httpOnly: true, secure: !estLocal(env().WEB_URL), sameSite: 'lax', path, maxAge };
}

export async function lireSession(cookies: LecteurCookies): Promise<Session | null> {
  const brut = recomposer(COOKIE_SESSION, (n) => cookies.get(n)?.value);
  if (!brut) return null;
  const s = await dechiffrer<Session>(brut, await clefs().session);
  if (!s || typeof s.acces !== 'string' || typeof s.debut !== 'number') return null;
  if (s.debut + DUREE_MAX_SESSION_S <= maintenant()) return null;
  return s;
}

/** Cookies à poser pour enregistrer la session (les morceaux devenus inutiles sont effacés). */
export async function cookiesSession(s: Session): Promise<CookieAPoser[]> {
  const fin = s.debut + DUREE_MAX_SESSION_S;
  const reste = Math.max(1, fin - maintenant());
  const morceaux = decouper(COOKIE_SESSION, await chiffrer(s, await clefs().session, fin));
  const poses = new Set(morceaux.map((m) => m.nom));
  return [
    ...morceaux.map((m) => ({ nom: m.nom, valeur: m.valeur, options: options(reste) })),
    ...nomsMorceaux(COOKIE_SESSION)
      .filter((n) => !poses.has(n))
      .map((n) => ({ nom: n, valeur: '', options: options(0) })),
  ];
}

export function cookiesEffacement(): CookieAPoser[] {
  return [
    ...nomsMorceaux(COOKIE_SESSION).map((n) => ({ nom: n, valeur: '', options: options(0) })),
    { nom: COOKIE_OIDC, valeur: '', options: options(0, '/api/auth') },
  ];
}

export async function cookieTransaction(t: TransactionOidc): Promise<CookieAPoser> {
  const valeur = await chiffrer(t, await clefs().oidc, maintenant() + DUREE_TRANSACTION_OIDC_S);
  return { nom: COOKIE_OIDC, valeur, options: options(DUREE_TRANSACTION_OIDC_S, '/api/auth') };
}

export async function lireTransaction(cookies: LecteurCookies): Promise<TransactionOidc | null> {
  const brut = cookies.get(COOKIE_OIDC)?.value;
  return brut ? dechiffrer<TransactionOidc>(brut, await clefs().oidc) : null;
}

export const COOKIE_RETOUR_MAIL = 'comtaple_mail_retour';
export const CHEMIN_RETOUR_MAIL = '/connexions-mail/retour';
/** Paramètres d'un retour OAuth de messagerie reçus sans session : gardés chiffrés le temps de la connexion, jamais dans une URL. */
export interface RetourMailEnAttente {
  state: string;
  code?: string;
  error?: string;
}
let cleRetourMail: Promise<Uint8Array> | undefined;
const clefRetourMail = () => (cleRetourMail ??= deriverCle(env().SESSION_SECRET, 'comtaple-mail-retour-v1'));

export async function cookieRetourMail(r: RetourMailEnAttente): Promise<CookieAPoser> {
  const valeur = await chiffrer(r, await clefRetourMail(), maintenant() + DUREE_TRANSACTION_OIDC_S);
  return { nom: COOKIE_RETOUR_MAIL, valeur, options: options(DUREE_TRANSACTION_OIDC_S, '/connexions-mail') };
}
export async function lireRetourMail(cookies: LecteurCookies): Promise<RetourMailEnAttente | null> {
  const brut = cookies.get(COOKIE_RETOUR_MAIL)?.value;
  return brut ? dechiffrer<RetourMailEnAttente>(brut, await clefRetourMail()) : null;
}
export const effacementRetourMail = (): CookieAPoser => ({ nom: COOKIE_RETOUR_MAIL, valeur: '', options: options(0, '/connexions-mail') });

/** Vrai lorsque le jeton d'accès doit être renouvelé avant d'être utilisé. */
export function doitRafraichir(s: Session, marge: number = env().SESSION_MARGE_RAFRAICHISSEMENT_S): boolean {
  return s.expireA - marge <= maintenant();
}

/** N'accepte qu'un chemin interne (« /… ») comme destination après connexion : jamais une URL externe. */
export function cheminRetourSur(v: string | null | undefined): string {
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.includes('\\') || /[\r\n]/.test(v) || v.startsWith('/api/')) return '/';
  return v;
}
