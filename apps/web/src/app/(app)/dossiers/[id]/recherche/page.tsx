import type { Metadata } from 'next';
import Link from 'next/link';
import { EtiquetteStatutDocument } from '@/components/document/affichage';
import { ErreurAcces } from '@/components/erreurs';
import { ExtraitSurligne } from '@/components/extrait';
import { EtiquetteStatutRevue } from '@/components/revision-affichage';
import { Alerte, Libelle, Saisie, SousTitre, Tableau } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { formaterDate, formaterMontant } from '@/lib/montants';
import { LONGUEUR_MAX_RECHERCHE, LONGUEUR_MIN_RECHERCHE, type ResultatsRecherche, requeteValide } from '@/lib/recherche';
import { tenter } from '@/lib/serveur/api';
import { parametre } from '@/lib/serveur/donnees';
import { contexteDossier } from '@/lib/serveur/dossier';

export const metadata: Metadata = { title: 'Recherche dans le dossier' };

export default async function PageRecherche({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const saisie = (parametre((await searchParams).q) ?? '').slice(0, 400);
  const q = requeteValide(saisie);
  const r = q ? await tenter<ResultatsRecherche>(`v1/recherche?entiteId=${id}&q=${encodeURIComponent(q)}`) : null;
  if (r && !r.ok && r.statut !== 400) return <ErreurAcces statut={r.statut} message={r.message} retour={`/dossiers/${id}`} />;
  const base = `/dossiers/${id}`;

  return (
    <div className="space-y-5">
      <form key={saisie} method="get" role="search" aria-label="Recherche dans le dossier" className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 grow">
          <Libelle htmlFor="q">Rechercher dans les pièces, les écritures et les constats de ce dossier</Libelle>
          <Saisie id="q" type="search" name="q" defaultValue={saisie} minLength={LONGUEUR_MIN_RECHERCHE} maxLength={LONGUEUR_MAX_RECHERCHE} required />
        </div>
        <Bouton type="submit">Rechercher</Bouton>
      </form>
      {!q ? (
        <Alerte ton={saisie.trim() ? 'attention' : 'neutre'} data-testid="recherche-invalide">
          Saisissez de {LONGUEUR_MIN_RECHERCHE} à {LONGUEUR_MAX_RECHERCHE} caractères. La recherche est textuelle (mots du français), sans intelligence artificielle.
        </Alerte>
      ) : r && !r.ok ? (
        <Alerte ton="attention" data-testid="recherche-invalide">
          {r.message}
        </Alerte>
      ) : r?.ok ? (
        <>
          <p data-testid="perimetre">
            Résultats pour « <strong className="break-words">{r.donnees.requete}</strong> » — périmètre : {r.donnees.perimetre}.
          </p>
          <p className="text-sm text-texte-doux">Les extraits sont des contenus de pièces, affichés tels quels en texte brut. Les listes sont limitées aux premiers résultats.</p>

          <section aria-labelledby="titre-r-pieces" className="space-y-2" data-groupe="pieces">
            <SousTitre id="titre-r-pieces">Pièces ({r.donnees.pieces.length})</SousTitre>
            {r.donnees.pieces.length === 0 ? <p className="text-texte-doux">Aucune pièce ne contient ces termes.</p> : null}
            <ul className="space-y-2">
              {r.donnees.pieces.map((p, i) => (
                <li key={`${p.documentId}-${p.page}-${i}`} className="space-y-1 rounded-lg border border-bordure bg-surface p-3" data-resultat-piece={p.documentId}>
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
          </section>

          <section aria-labelledby="titre-r-ecritures" className="space-y-2" data-groupe="ecritures">
            <SousTitre id="titre-r-ecritures">Écritures ({r.donnees.ecritures.length})</SousTitre>
            {r.donnees.ecritures.length === 0 ? (
              <p className="text-texte-doux">Aucune écriture du lot actif ne contient ces termes.</p>
            ) : (
              <Tableau legende="Écritures trouvées">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Journal</th>
                    <th scope="col">N°</th>
                    <th scope="col">Compte</th>
                    <th scope="col">Pièce</th>
                    <th scope="col">Libellé</th>
                    <th scope="col" className="text-right">Débit</th>
                    <th scope="col" className="text-right">Crédit</th>
                  </tr>
                </thead>
                <tbody>
                  {r.donnees.ecritures.map((e) => (
                    <tr key={e.id} data-resultat-ecriture={e.id}>
                      <td className="whitespace-nowrap">{formaterDate(e.date)}</td>
                      <td>{e.journal}</td>
                      <td className="break-all">{e.numero}</td>
                      <td className="font-mono">{e.compte}</td>
                      <td className="break-all">{e.piece}</td>
                      <td className="break-words">{e.libelle}</td>
                      <td className="text-right tabular-nums">{formaterMontant(e.debit)}</td>
                      <td className="text-right tabular-nums">{formaterMontant(e.credit)}</td>
                    </tr>
                  ))}
                </tbody>
              </Tableau>
            )}
            {r.donnees.ecritures.length ? (
              <p className="text-sm">
                <Link href={`${base}/comptabilite`} prefetch={false}>
                  Ouvrir l’onglet Comptabilité du dossier
                </Link>
              </p>
            ) : null}
          </section>

          <section aria-labelledby="titre-r-constats" className="space-y-2" data-groupe="constats">
            <SousTitre id="titre-r-constats">Constats ({r.donnees.constats.length})</SousTitre>
            {r.donnees.constats.length === 0 ? <p className="text-texte-doux">Aucun constat de la dernière exécution ne contient ces termes.</p> : null}
            <ul className="space-y-2">
              {r.donnees.constats.map((c) => (
                <li key={c.id} className="rounded-lg border border-bordure bg-surface p-3" data-resultat-constat={c.id}>
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
          </section>
        </>
      ) : null}
    </div>
  );
}
