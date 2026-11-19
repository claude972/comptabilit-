'use client';

import { useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Libelle, Liste, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { LIBELLE_CATEGORIE } from '@/lib/fiscal';

/** Catégorie de taille déclarée par le cabinet pour l'annexe (`PUT v1/exercices/:id/annexe/categorie`). */
export function CategorieAnnexe({ exerciceId, actuelle }: { exerciceId: string; actuelle: string | null }) {
  const appel = useAppel();
  const [valeur, setValeur] = useState(actuelle ?? '');
  const id = useId();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void appel.executer(`v1/exercices/${exerciceId}/annexe/categorie`, { method: 'PUT', json: { categorie: valeur || null } }, 'Catégorie enregistrée.');
      }}
    >
      <div>
        <Libelle htmlFor={id}>Catégorie de taille retenue par le cabinet</Libelle>
        <Liste id={id} value={valeur} onChange={(e) => setValeur(e.target.value)} className="min-w-72">
          <option value="">À confirmer (aucun allègement appliqué)</option>
          {Object.entries(LIBELLE_CATEGORIE)
            .filter(([k]) => k !== 'a_confirmer')
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </Liste>
      </div>
      <Bouton type="submit" variante="secondaire" disabled={appel.occupe || valeur === (actuelle ?? '')}>
        Enregistrer la catégorie
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

/** Confirmation d'une rubrique de l'annexe par une personne habilitée (`PUT`/`DELETE v1/exercices/:id/annexe/rubriques/:rubrique`). */
export function ConfirmerRubrique({ exerciceId, rubrique, titre, confirmation, note }: { exerciceId: string; rubrique: string; titre: string; confirmation: 'complete' | 'non_applicable' | null; note: string | null }) {
  const appel = useAppel();
  const [texte, setTexte] = useState(note ?? '');
  const id = useId();
  const envoyer = (etat: 'complete' | 'non_applicable') =>
    void appel.executer(`v1/exercices/${exerciceId}/annexe/rubriques/${rubrique}`, { method: 'PUT', json: { etat, ...(texte.trim() ? { note: texte.trim() } : {}) } }, etat === 'complete' ? 'Rubrique confirmée complète.' : 'Rubrique confirmée non applicable.');
  return (
    <div className="space-y-2">
      <div>
        <Libelle htmlFor={id}>Information saisie par le cabinet pour « {titre} » (facultatif)</Libelle>
        <ZoneTexte id={id} rows={2} maxLength={8000} value={texte} onChange={(e) => setTexte(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Bouton variante="secondaire" disabled={appel.occupe} onClick={() => envoyer('complete')} aria-label={`Confirmer complète : ${titre}`}>
          Confirmer complète
        </Bouton>
        <Bouton variante="contour" disabled={appel.occupe} onClick={() => envoyer('non_applicable')} aria-label={`Confirmer non applicable : ${titre}`}>
          Non applicable
        </Bouton>
        {confirmation ? (
          <Bouton variante="contour" disabled={appel.occupe} onClick={() => void appel.executer(`v1/exercices/${exerciceId}/annexe/rubriques/${rubrique}`, { method: 'DELETE' }, 'Confirmation retirée.')} aria-label={`Retirer la confirmation : ${titre}`}>
            Retirer la confirmation
          </Bouton>
        ) : null}
      </div>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </div>
  );
}

/** Reprise d'une proposition du moteur comme écriture d'inventaire proposée (`POST …/inventaire/propositions/:id/reprise`). */
export function ReprendreProposition({ exerciceId, propositionId, libelle }: { exerciceId: string; propositionId: string; libelle: string }) {
  const appel = useAppel();
  return (
    <div className="space-y-2">
      <Bouton
        variante="secondaire"
        disabled={appel.occupe}
        aria-label={`Reprendre comme écriture proposée : ${libelle}`}
        onClick={() => void appel.executer(`v1/exercices/${exerciceId}/inventaire/propositions/${encodeURIComponent(propositionId)}/reprise`, { method: 'POST' }, 'Reprise comme écriture d’inventaire proposée : elle reste un projet, à approuver par une autre personne.')}
      >
        Reprendre comme écriture proposée
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </div>
  );
}
