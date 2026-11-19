'use client';

import { type FormEvent, useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, Liste, Saisie, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import {
  type Lettre, LIBELLE_MODE_HONORAIRES, type ModeHonoraires, type Prestation, type PropositionAvenant, type SaisieLettre, formaterMinutes, lettreDepuis, lettreInitiale, phraseEstimation,
} from '@/lib/missions';
import { formaterDate } from '@/lib/montants';
import { SelecteurPieces } from '@/components/document/selecteur-pieces';
import type { PieceChoisie } from '@/lib/pieces-jointes';

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

export function CreerMission({ dossierId }: { dossierId: string }) {
  const [libelle, setLibelle] = useState('');
  const [debut, setDebut] = useState('');
  const [fin, setFin] = useState('');
  const appel = useAppel();
  const id = useId();
  return (
    <form
      className="space-y-2"
      data-formulaire="creer-mission"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!libelle.trim()) return appel.setErreur('Le libellé de la mission est obligatoire.');
        if (debut && fin && fin < debut) return appel.setErreur('La fin ne peut pas précéder le début.');
        if (await appel.executer(`v1/dossiers/${dossierId}/missions`, { method: 'POST', json: { libelle: libelle.trim(), ...(debut ? { debut } : {}), ...(fin ? { fin } : {}) } }, 'Mission créée.')) {
          setLibelle('');
          setDebut('');
          setFin('');
        }
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 grow">
          <Libelle htmlFor={`${id}-libelle`}>Libellé de la mission</Libelle>
          <Saisie id={`${id}-libelle`} value={libelle} maxLength={200} onChange={(e) => setLibelle(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <Libelle htmlFor={`${id}-debut`}>Début (facultatif)</Libelle>
          <Saisie id={`${id}-debut`} type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />
        </div>
        <div>
          <Libelle htmlFor={`${id}-fin`}>Fin (facultative)</Libelle>
          <Saisie id={`${id}-fin`} type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
        </div>
        <Bouton type="submit" variante="secondaire" disabled={appel.occupe}>
          Créer la mission
        </Bouton>
      </div>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

/** Lettre de mission ou avenant (`POST v1/missions/:id/lettres`) : contenu structuré, enregistré comme PROJET. */
export function RedigerLettre({ missionId, dossierId, prestations, lettres }: { missionId: string; dossierId: string; prestations: Prestation[]; lettres: Lettre[] }) {
  const [ouvert, setOuvert] = useState(false);
  const [signee, setSignee] = useState<PieceChoisie[]>([]);
  const [f, setF] = useState<SaisieLettre>(() => lettreInitiale(prestations));
  const [erreurs, setErreurs] = useState<string[]>([]);
  const appel = useAppel();
  const id = useId();
  const maj = (m: Partial<SaisieLettre>) => setF((v) => ({ ...v, ...m }));
  const texte = (nom: 'conditionsRevision' | 'obligationsCabinet' | 'obligationsClient' | 'livrables' | 'mandats' | 'limites', libelle: string, max: number) => (
    <div>
      <Libelle htmlFor={`${id}-${nom}`}>{libelle}</Libelle>
      <ZoneTexte id={`${id}-${nom}`} value={f[nom]} maxLength={max} onChange={(e) => maj({ [nom]: e.target.value })} className="min-h-16" />
    </div>
  );
  if (!ouvert) {
    return (
      <Bouton variante="secondaire" onClick={() => setOuvert(true)}>
        Rédiger une lettre ou un avenant
      </Bouton>
    );
  }
  async function envoyer(e: FormEvent) {
    e.preventDefault();
    const r = lettreDepuis(f);
    if (!r.ok) return setErreurs(r.erreurs);
    setErreurs([]);
    if (await appel.executer(`v1/missions/${missionId}/lettres`, { method: 'POST', json: { ...r.corps, ...(signee[0] ? { documentId: signee[0].id } : {}) } }, 'Projet enregistré. Il n’a aucun effet tant qu’il n’est pas validé.')) {
      setF(lettreInitiale(prestations));
      setSignee([]);
      setOuvert(false);
    }
  }
  return (
    <form onSubmit={envoyer} className="space-y-3 rounded-lg border border-bordure p-3" data-formulaire="rediger-lettre" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Libelle htmlFor={`${id}-effet`}>Date d’effet</Libelle>
          <Saisie id={`${id}-effet`} type="date" value={f.dateEffet} onChange={(e) => maj({ dateEffet: e.target.value })} />
        </div>
        <div>
          <Libelle htmlFor={`${id}-avenant`}>Nature</Libelle>
          <Liste
            id={`${id}-avenant`}
            value={f.avenantDe}
            onChange={(e) => {
              // Un avenant part du contenu de la lettre qu'il modifie : il reste entièrement modifiable avant l'enregistrement.
              const base = lettres.find((l) => l.id === e.target.value);
              setF((v) => (base ? { ...lettreInitiale(prestations, base), dateEffet: v.dateEffet } : { ...v, avenantDe: '' }));
            }}
          >
            <option value="">Lettre de mission</option>
            {lettres.map((l) => (
              <option key={l.id} value={l.id}>
                Avenant à la version {l.version} (effet au {formaterDate(l.dateEffet)})
              </option>
            ))}
          </Liste>
        </div>
      </div>
      <fieldset className="space-y-1">
        <legend className="font-medium">Périmètre (prestations couvertes)</legend>
        <ul className="space-y-1">
          {prestations.map((p) => {
            const v = f.prestations[p.code] ?? { cochee: false, precision: '' };
            return (
              <li key={p.code} className="flex flex-wrap items-center gap-2">
                <label className="flex min-h-11 items-center gap-2">
                  <input type="checkbox" className="size-5" checked={v.cochee} onChange={(e) => maj({ prestations: { ...f.prestations, [p.code]: { ...v, cochee: e.target.checked } } })} /> {p.libelle}
                </label>
                {v.cochee ? (
                  <>
                    <Libelle htmlFor={`${id}-pr-${p.code}`} className="sr-only">
                      Précision pour « {p.libelle} »
                    </Libelle>
                    <Saisie id={`${id}-pr-${p.code}`} value={v.precision} maxLength={500} placeholder="Précision (facultative)" onChange={(e) => maj({ prestations: { ...f.prestations, [p.code]: { ...v, precision: e.target.value } } })} className="max-w-md grow" autoComplete="off" />
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      </fieldset>
      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <legend className="font-medium">Durée</legend>
        <div>
          <Libelle htmlFor={`${id}-debut`}>Début de la mission</Libelle>
          <Saisie id={`${id}-debut`} type="date" value={f.debut} onChange={(e) => maj({ debut: e.target.value })} />
        </div>
        <div>
          <Libelle htmlFor={`${id}-fin`}>Fin (vide : sans terme)</Libelle>
          <Saisie id={`${id}-fin`} type="date" value={f.fin} onChange={(e) => maj({ fin: e.target.value })} />
        </div>
        <label className="flex min-h-11 items-center gap-2 self-end">
          <input type="checkbox" className="size-5" checked={f.taciteReconduction} onChange={(e) => maj({ taciteReconduction: e.target.checked })} /> Tacite reconduction
        </label>
      </fieldset>
      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <legend className="font-medium">Honoraires</legend>
        <div>
          <Libelle htmlFor={`${id}-mode`}>Mode</Libelle>
          <Liste id={`${id}-mode`} value={f.mode} onChange={(e) => maj({ mode: e.target.value as ModeHonoraires })}>
            {(Object.keys(LIBELLE_MODE_HONORAIRES) as ModeHonoraires[]).map((m) => (
              <option key={m} value={m}>
                {LIBELLE_MODE_HONORAIRES[m]}
              </option>
            ))}
          </Liste>
        </div>
        <div>
          <Libelle htmlFor={`${id}-montant`}>Honoraires annuels HT (vide : non renseignés)</Libelle>
          <Saisie id={`${id}-montant`} inputMode="decimal" value={f.montantAnnuelHt} maxLength={20} onChange={(e) => maj({ montantAnnuelHt: e.target.value })} autoComplete="off" />
        </div>
        <div>
          <Libelle htmlFor={`${id}-taux`}>Taux horaire HT (vide : non renseigné)</Libelle>
          <Saisie id={`${id}-taux`} inputMode="decimal" value={f.tauxHoraireHt} maxLength={20} onChange={(e) => maj({ tauxHoraireHt: e.target.value })} autoComplete="off" />
        </div>
        <div className="sm:col-span-3">{texte('conditionsRevision', 'Conditions de révision des honoraires', 2000)}</div>
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {texte('obligationsCabinet', 'Obligations du cabinet', 4000)}
        {texte('obligationsClient', 'Obligations du client', 4000)}
        {texte('livrables', 'Livrables (un par ligne)', 4000)}
        {texte('mandats', 'Mandats (un par ligne)', 4000)}
      </div>
      {texte('limites', 'Limites de la mission', 4000)}
      <SelecteurPieces entiteId={dossierId} selection={signee} surChangement={setSignee} multiple={false} libelle="Lettre signée (facultatif)" aide="Pièce du dossier contenant la lettre ou l’avenant signé. La joindre ne vaut pas validation : le projet reste à valider." />
      <Erreurs erreurs={erreurs} />
      <div className="flex flex-wrap gap-2">
        <Bouton type="submit" disabled={appel.occupe}>
          Enregistrer le projet
        </Bouton>
        <Bouton variante="contour" onClick={() => setOuvert(false)}>
          Fermer
        </Bouton>
      </div>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

/** Action simple en un clic avec confirmation en ligne (validation d'une lettre, d'un conseil, autorisation d'envoi…). */
export function ActionConfirmee({ chemin, libelle, confirmation, explication, succes, variante = 'primaire' }: { chemin: string; libelle: string; confirmation: string; explication: string; succes: string; variante?: 'primaire' | 'secondaire' }) {
  const appel = useAppel();
  const [ouvert, setOuvert] = useState(false);
  return (
    <div className="space-y-2">
      {ouvert ? (
        <div className="space-y-2 rounded-lg border border-bordure p-3" role="group" aria-label={libelle}>
          <p className="text-sm">{explication}</p>
          <div className="flex flex-wrap gap-2">
            <Bouton variante={variante} disabled={appel.occupe} onClick={async () => void ((await appel.executer(chemin, { method: 'POST' }, succes)) && setOuvert(false))}>
              {confirmation}
            </Bouton>
            <Bouton variante="contour" onClick={() => setOuvert(false)}>
              Annuler
            </Bouton>
          </div>
        </div>
      ) : (
        <Bouton variante={variante} onClick={() => setOuvert(true)}>
          {libelle}
        </Bouton>
      )}
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </div>
  );
}

export function EnregistrerTravail({ dossierId, prestations }: { dossierId: string; prestations: Prestation[] }) {
  const [date, setDate] = useState('');
  const [prestation, setPrestation] = useState('');
  const [description, setDescription] = useState('');
  const [minutes, setMinutes] = useState('');
  const appel = useAppel();
  const id = useId();
  return (
    <form
      className="space-y-2"
      data-formulaire="enregistrer-travail"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!date) return appel.setErreur('Indiquez la date du travail.');
        if (!prestation) return appel.setErreur('Choisissez la prestation.');
        if (!description.trim()) return appel.setErreur('Décrivez le travail.');
        if (minutes.trim() && !/^[1-9]\d{0,4}$/.test(minutes.trim())) return appel.setErreur('Temps observé : nombre entier de minutes (1 à 99 999), ou laissez vide.');
        const corps = { dateTravail: date, prestation, description: description.trim(), ...(minutes.trim() ? { tempsObserveMinutes: Number.parseInt(minutes.trim(), 10) } : {}) };
        if (await appel.executer(`v1/dossiers/${dossierId}/travaux`, { method: 'POST', json: corps }, 'Travail enregistré.')) {
          setDescription('');
          setMinutes('');
        }
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Libelle htmlFor={`${id}-date`}>Date du travail</Libelle>
          <Saisie id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <Libelle htmlFor={`${id}-prestation`}>Prestation</Libelle>
          <Liste id={`${id}-prestation`} value={prestation} onChange={(e) => setPrestation(e.target.value)}>
            <option value="">Choisir…</option>
            {prestations.map((p) => (
              <option key={p.code} value={p.code}>
                {p.libelle}
              </option>
            ))}
          </Liste>
        </div>
        <div>
          <Libelle htmlFor={`${id}-minutes`}>Temps OBSERVÉ, en minutes (facultatif)</Libelle>
          <Saisie id={`${id}-minutes`} inputMode="numeric" value={minutes} maxLength={5} onChange={(e) => setMinutes(e.target.value)} autoComplete="off" />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <Libelle htmlFor={`${id}-description`}>Description</Libelle>
          <ZoneTexte id={`${id}-description`} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} className="min-h-16" />
        </div>
      </div>
      <p className="text-sm text-texte-doux">Le temps saisi est un temps observé, jamais une estimation : laissez vide si vous ne l’avez pas mesuré.</p>
      <Bouton type="submit" variante="secondaire" disabled={appel.occupe}>
        Enregistrer le travail
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

/** Affectation explicite d'un travail à une mission du dossier (`PUT v1/travaux/:id/mission`) ; jamais déduite. */
export function AffecterTravail({ travailId, missionId, missions }: { travailId: string; missionId: string | null; missions: Array<{ id: string; libelle: string }> }) {
  const appel = useAppel();
  const id = useId();
  return (
    <div className="space-y-1" data-testid="affectation">
      <Libelle htmlFor={id} className="sr-only">
        Mission de ce travail
      </Libelle>
      <Liste
        id={id}
        value={missionId ?? ''}
        disabled={appel.occupe}
        onChange={(e) => void appel.executer(`v1/travaux/${travailId}/mission`, { method: 'PUT', json: { missionId: e.target.value || null } }, e.target.value ? 'Travail affecté.' : 'Affectation retirée.')}
      >
        <option value="">Non affecté</option>
        {missions.map((m) => (
          <option key={m.id} value={m.id}>
            {m.libelle}
          </option>
        ))}
      </Liste>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </div>
  );
}

/** Projet d'avenant pour un travail potentiellement hors périmètre (`POST v1/travaux/:id/proposition-avenant`). */
export function PreparerAvenant({ travailId, projetExistant }: { travailId: string; projetExistant: number | null }) {
  const appel = useAppel();
  // L'estimation n'est renvoyée qu'à la préparation (l'API ne la conserve pas) : elle reste affichée tant que la page n'est pas quittée.
  const [resultat, setResultat] = useState<PropositionAvenant | null>(null);
  return (
    <div className="space-y-2">
      {resultat ? null : projetExistant !== null ? (
        <span className="block text-sm" data-testid="avenant-existant">
          Un projet d’avenant (version {projetExistant}) a déjà été préparé pour ce travail : il reste à relire et à valider.
        </span>
      ) : (
        <Bouton
          variante="secondaire"
          disabled={appel.occupe}
          onClick={async () => {
            const r = await appel.executer<PropositionAvenant>(`v1/travaux/${travailId}/proposition-avenant`, { method: 'POST' });
            if (r) setResultat(r);
          }}
        >
          Préparer un projet d’avenant
        </Bouton>
      )}
      <div role="status" aria-live="polite">
        {resultat ? (
          <Alerte ton="attention" data-testid="projet-avenant">
            <p className="font-semibold">Projet d’avenant préparé (version {resultat.avenant.version}) — non validé</p>
            <p className="break-words">{resultat.mention}</p>
            <p className="mt-1 font-medium" data-testid="estimation" data-base={resultat.estimation.base ?? 'aucune'}>
              {phraseEstimation(resultat.estimation)}
            </p>
            {resultat.estimation.statut === 'estime' ? <p className="text-sm">C’est une estimation ({formaterMinutes(resultat.estimation.minutes)}), pas un temps observé ; {resultat.estimation.nbObservations} temps observé(s) connus pour cette prestation.</p> : null}
            <ul className="list-disc pl-5 text-sm">
              {resultat.estimation.hypotheses.map((h) => (
                <li key={h} className="break-words">
                  {h}
                </li>
              ))}
            </ul>
          </Alerte>
        ) : null}
      </div>
      <Retours erreur={appel.erreur} succes={null} />
    </div>
  );
}

export function DefinirBareme({ prestation, libelle, actuel }: { prestation: string; libelle: string; actuel: number | null }) {
  const [minutes, setMinutes] = useState(actuel ? String(actuel) : '');
  const appel = useAppel();
  const id = useId();
  return (
    <form
      className="space-y-1"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!/^[1-9]\d{0,4}$/.test(minutes.trim())) return appel.setErreur('Nombre entier de minutes attendu (1 à 99 999).');
        await appel.executer(`v1/cabinet/baremes/${prestation}`, { method: 'PUT', json: { minutesReference: Number.parseInt(minutes.trim(), 10) } }, 'Barème enregistré.');
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Libelle htmlFor={id} className="sr-only">
            Temps de référence en minutes pour « {libelle} »
          </Libelle>
          <Saisie id={id} inputMode="numeric" value={minutes} maxLength={5} onChange={(e) => setMinutes(e.target.value)} className="max-w-28" autoComplete="off" />
        </div>
        <Bouton type="submit" variante="secondaire" disabled={appel.occupe} aria-label={`Enregistrer le barème de « ${libelle} »`}>
          Enregistrer
        </Bouton>
      </div>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}
