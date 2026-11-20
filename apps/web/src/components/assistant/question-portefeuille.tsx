'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Alerte, Libelle, Saisie, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { erreurPeriode, nombreDeTranches, QUESTION_MAX, QUESTION_MIN, type PerimetreAssistant, type ReponsePortefeuille } from '@/lib/assistant';
import { ReponsePortefeuilleStructuree } from './affichage-portefeuille';

/**
 * Question à l'assistant sur un portefeuille (`POST v1/assistant/questions`). Le périmètre est calculé par le serveur :
 * la sélection ci-dessous ne fait que le RESTREINDRE (elle est intersectée avec les dossiers autorisés). Tous les
 * dossiers autorisés sont cochés par défaut ; dans ce cas aucun identifiant n'est envoyé.
 */
export function QuestionPortefeuille({ perimetre, periodeInitiale }: { perimetre: PerimetreAssistant; periodeInitiale?: { debut: string; fin: string } | null }) {
  const id = useId();
  const appel = useAppel();
  const routeur = useRouter();
  const chemin = usePathname();
  const [question, setQuestion] = useState('');
  const [choisis, setChoisis] = useState<string[]>(perimetre.dossiers.map((d) => d.id));
  const [posee, setPosee] = useState('');
  // Une réponse par tranche de dossiers, chacune distincte : elles ne sont jamais fusionnées en une seule.
  const [resultats, setResultats] = useState<ReponsePortefeuille[]>([]);
  // Ce qui a été réellement envoyé pour la question affichée : les tranches suivantes en reprennent exactement le contenu.
  const [envoyee, setEnvoyee] = useState<{ question: string; dossierIds?: string[]; periode?: { debut: string; fin: string } } | null>(null);
  const [invalide, setInvalide] = useState<string | null>(null);
  const [debut, setDebut] = useState(periodeInitiale?.debut ?? '');
  const [fin, setFin] = useState(periodeInitiale?.fin ?? '');
  const erreurDates = erreurPeriode(debut, fin);
  const tous = choisis.length === perimetre.dossiers.length;
  const nbTranches = nombreDeTranches(choisis.length, perimetre.borne);
  // La période est conservée dans l'adresse (rechargement, lien, retour arrière) sans recharger la page.
  const changerPeriode = (d: string, f: string) => {
    setDebut(d);
    setFin(f);
    // Par le routeur (et non `history.replaceState` seul) : l'actualisation qui suit chaque appel relit l'adresse du routeur.
    const requete = new URLSearchParams(window.location.search);
    for (const [cle, v] of [['debut', d], ['fin', f]] as const) {
      if (v) requete.set(cle, v);
      else requete.delete(cle);
    }
    routeur.replace(requete.size ? `${chemin}?${requete}` : chemin, { scroll: false });
  };
  const derniere = resultats.at(-1) ?? null;
  const suivante = derniere?.perimetre.tranche && derniere.perimetre.tranche.numero < derniere.perimetre.tranche.total ? derniere.perimetre.tranche : null;
  const interroger = async (corps: NonNullable<typeof envoyee>, tranche: number) => {
    const r = await appel.executer<ReponsePortefeuille>('v1/assistant/questions', { method: 'POST', json: { ...corps, ...(tranche > 1 ? { tranche } : {}) } });
    if (r) {
      setEnvoyee(corps);
      setResultats((v) => (tranche > 1 ? [...v, r] : [r]));
    }
  };
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
          if (erreurDates) return setInvalide(erreurDates);
          setInvalide(null);
          setPosee(texte);
          await interroger({ question: texte, ...(tous ? {} : { dossierIds: choisis }), ...(debut && fin ? { periode: { debut, fin } } : {}) }, 1);
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
              Une question porte sur {perimetre.borne} dossiers au plus : vos {choisis.length} dossiers forment {nbTranches} tranches de {perimetre.borne} au plus, classées par pertinence (dossiers ayant des données comptables importées d’abord, puis par ordre alphabétique). La
              première est interrogée ; les suivantes se demandent ensuite, une par une, et chaque réponse reste distincte. Réduisez la sélection pour choisir précisément les dossiers.
            </Alerte>
          ) : null}
        </fieldset>
        <fieldset className="space-y-2" data-testid="periode-commune" aria-describedby={`${id}-aide-periode`}>
          <legend className="font-medium">Période commune (facultative)</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Libelle htmlFor={`${id}-debut`}>Début de la période</Libelle>
              <Saisie id={`${id}-debut`} type="date" value={debut} aria-invalid={erreurDates ? true : undefined} onChange={(e) => changerPeriode(e.target.value, fin)} />
            </div>
            <div>
              <Libelle htmlFor={`${id}-fin`}>Fin de la période</Libelle>
              <Saisie id={`${id}-fin`} type="date" value={fin} aria-invalid={erreurDates ? true : undefined} onChange={(e) => changerPeriode(debut, e.target.value)} />
            </div>
          </div>
          <p id={`${id}-aide-periode`} className="text-sm text-texte-doux">
            Sans période, chaque dossier est interrogé sur son dernier exercice. Avec une période, chaque dossier est interrogé sur la part de cette période qui recoupe son dernier exercice recoupant cette période ; un dossier dont aucun exercice ne la recoupe n’est pas interrogé
            sur la comptabilité, et la réponse le dit dossier par dossier.
          </p>
          {erreurDates ? (
            <Alerte ton="danger" role="alert" data-testid="erreur-periode">
              {erreurDates}
            </Alerte>
          ) : null}
          {debut || fin ? (
            <Bouton variante="contour" onClick={() => changerPeriode('', '')}>
              Effacer la période
            </Bouton>
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
        {resultats.length ? (
          <>
            <p className="break-words">
              <span className="font-medium">Question :</span> {posee}
            </p>
            {resultats.map((resultat, i) => (
              <div key={resultat.echangeId ?? i} className="space-y-2" data-tranche-reponse={resultat.perimetre.tranche?.numero ?? 1}>
                <ReponsePortefeuilleStructuree mode={resultat.mode} perimetre={resultat.perimetre} reponse={resultat.reponse} />
                {!resultat.echangeEnregistre ? (
                  <Alerte ton="neutre" data-testid="echange-non-enregistre">
                    Cette réponse n’a pas été conservée dans votre historique.
                  </Alerte>
                ) : null}
              </div>
            ))}
            {suivante && envoyee ? (
              <div className="space-y-1" data-testid="tranche-suivante">
                <p className="text-sm text-texte-doux">
                  Tranche {suivante.numero} sur {suivante.total} interrogée : {suivante.retenus - suivante.dernier} dossier{suivante.retenus - suivante.dernier > 1 ? 's' : ''} restent à interroger, par une nouvelle question dont la réponse s’affichera à part.
                </p>
                <Bouton disabled={appel.occupe} onClick={() => interroger(envoyee, suivante.numero + 1)}>
                  Interroger les {Math.min(perimetre.borne, suivante.retenus - suivante.dernier)} suivants
                </Bouton>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-texte-doux">Aucune question posée pour l’instant.</p>
        )}
      </section>
    </div>
  );
}
