import type { Metadata } from 'next';
import Link from 'next/link';
import { ErreurAcces } from '@/components/erreurs';
import { Alerte, Carte, Libelle, Saisie, SousTitre, Tableau, Titre } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { DEVENIR_EXTRACTIONS, type IndicateursCabinet, LIBELLE_METHODE_EXTRACTION, LIBELLE_STATUT_RAPPROCHEMENT, LIBELLE_TYPE_IMPORT, MENTIONS_INDICATEURS, MENTION_DELAI, dateValide, decouperCleImport, entrees, formaterDelaiHeures } from '@/lib/indicateurs-cabinet';
import { LIBELLE_CANAL, LIBELLE_GRAVITE, LIBELLE_STATUT_CONTROLE, LIBELLE_STATUT_DOCUMENT, LIBELLE_STATUT_LOT, LIBELLE_STATUT_REVUE } from '@/lib/libelles';
import { type Prestation, formaterMinutes } from '@/lib/missions';
import { formaterDate } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { parametre } from '@/lib/serveur/donnees';
import { accesMessagerie } from '@/lib/serveur/messagerie';

export const metadata: Metadata = { title: 'Indicateurs du cabinet' };

const nombre = (n: number | undefined | null) => (typeof n === 'number' ? n.toLocaleString('fr-FR') : '—');

