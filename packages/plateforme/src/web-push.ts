/**
 * Protocole Web Push, écrit avec `node:crypto` seulement (aucune dépendance) :
 *  - chiffrement du message (RFC 8291, encodage « aes128gcm » de la RFC 8188) : ECDH P-256, HKDF-SHA-256, AES-128-GCM ;
 *  - identification volontaire du serveur d'application (VAPID, RFC 8292) : jeton JWT signé ES256.
 * Vérifié contre les exemples publiés par les deux RFC (web-push.test.ts). Le déchiffrement et la vérification du jeton
 * ne servent qu'au simulateur de service de notification et aux tests : l'application ne reçoit jamais de message poussé.
 */
import { createCipheriv, createDecipheriv, createECDH, createHmac, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';

const b64u = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
const deB64u = (s: string): Buffer => (/^[A-Za-z0-9_-]*$/.test(s) ? Buffer.from(s, 'base64url') : Buffer.alloc(0));
const hmac = (cle: Uint8Array, donnees: Uint8Array): Buffer => createHmac('sha256', cle).update(donnees).digest();
/** HKDF-SHA-256 réduit à UN bloc de sortie (32 octets au plus), suffisant ici : Extract puis Expand avec le compteur 0x01. */
const hkdf = (sel: Uint8Array, ikm: Uint8Array, info: Uint8Array, longueur: number): Buffer => hmac(hmac(sel, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, longueur);

/** Taille d'enregistrement annoncée (RFC 8291, section 4 : un seul enregistrement, 4096 octets au plus). */
const TAILLE_ENREGISTREMENT = 4096;
/** Clair maximal : 4096 − en-tête (86) − délimiteur (1) − étiquette (16) = 3993 octets (RFC 8291, section 4). */
export const TAILLE_MAX_CLAIR_POUSSE = 3993;

export class ErreurWebPush extends Error {}

export interface ClesAbonnementPousse {
  /** Clé publique P-256 du navigateur, point non compressé (65 octets), base64url. */
  p256dh: string;
  /** Secret d'authentification (16 octets), base64url. */
  auth: string;
}

function cleNavigateur(cles: ClesAbonnementPousse): { publique: Buffer; auth: Buffer } {
  const publique = deB64u(cles.p256dh);
  const auth = deB64u(cles.auth);
  if (publique.length !== 65 || publique[0] !== 4) throw new ErreurWebPush('Clé p256dh invalide : point P-256 non compressé de 65 octets attendu.');
  if (auth.length !== 16) throw new ErreurWebPush('Secret d’authentification invalide : 16 octets attendus.');
  return { publique, auth };
}

/** Vrai si les clés d'un abonnement ont la forme attendue ET si le point est sur la courbe (ECDH possible). */
export function clesAbonnementValides(cles: ClesAbonnementPousse): boolean {
  try {
    const { publique } = cleNavigateur(cles);
    const e = createECDH('prime256v1');
    e.generateKeys();
    e.computeSecret(publique);
    return true;
  } catch {
    return false;
  }
}

function derivations(secretEcdh: Buffer, auth: Buffer, publiqueNavigateur: Buffer, publiqueServeur: Buffer, sel: Buffer): { cle: Buffer; nonce: Buffer } {
  // RFC 8291, section 3.4.
  const ikm = hkdf(auth, secretEcdh, Buffer.concat([Buffer.from('WebPush: info\0', 'ascii'), publiqueNavigateur, publiqueServeur]), 32);
  return {
    cle: hkdf(sel, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'ascii'), 16),
    nonce: hkdf(sel, ikm, Buffer.from('Content-Encoding: nonce\0', 'ascii'), 12),
  };
}

/**
 * Chiffre un message pour un abonnement. Renvoie le corps de la requête (`Content-Encoding: aes128gcm`).
 * `fixes` (sel et clé privée éphémère imposés) ne sert qu'à rejouer l'exemple de la RFC : en usage normal, ils sont
 * tirés au hasard à CHAQUE message.
 */
export function chiffrerMessagePousse(clair: Uint8Array, cles: ClesAbonnementPousse, fixes?: { sel: Uint8Array; clePriveeEphemere: Uint8Array }): Buffer {
  if (clair.byteLength > TAILLE_MAX_CLAIR_POUSSE) throw new ErreurWebPush('Message trop long pour une notification poussée.');
  const { publique, auth } = cleNavigateur(cles);
  const ecdh = createECDH('prime256v1');
  if (fixes) ecdh.setPrivateKey(Buffer.from(fixes.clePriveeEphemere));
  else ecdh.generateKeys();
  const publiqueServeur = ecdh.getPublicKey();
  let secret: Buffer;
  try {
    secret = ecdh.computeSecret(publique);
  } catch {
    throw new ErreurWebPush('Clé p256dh invalide : le point n’est pas sur la courbe P-256.');
  }
  const sel = fixes ? Buffer.from(fixes.sel) : randomBytes(16);
  const { cle, nonce } = derivations(secret, auth, publique, publiqueServeur, sel);
  const chiffreur = createCipheriv('aes-128-gcm', cle, nonce);
  // Un seul enregistrement, le dernier : délimiteur 0x02, sans bourrage.
  const chiffre = Buffer.concat([chiffreur.update(clair), chiffreur.update(Buffer.from([2])), chiffreur.final(), chiffreur.getAuthTag()]);
  const entete = Buffer.alloc(21);
  sel.copy(entete, 0);
  entete.writeUInt32BE(TAILLE_ENREGISTREMENT, 16);
  entete.writeUInt8(publiqueServeur.length, 20);
  return Buffer.concat([entete, publiqueServeur, chiffre]);
}

/** Déchiffre un message poussé avec la clé PRIVÉE du navigateur (simulateur et tests uniquement). */
export function dechiffrerMessagePousse(corps: Uint8Array, navigateur: { clePrivee: Uint8Array; auth: Uint8Array }): Buffer {
  const b = Buffer.from(corps);
  if (b.length < 21 + 65 + 17) throw new ErreurWebPush('Message poussé trop court.');
  const sel = b.subarray(0, 16);
  const taille = b.readUInt32BE(16);
  const longueurCle = b.readUInt8(20);
  if (longueurCle !== 65) throw new ErreurWebPush('Identifiant de clé inattendu : clé publique P-256 de 65 octets attendue.');
  const publiqueServeur = b.subarray(21, 86);
  const chiffre = b.subarray(86);
  if (chiffre.length > taille) throw new ErreurWebPush('Message poussé en plusieurs enregistrements : non admis.');
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(navigateur.clePrivee));
  const { cle, nonce } = derivations(ecdh.computeSecret(publiqueServeur), Buffer.from(navigateur.auth), ecdh.getPublicKey(), publiqueServeur, sel);
  try {
    const d = createDecipheriv('aes-128-gcm', cle, nonce);
    d.setAuthTag(chiffre.subarray(chiffre.length - 16));
    const clair = Buffer.concat([d.update(chiffre.subarray(0, chiffre.length - 16)), d.final()]);
    // Retrait du bourrage : zéros finaux éventuels, puis le délimiteur 0x02 du dernier enregistrement.
    let fin = clair.length - 1;
    while (fin >= 0 && clair[fin] === 0) fin--;
    if (fin < 0 || clair[fin] !== 2) throw new Error('délimiteur');
    return clair.subarray(0, fin);
  } catch {
    throw new ErreurWebPush('Déchiffrement refusé : message altéré ou clés de l’abonnement différentes.');
  }
}

