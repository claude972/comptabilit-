/**
 * Recherche vectorielle : découpage en passages, embeddings par lots via la passerelle, fusion de classements (RRF).
 * Le stockage (pgvector) et l'exécution des requêtes sont à la charge de l'intégrateur ; ce module dit quoi stocker.
 */
import type { ContexteAppel } from '../audit.js';
import { empreinteSha256 } from '../audit.js';
import { MODELES_IA } from '../modeles.js';
import type { IssueIndisponible, PasserelleIa } from '../passerelle.js';

/** Vecteur d'embedding : `MODELES_IA.embeddings.dimensions` (1024) nombres. Colonne pgvector : `vector(1024)`. */
export type Vecteur = number[];
export const DIMENSIONS_VECTEUR = MODELES_IA.embeddings.dimensions;
/** Taille de lot : OVHcloud AI Endpoints accepte au plus 25 textes par appel d'embeddings pour bge-m3 (voir docs). */
export const TAILLE_LOT_EMBEDDINGS = 25;

export interface Passage {
  /** `${documentId}#${index}` : stable tant que le texte et les paramètres de découpage ne changent pas. */
  id: string;
  documentId: string;
  index: number;
  /** Position dans le texte d'origine (indices de caractères, fin exclue). */
  debut: number;
  fin: number;
  texte: string;
  /** SHA-256 du texte du passage : permet de ne pas recalculer un embedding inchangé. */
  empreinte: string;
}

/**
 * Ce que l'intégrateur doit stocker par passage (table à index pgvector), en plus de ses propres clés
 * `cabinetId` / `dossierId` (cloisonnement) : le vecteur n'a de sens qu'avec le modèle qui l'a produit.
 */
export interface PassageVectorise extends Passage {
  vecteur: Vecteur;
  modele: string;
  dimensions: number;
  /** Paramètres de découpage, pour savoir quand ré-indexer. */
  decoupage: { taille: number; recouvrement: number };
}

export interface OptionsDecoupage {
  /** Taille maximale d'un passage, en caractères. Défaut : 1200. */
  taille: number;
  /** Recouvrement entre deux passages consécutifs, en caractères. Défaut : 200. */
  recouvrement: number;
}

export const DECOUPAGE_PAR_DEFAUT: OptionsDecoupage = { taille: 1200, recouvrement: 200 };

/**
 * Découpe un texte en passages de `taille` caractères au plus, avec recouvrement. Déterministe.
 * La coupure se fait de préférence après une fin de paragraphe, sinon de phrase, sinon un espace, dans le
 * dernier tiers de la fenêtre ; à défaut, à la taille exacte.
 */
export function decouperEnPassages(documentId: string, texte: string, options: Partial<OptionsDecoupage> = {}): Passage[] {
  const { taille, recouvrement } = { ...DECOUPAGE_PAR_DEFAUT, ...options };
  if (!Number.isInteger(taille) || taille < 50) throw new Error('Découpage : taille entière d’au moins 50 caractères attendue.');
  if (!Number.isInteger(recouvrement) || recouvrement < 0 || recouvrement > taille / 2) throw new Error('Découpage : recouvrement entre 0 et la moitié de la taille attendu.');
  const passages: Passage[] = [];
  let debut = 0;
  while (debut < texte.length) {
    let fin = Math.min(texte.length, debut + taille);
    if (fin < texte.length) {
      const fenetre = texte.slice(debut, fin);
      const plancher = Math.floor((taille * 2) / 3);
      const coupes = [fenetre.lastIndexOf('\n\n') + 2, Math.max(fenetre.lastIndexOf('. '), fenetre.lastIndexOf('.\n')) + 2, fenetre.lastIndexOf('\n') + 1, fenetre.lastIndexOf(' ') + 1];
      const coupe = coupes.find((c) => c > plancher);
      if (coupe !== undefined) fin = debut + coupe;
    }
    const brut = texte.slice(debut, fin);
    const utile = brut.trim();
    if (utile !== '') {
      const decalage = brut.indexOf(utile);
      const index = passages.length;
      passages.push({ id: `${documentId}#${index}`, documentId, index, debut: debut + decalage, fin: debut + decalage + utile.length, texte: utile, empreinte: empreinteSha256(utile) });
    }
    if (fin >= texte.length) break;
    debut = Math.max(fin - recouvrement, debut + 1);
  }
  return passages;
}

