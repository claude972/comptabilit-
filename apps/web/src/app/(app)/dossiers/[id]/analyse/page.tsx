import type { Metadata } from 'next';
import Link from 'next/link';
import { ChoixExercice } from '@/components/dossier';
import { ErreurAcces } from '@/components/erreurs';
import { LienSource } from '@/components/revision-affichage';
import { TacheIa } from '@/components/assistant/taches';
import { Alerte, Carte, Etiquette, Libelle, Saisie, SousTitre, Tableau } from '@/components/ui/base';
import { auMoins } from '@/lib/types-api';
import { Bouton } from '@/components/ui/bouton';
import {
  type ControleEtat, type DefinitionIndicateur, type EtatProjet, type Etats, type Indicateurs, LIBELLE_FAMILLE, ORDRE_FAMILLES, PHRASE_SIGNAUX, type Rubrique, type ValeurIndicateur, filtrerBalance, formaterNombre,
  formaterValeur, libelleTotal, paginer, tauxSaisi,
} from '@/lib/analyse';
import { formaterMontant } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { parametre } from '@/lib/serveur/donnees';
import { contexteDossier, contexteExercice } from '@/lib/serveur/dossier';

export const metadata: Metadata = { title: 'Analyse du dossier' };

const PAR_PAGE = 50;

function Projet() {
  return (
    <Etiquette ton="attention" data-testid="mention-projet-etat">
      PROJET
    </Etiquette>
  );
}

