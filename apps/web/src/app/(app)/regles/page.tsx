import type { Metadata } from 'next';
import { ErreurAcces } from '@/components/erreurs';
import { DecisionRegle, MesurerImpact, ProposerRegle } from '@/components/regles/actions';
import { EtiquetteStatutControle } from '@/components/revision-affichage';
import { Alerte, Carte, Etiquette, MentionProjet, SousTitre, Titre, type Ton } from '@/components/ui/base';
import type { MembreCabinet } from '@/lib/administration';
import { estGestionnaire } from '@/lib/messagerie';
import { formaterHorodatage } from '@/lib/montants';
import { EXPLICATION_REGLEMENTAIRE, LIBELLE_STATUT_REGLE, ORDRE_STATUTS_REGLE, REGLES_DU_JEU, type RegleCabinet, type StatutRegle, TITRE_STATUT_REGLE, afficherParametre } from '@/lib/regles';
import { tenter } from '@/lib/serveur/api';
import { lireDossiers, lireMoi } from '@/lib/serveur/donnees';
import { type ControleCatalogue, auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Règles du cabinet' };

const TON: Record<StatutRegle, Ton> = { proposee: 'attention', approuvee: 'succes', retiree: 'neutre', refusee: 'neutre' };

export default async function PageRegles() {
  const moi = await lireMoi();
  if (!moi.ok) return <ErreurAcces statut={moi.statut} message={moi.message} />;
  const { role, utilisateur } = moi.donnees;
  if (role === 'client_deposant' || role === 'client_lecture') return <ErreurAcces statut={403} message="Les règles du cabinet sont réservées aux membres du cabinet." />;
  const gestionnaire = estGestionnaire(role);
  const [regles, catalogue, dossiers, membres] = await Promise.all([
    tenter<RegleCabinet[]>('v1/regles'),
    tenter<ControleCatalogue[]>('v1/reference/controles'),
    lireDossiers(),
    gestionnaire ? tenter<MembreCabinet[]>('v1/cabinet/membres') : null,
  ]);
  if (!regles.ok) return <ErreurAcces statut={regles.statut} message={regles.message} />;
  const controles = catalogue.ok ? catalogue.donnees : [];
  const titreDe = new Map(controles.map((c) => [c.id, c]));
  const tousDossiers = dossiers.ok ? dossiers.donnees : [];
  const nomDossier = new Map(tousDossiers.map((d) => [d.id, d.raisonSociale]));
  // Proposer une exception ou mesurer un impact demande le niveau « collaboration » sur le dossier (l'API vérifie).
  const dossiersActifs = tousDossiers.filter((d) => auMoins(d.niveau, 'collaboration')).map((d) => ({ id: d.id, raisonSociale: d.raisonSociale }));
  const nomMembre = new Map((membres?.ok ? membres.donnees : []).map((m) => [m.utilisateurId, m.nom]));
  const qui = (id: string | null) => (!id ? '—' : id === utilisateur.id ? 'vous' : (nomMembre.get(id) ?? 'un autre membre du cabinet'));
  const peutProposer = role !== 'support';

  return (
    <div className="space-y-6">
      <Titre>Règles du cabinet</Titre>
      <Alerte ton="neutre" data-testid="regles-du-jeu">
        <p className="font-semibold">Règles du jeu</p>
        <ul className="list-disc pl-5">
          {REGLES_DU_JEU.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="mt-1 text-sm">Les contrôles à fondement réglementaire ne sont pas paramétrables. {gestionnaire ? '' : 'Approuver, refuser et retirer sont réservés aux administrateurs et associés.'}</p>
      </Alerte>

      {peutProposer ? (
        <Carte className="space-y-3">
          <SousTitre>Proposer une règle</SousTitre>
          {!catalogue.ok ? (
            <Alerte ton="attention">Le catalogue des contrôles est indisponible : impossible de proposer une règle pour l’instant.</Alerte>
          ) : (
            <ProposerRegle
              controles={controles.map((c) => ({ id: c.id, titre: c.titre, parametresParDefaut: c.parametresParDefaut ?? {}, reglementaire: c.source?.type === 'reglementaire' }))}
              dossiers={dossiersActifs}
              cabinetPossible={role !== 'collaborateur'}
            />
          )}
        </Carte>
      ) : null}

      {ORDRE_STATUTS_REGLE.map((statut) => {
        const liste = regles.donnees.filter((r) => r.statut === statut);
        return (
          <section key={statut} aria-labelledby={`titre-${statut}`} className="space-y-2" data-statut-regles={statut}>
            <SousTitre id={`titre-${statut}`}>
              {TITRE_STATUT_REGLE[statut]} ({liste.length})
            </SousTitre>
            {liste.length === 0 ? <p className="text-texte-doux">Aucune.</p> : null}
            <ul className="space-y-3">
              {liste.map((r) => {
                const c = titreDe.get(r.controleId);
                return (
                  <li key={r.id} className="space-y-2 rounded-lg border border-bordure bg-surface p-3" data-regle={r.id} data-statut={r.statut}>
                    <p className="flex flex-wrap items-center gap-2">
                      <Etiquette ton={TON[r.statut] ?? 'neutre'}>{LIBELLE_STATUT_REGLE[r.statut] ?? r.statut}</Etiquette>
                      {r.statut === 'proposee' ? <MentionProjet>Projet — sans effet tant qu’elle n’est pas approuvée</MentionProjet> : null}
                      <span className="font-mono">{r.controleId}</span>
                      <span className="font-medium break-words">{c?.titre ?? ''}</span>
                      <span className="text-sm text-texte-doux">version {r.version}</span>
                    </p>
                    <p data-testid="portee">
                      Portée : {r.entiteId ? <>dossier « {nomDossier.get(r.entiteId) ?? 'dossier auquel vous n’avez pas accès'} »</> : 'tout le cabinet'}
                    </p>
                    <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]" data-testid="parametres">
                      {Object.entries(r.parametres ?? {}).map(([cle, v]) => (
                        <div key={cle} className="contents">
                          <dt className="font-mono text-texte-doux">{cle}</dt>
                          <dd className="break-words">
                            {afficherParametre(v)}
                            {c && cle in (c.parametresParDefaut ?? {}) ? <span className="text-texte-doux"> (par défaut : {afficherParametre(c.parametresParDefaut[cle])})</span> : null}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className="text-sm break-words whitespace-pre-wrap">Motif : {r.motif || '—'}</p>
                    <p className="text-sm text-texte-doux">
                      Proposée par {qui(r.proposeePar)} le {formaterHorodatage(r.creeLe)}
                      {r.decideeLe ? ` · décision du ${formaterHorodatage(r.decideeLe)}${r.approuveePar ? ` par ${qui(r.approuveePar)}` : ''}` : ''}
                    </p>
                    {r.impact ? (
                      <div className="rounded-lg bg-surface-2 p-3 text-sm" data-testid="impact">
                        <p className="font-medium">Impact mesuré le {formaterHorodatage(r.impact.mesureLe)} (version des données {r.impact.versionDonnees})</p>
                        <dl className="mt-1 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
                          <dt className="text-texte-doux">Avant (paramètres en vigueur)</dt>
                          <dd className="flex flex-wrap items-center gap-2" data-testid="impact-avant">
                            <EtiquetteStatutControle statut={r.impact.avant.statut} /> {r.impact.avant.constats} constat(s)
                          </dd>
                          <dt className="text-texte-doux">Après (paramètres proposés)</dt>
                          <dd className="flex flex-wrap items-center gap-2" data-testid="impact-apres">
                            <EtiquetteStatutControle statut={r.impact.apres.statut} /> {r.impact.apres.constats} constat(s)
                          </dd>
                          <dt className="text-texte-doux">Constats qui disparaissent</dt>
                          <dd data-testid="impact-disparaissent">{r.impact.constatsQuiDisparaissent}</dd>
                          <dt className="text-texte-doux">Constats qui apparaissent</dt>
                          <dd data-testid="impact-apparaissent">{r.impact.constatsQuiApparaissent}</dd>
                        </dl>
                        <p className="mt-1 text-texte-doux">Mesure faite sur un seul exercice : elle éclaire la décision, elle ne la remplace pas.</p>
                      </div>
                    ) : r.statut === 'proposee' ? (
                      <p className="text-sm" data-testid="impact-absent">
                        <Etiquette ton="vide">Impact non mesuré</Etiquette> L’approbation est impossible tant que l’impact n’a pas été mesuré.
                      </p>
                    ) : null}
                    {r.statut === 'proposee' && peutProposer ? <MesurerImpact regleId={r.id} entiteId={r.entiteId} dossiers={dossiersActifs} dejaMesure={r.impact !== null} /> : null}
                    {gestionnaire ? <DecisionRegle regleId={r.id} statut={r.statut} impactMesure={r.impact !== null} proposeeParMoi={r.proposeePar === utilisateur.id} /> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <p className="text-sm text-texte-doux">{EXPLICATION_REGLEMENTAIRE}</p>
    </div>
  );
}
