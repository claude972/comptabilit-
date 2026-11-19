import type { Metadata } from 'next';
import Link from 'next/link';
import { ErreurAcces } from '@/components/erreurs';
import { Etiquette, Libelle, Saisie, Tableau, Titre } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { libelleTerritoire } from '@/lib/administration';
import { LIBELLE_NIVEAU } from '@/lib/libelles';
import { estDeposant, lireDossiers, lireMoi, parametre } from '@/lib/serveur/donnees';
import { auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Dossiers' };

const PAR_PAGE = 50;
const sansAccents = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export default async function PageDossiers({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const moi = await lireMoi();
  if (!moi.ok) return <ErreurAcces statut={moi.statut} message={moi.message} />;
  if (estDeposant(moi.donnees.role)) return <ErreurAcces statut={403} retour="/deposer" />;
  const dossiers = await lireDossiers();
  if (!dossiers.ok) return <ErreurAcces statut={dossiers.statut} message={dossiers.message} />;
  const q = (parametre(sp.q) ?? '').trim().slice(0, 80);
  const seulementHabilites = parametre(sp.habilites) === '1';
  const filtres = dossiers.donnees.filter((d) => (!q || sansAccents(d.raisonSociale).includes(sansAccents(q))) && (!seulementHabilites || d.niveau !== null));
  const pages = Math.max(1, Math.ceil(filtres.length / PAR_PAGE));
  const page = Math.min(pages, Math.max(1, Number(parametre(sp.page)) || 1));
  const visibles = filtres.slice((page - 1) * PAR_PAGE, page * PAR_PAGE);
  const lienPage = (n: number) => `/dossiers?${new URLSearchParams({ ...(q ? { q } : {}), ...(seulementHabilites ? { habilites: '1' } : {}), page: String(n) })}`;
  return (
    <div className="space-y-4">
      <Titre>Dossiers</Titre>
      <form method="get" action="/dossiers" role="search" aria-label="Rechercher un dossier" className="flex flex-wrap items-end gap-3">
        <div>
          <Libelle htmlFor="recherche-dossier">Nom du dossier</Libelle>
          <Saisie id="recherche-dossier" name="q" type="search" defaultValue={q} maxLength={80} className="min-w-64" />
        </div>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" name="habilites" value="1" defaultChecked={seulementHabilites} />
          <span>Seulement ceux où je suis habilité</span>
        </label>
        <Bouton type="submit" variante="secondaire">
          Rechercher
        </Bouton>
      </form>
      <p className="text-texte-doux" data-testid="decompte-dossiers" role="status">
        {filtres.length} dossier{filtres.length > 1 ? 's' : ''}
        {q || seulementHabilites ? ` sur ${dossiers.donnees.length}` : ''}
        {pages > 1 ? ` — page ${page} sur ${pages}` : ''}
      </p>
      <Tableau legende="Dossiers du cabinet et niveau d’habilitation">
        <thead>
          <tr>
            <th scope="col">Dossier</th>
            <th scope="col">Forme</th>
            <th scope="col">Régime fiscal</th>
            <th scope="col">Territoire fiscal</th>
            <th scope="col">Votre habilitation</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((d) => (
            <tr key={d.id} data-dossier={d.id}>
              <th scope="row" className="!bg-transparent font-medium">
                {/* Sans habilitation : le dossier est seulement nommé, sans lien (l'API en refuse le contenu). */}
                {auMoins(d.niveau, 'lecture') ? (
                  <Link href={`/dossiers/${d.id}`} prefetch={false}>
                    {d.raisonSociale}
                  </Link>
                ) : (
                  d.raisonSociale
                )}
              </th>
              <td>{d.formeJuridique ?? '—'}</td>
              <td>{d.regimeFiscal ?? '—'}</td>
              <td>{libelleTerritoire(d.territoireFiscal)}</td>
              <td>{d.niveau ? <Etiquette ton="info">{LIBELLE_NIVEAU[d.niveau]}</Etiquette> : <Etiquette ton="vide">Non habilité</Etiquette>}</td>
            </tr>
          ))}
        </tbody>
      </Tableau>
      {filtres.length === 0 ? <p className="text-texte-doux">{dossiers.donnees.length === 0 ? 'Aucun dossier.' : 'Aucun dossier ne correspond à cette recherche.'}</p> : null}
      {pages > 1 ? (
        <nav aria-label="Pages de la liste des dossiers" className="flex flex-wrap items-center gap-4">
          {page > 1 ? (
            <Link href={lienPage(page - 1)} prefetch={false}>
              ← Page précédente
            </Link>
          ) : null}
          <span>
            Page {page} sur {pages}
          </span>
          {page < pages ? (
            <Link href={lienPage(page + 1)} prefetch={false}>
              Page suivante →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
