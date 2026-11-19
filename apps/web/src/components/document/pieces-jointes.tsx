import Link from 'next/link';
import { EtiquetteStatutDocument } from '@/components/document/affichage';
import { Etiquette } from '@/components/ui/base';
import { nomPieceJointe, pieceJointeRemplacee } from '@/lib/pieces-jointes';
import type { PieceJointe } from '@/lib/types-api';

/** Une pièce jointe en lecture : nom (texte brut), version, statut, lien vers la pièce ; « remplacée » est signalé. */
export function PieceJointeAffichee({ piece, dossierId }: { piece: PieceJointe; dossierId: string }) {
  const remplacee = pieceJointeRemplacee(piece);
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-piece-jointe={piece.id} data-remplacee={remplacee ? 'oui' : undefined}>
      {piece.nomOrigine !== null ? (
        <Link href={`/dossiers/${dossierId}/pieces/${piece.id}`} prefetch={false} className="break-all">
          {piece.nomOrigine}
        </Link>
      ) : (
        <span className="text-texte-doux">{nomPieceJointe(piece)}</span>
      )}
      {piece.version !== null ? <span className="text-sm text-texte-doux">version {piece.version}</span> : null}
      {piece.statut ? <EtiquetteStatutDocument statut={piece.statut} /> : null}
      {remplacee ? (
        <Etiquette ton="attention" className="whitespace-normal">
          Une version plus récente de cette pièce existe
        </Etiquette>
      ) : null}
    </span>
  );
}

/** Liste des pièces jointes d'un élément (conseil, écriture d'inventaire). Rien n'est affiché s'il n'y en a aucune. */
export function PiecesJointes({ pieces, dossierId, titre = 'Pièces jointes' }: { pieces: PieceJointe[] | undefined; dossierId: string; titre?: string }) {
  if (!pieces?.length) return null;
  return (
    <div className="text-sm" data-testid="pieces-jointes">
      <p className="font-medium">
        {titre} ({pieces.length})
      </p>
      <ul className="space-y-1">
        {pieces.map((p) => (
          <li key={p.id}>
            <PieceJointeAffichee piece={p} dossierId={dossierId} />
          </li>
        ))}
      </ul>
    </div>
  );
}
