/** Transport réel : appels du BFF Next (`/api/bff/v1/…`), qui ajoute le jeton côté serveur. */
import type { VueTeleversement, VueTerminee } from '../types-api';
import { ErreurHttp, ErreurReseau, type Transport } from './moteur';

export const ENTETE_CSRF = { 'X-Comtaple-Csrf': '1' } as const;

/** Appel JSON du BFF. Lève `ErreurHttp` (statut d'erreur relayé) ou `ErreurReseau` (requête non aboutie). */
export async function appelBff<T>(chemin: string, init: { method?: string; json?: unknown; corps?: Blob; signal?: AbortSignal } = {}): Promise<T> {
  let reponse: Response;
  try {
    reponse = await fetch(`/api/bff/${chemin}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(init.method && init.method !== 'GET' ? ENTETE_CSRF : {}),
        ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init.corps ? { 'Content-Type': 'application/octet-stream' } : {}),
      },
      // Le morceau est lu en mémoire avant l'envoi : certains navigateurs échouent à émettre directement un Blob issu d'IndexedDB.
      body: init.json !== undefined ? JSON.stringify(init.json) : init.corps ? await init.corps.arrayBuffer() : null,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(init.signal ? { signal: init.signal } : {}),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ErreurReseau('Connexion interrompue');
  }
  const corps: unknown = await reponse.json().catch(() => null);
  if (!reponse.ok) throw new ErreurHttp(reponse.status, corps);
  return corps as T;
}

export const transportBff: Transport = {
  ouvrir: (o, signal) => appelBff<VueTeleversement>('v1/televersements', { method: 'POST', json: o, ...(signal ? { signal } : {}) }),
  etat: (id, signal) => appelBff<VueTeleversement>(`v1/televersements/${id}`, signal ? { signal } : {}),
  envoyerMorceau: (id, decalage, donnees, signal) =>
    appelBff<VueTeleversement>(`v1/televersements/${id}/morceaux?decalage=${decalage}`, { method: 'PUT', corps: donnees, ...(signal ? { signal } : {}) }),
  terminer: (id, signal) => appelBff<VueTerminee>(`v1/televersements/${id}/terminer`, { method: 'POST', ...(signal ? { signal } : {}) }),
};

/** Empreinte SHA-256 hexadécimale, calculée localement avec l'API Web Crypto. */
export async function sha256Hex(fichier: Blob): Promise<string> {
  const condense = await crypto.subtle.digest('SHA-256', await fichier.arrayBuffer());
  return Array.from(new Uint8Array(condense), (o) => o.toString(16).padStart(2, '0')).join('');
}
