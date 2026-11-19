import { cache } from 'react';
import type { SituationAbonnement } from '../abonnement';
import type { Dossier, Exercice, Moi, Role } from '../types-api';
import { type Resultat, tenter } from './api';

/** Lectures partagées entre la mise en page et la page d'une même requête (mémoïsation par requête uniquement). */
export const lireMoi = cache((): Promise<Resultat<Moi>> => tenter<Moi>('v1/moi'));
/** Situation de l'abonnement du cabinet (lisible par tout membre). En cas d'échec de lecture, le service est présumé ouvert : l'API tranchera. */
export const lireSituation = cache(async (): Promise<SituationAbonnement | null> => {
  const r = await tenter<SituationAbonnement>('v1/abonnement/situation');
  return r.ok ? r.donnees : null;
});
export const lireDossiers = cache((): Promise<Resultat<Dossier[]>> => tenter<Dossier[]>('v1/dossiers'));
export const lireExercices = cache((entiteId: string): Promise<Resultat<Exercice[]>> => tenter<Exercice[]>(`v1/dossiers/${entiteId}/exercices`));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const estUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** Rôles qui n'ont accès qu'au dépôt et au suivi de leurs propres pièces. */
export function estDeposant(role: Role): boolean {
  return role === 'client_deposant';
}

/** Premier paramètre de requête sous forme de chaîne. */
export function parametre(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
