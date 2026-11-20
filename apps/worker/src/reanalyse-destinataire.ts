import { fusionnerReanalyseDestinataire, verifierCoherenceFacture, type ChampsFacture } from '@comtaple/core';
import { and, asc, eq, journaliser, schema as s, sql, type Tx } from '@comtaple/db';
import type { TacheReanalyseDestinataire } from '@comtaple/plateforme';
import { extrairePiece } from './analyse-document.js';
import type { Contexte } from './contexte.js';
import { detecterType } from './types-fichier.js';

/** Pièces traitées par passe : le lot est borné par l'API (50 pièces au plus), la boucle reprend jusqu'à épuisement. */
const PASSE = 10;

/** Levée pour simuler l'arrêt du processus au milieu d'un lot (essais de reprise). */
export class InterruptionSimulee extends Error {}

export interface OptionsReanalyse {
  /** ESSAIS SEULEMENT : interrompt le traitement après ce nombre de pièces terminées, comme le ferait un arrêt du processus. */
  arreterApres?: number;
}

type Resultat = 'inchangee' | 'destinataire_trouve' | 'abstention' | 'erreur';
interface Conclusion {
  resultat: Resultat;
  motif: string | null;
  detail?: Record<string, unknown>;
  /** Nouvelle version d'extraction à écrire (exécution seulement). */
  nouvelle?: { champs: Record<string, unknown> };
}

/**
 * Réanalyse EXPLICITE du destinataire d'un lot de pièces, demandée par une personne habilitée (D-091).
 *
 *  - Les pièces du lot ont été sélectionnées par l'API au moment de la demande ; ce traitement ne choisit rien.
 *  - Lecture : même chemin, mêmes bornes et même processus enfant isolé que l'analyse d'une pièce déposée. L'original
 *    n'est jamais modifié ; le statut de la pièce, ses pages et ses passages de recherche ne sont pas touchés.
 *  - Simulation : rien n'est écrit dans les extractions ; le rapport dit ce qui se passerait.
 *  - Exécution : une NOUVELLE version d'extraction (projet) est créée ; la précédente est conservée, ses décisions
 *    aussi. Seule la lecture du destinataire est reprise ; une correction humaine du destinataire n'est jamais écrasée
 *    (la valeur automatique est mémorisée à côté et le désaccord est signalé).
 *  - Reprise : chaque pièce est conclue dans sa propre transaction, avec son rapport. Rejouer le lot ne traite que les
 *    pièces non terminées ; l'index unique (pièce, version de l'analyseur) interdit tout doublon.
 */
export async function reanalyserDestinataire(c: Contexte, t: TacheReanalyseDestinataire, options: OptionsReanalyse = {}): Promise<void> {
  const ctx = { cabinetId: t.cabinetId };
  const lot = await c.bd.avecContexte(ctx, async (tx) => {
    const [l] = await tx.select().from(s.reanalysesDestinataire).where(eq(s.reanalysesDestinataire.id, t.lotId));
    if (!l || l.statut === 'termine') return null;
    if (l.statut === 'en_attente') await tx.update(s.reanalysesDestinataire).set({ statut: 'en_cours', majLe: sql`now()` }).where(eq(s.reanalysesDestinataire.id, l.id));
    return l;
  });
  if (!lot) return;
  const execution = lot.mode === 'execution';
  let terminees = 0;

  for (;;) {
    const attente = await c.bd.avecContexte(ctx, (tx) =>
      tx
        .select()
        .from(s.reanalysesDestinatairePieces)
        .where(and(eq(s.reanalysesDestinatairePieces.lotId, lot.id), eq(s.reanalysesDestinatairePieces.statut, 'en_attente')))
        .orderBy(asc(s.reanalysesDestinatairePieces.id))
        .limit(PASSE),
    );
    if (attente.length === 0) break;
    for (const piece of attente) {
      if (options.arreterApres !== undefined && terminees >= options.arreterApres) throw new InterruptionSimulee('Arrêt simulé du traitement');
      let conclusion: Conclusion;
      try {
        conclusion = await lirePiece(c, ctx, piece, execution, lot.versionAnalyseur);
      } catch (e) {
        // Aucun contenu de pièce dans le journal technique : identifiants et nature de l'erreur seulement.
        console.error(`[documents] réanalyse du destinataire : pièce ${piece.documentId} en erreur : ${(e as Error).message}`);
        conclusion = { resultat: 'erreur', motif: 'La pièce n’a pas pu être relue (original indisponible ou analyse interrompue). Rien n’a été modifié ; une nouvelle demande pourra la reprendre.' };
      }
      await conclure(c, ctx, lot, piece, execution, conclusion);
      terminees++;
    }
  }

  await c.bd.avecContexte(ctx, async (tx) => {
    const lignes = await tx.select({ resultat: s.reanalysesDestinatairePieces.resultat }).from(s.reanalysesDestinatairePieces).where(eq(s.reanalysesDestinatairePieces.lotId, lot.id));
    const resume: Record<string, number> = { inchangee: 0, destinataire_trouve: 0, abstention: 0, erreur: 0 };
    for (const l of lignes) if (l.resultat) resume[l.resultat] = (resume[l.resultat] ?? 0) + 1;
    const [fini] = await tx
      .update(s.reanalysesDestinataire)
      .set({ statut: 'termine', termineLe: sql`now()`, majLe: sql`now()`, resume })
      .where(and(eq(s.reanalysesDestinataire.id, lot.id), eq(s.reanalysesDestinataire.statut, 'en_cours')))
      .returning({ id: s.reanalysesDestinataire.id });
    if (!fini) return; // un autre traitement du même lot a déjà conclu
    await journaliser(tx, {
      cabinetId: t.cabinetId,
      acteurType: 'systeme',
      action: execution ? 'reanalyse_destinataire.executee' : 'reanalyse_destinataire.simulee',
      cibleType: 'reanalyse_destinataire',
      cibleId: lot.id,
      entiteId: lot.entiteId,
      details: { demandePar: lot.demandePar, versionAnalyseur: lot.versionAnalyseur, nbPieces: lot.nbPieces, resume },
    });
  });
}

