'use client';

import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { messageErreur, useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, Liste, Saisie, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { libelleTotal } from '@/lib/analyse';
import { formaterDate } from '@/lib/montants';
import { EXPLICATION_REGLEMENTAIRE, type ImpactRegle, type Saisies, afficherParametre, champsParametres, parametresDepuis, saisiesInitiales } from '@/lib/regles';
import { appelBff } from '@/lib/televersement/transport-bff';
import type { ControleCatalogue, Exercice } from '@/lib/types-api';

type ControleReduit = Pick<ControleCatalogue, 'id' | 'titre' | 'parametresParDefaut'> & { reglementaire: boolean };
interface DossierReduit {
  id: string;
  raisonSociale: string;
}

function Erreurs({ erreurs }: { erreurs: string[] }) {
  if (!erreurs.length) return null;
  return (
    <Alerte ton="danger" role="alert">
      <ul className="list-disc pl-5">
        {erreurs.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </Alerte>
  );
}

/** Proposition d'une règle (`POST v1/regles`). Les champs de paramètres découlent de `parametresParDefaut` du contrôle choisi. */
export function ProposerRegle({ controles, dossiers, cabinetPossible }: { controles: ControleReduit[]; dossiers: DossierReduit[]; cabinetPossible: boolean }) {
  const [controleId, setControleId] = useState('');
  const [portee, setPortee] = useState<'cabinet' | 'dossier'>(cabinetPossible ? 'cabinet' : 'dossier');
  const [entiteId, setEntiteId] = useState('');
  const [saisies, setSaisies] = useState<Saisies>({});
  const [motif, setMotif] = useState('');
  const [erreurs, setErreurs] = useState<string[]>([]);
  const appel = useAppel();
  const id = useId();
  const controle = controles.find((c) => c.id === controleId);
  const champs = useMemo(() => (controle && !controle.reglementaire ? champsParametres(controle.parametresParDefaut ?? {}) : []), [controle]);

  function choisir(nouveau: string) {
    setControleId(nouveau);
    const c = controles.find((x) => x.id === nouveau);
    setSaisies(c && !c.reglementaire ? saisiesInitiales(champsParametres(c.parametresParDefaut ?? {})) : {});
    setErreurs([]);
  }
  async function envoyer(e: FormEvent) {
    e.preventDefault();
    const pb: string[] = [];
    if (!controle) pb.push('Choisissez un contrôle.');
    else if (controle.reglementaire) pb.push(EXPLICATION_REGLEMENTAIRE);
    if (portee === 'dossier' && !entiteId) pb.push('Choisissez le dossier concerné.');
    if (motif.trim().length < 5) pb.push('Le motif est obligatoire (5 caractères au moins).');
    const p = controle && !controle.reglementaire ? parametresDepuis(champs, saisies) : null;
    if (p && !p.ok) pb.push(...p.erreurs);
    if (pb.length || !p || !p.ok) return setErreurs(pb);
    setErreurs([]);
    const r = await appel.executer('v1/regles', { method: 'POST', json: { controleId, ...(portee === 'dossier' ? { entiteId } : {}), parametres: p.parametres, motif: motif.trim() } }, 'Règle proposée. Elle n’a aucun effet tant qu’elle n’est pas approuvée.');
    if (r) {
      setMotif('');
      choisir('');
    }
  }
  return (
    <form onSubmit={envoyer} className="space-y-3" data-formulaire="proposer-regle" noValidate>
      <div>
        <Libelle htmlFor={`${id}-controle`}>Contrôle</Libelle>
        <Liste id={`${id}-controle`} value={controleId} onChange={(e) => choisir(e.target.value)}>
          <option value="">Choisir…</option>
          {controles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} — {c.titre}
              {c.reglementaire ? ' (non paramétrable : règle réglementaire)' : ''}
            </option>
          ))}
        </Liste>
      </div>
      {controle?.reglementaire ? (
        <Alerte ton="attention" data-testid="non-parametrable">
          <strong>Non paramétrable.</strong> {EXPLICATION_REGLEMENTAIRE}
        </Alerte>
      ) : null}
      {controle && !controle.reglementaire ? (
        <>
          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium">Portée</legend>
            <label className="flex min-h-11 items-center gap-2">
              <input autoComplete="off" type="radio" name={`${id}-portee`} className="size-5" checked={portee === 'cabinet'} disabled={!cabinetPossible} onChange={() => setPortee('cabinet')} /> Tout le cabinet
            </label>
            {!cabinetPossible ? <p className="text-sm text-texte-doux">Une préférence de tout le cabinet se propose à partir du rôle de réviseur.</p> : null}
            <label className="flex min-h-11 items-center gap-2">
              <input autoComplete="off" type="radio" name={`${id}-portee`} className="size-5" checked={portee === 'dossier'} onChange={() => setPortee('dossier')} /> Un dossier
            </label>
            {portee === 'dossier' ? (
              <div>
                <Libelle htmlFor={`${id}-dossier`}>Dossier concerné</Libelle>
                <Liste id={`${id}-dossier`} value={entiteId} onChange={(e) => setEntiteId(e.target.value)}>
                  <option value="">Choisir…</option>
                  {dossiers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.raisonSociale}
                    </option>
                  ))}
                </Liste>
              </div>
            ) : null}
          </fieldset>
          <fieldset className="space-y-2" data-testid="parametres-regle">
            <legend className="mb-1 font-medium">Paramètres (valeurs par défaut du contrôle préremplies)</legend>
            {champs.length === 0 ? <p className="text-texte-doux">Ce contrôle n’a aucun paramètre.</p> : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {champs.map((c) =>
                c.genre === 'fige' ? (
                  <p key={c.cle} className="text-sm text-texte-doux">
                    {libelleTotal(c.cle)} (<code>{c.cle}</code>) : paramètre structuré, non modifiable depuis cet écran. Valeur par défaut : {afficherParametre(c.defaut)}
                  </p>
                ) : c.genre === 'booleen' ? (
                  <label key={c.cle} className="flex min-h-11 items-center gap-2">
                    <input autoComplete="off" type="checkbox" className="size-5" checked={saisies[c.cle] === true} onChange={(e) => setSaisies((v) => ({ ...v, [c.cle]: e.target.checked }))} />
                    <span>
                      {libelleTotal(c.cle)} (<code>{c.cle}</code>)
                    </span>
                  </label>
                ) : (
                  <div key={c.cle}>
                    <Libelle htmlFor={`${id}-p-${c.cle}`}>
                      {libelleTotal(c.cle)} (<code>{c.cle}</code>)
                    </Libelle>
                    <Saisie
                      id={`${id}-p-${c.cle}`}
                      inputMode={c.genre === 'decimal' || c.genre === 'nombre' ? 'decimal' : c.genre === 'entier' ? 'numeric' : 'text'}
                      value={String(saisies[c.cle] ?? '')}
                      onChange={(e) => setSaisies((v) => ({ ...v, [c.cle]: e.target.value }))}
                      aria-describedby={`${id}-a-${c.cle}`}
                      autoComplete="off"
                      maxLength={500}
                    />
                    <p id={`${id}-a-${c.cle}`} className="text-sm text-texte-doux">
                      {c.genre === 'decimal' ? 'Nombre décimal (montant ou taux), transmis tel quel sans arrondi. ' : c.genre === 'liste' ? 'Valeurs séparées par des virgules. ' : c.genre === 'entier' ? 'Nombre entier. ' : ''}
                      Par défaut : {afficherParametre(c.defaut)}
                    </p>
                  </div>
                ),
              )}
            </div>
          </fieldset>
          <div>
            <Libelle htmlFor={`${id}-motif`}>Motif de la proposition (obligatoire)</Libelle>
            <ZoneTexte id={`${id}-motif`} value={motif} maxLength={2000} onChange={(e) => setMotif(e.target.value)} />
          </div>
        </>
      ) : null}
      <Erreurs erreurs={erreurs} />
      <Bouton type="submit" disabled={appel.occupe || !controle || controle.reglementaire}>
        Proposer cette règle
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

