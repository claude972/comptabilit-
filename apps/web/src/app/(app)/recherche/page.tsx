import type { Metadata } from 'next';
import Link from 'next/link';
import { EtiquetteStatutDocument } from '@/components/document/affichage';
import { ErreurAcces } from '@/components/erreurs';
import { ExtraitSurligne } from '@/components/extrait';
import { EtiquetteStatutRevue } from '@/components/revision-affichage';
import { Alerte, Libelle, Saisie, SousTitre, Titre } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { formaterDate, formaterMontant } from '@/lib/montants';
import { LONGUEUR_MAX_RECHERCHE, LONGUEUR_MIN_RECHERCHE, type ResultatsRecherchePortefeuille, requeteValide } from '@/lib/recherche';
import { tenter } from '@/lib/serveur/api';
import { estDeposant, lireMoi, parametre } from '@/lib/serveur/donnees';

export const metadata: Metadata = { title: 'Recherche' };

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/**
 * Recherche textuelle sur le portefeuille : les dossiers où la personne a au moins le niveau « lecture » (périmètre calculé par
 * la base, jamais par cet écran), résultats groupés par dossier. Les extraits de pièces sont des données non fiables, rendues en
 * texte brut. Les dossiers sans résultat ne sont pas listés, seulement décomptés.
 */
