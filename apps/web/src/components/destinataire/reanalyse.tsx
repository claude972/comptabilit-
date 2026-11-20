'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, SousTitre, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import type { DemandeReanalyse } from '@/lib/destinataire';

/** Demande de SIMULATION : le worker relit le lot sans rien écrire ; le rapport s'affiche ensuite sur la page. */
export function FormulaireSimulation({ entiteId, concernees, lot }: { entiteId: string; concernees: number; lot: number }) {
  const [motif, setMotif] = useState('');
  const { occupe, erreur, succes, executer, setErreur } = useAppel();
  const routeur = useRouter();
  const id = useId();
  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (motif.trim().length < 3) {
      setErreur('Indiquez le motif de la demande (3 caractères au moins).');
      return;
    }
    const r = await executer<DemandeReanalyse>(`v1/dossiers/${entiteId}/reanalyses-destinataire`, { method: 'POST', json: { mode: 'simulation', motif: motif.trim() } }, 'Simulation demandée : le rapport s’affiche dès qu’elle est terminée. Aucune donnée n’est modifiée.');
    if (r) routeur.push(`?demande=${r.id}`);
  }
  return (
    <form onSubmit={envoyer} className="space-y-3" data-formulaire="simulation-reanalyse" aria-labelledby={`${id}-titre`}>
      <SousTitre id={`${id}-titre`} className="text-base">
        1. Simuler la réanalyse d’un lot de {lot} pièce{lot > 1 ? 's' : ''}
      </SousTitre>
      <p className="text-sm text-texte-doux">
        La simulation relit les pièces du lot dans le processus isolé du worker et dit combien changeraient, <strong>sans rien écrire</strong>. {concernees > lot ? `Il reste ${concernees - lot} pièce(s) pour les lots suivants.` : ''}
      </p>
      <div>
        <Libelle htmlFor={`${id}-motif`}>Motif de la demande (obligatoire)</Libelle>
        <ZoneTexte id={`${id}-motif`} name="motif" value={motif} onChange={(e) => setMotif(e.target.value)} required minLength={3} maxLength={2000} />
      </div>
      <Bouton type="submit" variante="secondaire" disabled={occupe}>
        Lancer la simulation
      </Bouton>
      <Retours erreur={erreur} succes={succes} />
    </form>
  );
}

/** Confirmation explicite de l'EXÉCUTION, possible seulement après la simulation terminée dont l'aperçu est affiché. */
export function FormulaireExecution({ entiteId, simulationId, changeraient, validees }: { entiteId: string; simulationId: string; changeraient: number; validees: number }) {
  const [motif, setMotif] = useState('');
  const [lu, setLu] = useState(false);
  const { occupe, erreur, succes, executer, setErreur } = useAppel();
  const routeur = useRouter();
  const id = useId();
  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (!lu) {
      setErreur('Confirmez d’abord avoir lu l’aperçu de la simulation.');
      return;
    }
    if (motif.trim().length < 3) {
      setErreur('Indiquez le motif de la confirmation (3 caractères au moins).');
      return;
    }
    const r = await executer<DemandeReanalyse>(`v1/dossiers/${entiteId}/reanalyses-destinataire`, { method: 'POST', json: { mode: 'execution', motif: motif.trim(), simulationId } }, 'Réanalyse demandée : elle s’exécute dans le worker ; le rapport par pièce s’affiche à la fin.');
    if (r) routeur.push(`?demande=${r.id}`);
  }
  return (
    <form onSubmit={envoyer} className="space-y-3" data-formulaire="execution-reanalyse" aria-labelledby={`${id}-titre`}>
      <SousTitre id={`${id}-titre`} className="text-base">
        2. Confirmer et exécuter
      </SousTitre>
      <Alerte ton="attention">
        L’exécution créera une <strong>nouvelle version d’extraction</strong> pour {changeraient} pièce{changeraient > 1 ? 's' : ''}. Les versions précédentes, les originaux, les corrections humaines et les décisions sont conservés ; une correction humaine du destinataire n’est jamais écrasée.
        {validees > 0 ? ` Parmi les pièces concernées du dossier, ${validees} ${validees > 1 ? 'ont une extraction validée' : 'a une extraction validée'} : la validation reste attachée à la version validée, la nouvelle version est un projet à revalider.` : ''}
      </Alerte>
      <div>
        <Libelle htmlFor={`${id}-motif`}>Motif de la confirmation (obligatoire)</Libelle>
        <ZoneTexte id={`${id}-motif`} name="motif" value={motif} onChange={(e) => setMotif(e.target.value)} required minLength={3} maxLength={2000} />
      </div>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={lu} onChange={(e) => setLu(e.target.checked)} className="mt-1 size-5" />
        <span>J’ai lu le rapport de la simulation et je confirme l’exécution de cette réanalyse.</span>
      </label>
      <Bouton type="submit" disabled={occupe}>
        Confirmer et exécuter la réanalyse
      </Bouton>
      <Retours erreur={erreur} succes={succes} />
    </form>
  );
}

/** Reprise d'une demande interrompue : seules les pièces non terminées sont traitées, sans doublon. */
export function BoutonReprise({ demandeId }: { demandeId: string }) {
  const { occupe, erreur, succes, executer } = useAppel();
  return (
    <div className="space-y-2">
      <Bouton variante="contour" disabled={occupe} onClick={() => void executer(`v1/reanalyses-destinataire/${demandeId}/reprendre`, { method: 'POST' }, 'Reprise demandée : seules les pièces non terminées seront traitées.')}>
        Reprendre la demande
      </Bouton>
      <Retours erreur={erreur} succes={succes} />
    </div>
  );
}
