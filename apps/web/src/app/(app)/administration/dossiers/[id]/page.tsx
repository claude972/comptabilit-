import type { Metadata } from 'next';
import Link from 'next/link';
import { FormulaireDossier, Habilitation, OuvrirExercice } from '@/components/administration';
import { ErreurAcces } from '@/components/erreurs';
import { Alerte, Carte, Etiquette, SousTitre, Tableau, Titre } from '@/components/ui/base';
import { type FicheDossier, type MembreCabinet, type MembreDossier, controlesFiscauxRealises, libelleTerritoire } from '@/lib/administration';
import { LIBELLE_NIVEAU, LIBELLE_ROLE } from '@/lib/libelles';
import { formaterDate } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { estUuid } from '@/lib/serveur/donnees';
import { accesMessagerie } from '@/lib/serveur/messagerie';
import { type Exercice, auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Administration d’un dossier' };

export default async function PageAdministrationDossier({ params }: { params: Promise<{ id: string }> }) {
  const acces = await accesMessagerie();
  if (!acces.ok) return <ErreurAcces statut={acces.statut} message={acces.statut === 403 ? 'L’administration du cabinet est réservée aux administrateurs et associés.' : acces.message} />;
  const { id } = await params;
  if (!estUuid(id)) return <ErreurAcces statut={404} retour="/administration" />;
  const [fiche, membresDossier, membresCabinet] = await Promise.all([tenter<FicheDossier>(`v1/dossiers/${id}`), tenter<MembreDossier[]>(`v1/dossiers/${id}/membres`), tenter<MembreCabinet[]>('v1/cabinet/membres')]);
  if (!fiche.ok) return <ErreurAcces statut={fiche.statut} message={fiche.message} retour="/administration" />;
  const d = fiche.donnees;
  const habilite = auMoins(d.niveau, 'lecture');
  const exercices = habilite ? await tenter<Exercice[]>(`v1/dossiers/${id}/exercices`) : null;
  const niveaux = new Map((membresDossier.ok ? membresDossier.donnees : []).map((m) => [m.utilisateurId, m.niveau]));
  const moi = acces.moi.utilisateur.id;

  return (
    <div className="space-y-6">
      <p>
        <Link href="/administration" prefetch={false}>
          ← Retour à l’administration
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Titre>{d.raisonSociale}</Titre>
        <Etiquette>{libelleTerritoire(d.territoireFiscal)}</Etiquette>
        {d.niveau ? <Etiquette ton="info">Votre habilitation : {LIBELLE_NIVEAU[d.niveau]}</Etiquette> : <Etiquette ton="vide">Vous n’êtes pas habilité sur ce dossier</Etiquette>}
      </div>
      {!d.niveau ? (
        <Alerte ton="attention" data-testid="non-habilite">
          Vous administrez ce dossier sans accès à son contenu. Vous n’êtes pas habilité sur ce dossier tant que vous ne vous êtes pas accordé une
          habilitation ; cette attribution est journalisée.
        </Alerte>
      ) : null}
      {!controlesFiscauxRealises(d.territoireFiscal) ? <Alerte ton="attention">Territoire « {libelleTerritoire(d.territoireFiscal)} » : les contrôles fiscaux ne sont pas réalisés sur ce dossier.</Alerte> : null}

      <Carte className="space-y-3">
        <SousTitre>Caractéristiques</SousTitre>
        <FormulaireDossier dossier={d} />
      </Carte>

      <Carte className="space-y-3">
        <SousTitre>Exercices</SousTitre>
        {exercices?.ok ? (
          exercices.donnees.length ? (
            <ul className="list-disc pl-5" data-testid="exercices">
              {exercices.donnees.map((x) => (
                <li key={x.id}>
                  Du {formaterDate(x.debut)} au {formaterDate(x.fin)} ({x.statut})
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-texte-doux">Aucun exercice ouvert.</p>
          )
        ) : (
          <p className="text-texte-doux">Les exercices ne sont visibles qu’avec une habilitation de lecture sur le dossier.</p>
        )}
        {auMoins(d.niveau, 'collaboration') ? (
          <OuvrirExercice dossierId={d.id} />
        ) : (
          <Alerte ton="neutre" data-testid="exercice-impossible">
            Ouvrir un exercice demande une habilitation « Collaboration » ou plus sur ce dossier : le rôle d’administrateur du cabinet ne suffit pas.
            Accordez-vous d’abord cette habilitation ci-dessous, ou confiez l’ouverture à un collaborateur habilité.
          </Alerte>
        )}
      </Carte>

      <Carte className="space-y-2">
        <SousTitre>Restitution du dossier</SousTitre>
        {auMoins(d.niveau, 'validation') ? (
          <p>
            <Link href={`/dossiers/${d.id}/restitution`} prefetch={false}>
              Demander ou télécharger un export de restitution
            </Link>
          </p>
        ) : (
          <p className="text-texte-doux" data-testid="restitution-impossible">
            L’export de restitution demande l’habilitation « Validation » sur ce dossier : le rôle d’administrateur du cabinet ne suffit pas.
          </p>
        )}
      </Carte>

      <section aria-labelledby="titre-habilitations" className="space-y-2">
        <SousTitre id="titre-habilitations">Habilitations sur ce dossier</SousTitre>
        <p className="text-sm text-texte-doux">
          Le niveau proposé est plafonné par le rôle : un client ne peut recevoir ni révision ni validation. Toute attribution est journalisée, y compris
          celle que vous vous accordez.
        </p>
        {!membresCabinet.ok || !membresDossier.ok ? (
          <Alerte ton="attention">Les membres n’ont pas pu être chargés.</Alerte>
        ) : (
          <Tableau legende="Habilitations des membres du cabinet sur ce dossier">
            <thead>
              <tr>
                <th scope="col">Membre</th>
                <th scope="col">Rôle</th>
                <th scope="col">Niveau actuel</th>
                <th scope="col">Accorder, modifier ou retirer</th>
              </tr>
            </thead>
            <tbody>
              {membresCabinet.donnees
                .filter((m) => m.actif)
                .map((m) => {
                  const actuel = niveaux.get(m.utilisateurId) ?? null;
                  return (
                    <tr key={m.utilisateurId} data-membre={m.utilisateurId}>
                      <th scope="row" className="!bg-transparent font-medium">
                        {m.nom}
                        {m.utilisateurId === moi ? ' (vous)' : ''}
                        <span className="block text-sm font-normal break-all text-texte-doux">{m.email}</span>
                      </th>
                      <td>{LIBELLE_ROLE[m.role] ?? m.role}</td>
                      <td>{actuel ? <Etiquette ton="info">{LIBELLE_NIVEAU[actuel]}</Etiquette> : <Etiquette ton="vide">Aucune</Etiquette>}</td>
                      <td>
                        <Habilitation dossierId={d.id} utilisateurId={m.utilisateurId} nom={m.nom} role={m.role} niveauActuel={actuel} soiMeme={m.utilisateurId === moi} />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </Tableau>
        )}
      </section>
    </div>
  );
}
