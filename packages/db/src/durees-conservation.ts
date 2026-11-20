/**
 * Durées de conservation et délai de grâce PARAMÉTRABLES (D-099).
 *
 * Les durées juridiques ne sont pas arrêtées par ce projet : elles relèvent d'un avocat et du délégué à la protection
 * des données (docs/acces-externes.md). Ce module ne fixe donc AUCUNE durée : il lit un jeu de paramètres VERSIONNÉ
 * (fichier JSON de l'éditeur), le valide contre la politique de fin de contrat et en calcule les échéances.
 *
 *  - Le jeu fourni par défaut (`PARAMETRES_PROPOSES`) est une PROPOSITION NON VALIDÉE, marquée comme telle dans son
 *    statut, son nom de version et tout affichage. Il reprend les valeurs de travail de docs/conservation.md.
 *  - Une EXÉCUTION RÉELLE de fin de contrat (`--appliquer`) est impossible tant que l'éditeur n'a pas fourni la
 *    référence de la validation (`--durees-validees=<référence>`) : cette référence, l'empreinte du jeu de paramètres
 *    et sa version sont inscrites au journal du cabinet et au procès-verbal. Ce module ne vérifie PAS que la validation
 *    a eu lieu (il ne le peut pas) : il impose qu'une personne l'affirme explicitement, et que l'affirmation soit tracée.
 *  - Un jeu dont le statut n'est pas « PROPOSITION NON VALIDÉE » doit porter sa validation (référence, date, auteur).
 *
 * Ce fichier est PUR (aucune base, aucun réseau, aucune écriture) : les simulations qui lisent la base sont dans
 * `simulation-conservation.ts`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const FORMAT_DUREES = 'comtaple.durees-conservation/1';
export const STATUT_PROPOSITION = 'PROPOSITION NON VALIDÉE';

export type Duree = { jours: number } | { jusqu_au: string };
export type PointDeDepart = 'fin_de_contrat' | 'evenement' | 'cloture_exercice_editeur';
/** Ce qui est fait d'un élément à l'échéance : le détruire, le pseudonymiser, ou (journal seulement) le sceller et le soumettre à une revue humaine. */
export type ApresEcheance = 'supprimer' | 'pseudonymiser' | 'sceller';

export interface RegleCategorie {
  /** Durée de conservation à partir du point de départ : en jours, ou jusqu'à une date. 0 jour = pas de conservation propre. */
  duree: Duree;
  pointDeDepart: PointDeDepart;
  apresEcheance: ApresEcheance;
  /** Fondement invoqué, tel que l'éditeur le consigne (texte libre, non vérifié). */
  fondement?: string;
}

export interface ParametresDurees {
  format: typeof FORMAT_DUREES;
  /** Version du jeu de paramètres (change à chaque modification). */
  version: string;
  /** « PROPOSITION NON VALIDÉE » ou tout autre statut, alors accompagné de `validation`. */
  statut: string;
  validation: { reference: string; date: string; par: string } | null;
  /** Délai entre la fin de l'abonnement et l'exécution de la fin de contrat (30 à 3650 jours). */
  delaiGraceJours: number;
  /** Une règle par catégorie de la politique de fin de contrat (`code` de POLITIQUE_FIN_DE_CONTRAT). */
  categories: Record<string, RegleCategorie>;
  /** Rotation des sauvegardes (scripts/sauvegardes-rotation.mjs). */
  sauvegardes: { retentionJours: number; jeuxMinimumConserves: number };
  /** Comptes du fournisseur d'identité devenus sans appartenance. */
  comptes: { delaiDesactivationJours: number; delaiSuppressionApresDesactivationJours: number };
}

/** Catégories de la politique et leur devenir : copie VÉRIFIÉE par un test contre POLITIQUE_FIN_DE_CONTRAT. */
const j = (jours: number): Duree => ({ jours });
const AUCUNE: RegleCategorie = { duree: j(0), pointDeDepart: 'fin_de_contrat', apresEcheance: 'supprimer' };
const CINQ_ANS: RegleCategorie = { duree: j(1826), pointDeDepart: 'fin_de_contrat', apresEcheance: 'supprimer', fondement: 'Prescription de droit commun (Code civil, art. 2224 ; Code de commerce, art. L. 110-4) — valeur de travail' };

