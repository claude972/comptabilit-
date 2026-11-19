import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/serveur/env';
import { echangerCode } from '@/lib/serveur/oidc';
import { COOKIE_OIDC, cheminRetourSur, cookiesSession, lireTransaction } from '@/lib/serveur/session';

export const dynamic = 'force-dynamic';

/** Retour du fournisseur d'identité : échange du code, vérifications, puis ouverture de la session chiffrée. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const base = env().WEB_URL;
  const echec = (motif: string) => {
    const r = NextResponse.redirect(`${base}/connexion?erreur=${motif}`, { headers: { 'Cache-Control': 'no-store' } });
    r.cookies.set(COOKIE_OIDC, '', { path: '/api/auth', maxAge: 0 });
    return r;
  };
  const transaction = await lireTransaction(req.cookies);
  if (!transaction) return echec('expire');
  try {
    // L'URL de retour est reconstruite à partir de l'adresse publique configurée, pas de l'en-tête Host reçu.
    const session = await echangerCode(new URL(`${base}/api/auth/retour${req.nextUrl.search}`), transaction);
    const reponse = NextResponse.redirect(`${base}${cheminRetourSur(transaction.retour)}`, { headers: { 'Cache-Control': 'no-store' } });
    for (const c of await cookiesSession(session)) reponse.cookies.set(c.nom, c.valeur, c.options);
    reponse.cookies.set(COOKIE_OIDC, '', { path: '/api/auth', maxAge: 0 });
    return reponse;
  } catch {
    return echec('echec');
  }
}
