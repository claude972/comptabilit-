/**
 * Statut d'intégration d'un connecteur.
 * Tant qu'aucune connexion RÉELLE n'a été vérifiée avec de vrais identifiants de client OAuth,
 * le statut est `non_connecte`. Le simulateur ne permet jamais d'obtenir `connecte` :
 * ses hôtes ne sont pas les hôtes officiels et ses réponses portent l'en-tête `X-Simulateur`.
 */
import type { IdFournisseur } from './types.js';

export type StatutIntegration = 'non_connecte' | 'connecte';

/** Statut de ce paquet à sa livraison : aucune connexion réelle n'a été vérifiée. */
export const STATUT_INTEGRATION_INITIAL: Record<IdFournisseur, StatutIntegration> = {
  gmail: 'non_connecte',
  microsoft: 'non_connecte',
};

export const HOTES_OFFICIELS: Record<IdFournisseur, { api: string; jeton: string }> = {
  gmail: { api: 'gmail.googleapis.com', jeton: 'oauth2.googleapis.com' },
  microsoft: { api: 'graph.microsoft.com', jeton: 'login.microsoftonline.com' },
};

export const ENTETE_SIMULATEUR = 'x-simulateur';

/** Trace d'un appel réussi à l'API du fournisseur, produite par `MoteurMail.verifierConnexionReelle`. */
export interface PreuveConnexion {
  fournisseur: IdFournisseur;
  verifieeLe: string;
  /** URL de base de l'API réellement appelée. */
  urlApi: string;
  /** URL du point de jetons configuré. */
  urlJeton: string;
  /** La réponse portait l'en-tête du simulateur. */
  reponseSimulateur: boolean;
}

function hoteHttps(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.port === '' ? u.hostname : null;
  } catch {
    return null;
  }
}

export function evaluerStatutIntegration(
  fournisseur: IdFournisseur,
  preuve: PreuveConnexion | null,
): { statut: StatutIntegration; raisons: string[] } {
  const raisons: string[] = [];
  if (preuve === null) raisons.push('Aucune connexion réelle n’a été vérifiée.');
  else {
    if (preuve.fournisseur !== fournisseur) raisons.push('La preuve concerne un autre fournisseur.');
    if (preuve.reponseSimulateur) raisons.push('La réponse provient du simulateur de test.');
    if (hoteHttps(preuve.urlApi) !== HOTES_OFFICIELS[fournisseur].api) raisons.push('L’API appelée n’est pas l’hôte officiel du fournisseur.');
    if (hoteHttps(preuve.urlJeton) !== HOTES_OFFICIELS[fournisseur].jeton) {
      raisons.push('Le point de jetons n’est pas l’hôte officiel du fournisseur.');
    }
  }
  return { statut: raisons.length === 0 ? 'connecte' : 'non_connecte', raisons };
}
