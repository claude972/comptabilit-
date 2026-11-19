import type { PageTexte } from '@comtaple/core';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface LecturePdf {
  nbPages: number;
  pages: PageTexte[];
  /** XML de facture structurée embarqué (Factur-X / ZUGFeRD), s'il existe. */
  xmlEmbarque: string | null;
}

const NOMS_XML = ['factur-x.xml', 'zugferd-invoice.xml', 'xrechnung.xml', 'zugferd-invoice.xml'];
const PAGES_MAX = 60;

/**
 * Lit la couche texte et les pièces jointes d'un PDF sans rien exécuter (pdf.js 6 n'évalue plus de code),
 * pas de XFA, pas de récupération de ressource externe. Le contenu est traité comme non fiable.
 */
export async function lirePdf(contenu: Buffer): Promise<LecturePdf> {
  const tache = getDocument({
    data: new Uint8Array(contenu),
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  const doc = await tache.promise;
  try {
    const pages: PageTexte[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, PAGES_MAX); n++) {
      const page = await doc.getPage(n);
      const contenuTexte = await page.getTextContent();
      // Regroupe les fragments par ligne (ordonnée arrondie), de haut en bas puis de gauche à droite.
      const parLigne = new Map<number, Array<{ x: number; t: string }>>();
      for (const item of contenuTexte.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const y = Math.round((item.transform[5] as number) / 3);
        const l = parLigne.get(y) ?? [];
        l.push({ x: item.transform[4] as number, t: item.str });
        parLigne.set(y, l);
      }
      const lignes = [...parLigne.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, fragments]) => ({ texte: fragments.sort((a, b) => a.x - b.x).map((f) => f.t).join(' ').replace(/\s+/g, ' ').trim() }));
      pages.push({ page: n, texte: lignes.map((l) => l.texte).join('\n'), lignes });
      page.cleanup();
    }
    let xmlEmbarque: string | null = null;
    const jointes = (await doc.getAttachments().catch(() => null)) as Record<string, { filename: string; content: Uint8Array }> | null;
    if (jointes) {
      for (const j of Object.values(jointes)) {
        if (NOMS_XML.includes(j.filename.toLowerCase()) && j.content.length < 5 * 1024 * 1024) {
          xmlEmbarque = Buffer.from(j.content).toString('utf8');
          break;
        }
      }
    }
    return { nbPages: doc.numPages, pages, xmlEmbarque };
  } finally {
    await tache.destroy();
  }
}
