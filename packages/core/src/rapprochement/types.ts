import { z } from 'zod';
import { schemaChaineDecimale } from '../montant.js';
import type { ChaineDecimale } from '../montant.js';

/**
 * Élément rapprochable : facture, règlement, écriture ou mouvement bancaire ramené à une forme commune.
 *
 * CONVENTION DE SENS (identique pour les deux côtés rapprochés) : le montant est signé du point de vue
 * de la trésorerie de l'entreprise. POSITIF = encaissement réalisé ou à recevoir ; NÉGATIF = décaissement
 * réalisé ou à payer.
 *  - mouvement bancaire : montant du relevé (positif = crédit du compte bancaire) ;
 *  - ligne d'un compte 512 : débit − crédit (le débit du 512 est un encaissement) ;
 *  - ligne d'un compte 411 : débit − crédit (facture client = créance à encaisser, positive ; avoir négatif) ;
 *  - ligne d'un compte 401 : débit − crédit (facture fournisseur = dette à payer, négative ; avoir positif).
 * Les lignes de RÈGLEMENT d'un compte de tiers (crédit du 411, débit du 401) ont donc le signe opposé à
 * celui de la facture : pour rapprocher factures et règlements d'un même compte de tiers, convertir le
 * côté « règlements » avec `inverser: true`.
 */
export interface ElementRapprochable {
  id: string;
  type: 'mouvement_bancaire' | 'ligne_ecriture' | 'facture';
  /** ISO AAAA-MM-JJ. */
  date: string;
  montant: ChaineDecimale;
  reference: string | null;
  /** Contenu NON FIABLE : jamais interprété, jamais repris dans les explications. */
  libelle: string;
  tiers: string | null;
  compte: string | null;
}

export interface CritereRapprochement { critere: string; valeurA: string; valeurB: string; satisfait: boolean }

export interface Rapprochement {
  niveau: 'exact' | 'regle';
  /** Identifiant de la règle appliquée (voir REGLES_RAPPROCHEMENT). */
  regle: string;
  cotesA: string[];
  cotesB: string[];
  /** Somme A − somme B. */
  ecart: ChaineDecimale;
  criteres: CritereRapprochement[];
  /** Phrase générée à partir des seuls critères. */
  explication: string;
}

export interface ParametresRapprochement {
  /** Écart de règlement admis (paramètre du cabinet). Défaut "0.00". */
  toleranceMontant: ChaineDecimale;
  /** Écart de dates maximal, en jours, pour le niveau exact. Défaut 5. */
  fenetreJours: number;
  /** Écart de dates maximal, en jours, pour les règles de niveau 2. Défaut 45. */
  fenetreJoursRegles: number;
  /** Nombre maximal d'éléments d'un même côté dans un groupe. Défaut 6. */
  tailleMaxGroupe: number;
  /** Active la règle REGLE-PAIEMENTS-PARTIELS. Défaut true. */
  autoriserPartiels: boolean;
  /** Active la règle REGLE-COMPENSATION. Défaut true. */
  autoriserCompensations: boolean;
  /** Nombre maximal de combinaisons explorées PAR recherche de sous-ensemble. Défaut 20000. */
  budgetCombinaisons: number;
  /** Frais bancaires maximaux admis par opération pour REGLE-FRAIS-BANCAIRES. Défaut "0.00" = règle désactivée. */
  fraisBancairesMax: ChaineDecimale;
}

const montantPositif = schemaChaineDecimale.refine((v) => !v.startsWith('-'), 'Montant positif ou nul attendu.');

export const schemaParametresRapprochement = z.strictObject({
  toleranceMontant: montantPositif,
  fenetreJours: z.number().int().min(0).max(366),
  fenetreJoursRegles: z.number().int().min(0).max(1830),
  tailleMaxGroupe: z.number().int().min(2).max(12),
  autoriserPartiels: z.boolean(),
  autoriserCompensations: z.boolean(),
  budgetCombinaisons: z.number().int().min(1).max(5_000_000),
  fraisBancairesMax: montantPositif,
});

export const PARAMETRES_RAPPROCHEMENT_PAR_DEFAUT: Readonly<ParametresRapprochement> = Object.freeze({
  toleranceMontant: '0.00',
  fenetreJours: 5,
  fenetreJoursRegles: 45,
  tailleMaxGroupe: 6,
  autoriserPartiels: true,
  autoriserCompensations: true,
  budgetCombinaisons: 20_000,
  fraisBancairesMax: '0.00',
});

export interface ResultatRapprochement {
  rapprochements: Rapprochement[];
  nonRapprochesA: string[];
  nonRapprochesB: string[];
  /** Plusieurs solutions équivalentes : AUCUNE n'est retenue. `candidats` liste les solutions (ids des deux côtés). */
  ambiguites: Array<{ ids: string[]; candidats: string[][]; raison: string }>;
  /** Recherches interrompues (budget de combinaisons épuisé) : dites explicitement, jamais silencieuses. */
  abandons: Array<{ raison: string; ids: string[] }>;
  mesures: Record<string, string>;
}

export interface DescriptionRegle { id: string; niveau: 'exact' | 'regle'; description: string }

/** Règles déterministes, dans leur ordre d'application. */
export const REGLES_RAPPROCHEMENT: readonly DescriptionRegle[] = Object.freeze([
  { id: 'EXACT-REFERENCE', niveau: 'exact', description: 'Montant identique et référence identique après normalisation (majuscules, caractères alphanumériques seuls), avec un seul candidat de chaque côté.' },
  { id: 'EXACT-MONTANT-DATE', niveau: 'exact', description: 'Montant identique et dates séparées d’au plus `fenetreJours` jours, avec un seul candidat de chaque côté.' },
  { id: 'REGLE-ECART-REGLEMENT', niveau: 'regle', description: 'Un élément de chaque côté, de même sens, dont l’écart non nul n’excède pas `toleranceMontant`, dates séparées d’au plus `fenetreJoursRegles` jours, candidat unique de chaque côté. Inactive si la tolérance est nulle.' },
  { id: 'REGLE-FRAIS-BANCAIRES', niveau: 'regle', description: 'Un mouvement bancaire et un élément comptable de même sens : le mouvement est inférieur à l’attendu d’un montant de frais compris entre 0 exclu et `fraisBancairesMax`, candidat unique de chaque côté. Désactivée par défaut (`fraisBancairesMax` = 0).' },
  { id: 'REGLE-PAIEMENT-GROUPE', niveau: 'regle', description: 'Un élément d’un côté égale exactement la somme de 2 à `tailleMaxGroupe` éléments de l’autre côté, de même sens, rattachés à un même tiers non vide, dans la fenêtre `fenetreJoursRegles`. Solution unique exigée.' },
  { id: 'REGLE-COMPENSATION', niveau: 'regle', description: 'Compensation facture/avoir d’un même tiers : (a) un élément d’un côté égale la somme algébrique d’éléments de signes opposés d’un même tiers de l’autre côté ; (b) deux éléments d’un même côté et d’un même tiers, de montants exactement opposés, se soldent. Activée par `autoriserCompensations`.' },
  { id: 'REGLE-PAIEMENTS-PARTIELS', niveau: 'regle', description: 'Un élément d’un côté et TOUS les éléments libres de l’autre côté qui lui sont rattachés (même référence normalisée, ou à défaut même tiers s’il est le seul élément libre de ce tiers), de même sens, dont la somme n’excède pas son montant. Le solde restant est exposé dans `ecart`. Activée par `autoriserPartiels`.' },
]);
