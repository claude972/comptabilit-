'use client';

import { Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { messageErreur, useAppel } from '@/components/appel';
import { ListeEnvois, useEnvois } from '@/components/envoi-ordinateur';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, Liste, Saisie, SousTitre, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { cn } from '@/lib/cn';
import { AIDE_MOTIF, type Campagne, LIBELLE_TYPE_CAMPAGNE, PHRASE_ISOLEMENT, type StatutCampagne, type TypeImport, compteRenduAnnulationCampagne, motifValide } from '@/lib/imports';
import { LIBELLE_STATUT_DONNEES } from '@/lib/libelles';
import { formaterDate } from '@/lib/montants';
import { appelBff } from '@/lib/televersement/transport-bff';
import type { Exercice, StatutDonnees } from '@/lib/types-api';

const TYPES: TypeImport[] = ['fec', 'releve_bancaire'];

/** Ouverture d'une campagne (`POST v1/campagnes`) : un libellé et un type ; rien n'est importé à ce stade. */
export function CreerCampagne() {
  const routeur = useRouter();
  const [libelle, setLibelle] = useState('');
  const [type, setType] = useState<TypeImport | ''>('');
  const appel = useAppel();
  const id = useId();
  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (!libelle.trim()) return appel.setErreur('Indiquez le libellé de la campagne.');
    if (type === '') return appel.setErreur('Choisissez le type de la campagne : import comptable ou relevés bancaires.');
    const c = await appel.executer<Campagne>('v1/campagnes', { method: 'POST', json: { libelle: libelle.trim(), type } }, 'Campagne ouverte.');
    if (c) routeur.push(`/campagnes/${c.id}`);
  }
  return (
    <form onSubmit={envoyer} className="space-y-3" data-formulaire="creer-campagne" noValidate>
      <SousTitre className="text-base">Ouvrir une campagne</SousTitre>
      <div className="max-w-xl">
        <Libelle htmlFor={`${id}-libelle`}>Libellé de la campagne</Libelle>
        <Saisie id={`${id}-libelle`} value={libelle} maxLength={200} onChange={(e) => setLibelle(e.target.value)} autoComplete="off" />
      </div>
      <fieldset>
        <legend className="mb-1 font-medium">Type de fichiers (un seul type par campagne)</legend>
        <div className="flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <label key={t} className={cn('flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-bordure px-3', type === t && 'border-primaire bg-surface-2')}>
              <input autoComplete="off" type="radio" name={`${id}-type`} value={t} checked={type === t} onChange={() => setType(t)} className="size-5" />
              {LIBELLE_TYPE_CAMPAGNE[t]}
            </label>
          ))}
        </div>
      </fieldset>
      <Bouton type="submit" disabled={appel.occupe}>
        Ouvrir la campagne
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

const STATUTS: StatutDonnees[] = ['travail_avant_cloture', 'fec'];
type EtatExercices = { phase: 'aucun' } | { phase: 'chargement' } | { phase: 'pret'; exercices: Exercice[] } | { phase: 'erreur'; message: string };

/**
 * Dépôt de fichiers dans une campagne, dossier par dossier, par le téléversement reprenable habituel (`campagneId`).
 * La liste des envois reste affichée : plusieurs fichiers se déposent à la suite sans quitter la page.
 */
