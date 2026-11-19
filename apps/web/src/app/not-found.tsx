import Link from 'next/link';
import { connection } from 'next/server';
import { Carte, Titre } from '@/components/ui/base';

export default async function Introuvable() {
  // Rendu à la demande : la politique de sécurité du contenu repose sur un nonce propre à chaque requête.
  await connection();
  return (
    <main id="contenu" className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-4">
      <Carte className="space-y-3">
        <Titre>Page introuvable</Titre>
        <p>Cette adresse ne correspond à aucune page de Comtaple.</p>
        <p>
          <Link href="/">Revenir à l’accueil</Link>
        </p>
      </Carte>
    </main>
  );
}
