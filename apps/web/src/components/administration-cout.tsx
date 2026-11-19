'use client';

import { type FormEvent, useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Libelle, Saisie } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { formaterHorodatage, formaterMontant } from '@/lib/montants';
import { type CoutHoraire, coutHoraireSaisi } from '@/lib/rentabilite';

export const PHRASE_SANS_DEFAUT = 'Aucune valeur par défaut : tant qu’il n’est pas saisi, aucune marge n’est calculée.';

/** Saisie ou effacement du coût horaire interne du cabinet (`PUT v1/cabinet/cout-horaire`, gestionnaires). */
export function CoutHoraireInterne({ actuel }: { actuel: CoutHoraire }) {
  const [saisie, setSaisie] = useState('');
  const appel = useAppel();
  const id = useId();
  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    const r = coutHoraireSaisi(saisie);
    if (!r.ok) return appel.setErreur(r.erreur);
    // Le montant reste une chaîne décimale de bout en bout : l'API refuse un nombre.
    if (await appel.executer('v1/cabinet/cout-horaire', { method: 'PUT', json: { coutHoraireInterneHt: r.valeur } }, 'Coût horaire interne enregistré.')) setSaisie('');
  }
  return (
    <form onSubmit={enregistrer} className="space-y-3" data-formulaire="cout-horaire" noValidate>
      <p data-testid="cout-horaire-actuel">
        Coût horaire interne actuel :{' '}
        {actuel.coutHoraireInterneHt !== null ? (
          <strong className="tabular-nums">{formaterMontant(actuel.coutHoraireInterneHt, '€')} HT par heure</strong>
        ) : (
          <strong>non saisi</strong>
        )}
        {actuel.majLe ? <span className="text-sm text-texte-doux"> (mis à jour le {formaterHorodatage(actuel.majLe)})</span> : null}
      </p>
      <p className="text-sm" id={`${id}-aide`}>
        <strong>{PHRASE_SANS_DEFAUT}</strong> Il sert uniquement au calcul de marge des missions, visible des administrateurs et associés.
      </p>
      <div className="max-w-xs">
        <Libelle htmlFor={`${id}-cout`}>Coût horaire interne HT (en euros)</Libelle>
        <Saisie id={`${id}-cout`} value={saisie} onChange={(e) => setSaisie(e.target.value)} inputMode="decimal" maxLength={20} autoComplete="off" aria-describedby={`${id}-aide`} placeholder="ex. 62,50" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Bouton type="submit" disabled={appel.occupe}>
          Enregistrer le coût horaire
        </Bouton>
        {actuel.coutHoraireInterneHt !== null ? (
          <Bouton variante="contour" disabled={appel.occupe} onClick={() => void appel.executer('v1/cabinet/cout-horaire', { method: 'PUT', json: { coutHoraireInterneHt: null } }, 'Coût horaire interne effacé : plus aucune marge n’est calculée.')}>
            Effacer le coût horaire
          </Bouton>
        ) : null}
      </div>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}
