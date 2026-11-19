'use client';

import { useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, Liste, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { type CorrespondanceBanque, preparerProposition } from '@/lib/correspondance-banque';

/**
 * Proposition d'une correspondance (`POST v1/exercices/:id/correspondance-banque`). Rien n'est appliqué : la
 * proposition suit le circuit des règles du cabinet (impact, puis approbation par une autre personne).
 */
export function ProposerCorrespondance({ exerciceId, comptes, comptesBancaires }: { exerciceId: string; comptes: CorrespondanceBanque['comptes']; comptesBancaires: CorrespondanceBanque['comptesBancaires'] }) {
  const [choix, setChoix] = useState<Record<string, string>>(() => Object.fromEntries(comptes.map((c) => [c.compteNum, c.etat === 'associe' ? (c.compteBancaireRef ?? '') : ''])));
  const [motif, setMotif] = useState('');
  const [erreurs, setErreurs] = useState<string[]>([]);
  const appel = useAppel();
  const id = useId();
  return (
    <form
      className="space-y-3"
      data-formulaire="correspondance-banque"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const p = preparerProposition(choix, motif);
        setErreurs(p.erreurs);
        if (!p.corps) return;
        if (await appel.executer(`v1/exercices/${exerciceId}/correspondance-banque`, { method: 'POST', json: p.corps }, 'Proposition enregistrée : elle n’a aucun effet tant qu’elle n’est pas approuvée.')) setMotif('');
      }}
    >
      <ul className="space-y-2">
        {comptes.map((c) => (
          <li key={c.compteNum} className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-3">
            <Libelle htmlFor={`${id}-${c.compteNum}`}>
              Compte {c.compteNum}
              {c.compteLib ? ` — ${c.compteLib}` : ''}
            </Libelle>
            <Liste id={`${id}-${c.compteNum}`} value={choix[c.compteNum] ?? ''} onChange={(e) => setChoix({ ...choix, [c.compteNum]: e.target.value })}>
              <option value="">Aucun compte bancaire</option>
              {comptesBancaires.map((b) => (
                <option key={b.ref} value={b.ref}>
                  Compte bancaire {b.libelle}
                </option>
              ))}
            </Liste>
          </li>
        ))}
      </ul>
      <div>
        <Libelle htmlFor={`${id}-motif`}>Motif de cette correspondance</Libelle>
        <ZoneTexte id={`${id}-motif`} value={motif} maxLength={2000} onChange={(e) => setMotif(e.target.value)} className="min-h-16" />
      </div>
      {erreurs.length ? (
        <Alerte ton="danger" role="alert">
          <ul className="list-disc pl-5">
            {erreurs.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Alerte>
      ) : null}
      <Bouton type="submit" variante="secondaire" disabled={appel.occupe}>
        Proposer cette correspondance
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}