/** Jeu proposé : valeurs de travail de docs/conservation.md. AUCUNE n'est validée. */
export const PARAMETRES_PROPOSES: ParametresDurees = {
  format: FORMAT_DUREES,
  version: '2026-11-20.1-PROPOSITION',
  statut: STATUT_PROPOSITION,
  validation: null,
  delaiGraceJours: 90,
  categories: {
    comptes_appartenances: AUCUNE,
    dossiers: AUCUNE,
    pieces_fichiers: AUCUNE,
    ecritures_importees: AUCUNE,
    banque: AUCUNE,
    controles_constats: AUCUNE,
    decisions_validations: AUCUNE,
    missions_conseils: AUCUNE,
    regles_parametres: AUCUNE,
    messagerie: AUCUNE,
    notifications: AUCUNE,
    assistant: AUCUNE,
    traces_ia: { duree: j(183), pointDeDepart: 'evenement', apresEcheance: 'supprimer', fondement: 'Mesures d’exploitation, bas de la fourchette de la recommandation CNIL sur la journalisation — valeur de travail' },
    abonnement_facturation: { duree: j(3652), pointDeDepart: 'cloture_exercice_editeur', apresEcheance: 'supprimer', fondement: 'Code de commerce, art. L. 123-22 ; LPF, art. L. 102 B — valeur de travail' },
    restitutions_dossier: AUCUNE,
    restitutions_cabinet: CINQ_ANS,
    journal_audit: { duree: j(3652), pointDeDepart: 'evenement', apresEcheance: 'sceller', fondement: 'Recommandation CNIL sur la journalisation (12 mois à 10 ans selon l’acte) — la plus longue s’applique tant que le journal n’est pas scindé' },
    politiques_conservation: CINQ_ANS,
    fin_de_contrat: CINQ_ANS,
  },
  sauvegardes: { retentionJours: 90, jeuxMinimumConserves: 3 },
  comptes: { delaiDesactivationJours: 0, delaiSuppressionApresDesactivationJours: 30 },
};

