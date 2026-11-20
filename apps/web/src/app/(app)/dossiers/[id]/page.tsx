import type { Metadata } from 'next';
import Link from 'next/link';
import { EtiquetteStatutDocument } from '@/components/document/affichage';
import { DepotOrdinateur } from '@/components/envoi-ordinateur';
import { ErreurAcces } from '@/components/erreurs';
import { Carte, Etiquette, SousTitre, Tableau } from '@/components/ui/base';
import { cn } from '@/lib/cn';
import { LIBELLE_NATURE, LIBELLE_STATUT_DOCUMENT, ORDRE_STATUTS_DOCUMENT } from '@/lib/libelles';
import { formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { ServiceFerme } from '@/components/service-ferme';
import { lireSituation, parametre } from '@/lib/serveur/donnees';
import { contexteDossier } from '@/lib/serveur/dossier';
import { type ListeDocuments, type StatutDocument, auMoins } from '@/lib/types-api';
import { estRemplacee, sansRemplacees } from '@/lib/versions';

export const metadata: Metadata = { title: 'Pièces du dossier' };

export default async function PagePieces({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null; // la mise en page du dossier affiche déjà le refus
  const sp = await searchParams;
  const filtre = parametre(sp.statut);
  const statut = (ORDRE_STATUTS_DOCUMENT as readonly string[]).includes(filtre ?? '') && filtre !== 'remplace' ? (filtre as StatutDocument) : undefined;
  // Les versions remplacées sont masquées par défaut : elles restent consultables sur demande et depuis la pièce qui les remplace.
  const masquer = parametre(sp.remplacees) !== 'afficher';
  const page = Math.max(1, Number.parseInt(parametre(sp.page) ?? '1', 10) || 1);
  const r = await tenter<ListeDocuments>(`v1/documents?entiteId=${id}`);
  if (!r.ok) return <ErreurAcces statut={r.statut} message={r.message} retour="/dossiers" />;
  // Tant que le dossier tient sur une page de l'API, tout est connu : décomptes exacts et tri par urgence.
  // Au-delà, le filtre et la pagination sont faits par le serveur, et les décomptes ne sont plus affichés.
  const complet = !r.donnees.suite;
  const courante = complet ? r : await tenter<ListeDocuments>(`v1/documents?entiteId=${id}&page=${page}${statut ? `&statut=${statut}` : ''}`);
  if (!courante.ok) return <ErreurAcces statut={courante.statut} message={courante.message} retour="/dossiers" />;
  const tous = sansRemplacees(r.donnees.documents, masquer);
  const nbRemplacees = r.donnees.documents.filter(estRemplacee).length;
  const comptes = new Map<StatutDocument, number>();
  for (const d of tous) comptes.set(d.statut, (comptes.get(d.statut) ?? 0) + 1);
  const rang = (s: StatutDocument) => ORDRE_STATUTS_DOCUMENT.indexOf(s);
  const affiches = complet ? tous.filter((d) => !statut || d.statut === statut).sort((a, b) => rang(a.statut) - rang(b.statut) || b.creeLe.localeCompare(a.creeLe)) : sansRemplacees(courante.donnees.documents, masquer);
  const situation = await lireSituation();
  const ferme = situation && !situation.serviceOuvert ? situation.situation : null;
  const base = `/dossiers/${id}`;
  const nombre = (n: number) => (complet ? ` (${n})` : '');
  const suffixe = masquer ? '' : 'remplacees=afficher';
  const lien = (q: string) => `${base}${q || suffixe ? '?' : ''}${[q, suffixe].filter(Boolean).join('&')}`;
  const lienPage = (p: number) => lien(`page=${p}${statut ? `&statut=${statut}` : ''}`);
  const styleFiltre = (actif: boolean) => cn('inline-flex min-h-11 items-center rounded-lg border border-bordure px-3 text-texte no-underline hover:bg-surface-2', actif && 'border-primaire bg-surface-2 font-semibold');

  return (
    <div className="space-y-6">
      {ferme ? (
        <ServiceFerme situation={ferme} />
      ) : (
        <Carte>
          <DepotOrdinateur entiteId={id} />
        </Carte>
      )}
      <section aria-labelledby="titre-file" className="space-y-3">
        <SousTitre id="titre-file">File des pièces</SousTitre>
        <nav aria-label="Filtrer par statut">
          <ul className="flex flex-wrap gap-2">
            <li>
              <Link href={lien('')} prefetch={false} aria-current={!statut ? 'true' : undefined} className={styleFiltre(!statut)}>
                Toutes{nombre(tous.length)}
              </Link>
            </li>
            {ORDRE_STATUTS_DOCUMENT.filter((s) => s !== 'remplace').map((s) => (
              <li key={s}>
                <Link href={lien(`statut=${s}`)} prefetch={false} aria-current={statut === s ? 'true' : undefined} className={styleFiltre(statut === s)}>
                  {LIBELLE_STATUT_DOCUMENT[s]}{nombre(comptes.get(s) ?? 0)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="filtre-remplacees">
          <Link
            href={`${base}?${[statut ? `statut=${statut}` : '', masquer ? 'remplacees=afficher' : ''].filter(Boolean).join('&')}`}
            prefetch={false}
            aria-current={masquer ? 'true' : undefined}
            className={styleFiltre(masquer)}
          >
            Masquer les versions remplacées
          </Link>
          <span className="text-texte-doux">
            {masquer
              ? complet && nbRemplacees
                ? `${nbRemplacees} version${nbRemplacees > 1 ? 's' : ''} remplacée${nbRemplacees > 1 ? 's' : ''} masquée${nbRemplacees > 1 ? 's' : ''} (conservée${nbRemplacees > 1 ? 's' : ''} pour mémoire).`
                : 'Filtre actif : seules les versions courantes sont listées.'
              : 'Les versions remplacées sont affichées, pour mémoire.'}
          </span>
        </p>
        {affiches.length ? (
          <Tableau legende="Pièces du dossier">
            <thead>
              <tr>
                <th scope="col">Pièce</th>
                <th scope="col">Statut</th>
                <th scope="col">Nature</th>
                <th scope="col">Reçue le</th>
                <th scope="col">Réceptions</th>
              </tr>
            </thead>
            <tbody>
              {affiches.map((d) => (
                <tr key={d.id} data-version={d.version} data-remplacee={estRemplacee(d) ? 'oui' : undefined} className={estRemplacee(d) ? 'bg-surface-2 text-texte-doux' : undefined}>
                  <th scope="row" className="!bg-transparent font-medium">
                    <Link href={`${base}/pieces/${d.id}`} prefetch={false} className={cn('break-all', estRemplacee(d) && 'line-through')}>
                      {d.nomOrigine}
                    </Link>
                    {d.version > 1 ? <Etiquette className="ml-2">Version {d.version}</Etiquette> : null}
                    {d.motifStatut ? <span className="block text-sm font-normal break-words text-texte-doux">{d.motifStatut}</span> : null}
                  </th>
                  <td>
                    <EtiquetteStatutDocument statut={d.statut} />
                    {d.demandesOuvertes > 0 ? <Etiquette ton="attention" className="ml-1">Complément demandé</Etiquette> : null}
                  </td>
                  <td>{LIBELLE_NATURE[d.nature] ?? d.nature}</td>
                  <td className="whitespace-nowrap">{formaterHorodatage(d.creeLe)}</td>
                  <td>{d.nbReceptions}</td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        ) : (
          <p className="text-texte-doux">Aucune pièce {statut ? 'dans ce statut' : 'dans ce dossier'}.</p>
        )}
        {auMoins(ctx.niveau, 'collaboration') ? (
          <p className="text-sm" data-testid="lien-reanalyse-destinataire">
            <Link href={`${base}/reanalyse-destinataire`} prefetch={false}>
              Réanalyse du destinataire des anciennes pièces
            </Link>{' '}
            — explicite, par lot, avec aperçu avant exécution.
          </p>
        ) : null}
        {!complet ? (
          <nav aria-label="Pagination des pièces" className="flex flex-wrap items-center gap-3">
            {page > 1 ? <Link href={lienPage(page - 1)} prefetch={false} rel="prev">← Plus récentes</Link> : <span className="text-texte-doux">← Plus récentes</span>}
            <span>
              Page {page} ({courante.donnees.taillePage} par page)
            </span>
            {courante.donnees.suite ? <Link href={lienPage(page + 1)} prefetch={false} rel="next">Plus anciennes →</Link> : <span className="text-texte-doux">Plus anciennes →</span>}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
