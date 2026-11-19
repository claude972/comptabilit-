import type { Metadata } from 'next';
import Link from 'next/link';
import { ErreurAcces } from '@/components/erreurs';
import { Deconnecter, SynchroniserMaintenant } from '@/components/messagerie/actions';
import { EtiquetteStatutConnexion, RappelPerimetreMetier } from '@/components/messagerie/commun';
import { FormulaireConfigurationMail } from '@/components/messagerie/configuration';
import { Alerte, Carte, Etiquette, SousTitre, Tableau, Titre } from '@/components/ui/base';
import { LIBELLE_FOURNISSEUR, LIBELLE_ISSUE_PIECE, LIBELLE_ISSUE_SYNCHRO, type SuiviConnexion, decrireSignalement } from '@/lib/messagerie';
import { formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { estUuid, lireDossiers, parametre } from '@/lib/serveur/donnees';
import { accesMessagerie } from '@/lib/serveur/messagerie';

export const metadata: Metadata = { title: 'Connexion de messagerie' };

const SURVEILLANCE: Record<string, string> = {
  gmail_watch: 'Notifications Gmail',
  graph_abonnements: 'Notifications Microsoft Graph',
  periodique: 'Synchronisation périodique (pas de notifications)',
};

export default async function PageConnexionMail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const acces = await accesMessagerie();
  if (!acces.ok) return <ErreurAcces statut={acces.statut} message={acces.message} />;
  const { id } = await params;
  if (!estUuid(id)) return <ErreurAcces statut={404} retour="/messagerie" />;
  const [suivi, dossiers] = await Promise.all([tenter<SuiviConnexion>(`v1/mail/connexions/${id}/suivi`), lireDossiers()]);
  if (!suivi.ok) return <ErreurAcces statut={suivi.statut} message={suivi.message} retour="/messagerie" />;
  const { connexion: c, imports, pieces, signalements, erreur } = suivi.donnees;
  const active = c.statut === 'active';
  const supprimee = c.statut === 'supprimee';
  const nouvelle = parametre((await searchParams).connectee) === '1';
  const comptes = Object.entries(imports ?? {});

  return (
    <div className="space-y-4">
      <p>
        <Link href="/messagerie" prefetch={false}>
          ← Retour à la messagerie
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Titre className="break-all">{c.adresse || 'Boîte de messagerie'}</Titre>
        <Etiquette>{LIBELLE_FOURNISSEUR[c.fournisseur] ?? c.fournisseur}</Etiquette>
        {c.configuration?.boite?.type === 'partagee' ? <Etiquette>Boîte partagée</Etiquette> : null}
        <EtiquetteStatutConnexion statut={c.statut} />
      </div>
      {nouvelle && active ? (
        <Alerte ton="succes" role="status" data-testid="connexion-creee">
          L’autorisation a été accordée et enregistrée. Vérifiez ci-dessous ce qu’elle permet, puis réglez ce que Comtaple doit réellement récupérer.
        </Alerte>
      ) : null}
      {erreur && !supprimee ? (
        <Alerte ton="attention" role="alert" titre="Cette connexion n’est plus active">
          <p className="break-words">{erreur.motif ?? 'Motif non précisé.'}</p>
          <p>Aucune synchronisation n’est tentée. Pour reprendre la collecte, connectez de nouveau la boîte.</p>
        </Alerte>
      ) : null}
      {supprimee ? <Alerte ton="neutre">Cette boîte a été déconnectée : les jetons sont supprimés, Comtaple ne peut plus la lire.</Alerte> : null}
      <RappelPerimetreMetier />

      {/* Deux blocs volontairement distincts : ce que le jeton permet / ce que le logiciel lit. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-labelledby="titre-autorisation" className="space-y-2 rounded-xl border-2 border-attention-texte bg-attention-fond p-4 text-attention-texte" data-testid="bloc-autorisation">
          <SousTitre id="titre-autorisation">Ce que l’autorisation permet techniquement</SousTitre>
          <p className="text-sm">Permissions accordées chez le fournisseur (jeton OAuth).</p>
          {c.permissionsAccordees?.length ? (
            <ul className="space-y-2">
              {c.permissionsAccordees.map((p) => (
                <li key={p.scope}>
                  <code className="break-all">{p.scope}</code>
                  <span className="block break-words">{p.portee}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>Aucune permission enregistrée.</p>
          )}
        </section>
        <section aria-labelledby="titre-filtres" className="space-y-2 rounded-xl border border-dashed border-texte-doux bg-surface p-4" data-testid="bloc-filtres">
          <SousTitre id="titre-filtres">Ce que Comtaple récupère réellement (filtres)</SousTitre>
          <p className="text-sm text-texte-doux">Réglages du logiciel, modifiables ci-dessous.</p>
          <ul className="list-disc space-y-1 pl-5">
            {(c.filtresFonctionnels ?? []).map((f) => (
              <li key={f.type} className="break-words">
                {f.libelle}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <Alerte ton="attention" data-testid="phrase-filtre">
        <strong>Un filtre n’est pas une restriction technique du jeton.</strong> Les filtres sont appliqués par Comtaple ; ils ne réduisent pas
        l’autorisation accordée, qui porte en lecture sur l’ensemble de la boîte. Seul le retrait de l’autorisation chez le fournisseur supprime cet accès.
      </Alerte>

      <Carte className="space-y-3">
        <SousTitre>Suivi</SousTitre>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          <dt className="text-texte-doux">Connectée le</dt>
          <dd>{formaterHorodatage(c.creeLe)}</dd>
          <dt className="text-texte-doux">Dernière synchronisation</dt>
          <dd data-testid="derniere-synchro">
            {c.derniereSynchro ? formaterHorodatage(c.derniereSynchro) : 'Jamais'}
            {c.derniereIssue ? ` — ${LIBELLE_ISSUE_SYNCHRO[c.derniereIssue] ?? c.derniereIssue}` : ''}
          </dd>
          <dt className="text-texte-doux">Surveillance</dt>
          <dd>
            {c.surveillance ? (SURVEILLANCE[c.surveillance.mode] ?? c.surveillance.mode) : 'Aucune'}
            {c.surveillance?.echeance ? ` (à renouveler avant le ${formaterHorodatage(c.surveillance.echeance)})` : ''}
          </dd>
          <dt className="text-texte-doux">Pièces vues</dt>
          <dd>{comptes.length ? comptes.map(([issue, n]) => `${LIBELLE_ISSUE_PIECE[issue] ?? issue} : ${n}`).join(' · ') : 'Aucune pièce jointe examinée pour l’instant.'}</dd>
        </dl>
        {active ? <SynchroniserMaintenant connexionId={c.id} /> : null}

        {signalements.length ? (
          <section aria-labelledby="titre-signalements" className="space-y-2">
            <SousTitre id="titre-signalements" className="text-base">Signalements ({signalements.length})</SousTitre>
            <ul className="space-y-2" data-testid="signalements">
              {signalements.map((s) => {
                const d = decrireSignalement(s);
                return (
                  <li key={s.id} className="rounded-lg border border-bordure p-2" data-signalement={s.type}>
                    <p className="font-medium">{d.titre}</p>
                    <p className="text-sm break-words">{d.precision}</p>
                    <p className="text-sm text-texte-doux">{formaterHorodatage(s.creeLe)}</p>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {pieces.length ? (
          <Tableau legende="Dernières pièces jointes examinées">
            <thead>
              <tr>
                <th scope="col">Fichier</th>
                <th scope="col">Issue</th>
                <th scope="col">Vue le</th>
              </tr>
            </thead>
            <tbody>
              {pieces.map((p, i) => (
                <tr key={`${p.idMessage}-${i}`}>
                  <td className="break-all">{p.nomFichier}</td>
                  <td>
                    {p.issue === 'a_qualifier' ? (
                      <Link href="/messagerie/a-qualifier" prefetch={false}>
                        À qualifier
                      </Link>
                    ) : p.documentId ? (
                      <Link href={`/depots/${p.documentId}`} prefetch={false}>
                        {LIBELLE_ISSUE_PIECE[p.issue] ?? p.issue}
                      </Link>
                    ) : (
                      (LIBELLE_ISSUE_PIECE[p.issue] ?? p.issue)
                    )}
                  </td>
                  <td className="whitespace-nowrap">{formaterHorodatage(p.recueLe)}</td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        ) : null}
      </Carte>

      {active ? (
        <Carte>
          {dossiers.ok ? (
            <FormulaireConfigurationMail connexionId={c.id} configuration={c.configuration} connecteeLe={c.creeLe} dossiers={dossiers.donnees.map((d) => ({ id: d.id, raisonSociale: d.raisonSociale }))} />
          ) : (
            <Alerte ton="attention">La liste des dossiers est indisponible : la configuration ne peut pas être modifiée pour l’instant.</Alerte>
          )}
        </Carte>
      ) : null}

      {/* Toujours rendu : le résultat de la déconnexion (démarches restantes) doit rester affiché après l'actualisation. */}
      <Carte className="space-y-2">
        <SousTitre>Déconnexion</SousTitre>
        <p className="text-sm text-texte-doux">Arrête la surveillance, révoque l’autorisation quand le fournisseur le permet et supprime les jetons conservés par Comtaple.</p>
        <Deconnecter connexionId={c.id} adresse={c.adresse} dejaDeconnectee={supprimee} />
      </Carte>
    </div>
  );
}
