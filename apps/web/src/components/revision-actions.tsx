'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Etiquette, Libelle, Liste, SousTitre, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { ACTIONS_CONSTAT, LIBELLE_STATUT_LOT } from '@/lib/libelles';
import { appelBff } from '@/lib/televersement/transport-bff';
import { type LotImport, type Niveau, auMoins } from '@/lib/types-api';

/** Bouton déclenchant une action asynchrone du serveur (`POST`), avec retour d'état. */
export function BoutonAction({ chemin, libelle, succes, variante = 'secondaire' }: { chemin: string; libelle: string; succes: string; variante?: 'primaire' | 'secondaire' | 'contour' }) {
  const appel = useAppel();
  return (
    <div className="space-y-2">
      <Bouton variante={variante} disabled={appel.occupe} onClick={() => void appel.executer(chemin, { method: 'POST' }, succes)}>
        {libelle}
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </div>
  );
}

/** Recharge périodiquement les données serveur de la page tant qu'un traitement est en cours. */
export function ActualisationPeriodique({ secondes = 3, libelle }: { secondes?: number; libelle: string }) {
  const routeur = useRouter();
  useEffect(() => {
    const minuterie = setInterval(() => {
      if (document.visibilityState === 'visible') routeur.refresh();
    }, secondes * 1000);
    return () => clearInterval(minuterie);
  }, [routeur, secondes]);
  return (
    <p role="status" className="text-sm text-texte-doux">
      {libelle} — actualisation automatique toutes les {secondes} secondes.
    </p>
  );
}

/** Suivi d'un import en cours : interroge `GET v1/imports/:id` jusqu'à un statut final, puis recharge le rapport. */
export function SuiviImport({ lotId, initial, unite = 'lignes enregistrées' }: { lotId: string; initial: Pick<LotImport, 'statut' | 'progression'>; unite?: string }) {
  const routeur = useRouter();
  const [etat, setEtat] = useState(initial);
  const [erreur, setErreur] = useState(false);
  useEffect(() => {
    let arrete = false;
    const minuterie = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const lot = await appelBff<LotImport>(`v1/imports/${lotId}`);
        if (arrete) return;
        setErreur(false);
        setEtat({ statut: lot.statut, progression: lot.progression });
        if (lot.statut !== 'en_attente' && lot.statut !== 'en_cours') {
          clearInterval(minuterie);
          routeur.refresh();
        }
      } catch {
        if (!arrete) setErreur(true);
      }
    }, 2000);
    return () => {
      arrete = true;
      clearInterval(minuterie);
    };
  }, [lotId, routeur]);
  return (
    <div className="space-y-2" data-testid="suivi-import">
      <p role="status" aria-live="polite" className="flex flex-wrap items-center gap-2">
        <Etiquette ton="info">{LIBELLE_STATUT_LOT[etat.statut] ?? etat.statut}</Etiquette>
        {etat.statut === 'en_attente' ? 'L’analyse va démarrer.' : `${etat.progression.toLocaleString('fr-FR')} ${unite} jusqu’ici.`}
      </p>
      {/* Le nombre total de lignes n'est pas connu à l'avance : barre indéterminée. */}
      <progress aria-label="Import en cours" />
      {erreur ? <p className="text-sm">Suivi momentanément indisponible ; nouvelle tentative en cours.</p> : null}
    </div>
  );
}

/** Actions de revue d'un constat (`PATCH v1/constats/:id`). Seules les actions permises par l'habilitation sont proposées. */
export function ActionsConstat({ constatId, niveau, membres, affecteA }: { constatId: string; niveau: Niveau; membres: Array<{ utilisateurId: string; nom: string }>; affecteA: string | null }) {
  // « Affecter » n'est proposé que si la liste des personnes habilitées sur le dossier est disponible.
  const possibles = ACTIONS_CONSTAT.filter((a) => auMoins(niveau, a.niveau) && (a.action !== 'affecter' || membres.length > 0));
  const [destinataire, setDestinataire] = useState(affecteA ?? '');
  const [action, setAction] = useState(possibles[0]?.action ?? '');
  const [motif, setMotif] = useState('');
  const appel = useAppel();
  const id = useId();
  const regle = possibles.find((a) => a.action === action);
  if (!possibles.length || !regle) return <p className="text-texte-doux">Votre habilitation sur ce dossier ne permet pas de traiter ce constat.</p>;

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (regle!.motifRequis && !motif.trim()) {
      appel.setErreur('Un motif est requis pour cette action.');
      return;
    }
    if (action === 'affecter' && !destinataire) {
      appel.setErreur('Choisissez la personne à qui affecter ce constat.');
      return;
    }
    const ok = await appel.executer(`v1/constats/${constatId}`, { method: 'PATCH', json: { action, ...(motif.trim() ? { motif: motif.trim() } : {}), ...(action === 'affecter' ? { affecteA: destinataire } : {}) } }, `Action enregistrée : ${regle!.libelle.toLowerCase()}.`);
    if (ok) setMotif('');
  }
  return (
    <form onSubmit={envoyer} className="space-y-3" data-formulaire="constat">
      <SousTitre className="text-base">Traiter ce constat</SousTitre>
      <div>
        <Libelle htmlFor={`${id}-action`}>Action</Libelle>
        <Liste id={`${id}-action`} value={action} onChange={(e) => setAction(e.target.value)}>
          {possibles.map((a) => (
            <option key={a.action} value={a.action}>
              {a.libelle}
              {a.niveau === 'revision' ? ' (réviseur)' : ''}
            </option>
          ))}
        </Liste>
      </div>
      {action === 'affecter' ? (
        <div>
          <Libelle htmlFor={`${id}-affecte`}>Affecter à</Libelle>
          <Liste id={`${id}-affecte`} value={destinataire} onChange={(e) => setDestinataire(e.target.value)}>
            <option value="">Choisir une personne habilitée…</option>
            {membres.map((m) => (
              <option key={m.utilisateurId} value={m.utilisateurId}>
                {m.nom}
              </option>
            ))}
          </Liste>
        </div>
      ) : null}
      <div>
        <Libelle htmlFor={`${id}-motif`}>{regle.motifRequis ? 'Motif (obligatoire)' : 'Motif (facultatif)'}</Libelle>
        <ZoneTexte id={`${id}-motif`} value={motif} onChange={(e) => setMotif(e.target.value)} required={regle.motifRequis} maxLength={4000} />
      </div>
      <Bouton type="submit" disabled={appel.occupe}>
        Enregistrer
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}
