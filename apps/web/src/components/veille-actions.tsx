'use client';

import { useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Libelle, Liste, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { LIBELLE_SUIVI, type StatutSuivi } from '@/lib/veille';

/** Suivi d'une évolution pour ce dossier (`PUT v1/dossiers/:id/veille/:evolutionId`) : une note de travail, sans effet sur les contrôles. */
export function ConsignerSuivi({ dossierId, evolutionId, reference, actuel }: { dossierId: string; evolutionId: string; reference: string; actuel: { statut: StatutSuivi; note: string | null } | null }) {
  const [statut, setStatut] = useState<StatutSuivi>(actuel?.statut ?? 'a_examiner');
  const [note, setNote] = useState(actuel?.note ?? '');
  const appel = useAppel();
  const id = useId();
  return (
    <form
      className="space-y-2"
      data-formulaire="suivi-evolution"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        await appel.executer(`v1/dossiers/${dossierId}/veille/${evolutionId}`, { method: 'PUT', json: { statut, ...(note.trim() ? { note: note.trim() } : {}) } }, 'Suivi consigné pour ce dossier.');
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[14rem_1fr]">
        <div>
          <Libelle htmlFor={`${id}-statut`}>Suivi de « {reference} »</Libelle>
          <Liste id={`${id}-statut`} value={statut} onChange={(e) => setStatut(e.target.value as StatutSuivi)}>
            {(Object.keys(LIBELLE_SUIVI) as StatutSuivi[]).map((s) => (
              <option key={s} value={s}>
                {LIBELLE_SUIVI[s]}
              </option>
            ))}
          </Liste>
        </div>
        <div>
          <Libelle htmlFor={`${id}-note`}>Note (facultative)</Libelle>
          <ZoneTexte id={`${id}-note`} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} className="min-h-11" />
        </div>
      </div>
      <Bouton type="submit" variante="secondaire" disabled={appel.occupe}>
        Consigner le suivi
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}
