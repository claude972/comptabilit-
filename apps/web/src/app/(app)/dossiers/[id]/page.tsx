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
import type { ListeDocuments, StatutDocument } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Pièces du dossier' };

export default async function PagePieces({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null; // la mise en page du dossier affiche déjà le refus
  const sp = await searchParams;
  const filtre = parametre(sp.statut);
  const statut = (ORDRE_STATUTS_DOCUMENT as readonly string[]).includes(filtre ?? '') ? (filtre as StatutDocument) : undefined;
  const page = Math.max(1, Number.parseInt(parametre(sp.page) ?? '1', 10) || 1);
  const r = await tenter<ListeDocuments>(`v1/documents?entiteId=${id}`);
  if (!r.ok) return <ErreurAcces statut={r.statut} message={r.message} retour="/dossiers" />;
  // Tant que le dossier tient sur une page de l'API, tout est connu : décomptes exacts et tri par urgence.
  // Au-delà, le filtre et la pagination sont faits par le serveur, et les décomptes ne sont plus affichés.
  const complet = !r.donnees.suite;
  const courante = complet ? r : await tenter<ListeDocuments>(`v1/documents?entiteId=${id}&page=${page}${statut ? `&statut=${statut}` : ''}`);
  if (!courante.ok) return <ErreurAcces statut={courante.statut} message={courante.message} retour="/dossiers" />;
  const tous = r.donnees.documents;
  const comptes = new Map<StatutDocument, number>();
  for (const d of tous) comptes.set(d.statut, (comptes.get(d.statut) ?? 0) + 1);
  const rang = (s: StatutDocument) => ORDRE_STATUTS_DOCUMENT.indexOf(s);
  const affiches = complet ? tous.filter((d) => !statut || d.statut === statut).sort((a, b) => rang(a.statut) - rang(b.statut) || b.creeLe.localeCompare(a.creeLe)) : courante.donnees.documents;
  const situation = await lireSituation();
  const ferme = situation && !situation.serviceOuvert ? situation.situation : null;
  const base = `/dossiers/${id}`;
  const nombre = (n: number) => (complet ? ` (${n})` : '');
  const lienPage = (p: number) => `${base}?page=${p}${statut ? `&statut=${statut}` : ''}`;
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
              <Link href={base} prefetch={false} aria-current={!statut ? 'true' : undefined} className={styleFiltre(!statut)}>
                Toutes{nombre(tous.length)}
              </Link>
            </li>
            {ORDRE_STATUTS_DOCUMENT.map((s) => (
              <li key={s}>
                <Link href={`${base}?statut=${s}`} prefetch={false} aria-current={statut === s ? 'true' : undefined} className={styleFiltre(statut === s)}>
                  {LIBELLE_STATUT_DOCUMENT[s]}{nombre(comptes.get(s) ?? 0)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
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
                <tr key={d.id}>
                  <th scope="row" className="!bg-transparent font-medium">
                    <Link href={`${base}/pieces/${d.id}`} prefetch={false} className="break-all">
                      {d.nomOrigine}
                    </Link>
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
