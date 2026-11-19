/**
 * Annulation, rétablissement et reprise d'un import ; campagnes d'import sur plusieurs dossiers
 * (formes et règles de `apps/api/src/imports.controller.ts`). Logique pure : l'API reste seule juge.
 */
import type { Niveau, StatutLot } from './types-api';
import { auMoins } from './types-api';

export type ActionImport = 'annuler' | 'retablir' | 'reprendre';
export type TypeImport = 'fec' | 'releve_bancaire';

export interface EtatLot {
  statut: StatutLot;
  /** Statut que l'import avait quand il a été annulé ; null s'il a été annulé avant d'aboutir. */
  statutAvantAnnulation?: string | null;
}

/**
 * Actions proposées sur un import, selon son état et l'habilitation sur le dossier :
 *  - annuler (révision) : tout import non annulé ;
 *  - rétablir (révision) : import annulé qui avait abouti ;
 *  - reprendre (collaboration) : import en échec, ou annulé avant d'aboutir.
 */
export function actionsImport(lot: EtatLot, niveau: Niveau | null | undefined): ActionImport[] {
  const actions: ActionImport[] = [];
  const revision = auMoins(niveau, 'revision');
  if (auMoins(niveau, 'collaboration') && (lot.statut === 'echec' || (lot.statut === 'annule' && !lot.statutAvantAnnulation))) actions.push('reprendre');
  if (revision && lot.statut === 'annule' && lot.statutAvantAnnulation) actions.push('retablir');
  if (revision && lot.statut !== 'annule') actions.push('annuler');
  return actions;
}

/** Motif d'annulation ou de rétablissement : 5 à 2 000 caractères, comme l'exige l'API. */
export function motifValide(motif: string): boolean {
  const n = motif.trim().length;
  return n >= 5 && n <= 2000;
}
export const AIDE_MOTIF = 'Le motif est obligatoire (5 caractères au moins) : il est conservé avec la décision.';

/** Ce que l'annulation change, à dire AVANT de confirmer. Rien n'est supprimé : c'est toujours la première phrase. */
export function explicationAnnulation(lot: { type: TypeImport; actif: boolean; statut: StatutLot }): string[] {
  const phrases = ['Rien n’est supprimé : le fichier d’origine et les données lues sont conservés, seulement écartés. L’annulation est réversible.'];
  const abouti = lot.statut === 'termine' || lot.statut === 'termine_avec_erreurs';
  if (!abouti) phrases.push('Cet import n’a pas abouti : il pourra être relancé par « Reprendre », mais pas rétabli tel quel.');
  else if (lot.type === 'fec') {
    phrases.push(
      lot.actif
        ? 'Cet import est le lot actif de l’exercice : le lot précédent encore valable redevient actif (s’il n’y en a pas, l’exercice n’a plus de données actives) et les travaux qui dépendaient de ces données sont marqués « à revoir ».'
        : 'Cet import n’est pas le lot actif : les données actives de l’exercice ne changent pas.',
    );
  } else phrases.push('Les mouvements de ce relevé ne sont plus pris en compte, sauf ceux qui figurent aussi dans un autre relevé actif. Les rapprochements déjà calculés deviennent obsolètes.');
  return phrases;
}

export function explicationRetablissement(type: TypeImport): string {
  return type === 'fec'
    ? 'Cet import redevient le lot actif de son exercice, à la place de l’actuel ; les travaux qui dépendaient des données sont marqués « à revoir ».'
    : 'Les mouvements de ce relevé sont de nouveau pris en compte ; les rapprochements déjà calculés deviennent obsolètes.';
}

/** Un exercice dont tous les imports aboutis ont été écartés n'a plus de données actives : à dire clairement. */
export function sansDonneesActives(lots: ReadonlyArray<{ actif: boolean; statut: StatutLot }>): boolean {
  return lots.some((l) => l.statut === 'annule') && !lots.some((l) => l.actif) && !lots.some((l) => l.statut === 'en_attente' || l.statut === 'en_cours');
}

// ───────────── Campagnes d'import ─────────────
export type StatutCampagne = 'ouverte' | 'close' | 'annulee';
export const LIBELLE_STATUT_CAMPAGNE: Record<StatutCampagne, string> = { ouverte: 'Ouverte', close: 'Close', annulee: 'Annulée' };
export const LIBELLE_TYPE_CAMPAGNE: Record<TypeImport, string> = { fec: 'Import comptable', releve_bancaire: 'Relevés bancaires' };
export const PHRASE_ISOLEMENT = 'Chaque dossier est traité séparément : l’échec de l’un n’affecte pas les autres.';

export interface Campagne {
  id: string;
  libelle: string;
  type: TypeImport;
  statut: StatutCampagne;
  creePar: string | null;
  creeLe: string;
}
export interface ElementCampagne {
  lotImportId: string;
  entiteId: string;
  raisonSociale: string;
  exerciceId: string | null;
  statut: StatutLot;
  actif: boolean;
  progression: number;
  rapport: { nomFichier: string | null; lisible: boolean | null; conforme: boolean | null; suffisantPourTravaux: boolean | null; motif: string | null; nbAnomaliesParCode: Record<string, number> | null; nbMouvements: number | null };
}
export interface SuiviCampagne {
  campagne: Campagne;
  /** Dossiers de la campagne sur lesquels l'appelant n'est pas habilité : comptés, jamais détaillés. */
  dossiersHorsHabilitation: number;
  synthese: { lots: number; parStatut: Partial<Record<StatutLot, number>>; enCours: number };
  elements: ElementCampagne[];
}

const ORDRE_SYNTHESE: StatutLot[] = ['en_attente', 'en_cours', 'termine', 'termine_avec_erreurs', 'echec', 'annule'];
/** Synthèse par statut, dans un ordre stable, sans les statuts absents. */
export function syntheseParStatut(parStatut: Partial<Record<string, number>>): Array<{ statut: StatutLot; nombre: number }> {
  return ORDRE_SYNTHESE.map((statut) => ({ statut, nombre: parStatut[statut] ?? 0 })).filter((x) => x.nombre > 0);
}

/** Mention des dossiers hors habilitation ; null quand l'API n'en compte aucun. */
export function mentionHorsHabilitation(n: number): string | null {
  return n > 0 ? `${n} dossier(s) hors de votre habilitation` : null;
}

/** Trois états, jamais confondus : oui, non, non évalué (null). */
export function libelleTroisEtats(v: boolean | null | undefined): 'oui' | 'non' | 'non évalué' {
  return v === true ? 'oui' : v === false ? 'non' : 'non évalué';
}

/** Compte rendu de l'annulation d'une campagne, d'après la réponse de l'API. */
export function compteRenduAnnulationCampagne(r: { annules: number; laissesFauteHabilitation: number }): string {
  const laisses = r.laissesFauteHabilitation > 0 ? ` ${r.laissesFauteHabilitation} import(s) laissé(s) en place faute d’habilitation de révision sur leur dossier.` : ' Aucun import laissé en place faute d’habilitation.';
  return `${r.annules} import(s) annulé(s).${laisses} Chaque import annulé reste rétablissable individuellement.`;
}
