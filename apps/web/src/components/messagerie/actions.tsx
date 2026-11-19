'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { messageErreur, useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, Liste, SousTitre } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import type { ResultatDeconnexion } from '@/lib/messagerie';
import { appelBff } from '@/lib/televersement/transport-bff';

export function SynchroniserMaintenant({ connexionId }: { connexionId: string }) {
  const appel = useAppel();
  return (
    <div className="space-y-2">
      <Bouton variante="secondaire" disabled={appel.occupe} onClick={() => void appel.executer(`v1/mail/connexions/${connexionId}/synchroniser`, { method: 'POST' }, 'Synchronisation demandée : elle s’exécute en arrière-plan sur le serveur.')}>
        Synchroniser maintenant
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </div>
  );
}

/** Déconnexion avec confirmation ; les démarches restantes renvoyées par l'API sont affichées telles quelles. */
export function Deconnecter({ connexionId, adresse, dejaDeconnectee }: { connexionId: string; adresse: string; dejaDeconnectee: boolean }) {
  const routeur = useRouter();
  const [confirmation, setConfirmation] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<ResultatDeconnexion | null>(null);

  async function confirmer() {
    setOccupe(true);
    setErreur(null);
    try {
      setResultat(await appelBff<ResultatDeconnexion>(`v1/mail/connexions/${connexionId}`, { method: 'DELETE' }));
      routeur.refresh();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setOccupe(false);
    }
  }

  if (resultat) {
    return (
      <Alerte ton="succes" role="status" titre="Boîte déconnectée" data-testid="resultat-deconnexion">
        <p>{resultat.jetonsSupprimes ? 'Les jetons ont été supprimés : Comtaple ne peut plus lire cette boîte.' : 'La suppression des jetons n’a pas été confirmée.'}</p>
        <p>
          {resultat.revoqueChezFournisseur
            ? 'L’autorisation a aussi été révoquée chez le fournisseur.'
            : 'L’autorisation n’a pas été révoquée chez le fournisseur par Comtaple.'}
        </p>
        {resultat.actionsRestantes?.length ? (
          <>
            <p className="mt-2 font-semibold">Démarches restantes chez le fournisseur</p>
            <ul className="list-disc pl-5">
              {resultat.actionsRestantes.map((a, i) => (
                <li key={i} className="break-words">
                  {a}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Alerte>
    );
  }
  if (dejaDeconnectee) return <p className="text-texte-doux">Cette boîte est déjà déconnectée.</p>;
  return (
    <div className="space-y-2">
      {confirmation ? (
        <Alerte ton="attention" role="alertdialog" aria-label="Confirmer la déconnexion" data-testid="confirmation-deconnexion">
          <p>
            Déconnecter <span className="font-medium break-all">{adresse}</span> ? La surveillance s’arrête et les jetons sont supprimés. Les pièces
            déjà importées sont conservées. Pour reprendre la collecte, il faudra reconnecter la boîte.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Bouton variante="danger" onClick={() => void confirmer()} disabled={occupe}>
              Confirmer la déconnexion
            </Bouton>
            <Bouton variante="contour" onClick={() => setConfirmation(false)} disabled={occupe}>
              Annuler
            </Bouton>
          </div>
        </Alerte>
      ) : (
        <Bouton variante="danger" onClick={() => setConfirmation(true)}>
          Déconnecter et supprimer les jetons
        </Bouton>
      )}
      {erreur ? (
        <Alerte ton="danger" role="alert">
          {erreur}
        </Alerte>
      ) : null}
    </div>
  );
}

/** Affectation d'une pièce à qualifier à un dossier (`POST v1/mail/pieces-a-qualifier/:id/affecter`). */
export function AffecterPiece({ pieceId, dossiers, candidats }: { pieceId: string; dossiers: Array<{ id: string; raisonSociale: string }>; candidats: string[] }) {
  const appel = useAppel();
  const [entiteId, setEntiteId] = useState('');
  const [fait, setFait] = useState<{ documentId: string; doublonBinaire: boolean } | null>(null);
  const id = useId();
  if (fait) {
    return (
      <Alerte ton="succes" role="status">
        Pièce affectée au dossier. {fait.doublonBinaire ? 'Ce fichier y avait déjà été reçu : seule une nouvelle réception est enregistrée.' : 'Elle rejoint la file des pièces du dossier.'}
      </Alerte>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!entiteId) return;
        const r = await appel.executer<{ documentId: string; doublonBinaire: boolean }>(`v1/mail/pieces-a-qualifier/${pieceId}/affecter`, { method: 'POST', json: { entiteId } });
        if (r) setFait(r);
      }}
    >
      <SousTitre className="text-base">Affecter à un dossier</SousTitre>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 grow">
          <Libelle htmlFor={id}>Dossier comptable</Libelle>
          <Liste id={id} value={entiteId} onChange={(e) => setEntiteId(e.target.value)} required>
            <option value="">Choisir un dossier…</option>
            {dossiers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.raisonSociale}
                {candidats.includes(d.id) ? ' (désigné par une règle)' : ''}
              </option>
            ))}
          </Liste>
        </div>
        <Bouton type="submit" disabled={appel.occupe || !entiteId}>
          Affecter
        </Bouton>
      </div>
      <Retours erreur={appel.erreur} succes={null} />
    </form>
  );
}
