import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ErreurAcces } from '@/components/erreurs';
import { Alerte, Carte, Etiquette, SousTitre, Titre } from '@/components/ui/base';
import { LIBELLE_NIVEAU, LIBELLE_STATUT_DOCUMENT } from '@/lib/libelles';
import { tenter } from '@/lib/serveur/api';
import { estDeposant, lireDossiers, lireMoi } from '@/lib/serveur/donnees';
import { type StatutDocument, auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Tableau de bord' };

const A_SUIVRE: StatutDocument[] = ['a_controler', 'a_completer', 'en_analyse', 'recu', 'quarantaine'];

export default async function TableauDeBord() {
  const moi = await lireMoi();
  if (!moi.ok) return <ErreurAcces statut={moi.statut} message={moi.message} />;
  // Le déposant n'a pas de tableau de bord cabinet : il arrive directement sur le dépôt.
  if (estDeposant(moi.donnees.role)) redirect('/deposer');
  const dossiers = await lireDossiers();
  if (!dossiers.ok) return <ErreurAcces statut={dossiers.statut} message={dossiers.message} />;
  const habilites = dossiers.donnees.filter((d) => d.niveau !== null);
  const nonHabilites = dossiers.donnees.length - habilites.length;
  // Une seule requête pour tout le portefeuille : pièces en attente par dossier et par statut.
  const attente = await tenter<Array<{ entiteId: string; statut: StatutDocument; n: number }>>('v1/tableau-de-bord/pieces');
  const parDossier = new Map<string, Map<StatutDocument, number>>();
  if (attente.ok) for (const l of attente.donnees) parDossier.set(l.entiteId, (parDossier.get(l.entiteId) ?? new Map()).set(l.statut, l.n));
  const total = (id: string) => [...(parDossier.get(id)?.values() ?? [])].reduce((a, b) => a + b, 0);
  // Les dossiers qui ont des pièces à traiter d'abord ; au-delà de MAX cartes, la liste complète est dans « Dossiers ».
  const MAX = 24;
  const tries = [...habilites].sort((a, b) => total(b.id) - total(a.id) || a.raisonSociale.localeCompare(b.raisonSociale, 'fr'));
  const aSuivre = tries.filter((d) => total(d.id) > 0).length;
  const affiches = tries.slice(0, MAX);

  return (
    <div className="space-y-4">
      <Titre>Tableau de bord</Titre>
      <p className="text-texte-doux">
        Bonjour {moi.donnees.utilisateur.nom}. {habilites.length} dossier{habilites.length > 1 ? 's' : ''} sur lesquels vous êtes habilité
        {nonHabilites > 0 ? ` (${nonHabilites} autre${nonHabilites > 1 ? 's' : ''} du cabinet sans habilitation)` : ''}.
      </p>
      {habilites.length === 0 ? <Alerte ton="attention">Vous n’êtes habilité sur aucun dossier pour le moment.</Alerte> : null}
      {!attente.ok ? <Alerte ton="attention">Le décompte des pièces en attente est indisponible pour le moment.</Alerte> : null}
      {habilites.length > 0 ? (
        <p data-testid="resume-portefeuille">
          {attente.ok ? `${aSuivre} dossier${aSuivre > 1 ? 's ont' : ' a'} des pièces en attente de traitement. ` : ''}
          {habilites.length > MAX ? `Les ${MAX} premiers sont affichés, ceux qui ont des pièces en attente d’abord. ` : ''}
          <Link href="/dossiers" prefetch={false}>
            Voir et rechercher tous les dossiers
          </Link>
        </p>
      ) : null}
      <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {affiches.map((dossier) => {
          const comptes = parDossier.get(dossier.id) ?? new Map<StatutDocument, number>();
          const liste = { ok: attente.ok };
          const cabinet = auMoins(dossier.niveau, 'lecture');
          return (
            <li key={dossier.id}>
              <Carte className="h-full space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SousTitre>{dossier.raisonSociale}</SousTitre>
                  <Etiquette>{dossier.niveau ? LIBELLE_NIVEAU[dossier.niveau] : ''}</Etiquette>
                </div>
                {liste.ok ? (
                  <ul className="flex flex-wrap gap-2 text-sm" aria-label="Pièces par statut">
                    {A_SUIVRE.filter((s) => comptes.get(s)).map((s) => (
                      <li key={s}>
                        <Etiquette ton={s === 'a_completer' ? 'attention' : s === 'quarantaine' ? 'danger' : 'neutre'}>
                          {LIBELLE_STATUT_DOCUMENT[s]} : {comptes.get(s)}
                        </Etiquette>
                      </li>
                    ))}
                    {A_SUIVRE.every((s) => !comptes.get(s)) ? <li className="text-texte-doux">Aucune pièce en attente de traitement.</li> : null}
                  </ul>
                ) : (
                  <p className="text-sm text-texte-doux">Pièces indisponibles pour le moment.</p>
                )}
                <p className="flex flex-wrap gap-x-4 gap-y-1">
                  {cabinet ? (
                    <>
                      <Link href={`/dossiers/${dossier.id}`} prefetch={false}>Pièces</Link>
                      <Link href={`/dossiers/${dossier.id}/comptabilite`} prefetch={false}>Comptabilité</Link>
                      <Link href={`/dossiers/${dossier.id}/revision`} prefetch={false}>Révision</Link>
                    </>
                  ) : (
                    <Link href="/deposer" prefetch={false}>Déposer une pièce</Link>
                  )}
                </p>
              </Carte>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
