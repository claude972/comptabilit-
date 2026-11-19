'use client';

import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { messageErreur, useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, Liste, Saisie, SousTitre, Tableau, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import {
  type ApercuReleve, FORMATS_DATE, type FormulaireParametres, type FormulaireProfil, LIBELLE_SEPARATEUR, type ParametresRapprochement, decoupageSelon, entetesNumerotes, parametresDepuis, parametresInitiaux,
  profilDepuis, profilDepuisProposition, profilInitial, separateursProposes,
} from '@/lib/banque';
import { appelBff } from '@/lib/televersement/transport-bff';

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

/** Confirmation du profil de colonnes d'un CSV (`POST v1/imports/:id/relancer`) : c'est l'utilisateur qui confirme, pas le logiciel. */
type EtatApercu = { phase: 'chargement' } | { phase: 'pret'; apercu: ApercuReleve } | { phase: 'erreur'; message: string };

/** Premières lignes du fichier : texte brut à chasse fixe, puis découpage selon le séparateur choisi, colonnes numérotées. */
function ApercuCsv({ etat, separateur, lignesEntete }: { etat: EtatApercu; separateur: FormulaireProfil['separateur']; lignesEntete: string }) {
  if (etat.phase === 'chargement') return <p role="status">Chargement de l’aperçu du fichier…</p>;
  if (etat.phase === 'erreur') {
    return (
      <Alerte ton="neutre" role="status" data-testid="apercu-csv-indisponible">
        L’aperçu des premières lignes n’a pas pu être chargé ({etat.message}). Vous pouvez tout de même confirmer le profil en ouvrant le fichier pour vérifier ses en-têtes.
      </Alerte>
    );
  }
  const { apercu } = etat;
  const decoupage = decoupageSelon(apercu, separateur);
  const nbEntete = /^\d{1,3}$/.test(lignesEntete.trim()) ? Number(lignesEntete.trim()) : 0;
  const entetes = decoupage ? entetesNumerotes(decoupage, nbEntete) : [];
  return (
    <div className="space-y-2" data-testid="apercu-csv">
      <p className="font-medium">Aperçu du fichier ({apercu.lignes.length} première{apercu.lignes.length > 1 ? 's' : ''} ligne{apercu.lignes.length > 1 ? 's' : ''}, contenu affiché tel quel)</p>
      {apercu.tronque ? (
        <p className="text-sm" data-testid="apercu-tronque">
          <strong>Fichier tronqué pour l’aperçu</strong> : seul le début du fichier a été lu ; l’import, lui, portera sur le fichier entier.
        </p>
      ) : null}
      <pre className="max-h-64 overflow-auto rounded-lg border border-bordure bg-surface-2 p-2 font-mono text-sm whitespace-pre" tabIndex={0} aria-label="Premières lignes brutes du fichier" data-testid="apercu-lignes-brutes">
        {apercu.lignes.join('\n')}
      </pre>
      {decoupage ? (
        <Tableau legende={`Premières lignes découpées selon le séparateur ${LIBELLE_SEPARATEUR[separateur]}`}>
          <thead>
            <tr>
              {entetes.map((e) => (
                <th key={e.position} scope="col" data-colonne={e.position}>
                  <span className="block text-texte-doux">Colonne {e.position}</span>
                  {e.nom ? <span className="block break-words">{e.nom}</span> : <span className="block font-normal text-texte-doux">sans en-tête</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {decoupage.cellules.map((ligne, i) => (
              <tr key={i} className={i < nbEntete ? 'text-texte-doux' : undefined}>
                {entetes.map((e) => (
                  <td key={e.position} className="font-mono break-words">
                    {ligne[e.position - 1] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Tableau>
      ) : (
        <p className="text-sm" data-testid="apercu-sans-decoupage">
          Ce séparateur ne donne pas un nombre de colonnes constant sur les premières lignes : aucun découpage n’est proposé pour lui.
        </p>
      )}
    </div>
  );
}

export function FormulaireProfilCsv({ lotId, raisons }: { lotId: string; raisons: string[] }) {
  const [f, setF] = useState<FormulaireProfil>(() => profilInitial(raisons));
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [apercu, setApercu] = useState<EtatApercu>({ phase: 'chargement' });
  const [modifie, setModifie] = useState(false);
  const appel = useAppel();
  const id = useId();
  const dejaSaisi = useRef(false);
  const maj = (m: Partial<FormulaireProfil>) => {
    dejaSaisi.current = true;
    setModifie(true);
    setF((v) => ({ ...v, ...m }));
  };
  useEffect(() => {
    const controleur = new AbortController();
    appelBff<ApercuReleve>(`v1/imports/${lotId}/apercu`, { signal: controleur.signal })
      .then((a) => {
        setApercu({ phase: 'pret', apercu: a });
        // Pré-remplissage : uniquement si l'utilisateur n'a encore rien saisi, et toujours comme une proposition à confirmer.
        setF((v) => {
          if (dejaSaisi.current) return v;
          const depart = a.profilPropose ? profilDepuisProposition(a.profilPropose, v) : v;
          const choix = separateursProposes(a);
          return choix.includes(depart.separateur) ? depart : { ...depart, separateur: choix[0]! };
        });
      })
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setApercu({ phase: 'erreur', message: messageErreur(e) });
      });
    return () => controleur.abort();
  }, [lotId]);
  const charge = apercu.phase === 'pret' ? apercu.apercu : null;
  const choixSeparateurs = separateursProposes(charge);
  const constats = charge?.raisons.length ? charge.raisons : raisons;
  const champ = (nom: keyof FormulaireProfil, libelle: string) => (
    <div>
      <Libelle htmlFor={`${id}-${nom}`}>{libelle}</Libelle>
      <Saisie id={`${id}-${nom}`} value={f[nom] as string} onChange={(e) => maj({ [nom]: e.target.value })} autoComplete="off" maxLength={100} />
    </div>
  );
  async function envoyer(e: FormEvent) {
    e.preventDefault();
    const r = profilDepuis(f);
    if (!r.ok) return setErreurs(r.erreurs);
    setErreurs([]);
    await appel.executer(`v1/imports/${lotId}/relancer`, { method: 'POST', json: { profilCsv: r.profilCsv } }, 'Profil confirmé : la lecture du fichier est relancée.');
  }
  return (
    <form onSubmit={envoyer} className="space-y-3 rounded-lg border-2 border-attention-texte p-3" data-formulaire="profil-csv" noValidate>
      <SousTitre className="text-base">Confirmer les colonnes de ce fichier CSV</SousTitre>
      <p className="text-sm">
        Les colonnes n’ont pas été reconnues avec certitude : Comtaple s’est abstenu plutôt que de deviner. <strong>C’est vous qui confirmez le profil
        de colonnes, pas le logiciel</strong>, d’après l’aperçu ci-dessous.
      </p>
      {constats.length ? (
        <div className="text-sm" data-testid="raisons-profil">
          <p className="font-medium">Ce que la lecture automatique a constaté</p>
          <ul className="list-disc pl-5">
            {constats.map((r, i) => (
              <li key={i} className="break-words">
                {r}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ApercuCsv etat={apercu} separateur={f.separateur} lignesEntete={f.lignesEntete} />
      {charge?.profilPropose ? (
        <Alerte ton="attention" data-testid="profil-propose">
          <strong>Proposition du logiciel, à vérifier.</strong> Le formulaire ci-dessous a été pré-rempli d’après le début du fichier{modifie ? ' (vous l’avez modifié depuis)' : ''}. Rien n’est
          appliqué tant que vous ne l’avez pas confirmé : comparez-le à l’aperçu, corrigez-le au besoin.
        </Alerte>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Libelle htmlFor={`${id}-sep`}>Séparateur</Libelle>
          <Liste id={`${id}-sep`} value={f.separateur} onChange={(e) => maj({ separateur: e.target.value as FormulaireProfil['separateur'] })}>
            {choixSeparateurs.map((x) => (
              <option key={x} value={x}>
                {LIBELLE_SEPARATEUR[x]}
              </option>
            ))}
          </Liste>
        </div>
        {champ('lignesEntete', 'Lignes avant les données (en-tête compris)')}
        <div>
          <Libelle htmlFor={`${id}-fd`}>Format de date</Libelle>
          <Liste id={`${id}-fd`} value={f.formatDate} onChange={(e) => maj({ formatDate: e.target.value as FormulaireProfil['formatDate'] })}>
            {FORMATS_DATE.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Liste>
        </div>
        <div>
          <Libelle htmlFor={`${id}-dec`}>Séparateur décimal</Libelle>
          <Liste id={`${id}-dec`} value={f.decimale} onChange={(e) => maj({ decimale: e.target.value as ',' | '.' })}>
            <option value=",">Virgule (1234,56)</option>
            <option value=".">Point (1234.56)</option>
          </Liste>
        </div>
      </div>
      <p className="text-sm text-texte-doux">Désignez chaque colonne par son en-tête exact, ou par sa position (1 = première colonne), tels que numérotés dans l’aperçu.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {champ('date', 'Colonne de la date')}
        {champ('libelle', 'Colonne du libellé')}
        <div>
          <Libelle htmlFor={`${id}-mode`}>Montants</Libelle>
          <Liste id={`${id}-mode`} value={f.mode} onChange={(e) => maj({ mode: e.target.value as FormulaireProfil['mode'] })}>
            <option value="montant">Une colonne de montant signé</option>
            <option value="debit_credit">Deux colonnes : débit et crédit</option>
          </Liste>
        </div>
        {f.mode === 'montant' ? champ('montant', 'Colonne du montant') : null}
        {f.mode === 'debit_credit' ? champ('debit', 'Colonne du débit') : null}
        {f.mode === 'debit_credit' ? champ('credit', 'Colonne du crédit') : null}
        {champ('reference', 'Colonne de la référence (facultatif)')}
        {champ('iban', 'IBAN du compte (facultatif)')}
      </div>
      <Erreurs erreurs={erreurs} />
      <Bouton type="submit" disabled={appel.occupe}>
        Je confirme ce profil et relance la lecture
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

/** Lancement du rapprochement, avec paramètres avancés repliés (valeurs par défaut lues dans la référence de l'API). */
export function LancerRapprochement({ exerciceId, defauts }: { exerciceId: string; defauts: ParametresRapprochement }) {
  const [f, setF] = useState<FormulaireParametres>(() => parametresInitiaux(defauts));
  const [erreurs, setErreurs] = useState<string[]>([]);
  const appel = useAppel();
  const id = useId();
  const maj = (m: Partial<FormulaireParametres>) => setF((v) => ({ ...v, ...m }));
  async function envoyer(e: FormEvent) {
    e.preventDefault();
    const r = parametresDepuis(f, defauts);
    if (!r.ok) return setErreurs(r.erreurs);
    setErreurs([]);
    await appel.executer(`v1/exercices/${exerciceId}/rapprochements`, { method: 'POST', json: Object.keys(r.parametres).length ? { parametres: r.parametres } : {} }, 'Rapprochement demandé.');
  }
  return (
    <form onSubmit={envoyer} className="space-y-3" data-formulaire="lancer-rapprochement" noValidate>
      <details className="rounded-lg border border-bordure p-3">
        <summary className="min-h-11 cursor-pointer content-center font-medium">Paramètres avancés</summary>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Libelle htmlFor={`${id}-tol`}>Tolérance de montant (écart de règlement admis)</Libelle>
            <Saisie id={`${id}-tol`} inputMode="decimal" value={f.toleranceMontant} onChange={(e) => maj({ toleranceMontant: e.target.value })} />
          </div>
          <div>
            <Libelle htmlFor={`${id}-fj`}>Fenêtre des correspondances exactes (jours)</Libelle>
            <Saisie id={`${id}-fj`} inputMode="numeric" value={f.fenetreJours} onChange={(e) => maj({ fenetreJours: e.target.value })} />
          </div>
          <div>
            <Libelle htmlFor={`${id}-fr`}>Fenêtre des règles (jours)</Libelle>
            <Saisie id={`${id}-fr`} inputMode="numeric" value={f.fenetreJoursRegles} onChange={(e) => maj({ fenetreJoursRegles: e.target.value })} />
          </div>
          <label className="flex min-h-11 items-center gap-2">
            <input autoComplete="off" type="checkbox" className="size-5" checked={f.autoriserPartiels} onChange={(e) => maj({ autoriserPartiels: e.target.checked })} /> Paiements partiels
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input autoComplete="off" type="checkbox" className="size-5" checked={f.autoriserCompensations} onChange={(e) => maj({ autoriserCompensations: e.target.checked })} /> Compensations facture / avoir
          </label>
        </div>
        <p className="mt-2 text-sm text-texte-doux">Les valeurs affichées sont celles du moteur par défaut. Une tolérance nulle désactive la règle d’écart de règlement.</p>
      </details>
      <Erreurs erreurs={erreurs} />
      <Bouton type="submit" disabled={appel.occupe}>
        Lancer le rapprochement
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

/** Décision d'un réviseur sur une proposition (`PATCH v1/rapprochements/:id`). Valider est impossible si le calcul est obsolète. */
export function DecisionRapprochement({ id: propositionId, statut, obsolete }: { id: string; statut: string; obsolete: boolean }) {
  const appel = useAppel();
  const [rejet, setRejet] = useState(false);
  const [motif, setMotif] = useState('');
  const id = useId();
  const decider = (decision: string, m?: string) => appel.executer(`v1/rapprochements/${propositionId}`, { method: 'PATCH', json: { decision, ...(m ? { motif: m } : {}) } });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {statut !== 'valide' ? (
          <Bouton variante="secondaire" disabled={appel.occupe || obsolete} title={obsolete ? 'Les données ont changé : relancez le rapprochement avant de valider.' : undefined} onClick={() => void decider('valider')}>
            Valider
          </Bouton>
        ) : null}
        {statut !== 'rejete' && !rejet ? (
          <Bouton variante="danger" disabled={appel.occupe} onClick={() => setRejet(true)}>
            Rejeter
          </Bouton>
        ) : null}
        {statut !== 'propose' ? (
          <Bouton variante="contour" disabled={appel.occupe} onClick={() => void decider('remettre_en_proposition')}>
            Remettre en proposition
          </Bouton>
        ) : null}
      </div>
      {rejet ? (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!motif.trim()) return appel.setErreur('Un motif est requis pour rejeter.');
            if (await decider('rejeter', motif.trim())) {
              setRejet(false);
              setMotif('');
            }
          }}
          noValidate
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
      <Retours erreur={appel.erreur} succes={null} />
    </div>
  );
}
