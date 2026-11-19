import type { Metadata } from 'next';
import Link from 'next/link';
import { ChoixExercice } from '@/components/dossier';
import { ErreurAcces } from '@/components/erreurs';
import { ActualisationPeriodique, BoutonAction } from '@/components/revision-actions';
import { EtiquetteGravite, EtiquetteStatutControle, EtiquetteStatutRevue } from '@/components/revision-affichage';
import { Alerte, Carte, Etiquette, Libelle, Liste, MentionProjet, SousTitre, Tableau } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { LIBELLE_CYCLE, LIBELLE_GRAVITE, LIBELLE_STATUT_CONTROLE, LIBELLE_STATUT_LOT, LIBELLE_STATUT_REVUE } from '@/lib/libelles';
import { formaterHorodatage, formaterMontant } from '@/lib/montants';
import { libelleOrigineParametres } from '@/lib/regles';
import { tenter } from '@/lib/serveur/api';
import { parametre } from '@/lib/serveur/donnees';
import { contexteDossier, contexteExercice } from '@/lib/serveur/dossier';
import { type ExportRevision, type Gravite, type Revue, type StatutControle, type StatutRevue, auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Révision du dossier' };

const ORDRE_STATUTS: StatutControle[] = ['constat', 'erreur', 'non_realise', 'non_applicable', 'sans_anomalie'];
const GRAVITES = Object.keys(LIBELLE_GRAVITE) as Gravite[];
const STATUTS_REVUE = Object.keys(LIBELLE_STATUT_REVUE) as StatutRevue[];
const enCours = (s: string) => s === 'en_attente' || s === 'en_cours';

export default async function PageRevision({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const ex = await contexteExercice(id, sp.exercice);
  if (!ex.ok) return <ErreurAcces statut={ex.statut} message={ex.message} retour={`/dossiers/${id}`} />;
  if (!ex.exercice) return <Alerte ton="attention">Aucun exercice n’est défini pour ce dossier.</Alerte>;
  const exercice = ex.exercice;
  const [revue, exports] = await Promise.all([tenter<Revue>(`v1/exercices/${exercice.id}/revue`), tenter<ExportRevision[]>(`v1/exercices/${exercice.id}/dossiers-revision`)]);
  if (!revue.ok) return <ErreurAcces statut={revue.statut} message={revue.message} retour={`/dossiers/${id}`} />;
  const { execution, resultats, constats } = revue.donnees;
  const collaboration = auMoins(ctx.niveau, 'collaboration');
  const base = `/dossiers/${id}/revision`;

  const fGravite = GRAVITES.find((g) => g === parametre(sp.gravite));
  const fStatut = STATUTS_REVUE.find((s) => s === parametre(sp.statut));
  const fARevoir = parametre(sp.arevoir) === '1';
  const filtres = constats.filter((c) => (!fGravite || c.gravite === fGravite) && (!fStatut || c.statutRevue === fStatut) && (!fARevoir || c.aRevoir));
  const parStatut = new Map<StatutControle, number>();
  for (const r of resultats) parStatut.set(r.statut, (parStatut.get(r.statut) ?? 0) + 1);
  const nbConstats = new Map<string, number>();
  for (const c of constats) nbConstats.set(c.controleId, (nbConstats.get(c.controleId) ?? 0) + 1);
  const listeExports = exports.ok ? exports.donnees : [];
  const generationEnCours = listeExports.some((e) => enCours(e.statut));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ChoixExercice exercices={ex.exercices} courant={exercice.id} />
        <MentionProjet />
      </div>
      <Alerte ton="neutre" className="text-sm">
        Les contrôles signalent des points à examiner à partir des écritures importées. Ils n’établissent ni la régularité ni la sincérité des comptes :
        l’appréciation et la validation relèvent du professionnel.
      </Alerte>

      {!execution ? (
        <Alerte ton="attention" titre="Aucun contrôle n’a encore été exécuté pour cet exercice">
          Importez des écritures dans l’onglet Comptabilité : les contrôles sont lancés après un import suffisant pour les travaux.
        </Alerte>
      ) : (
        <>
          {execution.obsolete ? (
            <Alerte ton="attention" role="status" titre="Résultats obsolètes" data-testid="bandeau-obsolete">
              Les données comptables ont changé depuis cette exécution (version des données {execution.versionDonnees}). Relancez les contrôles : les
              résultats et constats ci-dessous ne reflètent plus les données actives.
            </Alerte>
          ) : null}
          {enCours(execution.statut) ? <ActualisationPeriodique libelle="Contrôles en cours d’exécution" /> : null}
          {execution.statut === 'echec' ? <Alerte ton="danger" titre="L’exécution des contrôles a échoué">Relancez les contrôles ; si l’échec persiste, signalez-le.</Alerte> : null}
          <p className="text-sm text-texte-doux">
            Dernière exécution : {LIBELLE_STATUT_LOT[execution.statut] ?? execution.statut}, lancée le {formaterHorodatage(execution.creeLe)}
            {execution.termineLe ? `, terminée le ${formaterHorodatage(execution.termineLe)}` : ''} · version des données {execution.versionDonnees}.
          </p>
        </>
      )}
      {collaboration ? (
        <BoutonAction chemin={`v1/exercices/${exercice.id}/controles`} libelle="Relancer les contrôles" succes="Nouvelle exécution des contrôles demandée." />
      ) : null}

      {execution ? (
        <>
          <section aria-labelledby="titre-controles" className="space-y-2">
            <SousTitre id="titre-controles">Contrôles ({resultats.length})</SousTitre>
            <ul className="flex flex-wrap gap-2" aria-label="Répartition des contrôles par statut" data-testid="synthese-controles">
              {ORDRE_STATUTS.map((s) => (
                <li key={s} className="flex items-center gap-1">
                  <EtiquetteStatutControle statut={s} /> <span className="font-semibold tabular-nums">{parStatut.get(s) ?? 0}</span>
                </li>
              ))}
            </ul>
            <Tableau legende="Résultat de chaque contrôle">
              <thead>
                <tr>
                  <th scope="col">Contrôle</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Constats</th>
                  <th scope="col">Précision</th>
                </tr>
              </thead>
              <tbody>
                {resultats.map((r) => (
                  <tr key={r.id} data-controle={r.controleId} data-statut={r.statut}>
                    <th scope="row" className="!bg-transparent font-medium">
                      <span className="font-mono">{r.controleId}</span> <span className="text-sm font-normal text-texte-doux">v{r.versionControle}</span>
                      {r.source?.titre ? <span className="block font-normal">{r.source.titre}</span> : null}
                      {r.source?.cycle ? <span className="block text-sm font-normal text-texte-doux">Cycle : {LIBELLE_CYCLE[r.source.cycle] ?? r.source.cycle}</span> : null}
                      {r.source?.regleCabinet ? (
                        <span className="mt-1 block font-normal" data-testid="origine-parametres">
                          <Etiquette ton="info" className="whitespace-normal">
                            {libelleOrigineParametres(r.source.regleCabinet)}
                          </Etiquette>{' '}
                          <Link href="/regles" prefetch={false} className="text-sm">
                            Voir les règles du cabinet
                          </Link>
                        </span>
                      ) : null}
                    </th>
                    <td>
                      <EtiquetteStatutControle statut={r.statut} />
                    </td>
                    <td className="tabular-nums">{r.statut === 'constat' ? (nbConstats.get(r.controleId) ?? 0) : '—'}</td>
                    <td className="break-words">
                      {r.motif ?? (r.statut === 'sans_anomalie' ? 'Aucune anomalie détectée par ce contrôle, dans son périmètre.' : '')}
                      {r.statut === 'non_realise' ? <span className="block text-sm font-medium">Ce contrôle n’a pas été réalisé : aucune conclusion ne peut en être tirée.</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tableau>
            <p className="text-sm text-texte-doux">
              {LIBELLE_STATUT_CONTROLE.sans_anomalie} ne signifie pas « sans erreur » : seul le périmètre du contrôle est couvert.{' '}
              <Link href="/reference/controles" prefetch={false}>
                Voir le catalogue des contrôles
              </Link>
              .
            </p>
          </section>

          <section aria-labelledby="titre-constats" className="space-y-3">
            <SousTitre id="titre-constats">
              Constats ({filtres.length}
              {filtres.length !== constats.length ? ` sur ${constats.length}` : ''})
            </SousTitre>
            {/* La clé force la réinitialisation des champs quand les filtres de l'URL changent (« Effacer les filtres »). */}
            <form key={`${fGravite ?? ''}|${fStatut ?? ''}|${fARevoir}`} method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrer les constats">
              <input type="hidden" name="exercice" value={exercice.id} />
              <div>
                <Libelle htmlFor="gravite">Gravité</Libelle>
                <Liste id="gravite" name="gravite" defaultValue={fGravite ?? ''}>
                  <option value="">Toutes</option>
                  {GRAVITES.map((g) => (
                    <option key={g} value={g}>
                      {LIBELLE_GRAVITE[g]}
                    </option>
                  ))}
                </Liste>
              </div>
              <div>
                <Libelle htmlFor="statut">Statut de revue</Libelle>
                <Liste id="statut" name="statut" defaultValue={fStatut ?? ''}>
                  <option value="">Tous</option>
                  {STATUTS_REVUE.map((s) => (
                    <option key={s} value={s}>
                      {LIBELLE_STATUT_REVUE[s]}
                    </option>
                  ))}
                </Liste>
              </div>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" name="arevoir" value="1" defaultChecked={fARevoir} className="size-5" /> À revoir uniquement
              </label>
              <Bouton type="submit" variante="secondaire">
                Filtrer
              </Bouton>
              {fGravite || fStatut || fARevoir ? (
                <Link href={`${base}?exercice=${exercice.id}`} prefetch={false} className="inline-flex min-h-11 items-center">
                  Effacer les filtres
                </Link>
              ) : null}
            </form>
            {filtres.length ? (
              <ul className="space-y-2" data-testid="liste-constats">
                {filtres.map((c) => (
                  <li key={c.id} className="rounded-lg border border-bordure bg-surface p-3" data-constat={c.id}>
                    <p className="flex flex-wrap items-center gap-2">
                      <EtiquetteGravite gravite={c.gravite} />
                      <EtiquetteStatutRevue statut={c.statutRevue} />
                      {c.aRevoir ? <Etiquette ton="attention">À revoir : données modifiées depuis la décision</Etiquette> : null}
                      <span className="font-mono text-sm">{c.controleId}</span>
                    </p>
                    <p className="mt-1 font-medium">
                      <Link href={`${base}/constats/${c.id}`} prefetch={false} className="break-words">
                        {c.titre}
                      </Link>
                    </p>
                    {c.montant !== null ? <p className="text-sm tabular-nums">Montant : {formaterMontant(c.montant)}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-texte-doux">{constats.length ? 'Aucun constat ne correspond à ces filtres.' : 'Aucun constat pour cette exécution.'}</p>
            )}
          </section>
        </>
      ) : null}

      <Carte className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SousTitre>Dossier de révision</SousTitre>
          <MentionProjet>Projet</MentionProjet>
        </div>
        <p className="text-sm text-texte-doux">
          Le dossier de révision (PDF et données structurées) est figé sur la dernière exécution terminée des contrôles. C’est un projet : il ne vaut
          pas validation des comptes.
        </p>
        {collaboration ? (
          <BoutonAction chemin={`v1/exercices/${exercice.id}/dossier-revision`} libelle="Générer le dossier de révision (projet)" succes="Génération demandée." />
        ) : null}
        {generationEnCours ? <ActualisationPeriodique libelle="Génération en cours" /> : null}
        {!exports.ok ? <Alerte ton="attention">La liste des dossiers générés est indisponible.</Alerte> : null}
        {listeExports.length ? (
          <Tableau legende="Dossiers de révision générés">
            <thead>
              <tr>
                <th scope="col">Demandé le</th>
                <th scope="col">État</th>
                <th scope="col">Mention</th>
                <th scope="col">Version des données</th>
                <th scope="col">Téléchargement</th>
              </tr>
            </thead>
            <tbody>
              {listeExports.map((e) => (
                <tr key={e.id} data-export={e.id}>
                  <td className="whitespace-nowrap">{formaterHorodatage(e.creeLe)}</td>
                  <td>
                    {LIBELLE_STATUT_LOT[e.statut] ?? e.statut}
                    {e.erreur ? <span className="block text-sm break-words">{e.erreur}</span> : null}
                  </td>
                  <td>
                    <MentionProjet>{e.mention === 'projet' ? 'Projet' : `Projet (${e.mention})`}</MentionProjet>
                  </td>
                  <td className="tabular-nums">{e.versionDonnees}</td>
                  <td>
                    {e.statut === 'termine' ? (
                      <span className="flex flex-wrap gap-3">
                        {/* Téléchargements relayés par le BFF : liens simples, sans préchargement. */}
                        <a href={`/api/bff/v1/dossiers-revision/${e.id}/pdf`} download>
                          PDF (projet)
                        </a>
                        <a href={`/api/bff/v1/dossiers-revision/${e.id}/donnees`} download>
                          Données (projet)
                        </a>
                      </span>
                    ) : (
                      <span className="text-texte-doux">Non disponible</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        ) : exports.ok ? (
          <p className="text-texte-doux">Aucun dossier de révision généré pour cet exercice.</p>
        ) : null}
      </Carte>
    </div>
  );
}
