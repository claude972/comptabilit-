import type { Metadata } from 'next';
import Link from 'next/link';
import { FormulaireEchange } from '@/components/document/actions';
import { ChampsExtraits, Echanges, EtiquetteStatutDocument, MotifStatut, Receptions, Verifications } from '@/components/document/affichage';
import { ApercuPiece } from '@/components/document/apercu';
import { ErreurAcces } from '@/components/erreurs';
import { Alerte, Carte, SousTitre, Titre } from '@/components/ui/base';
import { LIBELLE_NATURE } from '@/lib/libelles';
import { formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { estUuid } from '@/lib/serveur/donnees';
import type { DetailDocument } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Suivi d’une pièce' };

export default async function PageDepot({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estUuid(id)) return <ErreurAcces statut={404} retour="/depots" />;
  const r = await tenter<DetailDocument>(`v1/documents/${id}`);
  if (!r.ok) return <ErreurAcces statut={r.statut} message={r.message} retour="/depots" />;
  const { document: doc, fichier, extraction, echanges, receptions } = r.donnees;
  const demandeOuverte = echanges.some((e) => e.type === 'demande_complement' && !e.resolu);
  const apercuDisponible = fichier?.analyseAntivirus === 'sain';

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <p>
        <Link href="/depots" prefetch={false}>
          ← Retour aux dépôts
        </Link>
      </p>
      <Titre className="break-all">{doc.nomOrigine}</Titre>
      <Carte className="space-y-3">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Statut :</span> <EtiquetteStatutDocument statut={doc.statut} />
          <span className="text-sm text-texte-doux">
            {LIBELLE_NATURE[doc.nature] ?? doc.nature} · mis à jour le {formaterHorodatage(doc.majLe)}
          </span>
        </p>
        <MotifStatut statut={doc.statut} motif={doc.motifStatut} />
        {doc.commentaire ? (
          <p className="text-sm">
            <span className="font-medium">Votre commentaire :</span> <span className="break-words whitespace-pre-wrap">{doc.commentaire}</span>
          </p>
        ) : null}
        <Receptions receptions={receptions} />
      </Carte>

      {demandeOuverte ? (
        <Carte className="space-y-3 border-attention-texte" data-testid="demande-complement">
          <Alerte ton="attention" titre="Votre cabinet vous demande un complément">
            Lisez la demande dans les échanges ci-dessous, puis répondez. Pour transmettre une nouvelle photo, utilisez l’écran « Déposer ».
          </Alerte>
          <FormulaireEchange documentId={doc.id} type="reponse" />
        </Carte>
      ) : null}

      {echanges.length ? (
        <Carte>
          <Echanges echanges={echanges} />
        </Carte>
      ) : null}

      <Carte className="space-y-4">
        {extraction ? (
          <>
            <ChampsExtraits extraction={extraction} avecPreuves={false} />
            <Verifications verifications={extraction.verifications ?? []} />
          </>
        ) : (
          <p className="text-texte-doux">Aucune information n’a encore été extraite de cette pièce.</p>
        )}
        <FormulaireEchange documentId={doc.id} type="signalement_erreur" />
      </Carte>

      <Carte className="space-y-2">
        <SousTitre>Aperçu de la pièce</SousTitre>
        {apercuDisponible ? (
          <ApercuPiece documentId={doc.id} nom={doc.nomOrigine} />
        ) : (
          <Alerte ton="neutre" data-testid="apercu-indisponible">
            L’aperçu n’est pas disponible : {fichier?.analyseAntivirus === 'infecte' ? 'le fichier a été placé en quarantaine.' : 'le contrôle antivirus du fichier n’est pas terminé.'}
          </Alerte>
        )}
      </Carte>
    </div>
  );
}
