/** Vérification minimale de JWT signés RS256 (jeton OIDC du push Pub/Sub, id_token Microsoft). */
import { createPublicKey, verify } from 'node:crypto';
import { ErreurMail } from './erreurs.js';

export interface Jwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

export class ErreurJwt extends ErreurMail {
  constructor(message: string) {
    super('jwt_invalide', message);
  }
}

function decoderSegment(segment: string): Record<string, unknown> {
  try {
    const valeur: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) throw new Error('forme');
    return valeur as Record<string, unknown>;
  } catch {
    throw new ErreurJwt('Jeton illisible.');
  }
}

/**
 * Vérifie la signature RS256 et renvoie les revendications. `alg` doit être exactement RS256
 * (jamais `none`, jamais un algorithme symétrique) et la clé est choisie par `kid`.
 * Les revendications (iss, aud, exp…) restent à contrôler par l'appelant.
 */
export function verifierJwtRs256(jeton: string, cles: Jwk[]): Record<string, unknown> {
  const parties = jeton.split('.');
  if (parties.length !== 3) throw new ErreurJwt('Jeton mal formé.');
  const [enteteB64, chargeB64, signatureB64] = parties as [string, string, string];
  const entete = decoderSegment(enteteB64);
  if (entete['alg'] !== 'RS256') throw new ErreurJwt('Algorithme de signature refusé.');
  const candidates = cles.filter((c) => c.kty === 'RSA' && (entete['kid'] === undefined || c.kid === entete['kid']));
  const signature = Buffer.from(signatureB64, 'base64url');
  const donnees = Buffer.from(`${enteteB64}.${chargeB64}`, 'ascii');
  for (const jwk of candidates) {
    try {
      const clePublique = createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' });
      if (verify('RSA-SHA256', donnees, clePublique, signature)) return decoderSegment(chargeB64);
    } catch {
      // clé inutilisable : on essaie la suivante
    }
  }
  throw new ErreurJwt('Signature invalide ou clé inconnue.');
}

/** Contrôle `exp` (obligatoire) et `nbf`/`iat` avec une tolérance d'horloge. */
export function verifierValidite(charge: Record<string, unknown>, maintenant: Date, toleranceS = 60): void {
  const t = Math.floor(maintenant.getTime() / 1000);
  const exp = charge['exp'];
  if (typeof exp !== 'number' || exp + toleranceS < t) throw new ErreurJwt('Jeton expiré.');
  const nbf = charge['nbf'];
  if (typeof nbf === 'number' && nbf - toleranceS > t) throw new ErreurJwt('Jeton pas encore valable.');
}
