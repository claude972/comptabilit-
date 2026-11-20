import { afterEach, describe, expect, it } from 'vitest';
import { chargeUtilePoussee } from '@comtaple/core';
import { lireConfig } from './config.js';
import { associeAbonnement, chiffrerAbonnement, dechiffrerAbonnement, empreintePointAcces, envoyerNotificationPoussee, notificationsPoussees } from './notifications-poussees.js';
import { demarrerSimulateurPoussees, type SimulateurPoussees } from './simulateur-poussees.js';
import { enteteVapid, genererClesVapid } from './web-push.js';

const SECRET = 'secret-de-test-pour-le-chiffrement-au-repos-0123456789';
const vapid = genererClesVapid();
const base = { PUSH_VAPID_CLE_PUBLIQUE: '', PUSH_VAPID_CLE_PRIVEE: '', PUSH_VAPID_SUJET: '', PUSH_SIMULATEUR_URL: '', JETONS_CLE_CHIFFREMENT: SECRET, NODE_ENV: 'test' };
const avecCles = { ...base, PUSH_VAPID_CLE_PUBLIQUE: vapid.publique, PUSH_VAPID_CLE_PRIVEE: vapid.privee, PUSH_VAPID_SUJET: 'mailto:exploitation@editeur.example' };
const ID = '3f2b8c1e-7a4d-4e9b-8c2a-1d5e6f7a8b9c';
let sim: SimulateurPoussees | null = null;
afterEach(async () => {
  await sim?.arreter();
  sim = null;
});

describe('état des notifications poussées d’après la configuration', () => {
  it('sans clés VAPID (défaut) : non configuré, aucune clé publique, rien ne peut être chiffré ni envoyé', async () => {
    const e = notificationsPoussees(base);
    expect(e).toMatchObject({ statut: 'non_configure', clePublique: null, vapid: null, verifieSurAppareilReel: false, clesRepos: [] });
    expect(e.detail).toBe('Les notifications poussées ne sont pas activées sur ce service.');
    expect(() => chiffrerAbonnement(e, { endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: 'a', auth: 'b' }, 'x')).toThrow(/non configurées/);
    expect(await envoyerNotificationPoussee(e, { endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: 'a', auth: 'b' }, chargeUtilePoussee(null, ID))).toMatchObject({ issue: 'refuse', statut: null });
  });

  it('avec des clés : « configuré, non vérifié » — jamais « vérifié »', () => {
    const e = notificationsPoussees(avecCles);
    expect(e).toMatchObject({ statut: 'configure_non_verifie', clePublique: vapid.publique, verifieSurAppareilReel: false, origineSimulateur: null });
    expect(e.detail).toMatch(/n’a pas été vérifiée/);
    expect(e.detail).not.toContain(vapid.privee);
  });

  it('configuration partielle ou incohérente : refusée, en nommant les variables et jamais leur valeur', () => {
    const autre = genererClesVapid();
    const cas: Array<[Record<string, string>, RegExp]> = [
      [{ ...avecCles, PUSH_VAPID_CLE_PRIVEE: '' }, /vont ensemble/],
      [{ ...avecCles, PUSH_VAPID_SUJET: '' }, /vont ensemble/],
      [{ ...avecCles, PUSH_VAPID_CLE_PRIVEE: autre.privee }, /paire de clés/],
      [{ ...avecCles, PUSH_VAPID_CLE_PUBLIQUE: 'pas-une-cle' }, /paire de clés/],
      [{ ...avecCles, PUSH_VAPID_SUJET: 'exploitation' }, /PUSH_VAPID_SUJET/],
      [{ ...avecCles, JETONS_CLE_CHIFFREMENT: 'court' }, /JETONS_CLE_CHIFFREMENT/],
      [{ ...base, PUSH_SIMULATEUR_URL: 'http://127.0.0.1:9' }, /sans clés VAPID/],
    ];
    for (const [cfg, motif] of cas) {
      let message = '';
      try {
        notificationsPoussees(cfg as typeof base);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message, JSON.stringify(Object.keys(cfg))).toMatch(motif);
      expect(message).not.toContain(autre.privee);
      expect(message).not.toContain(vapid.privee);
    }
  });

  it('simulateur : statut « simulé », refusé en production et hors de la machine locale', () => {
    expect(notificationsPoussees({ ...avecCles, PUSH_SIMULATEUR_URL: 'http://127.0.0.1:4567/' })).toMatchObject({ statut: 'simule', origineSimulateur: 'http://127.0.0.1:4567' });
    expect(() => notificationsPoussees({ ...avecCles, PUSH_SIMULATEUR_URL: 'http://127.0.0.1:4567', NODE_ENV: 'production' })).toThrow(/interdit/);
    const env = { REDIS_URL: 'redis://x', S3_ENDPOINT: 'http://x.test', S3_BUCKET: 'abc', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 'b', OIDC_ISSUER: 'http://x.test' };
    expect(lireConfig(env)).toMatchObject({ PUSH_VAPID_CLE_PUBLIQUE: '', PUSH_VAPID_CLE_PRIVEE: '', PUSH_VAPID_SUJET: '', PUSH_SIMULATEUR_URL: '' });
    expect(() => lireConfig({ ...env, PUSH_SIMULATEUR_URL: 'http://127.0.0.1:4567', NODE_ENV: 'production' })).toThrow(/PUSH_SIMULATEUR_URL/);
    expect(() => lireConfig({ ...env, PUSH_SIMULATEUR_URL: 'https://fcm.googleapis.com' })).toThrow(/simulateur local/);
    expect(() => lireConfig({ ...env, PUSH_SIMULATEUR_URL: 'pas une adresse' })).toThrow(/simulateur local/);
  });
});

