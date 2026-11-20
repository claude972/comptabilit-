import pg from 'pg';
import type { Contexte } from './contexte.js';

/**
 * Verrou de SESSION PostgreSQL sur un traitement (un import, par exemple), tenu pendant toute sa durée sur une connexion
 * dédiée. Il distingue un traitement réellement en cours dans un worker VIVANT (verrou tenu : on s'efface) d'un traitement
 * resté « en cours » parce que son worker a été tué (SIGKILL, mémoire, redémarrage) : sa connexion est fermée par le serveur,
 * le verrou disparaît, et la reprise peut le prendre. Sans lui, un lot laissé « en cours » par un arrêt brutal ne serait
 * jamais repris (la prise en charge atomique refusait tout lot déjà « en cours »).
 */
export async function avecVerrouTraitement<T>(c: Contexte, cle: string, fn: () => Promise<T>): Promise<{ pris: true; valeur: T } | { pris: false }> {
  // Connexion DÉDIÉE hors du bassin : le verrou est tenu pendant tout le traitement, et le traitement lui-même emprunte des
  // connexions du bassin ; en tenir une du bassin ferait manquer de connexions (blocage) quand plusieurs traitements tournent.
  const client = new pg.Client(c.bd.pool.options);
  client.on('error', () => undefined); // session coupée : le verrou est libéré par le serveur, le traitement s'en rend compte autrement
  await client.connect();
  let verrouille = false;
  try {
    const r = await client.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtextextended($1, 0)) as ok', [cle]);
    if (!r.rows[0]?.ok) return { pris: false };
    verrouille = true;
    return { pris: true, valeur: await fn() };
  } finally {
    if (verrouille) {
      await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [cle]).catch(() => undefined); // session perdue : déjà libéré
    }
    await client.end().catch(() => undefined);
  }
}
