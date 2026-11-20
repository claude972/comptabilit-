import type { Metadata } from 'next';
import Link from 'next/link';
import { BoutonReanalyse, FormulaireCorrection, FormulaireEchange, FormulaireQualification, FormulaireValidation } from '@/components/document/actions';
import { BlocDestinataire } from '@/components/destinataire/bloc';
import { ChampsExtraits, Echanges, EtiquetteStatutDocument, MotifStatut, Receptions, Verifications, estValidee } from '@/components/document/affichage';
import { PropositionClassement } from '@/components/assistant/taches';
import { ApercuPiece } from '@/components/document/apercu';
import { NouvelleVersion } from '@/components/document/nouvelle-version';
import { BandeauRemplacee, BlocVersions } from '@/components/document/versions';
import { ErreurAcces } from '@/components/erreurs';
import { Alerte, Carte, Etiquette, MentionProjet, SousTitre } from '@/components/ui/base';
import type { ReponseDestinataire } from '@/lib/destinataire';
import { LIBELLE_NATURE } from '@/lib/libelles';
import { formaterDate, formaterTaille } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { estUuid, lireExercices } from '@/lib/serveur/donnees';
import { contexteDossier } from '@/lib/serveur/dossier';
import { type DetailDocument, auMoins } from '@/lib/types-api';
import { LIBELLE_VALIDATION_INVALIDEE, droitNouvelleVersion, statutValidation } from '@/lib/versions';

export const metadata: Metadata = { title: 'Revue d’une pièce' };

