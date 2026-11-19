import {
  type ChampsFacture,
  extraireChampsFacture,
  extraireChampsFacturX,
  extraireChampsUbl,
  type PageTexte,
  verifierCoherenceFacture,
} from '@comtaple/core';
import { and, eq, journaliser, schema as s, sql } from '@comtaple/db';
import type { TacheAnalyseDocument } from '@comtaple/plateforme';
import { analyserAntivirus } from './antivirus.js';
import type { Contexte } from './contexte.js';
import { ocr } from './ocr.js';
import { lirePdf } from './pdf.js';
import { detecterType } from './types-fichier.js';

/** Nombre minimal de caractères utiles pour considérer qu'une couche texte PDF existe réellement. */
const SEUIL_COUCHE_TEXTE = 40;
/** En dessous, une pièce passée à l'OCR est jugée illisible et renvoyée au déposant (règle interne). */
const SEUIL_LISIBILITE = 25;

const caracteresUtiles = (pages: PageTexte[]) => pages.reduce((n, p) => n + p.texte.replace(/\s/g, '').length, 0);

/**
 * Analyse d'une pièce : type réel, antivirus, extraction (données structurées > couche texte > OCR), vérifications
 * arithmétiques par le moteur. Le contenu de la pièce est une DONNÉE : aucun texte qu'elle contient n'est interprété
 * comme une instruction. L'IA n'intervient pas ici ; la passerelle IA est facultative et, non connectée, n'est pas appelée.
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
  let pages: PageTexte[] = [];
  let champs: ChampsFacture | null = null;
  let methode = 'aucune';
  let moteur: string | null = null;
  let nbPages: number | null = null;
  let motif: string | null = null;
  let illisible = false;

  try {
    if (type === 'application/xml') {
      const xml = contenu.toString('utf8');
      champs = /CrossIndustryInvoice/.test(xml.slice(0, 4000)) ? extraireChampsFacturX(xml) : extraireChampsUbl(xml);
      methode = 'structure';
      moteur = 'analyse XML (CII/UBL)';
    } else {
      if (type === 'application/pdf') {
        const pdf = await lirePdf(contenu);
        nbPages = pdf.nbPages;
        pages = pdf.pages;
        if (pdf.xmlEmbarque) {
          champs = extraireChampsFacturX(pdf.xmlEmbarque);
          methode = 'structure';
          moteur = 'Factur-X (XML embarqué)';
        } else if (caracteresUtiles(pages) >= SEUIL_COUCHE_TEXTE) {
          methode = 'couche_texte';
          moteur = 'pdfjs-dist';
        }
      }
      if (methode === 'aucune') {
        const r = await ocr(contenu, type, c.cfg.OCR_URL);
        if (r.disponible) {
          pages = r.pages;
          nbPages ??= r.pages.length;
          methode = 'ocr';
          moteur = r.moteur ?? 'ocr';
          if (caracteresUtiles(pages) < SEUIL_LISIBILITE) illisible = true;
        } else {
          motif = `OCR indisponible (${r.motif ?? 'inconnu'}) : saisie manuelle nécessaire`;
        }
      }
      if (!champs && pages.length > 0 && !illisible) champs = extraireChampsFacture(pages);
    }
  } catch (e) {
    motif = `Lecture impossible : ${e instanceof Error ? e.message.slice(0, 200) : 'erreur'}`;
  }

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
        moteur: `${moteur} ; IA : ${c.cfg.IA_OVH_ENDPOINT ? 'non sollicitée' : 'non connectée'}`,
        champs,
        verifications: verifierCoherenceFacture(champs),
        statut: 'projet',
      });
    },
  );
}
