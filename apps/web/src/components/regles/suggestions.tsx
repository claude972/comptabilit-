'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Etiquette, Libelle, type Ton, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { formaterHorodatage } from '@/lib/montants';
import { type CategorieSuggestion, LIBELLE_CATEGORIE_SUGGESTION, type SuggestionAmelioration, libelleDecompte } from '@/lib/regles';

const TON: Record<CategorieSuggestion, Ton> = { correction_donnee: 'neutre', exception_dossier: 'info', preference_cabinet: 'info', nouvelle_regle_metier: 'attention', modification_regle_reglementaire: 'attention' };

/** Écarter une suggestion (`POST v1/regles/suggestions/ecarter`) : un motif est exigé, la décision est conservée. */
function EcarterSuggestion({ empreinte }: { empreinte: string }) {
  const appel = useAppel();
  const id = useId();
  const [ouvert, setOuvert] = useState(false);
  const [motif, setMotif] = useState('');
  if (!ouvert) {
    return (
      <>
        <Bouton variante="contour" onClick={() => setOuvert(true)}>
          Écarter cette suggestion
        </Bouton>
        <Retours erreur={appel.erreur} succes={appel.succes} />
      </>
    );
  }
  return (
    <form
      className="w-full space-y-2"
      noValidate
      data-formulaire="ecarter-suggestion"
      onSubmit={async (e) => {
        e.preventDefault();
        if (motif.trim().length < 5) return appel.setErreur('Un motif de 5 caractères au moins est requis pour écarter une suggestion.');
        await appel.executer('v1/regles/suggestions/ecarter', { method: 'POST', json: { empreinte, motif: motif.trim() } }, 'Suggestion écartée. Elle ne sera reproposée que si de nouvelles décisions la fondent à elles seules.');
      }}
    >
      <Libelle htmlFor={`${id}-motif`}>Motif (obligatoire, conservé)</Libelle>
      <ZoneTexte id={`${id}-motif`} value={motif} maxLength={2000} onChange={(e) => setMotif(e.target.value)} className="min-h-16" />
      <div className="flex flex-wrap gap-2">
        <Bouton type="submit" variante="danger" disabled={appel.occupe}>
          Confirmer
        </Bouton>
        <Bouton variante="contour" onClick={() => setOuvert(false)}>
          Annuler
        </Bouton>
      </div>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

/**
 * Une suggestion d'amélioration : catégorie, constat, critère appliqué, preuves, paramètre concerné, ce qu'elle ne fait
 * pas. Elle n'est jamais une règle : « proposer » ne fait que pré-remplir le formulaire de proposition de cette page.
 */
export function CarteSuggestion({ suggestion: s, peutProposer }: { suggestion: SuggestionAmelioration; peutProposer: boolean }) {
  return (
    <li className="space-y-2 rounded-lg border border-bordure bg-surface p-3" data-suggestion={s.empreinte} data-categorie={s.categorie}>
      <p className="flex flex-wrap items-center gap-2">
        <Etiquette ton={TON[s.categorie]} className="whitespace-normal">
          {LIBELLE_CATEGORIE_SUGGESTION[s.categorie]}
        </Etiquette>
        <Etiquette ton="vide" className="whitespace-normal">
          Suggestion — aucune règle créée
        </Etiquette>
        <span className="min-w-0 font-medium break-words">{s.titre}</span>
      </p>
      {s.dossiers.length ? (
        <p className="text-sm break-words" data-testid="dossiers-suggestion">
          {s.portee === 'cabinet' ? 'Tout le cabinet — observé dans : ' : s.dossiers.length > 1 ? 'Dossiers : ' : 'Dossier : '}
          {s.dossiers.map((d) => d.nom).join(' ; ')}
        </p>
      ) : null}
      <p className="break-words">{s.constat}</p>
      {s.dejaEcartee ? (
        <Alerte ton="neutre" data-testid="deja-ecartee">
          Déjà écartée le {formaterHorodatage(s.dejaEcartee.le)} (« {s.dejaEcartee.motif} ») : elle revient parce que des décisions postérieures atteignent à elles seules les seuils.
        </Alerte>
      ) : null}
      {s.renvoi === 'veille' ? (
        <Alerte ton="attention" data-testid="renvoi-veille">
          Aucune règle de cabinet ne peut être proposée ici. Si le texte applicable a changé, cela se traite dans la{' '}
          <Link href="/veille/sources" prefetch={false}>
            veille réglementaire
          </Link>
          , par une personne, sur une source officielle.
        </Alerte>
      ) : null}
      {s.renvoi === 'editeur' ? (
        <Alerte ton="neutre" data-testid="renvoi-editeur">
          Simple signalement : à instruire par l’éditeur du logiciel. Rien n’est créé ni transmis automatiquement.
        </Alerte>
      ) : null}
      {s.parametre ? (
        <p className="text-sm break-words" data-testid="parametre-suggestion">
          Paramètre concerné : <code>{s.parametre.cle}</code> — valeur indicative <span className="font-mono">{s.parametre.valeurIndicative}</span> (par défaut : <span className="font-mono">{s.parametre.valeurParDefaut}</span>). {s.parametre.explication}
        </p>
      ) : s.proposable ? (
        <p className="text-sm text-texte-doux" data-testid="parametre-suggestion">
          Aucun paramètre du contrôle n’est désigné automatiquement : il revient à la personne qui propose de le choisir.
        </p>
      ) : null}
      <details data-testid="preuves-suggestion">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium">
          Preuves et critère
        </summary>
        <div className="space-y-2 text-sm">
          <p className="break-words">
            <span className="font-medium">Critère appliqué :</span> {s.critere}
          </p>
          <ul className="list-disc pl-5" data-testid="decomptes">
            {Object.entries(s.preuves.decomptes).map(([cle, n]) => (
              <li key={cle}>
                {n} {libelleDecompte(cle)}
              </li>
            ))}
          </ul>
          {s.preuves.periode ? (
            <p>
              Décisions du {formaterHorodatage(s.preuves.periode.du)} au {formaterHorodatage(s.preuves.periode.au)}.
            </p>
          ) : null}
          {s.preuves.decisions.length ? (
            <ul className="space-y-1" aria-label="Décisions sources">
              {s.preuves.decisions.map((d) => (
                <li key={d.decisionId} className="break-words" data-decision={d.decisionId}>
                  {formaterHorodatage(d.date)}
                  {s.controleId ? (
                    <>
                      {' — '}
                      <Link href={`/dossiers/${d.dossierId}/revision/constats/${d.cibleId}`} prefetch={false}>
                        constat
                      </Link>
                    </>
                  ) : null}
                  {d.motif ? ` — motif : ${d.motif}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {s.preuves.decisionsNonListees > 0 ? <p className="text-texte-doux">… et {s.preuves.decisionsNonListees} autre(s) décision(s) comptée(s), non listée(s).</p> : null}
        </div>
      </details>
      <div data-testid="ne-fait-pas">
        <p className="text-sm font-medium">Ce que cette suggestion ne fait pas</p>
        <ul className="list-disc pl-5 text-sm">
          {s.neFaitPas.map((t) => (
            <li key={t} className="break-words">
              {t}
            </li>
          ))}
        </ul>
      </div>
      {s.categorie !== 'correction_donnee' ? (
        <div className="flex flex-wrap items-start gap-2">
          {s.proposable && peutProposer ? (
            <Link href={`/regles?suggestion=${encodeURIComponent(s.empreinte)}#proposer`} prefetch={false} className="inline-flex min-h-11 items-center rounded-lg border border-bordure px-4 font-medium" data-testid="proposer-depuis-suggestion">
              Proposer cette règle (pré-remplir le formulaire)
            </Link>
          ) : null}
          <EcarterSuggestion empreinte={s.empreinte} />
        </div>
      ) : null}
    </li>
  );
}