function Decomptes({ titre, donnees, libelles, id }: { titre: string; donnees: Record<string, number> | undefined; libelles?: Record<string, string>; id: string }) {
  const lignes = entrees(donnees);
  return (
    <div data-testid={id}>
      <p className="font-medium">{titre}</p>
      {lignes.length === 0 ? (
        <p className="text-texte-doux">Aucune donnée.</p>
      ) : (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
          {lignes.map(([cle, n]) => (
            <div key={cle} className="contents" data-cle={cle}>
              <dt className="break-words">{libelles?.[cle] ?? cle}</dt>
              <dd className="text-right tabular-nums">{nombre(n)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export default async function PageIndicateursCabinet({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const acces = await accesMessagerie();
  if (!acces.ok) return <ErreurAcces statut={acces.statut} message={acces.statut === 403 ? 'Les indicateurs du cabinet sont réservés aux administrateurs et associés.' : acces.message} />;
  const sp = await searchParams;
  const du = dateValide(parametre(sp.du));
  const au = dateValide(parametre(sp.au));
  const requete = new URLSearchParams({ ...(du ? { du } : {}), ...(au ? { au } : {}) }).toString();
  const [r, prestations] = await Promise.all([tenter<IndicateursCabinet>(`v1/cabinet/indicateurs${requete ? `?${requete}` : ''}`), tenter<Prestation[]>('v1/reference/prestations')]);
  if (!r.ok && r.statut !== 400) return <ErreurAcces statut={r.statut} message={r.message} retour="/administration" />;
  const libellePrestation = Object.fromEntries((prestations.ok ? prestations.donnees : []).map((p) => [p.code, p.libelle]));
  const d = r.ok ? r.donnees : null;

  return (
    <div className="space-y-6">
      <p>
        <Link href="/administration" prefetch={false}>
          ← Retour à l’administration
        </Link>
      </p>
      <Titre>Indicateurs du cabinet</Titre>
      <Alerte ton="neutre" data-testid="mentions-indicateurs">
        <ul className="list-disc pl-5">
          {MENTIONS_INDICATEURS.map((m) => (
            <li key={m}>
              <strong>{m}</strong>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-sm">Décomptes agrégés par cabinet et par dossier ; ils ne donnent pas accès au contenu des dossiers où vous n’êtes pas habilité.</p>
      </Alerte>

      <form key={`${du ?? ''}|${au ?? ''}`} method="get" className="flex flex-wrap items-end gap-2" aria-label="Période des indicateurs">
        <div>
          <Libelle htmlFor="du">Du</Libelle>
          <Saisie id="du" name="du" type="date" defaultValue={d?.periode.du ?? du ?? ''} />
        </div>
        <div>
          <Libelle htmlFor="au">Au</Libelle>
          <Saisie id="au" name="au" type="date" defaultValue={d?.periode.au ?? au ?? ''} />
        </div>
        <Bouton type="submit" variante="secondaire">
          Afficher
        </Bouton>
      </form>

      {!r.ok ? (
        <Alerte ton="attention" role="alert" data-testid="periode-invalide">
          {r.message}
        </Alerte>
      ) : d ? (
        <>
          <p data-testid="periode">
            Période : du {formaterDate(d.periode.du)} au {formaterDate(d.periode.au)}. Les décomptes de constats, de contrôles et de rapprochements portent sur l’état courant (dernières exécutions non obsolètes), quelle que soit la période.
          </p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Carte className="space-y-3" data-testid="bloc-pieces">
              <SousTitre>Pièces et canaux</SousTitre>
              <p>
                Pièces reçues : <strong className="tabular-nums" data-testid="pieces-recues">{nombre(d.pieces?.recues)}</strong> · doublons binaires reçus : <span className="tabular-nums">{nombre(d.pieces?.doublonsBinaires)}</span>
              </p>
              <Decomptes titre="Par statut" donnees={d.pieces?.parStatut} libelles={LIBELLE_STATUT_DOCUMENT} id="pieces-par-statut" />
              <Decomptes titre="Réceptions par canal" donnees={d.pieces?.receptionsParCanal} libelles={LIBELLE_CANAL} id="receptions-par-canal" />
              <div data-testid="delai-traitement">
                <p className="font-medium">Délai de traitement médian</p>
                <p className="tabular-nums">{formaterDelaiHeures(d.pieces?.delaiTraitementMedianHeures)}</p>
                <p className="text-sm text-texte-doux">{MENTION_DELAI}</p>
              </div>
            </Carte>

            <Carte className="space-y-3" data-testid="bloc-extractions">
              <SousTitre>Devenir des extractions automatiques</SousTitre>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
                {DEVENIR_EXTRACTIONS.map((x) => (
                  <div key={x.cle} className="contents" data-devenir={x.cle}>
                    <dt>{x.libelle}</dt>
                    <dd className="text-right tabular-nums">{nombre(d.extractions?.[x.cle])}</dd>
                  </div>
                ))}
              </dl>
              <Decomptes titre="Extractions actuelles par méthode" donnees={d.extractions?.parMethode} libelles={LIBELLE_METHODE_EXTRACTION} id="extractions-par-methode" />
              <p className="text-sm text-texte-doux">Une extraction « acceptée sans correction » n’est pas pour autant exacte : aucun corpus de référence ne permet de mesurer la qualité.</p>
            </Carte>

            <Carte className="space-y-3" data-testid="bloc-imports">
              <SousTitre>Imports</SousTitre>
              <p>
                Lignes d’écriture importées : <strong className="tabular-nums">{nombre(d.imports?.lignesEcritureImportees)}</strong>
              </p>
              <div data-testid="imports-par-type">
                {entrees(d.imports?.parTypeEtStatut).length === 0 ? <p className="text-texte-doux">Aucun import sur la période.</p> : null}
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
                  {entrees(d.imports?.parTypeEtStatut).map(([cle, n]) => {
                    const c = decouperCleImport(cle);
                    return (
                      <div key={cle} className="contents" data-cle={cle}>
                        <dt>
                          {LIBELLE_TYPE_IMPORT[c.type] ?? c.type} — {(LIBELLE_STATUT_LOT as Record<string, string>)[c.statut] ?? c.statut}
                        </dt>
                        <dd className="text-right tabular-nums">{nombre(n)}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            </Carte>

            <Carte className="space-y-3" data-testid="bloc-constats">
              <SousTitre>Constats et contrôles</SousTitre>
              <p>
                Constats « à revoir » (données modifiées depuis la décision) : <span className="tabular-nums">{nombre(d.constats?.aRevoir)}</span>
              </p>
              <Decomptes titre="Constats par statut de revue" donnees={d.constats?.parStatutDeRevue} libelles={LIBELLE_STATUT_REVUE} id="constats-par-statut" />
              <Decomptes titre="Constats par gravité" donnees={d.constats?.parGravite} libelles={LIBELLE_GRAVITE} id="constats-par-gravite" />
              <Decomptes titre="Constats par contrôle" donnees={d.constats?.parControle} id="constats-par-controle" />
              <Decomptes titre="Résultats de contrôles par statut" donnees={d.controles?.parStatut} libelles={LIBELLE_STATUT_CONTROLE} id="controles-par-statut" />
            </Carte>

            <Carte className="space-y-3" data-testid="bloc-rapprochements">
              <SousTitre>Rapprochements bancaires</SousTitre>
              <Decomptes titre="Propositions par statut" donnees={d.rapprochements?.parStatut} libelles={LIBELLE_STATUT_RAPPROCHEMENT} id="rapprochements-par-statut" />
            </Carte>

            <Carte className="space-y-3" data-testid="bloc-temps">
              <SousTitre>Temps observés par prestation</SousTitre>
              {entrees(d.temps?.observeMinutesParPrestation).length === 0 ? (
                <p className="text-texte-doux">Aucun temps observé saisi sur la période.</p>
              ) : (
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
                  {entrees(d.temps?.observeMinutesParPrestation).map(([code, minutes]) => (
                    <div key={code} className="contents" data-prestation={code}>
                      <dt>{libellePrestation[code] ?? code}</dt>
                      <dd className="text-right tabular-nums">{formaterMinutes(minutes)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="text-sm text-texte-doux">
                Temps saisis par leurs auteurs sur les travaux, sans aucune estimation. Travaux sans temps saisi : <span className="tabular-nums">{nombre(d.temps?.travauxSansTempsSaisi)}</span>.
              </p>
            </Carte>
          </div>

          <section aria-labelledby="titre-par-dossier" className="space-y-2">
            <SousTitre id="titre-par-dossier">Par dossier ({d.parDossier?.length ?? 0})</SousTitre>
            <Tableau legende="Indicateurs par dossier">
              <thead>
                <tr>
                  <th scope="col">Dossier</th>
                  <th scope="col" className="text-right">Pièces reçues sur la période</th>
                  <th scope="col" className="text-right">Pièces à contrôler</th>
                  <th scope="col" className="text-right">Constats ouverts</th>
                  <th scope="col" className="text-right">Temps observé sur la période</th>
                </tr>
              </thead>
              <tbody>
                {(d.parDossier ?? []).map((x) => (
                  <tr key={x.entiteId} data-dossier={x.entiteId}>
                    <th scope="row" className="!bg-transparent font-medium break-words">{x.raisonSociale}</th>
                    <td className="text-right tabular-nums">{nombre(x.pieces)}</td>
                    <td className="text-right tabular-nums">{nombre(x.piecesAControler)}</td>
                    <td className="text-right tabular-nums">{nombre(x.constatsOuverts)}</td>
                    <td className="text-right tabular-nums">{formaterMinutes(x.tempsObserveMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </Tableau>
          </section>
        </>
      ) : null}
    </div>
  );
}
