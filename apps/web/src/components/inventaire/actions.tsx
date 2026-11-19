'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useId, useState } from 'react';
import { messageErreur, useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, Saisie, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { PHRASE_EXPORT, type SaisieEcriture, ligneVide, propositionDepuis, totauxSaisie } from '@/lib/inventaire';
import { formaterMontant } from '@/lib/montants';
import { ErreurHttp, ErreurReseau } from '@/lib/televersement/moteur';
import { ENTETE_CSRF, appelBff } from '@/lib/televersement/transport-bff';
import { SelecteurPieces } from '@/components/document/selecteur-pieces';
import type { PieceChoisie } from '@/lib/pieces-jointes';

const initiale = (): SaisieEcriture => ({ dateEcriture: '', libelle: '', justification: '', calcul: '', lignes: [ligneVide(), ligneVide()] });

/** Proposition d'une écriture d'inventaire (`POST v1/exercices/:id/ecritures-inventaire`). Les totaux affichés sont additionnés en centimes entiers. */
export function ProposerEcriture({ exerciceId, dossierId, debut, fin }: { exerciceId: string; dossierId: string; debut: string; fin: string }) {
  const routeur = useRouter();
  const [f, setF] = useState<SaisieEcriture>(initiale);
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [refus, setRefus] = useState<{ message: string; totalDebit?: string; totalCredit?: string; ecart?: string } | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [pieces, setPieces] = useState<PieceChoisie[]>([]);
  const id = useId();
  const totaux = totauxSaisie(f.lignes);
  const majLigne = (i: number, m: Partial<SaisieEcriture['lignes'][number]>) => setF((v) => ({ ...v, lignes: v.lignes.map((l, j) => (j === i ? { ...l, ...m } : l)) }));

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    setRefus(null);
    setSucces(null);
    const p = propositionDepuis(f);
    if (!p.ok) return setErreurs(p.erreurs);
    setErreurs([]);
    setOccupe(true);
    try {
      await appelBff(`v1/exercices/${exerciceId}/ecritures-inventaire`, { method: 'POST', json: { ...p.corps, pieces: pieces.map((x) => x.id) } });
      setPieces([]);
      setSucces('Écriture proposée. Elle n’a aucun effet tant qu’elle n’est pas approuvée par une autre personne habilitée.');
      setF(initiale());
      routeur.refresh();
    } catch (err) {
      // L'API renvoie les totaux et l'écart qu'elle a calculés quand elle refuse une écriture déséquilibrée.
      const corps = err instanceof ErreurHttp ? (err.corps as { totalDebit?: unknown; totalCredit?: unknown; ecart?: unknown } | null) : null;
      const texte = (v: unknown) => (typeof v === 'string' ? v : undefined);
      setRefus({ message: messageErreur(err), totalDebit: texte(corps?.totalDebit), totalCredit: texte(corps?.totalCredit), ecart: texte(corps?.ecart) });
    } finally {
      setOccupe(false);
    }
  }

  return (
    <form onSubmit={envoyer} className="space-y-3" data-formulaire="proposer-ecriture" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Libelle htmlFor={`${id}-date`}>Date de l’écriture (dans l’exercice)</Libelle>
          <Saisie id={`${id}-date`} type="date" min={debut} max={fin} value={f.dateEcriture} onChange={(e) => setF((v) => ({ ...v, dateEcriture: e.target.value }))} />
        </div>
        <div>
          <Libelle htmlFor={`${id}-libelle`}>Libellé</Libelle>
          <Saisie id={`${id}-libelle`} value={f.libelle} maxLength={200} onChange={(e) => setF((v) => ({ ...v, libelle: e.target.value }))} autoComplete="off" />
        </div>
        <div>
          <Libelle htmlFor={`${id}-justification`}>Justification (pourquoi cette écriture)</Libelle>
          <ZoneTexte id={`${id}-justification`} value={f.justification} maxLength={4000} onChange={(e) => setF((v) => ({ ...v, justification: e.target.value }))} />
        </div>
        <div>
          <Libelle htmlFor={`${id}-calcul`}>Calcul (détail du montant)</Libelle>
          <ZoneTexte id={`${id}-calcul`} value={f.calcul} maxLength={4000} onChange={(e) => setF((v) => ({ ...v, calcul: e.target.value }))} />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="font-medium">Lignes de l’écriture</legend>
        <ul className="space-y-2">
          {f.lignes.map((l, i) => (
            <li key={i} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-bordure p-2 lg:grid-cols-[10rem_1fr_9rem_9rem_auto]" data-ligne={i + 1}>
              <div>
                <Libelle htmlFor={`${id}-c-${i}`}>Compte (ligne {i + 1})</Libelle>
                <Saisie id={`${id}-c-${i}`} inputMode="numeric" value={l.compteNum} maxLength={12} onChange={(e) => majLigne(i, { compteNum: e.target.value })} autoComplete="off" />
              </div>
              <div>
                <Libelle htmlFor={`${id}-l-${i}`}>Libellé du compte (ligne {i + 1})</Libelle>
                <Saisie id={`${id}-l-${i}`} value={l.compteLib} maxLength={200} onChange={(e) => majLigne(i, { compteLib: e.target.value })} autoComplete="off" />
              </div>
              <div>
                <Libelle htmlFor={`${id}-d-${i}`}>Débit (ligne {i + 1})</Libelle>
                <Saisie id={`${id}-d-${i}`} inputMode="decimal" value={l.debit} maxLength={20} onChange={(e) => majLigne(i, { debit: e.target.value })} autoComplete="off" className="text-right tabular-nums" />
              </div>
              <div>
                <Libelle htmlFor={`${id}-k-${i}`}>Crédit (ligne {i + 1})</Libelle>
                <Saisie id={`${id}-k-${i}`} inputMode="decimal" value={l.credit} maxLength={20} onChange={(e) => majLigne(i, { credit: e.target.value })} autoComplete="off" className="text-right tabular-nums" />
              </div>
              <Bouton variante="contour" disabled={f.lignes.length <= 2} aria-label={`Supprimer la ligne ${i + 1}`} onClick={() => setF((v) => ({ ...v, lignes: v.lignes.filter((_, j) => j !== i) }))}>
                Supprimer
              </Bouton>
            </li>
          ))}
        </ul>
        <Bouton variante="secondaire" disabled={f.lignes.length >= 200} onClick={() => setF((v) => ({ ...v, lignes: [...v.lignes, ligneVide()] }))}>
          Ajouter une ligne
        </Bouton>
      </fieldset>
      <p className="tabular-nums" role="status" aria-live="polite" data-testid="totaux-saisie" data-equilibre={totaux.equilibre}>
        Total débit : <strong data-testid="total-debit">{formaterMontant(totaux.totalDebit)}</strong> · Total crédit : <strong data-testid="total-credit">{formaterMontant(totaux.totalCredit)}</strong> ·{' '}
        {totaux.invalides ? (
          <span>{totaux.invalides} montant(s) illisible(s), non compté(s)</span>
        ) : totaux.equilibre ? (
          <span>équilibrée</span>
        ) : (
          <span>
            écart débit − crédit : <strong data-testid="ecart-saisie">{formaterMontant(totaux.ecart)}</strong>
          </span>
        )}
      </p>
      <p className="text-sm text-texte-doux">Ces totaux sont indicatifs : l’équilibre est vérifié par le serveur à l’enregistrement.</p>
      {erreurs.length ? (
        <Alerte ton="danger" role="alert">
          <ul className="list-disc pl-5">
            {erreurs.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Alerte>
      ) : null}
      {refus ? (
        <Alerte ton="danger" role="alert" data-testid="refus-api">
          <p>{refus.message}</p>
          {refus.ecart !== undefined ? (
            <p className="tabular-nums" data-testid="ecart-api">
              Calcul du serveur — total débit : {formaterMontant(refus.totalDebit)} · total crédit : {formaterMontant(refus.totalCredit)} · écart : {formaterMontant(refus.ecart)}
            </p>
          ) : null}
        </Alerte>
      ) : null}
      <SelecteurPieces entiteId={dossierId} selection={pieces} surChangement={setPieces} libelle="Pièces justificatives (facultatif)" aide="Pièces du dossier qui justifient l’écriture proposée." />
      <Bouton type="submit" disabled={occupe}>
        Proposer l’écriture (projet)
      </Bouton>
      <div role="status" aria-live="polite">
        {succes ? <Alerte ton="succes">{succes}</Alerte> : null}
      </div>
    </form>
  );
}

/** Décision d'une personne habilitée en révision, autre que l'auteur (`POST v1/ecritures-inventaire/:id/decision`). */
export function DeciderEcriture({ ecritureId, aRevoir }: { ecritureId: string; aRevoir: boolean }) {
  const appel = useAppel();
  const [rejet, setRejet] = useState(false);
  const [motif, setMotif] = useState('');
  const id = useId();
  const chemin = `v1/ecritures-inventaire/${ecritureId}/decision`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Bouton variante="secondaire" disabled={appel.occupe || aRevoir} title={aRevoir ? 'Les données importées ont changé : cette proposition doit être revue et proposée à nouveau.' : undefined} onClick={() => void appel.executer(chemin, { method: 'POST', json: { decision: 'approuver' } }, 'Écriture approuvée : elle entre dans la balance ajustée de travail.')}>
          Approuver
        </Bouton>
        {!rejet ? (
          <Bouton variante="danger" disabled={appel.occupe} onClick={() => setRejet(true)}>
            Rejeter
          </Bouton>
        ) : null}
      </div>
      {rejet ? (
        <form
          className="space-y-2"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (!motif.trim()) return appel.setErreur('Un motif est requis pour rejeter.');
            await appel.executer(chemin, { method: 'POST', json: { decision: 'rejeter', motif: motif.trim() } }, 'Écriture rejetée.');
          }}
        >
          <Libelle htmlFor={id}>Motif du rejet (obligatoire)</Libelle>
          <ZoneTexte id={id} value={motif} maxLength={2000} onChange={(e) => setMotif(e.target.value)} className="min-h-16" />
          <div className="flex flex-wrap gap-2">
            <Bouton type="submit" variante="danger" disabled={appel.occupe}>
              Confirmer le rejet
            </Bouton>
            <Bouton variante="contour" onClick={() => setRejet(false)}>
              Annuler
            </Bouton>
          </div>
        </form>
      ) : null}
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </div>
  );
}

