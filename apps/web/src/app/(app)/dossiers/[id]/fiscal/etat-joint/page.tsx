import type { Metadata } from 'next';
import Link from 'next/link';
import { ErreurAcces } from '@/components/erreurs';
import { Alerte } from '@/components/ui/base';
import { csvEtatJoint, etatJointDe } from '@/lib/etat-joint';
import type { ReponseLiasse } from '@/lib/fiscal';
import { formaterHorodatage } from '@/lib/montants';
import { parametre } from '@/lib/serveur/donnees';
import { contexteDossier, contexteExercice } from '@/lib/serveur/dossier';
import { tenter } from '@/lib/serveur/api';

export const metadata: Metadata = { title: 'État joint (projet)' };
export const dynamic = 'force-dynamic';

const REGIMES = { reel_normal: 'Réel normal', reel_simplifie: 'Réel simplifié' } as const;
const LIMITES = [
  'Document de PRÉPARATION au statut PROJET : il reprend les saisies justifiées du cabinet telles qu’elles figurent dans Comtaple, sans recalcul ni déduction.',
  'Ce n’est ni une liasse fiscale, ni un état officiel de l’administration, ni une déclaration : aucune signature, aucune transmission, aucune validation professionnelle.',
  'Une ligne « à saisir » n’est jamais présumée nulle ; un total « abstention » n’a pas de chiffre faute de saisie complète ; les contrôles et rapprochements sont indicatifs.',
  'La disposition de cet état est propre à Comtaple (le formulaire officiel n’impose pas de modèle pour les états joints) ; les montants sont en euros, au centime.',
];

