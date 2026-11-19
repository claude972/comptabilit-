'use client';

import { useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { AIDE_MOTIF, type ActionImport, type TypeImport, explicationAnnulation, explicationRetablissement, motifValide } from '@/lib/imports';
import type { StatutLot } from '@/lib/types-api';

/**
 * Annuler (motif, confirmation expliquée), rétablir (motif) ou reprendre un import. Les actions proposées sont celles
 * que `actionsImport` déduit de l'état et de l'habilitation ; l'API vérifie de son côté et ses refus sont affichés.
 */
export function ActionsImport({ lot, actions }: { lot: { id: string; type: TypeImport; actif: boolean; statut: StatutLot }; actions: ActionImport[] }) {
  const [panneau, setPanneau] = useState<'annuler' | 'retablir' | null>(null);
  const [motif, setMotif] = useState('');
  const appel = useAppel();
  const id = useId();
  if (!actions.length && !appel.succes) return null;

  async function confirmer() {
    if (!panneau) return;
    if (!motifValide(motif)) return appel.setErreur(AIDE_MOTIF);
    const ok = await appel.executer(
      `v1/imports/${lot.id}/${panneau === 'annuler' ? 'annulation' : 'retablissement'}`,
      { method: 'POST', json: { motif: motif.trim() } },
      panneau === 'annuler' ? 'Import annulé. Rien n’a été supprimé : il reste rétablissable.' : 'Import rétabli.',
    );
    if (ok) {
      setMotif('');
      setPanneau(null);
    }
  }
  const ouvrir = (p: 'annuler' | 'retablir') => {
    appel.setErreur(null);
    setMotif('');
    setPanneau(p);
  };

  return (
    <div className="space-y-2" data-testid="actions-import">
      {!panneau ? (
        <div className="flex flex-wrap gap-2">
          {actions.includes('reprendre') ? (
            <Bouton variante="secondaire" disabled={appel.occupe} onClick={() => void appel.executer(`v1/imports/${lot.id}/reprise`, { method: 'POST' }, 'Reprise demandée : le même fichier est traité à nouveau, sans rien dupliquer.')}>
              Reprendre
            </Bouton>
          ) : null}
          {actions.includes('retablir') ? (
            <Bouton variante="secondaire" onClick={() => ouvrir('retablir')}>
              Rétablir
            </Bouton>
          ) : null}
          {actions.includes('annuler') ? (
            <Bouton variante="danger" onClick={() => ouvrir('annuler')}>
              Annuler l’import
            </Bouton>
          ) : null}
        </div>
      ) : (
        <div className="min-w-72 space-y-2 rounded-lg border-2 border-attention-texte bg-surface p-3 text-texte" role="group" aria-labelledby={`${id}-titre`} data-panneau={panneau}>
          <p id={`${id}-titre`} className="font-semibold">
            {panneau === 'annuler' ? 'Annuler cet import ?' : 'Rétablir cet import ?'}
          </p>
          <Alerte ton="attention" className="text-sm" data-testid="explication-import">
            {panneau === 'annuler' ? (
              <ul className="list-disc space-y-1 pl-5">
                {explicationAnnulation(lot).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <p>{explicationRetablissement(lot.type)}</p>
            )}
          </Alerte>
          <div>
            <Libelle htmlFor={`${id}-motif`}>{panneau === 'annuler' ? 'Motif de l’annulation (obligatoire)' : 'Motif du rétablissement (obligatoire)'}</Libelle>
            <ZoneTexte id={`${id}-motif`} value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={2000} required className="min-h-16" aria-describedby={`${id}-aide`} />
            <p id={`${id}-aide`} className="text-sm text-texte-doux">
              {AIDE_MOTIF}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Bouton variante={panneau === 'annuler' ? 'danger' : 'primaire'} disabled={appel.occupe} onClick={() => void confirmer()}>
              {panneau === 'annuler' ? 'Confirmer l’annulation' : 'Confirmer le rétablissement'}
            </Bouton>
            <Bouton variante="contour" onClick={() => setPanneau(null)}>
              Renoncer
            </Bouton>
          </div>
        </div>
      )}
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </div>
  );
}
