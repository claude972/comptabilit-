'use client';

import { useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Alerte, Libelle, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { QUESTION_MAX, QUESTION_MIN, type PerimetreAssistant, type ReponsePortefeuille } from '@/lib/assistant';
import { ReponsePortefeuilleStructuree } from './affichage-portefeuille';

/**
 * Question à l'assistant sur un portefeuille (`POST v1/assistant/questions`). Le périmètre est calculé par le serveur :
 * la sélection ci-dessous ne fait que le RESTREINDRE (elle est intersectée avec les dossiers autorisés). Tous les
 * dossiers autorisés sont cochés par défaut ; dans ce cas aucun identifiant n'est envoyé.
 */
export function QuestionPortefeuille({ perimetre }: { perimetre: PerimetreAssistant }) {
  const id = useId();
  const appel = useAppel();
  const [question, setQuestion] = useState('');
  const [choisis, setChoisis] = useState<string[]>(perimetre.dossiers.map((d) => d.id));
  const [posee, setPosee] = useState('');
  const [resultat, setResultat] = useState<ReponsePortefeuille | null>(null);
  const [invalide, setInvalide] = useState<string | null>(null);
  const tous = choisis.length === perimetre.dossiers.length;
  const basculer = (dossierId: string) => setChoisis((v) => (v.includes(dossierId) ? v.filter((x) => x !== dossierId) : [...v, dossierId]));

  return (
    <div className="space-y-4">
      <form
        className="space-y-3"
        data-formulaire="question-portefeuille"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const texte = question.trim();
          if (texte.length < QUESTION_MIN || texte.length > QUESTION_MAX) return setInvalide(`Saisissez une question de ${QUESTION_MIN} à ${QUESTION_MAX} caractères.`);
          if (choisis.length === 0) return setInvalide('Sélectionnez au moins un dossier.');
          setInvalide(null);
          const r = await appel.executer<ReponsePortefeuille>('v1/assistant/questions', { method: 'POST', json: { question: texte, ...(tous ? {} : { dossierIds: choisis }) } });
          if (r) {
            setPosee(texte);
            setResultat(r);
          }
        }}
      >
        <fieldset className="space-y-2" data-testid="choix-dossiers">
          <legend className="font-medium">
            Dossiers interrogés ({choisis.length} sur {perimetre.dossiers.length} autorisé{perimetre.dossiers.length > 1 ? 's' : ''})
          </legend>
          <div className="flex flex-wrap gap-2">
            <Bouton variante="contour" onClick={() => setChoisis(perimetre.dossiers.map((d) => d.id))} disabled={tous}>
              Tout sélectionner
            </Bouton>
            <Bouton variante="contour" onClick={() => setChoisis([])} disabled={choisis.length === 0}>
              Tout désélectionner
            </Bouton>
          </div>
          <ul className="grid max-h-64 grid-cols-1 gap-x-4 overflow-y-auto sm:grid-cols-2">
            {perimetre.dossiers.map((d) => (
              <li key={d.id}>
                <label className="flex min-h-11 items-center gap-2 break-words">
                  <input autoComplete="off" type="checkbox" className="size-5 shrink-0" checked={choisis.includes(d.id)} onChange={() => basculer(d.id)} data-dossier={d.id} />
                  <span className="min-w-0 break-words">{d.nom}</span>
                </label>
              </li>
            ))}
          </ul>
          {choisis.length > perimetre.borne ? (
            <Alerte ton="attention" data-testid="au-dela-de-la-borne">
              Une question porte sur {perimetre.borne} dossiers au plus : seuls les {perimetre.borne} premiers (ordre alphabétique) seront interrogés, et les autres vous seront listés. Réduisez la sélection pour choisir lesquels.
            </Alerte>
          ) : null}
        </fieldset>
        <div>
          <Libelle htmlFor={`${id}-question`}>Votre question sur ces dossiers</Libelle>
          <ZoneTexte
            id={`${id}-question`}
            value={question}
            maxLength={QUESTION_MAX}
            aria-describedby={`${id}-aide`}
            aria-invalid={invalide ? true : undefined}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Exemple : quel est le chiffre d’affaires ?"
          />
          <p id={`${id}-aide`} className="mt-1 text-sm text-texte-doux">
            De {QUESTION_MIN} à {QUESTION_MAX} caractères. Chaque dossier est analysé sur son dernier exercice. Les réponses citent leurs sources, dossier par dossier ; elles ne remplacent ni la revue ni la validation.
          </p>
        </div>
        <Bouton type="submit" disabled={appel.occupe}>
          {appel.occupe ? 'Recherche en cours…' : 'Poser la question'}
        </Bouton>
        {invalide || appel.erreur ? (
          <Alerte ton="danger" role="alert" data-testid="erreur-question">
            {invalide ?? appel.erreur}
          </Alerte>
        ) : null}
      </form>

      {/* Région annoncée poliment aux lecteurs d'écran quand la réponse arrive. */}
      <section aria-labelledby={`${id}-titre-reponse`} aria-live="polite" aria-busy={appel.occupe} data-testid="zone-reponse" className="space-y-2">
        <h3 id={`${id}-titre-reponse`} className="text-lg font-semibold">
          Réponse
        </h3>
        {resultat ? (
          <>
            <p className="break-words">
              <span className="font-medium">Question :</span> {posee}
            </p>
            <ReponsePortefeuilleStructuree mode={resultat.mode} perimetre={resultat.perimetre} reponse={resultat.reponse} />
            {!resultat.echangeEnregistre ? (
              <Alerte ton="neutre" data-testid="echange-non-enregistre">
                Cette réponse n’a pas été conservée dans votre historique.
              </Alerte>
            ) : null}
          </>
        ) : (
          <p className="text-texte-doux">Aucune question posée pour l’instant.</p>
        )}
      </section>
    </div>
  );
}
