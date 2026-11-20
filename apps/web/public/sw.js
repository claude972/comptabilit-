/*
 * Service worker de Comtaple, écrit à la main.
 *
 * Ce qu'il met en cache : UNIQUEMENT la coquille statique (page hors-ligne, icônes, manifeste, fichiers
 * versionnés /_next/static/). Ce qu'il ne met JAMAIS en cache : les réponses /api/** (API, pièces, exports),
 * les pages de l'application (elles portent des données de dossier et sont servies en « no-store »).
 * Les dépôts en attente ne passent pas par ici : ils sont conservés dans IndexedDB par l'application,
 * et rien n'est envoyé tant que l'application est fermée (aucune synchronisation en arrière-plan).
 *
 * Notifications poussées (si l'éditeur les a activées ET si la personne a abonné cet appareil) : la phrase affichée est
 * choisie ICI, dans une liste fermée ; rien de ce qui arrive dans le message n'est affiché tel quel, et le clic n'ouvre
 * jamais une adresse venue du message. Rien n'est mis en cache par ces gestionnaires.
 */
const VERSION = 'v2';
const CACHE = `comtaple-coquille-${VERSION}`;
const PAGE_HORS_LIGNE = '/hors-ligne';
const FICHIERS = ['/manifest.webmanifest', '/icones/icone-192.png', '/icones/icone-512.png', '/icones/icone-maskable-192.png', '/icones/icone-maskable-512.png'];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const page = await fetch(PAGE_HORS_LIGNE, { credentials: 'omit', cache: 'reload' });
      if (!page.ok) throw new Error('page hors-ligne indisponible');
      const html = await page.clone().text();
      await cache.put(PAGE_HORS_LIGNE, page);
      // Fichiers statiques versionnés dont la page hors-ligne a besoin (feuille de style, scripts).
      const statiques = Array.from(new Set(html.match(/\/_next\/static\/[^"'\\\s<>)]+/g) ?? []));
      await Promise.all([...FICHIERS, ...statiques].map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    (async () => {
      for (const nom of await caches.keys()) if (nom.startsWith('comtaple-') && nom !== CACHE) await caches.delete(nom);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET') return;
  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;
  // Jamais d'interception ni de cache pour l'API, l'authentification, les pièces et les exports.
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/') || FICHIERS.includes(url.pathname)) {
    evenement.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const connu = await cache.match(requete, { ignoreSearch: false });
        if (connu) return connu;
        const reponse = await fetch(requete);
        if (reponse.ok && reponse.type === 'basic') await cache.put(requete, reponse.clone());
        return reponse;
      })(),
    );
    return;
  }

  // Pages : toujours le réseau, sans mise en cache ; hors connexion, la page hors-ligne (sans donnée).
  if (requete.mode === 'navigate') {
    evenement.respondWith(
      fetch(requete).catch(async () => (await caches.match(PAGE_HORS_LIGNE)) ?? new Response('Hors connexion', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })),
    );
  }
});

// ───────────────────────────── Notifications poussées discrètes ─────────────────────────────

/*
 * Liste FERMÉE des phrases affichables (copie de PHRASES_POUSSEES, packages/core/src/notifications-poussees.ts ; un test
 * vérifie l'égalité). Aucune ne contient de montant, de nom de dossier, de client ou de fichier : c'est ce qui peut
 * apparaître sur un écran verrouillé. Le détail se lit dans l'application, après connexion.
 */
const PHRASES_POUSSEES = {
  notification: 'Vous avez une nouvelle notification dans Comtaple.',
  plusieurs: 'Vous avez de nouvelles notifications dans Comtaple.',
  complement: 'Un complément vous est demandé.',
  reponse: 'Une réponse a été apportée à une demande de complément.',
};
const TITRE_POUSSEE = 'Comtaple';
const ETIQUETTE_POUSSEE = 'comtaple-notifications';
/* Seule page ouverte par un clic sur une notification : jamais une adresse venue du message. */
const PAGE_POUSSEE = '/notifications';

/* Type générique du message : pris dans la liste fermée, sinon « notification ». Rien d'autre n'est lu du message. */
function typePousse(evenement) {
  try {
    const d = evenement.data ? evenement.data.json() : null;
    if (d && d.v === 1 && typeof d.t === 'string' && Object.prototype.hasOwnProperty.call(PHRASES_POUSSEES, d.t)) return d.t;
  } catch {
    /* message illisible : phrase par défaut */
  }
  return 'notification';
}

self.addEventListener('push', (evenement) => {
  evenement.waitUntil(
    (async () => {
      let type = typePousse(evenement);
      // Une seule notification Comtaple à l'écran (même étiquette) : si une autre, d'un autre type, y est déjà, la phrase
      // devient « de nouvelles notifications ».
      const presentes = await self.registration.getNotifications({ tag: ETIQUETTE_POUSSEE }).catch(() => []);
      if (presentes.some((n) => n.data && n.data.t !== type)) type = 'plusieurs';
      await self.registration.showNotification(TITRE_POUSSEE, {
        body: PHRASES_POUSSEES[type],
        tag: ETIQUETTE_POUSSEE,
        // Remplacement silencieux : une notification qui en remplace une autre ne sonne ni ne vibre de nouveau.
        renotify: false,
        icon: '/icones/icone-192.png',
        badge: '/icones/icone-192.png',
        lang: 'fr',
        data: { t: type },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (evenement) => {
  evenement.notification.close();
  evenement.waitUntil(
    (async () => {
      const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const fenetre of fenetres) {
        if (new URL(fenetre.url).origin !== self.location.origin) continue;
        await fenetre.focus();
        if (new URL(fenetre.url).pathname !== PAGE_POUSSEE && 'navigate' in fenetre) await fenetre.navigate(PAGE_POUSSEE).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(PAGE_POUSSEE);
    })(),
  );
});