export default async function PageRecherchePortefeuille({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const moi = await lireMoi();
  if (!moi.ok) return <ErreurAcces statut={moi.statut} message={moi.message} />;
  if (estDeposant(moi.donnees.role)) return <ErreurAcces statut={403} message="La recherche sur plusieurs dossiers n’est pas ouverte aux déposants." retour="/deposer" />;
  const sp = await searchParams;
  const saisie = (parametre(sp.q) ?? '').slice(0, 400);
  const q = requeteValide(saisie);
  const page = Math.min(1_000, Math.max(1, Number.parseInt(parametre(sp.page) ?? '1', 10) || 1));
  const r = q ? await tenter<ResultatsRecherchePortefeuille>(`v1/recherche?q=${encodeURIComponent(q)}&page=${page}`) : null;
  if (r && !r.ok && r.statut !== 400 && r.statut !== 503) return <ErreurAcces statut={r.statut} message={r.message} />;
  const lien = (p: number) => `/recherche?q=${encodeURIComponent(q ?? '')}&page=${p}`;

  return (
    <div className="space-y-5">
      <Titre>Recherche</Titre>
      <p className="text-sm text-texte-doux">
        Recherche textuelle (mots du français), sans intelligence artificielle, dans les pièces, les écritures du lot actif et les constats de la dernière exécution des dossiers où vous avez au moins le niveau « lecture ». Les extraits sont des contenus de pièces,
        affichés tels quels en texte brut.
      </p>
      <form key={saisie} method="get" role="search" aria-label="Recherche dans mes dossiers" className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 grow">
          <Libelle htmlFor="q">Rechercher dans tous mes dossiers</Libelle>
          <Saisie id="q" type="search" name="q" defaultValue={saisie} minLength={LONGUEUR_MIN_RECHERCHE} maxLength={LONGUEUR_MAX_RECHERCHE} required />
        </div>
        <Bouton type="submit">Rechercher</Bouton>
      </form>

      {!q ? (
        <Alerte ton={saisie.trim() ? 'attention' : 'neutre'} data-testid="recherche-invalide">
          Saisissez de {LONGUEUR_MIN_RECHERCHE} à {LONGUEUR_MAX_RECHERCHE} caractères.
        </Alerte>
      ) : r && !r.ok ? (
        <Alerte ton="attention" data-testid="recherche-invalide">
          {r.message}
        </Alerte>
      ) : r?.ok ? (
        <>
          <section aria-label="Synthèse de la recherche" className="space-y-1" data-testid="synthese-recherche">
            <p>
              Résultats pour « <strong className="break-words">{r.donnees.requete}</strong> » : {pluriel(r.donnees.dossiersAvecResultats, 'dossier')} avec résultat sur {r.donnees.dossiersAutorises} autorisé{r.donnees.dossiersAutorises > 1 ? 's' : ''}.
            </p>
            <p className="text-sm text-texte-doux" data-testid="dossiers-sans-resultat">
              {r.donnees.dossiersSansResultat === 0
                ? 'Aucun dossier autorisé sans résultat.'
                : `${pluriel(r.donnees.dossiersSansResultat, 'dossier')} autorisé${r.donnees.dossiersSansResultat > 1 ? 's' : ''} sans résultat (non listé${r.donnees.dossiersSansResultat > 1 ? 's' : ''}).`}
            </p>
            <p className="text-sm text-texte-doux">
              Par dossier, les {r.donnees.limites.piecesParDossier} meilleures pièces, {r.donnees.limites.ecrituresParDossier} écritures et {r.donnees.limites.constatsParDossier} constats au plus sont montrés, avec le total trouvé. Dossiers classés par nombre de résultats.
            </p>
          </section>

          {r.donnees.dossiers.length === 0 ? (
            <Alerte ton="neutre" data-testid="aucun-resultat">
              {r.donnees.dossiersAvecResultats === 0 ? 'Aucun résultat dans vos dossiers.' : 'Cette page ne contient plus de dossier : revenez à la première page.'}
            </Alerte>
          ) : null}

          <ul className="space-y-4" aria-label="Dossiers avec résultats">
            {r.donnees.dossiers.map((d) => {
              const base = `/dossiers/${d.id}`;
              const idTitre = `titre-d-${d.id}`;
              return (
                <li key={d.id} data-resultat-dossier={d.id}>
                  <section aria-labelledby={idTitre} className="space-y-3 rounded-lg border border-bordure bg-surface p-3">
                    <div className="space-y-1">
                      <SousTitre id={idTitre}>
                        <Link href={base} prefetch={false} className="break-words">
                          {d.nom}
                        </Link>
                      </SousTitre>
                      <p className="text-sm text-texte-doux" data-testid="totaux-dossier">
                        {pluriel(d.totaux.pieces, 'pièce')} · {pluriel(d.totaux.ecritures, 'écriture')} · {pluriel(d.totaux.constats, 'constat')} trouvé{d.totaux.pieces + d.totaux.ecritures + d.totaux.constats > 1 ? 's' : ''}.{' '}
                        <Link href={`${base}/recherche?q=${encodeURIComponent(r.donnees.requete)}`} prefetch={false}>
                          Voir tous les résultats dans ce dossier
                        </Link>
                      </p>
                    </div>

                    {d.pieces.length ? (
                      <div data-groupe="pieces" className="space-y-1">
                        <p className="font-medium">
                          Pièces ({d.pieces.length}
                          {d.totaux.pieces > d.pieces.length ? ` affichées sur ${d.totaux.pieces}` : ''})
                        </p>
                        <ul className="space-y-2">
                          {d.pieces.map((p, i) => (
                            <li key={`${p.documentId}-${p.page}-${i}`} className="space-y-1 rounded-lg border border-bordure p-2" data-resultat-piece={p.documentId}>
                              <p className="flex flex-wrap items-center gap-2">
                                <Link href={`${base}/pieces/${p.documentId}`} prefetch={false} className="font-medium break-all">
                                  {p.nomOrigine}
                                </Link>
                                <span className="text-sm text-texte-doux">page {p.page}</span>
                                <EtiquetteStatutDocument statut={p.statut} />
                              </p>
                              <p className="text-sm">
                                <ExtraitSurligne extrait={p.extrait ?? ''} />
                              </p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {d.ecritures.length ? (
                      <div data-groupe="ecritures" className="space-y-1">
                        <p className="font-medium">
                          Écritures ({d.ecritures.length}
                          {d.totaux.ecritures > d.ecritures.length ? ` affichées sur ${d.totaux.ecritures}` : ''})
                        </p>
                        <ul className="space-y-1 text-sm">
                          {d.ecritures.map((e) => (
                            <li key={e.id} className="rounded-lg border border-bordure p-2 break-words" data-resultat-ecriture={e.id}>
                              <span className="whitespace-nowrap">{formaterDate(e.date)}</span> · journal {e.journal} · n° <span className="break-all">{e.numero}</span> · compte <span className="font-mono">{e.compte}</span> · pièce <span className="break-all">{e.piece}</span> —{' '}
                              {e.libelle} · débit <span className="tabular-nums">{formaterMontant(e.debit)}</span> · crédit <span className="tabular-nums">{formaterMontant(e.credit)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {d.constats.length ? (
                      <div data-groupe="constats" className="space-y-1">
                        <p className="font-medium">
                          Constats ({d.constats.length}
                          {d.totaux.constats > d.constats.length ? ` affichés sur ${d.totaux.constats}` : ''})
                        </p>
                        <ul className="space-y-2">
                          {d.constats.map((c) => (
                            <li key={c.id} className="rounded-lg border border-bordure p-2" data-resultat-constat={c.id}>
                              <p className="flex flex-wrap items-center gap-2">
                                <EtiquetteStatutRevue statut={c.statutRevue} />
                                <span className="font-mono text-sm">{c.controleId}</span>
                                {c.montant !== null ? <span className="text-sm tabular-nums">Montant : {formaterMontant(c.montant)}</span> : null}
                              </p>
                              <p className="mt-1 font-medium">
                                <Link href={`${base}/revision/constats/${c.id}`} prefetch={false} className="break-words">
                                  {c.titre}
                                </Link>
                              </p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </section>
                </li>
              );
            })}
          </ul>

          {r.donnees.dossiersAvecResultats > r.donnees.dossiersParPage ? (
            <nav aria-label="Pages de résultats" className="flex flex-wrap items-center gap-3" data-testid="pagination-recherche">
              {page > 1 ? (
                <Link href={lien(page - 1)} prefetch={false} className="inline-flex min-h-11 items-center">
                  Page précédente
                </Link>
              ) : null}
              <span className="text-sm text-texte-doux">
                Page {page} sur {Math.ceil(r.donnees.dossiersAvecResultats / r.donnees.dossiersParPage)}
              </span>
              {page * r.donnees.dossiersParPage < r.donnees.dossiersAvecResultats ? (
                <Link href={lien(page + 1)} prefetch={false} className="inline-flex min-h-11 items-center">
                  Page suivante
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
