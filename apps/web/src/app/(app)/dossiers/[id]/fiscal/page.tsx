import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChoixExercice } from '@/components/dossier';
import { ErreurAcces } from '@/components/erreurs';
import { CategorieAnnexe, ConfirmerRubrique, NeantTableau, QualifierCompte, SaisieCases, SaisieLigneTableau, SaisirRenvoi } from '@/components/fiscal/actions';
import { Alerte, Carte, Etiquette, MentionProjet, SousTitre, Tableau } from '@/components/ui/base';
import { type Abstention, type AnnexeProjet, type CelluleImmobilisation, type CelluleVentilation, type AmortissementsDerogatoiresProjet, type CadreIIIProjet, type CaseSaisie2033D, type CaseSaisie2033E, type CelluleCalculee2033D, type Formulaire2033EProjet, type Formulaire2033FProjet, type Formulaire2033GProjet, type Formulaire2059AProjet, type GrilleProjet, type CelluleGrille, LIBELLES_COLONNES_2059_A, type FormulaireCasesProjet, type ResultatSigneFormulaire, type CelluleMontantSaisie, type Formulaire2033DProjet, LIGNES_DEROGATOIRES_2033D, LIGNES_PROVISIONS_2033D, type ChargesRepartiesProjet, LIBELLES_COLONNES_2055_B, type DetailResultatProjet, type EcartsReevaluationProjet, type EvenementQualification, LIBELLE_CLASSEMENT, type TableauxSaisisProjet, type ReponseHistorique, type ResultatSigne, LIBELLE_CATEGORIE, LIBELLE_ETAT_QUALIFICATION, type LiasseProjet, type ReponseAnnexe, type ReponseLiasse, type TableauxImmobilisationsProjet } from '@/lib/fiscal';
import { formaterHorodatage, formaterMontant, formaterMontantEuros } from '@/lib/montants';

type Fm = (valeur: string | null | undefined) => string;
import { tenter } from '@/lib/serveur/api';
import { parametre } from '@/lib/serveur/donnees';
import { contexteDossier, contexteExercice } from '@/lib/serveur/dossier';
import { auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'États fiscaux (projets)' };

const LIBELLE_REGIME = { reel_normal: 'Régime réel normal (2050 à 2055)', reel_simplifie: 'Régime simplifié (2033-A à 2033-C)' } as const;
const LIBELLE_STATUT_RUBRIQUE = { pre_rempli: 'Pré-remplie', a_completer: 'À compléter', non_applicable_a_confirmer: 'Applicabilité à confirmer' } as const;

function BlocAbstention({ a, quoi }: { a: Abstention; quoi: string }) {
  return (
    <Alerte ton="attention" titre={`${quoi} : non préparé pour ce dossier`} data-testid="abstention">
      <p>Aucun chiffre n’est produit : le dossier sort du périmètre couvert, ou une de ses caractéristiques reste à confirmer.</p>
      <ul className="list-disc pl-5">
        {a.motifs.map((m) => (
          <li key={m.code}>{m.message}</li>
        ))}
      </ul>
      {a.perimetreCouvert ? <p className="text-sm">Périmètre couvert : {a.perimetreCouvert}</p> : null}
    </Alerte>
  );
}

