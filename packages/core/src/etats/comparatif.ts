/**
 * Colonne N-1 (exercice précédent) des états projetés et de la liasse.
 *
 * Règles : l'exercice précédent doit être CONTIGU (clôture N-1 + 1 jour = ouverture N) ; il est projeté par les mêmes
 * tables et règles que l'exercice demandé, sur les écritures importées, avant inventaire ; s'il sort du périmètre, il n'y a
 * PAS de colonne (motif affiché), jamais une colonne approximative. Une durée différente de douze mois est signalée.
 */
import { estDateIso, isoDepuisJours, joursDepuisEpoque } from '../dates.js';
import { correspondancePour } from './correspondance.js';
import { projeterBilan, projeterCompteDeResultat } from './projection.js';
import type { Balance, EtatProjet } from './types.js';

export interface ExercicePeriode {
  debut: string;
  fin: string;
}

export const MOTIF_SANS_PRECEDENT = 'Aucun exercice précédent avec une comptabilité importée dans ce dossier : la colonne N-1 ne peut pas être alimentée (aucun chiffre n’est supposé).';

export const RESERVE_N1_NON_VALIDE =
  'Colonne N-1 : calculée sur les écritures importées de l’exercice précédent, AVANT écritures d’inventaire éventuelles, avec la même table de correspondance non validée ; ce n’est pas le N-1 des comptes annuels approuvés.';

/** Contrôle de contiguïté et de durée. `motif` non nul : aucune colonne. */
export function verifierExercicePrecedent(courant: ExercicePeriode, precedent: ExercicePeriode): { motif: string | null; reserves: string[] } {
  if (!estDateIso(precedent.debut) || !estDateIso(precedent.fin) || !estDateIso(courant.debut) || joursDepuisEpoque(precedent.fin) + 1 !== joursDepuisEpoque(courant.debut)) {
    return { motif: `L’exercice précédent (${precedent.debut} au ${precedent.fin}) n’est pas contigu à l’exercice demandé (ouvert le ${courant.debut}) : une colonne N-1 aurait un sens trompeur.`, reserves: [] };
  }
  const reserves = [RESERVE_N1_NON_VALIDE];
  const mois = (iso: string): number => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
  const nbMois = mois(precedent.fin) - mois(precedent.debut) + 1;
  const debutDeMois = precedent.debut.slice(8) === '01' && isoDepuisJours(joursDepuisEpoque(precedent.fin) + 1).slice(8) === '01';
  if (nbMois !== 12 || !debutDeMois) {
    reserves.push(`L’exercice précédent couvre ${precedent.debut} au ${precedent.fin} (${debutDeMois ? `${nbMois} mois` : 'durée non exprimable en mois entiers'}) : ses montants ne sont pas comparables à ceux d’un exercice de douze mois.`);
  }
  return { motif: null, reserves };
}

export type EtatsPrecedent =
  | { statut: 'fourni'; exercice: ExercicePeriode; compteDeResultat: EtatProjet; bilan: EtatProjet; reserves: string[] }
  | { statut: 'indisponible'; motifs: string[] };

/** Projets de compte de résultat et de bilan de l'exercice précédent. */
export function projeterEtatsPrecedent(courant: ExercicePeriode, precedent: { balance: Balance; exercice: ExercicePeriode } | null | undefined, motifAbsent?: string | null): EtatsPrecedent {
  if (!precedent) return { statut: 'indisponible', motifs: [motifAbsent ?? MOTIF_SANS_PRECEDENT] };
  const v = verifierExercicePrecedent(courant, precedent.exercice);
  if (v.motif) return { statut: 'indisponible', motifs: [v.motif] };
  const correspondance = correspondancePour(precedent.exercice.debut);
  if (!correspondance) return { statut: 'indisponible', motifs: ['Aucune table de correspondance vérifiée pour l’exercice précédent (ouvert avant le 1er janvier 2025) : pas de colonne N-1.'] };
  const compteDeResultat = projeterCompteDeResultat(precedent.balance, correspondance);
  const resultat = compteDeResultat.totaux['resultat'];
  const bilan = projeterBilan(precedent.balance, correspondance, resultat === undefined ? {} : { resultatExercice: resultat });
  return { statut: 'fourni', exercice: precedent.exercice, compteDeResultat, bilan, reserves: v.reserves };
}
