import type { Metadata } from 'next';
import Link from 'next/link';
import { BoutonReanalyse, FormulaireCorrection, FormulaireEchange, FormulaireQualification, FormulaireValidation } from '@/components/document/actions';
import { ChampsExtraits, Echanges, EtiquetteStatutDocument, MotifStatut, Receptions, Verifications, estValidee } from '@/components/document/affichage';
import { ApercuPiece } from '@/components/document/apercu';
import { ErreurAcces } from '@/components/erreurs';
import { Alerte, Carte, MentionProjet, SousTitre } from '@/components/ui/base';
import { LIBELLE_NATURE } from '@/lib/libelles';
import { formaterDate, formaterTaille } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { estUuid, lireExercices } from '@/lib/serveur/donnees';
import { contexteDossier } from '@/lib/serveur/dossier';
import { type DetailDocument, auMoins } from '@/lib/types-api';

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
  // Une pièce d'un autre dossier n'est pas affichée sous ce dossier.
  if (doc.entiteId !== id) return <ErreurAcces statut={404} retour={base} />;
  const collaboration = auMoins(niveau, 'collaboration');
  const revision = auMoins(niveau, 'revision');
  const exercice = exercices.ok ? exercices.donnees.find((x) => x.id === doc.exerciceId) : undefined;

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
        {extraction && !estValidee(extraction) ? <MentionProjet /> : null}
      </div>
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
          {collaboration ? (
            <>
              <Carte>
                <FormulaireCorrection documentId={doc.id} extraction={extraction} />
              </Carte>
              <Carte className="space-y-4">
                <FormulaireQualification documentId={doc.id} nature={doc.nature} exerciceId={doc.exerciceId} exercices={exercices.ok ? exercices.donnees : []} />
                {doc.statut !== 'traite' ? <BoutonReanalyse documentId={doc.id} /> : null}
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
          {revision && extraction ? (
            <Carte data-testid="decision-reviseur">
              <FormulaireValidation documentId={doc.id} version={extraction.version} />
            </Carte>
          ) : null}
        </div>
      </div>
    </div>
  );
}
