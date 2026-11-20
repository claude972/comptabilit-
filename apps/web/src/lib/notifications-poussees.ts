/**
 * Notifications poussées — logique de l'écran « Sur cet appareil », sans dépendance au navigateur (testable).
 * L'état affiché se déduit de ce que le service annonce et de ce que le navigateur sait faire ; aucun cas n'est muet.
 */

export interface EtatServicePoussees {
  statut: 'non_configure' | 'simule' | 'configure_non_verifie';
  detail: string;
  activees: boolean;
  clePublique: string | null;
  verifieSurAppareilReel: boolean;
  preference: { active: boolean };
  /** Liste fermée des phrases qu'une notification poussée peut afficher. */
  phrases: string[];
  services: string[];
  appareils: AppareilAbonne[];
}

export interface AppareilAbonne {
  id: string;
  service: string;
  libelleService: string;
  agent: string;
  creeLe: string;
  dernierEnvoiAccepteLe: string | null;
  /** SHA-256 (hexadécimal) du point d'accès : permet au navigateur de reconnaître son propre abonnement. */
  empreinte: string;
}

/** Ce que le navigateur sait faire et ce qu'il a déjà décidé, relevé à l'affichage (jamais de demande d'autorisation ici). */
export interface CapacitesNavigateur {
  serviceWorker: boolean;
  /** Un service worker est enregistré pour cette application (ce n'est pas le cas en mode développement). */
  serviceWorkerEnregistre: boolean;
  pushManager: boolean;
  notification: boolean;
  permission: 'default' | 'granted' | 'denied';
  ios: boolean;
  /** Application ouverte depuis l'écran d'accueil (affichage autonome). */
  autonome: boolean;
  /** Empreinte du point d'accès de l'abonnement que ce navigateur détient déjà, s'il en a un. */
  empreinteLocale: string | null;
}

export type EtatAppareil =
  /** L'éditeur n'a pas activé la fonction : rien à proposer. */
  | 'non_activees'
  /** iPhone ou iPad, hors application de l'écran d'accueil : la fonction n'y existe pas. */
  | 'ios_a_installer'
  /** Le navigateur ne connaît pas les notifications poussées. */
  | 'non_pris_en_charge'
  /** Navigateur compatible, mais aucun service worker n'est actif (mode développement, navigation privée…). */
  | 'service_worker_absent'
  /** La personne a refusé les notifications pour ce site : l'application ne peut pas redemander. */
  | 'refusees'
  /** Tout est prêt : explication, puis demande sur un geste explicite. */
  | 'a_activer'
  /** Cet appareil est abonné, et le service le connaît. */
  | 'abonne'
  /** Le navigateur détient un abonnement que le service ne connaît pas (ou plus) pour ce compte : à réactiver. */
  | 'a_reactiver';

export function etatAppareil(service: Pick<EtatServicePoussees, 'activees' | 'appareils'>, n: CapacitesNavigateur): EtatAppareil {
  if (!service.activees) return 'non_activees';
  if (!n.serviceWorker || !n.pushManager || !n.notification) return n.ios && !n.autonome ? 'ios_a_installer' : 'non_pris_en_charge';
  if (!n.serviceWorkerEnregistre) return 'service_worker_absent';
  if (n.permission === 'denied') return 'refusees';
  if (n.empreinteLocale && n.permission === 'granted') return service.appareils.some((a) => a.empreinte === n.empreinteLocale) ? 'abonne' : 'a_reactiver';
  return 'a_activer';
}

/** Clé publique VAPID (base64url) → octets attendus par `pushManager.subscribe`. */
export function cleServeur(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const binaire = atob(b64);
  const octets = new Uint8Array(new ArrayBuffer(binaire.length));
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}

/** Empreinte SHA-256 hexadécimale d'un point d'accès (même calcul que le service). */
export async function empreintePointAcces(endpoint: string): Promise<string> {
  const condense = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(condense), (o) => o.toString(16).padStart(2, '0')).join('');
}
