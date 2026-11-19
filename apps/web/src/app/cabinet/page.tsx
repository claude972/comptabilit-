import type { Metadata } from 'next';
import { BoutonDeconnexion } from '@/components/deconnexion';
import { Alerte, Carte, Titre } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import type { Cabinet } from '@/lib/administration';
import { LIBELLE_ROLE } from '@/lib/libelles';
import { tenter } from '@/lib/serveur/api';

export const metadata: Metadata = { title: 'Choix du cabinet' };
export const dynamic = 'force-dynamic';

/** Écran de choix du cabinet (compte membre de plusieurs cabinets). Formulaires HTML simples : fonctionne sans JavaScript. */
export default async function PageCabinet({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const cabinets = await tenter<Cabinet[]>('v1/cabinets');
  const erreur = (await searchParams).erreur === '1';
  return (
    <main id="contenu" className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-4">
      <Titre>Choisir un cabinet</Titre>
      <Carte className="space-y-3">
        {erreur ? (
          <Alerte ton="danger" role="alert">
            Ce cabinet ne fait pas partie de ceux auxquels votre compte appartient.
          </Alerte>
        ) : null}
        {!cabinets.ok ? (
          <Alerte ton="attention" role="alert">
            La liste de vos cabinets n’a pas pu être chargée. {cabinets.message}
          </Alerte>
        ) : cabinets.donnees.length === 0 ? (
          <Alerte ton="attention">Votre compte n’est membre actif d’aucun cabinet.</Alerte>
        ) : (
          <>
            <p>Votre compte est membre de plusieurs cabinets. Les données affichées et vos droits dépendent du cabinet choisi.</p>
            <ul className="space-y-2" data-testid="choix-cabinet">
              {cabinets.donnees.map((c) => (
                <li key={c.id}>
                  <form method="post" action="/api/session/cabinet">
                    <input type="hidden" name="cabinetId" value={c.id} />
                    <Bouton type="submit" variante="secondaire" className="h-auto w-full flex-col items-start py-3 text-left">
                      <span className="font-semibold">{c.nom}</span>
                      <span className="text-sm font-normal">{LIBELLE_ROLE[c.role] ?? c.role}</span>
                    </Bouton>
                  </form>
                </li>
              ))}
            </ul>
          </>
        )}
        <BoutonDeconnexion />
      </Carte>
    </main>
  );
}
