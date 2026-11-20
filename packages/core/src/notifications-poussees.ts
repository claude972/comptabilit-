/**
 * Notifications poussées DISCRÈTES — partie pure (aucun accès réseau, base ou fichier).
 *
 * Principe : une notification poussée traverse le service de notification du navigateur (Google, Mozilla, Apple,
 * Microsoft) et s'affiche sur un écran qui peut être verrouillé. Elle ne transporte donc RIEN de la notification
 * interne : ni montant, ni nom de dossier ou de client, ni nom de fichier, ni libellé, ni adresse, ni extrait.
 * La charge utile se limite à un type GÉNÉRIQUE pris dans une liste fermée et à un identifiant opaque ; la phrase
 * affichée est choisie par le service worker dans la même liste fermée (`PHRASES_POUSSEES`, recopiée dans
 * `apps/web/public/sw.js` — un test vérifie l'égalité). Le détail ne se lit qu'une fois l'application ouverte et la
 * personne authentifiée.
 */

/** Types génériques transportés. Liste FERMÉE : en ajouter un, c'est décider d'une phrase de plus sur l'écran verrouillé. */
export const TYPES_POUSSES = ['notification', 'plusieurs', 'complement', 'reponse'] as const;
export type TypePousse = (typeof TYPES_POUSSES)[number];

/** Phrase affichée pour chaque type générique. Aucune ne contient de donnée variable. */
export const PHRASES_POUSSEES: Readonly<Record<TypePousse, string>> = {
  notification: 'Vous avez une nouvelle notification dans Comtaple.',
  plusieurs: 'Vous avez de nouvelles notifications dans Comtaple.',
  complement: 'Un complément vous est demandé.',
  reponse: 'Une réponse a été apportée à une demande de complément.',
};
export const TITRE_POUSSEE = 'Comtaple';
/** Seule page ouverte par un clic sur une notification poussée (jamais une adresse venue de la charge utile). */
export const PAGE_POUSSEE = '/notifications';

/** Correspondance FERMÉE entre le type d'une notification interne et le type générique poussé. Tout le reste : « notification ». */
const TYPE_GENERIQUE: Readonly<Record<string, TypePousse>> = {
  'document.complement_demande': 'complement',
  'document.reponse': 'reponse',
  mixte: 'plusieurs',
};

