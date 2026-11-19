/** Restitution d'un dossier : formes de `apps/api/src/restitution.controller.ts` (résumé écrit par le worker). */
import type { StatutLot } from './types-api';

export interface ResumeRestitution {
  genereLe?: string;
  dossier?: string;
  pieces?: number;
  originaux?: number;
  originauxExclus?: Array<{ sha256: string; motif: string }>;
  lotsImport?: number;
  lignesEcriture?: number;
  constats?: number;
  decisions?: number;
  mouvementsBancaires?: number;
  rapprochements?: number;
  reglesCabinet?: number;
  evenementsAudit?: number;
}
export interface Restitution {
  id: string;
  entiteId: string;
  statut: StatutLot;
  sha256: string | null;
  taille: number | null;
  resume: ResumeRestitution | null;
  erreur: string | null;
  creeLe: string;
  termineLe: string | null;
}
export const restitutionEnCours = (r: Pick<Restitution, 'statut'>) => r.statut === 'en_attente' || r.statut === 'en_cours';
