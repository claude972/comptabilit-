import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionsCampagne, DepotCampagne } from '@/components/campagnes/actions';
import { ErreurAcces } from '@/components/erreurs';
import { ActualisationPeriodique } from '@/components/revision-actions';
import { ServiceFerme } from '@/components/service-ferme';
import { Alerte, Carte, Etiquette, SousTitre, Tableau, Titre, type Ton } from '@/components/ui/base';
import { LIBELLE_STATUT_CAMPAGNE, LIBELLE_TYPE_CAMPAGNE, PHRASE_ISOLEMENT, type SuiviCampagne, libelleTroisEtats, mentionHorsHabilitation, syntheseParStatut } from '@/lib/imports';
import { LIBELLE_STATUT_LOT } from '@/lib/libelles';
import { formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { estUuid, lireDossiers, lireSituation } from '@/lib/serveur/donnees';
import { type StatutLot, auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Suivi d’une campagne d’import' };

const TON_LOT: Record<StatutLot, Ton> = { en_attente: 'info', en_cours: 'info', termine: 'succes', termine_avec_erreurs: 'attention', echec: 'danger', annule: 'vide' };

/** Trois états distincts : « non évalué » n'est jamais rendu comme un « non ». */
function TroisEtats({ libelle, valeur }: { libelle: string; valeur: boolean | null }) {
  return (
    <Etiquette ton={valeur === true ? 'succes' : valeur === false ? 'danger' : 'vide'} data-indicateur={libelle} data-valeur={String(valeur)}>
      {libelle} : {libelleTroisEtats(valeur)}
    </Etiquette>
  );
}

export default async function PageCampagne({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estUuid(id)) return <ErreurAcces statut={404} retour="/campagnes" />;
  const [suivi, dossiers, situation] = await Promise.all([tenter<SuiviCampagne>(`v1/campagnes/${id}`), lireDossiers(), lireSituation()]);
  if (!suivi.ok) return <ErreurAcces statut={suivi.statut} message={suivi.message} retour="/campagnes" />;
  const { campagne: c, synthese, elements, dossiersHorsHabilitation } = suivi.donnees;
  const comptable = c.type === 'fec';
  // Un fichier ne se dépose que pour un dossier où l'on est habilité en collaboration (l'API le vérifie).
  const deposables = dossiers.ok ? dossiers.donnees.filter((d) => auMoins(d.niveau, 'collaboration')).map((d) => ({ id: d.id, raisonSociale: d.raisonSociale })) : [];
  const ferme = situation && !situation.serviceOuvert ? situation.situation : null;
  const hors = mentionHorsHabilitation(dossiersHorsHabilitation);
  const parStatut = syntheseParStatut(synthese.parStatut);
  const nbEchecs = synthese.parStatut.echec ?? 0;

  return (
    <div className="space-y-4">
      <p>
        <Link href="/campagnes" prefetch={false}>
          ← Campagnes d’import
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-2" data-testid="entete-campagne" data-statut={c.statut}>
        <Titre className="break-words">{c.libelle}</Titre>
        <Etiquette>{LIBELLE_TYPE_CAMPAGNE[c.type] ?? c.type}</Etiquette>
        <Etiquette ton={c.statut === 'ouverte' ? 'info' : c.statut === 'annulee' ? 'vide' : 'neutre'}>{LIBELLE_STATUT_CAMPAGNE[c.statut] ?? c.statut}</Etiquette>
        <span className="text-sm text-texte-doux">ouverte le {formaterHorodatage(c.creeLe)}</span>
      </div>
      <Alerte ton="neutre" data-testid="phrase-isolement">
        <strong>{PHRASE_ISOLEMENT}</strong>
      </Alerte>

      {c.statut !== 'ouverte' ? (
        <Alerte ton="neutre" data-testid="campagne-fermee">
          {c.statut === 'close' ? 'Cette campagne est close : elle n’accepte plus de fichiers. Ses imports restent en place.' : 'Cette campagne a été annulée : elle n’accepte plus de fichiers. Chaque import annulé reste rétablissable individuellement, depuis son dossier.'}
        </Alerte>
      ) : ferme ? (
        <ServiceFerme situation={ferme} />
      ) : !dossiers.ok ? (
        <Alerte ton="attention">La liste des dossiers n’a pas pu être chargée : le dépôt de fichiers est momentanément indisponible. {dossiers.message}</Alerte>
      ) : deposables.length ? (
        <Carte>
          <DepotCampagne campagneId={c.id} type={c.type} dossiers={deposables} />
        </Carte>
      ) : (
        <Alerte ton="neutre">Vous n’êtes habilité en collaboration sur aucun dossier : vous ne pouvez pas déposer de fichier dans cette campagne.</Alerte>
      )}

      <section aria-labelledby="titre-synthese" className="space-y-2" data-testid="synthese-campagne">
        <SousTitre id="titre-synthese">Synthèse ({synthese.lots} import{synthese.lots > 1 ? 's' : ''} dans vos dossiers)</SousTitre>
        {parStatut.length ? (
          <ul className="flex flex-wrap gap-2">
            {parStatut.map((x) => (
              <li key={x.statut}>
                <Etiquette ton={TON_LOT[x.statut]} data-synthese={x.statut}>
                  {LIBELLE_STATUT_LOT[x.statut]} : {x.nombre}
                </Etiquette>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-texte-doux">Aucun fichier déposé dans cette campagne pour les dossiers où vous êtes habilité.</p>
        )}
        {hors ? (
          <p className="text-sm" data-testid="hors-habilitation">
            {hors} : leurs imports ne sont ni détaillés ni modifiables ici.
          </p>
        ) : null}
        {synthese.enCours > 0 ? <ActualisationPeriodique libelle={`${synthese.enCours} import${synthese.enCours > 1 ? 's' : ''} en cours de traitement`} /> : null}
      </section>

      <section aria-labelledby="titre-suivi" className="space-y-2">
        <SousTitre id="titre-suivi">Suivi par dossier</SousTitre>
        {elements.length ? (
          <Tableau legende="Suivi des imports de la campagne, dossier par dossier">
            <thead>
              <tr>
                <th scope="col">Dossier</th>
                <th scope="col">Fichier</th>
                <th scope="col">Statut</th>
                <th scope="col">Progression</th>
                <th scope="col">{comptable ? 'Lisible / conforme / suffisant' : 'Mouvements'}</th>
                <th scope="col">Motif d’échec</th>
              </tr>
            </thead>
            <tbody>
              {elements.map((e) => (
                <tr key={e.lotImportId} data-element={e.lotImportId} data-dossier={e.entiteId} data-statut={e.statut}>
                  <th scope="row" className="!bg-transparent font-medium">
                    <Link href={comptable ? `/dossiers/${e.entiteId}/comptabilite${e.exerciceId ? `?exercice=${e.exerciceId}&lot=${e.lotImportId}` : ''}` : `/dossiers/${e.entiteId}/banque`} prefetch={false} className="break-words">
                      {e.raisonSociale}
                    </Link>
                  </th>
                  <td className="break-all">{e.rapport.nomFichier ?? '—'}</td>
                  <td>
                    <Etiquette ton={TON_LOT[e.statut] ?? 'neutre'}>{LIBELLE_STATUT_LOT[e.statut] ?? e.statut}</Etiquette>
                    {e.actif ? <Etiquette ton="info" className="ml-1">Lot actif</Etiquette> : null}
                  </td>
                  <td className="tabular-nums">
                    {e.progression.toLocaleString('fr-FR')} {comptable ? 'lignes' : 'mouvements lus'}
                  </td>
                  <td>
                    {comptable ? (
                      <span className="flex flex-wrap gap-1">
                        <TroisEtats libelle="Lisible" valeur={e.rapport.lisible} />
                        <TroisEtats libelle="Conforme" valeur={e.rapport.conforme} />
                        <TroisEtats libelle="Suffisant" valeur={e.rapport.suffisantPourTravaux} />
                      </span>
                    ) : e.rapport.nbMouvements === null ? (
                      <span className="text-texte-doux">Non disponible</span>
                    ) : (
                      e.rapport.nbMouvements.toLocaleString('fr-FR')
                    )}
                  </td>
                  <td className="break-words">{e.statut === 'echec' || e.rapport.motif ? (e.rapport.motif ?? 'Motif non précisé') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        ) : (
          <p className="text-texte-doux">Aucun import à afficher.</p>
        )}
      </section>

      <Carte className="space-y-3">
        <SousTitre className="text-base">Actions sur la campagne</SousTitre>
        <ActionsCampagne campagneId={c.id} statut={c.statut} nbEchecs={nbEchecs} nbImports={synthese.lots} />
      </Carte>
    </div>
  );
}
