import type { Metadata } from 'next';
import Link from 'next/link';
import { ErreurAcces } from '@/components/erreurs';
import { LienSource } from '@/components/revision-affichage';
import { Alerte, Etiquette, SousTitre, type Ton } from '@/components/ui/base';
import { ConsignerSuivi } from '@/components/veille-actions';
import { estGestionnaire } from '@/lib/messagerie';
import { formaterDate, formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { lireMoi } from '@/lib/serveur/donnees';
import { contexteDossier } from '@/lib/serveur/dossier';
import { auMoins } from '@/lib/types-api';
import { type EvolutionDossier, LIBELLE_APPLICABILITE, LIBELLE_SUIVI, PHRASE_VEILLE, type StatutApplicabilite } from '@/lib/veille';

export const metadata: Metadata = { title: 'Veille du dossier' };

const TON: Record<StatutApplicabilite, Ton> = { concerne: 'attention', a_confirmer: 'vide', non_concerne: 'neutre' };

export default async function PageVeilleDossier({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const [veille, moi] = await Promise.all([tenter<EvolutionDossier[]>(`v1/dossiers/${id}/veille`), lireMoi()]);
  if (!veille.ok) return <ErreurAcces statut={veille.statut} message={veille.message} retour={`/dossiers/${id}`} />;
  const collaboration = auMoins(ctx.niveau, 'collaboration');
  const gestionnaire = moi.ok && estGestionnaire(moi.donnees.role);
  const evolutions = veille.donnees;

  return (
    <div className="space-y-4">
      <Alerte ton="neutre" data-testid="phrase-veille">
        <strong>{PHRASE_VEILLE}</strong> Seules les évolutions lues et qualifiées par une personne, chez l’éditeur, sont présentées ici ; leur applicabilité à ce dossier est
        évaluée d’après ses caractéristiques.{' '}
        <Link href="/veille/sources" prefetch={false}>
          Voir l’état de la veille par source
        </Link>
        .
      </Alerte>
      <SousTitre>Évolutions vérifiées ({evolutions.length})</SousTitre>
      {evolutions.length === 0 ? (
        <p className="text-texte-doux" data-testid="aucune-evolution">
          Aucune évolution vérifiée n’est enregistrée à ce jour. Cela ne signifie pas qu’aucun texte n’a changé : consultez l’état de la veille par source.
        </p>
      ) : null}
      <ul className="space-y-3">
        {evolutions.map((e) => {
          const a = e.applicabilite;
          return (
            <li key={e.id} className="space-y-2 rounded-lg border border-bordure bg-surface p-3" data-evolution={e.id} data-applicabilite={a.statut}>
              <p className="flex flex-wrap items-center gap-2">
                <Etiquette ton={TON[a.statut] ?? 'neutre'} data-testid="applicabilite">
                  {LIBELLE_APPLICABILITE[a.statut] ?? a.statut}
                </Etiquette>
                <span className="font-medium break-words">{e.reference}</span>
                <span className="text-sm text-texte-doux">{e.emetteur}</span>
              </p>
              {e.resume ? <p className="break-words whitespace-pre-wrap">{e.resume}</p> : null}
              <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-texte-doux">Source</dt>
                <dd>
                  <LienSource url={e.url} />
                </dd>
                {e.passage ? (
                  <>
                    <dt className="text-texte-doux">Passage</dt>
                    <dd className="break-words">{e.passage}</dd>
                  </>
                ) : null}
                <dt className="text-texte-doux">Dates</dt>
                <dd>
                  Publication : {formaterDate(e.datePublication)} · effet : {formaterDate(e.dateEffet)} · vérifiée le {formaterDate(e.verifieeLe)}
                </dd>
                {e.conditions ? (
                  <>
                    <dt className="text-texte-doux">Conditions</dt>
                    <dd className="break-words whitespace-pre-wrap">{e.conditions}</dd>
                  </>
                ) : null}
                <dt className="text-texte-doux">Raisons</dt>
                <dd>
                  <ul className="list-disc pl-5" data-testid="raisons">
                    {a.raisons.map((r, i) => (
                      <li key={i} className="break-words">
                        {r}
                      </li>
                    ))}
                  </ul>
                </dd>
                {a.statut !== 'non_concerne' ? (
                  <>
                    <dt className="text-texte-doux">Exercices concernés</dt>
                    <dd data-testid="exercices-concernes">
                      {a.exercicesConcernes.length ? a.exercicesConcernes.map((x) => `du ${formaterDate(x.debut)} au ${formaterDate(x.fin)}`).join(' ; ') : 'Aucun exercice déterminé'}
                    </dd>
                  </>
                ) : null}
              </dl>
              {a.statut === 'a_confirmer' ? (
                <Alerte ton="attention" data-testid="manquants">
                  <p>
                    Caractéristiques du dossier à renseigner pour conclure : <strong>{a.manquants.length ? a.manquants.join(', ') : 'à apprécier manuellement'}</strong>.
                  </p>
                  <p className="mt-1">
                    {gestionnaire ? (
                      <Link href={`/administration/dossiers/${id}`} prefetch={false}>
                        Compléter la fiche d’administration du dossier
                      </Link>
                    ) : (
                      'La fiche d’administration du dossier est tenue par les administrateurs et associés du cabinet : demandez-leur de la compléter.'
                    )}
                  </p>
                </Alerte>
              ) : null}
              <p className="text-sm" data-testid="suivi">
                Suivi pour ce dossier :{' '}
                {e.suivi ? (
                  <>
                    <Etiquette ton="info">{LIBELLE_SUIVI[e.suivi.statut] ?? e.suivi.statut}</Etiquette> le {formaterHorodatage(e.suivi.majLe)}
                    {e.suivi.note ? <span className="block break-words whitespace-pre-wrap">Note : {e.suivi.note}</span> : null}
                  </>
                ) : (
                  <Etiquette ton="vide">Aucun suivi consigné</Etiquette>
                )}
              </p>
              {collaboration ? <ConsignerSuivi dossierId={id} evolutionId={e.id} reference={e.reference} actuel={e.suivi ? { statut: e.suivi.statut, note: e.suivi.note } : null} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
