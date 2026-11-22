'use client';

import { useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, Liste, Saisie, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { LIBELLE_CATEGORIE } from '@/lib/fiscal';

/** Catégorie de taille déclarée par le cabinet pour l'annexe (`PUT v1/exercices/:id/annexe/categorie`). */
export function CategorieAnnexe({ exerciceId, actuelle }: { exerciceId: string; actuelle: string | null }) {
  const appel = useAppel();
  const [valeur, setValeur] = useState(actuelle ?? '');
  const id = useId();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void appel.executer(`v1/exercices/${exerciceId}/annexe/categorie`, { method: 'PUT', json: { categorie: valeur || null } }, 'Catégorie enregistrée.');
      }}
    >
      <div>
        <Libelle htmlFor={id}>Catégorie de taille retenue par le cabinet</Libelle>
        <Liste id={id} value={valeur} onChange={(e) => setValeur(e.target.value)} className="min-w-72">
          <option value="">À confirmer (aucun allègement appliqué)</option>
          {Object.entries(LIBELLE_CATEGORIE)
            .filter(([k]) => k !== 'a_confirmer')
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </Liste>
      </div>
      <Bouton type="submit" variante="secondaire" disabled={appel.occupe || valeur === (actuelle ?? '')}>
        Enregistrer la catégorie
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

/** Confirmation d'une rubrique de l'annexe par une personne habilitée (`PUT`/`DELETE v1/exercices/:id/annexe/rubriques/:rubrique`). */
export function ConfirmerRubrique({ exerciceId, rubrique, titre, confirmation, note }: { exerciceId: string; rubrique: string; titre: string; confirmation: 'complete' | 'non_applicable' | null; note: string | null }) {
  const appel = useAppel();
  const [texte, setTexte] = useState(note ?? '');
  const id = useId();
  const envoyer = (etat: 'complete' | 'non_applicable') =>
    void appel.executer(`v1/exercices/${exerciceId}/annexe/rubriques/${rubrique}`, { method: 'PUT', json: { etat, ...(texte.trim() ? { note: texte.trim() } : {}) } }, etat === 'complete' ? 'Rubrique confirmée complète.' : 'Rubrique confirmée non applicable.');
  return (
    <div className="space-y-2">
      <div>
        <Libelle htmlFor={id}>Information saisie par le cabinet pour « {titre} » (facultatif)</Libelle>
        <ZoneTexte id={id} rows={2} maxLength={8000} value={texte} onChange={(e) => setTexte(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Bouton variante="secondaire" disabled={appel.occupe} onClick={() => envoyer('complete')} aria-label={`Confirmer complète : ${titre}`}>
          Confirmer complète
        </Bouton>
        <Bouton variante="contour" disabled={appel.occupe} onClick={() => envoyer('non_applicable')} aria-label={`Confirmer non applicable : ${titre}`}>
          Non applicable
        </Bouton>
        {confirmation ? (
          <Bouton variante="contour" disabled={appel.occupe} onClick={() => void appel.executer(`v1/exercices/${exerciceId}/annexe/rubriques/${rubrique}`, { method: 'DELETE' }, 'Confirmation retirée.')} aria-label={`Retirer la confirmation : ${titre}`}>
            Retirer la confirmation
          </Bouton>
        ) : null}
      </div>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </div>
  );
}

/** Qualification d'un compte du chiffre d'affaires : France + exportations = solde (`PUT`/`DELETE v1/exercices/:id/qualifications/ventilation/:compte`). */
export function QualifierCompte({ exerciceId, compte, solde, qualification }: { exerciceId: string; compte: string; solde: string; qualification: { montantFrance: string; montantExport: string; note: string } | null }) {
  const appel = useAppel();
  const [france, setFrance] = useState(qualification?.montantFrance ?? '');
  const [export_, setExport] = useState(qualification?.montantExport ?? '');
  const [note, setNote] = useState(qualification?.note ?? '');
  const id = useId();
  return (
    <form
      className="grid gap-2 sm:grid-cols-[8rem_8rem_1fr_auto] sm:items-end"
      data-testid={`qualifier-${compte}`}
      onSubmit={(e) => {
        e.preventDefault();
        void appel.executer(`v1/exercices/${exerciceId}/qualifications/ventilation/${compte}`, { method: 'PUT', json: { montantFrance: france.trim(), montantExport: export_.trim(), note: note.trim() } }, 'Qualification enregistrée.');
      }}
    >
      <div>
        <Libelle htmlFor={`${id}-f`}>France</Libelle>
        <Saisie id={`${id}-f`} inputMode="decimal" placeholder={solde} value={france} onChange={(e) => setFrance(e.target.value)} required />
      </div>
      <div>
        <Libelle htmlFor={`${id}-e`}>Export. et intracom.</Libelle>
        <Saisie id={`${id}-e`} inputMode="decimal" placeholder="0.00" value={export_} onChange={(e) => setExport(e.target.value)} required />
      </div>
      <div>
        <Libelle htmlFor={`${id}-n`}>Justification (obligatoire)</Libelle>
        <Saisie id={`${id}-n`} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} required minLength={5} />
      </div>
      <div className="flex gap-2">
        <Bouton type="submit" variante="secondaire" disabled={appel.occupe} aria-label={`Qualifier le compte ${compte}`}>
          Enregistrer
        </Bouton>
        {qualification ? (
          <Bouton type="button" variante="contour" disabled={appel.occupe} onClick={() => void appel.executer(`v1/exercices/${exerciceId}/qualifications/ventilation/${compte}`, { method: 'DELETE' }, 'Qualification retirée.')} aria-label={`Retirer la qualification du compte ${compte}`}>
            Retirer
          </Bouton>
        ) : null}
      </div>
      <div className="sm:col-span-4">
        <Retours erreur={appel.erreur} succes={appel.succes} />
      </div>
    </form>
  );
}

/** Saisie d'un renvoi de bas de tableau (`PUT`/`DELETE v1/exercices/:id/qualifications/renvois/:code`). */
export function SaisirRenvoi({ exerciceId, code, proposition, saisie, avecNeant = false }: { exerciceId: string; code: string; proposition: string | null; saisie: { montant: string; note: string } | null; avecNeant?: boolean }) {
  const appel = useAppel();
  const [montant, setMontant] = useState(saisie?.montant ?? '');
  const [note, setNote] = useState(saisie?.note ?? '');
  const id = useId();
  const envoyer = (m: string, n: string, message: string) => void appel.executer(`v1/exercices/${exerciceId}/qualifications/renvois/${code}`, { method: 'PUT', json: { montant: m.trim(), note: n.trim() } }, message);
  return (
    <form
      className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end"
      data-testid={`renvoi-${code}`}
      onSubmit={(e) => {
        e.preventDefault();
        envoyer(montant, note, 'Renvoi enregistré.');
      }}
    >
      <div>
        <Libelle htmlFor={`${id}-m`}>Montant</Libelle>
        <Saisie id={`${id}-m`} inputMode="decimal" placeholder={proposition ?? '0.00'} value={montant} onChange={(e) => setMontant(e.target.value)} required />
      </div>
      <div>
        <Libelle htmlFor={`${id}-n`}>Justification (obligatoire)</Libelle>
        <Saisie id={`${id}-n`} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} required minLength={5} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Bouton type="submit" variante="secondaire" disabled={appel.occupe} aria-label={`Enregistrer le renvoi ${code}`}>
          Enregistrer
        </Bouton>
        {avecNeant ? (
          <Bouton
            type="button"
            variante="contour"
            disabled={appel.occupe}
            onClick={() => envoyer('0.00', note.trim().length >= 5 ? note : 'Néant : aucune opération de cette nature, déclaré par le cabinet', 'Néant enregistré.')}
            aria-label={`Déclarer néant pour ${code}`}
          >
            Déclarer néant
          </Bouton>
        ) : null}
        {saisie ? (
          <Bouton type="button" variante="contour" disabled={appel.occupe} onClick={() => void appel.executer(`v1/exercices/${exerciceId}/qualifications/renvois/${code}`, { method: 'DELETE' }, 'Saisie retirée.')} aria-label={`Retirer la saisie du renvoi ${code}`}>
            Retirer
          </Bouton>
        ) : null}
      </div>
      <div className="sm:col-span-3">
        <Retours erreur={appel.erreur} succes={appel.succes} />
      </div>
    </form>
  );
}

/** Champ d'une saisie de tableau (cadre III du 2033-C, 2054 bis) : libellé, nature (texte, montant, choix) et valeur courante. */
export interface ChampSaisie {
  cle: string;
  libelle: string;
  type: 'texte' | 'montant' | 'choix';
  options?: Array<{ valeur: string; libelle: string }>;
  valeur?: string;
  /** Champ pouvant rester vide (information inexistante) : envoyé vide, jamais présumé. */
  optionnel?: boolean;
}

/**
 * Saisie d'UNE ligne d'un tableau servi par saisie (`PUT`/`DELETE v1/exercices/:id/tableaux/:tableau/:ligne`) : champs du tableau,
 * justification obligatoire. « Déclarer néant » (tableau entier) se fait par `NeantTableau`.
 */
export function SaisieLigneTableau({ exerciceId, tableau, ligne, champs, noteCourante, saisie, etiquette }: { exerciceId: string; tableau: string; ligne: string; champs: ChampSaisie[]; noteCourante: string | null; saisie: boolean; etiquette: string }) {
  const appel = useAppel();
  const [valeurs, setValeurs] = useState<Record<string, string>>(Object.fromEntries(champs.map((c) => [c.cle, c.valeur ?? (c.type === 'choix' ? (c.options?.[0]?.valeur ?? '') : '')])));
  const [note, setNote] = useState(noteCourante ?? '');
  const id = useId();
  return (
    <form
      className="space-y-2"
      data-testid={`saisie-${tableau}-${ligne}`}
      onSubmit={(e) => {
        e.preventDefault();
        void appel.executer(`v1/exercices/${exerciceId}/tableaux/${tableau}/${ligne}`, { method: 'PUT', json: { valeurs: Object.fromEntries(Object.entries(valeurs).map(([k, v]) => [k, v.trim()]).filter(([k, v]) => !(v === '' && champs.some((c) => c.cle === k && c.type === 'montant' && c.optionnel === true)))), note: note.trim() } }, 'Ligne enregistrée.');
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        {champs.map((c) => (
          <div key={c.cle} className={c.type === 'texte' ? 'min-w-56 flex-1' : ''}>
            <Libelle htmlFor={`${id}-${c.cle}`}>{c.libelle}</Libelle>
            {c.type === 'choix' ? (
              <Liste id={`${id}-${c.cle}`} value={valeurs[c.cle]} onChange={(e) => setValeurs({ ...valeurs, [c.cle]: e.target.value })}>
                {c.options?.map((o) => (
                  <option key={o.valeur} value={o.valeur}>
                    {o.libelle}
                  </option>
                ))}
              </Liste>
            ) : (
              <Saisie id={`${id}-${c.cle}`} className={c.type === 'montant' ? 'w-28' : ''} inputMode={c.type === 'montant' ? 'decimal' : undefined} placeholder={c.type === 'montant' ? '0.00' : undefined} maxLength={c.type === 'texte' ? 200 : 20} value={valeurs[c.cle]} onChange={(e) => setValeurs({ ...valeurs, [c.cle]: e.target.value })} required={c.optionnel !== true} />
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <Libelle htmlFor={`${id}-note`}>Justification (obligatoire)</Libelle>
          <Saisie id={`${id}-note`} maxLength={2000} minLength={5} value={note} onChange={(e) => setNote(e.target.value)} required />
        </div>
        <Bouton type="submit" variante="secondaire" disabled={appel.occupe} aria-label={`Enregistrer ${etiquette}`}>
          Enregistrer
        </Bouton>
        {saisie ? (
          <Bouton type="button" variante="contour" disabled={appel.occupe} onClick={() => void appel.executer(`v1/exercices/${exerciceId}/tableaux/${tableau}/${ligne}`, { method: 'DELETE' }, 'Saisie retirée.')} aria-label={`Retirer la saisie de ${etiquette}`}>
            Retirer
          </Bouton>
        ) : null}
      </div>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

/** Déclaration « néant » d'un tableau entier (ligne NEANT) ou retrait de cette déclaration. */
export function NeantTableau({ exerciceId, tableau, declare, etiquette }: { exerciceId: string; tableau: string; declare: boolean; etiquette: string }) {
  const appel = useAppel();
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`neant-${tableau}`}>
      {declare ? (
        <Bouton variante="contour" disabled={appel.occupe} onClick={() => void appel.executer(`v1/exercices/${exerciceId}/tableaux/${tableau}/NEANT`, { method: 'DELETE' }, 'Néant retiré.')} aria-label={`Retirer le néant : ${etiquette}`}>
          Retirer la déclaration « néant »
        </Bouton>
      ) : (
        <Bouton variante="contour" disabled={appel.occupe} onClick={() => void appel.executer(`v1/exercices/${exerciceId}/tableaux/${tableau}/NEANT`, { method: 'PUT', json: { valeurs: {}, note: `Néant : aucune opération de cette nature (${etiquette}), déclaré par le cabinet` } }, 'Néant enregistré.')} aria-label={`Déclarer néant : ${etiquette}`}>
          Déclarer néant : {etiquette}
        </Bouton>
      )}
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </div>
  );
}

export interface CaseASaisir {
  cle: string;
  code: string;
  libelle: string;
  valeur: string;
  saisie: boolean;
}

/**
 * Saisie de PLUSIEURS cases d'une même ligne d'un formulaire (une saisie justifiée par case : `PUT v1/exercices/:id/qualifications/renvois/:cle`),
 * avec une justification commune. « Néant pour les cases vides » déclare 0,00 explicitement ; une case laissée vide n'est pas touchée.
 */
export function SaisieCases({ exerciceId, cases, noteCourante, etiquette }: { exerciceId: string; cases: CaseASaisir[]; noteCourante: string | null; etiquette: string }) {
  const appel = useAppel();
  const [valeurs, setValeurs] = useState<Record<string, string>>(Object.fromEntries(cases.map((c) => [c.cle, c.valeur])));
  const [note, setNote] = useState(noteCourante ?? '');
  const id = useId();
  const enregistrer = async (neantPourVides: boolean) => {
    for (const c of cases) {
      const v = (valeurs[c.cle] ?? '').trim();
      const aEnvoyer = v !== '' ? v : neantPourVides && !c.saisie ? '0.00' : null;
      if (aEnvoyer === null) continue;
      const r = await appel.executer(`v1/exercices/${exerciceId}/qualifications/renvois/${c.cle}`, { method: 'PUT', json: { montant: aEnvoyer, note: note.trim() || 'Néant : aucune opération de cette nature, déclaré par le cabinet' } }, 'Case(s) enregistrée(s).');
      if (r === null) return;
    }
  };
  return (
    <form
      className="space-y-2"
      data-testid={`cases-${etiquette}`}
      onSubmit={(e) => {
        e.preventDefault();
        void enregistrer(false);
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        {cases.map((c) => (
          <div key={c.cle}>
            <Libelle htmlFor={`${id}-${c.cle}`}>
              {c.libelle} (case {c.code})
            </Libelle>
            <Saisie id={`${id}-${c.cle}`} className="w-28" inputMode="decimal" placeholder="0.00" value={valeurs[c.cle] ?? ''} onChange={(e) => setValeurs({ ...valeurs, [c.cle]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <Libelle htmlFor={`${id}-note`}>Justification (obligatoire, commune aux cases saisies)</Libelle>
          <Saisie id={`${id}-note`} maxLength={2000} minLength={5} value={note} onChange={(e) => setNote(e.target.value)} required />
        </div>
        <Bouton type="submit" variante="secondaire" disabled={appel.occupe} aria-label={`Enregistrer les cases : ${etiquette}`}>
          Enregistrer
        </Bouton>
        <Bouton type="button" variante="contour" disabled={appel.occupe || note.trim().length < 5} onClick={() => void enregistrer(true)} aria-label={`Néant pour les cases vides : ${etiquette}`}>
          Néant pour les cases vides
        </Bouton>
        {cases.some((c) => c.saisie) ? (
          <Bouton
            type="button"
            variante="contour"
            disabled={appel.occupe}
            onClick={async () => {
              for (const c of cases.filter((x) => x.saisie)) {
                const r = await appel.executer(`v1/exercices/${exerciceId}/qualifications/renvois/${c.cle}`, { method: 'DELETE' }, 'Saisie(s) retirée(s).');
                if (r === null) return;
              }
            }}
            aria-label={`Retirer les saisies : ${etiquette}`}
          >
            Retirer les saisies
          </Bouton>
        ) : null}
      </div>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

/** Reprise d'une proposition du moteur comme écriture d'inventaire proposée (`POST …/inventaire/propositions/:id/reprise`). */
export function ReprendreProposition({ exerciceId, propositionId, libelle }: { exerciceId: string; propositionId: string; libelle: string }) {
  const appel = useAppel();
  return (
    <div className="space-y-2">
      <Bouton
        variante="secondaire"
        disabled={appel.occupe}
        aria-label={`Reprendre comme écriture proposée : ${libelle}`}
        onClick={() => void appel.executer(`v1/exercices/${exerciceId}/inventaire/propositions/${encodeURIComponent(propositionId)}/reprise`, { method: 'POST' }, 'Reprise comme écriture d’inventaire proposée : elle reste un projet, à approuver par une autre personne.')}
      >
        Reprendre comme écriture proposée
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </div>
  );
}

export interface Immobilisation {
  id: string;
  libelle: string;
  compteImmobilisation: string;
  /** Valeur brute à amortir (la valeur résiduelle éventuelle s'en déduit). */
  baseAmortissable: string;
  /** Date d'acquisition (ou de construction) : point de départ du dégressif (premier jour du mois). */
  dateAcquisition?: string | null;
  dateMiseEnService: string;
  dureeMois: number;
  amortissementsAnterieurs: string | null;
  modeAmortissement?: 'lineaire' | 'degressif';
  coefficientDegressif?: string | null;
  eligibiliteDegressifConfirmee?: boolean | null;
  valeurResiduelle?: string | null;
  dateSortie?: string | null;
  composantDe?: string | null;
}

/** Coefficient du dégressif selon la durée en années (3-4 ans : 1,25 ; 5-6 ans : 1,75 ; au-delà : 2,25). */
export function coefficientPourDuree(dureeMois: number): string | null {
  if (!Number.isInteger(dureeMois) || dureeMois % 12 !== 0 || dureeMois < 36 || dureeMois > 600) return null;
  const ans = dureeMois / 12;
  return ans <= 4 ? '1.25' : ans <= 6 ? '1.75' : '2.25';
}

const EXPLICATION_MODE: Record<'lineaire' | 'degressif', string> = {
  lineaire:
    'Annuité constante sur la durée, à compter de la mise en service ; c’est le mode appliqué à défaut de mode mieux adapté (PCG art. 214-13). Vous répondez de la durée retenue : le moteur ne la juge pas.',
  degressif:
    'Annuités décroissantes : taux linéaire × coefficient, appliqué à la valeur nette comptable, avec bascule au linéaire quand il devient plus favorable (faculté de l’entreprise) ; prorata au mois la première année, à compter du premier jour du mois d’acquisition. Les coefficients majorés ou diminués de certains biens d’équipement ne sont pas pris en charge. Ce mode est ici celui du plan d’amortissement COMPTABLE, que vous choisissez (PCG art. 214-13) : Comtaple ne devine ni le mode, ni l’éligibilité, ni le coefficient. Si le dégressif n’est retenu que pour la déduction fiscale, le complément est un amortissement dérogatoire (comptes 145, 6872, 7872) que Comtaple ne propose pas : il est signalé et reste à traiter par le professionnel. Les règles du dégressif ne sont pas validées par un professionnel.',
};

/** Saisie d'une immobilisation dans le fichier du dossier (`POST v1/dossiers/:id/immobilisations`). */
export function SaisirImmobilisation({ dossierId, structures = [], degressifActive = false }: { dossierId: string; structures?: Immobilisation[]; degressifActive?: boolean }) {
  const appel = useAppel();
  const vide = { libelle: '', compte: '', base: '', acquisition: '', date: '', duree: '', anterieurs: '', mode: 'lineaire', coefficient: '', eligible: false, residuelle: '', sortie: '', composant: '' };
  const [f, setF] = useState(vide);
  const id = useId();
  const maj = (m: Partial<typeof vide>) => setF((v) => ({ ...v, ...m }));
  const decimal = (v: string) => v.trim().replace(/\s/g, '').replace(',', '.');
  const degressif = f.mode === 'degressif';
  const attendu = degressif ? coefficientPourDuree(Number(f.duree)) : null;
  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      aria-label="Saisir une immobilisation"
      data-formulaire="saisir-immobilisation"
      onSubmit={async (e) => {
        e.preventDefault();
        const corps = {
          libelle: f.libelle,
          compteImmobilisation: f.compte.trim(),
          baseAmortissable: decimal(f.base),
          ...(f.acquisition ? { dateAcquisition: f.acquisition } : {}),
          dateMiseEnService: f.date,
          dureeMois: Number(f.duree),
          modeAmortissement: f.mode,
          ...(f.anterieurs.trim() ? { amortissementsAnterieurs: decimal(f.anterieurs) } : {}),
          ...(f.residuelle.trim() ? { valeurResiduelle: decimal(f.residuelle) } : {}),
          ...(f.sortie ? { dateSortie: f.sortie } : {}),
          ...(f.composant ? { composantDe: f.composant } : {}),
          ...(degressif ? { coefficientDegressif: f.coefficient, eligibiliteDegressifConfirmee: f.eligible } : {}),
        };
        const r = await appel.executer(`v1/dossiers/${dossierId}/immobilisations`, { method: 'POST', json: corps }, 'Immobilisation enregistrée : la dotation de l’exercice figure dans les propositions du moteur.');
        if (r) setF(vide);
      }}
    >
      <div>
        <Libelle htmlFor={`${id}-lib`}>Désignation</Libelle>
        <Saisie id={`${id}-lib`} required maxLength={200} value={f.libelle} onChange={(e) => maj({ libelle: e.target.value })} autoComplete="off" />
      </div>
      <div>
        <Libelle htmlFor={`${id}-compte`}>Compte d’immobilisation (classe 2)</Libelle>
        <Saisie id={`${id}-compte`} required inputMode="numeric" pattern="2[0-9]{2,11}" value={f.compte} onChange={(e) => maj({ compte: e.target.value })} autoComplete="off" />
      </div>
      <div>
        <Libelle htmlFor={`${id}-base`}>Valeur brute à amortir (€)</Libelle>
        <Saisie id={`${id}-base`} required inputMode="decimal" value={f.base} onChange={(e) => maj({ base: e.target.value })} autoComplete="off" />
      </div>
      <div>
        <Libelle htmlFor={`${id}-res`}>Valeur résiduelle (€, facultatif)</Libelle>
        <Saisie id={`${id}-res`} inputMode="decimal" value={f.residuelle} onChange={(e) => maj({ residuelle: e.target.value })} autoComplete="off" aria-describedby={`${id}-aide-res`} />
        <p id={`${id}-aide-res`} className="mt-1 text-sm text-texte-doux">
          Seulement si elle est significative et mesurable (PCG art. 214-4) ; strictement inférieure à la valeur brute. Le montant amortissable est la valeur brute moins la valeur résiduelle.
        </p>
      </div>
      <div>
        <Libelle htmlFor={`${id}-acq`}>{degressif ? 'Date d’acquisition ou de construction' : 'Date d’acquisition (facultatif)'}</Libelle>
        <Saisie id={`${id}-acq`} type="date" required={degressif} value={f.acquisition} onChange={(e) => maj({ acquisition: e.target.value })} aria-describedby={`${id}-aide-acq`} />
        <p id={`${id}-aide-acq`} className="mt-1 text-sm text-texte-doux">
          {degressif ? 'Obligatoire en dégressif : le point de départ est le premier jour du mois d’acquisition (BOFiP BOI-BIC-AMT-20-20-30). Jamais postérieure à la mise en service.' : 'Sans effet sur le linéaire, dont le point de départ est la mise en service.'}
        </p>
      </div>
      <div>
        <Libelle htmlFor={`${id}-date`}>Date de mise en service</Libelle>
        <Saisie id={`${id}-date`} type="date" required value={f.date} onChange={(e) => maj({ date: e.target.value })} />
      </div>
      <div>
        <Libelle htmlFor={`${id}-duree`}>Durée d’amortissement (mois)</Libelle>
        <Saisie id={`${id}-duree`} required inputMode="numeric" pattern="[0-9]{1,4}" value={f.duree} onChange={(e) => maj({ duree: e.target.value })} autoComplete="off" />
      </div>
      <div>
        <Libelle htmlFor={`${id}-ant`}>Amortissements antérieurs (€, facultatif)</Libelle>
        <Saisie id={`${id}-ant`} inputMode="decimal" value={f.anterieurs} onChange={(e) => maj({ anterieurs: e.target.value })} autoComplete="off" />
      </div>
      <div>
        <Libelle htmlFor={`${id}-sortie`}>Date de sortie de l’actif (facultatif)</Libelle>
        <Saisie id={`${id}-sortie`} type="date" value={f.sortie} onChange={(e) => maj({ sortie: e.target.value })} aria-describedby={`${id}-aide-sortie`} />
        <p id={`${id}-aide-sortie`} className="mt-1 text-sm text-texte-doux">
          Cession ou mise au rebut : si elle tombe dans ou avant l’exercice, le moteur s’abstient (il ne calcule pas la plus ou moins-value) et le dit.
        </p>
      </div>
      <div>
        <Libelle htmlFor={`${id}-comp`}>Composant de (facultatif)</Libelle>
        <Liste id={`${id}-comp`} value={f.composant} onChange={(e) => maj({ composant: e.target.value })}>
          <option value="">Aucun (immobilisation autonome)</option>
          {structures
            .filter((x) => !x.composantDe)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.libelle}
              </option>
            ))}
        </Liste>
        <p className="mt-1 text-sm text-texte-doux">Un composant a son propre plan (PCG art. 214-9) : saisissez la structure d’abord, puis chaque composant avec sa durée.</p>
      </div>
      <div className="sm:col-span-2 lg:col-span-3 space-y-2 rounded-lg border border-bordure p-3" data-testid="choix-mode">
        <div className="max-w-md">
          <Libelle htmlFor={`${id}-mode`}>Mode d’amortissement (plan comptable)</Libelle>
          <Liste id={`${id}-mode`} value={f.mode} onChange={(e) => maj({ mode: e.target.value, ...(e.target.value === 'lineaire' ? { coefficient: '', eligible: false } : {}) })}>
            <option value="lineaire">Linéaire (par défaut)</option>
            <option value="degressif">{degressifActive ? 'Dégressif (sur déclaration du cabinet)' : 'Dégressif (déclaration du cabinet — calcul non activé)'}</option>
          </Liste>
        </div>
        <p className="text-sm text-texte-doux" data-testid="explication-mode">
          {EXPLICATION_MODE[degressif ? 'degressif' : 'lineaire']}
        </p>
        {degressif ? (
          <Alerte ton="attention" className="text-sm" data-testid="avertissement-degressif">
            {degressifActive
              ? 'Calcul du dégressif activé par l’éditeur ; le texte de loi (CGI art. 39 A) reste non vérifié sur une source officielle et les règles ne sont pas validées par un professionnel.'
              : 'Calcul du dégressif non activé : votre déclaration est enregistrée, mais aucun calcul ni aucune proposition d’écriture n’en découle. Le texte de loi (CGI art. 39 A) n’a pas été vérifié sur une source officielle et les règles n’ont pas été validées par un professionnel ; l’activation relève de l’éditeur.'}
          </Alerte>
        ) : null}
        {degressif ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="champs-degressif">
            <div>
              <Libelle htmlFor={`${id}-coef`}>Coefficient dégressif déclaré</Libelle>
              <Liste id={`${id}-coef`} value={f.coefficient} onChange={(e) => maj({ coefficient: e.target.value })} required>
                <option value="">Choisir…</option>
                <option value="1.25">1,25 (durée de 3 ou 4 ans)</option>
                <option value="1.75">1,75 (durée de 5 ou 6 ans)</option>
                <option value="2.25">2,25 (durée de plus de 6 ans)</option>
              </Liste>
              <p className="mt-1 text-sm text-texte-doux" data-testid="coefficient-attendu">
                {attendu ? `Pour cette durée (${Number(f.duree) / 12} ans), le coefficient cohérent est ${attendu.replace('.', ',')}.` : 'Durée en années entières, de 3 à 50 ans (36 à 600 mois), exigée en dégressif.'} Le serveur refuse un coefficient incohérent avec la durée.
              </p>
            </div>
            <div>
              <label className="flex min-h-11 items-start gap-2 text-base">
                <input type="checkbox" autoComplete="off" className="mt-1 size-5 shrink-0" checked={f.eligible} onChange={(e) => maj({ eligible: e.target.checked })} />
                <span>
                  Je confirme que le bien remplit les conditions du dégressif : neuf, durée d’au moins trois ans, bien visé par l’article 39 A du CGI, hors exclusions (voitures de tourisme, mobilier de bureau, locaux…).
                  <span className="block text-sm text-texte-doux">Le cabinet en répond : Comtaple ne le vérifie pas. Sans cette confirmation, le moteur s’abstient.</span>
                </span>
              </label>
            </div>
          </div>
        ) : null}
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <Bouton type="submit" variante="secondaire" disabled={appel.occupe}>
          Enregistrer l’immobilisation
        </Bouton>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <Retours erreur={appel.erreur} succes={appel.succes} />
      </div>
    </form>
  );
}

export function RetirerImmobilisation({ dossierId, immobilisation }: { dossierId: string; immobilisation: Immobilisation }) {
  const appel = useAppel();
  return (
    <>
      <Bouton variante="contour" disabled={appel.occupe} aria-label={`Retirer du fichier : ${immobilisation.libelle}`} onClick={() => void appel.executer(`v1/dossiers/${dossierId}/immobilisations/${immobilisation.id}`, { method: 'DELETE' }, 'Immobilisation retirée du fichier.')}>
        Retirer
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </>
  );
}
