/** Ports techniques injectables (horloge, HTTP, journal technique). Aucun accès à une base ni à un service. */

export interface Horloge {
  maintenant(): Date;
  /** Attente (remplaçable par une horloge simulée dans les tests). */
  attendre(ms: number): Promise<void>;
}

export interface InitHttp {
  method: string;
  headers: Record<string, string>;
  body?: string;
  redirect: 'manual';
  signal?: AbortSignal;
}

/** Sous-ensemble de `fetch`. En production : `httpNatif`. */
export type Http = (url: string, init: InitHttp) => Promise<Response>;

export const horlogeSysteme: Horloge = {
  maintenant: () => new Date(),
  attendre: (ms) => new Promise((resoudre) => setTimeout(resoudre, ms)),
};

export const httpNatif: Http = (url, init) => fetch(url, init);

/** Événement technique (reprises HTTP). Ne contient jamais de jeton, de prompt ni de réponse. */
export interface EvenementTechnique {
  type: string;
  donnees?: Record<string, string | number | boolean | null>;
}

export interface JournalTechnique {
  consigner(evenement: EvenementTechnique): void;
}
