import type { z } from 'zod';
import type { RapportReleve } from '../banque/types.js';
import type { LigneFec } from '../fec/types.js';
import type { ChaineDecimale } from '../montant.js';

export interface SourceRegle {
  type: 'reglementaire' | 'interne';
  reference: string;
  url: string | null;
  dateVerification: string | null;
  verification: 'verifiee' | 'non_verifiee' | 'sans_objet';
  periodeApplication: string | null;
}

export type StatutControle = 'sans_anomalie' | 'constat' | 'non_applicable' | 'non_realise' | 'erreur';

/** Ligne d'écriture : ligne FEC normalisée + identifiant technique fourni par l'appelant. */
export interface LigneEcriture extends LigneFec {
  id: string;
}

export interface ContexteControle {
  lignes: readonly LigneEcriture[];
  exercice: { debut: string; fin: string } | null;
  exercicePrecedent?: { lignes: readonly LigneEcriture[] } | null;
  /** Relevés bancaires lus (lireCamt053, lireOfx, lireCsvBanque). Facultatif : sans relevé, TRE-003 est `non_realise`. */
  releves?: readonly RapportReleve[] | null;
  /** Surcharges validées par le schéma du contrôle. */
  parametres: Record<string, unknown>;
}

export interface Constat {
  gravite: 'critique' | 'elevee' | 'moyenne' | 'faible';
  titre: string;
  explication: string;
  actionProposee: string;
  montant: ChaineDecimale | null;
  /** Identifiants de LigneEcriture. */
  lignesConcernees: string[];
  preuves: Array<{ libelle: string; valeur: string }>;
  /** Clé stable pour dédoublonner entre exécutions. */
  cle: string;
}

export interface ResultatControle {
  controleId: string;
  version: string;
  statut: StatutControle;
  motif: string | null;
  constats: Constat[];
  parametresAppliques: Record<string, unknown>;
  mesures: Record<string, string>;
}

/**
 * Ordre d'un passage en flux sur les lignes d'un exercice.
 *  - `fichier` : ordre du fichier d'origine (numéro de ligne croissant) ;
 *  - `ecriture`, `tiers`, `compte` : les lignes d'un même groupe sont CONTIGUËS et, dans le groupe, dans l'ordre du
 *    fichier ; l'ordre des groupes entre eux n'est PAS garanti (un contrôle ne doit pas en dépendre).
 * Clés de groupe : `ecriture` = journal + U+0001 + numéro d'écriture ; `tiers` = compte + U+0001 + (compte auxiliaire,
 * à défaut compte) ; `compte` = numéro de compte.
 */
export type OrdrePassage = 'fichier' | 'ecriture' | 'tiers' | 'compte';

export interface DemandePassage {
  ordre: OrdrePassage;
  /**
   * Restriction facultative : la source rend AU MOINS les lignes dont le compte commence par un de ces préfixes. Elle peut
   * en rendre davantage : le contrôle applique toujours son propre filtre.
   */
  prefixesComptes?: readonly string[];
  /** Restriction facultative, même règle : AU MOINS les lignes de ces journaux. */
  journaux?: readonly string[];
}

/**
 * Lignes d'un exercice lues par passages successifs, sans chargement intégral en mémoire. Le moteur reste pur : il ne
 * connaît que cette interface ; l'appelant (worker) l'implémente sur sa base. Contrat : relisible autant de fois que
 * nécessaire, contenu identique d'un passage à l'autre, `numeroLigne` strictement croissant dans l'ordre du fichier.
 */
export interface SourceLignes {
  readonly nbLignes: number;
  parcourir(demande: DemandePassage): AsyncIterable<LigneEcriture>;
}

/**
 * Budget d'état d'un contrôle en flux. Un contrôle qui devrait garder davantage ne rend PAS de résultat partiel : il
 * est « non réalisé » avec son motif.
 *  - `lignes` : nombre maximal de lignes d'écriture gardées en mémoire au même moment ;
 *  - `elements` : nombre maximal d'éléments compacts (un par écriture distincte, par compte…).
 */
export interface BudgetFlux {
  lignes: number;
  elements: number;
}

export interface ContexteControleFlux {
  source: SourceLignes;
  exercice: { debut: string; fin: string } | null;
  exercicePrecedent?: { source: SourceLignes } | null;
  releves?: readonly RapportReleve[] | null;
  parametres: Record<string, unknown>;
  budget: BudgetFlux;
}

export type CycleControle =
  | 'general'
  | 'tresorerie'
  | 'clients'
  | 'fournisseurs'
  | 'tva'
  | 'immobilisations'
  | 'social'
  | 'capitaux_propres'
  | 'cloture';

export interface DefinitionControle {
  id: string;
  version: string;
  cycle: CycleControle;
  titre: string;
  objectif: string;
  perimetre: string;
  donneesObligatoires: string[];
  /** Description lisible de la logique déterministe. */
  logique: string;
  schemaParametres: z.ZodType;
  parametresParDefaut: Record<string, unknown>;
  exceptions: string;
  source: SourceRegle;
  resultatsAttendus: string;
  /** Mode de calcul sur gros volume (chemin en flux) : passages, état gardé en mémoire, limites. Reproduit dans le catalogue documenté. */
  calculGrosVolume: string;
  executer(ctx: ContexteControle): ResultatControle;
  /**
   * Même contrôle calculé par passages en flux, en mémoire bornée. Présent seulement si l'égalité stricte avec
   * `executer` est prouvée par les tests d'équivalence (`flux.test.ts`) ; absent, le contrôle est « non réalisé »
   * sur le chemin « gros volume ».
   */
  executerFlux?(ctx: ContexteControleFlux): Promise<ResultatControle>;
}
