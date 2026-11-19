'use client';

import { type FormEvent, useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, Liste, SousTitre, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';

/** Demande de changement d'offre (`POST v1/abonnement/changement`) : appliquée par l'éditeur à la prochaine échéance. */
export function ChangerOffre({ offres, actuelle, demandee }: { offres: Array<{ code: string; libelle: string }>; actuelle: string; demandee: string | null }) {
  const [offre, setOffre] = useState(demandee ?? actuelle);
  const appel = useAppel();
  const id = useId();
  return (
    <form
      className="space-y-2"
      data-formulaire="changer-offre"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        await appel.executer('v1/abonnement/changement', { method: 'POST', json: { offre } }, offre === actuelle ? 'Demande de changement annulée : l’offre actuelle est conservée.' : 'Demande enregistrée : elle sera appliquée à la prochaine échéance.');
      }}
    >
      <SousTitre className="text-base">Changer d’offre</SousTitre>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64">
          <Libelle htmlFor={id}>Offre souhaitée</Libelle>
          <Liste id={id} value={offre} onChange={(e) => setOffre(e.target.value)}>
            {offres.map((o) => (
              <option key={o.code} value={o.code}>
                {o.libelle}
                {o.code === actuelle ? ' (offre actuelle)' : ''}
              </option>
            ))}
          </Liste>
        </div>
        <Bouton type="submit" variante="secondaire" disabled={appel.occupe || offre === (demandee ?? actuelle)}>
          Demander ce changement
        </Bouton>
      </div>
      <p className="text-sm text-texte-doux">Le changement n’est pas immédiat : il est appliqué à la prochaine échéance.</p>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

/** Résiliation (`POST v1/abonnement/resiliation`) : motif obligatoire et confirmation explicite. */
export function Resilier() {
  const [ouvert, setOuvert] = useState(false);
  const [motif, setMotif] = useState('');
  const [confirme, setConfirme] = useState(false);
  const appel = useAppel();
  const id = useId();
  if (!ouvert) {
    return (
      <div className="space-y-2">
        <Bouton variante="danger" onClick={() => setOuvert(true)}>
          Résilier l’abonnement…
        </Bouton>
        <Retours erreur={null} succes={appel.succes} />
      </div>
    );
  }
  return (
    <form
      className="space-y-3 rounded-lg border-2 border-danger p-3"
      data-formulaire="resilier"
      noValidate
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        if (!motif.trim()) return appel.setErreur('Indiquez le motif de la résiliation.');
        if (!confirme) return appel.setErreur('Cochez la case de confirmation pour résilier.');
        if (await appel.executer('v1/abonnement/resiliation', { method: 'POST', json: { motif: motif.trim() } }, 'Résiliation enregistrée.')) setOuvert(false);
      }}
    >
      <SousTitre className="text-base">Résilier l’abonnement</SousTitre>
      <Alerte ton="attention">
        Le service reste ouvert jusqu’à la fin du mois en cours ; ensuite, les nouveaux dépôts et imports seront suspendus. <strong>Vos données ne sont
        pas supprimées par la résiliation</strong> : la consultation et la restitution restent possibles.
      </Alerte>
      <div>
        <Libelle htmlFor={`${id}-motif`}>Motif (obligatoire)</Libelle>
        <ZoneTexte id={`${id}-motif`} value={motif} maxLength={2000} onChange={(e) => setMotif(e.target.value)} />
      </div>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" className="size-5" checked={confirme} onChange={(e) => setConfirme(e.target.checked)} /> Je confirme vouloir résilier l’abonnement du cabinet
      </label>
      <div className="flex flex-wrap gap-2">
        <Bouton type="submit" variante="danger" disabled={appel.occupe}>
          Confirmer la résiliation
        </Bouton>
        <Bouton variante="contour" onClick={() => setOuvert(false)}>
          Annuler
        </Bouton>
      </div>
      <Retours erreur={appel.erreur} succes={null} />
    </form>
  );
}
