/**
 * Ports : interfaces que l'intégrateur (API, worker) implémente.
 * Le paquet ne connaît ni la base de données, ni Redis, ni le stockage objet.
 */
import type { EtatConnexion, ExtraitQualification, ProvenanceDepot, Rattachement, Signalement } from './types.js';

/**
 * Persistance de l'état des connexions (statut, jetons chiffrés, curseurs, échéance de surveillance).
 * `enregistrer` remplace l'état complet. L'intégrateur doit sérialiser les synchronisations d'une même
 * connexion entre processus (verrou distribué) ; le moteur ne les sérialise que dans un même processus.
 */
export interface MagasinConnexions {
  lire(connexionId: string): Promise<EtatConnexion | null>;
  enregistrer(etat: EtatConnexion): Promise<void>;
}

/**
 * Réception des pièces. L'idempotence repose sur le triplet
 * (connexionId, identifiant fournisseur du message, identifiant de la pièce jointe).
 * `deposer` DOIT enregistrer ce triplet de façon atomique avec le dépôt : après un `deposer` réussi,
 * `pieceDejaVue` doit renvoyer `true`. Si le flux échoue en cours de lecture, rien ne doit être conservé.
 */
export interface RecepteurPieces {
  pieceDejaVue(connexionId: string, idMessage: string, idPieceJointe: string): Promise<boolean>;
  deposer(
    flux: AsyncIterable<Uint8Array>,
    provenance: ProvenanceDepot,
    rattachement: Rattachement,
    /** Contexte minimal et NON FIABLE du message, pour la qualification humaine. */
    extrait: ExtraitQualification,
  ): Promise<void>;
  /** Signalement à traiter par un humain. Peut être rejoué : dédoublonner sur (connexionId, idMessage, type, idPieceJointe). */
  signaler(signalement: Signalement): Promise<void>;
}

/**
 * Mémoire des empreintes de petites images, pour reconnaître un logo répété entre messages.
 * Facultatif : sans ce port, l'heuristique « logo répété » est désactivée.
 */
export interface MemoireEmpreintes {
  /** Enregistre l'occurrence et renvoie le nombre de messages DISTINCTS où cette empreinte a été vue. */
  noterImage(connexionId: string, empreinteSha256: string, idMessage: string): Promise<number>;
}

export type ValeurJournal = string | number | boolean | null;

/** Événement technique. Ne contient jamais de jeton, de corps de message ni d'adresse complète. */
export interface EvenementJournal {
  type: string;
  connexionId?: string;
  donnees?: Record<string, ValeurJournal>;
}

export interface Journal {
  consigner(evenement: EvenementJournal): void;
}

export interface Horloge {
  maintenant(): Date;
  /** Attente (remplaçable par une horloge simulée dans les tests). */
  attendre(ms: number): Promise<void>;
}

export interface InitHttp {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirect?: 'manual';
}

/** Sous-ensemble de `fetch`. En production : `(url, init) => fetch(url, init)`. */
export type Http = (url: string, init?: InitHttp) => Promise<Response>;

export const horlogeSysteme: Horloge = {
  maintenant: () => new Date(),
  attendre: (ms) => new Promise((resoudre) => setTimeout(resoudre, ms)),
};

export const httpNatif: Http = (url, init) => fetch(url, init);
