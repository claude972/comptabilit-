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
  /**
   * Marque laissée par le service worker quand le navigateur a renouvelé (ou perdu) l'abonnement sans que le service ait
   * pu l'enregistrer : empreinte de l'ANCIEN point d'accès (ou null si le navigateur ne l'a pas donnée). Absente : null.
   */
  renouvellement?: MarqueRenouvellement | null;
  /**
   * L'abonnement que détient le navigateur a été créé avec une AUTRE clé publique que celle du service (rotation des clés
   * VAPID) : il ne recevra plus rien. Faux si le navigateur ne dit pas avec quelle clé l'abonnement a été créé.
   */
  cleServiceDifferente?: boolean;
}

export interface MarqueRenouvellement {
  ancienneEmpreinte: string | null;
  le: string;
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
  if (n.empreinteLocale && n.permission === 'granted') return !n.cleServiceDifferente && service.appareils.some((a) => a.empreinte === n.empreinteLocale) ? 'abonne' : 'a_reactiver';
  // Abonnement perdu ou renouvelé sans que le service l'ait su (marque du service worker) : à réactiver, sur un geste.
  if (n.renouvellement && n.permission === 'granted') return 'a_reactiver';
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

/** Vrai si l'abonnement a été créé avec une autre clé que `clePublique` ; faux si le navigateur ne donne pas la clé d'origine. */
export function creeAvecUneAutreCle(cleAbonnement: ArrayBuffer | null | undefined, clePublique: string | null): boolean {
  if (!cleAbonnement || !clePublique) return false;
  const a = new Uint8Array(cleAbonnement);
  const b = cleServeur(clePublique);
  return a.length !== b.length || a.some((octet, i) => octet !== b[i]);
}

/** Empreinte SHA-256 hexadécimale d'un point d'accès (même calcul que le service). */
export async function empreintePointAcces(endpoint: string): Promise<string> {
  const condense = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(condense), (o) => o.toString(16).padStart(2, '0')).join('');
}

// ───────────── Marque de renouvellement (écrite par le service worker, public/sw.js) ─────────────

const BASE_POUSSEES = 'comtaple-poussees';
const MAGASIN_POUSSEES = 'etat';
const CLE_RENOUVELLEMENT = 'renouvellement';

function avecMagasin<T>(mode: IDBTransactionMode, action: (magasin: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((fin) => {
    // Bornée dans le temps : un navigateur qui ne répond pas ne doit pas figer l'écran.
    const delai = setTimeout(() => fin(null), 2000);
    const rendre = (v: T | null) => (clearTimeout(delai), fin(v));
    try {
      const ouverture = indexedDB.open(BASE_POUSSEES, 1);
      ouverture.onupgradeneeded = () => ouverture.result.createObjectStore(MAGASIN_POUSSEES);
      ouverture.onerror = () => rendre(null);
      ouverture.onsuccess = () => {
        const base = ouverture.result;
        try {
          const transaction = base.transaction(MAGASIN_POUSSEES, mode);
          const requete = action(transaction.objectStore(MAGASIN_POUSSEES));
          transaction.oncomplete = () => (base.close(), rendre(requete.result ?? null));
          transaction.onerror = transaction.onabort = () => (base.close(), rendre(null));
        } catch {
          base.close();
          rendre(null);
        }
      };
    } catch {
      rendre(null);
    }
  });
}

/** Lit la marque de renouvellement ; null s'il n'y en a pas, si elle est mal formée ou si le navigateur ne répond pas. */
export async function lireMarqueRenouvellement(): Promise<MarqueRenouvellement | null> {
  if (typeof indexedDB === 'undefined') return null;
  const v = (await avecMagasin<unknown>('readonly', (m) => m.get(CLE_RENOUVELLEMENT))) as Partial<MarqueRenouvellement> | null;
  if (!v || typeof v !== 'object' || typeof v.le !== 'string') return null;
  return { ancienneEmpreinte: typeof v.ancienneEmpreinte === 'string' && /^[0-9a-f]{64}$/.test(v.ancienneEmpreinte) ? v.ancienneEmpreinte : null, le: v.le };
}

export async function effacerMarqueRenouvellement(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await avecMagasin('readwrite', (m) => m.delete(CLE_RENOUVELLEMENT));
}