/** Ce que la validation attend de la politique : devenir de chaque catégorie. */
export interface CategoriePolitique { code: string; devenir: 'supprimer' | 'conserver_jusqu_a' | 'anonymiser' | 'restituer_puis_supprimer' }

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const estDate = (s: string) => DATE_ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Erreurs du jeu de paramètres (liste vide = valide). Ne dit rien de la VALIDITÉ JURIDIQUE des durées. */
export function validerParametres(p: unknown, politique: readonly CategoriePolitique[]): string[] {
  const e: string[] = [];
  if (typeof p !== 'object' || p === null) return ['le jeu de paramètres n’est pas un objet JSON'];
  const x = p as Partial<ParametresDurees>;
  if (x.format !== FORMAT_DUREES) e.push(`format attendu « ${FORMAT_DUREES} »`);
  if (typeof x.version !== 'string' || x.version.length < 3) e.push('version absente');
  if (typeof x.statut !== 'string' || x.statut.length < 3) e.push('statut absent');
  else if (x.statut !== STATUT_PROPOSITION) {
    const v = x.validation;
    if (!v || typeof v.reference !== 'string' || v.reference.trim().length < 6 || typeof v.par !== 'string' || !v.par.trim() || typeof v.date !== 'string' || !estDate(v.date)) e.push('un statut autre que « PROPOSITION NON VALIDÉE » exige validation { reference (6 caractères au moins), date AAAA-MM-JJ, par }');
  }
  if (x.statut === STATUT_PROPOSITION && x.validation) e.push('un jeu « PROPOSITION NON VALIDÉE » ne porte pas de validation');
  if (!Number.isInteger(x.delaiGraceJours) || x.delaiGraceJours! < 30 || x.delaiGraceJours! > 3650) e.push('delaiGraceJours : entier entre 30 et 3650');
  const cats = x.categories;
  if (typeof cats !== 'object' || cats === null) e.push('categories absentes');
  else {
    const codes = politique.map((c) => c.code);
    for (const c of codes) if (!(c in cats)) e.push(`catégorie « ${c} » sans règle`);
    for (const c of Object.keys(cats)) if (!codes.includes(c)) e.push(`catégorie « ${c} » inconnue de la politique`);
    for (const c of politique) {
      const r = (cats as Record<string, RegleCategorie | undefined>)[c.code];
      if (!r) continue;
      const d = r.duree as Record<string, unknown> | undefined;
      if (!d || (('jours' in d) === ('jusqu_au' in d))) e.push(`${c.code} : duree = { jours } OU { jusqu_au }`);
      else if ('jours' in d && (!Number.isInteger(d.jours) || (d.jours as number) < 0 || (d.jours as number) > 36500)) e.push(`${c.code} : jours = entier de 0 à 36500`);
      else if ('jusqu_au' in d && (typeof d.jusqu_au !== 'string' || !estDate(d.jusqu_au))) e.push(`${c.code} : jusqu_au = date AAAA-MM-JJ valide`);
      if (!['fin_de_contrat', 'evenement', 'cloture_exercice_editeur'].includes(r.pointDeDepart)) e.push(`${c.code} : pointDeDepart inconnu`);
      if (!['supprimer', 'pseudonymiser', 'sceller'].includes(r.apresEcheance)) e.push(`${c.code} : apresEcheance inconnu`);
      const supprimee = c.devenir === 'supprimer' || c.devenir === 'restituer_puis_supprimer';
      if (supprimee && (r.pointDeDepart !== 'fin_de_contrat' || r.apresEcheance !== 'supprimer')) e.push(`${c.code} : catégorie supprimée à l’exécution — point de départ « fin_de_contrat » et « supprimer » seuls admis`);
      if (supprimee && 'jusqu_au' in (r.duree ?? {})) e.push(`${c.code} : une catégorie supprimée à l’exécution se règle en jours (délai après la fin de l’abonnement), pas « jusqu_au »`);
      if (!supprimee && 'jours' in (r.duree ?? {}) && (r.duree as { jours: number }).jours === 0) e.push(`${c.code} : une catégorie conservée ou anonymisée exige une durée de conservation non nulle`);
      if (r.apresEcheance === 'sceller' && c.code !== 'journal_audit') e.push(`${c.code} : « sceller » n’est admis que pour le journal d’audit`);
    }
  }
  const s = x.sauvegardes;
  if (!s || !Number.isInteger(s.retentionJours) || s.retentionJours < 7 || s.retentionJours > 3650) e.push('sauvegardes.retentionJours : entier entre 7 et 3650');
  if (!s || !Number.isInteger(s.jeuxMinimumConserves) || s.jeuxMinimumConserves < 1 || s.jeuxMinimumConserves > 1000) e.push('sauvegardes.jeuxMinimumConserves : entier entre 1 et 1000');
  const c = x.comptes;
  if (!c || !Number.isInteger(c.delaiDesactivationJours) || c.delaiDesactivationJours < 0 || c.delaiDesactivationJours > 3650) e.push('comptes.delaiDesactivationJours : entier entre 0 et 3650');
  if (!c || !Number.isInteger(c.delaiSuppressionApresDesactivationJours) || c.delaiSuppressionApresDesactivationJours < 0 || c.delaiSuppressionApresDesactivationJours > 3650) e.push('comptes.delaiSuppressionApresDesactivationJours : entier entre 0 et 3650');
  return e;
}

function canonique(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonique).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonique(o[k])}`).join(',')}}`;
}
/** Empreinte (SHA-256 du JSON canonique) d'un jeu de paramètres : c'est elle que le procès-verbal consigne. */
export const empreinteParametres = (p: ParametresDurees): string => createHash('sha256').update(canonique(p), 'utf8').digest('hex');

export interface ParametresCharges {
  parametres: ParametresDurees;
  empreinte: string;
  /** « defaut » : le jeu PROPOSÉ du code ; « fichier » : lu depuis le chemin donné. */
  source: 'defaut' | 'fichier';
  chemin: string | null;
  /** Vrai tant que le statut est « PROPOSITION NON VALIDÉE ». */
  nonValide: boolean;
}

