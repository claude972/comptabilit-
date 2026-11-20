import type { Metadata } from 'next';
import Link from 'next/link';
import { FormulaireExecution, FormulaireSimulation, BoutonReprise } from '@/components/destinataire/reanalyse';
import { ErreurAcces } from '@/components/erreurs';
import { ActualisationPeriodique } from '@/components/revision-actions';
import { Alerte, Carte, Etiquette, SousTitre, Tableau } from '@/components/ui/base';
import { type ApercuReanalyse, LIBELLE_CHAMP_DESTINATAIRE, LIBELLE_RESULTAT, type RapportReanalyse, type ResultatReanalyse } from '@/lib/destinataire';
import { formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { estUuid, parametre } from '@/lib/serveur/donnees';
import { contexteDossier } from '@/lib/serveur/dossier';
import { auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Réanalyse du destinataire' };

const TON: Record<ResultatReanalyse | 'en_attente', 'neutre' | 'succes' | 'attention' | 'danger' | 'info'> = { en_attente: 'neutre', inchangee: 'neutre', destinataire_trouve: 'succes', abstention: 'attention', erreur: 'danger' };
const LIBELLE_STATUT = { en_attente: 'En attente du worker', en_cours: 'En cours', termine: 'Terminée' } as const;

function Rapport({ r, entiteId, peutDemander, validees }: { r: RapportReanalyse; entiteId: string; peutDemander: boolean; validees: number }) {
  const d = r.demande;
  const simulation = d.mode === 'simulation';
  const termine = d.statut === 'termine';
  return (
    <section aria-labelledby="titre-rapport" className="space-y-3" data-testid="rapport-reanalyse" data-mode={d.mode} data-statut={d.statut}>
      <div className="flex flex-wrap items-center gap-2">
        <SousTitre id="titre-rapport">{simulation ? 'Aperçu (simulation)' : 'Réanalyse exécutée'}</SousTitre>
        <Etiquette ton={termine ? 'succes' : 'info'}>{LIBELLE_STATUT[d.statut]}</Etiquette>
        <span className="text-sm text-texte-doux">
          Demandée par {d.demandeur ?? 'une personne du cabinet'} le {formaterHorodatage(d.creeLe)} — {d.nbPieces} pièce{d.nbPieces > 1 ? 's' : ''} — analyseur {d.versionAnalyseur}
        </span>
      </div>
      <p className="text-sm">
        Motif : <span className="break-words">{d.motif}</span>
      </p>
      {!termine ? <ActualisationPeriodique libelle="Relecture des pièces par le worker" secondes={2} /> : null}
      {!termine && peutDemander ? <BoutonReprise demandeId={d.id} /> : null}
      <ul className="flex flex-wrap gap-2" aria-label="Décomptes par résultat" data-testid="decomptes-reanalyse">
        {(Object.keys(LIBELLE_RESULTAT) as Array<ResultatReanalyse | 'en_attente'>).map((k) => (
          <li key={k}>
            <Etiquette ton={TON[k]} data-resultat={k}>
              {LIBELLE_RESULTAT[k]} : {r.decomptes[k] ?? 0}
            </Etiquette>
          </li>
        ))}
      </ul>
      {termine ? (
        <p className="text-sm" data-testid="resume-reanalyse">
          {simulation ? (
            <>
              <strong>{r.changeraient}</strong> pièce{r.changeraient > 1 ? 's' : ''} sur {d.nbPieces} {r.changeraient > 1 ? 'changeraient' : 'changerait'} (une nouvelle version d’extraction serait créée). <strong>Rien n’a été modifié.</strong>
            </>
          ) : (
            <>
              <strong>{r.changeraient}</strong> nouvelle{r.changeraient > 1 ? 's' : ''} version{r.changeraient > 1 ? 's' : ''} d’extraction créée{r.changeraient > 1 ? 's' : ''}. Les anciennes versions, les originaux et les décisions sont conservés.
            </>
          )}
        </p>
      ) : null}
      {r.pieces.length ? (
        <Tableau legende="Rapport par pièce de la réanalyse du destinataire">
          <thead>
            <tr>
              <th scope="col">Pièce</th>
              <th scope="col">Résultat</th>
              <th scope="col">Précisions</th>
            </tr>
          </thead>
          <tbody>
            {r.pieces.map((p) => (
              <tr key={p.id} data-resultat={p.resultat ?? 'en_attente'}>
                <th scope="row" className="!bg-transparent font-medium">
                  <Link href={`/dossiers/${entiteId}/pieces/${p.documentId}`} prefetch={false} className="break-all">
                    {p.nomFichier}
                  </Link>
                </th>
                <td>
                  <Etiquette ton={TON[p.resultat ?? 'en_attente']}>{LIBELLE_RESULTAT[p.resultat ?? 'en_attente']}</Etiquette>
                  {p.versionExtractionApres ? <span className="block text-sm text-texte-doux">version {p.versionExtractionAvant} → {p.versionExtractionApres}</span> : null}
                </td>
                <td className="text-sm">
                  {p.motif ? <span className="block break-words">{p.motif}</span> : null}
                  {p.detail?.desaccords?.length ? (
                    <span className="block" data-testid="desaccord-reanalyse">
                      <Etiquette ton="attention">Désaccord signalé</Etiquette>{' '}
                      {p.detail.desaccords.map((x) => `${LIBELLE_CHAMP_DESTINATAIRE[x.champ]} : saisie humaine ${x.humain ?? '(vide)'} conservée, lecture automatique ${x.automatique ?? '(vide)'}`).join(' ; ')}
                    </span>
                  ) : null}
                  {p.detail?.autresDivergences?.length ? <span className="block text-texte-doux">Autres champs lus autrement (non appliqués) : {p.detail.autresDivergences.join(', ')}.</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Tableau>
      ) : null}
      {simulation && termine && peutDemander ? (
        r.executionId ? (
          <Alerte ton="neutre">
            Cette simulation a déjà été exécutée.{' '}
            <Link href={`?demande=${r.executionId}`} prefetch={false}>
              Voir le rapport de l’exécution
            </Link>
            .
          </Alerte>
        ) : r.executable && r.changeraient > 0 ? (
          <Carte>
            <FormulaireExecution entiteId={entiteId} simulationId={d.id} changeraient={r.changeraient} validees={validees} />
          </Carte>
        ) : (
          <Alerte ton="neutre">Aucune pièce ne changerait, ou la version de l’analyseur a changé : il n’y a rien à confirmer. Relancez une simulation si besoin.</Alerte>
        )
      ) : null}
    </section>
  );
}

export default async function PageReanalyseDestinataire({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const base = `/dossiers/${id}`;
  if (!auMoins(ctx.niveau, 'collaboration')) return <ErreurAcces statut={403} message="La réanalyse du destinataire est réservée aux personnes habilitées à corriger les pièces." retour={base} />;
  const sp = await searchParams;
  const demande = parametre(sp.demande);
  const [apercu, rapport] = await Promise.all([tenter<ApercuReanalyse>(`v1/dossiers/${id}/reanalyse-destinataire`), demande && estUuid(demande) ? tenter<RapportReanalyse>(`v1/reanalyses-destinataire/${demande}`) : Promise.resolve(null)]);
  if (!apercu.ok) return <ErreurAcces statut={apercu.statut} message={apercu.message} retour={base} />;
  const a = apercu.donnees;
  return (
    <div className="space-y-6">
      <p>
        <Link href={base} prefetch={false}>
          ← Retour à la file des pièces
        </Link>
      </p>
      <div>
        <h2 className="text-xl font-semibold">Réanalyse du destinataire des pièces déjà stockées</h2>
        <p className="mt-1 text-texte-doux">
          Les pièces analysées avant la lecture du destinataire (acheteur) n’en portent pas. Cette page permet à une personne habilitée de les relire, par lots de {a.tailleMaxLot} pièces au plus, après un aperçu.
        </p>
      </div>
      <Carte className="space-y-3" data-testid="apercu-reanalyse">
        <SousTitre>Pièces concernées</SousTitre>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-texte-doux">Pièces sans lecture du destinataire</dt>
          <dd data-testid="nb-concernees" className="font-semibold">
            {a.concernees}
          </dd>
          <dt className="text-texte-doux">Dans le prochain lot</dt>
          <dd data-testid="nb-lot">
            {a.dansLeProchainLot} (lot{a.lotsNecessaires > 1 ? `s nécessaires : ${a.lotsNecessaires}` : ' unique'})
          </dd>
          <dt className="text-texte-doux">Dont extraction validée</dt>
          <dd>{a.extractionsValidees}</dd>
          <dt className="text-texte-doux">Dont corrigées à la main</dt>
          <dd>{a.corrigeesALaMain}</dd>
          <dt className="text-texte-doux">Déjà relues (jamais refaites avec l’analyseur {a.versionAnalyseur})</dt>
          <dd>{a.dejaRelues}</dd>
        </dl>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {a.garanties.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </Carte>

      {a.concernees === 0 ? (
        <Alerte ton="succes" data-testid="rien-a-reanalyser">
          Aucune pièce à réanalyser : toutes portent déjà la lecture de leur destinataire.
        </Alerte>
      ) : !a.peutDemander ? (
        <Alerte ton="neutre" data-testid="demande-reservee">
          Demander une simulation ou une exécution est réservé au niveau « révision » ou plus. Vous pouvez consulter l’aperçu et les rapports.
        </Alerte>
      ) : (
        <Carte>
          <FormulaireSimulation entiteId={id} concernees={a.concernees} lot={a.dansLeProchainLot} />
        </Carte>
      )}

      {rapport ? (
        rapport.ok ? (
          <Rapport r={rapport.donnees} entiteId={id} peutDemander={a.peutDemander} validees={a.extractionsValidees} />
        ) : (
          <Alerte ton="danger">Rapport indisponible : {rapport.message}</Alerte>
        )
      ) : null}

      <section aria-labelledby="titre-demandes" className="space-y-2">
        <SousTitre id="titre-demandes">Demandes précédentes</SousTitre>
        {a.demandes.length ? (
          <Tableau legende="Demandes de réanalyse du destinataire">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Nature</th>
                <th scope="col">Pièces</th>
                <th scope="col">État</th>
                <th scope="col">Motif</th>
              </tr>
            </thead>
            <tbody>
              {a.demandes.map((x) => (
                <tr key={x.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`?demande=${x.id}`} prefetch={false}>
                      {formaterHorodatage(x.creeLe)}
                    </Link>
                  </td>
                  <td>{x.mode === 'simulation' ? 'Simulation' : 'Exécution'}</td>
                  <td>{x.nbPieces}</td>
                  <td>{LIBELLE_STATUT[x.statut]}</td>
                  <td className="break-words">{x.motif}</td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        ) : (
          <p className="text-texte-doux">Aucune demande pour ce dossier.</p>
        )}
      </section>
    </div>
  );
}
