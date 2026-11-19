import type { Metadata } from 'next';
import { InviteInstallation } from '@/components/pwa';
import { PurgeApresDeconnexion } from '@/components/deconnexion';
import { Alerte, Carte } from '@/components/ui/base';
import { styleBouton } from '@/components/ui/bouton';

export const metadata: Metadata = { title: 'Connexion' };
export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  echec: 'La connexion n’a pas abouti. Merci de réessayer.',
  expire: 'La tentative de connexion a expiré. Merci de recommencer.',
  session: 'Votre session a expiré. Merci de vous reconnecter.',
  fournisseur: 'Le service d’authentification est momentanément indisponible. Merci de réessayer dans un instant.',
};

function retourSur(v: string | undefined): string | null {
  return v && v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') && !v.startsWith('/api/') ? v : null;
}

export default async function Connexion({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const erreur = typeof p.erreur === 'string' ? MESSAGES[p.erreur] : undefined;
  const retour = retourSur(typeof p.retour === 'string' ? p.retour : undefined);
  const deconnecte = p.deconnecte === '1';
  const lien = retour ? `/api/auth/connexion?retour=${encodeURIComponent(retour)}` : '/api/auth/connexion';
  return (
    <main id="contenu" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icones/icone-192.png" alt="" width={48} height={48} className="rounded-xl" />
        <h1 className="text-3xl font-semibold tracking-tight">Comtaple</h1>
      </div>
      <Carte className="space-y-4">
        <p>Déposez vos pièces comptables et suivez leur traitement avec votre cabinet.</p>
        {deconnecte ? (
          <Alerte ton="succes" role="status">
            Vous êtes déconnecté. Les dépôts en attente ont été effacés de cet appareil.
          </Alerte>
        ) : null}
        {erreur ? (
          <Alerte ton="danger" role="alert">
            {erreur}
          </Alerte>
        ) : null}
        {/* Lien simple (pas de préchargement) : il déclenche la redirection vers le fournisseur d'identité. */}
        <a href={lien} className={styleBouton({ taille: 'grande' })}>
          Se connecter
        </a>
        <p className="text-sm text-texte-doux">La connexion se fait sur la page sécurisée du service d’authentification de votre cabinet.</p>
      </Carte>
      <InviteInstallation />
      {deconnecte ? <PurgeApresDeconnexion /> : null}
    </main>
  );
}