/** Mesure d'impact (`POST v1/regles/:id/impact`) sur un exercice choisi : rien n'est enregistré dans la révision. */
export function MesurerImpact({ regleId, entiteId, dossiers, dejaMesure }: { regleId: string; entiteId: string | null; dossiers: DossierReduit[]; dejaMesure: boolean }) {
  const [ouvert, setOuvert] = useState(false);
  const [dossier, setDossier] = useState(entiteId ?? '');
  const [exercices, setExercices] = useState<Exercice[] | null>(null);
  const [exerciceId, setExerciceId] = useState('');
  const [chargement, setChargement] = useState<string | null>(null);
  const [resultat, setResultat] = useState<ImpactRegle | null>(null);
  const appel = useAppel();
  const id = useId();

  useEffect(() => {
    if (!ouvert || !dossier) return;
    let annule = false;
    setExercices(null);
    setExerciceId('');
    setChargement(null);
    appelBff<Exercice[]>(`v1/dossiers/${dossier}/exercices`)
      .then((liste) => {
        if (annule) return;
        setExercices(liste);
        setExerciceId(liste[0]?.id ?? '');
      })
      .catch((e: unknown) => {
        if (!annule) setChargement(`Exercices indisponibles pour ce dossier. ${messageErreur(e)}`);
      });
    return () => {
      annule = true;
    };
  }, [ouvert, dossier]);

  if (!ouvert) {
    return (
      <Bouton variante="secondaire" onClick={() => setOuvert(true)}>
        {dejaMesure ? 'Mesurer à nouveau l’impact' : 'Mesurer l’impact'}
      </Bouton>
    );
  }
  return (
    <form
      className="space-y-2 rounded-lg border border-bordure p-3"
      data-formulaire="mesurer-impact"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!exerciceId) return appel.setErreur('Choisissez l’exercice sur lequel mesurer l’impact.');
        const r = await appel.executer<ImpactRegle>(`v1/regles/${regleId}/impact`, { method: 'POST', json: { exerciceId } }, 'Impact mesuré. Rien n’a été modifié dans la révision.');
        if (r) setResultat(r);
      }}
    >
      {!entiteId ? (
        <div>
          <Libelle htmlFor={`${id}-dossier`}>Dossier servant à la mesure</Libelle>
          <Liste id={`${id}-dossier`} value={dossier} onChange={(e) => setDossier(e.target.value)}>
            <option value="">Choisir…</option>
            {dossiers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.raisonSociale}
              </option>
            ))}
          </Liste>
        </div>
      ) : null}
      {dossier ? (
        <div>
          <Libelle htmlFor={`${id}-exercice`}>Exercice</Libelle>
          <Liste id={`${id}-exercice`} value={exerciceId} onChange={(e) => setExerciceId(e.target.value)} disabled={!exercices?.length}>
            {exercices === null && !chargement ? <option value="">Chargement…</option> : null}
            {exercices?.length === 0 ? <option value="">Aucun exercice dans ce dossier</option> : null}
            {exercices?.map((x) => (
              <option key={x.id} value={x.id}>
                Du {formaterDate(x.debut)} au {formaterDate(x.fin)}
              </option>
            ))}
          </Liste>
        </div>
      ) : null}
      {chargement ? <Alerte ton="attention">{chargement}</Alerte> : null}
      <div className="flex flex-wrap gap-2">
        <Bouton type="submit" variante="secondaire" disabled={appel.occupe || !exerciceId}>
          Mesurer sur cet exercice
        </Bouton>
        <Bouton variante="contour" onClick={() => setOuvert(false)}>
          Fermer
        </Bouton>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-texte-doux">
        {appel.occupe ? 'Mesure en cours : le contrôle est exécuté deux fois sur les données actives…' : ''}
      </p>
      {resultat ? (
        <p className="text-sm" data-testid="impact-immediat">
          Avant : {resultat.avant.constats} constat(s) · Après : {resultat.apres.constats} constat(s).
        </p>
      ) : null}
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

