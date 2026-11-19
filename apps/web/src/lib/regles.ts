/** Règles du cabinet : formes de `apps/api/src/regles.controller.ts` et logique pure du formulaire de proposition. */
import type { StatutControle } from './types-api';

export type StatutRegle = 'proposee' | 'approuvee' | 'retiree' | 'refusee';
export interface MesureImpact {
  statut: StatutControle;
  constats: number;
  parametres: Record<string, unknown>;
}
export interface ImpactRegle {
  exerciceId: string;
  versionDonnees: number;
  mesureLe: string;
  avant: MesureImpact;
  apres: MesureImpact;
  constatsQuiDisparaissent: number;
  constatsQuiApparaissent: number;
}
export interface RegleCabinet {
  id: string;
  controleId: string;
  /** null : préférence de tout le cabinet ; sinon exception propre à un dossier. */
  entiteId: string | null;
  parametres: Record<string, unknown>;
  version: number;
  statut: StatutRegle;
  motif: string;
  impact: ImpactRegle | null;
  proposeePar: string | null;
  approuveePar: string | null;
  decideeLe: string | null;
  creeLe: string;
}

export const ORDRE_STATUTS_REGLE: readonly StatutRegle[] = ['proposee', 'approuvee', 'retiree', 'refusee'];
export const LIBELLE_STATUT_REGLE: Record<StatutRegle, string> = { proposee: 'Proposée', approuvee: 'Approuvée', retiree: 'Retirée', refusee: 'Refusée' };
export const TITRE_STATUT_REGLE: Record<StatutRegle, string> = { proposee: 'Règles proposées', approuvee: 'Règles approuvées', retiree: 'Règles retirées', refusee: 'Règles refusées' };

export const REGLES_DU_JEU: readonly string[] = [
  'Une proposition n’a aucun effet tant qu’elle n’est pas approuvée.',
  'L’impact doit être mesuré sur un exercice avant toute approbation.',
  'Pas d’auto-approbation : une règle est approuvée par un administrateur ou un associé autre que la personne qui l’a proposée.',
  'Approuver ou retirer une règle rend obsolètes les contrôles déjà exécutés : ils sont à relancer.',
];
export const EXPLICATION_REGLEMENTAIRE = 'Ce contrôle repose sur une règle réglementaire : ses paramètres ne se modifient pas par une préférence de cabinet.';

/** Origine des paramètres d'un résultat de contrôle (`resultat.source.regleCabinet`). */
export function libelleOrigineParametres(o: { version: number; portee: 'cabinet' | 'dossier' }): string {
  return `Paramètres propres ${o.portee === 'dossier' ? 'au dossier' : 'au cabinet'} — règle v${o.version}`;
}

const DECIMALE = /^-?\d{1,13}(\.\d{1,6})?$/;
export type GenreParametre = 'decimal' | 'texte' | 'entier' | 'nombre' | 'booleen' | 'liste' | 'fige';
export interface ChampParametre {
  cle: string;
  genre: GenreParametre;
  defaut: unknown;
}
/** Un champ de saisie par paramètre par défaut du contrôle ; le genre découle de la valeur par défaut. */
export function champsParametres(defauts: Record<string, unknown>): ChampParametre[] {
  return Object.entries(defauts).map(([cle, defaut]) => {
    let genre: GenreParametre = 'fige';
    if (typeof defaut === 'string') genre = DECIMALE.test(defaut) ? 'decimal' : 'texte';
    else if (typeof defaut === 'number') genre = Number.isInteger(defaut) ? 'entier' : 'nombre';
    else if (typeof defaut === 'boolean') genre = 'booleen';
    else if (Array.isArray(defaut) && defaut.length > 0 && defaut.every((v) => typeof v === 'string')) genre = 'liste';
    return { cle, genre, defaut };
  });
}
/** Valeur affichée d'un paramètre (liste séparée par des virgules, booléen en toutes lettres, objet en JSON). */
export function afficherParametre(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.length ? v.join(', ') : '(aucun)';
  return JSON.stringify(v);
}
export type Saisies = Record<string, string | boolean>;
export function saisiesInitiales(champs: readonly ChampParametre[]): Saisies {
  return Object.fromEntries(champs.filter((c) => c.genre !== 'fige').map((c) => [c.cle, c.genre === 'booleen' ? (c.defaut as boolean) : afficherParametre(c.defaut)]));
}
const memeListe = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Paramètres à envoyer : uniquement ceux qui diffèrent des valeurs par défaut. Les montants et taux restent des
 * CHAÎNES décimales (« 100000.00 ») ; seuls les paramètres dont la valeur par défaut est un nombre sont des nombres.
 */
