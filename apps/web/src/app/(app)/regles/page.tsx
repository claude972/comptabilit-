import type { Metadata } from 'next';
import Link from 'next/link';
import { ErreurAcces } from '@/components/erreurs';
import { DecisionRegle, MesurerImpact, ProposerRegle } from '@/components/regles/actions';
import { CarteSuggestion } from '@/components/regles/suggestions';
import { EtiquetteStatutControle } from '@/components/revision-affichage';
import { Alerte, Carte, Etiquette, MentionProjet, SousTitre, Titre, type Ton } from '@/components/ui/base';
import type { MembreCabinet } from '@/lib/administration';
import { estGestionnaire } from '@/lib/messagerie';
import { formaterHorodatage } from '@/lib/montants';
import { EXPLICATION_REGLEMENTAIRE, LIBELLE_STATUT_REGLE, ORDRE_STATUTS_REGLE, REGLES_DU_JEU, type PageRegles, type StatutRegle, TITRE_STATUT_REGLE, type VueSuggestions, afficherParametre, suggestionAPreremplir } from '@/lib/regles';
import { tenter } from '@/lib/serveur/api';
import { lireDossiers, lireMoi, parametre } from '@/lib/serveur/donnees';
import { type ControleCatalogue, auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Règles du cabinet' };

const TON: Record<StatutRegle, Ton> = { proposee: 'attention', approuvee: 'succes', retiree: 'neutre', refusee: 'neutre' };

export default async function PageRegles({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const recherche = await searchParams;
  const brute = recherche.page;
  const page = Math.max(1, Number.parseInt((Array.isArray(brute) ? brute[0] : brute) ?? '1', 10) || 1);
  const moi = await lireMoi();
  if (!moi.ok) return <ErreurAcces statut={moi.statut} message={moi.message} />;
  const { role, utilisateur } = moi.donnees;
  if (role === 'client_deposant' || role === 'client_lecture') return <ErreurAcces statut={403} message="Les règles du cabinet sont réservées aux membres du cabinet." />;
  const gestionnaire = estGestionnaire(role);
  // Suggestions tirées des corrections : réviseurs, associés, administrateurs (l'API refuse les autres rôles).
  const voitSuggestions = gestionnaire || role === 'reviseur';
  const [regles, catalogue, dossiers, membres, suggestions] = await Promise.all([
    tenter<PageRegles>(`v1/regles?page=${page}`),
    tenter<ControleCatalogue[]>('v1/reference/controles'),
    lireDossiers(),
    gestionnaire ? tenter<MembreCabinet[]>('v1/cabinet/membres') : null,
    voitSuggestions ? tenter<VueSuggestions>('v1/regles/suggestions') : null,
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
  const vue = suggestions?.ok ? suggestions.donnees : null;
  // « Proposer cette règle » depuis une suggestion : seule une suggestion EN COURS et proposable pré-remplit le formulaire.
  const aPreremplir = suggestionAPreremplir(vue, parametre(recherche.suggestion));

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

      {voitSuggestions ? (
        <section aria-labelledby="titre-suggestions" className="space-y-2" data-testid="suggestions">
          <SousTitre id="titre-suggestions">Suggestions tirées des corrections ({vue ? vue.suggestions.filter((x) => x.categorie !== 'correction_donnee').length : 0})</SousTitre>
          {!vue ? (
            <Alerte ton="attention">Les suggestions n’ont pas pu être calculées pour le moment.</Alerte>
          ) : (
            <>
              <p className="text-sm text-texte-doux" data-testid="cadre-suggestions">
                Calcul déterministe, sans IA, sur les décisions de revue des {vue.perimetre.fenetreMois} derniers mois. {vue.perimetre.mention} Critères v{vue.criteres.version} — {vue.criteres.statut}. Une suggestion n’active rien : elle ne devient une règle
                proposée que si une personne le décide.
              </p>
              {vue.perimetre.plafondsAtteints.length ? <Alerte ton="attention">Volume important : les décisions les plus anciennes n’ont pas été comptées ({vue.perimetre.plafondsAtteints.join(', ')}).</Alerte> : null}
              {vue.suggestions.length === 0 ? (
                <p className="text-texte-doux" data-testid="aucune-suggestion">
                  {vue.sansDecision ? 'Aucune décision de revue dans votre périmètre : rien à suggérer.' : 'Aucune récurrence n’atteint les seuils : rien à suggérer.'}
                </p>
              ) : null}
              <ul className="space-y-3">
                {vue.suggestions.map((x) => (
                  <CarteSuggestion key={x.empreinte} suggestion={x} peutProposer={peutProposer} />
                ))}
              </ul>
              {vue.ecarteesMaintenues.length ? (
                <details data-testid="suggestions-ecartees">
                  <summary className="flex min-h-11 cursor-pointer items-center font-medium">Suggestions écartées ou déjà tranchées ({vue.ecarteesMaintenues.length})</summary>
                  <ul className="list-disc pl-5 text-sm">
                    {vue.ecarteesMaintenues.map((e) => (
                      <li key={`${e.empreinte}-${e.le}`} className="break-words">
                        <span className="font-mono">{e.empreinte.split('|').slice(0, 2).join(' · ')}</span> — {formaterHorodatage(e.le)} — {e.motif}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {peutProposer ? (
        <Carte className="space-y-3" id="proposer">
          <SousTitre>Proposer une règle</SousTitre>
          {!catalogue.ok ? (
            <Alerte ton="attention">Le catalogue des contrôles est indisponible : impossible de proposer une règle pour l’instant.</Alerte>
          ) : (
            <ProposerRegle
              controles={controles.map((c) => ({ id: c.id, titre: c.titre, parametresParDefaut: c.parametresParDefaut ?? {}, reglementaire: c.source?.type === 'reglementaire' }))}
              dossiers={dossiersActifs}
              cabinetPossible={role !== 'collaborateur'}
              initiale={aPreremplir?.proposition ?? null}
              key={parametre(recherche.suggestion) ?? 'vierge'}
            />
          )}
        </Carte>
      ) : null}

      {regles.donnees.total > regles.donnees.taillePage || page > 1 ? (
        <nav aria-label="Pages de règles" className="flex flex-wrap items-center gap-3" data-testid="pagination-regles">
          {page > 1 ? <Link href={`/regles?page=${page - 1}`} prefetch={false} rel="prev">← Plus récentes</Link> : <span className="text-texte-doux">← Plus récentes</span>}
          <span>
            Page {page} — {regles.donnees.regles.length} règle(s) affichée(s) sur {regles.donnees.total}, des plus récentes aux plus anciennes
          </span>
          {regles.donnees.suite ? <Link href={`/regles?page=${page + 1}`} prefetch={false} rel="next">Plus anciennes →</Link> : <span className="text-texte-doux">Plus anciennes →</span>}
        </nav>
      ) : null}
      {ORDRE_STATUTS_REGLE.map((statut) => {
        const liste = regles.donnees.regles.filter((r) => r.statut === statut);
        const totalStatut = regles.donnees.parStatut[statut] ?? 0;
        return (
          <section key={statut} aria-labelledby={`titre-${statut}`} className="space-y-2" data-statut-regles={statut}>
            <SousTitre id={`titre-${statut}`}>
              {TITRE_STATUT_REGLE[statut]} ({totalStatut})
            </SousTitre>
            {totalStatut === 0 ? <p className="text-texte-doux">Aucune.</p> : liste.length === 0 ? <p className="text-texte-doux">Aucune sur cette page.</p> : null}
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
