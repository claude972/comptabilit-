import { type ChaineDecimale, schemaChaineDecimale, TOLERANCE_MONTANT_MAX } from '@comtaple/core';
import { and, desc, eq, isNull, schema as s, type Tx } from '@comtaple/db';

/** Origine de la tolérance en vigueur : réglage du dossier, du cabinet, ou valeur par défaut (aucune tolérance). */
export type OrigineTolerance = 'dossier' | 'cabinet' | 'defaut';

export interface ToleranceEnVigueur {
  montant: ChaineDecimale;
  origine: OrigineTolerance;
  /** Réglage retenu (null pour la valeur par défaut) : sa date, son auteur et son motif restent consultables. */
  reglage: { id: string; creeLe: string; reglePar: string; motif: string } | null;
}

/** Valeur par défaut : AUCUNE tolérance. Elle n'est jamais appliquée sans réglage explicite d'une personne habilitée. */
export const TOLERANCE_PAR_DEFAUT: ChaineDecimale = '0.00';

export { TOLERANCE_MONTANT_MAX };
export const schemaTolerance = schemaChaineDecimale;

/** Tolérance en vigueur pour un dossier : la ligne la plus récente du dossier, sinon celle du cabinet, sinon 0.00. */
export async function toleranceEnVigueur(tx: Tx, cabinetId: string, dossierId: string): Promise<ToleranceEnVigueur> {
  const [d] = await tx
    .select()
    .from(s.reglagesTiersFactures)
    .where(and(eq(s.reglagesTiersFactures.cabinetId, cabinetId), eq(s.reglagesTiersFactures.dossierId, dossierId)))
    .orderBy(desc(s.reglagesTiersFactures.creeLe), desc(s.reglagesTiersFactures.id))
    .limit(1);
  if (d) return { montant: d.toleranceMontant, origine: 'dossier', reglage: { id: d.id, creeLe: d.creeLe, reglePar: d.reglePar, motif: d.motif } };
  const [c] = await tx
    .select()
    .from(s.reglagesTiersFactures)
    .where(and(eq(s.reglagesTiersFactures.cabinetId, cabinetId), isNull(s.reglagesTiersFactures.dossierId)))
    .orderBy(desc(s.reglagesTiersFactures.creeLe), desc(s.reglagesTiersFactures.id))
    .limit(1);
  if (c) return { montant: c.toleranceMontant, origine: 'cabinet', reglage: { id: c.id, creeLe: c.creeLe, reglePar: c.reglePar, motif: c.motif } };
  return { montant: TOLERANCE_PAR_DEFAUT, origine: 'defaut', reglage: null };
}
