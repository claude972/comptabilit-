/**
 * Indexation des pièces pour la recherche de l'assistant : le texte de chaque page est découpé en passages, enregistrés
 * dans `passages_recherche` (écrite par le worker seulement). Le vecteur reste NULL tant qu'aucun modèle d'embeddings
 * n'est utilisable (état actuel : passerelle non connectée) ; la recherche est alors purement textuelle.
 * Le texte d'une pièce est une DONNÉE : il est découpé et stocké, jamais interprété.
 */
import type { PageTexte } from '@comtaple/core';
import { eq, schema as s, type Tx } from '@comtaple/db';
import { decouperEnPassages, type Passage, vectoriserPassages } from '@comtaple/ia';
import type { ServicesIa } from '@comtaple/plateforme';

export interface PassageAIndexer {
  page: number;
  rang: number;
  texte: string;
  vecteur: number[] | null;
  modele: string | null;
  natureVecteur: 'reel' | 'simulateur' | null;
}

/**
 * Découpe les pages en passages et, SEULEMENT si un modèle est utilisable (passerelle connectée, ou simulateur dans un
 * test), calcule leurs vecteurs. Une panne en cours de route laisse les passages restants sans vecteur : le texte
 * reste indexé. À appeler hors transaction (un appel de modèle ne doit pas tenir une transaction ouverte).
 */
export async function preparerPassages(ia: ServicesIa | undefined, cible: { cabinetId: string; entiteId: string; documentId: string }, pages: readonly PageTexte[]): Promise<PassageAIndexer[]> {
  const decoupes: Array<{ page: number; passage: Passage }> = [];
  for (const p of pages) for (const passage of decouperEnPassages(`${cible.documentId}:${p.page}`, p.texte ?? '')) decoupes.push({ page: p.page, passage });
  const lignes: PassageAIndexer[] = decoupes.map(({ page, passage }) => ({ page, rang: passage.index, texte: passage.texte, vecteur: null, modele: null, natureVecteur: null }));
  if (!ia || !ia.modeleUtilisable() || ia.natureFournisseur === null || lignes.length === 0) return lignes;
  const issue = await vectoriserPassages(ia.active(), decoupes.map((d) => d.passage), { cabinetId: cible.cabinetId, dossierId: cible.entiteId });
  const faits = issue.etat === 'ok' ? issue.passages : issue.partiels;
  const parId = new Map(faits.map((f) => [f.id, f]));
  decoupes.forEach(({ passage }, i) => {
    const f = parId.get(passage.id);
    const ligne = lignes[i];
    if (f && ligne) Object.assign(ligne, { vecteur: f.vecteur, modele: f.modele, natureVecteur: ia.natureFournisseur });
  });
  await ia.journal.vider();
  return lignes;
}

/**
 * Remplace les passages d'une pièce (idempotent : une ré-analyse donne le même résultat) et retire ceux de la version
 * qu'elle remplace, qui n'est plus la version de travail.
 */
export async function remplacerPassages(tx: Tx, cible: { cabinetId: string; entiteId: string; documentId: string; remplaceDocumentId: string | null }, passages: readonly PassageAIndexer[]): Promise<void> {
  await tx.delete(s.passagesRecherche).where(eq(s.passagesRecherche.documentId, cible.documentId));
  if (cible.remplaceDocumentId) await tx.delete(s.passagesRecherche).where(eq(s.passagesRecherche.documentId, cible.remplaceDocumentId));
  for (let i = 0; i < passages.length; i += 200) {
    await tx.insert(s.passagesRecherche).values(passages.slice(i, i + 200).map((p) => ({ cabinetId: cible.cabinetId, entiteId: cible.entiteId, documentId: cible.documentId, ...p })));
  }
}
