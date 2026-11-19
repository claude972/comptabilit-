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
  executer(ctx: ContexteControle): ResultatControle;
}