describe('abonnement chiffré au repos', () => {
  const secrets = { endpoint: 'https://fcm.googleapis.com/fcm/send/jeton-de-l-appareil', p256dh: 'BCVxsr7N', auth: 'BTBZMqHH6r4Tts7J_aSIgg' };
  const associe = associeAbonnement('cabinet-1', 'utilisateur-1', empreintePointAcces(secrets.endpoint));

  it('ni le point d’accès ni les clés n’apparaissent dans l’enveloppe ; elle se relit avec les mêmes données associées', () => {
    const e = notificationsPoussees(avecCles);
    const enveloppe = chiffrerAbonnement(e, secrets, associe);
    expect(enveloppe).toMatch(/^a1\.p-[0-9a-f]{12}\./);
    for (const v of Object.values(secrets)) expect(enveloppe).not.toContain(v);
    expect(enveloppe).not.toContain('fcm.googleapis.com');
    expect(dechiffrerAbonnement(e, enveloppe, associe)).toEqual(secrets);
    expect(chiffrerAbonnement(e, secrets, associe)).not.toBe(enveloppe); // IV aléatoire
    expect(empreintePointAcces(secrets.endpoint)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('enveloppe déplacée sur une autre personne ou un autre cabinet, altérée, ou chiffrée par un autre secret : illisible', () => {
    const e = notificationsPoussees(avecCles);
    const enveloppe = chiffrerAbonnement(e, secrets, associe);
    expect(dechiffrerAbonnement(e, enveloppe, associeAbonnement('cabinet-1', 'utilisateur-2', empreintePointAcces(secrets.endpoint)))).toBeNull();
    expect(dechiffrerAbonnement(e, enveloppe, associeAbonnement('cabinet-2', 'utilisateur-1', empreintePointAcces(secrets.endpoint)))).toBeNull();
    const parties = enveloppe.split('.');
    parties[3] = `${parties[3]!.slice(0, -2)}AA`;
    expect(dechiffrerAbonnement(e, parties.join('.'), associe)).toBeNull();
    expect(dechiffrerAbonnement(e, 'n-importe-quoi', associe)).toBeNull();
    const autreSecret = notificationsPoussees({ ...avecCles, JETONS_CLE_CHIFFREMENT: `${SECRET}-autre` });
    expect(dechiffrerAbonnement(autreSecret, enveloppe, associe)).toBeNull();
    // Rotation : l'ancien secret, déclaré comme tel, déchiffre encore ; le nouveau chiffre.
    const rotation = notificationsPoussees({ ...avecCles, JETONS_CLE_CHIFFREMENT: `${SECRET}-autre`, JETONS_CLES_ANCIENNES: SECRET });
    expect(dechiffrerAbonnement(rotation, enveloppe, associe)).toEqual(secrets);
    expect(chiffrerAbonnement(rotation, secrets, associe).split('.')[1]).not.toBe(enveloppe.split('.')[1]);
  });
});

describe('envoi contre le simulateur de service de notification', () => {
  const demarrer = async () => {
    sim = await demarrerSimulateurPoussees();
    return { sim, etat: notificationsPoussees({ ...avecCles, PUSH_SIMULATEUR_URL: sim.origine }) };
  };
  const secretsDe = (a: { endpoint: string; keys: { p256dh: string; auth: string } }) => ({ endpoint: a.endpoint, p256dh: a.keys.p256dh, auth: a.keys.auth });

  it('le simulateur vérifie le jeton VAPID, exige les en-têtes et déchiffre exactement la charge utile discrète', async () => {
    const { sim, etat } = await demarrer();
    const a = sim.abonner(vapid.publique);
    const r = await envoyerNotificationPoussee(etat, secretsDe(a), chargeUtilePoussee({ type: 'document.complement_demande' }, ID));
    expect(r).toEqual({ issue: 'accepte', statut: 201 });
    expect(sim.refus).toEqual([]);
    expect(sim.messages).toHaveLength(1);
    const m = sim.messages[0]!;
    expect(m.clair).toBe(`{"v":1,"t":"complement","i":"${ID}"}`);
    expect(m.enTetes).toEqual({ ttl: '86400', urgency: 'normal', topic: 'comtaple-complement', contentEncoding: 'aes128gcm' });
    expect(m.sujet).toBe('mailto:exploitation@editeur.example');
    expect(m.chiffre.includes(Buffer.from('complement'))).toBe(false);
    expect(m.chiffre.includes(Buffer.from(ID))).toBe(false);
  });

  it('404 ou 410 : abonnement périmé ; 429 ou 5xx ou service injoignable : temporaire ; 400, 403, 413 : refusé', async () => {
    const { sim, etat } = await demarrer();
    const a = sim.abonner(vapid.publique);
    const charge = chargeUtilePoussee(null, ID);
    sim.forcer(a.endpoint, 404, 429, 500, 503, 400, 413);
    const issues = [];
    for (let i = 0; i < 6; i++) issues.push(await envoyerNotificationPoussee(etat, secretsDe(a), charge));
    expect(issues).toEqual([
      { issue: 'abonnement_perime', statut: 404 }, { issue: 'temporaire', statut: 429 }, { issue: 'temporaire', statut: 500 }, { issue: 'temporaire', statut: 503 }, { issue: 'refuse', statut: 400 }, { issue: 'refuse', statut: 413 },
    ]);
    sim.revoquer(a.endpoint);
    expect(await envoyerNotificationPoussee(etat, secretsDe(a), charge)).toEqual({ issue: 'abonnement_perime', statut: 410 });
    expect(sim.messages).toEqual([]);
    // Abonnement créé pour une AUTRE clé VAPID : le service refuse (403), comme un service réel.
    const etranger = sim.abonner(genererClesVapid().publique);
    expect(await envoyerNotificationPoussee(etat, secretsDe(etranger), charge)).toEqual({ issue: 'refuse', statut: 403 });
    const origine = sim.origine;
    await sim.arreter();
    expect(await envoyerNotificationPoussee({ ...etat, origineSimulateur: origine }, secretsDe(a), charge)).toEqual({ issue: 'temporaire', statut: null, motif: 'injoignable' });
  });

  it('destination non admise ou clés d’abonnement invalides : aucune requête n’est émise', async () => {
    const { sim, etat } = await demarrer();
    const a = sim.abonner(vapid.publique);
    const charge = chargeUtilePoussee(null, ID);
    // Pile simulée : un service réel n'est PAS une destination admise (une pile de test ne peut pas l'atteindre).
    for (const endpoint of ['https://fcm.googleapis.com/fcm/send/abc', 'http://127.0.0.1:1/push/abc', 'http://169.254.169.254/latest/meta-data/', `${sim.origine.replace('127.0.0.1', 'localhost')}/push/abc`]) {
      expect(await envoyerNotificationPoussee(etat, { ...secretsDe(a), endpoint }, charge), endpoint).toEqual({ issue: 'refuse', statut: null, motif: 'destination_non_admise' });
    }
    // Pile réelle (sans simulateur) : une adresse locale ou privée n'est jamais appelée.
    const reel = notificationsPoussees(avecCles);
    for (const endpoint of [a.endpoint, 'https://10.0.0.1/push', 'https://localhost/push', 'https://exemple.test/push']) {
      expect(await envoyerNotificationPoussee(reel, { ...secretsDe(a), endpoint }, charge), endpoint).toEqual({ issue: 'refuse', statut: null, motif: 'destination_non_admise' });
    }
    expect(await envoyerNotificationPoussee(etat, { ...secretsDe(a), p256dh: 'abc' }, charge)).toEqual({ issue: 'refuse', statut: null, motif: 'cles_invalides' });
    expect(sim.messages).toEqual([]);
    expect(sim.refus).toEqual([]);
  });

  it('le simulateur refuse un jeton d’une autre audience, expiré, ou une requête sans en-tête TTL', async () => {
    const { sim } = await demarrer();
    const a = sim.abonner(vapid.publique);
    const maintenant = Math.floor(Date.now() / 1000);
    const poster = (authorization: string, enTetes: Record<string, string> = { ttl: '60', 'content-encoding': 'aes128gcm' }) => fetch(a.endpoint, { method: 'POST', headers: { authorization, ...enTetes }, body: new Uint8Array(200) }).then((r) => r.status);
    const jeton = (audience: string, expiration: number) => enteteVapid({ audience, sujet: 'mailto:x@editeur.example', cles: vapid, expiration });
    expect(await poster(jeton('https://fcm.googleapis.com', maintenant + 600))).toBe(401);
    expect(await poster(jeton(sim.origine, maintenant - 5))).toBe(401);
    expect(await poster(jeton(sim.origine, maintenant + 30 * 3600))).toBe(401);
    expect(await poster('Bearer abc')).toBe(401);
    expect(await poster(jeton(sim.origine, maintenant + 600), { 'content-encoding': 'aes128gcm' })).toBe(400);
    expect(await poster(jeton(sim.origine, maintenant + 600), { ttl: '60' })).toBe(400);
    expect(await poster(jeton(sim.origine, maintenant + 600))).toBe(400); // corps indéchiffrable
    expect(sim.messages).toEqual([]);
    expect(sim.refus.map((r) => r.statut)).toEqual([401, 401, 401, 401, 400, 400, 400]);
  });
});
