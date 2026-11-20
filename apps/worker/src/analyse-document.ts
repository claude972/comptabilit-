import { type ChampsFacture, type PageTexte, VERSION_ANALYSEUR_FACTURE, verifierCoherenceFacture } from '@comtaple/core';
import { and, eq, journaliser, schema as s, sql } from '@comtaple/db';
import type { TacheAnalyseDocument } from '@comtaple/plateforme';
import { analyserPieceIsolee, type CauseEchec, extraireTexteIsole, isolementDepuisConfig, motifEchecAnalyse, type OptionsAnalyse } from './analyse-isolee.js';
import { caracteresUtiles } from './analyse-types.js';
import { analyserAntivirus } from './antivirus.js';
import type { Contexte } from './contexte.js';
import { ocr } from './ocr.js';
import { preparerPassages, remplacerPassages } from './passages.js';
import { detecterType } from './types-fichier.js';

/** En dessous, une pièce passée à l'OCR est jugée illisible et renvoyée au déposant (règle interne). */
const SEUIL_LISIBILITE = 25;

/**
 * Analyse d'une pièce : type réel, antivirus, extraction (données structurées > couche texte > OCR), vérifications
 * arithmétiques par le moteur. Le contenu de la pièce est une DONNÉE : aucun texte qu'elle contient n'est interprété
 * comme une instruction. L'IA n'intervient pas dans l'extraction. Après l'analyse, le texte des pages est découpé en passages
 * pour la recherche de l'assistant ; leurs vecteurs ne sont calculés que si la passerelle IA est connectée (sinon NULL).
 *
 * ISOLEMENT : ce processus ne DÉCODE aucun fichier déposé. Il compare les premiers octets à des signatures fixes
 * (type réel), transmet les octets à l'antivirus, au service OCR et au processus enfant d'analyse (`analyse-isolee.ts`),
 * et ne reçoit de l'enfant qu'un résultat structuré validé par schéma. Un enfant qui plante, boucle ou déborde donne à
 * la pièce un motif explicite ; le fichier original n'est jamais modifié et les autres pièces continuent d'être traitées.
 */
export async function analyserDocument(c: Contexte, t: TacheAnalyseDocument): Promise<void> {
  const ctx = { cabinetId: t.cabinetId };
  const charge = await c.bd.avecContexte(ctx, async (tx) => {
    const [doc] = await tx.select().from(s.documents).where(eq(s.documents.id, t.documentId));
    if (!doc) return null;
    const [fichier] = await tx.select().from(s.fichiers).where(eq(s.fichiers.id, doc.fichierId));
    if (!fichier) return null;
    if (doc.statut === 'traite' || doc.statut === 'remplace') return null; // validé ou remplacé : on ne touche plus à rien
    await tx.update(s.documents).set({ statut: 'en_analyse', motifStatut: null, majLe: sql`now()` }).where(eq(s.documents.id, doc.id));
    return { doc, fichier };
  });
  if (!charge) return;
  const { doc, fichier } = charge;

  const contenu = await c.stockage.lire(fichier.cleStockage, c.cfg.TAILLE_MAX_PIECE);
  const type = detecterType(contenu);

  const conclure = (statut: (typeof s.statutDocument.enumValues)[number], motif: string | null, antivirus: string, extra?: (tx: Parameters<Parameters<typeof c.bd.avecContexte>[1]>[0]) => Promise<void>) =>
    c.bd.avecContexte(ctx, async (tx) => {
      await tx.update(s.fichiers).set({ typeMimeDetecte: type === 'inconnu' ? null : type, analyseAntivirus: antivirus }).where(eq(s.fichiers.id, fichier.id));
      if (extra) await extra(tx);
      await tx.update(s.documents).set({ statut, motifStatut: motif, majLe: sql`now()` }).where(eq(s.documents.id, doc.id));
      await journaliser(tx, {
        cabinetId: t.cabinetId,
        acteurType: 'systeme',
        action: 'document.analyse',
        cibleType: 'document',
        cibleId: doc.id,
        entiteId: doc.entiteId,
        details: { statut, type, antivirus },
      });
    });

  // 1) Antivirus avant tout traitement du contenu.
  const av = await analyserAntivirus(contenu, c.cfg.CLAMAV_HOST, c.cfg.CLAMAV_PORT);
  if (av.verdict === 'infecte') {
    await conclure('quarantaine', 'Fichier placé en quarantaine par l’antivirus', 'infecte');
    return;
  }
  if (av.verdict === 'indisponible' && c.cfg.ANTIVIRUS_OBLIGATOIRE) {
    await c.bd.avecContexte(ctx, (tx) =>
      tx.update(s.documents).set({ statut: 'recu', motifStatut: 'Analyse antivirus en attente (service indisponible)', majLe: sql`now()` }).where(eq(s.documents.id, doc.id)),
    );
    throw new Error(`Antivirus indisponible : ${av.motif}`); // la tâche sera retentée
  }
  const antivirus = av.verdict === 'sain' ? 'sain' : 'non_analyse';

  if (type === 'inconnu') {
    await conclure('a_completer', 'Type de fichier non pris en charge (PDF, JPEG, PNG, WebP, TIFF ou XML de facture attendus)', antivirus);
    return;
  }

  // 2) Extraction : données structurées d'abord, puis couche texte, puis OCR.
  const lecture = await extrairePiece(c, type, contenu, t.documentId);
  const { pages, champs, methode, moteur, nbPages, motif, illisible } = lecture;

  // Passages de recherche : préparés hors transaction (un éventuel appel d'embeddings ne tient aucune transaction ouverte).
  const cible = { cabinetId: t.cabinetId, entiteId: doc.entiteId, documentId: doc.id, remplaceDocumentId: doc.remplaceDocumentId };
  const passages = illisible ? [] : await preparerPassages(c.ia, cible, pages);

  await conclure(
    illisible ? 'a_completer' : 'a_controler',
    illisible ? 'Pièce illisible ou incomplète : merci de la photographier à nouveau' : motif,
    antivirus,
    async (tx) => {
      if (nbPages !== null) await tx.update(s.documents).set({ nbPages }).where(eq(s.documents.id, doc.id));
      await tx.delete(s.pagesDocument).where(eq(s.pagesDocument.documentId, doc.id));
      if (pages.length) {
        await tx.insert(s.pagesDocument).values(
          pages.map((p) => ({ cabinetId: t.cabinetId, entiteId: doc.entiteId, documentId: doc.id, numero: p.page, texte: p.texte, lignes: p.lignes ?? null, methode })),
        );
      }
      await remplacerPassages(tx, cible, passages);
      if (!champs) return;
      const [actuelle] = await tx
        .select()
        .from(s.extractions)
        .where(and(eq(s.extractions.documentId, doc.id), eq(s.extractions.actuelle, true)))
        .for('update');
      // Une correction humaine ou une validation n'est jamais écrasée par une nouvelle extraction automatique.
      if (actuelle && (actuelle.methode === 'saisie_humaine' || actuelle.statut === 'valide')) return;
      if (actuelle) await tx.update(s.extractions).set({ actuelle: false }).where(eq(s.extractions.id, actuelle.id));
      await tx.insert(s.extractions).values({
        cabinetId: t.cabinetId,
        entiteId: doc.entiteId,
        documentId: doc.id,
        version: (actuelle?.version ?? 0) + 1,
        methode,
        moteur: `${moteur} ; IA : ${c.cfg.IA_OVH_ENDPOINT ? 'non sollicitée' : 'non connectée'} ; analyseur ${VERSION_ANALYSEUR_FACTURE}`,
        champs,
        verifications: verifierCoherenceFacture(champs),
        statut: 'projet',
      });
    },
  );
}

