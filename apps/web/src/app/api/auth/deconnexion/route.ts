import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/serveur/env';
import { urlFinSession } from '@/lib/serveur/oidc';
import { refusCsrf } from '@/lib/serveur/securite';
import { cookiesEffacement, lireSession } from '@/lib/serveur/session';

export const dynamic = 'force-dynamic';

/** Déconnexion : efface la session locale puis clôt la session auprès du fournisseur d'identité. Formulaire POST uniquement. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const refus = refusCsrf(req.headers, false);
  if (refus) return NextResponse.json({ message: refus }, { status: 403 });
  const session = await lireSession(req.cookies);
  const fin = await urlFinSession(session);
  const reponse = NextResponse.redirect(fin ?? `${env().WEB_URL}/connexion?deconnecte=1`, { status: 303, headers: { 'Cache-Control': 'no-store' } });
  for (const c of cookiesEffacement()) reponse.cookies.set(c.nom, c.valeur, c.options);
  return reponse;
}
