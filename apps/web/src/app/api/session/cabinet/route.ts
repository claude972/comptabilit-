import { type NextRequest, NextResponse } from 'next/server';
import type { Cabinet } from '@/lib/administration';
import { env } from '@/lib/serveur/env';
import { refusCsrf } from '@/lib/serveur/securite';
import { cookiesSession, lireSession } from '@/lib/serveur/session';

export const dynamic = 'force-dynamic';

/**
 * Choix du cabinet par un compte membre de plusieurs cabinets. Le choix est vérifié auprès de l'API (`GET v1/cabinets`)
 * puis mémorisé dans la session chiffrée ; il est ensuite transmis par l'en-tête `X-Cabinet-Id`.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const refus = refusCsrf(req.headers, false);
  if (refus) return NextResponse.json({ message: refus }, { status: 403 });
  const base = env().WEB_URL;
  const session = await lireSession(req.cookies);
  if (!session) return NextResponse.redirect(`${base}/connexion`, { status: 303 });
  const voulu = String((await req.formData().catch(() => null))?.get('cabinetId') ?? '');
  let cabinets: Cabinet[] = [];
  try {
    const r = await fetch(`${env().API_URL}/v1/cabinets`, { headers: { authorization: `Bearer ${session.acces}`, accept: 'application/json' }, cache: 'no-store' });
    if (r.ok) cabinets = (await r.json()) as Cabinet[];
  } catch {
    // traité ci-dessous comme un refus
  }
  if (!Array.isArray(cabinets) || !cabinets.some((c) => c.id === voulu)) {
    return NextResponse.redirect(`${base}/cabinet?erreur=1`, { status: 303, headers: { 'Cache-Control': 'no-store' } });
  }
  const reponse = NextResponse.redirect(`${base}/`, { status: 303, headers: { 'Cache-Control': 'no-store' } });
  for (const c of await cookiesSession({ ...session, cabinet: voulu })) reponse.cookies.set(c.nom, c.valeur, c.options);
  return reponse;
}
