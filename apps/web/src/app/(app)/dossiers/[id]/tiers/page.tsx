import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChoixExercice } from '@/components/dossier';
import { ErreurAcces } from '@/components/erreurs';
import { DecisionLienFacture, DecisionLienTiers, DecisionSuspicion, ReglageTolerance } from '@/components/tiers/actions';
import { Alerte, Carte, Etiquette, Libelle, Liste, Saisie, SousTitre, Tableau } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { formaterDate, formaterMontant } from '@/lib/montants';
import { type Resultat, tenter } from '@/lib/serveur/api';
import { estUuid, parametre } from '@/lib/serveur/donnees';
import { contexteDossier, contexteExercice } from '@/lib/serveur/dossier';
import {
  type CandidatEcriture, clePieceEnClair, criteresEnClair, type EnteteTiers, type EtatFacture, LIBELLE_ABSTENTION_GROUPE, LIBELLE_COMPTABILISATION, LIBELLE_ETAT, LIBELLE_ORIGINE_TOLERANCE, LIBELLE_MODE, LIBELLE_NATURE_IMPUTATION, LIBELLE_SUSPICION, LIBELLE_TYPE_TIERS,
  type Pagination, type PropositionTiers, type RefEcriture, type ReponseATraiter, type ReponseFacture, type ReponseFactures, type ReponseFicheTiers, type ReponseReglagesTolerance, type ReponseTiers, type ResumeFacture, type Suspicion, TON_ETAT,
} from '@/lib/tiers';
import { auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Tiers et factures' };

const VUES = ['tiers', 'fiche', 'echeancier', 'facture', 'a-traiter', 'reglages'] as const;
type Vue = (typeof VUES)[number];
const ETATS = Object.keys(LIBELLE_ETAT) as EtatFacture[];

/** Clés et références longues : coupées plutôt que de provoquer un débordement horizontal sur petit écran. */
const coupe = 'break-all';

function ecritureEnClair(e: RefEcriture): string {
  return `${e.journalCode} ${e.ecritureNum} du ${formaterDate(e.ecritureDate)} — pièce ${e.pieceRef} — ${formaterMontant(e.montant)} au ${e.sens === 'debit' ? 'débit' : 'crédit'} du ${e.compteNum}${e.compAuxNum ? ` / ${e.compAuxNum}` : ''}${e.lettrage ? ` — lettrage ${e.lettrage}` : ''}`;
}

function EtatFactureEtiquette({ etat }: { etat: EtatFacture }) {
  return <Etiquette ton={TON_ETAT[etat]}>{LIBELLE_ETAT[etat]}</Etiquette>;
}

function Pages({ p, lien, quoi }: { p: Pagination; lien: (page: number) => string; quoi: string }) {
  if (p.total <= p.taillePage) return null;
  return (
    <nav aria-label={`Pages : ${quoi}`} className="flex flex-wrap items-center gap-4 text-sm">
      <span>
        Page {p.page} — {p.total} {quoi}
      </span>
      {p.page > 1 ? (
        <Link href={lien(p.page - 1)} prefetch={false}>
          Page précédente
        </Link>
      ) : null}
      {p.suite ? (
        <Link href={lien(p.page + 1)} prefetch={false}>
          Page suivante
        </Link>
      ) : null}
    </nav>
  );
}

function Entete({ e }: { e: EnteteTiers }) {
  return (
    <div className="space-y-2" data-testid="entete-tiers">
      <p className="text-sm">
        États appréciés au <strong data-testid="date-appreciation">{formaterDate(e.dateAppreciation)}</strong> ({e.origineDateAppreciation === 'cloture_exercice' ? 'clôture de l’exercice' : 'date fournie'}) —{' '}
        {e.donnees ? `écritures importées, version ${e.donnees.version}` : 'aucune écriture importée'}.
      </p>
      {!e.donnees ? (
        <Alerte ton="attention" data-testid="sans-donnees">
          Aucune donnée comptable importée pour cet exercice : aucun tiers comptable, aucun appariement, aucun règlement ne peut être établi. Importez des écritures dans l’onglet Comptabilité.
        </Alerte>
      ) : null}
      <p className="text-sm" data-testid="tolerance-en-vigueur">
        Tolérance de montant : <strong>{formaterMontant(e.tolerance.montant)}</strong> ({LIBELLE_ORIGINE_TOLERANCE[e.tolerance.origine]}).{' '}
        {e.tolerance.origine === 'defaut' ? 'Les montants doivent être strictement égaux.' : 'Un écart dans cette limite n’est jamais appliqué : il est seulement proposé, avec son montant, à confirmer.'}
      </p>
      {e.piecesEcartees.auDelaDuPlafond > 0 ? <Alerte ton="attention">{e.piecesEcartees.auDelaDuPlafond} pièce(s) ne sont pas suivies dans ce calcul (plafond atteint).</Alerte> : null}
    </div>
  );
}

function Refus<T>({ r, id }: { r: Resultat<T>; id: string }) {
  if (r.ok) return null;
  return <ErreurAcces statut={r.statut} message={r.message} retour={`/dossiers/${id}`} />;
}

function TableFactures({ factures, lien, legende }: { factures: ResumeFacture[]; lien: (f: ResumeFacture) => string; legende: string }) {
  return (
    <Tableau legende={legende}>
      <thead>
        <tr>
          <th scope="col">Facture</th>
          <th scope="col">Tiers</th>
          <th scope="col">Échéance</th>
          <th scope="col" className="text-right">Montant TTC</th>
          <th scope="col" className="text-right">Reste dû</th>
          <th scope="col">État</th>
        </tr>
      </thead>
      <tbody>
        {factures.map((f) => (
          <tr key={f.id} data-testid="ligne-facture">
            <th scope="row" className="!bg-transparent font-normal">
              <Link href={lien(f)} prefetch={false} className={coupe}>
                {f.type === 'avoir' ? 'Avoir' : 'Facture'} {f.numero ?? '(numéro non lu)'}
              </Link>
              <span className="block text-sm text-texte-doux">
                {f.sens === 'achat' ? 'Achat' : f.sens === 'vente' ? 'Vente' : 'Sens non déterminable'} — émise le {formaterDate(f.dateEmission)}
                {f.statutExtraction === 'projet' ? ' — extraction non validée' : ''}
              </span>
            </th>
            <td className={coupe}>{f.tiersNom ?? <span className="text-texte-doux">non déterminable</span>}</td>
            <td>
              {f.dateEcheance ? formaterDate(f.dateEcheance) : <span className="text-texte-doux">non déterminable</span>}
              {f.joursDeRetard ? <span className="block text-sm text-texte-doux">{f.joursDeRetard} j de retard</span> : null}
            </td>
            <td className="text-right tabular-nums">{formaterMontant(f.montant)}</td>
            <td className="text-right tabular-nums">{f.resteDu === null ? <span className="text-texte-doux">non déterminable</span> : formaterMontant(f.resteDu)}</td>
            <td>
              <EtatFactureEtiquette etat={f.etat} />
              {f.nbSuspicions > 0 ? (
                <Etiquette ton="danger" className="ml-1">
                  Suspicion
                </Etiquette>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </Tableau>
  );
}

function BlocPropositionTiers({ p, exerciceId, collaboration, revision, lienTiers }: { p: PropositionTiers; exerciceId: string; collaboration: boolean; revision: boolean; lienTiers: (cle: string) => string }) {
  return (
    <li className="space-y-2 rounded-lg border border-bordure p-3" data-testid="proposition-tiers">
      <p className={coupe}>
        <strong>{p.nomPiece ?? clePieceEnClair(p.clePiece)}</strong> ({clePieceEnClair(p.clePiece)}), lu sur {p.documentIds.length} pièce(s){' '}
        <Etiquette ton={p.statut === 'homonymes' ? 'attention' : 'info'}>{p.statut === 'homonymes' ? 'Homonymes : aucun retenu' : 'À confirmer'}</Etiquette>
      </p>
      <p className="text-sm text-texte-doux">Rapprochement proposé par le nom normalisé « {p.nomNormalise} » : un nom identique ne prouve pas qu’il s’agit du même tiers.</p>
      <ul className="space-y-2">
        {p.candidats.map((c) => (
          <li key={c.cle} className="space-y-1">
            <p className={coupe}>
              <Link href={lienTiers(c.cle)} prefetch={false}>
                {c.nom}
              </Link>{' '}
              — compte auxiliaire {c.compteAuxiliaire} ({LIBELLE_TYPE_TIERS[c.type]})
            </p>
            <DecisionLienTiers exerciceId={exerciceId} cleComptable={c.cle} clePiece={p.clePiece} quoi={`${p.nomPiece ?? p.clePiece} et le compte ${c.compteAuxiliaire}`} peutConfirmer={collaboration} peutInfirmer={revision} />
          </li>
        ))}
      </ul>
    </li>
  );
}

function BlocSuspicion({ s, exerciceId, revision, lienFacture }: { s: Suspicion; exerciceId: string; revision: boolean; lienFacture: (id: string) => string }) {
  return (
    <li className="space-y-2 rounded-lg border border-bordure p-3" data-testid="suspicion">
      <p>
        <strong>{s.type === 'ecritures_multiples' ? 'Une même facture portée par plusieurs écritures' : 'Deux pièces distinctes portant la même facture'}</strong>{' '}
        <Etiquette ton={s.statut === 'a_examiner' ? 'attention' : s.statut === 'confirmee' ? 'danger' : 'neutre'}>{LIBELLE_SUSPICION[s.statut]}</Etiquette>
      </p>
      <p className={`text-sm ${coupe}`}>
        Référence {s.reference ?? 'inconnue'} — montant {formaterMontant(s.montant)} — {s.explication}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm" aria-label="Preuves de la suspicion">
        {s.ecritures.map((e) => (
          <li key={e.ligneId} className={coupe}>
            Écriture {ecritureEnClair(e)}
          </li>
        ))}
        {s.documentIds.map((d, i) => (
          <li key={d}>
            <Link href={lienFacture(d)} prefetch={false}>
              Pièce {i + 1} de la suspicion
            </Link>
          </li>
        ))}
      </ul>
      {revision ? <DecisionSuspicion exerciceId={exerciceId} cle={s.cle} quoi={`référence ${s.reference ?? 'inconnue'}`} statut={s.statut} /> : <p className="text-sm text-texte-doux">Statuer sur une suspicion est réservé au niveau révision.</p>}
    </li>
  );
}

function PropositionsEcriture({ propositions, exerciceId, documentId, collaboration, revision }: { propositions: CandidatEcriture[]; exerciceId: string; documentId: string; collaboration: boolean; revision: boolean }) {
  return (
    <ul className="space-y-2" aria-label="Écritures proposées">
      {propositions.map((p) => (
        <li key={p.ecriture.ligneId} className="space-y-1 rounded-lg border border-bordure p-3" data-testid="proposition-ecriture">
          <p className={coupe}>{ecritureEnClair(p.ecriture)}</p>
          <p className="text-sm text-texte-doux">Critères : {criteresEnClair(p.criteres)}.</p>
          <DecisionLienFacture exerciceId={exerciceId} documentId={documentId} type="comptabilisation" cible={p.ecriture.cle} quoi={`écriture ${p.ecriture.journalCode} ${p.ecriture.ecritureNum}`} peutConfirmer={collaboration} peutInfirmer={revision} />
        </li>
      ))}
    </ul>
  );
}

function Definition({ terme, children }: { terme: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="font-medium">{terme} :</dt>
      <dd className={`min-w-0 ${coupe}`}>{children}</dd>
    </div>
  );
}

export default async function PageTiers({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const ex = await contexteExercice(id, sp.exercice);
  if (!ex.ok) return <ErreurAcces statut={ex.statut} message={ex.message} retour={`/dossiers/${id}`} />;
  if (!ex.exercice) return <Alerte ton="attention">Aucun exercice n’est défini pour ce dossier.</Alerte>;
  const exercice = ex.exercice;
  const vueDemandee = parametre(sp.vue);
  const vue: Vue = (VUES as readonly string[]).includes(vueDemandee ?? '') ? (vueDemandee as Vue) : 'tiers';
  const dateBrute = parametre(sp.date);
  const date = dateBrute && /^\d{4}-\d{2}-\d{2}$/.test(dateBrute) ? dateBrute : undefined;
  const page = /^[1-9]\d{0,5}$/.test(parametre(sp.page) ?? '') ? Number(parametre(sp.page)) : 1;
  const q = (parametre(sp.q) ?? '').slice(0, 100);
  const collaboration = auMoins(ctx.niveau, 'collaboration');
  const revision = auMoins(ctx.niveau, 'revision');

  const racine = `/dossiers/${id}/tiers`;
  /** Lien interne à l'onglet : l'exercice et la date d'appréciation suivent toujours. */
  const lien = (v: Vue, extra: Record<string, string | number | undefined> = {}) => {
    const u = new URLSearchParams({ exercice: exercice.id, vue: v });
    if (date) u.set('date', date);
    for (const [k, val] of Object.entries(extra)) if (val !== undefined && val !== '') u.set(k, String(val));
    return `${racine}?${u.toString()}`;
  };
  const api = `v1/exercices/${exercice.id}`;
  const suffixeDate = date ? `&date=${date}` : '';
  const lienFacture = (documentId: string) => lien('facture', { facture: documentId });
  const lienTiers = (cle: string) => lien('fiche', { cle });

  const type = parametre(sp.type);
  const etat = parametre(sp.etat);
  const cle = parametre(sp.cle);
  const factureId = parametre(sp.facture);
  const tiersFiltre = parametre(sp.tiers);

  const liste = vue === 'tiers' ? await tenter<ReponseTiers>(`${api}/tiers?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}${type && type in LIBELLE_TYPE_TIERS ? `&type=${type}` : ''}${suffixeDate}`) : null;
  const fiche = vue === 'fiche' && cle ? await tenter<ReponseFicheTiers>(`${api}/tiers/fiche?cle=${encodeURIComponent(cle)}&page=${page}${suffixeDate}`) : null;
  const echeancier =
    vue === 'echeancier'
      ? await tenter<ReponseFactures>(`${api}/factures?page=${page}${etat && etat in LIBELLE_ETAT ? `&etat=${etat}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}${tiersFiltre ? `&tiers=${encodeURIComponent(tiersFiltre)}` : ''}${suffixeDate}`)
      : null;
  const detail = vue === 'facture' && estUuid(factureId) ? await tenter<ReponseFacture>(`${api}/factures/${factureId}${date ? `?date=${date}` : ''}`) : null;
  const reglages = vue === 'reglages' ? await tenter<ReponseReglagesTolerance>(`v1/dossiers/${id}/tiers-factures/reglages`) : null;
  const aTraiter = vue === 'a-traiter' ? await tenter<ReponseATraiter>(`${api}/tiers-factures/a-traiter${date ? `?date=${date}` : ''}`) : null;

  const sections: Array<{ vue: Vue; libelle: string }> = [
    { vue: 'tiers', libelle: 'Tiers' },
    { vue: 'echeancier', libelle: 'Échéancier des factures' },
    { vue: 'a-traiter', libelle: 'À confirmer et suspicions' },
    { vue: 'reglages', libelle: 'Réglages' },
  ];
  const sectionCourante: Vue = vue === 'fiche' ? 'tiers' : vue === 'facture' ? 'echeancier' : vue;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ChoixExercice exercices={ex.exercices} courant={exercice.id} />
        {/* Date d'appréciation : formulaire GET, fonctionne sans JavaScript ; vide = clôture de l'exercice. */}
        <form method="get" className="flex max-w-full flex-wrap items-end gap-2" aria-label="Date d’appréciation des échéances">
          <input type="hidden" name="exercice" value={exercice.id} />
          <input type="hidden" name="vue" value={sectionCourante} />
          <div>
            <Libelle htmlFor="date-appreciation">Apprécier les échéances au (vide : clôture)</Libelle>
            <Saisie id="date-appreciation" type="date" name="date" defaultValue={date ?? ''} className="min-w-0" />
          </div>
          <Bouton type="submit" variante="secondaire">
            Appliquer la date
          </Bouton>
        </form>
      </div>
      <Alerte ton="neutre" className="text-sm" data-testid="avertissement-tiers">
        <strong>Aide à la révision.</strong> Les tiers, les soldes, les règlements et les restes dus sont recalculés à chaque affichage à partir des écritures importées et des pièces : rien n’est
        comptabilisé ni lettré ici, le logiciel de production comptable reste la référence. Ce que le moteur déduit est un projet tant qu’une personne habilitée ne l’a pas confirmé.
      </Alerte>
      <nav aria-label="Tiers et factures">
        <ul className="flex flex-wrap gap-4">
          {sections.map((s) => (
            <li key={s.vue}>
              <Link href={lien(s.vue)} prefetch={false} aria-current={sectionCourante === s.vue ? 'page' : undefined}>
                {s.libelle}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {liste ? <Refus r={liste} id={id} /> : null}
      {liste?.ok ? (
        <section aria-labelledby="titre-tiers" className="space-y-3">
          <SousTitre id="titre-tiers">Référentiel des tiers ({liste.donnees.pagination.total})</SousTitre>
          <Entete e={liste.donnees} />
          <form method="get" role="search" aria-label="Rechercher un tiers" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="exercice" value={exercice.id} />
            <input type="hidden" name="vue" value="tiers" />
            {date ? <input type="hidden" name="date" value={date} /> : null}
            <div className="min-w-0 flex-1 basis-48">
              <Libelle htmlFor="recherche-tiers">Nom, compte auxiliaire ou identifiant</Libelle>
              <Saisie id="recherche-tiers" type="search" name="q" defaultValue={q} maxLength={100} className="w-full min-w-0" />
            </div>
            <div>
              <Libelle htmlFor="type-tiers">Type</Libelle>
              <Liste id="type-tiers" name="type" defaultValue={type ?? ''}>
                <option value="">Tous</option>
                {Object.entries(LIBELLE_TYPE_TIERS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v} ({liste.donnees.pagination.parType[k] ?? 0})
                  </option>
                ))}
              </Liste>
            </div>
            <Bouton type="submit" variante="secondaire">
              Rechercher un tiers
            </Bouton>
          </form>
          {liste.donnees.nbPropositions > 0 ? (
            <p data-testid="lien-propositions">
              <Link href={lien('a-traiter')} prefetch={false}>
                {liste.donnees.nbPropositions} rapprochement(s) de tiers proposé(s), à confirmer
              </Link>
            </p>
          ) : null}
          {liste.donnees.tiers.length === 0 ? (
            <Alerte ton="neutre" data-testid="aucun-tiers">
              Aucun tiers {q || type ? 'ne correspond à cette recherche' : 'n’a été trouvé dans les écritures ni dans les pièces'}.
            </Alerte>
          ) : (
            <Tableau legende="Tiers du dossier">
              <thead>
                <tr>
                  <th scope="col">Tiers</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="text-right">Débit</th>
                  <th scope="col" className="text-right">Crédit</th>
                  <th scope="col" className="text-right">Solde (débit − crédit)</th>
                  <th scope="col" className="text-right">Pièces</th>
                </tr>
              </thead>
              <tbody>
                {liste.donnees.tiers.map((t) => (
                  <tr key={t.cle} data-testid="ligne-tiers">
                    <th scope="row" className="!bg-transparent font-normal">
                      <Link href={lienTiers(t.cle)} prefetch={false} className={coupe}>
                        {t.nom}
                      </Link>
                      <span className={`block text-sm text-texte-doux ${coupe}`}>
                        {t.origine === 'piece' ? 'Connu des seules pièces, sans compte dans les écritures' : t.sansAuxiliaire ? `Compte ${t.comptesGeneraux.join(', ')} sans compte auxiliaire : détail par tiers indisponible` : `Compte auxiliaire ${t.compteAuxiliaire}`}
                      </span>
                      {t.homonymes.length > 0 ? <Etiquette ton="attention">Homonyme de {t.homonymes.length} autre(s) tiers</Etiquette> : null}
                    </th>
                    <td>{LIBELLE_TYPE_TIERS[t.type]}</td>
                    <td className="text-right tabular-nums">{t.totalDebit === null ? '—' : formaterMontant(t.totalDebit)}</td>
                    <td className="text-right tabular-nums">{t.totalCredit === null ? '—' : formaterMontant(t.totalCredit)}</td>
                    <td className="text-right tabular-nums">{t.solde === null ? <span className="text-texte-doux">aucune écriture</span> : formaterMontant(t.solde)}</td>
                    <td className="text-right tabular-nums">{t.nbPieces ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </Tableau>
          )}
          <Pages p={liste.donnees.pagination} quoi="tiers" lien={(n) => lien('tiers', { page: n, q, type })} />
        </section>
      ) : null}

      {vue === 'fiche' && !cle ? <Alerte ton="attention">Aucun tiers n’est désigné.</Alerte> : null}
      {fiche ? <Refus r={fiche} id={id} /> : null}
      {fiche?.ok ? (
        <section aria-labelledby="titre-fiche" className="space-y-4" data-testid="fiche-tiers">
          <SousTitre id="titre-fiche">
            {fiche.donnees.tiers.nom} <Etiquette ton="info">{LIBELLE_TYPE_TIERS[fiche.donnees.tiers.type]}</Etiquette>
          </SousTitre>
          <Entete e={fiche.donnees} />
          <Carte className="space-y-2">
            <dl className="space-y-1">
              <Definition terme="Origine">{fiche.donnees.tiers.origine === 'comptable' ? `écritures (compte auxiliaire ${fiche.donnees.tiers.compteAuxiliaire ?? 'absent'}, comptes ${fiche.donnees.tiers.comptesGeneraux.join(', ')})` : 'pièces seulement : aucun compte dans les écritures ne lui est rattaché'}</Definition>
              {fiche.donnees.tiers.solde !== null ? (
                <Definition terme="Solde de l’exercice (débit − crédit)">
                  <span data-testid="solde-tiers">{formaterMontant(fiche.donnees.tiers.solde)}</span> — débit {formaterMontant(fiche.donnees.tiers.totalDebit)}, crédit {formaterMontant(fiche.donnees.tiers.totalCredit)}, {fiche.donnees.tiers.nbLignes} ligne(s)
                </Definition>
              ) : null}
              <Definition terme="Reste dû sur les factures suivies">{formaterMontant(fiche.donnees.resteDuTotal)}</Definition>
            </dl>
            {fiche.donnees.tiers.homonymes.length > 0 ? (
              <Alerte ton="attention" data-testid="homonymes">
                Ce nom est aussi celui de {fiche.donnees.tiers.homonymes.length} autre(s) tiers comptable(s) :{' '}
                {fiche.donnees.tiers.homonymes.map((h, i) => (
                  <span key={h}>
                    {i > 0 ? ', ' : ''}
                    <Link href={lienTiers(h)} prefetch={false} className={coupe}>
                      {h.replace(/^aux:/, 'compte ')}
                    </Link>
                  </span>
                ))}
                . Ils ne sont jamais fusionnés.
              </Alerte>
            ) : null}
            <h3 className="font-semibold">Identifiants connus et leur origine</h3>
            {fiche.donnees.tiers.identifiants.length === 0 ? (
              <p className="text-texte-doux">Aucun identifiant (SIREN, TVA) n’est connu pour ce tiers.</p>
            ) : (
              <ul className="list-disc pl-5" data-testid="identifiants">
                {fiche.donnees.tiers.identifiants.map((i) => (
                  <li key={`${i.nature}-${i.valeur}-${i.origine}`} className={coupe}>
                    {i.nature === 'nom' ? 'Nom' : i.nature.toUpperCase()} {i.valeur} — {i.origine === 'piece' ? `lu sur ${i.documentIds.length} pièce(s)` : 'trouvé dans le compte auxiliaire des écritures'}
                  </li>
                ))}
              </ul>
            )}
            {fiche.donnees.tiers.tiersPieces.map((tp) => (
              <div key={tp.cle} className="space-y-1">
                <p className={coupe}>
                  Rattaché à l’émetteur « {tp.nom ?? clePieceEnClair(tp.cle)} » ({clePieceEnClair(tp.cle)}) : {tp.lien === 'identifiant_fort' ? 'par identifiant fort (SIREN)' : 'confirmé par une personne'}.
                </p>
                {revision ? <DecisionLienTiers exerciceId={exercice.id} cleComptable={fiche.donnees.tiers.cle} clePiece={tp.cle} quoi={`${tp.nom ?? tp.cle}`} peutConfirmer={false} peutInfirmer retirable={tp.lien === 'confirme'} /> : null}
              </div>
            ))}
          </Carte>
          {fiche.donnees.propositions.length > 0 ? (
            <div className="space-y-2">
              <h3 className="font-semibold">Rapprochements proposés, à confirmer</h3>
              <ul className="space-y-2">
                {fiche.donnees.propositions.map((p) => (
                  <BlocPropositionTiers key={p.clePiece} p={p} exerciceId={exercice.id} collaboration={collaboration} revision={revision} lienTiers={lienTiers} />
                ))}
              </ul>
            </div>
          ) : null}
          <h3 className="font-semibold">Factures et avoirs rattachés ({fiche.donnees.factures.length})</h3>
          {fiche.donnees.factures.length === 0 ? <p className="text-texte-doux">Aucune pièce suivie n’est rattachée à ce tiers.</p> : <TableFactures factures={fiche.donnees.factures} lien={(f) => lienFacture(f.id)} legende="Factures et avoirs du tiers" />}
          <h3 className="font-semibold">Mouvements de l’exercice ({fiche.donnees.paginationMouvements.total})</h3>
          {fiche.donnees.mouvements.length === 0 ? (
            <p className="text-texte-doux">Aucune écriture pour ce tiers.</p>
          ) : (
            <Tableau legende="Mouvements du tiers tirés des écritures">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Écriture</th>
                  <th scope="col">Libellé</th>
                  <th scope="col" className="text-right">Débit</th>
                  <th scope="col" className="text-right">Crédit</th>
                  <th scope="col">Lettrage</th>
                </tr>
              </thead>
              <tbody>
                {fiche.donnees.mouvements.map((m) => (
                  <tr key={m.id}>
                    <td>{formaterDate(m.date)}</td>
                    <td className={coupe}>
                      {m.journalCode} {m.ecritureNum} — pièce {m.pieceRef}
                    </td>
                    <td className={coupe}>{m.libelle}</td>
                    <td className="text-right tabular-nums">{formaterMontant(m.debit)}</td>
                    <td className="text-right tabular-nums">{formaterMontant(m.credit)}</td>
                    <td>{m.lettrage ?? <span className="text-texte-doux">non lettrée</span>}</td>
                  </tr>
                ))}
              </tbody>
            </Tableau>
          )}
          <Pages p={fiche.donnees.paginationMouvements} quoi="mouvements" lien={(n) => lien('fiche', { cle, page: n })} />
        </section>
      ) : null}

      {echeancier ? <Refus r={echeancier} id={id} /> : null}
      {echeancier?.ok ? (
        <section aria-labelledby="titre-echeancier" className="space-y-3">
          <SousTitre id="titre-echeancier">Échéancier des factures et avoirs ({echeancier.donnees.pagination.total})</SousTitre>
          <Entete e={echeancier.donnees} />
          <form method="get" aria-label="Filtrer l’échéancier" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="exercice" value={exercice.id} />
            <input type="hidden" name="vue" value="echeancier" />
            {date ? <input type="hidden" name="date" value={date} /> : null}
            <div>
              <Libelle htmlFor="etat-facture">État</Libelle>
              <Liste id="etat-facture" name="etat" defaultValue={etat ?? ''} className="min-w-0">
                <option value="">Tous les états</option>
                {ETATS.map((e) => (
                  <option key={e} value={e}>
                    {LIBELLE_ETAT[e]} ({echeancier.donnees.pagination.parEtat[e]?.n ?? 0})
                  </option>
                ))}
              </Liste>
            </div>
            <div className="min-w-0 flex-1 basis-40">
              <Libelle htmlFor="recherche-facture">Numéro, fichier ou tiers</Libelle>
              <Saisie id="recherche-facture" type="search" name="q" defaultValue={q} maxLength={100} className="w-full min-w-0" />
            </div>
            <Bouton type="submit" variante="secondaire">
              Filtrer
            </Bouton>
          </form>
          <ul className="flex flex-wrap gap-2" aria-label="Décomptes par état" data-testid="decomptes-etats">
            {ETATS.filter((e) => echeancier.donnees.pagination.parEtat[e]).map((e) => (
              <li key={e}>
                <Link href={lien('echeancier', { etat: e })} prefetch={false} aria-current={etat === e ? 'true' : undefined}>
                  {LIBELLE_ETAT[e]} : {echeancier.donnees.pagination.parEtat[e]!.n}
                  {/* « Non déterminable » : seul le reste dû CONNU est additionné ; un total nul n'est pas affiché (il se lirait comme « rien n'est dû »). */}
                  {e.startsWith('avoir') || e === 'reglee' ? '' : e === 'non_determinable' ? (echeancier.donnees.pagination.parEtat[e]!.resteDu === '0.00' ? '' : ` — reste dû connu ${formaterMontant(echeancier.donnees.pagination.parEtat[e]!.resteDu)}`) : ` — reste dû ${formaterMontant(echeancier.donnees.pagination.parEtat[e]!.resteDu)}`}
                </Link>
              </li>
            ))}
          </ul>
          {echeancier.donnees.factures.length === 0 ? (
            <Alerte ton="neutre" data-testid="aucune-facture">
              {etat || q ? 'Aucune facture ne correspond à ce filtre.' : 'Aucune facture ni avoir n’est suivi sur cet exercice : déposez des pièces qualifiées « facture d’achat », « facture de vente » ou « avoir » dans l’onglet Pièces.'}
            </Alerte>
          ) : (
            <TableFactures factures={echeancier.donnees.factures} lien={(f) => lienFacture(f.id)} legende="Échéancier des factures et avoirs, triées par échéance" />
          )}
          <Pages p={echeancier.donnees.pagination} quoi="factures" lien={(n) => lien('echeancier', { page: n, etat, q })} />
        </section>
      ) : null}

      {vue === 'facture' && !estUuid(factureId) ? <Alerte ton="attention">Aucune facture n’est désignée.</Alerte> : null}
      {detail ? <Refus r={detail} id={id} /> : null}
      {detail?.ok
        ? (() => {
            const f = detail.donnees.facture;
            const c = f.comptabilisation;
            const lignes = c.ecriture ? (detail.donnees.lignesEcritures[c.ecriture.cle] ?? []) : [];
            return (
              <section aria-labelledby="titre-facture" className="space-y-4" data-testid="detail-facture">
                <SousTitre id="titre-facture">
                  {f.type === 'avoir' ? 'Avoir' : 'Facture'} {f.numero ?? '(numéro non lu)'} <EtatFactureEtiquette etat={f.etat} />
                </SousTitre>
                <Entete e={detail.donnees} />
                {f.motifEtat ? (
                  <Alerte ton="attention" data-testid="motif-etat">
                    {f.motifEtat}
                  </Alerte>
                ) : null}
                {f.reserves.length > 0 ? (
                  <ul className="list-disc pl-5 text-sm" aria-label="Réserves">
                    {f.reserves.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                ) : null}
                <Carte className="space-y-2">
                  <h3 className="font-semibold">Pièce</h3>
                  <dl className="space-y-1">
                    <Definition terme="Fichier">
                      <Link href={`/dossiers/${id}/pieces/${f.id}`} prefetch={false}>
                        {f.nomFichier}
                      </Link>{' '}
                      (version {f.versionPiece}) — extraction version {f.versionExtraction}, {f.statutExtraction === 'valide' ? 'validée par un réviseur' : 'projet non validé'}
                    </Definition>
                    <Definition terme="Sens">{f.sens === 'achat' ? 'Achat' : f.sens === 'vente' ? 'Vente' : 'Non déterminable'}</Definition>
                    <Definition terme="Tiers">
                      {detail.donnees.tiers ? (
                        <Link href={lienTiers(detail.donnees.tiers.cle)} prefetch={false}>
                          {detail.donnees.tiers.nom}
                        </Link>
                      ) : (
                        (f.tiersPiece?.nom ?? 'non déterminable')
                      )}
                      {f.motifTiers ? ` — ${f.motifTiers}` : ''}
                    </Definition>
                    <Definition terme="Émise le">{f.dateEmission ? formaterDate(f.dateEmission) : 'non déterminable'}</Definition>
                    <Definition terme="Échéance">
                      {f.dateEcheance ? formaterDate(f.dateEcheance) : 'non déterminable (non lue sur la pièce, jamais inventée)'}
                      {f.joursDeRetard ? ` — ${f.joursDeRetard} jour(s) de retard à la date d’appréciation` : ''}
                    </Definition>
                    <Definition terme="Montants">
                      HT {formaterMontant(f.totalHt)} — TVA {formaterMontant(f.totalTva)} — TTC {formaterMontant(f.totalTtc)} {f.devise ?? ''}
                    </Definition>
                    <Definition terme="Réglé">{f.montantRegle === null ? 'non déterminable' : formaterMontant(f.montantRegle)}</Definition>
                    <Definition terme="Reste dû">
                      <span data-testid="reste-du">{f.resteDu === null ? 'non déterminable' : formaterMontant(f.resteDu)}</span>
                    </Definition>
                  </dl>
                </Carte>
                <Carte className="space-y-2">
                  <h3 className="font-semibold">
                    Écriture qui la comptabilise <Etiquette ton={c.statut === 'apparie' || c.statut === 'confirme' ? 'succes' : c.statut === 'non_recherche' || c.statut === 'non_trouve' ? 'vide' : 'attention'}>{LIBELLE_COMPTABILISATION[c.statut]}</Etiquette>
                  </h3>
                  {c.motif ? <p>{c.motif}</p> : null}
                  {c.ecriture ? (
                    <>
                      <p className={coupe} data-testid="ecriture-facture">
                        {ecritureEnClair(c.ecriture)}
                      </p>
                      {c.criteres ? <p className="text-sm text-texte-doux">Critères : {criteresEnClair(c.criteres)}.</p> : null}
                      {lignes.length > 0 ? (
                        <Tableau legende="Lignes de l’écriture">
                          <thead>
                            <tr>
                              <th scope="col">Compte</th>
                              <th scope="col">Libellé</th>
                              <th scope="col" className="text-right">Débit</th>
                              <th scope="col" className="text-right">Crédit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lignes.map((l) => (
                              <tr key={l.id}>
                                <td className={coupe}>
                                  {l.compteNum}
                                  {l.compAuxNum ? ` / ${l.compAuxNum}` : ''}
                                </td>
                                <td className={coupe}>{l.libelle}</td>
                                <td className="text-right tabular-nums">{formaterMontant(l.debit)}</td>
                                <td className="text-right tabular-nums">{formaterMontant(l.credit)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </Tableau>
                      ) : null}
                      {revision ? <DecisionLienFacture exerciceId={exercice.id} documentId={f.id} type="comptabilisation" cible={c.ecriture.cle} quoi="l’écriture retenue" peutConfirmer={false} peutInfirmer retirable={c.statut === 'confirme'} /> : null}
                    </>
                  ) : null}
                  {c.propositions.length > 0 ? <PropositionsEcriture propositions={c.propositions} exerciceId={exercice.id} documentId={f.id} collaboration={collaboration} revision={revision} /> : null}
                </Carte>
                <Carte className="space-y-2">
                  <h3 className="font-semibold">Règlements et avoirs identifiés ({f.imputations.length})</h3>
                  {f.imputations.length === 0 ? <p className="text-texte-doux">Aucun règlement identifié.</p> : null}
                  <ul className="space-y-2" data-testid="imputations">
                    {f.imputations.map((i) => (
                      <li key={i.ecriture.ligneId} className="space-y-1 rounded-lg border border-bordure p-3">
                        <p className={coupe}>
                          <strong>{LIBELLE_NATURE_IMPUTATION[i.nature]}</strong> — {ecritureEnClair(i.ecriture)}
                        </p>
                        <p className="text-sm">
                          Montant imputé à cette facture : {i.montant === null ? 'non déterminable (écriture partagée entre plusieurs factures)' : formaterMontant(i.montant)} — identifié par : {LIBELLE_MODE[i.mode]}
                          {i.partage ? ' — règlement groupé' : ''}
                          {i.convention ? ' — réparti par ordre chronologique (convention)' : ''}
                          {i.comptee ? '' : ' — postérieur à la date d’appréciation : non compté'}
                        </p>
                        <p className="text-sm">
                          {i.banque.statut === 'valide' ? (
                            <>
                              <Etiquette ton="succes">Rapprochement bancaire validé</Etiquette>{' '}
                              {i.banque.mouvements.map((m) => `${formaterDate(m.date)} ${formaterMontant(m.montant)} ${m.libelle}`).join(' ; ')}
                            </>
                          ) : i.nature === 'reglement' ? (
                            <Etiquette ton="vide">Aucun rapprochement bancaire validé</Etiquette>
                          ) : null}
                        </p>
                        {i.avoirDocumentId ? (
                          <p className="text-sm">
                            <Link href={lienFacture(i.avoirDocumentId)} prefetch={false}>
                              Voir la pièce de l’avoir
                            </Link>
                          </p>
                        ) : null}
                        {i.mode !== 'lettrage' && revision ? (
                          <DecisionLienFacture exerciceId={exercice.id} documentId={f.id} type="imputation" cible={i.ecriture.cle} quoi={`écriture ${i.ecriture.journalCode} ${i.ecriture.ecritureNum}`} peutConfirmer={false} peutInfirmer retirable={i.mode === 'confirmation'} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {f.imputeSur.length > 0 ? (
                    <ul className="list-disc pl-5" aria-label="Factures sur lesquelles l’avoir est imputé">
                      {f.imputeSur.map((x) => (
                        <li key={x.factureId}>
                          <Link href={lienFacture(x.factureId)} prefetch={false}>
                            Imputé sur une facture
                          </Link>{' '}
                          pour {x.montant === null ? 'un montant non déterminable' : formaterMontant(x.montant)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {f.propositionsImputation.length > 0 ? (
                    <>
                      <h4 className="font-medium">Règlements proposés, à confirmer (non comptés)</h4>
                      <ul className="space-y-2" data-testid="propositions-imputation">
                        {f.propositionsImputation.map((p) => (
                          <li key={p.ecriture.ligneId} className="space-y-1 rounded-lg border border-bordure p-3">
                            <p className={coupe}>
                              <strong>{LIBELLE_NATURE_IMPUTATION[p.nature]}</strong> — {ecritureEnClair(p.ecriture)}
                            </p>
                            <p className="text-sm text-texte-doux">
                              {p.critere === 'montant_exact'
                                ? 'Même montant que le reste dû, sans référence à la facture.'
                                : p.critere === 'avoir_meme_tiers'
                                  ? 'Avoir du même tiers, non lettré.'
                                  : p.critere === 'ecart_tolere'
                                    ? `Écart de ${formaterMontant(p.ecart ?? null)} avec le reste dû, dans la tolérance réglée de ${formaterMontant(p.tolerance ?? null)} (règlement ${p.ecart?.startsWith('-') ? 'inférieur' : 'supérieur'} au reste dû). Proposition seulement : confirmée, elle laisse l’écart visible dans le reste dû.`
                                    : p.critere === 'reglement_groupe_probable'
                                      ? `Règlement groupé probable : son montant égale la somme exacte du reste dû de ${p.groupeDocumentIds?.length ?? 'plusieurs'} factures ouvertes de ce tiers. À confirmer facture par facture.`
                                      : 'Écriture citant plusieurs factures sans en égaler la somme.'}
                              {p.ambigue ? ' Plusieurs rapprochements sont possibles : aucun n’est retenu.' : ''}
                            </p>
                            <DecisionLienFacture exerciceId={exercice.id} documentId={f.id} type="imputation" cible={p.ecriture.cle} quoi={`écriture ${p.ecriture.journalCode} ${p.ecriture.ecritureNum}`} peutConfirmer={collaboration} peutInfirmer={revision} />
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </Carte>
                {detail.donnees.suspicions.length > 0 ? (
                  <div className="space-y-2">
                    <h3 className="font-semibold">Suspicion de double comptabilisation</h3>
                    <ul className="space-y-2">
                      {detail.donnees.suspicions.map((s) => (
                        <BlocSuspicion key={s.cle} s={s} exerciceId={exercice.id} revision={revision} lienFacture={lienFacture} />
                      ))}
                    </ul>
                  </div>
                ) : null}
                <Carte className="space-y-2">
                  <h3 className="font-semibold">Preuves</h3>
                  <dl className="space-y-1" data-testid="preuves">
                    {f.preuves.map((p) => (
                      <Definition key={p.libelle} terme={p.libelle}>
                        {p.valeur}
                      </Definition>
                    ))}
                  </dl>
                  {detail.donnees.decisions.length > 0 ? (
                    <ul className="list-disc pl-5 text-sm" aria-label="Décisions enregistrées">
                      {detail.donnees.decisions.map((d) => (
                        <li key={`${d.type}-${d.cible}`} className={coupe}>
                          {d.type === 'comptabilisation' ? 'Écriture' : 'Règlement'} {d.cible.replace('|', ' ')} : {d.decision === 'confirme' ? 'confirmé' : 'infirmé'} par {d.auteur}
                          {d.motif ? ` — ${d.motif}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Carte>
              </section>
            );
          })()
        : null}

      {reglages ? <Refus r={reglages} id={id} /> : null}
      {reglages?.ok ? (
        <section className="space-y-4" aria-labelledby="titre-reglages" data-testid="reglages-tolerance">
          <h2 id="titre-reglages" className="text-lg font-semibold">
            Tolérance de montant de l’appariement facture ↔ règlement
          </h2>
          <p className="text-sm text-texte-doux">{reglages.donnees.note}</p>
          <p data-testid="tolerance-courante">
            En vigueur : <strong>{formaterMontant(reglages.donnees.enVigueur.montant)}</strong> ({LIBELLE_ORIGINE_TOLERANCE[reglages.donnees.enVigueur.origine]}).
          </p>
          {revision ? (
            <ReglageTolerance dossierId={id} actuelle={reglages.donnees.enVigueur.origine === 'defaut' ? '0.00' : reglages.donnees.enVigueur.montant} maximum={reglages.donnees.maximum} />
          ) : (
            <Alerte ton="neutre">Régler la tolérance est réservé au niveau « révision » sur ce dossier.</Alerte>
          )}
          {[
            { titre: 'Historique du dossier', lignes: reglages.donnees.historiqueDossier },
            { titre: 'Historique du cabinet', lignes: reglages.donnees.historiqueCabinet },
          ].map((h) => (
            <div key={h.titre} className="space-y-1">
              <h3 className="font-semibold">{h.titre}</h3>
              {h.lignes.length === 0 ? (
                <p className="text-texte-doux">Aucun réglage.</p>
              ) : (
                <ul className="list-disc pl-5">
                  {h.lignes.map((l) => (
                    <li key={l.id} className={coupe}>
                      {formaterMontant(l.toleranceMontant)} — {formaterDate(l.creeLe)} — {l.auteur} — {l.motif}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      ) : null}
      {aTraiter ? <Refus r={aTraiter} id={id} /> : null}
      {aTraiter?.ok ? (
        <section aria-labelledby="titre-a-traiter" className="space-y-4">
          <SousTitre id="titre-a-traiter">À confirmer et suspicions</SousTitre>
          <Entete e={aTraiter.donnees} />
          <h3 className="font-semibold" id="titre-suspicions">
            Suspicions de double comptabilisation ({aTraiter.donnees.totaux.suspicions}, dont {aTraiter.donnees.totaux.suspicionsAExaminer} à examiner)
          </h3>
          <p className="text-sm text-texte-doux">
            Une même facture (même tiers, même numéro, même montant) portée par plusieurs écritures, ou deux pièces distinctes portant la même facture. Ce n’est ni un doublon binaire (le même fichier
            reçu deux fois), ni une nouvelle version d’une pièce.
          </p>
          {aTraiter.donnees.suspicions.length === 0 ? (
            <p className="text-texte-doux" data-testid="aucune-suspicion">
              Aucune suspicion relevée sur les données actuelles.
            </p>
          ) : (
            <ul className="space-y-2" aria-labelledby="titre-suspicions">
              {aTraiter.donnees.suspicions.map((s) => (
                <BlocSuspicion key={s.cle} s={s} exerciceId={exercice.id} revision={revision} lienFacture={lienFacture} />
              ))}
            </ul>
          )}
          <h3 className="font-semibold">Rapprochements de tiers proposés ({aTraiter.donnees.totaux.propositionsTiers})</h3>
          {aTraiter.donnees.propositionsTiers.length === 0 ? (
            <p className="text-texte-doux">Aucun rapprochement de tiers à confirmer.</p>
          ) : (
            <ul className="space-y-2">
              {aTraiter.donnees.propositionsTiers.map((p) => (
                <BlocPropositionTiers key={p.clePiece} p={p} exerciceId={exercice.id} collaboration={collaboration} revision={revision} lienTiers={lienTiers} />
              ))}
            </ul>
          )}
          <h3 className="font-semibold">Liens pièce ↔ écriture à confirmer ({aTraiter.donnees.totaux.liensAConfirmer})</h3>
          {aTraiter.donnees.liensAConfirmer.length === 0 ? (
            <p className="text-texte-doux">Aucun lien à confirmer.</p>
          ) : (
            <ul className="space-y-3">
              {aTraiter.donnees.liensAConfirmer.map((f) => (
                <li key={f.id} className="space-y-2 rounded-lg border border-bordure p-3" data-testid="lien-a-confirmer">
                  <p className={coupe}>
                    <Link href={lienFacture(f.id)} prefetch={false}>
                      {f.type === 'avoir' ? 'Avoir' : 'Facture'} {f.numero ?? '(numéro non lu)'}
                    </Link>{' '}
                    — {formaterMontant(f.montant)} — {f.tiersNom ?? 'tiers non déterminable'} <Etiquette ton="attention">{LIBELLE_COMPTABILISATION[f.comptabilisation]}</Etiquette>
                  </p>
                  {f.motif ? <p className="text-sm text-texte-doux">{f.motif}</p> : null}
                  <PropositionsEcriture propositions={f.propositions} exerciceId={exercice.id} documentId={f.id} collaboration={collaboration} revision={revision} />
                </li>
              ))}
            </ul>
          )}
          <h3 className="font-semibold">Règlements proposés ({aTraiter.donnees.totaux.reglementsProposes})</h3>
          {aTraiter.donnees.reglementsProposes.length === 0 ? (
            <p className="text-texte-doux">Aucun règlement proposé.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5">
              {aTraiter.donnees.reglementsProposes.map((f) => (
                <li key={f.id} className={coupe}>
                  <Link href={lienFacture(f.id)} prefetch={false}>
                    {f.type === 'avoir' ? 'Avoir' : 'Facture'} {f.numero ?? '(numéro non lu)'}
                  </Link>{' '}
                  — reste dû {formaterMontant(f.resteDu)} — {f.propositions.length} écriture(s) proposée(s)
                </li>
              ))}
            </ul>
          )}
          <h3 className="font-semibold">Règlements groupés probables ({aTraiter.donnees.totaux.reglementsGroupesProbables})</h3>
          {aTraiter.donnees.reglementsGroupesProbables.length === 0 ? (
            <p className="text-texte-doux">Aucun règlement groupé probable.</p>
          ) : (
            <ul className="space-y-2" data-testid="reglements-groupes">
              {aTraiter.donnees.reglementsGroupesProbables.map((g) => (
                <li key={g.ecriture.ligneId} className="space-y-1 rounded-lg border border-bordure p-3">
                  <p className={coupe}>
                    <strong>Règlement groupé probable</strong> <Etiquette ton="attention">À confirmer</Etiquette> — {ecritureEnClair(g.ecriture)}
                  </p>
                  <p className="text-sm text-texte-doux">{g.explication}</p>
                  <ul className="list-disc pl-5">
                    {g.factures.map((f) => (
                      <li key={f.documentId} className={coupe}>
                        <Link href={lienFacture(f.documentId)} prefetch={false}>
                          Facture {f.numero ?? '(numéro non lu)'}
                        </Link>{' '}
                        — reste dû {formaterMontant(f.resteDu)}
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm">Somme exacte : {formaterMontant(g.somme)}. Rien n’est lettré ni imputé : ouvrez chaque facture pour confirmer ce règlement.</p>
                </li>
              ))}
            </ul>
          )}
          {aTraiter.donnees.abstentionsReglementsGroupes.length > 0 ? (
            <div className="space-y-1" data-testid="abstentions-groupes">
              <h4 className="font-medium">Règlements non lettrés sans proposition de groupe ({aTraiter.donnees.totaux.abstentionsReglementsGroupes})</h4>
              <ul className="list-disc pl-5">
                {aTraiter.donnees.abstentionsReglementsGroupes.map((a) => (
                  <li key={a.ecriture.ligneId} className={coupe}>
                    {ecritureEnClair(a.ecriture)} — {LIBELLE_ABSTENTION_GROUPE[a.motif]}.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {aTraiter.donnees.decisionsARevoir.length > 0 ? (
            <Alerte ton="attention" titre={`Décisions à revoir (${aTraiter.donnees.totaux.decisionsARevoir})`} data-testid="decisions-a-revoir">
              <p>Ces décisions ne sont plus appliquées : la pièce, son extraction ou les écritures ont changé depuis.</p>
              <ul className="list-disc pl-5">
                {aTraiter.donnees.decisionsARevoir.map((d) => (
                  <li key={`${d.type}-${d.objet}-${d.cible}`} className={coupe}>
                    {d.type === 'tiers' ? 'Tiers' : d.type === 'suspicion' ? 'Suspicion' : d.type === 'comptabilisation' ? 'Lien pièce ↔ écriture' : 'Règlement'} ({d.cible.replace('|', ' ')}) : {d.motif}
                  </li>
                ))}
              </ul>
            </Alerte>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
