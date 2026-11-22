import type { Metadata } from 'next';
import Link from 'next/link';
import { ChoixExercice } from '@/components/dossier';
import { PiecesJointes } from '@/components/document/pieces-jointes';
import { ErreurAcces } from '@/components/erreurs';
import { type Immobilisation, ReprendreProposition, RetirerImmobilisation, SaisirImmobilisation } from '@/components/fiscal/actions';
import { DeciderEcriture, ExporterEcritures, ProposerEcriture } from '@/components/inventaire/actions';
import { LIBELLE_ETAT_COMPTE_IMMOBILISATION, LIBELLE_ETAT_DOTATION, LIBELLE_MODE_AMORTISSEMENT, LIBELLE_TYPE_PROPOSITION, LIBELLE_VERIFICATION_SOURCE, type ReponsePropositions, type SourceInventaire } from '@/lib/fiscal';
import { Alerte, Carte, Etiquette, MentionProjet, SousTitre, Tableau, type Ton } from '@/components/ui/base';
import { type BalanceAjustee, type EcritureInventaire, LIBELLE_STATUT_ECRITURE, type StatutEcriture, comparerBalances } from '@/lib/inventaire';
import { formaterDate, formaterHorodatage, formaterMontant } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { lireMoi } from '@/lib/serveur/donnees';
import { contexteDossier, contexteExercice } from '@/lib/serveur/dossier';
import { auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Écritures d’inventaire' };

const TON: Record<StatutEcriture, Ton> = { proposee: 'attention', approuvee: 'succes', rejetee: 'neutre', exportee: 'info' };

export default async function PageInventaire({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const ex = await contexteExercice(id, sp.exercice);
  if (!ex.ok) return <ErreurAcces statut={ex.statut} message={ex.message} retour={`/dossiers/${id}`} />;
  if (!ex.exercice) return <Alerte ton="attention">Aucun exercice n’est défini pour ce dossier.</Alerte>;
  const exercice = ex.exercice;
  const [liste, balance, moi, propositions, fichierImmos] = await Promise.all([
    tenter<EcritureInventaire[]>(`v1/exercices/${exercice.id}/ecritures-inventaire`),
    tenter<BalanceAjustee>(`v1/exercices/${exercice.id}/balance-ajustee`),
    lireMoi(),
    tenter<ReponsePropositions>(`v1/exercices/${exercice.id}/inventaire/propositions`),
    tenter<Immobilisation[]>(`v1/dossiers/${id}/immobilisations`),
  ]);
  if (!liste.ok) return <ErreurAcces statut={liste.statut} message={liste.message} retour={`/dossiers/${id}`} />;
  const moiId = moi.ok ? moi.donnees.utilisateur.id : null;
  const collaboration = auMoins(ctx.niveau, 'collaboration');
  const revision = auMoins(ctx.niveau, 'revision');
  const ecritures = liste.donnees;
  const exportables = ecritures.some((e) => (e.statut === 'approuvee' || e.statut === 'exportee') && !e.aRevoir);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ChoixExercice exercices={ex.exercices} courant={exercice.id} />
        <MentionProjet />
      </div>
      <Alerte ton="neutre" className="text-sm">
        Les écritures d’inventaire sont des <strong>propositions</strong>, séparées des écritures importées qui ne sont jamais modifiées. Préparer,
        approuver, exporter et intégrer dans le logiciel comptable sont quatre étapes distinctes ; la dernière n’est pas réalisée par Comtaple.
      </Alerte>

      <section aria-labelledby="titre-propositions-moteur" className="space-y-3" data-testid="propositions-moteur">
        <SousTitre id="titre-propositions-moteur">Propositions du moteur ({propositions.ok ? propositions.donnees.propositions.length : '—'})</SousTitre>
        {!propositions.ok ? (
          <p className="text-texte-doux">{propositions.statut === 409 ? 'Aucune donnée comptable importée pour cet exercice : le moteur ne peut rien proposer.' : `Propositions indisponibles. ${propositions.message}`}</p>
        ) : (
          <>
            <p className="text-sm text-texte-doux">
              Calculées par des règles explicites et versionnées, sans IA. Rien n’est enregistré tant que personne ne reprend une proposition ; une proposition reprise devient une écriture
              proposée, à approuver par une autre personne. {propositions.donnees.amortissements.motif}
            </p>
            <Alerte ton="attention" className="text-sm" data-testid="etat-degressif" data-degressif-active={propositions.donnees.degressif.active ? 'oui' : 'non'}>
              <strong>Amortissement dégressif : {propositions.donnees.degressif.active ? 'activé' : 'non activé'}.</strong> {propositions.donnees.degressif.motif}
              {propositions.donnees.degressif.active ? '' : ' Une immobilisation déclarée en dégressif ne reçoit aucune proposition de dotation ; le linéaire n’est pas concerné.'}
            </Alerte>
            {propositions.donnees.signalCesure !== 'disponible' ? (
              <Alerte ton="attention" className="text-sm">
                {propositions.donnees.signalCesure === 'controles_obsoletes'
                  ? 'Les contrôles sont obsolètes : les factures non parvenues et à établir ne sont pas proposées. Relancez les contrôles dans l’onglet Révision.'
                  : 'Les contrôles n’ont pas été exécutés sur ces données : les factures non parvenues et à établir ne sont pas proposées.'}
              </Alerte>
            ) : null}
            {propositions.donnees.propositions.length === 0 ? <p className="text-texte-doux">Aucune proposition sur les données actuelles.</p> : null}
            <ul className="space-y-3">
              {propositions.donnees.propositions.map((p) => (
                <li key={p.id} className="space-y-2 rounded-lg border border-bordure bg-surface p-3" data-proposition={p.id}>
                  <p className="flex flex-wrap items-center gap-2">
                    <Etiquette ton="info">{LIBELLE_TYPE_PROPOSITION[p.type] ?? p.type}</Etiquette>
                    <span className="font-medium">{p.libelle}</span>
                    <span className="text-sm text-texte-doux">
                      règle {p.origine.regle} v{p.origine.versionRegle} · écriture au {formaterDate(p.dateEcriture)}
                    </span>
                  </p>
                  <p className="text-sm">{p.justification}</p>
                  <ul className="text-sm text-texte-doux">
                    {p.calcul.map((c) => (
                      <li key={c.libelle}>
                        {c.libelle} : {c.valeur}
                      </li>
                    ))}
                  </ul>
                  <Tableau legende={`Lignes proposées : ${p.libelle}`}>
                    <thead>
                      <tr>
                        <th scope="col">Compte</th>
                        <th scope="col" className="text-right">Débit</th>
                        <th scope="col" className="text-right">Crédit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.lignes.map((l, i) => (
                        <tr key={i}>
                          <th scope="row" className="!bg-transparent font-normal">
                            {l.compteNum} {l.libelle}
                          </th>
                          <td className="text-right tabular-nums">{formaterMontant(l.debit)}</td>
                          <td className="text-right tabular-nums">{formaterMontant(l.credit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Tableau>
                  <p className="text-sm">
                    Impact sur le résultat : {formaterMontant(p.impacts.resultat)}. {p.impacts.commentaire}
                  </p>
                  {p.hypotheses.length ? <p className="text-sm text-texte-doux">Hypothèses : {p.hypotheses.join(' ')}</p> : null}
                  {p.planAmortissement?.length ? (
                    <div className="space-y-1" data-testid="plan-amortissement">
                      <Tableau legende={`Plan d’amortissement année par année : ${p.libelle}`}>
                        <thead>
                          <tr>
                            <th scope="col">Exercice clos le</th>
                            <th scope="col">Méthode</th>
                            <th scope="col" className="text-right">Base de calcul</th>
                            <th scope="col" className="text-right">Dotation</th>
                            <th scope="col" className="text-right">Cumul</th>
                            <th scope="col" className="text-right">Valeur nette</th>
                            <th scope="col">Calcul</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.planAmortissement.map((l) => (
                            <tr key={l.rang} data-rang={l.rang} data-courant={l.exerciceCourant ? 'oui' : 'non'} className={l.exerciceCourant ? 'font-semibold' : undefined}>
                              <th scope="row" className="!bg-transparent font-normal">
                                {formaterDate(l.exerciceFin)}
                                {l.exerciceCourant ? ' (proposée)' : ''}
                              </th>
                              <td>{l.methode === 'degressif' ? 'Dégressif' : 'Linéaire'}</td>
                              <td className="text-right tabular-nums">{formaterMontant(l.baseCalcul)}</td>
                              <td className="text-right tabular-nums">{formaterMontant(l.dotation)}</td>
                              <td className="text-right tabular-nums">{formaterMontant(l.cumul)}</td>
                              <td className="text-right tabular-nums">{formaterMontant(l.vnc)}</td>
                              <td className="break-words">{l.formule}</td>
                            </tr>
                          ))}
                        </tbody>
                      </Tableau>
                      <p className="text-sm text-texte-doux">La somme des dotations du plan est égale au montant amortissable, au centime : le dernier exercice solde l’arrondi.</p>
                    </div>
                  ) : null}
                  {p.source ? (
                    <details className="text-sm" data-testid="sources-proposition">
                      <summary>Sources de la règle</summary>
                      <ul className="list-disc space-y-1 pl-5 break-words">
                        {[p.source, ...(p.sourcesComplementaires ?? [])].map((x: SourceInventaire, i) => (
                          <li key={i}>
                            {x.reference} — <strong>{LIBELLE_VERIFICATION_SOURCE[x.verification] ?? x.verification}</strong>
                            {x.dateVerification ? `, consultée le ${formaterDate(x.dateVerification)}` : ''}. {x.periodeApplication ?? ''}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-texte-doux">Aucune règle n’est validée par un professionnel : elles sont à valider avant tout usage.</p>
                    </details>
                  ) : null}
                  {p.reprise ? (
                    <p className="text-sm" data-testid="deja-reprise">
                      Déjà reprise comme écriture d’inventaire ({LIBELLE_STATUT_ECRITURE[p.reprise.statut as StatutEcriture] ?? p.reprise.statut}).
                    </p>
                  ) : collaboration ? (
                    <ReprendreProposition exerciceId={exercice.id} propositionId={p.id} libelle={p.libelle} />
                  ) : null}
                </li>
              ))}
            </ul>
            {propositions.donnees.abstentions.length ? (
              <details>
                <summary>Le moteur s’est abstenu {propositions.donnees.abstentions.length} fois (données insuffisantes, cas hors périmètre ou dotation déjà comptabilisée)</summary>
                <ul className="list-disc pl-5 text-sm">
                  {propositions.donnees.abstentions.slice(0, 50).map((x, i) => (
                    <li key={i}>
                      {LIBELLE_TYPE_PROPOSITION[x.type] ?? x.type} — {x.motif}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {propositions.donnees.signalements?.length ? (
              <div className="space-y-2" data-testid="signalements">
                <h3 className="font-semibold">À traiter par le professionnel ({propositions.donnees.signalements.length})</h3>
                <p className="text-sm text-texte-doux">Points que le moteur signale sans proposer d’écriture : il ne fabrique pas d’écriture non validée.</p>
                <ul className="space-y-2">
                  {propositions.donnees.signalements.map((x, i) => (
                    <li key={i} data-signalement={x.code}>
                      <Alerte ton="attention" className="text-sm break-words">
                        <strong>{x.titre}.</strong> {x.motif} <span className="text-texte-doux">Source : {x.source.reference}</span>
                      </Alerte>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="titre-immobilisations" className="space-y-3" data-testid="fichier-immobilisations">
        <SousTitre id="titre-immobilisations">Immobilisations saisies ({fichierImmos.ok ? fichierImmos.donnees.length : '—'})</SousTitre>
        <p className="text-sm text-texte-doux">
          Fichier saisi par le cabinet (ou repris d’un fichier CSV après aperçu et confirmation) pour proposer les dotations aux amortissements (linéaires ; les dégressifs sont enregistrés comme déclaration du cabinet, sans calcul tant que l’éditeur ne l’a pas activé). Ce n’est pas le fichier des immobilisations du logiciel comptable, qui reste la référence ; rien n’y
          est exporté, et aucune écriture n’est créée par cette saisie ni par une reprise.
        </p>
        {fichierImmos.ok && fichierImmos.donnees.length ? (
          <Tableau legende="Immobilisations saisies pour ce dossier">
            <thead>
              <tr>
                <th scope="col">Désignation</th>
                <th scope="col">Compte</th>
                <th scope="col" className="text-right">Valeur brute</th>
                <th scope="col">Mode</th>
                <th scope="col" className="text-right">Valeur résiduelle</th>
                <th scope="col">Acquisition</th>
                <th scope="col">Mise en service</th>
                <th scope="col" className="text-right">Durée (mois)</th>
                <th scope="col">Sortie</th>
                <th scope="col">Composant de</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {fichierImmos.donnees.map((i) => (
                <tr key={i.id} data-immobilisation={i.id}>
                  <th scope="row" className="!bg-transparent font-normal">{i.libelle}</th>
                  <td>{i.compteImmobilisation}</td>
                  <td className="text-right tabular-nums">{formaterMontant(i.baseAmortissable)}</td>
                  <td>
                    {LIBELLE_MODE_AMORTISSEMENT[i.modeAmortissement ?? 'lineaire'] ?? i.modeAmortissement}
                    {i.modeAmortissement === 'degressif' ? ` (coefficient ${(i.coefficientDegressif ?? '').replace('.', ',')}${i.eligibiliteDegressifConfirmee ? ', éligibilité confirmée' : ', éligibilité non confirmée'})` : ''}
                    {i.modeAmortissement === 'degressif' ? (
                      <span className="block text-sm text-texte-doux" data-testid="justification-immobilisation">
                        {i.justificationDegressif ? `Justification du cabinet : ${i.justificationDegressif}` : 'Justification du cabinet absente : aucune dotation dégressive n’est calculée.'}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-right tabular-nums">{i.valeurResiduelle ? formaterMontant(i.valeurResiduelle) : '—'}</td>
                  <td>{i.dateAcquisition ? formaterDate(i.dateAcquisition) : '—'}</td>
                  <td>{formaterDate(i.dateMiseEnService)}</td>
                  <td className="text-right tabular-nums">{i.dureeMois}</td>
                  <td>{i.dateSortie ? formaterDate(i.dateSortie) : '—'}</td>
                  <td>{i.composantDe ? (fichierImmos.donnees.find((x) => x.id === i.composantDe)?.libelle ?? 'structure retirée') : '—'}</td>
                  <td>{collaboration ? <RetirerImmobilisation dossierId={id} immobilisation={i} /> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        ) : null}
        <p>
          <Link href={`/dossiers/${id}/inventaire/reprise`} prefetch={false} data-testid="lien-reprise">
            {collaboration ? 'Reprendre un fichier d’immobilisations (import CSV ou XLSX)' : 'Rapports des reprises du fichier d’immobilisations'}
          </Link>
        </p>
        {collaboration ? (
          <details>
            <summary>Saisir une immobilisation</summary>
            <Carte>
              <SaisirImmobilisation dossierId={id} structures={fichierImmos.ok ? fichierImmos.donnees : []} degressifActive={propositions.ok && propositions.donnees.degressif.active} />
            </Carte>
          </details>
        ) : null}
        {propositions.ok && propositions.donnees.rapprochement ? <RapprochementComptabilite rapprochement={propositions.donnees.rapprochement} libelles={fichierImmos.ok ? Object.fromEntries(fichierImmos.donnees.map((x) => [x.id, x.libelle])) : {}} /> : null}
      </section>

      <section aria-labelledby="titre-ecritures" className="space-y-3">
        <SousTitre id="titre-ecritures">Écritures proposées ({ecritures.length})</SousTitre>
        {ecritures.length === 0 ? <p className="text-texte-doux">Aucune écriture d’inventaire proposée pour cet exercice.</p> : null}
        <ul className="space-y-3" data-testid="liste-ecritures">
          {ecritures.map((e) => (
            <li key={e.id} className="space-y-2 rounded-lg border border-bordure bg-surface p-3" data-ecriture={e.id} data-statut={e.statut}>
              <p className="flex flex-wrap items-center gap-2">
                <Etiquette ton={TON[e.statut] ?? 'neutre'}>{LIBELLE_STATUT_ECRITURE[e.statut] ?? e.statut}</Etiquette>
                {e.statut === 'proposee' ? <MentionProjet>Projet — sans effet</MentionProjet> : null}
                {e.aRevoir ? (
                  <Etiquette ton="attention" data-testid="a-revoir">
                    À revoir : données importées modifiées depuis la proposition
                  </Etiquette>
                ) : null}
                <span className="font-medium break-words">{e.libelle}</span>
                <span className="text-sm text-texte-doux">du {formaterDate(e.dateEcriture)}</span>
              </p>
              <Tableau legende={`Lignes de l’écriture « ${e.libelle} »`}>
                <thead>
                  <tr>
                    <th scope="col">Compte</th>
                    <th scope="col">Libellé</th>
                    <th scope="col" className="text-right">Débit</th>
                    <th scope="col" className="text-right">Crédit</th>
                  </tr>
                </thead>
                <tbody>
                  {e.lignes.map((l, i) => (
                    <tr key={i}>
                      <td className="font-mono">{l.compteNum}</td>
                      <td className="break-words">{l.compteLib}</td>
                      <td className="text-right tabular-nums">{formaterMontant(l.debit)}</td>
                      <td className="text-right tabular-nums">{formaterMontant(l.credit)}</td>
                    </tr>
                  ))}
                </tbody>
              </Tableau>
              <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-texte-doux">Total</dt>
                <dd className="tabular-nums">{formaterMontant(e.totalDebit)}</dd>
                <dt className="text-texte-doux">Justification</dt>
                <dd className="break-words whitespace-pre-wrap">{e.justification}</dd>
                <dt className="text-texte-doux">Calcul</dt>
                <dd className="break-words whitespace-pre-wrap">{e.calcul}</dd>
                <dt className="text-texte-doux">Proposée</dt>
                <dd>
                  le {formaterHorodatage(e.creeLe)}
                  {e.proposeePar === moiId ? ' par vous' : e.proposeeParNom ? ` par ${e.proposeeParNom}` : ''} · version des données {e.versionDonnees}
                </dd>
                {e.decideeLe ? (
                  <>
                    <dt className="text-texte-doux">Décision</dt>
                    <dd className="break-words">
                      le {formaterHorodatage(e.decideeLe)}
                      {e.decideePar === moiId ? ' par vous' : e.decideeParNom ? ` par ${e.decideeParNom}` : ''}
                      {e.motifDecision ? ` — motif : ${e.motifDecision}` : ''}
                    </dd>
                  </>
                ) : null}
                {e.exporteeLe ? (
                  <>
                    <dt className="text-texte-doux">Exportée</dt>
                    <dd>le {formaterHorodatage(e.exporteeLe)} (fichier remis ; intégration non réalisée par Comtaple)</dd>
                  </>
                ) : null}
              </dl>
              <PiecesJointes pieces={e.piecesJointes} dossierId={id} titre="Pièces justificatives" />
              {e.statut === 'proposee' ? (
                !revision ? (
                  <p className="text-sm text-texte-doux">La décision est réservée au niveau « Révision » sur ce dossier.</p>
                ) : e.proposeePar === moiId ? (
                  <p className="text-sm text-texte-doux" data-testid="decision-auteur">
                    Vous avez proposé cette écriture : une autre personne habilitée en révision doit l’approuver ou la rejeter.
                  </p>
                ) : (
                  <DeciderEcriture ecritureId={e.id} aRevoir={e.aRevoir} />
                )
              ) : null}
            </li>
          ))}
        </ul>
        {collaboration ? (
          <Carte className="space-y-3">
            <SousTitre className="text-base">Proposer une écriture d’inventaire</SousTitre>
            <ProposerEcriture exerciceId={exercice.id} dossierId={id} debut={exercice.debut} fin={exercice.fin} />
          </Carte>
        ) : null}
      </section>

      <section aria-labelledby="titre-export" className="space-y-2">
        <SousTitre id="titre-export">Export</SousTitre>
        {revision ? (
          exportables ? (
            <ExporterEcritures exerciceId={exercice.id} />
          ) : (
            <p className="text-texte-doux">Aucune écriture approuvée à exporter pour l’instant.</p>
          )
        ) : (
          <p className="text-texte-doux">L’export est réservé au niveau « Révision » sur ce dossier.</p>
        )}
      </section>

      <section aria-labelledby="titre-balance-ajustee" className="space-y-3" id="balance-ajustee">
        <div className="flex flex-wrap items-center gap-2">
          <SousTitre id="titre-balance-ajustee">Balance ajustée de travail</SousTitre>
          <Etiquette ton="attention">PROJET</Etiquette>
        </div>
        {!balance.ok ? (
          <Alerte ton="attention" data-testid="balance-ajustee-indisponible">
            {balance.statut === 409 ? balance.message : `La balance ajustée n’a pas pu être chargée. ${balance.message}`}
          </Alerte>
        ) : (
          (() => {
            const b = balance.donnees;
            const lignes = comparerBalances(b.balanceImportee, b.balanceAjustee);
            const modifiees = lignes.filter((l) => l.modifiee);
            const table = (titre: string, selection: typeof lignes) => (
              <Tableau legende={titre}>
                <thead>
                  <tr>
                    <th scope="col" rowSpan={2}>Compte</th>
                    <th scope="colgroup" colSpan={2} className="text-center">Importée</th>
                    <th scope="colgroup" colSpan={2} className="text-center">Ajustée</th>
                  </tr>
                  <tr>
                    <th scope="col" className="text-right">Solde débiteur</th>
                    <th scope="col" className="text-right">Solde créditeur</th>
                    <th scope="col" className="text-right">Solde débiteur</th>
                    <th scope="col" className="text-right">Solde créditeur</th>
                  </tr>
                </thead>
                <tbody>
                  {selection.map((l) => (
                    <tr key={l.compteNum} data-compte={l.compteNum} data-modifiee={l.modifiee}>
                      <th scope="row" className="!bg-transparent font-medium">
                        <span className="font-mono">{l.compteNum}</span> <span className="font-normal break-words">{l.compteLib}</span>
                      </th>
                      <td className="text-right tabular-nums">{l.importee ? formaterMontant(l.importee.soldeDebiteur) : 'absent'}</td>
                      <td className="text-right tabular-nums">{l.importee ? formaterMontant(l.importee.soldeCrediteur) : 'absent'}</td>
                      <td className="text-right font-medium tabular-nums">{l.ajustee ? formaterMontant(l.ajustee.soldeDebiteur) : 'absent'}</td>
                      <td className="text-right font-medium tabular-nums">{l.ajustee ? formaterMontant(l.ajustee.soldeCrediteur) : 'absent'}</td>
                    </tr>
                  ))}
                </tbody>
              </Tableau>
            );
            return (
              <>
                <Alerte ton="attention" data-testid="mention-balance-ajustee">
                  <strong>{b.mention}</strong>
                </Alerte>
                {b.ecrituresEcarteesCarDonneesModifiees > 0 ? (
                  <Alerte ton="attention" role="status" data-testid="ecritures-ecartees">
                    {b.ecrituresEcarteesCarDonneesModifiees} écriture(s) approuvée(s) écartée(s) car les données importées ont changé depuis leur proposition : elles sont à revoir
                    et à proposer à nouveau.
                  </Alerte>
                ) : null}
                <div data-testid="ecritures-prises-en-compte">
                  <p className="font-medium">Écritures prises en compte ({b.ecrituresPrisesEnCompte.length})</p>
                  {b.ecrituresPrisesEnCompte.length ? (
                    <ul className="list-disc pl-5">
                      {b.ecrituresPrisesEnCompte.map((e) => (
                        <li key={e.id} className="break-words">
                          {formaterDate(e.dateEcriture)} — {e.libelle} : <span className="tabular-nums">{formaterMontant(e.total)}</span> ({(LIBELLE_STATUT_ECRITURE[e.statut] ?? e.statut).toLowerCase()})
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-texte-doux">Aucune : seules les écritures approuvées comptent. La balance ajustée est identique à la balance importée.</p>
                  )}
                </div>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]" data-testid="impact-resultat">
                  <dt className="text-texte-doux">Résultat d’après la balance importée</dt>
                  <dd className="tabular-nums">{formaterMontant(b.impact.resultatAvant)}</dd>
                  <dt className="text-texte-doux">Résultat d’après la balance ajustée</dt>
                  <dd className="tabular-nums">{formaterMontant(b.impact.resultatApres)}</dd>
                  <dt className="text-texte-doux">Impact sur le résultat</dt>
                  <dd className="font-semibold tabular-nums" data-testid="variation-resultat">{formaterMontant(b.impact.variation)}</dd>
                </dl>
                <p className="tabular-nums" data-testid="totaux-balances">
                  Total des débits — importée : {formaterMontant(b.balanceImportee.totalDebit)} · ajustée : {formaterMontant(b.balanceAjustee.totalDebit)}
                  {b.balanceAjustee.equilibree ? '' : ` · balance ajustée déséquilibrée, écart ${formaterMontant(b.balanceAjustee.ecart)}`}
                </p>
                {modifiees.length ? table('Comptes modifiés par les écritures d’inventaire', modifiees) : null}
                <details>
                  <summary className="min-h-11 cursor-pointer content-center font-medium">Tous les comptes, importée et ajustée côte à côte ({lignes.length})</summary>
                  {table('Balance importée et balance ajustée, tous les comptes', lignes)}
                </details>
              </>
            );
          })()
        )}
      </section>
    </div>
  );
}


/** Rapprochement du fichier saisi avec la comptabilité importée : écarts affichés, jamais corrigés. */
function RapprochementComptabilite({ rapprochement, libelles }: { rapprochement: NonNullable<ReponsePropositions['rapprochement']>; libelles: Record<string, string> }) {
  const nom = (ids: string[]) => ids.map((i) => libelles[i] ?? i).join(', ');
  const tonDotation: Record<string, Ton> = { aucune_dotation_comptabilisee: 'neutre', identique: 'succes', differente: 'attention', non_ventilee: 'attention', calcul_indisponible: 'attention' };
  const vide = rapprochement.dotations.length === 0 && rapprochement.comptes.length === 0 && rapprochement.comptesSansImmobilisation.length === 0;
  return (
    <div className="space-y-3" data-testid="rapprochement-immobilisations">
      <h3 className="font-semibold">Rapprochement avec la comptabilité importée</h3>
      <p className="text-sm text-texte-doux">
        Le moteur compare le fichier saisi aux écritures importées. Une dotation déjà comptabilisée n’est jamais reproposée ; l’écart éventuel est affiché et n’est jamais corrigé.
      </p>
      {vide ? <p className="text-sm text-texte-doux">Rien à rapprocher.</p> : null}
      {rapprochement.dotations.length ? (
        <ul className="space-y-2">
          {rapprochement.dotations.map((d) => (
            <li key={d.compteDotation} className="space-y-1 rounded-lg border border-bordure bg-surface p-3 text-sm" data-rapprochement-dotation={d.compteDotation} data-etat={d.etat}>
              <p className="flex flex-wrap items-center gap-2">
                <Etiquette ton={tonDotation[d.etat] ?? 'neutre'}>{LIBELLE_ETAT_DOTATION[d.etat] ?? d.etat}</Etiquette>
                <span className="font-medium">Compte {d.compteDotation}</span>
                <span className="text-texte-doux break-words">{nom(d.immobilisations)}</span>
              </p>
              <p>
                Calculée par le moteur : {d.dotationCalculee === null ? 'indisponible' : formaterMontant(d.dotationCalculee)} · comptabilisée : {formaterMontant(d.dotationComptabilisee)}
                {d.ecart !== null ? ` · écart (comptabilisé − calculé) : ${formaterMontant(d.ecart)}` : ''}
              </p>
              <p className="text-texte-doux break-words">{d.message}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {rapprochement.comptes.length ? (
        <ul className="space-y-1 text-sm">
          {rapprochement.comptes.map((c) => (
            <li key={c.compte} data-rapprochement-compte={c.compte} data-etat={c.etat} className="break-words">
              <Etiquette ton={c.etat === 'concordant' ? 'succes' : 'attention'}>{LIBELLE_ETAT_COMPTE_IMMOBILISATION[c.etat] ?? c.etat}</Etiquette> {c.message}
            </li>
          ))}
        </ul>
      ) : null}
      {rapprochement.comptesSansImmobilisation.length ? (
        <div data-testid="comptes-a-saisir">
          <p className="text-sm font-medium">Comptes d’immobilisation de la balance sans immobilisation saisie ({rapprochement.comptesSansImmobilisation.length}) — à saisir</p>
          <ul className="list-disc pl-5 text-sm break-words">
            {rapprochement.comptesSansImmobilisation.map((c) => (
              <li key={c.compte} data-compte-a-saisir={c.compte}>
                {c.compte} {c.libelle} : solde {formaterMontant(c.solde)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
