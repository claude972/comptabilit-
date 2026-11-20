'use client';

import { useRouter } from 'next/navigation';
import { type ChangeEvent, useCallback, useId, useMemo, useRef, useState } from 'react';
import { messageErreur } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Carte, Etiquette, Libelle, Liste, SousTitre, Tableau, type Ton } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import {
  type ApercuReprise,
  type Correspondance,
  LIBELLE_ENCODAGE,
  LIBELLE_SEPARATEUR,
  LIBELLE_STATUT_APERCU,
  type LigneApercu,
  type RepriseVue,
  type StatutApercu,
  TAILLE_MAX_FICHIER,
  formaterTaille,
  valeursLuesAffichables,
  versBase64,
} from '@/lib/reprise-immobilisations';
import { ErreurHttp } from '@/lib/televersement/moteur';
import { appelBff } from '@/lib/televersement/transport-bff';

const TON: Record<StatutApercu, Ton> = { valide: 'succes', invalide: 'danger', doublon: 'attention' };
const PAR_PAGE = 50;

/**
 * Reprise d'un fichier d'immobilisations (CSV) : 1. choix du fichier, 2. aperçu avec correspondance des colonnes (rien n'est
 * écrit), 3. confirmation explicite, puis le rapport ligne par ligne s'affiche (page `?rapport=`). Le fichier reste dans le
 * navigateur jusqu'à la validation ; le serveur relit et recalcule tout.
 */
