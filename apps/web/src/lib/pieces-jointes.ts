/**
 * Pièces jointes à un conseil, un fait consigné, une lettre de mission ou une écriture d'inventaire (logique pure).
 * Les noms de fichiers sont un contenu non fiable : ils ne sont jamais interprétés, seulement comparés et affichés.
 */
import type { DocumentListe, PieceJointe } from './types-api';
import { estRemplacee } from './versions';

/** Limite de l'API (`pieces: z.array(uuid).max(50)`). */
export const MAX_PIECES_JOINTES = 50;

export type PieceChoisie = Pick<PieceJointe, 'id' | 'nomOrigine' | 'statut' | 'version'>;

const normaliser = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Pièces proposées dans le sélecteur : versions remplacées exclues sauf demande expresse, recherche par nom sans tenir
 * compte de la casse ni des accents. Ne porte que sur la page chargée (l'API ne sait pas chercher par nom).
 */
export function filtrerPieces<T extends Pick<DocumentListe, 'nomOrigine' | 'statut' | 'remplacePar'>>(pieces: readonly T[], p: { recherche: string; inclureRemplacees: boolean }): T[] {
  const terme = normaliser(p.recherche);
  return pieces.filter((d) => (p.inclureRemplacees || !estRemplacee(d)) && (!terme || normaliser(d.nomOrigine).includes(terme)));
}

/** Coche ou décoche une pièce. En choix unique, la nouvelle pièce remplace la précédente ; au-delà du maximum, rien ne change. */
export function basculerPiece(selection: readonly PieceChoisie[], piece: PieceChoisie, multiple: boolean, maximum = MAX_PIECES_JOINTES): PieceChoisie[] {
  if (selection.some((s) => s.id === piece.id)) return selection.filter((s) => s.id !== piece.id);
  if (!multiple) return [piece];
  return selection.length >= maximum ? [...selection] : [...selection, piece];
}

/** Nom affiché d'une pièce jointe ; l'API renvoie des champs nuls quand la pièce n'est plus lisible par l'appelant. */
export function nomPieceJointe(p: Pick<PieceJointe, 'nomOrigine'>): string {
  return p.nomOrigine ?? 'Pièce non consultable';
}

/** Une pièce jointe dont une version plus récente existe doit être signalée : ce qui est joint n'est plus la version courante. */
export function pieceJointeRemplacee(p: Pick<PieceJointe, 'statut'>): boolean {
  return p.statut === 'remplace';
}
