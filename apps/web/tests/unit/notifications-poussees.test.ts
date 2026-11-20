import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { PAGE_POUSSEE, PHRASES_POUSSEES, TITRE_POUSSEE } from '@comtaple/core';
import { describe, expect, it } from 'vitest';
import { type CapacitesNavigateur, cleServeur, empreintePointAcces, etatAppareil } from '@/lib/notifications-poussees';

const SOURCE_SW = readFileSync(path.resolve(import.meta.dirname, '../../public/sw.js'), 'utf8');

/** Exécute le VRAI fichier `public/sw.js` dans un faux environnement de service worker, et rend ses gestionnaires. */
function chargerServiceWorker(options: { fenetres?: Array<{ url: string }>; presentes?: Array<{ data: unknown }> } = {}) {
  const gestionnaires: Record<string, (e: any) => void> = {};
  const affichees: Array<{ titre: string; options: any }> = [];
  const ouvertes: string[] = [];
  const navigations: string[] = [];
  const focus: string[] = [];
  const cache = { ecrites: [] as string[] };
  const fenetres = (options.fenetres ?? []).map((f) => ({ url: f.url, focus: async () => void focus.push(f.url), navigate: async (u: string) => void navigations.push(u) }));
  const self = {
    location: { origin: 'https://comtaple.exemple.test' },
    addEventListener: (nom: string, f: (e: any) => void) => (gestionnaires[nom] = f),
    registration: {
      getNotifications: async () => options.presentes ?? [],
      showNotification: async (titre: string, o: any) => void affichees.push({ titre, options: o }),
    },
    clients: { matchAll: async () => fenetres, openWindow: async (u: string) => void ouvertes.push(u), claim: async () => undefined },
    skipWaiting: async () => undefined,
  };
  const caches = { open: async () => ({ put: async (r: any) => void cache.ecrites.push(typeof r === 'string' ? r : r.url), add: async (u: string) => void cache.ecrites.push(u), match: async () => undefined }), keys: async () => [], match: async () => undefined, delete: async () => true };
  vm.runInNewContext(SOURCE_SW, { self, caches, URL, Response, fetch: async () => new Response('', { status: 200 }), Set, Array, Promise, Object, Error });
  const declencher = async (nom: string, evenement: Record<string, unknown>) => {
    const attentes: Promise<unknown>[] = [];
    gestionnaires[nom]!({ ...evenement, waitUntil: (p: Promise<unknown>) => attentes.push(p) });
    await Promise.all(attentes);
  };
  const message = (charge: unknown) => ({ data: { json: () => (typeof charge === 'string' ? JSON.parse(charge) : charge) } });
  return { gestionnaires, affichees, ouvertes, navigations, focus, cache, declencher, message };
}

