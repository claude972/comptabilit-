import type { Metadata } from 'next';
import Link from 'next/link';
import { ErreurAcces } from '@/components/erreurs';
import { ConnecteurNonConfigure, EtiquetteStatutConnexion, GUIDE, RappelPerimetreMetier } from '@/components/messagerie/commun';
import { Alerte, Carte, Etiquette, SousTitre, Tableau, Titre } from '@/components/ui/base';
import { styleBouton } from '@/components/ui/bouton';
import { type Fournisseur, type Integrations, LIBELLE_FOURNISSEUR, LIBELLE_ISSUE_SYNCHRO, type ListeConnexionsMail, type PieceAQualifier, messageRetour } from '@/lib/messagerie';
import { formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { parametre } from '@/lib/serveur/donnees';
import { accesMessagerie } from '@/lib/serveur/messagerie';

export const metadata: Metadata = { title: 'Messagerie' };

const CLE_INTEGRATION: Record<Fournisseur, 'gmail' | 'microsoft365'> = { gmail: 'gmail', microsoft: 'microsoft365' };

export default async function PageMessagerie({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const acces = await accesMessagerie();
  if (!acces.ok) return <ErreurAcces statut={acces.statut} message={acces.message} />;
  const [integrations, liste, aQualifier] = await Promise.all([
    tenter<Integrations>('v1/integrations'),
    tenter<ListeConnexionsMail>('v1/mail/connexions'),
    tenter<PieceAQualifier[]>('v1/mail/pieces-a-qualifier'),
  ]);
  if (!liste.ok) return <ErreurAcces statut={liste.statut} message={liste.message} />;
  const { connecteurs, connexions } = liste.donnees;
  const retour = messageRetour(parametre((await searchParams).retour));
  const etats = (['gmail', 'microsoft'] as const).map((f) => ({ f, integration: integrations.ok ? integrations.donnees.messagerie?.[CLE_INTEGRATION[f]] : undefined, connecteur: connecteurs[f] }));
  // « Connecté » n'est affiché que si l'API l'atteste (appel de lecture réussi sur les hôtes officiels du fournisseur).
  const aucunReel = !integrations.ok || etats.every((e) => e.integration?.statut !== 'connecte');
  const unConfigure = etats.some((e) => e.connecteur?.configure);

  return (
    <div className="space-y-4">
      <Titre>Messagerie — collecte des factures par mail</Titre>
      {retour ? (
        <Alerte ton="danger" role="alert" titre="La boîte n’a pas été connectée" data-testid="retour-oauth">
          {retour}
        </Alerte>
      ) : null}
      {aucunReel ? (
        <Alerte ton="attention" role="status" titre="Non connecté" data-testid="bandeau-non-connecte">
          Aucune boîte réelle n’a été connectée à Comtaple auprès de Gmail ou de Microsoft 365. Aucun message n’est lu et aucune facture n’est
          collectée par mail.
          {!integrations.ok ? ' (L’état des connecteurs n’a pas pu être lu : il est considéré comme non connecté.)' : ''}
        </Alerte>
      ) : null}
      <RappelPerimetreMetier />

      <section aria-labelledby="titre-connecteurs" className="space-y-2">
        <SousTitre id="titre-connecteurs">État des connecteurs</SousTitre>
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {etats.map(({ f, integration, connecteur }) => (
            <li key={f}>
              <Carte className="h-full space-y-2" data-connecteur={f}>
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {LIBELLE_FOURNISSEUR[f]}
                  <Etiquette ton={integration?.statut === 'connecte' ? 'succes' : 'vide'}>{integration?.statut === 'connecte' ? 'Connecté' : 'Non connecté'}</Etiquette>
                </p>
                {integration?.detail ? <p className="text-sm break-words">{integration.detail}</p> : null}
                {connecteur?.configure ? (
                  integration?.detail !== connecteur.detail ? <p className="text-sm break-words text-texte-doux">{connecteur.detail}</p> : null
                ) : (
                  <ConnecteurNonConfigure fournisseur={LIBELLE_FOURNISSEUR[f]} detail={connecteur?.detail ?? 'Connecteur non configuré.'} />
                )}
              </Carte>
            </li>
          ))}
        </ul>
        {unConfigure ? (
          <Link href="/messagerie/connecter" prefetch={false} className={styleBouton()}>
            Connecter une boîte
          </Link>
        ) : (
          <p className="text-sm text-texte-doux" data-testid="connexion-impossible">
            La connexion d’une boîte n’est pas proposée : aucun connecteur n’est configuré sur cette installation (voir <code className="break-all">{GUIDE}</code>).
          </p>
        )}
      </section>

      <section aria-labelledby="titre-connexions" className="space-y-2">
        <SousTitre id="titre-connexions">Boîtes connectées ({connexions.length})</SousTitre>
        {connexions.length ? (
          <Tableau legende="Connexions de messagerie du cabinet">
            <thead>
              <tr>
                <th scope="col">Boîte</th>
                <th scope="col">Fournisseur</th>
                <th scope="col">Statut</th>
                <th scope="col">Dernière synchronisation</th>
                <th scope="col">Dernière erreur</th>
              </tr>
            </thead>
            <tbody>
              {connexions.map((c) => (
                <tr key={c.id} data-connexion={c.id}>
                  <th scope="row" className="!bg-transparent font-medium">
                    <Link href={`/messagerie/${c.id}`} prefetch={false} className="break-all">
                      {c.adresse || 'Adresse non communiquée'}
                    </Link>
                    {c.configuration?.boite?.type === 'partagee' ? <span className="block text-sm font-normal text-texte-doux">Boîte partagée</span> : null}
                  </th>
                  <td>{LIBELLE_FOURNISSEUR[c.fournisseur] ?? c.fournisseur}</td>
                  <td>
                    <EtiquetteStatutConnexion statut={c.statut} />
                  </td>
                  <td>
                    {c.derniereSynchro ? formaterHorodatage(c.derniereSynchro) : 'Jamais'}
                    {c.derniereIssue ? <span className="block text-sm text-texte-doux">{LIBELLE_ISSUE_SYNCHRO[c.derniereIssue] ?? c.derniereIssue}</span> : null}
                  </td>
                  <td className="break-words">{c.motifStatut ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        ) : (
          <p className="text-texte-doux">Aucune boîte n’est connectée pour ce cabinet.</p>
        )}
        <p className="text-sm text-texte-doux">
          Une boîte « active » ici a obtenu une autorisation ; le statut « Connecté » d’un connecteur, lui, n’apparaît qu’après une lecture réussie
          auprès du fournisseur réel.
        </p>
      </section>

      <section aria-labelledby="titre-a-qualifier" className="space-y-2">
        <SousTitre id="titre-a-qualifier">Pièces à qualifier</SousTitre>
        <p>
          <Link href="/messagerie/a-qualifier" prefetch={false}>
            {aQualifier.ok ? `${aQualifier.donnees.length} pièce${aQualifier.donnees.length > 1 ? 's' : ''} reçue${aQualifier.donnees.length > 1 ? 's' : ''} par mail en attente d’un dossier` : 'Voir les pièces reçues par mail en attente d’un dossier'}
          </Link>
        </p>
      </section>
    </div>
  );
}
