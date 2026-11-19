/**
 * Harnais d'évaluation. Mesure par tâche : exactitude, erreurs, abstentions, rejets par garde-fou.
 *
 * Contre le SIMULATEUR, chaque cas rejoue une réponse de modèle écrite à la main (bonne, fausse ou malveillante) :
 * le harnais vérifie alors que prompts, validation et garde-fous produisent l'issue attendue. C'est un test de
 * NON-RÉGRESSION du code ; cela ne mesure en rien la qualité d'un modèle réel.
 * Contre un fournisseur réel, les réponses simulées sont ignorées et la sortie du modèle est comparée à l'attendu.
 */
import type { EvenementAuditIa } from '../audit.js';
import type { FournisseurIa } from '../fournisseur.js';
import { PasserelleIa } from '../passerelle.js';
import type { ReponseSimulee } from '../simulateur/index.js';

export type IssueEvaluee = 'propose' | 'abstention' | 'rejet' | 'indisponible';

export interface CasEvaluation<E> {
  id: string;
  description: string;
  entree: E;
  /** Réponses du « modèle » rejouées par le simulateur, dans l'ordre des appels. Ignorées avec un fournisseur réel. */
  simulation: ReponseSimulee[];
  attendu: { issue: IssueEvaluee; /** Résumé attendu du résultat (comparé par égalité structurelle) ; omis : seule l'issue compte. */ cle?: unknown };
}

export interface JeuEvaluation<E> {
  tache: string;
  /** Version du corpus : à changer à chaque modification des cas. */
  version: string;
  cas: Array<CasEvaluation<E>>;
}

export interface ObservationCas {
  issue: IssueEvaluee;
  /** Résumé comparable du résultat. */
  cle: unknown;
  /** Éléments écartés par un garde-fou à l'intérieur d'un résultat par ailleurs retenu. */
  elementsEcartes: number;
}

export interface TacheEvaluable<E> {
  nom: string;
  executer(passerelle: PasserelleIa, entree: E, journal: { consigner(e: EvenementAuditIa): void }): Promise<ObservationCas>;
}

export interface RapportEvaluation {
  tache: string;
  versionCorpus: string;
  fournisseur: string;
  nature: 'reel' | 'simulateur';
  total: number;
  /** Cas dont l'issue ET le résumé correspondent à l'attendu. */
  exacts: number;
  /** Cas non conformes à l'attendu. */
  erreurs: number;
  abstentions: number;
  /** Cas entièrement rejetés par un garde-fou. */
  rejets: number;
  indisponibles: number;
  /** Éléments écartés par garde-fou dans des résultats retenus (suggestions, extraits, segments…). */
  elementsEcartes: number;
  /** exacts / total, entre 0 et 1. */
  exactitude: number;
  appelsTraces: number;
  details: Array<{ id: string; attendu: IssueEvaluee; obtenu: IssueEvaluee; exact: boolean }>;
  avertissement: string;
}

export const AVERTISSEMENT_SIMULATEUR = 'mesuré contre un SIMULATEUR : ne dit rien de la qualité du modèle réel';
export const AVERTISSEMENT_REEL = 'mesuré contre un fournisseur réel sur un corpus SYNTHÉTIQUE : ne remplace pas l’évaluation sur corpus métier réel';

function canonique(v: unknown): string {
  return JSON.stringify(v, (_cle, valeur: unknown) =>
    valeur !== null && typeof valeur === 'object' && !Array.isArray(valeur) ? Object.fromEntries(Object.entries(valeur as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : valeur,
  );
}

interface Programmable {
  reinitialiser(): unknown;
  programmer(...reponses: ReponseSimulee[]): unknown;
}

function estProgrammable(f: FournisseurIa): f is FournisseurIa & Programmable {
  return f.nature === 'simulateur' && typeof (f as Partial<Programmable>).programmer === 'function' && typeof (f as Partial<Programmable>).reinitialiser === 'function';
}

export async function evaluer<E>(tache: TacheEvaluable<E>, jeu: JeuEvaluation<E>, fournisseur: FournisseurIa): Promise<RapportEvaluation> {
  if (jeu.tache !== tache.nom) throw new Error(`Le jeu « ${jeu.tache} » ne correspond pas à la tâche « ${tache.nom} ».`);
  const evenements: EvenementAuditIa[] = [];
  const journal = { consigner: (e: EvenementAuditIa): void => void evenements.push(e) };
  const passerelle = new PasserelleIa({ fournisseur, journal });
  const rapport: RapportEvaluation = {
    tache: tache.nom,
    versionCorpus: jeu.version,
    fournisseur: fournisseur.nom,
    nature: fournisseur.nature,
    total: jeu.cas.length,
    exacts: 0,
    erreurs: 0,
    abstentions: 0,
    rejets: 0,
    indisponibles: 0,
    elementsEcartes: 0,
    exactitude: 0,
    appelsTraces: 0,
    details: [],
    avertissement: fournisseur.nature === 'simulateur' ? AVERTISSEMENT_SIMULATEUR : AVERTISSEMENT_REEL,
  };
  for (const cas of jeu.cas) {
    if (estProgrammable(fournisseur)) {
      fournisseur.reinitialiser();
      fournisseur.programmer(...cas.simulation);
    }
    const obtenu = await tache.executer(passerelle, cas.entree, journal);
    const exact = obtenu.issue === cas.attendu.issue && (cas.attendu.cle === undefined || canonique(obtenu.cle) === canonique(cas.attendu.cle));
    if (exact) rapport.exacts += 1;
    else rapport.erreurs += 1;
    if (obtenu.issue === 'abstention') rapport.abstentions += 1;
    if (obtenu.issue === 'rejet') rapport.rejets += 1;
    if (obtenu.issue === 'indisponible') rapport.indisponibles += 1;
    rapport.elementsEcartes += obtenu.elementsEcartes;
    rapport.details.push({ id: cas.id, attendu: cas.attendu.issue, obtenu: obtenu.issue, exact });
  }
  rapport.exactitude = rapport.total === 0 ? 0 : rapport.exacts / rapport.total;
  rapport.appelsTraces = evenements.filter((e) => e.type === 'appel_ia').length;
  return rapport;
}

export function formaterRapport(r: RapportEvaluation): string {
  return [
    `Évaluation « ${r.tache} » — corpus synthétique v${r.versionCorpus} — fournisseur : ${r.fournisseur}`,
    `ATTENTION : ${r.avertissement}.`,
    `Cas : ${r.total} ; conformes à l’attendu : ${r.exacts} (${(r.exactitude * 100).toFixed(1)} %) ; erreurs : ${r.erreurs}`,
    `Abstentions : ${r.abstentions} ; rejets par garde-fou : ${r.rejets} ; éléments écartés par garde-fou : ${r.elementsEcartes} ; IA indisponible : ${r.indisponibles}`,
    ...r.details.filter((d) => !d.exact).map((d) => `  ÉCART ${d.id} : attendu ${d.attendu}, obtenu ${d.obtenu}`),
  ].join('\n');
}