describe('service worker : notifications poussées', () => {
  it('la liste fermée des phrases du service worker est exactement celle du moteur', () => {
    const bloc = /const PHRASES_POUSSEES = (\{[^}]+\});/.exec(SOURCE_SW)?.[1];
    expect(bloc).toBeTruthy();
    expect(vm.runInNewContext(`(${bloc})`)).toEqual({ ...PHRASES_POUSSEES });
    expect(SOURCE_SW).toContain(`const TITRE_POUSSEE = '${TITRE_POUSSEE}';`);
    expect(SOURCE_SW).toContain(`const PAGE_POUSSEE = '${PAGE_POUSSEE}';`);
  });

  it('« push » : affiche la phrase générique du type reçu, avec l’étiquette de regroupement et sans rejouer de son', async () => {
    for (const [t, phrase] of Object.entries(PHRASES_POUSSEES)) {
      const sw = chargerServiceWorker();
      await sw.declencher('push', sw.message({ v: 1, t, i: '3f2b8c1e-7a4d-4e9b-8c2a-1d5e6f7a8b9c' }));
      expect(sw.affichees).toHaveLength(1);
      expect(sw.affichees[0]!.titre).toBe('Comtaple');
      expect(sw.affichees[0]!.options).toMatchObject({ body: phrase, tag: 'comtaple-notifications', renotify: false, lang: 'fr', data: { t } });
    }
  });

  it('« push » : rien de ce que contient le message n’est affiché — ni texte, ni titre, ni adresse, ni champ inconnu', async () => {
    const hostile = { v: 1, t: 'complement', i: 'x', title: 'Dossier Dupain SARL', body: 'Facture de 12 345,67 € — facture-meunerie.pdf', url: 'https://malveillant.exemple.test/', icon: 'https://malveillant.exemple.test/i.png', data: { url: 'https://malveillant.exemple.test/' }, actions: [{ action: 'x', title: 'Payer' }] };
    const sw = chargerServiceWorker();
    await sw.declencher('push', sw.message(hostile));
    const affiche = JSON.stringify(sw.affichees);
    for (const interdit of ['Dupain', '12 345', 'meunerie', 'malveillant', 'Payer']) expect(affiche).not.toContain(interdit);
    expect(sw.affichees[0]!.options.body).toBe(PHRASES_POUSSEES.complement);
    expect(Object.keys(sw.affichees[0]!.options).sort()).toEqual(['badge', 'body', 'data', 'icon', 'lang', 'renotify', 'tag']);
    expect(sw.affichees[0]!.options.icon).toBe('/icones/icone-192.png');

    // Type inconnu, version inconnue, message vide ou illisible : phrase par défaut, jamais le contenu reçu.
    for (const charge of [{ v: 1, t: 'Dossier Dupain SARL' }, { v: 2, t: 'complement' }, { v: 1, t: '__proto__' }, { v: 1, t: 'toString' }, { t: 'complement' }, 'null', '"texte libre"', '[1,2]']) {
      const autre = chargerServiceWorker();
      await autre.declencher('push', autre.message(charge));
      expect(autre.affichees.map((a) => a.options.body), JSON.stringify(charge)).toEqual([PHRASES_POUSSEES.notification]);
    }
    const illisible = chargerServiceWorker();
    await illisible.declencher('push', { data: { json: () => { throw new Error('illisible'); } } });
    await illisible.declencher('push', { data: null });
    expect(illisible.affichees.map((a) => a.options.body)).toEqual([PHRASES_POUSSEES.notification, PHRASES_POUSSEES.notification]);
  });

  it('« push » : une notification d’un autre type déjà à l’écran → « de nouvelles notifications » (une seule à la fois)', async () => {
    const sw = chargerServiceWorker({ presentes: [{ data: { t: 'complement' } }] });
    await sw.declencher('push', sw.message({ v: 1, t: 'notification', i: 'x' }));
    expect(sw.affichees[0]!.options).toMatchObject({ body: PHRASES_POUSSEES.plusieurs, tag: 'comtaple-notifications' });
    const meme = chargerServiceWorker({ presentes: [{ data: { t: 'complement' } }] });
    await meme.declencher('push', meme.message({ v: 1, t: 'complement', i: 'x' }));
    expect(meme.affichees[0]!.options.body).toBe(PHRASES_POUSSEES.complement);
  });

  it('« notificationclick » : ouvre la page des notifications, jamais une adresse venue du message', async () => {
    const fermees: number[] = [];
    const notification = { close: () => fermees.push(1), data: { t: 'complement', url: 'https://malveillant.exemple.test/' }, tag: 'https://malveillant.exemple.test/' };
    const sans = chargerServiceWorker();
    await sans.declencher('notificationclick', { notification, action: 'https://malveillant.exemple.test/' });
    expect(sans.ouvertes).toEqual(['/notifications']);
    expect(fermees).toHaveLength(1);
    // Application déjà ouverte : sa fenêtre est activée et menée à la page des notifications ; aucune nouvelle fenêtre.
    const avec = chargerServiceWorker({ fenetres: [{ url: 'https://autre.exemple.test/x' }, { url: 'https://comtaple.exemple.test/depots' }] });
    await avec.declencher('notificationclick', { notification });
    expect(avec.focus).toEqual(['https://comtaple.exemple.test/depots']);
    expect(avec.navigations).toEqual(['/notifications']);
    expect(avec.ouvertes).toEqual([]);
    const dessus = chargerServiceWorker({ fenetres: [{ url: 'https://comtaple.exemple.test/notifications' }] });
    await dessus.declencher('notificationclick', { notification });
    expect(dessus.navigations).toEqual([]);
    expect(dessus.focus).toHaveLength(1);
  });

  it('les gestionnaires de notification ne mettent rien en cache ; le service worker ne met toujours en cache aucun document', async () => {
    const sw = chargerServiceWorker();
    await sw.declencher('push', sw.message({ v: 1, t: 'notification', i: 'x' }));
    await sw.declencher('notificationclick', { notification: { close: () => undefined } });
    expect(sw.cache.ecrites).toEqual([]);
    // Interception : une page (navigation) ou une réponse d'API n'est jamais écrite en cache.
    const reponses: Promise<Response>[] = [];
    const requete = (url: string, mode = 'cors') => ({ method: 'GET', url, mode });
    for (const r of [requete('https://comtaple.exemple.test/depots/abc', 'navigate'), requete('https://comtaple.exemple.test/notifications', 'navigate'), requete('https://comtaple.exemple.test/api/bff/v1/documents/abc/original'), requete('https://comtaple.exemple.test/api/bff/v1/notifications')]) {
      sw.gestionnaires.fetch!({ request: r, respondWith: (p: Promise<Response>) => reponses.push(p) });
    }
    await Promise.all(reponses);
    expect(reponses).toHaveLength(2); // les deux navigations (réseau, repli hors-ligne) ; l'API n'est pas interceptée
    expect(sw.cache.ecrites).toEqual([]);
    expect(SOURCE_SW.match(/cache\.(put|add)\(/g)).toHaveLength(3); // page hors-ligne, coquille statique, fichiers versionnés
  });
});

