/** Appels de l'API métier depuis les composants serveur, avec le jeton de la session (jamais transmis au navigateur). */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from './env';
import { lireSession } from './session';

export class ErreurApi extends Error {
  constructor(
    readonly statut: number,
    message: string,
  ) {
    super(message);
  }
}

export type Resultat<T> = { ok: true; donnees: T } | { ok: false; statut: number; message: string };

function messageDe(corps: unknown, defaut: string): string {
  const m = (corps as { message?: unknown } | null)?.message;
  return typeof m === 'string' ? m : defaut;
}

/** Appelle `v1/…` ; lève `ErreurApi` pour tout statut d'erreur. Une session absente renvoie à la connexion. */
export async function api<T>(chemin: string, init?: { method?: string; corps?: unknown }): Promise<T> {
  const session = await lireSession(await cookies());
  if (!session) redirect('/connexion');
  let reponse: Response;
  try {
    reponse = await fetch(`${env().API_URL}/${chemin.replace(/^\/+/, '')}`, {
      method: init?.method ?? 'GET',
      headers: { authorization: `Bearer ${session.acces}`, accept: 'application/json', ...(session.cabinet ? { 'x-cabinet-id': session.cabinet } : {}), ...(init?.corps !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(init?.corps !== undefined ? { body: JSON.stringify(init.corps) } : {}),
      cache: 'no-store',
    });
  } catch {
    throw new ErreurApi(503, 'Le service est momentanément indisponible.');
  }
  if (reponse.status === 401) redirect('/connexion?erreur=session');
  const corps: unknown = await reponse.json().catch(() => null);
  if (!reponse.ok) throw new ErreurApi(reponse.status, messageDe(corps, `Erreur ${reponse.status}`));
  return corps as T;
}

/** Variante qui ne lève pas pour les refus attendus (403, 404, 409, indisponibilité) : la page les affiche proprement. */
export async function tenter<T>(chemin: string): Promise<Resultat<T>> {
  try {
    return { ok: true, donnees: await api<T>(chemin) };
  } catch (e) {
    if (e instanceof ErreurApi) return { ok: false, statut: e.statut, message: e.message };
    throw e;
  }
}
