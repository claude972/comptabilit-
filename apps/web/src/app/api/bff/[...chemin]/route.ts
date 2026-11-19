import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { env } from '@/lib/serveur/env';
import { refusCsrf } from '@/lib/serveur/securite';
import { lireSession } from '@/lib/serveur/session';

export const dynamic = 'force-dynamic';

/**
 * Relais vers l'API métier (« backend for frontend »). Le navigateur ne détient aucun jeton : le relais ajoute
 * `Authorization: Bearer …` à partir de la session chiffrée, ne joint que `API_URL` et uniquement des chemins `v1/…`.
 */
const ENTETES_REQUETE = ['content-type', 'content-length', 'accept', 'x-cabinet-id'];
const ENTETES_REPONSE = ['content-type', 'content-length', 'content-disposition', 'content-security-policy', 'x-content-type-options'];
const SEGMENT = /^[A-Za-z0-9._~-]+$/;

const json = (statut: number, message: string) =>
  Response.json({ message }, { status: statut, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

async function relayer(req: NextRequest, ctx: { params: Promise<{ chemin: string[] }> }): Promise<Response> {
  const { chemin } = await ctx.params;
  if (chemin[0] !== 'v1' || chemin.length < 2 || chemin.some((s) => !SEGMENT.test(s) || s === '.' || s === '..')) return json(404, 'Chemin inconnu');

  if (req.method !== 'GET') {
    const refus = refusCsrf(req.headers);
    if (refus) return json(403, refus);
  } else if (req.headers.get('sec-fetch-site') === 'cross-site') {
    // Une page tierce ne doit pas pouvoir inclure une pièce ou un export (image, cadre…).
    return json(403, 'Requête intersite refusée');
  }

  const session = await lireSession(await cookies());
  if (!session) return json(401, 'Session absente ou expirée');

  const cible = new URL(`${env().API_URL}/${chemin.map(encodeURIComponent).join('/')}`);
  cible.search = req.nextUrl.search;
  const entetes = new Headers({ authorization: `Bearer ${session.acces}` });
  for (const nom of ENTETES_REQUETE) {
    const v = req.headers.get(nom);
    if (v) entetes.set(nom, v);
  }
  const avecCorps = req.method !== 'GET' && req.body !== null;
  let amont: Response;
  try {
    amont = await fetch(cible, {
      method: req.method,
      headers: entetes,
      // Le corps (morceau binaire ou JSON) est relayé en flux, sans être interprété ni conservé.
      ...(avecCorps ? { body: req.body, duplex: 'half' } : {}),
      redirect: 'manual',
      cache: 'no-store',
      signal: req.signal,
    } as RequestInit);
  } catch {
    return json(502, 'Service momentanément indisponible');
  }

  const sortie = new Headers({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  for (const nom of ENTETES_REPONSE) {
    const v = amont.headers.get(nom);
    if (v) sortie.set(nom, v);
  }
  return new Response(amont.status === 204 || amont.status === 304 ? null : amont.body, { status: amont.status, headers: sortie });
}

export { relayer as GET, relayer as POST, relayer as PUT, relayer as PATCH, relayer as DELETE };
