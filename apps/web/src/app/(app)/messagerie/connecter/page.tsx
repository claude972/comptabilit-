import type { Metadata } from 'next';
import Link from 'next/link';
import { ErreurAcces } from '@/components/erreurs';
import { RappelPerimetreMetier } from '@/components/messagerie/commun';
import { DemarrerConnexion } from '@/components/messagerie/demarrer';
import { Titre } from '@/components/ui/base';
import { type ListeConnexionsMail, dateDebutParDefaut } from '@/lib/messagerie';
import { tenter } from '@/lib/serveur/api';
import { accesMessagerie } from '@/lib/serveur/messagerie';

export const metadata: Metadata = { title: 'Connecter une boîte' };

export default async function PageConnecter() {
  const acces = await accesMessagerie();
  if (!acces.ok) return <ErreurAcces statut={acces.statut} message={acces.message} />;
  const liste = await tenter<ListeConnexionsMail>('v1/mail/connexions');
  if (!liste.ok) return <ErreurAcces statut={liste.statut} message={liste.message} retour="/messagerie" />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <p>
        <Link href="/messagerie" prefetch={false}>
          ← Retour à la messagerie
        </Link>
      </p>
      <Titre>Connecter une boîte de messagerie</Titre>
      <RappelPerimetreMetier />
      <DemarrerConnexion connecteurs={liste.donnees.connecteurs} dateParDefaut={dateDebutParDefaut(new Date())} />
    </div>
  );
}
