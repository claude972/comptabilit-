'use client';

import { useEffect, useId, useState } from 'react';
import { messageErreur } from '@/components/appel';
import { EtiquetteStatutDocument } from '@/components/document/affichage';
import { Alerte, Etiquette, Libelle, Saisie } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { MAX_PIECES_JOINTES, type PieceChoisie, basculerPiece, filtrerPieces, nomPieceJointe, pieceJointeRemplacee } from '@/lib/pieces-jointes';
import { appelBff } from '@/lib/televersement/transport-bff';
import type { ListeDocuments } from '@/lib/types-api';

type Etat = { phase: 'chargement' } | { phase: 'pret'; liste: ListeDocuments } | { phase: 'erreur'; message: string };

/**
 * Sélecteur de pièces du dossier (`GET v1/documents?entiteId=`), paginé comme l'API. Les versions remplacées sont
 * exclues par défaut. La recherche par nom porte sur la page affichée : l'API ne propose pas de recherche par nom.
 * Ne joint rien par lui-même : il ne fait que tenir la sélection que le formulaire parent enverra.
 */
export function SelecteurPieces({
  entiteId, selection, surChangement, multiple = true, libelle = 'Pièces jointes', aide,
}: {
  entiteId: string;
  selection: PieceChoisie[];
  surChangement: (s: PieceChoisie[]) => void;
  multiple?: boolean;
  libelle?: string;
  aide?: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [page, setPage] = useState(1);
  const [etat, setEtat] = useState<Etat>({ phase: 'chargement' });
  const [recherche, setRecherche] = useState('');
  const [inclureRemplacees, setInclureRemplacees] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!ouvert) return;
    const controleur = new AbortController();
    setEtat({ phase: 'chargement' });
    appelBff<ListeDocuments>(`v1/documents?entiteId=${entiteId}&page=${page}`, { signal: controleur.signal })
      .then((liste) => setEtat({ phase: 'pret', liste }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setEtat({ phase: 'erreur', message: messageErreur(e) });
      });
    return () => controleur.abort();
  }, [ouvert, page, entiteId]);

  const visibles = etat.phase === 'pret' ? filtrerPieces(etat.liste.documents, { recherche, inclureRemplacees }) : [];
  const complet = multiple && selection.length >= MAX_PIECES_JOINTES;
  return (
    <fieldset className="space-y-2 rounded-lg border border-bordure p-3" data-testid="selecteur-pieces">
      <legend className="px-1 text-sm font-medium">{libelle}</legend>
      {aide ? <p className="text-sm text-texte-doux">{aide}</p> : null}
      {selection.length ? (
        <ul className="space-y-1" data-testid="pieces-choisies">
          {selection.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium break-all">{nomPieceJointe(p)}</span>
              {p.version !== null && p.version > 1 ? <Etiquette>Version {p.version}</Etiquette> : null}
              {pieceJointeRemplacee(p) ? <Etiquette ton="attention">Version remplacée</Etiquette> : null}
              <Bouton variante="contour" onClick={() => surChangement(selection.filter((s) => s.id !== p.id))} aria-label={`Retirer ${nomPieceJointe(p)}`}>
                Retirer
              </Bouton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-texte-doux">Aucune pièce jointe.</p>
      )}
      {!ouvert ? (
        <Bouton variante="secondaire" onClick={() => setOuvert(true)}>
          {multiple ? 'Choisir des pièces du dossier' : 'Choisir une pièce du dossier'}
        </Bouton>
      ) : (
        <div className="space-y-2 rounded-lg bg-surface-2 p-2">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grow">
              <Libelle htmlFor={`${id}-recherche`}>Rechercher par nom (dans la page affichée)</Libelle>
              <Saisie id={`${id}-recherche`} type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} maxLength={200} autoComplete="off" />
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input autoComplete="off" type="checkbox" className="size-5" checked={inclureRemplacees} onChange={(e) => setInclureRemplacees(e.target.checked)} />
              Inclure les versions remplacées
            </label>
          </div>
          <div aria-live="polite">
            {etat.phase === 'chargement' ? <p role="status">Chargement des pièces du dossier…</p> : null}
            {etat.phase === 'erreur' ? (
              <Alerte ton="danger" role="alert">
                Les pièces du dossier n’ont pas pu être chargées : {etat.message}
              </Alerte>
            ) : null}
            {etat.phase === 'pret' && !visibles.length ? (
              <p className="text-sm text-texte-doux">{etat.liste.documents.length ? 'Aucune pièce de cette page ne correspond.' : 'Aucune pièce dans ce dossier.'}</p>
            ) : null}
          </div>
          {visibles.length ? (
            <ul className="max-h-72 space-y-1 overflow-y-auto" aria-label="Pièces du dossier" data-testid="pieces-disponibles">
              {visibles.map((d) => {
                const coche = selection.some((s) => s.id === d.id);
                return (
                  <li key={d.id}>
                    <label className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 rounded-lg border border-bordure bg-surface px-3 py-1 text-sm">
                      <input autoComplete="off"
                        type={multiple ? 'checkbox' : 'radio'}
                        name={`${id}-piece`}
                        className="size-5"
                        checked={coche}
                        disabled={!coche && complet}
                        onChange={() => surChangement(basculerPiece(selection, { id: d.id, nomOrigine: d.nomOrigine, statut: d.statut, version: d.version }, multiple))}
                      />
                      <span className="font-medium break-all">{d.nomOrigine}</span>
                      {d.version > 1 ? <Etiquette>Version {d.version}</Etiquette> : null}
                      <EtiquetteStatutDocument statut={d.statut} />
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {complet ? <p className="text-sm">Maximum de {MAX_PIECES_JOINTES} pièces jointes atteint.</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            {etat.phase === 'pret' && (page > 1 || etat.liste.suite) ? (
              <>
                <Bouton variante="contour" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  ← Plus récentes
                </Bouton>
                <span className="text-sm">
                  Page {page} ({etat.liste.taillePage} par page)
                </span>
                <Bouton variante="contour" disabled={!etat.liste.suite} onClick={() => setPage(page + 1)}>
                  Plus anciennes →
                </Bouton>
              </>
            ) : null}
            <Bouton variante="contour" onClick={() => setOuvert(false)}>
              Fermer la liste
            </Bouton>
          </div>
        </div>
      )}
    </fieldset>
  );
}
