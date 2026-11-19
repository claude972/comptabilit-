/**
 * Traces d'audit de la passerelle. AUCUN CONTENU : ni prompt, ni réponse, ni argument, ni résultat de fonction.
 * Seulement des identifiants, des tailles, des empreintes, des décomptes et des codes.
 */
import { createHash } from 'node:crypto';
import type { TypePseudonyme } from './pseudonymisation.js';

export function empreinteSha256(texte: string): string {
  return createHash('sha256').update(texte, 'utf8').digest('hex');
}

/** Contexte IMPOSÉ par l'appelant (jamais par le modèle). */
export interface ContexteAppel {
  cabinetId: string;
  dossierId?: string | null;
  utilisateurId?: string | null;
}

export type ResultatAppel = 'ok' | 'abstention' | 'rejet' | 'erreur';

export interface CoutEstime {
  /** Chaîne décimale à 6 décimales, dans `devise`. ESTIMATION : jetons × tarif configuré. */
  montant: string;
  devise: string;
  /** Date à laquelle les tarifs utilisés ont été relevés. */
  tarifsRelevesLe: string;
}

export interface TraceAppelIa {
  type: 'appel_ia';
  id: string;
  horodatage: string;
  /** Nom de la tâche (`classer_piece`, `assistant`, `embeddings`…). */
  tache: string;
  operation: 'completion' | 'embeddings';
  prompt: { id: string; version: string } | null;
  fournisseur: string | null;
  nature: 'reel' | 'simulateur' | null;
  modele: string;
  contexte: { cabinetId: string; dossierId: string | null; utilisateurId: string | null };
  /** SHA-256 du prompt APRÈS pseudonymisation (messages, fonctions déclarées, schéma). */
  empreintePrompt: string;
  tailles: { messages: number; caracteresEntree: number; caracteresSortie: number; fonctionsDeclarees: number; appelsFonctions: number; textes: number };
  /** Nombre de valeurs distinctes masquées avant l'appel, par type. */
  pseudonymes: Record<TypePseudonyme, number>;
  dureeMs: number;
  jetons: { entree: number | null; sortie: number | null };
  coutEstime: CoutEstime | null;
  resultat: ResultatAppel;
  /** Codes (jamais de contenu) : motifs de rejet ou d'abstention, code d'erreur. */
  codes: string[];
}

export interface TraceFonctionMetier {
  type: 'fonction_metier';
  id: string;
  horodatage: string;
  tache: string;
  /** Nom demandé, réduit à `[A-Za-z0-9_]` et 64 caractères (un nom inventé par le modèle n'est pas fiable). */
  fonction: string;
  mode: 'ia' | 'sans_ia';
  issue: 'executee' | 'refusee' | 'erreur';
  /** Code du refus ou de l'erreur. */
  code: string | null;
  contexte: { cabinetId: string; dossierId: string | null; utilisateurId: string | null };
  tailles: { arguments: number; elements: number; elementsEcartes: number };
}

export type EvenementAuditIa = TraceAppelIa | TraceFonctionMetier;

/** Port à implémenter par l'intégrateur : écriture dans le journal d'audit (table dédiée). */
export interface JournalAuditIa {
  consigner(evenement: EvenementAuditIa): void;
}

/** Tarifs passés en configuration, DATÉS. Le code n'embarque aucun tarif. */
export interface TarifsIa {
  /** AAAA-MM-JJ : date du relevé des tarifs. */
  relevesLe: string;
  devise: string;
  /** Où les tarifs ont été relevés (URL du catalogue, contrat…). */
  source: string;
  /** Par identifiant de modèle : prix par million de jetons, chaînes décimales (6 décimales au plus). */
  parMillionDeJetons: Record<string, { entree: string; sortie: string }>;
}

const MICRO = 1_000_000n;

function versMicro(prix: string): bigint | null {
  const m = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(prix);
  if (!m) return null;
  return BigInt(m[1] ?? '0') * MICRO + BigInt((m[2] ?? '').padEnd(6, '0'));
}

/** Coût estimé = jetons × tarif / 1 000 000, en arithmétique entière (arrondi au millionième le plus proche). */
export function estimerCout(tarifs: TarifsIa | null, modele: string, jetons: { entree: number | null; sortie: number | null }): CoutEstime | null {
  const tarif = tarifs?.parMillionDeJetons[modele];
  if (!tarifs || !tarif || jetons.entree === null) return null;
  const entree = versMicro(tarif.entree);
  const sortie = versMicro(tarif.sortie);
  if (entree === null || sortie === null) return null;
  const numerateur = BigInt(jetons.entree) * entree + BigInt(jetons.sortie ?? 0) * sortie;
  const micro = (numerateur + MICRO / 2n) / MICRO;
  const texte = micro.toString().padStart(7, '0');
  return { montant: `${texte.slice(0, -6)}.${texte.slice(-6)}`, devise: tarifs.devise, tarifsRelevesLe: tarifs.relevesLe };
}
