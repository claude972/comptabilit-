import { type NextRequest, NextResponse } from 'next/server';
import { rafraichir } from './lib/serveur/oidc';
import { entetesSecurite } from './lib/serveur/securite';
import { COOKIE_SESSION, type CookieAPoser, cookiesEffacement, cookiesSession, doitRafraichir, lireSession } from './lib/serveur/session';

/** Chemins servis sans session : écran de connexion, page hors-ligne, parcours OIDC et fichiers de la PWA. */
function estPublic(chemin: string): boolean {
  return (
    chemin === '/connexion' ||
    chemin === '/hors-ligne' ||
    chemin.startsWith('/api/auth/') ||
    chemin === '/manifest.webmanifest' ||
    chemin === '/sw.js' ||
    chemin === '/favicon.ico' ||
    chemin.startsWith('/icones/')
  );
}

/** En-tête `Cookie` transmis aux composants serveur, avec la session renouvelée à la place de l'ancienne. */
function enteteCookie(req: NextRequest, cookies: CookieAPoser[]): string {
  const paires = req.cookies
    .getAll()
    .filter((c) => !c.name.startsWith(`${COOKIE_SESSION}.`))
    .map((c) => `${c.name}=${c.value}`);
  for (const c of cookies) if (c.valeur) paires.push(`${c.nom}=${c.valeur}`);
  return paires.join('; ');
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const chemin = req.nextUrl.pathname;
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64');
  const securite = entetesSecurite(nonce);
  const finir = (reponse: NextResponse, cookies: CookieAPoser[] = []) => {
    for (const [nom, valeur] of Object.entries(securite)) reponse.headers.set(nom, valeur);
    for (const c of cookies) reponse.cookies.set(c.nom, c.valeur, c.options);
    return reponse;
  };

  let session = await lireSession(req.cookies);
  let aPoser: CookieAPoser[] = [];
  // Renouvellement transparent du jeton d'accès. S'il échoue, la session est close : retour à la connexion.
  if (session && doitRafraichir(session) && !chemin.startsWith('/api/auth/')) {
    session = await rafraichir(session);
    aPoser = session ? await cookiesSession(session) : cookiesEffacement();
  }

  if (!session && !estPublic(chemin)) {
    if (chemin.startsWith('/api/')) {
      return finir(NextResponse.json({ message: 'Session absente ou expirée' }, { status: 401, headers: { 'Cache-Control': 'no-store' } }), aPoser);
    }
    const cible = new URL('/connexion', req.nextUrl);
    if (chemin !== '/') cible.searchParams.set('retour', `${chemin}${req.nextUrl.search}`);
    return finir(NextResponse.redirect(cible), aPoser);
  }

  const entetes = new Headers(req.headers);
  entetes.set('x-nonce', nonce);
  entetes.set('content-security-policy', securite['Content-Security-Policy'] ?? '');
  if (aPoser.length) entetes.set('cookie', enteteCookie(req, aPoser));
  const reponse = NextResponse.next({ request: { headers: entetes } });
  // Les pages portent des données de dossier : jamais de mise en cache, ni par le navigateur ni par le service worker.
  if (!chemin.startsWith('/icones/') && chemin !== '/favicon.ico') reponse.headers.set('Cache-Control', 'no-store');
  return finir(reponse, aPoser);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
