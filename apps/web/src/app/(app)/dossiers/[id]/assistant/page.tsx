import type { Metadata } from 'next';
import { BandeauEtatIa, ReponseStructuree } from '@/components/assistant/affichage';
import { QuestionAssistant } from '@/components/assistant/question';
import { ErreurAcces } from '@/components/erreurs';
import { Alerte, Carte, Etiquette, SousTitre } from '@/components/ui/base';
import { type HistoriqueAssistant, LIBELLE_MODE, type VueIa } from '@/lib/assistant';
import { formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { lireExercices } from '@/lib/serveur/donnees';
import { contexteDossier } from '@/lib/serveur/dossier';

export const metadata: Metadata = { title: 'Assistant du dossier' };

export default async function PageAssistant({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const [ia, exercices, historique] = await Promise.all([tenter<VueIa>('v1/ia'), lireExercices(id), tenter<HistoriqueAssistant>(`v1/dossiers/${id}/assistant/questions`)]);
  if (!historique.ok && historique.statut !== 503) return <ErreurAcces statut={historique.statut} message={historique.message} retour={`/dossiers/${id}`} />;
  const base = `/dossiers/${id}`;
  const echanges = historique.ok ? historique.donnees.echanges : [];

  return (
    <div className="space-y-5">
      <SousTitre id="titre-assistant">Assistant documenté</SousTitre>
      <BandeauEtatIa etat={ia.ok ? ia.donnees : null} />
      <p className="text-sm text-texte-doux">
        L’assistant ne consulte que ce dossier, avec vos habilitations, sur la période de l’exercice choisi. Les extraits de pièces et les libellés d’écritures sont des données affichées telles quelles ; les calculs viennent du moteur.
      </p>

      <Carte>
        <QuestionAssistant dossierId={id} nomDossier={ctx.dossier.raisonSociale} exercices={exercices.ok ? exercices.donnees : []} />
      </Carte>

      <section aria-labelledby="titre-historique" className="space-y-2" data-testid="historique-assistant">
        <SousTitre id="titre-historique">Mes questions précédentes ({historique.ok ? historique.donnees.total : 0})</SousTitre>
        {!historique.ok ? <Alerte ton="attention">L’historique n’a pas pu être lu pour le moment.</Alerte> : null}
        {historique.ok && echanges.length === 0 ? <p className="text-texte-doux">Aucune question enregistrée sur ce dossier. Vous seul voyez votre historique.</p> : null}
        <ul className="space-y-2">
          {echanges.map((e) => (
            <li key={e.id} className="rounded-lg border border-bordure bg-surface" data-echange={e.id}>
              <details>
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 p-3">
                  <span className="font-medium break-words">{e.question}</span>
                  <Etiquette ton={e.mode === 'ia' ? 'info' : 'attention'}>{LIBELLE_MODE[e.mode]}</Etiquette>
                  <span className="text-sm text-texte-doux">{formaterHorodatage(e.creeLe)}</span>
                </summary>
                <div className="border-t border-bordure p-3">
                  <ReponseStructuree base={base} mode={e.mode} reponse={e.reponse} nomDossier={ctx.dossier.raisonSociale} />
                </div>
              </details>
            </li>
          ))}
        </ul>
        {historique.ok && historique.donnees.total > echanges.length ? <p className="text-sm text-texte-doux">Seules les {echanges.length} questions les plus récentes sont affichées.</p> : null}
      </section>
    </div>
  );
}
