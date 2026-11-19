import type { Metadata } from 'next';
import Link from 'next/link';
import { ErreurAcces } from '@/components/erreurs';
import { ActualisationPeriodique, BoutonAction } from '@/components/revision-actions';
import { Alerte, Carte, Etiquette, SousTitre, Titre } from '@/components/ui/base';
import { LIBELLE_STATUT_LOT } from '@/lib/libelles';
import { formaterHorodatage, formaterTaille } from '@/lib/montants';
import { type PerimetreRestitution, type RestitutionCabinet, restitutionEnCours } from '@/lib/restitution';
import { tenter } from '@/lib/serveur/api';

export const metadata: Metadata = { title: 'Restitution du cabinet' };

const nombre = (n: number | undefined | null) => (typeof n === 'number' ? n.toLocaleString('fr-FR') : '—');

export default async function PageRestitutionCabinet() {
  const [perimetre, liste] = await Promise.all([tenter<PerimetreRestitution>('v1/cabinet/restitutions/perimetre'), tenter<RestitutionCabinet[]>('v1/cabinet/restitutions')]);
  if (!perimetre.ok) return <ErreurAcces statut={perimetre.statut} message={perimetre.statut === 403 ? 'La restitution du cabinet est réservée aux administrateurs et associés.' : perimetre.message} retour="/dossiers" />;
  if (!liste.ok) return <ErreurAcces statut={liste.statut} message={liste.message} retour="/administration" />;
  const p = perimetre.donnees;
  const enCours = liste.donnees.some(restitutionEnCours);

  return (
    <div className="space-y-4">
      <p>
        <Link href="/administration" prefetch={false}>
          ← Administration
        </Link>
      </p>
      <Titre>Restitution du cabinet</Titre>
      <Alerte ton="neutre">
        Archive ZIP de l’ensemble du cabinet : données du cabinet et de ses dossiers (une table par fichier), écritures, originaux non modifiés et manifeste d’empreintes SHA-256, vérifiable
        sans le logiciel. Elle reste possible quand l’abonnement est suspendu ou résilié. Chaque demande et chaque téléchargement sont journalisés.
      </Alerte>

      <section aria-labelledby="titre-perimetre" className="space-y-2" data-testid="perimetre" data-complet={String(p.complet)}>
        <SousTitre id="titre-perimetre">Périmètre d’une restitution demandée maintenant par vous</SousTitre>
        <p>
          Un dossier n’entre dans l’archive que si <strong>vous</strong> y avez l’habilitation « Validation ». Dossiers inclus : <span data-testid="nb-inclus">{nombre(p.inclus.length)}</span> ·
          dossiers écartés : <span data-testid="nb-ecartes">{nombre(p.ecartes.length)}</span>.
        </p>
        {p.complet ? (
          <Alerte ton="succes">Tous les dossiers du cabinet seraient restitués.</Alerte>
        ) : (
          <Alerte ton="attention" titre="La restitution serait incomplète" data-testid="perimetre-incomplet">
            {p.ecartes.length} dossier(s) n’y figureraient pas, faute d’habilitation « Validation » de votre part. Pour une restitution complète, un administrateur ou un associé doit vous
            habiliter sur ces dossiers (opération journalisée), ou la personne habilitée doit demander la restitution elle-même.
            <details className="mt-1">
              <summary>Dossiers écartés et motif</summary>
              <ul className="list-disc pl-5">
                {p.ecartes.slice(0, 200).map((e) => (
                  <li key={e.id} className="break-words">
                    {e.raisonSociale} — {e.motif}
                  </li>
                ))}
              </ul>
              {p.ecartes.length > 200 ? <p>… et {p.ecartes.length - 200} autre(s).</p> : null}
            </details>
          </Alerte>
        )}
        {enCours ? null : <BoutonAction chemin="v1/cabinet/restitutions" libelle="Demander la restitution du cabinet" succes="Restitution demandée : l’archive est en préparation." variante="primaire" />}
      </section>

      <div aria-live="polite">{enCours ? <ActualisationPeriodique libelle="Préparation de l’archive du cabinet en cours" /> : null}</div>
      <SousTitre>Restitutions demandées ({liste.donnees.length})</SousTitre>
      {liste.donnees.length === 0 ? <p className="text-texte-doux">Aucune restitution du cabinet n’a été demandée.</p> : null}
      <ul className="space-y-3">
        {liste.donnees.map((x) => (
          <li key={x.id} data-restitution-cabinet={x.id} data-statut={x.statut}>
            <Carte className="space-y-2">
              <p className="flex flex-wrap items-center gap-2">
                <Etiquette ton={x.statut === 'termine' ? 'succes' : x.statut === 'echec' ? 'danger' : 'info'}>{LIBELLE_STATUT_LOT[x.statut] ?? x.statut}</Etiquette>
                {x.resume ? (
                  <Etiquette ton={x.resume.complet ? 'succes' : 'attention'} data-testid="completude">
                    {x.resume.complet ? 'Complète' : `Incomplète : ${nombre(x.resume.dossiersEcartes)} dossier(s) écarté(s)`}
                  </Etiquette>
                ) : null}
                <span>
                  Demandée le {formaterHorodatage(x.creeLe)} par {x.demandeParNom ?? 'un membre du cabinet'}
                </span>
              </p>
              {x.statut === 'echec' ? (
                <Alerte ton="danger" role="alert">
                  La préparation de l’archive a échoué{x.erreur ? ` : ${x.erreur}` : '.'} Demandez une nouvelle restitution ; si l’échec persiste, signalez-le.
                </Alerte>
              ) : null}
              {restitutionEnCours(x) ? <progress aria-label="Préparation de l’archive du cabinet" /> : null}
              {x.statut === 'termine' ? (
                <>
                  {x.telechargeable ? (
                    <p>
                      <a href={`/api/bff/v1/cabinet/restitutions/${x.id}/archive`} download data-testid="telecharger-archive-cabinet">
                        Télécharger l’archive{typeof x.taille === 'number' ? ` (${formaterTaille(x.taille)})` : ''}
                      </a>
                    </p>
                  ) : (
                    <p className="text-texte-doux" data-testid="non-telechargeable">
                      Seule la personne qui a demandé cette restitution peut la télécharger : son périmètre est celui de ses habilitations.
                    </p>
                  )}
                  <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                    <dt className="text-texte-doux">Empreinte SHA-256 de l’archive</dt>
                    <dd className="font-mono break-all" data-testid="empreinte">{x.sha256 ?? 'Non disponible'}</dd>
                    <dt className="text-texte-doux">Contenu</dt>
                    <dd>
                      {nombre(x.resume?.dossiersInclus)} dossier(s) · {nombre(x.resume?.originaux)} original(aux) · {nombre(x.resume?.lignesEcriture)} ligne(s) d’écriture
                    </dd>
                    <dt className="text-texte-doux">Originaux exclus ou non conformes</dt>
                    <dd>
                      {nombre(x.resume?.originauxExclus?.length)} exclu(s) (antivirus) · {nombre(x.resume?.originauxNonConformes?.length)} non conforme(s) à leur empreinte
                    </dd>
                    <dt className="text-texte-doux">Journal d’audit à la génération</dt>
                    <dd data-testid="journal-restitution">
                      Vérification stricte : {x.resume?.journalAudit?.verificationStricte ?? '—'}
                      {x.resume?.journalAudit?.partiel ? ' · restitué partiellement (dossiers écartés)' : ''}
                    </dd>
                  </dl>
                  <p className="text-sm text-texte-doux">
                    Vérifiez l’empreinte du fichier téléchargé (par exemple « shasum -a 256 »), puis chaque fichier contre le manifeste : la marche à suivre est dans le fichier LISEZMOI de
                    l’archive.
                  </p>
                </>
              ) : null}
            </Carte>
          </li>
        ))}
      </ul>
    </div>
  );
}
