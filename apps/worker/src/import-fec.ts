import { analyserFec, type LigneFec } from '@comtaple/core';
import { and, eq, inArray, journaliser, ne, schema as s, sql } from '@comtaple/db';
import type { TacheImportFec } from '@comtaple/plateforme';
import type { Contexte } from './contexte.js';

const TAILLE_LOT = 1000;

/** Levée quand l'utilisateur a annulé l'import pendant son exécution. */
class ImportAnnule extends Error {}

/**
 * Import d'un FEC ou d'une extraction de travail : lecture en flux, normalisation, rapport ligne par ligne.
 * Idempotent : relancer la tâche remplace les lignes de CE lot sans jamais dupliquer.
 * L'original reste intact dans le stockage ; seules les lignes normalisées sont en base.
 */
export async function importerFec(c: Contexte, t: TacheImportFec): Promise<void> {
  const ctx = { cabinetId: t.cabinetId };
  const init = await c.bd.avecContexte(ctx, async (tx) => {
    const [lot] = await tx.select().from(s.lotsImport).where(eq(s.lotsImport.id, t.lotImportId));
    if (!lot || !lot.fichierId || !lot.exerciceId) return null;
    if (lot.statut === 'annule' || lot.statut === 'termine' || lot.statut === 'termine_avec_erreurs') return null;
    const [fichier] = await tx.select().from(s.fichiers).where(eq(s.fichiers.id, lot.fichierId));
    const [exercice] = await tx.select().from(s.exercices).where(eq(s.exercices.id, lot.exerciceId));
    if (!fichier || !exercice) return null;
    // Prise en charge ATOMIQUE : si une autre tâche traite déjà ce lot (tâche en double après un rattrapage), on s'efface.
    const [pris] = await tx.update(s.lotsImport).set({ statut: 'en_cours', progression: 0 }).where(and(eq(s.lotsImport.id, lot.id), inArray(s.lotsImport.statut, ['en_attente', 'echec']))).returning({ id: s.lotsImport.id });
    if (!pris) return null;
    return { lot, fichier, exercice };
  });
  if (!init) return;
  const { lot, fichier, exercice } = init;
  const nomFichier = (lot.rapport as { nomFichier?: string } | null)?.nomFichier;

  try {
    const flux = await c.stockage.lireFlux(fichier.cleStockage);
    const { rapport, executionId } = await c.bd.avecContexte(ctx, async (tx) => {
      await tx.delete(s.lignesEcriture).where(eq(s.lignesEcriture.lotImportId, lot.id));
      let tampon: LigneFec[] = [];
      let total = 0;
      const vider = async () => {
        if (!tampon.length) return;
        await tx.insert(s.lignesEcriture).values(
          tampon.map((l) => ({
            cabinetId: t.cabinetId,
            entiteId: lot.entiteId,
            exerciceId: exercice.id,
            lotImportId: lot.id,
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
          })),
        );
        total += tampon.length;
        tampon = [];
        if (total % 10_000 === 0) {
          // Progression visible hors transaction (connexion distincte, même contexte cabinet).
          // Progression visible hors transaction, et prise en compte d'une ANNULATION demandée pendant l'import :
          // la transaction en cours est alors abandonnée, aucune ligne n'est conservée, les données actives restent intactes.
          const etat = await c.bd.avecContexte(ctx, async (tx2) => {
            const [maj] = await tx2.update(s.lotsImport).set({ progression: total }).where(and(eq(s.lotsImport.id, lot.id), ne(s.lotsImport.statut, 'annule'))).returning({ id: s.lotsImport.id });
            return maj ? 'en_cours' : 'annule';
          });
          if (etat === 'annule') throw new ImportAnnule();
        }
      };
      const rapport = await analyserFec(flux as AsyncIterable<Uint8Array>, {
        exerciceDebut: exercice.debut,
        exerciceFin: exercice.fin,
        ...(nomFichier ? { nomFichier } : {}),
        surLigne: async (ligne) => {
          tampon.push(ligne);
          if (tampon.length >= TAILLE_LOT) await vider();
        },
      });
      await vider();

      let executionId: string | null = null;
      if (!rapport.lisible || total === 0) {
        await tx.delete(s.lignesEcriture).where(eq(s.lignesEcriture.lotImportId, lot.id));
        await tx
          .update(s.lotsImport)
          .set({ statut: 'echec', progression: 0, rapport: { ...rapport, nomFichier }, termineLe: sql`now()` })
          .where(eq(s.lotsImport.id, lot.id));
      } else {
        // Nouvelle version des données : l'ancienne est désactivée (conservée), les travaux antérieurs sont à revoir.
        await tx
          .update(s.lotsImport)
          .set({ actif: false })
          .where(and(eq(s.lotsImport.exerciceId, exercice.id), eq(s.lotsImport.type, 'fec'), ne(s.lotsImport.id, lot.id)));
        const [ex] = await tx
          .update(s.exercices)
          .set({ versionDonnees: sql`${s.exercices.versionDonnees} + 1` })
          .where(eq(s.exercices.id, exercice.id))
          .returning();
        await tx.update(s.executionsControles).set({ obsolete: true }).where(eq(s.executionsControles.exerciceId, exercice.id));
        await tx.update(s.executionsRapprochement).set({ obsolete: true }).where(eq(s.executionsRapprochement.exerciceId, exercice.id));
        await tx
          .update(s.constats)
          .set({ aRevoir: true })
          .where(and(eq(s.constats.exerciceId, exercice.id), ne(s.constats.statutRevue, 'a_examiner')));
        await tx
          .update(s.lotsImport)
          .set({
            actif: true,
            remplaceLotId: null,
            statut: rapport.anomalies.length > 0 ? 'termine_avec_erreurs' : 'termine',
            progression: total,
            rapport: { ...rapport, nomFichier },
            termineLe: sql`now()`,
          })
          .where(eq(s.lotsImport.id, lot.id));
        if (rapport.suffisantPourTravaux) {
          const [e] = await tx
            .insert(s.executionsControles)
            .values({ cabinetId: t.cabinetId, entiteId: lot.entiteId, exerciceId: exercice.id, lotImportId: lot.id, versionDonnees: ex!.versionDonnees, lancePar: lot.lancePar })
            .returning();
          executionId = e!.id;
        }
      }
      await journaliser(tx, {
        cabinetId: t.cabinetId,
        acteurType: 'systeme',
        action: 'import.fec.termine',
        cibleType: 'lot_import',
        cibleId: lot.id,
        entiteId: lot.entiteId,
        details: {
          lignes: total,
          lisible: rapport.lisible,
          conforme: rapport.conforme,
          suffisantPourTravaux: rapport.suffisantPourTravaux,
          anomalies: rapport.nbAnomaliesParCode,
        },
      });
      return { rapport, executionId };
    });
    if (executionId) await c.taches.executerControles({ cabinetId: t.cabinetId, executionId });
    void rapport;
  } catch (e) {
    if (e instanceof ImportAnnule) return; // annulation demandée : statut déjà « annule », rien à signaler comme échec
    await c.bd.avecContexte(ctx, (tx) =>
      tx
        .update(s.lotsImport)
        .set({ statut: 'echec', rapport: { nomFichier, erreurTechnique: e instanceof Error ? e.message.slice(0, 500) : 'erreur' }, termineLe: sql`now()` })
        .where(eq(s.lotsImport.id, lot.id)),
    );
    throw e;
  }
}