export function parametresDepuis(champs: readonly ChampParametre[], saisies: Saisies): { ok: true; parametres: Record<string, unknown> } | { ok: false; erreurs: string[] } {
  const parametres: Record<string, unknown> = {};
  const erreurs: string[] = [];
  for (const c of champs) {
    const s = saisies[c.cle];
    if (c.genre === 'fige' || s === undefined) continue;
    if (c.genre === 'booleen') {
      if (s !== c.defaut) parametres[c.cle] = s === true;
      continue;
    }
    const texte = String(s).trim();
    if (c.genre === 'decimal') {
      const v = texte.replace(/[\s  ]/g, '').replace(',', '.');
      if (!DECIMALE.test(v)) erreurs.push(`« ${c.cle} » : nombre décimal attendu (ex. 1500.00).`);
      else if (v !== c.defaut) parametres[c.cle] = v;
    } else if (c.genre === 'entier') {
      if (!/^-?\d{1,9}$/.test(texte)) erreurs.push(`« ${c.cle} » : nombre entier attendu.`);
      else if (Number.parseInt(texte, 10) !== c.defaut) parametres[c.cle] = Number.parseInt(texte, 10);
    } else if (c.genre === 'nombre') {
      const v = texte.replace(',', '.');
      if (!/^-?\d{1,9}(\.\d{1,6})?$/.test(v)) erreurs.push(`« ${c.cle} » : nombre attendu.`);
      else if (Number(v) !== c.defaut) parametres[c.cle] = Number(v);
    } else if (c.genre === 'liste') {
      const liste = texte.split(',').map((x) => x.trim()).filter(Boolean);
      if (!memeListe(liste, c.defaut as string[])) parametres[c.cle] = liste;
    } else if (texte !== c.defaut) {
      if (!texte) erreurs.push(`« ${c.cle} » : valeur attendue.`);
      else parametres[c.cle] = texte;
    }
  }
  if (erreurs.length) return { ok: false, erreurs };
  if (!Object.keys(parametres).length) return { ok: false, erreurs: ['Modifiez au moins un paramètre : une règle identique aux valeurs par défaut n’a pas d’objet.'] };
  return { ok: true, parametres };
}

/** Page de règles (`GET v1/regles?page=N`) : décomptes par statut calculés sur toutes les règles, pas sur la page. */
export interface PageRegles {
  page: number;
  taillePage: number;
  total: number;
  suite: boolean;
  parStatut: Partial<Record<StatutRegle, number>>;
  regles: RegleCabinet[];
}

// ───────────────────────────── Suggestions d'amélioration tirées des corrections ─────────────────────────────

export type CategorieSuggestion = 'correction_donnee' | 'exception_dossier' | 'preference_cabinet' | 'nouvelle_regle_metier' | 'modification_regle_reglementaire';
export interface SuggestionAmelioration {
  empreinte: string;
  categorie: CategorieSuggestion;
  titre: string;
  constat: string;
  critere: string;
  controleId: string | null;
  dossierIds: string[];
  dossiers: Array<{ id: string; nom: string }>;
  portee: 'dossier' | 'cabinet' | null;
  proposable: boolean;
  renvoi: 'veille' | 'editeur' | null;
  /** Valeurs en chaînes décimales, jamais des nombres flottants. */
  parametre: { cle: string; valeurParDefaut: string; valeurIndicative: string; explication: string } | null;
  proposition: { controleId: string; entiteId: string | null; parametres: Record<string, string>; motif: string } | null;
  preuves: {
    decomptes: Record<string, number>;
    periode: { du: string; au: string } | null;
    decisions: Array<{ decisionId: string; cibleId: string; dossierId: string; date: string; motif: string | null }>;
    decisionsNonListees: number;
  };
  neFaitPas: string[];
  dejaEcartee: { le: string; motif: string } | null;
}
export interface VueSuggestions {
  criteres: { version: string; statut: string; fenetreMois: number };
  suggestions: SuggestionAmelioration[];
  ecarteesMaintenues: Array<{ empreinte: string; le: string; motif: string }>;
  dejaEnCours: string[];
  sansDecision: boolean;
  perimetre: { dossiers: number; fenetreMois: number; mention: string; plafondsAtteints: string[] };
}

export const LIBELLE_CATEGORIE_SUGGESTION: Record<CategorieSuggestion, string> = {
  correction_donnee: 'Correction de données',
  exception_dossier: 'Exception propre à un dossier',
  preference_cabinet: 'Préférence du cabinet',
  nouvelle_regle_metier: 'Nouvelle règle métier (signalement)',
  modification_regle_reglementaire: 'Règle réglementaire (renvoi vers la veille)',
};
const LIBELLE_DECOMPTE: Record<string, string> = {
  rejetsMotives: 'rejets motivés',
  rejetsNonMotives: 'rejets sans motif suffisant (non comptés)',
  decisionsContraires: 'décisions contraires',
  executions: 'exécutions de contrôles concernées',
  dossiers: 'dossiers',
  piecesCorrigees: 'pièces corrigées',
  validations: 'validations',
  constatsCorriges: 'constats corrigés',
  champsCorriges: 'champs extraits corrigés',
  rejetsIsoles: 'rejets de constats isolés',
  rapprochementsRejetesIsoles: 'rejets de rapprochements isolés',
};
export const libelleDecompte = (cle: string): string => LIBELLE_DECOMPTE[cle] ?? cle;

/** Suggestion (proposable) désignée par l'adresse `/regles?suggestion=…` : sert à pré-remplir le formulaire de proposition. */
export function suggestionAPreremplir(vue: VueSuggestions | null, empreinte: string | undefined): SuggestionAmelioration | null {
  if (!vue || !empreinte) return null;
  return vue.suggestions.find((s) => s.empreinte === empreinte && s.proposable && s.proposition !== null) ?? null;
}
