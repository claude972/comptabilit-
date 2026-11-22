import type { Metadata } from 'next';
import Link from 'next/link';
import { ChoixExercice } from '@/components/dossier';
import { ErreurAcces } from '@/components/erreurs';
import { CategorieAnnexe, ConfirmerRubrique, QualifierCompte, SaisirRenvoi } from '@/components/fiscal/actions';
import { Alerte, Carte, Etiquette, MentionProjet, SousTitre, Tableau } from '@/components/ui/base';
import { type Abstention, type AnnexeProjet, type CelluleImmobilisation, type CelluleVentilation, type DetailResultatProjet, LIBELLE_CATEGORIE, LIBELLE_ETAT_QUALIFICATION, type LiasseProjet, type ReponseAnnexe, type ReponseLiasse, type TableauxImmobilisationsProjet } from '@/lib/fiscal';
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

/** Détail du compte de résultat (D-106) : ventilation France / exportations qualifiée par le cabinet, détail exceptionnel, renvois. */
function DetailResultat({ d, fm, exerciceId, revision }: { d: DetailResultatProjet | Abstention; fm: Fm; exerciceId: string; revision: boolean }) {
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
      {liasse?.ok && liasse.donnees.detailResultat ? <DetailResultat d={liasse.donnees.detailResultat} fm={fm} exerciceId={exercice.id} revision={revision} /> : null}
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