describe('écran « Sur cet appareil » : état déduit du service et du navigateur', () => {
  const complet: CapacitesNavigateur = { serviceWorker: true, serviceWorkerEnregistre: true, pushManager: true, notification: true, permission: 'default', ios: false, autonome: false, empreinteLocale: null };
  const service = (appareils: string[] = [], activees = true) => ({ activees, appareils: appareils.map((empreinte) => ({ id: empreinte, service: 'fcm', libelleService: '', agent: '', creeLe: '', dernierEnvoiAccepteLe: null, empreinte })) });

  it('fonction non activée par l’éditeur : rien n’est proposé, quel que soit le navigateur', () => {
    expect(etatAppareil(service([], false), complet)).toBe('non_activees');
    expect(etatAppareil(service(['e1'], false), { ...complet, permission: 'granted', empreinteLocale: 'e1' })).toBe('non_activees');
  });

  it('navigateur sans prise en charge ; iPhone hors écran d’accueil ; service worker absent', () => {
    expect(etatAppareil(service(), { ...complet, pushManager: false })).toBe('non_pris_en_charge');
    expect(etatAppareil(service(), { ...complet, notification: false })).toBe('non_pris_en_charge');
    expect(etatAppareil(service(), { ...complet, serviceWorker: false })).toBe('non_pris_en_charge');
    expect(etatAppareil(service(), { ...complet, pushManager: false, notification: false, ios: true })).toBe('ios_a_installer');
    // iPhone, application installée, mais version trop ancienne (pas de PushManager) : non pris en charge.
    expect(etatAppareil(service(), { ...complet, pushManager: false, ios: true, autonome: true })).toBe('non_pris_en_charge');
    expect(etatAppareil(service(), { ...complet, serviceWorkerEnregistre: false })).toBe('service_worker_absent');
  });

  it('autorisation refusée, à demander, accordée ; abonnement connu ou inconnu du service', () => {
    expect(etatAppareil(service(), { ...complet, permission: 'denied' })).toBe('refusees');
    expect(etatAppareil(service(['e1']), { ...complet, permission: 'denied', empreinteLocale: 'e1' })).toBe('refusees');
    expect(etatAppareil(service(), complet)).toBe('a_activer');
    expect(etatAppareil(service(), { ...complet, permission: 'granted' })).toBe('a_activer');
    expect(etatAppareil(service(['e1', 'e2']), { ...complet, permission: 'granted', empreinteLocale: 'e2' })).toBe('abonne');
    expect(etatAppareil(service(['e1']), { ...complet, permission: 'granted', empreinteLocale: 'e9' })).toBe('a_reactiver');
  });

  it('clé publique et empreinte : mêmes conventions que le service', async () => {
    const cle = cleServeur('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
    expect(cle).toHaveLength(65);
    expect(cle[0]).toBe(4);
    expect(Buffer.from(cle).toString('base64url')).toBe('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
    expect(await empreintePointAcces('https://fcm.googleapis.com/fcm/send/abc')).toBe((await import('node:crypto')).createHash('sha256').update('https://fcm.googleapis.com/fcm/send/abc').digest('hex'));
  });
});
