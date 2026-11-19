/**
 * Décodage d'une pièce : TOUT ce qui interprète des octets ou du texte venant d'un dépôt (PDF, XML de facture, texte
 * reconnu). Ce module ne s'exécute que dans le processus enfant d'analyse (`analyse-enfant.ts`) ; le processus du
 * worker ne l'importe jamais (vérifié par test). Aucun accès réseau, base ou fichier.
 */
import { type ChampsFacture, extraireChampsFacture, extraireChampsFacturX, extraireChampsUbl, type PageTexte } from '@comtaple/core';
import { caracteresUtiles, type ResultatPiece, type ResultatTexte, SEUIL_COUCHE_TEXTE, type TypePieceDecodee } from './analyse-types.js';
import { lirePdf } from './pdf.js';

/**
 * Lit une pièce PDF ou XML : données structurées d'abord (Factur-X embarqué, CII, UBL), sinon couche texte.
 * Un fichier que le lecteur refuse ne lève pas : `lectureImpossible` est posé et l'état partiel déjà lu est rendu
 * (le message de la bibliothèque, technique, ne sort pas d'ici).
 */
export async function analyserPiece(type: TypePieceDecodee, contenu: Buffer): Promise<ResultatPiece> {
  const r: ResultatPiece = { pages: [], nbPages: null, champs: null, methode: 'aucune', moteur: null, lectureImpossible: false };
  try {
    if (type === 'application/xml') {
      const xml = contenu.toString('utf8');
      r.champs = /CrossIndustryInvoice/.test(xml.slice(0, 4000)) ? extraireChampsFacturX(xml) : extraireChampsUbl(xml);
      r.methode = 'structure';
      r.moteur = 'analyse XML (CII/UBL)';
      return r;
    }
    const pdf = await lirePdf(contenu);
    r.nbPages = pdf.nbPages;
    r.pages = pdf.pages;
    if (pdf.xmlEmbarque) {
      r.champs = extraireChampsFacturX(pdf.xmlEmbarque);
      r.methode = 'structure';
      r.moteur = 'Factur-X (XML embarqué)';
    } else if (caracteresUtiles(r.pages) >= SEUIL_COUCHE_TEXTE) {
      r.methode = 'couche_texte';
      r.moteur = 'pdfjs-dist';
    }
    // Sans couche texte suffisante, le parent tentera l'OCR ; s'il est indisponible, ces champs (souvent vides) valent.
    if (!r.champs && r.pages.length > 0) r.champs = extraireChampsFacture(r.pages);
  } catch (e) {
    process.stderr.write(`lecture impossible : ${e instanceof Error ? e.name : 'erreur'}\n`);
    r.lectureImpossible = true;
  }
  return r;
}

/** Extraction déterministe des champs depuis un texte déjà reconnu (sortie du service OCR). */
export function extraireDuTexte(pages: PageTexte[]): ResultatTexte {
  const champs: ChampsFacture | null = pages.length > 0 ? extraireChampsFacture(pages) : null;
  return { champs };
}
