'use client';

import { type FormEvent, useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, Liste, Saisie, SousTitre, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { CHAMPS_DATE, CHAMPS_MONTANT, LIBELLE_CHAMP, LIBELLE_NATURE } from '@/lib/libelles';
import { formaterDate } from '@/lib/montants';
import { CHAMPS_FACTURE, type Exercice, type Extraction, type NatureDocument, type NomChamp } from '@/lib/types-api';

const TEXTES_ECHANGE = {
  signalement_erreur: { titre: 'Signaler une erreur', libelle: 'Décrivez l’erreur constatée', bouton: 'Signaler une erreur', succes: 'Signalement transmis au cabinet.' },
  reponse: { titre: 'Répondre à la demande de complément', libelle: 'Votre réponse', bouton: 'Envoyer la réponse', succes: 'Réponse envoyée.' },
  demande_complement: { titre: 'Demander un complément au déposant', libelle: 'Complément demandé', bouton: 'Demander un complément', succes: 'Demande envoyée : la pièce passe « À compléter ».' },
} as const;

/** Signalement d'erreur, réponse à une demande ou demande de complément (`POST v1/documents/:id/echanges`). */
export function FormulaireEchange({ documentId, type }: { documentId: string; type: keyof typeof TEXTES_ECHANGE }) {
  const t = TEXTES_ECHANGE[type];
  const { occupe, erreur, succes, executer } = useAppel();
  const [message, setMessage] = useState('');
  const id = useId();
  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    if (await executer(`v1/documents/${documentId}/echanges`, { method: 'POST', json: { type, message: message.trim() } }, t.succes)) setMessage('');
  }
  return (
    <form onSubmit={envoyer} className="space-y-2" data-formulaire={type}>
      <SousTitre className="text-base">{t.titre}</SousTitre>
      <div>
        <Libelle htmlFor={id}>{t.libelle}</Libelle>
        <ZoneTexte id={id} value={message} onChange={(e) => setMessage(e.target.value)} required maxLength={4000} />
      </div>
      <Bouton type="submit" variante={type === 'signalement_erreur' ? 'secondaire' : 'primaire'} disabled={occupe || !message.trim()}>
        {t.bouton}
      </Bouton>
      <Retours erreur={erreur} succes={succes} />
    </form>
  );
}

/** Correction de champs extraits (`PUT …/extraction`) : seuls les champs modifiés sont envoyés ; une nouvelle version « projet » est créée. */
export function FormulaireCorrection({ documentId, extraction }: { documentId: string; extraction: Extraction | null }) {
  const initiales = Object.fromEntries(CHAMPS_FACTURE.map((n) => [n, extraction?.champs[n]?.valeur ?? ''])) as Record<NomChamp, string>;
  const [valeurs, setValeurs] = useState(initiales);
  const { occupe, erreur, succes, executer, setErreur } = useAppel();
  const id = useId();
  const modifies = CHAMPS_FACTURE.filter((n) => valeurs[n].trim() !== '' && valeurs[n].trim() !== String(initiales[n]));

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (!modifies.length) {
      setErreur('Modifiez au moins un champ avant d’enregistrer.');
      return;
    }
    // Les montants restent des chaînes : la virgule saisie est remplacée par un point, sans conversion numérique.
    const champs = Object.fromEntries(modifies.map((n) => [n, CHAMPS_MONTANT.includes(n) ? valeurs[n].trim().replace(/[\s  ]/g, '').replace(',', '.') : valeurs[n].trim()]));
    await executer(`v1/documents/${documentId}/extraction`, { method: 'PUT', json: { champs } }, 'Correction enregistrée : une nouvelle version, non validée, a été créée.');
  }
  return (
    <form onSubmit={envoyer} className="space-y-3" data-formulaire="correction">
      <SousTitre className="text-base">Corriger les champs</SousTitre>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CHAMPS_FACTURE.map((n) => (
          <div key={n}>
            <Libelle htmlFor={`${id}-${n}`}>{LIBELLE_CHAMP[n]}</Libelle>
            {n === 'typeDocument' ? (
              <Liste id={`${id}-${n}`} value={valeurs[n]} onChange={(e) => setValeurs({ ...valeurs, [n]: e.target.value })}>
                <option value="">—</option>
                <option value="facture">Facture</option>
                <option value="avoir">Avoir</option>
                <option value="inconnu">Indéterminé</option>
              </Liste>
            ) : (
              <Saisie
                id={`${id}-${n}`}
                name={n}
                type={CHAMPS_DATE.includes(n) ? 'date' : 'text'}
                inputMode={CHAMPS_MONTANT.includes(n) ? 'decimal' : undefined}
                pattern={CHAMPS_MONTANT.includes(n) ? '-?[0-9   ]{1,17}([.,][0-9]{1,6})?' : undefined}
                title={CHAMPS_MONTANT.includes(n) ? 'Montant, par exemple 1234,56' : undefined}
                maxLength={n === 'devise' ? 3 : 200}
                value={valeurs[n]}
                onChange={(e) => setValeurs({ ...valeurs, [n]: e.target.value })}
                autoComplete="off"
              />
            )}
          </div>
        ))}
      </div>
      <p className="text-sm text-texte-doux">
        {modifies.length ? `Champs modifiés : ${modifies.map((n) => LIBELLE_CHAMP[n]).join(', ')}.` : 'Aucun champ modifié.'} Les vérifications sont recalculées par le serveur.
      </p>
      <Bouton type="submit" variante="secondaire" disabled={occupe}>
        Enregistrer la correction
      </Bouton>
      <Retours erreur={erreur} succes={succes} />
    </form>
  );
}