export interface LecturePiece {
  pages: PageTexte[];
  champs: ChampsFacture | null;
  methode: string;
  moteur: string | null;
  nbPages: number | null;
  /** Motif en français quand la lecture n'a pas abouti (analyse interrompue, lecture impossible, OCR indisponible). */
  motif: string | null;
  illisible: boolean;
}

/**
 * Lecture d'une pièce : données structurées d'abord, puis couche texte, puis OCR. Partagée par l'analyse d'une pièce
 * déposée et par la réanalyse explicite du destinataire (D-091) : même chemin, mêmes bornes, même isolement. Ne touche
 * ni la base ni le stockage.
 */
export async function extrairePiece(c: Contexte, type: ReturnType<typeof detecterType>, contenu: Buffer, documentId: string): Promise<LecturePiece> {
  let pages: PageTexte[] = [];
  let champs: ChampsFacture | null = null;
  let methode = 'aucune';
  let moteur: string | null = null;
  let nbPages: number | null = null;
  let motif: string | null = null;
  let illisible = false;

  const isolement: OptionsAnalyse = {
    dureeMaxMs: c.cfg.ANALYSE_DUREE_MAX_MS,
    tasMaxMo: c.cfg.ANALYSE_TAS_MAX_MO,
    memoireMaxMo: c.cfg.ANALYSE_MEMOIRE_MAX_MO,
    sortieMaxOctets: c.cfg.ANALYSE_SORTIE_MAX_OCTETS,
    ...isolementDepuisConfig(c.cfg),
    ...c.analyse,
  };
  // Le motif technique (cause) va au journal du worker, jamais à l'utilisateur ; aucun contenu de pièce n'y figure.
  const interrompre = (etape: string, cause: CauseEchec) => {
    console.error(`[documents] analyse isolée interrompue (${etape}) pour le document ${documentId} : ${cause}`);
    motif = motifEchecAnalyse(cause);
  };

  if (type === 'application/pdf' || type === 'application/xml') {
    const r = await analyserPieceIsolee(type, contenu, isolement);
    if (!r.ok) interrompre('lecture', r.cause);
    else {
      ({ pages, nbPages, champs, methode, moteur } = r.valeur);
      if (r.valeur.lectureImpossible) {
        console.error(`[documents] lecture impossible du document ${documentId}`);
        motif = 'Lecture impossible : le fichier est endommagé ou son contenu ne correspond pas à son format. La pièce est conservée telle quelle ; déposez-la à nouveau si vous en avez une copie lisible.';
      }
    }
  }
  // OCR (service dédié, déjà isolé) : pour une image, ou un PDF lu sans couche texte exploitable.
  if (type !== 'application/xml' && methode === 'aucune' && motif === null) {
    const r = await ocr(contenu, type, c.cfg.OCR_URL);
    if (r.disponible) {
      pages = r.pages;
      nbPages ??= r.pages.length;
      methode = 'ocr';
      moteur = r.moteur ?? 'ocr';
      champs = null;
      if (caracteresUtiles(pages) < SEUIL_LISIBILITE) illisible = true;
      else if (pages.length > 0) {
        // Le texte reconnu reste un contenu non fiable : ses champs sont extraits dans un enfant, comme pour un PDF.
        const e = await extraireTexteIsole(pages, isolement);
        if (e.ok) champs = e.valeur.champs;
        else interrompre('extraction', e.cause);
      }
    } else {
      motif = `OCR indisponible (${r.motif ?? 'inconnu'}) : saisie manuelle nécessaire`;
    }
  }
  return { pages, champs, methode, moteur, nbPages, motif, illisible };
}
