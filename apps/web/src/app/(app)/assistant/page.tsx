import type { Metadata } from 'next';
import { BandeauEtatIa } from '@/components/assistant/affichage';
import { ReponsePortefeuilleStructuree } from '@/components/assistant/affichage-portefeuille';
import { QuestionPortefeuille } from '@/components/assistant/question-portefeuille';
import { ErreurAcces } from '@/components/erreurs';
import { Alerte, Carte, Etiquette, SousTitre, Titre } from '@/components/ui/base';
import { type HistoriquePortefeuille, LIBELLE_MODE, type PerimetreAssistant, periodeDeLAdresse, type VueIa } from '@/lib/assistant';
import { formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { estDeposant, lireMoi } from '@/lib/serveur/donnees';

export const metadata: Metadata = { title: 'Assistant' };

/** Assistant au niveau du cabinet : questions sur le portefeuille de dossiers autorisés de la personne connectée. */
export default async function PageAssistantPortefeuille({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const moi = await lireMoi();
  if (!moi.ok) return <ErreurAcces statut={moi.statut} message={moi.message} />;
  if (estDeposant(moi.donnees.role)) return <ErreurAcces statut={403} message="L’assistant n’est pas ouvert aux déposants." retour="/deposer" />;
  const [ia, perimetre, historique] = await Promise.all([tenter<VueIa>('v1/ia'), tenter<PerimetreAssistant>('v1/assistant/perimetre'), tenter<HistoriquePortefeuille>('v1/assistant/questions')]);
  if (!perimetre.ok) return <ErreurAcces statut={perimetre.statut} message={perimetre.message} />;
  const echanges = historique.ok ? historique.donnees.echanges : [];
  const dossiers = perimetre.donnees.dossiers;

  return (
    <div className="space-y-5">
      <Titre>Assistant</Titre>
      <BandeauEtatIa etat={ia.ok ? ia.donnees : null} />
      <p className="text-sm text-texte-doux">
        L’assistant ne consulte que les dossiers où vous êtes habilité en lecture au moins, chacun sur son dernier exercice (ou la part d’une période commune que vous choisissez), {perimetre.donnees.borne} dossiers au plus par question ; au-delà, les dossiers se demandent par tranches. Chaque source citée indique son dossier. Les extraits de pièces et les
        libellés d’écritures sont des données affichées telles quelles ; les calculs viennent du moteur.
      </p>

      {dossiers.length === 0 ? (
        <Alerte ton="neutre" data-testid="perimetre-vide">
          Aucun dossier ne vous est ouvert en lecture : l’assistant n’a rien à interroger.
        </Alerte>
      ) : (
        <Carte>
          <QuestionPortefeuille perimetre={perimetre.donnees} periodeInitiale={periodeDeLAdresse(un(sp.debut), un(sp.fin))} />
        </Carte>
      )}

      <section aria-labelledby="titre-historique" className="space-y-2" data-testid="historique-portefeuille">
        <SousTitre id="titre-historique">Mes questions précédentes ({historique.ok ? historique.donnees.total : 0})</SousTitre>
        {!historique.ok ? <Alerte ton="attention">L’historique n’a pas pu être lu pour le moment.</Alerte> : null}
        {historique.ok && echanges.length === 0 ? <p className="text-texte-doux">Aucune question de portefeuille enregistrée. Vous seul voyez votre historique.</p> : null}
        <ul className="space-y-2">
          {echanges.map((e) => (
            <li key={e.id} className="rounded-lg border border-bordure bg-surface" data-echange={e.id}>
              <details>
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 p-3">
                  <span className="min-w-0 font-medium break-words">{e.question}</span>
                  <Etiquette ton={e.mode === 'ia' ? 'info' : 'attention'}>{LIBELLE_MODE[e.mode]}</Etiquette>
                  {e.masque ? <Etiquette ton="attention">Périmètre réduit depuis</Etiquette> : null}
                  <span className="text-sm text-texte-doux">{formaterHorodatage(e.creeLe)}</span>
                </summary>
                <div className="border-t border-bordure p-3">
                  <ReponsePortefeuilleStructuree mode={e.mode} perimetre={e.perimetre} reponse={e.reponse} masque={e.masque} />
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
