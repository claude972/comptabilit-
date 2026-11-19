import type { Metadata } from 'next';
import Link from 'next/link';
import { EtiquetteStatutDocument } from '@/components/document/affichage';
import { ErreurAcces } from '@/components/erreurs';
import { Alerte, Carte, Etiquette, SousTitre, Titre } from '@/components/ui/base';
import { styleBouton } from '@/components/ui/bouton';
import { LIBELLE_NATURE } from '@/lib/libelles';
import { formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { estDeposant, lireDossiers, lireMoi } from '@/lib/serveur/donnees';
import type { DocumentListe, ListeDocuments } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Mes dépôts' };

type Ligne = DocumentListe & { dossier: string };

function Piece({ d }: { d: Ligne }) {
  return (
    <li className="rounded-lg border border-bordure bg-surface">
      <Link href={`/depots/${d.id}`} prefetch={false} className="block min-h-11 space-y-1 p-3 text-texte no-underline hover:bg-surface-2">
        <span className="flex flex-wrap items-center gap-2">
          <EtiquetteStatutDocument statut={d.statut} />
          {d.demandesOuvertes > 0 ? <Etiquette ton="attention">Complément demandé</Etiquette> : null}
          <span className="font-medium break-all">{d.nomOrigine}</span>
        </span>
        <span className="block text-sm text-texte-doux">
          {d.dossier} · {LIBELLE_NATURE[d.nature] ?? d.nature} · déposé le {formaterHorodatage(d.creeLe)}
        </span>
        {d.motifStatut ? <span className="block text-sm break-words">{d.motifStatut}</span> : null}
      </Link>
    </li>
  );
}

export default async function PageDepots() {
  const [moi, dossiers] = await Promise.all([lireMoi(), lireDossiers()]);
  if (!moi.ok) return <ErreurAcces statut={moi.statut} message={moi.message} />;
  if (!dossiers.ok) return <ErreurAcces statut={dossiers.statut} message={dossiers.message} />;
  const deposant = estDeposant(moi.donnees.role);
  const autorises = dossiers.donnees.filter((d) => d.niveau !== null);
  const listes = await Promise.all(autorises.map(async (d) => ({ dossier: d, liste: await tenter<ListeDocuments>(`v1/documents?entiteId=${d.id}`) })));
  const indisponibles = listes.filter((l) => !l.liste.ok).map((l) => l.dossier.raisonSociale);
  const pieces: Ligne[] = listes
    .flatMap((l) => (l.liste.ok ? l.liste.donnees.documents.map((doc) => ({ ...doc, dossier: l.dossier.raisonSociale })) : []))
    .sort((a, b) => b.creeLe.localeCompare(a.creeLe));
  // Les demandes de complément passent en premier : elles attendent une action du déposant.
  const aCompleter = pieces.filter((p) => p.demandesOuvertes > 0 || p.statut === 'a_completer');
  const autres = pieces.filter((p) => !aCompleter.includes(p));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Titre>{deposant ? 'Mes dépôts' : 'Pièces déposées'}</Titre>
        <Link href="/deposer" prefetch={false} className={styleBouton()}>
          Déposer une pièce
        </Link>
      </div>
      {!deposant ? <p className="text-texte-doux">Pièces des dossiers sur lesquels vous êtes habilité, tous déposants confondus.</p> : null}
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
