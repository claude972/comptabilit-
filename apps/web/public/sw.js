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
 *
 * Renouvellement d'un abonnement par le navigateur (« pushsubscriptionchange ») : voir en fin de fichier. Cet événement
 * est peu fiable selon les navigateurs ; rien ne repose sur lui seul.
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

// ───────────────────────────── Renouvellement de l'abonnement par le navigateur ─────────────────────────────

/*
 * « pushsubscriptionchange » : le navigateur signale que l'abonnement a changé hors du contrôle de l'application
 * (renouvelé, révoqué ou perdu). D'après la spécification Push API, le navigateur PEUT renouveler de lui-même et fournir
 * le nouvel abonnement ; « newSubscription » et « oldSubscription » peuvent aussi être absents. D'après MDN, l'événement
 * n'a qu'une « disponibilité limitée » : certains navigateurs ne l'émettent pas. Ce gestionnaire fait donc au mieux, et
 * RIEN ne repose sur lui seul : sans lui, l'ancien abonnement est retiré par le service au premier refus du service de
 * notification, et l'écran des notifications propose « Réactiver ».
 *
 * Déroulement : une MARQUE locale (empreinte de l'ancien point d'accès et date — jamais l'adresse ni les clés) est écrite
 * d'abord ; puis réabonnement avec la clé publique du service si le navigateur ne l'a pas fait ; puis remplacement côté
 * service par une route authentifiée par la session. La marque n'est effacée que si le service a confirmé. Session
 * fermée, hors connexion ou réabonnement impossible : la marque reste, et l'écran propose « Réactiver » au prochain passage.
 */
const BASE_POUSSEES = 'comtaple-poussees';
const MAGASIN_POUSSEES = 'etat';
const CLE_RENOUVELLEMENT = 'renouvellement';
const ROUTE_POUSSEES = '/api/bff/v1/notifications/poussees';

/* Écrit (ou efface, avec null) la marque de renouvellement dans IndexedDB. Un échec n'interrompt rien. */
function noterRenouvellement(marque) {
  return new Promise((fin) => {
    try {
      const ouverture = indexedDB.open(BASE_POUSSEES, 1);
      ouverture.onupgradeneeded = () => ouverture.result.createObjectStore(MAGASIN_POUSSEES);
      ouverture.onerror = () => fin(false);
      ouverture.onsuccess = () => {
        const base = ouverture.result;
        try {
          const transaction = base.transaction(MAGASIN_POUSSEES, 'readwrite');
          if (marque) transaction.objectStore(MAGASIN_POUSSEES).put(marque, CLE_RENOUVELLEMENT);
          else transaction.objectStore(MAGASIN_POUSSEES).delete(CLE_RENOUVELLEMENT);
          transaction.oncomplete = () => (base.close(), fin(true));
          transaction.onerror = transaction.onabort = () => (base.close(), fin(false));
        } catch {
          base.close();
          fin(false);
        }
      };
    } catch {
      fin(false);
    }
  });
}

/* Empreinte SHA-256 hexadécimale d'un point d'accès (même calcul que le service et que l'écran). */
async function empreintePointAcces(pointAcces) {
  const condense = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pointAcces));
  return Array.from(new Uint8Array(condense), (o) => o.toString(16).padStart(2, '0')).join('');
}

/* Clé publique du service : celle de l'ancien abonnement si le navigateur la donne, sinon celle que rend le service (session requise). */
async function cleServicePoussees(ancien) {
  if (ancien && ancien.options && ancien.options.applicationServerKey) return ancien.options.applicationServerKey;
  const reponse = await fetch(ROUTE_POUSSEES, { credentials: 'same-origin', cache: 'no-store' });
  if (!reponse.ok) return null;
  const etat = await reponse.json();
  if (!etat || !etat.activees || typeof etat.clePublique !== 'string') return null;
  const binaire = atob(etat.clePublique.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(etat.clePublique.length / 4) * 4, '='));
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}

self.addEventListener('pushsubscriptionchange', (evenement) => {
  evenement.waitUntil(
    (async () => {
      const ancien = evenement.oldSubscription || null;
      let ancienneEmpreinte = null;
      try {
        if (ancien && typeof ancien.endpoint === 'string') ancienneEmpreinte = await empreintePointAcces(ancien.endpoint);
      } catch {
        /* empreinte incalculable : la marque le dira par « null » */
      }
      // La marque d'abord : si la suite échoue ou si le navigateur arrête ce service worker, l'écran saura quoi proposer.
      await noterRenouvellement({ ancienneEmpreinte, le: new Date().toISOString() });
      let nouveau = evenement.newSubscription || null;
      try {
        if (!nouveau) nouveau = await self.registration.pushManager.getSubscription();
        if (!nouveau) {
          const cle = await cleServicePoussees(ancien);
          // « userVisibleOnly » : comme à l'activation, chaque message reçu affiche une notification.
          if (cle) nouveau = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cle });
        }
      } catch {
        nouveau = null;
      }
      // Réabonnement impossible (autorisation retirée, clé inconnue, session fermée) : la marque reste.
      if (!nouveau || typeof nouveau.endpoint !== 'string') return;
      if (ancien && nouveau.endpoint === ancien.endpoint) {
        // Rien n'a changé en réalité : le service connaît déjà cet abonnement.
        await noterRenouvellement(null);
        return;
      }
      try {
        const json = nouveau.toJSON();
        const reponse = await fetch(`${ROUTE_POUSSEES}/abonnements/remplacement`, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', 'X-Comtaple-Csrf': '1' },
          // L'ancienne adresse n'est jamais transmise : seulement son empreinte.
          body: JSON.stringify({ ancienneEmpreinte, endpoint: nouveau.endpoint, keys: { p256dh: json.keys && json.keys.p256dh, auth: json.keys && json.keys.auth }, agentUtilisateur: self.navigator ? self.navigator.userAgent : undefined }),
        });
        // Confirmé par le service : la marque n'a plus lieu d'être. Tout autre cas (401, 503, refus) : elle reste.
        if (reponse.ok) await noterRenouvellement(null);
      } catch {
        /* hors connexion : la marque reste, l'écran proposera « Réactiver » */
      }
    })(),
  );
});
