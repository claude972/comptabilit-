import { type NextRequest, NextResponse } from 'next/server';
import { type CodeRetour, codeRetour } from '@/lib/messagerie';
import { env } from '@/lib/serveur/env';
import { CHEMIN_RETOUR_MAIL, type RetourMailEnAttente, cookieRetourMail, effacementRetourMail, lireRetourMail, lireSession } from '@/lib/serveur/session';

export const dynamic = 'force-dynamic';

/**
 * URI de redirection OAuth des fournisseurs de messagerie (`MAIL_URI_REDIRECTION`, par défaut `<WEB_URL>/connexions-mail/retour`).
 *
 * Reçoit `state` + `code` (ou `error`), exige la session de l'utilisateur, relaie à `POST v1/mail/retour` côté serveur,
 * puis REDIRIGE toujours : l'adresse portant le code n'entre pas dans l'historique, n'est jamais affichée ni transmise
 * comme référent. Sans session, les paramètres attendent dans un cookie chiffré `HttpOnly` pendant la connexion.
 */
const ENTETES = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function borne(v: string | null, max: number): string | undefined {
  return v && v.length <= max ? v : undefined;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const base = env().WEB_URL;
  const q = req.nextUrl.searchParams;
  const enUrl = q.has('state') || q.has('code') || q.has('error');
  const fin = (chemin: string, effacer = true) => {
    const r = NextResponse.redirect(`${base}${chemin}`, { status: 303, headers: ENTETES });
    if (effacer) {
      const c = effacementRetourMail();
      r.cookies.set(c.nom, c.valeur, c.options);
    }
    return r;
  };
  const echec = (code: CodeRetour) => fin(`/messagerie?retour=${code}`);

  let recu: RetourMailEnAttente | null = null;
  if (enUrl) {
    const state = borne(q.get('state'), 512);
    const code = borne(q.get('code'), 4096);
    const error = borne(q.get('error'), 200);
    if (state && (code || error)) recu = { state, ...(code ? { code } : {}), ...(error ? { error } : {}) };
  } else {
    recu = await lireRetourMail(req.cookies);
  }

  const session = await lireSession(req.cookies);
  if (!session) {
    if (!recu) return fin('/connexion');
    // Connexion d'abord, reprise ensuite : les paramètres ne voyagent pas dans l'URL de connexion.
    const r = fin(`/connexion?retour=${encodeURIComponent(CHEMIN_RETOUR_MAIL)}`, false);
    const c = await cookieRetourMail(recu);
    r.cookies.set(c.nom, c.valeur, c.options);
    return r;
  }
  if (!recu) return echec('retour_incomplet');

  let reponse: Response;
  try {
    reponse = await fetch(`${env().API_URL}/v1/mail/retour`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.acces}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(recu),
      cache: 'no-store',
    });
  } catch {
    return echec('fournisseur_indisponible');
  }
  if (reponse.status === 401) return fin('/connexion?erreur=session');
  const corps: unknown = await reponse.json().catch(() => null);
  if (!reponse.ok) return echec(codeRetour(reponse.status, corps));
  const id = (corps as { id?: unknown } | null)?.id;
  return typeof id === 'string' && UUID.test(id) ? fin(`/messagerie/${id}?connectee=1`) : echec('echec');
}
