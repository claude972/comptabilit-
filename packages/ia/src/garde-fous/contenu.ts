/**
 * Contenus NON FIABLES (pièces, messages, pages, libellés) : toujours transmis au modèle comme DONNÉES délimitées,
 * jamais comme instructions. La délimitation ne suffit pas à elle seule : la protection repose sur les
 * vérifications déterministes faites APRÈS la réponse (liste blanche de fonctions, périmètre imposé, citations,
 * chiffres). Elle réduit seulement le risque que le modèle confonde données et consignes.
 */

export const OUVERTURE_DONNEES = '<<<DONNEES';
export const FERMETURE_DONNEES = '<<<FIN_DONNEES';

export interface OptionsDelimitation {
  /** Minimisation : au-delà, le contenu est tronqué et la troncature est signalée. */
  tailleMax?: number;
}

/** Tronque (minimisation) en signalant explicitement la coupure. */
export function tronquer(contenu: string, tailleMax: number): { texte: string; tronque: boolean } {
  if (contenu.length <= tailleMax) return { texte: contenu, tronque: false };
  return { texte: contenu.slice(0, tailleMax), tronque: true };
}

/**
 * Encadre un contenu non fiable. Toute séquence « <<< » ou « >>> » du contenu est neutralisée pour qu'il ne puisse
 * ni fermer son bloc ni en ouvrir un autre.
 */
export function delimiterDonnees(etiquette: string, contenu: string, options: OptionsDelimitation = {}): string {
  const nom = etiquette.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);
  const { texte, tronque } = tronquer(contenu, options.tailleMax ?? 20_000);
  const neutralise = texte.replace(/<<</g, '‹‹‹').replace(/>>>/g, '›››');
  return `${OUVERTURE_DONNEES} ${nom}>>>\n${neutralise}\n${FERMETURE_DONNEES} ${nom}>>>${tronque ? '\n(contenu tronqué)' : ''}`;
}

const MOTIF_URL = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/giu;

/** URL présentes dans un texte (une réponse ne peut contenir que des URL de sources fournies). */
export function extraireUrls(texte: string): string[] {
  return [...texte.matchAll(MOTIF_URL)].map((m) => m[0].replace(/[.,;:!?]+$/, ''));
}
