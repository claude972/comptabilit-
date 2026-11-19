/**
 * Garde d'hôtes et reprise sur erreur passagère.
 * - Le paquet n'émet de requêtes QUE vers les hôtes du fournisseur configuré (jamais vers un lien trouvé dans un message).
 * - 429 / 5xx / erreur réseau : reprise bornée, attente exponentielle avec gigue, `Retry-After` respecté.
 */
import { ErreurHoteInterdit, ErreurTemporaire } from './erreurs.js';
import type { Horloge, Http, InitHttp, Journal } from './ports.js';

/** Enveloppe `http` : refuse tout hôte hors liste et ne suit aucune redirection. */
export function creerHttpGarde(http: Http, urlsAutorisees: string[]): Http {
  const hotes = new Set(urlsAutorisees.map((u) => new URL(u).host));
  return async (url, init) => {
    let hote: string;
    try {
      hote = new URL(url).host;
    } catch {
      throw new ErreurHoteInterdit();
    }
    if (!hotes.has(hote)) throw new ErreurHoteInterdit();
    return http(url, { ...init, redirect: 'manual' });
  };
}

export interface OptionsReprise {
  tentativesMax: number;
  baseMs: number;
  plafondMs: number;
  /** Au-delà de ce `Retry-After`, on n'attend pas : la synchronisation est interrompue et reprendra plus tard. */
  attenteMaxMs: number;
}

export const REPRISE_PAR_DEFAUT: OptionsReprise = {
  tentativesMax: 6,
  baseMs: 1000,
  plafondMs: 64_000,
  attenteMaxMs: 15 * 60 * 1000,
};

export interface DependancesReprise {
  http: Http;
  horloge: Horloge;
  journal: Journal;
  /** Nombre dans [0, 1[ pour la gigue. */
  hasard: () => number;
  options?: Partial<OptionsReprise>;
  connexionId?: string;
}

/** Lit `Retry-After` (secondes ou date HTTP) en millisecondes. */
export function lireRetryAfter(reponse: Response, maintenant: Date): number | null {
  const valeur = reponse.headers.get('retry-after');
  if (valeur === null) return null;
  if (/^\d+$/.test(valeur.trim())) return Number(valeur.trim()) * 1000;
  const date = Date.parse(valeur);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - maintenant.getTime());
}

const RAISONS_QUOTA_GMAIL = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

async function estReessayable(reponse: Response): Promise<boolean> {
  if (reponse.status === 429 || (reponse.status >= 500 && reponse.status <= 504)) return true;
  if (reponse.status !== 403) return false;
  // Gmail signale certains dépassements de quota par un 403 avec une raison dédiée.
  try {
    const corps = (await reponse.clone().json()) as { error?: { errors?: { reason?: unknown }[] } };
    return (corps.error?.errors ?? []).some((e) => typeof e.reason === 'string' && RAISONS_QUOTA_GMAIL.has(e.reason));
  } catch {
    return false;
  }
}

/** Exécute une requête avec reprise. Lève `ErreurTemporaire` quand les reprises sont épuisées. */
export async function requeteAvecReprise(deps: DependancesReprise, url: string, init?: InitHttp): Promise<Response> {
  const options = { ...REPRISE_PAR_DEFAUT, ...deps.options };
  for (let tentative = 0; ; tentative++) {
    let reponse: Response | null = null;
    try {
      reponse = await deps.http(url, init);
    } catch (erreur) {
      if (erreur instanceof ErreurHoteInterdit) throw erreur;
    }
    if (reponse !== null && !(await estReessayable(reponse))) return reponse;
    const statut = reponse?.status ?? null;
    const retryAfter = reponse ? lireRetryAfter(reponse, deps.horloge.maintenant()) : null;
    // Libère la connexion avant d'attendre.
    await reponse?.body?.cancel().catch(() => undefined);
    if (tentative + 1 >= options.tentativesMax || (retryAfter !== null && retryAfter > options.attenteMaxMs)) {
      throw new ErreurTemporaire(statut, retryAfter);
    }
    const exponentielle = Math.min(options.plafondMs, options.baseMs * 2 ** tentative + Math.floor(deps.hasard() * 1000));
    const attente = retryAfter ?? exponentielle;
    deps.journal.consigner({
      type: 'http.reprise',
      ...(deps.connexionId !== undefined ? { connexionId: deps.connexionId } : {}),
      donnees: { statut, tentative: tentative + 1, attenteMs: attente, retryAfter: retryAfter !== null },
    });
    await deps.horloge.attendre(attente);
  }
}