export interface ChargeUtilePoussee {
  /** Version du format. */
  v: 1;
  /** Type générique (liste fermée). */
  t: TypePousse;
  /** Identifiant opaque de l'envoi (UUID aléatoire) : ne désigne ni un dossier, ni une pièce, ni la notification interne. */
  i: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Charge utile d'une notification poussée. FONCTION PURE : elle ne lit de la notification interne que son `type`
 * (comparé à une table fermée — jamais recopié) ; tout autre champ (dossier, cible, données, texte) est ignoré par
 * construction, et l'identifiant doit être un UUID. Le résultat appartient donc à un ensemble fini, à l'identifiant près.
 */
export function chargeUtilePoussee(notification: { type?: unknown } | null | undefined, identifiantOpaque: string): ChargeUtilePoussee {
  if (typeof identifiantOpaque !== 'string' || !UUID.test(identifiantOpaque)) throw new Error('Identifiant opaque invalide : UUID attendu.');
  const type = typeof notification?.type === 'string' && Object.hasOwn(TYPE_GENERIQUE, notification.type) ? TYPE_GENERIQUE[notification.type]! : 'notification';
  return { v: 1, t: type, i: identifiantOpaque };
}

/** Texte exact de la charge utile (ordre des clés fixé). */
export const serialiserChargeUtilePoussee = (c: ChargeUtilePoussee): string => `{"v":1,"t":"${c.t}","i":"${c.i}"}`;

// ───────────────────────────── Points d'accès : liste blanche des services de notification ─────────────────────────────

export interface ServiceNotification {
  id: 'fcm' | 'mozilla' | 'apple' | 'wns';
  libelle: string;
  /** Hôte exact, ou suffixe commençant par un point (« .push.apple.com » accepte « web.push.apple.com »). */
  hote: string;
  /** Page officielle où l'hôte a été lu, et date de lecture. */
  source: string;
}

/**
 * Services de notification des navigateurs acceptés comme destination. Lus sur les documentations officielles le
 * 2026-11-19. Tout autre hôte est refusé : le point d'accès est une adresse fournie par le client, et le serveur y
 * envoie une requête — sans liste blanche, ce serait une requête forgée côté serveur.
 * Non retenus faute de source officielle lue : « android.googleapis.com » (ancien point d'accès GCM, sans VAPID) et les
 * hôtes « *.google.com » parfois observés pour Chrome ; un navigateur qui en fournirait un verrait son abonnement refusé.
 */
export const SERVICES_NOTIFICATION: readonly ServiceNotification[] = [
  { id: 'fcm', libelle: 'Google (Chrome, Edge sur Android, navigateurs Chromium)', hote: 'fcm.googleapis.com', source: 'https://developer.chrome.com/blog/web-push-interop-wins' },
  { id: 'mozilla', libelle: 'Mozilla (Firefox)', hote: 'updates.push.services.mozilla.com', source: 'https://mozilla-services.github.io/autopush-rs/' },
  { id: 'apple', libelle: 'Apple (Safari, applications web de l’écran d’accueil)', hote: '.push.apple.com', source: 'https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/' },
  { id: 'wns', libelle: 'Microsoft (Edge sur Windows)', hote: '.notify.windows.com', source: 'https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/firewall-allowlist-config' },
];

export type RefusPointAcces = 'illisible' | 'trop_long' | 'schema' | 'identifiants' | 'port' | 'adresse_ip' | 'hote_inconnu' | 'chemin';
export type VerificationPointAcces = { ok: true; url: string; origine: string; service: ServiceNotification['id'] | 'simulateur' } | { ok: false; motif: RefusPointAcces };

const LONGUEUR_MAX_POINT_ACCES = 2000;
/** Nom d'hôte DNS ordinaire : étiquettes de lettres, chiffres et tirets, dont la dernière n'est pas numérique. */
const NOM_HOTE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Vérifie un point d'accès fourni par un navigateur. Accepté seulement si : adresse lisible, `https`, sans identifiants,
 * port par défaut, hôte NOMMÉ (jamais une adresse IP, sous aucune écriture) et figurant dans la liste blanche.
 * Les adresses internes ou privées sont donc refusées par construction : aucun hôte de la liste n'en est une, et une
 * adresse IP littérale n'est jamais acceptée.
 *
 * `origineSimulateur` (TESTS, jamais en production — voir packages/plateforme) : seule l'origine exacte du simulateur
 * local est alors acceptée, et AUCUN service réel ne l'est : une pile de test ne peut pas atteindre un vrai service.
 */
export function verifierPointAcces(adresse: unknown, origineSimulateur?: string): VerificationPointAcces {
  if (typeof adresse !== 'string' || adresse === '' || /[\s\\\u0000-\u001f\u007f]/.test(adresse)) return { ok: false, motif: 'illisible' };
  if (adresse.length > LONGUEUR_MAX_POINT_ACCES) return { ok: false, motif: 'trop_long' };
  let u: URL;
  try {
    u = new URL(adresse);
  } catch {
    return { ok: false, motif: 'illisible' };
  }
  if (u.username !== '' || u.password !== '') return { ok: false, motif: 'identifiants' };
  if (u.pathname.length < 2) return { ok: false, motif: 'chemin' };
  if (origineSimulateur !== undefined && origineSimulateur !== '') {
    return u.origin === new URL(origineSimulateur).origin ? { ok: true, url: u.href, origine: u.origin, service: 'simulateur' } : { ok: false, motif: 'hote_inconnu' };
  }
  if (u.protocol !== 'https:') return { ok: false, motif: 'schema' };
  if (u.port !== '') return { ok: false, motif: 'port' };
  const hote = u.hostname;
  // Adresse IP littérale (IPv6 entre crochets ; IPv4 sous toute écriture : l'analyseur d'URL la normalise en quatre nombres).
  if (hote.startsWith('[') || /^\d+(\.\d+){3}$/.test(hote)) return { ok: false, motif: 'adresse_ip' };
  if (!NOM_HOTE.test(hote)) return { ok: false, motif: 'hote_inconnu' };
  const service = SERVICES_NOTIFICATION.find((s) => (s.hote.startsWith('.') ? hote.endsWith(s.hote) && hote.length > s.hote.length : hote === s.hote));
  if (!service) return { ok: false, motif: 'hote_inconnu' };
  return { ok: true, url: u.href, origine: u.origin, service: service.id };
}

// ───────────────────────────── Agent utilisateur réduit ─────────────────────────────

/**
 * Réduit un agent utilisateur à « Navigateur sur Système » (liste fermée), pour que la personne reconnaisse ses appareils
 * sans que la version exacte, le modèle ni aucune autre empreinte ne soient conservés.
 */
export function reduireAgentUtilisateur(agent: unknown): string {
  const ua = typeof agent === 'string' ? agent.slice(0, 600) : '';
  const systeme = /iPhone|iPod/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : null;
  const navigateur = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' : /SamsungBrowser\//.test(ua) ? 'Samsung Internet' : /OPR\//.test(ua) ? 'Opera' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  if (!navigateur && !systeme) return 'Appareil non reconnu';
  return `${navigateur ?? 'Navigateur'} sur ${systeme ?? 'système non reconnu'}`;
}
