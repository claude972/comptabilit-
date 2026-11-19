import type { LigneEcriture, MouvementBancaire, RapportReleve } from '@comtaple/core';
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

/**
 * Relevés bancaires ACTIFS d'un dossier, dans la forme attendue par les contrôles (contexte `releves`). Commun au worker
 * (exécution des contrôles) et à l'API (mesure d'impact d'une règle, état de la correspondance des comptes de banque).
 */
export async function relevesDuDossier(tx: Tx, entiteId: string): Promise<RapportReleve[]> {
  // Seuls les relevés des lots ACTIFS comptent (un relevé annulé est conservé mais écarté).
  const releves = await tx
    .select({ r: s.relevesBancaires })
    .from(s.relevesBancaires)
    .innerJoin(s.lotsImport, and(eq(s.lotsImport.id, s.relevesBancaires.lotImportId), eq(s.lotsImport.actif, true)))
    .where(eq(s.relevesBancaires.entiteId, entiteId))
    .orderBy(asc(s.relevesBancaires.dateCloture))
    .then((lignes) => lignes.map((l) => l.r));
  if (releves.length === 0) return [];
  // Chaque mouvement est restitué dans le relevé de chaque lot actif qui le contient.
  const liens = await tx.select().from(s.mouvementsLots).where(eq(s.mouvementsLots.entiteId, entiteId));
  const lotsDe = new Map<string, string[]>();
  for (const l of liens) lotsDe.set(l.mouvementId, [...(lotsDe.get(l.mouvementId) ?? []), l.lotImportId]);
  const mouvements = await tx.select().from(s.mouvementsBancaires).where(eq(s.mouvementsBancaires.entiteId, entiteId)).orderBy(asc(s.mouvementsBancaires.dateOperation), asc(s.mouvementsBancaires.rang));
  const parLot = new Map<string, RapportReleve>();
  for (const r of releves) {
    const rapport = parLot.get(r.lotImportId) ?? { format: r.format as RapportReleve['format'], version: null, comptes: [], mouvements: [], anomalies: [], lisible: true, source: { type: 'interne', reference: 'Relevé importé', url: null, dateVerification: null, verification: 'sans_objet', periodeApplication: null } };
    rapport.comptes.push(r.brut as RapportReleve['comptes'][number]);
    parLot.set(r.lotImportId, rapport);
  }
  for (const m of mouvements) {
    for (const lotId of lotsDe.get(m.id) ?? []) if (parLot.has(lotId)) parLot.get(lotId)!.mouvements.push(m.brut as MouvementBancaire);
  }
  return [...parLot.values()];
}
