import { CircleAlert, CircleCheck, CircleDashed } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DecisionRapprochement, FormulaireProfilCsv, LancerRapprochement } from '@/components/banque/actions';
import { ChoixExercice } from '@/components/dossier';
import { ImportReleve } from '@/components/envoi-ordinateur';
import { ErreurAcces } from '@/components/erreurs';
import { ActionsImport } from '@/components/imports/actions';
import { TraceAnnulation } from '@/components/imports/affichage';
import { ActualisationPeriodique, SuiviImport } from '@/components/revision-actions';
import { Alerte, Carte, Etiquette, Libelle, MentionProjet, Saisie, SousTitre, Tableau, type Ton } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import {
  type Cadrage, type DernierRapprochement, type EcritureRapprochee, type EtatBanque, LIBELLE_CADRAGE, LIBELLE_FORMAT_RELEVE, LIBELLE_STATUT_PROPOSITION, type MouvementRapproche, type PageMouvements,
  type ReferenceRapprochement, estNul, masquerCompte, sensMouvement, synthesePropositions, syntheseDepuisDecomptes,
} from '@/lib/banque';
import type { MembreDossier } from '@/lib/administration';
import { actionsImport } from '@/lib/imports';
import { LIBELLE_STATUT_LOT } from '@/lib/libelles';
import { TacheIa } from '@/components/assistant/taches';
import { AgregationBancaire, type EtatAgregation } from '@/components/banque/agregation';
import { formaterDate, formaterHorodatage, formaterMontant } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { ServiceFerme } from '@/components/service-ferme';
import { lireSituation, parametre } from '@/lib/serveur/donnees';
import { contexteDossier, contexteExercice } from '@/lib/serveur/dossier';
import { auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Banque du dossier' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const enCours = (s: string) => s === 'en_attente' || s === 'en_cours';

/** Trois rendus distincts : vert plein (cadré), rouge plein (écart), pointillés sans couleur de succès (non vérifiable). */
const CADRAGE: Record<Cadrage, { ton: Ton; Icone: typeof CircleCheck }> = {
  ok: { ton: 'succes', Icone: CircleCheck },
  ecart: { ton: 'danger', Icone: CircleAlert },
  non_verifiable: { ton: 'vide', Icone: CircleDashed },
};
function EtiquetteCadrage({ cadrage, ecart }: { cadrage: Cadrage; ecart: string | null }) {
  const c = CADRAGE[cadrage] ?? CADRAGE.non_verifiable;
  return (
    <Etiquette ton={c.ton} data-cadrage={cadrage} className="whitespace-normal">
      <c.Icone aria-hidden="true" className="size-4 shrink-0" />
      {LIBELLE_CADRAGE[cadrage] ?? 'Non vérifiable'}
      {cadrage === 'ecart' && ecart ? ` : ${formaterMontant(ecart)}` : ''}
    </Etiquette>
  );
}

function Montant({ valeur }: { valeur: string }) {
  const sens = sensMouvement(valeur);
  return (
    <span className="tabular-nums" data-sens={sens}>
      {formaterMontant(valeur)}
      <span className="block text-xs text-texte-doux">{sens === 'encaissement' ? 'encaissement' : sens === 'decaissement' ? 'décaissement' : ''}</span>
    </span>
  );
}

function LigneEcriture({ e }: { e: EcritureRapprochee | undefined }) {
  if (!e) return <li className="text-texte-doux">Écriture non communiquée</li>;
  return (
    <li className="break-words">
      {formaterDate(e.date)} · {e.journal} · pièce {e.piece} — {e.libelle}
      <span className="block tabular-nums text-texte-doux">
        Débit {formaterMontant(e.debit)} · Crédit {formaterMontant(e.credit)}
      </span>
    </li>
  );
}
function LigneMouvement({ m }: { m: MouvementRapproche | undefined }) {
  if (!m) return <li className="text-texte-doux">Mouvement non communiqué</li>;
  return (
    <li className="break-words">
      {formaterDate(m.date)} — {m.libelle}
      <span className="block tabular-nums text-texte-doux">{formaterMontant(m.montant)}</span>
    </li>
  );
}

export default async function PageBanque({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const base = `/dossiers/${id}/banque`;
  const du = DATE.test(parametre(sp.du) ?? '') ? parametre(sp.du)! : '';
  const au = DATE.test(parametre(sp.au) ?? '') ? parametre(sp.au)! : '';
  const page = Math.max(1, Number.parseInt(parametre(sp.page) ?? '1', 10) || 1);
  const filtre = `${du ? `&du=${du}` : ''}${au ? `&au=${au}` : ''}`;
  const [etat, mouvements, ex, reference, membres] = await Promise.all([
    tenter<EtatBanque>(`v1/dossiers/${id}/banque`),
    tenter<PageMouvements>(`v1/dossiers/${id}/banque/mouvements?page=${page}${filtre}`),
    contexteExercice(id, sp.exercice),
    tenter<ReferenceRapprochement>('v1/reference/rapprochement'),
    tenter<MembreDossier[]>(`v1/dossiers/${id}/membres`),
  ]);
  const nomDe = (utilisateurId: string | null | undefined) => (membres.ok && utilisateurId ? (membres.donnees.find((m) => m.utilisateurId === utilisateurId)?.nom ?? null) : null);
  if (!etat.ok) return <ErreurAcces statut={etat.statut} message={etat.message} retour={`/dossiers/${id}`} />;
  const situation = await lireSituation();
  const ferme = situation && !situation.serviceOuvert ? situation.situation : null;
  const collaboration = auMoins(ctx.niveau, 'collaboration');
  const agregation = collaboration ? await tenter<EtatAgregation>(`v1/dossiers/${id}/banque/agregation`) : { ok: false as const };
  const revision = auMoins(ctx.niveau, 'revision');
  const exercice = ex.ok ? ex.exercice : null;
  const pageR = Math.max(1, Number.parseInt(parametre(sp.pageR) ?? '1', 10) || 1);
  const dernier = exercice ? await tenter<DernierRapprochement>(`v1/exercices/${exercice.id}/rapprochements?page=${pageR}`) : null;
  const lienPageR = (p: number) => `${base}?pageR=${p}${page > 1 ? `&page=${page}` : ''}${filtre}${exercice ? `&exercice=${exercice.id}` : ''}#titre-propositions`;
  const regles = reference.ok ? reference.donnees.regles : [];
  const libelleRegle = (regle: string) => regles.find((r) => r.id === regle)?.description ?? null;
  const lienPage = (p: number) => `${base}?page=${p}${filtre}${exercice ? `&exercice=${exercice.id}` : ''}#mouvements`;

  return (
    <div className="space-y-6">
      {ferme ? (
        <ServiceFerme situation={ferme} />
      ) : collaboration ? (
        <Carte className="space-y-4">
          <ImportReleve entiteId={id} />
          {agregation.ok ? <AgregationBancaire entiteId={id} etat={agregation.donnees} /> : null}
        </Carte>
      ) : (
        <Alerte ton="neutre">Votre habilitation (lecture) ne permet pas d’importer un relevé ni de lancer un rapprochement.</Alerte>
      )}

      <section aria-labelledby="titre-imports" className="space-y-2">
        <SousTitre id="titre-imports">Imports de relevés ({etat.donnees.imports.length})</SousTitre>
        {etat.donnees.imports.length === 0 ? <p className="text-texte-doux">Aucun relevé importé pour ce dossier.</p> : null}
        <ul className="space-y-2" data-testid="imports-releves">
          {etat.donnees.imports.map((lot) => {
            const r = lot.rapport ?? {};
            const anomalies = r.anomalies ?? [];
            return (
              <li key={lot.id} className="space-y-2 rounded-lg border border-bordure bg-surface p-3" data-import={lot.id} data-statut={lot.statut}>
                <p className="flex flex-wrap items-center gap-2">
                  <Etiquette ton={lot.statut === 'echec' ? 'danger' : lot.statut === 'termine' ? 'neutre' : lot.statut === 'annule' ? 'vide' : enCours(lot.statut) ? 'info' : 'attention'}>{LIBELLE_STATUT_LOT[lot.statut] ?? lot.statut}</Etiquette>
                  <span className="font-medium break-all">{r.nomFichier ?? 'Fichier sans nom'}</span>
                  {r.format ? <Etiquette>{LIBELLE_FORMAT_RELEVE[r.format] ?? r.format}</Etiquette> : null}
                  <span className="text-sm text-texte-doux">{formaterHorodatage(lot.creeLe)}</span>
                </p>
                {lot.statut === 'annule' ? (
                  <p>
                    <TraceAnnulation lot={lot} nomAuteur={nomDe(lot.annulePar)} />
                    <span className="block text-sm">Les mouvements de ce relevé ne sont plus pris en compte, sauf ceux présents dans un autre relevé actif.</span>
                  </p>
                ) : null}
                {enCours(lot.statut) ? <SuiviImport lotId={lot.id} initial={{ statut: lot.statut, progression: lot.progression }} unite="mouvements lus" /> : null}
                {typeof r.nbMouvements === 'number' ? (
                  <p className="text-sm">
                    {r.nbMouvements.toLocaleString('fr-FR')} mouvement{r.nbMouvements > 1 ? 's' : ''} lu{r.nbMouvements > 1 ? 's' : ''} · {(r.nbNouveaux ?? 0).toLocaleString('fr-FR')} nouveau{(r.nbNouveaux ?? 0) > 1 ? 'x' : ''} ·{' '}
                    {(r.nbDejaConnus ?? 0).toLocaleString('fr-FR')} déjà connu{(r.nbDejaConnus ?? 0) > 1 ? 's' : ''} · {anomalies.length} anomalie{anomalies.length > 1 ? 's' : ''}
                  </p>
                ) : null}
                {r.profilCsv?.origine ? (
                  <p className="text-sm text-texte-doux">Colonnes du CSV : {r.profilCsv.origine === 'confirme' ? 'profil confirmé par un utilisateur' : 'profil reconnu automatiquement, sans ambiguïté'}.</p>
                ) : null}
                {lot.statut === 'echec' ? (
                  <Alerte ton={r.profilAConfirmer ? 'attention' : 'danger'} titre={r.profilAConfirmer ? 'Import en attente de votre confirmation' : 'Échec de l’import'}>
                    <p className="break-words">{r.motif ?? 'Motif non précisé.'}</p>
                    {!r.profilAConfirmer ? <p className="text-sm">Aucun mouvement de ce fichier n’a été enregistré.</p> : null}
                  </Alerte>
                ) : null}
                {anomalies.length ? (
                  <details className="text-sm">
                    <summary className="min-h-11 cursor-pointer content-center">Voir les anomalies ({anomalies.length})</summary>
                    <ul className="list-disc pl-5">
                      {anomalies.slice(0, 50).map((a, i) => (
                        <li key={i} className="break-words">
                          <code>{a.code}</code>
                          {a.rang !== null ? ` (mouvement n° ${a.rang})` : ''} — {a.message}
                        </li>
                      ))}
                    </ul>
                    {anomalies.length > 50 ? <p className="text-texte-doux">Les 50 premières sont affichées.</p> : null}
                  </details>
                ) : null}
                {lot.statut === 'echec' && r.profilAConfirmer && collaboration ? <FormulaireProfilCsv lotId={lot.id} raisons={r.raisons ?? []} /> : null}
                {/* Un CSV en attente de profil se relance par la confirmation du profil, pas par une reprise à l'identique. */}
                <ActionsImport lot={{ id: lot.id, type: 'releve_bancaire', actif: lot.actif ?? false, statut: lot.statut }} actions={actionsImport(lot, ctx.niveau).filter((x) => x !== 'reprendre' || !r.profilAConfirmer)} />
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="titre-releves" className="space-y-2">
        <SousTitre id="titre-releves">Relevés lus ({etat.donnees.releves.length})</SousTitre>
        {etat.donnees.releves.length ? (
          <Tableau legende="Relevés bancaires lus, soldes et cadrage">
            <thead>
              <tr>
                <th scope="col">Compte</th>
                <th scope="col">Période</th>
                <th scope="col" className="text-right">Solde d’ouverture</th>
                <th scope="col" className="text-right">Mouvements</th>
                <th scope="col" className="text-right">Solde de clôture</th>
                <th scope="col">Cadrage</th>
              </tr>
            </thead>
            <tbody>
              {etat.donnees.releves.map((r) => (
                <tr key={r.id} data-releve={r.id}>
                  <th scope="row" className="!bg-transparent font-medium">
                    <span className="font-mono">{masquerCompte(r.iban, r.identifiant)}</span>
                    <span className="block text-sm font-normal text-texte-doux">
                      {LIBELLE_FORMAT_RELEVE[r.format] ?? r.format}
                      {r.devise ? ` · ${r.devise}` : ''}
                    </span>
                  </th>
                  <td>
                    {formaterDate(r.dateOuverture)} → {formaterDate(r.dateCloture)}
                  </td>
                  <td className="text-right tabular-nums">{r.soldeOuverture === null ? <span className="text-texte-doux">Absent du fichier</span> : formaterMontant(r.soldeOuverture)}</td>
                  <td className="text-right tabular-nums">
                    {formaterMontant(r.totalMouvements)}
                    <span className="block text-xs text-texte-doux">{r.nbMouvements.toLocaleString('fr-FR')} mouvements</span>
                  </td>
                  <td className="text-right tabular-nums">{r.soldeCloture === null ? <span className="text-texte-doux">Absent du fichier</span> : formaterMontant(r.soldeCloture)}</td>
                  <td>
                    <EtiquetteCadrage cadrage={r.cadrage} ecart={r.ecart} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        ) : (
          <p className="text-texte-doux">Aucun relevé lu.</p>
        )}
        <p className="text-sm text-texte-doux">
          Cadrage : solde d’ouverture + mouvements comparé au solde de clôture, calculé par le serveur. « Non vérifiable » signifie qu’un solde manque
          dans le fichier : le relevé n’est alors ni cadré ni en écart.
        </p>
      </section>

      <section aria-labelledby="titre-mouvements" id="mouvements" className="space-y-2">
        <SousTitre id="titre-mouvements">Mouvements bancaires ({etat.donnees.nbMouvements.toLocaleString('fr-FR')} au total)</SousTitre>
        <form key={`${du}|${au}`} method="get" className="flex flex-wrap items-end gap-2" aria-label="Filtrer les mouvements par période">
          {exercice ? <input type="hidden" name="exercice" value={exercice.id} /> : null}
          <div>
            <Libelle htmlFor="du">Du</Libelle>
            <Saisie id="du" name="du" type="date" defaultValue={du} />
          </div>
          <div>
            <Libelle htmlFor="au">Au</Libelle>
            <Saisie id="au" name="au" type="date" defaultValue={au} />
          </div>
          <Bouton type="submit" variante="secondaire">
            Filtrer
          </Bouton>
          {du || au ? (
            <Link href={`${base}${exercice ? `?exercice=${exercice.id}` : ''}#mouvements`} prefetch={false} className="inline-flex min-h-11 items-center">
              Toute la période
            </Link>
          ) : null}
        </form>
        {!mouvements.ok ? (
          <Alerte ton="attention">Les mouvements n’ont pas pu être chargés. {mouvements.message}</Alerte>
        ) : mouvements.donnees.mouvements.length ? (
          <>
            <Tableau legende="Mouvements bancaires importés">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Libellé</th>
                  <th scope="col">Référence</th>
                  <th scope="col">Compte</th>
                  <th scope="col" className="text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {mouvements.donnees.mouvements.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap">{formaterDate(m.dateOperation)}</td>
                    <td className="break-words">
                      {m.libelle}
                      {m.contrepartieNom ? <span className="block text-sm text-texte-doux">{m.contrepartieNom}</span> : null}
                    </td>
                    <td className="break-all">{m.referenceBoutEnBout ?? m.referenceBanque ?? '—'}</td>
                    <td className="font-mono">{masquerCompte(m.iban)}</td>
                    <td className="text-right">
                      <Montant valeur={m.montant} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tableau>
            <nav aria-label="Pagination des mouvements" className="flex flex-wrap items-center gap-3">
              {page > 1 ? <Link href={lienPage(page - 1)} prefetch={false} rel="prev">← Précédents</Link> : <span className="text-texte-doux">← Précédents</span>}
              <span>
                Page {mouvements.donnees.page} ({mouvements.donnees.taillePage} par page)
              </span>
              {mouvements.donnees.suite ? <Link href={lienPage(page + 1)} prefetch={false} rel="next">Suivants →</Link> : <span className="text-texte-doux">Suivants →</span>}
            </nav>
          </>
        ) : (
          <p className="text-texte-doux">{du || au || page > 1 ? 'Aucun mouvement sur cette période ou cette page.' : 'Aucun mouvement importé.'}</p>
        )}
      </section>

      <section aria-labelledby="titre-rapprochement" className="space-y-3" id="rapprochement">
        <div className="flex flex-wrap items-center gap-2">
          <SousTitre id="titre-rapprochement">Rapprochement banque ↔ comptabilité</SousTitre>
          <MentionProjet />
        </div>
        <Alerte ton="neutre" data-testid="mention-proposition">
          <strong>Proposition du moteur — valider ne modifie aucune écriture dans votre logiciel comptable.</strong> Une proposition n’est jamais une
          validation : chaque rapprochement reste à valider ou à rejeter par un réviseur.
        </Alerte>
        {!ex.ok ? (
          <Alerte ton="attention">Les exercices du dossier n’ont pas pu être chargés. {ex.message}</Alerte>
        ) : !exercice ? (
          <Alerte ton="attention">Aucun exercice n’est ouvert sur ce dossier : le rapprochement porte sur un exercice.</Alerte>
        ) : (
          <>
            <ChoixExercice exercices={ex.exercices} courant={exercice.id} />
            <p>
              <Link href={`${base}/correspondance?exercice=${exercice.id}`} prefetch={false} data-testid="lien-correspondance">
                Correspondance des comptes de banque (512 ↔ comptes bancaires)
              </Link>
            </p>
            {collaboration && reference.ok ? <LancerRapprochement key={exercice.id} exerciceId={exercice.id} defauts={reference.donnees.parametresParDefaut} /> : null}
            {dernier && !dernier.ok ? <Alerte ton="attention">Le dernier rapprochement n’a pas pu être chargé. {dernier.message}</Alerte> : null}
            {dernier?.ok ? <Rapprochement d={dernier.donnees} regles={regles} libelleRegle={libelleRegle} revision={revision} lienPage={lienPageR} /> : null}
          {revision && dernier?.ok ? (
            <Carte>
              <TacheIa
                bloc="suggestions-rapprochement"
                chemin={`v1/exercices/${exercice.id}/rapprochements/suggestions`}
                titre="Suggestions complémentaires"
                libelleBouton="Demander des suggestions de rapprochement"
                explication="Pour les mouvements et écritures restés sans correspondance : chaque suggestion est vérifiée arithmétiquement par le moteur, et écartée si elle ne tombe pas juste. Exige une IA connectée ; aucune suggestion ne valide un rapprochement."
              />
            </Carte>
          ) : null}

          </>
        )}
      </section>
    </div>
  );
}

function Rapprochement({ d, regles, libelleRegle, revision, lienPage }: { d: DernierRapprochement; regles: ReferenceRapprochement['regles']; libelleRegle: (r: string) => string | null; revision: boolean; lienPage: (p: number) => string }) {
  const e = d.execution;
  if (!e) return <p className="text-texte-doux">Aucun rapprochement n’a encore été lancé pour cet exercice.</p>;
  // Synthèse sur TOUTES les propositions (décomptes du serveur), et non sur la seule page affichée.
  const pg = d.pagination;
  const synthese = pg ? syntheseDepuisDecomptes(pg, regles) : synthesePropositions(d.rapprochements, regles);
  const ambiguites = e.ambiguites ?? [];
  const abandons = e.abandons ?? [];
  const designer = (id: string) => (d.ecritures[id] ? `écriture du ${formaterDate(d.ecritures[id].date)} (${formaterMontant(d.ecritures[id].debit)} / ${formaterMontant(d.ecritures[id].credit)})` : d.mouvements[id] ? `mouvement du ${formaterDate(d.mouvements[id].date)} (${formaterMontant(d.mouvements[id].montant)})` : 'élément non communiqué');
  return (
    <div className="space-y-4">
      {e.obsolete ? (
        <Alerte ton="attention" role="status" titre="Rapprochement obsolète" data-testid="rapprochement-obsolete">
          Les données ont changé : relancez le rapprochement. Tant qu’il n’est pas relancé, aucune proposition ne peut être validée.
        </Alerte>
      ) : null}
      {enCours(e.statut) ? <ActualisationPeriodique libelle="Rapprochement en cours de calcul" /> : null}
      {e.statut === 'echec' ? <Alerte ton="danger" titre="Le rapprochement a échoué">{e.erreur ?? 'Relancez-le ; si l’échec persiste, signalez-le.'}</Alerte> : null}
      <p className="text-sm text-texte-doux">
        Dernier calcul : {LIBELLE_STATUT_LOT[e.statut] ?? e.statut}, lancé le {formaterHorodatage(e.creeLe)} · version des données {e.versionDonnees}.
      </p>
      {e.statut === 'termine' ? (
        <>
          <Carte className="space-y-2" data-testid="synthese-rapprochement">
            <SousTitre className="text-base">Synthèse</SousTitre>
            <ul className="flex flex-wrap gap-2">
              <li><Etiquette ton="info">Propositions : {synthese.total}</Etiquette></li>
              <li><Etiquette>Validées : {synthese.statuts.valide}</Etiquette></li>
              <li><Etiquette>Rejetées : {synthese.statuts.rejete}</Etiquette></li>
              <li><Etiquette ton="attention">Écritures de banque non rapprochées : {d.nonRapproches.nbEcritures}</Etiquette></li>
              <li><Etiquette ton="attention">Mouvements non rapprochés : {d.nonRapproches.nbMouvements}</Etiquette></li>
              <li><Etiquette ton="vide">Ambiguïtés : {ambiguites.length}</Etiquette></li>
              <li><Etiquette ton="vide">Abandons : {abandons.length}</Etiquette></li>
            </ul>
            {synthese.parRegle.length ? (
              <ul className="text-sm">
                {synthese.parRegle.map((r) => (
                  <li key={r.id}>
                    <code>{r.id}</code> ({r.niveau === 'exact' ? 'correspondance exacte' : 'règle'}) : {r.nombre}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-sm">
              Une <strong>ambiguïté</strong> (plusieurs solutions équivalentes) n’est jamais tranchée par le logiciel. Un <strong>abandon</strong> signifie que
              la recherche a été interrompue par une borne de calcul, pas qu’il n’existe aucune solution.
            </p>
          </Carte>

          <section aria-labelledby="titre-propositions" className="space-y-2">
            <SousTitre id="titre-propositions" className="text-base">Propositions ({pg ? pg.total : d.rapprochements.length})</SousTitre>
            {pg && (pg.total > pg.taillePage || pg.page > 1) ? (
              <nav aria-label="Pages de propositions" className="flex flex-wrap items-center gap-3" data-testid="pagination-propositions">
                {pg.page > 1 ? <Link href={lienPage(pg.page - 1)} prefetch={false} rel="prev">← Précédentes</Link> : <span className="text-texte-doux">← Précédentes</span>}
                <span>
                  Page {pg.page} — {d.rapprochements.length} proposition(s) affichée(s) sur {pg.total}
                </span>
                {pg.suite ? <Link href={lienPage(pg.page + 1)} prefetch={false} rel="next">Suivantes →</Link> : <span className="text-texte-doux">Suivantes →</span>}
              </nav>
            ) : null}
            {d.rapprochements.length === 0 ? <p className="text-texte-doux">Aucune proposition.</p> : null}
            <ul className="space-y-3" data-testid="propositions">
              {d.rapprochements.map((p) => (
                <li key={p.id} className="space-y-2 rounded-lg border border-bordure bg-surface p-3" data-proposition={p.id} data-regle={p.regle} data-statut={p.statut}>
                  <p className="flex flex-wrap items-center gap-2">
                    <Etiquette ton={p.statut === 'valide' ? 'succes' : p.statut === 'rejete' ? 'danger' : 'attention'}>{LIBELLE_STATUT_PROPOSITION[p.statut] ?? p.statut}</Etiquette>
                    <code>{p.regle}</code>
                    {!estNul(p.ecart) ? <Etiquette ton="attention">Écart : {formaterMontant(p.ecart)}</Etiquette> : <span className="text-sm text-texte-doux">Sans écart</span>}
                  </p>
                  {libelleRegle(p.regle) ? <p className="text-sm text-texte-doux">{libelleRegle(p.regle)}</p> : null}
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div>
                      <p className="font-medium">Écritures comptables</p>
                      <ul className="space-y-1">
                        {p.cotesEcritures.map((x) => (
                          <LigneEcriture key={x} e={d.ecritures[x]} />
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium">Mouvements bancaires</p>
                      <ul className="space-y-1">
                        {p.cotesMouvements.map((x) => (
                          <LigneMouvement key={x} m={d.mouvements[x]} />
                        ))}
                      </ul>
                    </div>
                  </div>
                  <p className="break-words">{p.explication}</p>
                  <details className="text-sm">
                    <summary className="min-h-11 cursor-pointer content-center">Critères ({p.criteres?.length ?? 0})</summary>
                    <ul className="space-y-1">
                      {(p.criteres ?? []).map((c, i) => (
                        <li key={i} className="break-words">
                          <Etiquette ton={c.satisfait ? 'succes' : 'danger'}>{c.satisfait ? 'Satisfait' : 'Non satisfait'}</Etiquette> {c.critere} : {c.valeurA} ↔ {c.valeurB}
                        </li>
                      ))}
                    </ul>
                  </details>
                  {p.statut === 'rejete' && p.motif ? <p className="text-sm break-words">Motif du rejet : {p.motif}</p> : null}
                  {revision ? <DecisionRapprochement id={p.id} statut={p.statut} obsolete={e.obsolete} /> : null}
                </li>
              ))}
            </ul>
          </section>

          {ambiguites.length ? (
            <section aria-labelledby="titre-ambiguites" className="space-y-1">
              <SousTitre id="titre-ambiguites" className="text-base">Ambiguïtés ({ambiguites.length})</SousTitre>
              <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="ambiguites">
                {ambiguites.slice(0, 100).map((a, i) => (
                  <li key={i} className="break-words">
                    {a.raison} — {a.ids.slice(0, 6).map(designer).join(' ; ')}
                    {a.ids.length > 6 ? ' ; …' : ''} ({a.candidats?.length ?? 0} solutions équivalentes, aucune retenue)
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {abandons.length ? (
            <section aria-labelledby="titre-abandons" className="space-y-1">
              <SousTitre id="titre-abandons" className="text-base">Recherches abandonnées ({abandons.length})</SousTitre>
              <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="abandons">
                {abandons.slice(0, 100).map((a, i) => (
                  <li key={i} className="break-words">
                    {a.raison} ({a.ids.length} élément{a.ids.length > 1 ? 's' : ''} concerné{a.ids.length > 1 ? 's' : ''})
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <section aria-labelledby="titre-sans-mouvement" className="space-y-1" data-testid="ecritures-sans-mouvement">
              <SousTitre id="titre-sans-mouvement" className="text-base">Écritures de banque sans mouvement ({d.nonRapproches.nbEcritures})</SousTitre>
              {d.nonRapproches.nbEcritures > d.nonRapproches.ecritures.length ? (
                <p className="text-sm">Liste tronquée : {d.nonRapproches.ecritures.length} affichées sur {d.nonRapproches.nbEcritures}.</p>
              ) : null}
              <ul className="space-y-1 text-sm">
                {d.nonRapproches.ecritures.map((x) => (
                  <LigneEcriture key={x} e={d.ecritures[x]} />
                ))}
              </ul>
            </section>
            <section aria-labelledby="titre-sans-ecriture" className="space-y-1" data-testid="mouvements-sans-ecriture">
              <SousTitre id="titre-sans-ecriture" className="text-base">Mouvements sans écriture ({d.nonRapproches.nbMouvements})</SousTitre>
              {d.nonRapproches.nbMouvements > d.nonRapproches.mouvements.length ? (
                <p className="text-sm">Liste tronquée : {d.nonRapproches.mouvements.length} affichés sur {d.nonRapproches.nbMouvements}.</p>
              ) : null}
              <ul className="space-y-1 text-sm">
                {d.nonRapproches.mouvements.map((x) => (
                  <LigneMouvement key={x} m={d.mouvements[x]} />
                ))}
              </ul>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
