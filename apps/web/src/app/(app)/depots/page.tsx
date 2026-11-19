import type { Metadata } from 'next';
import Link from 'next/link';
import { EtiquetteStatutDocument } from '@/components/document/affichage';
import { ErreurAcces } from '@/components/erreurs';
import { Alerte, Carte, Etiquette, SousTitre, Titre } from '@/components/ui/base';
import { styleBouton } from '@/components/ui/bouton';
import { cn } from '@/lib/cn';
import { LIBELLE_NATURE } from '@/lib/libelles';
import { formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { estDeposant, lireDossiers, lireMoi, parametre } from '@/lib/serveur/donnees';
import type { DocumentListe, ListeDocuments } from '@/lib/types-api';
import { estRemplacee, sansRemplacees } from '@/lib/versions';

export const metadata: Metadata = { title: 'Mes dépôts' };

type Ligne = DocumentListe & { dossier: string };

function Piece({ d }: { d: Ligne }) {
  return (
    <li className={cn('rounded-lg border border-bordure bg-surface', estRemplacee(d) && 'border-dashed bg-surface-2')} data-version={d.version} data-remplacee={estRemplacee(d) ? 'oui' : undefined}>
      <Link href={`/depots/${d.id}`} prefetch={false} className="block min-h-11 space-y-1 p-3 text-texte no-underline hover:bg-surface-2">
        <span className="flex flex-wrap items-center gap-2">
          <EtiquetteStatutDocument statut={d.statut} />
          {d.demandesOuvertes > 0 ? <Etiquette ton="attention">Complément demandé</Etiquette> : null}
          <span className={cn('font-medium break-all', estRemplacee(d) && 'text-texte-doux line-through')}>{d.nomOrigine}</span>
          {d.version > 1 ? <Etiquette>Version {d.version}</Etiquette> : null}
        </span>
        <span className="block text-sm text-texte-doux">
          {d.dossier} · {LIBELLE_NATURE[d.nature] ?? d.nature} · déposé le {formaterHorodatage(d.creeLe)}
        </span>
        {d.motifStatut ? <span className="block text-sm break-words">{d.motifStatut}</span> : null}
      </Link>
    </li>
  );
}

export default async function PageDepots({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(parametre(sp.page) ?? '1', 10) || 1);
  const [moi, dossiers] = await Promise.all([lireMoi(), lireDossiers()]);
  if (!moi.ok) return <ErreurAcces statut={moi.statut} message={moi.message} />;
  if (!dossiers.ok) return <ErreurAcces statut={dossiers.statut} message={dossiers.message} />;
  const deposant = estDeposant(moi.donnees.role);
  const autorises = dossiers.donnees.filter((d) => d.niveau !== null);
  // « Mes dépôts » : toujours pour un déposant ; sur demande pour les autres rôles (filtre appliqué par l'API).
  const mesDepots = !deposant && parametre(sp.deposant) === 'moi';
  const listes = await Promise.all(autorises.map(async (d) => ({ dossier: d, liste: await tenter<ListeDocuments>(`v1/documents?entiteId=${d.id}&page=${page}${mesDepots ? '&deposant=moi' : ''}`) })));
  const suite = listes.some((l) => l.liste.ok && l.liste.donnees.suite);
  // Les versions remplacées sont masquées par défaut (elles restent accessibles depuis la version qui les remplace).
  const masquer = parametre(sp.remplacees) !== 'afficher';
  const lien = (p: number, moi = mesDepots, masque = masquer) => `/depots?page=${p}${moi ? '&deposant=moi' : ''}${masque ? '' : '&remplacees=afficher'}`;
  const indisponibles = listes.filter((l) => !l.liste.ok).map((l) => l.dossier.raisonSociale);
  const pieces: Ligne[] = listes
    .flatMap((l) => (l.liste.ok ? sansRemplacees(l.liste.donnees.documents, masquer).map((doc) => ({ ...doc, dossier: l.dossier.raisonSociale })) : []))
    .sort((a, b) => b.creeLe.localeCompare(a.creeLe));
  // Les demandes de complément passent en premier : elles attendent une action du déposant.
  const aCompleter = pieces.filter((p) => !estRemplacee(p) && (p.demandesOuvertes > 0 || p.statut === 'a_completer'));
  const autres = pieces.filter((p) => !aCompleter.includes(p));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Titre>{deposant ? 'Mes dépôts' : 'Pièces déposées'}</Titre>
        <Link href="/deposer" prefetch={false} className={styleBouton()}>
          Déposer une pièce
        </Link>
      </div>
      {!deposant ? (
        <nav aria-label="Filtrer par déposant" className="flex flex-wrap items-center gap-2" data-testid="filtre-deposant">
          <Link href={lien(1, false)} prefetch={false} aria-current={!mesDepots ? 'true' : undefined} className={styleBouton({ variante: !mesDepots ? 'secondaire' : 'contour' })}>
            Tous les déposants
          </Link>
          <Link href={lien(1, true)} prefetch={false} aria-current={mesDepots ? 'true' : undefined} className={styleBouton({ variante: mesDepots ? 'secondaire' : 'contour' })}>
            Mes dépôts
          </Link>
          <span className="text-sm text-texte-doux">Pièces des dossiers sur lesquels vous êtes habilité.</span>
        </nav>
      ) : null}
      <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="filtre-remplacees">
        <Link href={lien(1, mesDepots, !masquer)} prefetch={false} aria-current={masquer ? 'true' : undefined} className={styleBouton({ variante: masquer ? 'secondaire' : 'contour' })}>
          Masquer les versions remplacées
        </Link>
        <span className="text-texte-doux">{masquer ? 'Filtre actif : seules les versions courantes sont listées.' : 'Les versions remplacées sont affichées, pour mémoire.'}</span>
      </p>
      {indisponibles.length ? (
        <Alerte ton="attention" role="alert">
          Les pièces de certains dossiers n’ont pas pu être chargées : {indisponibles.join(', ')}.
        </Alerte>
      ) : null}
      {aCompleter.length ? (
        <Carte className="space-y-2 border-attention-texte" data-testid="depots-a-completer">
          <SousTitre>À compléter ({aCompleter.length})</SousTitre>
          <p className="text-sm text-texte-doux">Votre cabinet attend un complément ou une nouvelle photo pour ces pièces.</p>
          <ul className="space-y-2">
            {aCompleter.map((d) => (
              <Piece key={d.id} d={d} />
            ))}
          </ul>
        </Carte>
      ) : null}
      <section aria-labelledby="titre-autres" className="space-y-2">
        <SousTitre id="titre-autres">{aCompleter.length ? 'Autres pièces' : 'Pièces'} ({autres.length})</SousTitre>
        {autres.length ? (
          <ul className="space-y-2" data-testid="depots-autres">
            {autres.map((d) => (
              <Piece key={d.id} d={d} />
            ))}
          </ul>
        ) : (
          <p className="text-texte-doux">{pieces.length ? 'Aucune autre pièce.' : 'Aucune pièce déposée pour le moment.'}</p>
        )}
      </section>
      {page > 1 || suite ? (
        <nav aria-label="Pagination des pièces" className="flex flex-wrap items-center gap-3">
          {page > 1 ? <Link href={lien(page - 1)} prefetch={false} rel="prev">← Plus récentes</Link> : <span className="text-texte-doux">← Plus récentes</span>}
          <span>Page {page}</span>
          {suite ? <Link href={lien(page + 1)} prefetch={false} rel="next">Plus anciennes →</Link> : <span className="text-texte-doux">Plus anciennes →</span>}
        </nav>
      ) : null}
      <p className="text-sm text-texte-doux">
        Seules les pièces dont le serveur a confirmé la réception apparaissent ici. Un envoi encore en attente sur cet appareil se trouve dans l’écran{' '}
        <Link href="/deposer" prefetch={false}>
          Déposer
        </Link>
        .
      </p>
    </div>
  );
}