export default async function PageRevuePiece({ params }: { params: Promise<{ id: string; documentId: string }> }) {
  const { id, documentId } = await params;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const base = `/dossiers/${id}`;
  if (!estUuid(documentId)) return <ErreurAcces statut={404} retour={base} />;
  const [r, exercices] = await Promise.all([tenter<DetailDocument>(`v1/documents/${documentId}`), lireExercices(id)]);
  if (!r.ok) return <ErreurAcces statut={r.statut} message={r.message} retour={base} />;
  const { document: doc, fichier, extraction, echanges, receptions, niveau } = r.donnees;
  // Destinataire (acheteur) : lecture dès le niveau « lecture » ; un refus ou une panne n'empêche pas d'afficher le reste de la revue.
  const destinataire = extraction && doc.entiteId === id ? await tenter<ReponseDestinataire>(`v1/documents/${documentId}/destinataire`) : null;
  const versions = r.donnees.versions ?? [];
  // Une version remplacée est conservée pour mémoire : aucune correction ni validation n'y est proposée (l'API les refuse).
  const courante = r.donnees.estVersionCourante !== false && !doc.remplacePar;
  // Une pièce d'un autre dossier n'est pas affichée sous ce dossier.
  if (doc.entiteId !== id) return <ErreurAcces statut={404} retour={base} />;
  const collaboration = auMoins(niveau, 'collaboration');
  const revision = auMoins(niveau, 'revision');
  const exercice = exercices.ok ? exercices.donnees.find((x) => x.id === doc.exerciceId) : undefined;
  const lienVersion = (v: string) => `${base}/pieces/${v}`;
  const validation = statutValidation(extraction?.statut);
  const droit = droitNouvelleVersion({ niveau, estVersionCourante: courante, statut: doc.statut, deposeeParMoi: receptions.some((x) => x.parMoi) });

  return (
    <div className="space-y-4">
      <p>
        <Link href={base} prefetch={false}>
          ← Retour à la file des pièces
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-2" data-testid="entete-piece">
        <h2 className="text-xl font-semibold break-all">{doc.nomOrigine}</h2>
        <EtiquetteStatutDocument statut={doc.statut} />
        {doc.version > 1 || versions.length > 1 ? <Etiquette>Version {doc.version}</Etiquette> : null}
        {validation === 'validation_invalidee' ? (
          <Etiquette ton="attention" className="whitespace-normal">
            {LIBELLE_VALIDATION_INVALIDEE}
          </Etiquette>
        ) : extraction && !estValidee(extraction) ? (
          <MentionProjet />
        ) : null}
      </div>
      {!courante ? <BandeauRemplacee versions={versions} remplacePar={doc.remplacePar} lien={lienVersion} /> : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Carte className="space-y-3 self-start xl:sticky xl:top-4">
          <SousTitre>Pièce</SousTitre>
          {fichier?.analyseAntivirus === 'sain' ? (
            <ApercuPiece documentId={doc.id} nom={doc.nomOrigine} />
          ) : (
            <Alerte ton="neutre" data-testid="apercu-indisponible">
              Aperçu indisponible : {fichier?.analyseAntivirus === 'infecte' ? 'fichier en quarantaine.' : 'contrôle antivirus non terminé.'}
            </Alerte>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-texte-doux">Nature</dt>
            <dd>{LIBELLE_NATURE[doc.nature] ?? doc.nature}</dd>
            <dt className="text-texte-doux">Exercice</dt>
            <dd>{exercice ? `Du ${formaterDate(exercice.debut)} au ${formaterDate(exercice.fin)}` : 'Non rattachée'}</dd>
            <dt className="text-texte-doux">Pages</dt>
            <dd>{doc.nbPages ?? '—'}</dd>
            {fichier ? (
              <>
                <dt className="text-texte-doux">Fichier</dt>
                <dd>
                  {fichier.typeMimeDetecte ?? 'type non déterminé'} · {formaterTaille(fichier.taille)}
                </dd>
                <dt className="text-texte-doux">Empreinte SHA-256</dt>
                <dd className="font-mono text-xs break-all">{fichier.sha256}</dd>
              </>
            ) : null}
          </dl>
          {doc.commentaire ? (
            <p className="text-sm">
              <span className="font-medium">Commentaire du déposant :</span> <span className="break-words whitespace-pre-wrap">{doc.commentaire}</span>
            </p>
          ) : null}
          <Receptions receptions={receptions} />
          {versions.length ? <BlocVersions versions={versions} courantId={doc.id} lien={lienVersion} /> : null}
          <NouvelleVersion documentId={doc.id} entiteId={id} canal="ordinateur" lienVersion={`${base}/pieces/`} droit={droit} />
        </Carte>

        <div className="space-y-4">
          <MotifStatut statut={doc.statut} motif={doc.motifStatut} />
          <Carte className="space-y-4">
            {extraction ? (
              <>
                <ChampsExtraits extraction={extraction} avecPreuves />
                <Verifications verifications={extraction.verifications ?? []} />
              </>
            ) : (
              <Alerte ton="neutre">Aucune extraction disponible : la pièce est en cours d’analyse, ou sa lecture automatique n’a rien donné.</Alerte>
            )}
          </Carte>
          {destinataire?.ok ? (
            <BlocDestinataire d={destinataire.donnees} documentId={doc.id} peutCorriger={courante && collaboration} lienReanalyse={collaboration ? `${base}/reanalyse-destinataire` : null} />
          ) : destinataire ? (
            <Alerte ton="neutre" data-testid="destinataire-indisponible">
              Destinataire indisponible : {destinataire.message}
            </Alerte>
          ) : null}
          {!courante ? (
            <Alerte ton="neutre" data-testid="actions-indisponibles">
              Version conservée pour mémoire : la correction, la qualification et la validation se font sur la version la plus récente.
            </Alerte>
          ) : collaboration ? (
            <>
              <Carte>
                <FormulaireCorrection documentId={doc.id} extraction={extraction} />
              </Carte>
              <Carte className="space-y-4">
                <FormulaireQualification documentId={doc.id} nature={doc.nature} exerciceId={doc.exerciceId} exercices={exercices.ok ? exercices.donnees : []} />
                {doc.statut !== 'traite' ? <BoutonReanalyse documentId={doc.id} /> : null}
              </Carte>
              <Carte>
                <PropositionClassement documentId={doc.id} />
              </Carte>
              <Carte>
                <FormulaireEchange documentId={doc.id} type="demande_complement" />
              </Carte>
            </>
          ) : (
            <Alerte ton="neutre">Votre habilitation (lecture) ne permet pas de corriger ni de qualifier cette pièce.</Alerte>
          )}
          {echanges.length ? (
            <Carte>
              <Echanges echanges={echanges} />
            </Carte>
          ) : null}
          {/* Valider / Rejeter : uniquement au niveau « révision » ou plus ; l'API le vérifie de son côté. */}
          {revision && extraction && courante ? (
            <Carte data-testid="decision-reviseur">
              <FormulaireValidation documentId={doc.id} version={extraction.version} />
            </Carte>
          ) : null}
        </div>
      </div>
    </div>
  );
}
