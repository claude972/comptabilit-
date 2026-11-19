import { CircleCheck, CircleHelp, CircleX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ChoixExercice } from '@/components/dossier';
import { ImportComptable } from '@/components/envoi-ordinateur';
import { ErreurAcces } from '@/components/erreurs';
import { SuiviImport } from '@/components/revision-actions';
import { LienSource } from '@/components/revision-affichage';
import { Alerte, Carte, Etiquette, MentionProjet, SousTitre, Tableau } from '@/components/ui/base';
import { cn } from '@/lib/cn';
import { LIBELLE_STATUT_DONNEES, LIBELLE_STATUT_LOT } from '@/lib/libelles';
import { formaterDate, formaterHorodatage, formaterMontant } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { parametre } from '@/lib/serveur/donnees';
import { contexteDossier, contexteExercice } from '@/lib/serveur/dossier';
import { type LotImport, type RapportFec, auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Comptabilité du dossier' };

/** Page d'anomalies renvoyée par `GET v1/imports/:id/anomalies` (pagination et filtre par code faits par le serveur). */
interface PageAnomalies {
  page: number;
  taillePage: number;
  total: number;
  suite: boolean;
  anomalies: NonNullable<RapportFec['anomalies']>;
}
const GRAVITE_ANOMALIE: Record<string, string> = { bloquante: 'Bloquante', majeure: 'Majeure', mineure: 'Mineure', information: 'Information' };

/** Indicateur à trois états : oui, non, ou non évalué (jamais présenté comme un « oui »). */
function Indicateur({ libelle, valeur, aide }: { libelle: string; valeur: boolean | undefined; aide: string }) {
  const Icone = valeur === true ? CircleCheck : valeur === false ? CircleX : CircleHelp;
  return (
    <div className={cn('rounded-lg border p-3', valeur === true ? 'border-transparent bg-succes-fond text-succes-texte' : valeur === false ? 'border-transparent bg-danger-fond text-danger-texte' : 'border-dashed border-texte-doux')} data-indicateur={libelle} data-valeur={String(valeur)}>
      <p className="flex items-center gap-2 font-semibold">
        <Icone aria-hidden="true" className="size-5 shrink-0" />
        {libelle} : {valeur === true ? 'oui' : valeur === false ? 'non' : 'non évalué'}
      </p>
      <p className="mt-1 text-sm">{aide}</p>
    </div>
  );
}

function Rapport({ lot, base, detail, code }: { lot: LotImport; base: string; detail: PageAnomalies | null; code: string }) {
  const r: RapportFec = lot.rapport ?? {};
  const analyse = typeof r.lisible === 'boolean';
  const parCode = Object.entries(r.nbAnomaliesParCode ?? {}).sort((a, b) => a[0].localeCompare(b[0]));
  const PAR_PAGE = detail?.taillePage ?? 100;
  const totalDetail = detail?.total ?? 0;
  const nbPages = Math.max(1, Math.ceil(totalDetail / PAR_PAGE));
  const courante = detail?.page ?? 1;
  const tranche = detail?.anomalies ?? [];
  const totalAnomalies = parCode.reduce((n, [, v]) => n + (Number.isSafeInteger(v) ? v : 0), 0);
  const lien = (p: number, c = code) => `${base}&lot=${lot.id}&page=${p}${c ? `&code=${encodeURIComponent(c)}` : ''}#anomalies`;

  return (
    <Carte className="space-y-4" data-testid="rapport-import">
      <div className="flex flex-wrap items-center gap-2">
        <SousTitre>Rapport d’import — version {lot.version}</SousTitre>
        <Etiquette ton={lot.statut === 'echec' ? 'danger' : lot.statut === 'termine' ? 'neutre' : 'attention'}>{LIBELLE_STATUT_LOT[lot.statut] ?? lot.statut}</Etiquette>
        {lot.actif ? <Etiquette ton="info">Lot actif</Etiquette> : null}
        <MentionProjet />
      </div>
      <p className="text-sm text-texte-doux">
        {r.nomFichier ? <span className="break-all">Fichier : {r.nomFichier} · </span> : null}
        {lot.statutDonnees ? `${LIBELLE_STATUT_DONNEES[lot.statutDonnees]} · ` : ''}importé le {formaterHorodatage(lot.creeLe)}
      </p>
      {lot.statut === 'en_attente' || lot.statut === 'en_cours' ? <SuiviImport lotId={lot.id} initial={{ statut: lot.statut, progression: lot.progression }} /> : null}
      {r.erreurTechnique ? (
        <Alerte ton="danger" titre="Erreur technique pendant l’import">
          <p className="break-words">{r.erreurTechnique}</p>
        </Alerte>
      ) : null}
      {analyse ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Indicateur libelle="Lisible" valeur={r.lisible} aide="Le fichier a pu être lu et ses lignes normalisées." />
            <Indicateur libelle="Conforme au référentiel contrôlé" valeur={r.conforme} aide="Aucun écart parmi les contrôles de format implémentés. Ce n’est pas une attestation de conformité." />
            <Indicateur libelle="Suffisant pour les travaux" valeur={r.suffisantPourTravaux} aide="Les données minimales sont présentes pour lancer les contrôles de révision." />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
            <dt className="text-texte-doux">Lignes lues</dt>
            <dd>{r.nbLignesLues?.toLocaleString('fr-FR') ?? '—'}</dd>
            <dt className="text-texte-doux">Lignes normalisées</dt>
            <dd>{r.nbLignesNormalisees?.toLocaleString('fr-FR') ?? '—'}</dd>
            <dt className="text-texte-doux">Total débit</dt>
            <dd className="tabular-nums">{formaterMontant(r.totalDebit)}</dd>
            <dt className="text-texte-doux">Total crédit</dt>
            <dd className="tabular-nums">{formaterMontant(r.totalCredit)}</dd>
            <dt className="text-texte-doux">Période des écritures</dt>
            <dd>
              {formaterDate(r.dateMin)} → {formaterDate(r.dateMax)}
            </dd>
            <dt className="text-texte-doux">Encodage / séparateur</dt>
            <dd>
              {r.encodage ?? '—'} / {r.separateur ?? '—'}
            </dd>
          </dl>
          {r.referentiel?.reference ? (
            <details className="rounded-lg border border-bordure p-3 text-sm">
              <summary className="min-h-11 cursor-pointer content-center font-medium">Référentiel contrôlé et limites</summary>
              <p className="mt-2 break-words">{r.referentiel.reference}</p>
              <p className="mt-1">
                <LienSource url={r.referentiel.url} />
              </p>
              <p className="mt-1">
                {r.referentiel.verification === 'verifiee' ? `Source vérifiée le ${formaterDate(r.referentiel.dateVerification)}.` : 'Source non vérifiée.'} {r.referentiel.periodeApplication}
              </p>
              {r.referentiel.controlesImplementes?.length ? (
                <>
                  <p className="mt-2 font-medium">Contrôles implémentés</p>
                  <ul className="list-disc pl-5">
                    {r.referentiel.controlesImplementes.map((c) => (
                      <li key={c.code}>
                        <code>{c.code}</code> — {c.description}
                        {c.ecartAuReferentiel ? ' (écart au référentiel)' : ''}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {r.referentiel.controlesNonImplementes?.length ? (
                <>
                  <p className="mt-2 font-medium">Points du référentiel non contrôlés</p>
                  <ul className="list-disc pl-5">
                    {r.referentiel.controlesNonImplementes.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </details>
          ) : null}

          <section aria-labelledby="titre-anomalies-code" className="space-y-2">
            <SousTitre id="titre-anomalies-code" className="text-base">Anomalies par code ({totalAnomalies.toLocaleString('fr-FR')})</SousTitre>
            {parCode.length ? (
              <Tableau legende="Nombre d’anomalies par code">
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col" className="text-right">Nombre</th>
                  </tr>
                </thead>
                <tbody>
                  {parCode.map(([c, n]) => (
                    <tr key={c}>
                      <td>
                        <Link href={lien(1, c)} prefetch={false} aria-label={`Voir le détail des anomalies ${c}`}>
                          <code>{c}</code>
                        </Link>
                      </td>
                      <td className="text-right tabular-nums">{Number(n).toLocaleString('fr-FR')}</td>
                    </tr>
                  ))}
                </tbody>
              </Tableau>
            ) : (
              <p className="text-texte-doux">Aucune anomalie relevée par les contrôles implémentés.</p>
            )}
          </section>

          {totalDetail ? (
            <section aria-labelledby="titre-anomalies" id="anomalies" className="space-y-2">
              <SousTitre id="titre-anomalies" className="text-base">
                Détail ligne par ligne{code ? ` (${code})` : ''} — {(courante - 1) * PAR_PAGE + 1} à {Math.min(courante * PAR_PAGE, totalDetail)} sur {totalDetail.toLocaleString('fr-FR')}
              </SousTitre>
              {code ? (
                <p className="text-sm">
                  <Link href={lien(1, '')} prefetch={false}>
                    Voir tous les codes
                  </Link>
                </p>
              ) : null}
              {!code && totalDetail < totalAnomalies ? (
                <p className="text-sm text-texte-doux">Le détail conservé par le serveur est plafonné : le décompte complet figure dans le tableau par code.</p>
              ) : null}
              <Tableau legende="Anomalies ligne par ligne">
                <thead>
                  <tr>
                    <th scope="col">Ligne</th>
                    <th scope="col">Colonne</th>
                    <th scope="col">Code</th>
                    <th scope="col">Gravité</th>
                    <th scope="col">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {tranche.map((a, i) => (
                    <tr key={`${courante}-${i}`}>
                      <td className="tabular-nums">{a.ligne ?? '—'}</td>
                      <td>{a.colonne ?? '—'}</td>
                      <td><code>{a.code}</code></td>
                      <td>{GRAVITE_ANOMALIE[a.gravite] ?? a.gravite}</td>
                      <td className="break-words">{a.message}</td>
                    </tr>
                  ))}
                </tbody>
              </Tableau>
              {nbPages > 1 ? (
                <nav aria-label="Pagination des anomalies" className="flex flex-wrap items-center gap-3">
                  {courante > 1 ? <Link href={lien(courante - 1)} prefetch={false} rel="prev">← Précédentes</Link> : <span className="text-texte-doux">← Précédentes</span>}
                  <span>
                    Page {courante} sur {nbPages}
                  </span>
                  {courante < nbPages ? <Link href={lien(courante + 1)} prefetch={false} rel="next">Suivantes →</Link> : <span className="text-texte-doux">Suivantes →</span>}
                </nav>
              ) : null}
            </section>
          ) : null}
        </>
      ) : lot.statut !== 'en_attente' && lot.statut !== 'en_cours' && !r.erreurTechnique ? (
        <Alerte ton="neutre">Aucun rapport d’analyse n’est disponible pour ce lot.</Alerte>
      ) : null}
    </Carte>
  );
}

export default async function PageComptabilite({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const ex = await contexteExercice(id, sp.exercice);
  if (!ex.ok) return <ErreurAcces statut={ex.statut} message={ex.message} retour={`/dossiers/${id}`} />;
  if (!ex.exercice) return <Alerte ton="attention">Aucun exercice n’est défini pour ce dossier : l’import comptable n’est pas possible.</Alerte>;
  const exercice = ex.exercice;
  const lots = await tenter<LotImport[]>(`v1/exercices/${exercice.id}/imports`);
  if (!lots.ok) return <ErreurAcces statut={lots.statut} message={lots.message} retour={`/dossiers/${id}`} />;
  const base = `/dossiers/${id}/comptabilite?exercice=${exercice.id}`;
  const voulu = parametre(sp.lot);
  const choisi = lots.donnees.find((l) => l.id === voulu) ?? lots.donnees.find((l) => l.actif) ?? lots.donnees[0];
  const page = Math.max(1, Number.parseInt(parametre(sp.page) ?? '1', 10) || 1);
  const code = /^[A-Z0-9_]{1,60}$/.test(parametre(sp.code) ?? '') ? parametre(sp.code)! : '';
  const detail = choisi ? await tenter<PageAnomalies>(`v1/imports/${choisi.id}/anomalies?page=${page}${code ? `&code=${code}` : ''}`) : null;

  return (
    <div className="space-y-4">
      <ChoixExercice exercices={ex.exercices} courant={exercice.id} />
      {auMoins(ctx.niveau, 'collaboration') ? (
        <Carte>
          <ImportComptable entiteId={id} exerciceId={exercice.id} cheminRetour={base} />
        </Carte>
      ) : (
        <Alerte ton="neutre">Votre habilitation (lecture) ne permet pas d’importer des écritures.</Alerte>
      )}

      <section aria-labelledby="titre-versions" className="space-y-2">
        <SousTitre id="titre-versions">Historique des versions importées</SousTitre>
        {lots.donnees.length ? (
          <Tableau legende="Versions des lots d’import de l’exercice">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">État</th>
                <th scope="col">Statut des données</th>
                <th scope="col">Fichier</th>
                <th scope="col">Importé le</th>
                <th scope="col">Lignes</th>
                <th scope="col">Rapport</th>
              </tr>
            </thead>
            <tbody>
              {lots.donnees.map((l) => (
                <tr key={l.id} className={cn(l.actif && 'bg-info-fond text-info-texte')} data-lot={l.id} data-actif={l.actif}>
                  <th scope="row" className="!bg-transparent font-semibold">
                    v{l.version} {l.actif ? <Etiquette ton="info" className="ml-1 border-info-texte">Lot actif</Etiquette> : null}
                  </th>
                  <td>{LIBELLE_STATUT_LOT[l.statut] ?? l.statut}</td>
                  <td>{l.statutDonnees ? LIBELLE_STATUT_DONNEES[l.statutDonnees] : '—'}</td>
                  <td className="break-all">{l.rapport?.nomFichier ?? '—'}</td>
                  <td className="whitespace-nowrap">{formaterHorodatage(l.creeLe)}</td>
                  <td className="tabular-nums">{l.progression.toLocaleString('fr-FR')}</td>
                  <td>
                    <Link href={`${base}&lot=${l.id}`} prefetch={false} aria-current={choisi?.id === l.id ? 'true' : undefined} className={cn('text-inherit', choisi?.id === l.id && 'font-semibold')}>
                      {choisi?.id === l.id ? 'Affiché ci-dessous' : 'Voir le rapport'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        ) : (
          <p className="text-texte-doux">Aucune donnée comptable importée pour cet exercice.</p>
        )}
        <p className="text-sm text-texte-doux">Le lot actif est celui sur lequel portent les contrôles de révision. Les versions précédentes sont conservées.</p>
      </section>

      {choisi ? <Rapport lot={choisi} base={base} detail={detail?.ok ? detail.donnees : null} code={code} /> : null}
    </div>
  );
}
