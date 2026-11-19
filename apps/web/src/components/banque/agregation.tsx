'use client';

import { useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, Liste, Saisie, SousTitre } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';

export interface EtatAgregation {
  statut: 'non_connecte' | 'simule' | 'configure_non_verifie';
  detail: string;
  prestataire: string | null;
  comptes: Array<{ identifiant: string; libelle: string | null; iban: string | null; devise: string | null }>;
}

const LIBELLE: Record<EtatAgregation['statut'], string> = {
  non_connecte: 'Non connectée',
  simule: 'SIMULATEUR de test (aucune banque réelle)',
  configure_non_verifie: 'Configurée, non vérifiée',
};

/**
 * État de l'agrégation bancaire (`v1/dossiers/:id/banque/agregation`). Tant qu'aucun prestataire n'est connecté, l'écran
 * le dit et ne propose aucune action ; l'import de fichiers reste le moyen normal.
 */
export function AgregationBancaire({ entiteId, etat }: { entiteId: string; etat: EtatAgregation }) {
  const appel = useAppel();
  const [compte, setCompte] = useState(etat.comptes[0]?.identifiant ?? '');
  const [depuis, setDepuis] = useState('');
  const idCompte = useId();
  const idDepuis = useId();
  return (
    <section aria-labelledby="titre-agregation" className="space-y-2" data-testid="agregation-bancaire">
      <SousTitre id="titre-agregation" className="text-base">
        Agrégation bancaire : {LIBELLE[etat.statut]}
      </SousTitre>
      <p className="text-sm text-texte-doux">{etat.detail}</p>
      {etat.statut === 'non_connecte' ? (
        <p className="text-sm text-texte-doux">Rien n’est récupéré automatiquement auprès d’une banque : importez un relevé ci-dessus.</p>
      ) : etat.comptes.length === 0 ? (
        <Alerte ton="neutre">Le prestataire ne propose aucun compte.</Alerte>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void appel.executer(`v1/dossiers/${entiteId}/banque/agregation/synchroniser`, { method: 'POST', json: { compte, depuis } }, 'Mouvements demandés au prestataire : l’import apparaît dans la liste ci-dessous.');
          }}
        >
          <div>
            <Libelle htmlFor={idCompte}>Compte chez le prestataire</Libelle>
            <Liste id={idCompte} value={compte} onChange={(e) => setCompte(e.target.value)} className="min-w-64">
              {etat.comptes.map((c) => (
                <option key={c.identifiant} value={c.identifiant}>
                  {c.libelle ?? c.identifiant} {c.iban ? `· ${c.iban}` : ''}
                </option>
              ))}
            </Liste>
          </div>
          <div>
            <Libelle htmlFor={idDepuis}>Mouvements depuis le</Libelle>
            <Saisie id={idDepuis} type="date" required value={depuis} onChange={(e) => setDepuis(e.target.value)} />
          </div>
          <Bouton type="submit" variante="secondaire" disabled={appel.occupe || !compte}>
            Récupérer les mouvements
          </Bouton>
        </form>
      )}
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </section>
  );
}