function Liasse({ l, fm }: { l: LiasseProjet; fm: Fm }) {
  return (
    <div className="space-y-4" data-testid="liasse">
      <Alerte ton="attention" titre="Projet incomplet par construction">
        <p>{l.mention}</p>
        <p>
          Table « {l.table.id} » version {l.table.version}, formulaires du millésime {l.table.millesimeFormulaire} : en attente de validation professionnelle. Les codes de cases des
          formulaires n’ont pas pu être vérifiés sur la source officielle : chaque ligne est désignée par son libellé, et son code de case reste « à confirmer ».
        </p>
        {l.manques.length ? (
          <ul className="list-disc pl-5">
            {l.manques.slice(0, 12).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
      </Alerte>
      {l.comparatif.statut === 'fourni' ? (
        <Alerte ton="neutre" titre={`Colonne N-1 : exercice du ${l.comparatif.exercice.debut} au ${l.comparatif.exercice.fin}`} data-testid="comparatif-n1">
          <ul className="list-disc pl-5">
            {l.comparatif.reserves.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Alerte>
      ) : (
        <Alerte ton="attention" titre="Colonne N-1 indisponible" data-testid="comparatif-n1-indisponible">
          <ul className="list-disc pl-5">
            {l.comparatif.motifs.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alerte>
      )}
      <ul className="space-y-1" aria-label="Contrôles de cohérence" data-testid="controles-liasse">
        {l.controles.map((c) => (
          <li key={c.code}>
            <Etiquette ton={c.statut === 'ok' ? 'succes' : c.statut === 'ecart' ? 'danger' : 'attention'}>{c.statut === 'ok' ? 'Cohérent' : c.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette> {c.message}
            {c.ecart ? ` (écart : ${fm(c.ecart)})` : ''}
          </li>
        ))}
      </ul>
      {l.tableaux.map((t) => {
        const deuxColonnes = t.lignes.some((x) => x.brut !== undefined);
        const avecN1 = l.comparatif.statut === 'fourni';
        return (
          <section key={t.code} aria-labelledby={`tableau-${t.code}`} className="space-y-2">
            <SousTitre id={`tableau-${t.code}`} className="text-base">
              {t.code} — {t.intitule} <MentionProjet />
            </SousTitre>
            <Tableau legende={`Projet du tableau ${t.code}`}>
              <thead>
                <tr>
                  <th scope="col">Ligne</th>
                  <th scope="col">Case</th>
                  {deuxColonnes ? (
                    <>
                      <th scope="col" className="text-right">Brut</th>
                      <th scope="col" className="text-right">Amortissements, dépréciations</th>
                    </>
                  ) : null}
                  <th scope="col" className="text-right">{deuxColonnes ? 'Net' : 'Montant'}</th>
                  {avecN1 ? <th scope="col" className="text-right">{deuxColonnes ? 'Net N-1' : 'N-1'}</th> : null}
                </tr>
              </thead>
              <tbody>
                {t.lignes.map((x) => (
                  <tr key={x.ligne} className={x.nature === 'poste' ? undefined : 'font-semibold'}>
                    <th scope="row" className="!bg-transparent font-normal">
                      {x.libelle}
                      {x.note ? <span className="block text-sm text-texte-doux">{x.note}</span> : null}
                    </th>
                    <td data-testid={`code-${x.ligne}`}>
                      {x.codesActif ? (
                        <span className="tabular-nums">
                          {x.codesActif.brut}
                          {x.codesActif.amortissements ? ` / ${x.codesActif.amortissements}` : ''}
                          <span className="block text-xs text-texte-doux">brut{x.codesActif.amortissements ? ' / amort.' : ''}, vérifiés sur le PDF</span>
                        </span>
                      ) : x.codeCase !== null ? (
                        <span className="tabular-nums">
                          {x.codeCase}
                          <span className="block text-xs text-texte-doux">vérifié sur le PDF</span>
                        </span>
                      ) : (
                        <span className="text-texte-doux">à confirmer</span>
                      )}
                    </td>
                    {deuxColonnes ? (
                      <>
                        <td className="text-right tabular-nums">{x.brut !== undefined ? fm(x.brut) : ''}</td>
                        <td className="text-right tabular-nums">{x.amortissementsDepreciations !== undefined ? fm(x.amortissementsDepreciations) : ''}</td>
                      </>
                    ) : null}
                    <td className="text-right tabular-nums">{fm(x.montant)}</td>
                    {avecN1 ? <td className="text-right tabular-nums" data-n1={x.ligne}>{fm(x.n1?.montant)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </Tableau>
          </section>
        );
      })}
      {l.comptesNonAffectes.length || l.rubriquesNonAffectees.length ? (
        <Alerte ton="attention" titre="Montants non affectés à une ligne" data-testid="non-affectes">
          <p>Ils ne sont pas forcés dans une ligne : l’écart correspondant apparaît dans les contrôles ci-dessus.</p>
          <ul className="list-disc pl-5">
            {l.comptesNonAffectes.map((c) => (
              <li key={c.compteNum}>
                Compte {c.compteNum} {c.compteLib} : {fm(c.solde)}
              </li>
            ))}
            {l.rubriquesNonAffectees.map((r) => (
              <li key={r.code}>
                {r.libelle} : {fm(r.montant)} — {r.motif}
              </li>
            ))}
          </ul>
        </Alerte>
      ) : null}
      <section aria-labelledby="titre-non-couverts" className="space-y-2">
        <SousTitre id="titre-non-couverts" className="text-base">
          Tableaux non couverts ({l.tableauxNonCouverts.length})
        </SousTitre>
        <ul className="space-y-2" data-testid="tableaux-non-couverts">
          {l.tableauxNonCouverts.map((t) => (
            <li key={t.code} className="rounded-lg border border-bordure p-3">
              <p className="font-medium">
                {t.code} — {t.intitule} <Etiquette ton="vide">{t.couverture === 'partiel' ? 'Partiel' : 'Non couvert'}</Etiquette>
              </p>
              <p className="text-sm text-texte-doux">{t.motif}</p>
              <p className="text-sm">Informations nécessaires : {t.informationsComplementairesNecessaires.join(' ; ')}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}


function CelluleMontant({ c, avecN1, fm }: { c: CelluleImmobilisation | undefined; avecN1: boolean; fm: Fm }) {
  if (c === undefined) return <td />;
  return (
    <td className="text-right tabular-nums" data-statut={c.statut}>
      {c.montant !== null ? (
        fm(c.montant)
      ) : (
        <span className="text-texte-doux" title={c.motif ?? undefined}>
          {c.statut === 'a_saisir' ? 'à saisir' : 'non établi'}
        </span>
      )}
      {avecN1 && c.n1 !== null ? <span className="block text-xs text-texte-doux">N-1 : {fm(c.n1)}</span> : null}
      <span className="block text-xs text-texte-doux">{c.codeCase !== null ? `case ${c.codeCase} (${c.etatCodeCase === 'lu_verifie' ? 'lue, vérifiée sur le PDF' : 'lue, à confirmer'})` : ''}</span>
    </td>
  );
}

/** Saisie des cellules des tableaux d'immobilisations que la balance ne permet pas de déduire (réévaluation, ventilation des diminutions, « dont composants »), D-134. */
function SaisiesImmobilisations({ t, fm, exerciceId, revision, evenements }: { t: TableauxImmobilisationsProjet; fm: Fm; exerciceId: string; revision: boolean; evenements: EvenementQualification[] }) {
  const lignes = t.saisiesCellules ?? [];
  if (lignes.length === 0) return null;
  const badge = (statut: string) => <Etiquette ton={statut === 'saisi' ? 'succes' : 'attention'}>{statut === 'saisi' ? 'Saisi' : statut === 'a_revoir' ? 'À revoir : données modifiées' : 'À saisir'}</Etiquette>;
  const cadres = Array.from(new Set(lignes.map((l) => l.cadre)));
  const titre: Record<string, string> = { A: '2054 cadre A — réévaluation et « dont composants »', B: '2054 cadre B — ventilation des diminutions et valeur d’origine réévaluée', I: '2033-C cadre I — valeur d’origine des immobilisations réévaluées' };
  return (
    <section className="space-y-3" aria-labelledby="titre-saisies-immobilisations" data-testid="saisies-immobilisations">
      <SousTitre id="titre-saisies-immobilisations" className="text-base">
        Cellules à saisir des tableaux d’immobilisations <MentionProjet />
      </SousTitre>
      <p className="text-sm text-texte-doux">
        La balance ne distingue ni les réévaluations, ni les virements de poste à poste des cessions, ni les composants : chaque cellule se saisit avec une justification obligatoire, tracée et historisée ; une cellule non saisie n’est jamais présumée nulle (zéro explicite). Le contrôle « virements + cessions = diminutions de la balance » est indicatif.
      </p>
      {cadres.map((cadre) => (
        <details key={cadre} data-testid={`saisies-immobilisations-${cadre}`} open={lignes.some((l) => l.cadre === cadre && l.statut !== 'a_saisir')}>
          <summary className="cursor-pointer font-semibold">{titre[cadre]}</summary>
          <ul className="mt-2 space-y-2">
            {lignes.filter((l) => l.cadre === cadre).map((l) => (
              <li key={l.ligne} className="rounded-lg border border-bordure p-3" data-saisie-immo={l.ligne}>
                <p className="text-sm">
                  {l.libelle} {badge(l.statut)}
                  {l.statut === 'saisi' ? <span className="text-texte-doux"> · {l.colonnes.filter((c) => l.valeurs && c.cle in l.valeurs).map((c) => `${c.libelle} : ${fm(l.valeurs![c.cle])}`).join(' · ')}</span> : null}
                </p>
                {l.trace ? (
                  <p className="text-xs text-texte-doux" data-testid={`trace-immo-${l.ligne}`}>
                    saisie le {formaterHorodatage(l.trace.le)} sur la version {l.trace.versionDonnees} des données · « {l.trace.note} »
                  </p>
                ) : null}
                <HistoriqueLigne evenements={evenements} cle={`IMMO_CELL:${l.ligne}`} fm={fm} />
                {revision ? <SaisieLigneTableau exerciceId={exerciceId} tableau="IMMO_CELL" ligne={l.ligne} etiquette={`la ligne ${l.ligne} (${l.libelle})`} saisie={l.statut !== 'a_saisir'} noteCourante={l.trace?.note ?? null} champs={l.colonnes.map((c) => ({ cle: c.cle, libelle: c.libelle, type: 'montant' as const, valeur: l.valeurs?.[c.cle] ?? '', optionnel: true }))} /> : null}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}

function ImmobilisationsLiasse({ t, fm }: { t: TableauxImmobilisationsProjet | Abstention; fm: Fm }) {
  if (t.statut === 'abstention') return <BlocAbstention a={t} quoi="Tableaux d’immobilisations et d’amortissements" />;
  const avecN1 = t.comparatif.statut === 'fourni';
  return (
    <section className="space-y-4" aria-labelledby="titre-immobilisations" data-testid="tableaux-immobilisations">
      <SousTitre id="titre-immobilisations" className="text-base">
        Immobilisations et amortissements ({t.tableaux.map((x) => x.code).join(', ')}) <MentionProjet />
      </SousTitre>
      <Alerte ton="attention" titre="Projet incomplet par construction">
        <p>{t.mention}</p>
        {t.reserves.map((r) => (
          <p key={r} className="text-sm">
            {r}
          </p>
        ))}
        <p className="text-sm">
          Une cellule « à saisir » ou « non établi » n’est jamais remplie par défaut : le motif s’affiche au survol et dans le détail de la ligne. Les écarts entre la balance et le fichier des immobilisations sont affichés, jamais corrigés.
        </p>
      </Alerte>
      {t.comparatif.statut === 'fourni' ? (
        <p className="text-sm" data-testid="immobilisations-n1">
          Colonne N-1 : exercice du {t.comparatif.exercice.debut} au {t.comparatif.exercice.fin}.
        </p>
      ) : (
        <Alerte ton="attention" titre="Colonne N-1 indisponible" data-testid="immobilisations-n1-indisponible">
          <ul className="list-disc pl-5">
            {t.comparatif.motifs.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alerte>
      )}
      <Alerte ton={t.fichier.fourni ? 'neutre' : 'attention'} titre="Fichier des immobilisations" data-testid="immobilisations-fichier">
        <p>
          {t.fichier.fourni
            ? `${t.fichier.nbImmobilisations} immobilisation(s) saisie(s) ou reprise(s) pour ce dossier, rapprochées de la balance et du moteur d’amortissements.`
            : 'Aucune immobilisation saisie pour ce dossier : aucun rapprochement avec le fichier. Saisie ou reprise dans l’onglet Amortissements.'}
        </p>
        <p className="text-sm">{t.fichier.degressif.motif}</p>
        {t.fichier.abstentions.length ? (
          <ul className="list-disc pl-5 text-sm">
            {t.fichier.abstentions.map((a) => (
              <li key={`${a.immobilisation}-${a.code}`}>
                {a.libelle} : {a.motif}
              </li>
            ))}
          </ul>
        ) : null}
      </Alerte>
      <ul className="space-y-1" aria-label="Contrôles des tableaux d’immobilisations" data-testid="controles-immobilisations">
        {t.controles.map((c) => (
          <li key={c.code}>
            <Etiquette ton={c.statut === 'ok' ? 'succes' : c.statut === 'ecart' ? 'danger' : 'attention'}>{c.statut === 'ok' ? 'Cohérent' : c.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette> {c.message}
            {c.ecart && c.statut === 'ecart' ? ` (écart : ${fm(c.ecart)})` : ''}
          </li>
        ))}
      </ul>
      {t.tableaux.map((tab) =>
        tab.cadres.map((cadre) => (
          <div key={`${tab.code}-${cadre.id}`} className="space-y-2" data-tableau={tab.code} data-cadre={cadre.id}>
            <p className="font-medium">
              {tab.code} — {tab.intitule} · {cadre.titre}
            </p>
            <Tableau legende={`Projet du tableau ${tab.code}, cadre ${cadre.id}`}>
              <thead>
                <tr>
                  <th scope="col">Ligne</th>
                  {cadre.colonnes.map((c) => (
                    <th key={c.cle} scope="col" className="text-right">
                      {c.numero !== null ? `Col. ${c.numero} — ` : ''}
                      {c.libelle}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cadre.lignes.map((l) => (
                  <tr key={l.id} className={l.nature === 'total' ? 'font-semibold' : undefined} data-ligne={l.id}>
                    <th scope="row" className="!bg-transparent font-normal">
                      {l.numeroRomain ? `${l.numeroRomain} — ` : ''}
                      {l.libelle}
                      {l.note ? <span className="block text-sm text-texte-doux">{l.note}</span> : null}
                      {l.dontComposants ? <span className="block text-sm text-texte-doux">dont composants (case {l.dontComposants.codeCase}) : {l.dontComposants.statut === 'etabli' ? fm(l.dontComposants.montant) : 'à saisir'}</span> : null}
                      {l.comptes.length || l.fichierBrut || l.fichierAmortissements ? (
                        <details className="text-sm">
                          <summary>Détail : comptes et fichier</summary>
                          <ul className="list-disc pl-5">
                            {l.comptes.map((c) => (
                              <li key={c.compteNum}>
                                {c.compteNum} {c.compteLib} : ouverture {fm(c.ouverture)}, augmentations {fm(c.augmentations)}, diminutions {fm(c.diminutions)}, clôture {fm(c.cloture)}
                              </li>
                            ))}
                            {l.fichierBrut ? (
                              <li>
                                Fichier : {l.fichierBrut.nbImmobilisations} immobilisation(s), valeur brute à la clôture {fm(l.fichierBrut.valeurBruteCloture)}, écart avec la balance {fm(l.fichierBrut.ecartCloture)}.{' '}
                                {l.fichierBrut.motifs.join(' ')}
                              </li>
                            ) : null}
                            {l.fichierAmortissements ? (
                              <li>
                                Fichier : amortissements à l’ouverture {fm(l.fichierAmortissements.amortissementsOuverture)} (écart {fm(l.fichierAmortissements.ecartOuverture)}) ; dotation calculée par le moteur{' '}
                                {fm(l.fichierAmortissements.dotationCalculee)}, comptabilisée {fm(l.fichierAmortissements.dotationComptabilisee)} (écart {fm(l.fichierAmortissements.ecartDotation)}).{' '}
                                {l.fichierAmortissements.motifs.join(' ')}
                              </li>
                            ) : null}
                          </ul>
                        </details>
                      ) : null}
                    </th>
                    {cadre.colonnes.map((c) => (
                      <CelluleMontant key={c.cle} c={l.cellules[c.cle]} avecN1={avecN1} fm={fm} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </Tableau>
          </div>
        )),
      )}
      <ul className="space-y-1 text-sm" data-testid="immobilisations-non-couverts">
        {t.tableaux.flatMap((tab) => tab.cadresNonCouverts.map((c) => <li key={`${tab.code}-${c.cadre}`}>{tab.code}, cadre {c.cadre} « {c.intitule} » : non préparé. {c.motif}</li>))}
      </ul>
    </section>
  );
}

function CelluleVentil({ c, fm }: { c: CelluleVentilation; fm: Fm }) {
  const etat = c.etatCodeCase === 'lu_verifie' ? 'lue, vérifiée sur le PDF' : 'lue, à confirmer';
  const legende = c.codeCase === null ? <span className="block text-xs text-texte-doux">sans case sur ce formulaire</span> : <span className="block text-xs text-texte-doux">case {c.codeCase} ({etat})</span>;
  return c.statut === 'etabli' ? (
    <>
      {fm(c.montant)}
      {legende}
    </>
  ) : (
    <>
      <span className="text-texte-doux" title={c.motif}>
        abstention
      </span>
      {legende}
    </>
  );
}

/** Résumé lisible des valeurs JSON d'une saisie de tableau (historique). */
function resumeValeurs(json: string | null): string {
  if (json === null) return '';
  try {
    const v = JSON.parse(json) as Record<string, string>;
    const e = Object.entries(v);
    return e.length === 0 ? '« néant »' : e.map(([k, x]) => `${k} = ${x}`).join(', ');
  } catch {
    return '';
  }
}

function CelluleMs({ c, fm }: { c: CelluleMontantSaisie; fm: Fm }) {
  const code = c.codeCase === null ? null : <span className="block text-xs text-texte-doux">case {c.codeCase} ({c.etatCodeCase === 'lu_verifie' ? 'lue, vérifiée sur le PDF' : 'lue, à confirmer'})</span>;
  return c.statut === 'etabli' ? (
    <>
      <span className="tabular-nums">{fm(c.montant)}</span>
      {code}
    </>
  ) : (
    <>
      <span className="text-texte-doux" title={c.motifs.join(' ')}>
        abstention
      </span>
      {code}
    </>
  );
}

function CelluleSigne({ r, fm, testid }: { r: ResultatSigne; fm: Fm; testid: string }) {
  if (r.statut === 'abstention') {
    return (
      <div data-testid={testid} data-statut="abstention">
        <Etiquette ton="attention">Abstention</Etiquette> <span className="text-xs text-texte-doux">(cases {r.codesCases.join(' / ')})</span>
        <ul className="list-disc pl-5 text-sm">
          {r.motifs.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div data-testid={testid} data-statut="etabli" data-sens={r.sens}>
      <strong className="tabular-nums">{r.sens === 'nul' ? fm('0.00') : fm(r.montant)}</strong> — {r.sens === 'benefice' ? 'bénéfice' : r.sens === 'deficit' ? 'déficit' : 'résultat nul'}{' '}
      <span className="text-xs text-texte-doux">(case {r.codeCase}, lue, vérifiée sur le PDF)</span>
    </div>
  );
}

/** Historique en ajout seul d'une qualification : chaque saisie et chaque retrait, avec auteur, date, note et version des données. */
/** Liste de lignes de saisie : les lignes du formulaire d'abord, puis les lignes d'ÉTAT JOINT (au-delà de la capacité du formulaire, même saisie) repliées (D-128). */
function ListeEtatJoint<T>({ items, capacite, rendu, classe, testid }: { items: readonly T[]; capacite: number; rendu: (x: T) => ReactNode; classe: string; testid?: string }) {
  const jointes = items.slice(capacite);
  const nonVides = jointes.filter((x) => (x as { statut?: string }).statut !== 'a_saisir').length;
  return (
    <>
      <ul className={classe} {...(testid ? { 'data-testid': testid } : {})}>
        {items.slice(0, capacite).map(rendu)}
      </ul>
      {jointes.length > 0 ? (
        <details className="mt-2" data-testid={testid ? `${testid}-etat-joint` : 'etat-joint'} open={nonVides > 0}>
          <summary className="cursor-pointer text-sm font-medium">
            Lignes d’état joint, {capacite + 1} à {capacite + jointes.length} (au-delà du formulaire, même saisie ; {nonVides} saisie(s))
          </summary>
          <ul className={`${classe} mt-2`}>{jointes.map(rendu)}</ul>
        </details>
      ) : null}
    </>
  );
}

function HistoriqueLigne({ evenements, cle, fm }: { evenements: EvenementQualification[]; cle: string; fm: Fm }) {
  const e = evenements.filter((x) => x.cle === cle);
  if (e.length === 0) return null;
  return (
    <details className="text-xs text-texte-doux" data-testid={`historique-${cle}`}>
      <summary>Historique ({e.length})</summary>
      <ol className="list-decimal pl-5">
        {e.map((x, i) => (
          <li key={`${x.le}-${i}`}>
            {formaterHorodatage(x.le)} — {x.action === 'retrait' ? 'retrait de la saisie' : x.nature === 'tableau' ? `saisie ${resumeValeurs(x.montant)}` : x.nature === 'renvoi' && x.montant === '0.00' ? 'néant déclaré' : `saisie de ${fm(x.montant)}${x.montantExport !== null ? ` (export ${fm(x.montantExport)})` : ''}`} · version {x.versionDonnees} des données · utilisateur {x.auteurId.slice(0, 8)}
            {x.note ? ` · « ${x.note} »` : ''}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Détail du compte de résultat (D-106) : ventilation France / exportations qualifiée par le cabinet, détail exceptionnel, renvois. */
function DetailResultat({ d, fm, exerciceId, revision, evenements }: { d: DetailResultatProjet | Abstention; fm: Fm; exerciceId: string; revision: boolean; evenements: EvenementQualification[] }) {
  if (d.statut === 'abstention') return <BlocAbstention a={d} quoi="Détail des tableaux 2052 et 2053" />;
  const v = d.ventilationChiffreAffaires;
  const net = v.chiffreAffairesNet;
  const simplifie = d.regime === 'reel_simplifie';
  return (
    <section className="space-y-4" aria-labelledby="titre-detail-resultat" data-testid="detail-resultat">
      <SousTitre id="titre-detail-resultat" className="text-base">
        {simplifie ? 'Détail du compte de résultat simplifié (2033-B)' : 'Détail du compte de résultat (2052 et 2053)'} <MentionProjet />
      </SousTitre>
      <Alerte ton="attention" titre="Information que la balance ne porte pas : qualifiée par le cabinet, jamais déduite">
        <p className="text-sm">
          Une écriture ne dit ni où se trouve le client ni si une vente est une exportation. Pour chaque compte du chiffre d’affaires, le cabinet déclare ici le montant réalisé en France et celui des exportations et livraisons intracommunautaires (leur somme doit égaler le solde du
          compte ; un compte de rabais se qualifie en négatif), avec une justification. La saisie est tracée et devient « à revoir » si les données changent. Tant qu’un compte n’est pas qualifié, les cellules France et exportations restent en abstention. Rien de ceci ne vaut
          validation professionnelle.
        </p>
        {d.limites.map((l) => (
          <p key={l} className="text-sm">
            {l}
          </p>
        ))}
      </Alerte>
      <ul className="space-y-1" aria-label="Contrôles du détail" data-testid="controles-detail">
        {d.controles.map((c) => (
          <li key={c.code}>
            <Etiquette ton={c.statut === 'coherent' ? 'succes' : c.statut === 'ecart' ? 'danger' : 'attention'}>{c.statut === 'coherent' ? 'Cohérent' : c.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette> {c.message}
            {c.ecart ? ` (écart : ${fm(c.ecart)})` : ''}
          </li>
        ))}
      </ul>

      <div className="space-y-2">
        <h3 className="font-semibold" id="titre-2052">
          {simplifie ? '2033-B — Production vendue : dont export et livraisons intracommunautaires, total' : '2052 — Chiffre d’affaires : France, exportations et livraisons intracommunautaires, total'}
        </h3>
        <Tableau legende="Ventilation du chiffre d’affaires du tableau 2052">
          <thead>
            <tr>
              <th scope="col">Ligne</th>
              {simplifie ? null : (
                <th scope="col" className="text-right">
                  France
                </th>
              )}
              <th scope="col" className="text-right">
                {simplifie ? 'Dont export et livraisons intracom.' : 'Exportations et livraisons intracom.'}
              </th>
              <th scope="col" className="text-right">Total (balance)</th>
            </tr>
          </thead>
          <tbody data-testid="ventilation-ca">
            {v.lignes.map((l) => (
              <tr key={l.id} data-ligne={l.id}>
                <th scope="row">
                  {l.libelle}
                  <span className="block text-xs font-normal text-texte-doux">{l.qualifiee ? 'Tous les comptes sont qualifiés' : 'Comptes à qualifier ci-dessous'}</span>
                </th>
                {simplifie ? null : (
                  <td className="text-right tabular-nums">
                    <CelluleVentil c={l.france} fm={fm} />
                  </td>
                )}
                <td className="text-right tabular-nums">
                  <CelluleVentil c={l.export} fm={fm} />
                </td>
                <td className="text-right tabular-nums">
                  <CelluleVentil c={l.total} fm={fm} />
                </td>
              </tr>
            ))}
            {net === null ? null : (
            <tr data-ligne="CA_NET">
              <th scope="row">Chiffre d’affaires net</th>
              <td className="text-right tabular-nums">
                <CelluleVentil c={net.france} fm={fm} />
              </td>
              <td className="text-right tabular-nums">
                <CelluleVentil c={net.export} fm={fm} />
              </td>
              <td className="text-right tabular-nums">
                <CelluleVentil c={net.total} fm={fm} />
              </td>
            </tr>
            )}
          </tbody>
        </Tableau>
        {v.comptesNonAffectes.length > 0 ? (
          <Alerte ton="attention" titre="Comptes de la classe 70 sans ligne certaine (absents de tous les totaux)" data-testid="ca-non-affectes">
            <ul className="list-disc pl-5 text-sm">
              {v.comptesNonAffectes.map((c) => (
                <li key={c.compteNum}>
                  {c.compteNum} {c.compteLib} : {fm(c.solde)}
                </li>
              ))}
            </ul>
          </Alerte>
        ) : null}
        {v.qualificationsOrphelines.length > 0 ? (
          <Alerte ton="attention" titre="Qualifications ignorées">
            <ul className="list-disc pl-5 text-sm">
              {v.qualificationsOrphelines.map((o) => (
                <li key={o.compte}>
                  {o.compte} : {o.motif}
                </li>
              ))}
            </ul>
          </Alerte>
        ) : null}
        <h4 className="font-semibold">Qualification par compte ({v.nbComptesAQualifier} à qualifier ou à revoir)</h4>
        <ul className="space-y-3" data-testid="qualification-comptes">
          {v.lignes.flatMap((l) => l.comptes).filter((c) => c.etat !== 'sans_montant').map((c) => (
            <li key={c.compteNum} className="rounded-lg border border-bordure p-3" data-compte={c.compteNum}>
              <p className="text-sm">
                <strong>
                  {c.compteNum} {c.compteLib}
                </strong>{' '}
                — solde créditeur {fm(c.solde)} <Etiquette ton={c.etat === 'qualifie' ? 'succes' : c.etat === 'ecart' ? 'danger' : 'attention'}>{LIBELLE_ETAT_QUALIFICATION[c.etat]}</Etiquette>
              </p>
              {c.qualification ? (
                <p className="text-xs text-texte-doux" data-testid={`trace-${c.compteNum}`}>
                  France {fm(c.qualification.montantFrance)} · exportations et intracom. {fm(c.qualification.montantExport)} · saisi le {formaterHorodatage(c.qualification.le)} sur la version {c.qualification.versionDonnees} des données · « {c.qualification.note} »
                  {c.ecart ? ` · écart avec le solde : ${fm(c.ecart)}` : ''}
                </p>
              ) : null}
              <HistoriqueLigne evenements={evenements} cle={c.compteNum} fm={fm} />
              {revision ? (
                <QualifierCompte exerciceId={exerciceId} compte={c.compteNum} solde={c.solde} qualification={c.qualification ? { montantFrance: c.qualification.montantFrance, montantExport: c.qualification.montantExport, note: c.qualification.note } : null} />
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {d.detailExceptionnel === null ? null : (
      <div className="space-y-2">
        <h3 className="font-semibold" id="titre-2053">
          2053 — Détail des produits et charges exceptionnels (cadre (7))
        </h3>
        <p className="text-sm text-texte-doux">{d.detailExceptionnel!.origine}</p>
        <Tableau legende="Détail des produits et charges exceptionnels du tableau 2053">
          <thead>
            <tr>
              <th scope="col">Compte</th>
              <th scope="col" className="text-right">Produits exceptionnels</th>
              <th scope="col" className="text-right">Charges exceptionnelles</th>
            </tr>
          </thead>
          <tbody data-testid="detail-exceptionnel">
            {d.detailExceptionnel!.produits.map((l) => (
              <tr key={`p-${l.compteNum}`}>
                <th scope="row">
                  {l.compteNum} {l.compteLib}
                </th>
                <td className="text-right tabular-nums">{fm(l.montant)}</td>
                <td />
              </tr>
            ))}
            {d.detailExceptionnel!.charges.map((l) => (
              <tr key={`c-${l.compteNum}`}>
                <th scope="row">
                  {l.compteNum} {l.compteLib}
                </th>
                <td />
                <td className="text-right tabular-nums">{fm(l.montant)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">Total — résultat exceptionnel : {fm(d.detailExceptionnel!.resultatExceptionnel)}</th>
              <td className="text-right font-semibold tabular-nums">{fm(d.detailExceptionnel!.totalProduits)}</td>
              <td className="text-right font-semibold tabular-nums">{fm(d.detailExceptionnel!.totalCharges)}</td>
            </tr>
          </tbody>
        </Tableau>
      </div>

      )}

      <div className="space-y-2">
        <h3 className="font-semibold" id="titre-renvois">
          {simplifie ? 'Lignes « dont » du 2033-B (renvois) : saisie tracée' : 'Renvois de bas de tableau (2052 et 2053) : saisie tracée'}
        </h3>
        <p className="text-sm text-texte-doux">
          Une case sans saisie reste vide. Une proposition tirée de la balance (quand un compte du PCG désigne le renvoi sans ambiguïté) n’est jamais retenue tant que le cabinet ne l’a pas saisie.
        </p>
        <ul className="space-y-3" data-testid="renvois-detail">
          {d.renvois.map((r) => (
            <li key={r.code} className="rounded-lg border border-bordure p-3" data-renvoi={r.code}>
              <p className="text-sm">
                <strong>
                  {r.tableau} {r.renvoi === 'dont' ? '' : r.renvoi + ' '}— {r.libelle}
                </strong>{' '}
                <span className="text-texte-doux">{r.codeCase === null ? '(sans case : montant à inscrire sur les pointillés)' : `(case ${r.codeCase}, ${r.etatCodeCase === 'lu_verifie' ? 'lue, vérifiée sur le PDF' : 'lue, à confirmer'})`}</span>{' '}
                <Etiquette ton={r.statut === 'saisi' ? 'succes' : 'attention'}>{r.statut === 'saisi' ? 'Saisi' : r.statut === 'a_revoir' ? 'À revoir : données modifiées' : 'À saisir'}</Etiquette>
              </p>
              <p className="text-xs text-texte-doux">
                {r.precision}
                {r.proposition ? ` Proposition de la balance : ${fm(r.proposition.montant)} (comptes ${r.proposition.comptes.join(', ')}), non retenue.` : ''}
              </p>
              {r.saisie ? (
                <p className="text-xs text-texte-doux" data-testid={`trace-renvoi-${r.code}`}>
                  {fm(r.saisie.montant)} · saisi le {formaterHorodatage(r.saisie.le)} sur la version {r.saisie.versionDonnees} des données · « {r.saisie.note} »
                </p>
              ) : null}
              <HistoriqueLigne evenements={evenements} cle={r.code} fm={fm} />
              {revision ? <SaisirRenvoi exerciceId={exerciceId} code={r.code} proposition={r.proposition?.montant ?? null} saisie={r.saisie ? { montant: r.saisie.montant, note: r.saisie.note } : null} /> : null}
            </li>
          ))}
        </ul>
        <ul className="list-disc pl-5 text-sm text-texte-doux" data-testid="renvois-non-prepares">
          {d.renvoisNonPrepares.map((n) => (
            <li key={n}>Non préparé — {n}</li>
          ))}
        </ul>
      </div>
      {d.resultatFiscal === null ? null : (
        <div className="space-y-3" data-testid="resultat-fiscal">
          <h3 className="font-semibold" id="titre-resultat-fiscal">
            2033-B — B. Résultat fiscal (réintégrations, déductions, déficits) : saisie justifiée et historisée
          </h3>
          <Alerte ton="attention" titre="Aucune décision fiscale n’est prise par Comtaple">
            <p className="text-sm">
              Chaque réintégration ou déduction est une saisie justifiée du cabinet (montant en positif, justification obligatoire, historique conservé). « Néant » est une déclaration explicite ; une case sans saisie n’est jamais présumée nulle et rend le résultat
              fiscal en abstention. Le calcul se borne à l’arithmétique du formulaire : résultat comptable + réintégrations − déductions (cases 352 / 354), puis imputation saisie dans la limite du plafond de la notice (cases 370 / 372). Projet, sans validation professionnelle ni transmission.
            </p>
          </Alerte>
          <Tableau legende="Calcul du résultat fiscal du tableau 2033-B">
            <thead>
              <tr>
                <th scope="col">Étape</th>
                <th scope="col">Résultat</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Résultat comptable reporté (312 / 314)</th>
                <td>
                  <CelluleSigne r={d.resultatFiscal.resultatComptable} fm={fm} testid="rf-comptable" />
                </td>
              </tr>
              <tr>
                <th scope="row">Résultat fiscal avant imputation des déficits (352 / 354)</th>
                <td>
                  <CelluleSigne r={d.resultatFiscal.avantImputation} fm={fm} testid="rf-avant" />
                </td>
              </tr>
              <tr>
                <th scope="row">Plafond d’imputation des déficits antérieurs</th>
                <td data-testid="rf-plafond">
                  {d.resultatFiscal.plafondImputation ? (
                    <>
                      <strong className="tabular-nums">{fm(d.resultatFiscal.plafondImputation.montant)}</strong> <span className="text-xs text-texte-doux">{d.resultatFiscal.plafondImputation.regle}</span>
                    </>
                  ) : (
                    <span className="text-texte-doux">sans objet (pas de bénéfice établi)</span>
                  )}
                </td>
              </tr>
              <tr>
                <th scope="row">Résultat fiscal après imputation des déficits (370 / 372)</th>
                <td>
                  <CelluleSigne r={d.resultatFiscal.apresImputation} fm={fm} testid="rf-apres" />
                </td>
              </tr>
            </tbody>
          </Tableau>
          <ul className="space-y-1" aria-label="Contrôles du résultat fiscal" data-testid="controles-resultat-fiscal">
            {d.resultatFiscal.controles.map((c) => (
              <li key={c.code}>
                <Etiquette ton={c.statut === 'coherent' ? 'succes' : c.statut === 'ecart' ? 'danger' : 'attention'}>{c.statut === 'coherent' ? 'Cohérent' : c.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette> {c.message}
                {c.ecart ? ` (écart : ${fm(c.ecart)})` : ''}
              </li>
            ))}
          </ul>
          <ul className="space-y-3" data-testid="lignes-resultat-fiscal">
            {d.resultatFiscal.lignes.map((l) => (
              <li key={l.cle} className="rounded-lg border border-bordure p-3" data-ligne-rf={l.cle}>
                <p className="text-sm">
                  <strong>{l.libelle}</strong> <span className="text-texte-doux">(case {l.codeCase}, lue, vérifiée sur le PDF)</span>{' '}
                  <Etiquette ton={l.statut === 'saisi' ? 'succes' : 'attention'}>{l.statut === 'saisi' ? (l.neant ? 'Néant déclaré' : 'Saisi') : l.statut === 'a_revoir' ? 'À revoir : données modifiées' : 'À saisir'}</Etiquette>
                </p>
                <p className="text-xs text-texte-doux">{l.precision}</p>
                {l.saisie ? (
                  <p className="text-xs text-texte-doux" data-testid={`trace-rf-${l.cle}`}>
                    {l.neant ? 'Néant' : fm(l.saisie.montant)} · saisi le {formaterHorodatage(l.saisie.le)} sur la version {l.saisie.versionDonnees} des données · « {l.saisie.note} »
                  </p>
                ) : null}
                <HistoriqueLigne evenements={evenements} cle={l.cle} fm={fm} />
                {revision ? <SaisirRenvoi exerciceId={exerciceId} code={l.cle} proposition={null} saisie={l.saisie ? { montant: l.saisie.montant, note: l.saisie.note } : null} avecNeant /> : null}
                {l.detail.length > 0 ? (
                  <details className="mt-2 rounded border border-bordure p-2" data-testid={`detail-rf-${l.cle}`}>
                    <summary className="cursor-pointer text-sm font-semibold">
                      Détail de la case {l.codeCase} ({l.detail.filter((x) => x.statut === 'saisi').length} / {l.detail.length} saisies)
                    </summary>
                    {l.controleDetail ? (
                      <p className="my-2 text-sm" data-testid={`controle-detail-${l.cle}`}>
                        <Etiquette ton={l.controleDetail.statut === 'coherent' ? 'succes' : l.controleDetail.statut === 'ecart' ? 'danger' : 'attention'}>
                          {l.controleDetail.statut === 'coherent' ? 'Cohérent (indicatif)' : l.controleDetail.statut === 'ecart' ? 'Écart (indicatif)' : 'Non vérifiable'}
                        </Etiquette>{' '}
                        {l.controleDetail.message}
                        {l.controleDetail.ecart ? ` (écart : ${fm(l.controleDetail.ecart)})` : ''}
                      </p>
                    ) : null}
                    <ul className="space-y-2">
                      {l.detail.map((x) => (
                        <li key={x.cle} className="rounded border border-bordure p-2" data-ligne-rf={x.cle}>
                          <p className="text-sm">
                            {x.libelle} <span className="text-texte-doux">(case {x.codeCase}, lue, vérifiée sur le PDF{x.additionne ? '' : ' ; non additionnée'})</span>{' '}
                            <Etiquette ton={x.statut === 'saisi' ? 'succes' : 'attention'}>{x.statut === 'saisi' ? (x.neant ? 'Néant déclaré' : 'Saisi') : x.statut === 'a_revoir' ? 'À revoir : données modifiées' : 'À saisir'}</Etiquette>
                          </p>
                          <p className="text-xs text-texte-doux">{x.precision}</p>
                          {x.saisie ? (
                            <p className="text-xs text-texte-doux" data-testid={`trace-rf-${x.cle}`}>
                              {x.neant ? 'Néant' : fm(x.saisie.montant)} · saisi le {formaterHorodatage(x.saisie.le)} sur la version {x.saisie.versionDonnees} des données · « {x.saisie.note} »
                            </p>
                          ) : null}
                          <HistoriqueLigne evenements={evenements} cle={x.cle} fm={fm} />
                          {revision ? <SaisirRenvoi exerciceId={exerciceId} code={x.cle} proposition={null} saisie={x.saisie ? { montant: x.saisie.montant, note: x.saisie.note } : null} avecNeant /> : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
          <ul className="list-disc pl-5 text-sm text-texte-doux" data-testid="resultat-fiscal-non-prepare">
            {d.resultatFiscal.nonPrepare.map((n) => (
              <li key={n}>Non préparé — {n}</li>
            ))}
          </ul>
        </div>
      )}
      <details className="text-sm">
        <summary>Sources officielles lues</summary>
        <ul className="list-disc pl-5">
          {d.sources.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** Cadre III du 2033-C (cessions, plus-values et moins-values) : saisie ligne par ligne, tracée et historisée (D-112). */
function CadreIII({ c, fm, exerciceId, revision, evenements }: { c: CadreIIIProjet; fm: Fm; exerciceId: string; revision: boolean; evenements: EvenementQualification[] }) {
  const choix = Object.entries(LIBELLE_CLASSEMENT).map(([valeur, libelle]) => ({ valeur, libelle }));
  const badge = (statut: string) => <Etiquette ton={statut === 'saisi' ? 'succes' : 'attention'}>{statut === 'saisi' ? 'Saisi' : statut === 'a_revoir' ? 'À revoir : données modifiées' : 'À saisir'}</Etiquette>;
  return (
    <section className="space-y-3" aria-labelledby="titre-cadre-iii" data-testid="cadre-iii">
      <SousTitre id="titre-cadre-iii" className="text-base">
        2033-C — Cadre III : plus-values et moins-values (cessions d’immobilisations) <MentionProjet />
      </SousTitre>
      <Alerte ton="attention" titre="Saisie du cabinet : les cessions ne se déduisent pas de la balance">
        <p className="text-sm">
          Chaque cession se saisit ligne par ligne (nature, valeur d’actif, amortissements, prix de cession, régime d’imposition de la plus ou moins-value), avec une justification obligatoire, tracée et historisée. Le logiciel calcule seulement ce que le formulaire calcule
          (valeur résiduelle = valeur d’actif − amortissements ; plus ou moins-value = prix de cession − valeur résiduelle ; totaux). Le classement court terme / long terme est une décision du cabinet. Sans cession saisie ni « néant », les totaux restent en abstention.
        </p>
        {c.limites.map((l) => (
          <p key={l} className="text-sm">
            {l}
          </p>
        ))}
      </Alerte>
      <ul className="space-y-1" aria-label="Contrôles du cadre III" data-testid="controles-cadre-iii">
        {c.controles.map((x) => (
          <li key={x.code}>
            <Etiquette ton={x.statut === 'coherent' ? 'succes' : x.statut === 'ecart' ? 'danger' : 'attention'}>{x.statut === 'coherent' ? 'Cohérent' : x.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette> {x.message}
            {x.ecart ? ` (écart : ${fm(x.ecart)})` : ''}
          </li>
        ))}
      </ul>
      <Tableau legende="Cadre III du tableau 2033-C : cessions, plus-values et moins-values">
        <thead>
          <tr>
            <th scope="col">Ligne</th>
            <th scope="col">Nature</th>
            <th scope="col" className="text-right">① Valeur d’actif</th>
            <th scope="col" className="text-right">② Amortissements</th>
            <th scope="col" className="text-right">③ Valeur résiduelle</th>
            <th scope="col" className="text-right">④ Prix de cession</th>
            <th scope="col" className="text-right">⑤ Court terme</th>
            <th scope="col" className="text-right">⑥ Long terme 19 %</th>
            <th scope="col" className="text-right">⑦ 15 % ou 12,8 %</th>
            <th scope="col" className="text-right">⑧ 0 %</th>
          </tr>
        </thead>
        <tbody data-testid="lignes-cessions">
          {c.lignes.filter((l, i) => i < 10 || l.statut !== 'a_saisir').map((l) => (
            <tr key={l.ligne} data-cession={l.ligne}>
              <th scope="row">{Number(l.ligne)}</th>
              <td>{l.statut === 'saisi' ? l.nature : badge(l.statut)}</td>
              <td className="text-right tabular-nums">{l.valeurActif !== null ? fm(l.valeurActif) : ''}</td>
              <td className="text-right tabular-nums">{l.amortissements !== null ? fm(l.amortissements) : ''}</td>
              <td className="text-right tabular-nums">{l.valeurResiduelle !== null ? fm(l.valeurResiduelle) : ''}</td>
              <td className="text-right tabular-nums">{l.prixCession !== null ? fm(l.prixCession) : ''}</td>
              {(['c5', 'c6', 'c7', 'c8'] as const).map((k) => (
                <td key={k} className="text-right tabular-nums">
                  {l.colonnePlusValue === k && l.plusOuMoinsValue !== null ? fm(l.plusOuMoinsValue) : ''}
                </td>
              ))}
            </tr>
          ))}
          <tr data-cession="TOTAL" className="font-semibold">
            <th scope="row" colSpan={2}>
              Total (lignes saisies)
            </th>
            {(['valeurActif', 'amortissements', 'valeurResiduelle', 'prixCession', 'c5', 'c6', 'c7', 'c8'] as const).map((k) => (
              <td key={k} className="text-right tabular-nums" data-total={k}>
                <CelluleMs c={c.totaux[k]} fm={fm} />
              </td>
            ))}
          </tr>
          <tr data-cession="REG">
            <th scope="row" colSpan={6}>
              Régularisations (cases 590, 583, 594, 595) {badge(c.regularisations.statut)}
            </th>
            {(['c5', 'c6', 'c7', 'c8'] as const).map((k) => (
              <td key={k} className="text-right tabular-nums">
                {c.regularisations[k] !== null ? fm(c.regularisations[k]) : ''}
                <span className="block text-xs text-texte-doux">case {c.regularisations.codes[k]}</span>
              </td>
            ))}
          </tr>
          <tr data-cession="TOTAL_GENERAL" className="font-semibold">
            <th scope="row" colSpan={6}>
              TOTAL (total de colonne + régularisations)
            </th>
            {(['c5', 'c6', 'c7', 'c8'] as const).map((k) => (
              <td key={k} className="text-right tabular-nums" data-total-general={k}>
                <CelluleMs c={c.totalGeneral[k]} fm={fm} />
              </td>
            ))}
          </tr>
        </tbody>
      </Tableau>
      <p className="text-sm" data-testid="plus-values-19">
        Plus-values taxables à 19 % (case 579) : {c.plusValues19.montant !== null ? <strong>{fm(c.plusValues19.montant)}</strong> : 'à saisir'} {badge(c.plusValues19.statut)}
      </p>
      <p className="text-sm" data-testid="etat-cadre-iii">
        État du cadre : <strong>{c.etat === 'saisi' ? 'cessions saisies' : c.etat === 'neant' ? 'néant déclaré' : 'à saisir (ni cession ni néant)'}</strong>
        {c.neant ? ` — déclaré le ${formaterHorodatage(c.neant.le)} sur la version ${c.neant.versionDonnees} des données` : ''}.
      </p>
      {revision ? (
        <div className="space-y-3">
          <NeantTableau exerciceId={exerciceId} tableau="2033C_III" declare={c.etat === 'neant'} etiquette="cadre III du 2033-C (aucune cession)" />
          <ListeEtatJoint classe="space-y-3" capacite={10} items={c.lignes} rendu={(l) => (
              <li key={l.ligne} className="rounded-lg border border-bordure p-3" data-saisie-cession={l.ligne}>
                <p className="text-sm font-semibold">Cession n° {Number(l.ligne)} {badge(l.statut)}</p>
                {l.trace ? (
                  <p className="text-xs text-texte-doux" data-testid={`trace-cession-${l.ligne}`}>
                    saisie le {formaterHorodatage(l.trace.le)} sur la version {l.trace.versionDonnees} des données · « {l.trace.note} »
                  </p>
                ) : null}
                <HistoriqueLigne evenements={evenements} cle={`2033C_III:${l.ligne}`} fm={fm} />
                <SaisieLigneTableau
                  exerciceId={exerciceId}
                  tableau="2033C_III"
                  ligne={l.ligne}
                  etiquette={`la cession ${Number(l.ligne)}`}
                  saisie={l.statut !== 'a_saisir'}
                  noteCourante={l.trace?.note ?? null}
                  champs={[
                    { cle: 'nature', libelle: 'Nature de l’immobilisation cédée', type: 'texte', valeur: l.nature ?? '' },
                    { cle: 'valeurActif', libelle: '① Valeur d’actif', type: 'montant', valeur: l.valeurActif ?? '' },
                    { cle: 'amortissements', libelle: '② Amortissements', type: 'montant', valeur: l.amortissements ?? '' },
                    { cle: 'prixCession', libelle: '④ Prix de cession', type: 'montant', valeur: l.prixCession ?? '' },
                    { cle: 'classement', libelle: 'Régime de la plus ou moins-value (décision du cabinet)', type: 'choix', options: choix, valeur: l.classement ?? 'court_terme' },
                  ]}
                />
              </li>
            )} />
          <ul className="space-y-3">
            <li className="rounded-lg border border-bordure p-3" data-saisie-cession="REG">
              <p className="text-sm font-semibold">Régularisations {badge(c.regularisations.statut)}</p>
              <HistoriqueLigne evenements={evenements} cle="2033C_III:REG" fm={fm} />
              <SaisieLigneTableau
                exerciceId={exerciceId}
                tableau="2033C_III"
                ligne="REG"
                etiquette="les régularisations"
                saisie={c.regularisations.statut !== 'a_saisir'}
                noteCourante={c.regularisations.trace?.note ?? null}
                champs={(['c5', 'c6', 'c7', 'c8'] as const).map((k) => ({ cle: k, libelle: `Colonne ${k.slice(1)} (case ${c.regularisations.codes[k]}, signée)`, type: 'montant' as const, valeur: c.regularisations[k] ?? '' }))}
              />
            </li>
            <li className="rounded-lg border border-bordure p-3" data-saisie-cession="PV19">
              <p className="text-sm font-semibold">Plus-values taxables à 19 % (case 579) {badge(c.plusValues19.statut)}</p>
              <HistoriqueLigne evenements={evenements} cle="2033C_III:PV19" fm={fm} />
              <SaisieLigneTableau exerciceId={exerciceId} tableau="2033C_III" ligne="PV19" etiquette="la case 579" saisie={c.plusValues19.statut !== 'a_saisir'} noteCourante={c.plusValues19.trace?.note ?? null} champs={[{ cle: 'montant', libelle: 'Montant (case 579)', type: 'montant', valeur: c.plusValues19.montant ?? '' }]} />
            </li>
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Tableau 2054 bis (écarts de réévaluation des immobilisations amortissables) : saisie ligne par ligne, tracée et historisée (D-112). */
function EcartsReevaluation({ t, fm, exerciceId, revision, evenements }: { t: EcartsReevaluationProjet; fm: Fm; exerciceId: string; revision: boolean; evenements: EvenementQualification[] }) {
  const badge = (statut: string) => <Etiquette ton={statut === 'saisi' ? 'succes' : 'attention'}>{statut === 'saisi' ? 'Saisi' : statut === 'a_revoir' ? 'À revoir : données modifiées' : 'À saisir'}</Etiquette>;
  return (
    <section className="space-y-3" aria-labelledby="titre-2054-bis" data-testid="ecarts-reevaluation">
      <SousTitre id="titre-2054-bis" className="text-base">
        2054 bis — Écarts de réévaluation sur immobilisations amortissables <MentionProjet />
      </SousTitre>
      <Alerte ton="attention" titre="Saisie du cabinet : tableau réservé aux entreprises ayant pratiqué la réévaluation légale">
        <p className="text-sm">
          Aucune donnée de la balance ne porte ce tableau. Chaque ligne se saisit (colonnes ① à ⑤) avec une justification obligatoire, tracée et historisée ; le logiciel calcule seulement ce que le formulaire calcule : écart = ① − ②, colonne ⑥ = (① − ②) − ⑤, ligne 10 = somme des lignes,
          cadre B ligne 3 = ligne 1 − ligne 2. Une ligne non saisie n’est jamais présumée nulle ; sans ligne ni « néant », les totaux restent en abstention.
        </p>
        {t.limites.map((l) => (
          <p key={l} className="text-sm">
            {l}
          </p>
        ))}
      </Alerte>
      <ul className="space-y-1" aria-label="Contrôles du 2054 bis" data-testid="controles-2054-bis">
        {t.controles.map((x) => (
          <li key={x.code}>
            <Etiquette ton={x.statut === 'coherent' ? 'succes' : x.statut === 'ecart' ? 'danger' : 'attention'}>{x.statut === 'coherent' ? 'Cohérent' : x.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette> {x.message}
          </li>
        ))}
      </ul>
      <Tableau legende="Cadre A du tableau 2054 bis : écarts de réévaluation">
        <thead>
          <tr>
            <th scope="col">Ligne</th>
            <th scope="col" className="text-right">① Augmentation du montant brut</th>
            <th scope="col" className="text-right">② Augmentation des amortissements</th>
            <th scope="col" className="text-right">Écart (① − ②)</th>
            <th scope="col" className="text-right">③ Suppléments d’amortissement</th>
            <th scope="col" className="text-right">④ Fraction résiduelle (éléments cédés)</th>
            <th scope="col" className="text-right">⑤ Montant cumulé fin d’exercice</th>
            <th scope="col" className="text-right">⑥ Provision spéciale fin d’exercice</th>
          </tr>
        </thead>
        <tbody data-testid="lignes-2054-bis">
          {t.lignes.map((l) => (
            <tr key={l.ligne} data-bis={l.ligne}>
              <th scope="row">
                {Number(l.ligne)} — {l.libelle} {l.statut !== 'saisi' ? badge(l.statut) : null}
              </th>
              {([l.c1, l.c2, l.ecart, l.c3, l.c4, l.c5, l.c6] as Array<string | null>).map((v, i) => (
                <td key={i} className="text-right tabular-nums">
                  {v !== null ? fm(v) : ''}
                </td>
              ))}
            </tr>
          ))}
          <tr data-bis="TOTAUX" className="font-semibold">
            <th scope="row">10 — TOTAUX (lignes saisies)</th>
            <td className="text-right tabular-nums">
              <CelluleMs c={t.totaux.c1} fm={fm} />
            </td>
            <td className="text-right tabular-nums">
              <CelluleMs c={t.totaux.c2} fm={fm} />
            </td>
            <td />
            <td className="text-right tabular-nums">
              <CelluleMs c={t.totaux.c3} fm={fm} />
            </td>
            <td className="text-right tabular-nums">
              <CelluleMs c={t.totaux.c4} fm={fm} />
            </td>
            <td className="text-right tabular-nums">
              <CelluleMs c={t.totaux.c5} fm={fm} />
            </td>
            <td className="text-right tabular-nums" data-total="c6">
              <CelluleMs c={t.totaux.c6} fm={fm} />
            </td>
          </tr>
        </tbody>
      </Tableau>
      <p className="text-sm" data-testid="cadre-b-2054-bis">
        Cadre B (déficits au 31 décembre 1976 imputés sur la provision spéciale) : ligne 1 {t.cadreB.b1.montant !== null ? <strong>{fm(t.cadreB.b1.montant)}</strong> : 'à saisir'} {badge(t.cadreB.b1.statut)} · ligne 2{' '}
        {t.cadreB.b2.montant !== null ? <strong>{fm(t.cadreB.b2.montant)}</strong> : 'à saisir'} {badge(t.cadreB.b2.statut)} · ligne 3 (1 − 2) : <CelluleMs c={t.cadreB.b3} fm={fm} />
      </p>
      <p className="text-sm" data-testid="etat-2054-bis">
        État du tableau : <strong>{t.etat === 'saisi' ? 'lignes saisies' : t.etat === 'neant' ? 'néant déclaré' : 'à saisir (ni ligne ni néant)'}</strong>
        {t.neant ? ` — déclaré le ${formaterHorodatage(t.neant.le)} sur la version ${t.neant.versionDonnees} des données` : ''}.
      </p>
      {revision ? (
        <div className="space-y-3">
          <NeantTableau exerciceId={exerciceId} tableau="2054BIS_A" declare={t.etat === 'neant'} etiquette="tableau 2054 bis (aucune réévaluation légale)" />
          <ul className="space-y-3">
            {t.lignes.map((l) => (
              <li key={l.ligne} className="rounded-lg border border-bordure p-3" data-saisie-bis={l.ligne}>
                <p className="text-sm font-semibold">
                  Ligne {Number(l.ligne)} — {l.libelle} {badge(l.statut)}
                </p>
                {l.trace ? (
                  <p className="text-xs text-texte-doux" data-testid={`trace-bis-${l.ligne}`}>
                    saisie le {formaterHorodatage(l.trace.le)} sur la version {l.trace.versionDonnees} des données · « {l.trace.note} »
                  </p>
                ) : null}
                <HistoriqueLigne evenements={evenements} cle={`2054BIS_A:${l.ligne}`} fm={fm} />
                <SaisieLigneTableau
                  exerciceId={exerciceId}
                  tableau="2054BIS_A"
                  ligne={l.ligne}
                  etiquette={`la ligne ${Number(l.ligne)} du 2054 bis`}
                  saisie={l.statut !== 'a_saisir'}
                  noteCourante={l.trace?.note ?? null}
                  champs={[
                    { cle: 'c1', libelle: '① Augmentation du montant brut', type: 'montant', valeur: l.c1 ?? '' },
                    { cle: 'c2', libelle: '② Augmentation des amortissements', type: 'montant', valeur: l.c2 ?? '' },
                    { cle: 'c3', libelle: '③ Suppléments d’amortissement', type: 'montant', valeur: l.c3 ?? '' },
                    { cle: 'c4', libelle: '④ Fraction résiduelle (cédés)', type: 'montant', valeur: l.c4 ?? '' },
                    { cle: 'c5', libelle: '⑤ Montant cumulé fin d’exercice', type: 'montant', valeur: l.c5 ?? '' },
                  ]}
                />
              </li>
            ))}
            {(['B1', 'B2'] as const).map((b) => {
              const x = b === 'B1' ? t.cadreB.b1 : t.cadreB.b2;
              return (
                <li key={b} className="rounded-lg border border-bordure p-3" data-saisie-bis={b}>
                  <p className="text-sm font-semibold">
                    Cadre B, ligne {b === 'B1' ? '1 — fraction incluse dans la provision spéciale au début de l’exercice' : '2 — fraction rattachée au résultat de l’exercice'} {badge(x.statut)}
                  </p>
                  <HistoriqueLigne evenements={evenements} cle={`2054BIS_B:${b}`} fm={fm} />
                  <SaisieLigneTableau exerciceId={exerciceId} tableau="2054BIS_B" ligne={b} etiquette={`la ligne ${b === 'B1' ? 1 : 2} du cadre B`} saisie={x.statut !== 'a_saisir'} noteCourante={x.trace?.note ?? null} champs={[{ cle: 'montant', libelle: 'Montant', type: 'montant', valeur: x.montant ?? '' }]} />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Tableau 2055 cadre B (amortissements dérogatoires) : saisie ligne par ligne, tracée et historisée (D-113). */
function AmortissementsDerogatoires({ t, fm, exerciceId, revision, evenements }: { t: AmortissementsDerogatoiresProjet; fm: Fm; exerciceId: string; revision: boolean; evenements: EvenementQualification[] }) {
  const badge = (statut: string) => <Etiquette ton={statut === 'saisi' ? 'succes' : 'attention'}>{statut === 'saisi' ? 'Saisi' : statut === 'a_revoir' ? 'À revoir : données modifiées' : 'À saisir'}</Etiquette>;
  const total = (nom: string, cellules: Array<CelluleMontantSaisie | null>, testid: string) => (
    <tr data-b2055={testid} className="font-semibold">
      <th scope="row">{nom}</th>
      {cellules.map((c, i) => (
        <td key={i} className="text-right tabular-nums">
          {c ? <CelluleMs c={c} fm={fm} /> : null}
        </td>
      ))}
    </tr>
  );
  return (
    <section className="space-y-3" aria-labelledby="titre-2055-b" data-testid="amortissements-derogatoires">
      <SousTitre id="titre-2055-b" className="text-base">
        2055 — Cadre B : provision pour amortissements dérogatoires (dotations et reprises) <MentionProjet />
      </SousTitre>
      <Alerte ton="attention" titre="Saisie du cabinet : la balance ne ventile pas les amortissements dérogatoires">
        <p className="text-sm">
          Chaque poste se saisit en colonnes 1 à 6 (dotations : différentiel de durée et autres, mode dégressif, amortissement fiscal exceptionnel ; reprises : mêmes origines) avec une justification obligatoire, tracée et historisée. L’origine d’une dotation ou d’une reprise est une décision du cabinet. Le logiciel
          calcule seulement ce que le formulaire calcule : colonne 7 = (1 + 2 + 3) − (4 + 5 + 6), totaux, non ventilé. Une ligne non saisie n’est jamais présumée nulle ; sans ligne ni « néant », les totaux restent en abstention.
        </p>
        {t.limites.map((l) => (
          <p key={l} className="text-sm">
            {l}
          </p>
        ))}
      </Alerte>
      <ul className="space-y-1" aria-label="Contrôles du cadre B du 2055" data-testid="controles-2055-b">
        {t.controles.map((x) => (
          <li key={x.code}>
            <Etiquette ton={x.statut === 'coherent' ? 'succes' : x.statut === 'ecart' ? 'danger' : 'attention'}>{x.statut === 'coherent' ? 'Cohérent' : x.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette> {x.message}
            {x.ecart ? ` (écart : ${fm(x.ecart)})` : ''}
          </li>
        ))}
      </ul>
      <Tableau legende="Cadre B du tableau 2055 : amortissements dérogatoires">
        <thead>
          <tr>
            <th scope="col">Immobilisations amortissables</th>
            {LIBELLES_COLONNES_2055_B.map((c) => (
              <th key={c} scope="col" className="text-right">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody data-testid="lignes-2055-b">
          {t.lignes.map((l) => (
            <tr key={l.ligne} data-b2055={l.ligne}>
              <th scope="row">
                {l.libelle} {l.statut !== 'saisi' ? badge(l.statut) : null}
              </th>
              {l.colonnes.map((c, i) => (
                <td key={i} className="text-right tabular-nums">
                  {c ? (
                    <>
                      {c.montant !== null ? fm(c.montant) : ''}
                      <span className="block text-xs text-texte-doux">case {c.codeCase}</span>
                    </>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
          {total('TOTAL I (incorporelles)', t.totaux.I, 'I')}
          {total('TOTAL II (corporelles)', t.totaux.II, 'II')}
          {total('TOTAL III (frais d’acquisition de titres de participation)', t.totaux.III, 'III')}
          {total('Total général (I + II + III)', t.totaux.general, 'general')}
        </tbody>
      </Tableau>
      <p className="text-sm" data-testid="non-ventile-2055-b">
        Total général non ventilé : dotations (NP + NQ + NR) <CelluleMs c={t.nonVentile.NW} fm={fm} /> · reprises (NS + NT + NU) <CelluleMs c={t.nonVentile.NY} fm={fm} /> · mouvement net (NW − NY) <CelluleMs c={t.nonVentile.NZ} fm={fm} />
      </p>
      <p className="text-sm" data-testid="etat-2055-b">
        État du cadre : <strong>{t.etat === 'saisi' ? 'lignes saisies' : t.etat === 'neant' ? 'néant déclaré' : 'à saisir (ni ligne ni néant)'}</strong>
        {t.neant ? ` — déclaré le ${formaterHorodatage(t.neant.le)} sur la version ${t.neant.versionDonnees} des données` : ''}.
      </p>
      {revision ? (
        <div className="space-y-3">
          <NeantTableau exerciceId={exerciceId} tableau="2055_B" declare={t.etat === 'neant'} etiquette="cadre B du 2055 (aucun amortissement dérogatoire)" />
          <ul className="space-y-3">
            {t.lignes.map((l) => {
              const quatre = l.ligne === '13';
              const idx = quatre ? [0, 3] : [0, 1, 2, 3, 4, 5];
              return (
                <li key={l.ligne} className="rounded-lg border border-bordure p-3" data-saisie-b2055={l.ligne}>
                  <p className="text-sm font-semibold">
                    {l.libelle} {badge(l.statut)}
                  </p>
                  {l.trace ? (
                    <p className="text-xs text-texte-doux" data-testid={`trace-b2055-${l.ligne}`}>
                      saisie le {formaterHorodatage(l.trace.le)} sur la version {l.trace.versionDonnees} des données · « {l.trace.note} »
                    </p>
                  ) : null}
                  <HistoriqueLigne evenements={evenements} cle={`2055_B:${l.ligne}`} fm={fm} />
                  <SaisieLigneTableau
                    exerciceId={exerciceId}
                    tableau="2055_B"
                    ligne={l.ligne}
                    etiquette={`la ligne « ${l.libelle} » du cadre B`}
                    saisie={l.statut !== 'a_saisir'}
                    noteCourante={l.trace?.note ?? null}
                    champs={idx.map((i) => ({ cle: `c${i + 1}`, libelle: LIBELLES_COLONNES_2055_B[i]!, type: 'montant' as const, valeur: l.colonnes[i]?.montant ?? '' }))}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Tableau 2055 cadre C (charges réparties sur plusieurs exercices) : saisie ligne par ligne, tracée et historisée (D-113). */
function ChargesReparties({ t, fm, exerciceId, revision, evenements }: { t: ChargesRepartiesProjet; fm: Fm; exerciceId: string; revision: boolean; evenements: EvenementQualification[] }) {
  const badge = (statut: string) => <Etiquette ton={statut === 'saisi' ? 'succes' : 'attention'}>{statut === 'saisi' ? 'Saisi' : statut === 'a_revoir' ? 'À revoir : données modifiées' : 'À saisir'}</Etiquette>;
  return (
    <section className="space-y-3" aria-labelledby="titre-2055-c" data-testid="charges-reparties">
      <SousTitre id="titre-2055-c" className="text-base">
        2055 — Cadre C : charges réparties sur plusieurs exercices <MentionProjet />
      </SousTitre>
      <Alerte ton="attention" titre="Saisie du cabinet : la balance ne porte pas les mouvements de l’exercice">
        <p className="text-sm">
          Le montant net au début, les augmentations et les dotations de l’exercice se saisissent avec une justification obligatoire, tracée et historisée ; le montant net à la fin est calculé comme le formulaire : début + augmentations − dotations. Sans ligne ni « néant », rien n’est présumé nul.
        </p>
        {t.limites.map((l) => (
          <p key={l} className="text-sm">
            {l}
          </p>
        ))}
      </Alerte>
      <ul className="space-y-1" aria-label="Contrôles du cadre C du 2055" data-testid="controles-2055-c">
        {t.controles.map((x) => (
          <li key={x.code}>
            <Etiquette ton={x.statut === 'coherent' ? 'succes' : x.statut === 'ecart' ? 'danger' : 'attention'}>{x.statut === 'coherent' ? 'Cohérent' : x.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette> {x.message}
            {x.ecart ? ` (écart : ${fm(x.ecart)})` : ''}
          </li>
        ))}
      </ul>
      <Tableau legende="Cadre C du tableau 2055 : charges réparties sur plusieurs exercices">
        <thead>
          <tr>
            <th scope="col">Charges</th>
            <th scope="col" className="text-right">Montant net au début</th>
            <th scope="col" className="text-right">Augmentations</th>
            <th scope="col" className="text-right">Dotations de l’exercice aux amortissements</th>
            <th scope="col" className="text-right">Montant net à la fin</th>
          </tr>
        </thead>
        <tbody data-testid="lignes-2055-c">
          {t.lignes.map((l) => (
            <tr key={l.ligne} data-c2055={l.ligne}>
              <th scope="row">
                {l.libelle} {l.statut !== 'saisi' ? badge(l.statut) : null}
              </th>
              <td className="text-right tabular-nums">{l.debut !== null ? fm(l.debut) : ''}</td>
              <td className="text-right tabular-nums">{l.augmentations !== null ? fm(l.augmentations) : ''}</td>
              <td className="text-right tabular-nums">
                {l.dotations !== null ? fm(l.dotations) : ''}
                <span className="block text-xs text-texte-doux">case {l.caseDotations}</span>
              </td>
              <td className="text-right tabular-nums">
                {l.fin !== null ? fm(l.fin) : ''}
                <span className="block text-xs text-texte-doux">case {l.caseFin}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </Tableau>
      <p className="text-sm" data-testid="etat-2055-c">
        État du cadre : <strong>{t.etat === 'saisi' ? 'lignes saisies' : t.etat === 'neant' ? 'néant déclaré' : 'à saisir (ni ligne ni néant)'}</strong>
        {t.neant ? ` — déclaré le ${formaterHorodatage(t.neant.le)} sur la version ${t.neant.versionDonnees} des données` : ''}.
      </p>
      {revision ? (
        <div className="space-y-3">
          <NeantTableau exerciceId={exerciceId} tableau="2055_C" declare={t.etat === 'neant'} etiquette="cadre C du 2055 (aucune charge répartie)" />
          <ul className="space-y-3">
            {t.lignes.map((l) => (
              <li key={l.ligne} className="rounded-lg border border-bordure p-3" data-saisie-c2055={l.ligne}>
                <p className="text-sm font-semibold">
                  {l.libelle} {badge(l.statut)}
                </p>
                {l.trace ? (
                  <p className="text-xs text-texte-doux" data-testid={`trace-c2055-${l.ligne}`}>
                    saisie le {formaterHorodatage(l.trace.le)} sur la version {l.trace.versionDonnees} des données · « {l.trace.note} »
                  </p>
                ) : null}
                <HistoriqueLigne evenements={evenements} cle={`2055_C:${l.ligne}`} fm={fm} />
                <SaisieLigneTableau
                  exerciceId={exerciceId}
                  tableau="2055_C"
                  ligne={l.ligne}
                  etiquette={`la ligne « ${l.libelle} » du cadre C`}
                  saisie={l.statut !== 'a_saisir'}
                  noteCourante={l.trace?.note ?? null}
                  champs={[
                    { cle: 'debut', libelle: 'Montant net au début de l’exercice', type: 'montant', valeur: l.debut ?? '' },
                    { cle: 'augmentations', libelle: 'Augmentations', type: 'montant', valeur: l.augmentations ?? '' },
                    { cle: 'dotations', libelle: `Dotations de l’exercice (case ${l.caseDotations})`, type: 'montant', valeur: l.dotations ?? '' },
                  ]}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function CelluleCaseD({ c, fm }: { c: CaseSaisie2033D | undefined; fm: Fm }) {
  if (c === undefined) return null;
  return (
    <>
      {c.statut === 'saisi' ? (c.neant ? <span className="text-texte-doux">néant</span> : <span className="tabular-nums">{c.type === 'entier' ? String(Number(c.montant)) : fm(c.montant)}</span>) : c.statut === 'a_revoir' ? <Etiquette ton="attention">à revoir</Etiquette> : c.proposition ? <span className="text-xs text-texte-doux" title={c.proposition.origine}>proposé : {fm(c.proposition.montant)}</span> : <span className="text-texte-doux">à saisir</span>}
      <span className="block text-xs text-texte-doux">case {c.codeCase}</span>
    </>
  );
}

function CelluleCalc({ c, fm }: { c: CelluleCalculee2033D; fm: Fm }) {
  return c.statut === 'etabli' ? (
    <>
      <strong className="tabular-nums">{fm(c.montant)}</strong>
      <span className="block text-xs text-texte-doux">case {c.codeCase} · {c.calcul}</span>
    </>
  ) : (
    <>
      <span className="text-texte-doux" title={c.motifs.join(' ')}>
        abstention
      </span>
      <span className="block text-xs text-texte-doux">case {c.codeCase} · {c.motifs.join(' ')}</span>
    </>
  );
}

/** Tableau 2033-D (provisions, amortissements dérogatoires, déficits reportables, divers) : saisie case par case, justifiée et historisée (D-114). */
function Formulaire2033D({ f, fm, exerciceId, revision, evenements }: { f: Formulaire2033DProjet; fm: Fm; exerciceId: string; revision: boolean; evenements: EvenementQualification[] }) {
  const parCode = new Map(f.cases.map((c) => [c.codeCase, c]));
  const badge = (statut: string) => <Etiquette ton={statut === 'saisi' ? 'succes' : 'attention'}>{statut === 'saisi' ? 'Saisi' : statut === 'a_revoir' ? 'À revoir : données modifiées' : 'À saisir'}</Etiquette>;
  const casesLigne = (codes: string[], libelles: string[]) =>
    codes.map((code, i) => {
      const c = parCode.get(code)!;
      return { cle: c.cle, code, libelle: libelles[i]!, valeur: c.saisie?.montant ?? '', saisie: c.statut !== 'a_saisir' };
    });
  const note = (codes: string[]) => codes.map((c) => parCode.get(c)!.saisie?.note).find((n) => n) ?? null;
  const aSaisir = (c: CaseSaisie2033D) => (
    <li key={c.cle} className="rounded border border-bordure p-2" data-ligne-d={c.cle}>
      <p className="text-sm">
        {c.libelle} <span className="text-texte-doux">(case {c.codeCase}, lue, vérifiée sur le PDF)</span> {badge(c.statut)}
        {c.proposition && c.statut !== 'saisi' ? <span className="text-xs text-texte-doux"> · proposition : {fm(c.proposition.montant)} ({c.proposition.origine}), non retenue</span> : null}
      </p>
      {c.precision ? <p className="text-xs text-texte-doux">{c.precision}</p> : null}
      {c.saisie ? (
        <p className="text-xs text-texte-doux" data-testid={`trace-d-${c.cle}`}>
          {c.neant ? 'Néant' : fm(c.saisie.montant)} · saisi le {formaterHorodatage(c.saisie.le)} sur la version {c.saisie.versionDonnees} des données · « {c.saisie.note} »
        </p>
      ) : null}
      <HistoriqueLigne evenements={evenements} cle={c.cle} fm={fm} />
      {revision ? <SaisirRenvoi exerciceId={exerciceId} code={c.cle} proposition={c.proposition?.montant ?? null} saisie={c.saisie ? { montant: c.saisie.montant, note: c.saisie.note } : null} avecNeant /> : null}
    </li>
  );
  return (
    <section className="space-y-4" aria-labelledby="titre-2033-d" data-testid="formulaire-2033-d">
      <SousTitre id="titre-2033-d" className="text-base">
        2033-D — Relevé des provisions, amortissements dérogatoires, déficits reportables, divers <MentionProjet />
      </SousTitre>
      <Alerte ton="attention" titre="Saisie du cabinet : aucune de ces informations ne se déduit de la balance">
        <p className="text-sm">
          Chaque case se saisit avec une justification obligatoire, tracée et historisée ; « néant » est une déclaration explicite et une case sans saisie n’est jamais présumée nulle. Le logiciel ne calcule que ce que la notice énonce (case 870 = 984 + 860 ; case 780 = total du cadre C) ;
          les autres rapprochements sont des contrôles indicatifs, jamais bloquants ni corrigés. Les cases 983 et 860, que la notice identifie aux lignes 360 et 372 du 2033-B, sont proposées quand la partie B est établie, jamais retenues sans saisie.
        </p>
        {f.limites.map((l) => (
          <p key={l} className="text-sm">
            {l}
          </p>
        ))}
      </Alerte>
      <ul className="space-y-1" aria-label="Contrôles du 2033-D" data-testid="controles-2033-d">
        {f.controles.map((x) => (
          <li key={x.code}>
            <Etiquette ton={x.statut === 'coherent' ? 'succes' : x.statut === 'ecart' ? 'danger' : 'attention'}>{x.statut === 'coherent' ? 'Cohérent' : x.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette> {x.message}
            {x.ecart ? ` (écart : ${fm(x.ecart)})` : ''}
          </li>
        ))}
      </ul>

      <div className="space-y-2">
        <h3 className="font-semibold">I-A — Nature des provisions</h3>
        <Tableau legende="Cadre I-A du tableau 2033-D : relevé des provisions">
          <thead>
            <tr>
              <th scope="col">Nature</th>
              <th scope="col" className="text-right">Début de l’exercice</th>
              <th scope="col" className="text-right">Augmentations (dotations)</th>
              <th scope="col" className="text-right">Diminutions (reprises)</th>
              <th scope="col" className="text-right">Fin de l’exercice</th>
            </tr>
          </thead>
          <tbody data-testid="provisions-2033-d">
            {LIGNES_PROVISIONS_2033D.map((l) => (
              <tr key={l.id} data-provision={l.id}>
                <th scope="row">{l.libelle}</th>
                {l.cases.map((code) => (
                  <td key={code} className="text-right">
                    <CelluleCaseD c={parCode.get(code)} fm={fm} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Tableau>
        {revision ? (
          <ul className="space-y-2">
            {LIGNES_PROVISIONS_2033D.map((l) => (
              <li key={l.id} className="rounded border border-bordure p-2" data-saisie-provision={l.id}>
                <p className="text-sm font-semibold">{l.libelle}</p>
                <SaisieCases exerciceId={exerciceId} etiquette={`provisions-${l.id}`} noteCourante={note([...l.cases])} cases={casesLigne([...l.cases], ['Début', 'Dotations', 'Reprises', 'Fin'])} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">I-B — Mouvements affectant la provision pour amortissements dérogatoires</h3>
        <Tableau legende="Cadre I-B du tableau 2033-D : amortissements dérogatoires">
          <thead>
            <tr>
              <th scope="col">Immobilisations</th>
              <th scope="col" className="text-right">Dotations</th>
              <th scope="col" className="text-right">Reprises</th>
            </tr>
          </thead>
          <tbody data-testid="derogatoires-2033-d">
            {LIGNES_DEROGATOIRES_2033D.map((l) => (
              <tr key={l.id} data-derogatoire={l.id}>
                <th scope="row">{l.libelle}</th>
                {l.cases.map((code) => (
                  <td key={code} className="text-right">
                    <CelluleCaseD c={parCode.get(code)} fm={fm} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Tableau>
        {revision ? (
          <ul className="space-y-2">
            {LIGNES_DEROGATOIRES_2033D.map((l) => (
              <li key={l.id} className="rounded border border-bordure p-2" data-saisie-derogatoire={l.id}>
                <p className="text-sm font-semibold">{l.libelle}</p>
                <SaisieCases exerciceId={exerciceId} etiquette={`derogatoires-${l.id}`} noteCourante={note([...l.cases])} cases={casesLigne([...l.cases], ['Dotations', 'Reprises'])} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">I-C — Dotations aux provisions et charges à payer non déductibles (sept lignes)</h3>
        <p className="text-sm" data-testid="cadre-c-2033-d">
          Total à reporter ligne 322 du 2033-B (case 780) : <CelluleCalc c={f.cadreC.total780} fm={fm} /> · état : <strong>{f.cadreC.etat === 'saisi' ? 'lignes saisies' : f.cadreC.etat === 'neant' ? 'néant déclaré' : 'à saisir (ni ligne ni néant)'}</strong>
        </p>
        <ListeEtatJoint classe="space-y-1" capacite={7} items={f.cadreC.lignes} rendu={(l) => (
            <li key={l.ligne} className="text-sm" data-ligne-c={l.ligne}>
              {Number(l.ligne)} — {l.statut === 'saisi' ? `${l.nature} : ${fm(l.montant)}` : badge(l.statut)}
              {l.trace ? <span className="text-xs text-texte-doux"> · saisie le {formaterHorodatage(l.trace.le)} sur la version {l.trace.versionDonnees} des données · « {l.trace.note} »</span> : null}
              <HistoriqueLigne evenements={evenements} cle={`2033D_C:${l.ligne}`} fm={fm} />
              {revision ? (
                <SaisieLigneTableau
                  exerciceId={exerciceId}
                  tableau="2033D_C"
                  ligne={l.ligne}
                  etiquette={`la ligne ${Number(l.ligne)} du cadre C`}
                  saisie={l.statut !== 'a_saisir'}
                  noteCourante={l.trace?.note ?? null}
                  champs={[
                    { cle: 'nature', libelle: 'Nature de la dotation non déductible', type: 'texte', valeur: l.nature ?? '' },
                    { cle: 'montant', libelle: 'Montant', type: 'montant', valeur: l.montant ?? '' },
                  ]}
                />
              ) : null}
            </li>
          )} />
        {revision ? <NeantTableau exerciceId={exerciceId} tableau="2033D_C" declare={f.cadreC.etat === 'neant'} etiquette="cadre C du 2033-D (aucune dotation non déductible)" /> : null}
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">II — Déficits reportables</h3>
        <p className="text-sm" data-testid="total-870">
          Total des déficits restant à reporter (case 870) : <CelluleCalc c={f.total870} fm={fm} />
        </p>
        <ul className="space-y-2" data-testid="deficits-2033-d">
          {f.cases.filter((c) => c.cadre === 'II').map(aSaisir)}
        </ul>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">III — Divers</h3>
        <ul className="space-y-2" data-testid="divers-2033-d">
          {f.cases.filter((c) => c.cadre === 'III').map(aSaisir)}
        </ul>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">IV — Travailleurs indépendants (revenu brut social)</h3>
        {f.revenuBrutSocial ? (
          <p className="text-sm" data-testid="revenu-brut-social">
            Revenu brut social d’après la formule de la notice (cases 692 / 693) : <CelluleCalc c={f.revenuBrutSocial} fm={fm} />
          </p>
        ) : null}
        <ul className="space-y-2" data-testid="travailleurs-independants-2033-d">
          {f.cases.filter((c) => c.cadre === 'IV').map(aSaisir)}
        </ul>
      </div>

      <ul className="list-disc pl-5 text-sm text-texte-doux" data-testid="2033-d-non-prepare">
        {f.nonPrepare.map((n) => (
          <li key={n}>Non préparé — {n}</li>
        ))}
      </ul>
    </section>
  );
}

/** Tableau 2033-E (effectifs et valeur ajoutée) : saisie case par case, totaux calculés seulement quand tout est saisi (D-115). */
function Formulaire2033E({ f, fm, exerciceId, revision, evenements }: { f: Formulaire2033EProjet; fm: Fm; exerciceId: string; revision: boolean; evenements: EvenementQualification[] }) {
  const groupe = (g: CaseSaisie2033E['groupe']) => f.cases.filter((c) => c.groupe === g);
  const valeur = (c: CaseSaisie2033E) => (c.statut === 'saisi' ? (c.neant ? 'néant' : c.type === 'montant' ? fm(c.montant) : String(Number(c.montant))) : c.statut === 'a_revoir' ? 'à revoir' : c.proposition ? `proposé : ${fm(c.proposition.montant)}` : 'à saisir');
  const badge = (statut: string) => <Etiquette ton={statut === 'saisi' ? 'succes' : 'attention'}>{statut === 'saisi' ? 'Saisi' : statut === 'a_revoir' ? 'À revoir : données modifiées' : 'À saisir'}</Etiquette>;
  const bloc = (titre: string, g: CaseSaisie2033E['groupe'], total?: CelluleCalculee2033D, libelleTotal?: string) => (
    <div className="space-y-2" key={g}>
      <h3 className="font-semibold">{titre}</h3>
      <Tableau legende={titre}>
        <tbody data-testid={`groupe-2033-e-${g}`}>
          {groupe(g).map((c) => (
            <tr key={c.cle} data-case-e={c.codeCase}>
              <th scope="row">
                {c.libelle}
                <span className="block text-xs font-normal text-texte-doux">case {c.codeCase} (lue, vérifiée sur le PDF)</span>
              </th>
              <td className="text-right tabular-nums">{valeur(c)}</td>
            </tr>
          ))}
          {total ? (
            <tr data-case-e={total.codeCase} className="font-semibold">
              <th scope="row">{libelleTotal}</th>
              <td className="text-right">
                <CelluleCalc c={total} fm={fm} />
              </td>
            </tr>
          ) : null}
        </tbody>
      </Tableau>
      {revision ? (
        <ul className="space-y-2">
          {groupe(g).map((c) => (
            <li key={c.cle} className="rounded border border-bordure p-2" data-ligne-e={c.cle}>
              <p className="text-sm">
                {c.libelle} <span className="text-texte-doux">(case {c.codeCase})</span> {badge(c.statut)}
                {c.proposition && c.statut !== 'saisi' ? <span className="text-xs text-texte-doux"> · proposition : {fm(c.proposition.montant)} ({c.proposition.origine}), non retenue</span> : null}
              </p>
              {c.precision ? <p className="text-xs text-texte-doux">{c.precision}</p> : null}
              {c.saisie ? (
                <p className="text-xs text-texte-doux" data-testid={`trace-e-${c.cle}`}>
                  {c.neant ? 'Néant' : c.type === 'montant' ? fm(c.saisie.montant) : String(Number(c.saisie.montant))} · saisi le {formaterHorodatage(c.saisie.le)} sur la version {c.saisie.versionDonnees} des données · « {c.saisie.note} »
                </p>
              ) : null}
              <HistoriqueLigne evenements={evenements} cle={c.cle} fm={fm} />
              <SaisirRenvoi exerciceId={exerciceId} code={c.cle} proposition={c.proposition?.montant ?? null} saisie={c.saisie ? { montant: c.saisie.montant, note: c.saisie.note } : null} avecNeant />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
  return (
    <section className="space-y-4" aria-labelledby="titre-2033-e" data-testid="formulaire-2033-e">
      <SousTitre id="titre-2033-e" className="text-base">
        2033-E — Effectifs et valeur ajoutée (CVAE) <MentionProjet />
      </SousTitre>
      <Alerte ton="attention" titre="Saisie du cabinet : le rattachement des comptes aux lignes de la valeur ajoutée relève des règles de la CVAE">
        <p className="text-sm">
          Chaque case se saisit avec une justification obligatoire, tracée et historisée ; « néant » est une déclaration explicite et une case sans saisie n’est jamais présumée nulle. Les totaux 106, 144 et 152, la valeur ajoutée (137) et la case 117 sont calculés comme le formulaire
          l’énonce, uniquement quand toutes leurs composantes sont saisies. La case 022 est proposée (= case 106) pour un exercice de 12 mois, jamais retenue sans saisie. Durée de l’exercice : {f.exercice.dureeMois} mois.
        </p>
        {f.limites.map((l) => (
          <p key={l} className="text-sm">
            {l}
          </p>
        ))}
      </Alerte>
      <ul className="space-y-1" aria-label="Contrôles du 2033-E" data-testid="controles-2033-e">
        {f.controles.map((x) => (
          <li key={x.code}>
            <Etiquette ton={x.statut === 'coherent' ? 'succes' : x.statut === 'ecart' ? 'danger' : 'attention'}>{x.statut === 'coherent' ? 'Cohérent' : x.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette> {x.message}
            {x.ecart ? ` (écart : ${fm(x.ecart)})` : ''}
          </li>
        ))}
      </ul>
      {bloc('Déclaration des effectifs', 'effectifs')}
      {bloc('I — Chiffre d’affaires de référence CVAE', 'I', f.total1, 'TOTAL 1')}
      {bloc('II — Autres produits à retenir pour le calcul de la valeur ajoutée', 'II', f.total2, 'TOTAL 2')}
      {bloc('III — Charges à retenir pour le calcul de la valeur ajoutée', 'III', f.total3, 'TOTAL 3')}
      <div className="space-y-1" data-testid="valeur-ajoutee-2033-e">
        <h3 className="font-semibold">IV et V — Valeur ajoutée produite et assujettie à la CVAE</h3>
        <p className="text-sm">
          Calcul de la valeur ajoutée (Total 1 + Total 2 − Total 3) : <CelluleCalc c={f.valeurAjoutee137} fm={fm} />
        </p>
        <p className="text-sm">
          Valeur ajoutée assujettie à la CVAE : <CelluleCalc c={f.valeurAjoutee117} fm={fm} />
        </p>
      </div>
      {bloc('Cadre réservé au mono-établissement au sens de la CVAE', 'mono')}
      <ul className="list-disc pl-5 text-sm text-texte-doux" data-testid="2033-e-non-prepare">
        {f.nonPrepare.map((n) => (
          <li key={n}>Non préparé — {n}</li>
        ))}
      </ul>
    </section>
  );
}

/** Tableau 2033-F (composition du capital social) : saisie ligne par ligne, justifiée et historisée (D-116). */
function Formulaire2033F({ f, fm, exerciceId, revision, evenements, numero = '2033' }: { f: Formulaire2033FProjet; fm: Fm; exerciceId: string; revision: boolean; evenements: EvenementQualification[]; numero?: string }) {
  const badge = (statut: string) => <Etiquette ton={statut === 'saisi' ? 'succes' : 'attention'}>{statut === 'saisi' ? 'Saisi' : statut === 'a_revoir' ? 'À revoir : données modifiées' : 'À saisir'}</Etiquette>;
  const t = (cle: string, libelle: string, valeur: string | undefined, optionnel = false) => ({ cle, libelle, type: 'texte' as const, valeur: valeur ?? '', optionnel });
  const m = (cle: string, libelle: string, valeur: string | undefined) => ({ cle, libelle, type: 'montant' as const, valeur: valeur ?? '' });
  const adresse = (v: Record<string, string> | null) => [
    t('adresseNumero', 'N°', v?.adresseNumero, true), t('adresseVoie', 'Voie', v?.adresseVoie, true), t('codePostal', 'Code postal', v?.codePostal, true), t('commune', 'Commune', v?.commune, true), t('pays', 'Pays', v?.pays, true),
  ];
  return (
    <section className="space-y-4" aria-labelledby="titre-2033-f" data-testid="formulaire-2033-f">
      <SousTitre id="titre-2033-f" className="text-base">
        {numero}-F — Composition du capital social <MentionProjet />
      </SousTitre>
      <Alerte ton="attention" titre="Saisie du cabinet : le registre des associés est tenu par la société, rien ne se déduit de la balance">
        <p className="text-sm">
          Chaque ligne (quatre personnes morales, deux personnes physiques) et les nombres 901 à 904 se saisissent avec une justification obligatoire, tracée et historisée ; « néant » est une déclaration explicite du tableau. Les cases 905 (901 + 903) et 906 (902 + 904) sont calculées comme le formulaire l’énonce,
          quand 901 à 904 sont saisies. Les rapprochements (pourcentages, nombres d’associés et de parts) sont indicatifs. Les lignes de personnes physiques contiennent des données personnelles : elles restent dans les tables protégées du cabinet.
        </p>
        {f.limites.map((l) => (
          <p key={l} className="text-sm">
            {l}
          </p>
        ))}
      </Alerte>
      <ul className="space-y-1" aria-label="Contrôles du 2033-F" data-testid="controles-2033-f">
        {f.controles.map((x) => (
          <li key={x.code}>
            <Etiquette ton={x.statut === 'coherent' ? 'succes' : x.statut === 'ecart' ? 'danger' : 'attention'}>{x.statut === 'coherent' ? 'Cohérent' : x.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette> {x.message}
            {x.ecart ? ` (écart : ${fm(x.ecart)})` : ''}
          </li>
        ))}
      </ul>
      <p className="text-sm" data-testid="etat-2033-f">
        État du tableau : <strong>{f.etat === 'saisi' ? 'saisies présentes' : f.etat === 'neant' ? 'néant déclaré' : 'à saisir (ni saisie ni néant)'}</strong>
        {f.neant ? ` — déclaré le ${formaterHorodatage(f.neant.le)} sur la version ${f.neant.versionDonnees} des données` : ''}.
      </p>
      <Tableau legende="Nombres d’associés et de parts du tableau 2033-F">
        <tbody data-testid="nombres-2033-f">
          {f.nombres.cases.map((c) => (
            <tr key={c.code} data-nombre={c.code}>
              <th scope="row">
                {c.libelle}
                <span className="block text-xs font-normal text-texte-doux">case {c.code} (lue, vérifiée sur le PDF)</span>
              </th>
              <td className="text-right tabular-nums">{c.montant !== null ? (c.neant ? 'néant' : fm(c.montant)) : c.statut === 'a_revoir' ? 'à revoir' : 'à saisir'}</td>
            </tr>
          ))}
          <tr data-nombre="905" className="font-semibold">
            <th scope="row">Total des lignes 901 + 903 (nombre d’associés)</th>
            <td className="text-right">
              <CelluleCalc c={f.nombres.total905} fm={fm} />
            </td>
          </tr>
          <tr data-nombre="906" className="font-semibold">
            <th scope="row">Total des lignes 902 + 904 (nombre de parts ou d’actions)</th>
            <td className="text-right">
              <CelluleCalc c={f.nombres.total906} fm={fm} />
            </td>
          </tr>
        </tbody>
      </Tableau>
      {revision ? (
        <div className="space-y-2" data-testid="saisie-nombres-2033-f">
          <p className="text-sm font-semibold">Nombres d’associés et de parts {badge(f.nombres.statut)}</p>
          <HistoriqueLigne evenements={evenements} cle="2033F_NB:NB" fm={fm} />
          <SaisieLigneTableau
            exerciceId={exerciceId}
            tableau="2033F_NB"
            ligne="NB"
            etiquette="les nombres 901 à 904"
            saisie={f.nombres.statut !== 'a_saisir'}
            noteCourante={f.nombres.trace?.note ?? null}
            champs={f.nombres.cases.map((c) => ({ cle: `c${c.code}`, libelle: `${c.code}`, type: 'montant' as const, valeur: c.montant ?? '' }))}
          />
          <NeantTableau exerciceId={exerciceId} tableau="2033F_NB" declare={f.etat === 'neant'} etiquette="tableau 2033-F (aucun associé à déclarer)" />
        </div>
      ) : null}
      <div className="space-y-2">
        <h3 className="font-semibold">I — Capital détenu par les personnes morales</h3>
        <ListeEtatJoint classe="space-y-2" testid="personnes-morales-2033-f" capacite={4} items={f.personnesMorales} rendu={(l) => (
            <li key={l.ligne} className="rounded-lg border border-bordure p-3" data-associe-pm={l.ligne}>
              <p className="text-sm">
                Personne morale {Number(l.ligne)} — {l.statut === 'saisi' ? <strong>{l.valeurs!.denomination}</strong> : badge(l.statut)}
                {l.statut === 'saisi' ? <span className="text-texte-doux"> · {l.valeurs!.formeJuridique} · SIREN {l.valeurs!.siren || 'non applicable'} · {fm(l.valeurs!.pourcentage)} % · {fm(l.valeurs!.parts)} parts ou actions</span> : null}
              </p>
              {l.trace ? (
                <p className="text-xs text-texte-doux" data-testid={`trace-pm-${l.ligne}`}>
                  saisie le {formaterHorodatage(l.trace.le)} sur la version {l.trace.versionDonnees} des données · « {l.trace.note} »
                </p>
              ) : null}
              <HistoriqueLigne evenements={evenements} cle={`2033F_PM:${l.ligne}`} fm={fm} />
              {revision ? (
                <SaisieLigneTableau
                  exerciceId={exerciceId}
                  tableau="2033F_PM"
                  ligne={l.ligne}
                  etiquette={`la personne morale ${Number(l.ligne)}`}
                  saisie={l.statut !== 'a_saisir'}
                  noteCourante={l.trace?.note ?? null}
                  champs={[
                    t('formeJuridique', 'Forme juridique', l.valeurs?.formeJuridique, true),
                    t('denomination', 'Dénomination', l.valeurs?.denomination),
                    t('siren', 'N° SIREN (si établie en France)', l.valeurs?.siren, true),
                    m('pourcentage', '% de détention', l.valeurs?.pourcentage),
                    m('parts', 'Nb de parts ou actions', l.valeurs?.parts),
                    ...adresse(l.valeurs),
                  ]}
                />
              ) : null}
            </li>
          )} />
      </div>
      <div className="space-y-2">
        <h3 className="font-semibold">II — Capital détenu par les personnes physiques</h3>
        <ListeEtatJoint classe="space-y-2" testid="personnes-physiques-2033-f" capacite={2} items={f.personnesPhysiques} rendu={(l) => (
            <li key={l.ligne} className="rounded-lg border border-bordure p-3" data-associe-pp={l.ligne}>
              <p className="text-sm">
                Personne physique {Number(l.ligne)} — {l.statut === 'saisi' ? <strong>{l.valeurs!.titre} {l.valeurs!.nomFamille} {l.valeurs!.prenoms}</strong> : badge(l.statut)}
                {l.statut === 'saisi' ? <span className="text-texte-doux"> · {fm(l.valeurs!.pourcentage)} % · {fm(l.valeurs!.parts)} parts ou actions</span> : null}
              </p>
              {l.trace ? (
                <p className="text-xs text-texte-doux" data-testid={`trace-pp-${l.ligne}`}>
                  saisie le {formaterHorodatage(l.trace.le)} sur la version {l.trace.versionDonnees} des données · « {l.trace.note} »
                </p>
              ) : null}
              <HistoriqueLigne evenements={evenements} cle={`2033F_PP:${l.ligne}`} fm={fm} />
              {revision ? (
                <SaisieLigneTableau
                  exerciceId={exerciceId}
                  tableau="2033F_PP"
                  ligne={l.ligne}
                  etiquette={`la personne physique ${Number(l.ligne)}`}
                  saisie={l.statut !== 'a_saisir'}
                  noteCourante={l.trace?.note ?? null}
                  champs={[
                    { cle: 'titre', libelle: 'Titre', type: 'choix', options: [{ valeur: 'M', libelle: 'M' }, { valeur: 'MME', libelle: 'MME' }], valeur: l.valeurs?.titre ?? 'M' },
                    t('nomFamille', 'Nom de famille', l.valeurs?.nomFamille),
                    t('nomUsage', 'Nom d’usage', l.valeurs?.nomUsage, true),
                    t('prenoms', 'Prénom(s)', l.valeurs?.prenoms, true),
                    m('pourcentage', '% de détention', l.valeurs?.pourcentage),
                    m('parts', 'Nb de parts ou actions', l.valeurs?.parts),
                    t('naissanceDate', 'Date de naissance (AAAA-MM-JJ)', l.valeurs?.naissanceDate, true),
                    t('naissanceDepartement', 'N° département de naissance', l.valeurs?.naissanceDepartement, true),
                    t('naissanceCommune', 'Commune de naissance', l.valeurs?.naissanceCommune, true),
                    t('naissancePays', 'Pays de naissance', l.valeurs?.naissancePays, true),
                    ...adresse(l.valeurs),
                  ]}
                />
              ) : null}
            </li>
          )} />
      </div>
      <ul className="list-disc pl-5 text-sm text-texte-doux" data-testid="2033-f-non-prepare">
        {f.nonPrepare.map((n) => (
          <li key={n}>Non préparé — {n}</li>
        ))}
      </ul>
    </section>
  );
}

/** Tableau 2033-G (filiales et participations) : saisie ligne par ligne, justifiée et historisée (D-117). */
function Formulaire2033G({ f, fm, exerciceId, revision, evenements, numero = '2033' }: { f: Formulaire2033GProjet; fm: Fm; exerciceId: string; revision: boolean; evenements: EvenementQualification[]; numero?: string }) {
  const badge = (statut: string) => <Etiquette ton={statut === 'saisi' ? 'succes' : 'attention'}>{statut === 'saisi' ? 'Saisi' : statut === 'a_revoir' ? 'À revoir : données modifiées' : 'À saisir'}</Etiquette>;
  const t = (cle: string, libelle: string, valeur: string | undefined, optionnel = false) => ({ cle, libelle, type: 'texte' as const, valeur: valeur ?? '', optionnel });
  return (
    <section className="space-y-4" aria-labelledby="titre-2033-g" data-testid="formulaire-2033-g">
      <SousTitre id="titre-2033-g" className="text-base">
        {numero}-G — Filiales et participations (détention directe d’au moins 10 % du capital) <MentionProjet />
      </SousTitre>
      <Alerte ton="attention" titre="Saisie du cabinet : le portefeuille de titres relève du registre de la société, rien ne se déduit de la balance">
        <p className="text-sm">
          Le nombre total de filiales (case 905) et chaque filiale (sept lignes) se saisissent avec une justification obligatoire, tracée et historisée ; « néant » est une déclaration explicite du tableau. Le formulaire n’énonce aucun calcul : les rapprochements sont indicatifs.
        </p>
        {f.limites.map((l) => (
          <p key={l} className="text-sm">
            {l}
          </p>
        ))}
      </Alerte>
      <ul className="space-y-1" aria-label="Contrôles du 2033-G" data-testid="controles-2033-g">
        {f.controles.map((x) => (
          <li key={x.code}>
            <Etiquette ton={x.statut === 'coherent' ? 'succes' : x.statut === 'ecart' ? 'danger' : 'attention'}>{x.statut === 'coherent' ? 'Cohérent' : x.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette> {x.message}
            {x.ecart ? ` (écart : ${fm(x.ecart)})` : ''}
          </li>
        ))}
      </ul>
      <p className="text-sm" data-testid="etat-2033-g">
        État du tableau : <strong>{f.etat === 'saisi' ? 'saisies présentes' : f.etat === 'neant' ? 'néant déclaré' : 'à saisir (ni saisie ni néant)'}</strong>
        {f.neant ? ` — déclaré le ${formaterHorodatage(f.neant.le)} sur la version ${f.neant.versionDonnees} des données` : ''}. Nombre total de filiales détenues (case {f.nombre.codeCase}) :{' '}
        <strong data-testid="nombre-filiales">{f.nombre.montant !== null ? (f.nombre.neant ? 'néant' : String(Number(f.nombre.montant))) : f.nombre.statut === 'a_revoir' ? 'à revoir' : 'à saisir'}</strong> {badge(f.nombre.statut)}
      </p>
      {revision ? (
        <div className="space-y-2" data-testid="saisie-nombre-2033-g">
          <HistoriqueLigne evenements={evenements} cle="2033G_NB:NB" fm={fm} />
          <SaisieLigneTableau exerciceId={exerciceId} tableau="2033G_NB" ligne="NB" etiquette="le nombre de filiales" saisie={f.nombre.statut !== 'a_saisir'} noteCourante={f.nombre.trace?.note ?? null} champs={[{ cle: 'c905', libelle: 'Nombre total de filiales (905)', type: 'montant', valeur: f.nombre.montant ?? '' }]} />
          <NeantTableau exerciceId={exerciceId} tableau="2033G_NB" declare={f.etat === 'neant'} etiquette="tableau 2033-G (aucune filiale détenue à 10 % ou plus)" />
        </div>
      ) : null}
      <ListeEtatJoint classe="space-y-2" testid="filiales-2033-g" capacite={7} items={f.filiales} rendu={(l) => (
          <li key={l.ligne} className="rounded-lg border border-bordure p-3" data-filiale={l.ligne}>
            <p className="text-sm">
              Filiale {Number(l.ligne)} — {l.statut === 'saisi' ? <strong>{l.valeurs!.denomination}</strong> : badge(l.statut)}
              {l.statut === 'saisi' ? <span className="text-texte-doux"> · {l.valeurs!.formeJuridique} · SIREN {l.valeurs!.siren || 'non applicable'} · {fm(l.valeurs!.pourcentage)} %</span> : null}
            </p>
            {l.trace ? (
              <p className="text-xs text-texte-doux" data-testid={`trace-filiale-${l.ligne}`}>
                saisie le {formaterHorodatage(l.trace.le)} sur la version {l.trace.versionDonnees} des données · « {l.trace.note} »
              </p>
            ) : null}
            <HistoriqueLigne evenements={evenements} cle={`2033G_FIL:${l.ligne}`} fm={fm} />
            {revision ? (
              <SaisieLigneTableau
                exerciceId={exerciceId}
                tableau="2033G_FIL"
                ligne={l.ligne}
                etiquette={`la filiale ${Number(l.ligne)}`}
                saisie={l.statut !== 'a_saisir'}
                noteCourante={l.trace?.note ?? null}
                champs={[
                  t('formeJuridique', 'Forme juridique', l.valeurs?.formeJuridique, true),
                  t('denomination', 'Dénomination', l.valeurs?.denomination),
                  t('siren', 'N° SIREN (si établie en France)', l.valeurs?.siren, true),
                  { cle: 'pourcentage', libelle: '% de détention', type: 'montant', valeur: l.valeurs?.pourcentage ?? '' },
                  t('adresseNumero', 'N°', l.valeurs?.adresseNumero, true),
                  t('adresseVoie', 'Voie', l.valeurs?.adresseVoie, true),
                  t('codePostal', 'Code postal', l.valeurs?.codePostal, true),
                  t('commune', 'Commune', l.valeurs?.commune, true),
                  t('pays', 'Pays', l.valeurs?.pays, true),
                ]}
              />
            ) : null}
          </li>
        )} />
      <ul className="list-disc pl-5 text-sm text-texte-doux" data-testid="2033-g-non-prepare">
        {f.nonPrepare.map((n) => (
          <li key={n}>Non préparé — {n}</li>
        ))}
      </ul>
    </section>
  );
}

function ResultatSigneF({ r, fm, testid }: { r: ResultatSigneFormulaire; fm: Fm; testid: string }) {
  if (r.statut === 'abstention') {
    return (
      <div data-testid={testid} data-statut="abstention">
        <Etiquette ton="attention">Abstention</Etiquette> <span className="text-xs text-texte-doux">(cases {r.codesCases.join(' / ')})</span>
        <ul className="list-disc pl-5 text-sm">
          {r.motifs.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div data-testid={testid} data-statut="etabli" data-sens={r.sens}>
      <strong className="tabular-nums">{fm(r.montant)}</strong> — {r.sens === 'benefice' ? 'bénéfice' : r.sens === 'deficit' ? 'déficit' : 'résultat nul'} <span className="text-xs text-texte-doux">(case {r.codeCase}, lue, vérifiée sur le PDF)</span>
    </div>
  );
}

/** Formulaire du régime réel normal servi par le moteur générique : saisie case par case, calculs énoncés par le formulaire seulement, contrôles indicatifs (D-118). */
function FormulaireCases({ f, fm, exerciceId, revision, evenements }: { f: FormulaireCasesProjet; fm: Fm; exerciceId: string; revision: boolean; evenements: EvenementQualification[] }) {
  const badge = (statut: string) => <Etiquette ton={statut === 'saisi' ? 'succes' : 'attention'}>{statut === 'saisi' ? 'Saisi' : statut === 'a_revoir' ? 'À revoir : données modifiées' : 'À saisir'}</Etiquette>;
  const idHtml = `formulaire-${f.id}`;
  return (
    <section className="space-y-4" aria-labelledby={`titre-${idHtml}`} data-testid={idHtml}>
      <SousTitre id={`titre-${idHtml}`} className="text-base">
        {f.titre} <MentionProjet />
      </SousTitre>
      <Alerte ton="attention" titre="Saisie du cabinet : aucune de ces informations ne se déduit de la balance">
        <p className="text-sm">
          Chaque case se saisit avec une justification obligatoire, tracée et historisée ; « néant » est une déclaration explicite et une case sans saisie n’est jamais présumée nulle. Le logiciel ne calcule que ce que le formulaire énonce, quand toutes les composantes sont saisies ;
          les rapprochements entre un total de ligne et ses composantes sont des contrôles indicatifs, jamais bloquants ni corrigés. Source : {f.source}
        </p>
        {f.limites.map((l) => (
          <p key={l} className="text-sm">
            {l}
          </p>
        ))}
      </Alerte>
      <ul className="space-y-1" aria-label={`Contrôles du ${f.titre}`} data-testid={`controles-${idHtml}`}>
        {f.controles.map((x) => (
          <li key={x.code}>
            <Etiquette ton={x.statut === 'coherent' ? 'succes' : x.statut === 'ecart' ? 'danger' : 'attention'}>{x.statut === 'coherent' ? 'Cohérent' : x.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette> {x.message}
            {x.ecart ? ` (écart : ${fm(x.ecart)})` : ''}
          </li>
        ))}
      </ul>
      {f.groupes.map((g) => (
        <details key={g.id} className="rounded-lg border border-bordure p-3" open={g.id === f.groupes[0]?.id} data-testid={`groupe-${idHtml}-${g.id}`}>
          <summary className="cursor-pointer font-semibold">
            {g.titre} ({f.cases.filter((c) => c.groupe === g.id && c.statut === 'saisi').length} / {f.cases.filter((c) => c.groupe === g.id).length} saisies)
          </summary>
          <ul className="mt-2 space-y-2">
            {f.cases.filter((c) => c.groupe === g.id).map((c) => (
              <li key={c.cle} className="rounded border border-bordure p-2" data-case-f={c.cle}>
                <p className="text-sm">
                  {c.libelle} <span className="text-texte-doux">(case {c.code}, lue, vérifiée sur le PDF)</span> {badge(c.statut)}
                </p>
                {c.precision ? <p className="text-xs text-texte-doux">{c.precision}</p> : null}
                {c.proposition && c.statut !== 'saisi' ? <p className="text-xs text-texte-doux" data-testid={`proposition-f-${c.cle}`}>Proposition : {fm(c.proposition.montant)} ({c.proposition.origine}), non retenue tant qu’elle n’est pas saisie.</p> : null}
                {c.saisie ? (
                  <p className="text-xs text-texte-doux" data-testid={`trace-f-${c.cle}`}>
                    {c.neant ? 'Néant' : fm(c.saisie.montant)} · saisi le {formaterHorodatage(c.saisie.le)} sur la version {c.saisie.versionDonnees} des données · « {c.saisie.note} »
                  </p>
                ) : null}
                <HistoriqueLigne evenements={evenements} cle={c.cle} fm={fm} />
                {revision ? <SaisirRenvoi exerciceId={exerciceId} code={c.cle} proposition={c.proposition?.montant ?? null} saisie={c.saisie ? { montant: c.saisie.montant, note: c.saisie.note } : null} avecNeant /> : null}
              </li>
            ))}
            {f.calculs.filter((k) => k.groupe === g.id).map((k) => (
              <li key={k.code} className="rounded border border-bordure bg-surface-2 p-2" data-calcul-f={k.code}>
                <p className="text-sm">
                  <strong>{k.libelle}</strong> <span className="text-texte-doux">(case {k.code}, calculée)</span>
                </p>
                <CelluleCalc c={{ ...k, codeCase: k.code } as CelluleCalculee2033D} fm={fm} />
              </li>
            ))}
          </ul>
        </details>
      ))}
      {f.imputation ? (
        <div className="space-y-1" data-testid={`imputation-${idHtml}`}>
          <h3 className="font-semibold">Résultat fiscal avant et après imputation des déficits</h3>
          <p className="text-sm">
            Avant imputation : <ResultatSigneF r={f.imputation.avant} fm={fm} testid={`avant-${idHtml}`} />
          </p>
          <p className="text-sm" data-testid={`plafond-${idHtml}`}>
            Plafond d’imputation : {f.imputation.plafond ? <><strong className="tabular-nums">{fm(f.imputation.plafond.montant)}</strong> <span className="text-xs text-texte-doux">{f.imputation.plafond.regle}</span></> : <span className="text-texte-doux">sans objet (pas de bénéfice établi)</span>}
          </p>
          <p className="text-sm">
            Après imputation : <ResultatSigneF r={f.imputation.apres} fm={fm} testid={`apres-${idHtml}`} />
          </p>
        </div>
      ) : null}
      <ul className="list-disc pl-5 text-sm text-texte-doux" data-testid={`non-prepare-${idHtml}`}>
        {f.nonPrepare.map((n) => (
          <li key={n}>Non préparé — {n}</li>
        ))}
      </ul>
    </section>
  );
}

/** Tableau 2059-A (plus et moins-values, régime réel normal) : saisie ligne par ligne, justifiée et historisée (D-121). */
function Formulaire2059A({ f, fm, exerciceId, revision, evenements }: { f: Formulaire2059AProjet; fm: Fm; exerciceId: string; revision: boolean; evenements: EvenementQualification[] }) {
  const badge = (statut: string) => <Etiquette ton={statut === 'saisi' ? 'succes' : 'attention'}>{statut === 'saisi' ? 'Saisi' : statut === 'a_revoir' ? 'À revoir : données modifiées' : 'À saisir'}</Etiquette>;
  const m = (cle: string, valeur: string | undefined, optionnel = true) => ({ cle, libelle: LIBELLES_COLONNES_2059_A[cle] ?? cle, type: 'montant' as const, valeur: valeur ?? '', optionnel });
  const total = (t: Formulaire2059AProjet['cadres']['A']) => (t.statut === 'etabli' ? <strong>{fm(t.montant)}</strong> : <span className="text-texte-doux">abstention : {t.motifs.join(' ')}</span>);
  return (
    <section className="space-y-4" aria-labelledby="titre-2059-a" data-testid="formulaire-2059-a">
      <SousTitre id="titre-2059-a" className="text-base">
        2059-A — Détermination des plus ou moins-values <MentionProjet />
      </SousTitre>
      <Alerte ton="attention" titre="Saisie du cabinet : le détail des cessions ne se déduit pas de la balance et la qualification fiscale n’est jamais décidée par le logiciel">
        <p className="text-sm">
          Chaque cession (lignes 1 à 12) et chaque ligne de la rubrique II (13 à 16, 18 à 20) se saisit avec une justification obligatoire, tracée et historisée. Une case non remplie est une case vide du formulaire, jamais un zéro ; « néant » est une déclaration explicite du tableau.
        </p>
        {f.limites.map((l) => (
          <p key={l} className="text-sm">
            {l}
          </p>
        ))}
      </Alerte>
      <ul className="space-y-1" aria-label="Contrôles du 2059-A" data-testid="controles-2059-a">
        {f.controles.map((x) => (
          <li key={x.code}>
            <Etiquette ton={x.statut === 'coherent' ? 'succes' : x.statut === 'ecart' ? 'danger' : 'attention'}>{x.statut === 'coherent' ? 'Cohérent' : x.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette> {x.message}
            {x.ecart ? ` (écart : ${fm(x.ecart)})` : ''}
          </li>
        ))}
      </ul>
      <p className="text-sm" data-testid="etat-2059-a">
        État du tableau : <strong>{f.etat === 'saisi' ? 'saisies présentes' : f.etat === 'neant' ? 'néant déclaré' : 'à saisir (ni saisie ni néant)'}</strong>
        {f.neant ? ` — déclaré le ${formaterHorodatage(f.neant.le)} sur la version ${f.neant.versionDonnees} des données` : ''}.
      </p>
      <ul className="space-y-1 text-sm" data-testid="cadres-2059-a">
        <li data-cadre="A">Cadre A — plus ou moins-value nette à court terme (total algébrique de la colonne 9) : {total(f.cadres.A)}</li>
        <li data-cadre="B">Cadre B — plus ou moins-value nette à long terme (total algébrique de la colonne 10) : {total(f.cadres.B)}</li>
        {f.cadreBParTaux ? (
          <li data-cadre-taux="B" className="text-sm text-texte-doux">
            dont par taux : 19 % {total(f.cadreBParTaux.c10a)} · 15 % ou 12,80 % {total(f.cadreBParTaux.c10b)} · 0 % {total(f.cadreBParTaux.c10c)}. Ces montants ne sont reportés nulle part : le 2058-A les rapproche, à titre indicatif, de ses lignes WP, WV et WH (la notice dit « voir également »), sans décider de la répartition.
          </li>
        ) : null}
        <li data-cadre="C">Cadre C — autres plus-values taxables à 19 % (colonne 11) : {total(f.cadres.C)}</li>
      </ul>
      {revision ? <NeantTableau exerciceId={exerciceId} tableau="2059A_IM" declare={f.etat === 'neant'} etiquette="tableau 2059-A (aucune cession)" /> : null}
      <h3 className="text-sm font-semibold">I — Immobilisations (lignes 1 à 12)</h3>
      <ul className="space-y-2" data-testid="cessions-2059-a">
        {f.immobilisations.map((l) => (
          <li key={l.ligne} className="rounded-lg border border-bordure p-3" data-cession={l.ligne}>
            <p className="text-sm">
              Ligne {Number(l.ligne)} — {l.statut === 'saisi' ? <strong>{l.nature}</strong> : badge(l.statut)}
              {l.statut === 'saisi' ? <span className="text-texte-doux"> · {Object.entries(l.valeurs!).filter(([k]) => k !== 'nature').map(([k, x]) => `col. ${LIBELLES_COLONNES_2059_A[k] ?? k} : ${fm(x)}`).join(' · ')}</span> : null}
            </p>
            {l.trace ? (
              <p className="text-xs text-texte-doux" data-testid={`trace-cession-${l.ligne}`}>
                saisie le {formaterHorodatage(l.trace.le)} sur la version {l.trace.versionDonnees} des données · « {l.trace.note} »
              </p>
            ) : null}
            <HistoriqueLigne evenements={evenements} cle={`2059A_IM:${l.ligne}`} fm={fm} />
            {revision ? (
              <SaisieLigneTableau
                exerciceId={exerciceId}
                tableau="2059A_IM"
                ligne={l.ligne}
                etiquette={`la cession ${Number(l.ligne)}`}
                saisie={l.statut !== 'a_saisir'}
                noteCourante={l.trace?.note ?? null}
                champs={[{ cle: 'nature', libelle: 'Nature et date d’acquisition (colonne 1)', type: 'texte', valeur: l.nature ?? '' }, ...['c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10a', 'c10b', 'c10c', 'c11'].map((k) => m(k, l.valeurs?.[k]))]}
              />
            ) : null}
          </li>
        ))}
      </ul>
      <h3 className="text-sm font-semibold">II — Autres éléments (lignes 13 à 16 et 18 à 20)</h3>
      <ul className="space-y-2" data-testid="autres-2059-a">
        {f.autres.map((l) => (
          <li key={l.ligne} className="rounded-lg border border-bordure p-3" data-autre={l.ligne}>
            <p className="text-sm">
              Ligne {Number(l.ligne)} — {l.libelle} {badge(l.statut)}
              {l.statut === 'saisi' ? <span className="text-texte-doux"> · {Object.entries(l.valeurs!).map(([k, x]) => `col. ${LIBELLES_COLONNES_2059_A[k] ?? k} : ${fm(x)}`).join(' · ')}</span> : null}
            </p>
            {l.trace ? (
              <p className="text-xs text-texte-doux" data-testid={`trace-autre-${l.ligne}`}>
                saisie le {formaterHorodatage(l.trace.le)} sur la version {l.trace.versionDonnees} des données · « {l.trace.note} »
              </p>
            ) : null}
            <HistoriqueLigne evenements={evenements} cle={`2059A_AUT:${l.ligne}`} fm={fm} />
            {revision ? <SaisieLigneTableau exerciceId={exerciceId} tableau="2059A_AUT" ligne={l.ligne} etiquette={`la ligne ${Number(l.ligne)}`} saisie={l.statut !== 'a_saisir'} noteCourante={l.trace?.note ?? null} champs={l.colonnes.map((k) => m(k, l.valeurs?.[k]))} /> : null}
          </li>
        ))}
      </ul>
      <ul className="list-disc pl-5 text-sm text-texte-doux" data-testid="2059-a-non-prepare">
        {f.nonPrepare.map((n) => (
          <li key={n}>Non préparé — {n}</li>
        ))}
      </ul>
    </section>
  );
}

/** Tableaux 2059-B, 2059-C et 2059-D (grilles) : saisie ligne par ligne, justifiée et historisée (D-122). */
function Grille2059({ g, fm, exerciceId, revision, evenements }: { g: GrilleProjet; fm: Fm; exerciceId: string; revision: boolean; evenements: EvenementQualification[] }) {
  const badge = (statut: string) => <Etiquette ton={statut === 'saisi' ? 'succes' : 'attention'}>{statut === 'saisi' ? 'Saisi' : statut === 'a_revoir' ? 'À revoir : données modifiées' : 'À saisir'}</Etiquette>;
  const cellule = (c: CelluleGrille | undefined) => (c === undefined ? <span className="text-texte-doux">—</span> : c.statut === 'etabli' ? <strong>{fm(c.montant)}</strong> : <span className="text-texte-doux" title={c.motifs.join(' ')}>abstention</span>);
  const id = g.id.toLowerCase();
  return (
    <section className="space-y-4" aria-labelledby={`titre-${id}`} data-testid={`grille-${g.id}`}>
      <SousTitre id={`titre-${id}`} className="text-base">
        {g.id === '2033-E-DATES' ? '2033-E / 2059-E' : g.id} — {g.titre} <MentionProjet />
      </SousTitre>
      <Alerte ton="attention" titre="Saisie du cabinet : rien ne se déduit de la balance, aucune qualification ni imputation n’est décidée par le logiciel">
        {g.limites.map((l) => (
          <p key={l} className="text-sm">
            {l}
          </p>
        ))}
      </Alerte>
      <ul className="space-y-1" aria-label={`Contrôles du ${g.id}`}>
        {g.controles.map((x) => (
          <li key={x.code}>
            <Etiquette ton={x.statut === 'coherent' ? 'succes' : x.statut === 'ecart' ? 'danger' : 'attention'}>{x.statut === 'coherent' ? 'Cohérent' : x.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette> {x.message}
          </li>
        ))}
      </ul>
      <p className="text-sm" data-testid={`etat-${id}`}>
        État du tableau : <strong>{g.etat === 'saisi' ? 'saisies présentes' : g.etat === 'neant' ? 'néant déclaré' : 'à saisir (ni saisie ni néant)'}</strong>
        {g.neant ? ` — déclaré le ${formaterHorodatage(g.neant.le)} sur la version ${g.neant.versionDonnees} des données` : ''}.
      </p>
      {revision && g.neantPossible ? <NeantTableau exerciceId={exerciceId} tableau={g.cadres[0]!.tableau} declare={g.etat === 'neant'} etiquette={`tableau ${g.id} (aucune donnée)`} /> : null}
      {g.cadres.map((c) => (
        <div key={c.tableau} className="space-y-2" data-cadre-grille={c.tableau}>
          <h3 className="text-sm font-semibold">{c.titre}</h3>
          <ul className="space-y-2" data-testid={`lignes-${c.tableau}`}>
            {c.lignes.map((l) => (
              <li key={l.ligne} className="rounded-lg border border-bordure p-3" data-ligne-grille={l.ligne}>
                <p className="text-sm">
                  {l.groupe ? <span className="text-texte-doux">{l.groupe} · </span> : null}
                  {c.libelleOrigine ? `Ligne ${Number(l.ligne)}` : l.libelle} {l.statut === 'saisi' ? null : badge(l.statut)}
                  {l.statut === 'saisi' ? (
                    <span className="text-texte-doux">
                      {l.origine ? ` · ${l.origine}` : ''} · {c.colonnes.filter((k) => l.valeurs && k.cle in l.valeurs).map((k) => `${k.libelle} : ${k.type === 'booleen' ? (l.valeurs![k.cle] === 'oui' ? 'oui' : 'non') : k.type === 'date' || k.type === 'texte' || k.type === 'annee' ? l.valeurs![k.cle] : fm(l.valeurs![k.cle])}`).join(' · ')}
                    </span>
                  ) : null}
                </p>
                {l.calculee ? (
                  <p className="text-xs" data-testid={`calculee-${c.tableau}-${l.ligne}`}>
                    {c.colonneCalculee?.libelle} : {cellule(l.calculee)}
                  </p>
                ) : null}
                {l.trace ? (
                  <p className="text-xs text-texte-doux" data-testid={`trace-${c.tableau}-${l.ligne}`}>
                    saisie le {formaterHorodatage(l.trace.le)} sur la version {l.trace.versionDonnees} des données · « {l.trace.note} »
                  </p>
                ) : null}
                <HistoriqueLigne evenements={evenements} cle={`${c.tableau}:${l.ligne}`} fm={fm} />
                {revision ? (
                  <SaisieLigneTableau
                    exerciceId={exerciceId}
                    tableau={c.tableau}
                    ligne={l.ligne}
                    etiquette={`${c.libelleOrigine ? 'la ligne' : 'la ligne'} ${c.libelleOrigine ? Number(l.ligne) : l.ligne} du ${c.tableau}`}
                    saisie={l.statut !== 'a_saisir'}
                    noteCourante={l.trace?.note ?? null}
                    champs={[...(c.libelleOrigine ? [{ cle: 'origine', libelle: c.libelleOrigine, type: 'texte' as const, valeur: l.origine ?? '' }] : []), ...c.colonnes.filter((k) => l.colonnes.includes(k.cle)).map((k) => ({ cle: k.cle, libelle: k.libelle, type: (k.type === 'booleen' ? 'choix' : k.type === 'date' || k.type === 'texte' || k.type === 'annee' ? 'texte' : 'montant') as 'texte' | 'montant' | 'choix', ...(k.type === 'booleen' ? { options: [{ valeur: 'non', libelle: 'Non' }, { valeur: 'oui', libelle: 'Oui' }] } : {}), valeur: l.valeurs?.[k.cle] ?? '' }))]}
                  />
                ) : null}
              </li>
            ))}
          </ul>
          {c.calculs.length > 0 ? (
            <ul className="space-y-1 text-sm" data-testid={`calculs-${c.tableau}`}>
              {c.calculs.map((k) => (
                <li key={k.id} data-calcul-grille={k.id}>
                  {k.libelle} : {Object.entries(k.cellules).map(([col, cel]) => (
                    <span key={col} className="mr-3">
                      {c.colonnes.find((x) => x.cle === col)?.libelle ?? col} : {cellule(cel)}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
      <ul className="list-disc pl-5 text-sm text-texte-doux" data-testid={`${id}-non-prepare`}>
        {g.nonPrepare.map((n) => (
          <li key={n}>Non préparé — {n}</li>
        ))}
      </ul>
    </section>
  );
}

function Annexe({ a, reponse, exerciceId, revision }: { a: AnnexeProjet; reponse: ReponseAnnexe; exerciceId: string; revision: boolean }) {
  const confirmations = new Map(reponse.confirmations.map((c) => [c.rubrique, c]));
  const requises = a.rubriques.filter((r) => r.requise);
  const confirmees = requises.filter((r) => r.confirmation !== null).length;
  return (
    <div className="space-y-4" data-testid="annexe">
      <Alerte ton={a.complet ? 'succes' : 'attention'} titre={a.complet ? 'Toutes les rubriques requises sont confirmées' : 'Projet d’annexe incomplet'} data-testid="etat-annexe">
        <p>{a.mention}</p>
        <p>
          {confirmees} rubrique{confirmees > 1 ? 's' : ''} requise{confirmees > 1 ? 's' : ''} confirmée{confirmees > 1 ? 's' : ''} sur {requises.length}. Une rubrique n’est complète que si une personne
          habilitée le confirme ; la confirmation ne vaut pas validation des comptes annuels.
        </p>
        {a.reserves.map((r) => (
          <p key={r} className="text-sm">
            {r}
          </p>
        ))}
      </Alerte>
      <Carte className="space-y-2">
        <p>
          Catégorie retenue : <strong>{LIBELLE_CATEGORIE[a.categorie] ?? a.categorie}</strong>. Modèle « {a.modele.id} » version {a.modele.version} ({a.modele.periodeApplication}).
        </p>
        <p className="text-sm text-texte-doux" data-testid="categorie-indicative">
          Catégorie indicative : {reponse.categorieIndicative.categorie ? (LIBELLE_CATEGORIE[String(reponse.categorieIndicative.categorie)] ?? String(reponse.categorieIndicative.categorie)) : 'non déterminable'}.{' '}
          {reponse.categorieIndicative.mention}
        </p>
        {revision ? <CategorieAnnexe exerciceId={exerciceId} actuelle={reponse.categorieDeclaree} /> : null}
      </Carte>
      <ul className="space-y-3">
        {a.rubriques.map((r) => {
          const c = confirmations.get(r.id);
          return (
            <li key={r.id} className="space-y-2 rounded-lg border border-bordure bg-surface p-3" data-rubrique={r.id}>
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.titre}</span>
                <Etiquette ton="vide">{r.reference}</Etiquette>
                {!r.requise ? <Etiquette ton="neutre">Non requise pour cette catégorie</Etiquette> : null}
                {r.confirmation ? (
                  <Etiquette ton="succes">{r.confirmation === 'complete' ? 'Confirmée complète' : 'Confirmée non applicable'}</Etiquette>
                ) : (
                  <Etiquette ton={r.statut === 'pre_rempli' ? 'info' : 'attention'}>{LIBELLE_STATUT_RUBRIQUE[r.statut]}</Etiquette>
                )}
                {c?.aRevoir ? <Etiquette ton="attention">Confirmation à revoir : les données ont changé</Etiquette> : null}
              </p>
              <p className="text-sm text-texte-doux">{r.objet}</p>
              <p className="text-sm">{r.motifStatut}</p>
              {r.preRemplissage.map((t) => (
                <div key={t.titre} className="space-y-1">
                  <Tableau legende={t.titre}>
                    <thead>
                      <tr>
                        <th scope="col">{t.titre}</th>
                        {t.colonnes.map((col) => (
                          <th key={col.cle} scope="col" className="text-right">
                            {col.libelle}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {t.lignes.map((l) => (
                        <tr key={l.libelle} className={l.estTotal ? 'font-semibold' : undefined}>
                          <th scope="row" className="!bg-transparent font-normal">{l.libelle}</th>
                          {t.colonnes.map((col) => (
                            <td key={col.cle} className="text-right tabular-nums">
                              {l.valeurs[col.cle] === null || l.valeurs[col.cle] === undefined ? <span className="text-texte-doux">à saisir</span> : formaterMontant(l.valeurs[col.cle]!)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </Tableau>
                  {t.reserves.map((x) => (
                    <p key={x} className="text-sm text-texte-doux">
                      {x}
                    </p>
                  ))}
                </div>
              ))}
              {r.aSaisir.length ? (
                <div>
                  <p className="text-sm font-medium">À fournir par le cabinet :</p>
                  <ul className="list-disc pl-5 text-sm">
                    {r.aSaisir.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {c?.note ? <p className="text-sm">Information saisie le {formaterHorodatage(c.creeLe)} : {c.note}</p> : null}
              {revision && r.requise ? <ConfirmerRubrique exerciceId={exerciceId} rubrique={r.id} titre={r.titre} confirmation={c && !c.aRevoir ? c.etat : null} note={c?.note ?? null} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default async function PageFiscal({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const ex = await contexteExercice(id, sp.exercice);
  if (!ex.ok) return <ErreurAcces statut={ex.statut} message={ex.message} retour={`/dossiers/${id}`} />;
  if (!ex.exercice) return <Alerte ton="attention">Aucun exercice n’est défini pour ce dossier.</Alerte>;
  const exercice = ex.exercice;
  const vue = parametre(sp.vue) === 'annexe' ? 'annexe' : 'liasse';
  const regime = parametre(sp.regime) === 'reel_simplifie' ? 'reel_simplifie' : 'reel_normal';
  const euros = parametre(sp.montants) === 'euros';
  const fm: Fm = euros ? formaterMontantEuros : (v) => formaterMontant(v);
  const base = `/dossiers/${id}/fiscal?exercice=${exercice.id}`;
  const lienMontants = `${base}&vue=${vue}&regime=${regime}${euros ? '' : '&montants=euros'}`;
  const revision = auMoins(ctx.niveau, 'revision');
  const liasse = vue === 'liasse' ? await tenter<ReponseLiasse>(`v1/exercices/${exercice.id}/liasse?regime=${regime}`) : null;
  const historique = liasse?.ok && liasse.donnees.detailResultat ? await tenter<ReponseHistorique>(`v1/exercices/${exercice.id}/qualifications/historique`) : null;
  const evenements = historique?.ok ? historique.donnees.evenements : [];
  const annexe = vue === 'annexe' ? await tenter<ReponseAnnexe>(`v1/exercices/${exercice.id}/annexe`) : null;
  const reponse = liasse ?? annexe;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ChoixExercice exercices={ex.exercices} courant={exercice.id} />
        <MentionProjet />
      </div>
      <Alerte ton="neutre" className="text-sm" data-testid="avertissement-fiscal">
        Ces états sont des <strong>projets de préparation</strong>, calculés sur les écritures importées, avant écritures d’inventaire. Ils ne constituent ni une liasse fiscale ni des comptes
        annuels, n’ont été validés par aucun professionnel, et Comtaple ne transmet aucune déclaration : la télétransmission n’existe pas dans ce logiciel.
      </Alerte>
      <nav aria-label="États fiscaux">
        <ul className="flex flex-wrap gap-4">
          <li>
            <Link href={`${base}&vue=liasse&regime=reel_normal`} prefetch={false} aria-current={vue === 'liasse' && regime === 'reel_normal' ? 'page' : undefined}>
              Liasse — {LIBELLE_REGIME.reel_normal}
            </Link>
          </li>
          <li>
            <Link href={`${base}&vue=liasse&regime=reel_simplifie`} prefetch={false} aria-current={vue === 'liasse' && regime === 'reel_simplifie' ? 'page' : undefined}>
              Liasse — {LIBELLE_REGIME.reel_simplifie}
            </Link>
          </li>
          {vue === 'liasse' ? (
            <li>
              <Link href={`/dossiers/${id}/fiscal/etat-joint?exercice=${exercice.id}&regime=${regime}`} prefetch={false} data-testid="lien-etat-joint">
                État joint imprimable / exportable
              </Link>
            </li>
          ) : null}
          <li>
            <Link href={`${base}&vue=annexe`} prefetch={false} aria-current={vue === 'annexe' ? 'page' : undefined}>
              Projet d’annexe
            </Link>
          </li>
        </ul>
      </nav>
      {vue === 'liasse' ? (
        <>
          <p className="text-sm text-texte-doux">Le régime d’imposition est un choix du cabinet : Comtaple ne le déduit d’aucun seuil.</p>
          <p className="text-sm" data-testid="choix-montants">
            Montants affichés : <strong>{euros ? 'en euros entiers' : 'au centime'}</strong> —{' '}
            <Link href={lienMontants} prefetch={false}>
              {euros ? 'Afficher les centimes' : 'Afficher en euros entiers (présentation des formulaires)'}
            </Link>
            .{' '}
            {euros ? (
              <span className="text-texte-doux" data-testid="note-arrondi">
                Chaque montant est arrondi à l’euro le plus proche (0,50 compté pour 1), comme l’exigent les notices 2032-NOT-SD et 2033-NOT-SD (millésime 2026). Les montants exacts ne sont pas modifiés ; la somme des montants arrondis peut
                différer d’un euro du total arrondi, l’écart n’est pas corrigé ; la notice ne dit rien des montants négatifs (la demi-unité s’éloigne de zéro, par convention).
              </span>
            ) : null}
          </p>
        </>
      ) : null}
      {reponse && !reponse.ok ? (
        reponse.statut === 409 ? (
          <Alerte ton="attention" data-testid="sans-donnees">
            {reponse.message} Importez des écritures dans l’onglet Comptabilité.
          </Alerte>
        ) : (
          <ErreurAcces statut={reponse.statut} message={reponse.message} retour={`/dossiers/${id}`} />
        )
      ) : null}
      {liasse?.ok ? liasse.donnees.resultat.statut === 'abstention' ? <BlocAbstention a={liasse.donnees.resultat} quoi="Liasse fiscale" /> : <Liasse l={liasse.donnees.resultat} fm={fm} /> : null}
      {liasse?.ok && liasse.donnees.tableauxImmobilisations ? <ImmobilisationsLiasse t={liasse.donnees.tableauxImmobilisations} fm={fm} /> : null}
      {liasse?.ok && liasse.donnees.tableauxImmobilisations && liasse.donnees.tableauxImmobilisations.statut === 'projet' ? <SaisiesImmobilisations t={liasse.donnees.tableauxImmobilisations} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
      {liasse?.ok && liasse.donnees.tableauxSaisis ? (
        liasse.donnees.tableauxSaisis.statut === 'abstention' ? (
          <BlocAbstention a={liasse.donnees.tableauxSaisis} quoi="Cadre III du 2033-C et 2054 bis" />
        ) : (
          <>
            {liasse.donnees.tableauxSaisis.cadreIII ? <CadreIII c={liasse.donnees.tableauxSaisis.cadreIII} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
            {liasse.donnees.tableauxSaisis.amortissementsDerogatoires ? <AmortissementsDerogatoires t={liasse.donnees.tableauxSaisis.amortissementsDerogatoires} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
            {liasse.donnees.tableauxSaisis.chargesRepartiesPlusieursExercices ? <ChargesReparties t={liasse.donnees.tableauxSaisis.chargesRepartiesPlusieursExercices} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
            {liasse.donnees.tableauxSaisis.ecartsReevaluation ? <EcartsReevaluation t={liasse.donnees.tableauxSaisis.ecartsReevaluation} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
          </>
        )
      ) : null}
      {liasse?.ok && liasse.donnees.formulaire2033D ? <Formulaire2033D f={liasse.donnees.formulaire2033D} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
      {liasse?.ok && liasse.donnees.formulaire2033E ? <Formulaire2033E f={liasse.donnees.formulaire2033E} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
      {liasse?.ok && liasse.donnees.formulaire2033F ? <Formulaire2033F numero={regime === 'reel_normal' ? '2059' : '2033'} f={liasse.donnees.formulaire2033F} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
      {liasse?.ok && liasse.donnees.formulaire2033G ? <Formulaire2033G numero={regime === 'reel_normal' ? '2059' : '2033'} f={liasse.donnees.formulaire2033G} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
      {liasse?.ok && liasse.donnees.formulairesCases ? liasse.donnees.formulairesCases.map((f) => <FormulaireCases key={f.id} f={f} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} />) : null}
      {liasse?.ok && liasse.donnees.formulaire2059A ? <Formulaire2059A f={liasse.donnees.formulaire2059A} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
      {liasse?.ok && liasse.donnees.grilles2059 ? liasse.donnees.grilles2059.map((g) => <Grille2059 key={g.id} g={g} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} />) : null}
      {liasse?.ok && liasse.donnees.formulaire2065 && liasse.donnees.identification ? (
        <p className="text-sm" data-testid="identification-2065">
          2065 — identification reprise du dossier (non ressaisie) : <strong>{liasse.donnees.identification.designation}</strong> · SIREN {liasse.donnees.identification.siren ?? 'non renseigné au dossier'} · forme juridique {liasse.donnees.identification.formeJuridique ?? 'non renseignée'} · code NAF {liasse.donnees.identification.codeNaf ?? 'non renseigné'} · exercice du {exercice.debut} au {exercice.fin}.
        </p>
      ) : null}
      {liasse?.ok && liasse.donnees.formulaire2065 ? <Grille2059 g={liasse.donnees.formulaire2065} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
      {liasse?.ok && liasse.donnees.formulaire2057 ? <Grille2059 g={liasse.donnees.formulaire2057} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
      {liasse?.ok && liasse.donnees.detail2053 ? <Grille2059 g={liasse.donnees.detail2053} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
      {liasse?.ok && liasse.donnees.feuilles2058 ? liasse.donnees.feuilles2058.map((g) => <Grille2059 key={g.id} g={g} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} />) : null}
      {liasse?.ok && liasse.donnees.feuilletDeficits ? <Grille2059 g={liasse.donnees.feuilletDeficits} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
      {liasse?.ok && liasse.donnees.formulaire2065Bis ? <Grille2059 g={liasse.donnees.formulaire2065Bis} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
      {liasse?.ok && liasse.donnees.datesCvae ? <Grille2059 g={liasse.donnees.datesCvae} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
      {liasse?.ok && liasse.donnees.detailResultat ? <DetailResultat d={liasse.donnees.detailResultat} fm={fm} exerciceId={exercice.id} revision={revision} evenements={evenements} /> : null}
      {annexe?.ok ? (
        annexe.donnees.resultat.statut === 'abstention' ? (
          <BlocAbstention a={annexe.donnees.resultat} quoi="Projet d’annexe" />
        ) : (
          <Annexe a={annexe.donnees.resultat} reponse={annexe.donnees} exerciceId={exercice.id} revision={revision} />
        )
      ) : null}
    </div>
  );
}
