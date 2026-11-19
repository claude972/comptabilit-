import { describe, expect, it } from 'vitest';
import { MAX_PIECES_JOINTES, type PieceChoisie, basculerPiece, filtrerPieces, nomPieceJointe, pieceJointeRemplacee } from '@/lib/pieces-jointes';

const pieces = [
  { id: 'a', nomOrigine: 'Facture Été 2025.pdf', statut: 'a_controler' as const, remplacePar: null },
  { id: 'b', nomOrigine: 'facture-ete-2025-v1.pdf', statut: 'remplace' as const, remplacePar: 'a' },
  { id: 'c', nomOrigine: '<script>alert(1)</script>.pdf', statut: 'traite' as const, remplacePar: null },
];
const choisie = (id: string): PieceChoisie => ({ id, nomOrigine: `${id}.pdf`, statut: 'traite', version: 1 });

describe('sélecteur de pièces jointes', () => {
  it('exclut les versions remplacées par défaut et les inclut sur demande', () => {
    expect(filtrerPieces(pieces, { recherche: '', inclureRemplacees: false }).map((p) => p.id)).toEqual(['a', 'c']);
    expect(filtrerPieces(pieces, { recherche: '', inclureRemplacees: true }).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
  it('cherche par nom sans tenir compte de la casse ni des accents, sans interpréter le nom', () => {
    expect(filtrerPieces(pieces, { recherche: ' ETE ', inclureRemplacees: true }).map((p) => p.id)).toEqual(['a', 'b']);
    expect(filtrerPieces(pieces, { recherche: 'été', inclureRemplacees: false }).map((p) => p.id)).toEqual(['a']);
    expect(filtrerPieces(pieces, { recherche: '<script>', inclureRemplacees: false }).map((p) => p.id)).toEqual(['c']);
    expect(filtrerPieces(pieces, { recherche: 'absent', inclureRemplacees: true })).toEqual([]);
  });
  it('coche et décoche ; en choix unique la nouvelle pièce remplace la précédente', () => {
    expect(basculerPiece([], choisie('a'), true).map((p) => p.id)).toEqual(['a']);
    expect(basculerPiece([choisie('a')], choisie('b'), true).map((p) => p.id)).toEqual(['a', 'b']);
    expect(basculerPiece([choisie('a'), choisie('b')], choisie('a'), true).map((p) => p.id)).toEqual(['b']);
    expect(basculerPiece([choisie('a')], choisie('b'), false).map((p) => p.id)).toEqual(['b']);
    expect(basculerPiece([choisie('a')], choisie('a'), false)).toEqual([]);
  });
  it('ne dépasse pas le maximum accepté par l’API', () => {
    const pleine = Array.from({ length: MAX_PIECES_JOINTES }, (_, i) => choisie(`p${i}`));
    expect(basculerPiece(pleine, choisie('de-trop'), true)).toHaveLength(MAX_PIECES_JOINTES);
    expect(basculerPiece(pleine, choisie('p0'), true)).toHaveLength(MAX_PIECES_JOINTES - 1);
  });
});

describe('pièce jointe en lecture', () => {
  it('nomme la pièce, ou dit qu’elle n’est pas consultable', () => {
    expect(nomPieceJointe({ nomOrigine: 'lettre-signee.pdf' })).toBe('lettre-signee.pdf');
    expect(nomPieceJointe({ nomOrigine: null })).toBe('Pièce non consultable');
  });
  it('signale une pièce jointe devenue « remplacée »', () => {
    expect(pieceJointeRemplacee({ statut: 'remplace' })).toBe(true);
    expect(pieceJointeRemplacee({ statut: 'traite' })).toBe(false);
    expect(pieceJointeRemplacee({ statut: null })).toBe(false);
  });
});
