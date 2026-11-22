import type { Metadata } from 'next';
import Link from 'next/link';
import { ChoixExercice } from '@/components/dossier';
import { ErreurAcces } from '@/components/erreurs';
import { CategorieAnnexe, ConfirmerRubrique, NeantTableau, QualifierCompte, SaisieLigneTableau, SaisirRenvoi } from '@/components/fiscal/actions';
import { Alerte, Carte, Etiquette, MentionProjet, SousTitre, Tableau } from '@/components/ui/base';
import { type Abstention, type AnnexeProjet, type CelluleImmobilisation, type CelluleVentilation, type AmortissementsDerogatoiresProjet, type CadreIIIProjet, type CelluleMontantSaisie, type ChargesRepartiesProjet, LIBELLES_COLONNES_2055_B, type DetailResultatProjet, type EcartsReevaluationProjet, type EvenementQualification, LIBELLE_CLASSEMENT, type TableauxSaisisProjet, type ReponseHistorique, type ResultatSigne, LIBELLE_CATEGORIE, LIBELLE_ETAT_QUALIFICATION, type LiasseProjet, type ReponseAnnexe, type ReponseLiasse, type TableauxImmobilisationsProjet } from '@/lib/fiscal';
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
                    <td>{x.codeCase ?? <span className="text-texte-doux">à confirmer</span>}</td>
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
      <span className="block text-xs text-texte-doux">{c.codeCase !== null ? `case ${c.codeCase} (lue, à confirmer)` : ''}</span>
    </td>
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
                      {l.dontComposants ? <span className="block text-sm text-texte-doux">dont composants (case {l.dontComposants.codeCase}) : à saisir</span> : null}
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
          {c.lignes.map((l) => (
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
          <ul className="space-y-3">
            {c.lignes.map((l) => (
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
            ))}
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