const NATURES = Object.keys(LIBELLE_NATURE) as NatureDocument[];

/** Qualification (`PATCH v1/documents/:id`) : nature et exercice de rattachement. */
export function FormulaireQualification({ documentId, nature, exerciceId, exercices }: { documentId: string; nature: NatureDocument; exerciceId: string | null; exercices: Exercice[] }) {
  const [n, setN] = useState(nature);
  const [ex, setEx] = useState(exerciceId ?? '');
  const { occupe, erreur, succes, executer, setErreur } = useAppel();
  const id = useId();
  async function envoyer(e: FormEvent) {
    e.preventDefault();
    const corps: { nature?: NatureDocument; exerciceId?: string | null } = {};
    if (n !== nature) corps.nature = n;
    if (ex !== (exerciceId ?? '')) corps.exerciceId = ex || null;
    if (!Object.keys(corps).length) {
      setErreur('Aucune modification à enregistrer.');
      return;
    }
    await executer(`v1/documents/${documentId}`, { method: 'PATCH', json: corps }, 'Qualification enregistrée.');
  }
  return (
    <form onSubmit={envoyer} className="space-y-3" data-formulaire="qualification">
      <SousTitre className="text-base">Qualifier la pièce</SousTitre>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Libelle htmlFor={`${id}-nature`}>Nature</Libelle>
          <Liste id={`${id}-nature`} value={n} onChange={(e) => setN(e.target.value as NatureDocument)}>
            {NATURES.map((v) => (
              <option key={v} value={v}>
                {LIBELLE_NATURE[v]}
              </option>
            ))}
          </Liste>
        </div>
        <div>
          <Libelle htmlFor={`${id}-exercice`}>Exercice de rattachement</Libelle>
          <Liste id={`${id}-exercice`} value={ex} onChange={(e) => setEx(e.target.value)}>
            <option value="">Aucun</option>
            {exercices.map((x) => (
              <option key={x.id} value={x.id}>
                Du {formaterDate(x.debut)} au {formaterDate(x.fin)}
              </option>
            ))}
          </Liste>
        </div>
      </div>
      <Bouton type="submit" variante="secondaire" disabled={occupe}>
        Enregistrer la qualification
      </Bouton>
      <Retours erreur={erreur} succes={succes} />
    </form>
  );
}

/** Validation ou rejet de l'extraction en vigueur (`POST …/validation`), réservé au niveau « révision » ou plus. */
export function FormulaireValidation({ documentId, version }: { documentId: string; version: number }) {
  const [motif, setMotif] = useState('');
  const { occupe, erreur, succes, executer, setErreur } = useAppel();
  const id = useId();
  async function decider(decision: 'valider' | 'rejeter') {
    if (decision === 'rejeter' && !motif.trim()) {
      setErreur('Un motif est requis pour rejeter.');
      return;
    }
    await executer(
      `v1/documents/${documentId}/validation`,
      { method: 'POST', json: { decision, ...(motif.trim() ? { motif: motif.trim() } : {}) } },
      decision === 'valider' ? `Version ${version} validée.` : 'Pièce rejetée.',
    );
  }
  return (
    <div className="space-y-3" data-formulaire="validation">
      <SousTitre className="text-base">Décision du réviseur</SousTitre>
      <Alerte ton="attention">
        La validation porte sur la <strong>version {version}</strong> affichée ci-dessus. Toute correction ultérieure crée une nouvelle version, non validée.
        La décision est la vôtre : le logiciel ne valide rien par lui-même.
      </Alerte>
      <div>
        <Libelle htmlFor={id}>Motif (obligatoire pour rejeter)</Libelle>
        <ZoneTexte id={id} value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={2000} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Bouton onClick={() => void decider('valider')} disabled={occupe}>
          Valider la version {version}
        </Bouton>
        <Bouton variante="danger" onClick={() => void decider('rejeter')} disabled={occupe}>
          Rejeter
        </Bouton>
      </div>
      <Retours erreur={erreur} succes={succes} />
    </div>
  );
}

export function BoutonReanalyse({ documentId }: { documentId: string }) {
  const { occupe, erreur, succes, executer } = useAppel();
  return (
    <div className="space-y-2">
      <Bouton variante="contour" disabled={occupe} onClick={() => void executer(`v1/documents/${documentId}/reanalyse`, { method: 'POST' }, 'Nouvelle analyse demandée.')}>
        Relancer l’analyse automatique
      </Bouton>
      <Retours erreur={erreur} succes={succes} />
    </div>
  );
}