function Controles({ controles }: { controles: ControleEtat[] }) {
  if (!controles.length) return null;
  return (
    <ul className="space-y-1 text-sm" data-testid="controles-internes">
      {controles.map((c) => (
        <li key={c.code} className="flex flex-wrap items-start gap-2" data-controle-etat={c.statut}>
          <Etiquette ton={c.statut === 'ok' ? 'succes' : c.statut === 'ecart' ? 'danger' : 'vide'}>{c.statut === 'ok' ? 'Cohérent' : c.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette>
          <span className="break-words">
            {c.message}
            {c.statut === 'ecart' && c.ecart ? ` Écart : ${formaterMontant(c.ecart)}.` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Comptes({ r }: { r: Rubrique }) {
  if (!r.comptes?.length) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-texte-doux">{r.comptes.length} compte{r.comptes.length > 1 ? 's' : ''}</summary>
      <ul>
        {r.comptes.map((c, i) => (
          <li key={`${c.compteNum}-${i}`} className="break-words">
            <span className="font-mono">{c.compteNum}</span> {c.compteLib} : <span className="tabular-nums">{formaterMontant(c.montant)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function EtatAffiche({ titre, etat, id, n1 }: { titre: string; etat: EtatProjet; id: string; n1: EtatProjet | null }) {
  const parCodeN1 = new Map((n1?.rubriques ?? []).map((r) => [r.code, r]));
  const actif = etat.rubriques.filter((r) => r.brut !== undefined);
  const autres = etat.rubriques.filter((r) => r.brut === undefined);
  return (
    <Carte className="space-y-3" data-testid={id}>
      <div className="flex flex-wrap items-center gap-2">
        <SousTitre>{titre}</SousTitre>
        <Projet />
        {!etat.complet ? <Etiquette ton="danger">Incomplet</Etiquette> : null}
      </div>
      {!etat.complet ? (
        <Alerte ton="danger" role="alert" titre="État incomplet : ne pas le lire comme un total fiable" data-testid={`${id}-incomplet`}>
          <ul className="list-disc pl-5">
            {etat.motifsIncompletude.map((m, i) => (
              <li key={i} className="break-words">
                {m}
              </li>
            ))}
          </ul>
        </Alerte>
      ) : null}
      {actif.length ? (
        <Tableau legende={`${titre} — actif`}>
          <thead>
            <tr>
              <th scope="col">Actif</th>
              <th scope="col" className="text-right">Brut</th>
              <th scope="col" className="text-right">Amortissements et dépréciations</th>
              <th scope="col" className="text-right">Net</th>
              {n1 ? <th scope="col" className="text-right" data-testid={`${id}-colonne-n1`}>Net N-1</th> : null}
            </tr>
          </thead>
          <tbody>
            {actif.map((r) => (
              <tr key={r.code} data-rubrique={r.code}>
                <th scope="row" className="!bg-transparent font-medium">
                  {r.libelle}
                  <Comptes r={r} />
                </th>
                <td className="text-right tabular-nums">{formaterMontant(r.brut)}</td>
                <td className="text-right tabular-nums">{formaterMontant(r.amortissementsDepreciations)}</td>
                <td className="text-right tabular-nums">{formaterMontant(r.montant)}</td>
                {n1 ? <td className="text-right tabular-nums" data-n1={r.code}>{formaterMontant(parCodeN1.get(r.code)?.montant)}</td> : null}
              </tr>
            ))}
          </tbody>
        </Tableau>
      ) : null}
      {autres.length ? (
        <Tableau legende={actif.length ? `${titre} — passif` : titre}>
          <thead>
            <tr>
              <th scope="col">{actif.length ? 'Passif' : 'Rubrique'}</th>
              <th scope="col" className="text-right">Montant</th>
              {n1 ? <th scope="col" className="text-right" data-testid={`${id}-colonne-n1-bis`}>N-1</th> : null}
            </tr>
          </thead>
          <tbody>
            {autres.map((r) => (
              <tr key={r.code} data-rubrique={r.code}>
                <th scope="row" className="!bg-transparent font-medium">
                  {r.libelle}
                  <Comptes r={r} />
                </th>
                <td className="text-right tabular-nums">{formaterMontant(r.montant)}</td>
                {n1 ? <td className="text-right tabular-nums" data-n1={r.code}>{formaterMontant(parCodeN1.get(r.code)?.montant)}</td> : null}
              </tr>
            ))}
          </tbody>
        </Tableau>
      ) : null}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]" data-testid={`${id}-totaux`}>
        {Object.entries(etat.totaux ?? {}).map(([cle, v]) => (
          <div key={cle} className="contents">
            <dt className="text-texte-doux">{libelleTotal(cle)}</dt>
            <dd className="font-semibold tabular-nums">
              {formaterMontant(v)}
              {n1 ? <span className="ml-3 font-normal text-texte-doux" data-testid={`${id}-total-n1-${cle}`}>N-1 : {formaterMontant(n1.totaux?.[cle])}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      {etat.comptesNonAffectes.length ? (
        <Alerte ton="attention" titre={`Comptes non affectés à une rubrique (${etat.comptesNonAffectes.length})`} data-testid={`${id}-non-affectes`}>
          <ul>
            {etat.comptesNonAffectes.slice(0, 50).map((c) => (
              <li key={c.compteNum} className="break-words">
                <span className="font-mono">{c.compteNum}</span> {c.compteLib} — solde <span className="tabular-nums">{formaterMontant(c.solde)}</span>
              </li>
            ))}
          </ul>
        </Alerte>
      ) : null}
      <div>
        <p className="font-medium">Contrôles internes</p>
        <Controles controles={etat.controles} />
        <p className="mt-1 text-sm text-texte-doux">Un écart est affiché tel quel : aucun ajustement ne force l’égalité.</p>
      </div>
    </Carte>
  );
}

function Indicateur({ v, d }: { v: ValeurIndicateur; d: DefinitionIndicateur | undefined }) {
  const signal = d?.famille === 'signal';
  return (
    <li className="space-y-1 rounded-lg border border-bordure bg-surface p-3" data-indicateur={v.id} data-statut={v.statut}>
      <p className="font-medium break-words">{d?.libelle ?? v.id}</p>
      {v.statut === 'non_calculable' ? (
        <p data-testid="non-calculable">
          <Etiquette ton="vide">Non calculable</Etiquette> <span className="break-words">{v.motif ?? 'Motif non précisé.'}</span>
        </p>
      ) : signal ? (
        <p>
          {v.aExaminer === true ? <Etiquette ton="attention">À examiner</Etiquette> : v.aExaminer === false ? <Etiquette>Rien de particulier relevé dans les écritures</Etiquette> : <Etiquette ton="vide">Non déterminé</Etiquette>}
          {v.valeur !== null ? <span className="ml-2 text-sm tabular-nums text-texte-doux">Mesure : {formaterValeur(v.valeur, v.unite)}</span> : null}
        </p>
      ) : (
        <p className="text-xl font-semibold tabular-nums" data-testid="valeur-indicateur">
          {formaterValeur(v.valeur, v.unite)}
        </p>
      )}
      {v.precedent ? (
        <p className="text-sm text-texte-doux" data-testid="evolution">
          Exercice précédent : {formaterValeur(v.precedent.valeur, v.unite)}
          {v.precedent.variation !== null ? ` · variation ${formaterValeur(v.precedent.variation, v.unite)}` : ''}
          {v.precedent.variationPourcent !== null ? ` (${formaterNombre(v.precedent.variationPourcent)} %)` : ''}
        </p>
      ) : null}
      {v.mentions?.length ? (
        <ul className="list-disc pl-5 text-sm text-texte-doux">
          {v.mentions.map((m, i) => (
            <li key={i} className="break-words">
              {m}
            </li>
          ))}
        </ul>
      ) : null}
      {v.composantes?.length ? (
        <details className="text-sm" data-testid="composantes">
          <summary className="min-h-11 cursor-pointer content-center">Composantes ({v.composantes.length})</summary>
          <ul className="space-y-1">
            {v.composantes.map((c, i) => (
              <li key={i}>
                <span className="break-words">{c.libelle}</span> : <span className="tabular-nums">{formaterMontant(c.montant)}</span>
                {c.comptes?.length ? (
                  <details className="ml-4">
                    <summary className="cursor-pointer text-texte-doux">{c.comptes.length} compte{c.comptes.length > 1 ? 's' : ''}</summary>
                    <ul data-testid="comptes-composante">
                      {c.comptes.map((k, j) => (
                        <li key={`${k.compteNum}-${j}`}>
                          <span className="font-mono">{k.compteNum}</span> : <span className="tabular-nums">{formaterMontant(k.montant)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {d ? <p className="text-xs text-texte-doux break-words">Formule : {d.formule}</p> : null}
    </li>
  );
}

export default async function PageAnalyse({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const ex = await contexteExercice(id, sp.exercice);
  if (!ex.ok) return <ErreurAcces statut={ex.statut} message={ex.message} retour={`/dossiers/${id}`} />;
  if (!ex.exercice) return <Alerte ton="attention">Aucun exercice n’est défini pour ce dossier.</Alerte>;
  const exercice = ex.exercice;
  const exerciceIa = exercice.id;
  const collaborationIa = auMoins(ctx.niveau, 'collaboration');
  const tv = tauxSaisi(parametre(sp.tauxTvaVentes));
  const ta = tauxSaisi(parametre(sp.tauxTvaAchats));
  const requeteTva = `${tv ? `&tauxTvaVentes=${tv}` : ''}${ta ? `&tauxTvaAchats=${ta}` : ''}`;
  const [etats, indicateurs, catalogue] = await Promise.all([
    tenter<Etats>(`v1/exercices/${exercice.id}/etats`),
    tenter<Indicateurs>(`v1/exercices/${exercice.id}/indicateurs${requeteTva ? `?${requeteTva.slice(1)}` : ''}`),
    tenter<DefinitionIndicateur[]>('v1/reference/indicateurs'),
  ]);
  const recherche = (parametre(sp.compte) ?? '').slice(0, 60);
  const base = `/dossiers/${id}/analyse?exercice=${exercice.id}`;

  if (!etats.ok && etats.statut !== 409) return <ErreurAcces statut={etats.statut} message={etats.message} retour={`/dossiers/${id}`} />;
  const definitions = new Map((catalogue.ok ? catalogue.donnees : []).map((d) => [d.id, d]));

  return (
    <div className="space-y-6">
      <ChoixExercice exercices={ex.exercices} courant={exercice.id} />
      {!etats.ok ? (
        <Alerte ton="attention" titre="États non calculables pour cet exercice" data-testid="etats-indisponibles">
          {etats.message}
        </Alerte>
      ) : (
        <>
          <Alerte ton="attention" data-testid="mention-etats">
            <strong>{etats.donnees.mention}</strong>
          </Alerte>

          <section aria-labelledby="titre-balance" className="space-y-2" id="balance">
            <div className="flex flex-wrap items-center gap-2">
              <SousTitre id="titre-balance">Balance ({etats.donnees.balance.lignes.length} comptes)</SousTitre>
              {etats.donnees.balance.equilibree ? (
                <Etiquette ton="succes" data-testid="balance-equilibre">Équilibrée</Etiquette>
              ) : (
                <Etiquette ton="danger" data-testid="balance-equilibre">Déséquilibrée — écart {formaterMontant(etats.donnees.balance.ecart)}</Etiquette>
              )}
            </div>
            <p className="tabular-nums" data-testid="totaux-balance">
              Total des débits : {formaterMontant(etats.donnees.balance.totalDebit)} · Total des crédits : {formaterMontant(etats.donnees.balance.totalCredit)}
            </p>
            <form key={recherche} method="get" action="#balance" className="flex flex-wrap items-end gap-2" aria-label="Rechercher un compte">
              <input type="hidden" name="exercice" value={exercice.id} />
              <div>
                <Libelle htmlFor="compte">Rechercher un compte (numéro ou libellé)</Libelle>
                <Saisie id="compte" name="compte" defaultValue={recherche} maxLength={60} />
              </div>
              <Bouton type="submit" variante="secondaire">
                Rechercher
              </Bouton>
              {recherche ? (
                <Link href={`${base}#balance`} prefetch={false} className="inline-flex min-h-11 items-center">
                  Tous les comptes
                </Link>
              ) : null}
            </form>
            {(() => {
              const filtrees = filtrerBalance(etats.donnees.balance.lignes, recherche);
              const p = paginer(filtrees, Number.parseInt(parametre(sp.pb) ?? '1', 10), PAR_PAGE);
              const lien = (n: number) => `${base}${recherche ? `&compte=${encodeURIComponent(recherche)}` : ''}&pb=${n}#balance`;
              return (
                <>
                  <Tableau legende="Balance des comptes">
                    <thead>
                      <tr>
                        <th scope="col">Compte</th>
                        <th scope="col" className="text-right">Total débit</th>
                        <th scope="col" className="text-right">Total crédit</th>
                        <th scope="col" className="text-right">Solde débiteur</th>
                        <th scope="col" className="text-right">Solde créditeur</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.tranche.map((l) => (
                        <tr key={l.compteNum}>
                          <th scope="row" className="!bg-transparent font-medium">
                            <span className="font-mono">{l.compteNum}</span> <span className="font-normal break-words">{l.compteLib}</span>
                          </th>
                          <td className="text-right tabular-nums">{formaterMontant(l.totalDebit)}</td>
                          <td className="text-right tabular-nums">{formaterMontant(l.totalCredit)}</td>
                          <td className="text-right tabular-nums">{formaterMontant(l.soldeDebiteur)}</td>
                          <td className="text-right tabular-nums">{formaterMontant(l.soldeCrediteur)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Tableau>
                  {filtrees.length === 0 ? <p className="text-texte-doux">Aucun compte ne correspond.</p> : null}
                  {p.nbPages > 1 ? (
                    <nav aria-label="Pagination de la balance" className="flex flex-wrap items-center gap-3">
                      {p.page > 1 ? <Link href={lien(p.page - 1)} prefetch={false}>← Précédents</Link> : <span className="text-texte-doux">← Précédents</span>}
                      <span>
                        Page {p.page} sur {p.nbPages} ({filtrees.length} comptes)
                      </span>
                      {p.page < p.nbPages ? <Link href={lien(p.page + 1)} prefetch={false}>Suivants →</Link> : <span className="text-texte-doux">Suivants →</span>}
                    </nav>
                  ) : null}
                </>
              );
            })()}
          </section>

          {etats.donnees.correspondance ? (
            <>
              <Alerte ton="attention" data-testid="correspondance">
                Table de correspondance comptes → rubriques « {etats.donnees.correspondance.id} » version {etats.donnees.correspondance.version} :{' '}
                <strong>en attente de validation professionnelle</strong>. Tout état qui en découle est un projet. {etats.donnees.correspondance.periodeApplication}
                {etats.donnees.correspondance.source?.url ? (
                  <span className="block text-sm">
                    Source : <LienSource url={etats.donnees.correspondance.source.url} />
                  </span>
                ) : null}
              </Alerte>
              {etats.donnees.comparatif?.statut === 'fourni' ? (
                <Alerte ton="neutre" titre={`Colonne N-1 : exercice du ${etats.donnees.comparatif.exercice.debut} au ${etats.donnees.comparatif.exercice.fin}`} data-testid="comparatif-n1">
                  <ul className="list-disc pl-5">
                    {etats.donnees.comparatif.reserves.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </Alerte>
              ) : etats.donnees.comparatif ? (
                <Alerte ton="attention" titre="Colonne N-1 indisponible" data-testid="comparatif-n1-indisponible">
                  <ul className="list-disc pl-5">
                    {etats.donnees.comparatif.motifs.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </Alerte>
              ) : null}
              {etats.donnees.compteDeResultat ? <EtatAffiche titre="Projet de compte de résultat" etat={etats.donnees.compteDeResultat} id="compte-de-resultat" n1={etats.donnees.comparatif?.statut === 'fourni' ? etats.donnees.comparatif.compteDeResultat : null} /> : null}
              {etats.donnees.bilan ? <EtatAffiche titre="Projet de bilan" etat={etats.donnees.bilan} id="bilan" n1={etats.donnees.comparatif?.statut === 'fourni' ? etats.donnees.comparatif.bilan : null} /> : null}
            </>
          ) : (
            <Alerte ton="attention" titre="Projets de compte de résultat et de bilan indisponibles" data-testid="sans-correspondance">
              {etats.donnees.motif ?? 'Aucune table de correspondance applicable à cet exercice.'}
            </Alerte>
          )}
        </>
      )}

      <section aria-labelledby="titre-indicateurs" className="space-y-3" id="indicateurs">
        <div className="flex flex-wrap items-center gap-2">
          <SousTitre id="titre-indicateurs">Indicateurs</SousTitre>
          {collaborationIa ? (
            <Carte>
              <TacheIa
                bloc="commentaire-indicateurs"
                chemin={`v1/exercices/${exerciceIa}/indicateurs/commentaire`}
                titre="Projet de commentaire"
                libelleBouton="Préparer un commentaire des indicateurs"
                explication="Rédigé à partir des seuls indicateurs calculés par le moteur ; tout chiffre du texte est vérifié contre eux. Sans IA connectée, un gabarit les restitue, et le dit."
              />
            </Carte>
          ) : null}
          <Link href="/reference/indicateurs" prefetch={false}>
            Catalogue des indicateurs (formules, conventions, sources)
          </Link>
        </div>
        {!indicateurs.ok ? (
          <Alerte ton="attention" data-testid="indicateurs-indisponibles">
            {indicateurs.statut === 409 ? indicateurs.message : `Les indicateurs n’ont pas pu être chargés. ${indicateurs.message}`}
          </Alerte>
        ) : (
          <>
            <Alerte ton="neutre" className="text-sm">
              {indicateurs.donnees.mention}
              {!indicateurs.donnees.donnees.exercicePrecedentFourni ? ' Aucun exercice précédent importé : pas d’évolution N / N-1.' : ''}
            </Alerte>
            <form key={`${tv}|${ta}`} method="get" action="#indicateurs" className="flex flex-wrap items-end gap-2" aria-label="Taux de TVA moyens pour les délais">
              <input type="hidden" name="exercice" value={exercice.id} />
              <div>
                <Libelle htmlFor="tauxTvaVentes">Taux de TVA moyen des ventes (%)</Libelle>
                <Saisie id="tauxTvaVentes" name="tauxTvaVentes" inputMode="decimal" defaultValue={tv?.replace('.', ',') ?? ''} className="max-w-40" />
              </div>
              <div>
                <Libelle htmlFor="tauxTvaAchats">Taux de TVA moyen des achats (%)</Libelle>
                <Saisie id="tauxTvaAchats" name="tauxTvaAchats" inputMode="decimal" defaultValue={ta?.replace('.', ',') ?? ''} className="max-w-40" />
              </div>
              <Bouton type="submit" variante="secondaire">
                Calculer les délais
              </Bouton>
              <p className="w-full text-sm text-texte-doux">Les délais clients et fournisseurs exigent ces taux : sans eux, ils restent « non calculables ». Ce sont vos hypothèses, pas des données du dossier.</p>
            </form>
            {ORDRE_FAMILLES.map((famille) => {
              const valeurs = indicateurs.donnees.indicateurs.filter((v) => (definitions.get(v.id)?.famille ?? 'activite') === famille);
              if (!valeurs.length) return null;
              return (
                <section key={famille} aria-labelledby={`famille-${famille}`} className="space-y-2" data-famille={famille}>
                  <h3 id={`famille-${famille}`} className="font-semibold">
                    {LIBELLE_FAMILLE[famille]}
                  </h3>
                  {famille === 'signal' ? (
                    <Alerte ton="attention" data-testid="phrase-signaux">
                      {PHRASE_SIGNAUX}
                    </Alerte>
                  ) : null}
                  <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {valeurs.map((v) => (
                      <Indicateur key={v.id} v={v} d={definitions.get(v.id)} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </section>
    </div>
  );
}
