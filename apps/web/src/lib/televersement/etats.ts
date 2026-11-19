/**
 * États d'un dépôt côté appareil. « recu » n'existe ici que comme conséquence d'une confirmation du serveur ;
 * aucun état local ne peut y mener autrement.
 */
import type { IssueEnvoi } from './moteur';

export type EtatDepot =
  /** Enregistré sur l'appareil, pas encore envoyé. */
  | 'en_file'
  | 'envoi'
  | 'attente_connexion'
  | 'interrompu'
  /** Refus définitif du serveur. */
  | 'refuse'
  | 'recu';

export const LIBELLE_ETAT_DEPOT: Record<EtatDepot, string> = {
  en_file: 'En attente d’envoi',
  envoi: 'Envoi en cours',
  attente_connexion: 'En attente de connexion',
  interrompu: 'Interrompu — reprendre',
  refuse: 'Refusé',
  recu: 'Reçu',
};

export type Evenement =
  | { type: 'demarrer'; enLigne: boolean }
  | { type: 'issue'; issue: IssueEnvoi; enLigne: boolean }
  | { type: 'hors_ligne' }
  | { type: 'retour_reseau' };

/** Transition d'état (fonction pure). */
export function transition(etat: EtatDepot, ev: Evenement): EtatDepot {
  if (etat === 'recu' || etat === 'refuse') return etat; // états terminaux
  switch (ev.type) {
    case 'demarrer':
      return ev.enLigne ? 'envoi' : 'attente_connexion';
    case 'hors_ligne':
      return etat === 'en_file' || etat === 'envoi' ? 'attente_connexion' : etat;
    case 'retour_reseau':
      return etat === 'attente_connexion' ? 'en_file' : etat;
    case 'issue':
      switch (ev.issue.issue) {
        case 'recu':
          // Garde-fou : seul `recu: true` renvoyé par `terminer` ouvre l'état « Reçu ».
          return ev.issue.vue.recu === true ? 'recu' : 'interrompu';
        case 'coupure':
          return ev.enLigne ? 'interrompu' : 'attente_connexion';
        case 'refuse':
          return 'refuse';
        case 'session_expiree':
        case 'interrompu':
        case 'annule':
          return 'interrompu';
      }
  }
}

/** Un dépôt dans cet état doit-il être relancé automatiquement au retour du réseau ou dans l'application ? */
export function repriseAutomatique(etat: EtatDepot): boolean {
  return etat === 'en_file' || etat === 'attente_connexion';
}

/** Délai au-delà duquel un dépôt abandonné sur l'appareil est purgé. */
export const DUREE_CONSERVATION_MS = 7 * 24 * 3600 * 1000;
export function estPerime(creeLe: number, maintenant: number): boolean {
  return maintenant - creeLe > DUREE_CONSERVATION_MS;
}