export function DepotCampagne({ campagneId, type, dossiers }: { campagneId: string; type: TypeImport; dossiers: Array<{ id: string; raisonSociale: string }> }) {
  const routeur = useRouter();
  const { envois, ajouter, reprendre } = useEnvois(() => routeur.refresh());
  const [dossier, setDossier] = useState('');
  const [exercices, setExercices] = useState<EtatExercices>({ phase: 'aucun' });
  const [exercice, setExercice] = useState('');
  const [statut, setStatut] = useState<StatutDonnees | ''>('');
  const [fichier, setFichier] = useState<File | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const entree = useRef<HTMLInputElement>(null);
  const id = useId();
  const comptable = type === 'fec';
  const nomDossier = (entiteId: string) => dossiers.find((d) => d.id === entiteId)?.raisonSociale ?? 'dossier';

  // Les exercices sont ceux du dossier choisi : un import comptable porte toujours sur un exercice déterminé.
  useEffect(() => {
    setExercice('');
    if (!comptable || !dossier) return setExercices({ phase: 'aucun' });
    const controleur = new AbortController();
    setExercices({ phase: 'chargement' });
    appelBff<Exercice[]>(`v1/dossiers/${dossier}/exercices`, { signal: controleur.signal })
      .then((liste) => {
        setExercices({ phase: 'pret', exercices: liste });
        setExercice(liste[0]?.id ?? '');
      })
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setExercices({ phase: 'erreur', message: messageErreur(e) });
      });
    return () => controleur.abort();
  }, [comptable, dossier]);

  function envoyer(e: FormEvent) {
    e.preventDefault();
    if (!dossier) return setErreur('Choisissez le dossier auquel ce fichier appartient.');
    if (comptable && !exercice) return setErreur('Choisissez l’exercice concerné.');
    if (comptable && statut === '') return setErreur('Indiquez le statut des données importées : il n’est jamais présumé.');
    if (!fichier) return setErreur('Choisissez le fichier à déposer.');
    setErreur(null);
    ajouter([fichier], (f) =>
      comptable
        ? { entiteId: dossier, nomFichier: f.name.slice(0, 255), typeMime: 'text/plain', canal: 'ordinateur', usage: 'fec', exerciceId: exercice, statutDonnees: statut as StatutDonnees, campagneId }
        : { entiteId: dossier, nomFichier: f.name.slice(0, 255), ...(f.type ? { typeMime: f.type.slice(0, 100) } : {}), canal: 'ordinateur', usage: 'banque', campagneId },
    );
    // Le dossier est remis à vide : chaque fichier est rattaché à son dossier par un choix explicite.
    setFichier(null);
    setDossier('');
    if (entree.current) entree.current.value = '';
  }

  return (
    <section aria-labelledby={`${id}-titre`} className="space-y-3" data-testid="depot-campagne">
      <SousTitre id={`${id}-titre`} className="text-base">
        Déposer un fichier pour un dossier
      </SousTitre>
      <p className="text-sm text-texte-doux">
        Un fichier à la fois, pour un dossier déterminé ; recommencez pour le dossier suivant. {PHRASE_ISOLEMENT}
      </p>
      <form onSubmit={envoyer} className="space-y-3" data-formulaire="depot-campagne" noValidate>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Libelle htmlFor={`${id}-dossier`}>Dossier (parmi ceux où vous êtes habilité en collaboration)</Libelle>
            <Liste id={`${id}-dossier`} value={dossier} onChange={(e) => setDossier(e.target.value)}>
              <option value="">Choisir un dossier…</option>
              {dossiers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.raisonSociale}
                </option>
              ))}
            </Liste>
          </div>
          {comptable ? (
            <div>
              <Libelle htmlFor={`${id}-exercice`}>Exercice</Libelle>
              <Liste id={`${id}-exercice`} value={exercice} onChange={(e) => setExercice(e.target.value)} disabled={exercices.phase !== 'pret' || !exercices.exercices.length}>
                {exercices.phase === 'pret' && exercices.exercices.length ? null : <option value="">{exercices.phase === 'chargement' ? 'Chargement…' : exercices.phase === 'pret' ? 'Aucun exercice' : '—'}</option>}
                {exercices.phase === 'pret'
                  ? exercices.exercices.map((x) => (
                      <option key={x.id} value={x.id}>
                        Du {formaterDate(x.debut)} au {formaterDate(x.fin)}
                      </option>
                    ))
                  : null}
              </Liste>
              <div aria-live="polite" className="text-sm">
                {exercices.phase === 'erreur' ? <span role="alert">Les exercices de ce dossier n’ont pas pu être chargés : {exercices.message}</span> : null}
                {exercices.phase === 'pret' && !exercices.exercices.length ? 'Aucun exercice n’est défini pour ce dossier : l’import comptable n’y est pas possible.' : null}
              </div>
            </div>
          ) : null}
        </div>
        {comptable ? (
          <fieldset>
            <legend className="mb-1 font-medium">Statut des données importées (obligatoire)</legend>
            <div className="flex flex-wrap gap-2">
              {STATUTS.map((s) => (
                <label key={s} className={cn('flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-bordure px-3', statut === s && 'border-primaire bg-surface-2')}>
                  <input autoComplete="off" type="radio" name={`${id}-statut`} value={s} checked={statut === s} onChange={() => setStatut(s)} className="size-5" />
                  {LIBELLE_STATUT_DONNEES[s]}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div>
          <Libelle htmlFor={`${id}-fichier`}>{comptable ? 'Fichier des écritures du dossier' : 'Relevé bancaire du dossier (camt.053, OFX ou CSV)'}</Libelle>
          <input
            ref={entree}
            id={`${id}-fichier`}
            type="file"
            accept={comptable ? '.txt,.csv,.fec,text/plain,text/csv' : '.xml,.ofx,.csv,.txt,application/xml,text/xml,text/csv,text/plain'}
            data-testid="entree-campagne"
            onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
            className="block min-h-11 w-full max-w-lg rounded-lg border border-bordure bg-surface p-2"
          />
        </div>
        {erreur ? (
          <Alerte ton="danger" role="alert">
            {erreur}
          </Alerte>
        ) : null}
        <Bouton type="submit">
          <Upload aria-hidden="true" className="size-5" /> Déposer pour ce dossier
        </Bouton>
      </form>
      <div aria-live="polite">
        <ListeEnvois
          envois={envois}
          surReprise={reprendre}
          recu={(e) => `${nomDossier(e.ouverture.entiteId)} — ${e.resultat?.dejaImporte ? 'ce fichier avait déjà été importé pour ce dossier : aucun nouvel import n’a été créé.' : 'fichier reçu : le traitement de ce dossier démarre.'}`}
        />
      </div>
    </section>
  );
}

/** Reprise des échecs, clôture, annulation motivée de la campagne (`POST v1/campagnes/:id/…`). */
export function ActionsCampagne({ campagneId, statut, nbEchecs, nbImports }: { campagneId: string; statut: StatutCampagne; nbEchecs: number; nbImports: number }) {
  const [panneau, setPanneau] = useState<'clore' | 'annuler' | null>(null);
  const [motif, setMotif] = useState('');
  const [compteRendu, setCompteRendu] = useState<string | null>(null);
  const appel = useAppel();
  const id = useId();
  const base = `v1/campagnes/${campagneId}`;

  async function reprendre() {
    setCompteRendu(null);
    const r = await appel.executer<{ repris: number }>(`${base}/reprise-echecs`, { method: 'POST' });
    if (r) setCompteRendu(`${r.repris} import(s) en échec repris, dans les dossiers où vous êtes habilité en collaboration. Chaque dossier est retraité séparément.`);
  }
  async function clore() {
    setCompteRendu(null);
    if (await appel.executer(`${base}/cloture`, { method: 'POST' })) {
      setCompteRendu('Campagne close : elle n’accepte plus de fichiers. Ses imports restent en place.');
      setPanneau(null);
    }
  }
  async function annuler() {
    if (!motifValide(motif)) return appel.setErreur(AIDE_MOTIF);
    setCompteRendu(null);
    const r = await appel.executer<{ annules: number; laissesFauteHabilitation: number }>(`${base}/annulation`, { method: 'POST', json: { motif: motif.trim() } });
    if (r) {
      setCompteRendu(compteRenduAnnulationCampagne(r));
      setMotif('');
      setPanneau(null);
    }
  }
  const ouvrir = (p: 'clore' | 'annuler') => {
    appel.setErreur(null);
    setPanneau(p);
  };

  return (
    <div className="space-y-3" data-testid="actions-campagne">
      {!panneau ? (
        <div className="flex flex-wrap gap-2">
          {nbEchecs > 0 && statut !== 'annulee' ? (
            <Bouton variante="secondaire" disabled={appel.occupe} onClick={() => void reprendre()}>
              Reprendre les échecs ({nbEchecs})
            </Bouton>
          ) : null}
          {statut === 'ouverte' ? (
            <Bouton variante="secondaire" onClick={() => ouvrir('clore')}>
              Clore la campagne
            </Bouton>
          ) : null}
          {statut !== 'annulee' ? (
            <Bouton variante="danger" disabled={nbImports === 0} title={nbImports === 0 ? 'Aucun import à annuler dans vos dossiers.' : undefined} onClick={() => ouvrir('annuler')}>
              Annuler la campagne
            </Bouton>
          ) : null}
          {statut === 'annulee' ? <p className="text-sm text-texte-doux">Cette campagne est annulée : aucune action n’est possible sur elle. Ses imports se rétablissent un par un, depuis chaque dossier.</p> : null}
        </div>
      ) : panneau === 'clore' ? (
        <div className="space-y-2 rounded-lg border-2 border-attention-texte p-3" role="group" aria-labelledby={`${id}-clore`} data-panneau="clore">
          <p id={`${id}-clore`} className="font-semibold">
            Clore cette campagne ?
          </p>
          <p className="text-sm">Une campagne close n’accepte plus de fichiers. Ses imports restent en place et ne sont pas modifiés.</p>
          <div className="flex flex-wrap gap-2">
            <Bouton disabled={appel.occupe} onClick={() => void clore()}>
              Confirmer la clôture
            </Bouton>
            <Bouton variante="contour" onClick={() => setPanneau(null)}>
              Renoncer
            </Bouton>
          </div>
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border-2 border-attention-texte p-3" role="group" aria-labelledby={`${id}-annuler`} data-panneau="annuler">
          <p id={`${id}-annuler`} className="font-semibold">
            Annuler cette campagne ?
          </p>
          <Alerte ton="attention" className="text-sm" data-testid="explication-campagne">
            <ul className="list-disc space-y-1 pl-5">
              <li>Chacun de ses imports est annulé, dossier par dossier. Rien n’est supprimé : chaque import reste rétablissable individuellement.</li>
              <li>Seuls les dossiers où vous êtes habilité en révision sont concernés ; les imports des autres dossiers sont laissés en place, et comptés.</li>
              <li>Pour un import comptable actif, le lot précédent du dossier redevient actif et les travaux qui dépendaient des données sont marqués « à revoir ».</li>
            </ul>
          </Alerte>
          <div>
            <Libelle htmlFor={`${id}-motif`}>Motif de l’annulation (obligatoire)</Libelle>
            <ZoneTexte id={`${id}-motif`} value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={2000} required className="min-h-16" aria-describedby={`${id}-aide`} />
            <p id={`${id}-aide`} className="text-sm text-texte-doux">
              {AIDE_MOTIF}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Bouton variante="danger" disabled={appel.occupe} onClick={() => void annuler()}>
              Confirmer l’annulation de la campagne
            </Bouton>
            <Bouton variante="contour" onClick={() => setPanneau(null)}>
              Renoncer
            </Bouton>
          </div>
        </div>
      )}
      <Retours erreur={appel.erreur} succes={null} />
      <div role="status" aria-live="polite">
        {compteRendu ? (
          <Alerte ton="info" data-testid="compte-rendu-campagne">
            {compteRendu}
          </Alerte>
        ) : null}
      </div>
    </div>
  );
}
