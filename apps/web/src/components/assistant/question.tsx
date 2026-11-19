'use client';

import { useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Alerte, Libelle, Liste, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { QUESTION_MAX, QUESTION_MIN, type ReponseQuestion } from '@/lib/assistant';
import { formaterDate } from '@/lib/montants';
import type { Exercice } from '@/lib/types-api';
import { ReponseStructuree } from './affichage';

/**
 * Question à l'assistant (`POST v1/dossiers/:id/assistant/questions`). Le périmètre (cabinet, dossier, période de
 * l'exercice) est imposé par le serveur ; seuls la question et l'exercice choisi sont envoyés.
 */
export function QuestionAssistant({ dossierId, nomDossier, exercices }: { dossierId: string; nomDossier: string; exercices: Exercice[] }) {
  const id = useId();
  const appel = useAppel();
  const [question, setQuestion] = useState('');
  const [exerciceId, setExerciceId] = useState(exercices[0]?.id ?? '');
  const [posee, setPosee] = useState('');
  const [resultat, setResultat] = useState<ReponseQuestion | null>(null);
  const [invalide, setInvalide] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <form
        className="space-y-3"
        data-formulaire="question-assistant"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const texte = question.trim();
          if (texte.length < QUESTION_MIN || texte.length > QUESTION_MAX) {
            setInvalide(`Saisissez une question de ${QUESTION_MIN} à ${QUESTION_MAX} caractères.`);
            return;
          }
          setInvalide(null);
          const r = await appel.executer<ReponseQuestion>(`v1/dossiers/${dossierId}/assistant/questions`, { method: 'POST', json: { question: texte, ...(exerciceId ? { exerciceId } : {}) } });
          if (r) {
            setPosee(texte);
            setResultat(r);
          }
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[16rem_1fr]">
          <div>
            <Libelle htmlFor={`${id}-exercice`}>Exercice analysé</Libelle>
            {exercices.length ? (
              <Liste id={`${id}-exercice`} value={exerciceId} onChange={(e) => setExerciceId(e.target.value)}>
                {exercices.map((x) => (
                  <option key={x.id} value={x.id}>
                    Du {formaterDate(x.debut)} au {formaterDate(x.fin)}
                  </option>
                ))}
              </Liste>
            ) : (
              <p id={`${id}-exercice`} className="text-sm text-texte-doux">
                Aucun exercice dans ce dossier : seules les pièces seront recherchées.
              </p>
            )}
          </div>
          <div>
            <Libelle htmlFor={`${id}-question`}>Votre question sur ce dossier</Libelle>
            <ZoneTexte
              id={`${id}-question`}
              value={question}
              maxLength={QUESTION_MAX}
              aria-describedby={`${id}-aide`}
              aria-invalid={invalide ? true : undefined}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Exemple : quel est le solde du compte 512 ?"
            />
            <p id={`${id}-aide`} className="mt-1 text-sm text-texte-doux">
              De {QUESTION_MIN} à {QUESTION_MAX} caractères. Les réponses citent leurs sources ; elles ne remplacent ni la revue ni la validation.
            </p>
          </div>
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
            <ReponseStructuree base={`/dossiers/${dossierId}`} mode={resultat.mode} reponse={resultat.reponse} nomDossier={nomDossier} />
            {!resultat.echangeEnregistre ? (
              <Alerte ton="neutre" data-testid="echange-non-enregistre">
                Cette réponse n’a pas été conservée dans votre historique : votre habilitation sur ce dossier (lecture) ne permet pas de l’y enregistrer.
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
