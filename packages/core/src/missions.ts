/**
 * Missions : périmètre d'une lettre de mission, rattachement d'un travail à la lettre applicable à sa date,
 * détection des travaux potentiellement hors périmètre, estimation de temps.
 * Pur et déterministe. Une estimation repose toujours sur une base identifiée (barème du cabinet ou temps observés) ;
 * sans base, le moteur s'abstient. Temps observé et temps estimé ne sont jamais confondus.
 */
import { z } from 'zod';
import { schemaChaineDecimale } from './montant.js';

/** Référentiel interne de prestations (convention du logiciel, extensible par « autre » avec un libellé). */
export const PRESTATIONS = {
  tenue: 'Tenue de comptabilité',
  revision: 'Révision des comptes',
  comptes_annuels: 'Établissement des comptes annuels',
  fiscal_tva: 'Déclarations de TVA',
  fiscal_is: 'Déclarations d’impôt sur les sociétés et liasse fiscale',
  social_paie: 'Paie et déclarations sociales',
  juridique_annuel: 'Secrétariat juridique annuel',
  conseil_ponctuel: 'Conseil ponctuel',
  autre: 'Autre prestation',
} as const;
export type CodePrestation = keyof typeof PRESTATIONS;
const codes = Object.keys(PRESTATIONS) as [CodePrestation, ...CodePrestation[]];
const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const schemaContenuLettre = z.object({
  perimetre: z.array(z.object({ prestation: z.enum(codes), precision: z.string().max(500).optional() })).min(1),
  duree: z.object({ debut: dateIso, fin: dateIso.nullable(), taciteReconduction: z.boolean() }),
  honoraires: z.object({
    mode: z.enum(['forfait', 'temps_passe', 'mixte']),
    montantAnnuelHt: schemaChaineDecimale.nullable(),
    tauxHoraireHt: schemaChaineDecimale.nullable(),
    conditionsRevision: z.string().max(2000),
  }),
  obligationsCabinet: z.string().max(4000),
  obligationsClient: z.string().max(4000),
  livrables: z.array(z.string().max(300)).max(50),
  mandats: z.array(z.string().max(300)).max(50),
  limites: z.string().max(4000),
});
export type ContenuLettre = z.infer<typeof schemaContenuLettre>;

export interface LettreDatee {
  id: string;
  dateEffet: string;
  statut: string;
  contenu: ContenuLettre;
  /** Ordre de création, pour départager deux lettres de même date d'effet. */
  version: number;
}

/**
 * Lettre (ou avenant) applicable à une date : la plus récente VALIDÉE dont la date d'effet est atteinte, dans la
 * durée prévue. Un projet n'est jamais applicable.
 */
export function lettreApplicable(lettres: readonly LettreDatee[], date: string): LettreDatee | null {
  const candidates = lettres
    .filter((l) => l.statut === 'validee' && l.dateEffet <= date && (l.contenu.duree.fin === null || l.contenu.duree.taciteReconduction || date <= l.contenu.duree.fin))
    .sort((a, b) => (a.dateEffet === b.dateEffet ? b.version - a.version : a.dateEffet < b.dateEffet ? 1 : -1));
  return candidates[0] ?? null;
}

export type SituationTravail =
  | { situation: 'dans_le_perimetre'; lettreId: string }
  | { situation: 'potentiellement_hors_perimetre'; lettreId: string; motif: string }
  | { situation: 'aucune_lettre_applicable'; motif: string };

/** Compare la prestation d'un travail au périmètre de la lettre applicable à sa date. Un constat, pas une conclusion. */
export function situerTravail(lettres: readonly LettreDatee[], travail: { date: string; prestation: string }): SituationTravail {
  const lettre = lettreApplicable(lettres, travail.date);
  if (!lettre) return { situation: 'aucune_lettre_applicable', motif: `Aucune lettre de mission validée n’est applicable au ${travail.date}.` };
  if (lettre.contenu.perimetre.some((p) => p.prestation === travail.prestation)) return { situation: 'dans_le_perimetre', lettreId: lettre.id };
  const libelle = (PRESTATIONS as Record<string, string>)[travail.prestation] ?? travail.prestation;
  return { situation: 'potentiellement_hors_perimetre', lettreId: lettre.id, motif: `La prestation « ${libelle} » ne figure pas dans le périmètre de la lettre applicable (effet au ${lettre.dateEffet}).` };
}

export interface EstimationTemps {
  statut: 'estime' | 'non_estimable';
  minutes: number | null;
  /** Base utilisée, toujours nommée. */
  base: 'bareme_cabinet' | 'temps_observes' | null;
  nbObservations: number;
  hypotheses: string[];
}

/**
 * Estime le temps d'une prestation. Priorité au barème du cabinet ; à défaut, médiane des temps observés si au moins
 * `minObservations` existent (la médiane résiste aux valeurs extrêmes) ; sinon abstention.
 */
export function estimerTemps(entree: { baremeMinutes: number | null; tempsObservesMinutes: readonly number[]; minObservations?: number }): EstimationTemps {
  const observes = entree.tempsObservesMinutes.filter((m) => Number.isInteger(m) && m > 0).sort((a, b) => a - b);
  const min = entree.minObservations ?? 3;
  if (entree.baremeMinutes !== null && Number.isInteger(entree.baremeMinutes) && entree.baremeMinutes > 0) {
    return { statut: 'estime', minutes: entree.baremeMinutes, base: 'bareme_cabinet', nbObservations: observes.length, hypotheses: ['Temps de référence du barème du cabinet pour cette prestation.'] };
  }
  if (observes.length >= min) {
    const milieu = Math.floor(observes.length / 2);
    // Médiane entière : pour un nombre pair d'observations, moyenne des deux valeurs centrales arrondie à la minute supérieure.
    const mediane = observes.length % 2 === 1 ? observes[milieu]! : Math.ceil((observes[milieu - 1]! + observes[milieu]!) / 2);
    return { statut: 'estime', minutes: mediane, base: 'temps_observes', nbObservations: observes.length, hypotheses: [`Médiane de ${observes.length} temps observés pour cette prestation dans le cabinet.`, 'Aucun barème défini pour cette prestation.'] };
  }
  return { statut: 'non_estimable', minutes: null, base: null, nbObservations: observes.length, hypotheses: [`Aucun barème défini et moins de ${min} temps observés : estimation impossible.`] };
}
