import Link from 'next/link';
import type { ReactNode } from 'react';
import { ErreurAcces } from '@/components/erreurs';
import { Onglets } from '@/components/navigation';
import { Etiquette, Libelle, Saisie, Titre } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { LIBELLE_NIVEAU } from '@/lib/libelles';
import { contexteDossier } from '@/lib/serveur/dossier';
import { auMoins } from '@/lib/types-api';

export default async function MiseEnPageDossier({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return <ErreurAcces statut={ctx.statut} message={ctx.message} retour="/dossiers" />;
  const base = `/dossiers/${ctx.dossier.id}`;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm">
          <Link href="/dossiers" prefetch={false}>
            Dossiers
          </Link>{' '}
          /
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Titre>{ctx.dossier.raisonSociale}</Titre>
          <Etiquette ton="info">Habilitation : {LIBELLE_NIVEAU[ctx.niveau]}</Etiquette>
          {/* Recherche dans le dossier : formulaire GET, fonctionne sans JavaScript ; la requête est dans l'URL de la page de résultats. */}
          <form method="get" action={`${base}/recherche`} role="search" aria-label="Rechercher dans ce dossier" className="ml-auto flex max-w-full flex-wrap items-end gap-2">
            {/* Sur un écran étroit, le champ se réduit et le bouton passe à la ligne : jamais de débordement horizontal. */}
            <div className="min-w-0 flex-1">
              <Libelle htmlFor="recherche-dossier" className="sr-only">
                Rechercher dans ce dossier (pièces, écritures, constats)
              </Libelle>
              <Saisie id="recherche-dossier" type="search" name="q" minLength={2} maxLength={200} placeholder="Rechercher dans ce dossier" className="w-full min-w-0 sm:min-w-72" required />
            </div>
            <Bouton type="submit" variante="secondaire">
              Chercher dans le dossier
            </Bouton>
          </form>
        </div>
      </div>
      <Onglets
        libelle="Sections du dossier"
        liens={[
          { href: base, libelle: 'Pièces' },
          { href: `${base}/comptabilite`, libelle: 'Comptabilité' },
          { href: `${base}/banque`, libelle: 'Banque' },
          { href: `${base}/revision`, libelle: 'Révision' },
          { href: `${base}/analyse`, libelle: 'Analyse' },
          { href: `${base}/inventaire`, libelle: 'Inventaire' },
          { href: `${base}/fiscal`, libelle: 'États fiscaux' },
          { href: `${base}/mission`, libelle: 'Mission' },
          { href: `${base}/veille`, libelle: 'Veille' },
          // Assistant documenté : à partir du niveau « lecture » (le layout refuse déjà le simple dépôt ; l'API vérifie).
          { href: `${base}/assistant`, libelle: 'Assistant' },
          // La restitution exige l'habilitation de validation : l'onglet n'est proposé qu'à ce niveau (l'API vérifie).
          ...(auMoins(ctx.niveau, 'validation') ? [{ href: `${base}/restitution`, libelle: 'Restitution' }] : []),
        ]}
      />
      {children}
    </div>
  );
}
