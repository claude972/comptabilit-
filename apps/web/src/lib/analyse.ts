/**
 * États de travail (balance, projets de compte de résultat et de bilan) et indicateurs : formes de
 * `apps/api/src/etats.controller.ts` et mise en forme. Toutes les valeurs viennent du serveur en chaînes décimales ;
 * l'interface ne calcule ni total ni ratio.
 */
import type { Exercice, SourceRegle } from './types-api';

export interface LigneBalance {
  compteNum: string;
  compteLib: string;
  totalDebit: string;
  totalCredit: string;
  soldeDebiteur: string;
  soldeCrediteur: string;
  nbLignes: number;
}
export interface Balance {
  lignes: LigneBalance[];
  totalDebit: string;
  totalCredit: string;
  equilibree: boolean;
  ecart: string;
}
export interface Rubrique {
  code: string;
  libelle: string;
  brut?: string;
  amortissementsDepreciations?: string;
  montant: string;
  comptes: Array<{ compteNum: string; compteLib: string; montant: string }>;
}
export interface ControleEtat {
  code: string;
  statut: 'ok' | 'ecart' | 'non_verifiable';
  message: string;
  ecart: string | null;
}
export interface EtatProjet {
  statut: 'projet';
  complet: boolean;
  motifsIncompletude: string[];
  rubriques: Rubrique[];
  totaux: Record<string, string>;
  comptesNonAffectes: Array<{ compteNum: string; compteLib: string; solde: string }>;
  controles: ControleEtat[];
}
export interface Etats {
  mention: string;
  exercice: Exercice;
  donnees: { version: number; versionDonnees: number; statutDonnees: string | null };
  balance: Balance;
  correspondance: { id: string; version: string; periodeApplication: string; etat: string; source: SourceRegle } | null;
  compteDeResultat: EtatProjet | null;
  bilan: EtatProjet | null;
  motif: string | null;
}
export type Unite = 'euros' | 'jours' | 'pourcentage' | 'ratio';
export type Famille = 'activite' | 'rentabilite' | 'bfr' | 'tresorerie' | 'structure' | 'signal';
export interface DefinitionIndicateur {
  id: string;
  version: string;
  libelle: string;
  famille: Famille;
  formule: string;
  convention: string;
  unite: Unite;
  entrees: string[];
  regleDonneeManquante: string;
  source: SourceRegle;
}
export interface ValeurIndicateur {
  id: string;
  version: string;
  statut: 'calcule' | 'non_calculable';
  motif: string | null;
  valeur: string | null;
  unite: Unite;
  composantes: Array<{ libelle: string; montant: string; comptes: Array<{ compteNum: string; montant: string }> }>;
  precedent?: { valeur: string | null; variation: string | null; variationPourcent: string | null } | null;
  mentions: string[];
  aExaminer: boolean | null;
}
export interface Indicateurs {
  mention: string;
  donnees: { exercicePrecedentFourni: boolean };
  indicateurs: ValeurIndicateur[];
}

export const ORDRE_FAMILLES: Famille[] = ['activite', 'rentabilite', 'bfr', 'tresorerie', 'structure', 'signal'];
export const LIBELLE_FAMILLE: Record<Famille, string> = {
  activite: 'Activité',
  rentabilite: 'Rentabilité',
  bfr: 'Besoin en fonds de roulement',
  tresorerie: 'Trésorerie',
  structure: 'Structure financière',
  signal: 'Questions à examiner',
};
export const PHRASE_SIGNAUX = 'Ces questions sont des points à examiner au vu des écritures : ni un diagnostic, ni une appréciation de la continuité d’exploitation.';

const ESPACE_FINE = ' ';
/** Nombre décimal en chaîne → écriture française (milliers, virgule), décimales conservées telles quelles : aucun flottant, aucun arrondi. */
export function formaterNombre(valeur: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(valeur);
  if (!m) return valeur;
  const entier = (m[2] ?? '0').replace(/^0+(?=\d)/, '');
  let groupes = '';
  for (let i = 0; i < entier.length; i++) groupes += (i > 0 && (entier.length - i) % 3 === 0 ? ESPACE_FINE : '') + entier[i];
  const nul = /^0+$/.test(entier) && /^0*$/.test(m[3] ?? '');
  return `${m[1] && !nul ? '−' : ''}${groupes}${m[3] ? `,${m[3]}` : ''}`;
}
const SUFFIXE: Record<Unite, string> = { euros: ' €', jours: ' jours', pourcentage: ' %', ratio: '' };
/** Valeur d'un indicateur selon son unité. Une valeur absente n'est jamais rendue comme un zéro. */
export function formaterValeur(valeur: string | null | undefined, unite: Unite): string {
  if (valeur === null || valeur === undefined) return 'Non calculable';
  return `${formaterNombre(valeur)}${SUFFIXE[unite] ?? ''}`;
}

/** Recherche d'un compte dans la balance : début de numéro, ou fragment de libellé (sans casse ni accents). */
export function filtrerBalance(lignes: readonly LigneBalance[], recherche: string): LigneBalance[] {
  const q = recherche.trim();
  if (!q) return [...lignes];
  if (/^\d+$/.test(q)) return lignes.filter((l) => l.compteNum.startsWith(q));
  const norme = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return lignes.filter((l) => norme(l.compteLib).includes(norme(q)) || l.compteNum.startsWith(q));
}
export function paginer<T>(elements: readonly T[], page: number, taille: number): { tranche: T[]; page: number; nbPages: number } {
  const nbPages = Math.max(1, Math.ceil(elements.length / taille));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), nbPages);
  return { tranche: elements.slice((p - 1) * taille, p * taille), page: p, nbPages };
}
/** Taux de TVA saisi (« 20 », « 5,5 ») → chaîne décimale pour l'API ; null si la saisie n'est pas un taux positif. */
export function tauxSaisi(v: string | undefined): string | null {
  const t = (v ?? '').trim().replace(',', '.');
  return /^\d{1,3}(\.\d{1,4})?$/.test(t) ? t : null;
}
/** Clé technique d'un total (« totalActifNet ») → libellé lisible, sans rien inventer sur son sens. */
export function libelleTotal(cle: string): string {
  const mots = cle.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return mots.charAt(0).toUpperCase() + mots.slice(1);
}
