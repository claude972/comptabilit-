import Link from 'next/link';
import type { ReactNode } from 'react';
import { ErreurAcces } from '@/components/erreurs';
import { Onglets } from '@/components/navigation';
import { Etiquette, Titre } from '@/components/ui/base';
import { LIBELLE_NIVEAU } from '@/lib/libelles';
import { contexteDossier } from '@/lib/serveur/dossier';

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
        ]}
      />
      {children}
    </div>
  );
}
