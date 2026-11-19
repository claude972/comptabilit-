import type { Metadata } from 'next';
import { ErreurAcces } from '@/components/erreurs';
import { ActualisationPeriodique, BoutonAction } from '@/components/revision-actions';
import { Alerte, Carte, Etiquette, SousTitre } from '@/components/ui/base';
import { LIBELLE_STATUT_LOT } from '@/lib/libelles';
import { formaterHorodatage, formaterTaille } from '@/lib/montants';
import { type Restitution, restitutionEnCours } from '@/lib/restitution';
import { tenter } from '@/lib/serveur/api';
import { contexteDossier } from '@/lib/serveur/dossier';
import { auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Restitution du dossier' };

const nombre = (n: number | undefined) => (typeof n === 'number' ? n.toLocaleString('fr-FR') : '—');

export default async function PageRestitution({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  if (!auMoins(ctx.niveau, 'validation')) return <ErreurAcces statut={403} message="La restitution d’un dossier est réservée à l’habilitation « Validation » sur ce dossier." retour={`/dossiers/${id}`} />;
  const r = await tenter<Restitution[]>(`v1/dossiers/${id}/restitutions`);
  if (!r.ok) return <ErreurAcces statut={r.statut} message={r.message} retour={`/dossiers/${id}`} />;
  const liste = r.donnees;
  const enCours = liste.some(restitutionEnCours);

  return (
    <div className="space-y-4">
      <Alerte ton="neutre">
        L’export de restitution est une archive ZIP du dossier : originaux non modifiés, données structurées, écritures, constats, décisions, rapprochements, règles du cabinet
        applicables, journal d’audit du dossier et manifeste d’empreintes SHA-256. Il reste possible quand l’abonnement est suspendu ou résilié. Chaque téléchargement est journalisé.
      </Alerte>
      <BoutonAction chemin={`v1/dossiers/${id}/restitutions`} libelle="Demander un export de restitution" succes="Export demandé : l’archive est en préparation." variante="primaire" />
      <div aria-live="polite">{enCours ? <ActualisationPeriodique libelle="Préparation de l’archive en cours" /> : null}</div>
      <SousTitre>Exports demandés ({liste.length})</SousTitre>
      {liste.length === 0 ? <p className="text-texte-doux">Aucun export de restitution demandé pour ce dossier.</p> : null}
      <ul className="space-y-3">
        {liste.map((x) => (
          <li key={x.id} data-restitution={x.id} data-statut={x.statut}>
            <Carte className="space-y-2">
              <p className="flex flex-wrap items-center gap-2">
                <Etiquette ton={x.statut === 'termine' ? 'succes' : x.statut === 'echec' ? 'danger' : 'info'} data-testid="statut-restitution">
                  {LIBELLE_STATUT_LOT[x.statut] ?? x.statut}
                </Etiquette>
                <span>Demandé le {formaterHorodatage(x.creeLe)}</span>
                {x.termineLe ? <span className="text-texte-doux">· terminé le {formaterHorodatage(x.termineLe)}</span> : null}
              </p>
              {x.statut === 'echec' ? (
                <Alerte ton="danger" role="alert">
                  La préparation de l’archive a échoué{x.erreur ? ` : ${x.erreur}` : '.'} Demandez un nouvel export ; si l’échec persiste, signalez-le.
                </Alerte>
              ) : null}
              {restitutionEnCours(x) ? <progress aria-label="Préparation de l’archive" /> : null}
              {x.statut === 'termine' ? (
                <>
                  <p>
                    {/* Téléchargement relayé par le BFF : lien simple, sans préchargement. */}
                    <a href={`/api/bff/v1/restitutions/${x.id}/archive`} download data-testid="telecharger-archive">
                      Télécharger l’archive{typeof x.taille === 'number' ? ` (${formaterTaille(x.taille)})` : ''}
                    </a>
                  </p>
                  <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]" data-testid="resume-restitution">
                    <dt className="text-texte-doux">Empreinte SHA-256 de l’archive</dt>
                    <dd className="font-mono break-all" data-testid="empreinte">{x.sha256 ?? 'Non disponible'}</dd>
                    <dt className="text-texte-doux">Pièces</dt>
                    <dd className="tabular-nums" data-testid="resume-pieces">{nombre(x.resume?.pieces)}</dd>
                    <dt className="text-texte-doux">Originaux restitués</dt>
                    <dd className="tabular-nums" data-testid="resume-originaux">{nombre(x.resume?.originaux)}</dd>
                    <dt className="text-texte-doux">Originaux exclus</dt>
                    <dd data-testid="resume-exclus">
                      {x.resume?.originauxExclus?.length ? (
                        <ul className="list-disc pl-5">
                          {x.resume.originauxExclus.map((o, i) => (
                            <li key={`${o.sha256}-${i}`} className="break-words">
                              {o.motif} <span className="font-mono text-xs break-all text-texte-doux">({o.sha256})</span>
                            </li>
                          ))}
                        </ul>
                      ) : x.resume ? (
                        'Aucun'
                      ) : (
                        '—'
                      )}
                    </dd>
                    <dt className="text-texte-doux">Lignes d’écriture</dt>
                    <dd className="tabular-nums" data-testid="resume-lignes">{nombre(x.resume?.lignesEcriture)}</dd>
                    <dt className="text-texte-doux">Autres contenus</dt>
                    <dd>
                      {nombre(x.resume?.lotsImport)} import(s) · {nombre(x.resume?.constats)} constat(s) · {nombre(x.resume?.decisions)} décision(s) · {nombre(x.resume?.mouvementsBancaires)} mouvement(s)
                      bancaire(s) · {nombre(x.resume?.rapprochements)} rapprochement(s) · {nombre(x.resume?.reglesCabinet)} règle(s) du cabinet · {nombre(x.resume?.evenementsAudit)} ligne(s) d’audit
                    </dd>
                  </dl>
                  <p className="text-sm text-texte-doux">Vérifiez l’empreinte du fichier téléchargé (par exemple « shasum -a 256 ») : elle doit être identique à celle affichée ici.</p>
                </>
              ) : null}
            </Carte>
          </li>
        ))}
      </ul>
    </div>
  );
}
