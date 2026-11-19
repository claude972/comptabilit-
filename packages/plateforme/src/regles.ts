import { correspondancePour, dec, identifierOperations, type LigneEcriture, type MouvementBancaire, type OperationIdentifiable, type ProfilDossier, projeterBilan, type RapportReleve, versChaine } from '@comtaple/core';
import { and, asc, eq, isNull, or, schema as s, sql, type Tx } from '@comtaple/db';

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

/**
 * Taille et opérations d'un dossier pour la veille (critères de taille et d'opérations d'une évolution).
 * Tirées du DERNIER exercice qui a un lot comptable actif, par agrégation en base (aucune ligne chargée en mémoire) :
 *  - chiffre d'affaires : crédits − débits des comptes 70 (ventes nettes des rabais, remises et ristournes accordés) ;
 *  - total du bilan : total de l'actif du projet de bilan, seulement s'il est équilibré et complet ; sinon inconnu ;
 *  - opérations : repérées aux racines des comptes mouvementés.
 * Tout ce qui n'est pas calculable vaut null : l'applicabilité est alors « à confirmer ».
 */
export async function tailleEtOperationsDuDossier(tx: Tx, entiteId: string, effectifMoyen: number | null): Promise<{ taille: NonNullable<ProfilDossier['taille']>; operations: OperationIdentifiable[] | null }> {
  const r = await tx.execute(sql`
    select l.id as lot, e.debut::text as debut, e.fin::text as fin
      from lots_import l join exercices e on e.id = l.exercice_id
     where l.entite_id = ${entiteId}::uuid and l.type = 'fec' and l.actif
     order by e.fin desc limit 1`);
  const dernier = r.rows[0] as { lot: string; debut: string; fin: string } | undefined;
  if (!dernier) return { taille: { chiffreAffaires: null, totalBilan: null, effectif: effectifMoyen, exercice: null }, operations: null };
  const comptes = (
    await tx.execute(sql`
      select compte_num as "compteNum", min(compte_lib) as "compteLib", sum(debit)::text as debit, sum(credit)::text as credit, count(*)::int as n
        from lignes_ecriture where lot_import_id = ${dernier.lot}::uuid group by compte_num order by compte_num`)
  ).rows as Array<{ compteNum: string; compteLib: string; debit: string; credit: string; n: number }>;
  let totalDebit = dec('0');
  let totalCredit = dec('0');
  let ca = dec('0');
  const lignes = comptes.map((c) => {
    const d = dec(c.debit);
    const cr = dec(c.credit);
    totalDebit = totalDebit.plus(d);
    totalCredit = totalCredit.plus(cr);
    if (c.compteNum.startsWith('70')) ca = ca.plus(cr).minus(d);
    const solde = d.minus(cr);
    return { compteNum: c.compteNum, compteLib: c.compteLib, totalDebit: versChaine(d), totalCredit: versChaine(cr), soldeDebiteur: versChaine(solde.isPositive() ? solde : dec('0')), soldeCrediteur: versChaine(solde.isNegative() ? solde.negated() : dec('0')), nbLignes: c.n };
  });
  const balance = { lignes, totalDebit: versChaine(totalDebit), totalCredit: versChaine(totalCredit), equilibree: totalDebit.equals(totalCredit), ecart: versChaine(totalDebit.minus(totalCredit)) };
  const correspondance = correspondancePour(dernier.debut);
  let totalBilan: string | null = null;
  if (correspondance && balance.equilibree) {
    const bilan = projeterBilan(balance, correspondance);
    const egal = bilan.controles.find((c) => c.code === 'total_actif_egal_total_passif');
    if (bilan.complet && egal?.statut === 'ok') totalBilan = bilan.totaux['total_actif'] ?? null;
  }
  return {
    taille: { chiffreAffaires: lignes.some((l) => l.compteNum.startsWith('70')) ? versChaine(ca) : lignes.length ? '0.00' : null, totalBilan, effectif: effectifMoyen, exercice: { debut: dernier.debut, fin: dernier.fin } },
    operations: identifierOperations(lignes.filter((l) => l.totalDebit !== '0.00' || l.totalCredit !== '0.00').map((l) => l.compteNum)),
  };
}