export default async function PageEtatJoint({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const ex = await contexteExercice(id, sp.exercice);
  if (!ex.ok) return <ErreurAcces statut={ex.statut} message={ex.message} retour={`/dossiers/${id}`} />;
  if (!ex.exercice) return <Alerte ton="attention">Aucun exercice n’est défini pour ce dossier.</Alerte>;
  const exercice = ex.exercice;
  const regime = parametre(sp.regime) === 'reel_simplifie' ? 'reel_simplifie' : 'reel_normal';
  const liasse = await tenter<ReponseLiasse>(`v1/exercices/${exercice.id}/liasse?regime=${regime}`);
  if (!liasse.ok) return <ErreurAcces statut={liasse.statut} message={liasse.message} retour={`/dossiers/${id}/fiscal?exercice=${exercice.id}`} />;
  // `?vue=essentiel` : bilan, comptes de résultat, immobilisations et amortissements seulement (D-163) ; sans paramètre, tous les tableaux préparés.
  // `?vue=stocks` : bilan (2050 actif, 2051 passif) et ventilation des stocks seulement (D-174) : grille 2050-STOCKS saisie, cases BN à BS retenues ou en abstention, écarts et justifications.
  const vue = parametre(sp.vue) === 'essentiel' ? 'essentiel' : parametre(sp.vue) === 'stocks' ? 'stocks' : parametre(sp.vue) === 'charges' ? 'charges' : 'complet';
  const essentiel = vue === 'essentiel';
  const stocks = vue === 'stocks';
  // `?vue=charges` : relevé interne des frais à payer seulement (D-175) : saisies justifiées, total, néant éventuel ; relevé propre à Comtaple, non officiel.
  const charges = vue === 'charges';
  const tousTableaux = etatJointDe(liasse.donnees);
  const tableaux = essentiel ? tousTableaux.filter((t) => /^(liasse-|2054\/|2055\/|2033-C\/)/.test(t.id)) : stocks ? tousTableaux.filter((t) => /^(liasse-2050|liasse-2051|liasse-2050-STOCKS-REPRISE)$|^2050-STOCKS\//.test(t.id)) : charges ? tousTableaux.filter((t) => t.id.startsWith('CHARGES-A-PAYER/')) : tousTableaux;
  const perimetre = essentiel ? 'bilan, comptes de résultat, immobilisations et amortissements seulement' : stocks ? 'bilan (2050 actif, 2051 passif) et ventilation des stocks seulement (cases BN à BS)' : charges ? 'relevé interne des frais à payer seulement (non officiel)' : 'tous les tableaux préparés';
  const edition = formaterHorodatage(new Date().toISOString());
  const identification = [
    `Dossier : ${ctx.dossier.raisonSociale}${ctx.dossier.formeJuridique ? ` (${ctx.dossier.formeJuridique})` : ''} — SIREN ${liasse.donnees.identification?.siren ?? 'non renseigné au dossier'}`,
    `Exercice : du ${exercice.debut} au ${exercice.fin} (version ${exercice.versionDonnees} des données)`,
    `Régime : ${REGIMES[regime]}`,
    `Périmètre de cet état : ${perimetre} (${tableaux.length} tableau(x) sur ${tousTableaux.length} préparés)`,
    `Édité le ${edition} — PROJET, non validé`,
  ];
  const csv = csvEtatJoint(tableaux, identification);
  const retour = `/dossiers/${id}/fiscal?exercice=${exercice.id}&vue=liasse&regime=${regime}`;
  return (
    <div className="space-y-4">
      {/* Règles d'impression : feuille de style GLOBALE (`globals.css`, section « État joint »), car la politique de sécurité du contenu (style-src avec nonce) interdit tout <style> en ligne : l'ancienne balise ne s'appliquait pas et le PDF reprenait la navigation de l'application (D-174). */}
      <div className="hors-impression flex flex-wrap items-center gap-4" data-testid="actions-etat-joint">
        <Link href={retour}>← Retour aux états fiscaux</Link>
        <Link href={`/dossiers/${id}/fiscal/etat-joint?exercice=${exercice.id}&regime=${regime === 'reel_normal' ? 'reel_simplifie' : 'reel_normal'}`} prefetch={false}>
          Voir l’état joint du régime {REGIMES[regime === 'reel_normal' ? 'reel_simplifie' : 'reel_normal'].toLowerCase()}
        </Link>
        {vue !== 'complet' ? (
          <Link href={`/dossiers/${id}/fiscal/etat-joint?exercice=${exercice.id}&regime=${regime}`} prefetch={false} data-testid="lien-etat-complet">
            Voir tous les tableaux préparés ({tousTableaux.length})
          </Link>
        ) : null}
        {vue !== 'essentiel' ? (
          <Link href={`/dossiers/${id}/fiscal/etat-joint?exercice=${exercice.id}&regime=${regime}&vue=essentiel`} prefetch={false} data-testid="lien-etat-essentiel">
            Bilan, comptes de résultat et immobilisations seulement
          </Link>
        ) : null}
        {vue !== 'charges' && regime === 'reel_normal' ? (
          <Link href={`/dossiers/${id}/fiscal/etat-joint?exercice=${exercice.id}&regime=${regime}&vue=charges`} prefetch={false} data-testid="lien-etat-charges">
            Relevé des frais à payer
          </Link>
        ) : null}
        {vue !== 'stocks' ? (
          <Link href={`/dossiers/${id}/fiscal/etat-joint?exercice=${exercice.id}&regime=${regime}&vue=stocks`} prefetch={false} data-testid="lien-etat-stocks">
            Bilan et ventilation des stocks
          </Link>
        ) : null}
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download={`etat-joint${vue === 'complet' ? '' : `-${vue}`}-${regime}-${exercice.fin}.csv`} data-testid="export-csv-etat-joint">
          Exporter en CSV
        </a>
        <span className="text-sm text-texte-doux">Pour imprimer ou enregistrer en PDF : Fichier › Imprimer (format A4 paysage, pagination et statut PROJET sur chaque page).</span>
      </div>
      <div id="pied-etat-joint" style={{ display: 'none' }} data-testid="pied-etat-joint">
        PROJET — non validé — aucune signature ni transmission · {ctx.dossier.raisonSociale} · exercice du {exercice.debut} au {exercice.fin}
      </div>
      <div id="etat-joint" data-testid="etat-joint">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th colSpan={99} className="border-b-2 border-black p-1 text-left align-top font-normal">
                <p className="text-base font-bold">ÉTAT JOINT — PROJET (non validé) — {REGIMES[regime]}</p>
                <p data-testid="identification-etat-joint">{identification.join(' · ')}</p>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={99} className="p-1">
                <div className="mb-3 border border-black p-2" data-testid="limites-etat-joint">
                  <p className="font-bold">Statut et limites</p>
                  <ul className="list-disc pl-5">
                    {LIMITES.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                  <p className="mt-1 font-semibold" data-testid="perimetre-etat-joint">
                    Périmètre : {perimetre} ({tableaux.length} tableau(x) sur {tousTableaux.length} préparés). L’état complet reste accessible depuis le lien « Voir tous les tableaux préparés ».
                  </p>
                  <p className="mt-1" data-testid="sommaire-etat-joint">
                    {tableaux.length} tableau(x) : {tableaux.map((t) => t.id).join(', ')}.
                  </p>
                </div>
                {tableaux.map((t) => (
                  <section key={t.id} className="tableau-joint mb-4" data-tableau-joint={t.id}>
                    <h2 className="text-sm font-bold">{t.titre}</h2>
                    <p>État du tableau : {t.etat}</p>
                    <table className="my-1 w-full border-collapse border border-black">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="border border-black p-1 text-left">{t.colonnes[0]}</th>
                          <th className="border border-black p-1 text-left">Statut</th>
                          {t.colonnes.slice(1).map((c) => (
                            <th key={c} className="border border-black p-1 text-left font-semibold">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {t.lignes.map((l, i) => (
                          <tr key={`${l.libelle}-${i}`}>
                            <td className="border border-black p-1">{l.libelle}</td>
                            <td className="border border-black p-1">{l.statut}</td>
                            {l.cellules.map((c, j) => (
                              <td key={j} className="border border-black p-1 text-right tabular-nums">
                                {c}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {t.totaux.map((x) => (
                          <tr key={x.libelle} className="font-bold" data-total-joint>
                            <td className="border border-black p-1" colSpan={2}>
                              TOTAL — {x.libelle}
                            </td>
                            {x.cellules.map((c, j) => (
                              <td key={j} className="border border-black p-1 text-right tabular-nums">
                                {c}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {t.limites.length > 0 ? (
                      <ul className="list-disc pl-5 text-[10px]">
                        {t.limites.map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                ))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