export function ReprendreFichier({ entiteId }: { entiteId: string }) {
  const routeur = useRouter();
  const id = useId();
  const entree = useRef<HTMLInputElement>(null);
  const [fichier, setFichier] = useState<{ nom: string; base64: string; taille: number } | null>(null);
  const [options, setOptions] = useState<{ encodage?: string; separateur?: string }>({});
  const [apercu, setApercu] = useState<ApercuReprise | null>(null);
  const [correspondance, setCorrespondance] = useState<Correspondance | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [confirme, setConfirme] = useState(false);
  const [filtre, setFiltre] = useState<'toutes' | StatutApercu>('toutes');
  const [page, setPage] = useState(1);

  const calculer = useCallback(
    async (f: { nom: string; base64: string }, opt: { encodage?: string; separateur?: string }, corr: Correspondance | null) => {
      setOccupe(true);
      setErreur(null);
      setSucces(null);
      setConfirme(false);
      try {
        const r = await appelBff<ApercuReprise>(`v1/dossiers/${entiteId}/reprises-immobilisations/apercu`, {
          method: 'POST',
          json: { nomFichier: f.nom, contenuBase64: f.base64, ...(opt.encodage ? { encodage: opt.encodage } : {}), ...(opt.separateur ? { separateur: opt.separateur } : {}), ...(corr ? { correspondance: corr } : {}) },
        });
        setApercu(r);
        setCorrespondance(r.correspondance);
        setPage(1);
      } catch (e) {
        setApercu(null);
        setErreur(e instanceof ErreurHttp && (e.corps as { message?: string } | null)?.message ? `Fichier refusé : ${(e.corps as { message: string }).message}` : messageErreur(e));
      } finally {
        setOccupe(false);
      }
    },
    [entiteId],
  );

  async function choisir(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setApercu(null);
    setFichier(null);
    setOptions({});
    setErreur(null);
    setSucces(null);
    if (!f) return;
    if (f.size > TAILLE_MAX_FICHIER) {
      setErreur(`Fichier trop volumineux : ${formaterTaille(f.size)}, maximum ${formaterTaille(TAILLE_MAX_FICHIER)}. Rien n’a été envoyé.`);
      return;
    }
    if (f.size === 0) {
      setErreur('Le fichier est vide. Rien n’a été envoyé.');
      return;
    }
    const lu = { nom: f.name.slice(0, 255), base64: await versBase64(f), taille: f.size };
    setFichier(lu);
    await calculer(lu, {}, null);
  }

  async function valider() {
    if (!fichier || !apercu || !correspondance) return;
    setOccupe(true);
    setErreur(null);
    try {
      const r = await appelBff<RepriseVue>(`v1/dossiers/${entiteId}/reprises-immobilisations`, {
        method: 'POST',
        json: { nomFichier: fichier.nom, contenuBase64: fichier.base64, ...(options.encodage ? { encodage: options.encodage } : {}), ...(options.separateur ? { separateur: options.separateur } : {}), correspondance, empreinteApercu: apercu.empreinteApercu, confirmation: true },
      });
      setSucces(r.dejaImporte ? 'Ce fichier avait déjà été repris avec cette correspondance : voici son rapport, rien n’a été ajouté.' : `Reprise validée : ${r.nbCreees} immobilisation(s) créée(s).`);
      routeur.push(`?rapport=${r.id}`);
      routeur.refresh();
      setApercu(null);
      setFichier(null);
      if (entree.current) entree.current.value = '';
    } catch (e) {
      const corps = e instanceof ErreurHttp ? (e.corps as { code?: string } | null) : null;
      const message = messageErreur(e);
      // Aperçu périmé : on le recalcule pour que la personne relise ce qui serait réellement importé, puis on rappelle pourquoi.
      if (corps?.code === 'apercu_obsolete' && fichier) await calculer(fichier, options, correspondance);
      setErreur(message);
    } finally {
      setOccupe(false);
    }
  }

  const lignes = useMemo<LigneApercu[]>(() => (apercu ? apercu.lignes.filter((l) => filtre === 'toutes' || l.statut === filtre) : []), [apercu, filtre]);
  const pages = Math.max(1, Math.ceil(lignes.length / PAR_PAGE));
  const visibles = lignes.slice((page - 1) * PAR_PAGE, page * PAR_PAGE);

  return (
    <div className="space-y-6" data-testid="reprise-immobilisations">
      <Carte className="space-y-3">
        <SousTitre className="text-base">1. Choisir le fichier</SousTitre>
        <p className="text-sm text-texte-doux">
          Fichier CSV (séparateur point-virgule, virgule ou tabulation ; UTF-8 ou ISO-8859-15 ; virgule ou point décimal ; dates JJ/MM/AAAA ou AAAA-MM-JJ), {formaterTaille(TAILLE_MAX_FICHIER)} et 5 000 lignes au plus. Les classeurs Excel (.xlsx, .xls) ne sont pas pris en charge : enregistrez-les d’abord au format CSV.
          Le contenu est lu comme du texte : aucune formule n’est exécutée.
        </p>
        <div>
          <Libelle htmlFor={`${id}-fichier`}>Fichier des immobilisations (CSV)</Libelle>
          <input
            ref={entree}
            id={`${id}-fichier`}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            disabled={occupe}
            onChange={(e) => void choisir(e)}
            className="block min-h-11 w-full max-w-xl rounded-lg border border-bordure bg-surface px-3 py-2 text-base file:mr-3 file:min-h-9 file:rounded-md file:border-0 file:bg-surface-2 file:px-3"
          />
        </div>
        {occupe ? (
          <p role="status" className="text-sm text-texte-doux">
            Lecture du fichier en cours…
          </p>
        ) : null}
        <Retours erreur={erreur} succes={succes} />
      </Carte>

      {apercu && fichier ? (
        <>
          <Carte className="space-y-4" data-testid="apercu-reprise">
            <SousTitre className="text-base">2. Aperçu : rien n’est encore enregistré</SousTitre>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-texte-doux">Fichier</dt>
              <dd className="break-all">
                {apercu.fichier.nom} ({formaterTaille(apercu.fichier.taille)})
              </dd>
              <dt className="text-texte-doux">Lignes de données</dt>
              <dd>{apercu.fichier.nbLignes}</dd>
              <dt className="text-texte-doux">Empreinte SHA-256</dt>
              <dd className="break-all font-mono text-xs">{apercu.fichier.sha256}</dd>
            </dl>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Libelle htmlFor={`${id}-sep`}>Séparateur {apercu.fichier.separateurImpose ? '(choisi)' : '(détecté)'}</Libelle>
                <Liste
                  id={`${id}-sep`}
                  value={options.separateur ?? apercu.fichier.separateur}
                  disabled={occupe}
                  onChange={(e) => {
                    const o = { ...options, separateur: e.target.value };
                    setOptions(o);
                    void calculer(fichier, o, null);
                  }}
                >
                  {Object.entries(LIBELLE_SEPARATEUR).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Liste>
              </div>
              <div>
                <Libelle htmlFor={`${id}-enc`}>Encodage {apercu.fichier.encodageImpose ? '(choisi)' : `(détecté : ${LIBELLE_ENCODAGE[apercu.fichier.encodage] ?? apercu.fichier.encodage})`}</Libelle>
                <Liste
                  id={`${id}-enc`}
                  value={options.encodage ?? ''}
                  disabled={occupe}
                  onChange={(e) => {
                    const o = { ...options };
                    if (e.target.value) o.encodage = e.target.value;
                    else delete o.encodage;
                    setOptions(o);
                    void calculer(fichier, o, null);
                  }}
                >
                  <option value="">Détection automatique</option>
                  <option value="utf-8">UTF-8</option>
                  <option value="iso-8859-15">ISO-8859-15</option>
                  <option value="windows-1252">Windows-1252</option>
                </Liste>
              </div>
            </div>
            {apercu.fichier.avertissements.map((a) => (
              <Alerte key={a} ton="attention">
                {a}
              </Alerte>
            ))}

            <fieldset className="space-y-3" disabled={occupe}>
              <legend className="font-semibold">Correspondance des colonnes</legend>
              <p className="text-sm text-texte-doux">
                Proposée d’après les en-têtes du fichier ; modifiez-la si besoin. Une colonne ambiguë ou une durée sans unité n’est jamais devinée : vous la choisissez. Le mode dégressif d’un bien est enregistré comme déclaration du cabinet ; le calcul reste en abstention tant que l’éditeur ne l’a pas activé.
              </p>
              {apercu.remarques.map((r) => (
                <Alerte key={r} ton="attention" className="text-sm">
                  {r}
                </Alerte>
              ))}
              <div className="grid gap-3 md:grid-cols-2" data-testid="correspondance">
                {apercu.champs.map((c) => (
                  <div key={c.code}>
                    <Libelle htmlFor={`${id}-c-${c.code}`}>
                      {c.libelle}
                      {c.obligatoire ? ' (obligatoire)' : ''}
                    </Libelle>
                    <Liste
                      id={`${id}-c-${c.code}`}
                      data-champ={c.code}
                      aria-describedby={`${id}-a-${c.code}`}
                      value={correspondance?.[c.code] == null ? '' : String(correspondance[c.code])}
                      onChange={(e) => {
                        const suivante = { ...(correspondance ?? {}), [c.code]: e.target.value === '' ? null : Number(e.target.value) };
                        setCorrespondance(suivante);
                        void calculer(fichier, options, suivante);
                      }}
                    >
                      <option value="">— Aucune colonne —</option>
                      {apercu.entetes.map((h, i) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <option key={i} value={i}>{`Colonne ${i + 1} : ${h || '(sans titre)'}`}</option>
                      ))}
                    </Liste>
                    <p id={`${id}-a-${c.code}`} className="mt-1 text-sm text-texte-doux">
                      {c.aide}
                    </p>
                  </div>
                ))}
              </div>
            </fieldset>

            {apercu.problemes.length ? (
              <Alerte ton="danger" role="alert" data-testid="problemes-correspondance">
                <p className="font-semibold">La correspondance ne permet pas d’importer :</p>
                <ul className="list-disc pl-5">
                  {apercu.problemes.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Alerte>
            ) : null}

            <div role="status" aria-live="polite" data-testid="decomptes-apercu">
              <ul className="flex flex-wrap gap-2">
                <li>
                  <Etiquette ton="succes">Valides : {apercu.comptes.valides}</Etiquette>
                </li>
                <li>
                  <Etiquette ton="danger">Invalides : {apercu.comptes.invalides}</Etiquette>
                </li>
                <li>
                  <Etiquette ton="attention">Doublons ignorés : {apercu.comptes.doublons}</Etiquette>
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <Libelle htmlFor={`${id}-filtre`}>Afficher</Libelle>
                  <Liste
                    id={`${id}-filtre`}
                    value={filtre}
                    onChange={(e) => {
                      setFiltre(e.target.value as 'toutes' | StatutApercu);
                      setPage(1);
                    }}
                  >
                    <option value="toutes">Toutes les lignes</option>
                    <option value="valide">Valides</option>
                    <option value="invalide">Invalides</option>
                    <option value="doublon">Doublons</option>
                  </Liste>
                </div>
                <p className="text-sm text-texte-doux">
                  {lignes.length} ligne{lignes.length > 1 ? 's' : ''} — page {page} sur {pages}
                </p>
              </div>
              <Tableau legende="Aperçu ligne par ligne du fichier à reprendre">
                <thead>
                  <tr>
                    <th scope="col">Ligne</th>
                    <th scope="col">Statut</th>
                    <th scope="col">Motif</th>
                    <th scope="col">Valeurs lues</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((l) => (
                    <tr key={l.ligne} data-ligne={l.ligne} data-statut={l.statut}>
                      <th scope="row" className="!bg-transparent font-normal">
                        {l.ligne}
                      </th>
                      <td>
                        <Etiquette ton={TON[l.statut]}>{LIBELLE_STATUT_APERCU[l.statut]}</Etiquette>
                      </td>
                      <td className="break-words">{l.motifs.length ? l.motifs.join(' ; ') : '—'}</td>
                      <td className="break-words">
                        {valeursLuesAffichables(apercu.champs, l.lues)
                          .map((v) => `${v.libelle} : ${v.valeur}`)
                          .join(' ; ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Tableau>
              {pages > 1 ? (
                <div className="flex gap-2">
                  <Bouton variante="contour" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Page précédente
                  </Bouton>
                  <Bouton variante="contour" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                    Page suivante
                  </Bouton>
                </div>
              ) : null}
            </div>
          </Carte>

          <Carte className="space-y-3" data-testid="confirmation-reprise">
            <SousTitre className="text-base">3. Confirmer l’import</SousTitre>
            <Alerte ton="attention">
              La validation créera <strong>{apercu.comptes.valides}</strong> immobilisation{apercu.comptes.valides > 1 ? 's' : ''}, rejettera {apercu.comptes.invalides} ligne{apercu.comptes.invalides > 1 ? 's' : ''} et ignorera {apercu.comptes.doublons} doublon{apercu.comptes.doublons > 1 ? 's' : ''}. Aucune immobilisation existante n’est modifiée, remplacée ni supprimée. Le fichier original est conservé avec votre nom, la date et son empreinte, et un rapport ligne par ligne est enregistré.
            </Alerte>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={confirme} disabled={!apercu.peutValider || occupe} onChange={(e) => setConfirme(e.target.checked)} className="mt-1 size-5" />
              <span>J’ai relu l’aperçu et la correspondance des colonnes, et je confirme l’import de ces lignes valides dans ce dossier.</span>
            </label>
            <Bouton variante="primaire" disabled={!apercu.peutValider || !confirme || occupe} onClick={() => void valider()}>
              Valider l’import de {apercu.comptes.valides} immobilisation{apercu.comptes.valides > 1 ? 's' : ''}
            </Bouton>
            {!apercu.peutValider ? <p className="text-sm text-texte-doux">{apercu.problemes.length ? 'Corrigez la correspondance des colonnes pour pouvoir valider.' : 'Aucune ligne valide : il n’y a rien à importer.'}</p> : null}
          </Carte>
        </>
      ) : null}
    </div>
  );
}
