/** Verrou de session d'un traitement (D-101) — PostgreSQL réel : un worker vivant garde son lot, un worker mort le libère. */
import { randomUUID } from 'node:crypto';
import { creerAccesBd, urlBd } from '@comtaple/db';
import { chargerEnvLocal } from '@comtaple/db/env';
import { type Files, lireConfig, type Stockage } from '@comtaple/plateforme';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Contexte } from './contexte.js';
import { avecVerrouTraitement } from './verrou-traitement.js';

chargerEnvLocal();
const bd = creerAccesBd(urlBd('worker'), { max: 4 });
const c: Contexte = { cfg: lireConfig(), bd, stockage: {} as Stockage, taches: {} as Files };
afterAll(() => bd.fermer());

describe('verrou de traitement', () => {
  it('un second appel pour la même clé s’efface tant que le premier tient le verrou ; une autre clé passe ; le verrou est rendu ensuite', async () => {
    const cle = `essai-verrou:${randomUUID()}`;
    let liberer!: () => void;
    const attente = new Promise<void>((r) => (liberer = r));
    let commence!: () => void;
    const debute = new Promise<void>((r) => (commence = r));
    const premier = avecVerrouTraitement(c, cle, async () => {
      commence();
      await attente;
      return 'un';
    });
    await debute;
    expect(await avecVerrouTraitement(c, cle, async () => 'deux')).toEqual({ pris: false });
    expect(await avecVerrouTraitement(c, `${cle}-autre`, async () => 'trois')).toEqual({ pris: true, valeur: 'trois' });
    liberer();
    expect(await premier).toEqual({ pris: true, valeur: 'un' });
    expect(await avecVerrouTraitement(c, cle, async () => 'quatre')).toEqual({ pris: true, valeur: 'quatre' });
  });

  it('une erreur du traitement rend le verrou et se propage ; un worker MORT (session fermée de force) libère son verrou', async () => {
    const cle = `essai-verrou:${randomUUID()}`;
    await expect(avecVerrouTraitement(c, cle, async () => Promise.reject(new Error('échec voulu')))).rejects.toThrow('échec voulu');
    expect(await avecVerrouTraitement(c, cle, async () => 'repris')).toEqual({ pris: true, valeur: 'repris' });
    // Verrou tenu par une session distincte, puis session tuée (comme un SIGKILL du worker) : le verrou disparaît.
    const mort = new pg.Client({ connectionString: urlBd('worker') });
    mort.on('error', () => undefined);
    await mort.connect();
    await mort.query('select pg_advisory_lock(hashtextextended($1, 0))', [cle]);
    expect(await avecVerrouTraitement(c, cle, async () => 'x')).toEqual({ pris: false });
    const pid = (await mort.query('select pg_backend_pid() as pid')).rows[0].pid as number;
    const admin = new pg.Client({ connectionString: urlBd('admin') });
    await admin.connect();
    await admin.query('select pg_terminate_backend($1)', [pid]);
    await admin.end();
    expect(await avecVerrouTraitement(c, cle, async () => 'libre')).toEqual({ pris: true, valeur: 'libre' });
  });
});
