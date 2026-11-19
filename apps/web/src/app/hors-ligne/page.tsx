import type { Metadata } from 'next';
import { Alerte, Carte, Titre } from '@/components/ui/base';
import { styleBouton } from '@/components/ui/bouton';

export const metadata: Metadata = { title: 'Hors connexion' };
// Rendu à la demande : la politique de sécurité du contenu repose sur un nonce propre à chaque requête.
export const dynamic = 'force-dynamic';

/** Seule page conservée par le service worker. Elle ne contient aucune donnée de dossier. */
export default function HorsLigne() {
  return (
    <main id="contenu" className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-4">
      <Titre>Vous êtes hors connexion</Titre>
      <Carte className="space-y-3">
        <p>Comtaple a besoin d’une connexion pour afficher vos dossiers et envoyer vos pièces.</p>
        <Alerte ton="info" titre="Vos dépôts en attente sont conservés sur cet appareil">
          <p>
            Rien n’est envoyé tant que l’application est fermée ou hors connexion. L’envoi reprendra, là où il s’était arrêté, quand vous
            rouvrirez Comtaple avec une connexion.
          </p>
        </Alerte>
        <a href="/" className={styleBouton({ taille: 'grande' })}>
          Réessayer
        </a>
      </Carte>
    </main>
  );
}
