import type { LigneEcriture } from '@comtaple/core';
import { and, asc, eq, isNull, or, schema as s, type Tx } from '@comtaple/db';

/** Lignes normalisées d'un lot comptable, dans l'ordre du fichier d'origine. */
export async function lignesDuLot(tx: Tx, lotImportId: string): Promise<LigneEcriture[]> {
  const brutes = await tx.select().from(s.lignesEcriture).where(eq(s.lignesEcriture.lotImportId, lotImportId)).orderBy(asc(s.lignesEcriture.numeroLigne));
  return brutes.map((l) => ({
    id: l.id,
    numeroLigne: l.numeroLigne,
    journalCode: l.journalCode,
    journalLib: l.journalLib,
    ecritureNum: l.ecritureNum,
    ecritureDate: l.ecritureDate,
    compteNum: l.compteNum,
    compteLib: l.compteLib,
    compAuxNum: l.compAuxNum,
    compAuxLib: l.compAuxLib,
    pieceRef: l.pieceRef,
    pieceDate: l.pieceDate,
    ecritureLib: l.ecritureLib,
    debit: l.debit,
    credit: l.credit,
    ecritureLet: l.ecritureLet,
    dateLet: l.dateLet,
    validDate: l.validDate,
    montantDevise: l.montantDevise,
    idevise: l.idevise,
  }));
}

export interface OrigineParametres {
  regleId: string;
  version: number;
  portee: 'cabinet' | 'dossier';
}

/**
 * Paramètres de contrôles APPROUVÉS applicables à un dossier : la préférence du cabinet, surchargée par l'exception
 * propre au dossier. Seules les règles au statut « approuvee » comptent : une proposition n'a aucun effet.
 */
export async function parametresApprouves(tx: Tx, entiteId: string): Promise<{ parametres: Record<string, Record<string, unknown>>; origines: Record<string, OrigineParametres> }> {
  const regles = await tx
    .select()
    .from(s.reglesCabinet)
    .where(and(eq(s.reglesCabinet.statut, 'approuvee'), or(isNull(s.reglesCabinet.entiteId), eq(s.reglesCabinet.entiteId, entiteId))))
    .orderBy(asc(s.reglesCabinet.creeLe));
  const parametres: Record<string, Record<string, unknown>> = {};
  const origines: Record<string, OrigineParametres> = {};
  // D'abord les règles de cabinet, puis celles du dossier, qui l'emportent.
  for (const portee of ['cabinet', 'dossier'] as const) {
    for (const r of regles.filter((x) => (portee === 'cabinet' ? x.entiteId === null : x.entiteId !== null))) {
      parametres[r.controleId] = r.parametres as Record<string, unknown>;
      origines[r.controleId] = { regleId: r.id, version: r.version, portee };
    }
  }
  return { parametres, origines };
}