/** Export CSV (`POST …/ecritures-inventaire/export`) : le fichier est remis à l'utilisateur, rien n'est transmis à un logiciel tiers. */
export function ExporterEcritures({ exerciceId }: { exerciceId: string }) {
  const routeur = useRouter();
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  async function exporter() {
    setOccupe(true);
    setErreur(null);
    setSucces(null);
    try {
      let reponse: Response;
      try {
        reponse = await fetch(`/api/bff/v1/exercices/${exerciceId}/ecritures-inventaire/export`, { method: 'POST', headers: ENTETE_CSRF, credentials: 'same-origin', cache: 'no-store' });
      } catch {
        throw new ErreurReseau('Connexion interrompue');
      }
      if (!reponse.ok) throw new ErreurHttp(reponse.status, await reponse.json().catch(() => null));
      const fichier = await reponse.blob();
      const nom = /filename="([^"]+)"/.exec(reponse.headers.get('content-disposition') ?? '')?.[1] ?? `ecritures-inventaire-${exerciceId}.csv`;
      const url = URL.createObjectURL(fichier);
      const lien = document.createElement('a');
      lien.href = url;
      lien.download = nom;
      document.body.append(lien);
      lien.click();
      lien.remove();
      URL.revokeObjectURL(url);
      setSucces('Fichier CSV remis. Les écritures approuvées sont marquées « exportées » ; leur intégration dans votre logiciel comptable reste à faire par vous.');
      routeur.refresh();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setOccupe(false);
    }
  }
  return (
    <div className="space-y-2">
      <p data-testid="phrase-export">{PHRASE_EXPORT}</p>
      <Bouton variante="secondaire" disabled={occupe} onClick={() => void exporter()}>
        Exporter les écritures approuvées (CSV)
      </Bouton>
      <Retours erreur={erreur} succes={succes} />
    </div>
  );
}
