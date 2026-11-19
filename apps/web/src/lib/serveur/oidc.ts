/** Client OpenID Connect (code d'autorisation + PKCE S256 + state + nonce), exécuté exclusivement côté serveur. */
import * as oidc from 'openid-client';
import { env, estLocal } from './env';
import type { Session, TransactionOidc } from './session';

let configuration: Promise<oidc.Configuration> | undefined;

function config(): Promise<oidc.Configuration> {
  if (!configuration) {
    const e = env();
    // HTTP n'est toléré que vers un fournisseur d'identité local de développement.
    const options = estLocal(e.OIDC_ISSUER) && e.OIDC_ISSUER.startsWith('http://') ? { execute: [oidc.allowInsecureRequests] } : undefined;
    configuration = oidc.discovery(new URL(e.OIDC_ISSUER), e.OIDC_CLIENT_ID, undefined, oidc.ClientSecretPost(e.OIDC_CLIENT_SECRET), options);
    configuration.catch(() => {
      configuration = undefined; // nouvelle tentative de découverte à la prochaine requête
    });
  }
  return configuration;
}

export const urlRetour = () => `${env().WEB_URL}/api/auth/retour`;

export async function preparerConnexion(retour: string): Promise<{ url: URL; transaction: TransactionOidc }> {
  const c = await config();
  const verificateur = oidc.randomPKCECodeVerifier();
  const transaction: TransactionOidc = { verificateur, etat: oidc.randomState(), nonce: oidc.randomNonce(), retour };
  const url = oidc.buildAuthorizationUrl(c, {
    redirect_uri: urlRetour(),
    scope: 'openid profile email',
    code_challenge: await oidc.calculatePKCECodeChallenge(verificateur),
    code_challenge_method: 'S256',
    state: transaction.etat,
    nonce: transaction.nonce,
  });
  return { url, transaction };
}

function versSession(j: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers, precedent?: Session): Session {
  const maintenant = Math.floor(Date.now() / 1000);
  const sujet = j.claims()?.sub ?? precedent?.sujet;
  if (!sujet) throw new Error('Jeton sans sujet');
  return {
    acces: j.access_token,
    rafraichissement: j.refresh_token ?? precedent?.rafraichissement ?? null,
    identite: j.id_token ?? precedent?.identite ?? null,
    expireA: maintenant + (j.expiresIn() ?? 60),
    debut: precedent?.debut ?? maintenant,
    sujet,
  };
}

/** Échange le code reçu sur l'URL de retour ; vérifie `state`, `nonce` et le vérificateur PKCE. */
export async function echangerCode(urlCourante: URL, t: TransactionOidc): Promise<Session> {
  const jetons = await oidc.authorizationCodeGrant(await config(), urlCourante, {
    pkceCodeVerifier: t.verificateur,
    expectedState: t.etat,
    expectedNonce: t.nonce,
    idTokenExpected: true,
  });
  return versSession(jetons);
}

/** Renouvelle le jeton d'accès ; renvoie null si le fournisseur refuse (session révoquée ou expirée). */
export async function rafraichir(s: Session): Promise<Session | null> {
  if (!s.rafraichissement) return null;
  try {
    return versSession(await oidc.refreshTokenGrant(await config(), s.rafraichissement), s);
  } catch {
    return null;
  }
}

export async function urlFinSession(s: Session | null): Promise<URL | null> {
  try {
    const c = await config();
    if (!c.serverMetadata().end_session_endpoint) return null;
    return oidc.buildEndSessionUrl(c, {
      post_logout_redirect_uri: `${env().WEB_URL}/connexion?deconnecte=1`,
      ...(s?.identite ? { id_token_hint: s.identite } : { client_id: env().OIDC_CLIENT_ID }),
    });
  } catch {
    return null;
  }
}

export function origineFournisseur(): string {
  return new URL(env().OIDC_ISSUER).origin;
}
