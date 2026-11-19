/*
 * Service worker de Comtaple, écrit à la main.
 *
 * Ce qu'il met en cache : UNIQUEMENT la coquille statique (page hors-ligne, icônes, manifeste, fichiers
 * versionnés /_next/static/). Ce qu'il ne met JAMAIS en cache : les réponses /api/** (API, pièces, exports),
 * les pages de l'application (elles portent des données de dossier et sont servies en « no-store »).
 * Les dépôts en attente ne passent pas par ici : ils sont conservés dans IndexedDB par l'application,
 * et rien n'est envoyé tant que l'application est fermée (aucune synchronisation en arrière-plan).
 */
const VERSION = 'v1';
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
