import type { PageTexte } from '@comtaple/core';

export interface ResultatOcr {
  disponible: boolean;
  motif?: string;
  moteur?: string;
  pages: PageTexte[];
  pagesIgnorees?: number;
}

/**
 * Appelle le service OCR local (PaddleOCR conteneurisé). En cas d'indisponibilité, renvoie `disponible: false` :
 * la collecte n'est pas bloquée, la pièce part en saisie manuelle.
 */
export async function ocr(contenu: Buffer, typeMime: string, url: string): Promise<ResultatOcr> {
  try {
    const r = await fetch(`${url}/ocr`, {
      method: 'POST',
      headers: { 'content-type': typeMime },
      body: new Uint8Array(contenu),
      signal: AbortSignal.timeout(180_000),
    });
    if (!r.ok) return { disponible: false, motif: `service OCR : HTTP ${r.status}`, pages: [] };
    const d = (await r.json()) as {
      moteur: string;
      version_moteur: string;
      pages_ignorees?: number;
      pages: Array<{ page: number; texte: string; lignes: Array<{ texte: string; boite: [number, number, number, number] }> }>;
    };
    return {
      disponible: true,
      moteur: `${d.moteur} ${d.version_moteur}`,
      pagesIgnorees: d.pages_ignorees ?? 0,
      pages: d.pages.map((p) => ({ page: p.page, texte: p.texte, lignes: p.lignes.map((l) => ({ texte: l.texte, boite: l.boite })) })),
    };
  } catch (e) {
    return { disponible: false, motif: e instanceof Error ? e.message : 'erreur inconnue', pages: [] };
  }
}