/** Relit UNE pièce et détermine la conclusion (sans rien écrire). Lève une erreur pour toute panne technique. */
async function lirePiece(c: Contexte, ctx: { cabinetId: string }, piece: typeof s.reanalysesDestinatairePieces.$inferSelect, execution: boolean, versionAnalyseur: string): Promise<Conclusion> {
  const charge = await c.bd.avecContexte(ctx, async (tx) => {
    const [doc] = await tx.select().from(s.documents).where(eq(s.documents.id, piece.documentId));
    if (!doc) return null;
    const [fichier] = await tx.select().from(s.fichiers).where(eq(s.fichiers.id, doc.fichierId));
    const [actuelle] = await tx.select().from(s.extractions).where(and(eq(s.extractions.documentId, doc.id), eq(s.extractions.actuelle, true)));
    return { doc, fichier, actuelle };
  });
  if (!charge?.fichier) return { resultat: 'erreur', motif: 'Pièce ou original introuvable : rien n’a été modifié.' };
  const { doc, fichier, actuelle } = charge;
  if (doc.remplacePar || doc.statut === 'remplace') return { resultat: 'inchangee', motif: 'La pièce a été remplacée par une nouvelle version depuis la demande : rien n’est changé.' };
  if (!actuelle || actuelle.id !== piece.extractionAvantId) {
    return { resultat: 'inchangee', motif: 'L’extraction de la pièce a changé depuis la demande (correction ou nouvelle version) : rien n’est changé ; la pièce pourra être reprise dans une nouvelle demande.' };
  }
  if (fichier.analyseAntivirus === 'infecte' || doc.statut === 'quarantaine') return { resultat: 'erreur', motif: 'Pièce en quarantaine : elle n’est pas relue.' };

  const contenu = await c.stockage.lire(fichier.cleStockage, c.cfg.TAILLE_MAX_PIECE);
  const type = detecterType(contenu);
  if (type === 'inconnu') return { resultat: 'erreur', motif: 'Type de fichier non pris en charge : la pièce n’est pas relue.' };
  const lecture = await extrairePiece(c, type, contenu, doc.id);
  if (lecture.motif !== null) return { resultat: 'erreur', motif: lecture.motif };
  if (lecture.illisible) return { resultat: 'erreur', motif: 'Pièce illisible ou incomplète : aucun champ n’a pu être relu.' };
  if (!lecture.champs) {
    return { resultat: 'abstention', motif: 'Aucun champ n’a pu être lu sur la pièce lors de cette relecture : l’extraction est conservée telle quelle.', detail: { versionAnalyseur } };
  }
  const base = actuelle.champs as Record<string, unknown>;
  const fusion = fusionnerReanalyseDestinataire(base, lecture.champs, { versionNouvelle: actuelle.version + 1, versionAnalyseur });
  const detail = { versionAnalyseur, avant: fusion.avant, apres: fusion.apres, automatique: fusion.automatique, desaccords: fusion.desaccords, autresDivergences: fusion.autresDivergences };
  if (fusion.resultat === 'inchangee') return { resultat: 'inchangee', motif: fusion.motif, detail };
  return { resultat: fusion.resultat, motif: fusion.motif, detail, ...(execution ? { nouvelle: { champs: fusion.champs } } : {}) };
}

