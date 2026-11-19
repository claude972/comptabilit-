import { type NextRequest, NextResponse } from 'next/server';
import { preparerConnexion } from '@/lib/serveur/oidc';
import { cheminRetourSur, cookieTransaction } from '@/lib/serveur/session';
import { env } from '@/lib/serveur/env';

export const dynamic = 'force-dynamic';

/** Démarre le parcours OIDC : vérificateur PKCE, `state` et `nonce` sont conservés chiffrés côté serveur (cookie HttpOnly court). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const retour = cheminRetourSur(req.nextUrl.searchParams.get('retour'));
  try {
    const { url, transaction } = await preparerConnexion(retour);
    const reponse = NextResponse.redirect(url, { headers: { 'Cache-Control': 'no-store' } });
    const c = await cookieTransaction(transaction);
    reponse.cookies.set(c.nom, c.valeur, c.options);
    return reponse;
  } catch {
    return NextResponse.redirect(`${env().WEB_URL}/connexion?erreur=fournisseur`, { headers: { 'Cache-Control': 'no-store' } });
  }
}
