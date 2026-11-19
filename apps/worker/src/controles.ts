import { CATALOGUE_CONTROLES, executerControles, type LigneEcriture } from '@comtaple/core';
import { and, asc, desc, eq, journaliser, ne, schema as s, sql } from '@comtaple/db';
import type { TacheControles } from '@comtaple/plateforme';
import type { Contexte } from './contexte.js';

/**
 * Exécute le catalogue de contrôles déterministes sur le lot d'une exécution et enregistre résultats et constats,
 * rattachés à la version exacte des données et des règles. Aucun appel à l'IA.
 */
export async function executerControlesExecution(c: Contexte, t: TacheControles): Promise<void> {
  const ctx = { cabinetId: t.cabinetId };
  await c.bd.avecContexte(ctx, async (tx) => {
    const [execution] = await tx.select().from(s.executionsControles).where(eq(s.executionsControles.id, t.executionId)).for('update');
    if (!execution || execution.statut === 'termine') return;
    const [exercice] = await tx.select().from(s.exercices).where(eq(s.exercices.id, execution.exerciceId));
    if (!exercice) return;
    await tx.delete(s.constats).where(eq(s.constats.executionId, execution.id));
    await tx.delete(s.resultatsControles).where(eq(s.resultatsControles.executionId, execution.id));

    const brutes = await tx
      .select()
      .from(s.lignesEcriture)
      .where(eq(s.lignesEcriture.lotImportId, execution.lotImportId))
      .orderBy(asc(s.lignesEcriture.numeroLigne));
    const lignes: LigneEcriture[] = brutes.map((l) => ({
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

    const resultats = executerControles({ lignes, exercice: { debut: exercice.debut, fin: exercice.fin }, exercicePrecedent: null });

    // Décisions de revue antérieures sur le même exercice : reportées par clé stable, mais marquées « à revoir ».
    const [precedente] = await tx
      .select()
      .from(s.executionsControles)
      .where(and(eq(s.executionsControles.exerciceId, exercice.id), ne(s.executionsControles.id, execution.id), eq(s.executionsControles.statut, 'termine')))
      .orderBy(desc(s.executionsControles.creeLe))
      .limit(1);
    const anciens = new Map<string, typeof s.constats.$inferSelect>();
    if (precedente) {
      for (const a of await tx.select().from(s.constats).where(eq(s.constats.executionId, precedente.id))) anciens.set(`${a.controleId}|${a.cle}`, a);
    }

    let nbConstats = 0;
    for (const r of resultats) {
      const def = CATALOGUE_CONTROLES.find((d) => d.id === r.controleId);
      const [res] = await tx
        .insert(s.resultatsControles)
        .values({
          cabinetId: t.cabinetId,
          entiteId: execution.entiteId,
          executionId: execution.id,
          controleId: r.controleId,
          versionControle: r.version,
          statut: r.statut,
          motif: r.motif,
          parametres: r.parametresAppliques,
          mesures: r.mesures,
          source: def ? { ...def.source, titre: def.titre, cycle: def.cycle } : {},
        })
        .returning();
      for (let i = 0; i < r.constats.length; i += 500) {
        const lot = r.constats.slice(i, i + 500);
        await tx.insert(s.constats).values(
          lot.map((k) => {
            const ancien = anciens.get(`${r.controleId}|${k.cle}`);
            const reporte = ancien && ancien.statutRevue !== 'a_examiner';
            return {
              cabinetId: t.cabinetId,
              entiteId: execution.entiteId,
              exerciceId: exercice.id,
              executionId: execution.id,
              resultatId: res!.id,
              controleId: r.controleId,
              cle: k.cle,
              gravite: k.gravite,
              titre: k.titre,
              explication: k.explication,
              actionProposee: k.actionProposee,
              montant: k.montant,
              lignesConcernees: k.lignesConcernees,
              preuves: k.preuves,
              statutRevue: reporte ? ancien.statutRevue : ('a_examiner' as const),
              affecteA: ancien?.affecteA ?? null,
              aRevoir: Boolean(reporte),
            };
          }),
        );
        nbConstats += lot.length;
      }
    }
    await tx.update(s.executionsControles).set({ statut: 'termine', termineLe: sql`now()` }).where(eq(s.executionsControles.id, execution.id));
    await journaliser(tx, {
      cabinetId: t.cabinetId,
      acteurType: 'systeme',
      action: 'controles.termines',
      cibleType: 'execution_controles',
      cibleId: execution.id,
      entiteId: execution.entiteId,
      details: {
        versionDonnees: execution.versionDonnees,
        lignes: lignes.length,
        constats: nbConstats,
        statuts: Object.fromEntries(resultats.map((r) => [`${r.controleId}@${r.version}`, r.statut])),
      },
    });
  });
}