/** Décisions réservées aux gestionnaires : approuver, refuser (motif), retirer. L'API reste seule juge des garde-fous. */
export function DecisionRegle({ regleId, statut, impactMesure, proposeeParMoi }: { regleId: string; statut: string; impactMesure: boolean; proposeeParMoi: boolean }) {
  const appel = useAppel();
  const [refus, setRefus] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [motif, setMotif] = useState('');
  const id = useId();
  if (statut === 'approuvee') {
    return (
      <div className="space-y-2">
        {confirmation ? (
          <div className="space-y-2 rounded-lg border border-bordure p-3" role="group" aria-label="Confirmer le retrait">
            <p className="text-sm">Retirer cette règle rétablit les paramètres par défaut du contrôle et rend obsolètes les contrôles déjà exécutés. La règle reste dans l’historique.</p>
            <div className="flex flex-wrap gap-2">
              <Bouton variante="danger" disabled={appel.occupe} onClick={() => void appel.executer(`v1/regles/${regleId}/retirer`, { method: 'POST' }, 'Règle retirée.')}>
                Confirmer le retrait
              </Bouton>
              <Bouton variante="contour" onClick={() => setConfirmation(false)}>
                Annuler
              </Bouton>
            </div>
          </div>
        ) : (
          <Bouton variante="danger" onClick={() => setConfirmation(true)}>
            Retirer
          </Bouton>
        )}
        <Retours erreur={appel.erreur} succes={appel.succes} />
      </div>
    );
  }
  if (statut !== 'proposee') return null;
  const blocage = proposeeParMoi ? 'Vous avez proposé cette règle : une autre personne (administrateur ou associé) doit l’approuver.' : !impactMesure ? 'Mesurez l’impact avant d’approuver.' : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Bouton disabled={appel.occupe || blocage !== null} aria-describedby={blocage ? `${id}-blocage` : undefined} onClick={() => void appel.executer(`v1/regles/${regleId}/approuver`, { method: 'POST' }, 'Règle approuvée. Les contrôles déjà exécutés sont à relancer.')}>
          Approuver
        </Bouton>
        {!refus ? (
          <Bouton variante="danger" disabled={appel.occupe} onClick={() => setRefus(true)}>
            Refuser
          </Bouton>
        ) : null}
      </div>
      {blocage ? (
        <p id={`${id}-blocage`} className="text-sm text-texte-doux" data-testid="blocage-approbation">
          {blocage}
        </p>
      ) : null}
      {refus ? (
        <form
          className="space-y-2"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (!motif.trim()) return appel.setErreur('Un motif est requis pour refuser.');
            await appel.executer(`v1/regles/${regleId}/refuser`, { method: 'POST', json: { motif: motif.trim() } }, 'Règle refusée.');
          }}
        >
          <Libelle htmlFor={`${id}-motif`}>Motif du refus (obligatoire)</Libelle>
          <ZoneTexte id={`${id}-motif`} value={motif} maxLength={2000} onChange={(e) => setMotif(e.target.value)} className="min-h-16" />
          <div className="flex flex-wrap gap-2">
            <Bouton type="submit" variante="danger" disabled={appel.occupe}>
              Confirmer le refus
            </Bouton>
            <Bouton variante="contour" onClick={() => setRefus(false)}>
              Annuler
            </Bouton>
          </div>
        </form>
      ) : null}
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </div>
  );
}
