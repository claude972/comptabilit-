import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { BoutonDeconnexion } from '@/components/deconnexion';
import { type LienNavigation, Navigation } from '@/components/navigation';
import { Alerte, Carte, Titre } from '@/components/ui/base';
import { LIBELLE_ROLE } from '@/lib/libelles';
import { estGestionnaire } from '@/lib/messagerie';
import { estDeposant, lireMoi } from '@/lib/serveur/donnees';
import { lireSession } from '@/lib/serveur/session';

export const dynamic = 'force-dynamic';

export default async function MiseEnPage({ children }: { children: ReactNode }) {
  const moi = await lireMoi();
  // Compte membre de plusieurs cabinets sans choix fait : l'API demande de préciser le cabinet.
  if (!moi.ok && moi.statut === 400) redirect('/cabinet');
  if (!moi.ok) {
    // Compte authentifié mais non rattaché (403), plusieurs cabinets sans choix (400), ou API indisponible.
    return (
      <main id="contenu" className="mx-auto max-w-xl space-y-4 p-4">
        <Titre>Comtaple</Titre>
        <Carte className="space-y-3">
          <Alerte ton={moi.statut >= 500 ? 'attention' : 'danger'} role="alert" titre={moi.statut >= 500 ? 'Service momentanément indisponible' : 'Accès impossible avec ce compte'}>
            <p>{moi.statut >= 500 ? 'Vos données ne peuvent pas être chargées pour l’instant. Merci de réessayer dans quelques instants.' : moi.message}</p>
          </Alerte>
          <BoutonDeconnexion />
        </Carte>
      </main>
    );
  }
  const { utilisateur, cabinet, role } = moi.donnees;
  const session = await lireSession(await cookies());
  // Un déposant n'a aucun lien vers l'espace cabinet ; l'API lui en refuse de toute façon l'accès.
  const liens: LienNavigation[] = estDeposant(role)
    ? [
        { href: '/deposer', libelle: 'Déposer' },
        { href: '/depots', libelle: 'Mes dépôts' },
      ]
    : [
        { href: '/', libelle: 'Tableau de bord' },
        { href: '/dossiers', libelle: 'Dossiers' },
        { href: '/deposer', libelle: 'Déposer' },
        { href: '/depots', libelle: 'Pièces déposées' },
        { href: '/reference/controles', libelle: 'Catalogue des contrôles' },
        ...(estGestionnaire(role) ? [{ href: '/administration', libelle: 'Administration' }] : []),
        // Connexions de messagerie : gestionnaires du cabinet uniquement (l'API refuse les autres rôles).
        ...(estGestionnaire(role) ? [{ href: '/messagerie', libelle: 'Messagerie' }] : []),
      ];
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-bordure bg-surface pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 sm:px-4">
          <Link href={estDeposant(role) ? '/deposer' : '/'} prefetch={false} className="flex min-h-11 items-center gap-2 text-lg font-semibold text-texte no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icones/icone-192.png" alt="" width={28} height={28} className="rounded-md" />
            Comtaple
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {session?.cabinet ? (
              <Link href="/cabinet" prefetch={false} className="inline-flex min-h-11 items-center text-sm">
                Changer de cabinet
              </Link>
            ) : null}
            <p className="text-right text-sm leading-tight">
              <span className="block font-medium" data-testid="utilisateur">{utilisateur.nom}</span>
              <span className="block text-texte-doux">
                {LIBELLE_ROLE[role] ?? role} · {cabinet?.nom}
              </span>
            </p>
            <BoutonDeconnexion />
          </div>
          <div className="w-full">
            <Navigation liens={liens} />
          </div>
        </div>
      </header>
      <main id="contenu" className="mx-auto w-full max-w-7xl grow px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-4">
        {children}
      </main>
    </div>
  );
}
