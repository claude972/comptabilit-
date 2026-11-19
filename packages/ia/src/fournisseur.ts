/**
 * Port `FournisseurIa` : ce que la passerelle attend d'un fournisseur de modèles.
 * Deux implémentations : `FournisseurOvh` (réel) et `SimulateurIa` (SIMULATEUR de test, `@comtaple/ia/simulateur`).
 * Aucun autre code que la passerelle ne doit appeler un fournisseur directement.
 */

/** Appel de fonction demandé par le modèle. `argumentsJson` est une chaîne JSON NON FIABLE, à valider. */
export interface AppelFonctionBrut {
  id: string;
  nom: string;
  argumentsJson: string;
}

export type MessageIa =
  | { role: 'system' | 'user'; contenu: string }
  | { role: 'assistant'; contenu: string | null; appels?: AppelFonctionBrut[] }
  /** Résultat d'une fonction métier, renvoyé au modèle comme DONNÉE. */
  | { role: 'tool'; idAppel: string; nom: string; contenu: string };

/** Déclaration d'une fonction appelable. `parametres` est un schéma JSON (objet). */
export interface DefinitionOutil {
  nom: string;
  description: string;
  parametres: Record<string, unknown>;
}

export interface DemandeCompletion {
  modele: string;
  messages: MessageIa[];
  temperature: number;
  maxJetonsSortie: number;
  /** Sortie JSON contrainte par schéma (`response_format: json_schema`). */
  schemaSortie?: { nom: string; schema: Record<string, unknown> };
  outils?: DefinitionOutil[];
  /** `required` : le modèle doit appeler au moins une fonction. */
  choixOutil?: 'auto' | 'required' | 'none';
}

/** D'où vient réellement la réponse : sert à établir (ou refuser) le statut `connecte`. */
export interface OrigineReponse {
  url: string;
  /** La réponse portait la marque du simulateur. */
  simulateur: boolean;
}

export interface ReponseCompletion {
  contenu: string | null;
  appels: AppelFonctionBrut[];
  raisonFin: string | null;
  /** `null` quand le fournisseur ne fournit pas le décompte. */
  usage: { jetonsEntree: number | null; jetonsSortie: number | null };
  modeleRenvoye: string | null;
  origine: OrigineReponse;
}

export interface DemandeEmbeddings {
  modele: string;
  textes: string[];
}

export interface ReponseEmbeddings {
  /** Un vecteur par texte, dans l'ordre des textes. */
  vecteurs: number[][];
  usage: { jetonsEntree: number | null };
  modeleRenvoye: string | null;
  origine: OrigineReponse;
}

export interface FournisseurIa {
  /** `simulateur` : ne peut jamais conduire au statut `connecte`. */
  readonly nature: 'reel' | 'simulateur';
  readonly nom: string;
  /** URL de base appelée (sans secret), `null` pour un simulateur en mémoire. */
  readonly urlBase: string | null;
  /** Lève une `ErreurIa` typée en cas d'échec. */
  completer(demande: DemandeCompletion): Promise<ReponseCompletion>;
  vectoriser(demande: DemandeEmbeddings): Promise<ReponseEmbeddings>;
}
