'use client';

import { type FormEvent, useEffect, useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, Saisie, SousTitre, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { CHAMPS_DESTINATAIRE, type ChampDestinataire, LIBELLE_CHAMP_DESTINATAIRE, type LigneDestinataire } from '@/lib/destinataire';

type Valeurs = Record<ChampDestinataire, string>;
const depuis = (lignes: LigneDestinataire[]): Valeurs => Object.fromEntries(CHAMPS_DESTINATAIRE.map((c) => [c, lignes.find((l) => l.champ === c)?.effective ?? ''])) as Valeurs;

const PRECISIONS: Record<ChampDestinataire, { maxLength: number; inputMode?: 'numeric'; aide: string }> = {
  destinataireNom: { maxLength: 200, aide: 'Raison sociale telle qu’elle figure sur la pièce.' },
  destinataireSiren: { maxLength: 11, inputMode: 'numeric', aide: '9 chiffres ; la clé de contrôle est vérifiée.' },
  destinataireSiret: { maxLength: 17, inputMode: 'numeric', aide: '14 chiffres, commençant par le SIREN.' },
  destinataireTva: { maxLength: 20, aide: 'Par exemple FR96552100554.' },
  destinatairePays: { maxLength: 2, aide: 'Code ISO à 2 lettres, par exemple FR.' },
};

/**
 * Correction manuelle du destinataire (`PUT v1/documents/:id/destinataire`) : motif obligatoire, nouvelle version
 * d'extraction non validée. Seuls les champs modifiés sont envoyés ; vider un champ le déclare « sans valeur ».
 */
export function FormulaireDestinataire({ documentId, version, lignes }: { documentId: string; version: number; lignes: LigneDestinataire[] }) {
  const initiales = depuis(lignes);
  const [valeurs, setValeurs] = useState<Valeurs>(initiales);
  const [motif, setMotif] = useState('');
  const { occupe, erreur, succes, executer, setErreur } = useAppel();
  const id = useId();
  // La page se recharge après l'enregistrement : le formulaire repart des valeurs retenues par le serveur.
  const signature = JSON.stringify(initiales);
  useEffect(() => {
    setValeurs(JSON.parse(signature) as Valeurs);
  }, [signature, version]);
  const modifies = CHAMPS_DESTINATAIRE.filter((c) => valeurs[c].trim() !== initiales[c]);

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (modifies.length === 0) {
      setErreur('Modifiez au moins un champ du destinataire avant d’enregistrer.');
      return;
    }
    if (motif.trim().length < 3) {
      setErreur('Indiquez le motif de la correction (3 caractères au moins).');
      return;
    }
    const champs = Object.fromEntries(modifies.map((c) => [c, valeurs[c].trim() === '' ? null : valeurs[c].trim()]));
    const r = await executer(`v1/documents/${documentId}/destinataire`, { method: 'PUT', json: { champs, motif: motif.trim() } }, 'Correction enregistrée : une nouvelle version de l’extraction, non validée, a été créée. L’original et les versions précédentes sont conservés.');
    if (r) setMotif('');
  }

  return (
    <form onSubmit={envoyer} className="space-y-3" data-formulaire="destinataire" aria-labelledby={`${id}-titre`}>
      <SousTitre id={`${id}-titre`} className="text-base">
        Corriger le destinataire
      </SousTitre>
      <p className="text-sm text-texte-doux">
        Votre saisie prime sur la lecture automatique, qui reste visible à côté. Une réanalyse ne l’écrasera jamais : elle signale seulement un désaccord. Laissez un champ vide pour dire qu’il n’y a pas de valeur.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CHAMPS_DESTINATAIRE.map((c) => (
          <div key={c}>
            <Libelle htmlFor={`${id}-${c}`}>{LIBELLE_CHAMP_DESTINATAIRE[c]}</Libelle>
            <Saisie
              id={`${id}-${c}`}
              name={c}
              type="text"
              inputMode={PRECISIONS[c].inputMode}
              maxLength={PRECISIONS[c].maxLength}
              value={valeurs[c]}
              onChange={(e) => setValeurs({ ...valeurs, [c]: e.target.value })}
              autoComplete="off"
              aria-describedby={`${id}-${c}-aide`}
            />
            <p id={`${id}-${c}-aide`} className="mt-1 text-sm text-texte-doux">
              {PRECISIONS[c].aide}
            </p>
          </div>
        ))}
      </div>
      <div>
        <Libelle htmlFor={`${id}-motif`}>Motif de la correction (obligatoire)</Libelle>
        <ZoneTexte id={`${id}-motif`} name="motif" value={motif} onChange={(e) => setMotif(e.target.value)} required minLength={3} maxLength={2000} />
      </div>
      <p className="text-sm text-texte-doux" aria-live="polite">
        {modifies.length ? `Champs modifiés : ${modifies.map((c) => LIBELLE_CHAMP_DESTINATAIRE[c]).join(', ')}.` : 'Aucun champ modifié.'}
      </p>
      <Alerte ton="neutre" className="text-sm">
        La correction crée une nouvelle version de l’extraction (projet, à valider) et est inscrite au journal d’audit avec les valeurs avant et après. Le sens de la pièce et l’appariement des tiers sont recalculés à partir de cette valeur ; les décisions déjà prises ne sont jamais écrasées.
      </Alerte>
      <Bouton type="submit" variante="secondaire" disabled={occupe}>
        Enregistrer la correction du destinataire
      </Bouton>
      <Retours erreur={erreur} succes={succes} />
    </form>
  );
}
