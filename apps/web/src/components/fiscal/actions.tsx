'use client';

import { useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Libelle, Liste, Saisie, ZoneTexte } from '@/components/ui/base';
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

export interface Immobilisation {
  id: string;
  libelle: string;
  compteImmobilisation: string;
  baseAmortissable: string;
  dateMiseEnService: string;
  dureeMois: number;
  amortissementsAnterieurs: string | null;
}

/** Saisie d'une immobilisation dans le fichier du dossier (`POST v1/dossiers/:id/immobilisations`). */
export function SaisirImmobilisation({ dossierId }: { dossierId: string }) {
  const appel = useAppel();
  const vide = { libelle: '', compte: '', base: '', date: '', duree: '', anterieurs: '' };
  const [f, setF] = useState(vide);
  const id = useId();
  const maj = (m: Partial<typeof vide>) => setF((v) => ({ ...v, ...m }));
  const decimal = (v: string) => v.trim().replace(/\s/g, '').replace(',', '.');
  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      aria-label="Saisir une immobilisation"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await appel.executer(
          `v1/dossiers/${dossierId}/immobilisations`,
          { method: 'POST', json: { libelle: f.libelle, compteImmobilisation: f.compte.trim(), baseAmortissable: decimal(f.base), dateMiseEnService: f.date, dureeMois: Number(f.duree), ...(f.anterieurs.trim() ? { amortissementsAnterieurs: decimal(f.anterieurs) } : {}) } },
          'Immobilisation enregistrée : la dotation de l’exercice figure dans les propositions du moteur.',
        );
        if (r) setF(vide);
      }}
    >
      <div>
        <Libelle htmlFor={`${id}-lib`}>Désignation</Libelle>
        <Saisie id={`${id}-lib`} required maxLength={200} value={f.libelle} onChange={(e) => maj({ libelle: e.target.value })} autoComplete="off" />
      </div>
      <div>
        <Libelle htmlFor={`${id}-compte`}>Compte d’immobilisation (classe 2)</Libelle>
        <Saisie id={`${id}-compte`} required inputMode="numeric" pattern="2[0-9]{2,11}" value={f.compte} onChange={(e) => maj({ compte: e.target.value })} autoComplete="off" />
      </div>
      <div>
        <Libelle htmlFor={`${id}-base`}>Base amortissable (€)</Libelle>
        <Saisie id={`${id}-base`} required inputMode="decimal" value={f.base} onChange={(e) => maj({ base: e.target.value })} autoComplete="off" />
      </div>
      <div>
        <Libelle htmlFor={`${id}-date`}>Date de mise en service</Libelle>
        <Saisie id={`${id}-date`} type="date" required value={f.date} onChange={(e) => maj({ date: e.target.value })} />
      </div>
      <div>
        <Libelle htmlFor={`${id}-duree`}>Durée d’amortissement (mois)</Libelle>
        <Saisie id={`${id}-duree`} required inputMode="numeric" pattern="[0-9]{1,4}" value={f.duree} onChange={(e) => maj({ duree: e.target.value })} autoComplete="off" />
      </div>
      <div>
        <Libelle htmlFor={`${id}-ant`}>Amortissements antérieurs (€, facultatif)</Libelle>
        <Saisie id={`${id}-ant`} inputMode="decimal" value={f.anterieurs} onChange={(e) => maj({ anterieurs: e.target.value })} autoComplete="off" />
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <Bouton type="submit" variante="secondaire" disabled={appel.occupe}>
          Enregistrer l’immobilisation
        </Bouton>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <Retours erreur={appel.erreur} succes={appel.succes} />
      </div>
    </form>
  );
}

export function RetirerImmobilisation({ dossierId, immobilisation }: { dossierId: string; immobilisation: Immobilisation }) {
  const appel = useAppel();
  return (
    <>
      <Bouton variante="contour" disabled={appel.occupe} aria-label={`Retirer du fichier : ${immobilisation.libelle}`} onClick={() => void appel.executer(`v1/dossiers/${dossierId}/immobilisations/${immobilisation.id}`, { method: 'DELETE' }, 'Immobilisation retirée du fichier.')}>
        Retirer
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </>
  );
}