export type IssueVectorisation =
  | { etat: 'ok'; passages: PassageVectorise[]; lots: number }
  /** `partiels` : passages déjà vectorisés avant la panne (à conserver ; reprendre les autres plus tard). */
  | (IssueIndisponible & { partiels: PassageVectorise[] });

/**
 * Calcule les embeddings des passages, par lots, via la passerelle (pseudonymisation et audit compris).
 * En cas de panne, l'indexation texte reste utilisable : la recherche fonctionne sans vecteurs.
 */
export async function vectoriserPassages(
  passerelle: PasserelleIa,
  passages: readonly Passage[],
  contexte: ContexteAppel,
  options: { tailleLot?: number; decoupage?: OptionsDecoupage; nomsPersonnes?: readonly string[] } = {},
): Promise<IssueVectorisation> {
  const tailleLot = Math.min(Math.max(1, options.tailleLot ?? TAILLE_LOT_EMBEDDINGS), TAILLE_LOT_EMBEDDINGS);
  const decoupage = options.decoupage ?? DECOUPAGE_PAR_DEFAUT;
  const faits: PassageVectorise[] = [];
  let lots = 0;
  for (let i = 0; i < passages.length; i += tailleLot) {
    const lot = passages.slice(i, i + tailleLot);
    const issue = await passerelle.vectoriser({ tache: 'embeddings_passages', prompt: null, contexte, textes: lot.map((p) => p.texte), ...(options.nomsPersonnes ? { nomsPersonnes: options.nomsPersonnes } : {}) });
    if (issue.etat !== 'ok') return { ...issue, partiels: faits };
    lots += 1;
    lot.forEach((p, j) => faits.push({ ...p, vecteur: issue.vecteurs[j] as Vecteur, modele: issue.modele, dimensions: issue.dimensions, decoupage }));
  }
  return { etat: 'ok', passages: faits, lots };
}

/** Embedding d'une requête de recherche. Indisponible : l'appelant fait la recherche en texte seul. */
export async function vectoriserRequete(
  passerelle: PasserelleIa,
  requete: string,
  contexte: ContexteAppel,
  nomsPersonnes?: readonly string[],
): Promise<{ etat: 'ok'; vecteur: Vecteur; modele: string } | IssueIndisponible> {
  const issue = await passerelle.vectoriser({ tache: 'embeddings_requete', prompt: null, contexte, textes: [requete], ...(nomsPersonnes ? { nomsPersonnes } : {}) });
  if (issue.etat !== 'ok') return issue;
  return { etat: 'ok', vecteur: issue.vecteurs[0] as Vecteur, modele: issue.modele };
}

/** Similarité cosinus (pour les tests et les petits volumes ; en production, l'opérateur `<=>` de pgvector). */
export function similariteCosinus(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error('Similarité : vecteurs de dimensions différentes.');
  let produit = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    produit += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : produit / Math.sqrt(na * nb);
}

export interface ResultatFusion {
  id: string;
  /** Score RRF : somme sur les classements de 1 / (k + rang). Sert à ORDONNER ; ce n'est pas une probabilité. */
  score: number;
  /** Rang (à partir de 1) dans chaque classement fourni, `null` si absent. */
  rangs: Array<number | null>;
}

/**
 * Fusion de classements par rangs réciproques (RRF). Chaque classement est une liste d'identifiants du meilleur
 * au moins bon (ex. recherche plein texte, recherche vectorielle). Égalités départagées par identifiant : déterministe.
 */
export function fusionnerClassements(classements: ReadonlyArray<readonly string[]>, options: { k?: number; limite?: number } = {}): ResultatFusion[] {
  const k = options.k ?? 60;
  if (!(k > 0)) throw new Error('Fusion : k strictement positif attendu.');
  const fusion = new Map<string, ResultatFusion>();
  classements.forEach((classement, c) => {
    const vus = new Set<string>();
    let rang = 0;
    for (const id of classement) {
      if (vus.has(id)) continue;
      vus.add(id);
      rang += 1;
      const r = fusion.get(id) ?? { id, score: 0, rangs: classements.map(() => null) };
      r.score += 1 / (k + rang);
      r.rangs[c] = rang;
      fusion.set(id, r);
    }
  });
  const tries = [...fusion.values()].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return options.limite !== undefined ? tries.slice(0, options.limite) : tries;
}
