'use client';

import { useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Libelle, Saisie } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';

type Decision = 'confirme' | 'infirme' | 'retirer';

/**
 * Boutons de décision communs : confirmer (collaboration), infirmer avec motif ou retirer (révision). Rien n'est
 * comptabilisé ni lettré : la décision n'existe que dans cet outil d'aide à la révision ; l'API revérifie les droits.
 */
function Decisions({
  quoi, envoyer, occupe, erreur, succes, peutConfirmer, peutInfirmer, libelles, retirable,
}: {
  quoi: string;
  envoyer: (decision: Decision, motif?: string) => void;
  occupe: boolean;
  erreur: string | null;
  succes: string | null;
  peutConfirmer: boolean;
  peutInfirmer: boolean;
  libelles: { confirmer: string; infirmer: string };
  retirable?: boolean;
}) {
  const [motif, setMotif] = useState('');
  const id = useId();
  if (!peutConfirmer && !peutInfirmer) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        {peutConfirmer ? (
          <Bouton variante="secondaire" disabled={occupe} onClick={() => envoyer('confirme')} aria-label={`${libelles.confirmer} : ${quoi}`}>
            {libelles.confirmer}
          </Bouton>
        ) : null}
        {peutInfirmer ? (
          <>
            <div className="min-w-0 flex-1 basis-48">
              <Libelle htmlFor={id}>Motif (requis pour {libelles.infirmer.toLowerCase()})</Libelle>
              <Saisie id={id} value={motif} maxLength={2000} onChange={(e) => setMotif(e.target.value)} className="w-full min-w-0" />
            </div>
            <Bouton variante="contour" disabled={occupe || motif.trim() === ''} onClick={() => envoyer('infirme', motif.trim())} aria-label={`${libelles.infirmer} : ${quoi}`}>
              {libelles.infirmer}
            </Bouton>
            {retirable ? (
              <Bouton variante="contour" disabled={occupe} onClick={() => envoyer('retirer')} aria-label={`Retirer la décision : ${quoi}`}>
                Retirer la décision
              </Bouton>
            ) : null}
          </>
        ) : null}
      </div>
      <Retours erreur={erreur} succes={succes} />
    </div>
  );
}

const MESSAGES: Record<Decision, string> = { confirme: 'Décision enregistrée : confirmé.', infirme: 'Décision enregistrée : infirmé.', retirer: 'Décision retirée.' };

/** Rattachement d'un tiers de pièce à un tiers comptable (`PUT v1/exercices/:id/tiers/liens`). */
export function DecisionLienTiers({ exerciceId, cleComptable, clePiece, quoi, peutConfirmer, peutInfirmer, retirable }: { exerciceId: string; cleComptable: string; clePiece: string; quoi: string; peutConfirmer: boolean; peutInfirmer: boolean; retirable?: boolean }) {
  const appel = useAppel();
  return (
    <Decisions
      quoi={quoi}
      occupe={appel.occupe}
      erreur={appel.erreur}
      succes={appel.succes}
      peutConfirmer={peutConfirmer}
      peutInfirmer={peutInfirmer}
      retirable={retirable}
      libelles={{ confirmer: 'Confirmer : c’est le même tiers', infirmer: 'Infirmer' }}
      envoyer={(decision, motif) => void appel.executer(`v1/exercices/${exerciceId}/tiers/liens`, { method: 'PUT', json: { cleComptable, clePiece, decision, ...(motif ? { motif } : {}) } }, MESSAGES[decision])}
    />
  );
}

/** Lien d'une facture avec son écriture ou avec une écriture de règlement ou d'avoir (`PUT v1/exercices/:id/factures/:documentId/liens`). */
export function DecisionLienFacture({
  exerciceId, documentId, type, cible, quoi, peutConfirmer, peutInfirmer, retirable,
}: {
  exerciceId: string;
  documentId: string;
  type: 'comptabilisation' | 'imputation';
  cible: string;
  quoi: string;
  peutConfirmer: boolean;
  peutInfirmer: boolean;
  retirable?: boolean;
}) {
  const appel = useAppel();
  return (
    <Decisions
      quoi={quoi}
      occupe={appel.occupe}
      erreur={appel.erreur}
      succes={appel.succes}
      peutConfirmer={peutConfirmer}
      peutInfirmer={peutInfirmer}
      retirable={retirable}
      libelles={{ confirmer: type === 'comptabilisation' ? 'Confirmer cette écriture' : 'Confirmer ce règlement', infirmer: 'Infirmer' }}
      envoyer={(decision, motif) => void appel.executer(`v1/exercices/${exerciceId}/factures/${documentId}/liens`, { method: 'PUT', json: { type, cible, decision, ...(motif ? { motif } : {}) } }, MESSAGES[decision])}
    />
  );
}

/** Décision sur une suspicion de double comptabilisation, réservée au niveau révision (`PUT v1/exercices/:id/suspicions`). */
export function DecisionSuspicion({ exerciceId, cle, quoi, statut }: { exerciceId: string; cle: string; quoi: string; statut: 'a_examiner' | 'confirmee' | 'ecartee' }) {
  const appel = useAppel();
  return (
    <Decisions
      quoi={quoi}
      occupe={appel.occupe}
      erreur={appel.erreur}
      succes={appel.succes}
      peutConfirmer={statut !== 'confirmee'}
      peutInfirmer
      retirable={statut !== 'a_examiner'}
      libelles={{ confirmer: 'Confirmer la double comptabilisation', infirmer: 'Écarter' }}
      envoyer={(decision, motif) =>
        void appel.executer(
          `v1/exercices/${exerciceId}/suspicions`,
          { method: 'PUT', json: { cle, decision, ...(motif ? { motif } : {}) } },
          decision === 'confirme' ? 'Suspicion confirmée : la correction se fait dans le logiciel de production comptable.' : decision === 'infirme' ? 'Suspicion écartée.' : 'Décision retirée.',
        )
      }
    />
  );
}

/** Réglage de la tolérance de montant d'un dossier (`PUT v1/dossiers/:id/tiers-factures/reglages`), niveau révision, motif obligatoire. */
export function ReglageTolerance({ dossierId, actuelle, maximum }: { dossierId: string; actuelle: string; maximum: string }) {
  const appel = useAppel();
  const [montant, setMontant] = useState(actuelle);
  const [motif, setMotif] = useState('');
  const idMontant = useId();
  const idMotif = useId();
  const valide = /^\d{1,4}(\.\d{1,2})?$/.test(montant) && motif.trim() !== '';
  return (
    <form
      className="space-y-3"
      aria-label="Régler la tolérance de montant du dossier"
      onSubmit={(e) => {
        e.preventDefault();
        if (valide) void appel.executer(`v1/dossiers/${dossierId}/tiers-factures/reglages`, { method: 'PUT', json: { toleranceMontant: montant, motif: motif.trim() } }, 'Tolérance enregistrée pour ce dossier.');
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Libelle htmlFor={idMontant}>Tolérance de montant, en euros (0 = aucune ; au plus {maximum})</Libelle>
          <Saisie id={idMontant} inputMode="decimal" value={montant} onChange={(e) => setMontant(e.target.value)} className="w-40 min-w-0" />
        </div>
        <div className="min-w-0 flex-1 basis-60">
          <Libelle htmlFor={idMotif}>Motif (obligatoire)</Libelle>
          <Saisie id={idMotif} value={motif} maxLength={2000} onChange={(e) => setMotif(e.target.value)} className="w-full min-w-0" />
        </div>
        <Bouton type="submit" variante="secondaire" disabled={appel.occupe || !valide}>
          Enregistrer la tolérance
        </Bouton>
      </div>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}
