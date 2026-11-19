import type { Metadata } from 'next';
import { Deposer } from '@/components/depot/deposer';
import { ErreurAcces } from '@/components/erreurs';
import { Alerte, Titre } from '@/components/ui/base';
import { lireDossiers, lireMoi, lireSituation } from '@/lib/serveur/donnees';

export const metadata: Metadata = { title: 'Déposer une pièce' };

export default async function PageDeposer() {
  const [moi, dossiers, situation] = await Promise.all([lireMoi(), lireDossiers(), lireSituation()]);
  if (!moi.ok) return <ErreurAcces statut={moi.statut} message={moi.message} />;
  if (!dossiers.ok) return <ErreurAcces statut={dossiers.statut} message={dossiers.message} />;
  // Seuls les dossiers où l'utilisateur est habilité (niveau non nul) sont proposés.
  const autorises = dossiers.donnees.filter((d) => d.niveau !== null).map((d) => ({ id: d.id, raisonSociale: d.raisonSociale }));
  if (autorises.length === 0) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Titre>Déposer une pièce</Titre>
        <Alerte ton="attention" titre="Aucun dossier ne vous est ouvert">
          Vous n’êtes habilité sur aucun dossier pour le moment. Rapprochez-vous de votre cabinet.
        </Alerte>
      </div>
    );
  }
  return <Deposer utilisateurId={moi.donnees.utilisateur.id} dossiers={autorises} serviceFerme={situation && !situation.serviceOuvert ? situation.situation : null} />;
}