// ───────────────────────────── VAPID (RFC 8292) ─────────────────────────────

export interface ClesVapid {
  /** Clé publique P-256, point non compressé, base64url : c'est l'`applicationServerKey` donnée au navigateur. */
  publique: string;
  /** Clé privée P-256 (32 octets), base64url. SECRET : jamais dans le dépôt, jamais journalisée. */
  privee: string;
}

/** Nouvelle paire de clés VAPID. Rien n'est écrit nulle part : à l'appelant de la remettre à qui doit la garder. */
export function genererClesVapid(): ClesVapid {
  const e = createECDH('prime256v1');
  e.generateKeys();
  // `getPrivateKey()` rend l'entier SANS ses octets nuls de tête : une clé sur 256 environ ferait moins de 32 octets et
  // serait refusée par `clesVapidCoherentes`. Elle est donc ramenée à 32 octets (complétée à gauche par des zéros).
  const privee = e.getPrivateKey();
  return { publique: b64u(e.getPublicKey()), privee: b64u(Buffer.concat([Buffer.alloc(32 - privee.length), privee])) };
}

/** Vrai si la paire est bien formée ET cohérente (la clé publique est celle de la clé privée). */
export function clesVapidCoherentes(cles: ClesVapid): boolean {
  try {
    const privee = deB64u(cles.privee);
    if (privee.length !== 32) return false;
    const e = createECDH('prime256v1');
    e.setPrivateKey(privee);
    return b64u(e.getPublicKey()) === cles.publique;
  } catch {
    return false;
  }
}

