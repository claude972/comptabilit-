import type { Metadata } from 'next';
import Link from 'next/link';
import { ChoixExercice } from '@/components/dossier';
import { ErreurAcces } from '@/components/erreurs';
import { CategorieAnnexe, ConfirmerRubrique } from '@/components/fiscal/actions';
import { Alerte, Carte, Etiquette, MentionProjet, SousTitre, Tableau } from '@/components/ui/base';
import { type Abstention, type AnnexeProjet, LIBELLE_CATEGORIE, type LiasseProjet, type ReponseAnnexe, type ReponseLiasse } from '@/lib/fiscal';
import { formaterHorodatage, formaterMontant } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { parametre } from '@/lib/serveur/donnees';
import { contexteDossier, contexteExercice } from '@/lib/serveur/dossier';
import { auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'États fiscaux (projets)' };

const LIBELLE_REGIME = { reel_normal: 'Régime réel normal (2050 à 2053)', reel_simplifie: 'Régime simplifié (2033-A et 2033-B)' } as const;
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

function Liasse({ l }: { l: LiasseProjet }) {
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
      <ul className="space-y-1" aria-label="Contrôles de cohérence" data-testid="controles-liasse">
        {l.controles.map((c) => (
          <li key={c.code}>
            <Etiquette ton={c.statut === 'ok' ? 'succes' : c.statut === 'ecart' ? 'danger' : 'attention'}>{c.statut === 'ok' ? 'Cohérent' : c.statut === 'ecart' ? 'Écart' : 'Non vérifiable'}</Etiquette> {c.message}
            {c.ecart ? ` (écart : ${formaterMontant(c.ecart)})` : ''}
          </li>
        ))}
      </ul>
      {l.tableaux.map((t) => {
        const deuxColonnes = t.lignes.some((x) => x.brut !== undefined);
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
                        <td className="text-right tabular-nums">{x.brut !== undefined ? formaterMontant(x.brut) : ''}</td>
                        <td className="text-right tabular-nums">{x.amortissementsDepreciations !== undefined ? formaterMontant(x.amortissementsDepreciations) : ''}</td>
                      </>
                    ) : null}
                    <td className="text-right tabular-nums">{formaterMontant(x.montant)}</td>
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
                Compte {c.compteNum} {c.compteLib} : {formaterMontant(c.solde)}
              </li>
            ))}
            {l.rubriquesNonAffectees.map((r) => (
              <li key={r.code}>
                {r.libelle} : {formaterMontant(r.montant)} — {r.motif}
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
  const base = `/dossiers/${id}/fiscal?exercice=${exercice.id}`;
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
        <p className="text-sm text-texte-doux">Le régime d’imposition est un choix du cabinet : Comtaple ne le déduit d’aucun seuil.</p>
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
      {liasse?.ok ? liasse.donnees.resultat.statut === 'abstention' ? <BlocAbstention a={liasse.donnees.resultat} quoi="Liasse fiscale" /> : <Liasse l={liasse.donnees.resultat} /> : null}
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
