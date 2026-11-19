/**
 * Modèles FIGÉS de la passerelle IA. Aucun alias : un identifiant désigne un modèle précis et ne peut pas
 * changer de modèle en production. Aucun appelant ne choisit le modèle : la passerelle l'impose.
 *
 * Identifiants vérifiés le 2026-11-19 sur la liste publique `GET {URL_BASE_OVH}/models` d'OVHcloud AI Endpoints
 * (voir docs/passerelle.md). Aucun appel de génération n'a été fait : aucun jeton n'existe.
 */
export const MODELES_IA = {
  langage: { id: 'Mistral-Small-3.2-24B-Instruct-2506', temperature: 0, maxJetonsSortie: 2048 },
  embeddings: { id: 'bge-m3', dimensions: 1024 },
} as const;

/** Hôte officiel d'OVHcloud AI Endpoints (API compatible OpenAI). Seul hôte permettant le statut `connecte`. */
export const HOTE_OFFICIEL_OVH = 'oai.endpoints.kepler.ai.cloud.ovh.net';
export const URL_BASE_OVH = `https://${HOTE_OFFICIEL_OVH}/v1`;

/** En-tête porté par toute réponse HTTP du simulateur. */
export const ENTETE_SIMULATEUR = 'x-simulateur';
export const NOM_SIMULATEUR = 'comtaple-ia';
