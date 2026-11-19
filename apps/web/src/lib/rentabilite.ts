/**
 * Rentabilité d'une mission (`GET v1/missions/:id/rentabilite`, calcul de `packages/core/src/rentabilite.ts`) et coût
 * horaire interne du cabinet. L'interface n'effectue AUCUN calcul : elle affiche ce que l'API renvoie, et ce qui n'est
 * pas calculable est dit « non calculable », avec le motif de l'API — jamais zéro.
 */
import { normaliserMontantSaisi, versCentimes } from './centimes';
import type { Exercice } from './types-api';

export type StatutCalcul = 'calcule' | 'partiel' | 'non_calculable';
export const LIBELLE_STATUT_CALCUL: Record<StatutCalcul, string> = { calcule: 'Calculé', partiel: 'Partiel', non_calculable: 'Non calculable' };

export interface Rentabilite {
  mission: { id: string; entiteId: string; libelle: string };
  /** Mention générale renvoyée par l'API, à afficher telle quelle. */
  mention: string;
  periode: { debut: string; fin: string };
  honoraires: {
    statut: 'calcule' | 'non_calculable';
    motif: string | null;
    forfait: string;
    tempsPasse: string;
    total: string | null;
    detail: Array<{ lettreId: string; du: string; au: string; jours: number; mode: string; montant: string }>;
  };
  temps: { minutesDansPerimetre: number; minutesHorsPerimetre: number; minutesSansLettre: number; travauxSansTemps: number; nbTravaux: number };
  tauxHoraireRealise: { statut: StatutCalcul; valeur: string | null; motif: string | null };
  marge: { statut: StatutCalcul; coutHoraire: string | null; cout: string | null; valeur: string | null; tauxPourcent: string | null; motif: string | null };
  mentions: string[];
}
export interface CoutHoraire {
  coutHoraireInterneHt: string | null;
  majLe: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface Periode {
  du: string;
  au: string;
  origine: 'demandee' | 'exercice_en_cours' | 'annee_civile';
}
/**
 * Période affichée : celle de l'URL si elle est valide ; à défaut l'exercice du dossier qui contient la date du jour ;
 * à défaut l'année civile en cours. `aujourdHui` est une date AAAA-MM-JJ.
 */
export function periodeRentabilite(demande: { du?: string | undefined; au?: string | undefined }, exercices: ReadonlyArray<Pick<Exercice, 'debut' | 'fin'>>, aujourdHui: string): Periode {
  if (demande.du && demande.au && DATE.test(demande.du) && DATE.test(demande.au) && demande.du <= demande.au) return { du: demande.du, au: demande.au, origine: 'demandee' };
  const enCours = exercices.find((x) => x.debut <= aujourdHui && aujourdHui <= x.fin);
  if (enCours) return { du: enCours.debut, au: enCours.fin, origine: 'exercice_en_cours' };
  const annee = aujourdHui.slice(0, 4);
  return { du: `${annee}-01-01`, au: `${annee}-12-31`, origine: 'annee_civile' };
}
export const LIBELLE_ORIGINE_PERIODE: Record<Periode['origine'], string> = {
  demandee: 'Période choisie.',
  exercice_en_cours: 'Période par défaut : l’exercice en cours du dossier.',
  annee_civile: 'Période par défaut : l’année civile en cours (aucun exercice du dossier ne couvre la date du jour).',
};

/** Une période saisie mais inutilisable doit être signalée plutôt que remplacée en silence. */
export function periodeDemandeeInvalide(demande: { du?: string | undefined; au?: string | undefined }): boolean {
  if (!demande.du && !demande.au) return false;
  return !(demande.du && demande.au && DATE.test(demande.du) && DATE.test(demande.au) && demande.du <= demande.au);
}

/** Le coût et la marge ne s'affichent que si l'API les a renvoyés ; sinon c'est son motif qui s'affiche. */
export function margeAffichable(m: Rentabilite['marge']): m is Rentabilite['marge'] & { cout: string; valeur: string } {
  return m.statut !== 'non_calculable' && m.cout !== null && m.valeur !== null;
}

/**
 * Saisie du coût horaire interne : montant strictement positif, deux décimales au plus, transmis en chaîne décimale.
 * Il n'existe aucune valeur par défaut : une saisie vide n'est pas un coût (l'effacement est une action distincte).
 */
export function coutHoraireSaisi(saisie: string): { ok: true; valeur: string } | { ok: false; erreur: string } {
  if (!saisie.trim()) return { ok: false, erreur: 'Saisissez un coût horaire, ou utilisez « Effacer » pour qu’aucune marge ne soit calculée.' };
  const valeur = normaliserMontantSaisi(saisie);
  if (valeur === null) return { ok: false, erreur: 'Coût horaire invalide : un montant positif, deux décimales au plus (ex. 62,50).' };
  if (versCentimes(valeur) === 0n) return { ok: false, erreur: 'Le coût horaire doit être strictement positif. Pour ne calculer aucune marge, utilisez « Effacer ».' };
  return { ok: true, valeur };
}