const jwkPublic = (publique: Buffer) => ({ kty: 'EC', crv: 'P-256', x: b64u(publique.subarray(1, 33)), y: b64u(publique.subarray(33, 65)) });

/** Durée de validité maximale d'un jeton VAPID (RFC 8292, section 2 : 24 heures au plus). */
export const VALIDITE_MAX_VAPID_S = 24 * 3600;

/**
 * Valeur de l'en-tête `Authorization` (schéma « vapid », RFC 8292, section 3). `audience` est l'ORIGINE du point
 * d'accès : le jeton n'est valable que pour ce service de notification. `sujet` : contact de l'éditeur (mailto: ou https:).
 */
export function enteteVapid(p: { audience: string; sujet: string; cles: ClesVapid; expiration: number }): string {
  const publique = deB64u(p.cles.publique);
  if (publique.length !== 65 || publique[0] !== 4) throw new ErreurWebPush('Clé publique VAPID invalide.');
  const cle = createPrivateKey({ key: { ...jwkPublic(publique), d: p.cles.privee }, format: 'jwk' });
  const aSigner = `${b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))}.${b64u(Buffer.from(JSON.stringify({ aud: p.audience, exp: p.expiration, sub: p.sujet })))}`;
  const signature = sign('sha256', Buffer.from(aSigner, 'ascii'), { key: cle, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${aSigner}.${b64u(signature)}, k=${p.cles.publique}`;
}

export interface JetonVapidVerifie {
  /** Clé publique annoncée (paramètre `k`), base64url : le service la compare à celle de l'abonnement. */
  clePublique: string;
  aud: string;
  exp: number;
  sub: string;
}

/**
 * Vérifie un en-tête `Authorization: vapid t=…, k=…` comme le ferait un service de notification : signature ES256 par la
 * clé `k`, audience égale à l'origine du service, expiration future et à moins de 24 heures, sujet présent.
 * `maintenant` en secondes. Lève `ErreurWebPush` avec le motif.
 */
export function verifierEnteteVapid(entete: string | undefined, attendu: { audience: string; maintenant: number }): JetonVapidVerifie {
  const m = /^vapid\s+(.+)$/i.exec(entete ?? '');
  if (!m) throw new ErreurWebPush('Schéma d’autorisation « vapid » attendu.');
  const params = new Map(m[1]!.split(',').map((x) => x.trim().split('=', 2) as [string, string]));
  const t = params.get('t') ?? '';
  const k = params.get('k') ?? '';
  const parties = t.split('.');
  const publique = deB64u(k);
  if (parties.length !== 3 || publique.length !== 65 || publique[0] !== 4) throw new ErreurWebPush('Paramètres « t » ou « k » mal formés.');
  let enteteJwt: any;
  let corps: any;
  try {
    enteteJwt = JSON.parse(deB64u(parties[0]!).toString('utf8'));
    corps = JSON.parse(deB64u(parties[1]!).toString('utf8'));
  } catch {
    throw new ErreurWebPush('Jeton illisible.');
  }
  if (enteteJwt?.alg !== 'ES256') throw new ErreurWebPush('Algorithme de signature inattendu : ES256 exigé.');
  const signature = deB64u(parties[2]!);
  const valide = signature.length === 64 && verify('sha256', Buffer.from(`${parties[0]}.${parties[1]}`, 'ascii'), { key: createPublicKey({ key: jwkPublic(publique), format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, signature);
  if (!valide) throw new ErreurWebPush('Signature du jeton invalide.');
  if (corps?.aud !== attendu.audience) throw new ErreurWebPush('Audience du jeton différente de l’origine du service.');
  if (typeof corps.exp !== 'number' || corps.exp <= attendu.maintenant) throw new ErreurWebPush('Jeton expiré.');
  if (corps.exp > attendu.maintenant + VALIDITE_MAX_VAPID_S) throw new ErreurWebPush('Expiration à plus de 24 heures.');
  if (typeof corps.sub !== 'string' || !/^(mailto:|https:\/\/)/.test(corps.sub)) throw new ErreurWebPush('Sujet (contact) absent ou mal formé.');
  return { clePublique: k, aud: corps.aud, exp: corps.exp, sub: corps.sub };
}
