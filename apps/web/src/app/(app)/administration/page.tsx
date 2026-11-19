import type { Metadata } from 'next';
import Link from 'next/link';
import { FormulaireDossier } from '@/components/administration';
import { ErreurAcces } from '@/components/erreurs';
import { Alerte, Carte, Etiquette, SousTitre, Tableau, Titre } from '@/components/ui/base';
import { type JournalAudit, type MembreCabinet, detailsSimples, libelleTerritoire } from '@/lib/administration';
import { LIBELLE_NIVEAU, LIBELLE_ROLE } from '@/lib/libelles';
import { formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { lireDossiers } from '@/lib/serveur/donnees';
import { accesMessagerie } from '@/lib/serveur/messagerie';

export const metadata: Metadata = { title: 'Administration du cabinet' };

export default async function PageAdministration() {
  // Même règle que la messagerie : gestionnaires du cabinet (administrateur, associé) uniquement.
  const acces = await accesMessagerie();
  if (!acces.ok) return <ErreurAcces statut={acces.statut} message={acces.statut === 403 ? 'L’administration du cabinet est réservée aux administrateurs et associés.' : acces.message} />;
  const [membres, dossiers, audit] = await Promise.all([tenter<MembreCabinet[]>('v1/cabinet/membres'), lireDossiers(), tenter<JournalAudit>('v1/audit?limite=100')]);
  if (!membres.ok) return <ErreurAcces statut={membres.statut} message={membres.message} />;
  const nomDe = new Map(membres.donnees.map((m) => [m.utilisateurId, m.nom]));
  const nomDossier = new Map((dossiers.ok ? dossiers.donnees : []).map((d) => [d.id, d.raisonSociale]));

  return (
    <div className="space-y-6">
      <Titre>Administration du cabinet</Titre>
      <nav aria-label="Autres écrans d’administration">
        <ul className="flex flex-wrap gap-3">
          <li>
            <Link href="/administration/abonnement" prefetch={false}>
              Abonnement du cabinet
            </Link>
          </li>
        </ul>
      </nav>

      <section aria-labelledby="titre-membres" className="space-y-2">
        <SousTitre id="titre-membres">Membres du cabinet ({membres.donnees.length})</SousTitre>
        <Tableau legende="Membres du cabinet et rôles">
          <thead>
            <tr>
              <th scope="col">Nom</th>
              <th scope="col">Adresse</th>
              <th scope="col">Rôle</th>
              <th scope="col">État</th>
            </tr>
          </thead>
          <tbody>
            {membres.donnees.map((m) => (
              <tr key={m.utilisateurId} data-membre={m.utilisateurId}>
                <th scope="row" className="!bg-transparent font-medium">{m.nom}</th>
                <td className="break-all">{m.email}</td>
                <td>{LIBELLE_ROLE[m.role] ?? m.role}</td>
                <td>
                  {m.actif ? 'Actif' : 'Inactif'}
                  {m.expireLe ? ` · accès jusqu’au ${formaterHorodatage(m.expireLe)}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </Tableau>
        <Alerte ton="neutre" className="text-sm" data-testid="sans-invitation">
          Lecture seule : l’invitation de nouveaux utilisateurs, le changement de rôle et la désactivation d’un membre ne sont pas encore proposés par
          Comtaple. Ils se font pour l’instant hors de cet écran.
        </Alerte>
      </section>

      <section aria-labelledby="titre-dossiers" className="space-y-2">
        <SousTitre id="titre-dossiers">Dossiers ({dossiers.ok ? dossiers.donnees.length : '—'})</SousTitre>
        {!dossiers.ok ? (
          <Alerte ton="attention">La liste des dossiers est indisponible.</Alerte>
        ) : (
          <Tableau legende="Dossiers du cabinet">
            <thead>
              <tr>
                <th scope="col">Dossier</th>
                <th scope="col">Territoire fiscal</th>
                <th scope="col">Votre habilitation</th>
              </tr>
            </thead>
            <tbody>
              {dossiers.donnees.map((d) => (
                <tr key={d.id} data-dossier={d.id}>
                  <th scope="row" className="!bg-transparent font-medium">
                    <Link href={`/administration/dossiers/${d.id}`} prefetch={false}>
                      {d.raisonSociale}
                    </Link>
                  </th>
                  <td>{libelleTerritoire(d.territoireFiscal)}</td>
                  <td>{d.niveau ? <Etiquette ton="info">{LIBELLE_NIVEAU[d.niveau]}</Etiquette> : <Etiquette ton="vide">Non habilité</Etiquette>}</td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        )}
        <Carte className="space-y-3">
          <SousTitre className="text-base">Créer un dossier</SousTitre>
          <FormulaireDossier />
        </Carte>
      </section>

      <section aria-labelledby="titre-audit" className="space-y-2">
        <SousTitre id="titre-audit">Journal d’audit</SousTitre>
        {!audit.ok ? (
          <Alerte ton="attention">Le journal d’audit est indisponible. {audit.message}</Alerte>
        ) : (
          <>
            {audit.donnees.integrite.rupture === null ? (
              <Alerte ton="succes" data-testid="integrite-audit">
                Chaîne intacte : les empreintes du journal se suivent sans rupture.
              </Alerte>
            ) : (
              <Alerte ton="danger" role="alert" titre="Rupture de la chaîne d’audit" data-testid="integrite-audit">
                Première ligne incohérente : n° {String(audit.donnees.integrite.rupture)}. Le journal a pu être altéré ; signalez-le sans délai.
              </Alerte>
            )}
            <Tableau legende="Dernières lignes du journal d’audit">
              <thead>
                <tr>
                  <th scope="col">N°</th>
                  <th scope="col">Horodatage</th>
                  <th scope="col">Acteur</th>
                  <th scope="col">Action</th>
                  <th scope="col">Cible</th>
                  <th scope="col">Précisions</th>
                </tr>
              </thead>
              <tbody>
                {audit.donnees.lignes.map((l) => (
                  <tr key={l.id}>
                    <td className="tabular-nums">{l.id}</td>
                    <td className="whitespace-nowrap">{formaterHorodatage(l.horodatage)}</td>
                    <td>{l.acteurType === 'systeme' ? 'Système' : l.acteurId ? (nomDe.get(l.acteurId) ?? 'Utilisateur hors cabinet') : '—'}</td>
                    <td><code className="break-all">{l.action}</code></td>
                    <td className="break-words">
                      {l.cibleType ?? '—'}
                      {l.entiteId && nomDossier.has(l.entiteId) ? <span className="block text-sm text-texte-doux">{nomDossier.get(l.entiteId)}</span> : null}
                    </td>
                    <td className="text-sm break-words">
                      {detailsSimples(l.details).map((d) => `${d.cle} : ${d.valeur}`).join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tableau>
            <p className="text-sm text-texte-doux">Les {audit.donnees.lignes.length} lignes les plus récentes. Seules les précisions simples sont affichées.</p>
          </>
        )}
      </section>
    </div>
  );
}