/**
 * Conclut UNE pièce : une seule transaction écrit la nouvelle version d'extraction (exécution), le rapport de la pièce et
 * l'entrée du journal d'audit. Si la pièce est déjà terminée (traitement concurrent ou repris), rien n'est refait.
 */
async function conclure(c: Contexte, ctx: { cabinetId: string }, lot: typeof s.reanalysesDestinataire.$inferSelect, piece: typeof s.reanalysesDestinatairePieces.$inferSelect, execution: boolean, conclusion: Conclusion): Promise<void> {
  const ecrire = (tx: Tx, c2: Conclusion) => ecrireConclusion(tx, lot, piece, execution, c2);
  try {
    await c.bd.avecContexte(ctx, (tx) => ecrire(tx, conclusion));
  } catch (e) {
    // Garde-fou : une autre demande a déjà réanalysé cette pièce avec la même version de l'analyseur (index unique) ; rien n'a été écrit.
    if ((e as { code?: string; cause?: { code?: string } }).code === '23505' || (e as { cause?: { code?: string } }).cause?.code === '23505') {
      await c.bd.avecContexte(ctx, (tx) => ecrire(tx, { resultat: 'erreur', motif: 'Cette pièce a déjà été réanalysée avec cette version de l’analyseur par une autre demande : rien n’est refait.' }));
      return;
    }
    throw e;
  }
}

async function ecrireConclusion(tx: Tx, lot: typeof s.reanalysesDestinataire.$inferSelect, piece: typeof s.reanalysesDestinatairePieces.$inferSelect, execution: boolean, conclusion: Conclusion): Promise<void> {
  const [courante] = await tx.select().from(s.reanalysesDestinatairePieces).where(eq(s.reanalysesDestinatairePieces.id, piece.id)).for('update');
  if (!courante || courante.statut === 'termine') return;
  let extractionApresId: string | null = null;
  let versionApres: number | null = null;
  let versionAvant = piece.versionExtractionAvant;
  if (execution && conclusion.nouvelle) {
    const [actuelle] = await tx.select().from(s.extractions).where(and(eq(s.extractions.documentId, piece.documentId), eq(s.extractions.actuelle, true))).for('update');
    if (!actuelle || actuelle.id !== piece.extractionAvantId) {
      conclusion = { resultat: 'inchangee', motif: 'L’extraction de la pièce a changé pendant la relecture : rien n’est changé.' };
    } else {
      versionAvant = actuelle.version;
      await tx.update(s.extractions).set({ actuelle: false }).where(eq(s.extractions.id, actuelle.id));
      const champs = conclusion.nouvelle.champs;
      const [nouvelle] = await tx
        .insert(s.extractions)
        .values({
          cabinetId: lot.cabinetId,
          entiteId: lot.entiteId,
          documentId: piece.documentId,
          version: actuelle.version + 1,
          // La méthode reste celle de la version précédente : les champs hors destinataire (et ceux corrigés à la main) ne changent pas.
          methode: actuelle.methode,
          moteur: `${actuelle.moteur ?? actuelle.methode} ; réanalyse du destinataire, analyseur ${lot.versionAnalyseur}`,
          champs,
          verifications: verifierCoherenceFacture(champs as unknown as ChampsFacture),
          // Une version nouvelle n'est jamais validée d'office : la validation antérieure reste attachée à la version précédente.
          statut: 'projet',
        })
        .returning({ id: s.extractions.id, version: s.extractions.version });
      extractionApresId = nouvelle!.id;
      versionApres = nouvelle!.version;
      await journaliser(tx, {
        cabinetId: lot.cabinetId,
        acteurType: 'systeme',
        action: 'extraction.destinataire_reanalyse',
        cibleType: 'document',
        cibleId: piece.documentId,
        entiteId: lot.entiteId,
        details: { demandePar: lot.demandePar, reanalyseId: lot.id, versionAnalyseur: lot.versionAnalyseur, versionAvant, versionApres, resultat: conclusion.resultat, ...(conclusion.detail ?? {}) },
      });
    }
  }
  await tx
    .update(s.reanalysesDestinatairePieces)
    .set({
      statut: 'termine',
      resultat: conclusion.resultat,
      motif: conclusion.motif,
      extractionApresId,
      versionExtractionApres: versionApres,
      detail: { ...(conclusion.detail ?? {}), versionExtractionAvant: versionAvant },
      traiteLe: sql`now()`,
    })
    .where(eq(s.reanalysesDestinatairePieces.id, piece.id));
  await tx.update(s.reanalysesDestinataire).set({ majLe: sql`now()` }).where(eq(s.reanalysesDestinataire.id, lot.id));
}
