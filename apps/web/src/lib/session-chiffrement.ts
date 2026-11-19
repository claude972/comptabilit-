/**
 * Chiffrement et découpage des cookies de session (logique pure, sans dépendance à Next).
 * Le contenu (jetons OIDC) est compressé, chiffré en JWE (clé directe, A256GCM) puis réparti sur plusieurs cookies
 * lorsque la valeur dépasse la taille admise par les navigateurs (~4 Ko par cookie, nom et attributs compris).
 */
import { CompactEncrypt, compactDecrypt } from 'jose';

/** Taille maximale de la VALEUR d'un cookie ; laisse de la marge pour le nom et les attributs. */
export const TAILLE_MAX_MORCEAU = 3500;
export const NB_MAX_MORCEAUX = 6;

const encodeur = new TextEncoder();
const decodeur = new TextDecoder();

/** Dérive une clé AES-256 du secret de session (HKDF-SHA-256, usage séparé par « info »). */
export async function deriverCle(secret: string, usage = 'comtaple-session-v1'): Promise<Uint8Array> {
  if (secret.length < 32) throw new Error('SESSION_SECRET trop court (32 caractères au minimum)');
  const base = await crypto.subtle.importKey('raw', encodeur.encode(secret), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: encodeur.encode('comtaple'), info: encodeur.encode(usage) },
    base,
    256,
  );
  return new Uint8Array(bits);
}

async function transformer(octets: Uint8Array, flux: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const ecrivain = flux.writable.getWriter();
  void ecrivain.write(octets as Uint8Array<ArrayBuffer>).catch(() => undefined);
  void ecrivain.close().catch(() => undefined);
  return new Uint8Array(await new Response(flux.readable).arrayBuffer());
}

/** Chiffre un objet JSON. `expireA` (secondes Unix) est scellé dans l'en-tête protégé et vérifié au déchiffrement. */
export async function chiffrer(contenu: unknown, cle: Uint8Array, expireA: number): Promise<string> {
  const clair = await transformer(encodeur.encode(JSON.stringify(contenu)), new CompressionStream('deflate-raw'));
  return new CompactEncrypt(clair).setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: 'comtaple+session', exp: expireA }).encrypt(cle);
}

/** Déchiffre ; renvoie null si le jeton est altéré, chiffré avec une autre clé ou expiré. Ne lève jamais. */
export async function dechiffrer<T>(jeton: string, cle: Uint8Array, maintenant: number = Math.floor(Date.now() / 1000)): Promise<T | null> {
  try {
    const { plaintext, protectedHeader } = await compactDecrypt(jeton, cle, {
      keyManagementAlgorithms: ['dir'],
      contentEncryptionAlgorithms: ['A256GCM'],
    });
    const exp = (protectedHeader as { exp?: unknown }).exp;
    if (protectedHeader.typ !== 'comtaple+session' || typeof exp !== 'number' || exp <= maintenant) return null;
    const json = await transformer(plaintext, new DecompressionStream('deflate-raw'));
    return JSON.parse(decodeur.decode(json)) as T;
  } catch {
    return null;
  }
}

export interface MorceauCookie {
  nom: string;
  valeur: string;
}

/**
 * Découpe une valeur en cookies `nom.0`, `nom.1`… Le premier morceau commence par « n: » (nombre de morceaux),
 * ce qui permet d'ignorer d'éventuels morceaux résiduels d'une session antérieure plus volumineuse.
 */
export function decouper(nom: string, valeur: string, tailleMax: number = TAILLE_MAX_MORCEAU): MorceauCookie[] {
  if (tailleMax < 16) throw new Error('taille de morceau trop petite');
  const prefixeMax = 2; // « n: » avec n sur un chiffre
  const nb = Math.max(1, Math.ceil((valeur.length + prefixeMax) / tailleMax));
  if (nb > NB_MAX_MORCEAUX) throw new Error('Session trop volumineuse pour être conservée dans des cookies');
  const complet = `${nb}:${valeur}`;
  const morceaux: MorceauCookie[] = [];
  for (let i = 0; i < nb; i++) morceaux.push({ nom: `${nom}.${i}`, valeur: complet.slice(i * tailleMax, (i + 1) * tailleMax) });
  return morceaux;
}

/** Recompose la valeur à partir des cookies présents ; null si un morceau manque ou si le format est inattendu. */
export function recomposer(nom: string, lire: (nomCookie: string) => string | undefined): string | null {
  const premier = lire(`${nom}.0`);
  if (!premier) return null;
  const m = /^([1-9]):/.exec(premier);
  if (!m) return null;
  const nb = Number(m[1]);
  if (nb > NB_MAX_MORCEAUX) return null;
  let valeur = premier.slice(2);
  for (let i = 1; i < nb; i++) {
    const suite = lire(`${nom}.${i}`);
    if (!suite) return null;
    valeur += suite;
  }
  return valeur;
}

/** Noms de tous les cookies possibles d'une session (pour l'effacement). */
export function nomsMorceaux(nom: string): string[] {
  return Array.from({ length: NB_MAX_MORCEAUX }, (_, i) => `${nom}.${i}`);
}
