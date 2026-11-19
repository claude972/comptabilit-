/**
 * Statut de la passerelle IA, quatre valeurs jamais confondues :
 * - `non_connecte` : aucune configuration ;
 * - `configure_non_verifie` : URL et jeton présents, aucun appel réel réussi constaté ;
 * - `connecte` : un appel RÉEL a réussi sur l'hôte officiel, avec les modèles figés (preuve à l'appui) ;
 * - `simule` : le fournisseur est le SIMULATEUR de test. Ne peut jamais devenir `connecte`.
 *
 * `connecte` atteste seulement que le service répond : il ne dit RIEN de la qualité du modèle sur les tâches
 * métier (évaluation sur corpus réel exigée avant de lui confier une tâche, voir docs/passerelle.md).
 */
import type { FournisseurIa } from './fournisseur.js';
import { HOTE_OFFICIEL_OVH, MODELES_IA } from './modeles.js';

export type StatutIa = 'non_connecte' | 'configure_non_verifie' | 'connecte' | 'simule';

/** Preuve d'un appel réussi, produite par `PasserelleIa.verifierConnexion`. À conserver par l'intégrateur. */
export interface PreuveConnexionIa {
  verifieeLe: string;
  /** URL de base du fournisseur au moment de la vérification. */
  urlBase: string;
  /** URL réellement appelées (complétion puis embeddings). */
  urlsAppelees: string[];
  /** Une des réponses portait la marque du simulateur, ou le fournisseur était un simulateur. */
  reponseSimulateur: boolean;
  modeles: { langage: string | null; embeddings: string | null };
  dimensionsEmbeddings: number | null;
}

function hoteHttps(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.port === '' ? u.hostname : null;
  } catch {
    return null;
  }
}

const memeModele = (a: string | null, b: string): boolean => a !== null && a.toLowerCase() === b.toLowerCase();

export function evaluerStatutIa(
  fournisseur: Pick<FournisseurIa, 'nature' | 'urlBase'> | null,
  preuve: PreuveConnexionIa | null,
): { statut: StatutIa; raisons: string[] } {
  if (fournisseur === null) return { statut: 'non_connecte', raisons: ['Aucun fournisseur IA n’est configuré (URL ou jeton absent).'] };
  if (fournisseur.nature === 'simulateur') {
    return { statut: 'simule', raisons: ['Le fournisseur est le SIMULATEUR de test : aucune IA réelle n’est appelée.'] };
  }
  const raisons: string[] = [];
  if (preuve === null) raisons.push('Aucun appel réel réussi n’a été constaté.');
  else {
    if (preuve.reponseSimulateur) raisons.push('La réponse provient du simulateur de test.');
    if (preuve.urlBase !== fournisseur.urlBase) raisons.push('La preuve concerne une autre URL de base que celle configurée.');
    if (hoteHttps(preuve.urlBase) !== HOTE_OFFICIEL_OVH || preuve.urlsAppelees.length === 0 || preuve.urlsAppelees.some((u) => hoteHttps(u) !== HOTE_OFFICIEL_OVH)) {
      raisons.push('L’hôte appelé n’est pas l’hôte officiel du fournisseur.');
    }
    if (!memeModele(preuve.modeles.langage, MODELES_IA.langage.id)) raisons.push('Le modèle de langage renvoyé n’est pas le modèle figé.');
    if (!memeModele(preuve.modeles.embeddings, MODELES_IA.embeddings.id)) raisons.push('Le modèle d’embeddings renvoyé n’est pas le modèle figé.');
    if (preuve.dimensionsEmbeddings !== MODELES_IA.embeddings.dimensions) raisons.push('La dimension des vecteurs n’est pas celle attendue.');
  }
  return { statut: raisons.length === 0 ? 'connecte' : 'configure_non_verifie', raisons };
}