/** Charge un jeu de paramètres : le fichier donné (validé), ou à défaut la PROPOSITION NON VALIDÉE. */
export function chargerParametres(politique: readonly CategoriePolitique[], chemin?: string): ParametresCharges {
  let parametres: ParametresDurees = PARAMETRES_PROPOSES;
  let source: ParametresCharges['source'] = 'defaut';
  if (chemin) {
    let brut: unknown;
    try {
      brut = JSON.parse(readFileSync(chemin, 'utf8'));
    } catch (err) {
      throw new Error(`Durées de conservation : fichier illisible ou JSON invalide (${chemin}) : ${(err as Error).message}`);
    }
    parametres = brut as ParametresDurees;
    source = 'fichier';
  }
  const erreurs = validerParametres(parametres, politique);
  if (erreurs.length) throw new Error(`Durées de conservation invalides${chemin ? ` (${chemin})` : ''} : ${erreurs.join(' ; ')}`);
  return { parametres, empreinte: empreinteParametres(parametres), source, chemin: chemin ?? null, nonValide: parametres.statut === STATUT_PROPOSITION };
}

/** Références refusées comme « validation » : elles n'en sont pas une. */
const REFERENCES_VIDES = /^(oui|ok|yes|true|test|essai|x+|n\/?a|aucune?|todo|tbd|\?+|-+)$/i;
/**
 * Référence de la validation des durées, exigée pour toute exécution réelle. Renvoie la référence nettoyée, ou lève.
 * Ce contrôle est FORMEL : il refuse l'absence et les valeurs manifestement vides, il ne prouve pas la validation.
 */
export function exigerReferenceValidation(reference: string | undefined, chargees?: ParametresCharges): string {
  const r = reference?.trim();
  if (!r) throw new Error('Exécution réelle refusée : les durées de conservation ne sont pas déclarées validées. Fournir --durees-validees=<référence de la validation> (avis de l’avocat ou du DPO, par exemple) ; les valeurs par défaut sont une PROPOSITION NON VALIDÉE.');
  if (r.length < 6 || REFERENCES_VIDES.test(r)) throw new Error(`Exécution réelle refusée : « ${r} » n’est pas une référence de validation exploitable (6 caractères au moins, identifiant d’un avis ou d’un document).`);
  if (chargees && !chargees.nonValide && chargees.parametres.validation && chargees.parametres.validation.reference !== r) throw new Error(`Exécution réelle refusée : la référence fournie (« ${r} ») diffère de celle inscrite dans le jeu de paramètres (« ${chargees.parametres.validation.reference} »).`);
  return r;
}

/** Ce que l'exécution consigne : la preuve de ce qui a été déclaré validé. */
export interface TraceValidationDurees { reference: string; version: string; statut: string; empreinte: string; source: 'defaut' | 'fichier' }
export const traceValidation = (reference: string, c: ParametresCharges): TraceValidationDurees => ({ reference, version: c.parametres.version, statut: c.parametres.statut, empreinte: c.empreinte, source: c.source });

const ajouterJours = (iso: string, jours: number): string => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
};
export { ajouterJours };

/** Échéance (AAAA-MM-JJ) d'une règle à partir d'un point de départ (AAAA-MM-JJ), ou null si le point de départ est inconnu. */
export function echeanceDe(regle: RegleCategorie, depart: string | null): string | null {
  if ('jusqu_au' in regle.duree) return regle.duree.jusqu_au;
  return depart === null ? null : ajouterJours(depart, regle.duree.jours);
}

/** Délai (jours) après la fin de l'abonnement avant l'exécution : le plus long du délai de grâce et des durées des catégories supprimées. */
export function delaiEffectifSuppression(p: ParametresDurees, supprimees: readonly string[], graceExplicite?: number): number {
  const grace = graceExplicite ?? p.delaiGraceJours;
  const plusLongue = Math.max(0, ...supprimees.map((c) => { const d = p.categories[c]?.duree; return d && 'jours' in d ? d.jours : 0; }));
  return Math.max(grace, plusLongue);
}
