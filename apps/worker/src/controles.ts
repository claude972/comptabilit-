import { CATALOGUE_CONTROLES, executerControles, executerControlesFlux, type LigneEcriture, type ResultatControle } from '@comtaple/core';
import { and, desc, eq, journaliser, lt, ne, schema as s, sql } from '@comtaple/db';
import { parametresApprouves, type TacheControles } from '@comtaple/plateforme';
import { lignesDuLot, relevesDuDossier } from './banque.js';
import type { Contexte } from './contexte.js';
import { ErreurLectureSource, preparerSourceDuLot } from './source-lignes.js';

/** Contrôles dont la règle ou le seuil relève de la fiscalité métropolitaine (taux de TVA, tolérance des biens de faible valeur). */
const CONTROLES_FISCAUX_METROPOLE = new Set(['TVA-001', 'TVA-002', 'IMM-002']);

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

    // Règle de volume (D-061 révisée) :
    //  - jusqu'au seuil LIGNES_MAX_PAR_TRAITEMENT : chemin EN MÉMOIRE (référence), inchangé ;
    //  - au-delà : chemin EN FLUX (passages successifs par curseur, mémoire bornée), pour les contrôles dont l'égalité
    //    avec le calcul en mémoire est prouvée ; tout autre contrôle, ou tout contrôle dont l'état dépasserait le budget,
    //    est « non réalisé » avec son motif. Ni plantage du worker, ni résultat partiel présenté comme complet.
    const { source, ordreDetermine } = await preparerSourceDuLot(tx, execution.lotImportId);
    const nbLignes = source.nbLignes;
    const seuil = c.cfg.LIGNES_MAX_PAR_TRAITEMENT;
    const enFlux = nbLignes > seuil;
    const budget = { lignes: c.cfg.LIGNES_MAX_ETAT_FLUX, elements: 10 * c.cfg.LIGNES_MAX_ETAT_FLUX };
    // Exercice précédent : celui qui se termine juste avant, s'il a des données comptables actives (sinon CLO-002 reste non réalisé).
    const [precedentEx] = await tx
      .select()
      .from(s.exercices)
      .where(and(eq(s.exercices.entiteId, execution.entiteId), lt(s.exercices.fin, exercice.debut)))
      .orderBy(desc(s.exercices.fin))
      .limit(1);
    const [lotPrecedent] = precedentEx
      ? await tx
          .select()
          .from(s.lotsImport)
          .where(and(eq(s.lotsImport.exerciceId, precedentEx.id), eq(s.lotsImport.type, 'fec'), eq(s.lotsImport.actif, true)))
      : [];
    const precedent = lotPrecedent ? await preparerSourceDuLot(tx, lotPrecedent.id) : null;
    const releves = await relevesDuDossier(tx, execution.entiteId);

    // Paramètres propres au cabinet ou au dossier : uniquement des règles approuvées par une personne habilitée.
    const regles = await parametresApprouves(tx, execution.entiteId);
    const [entite] = await tx.select().from(s.entites).where(eq(s.entites.id, execution.entiteId));
    const territoire = entite?.territoireFiscal ?? 'a_confirmer';
    const exerciceCtx = { debut: exercice.debut, fin: exercice.fin };
    const relevesCtx = releves.length ? releves : null;
    const flux = (ids?: string[]) =>
      executerControlesFlux(
        { source, exercice: exerciceCtx, exercicePrecedent: precedent && precedent.ordreDetermine ? { source: precedent.source } : null, releves: relevesCtx, budget },
        { parametres: regles.parametres, erreurDeLecture: (e) => e instanceof ErreurLectureSource, ...(ids ? { ids } : {}) },
      );

    let bruts: ResultatControle[];
    if (!enFlux) {
      const lignes = await lignesDuLot(tx, execution.lotImportId);
      // L'exercice précédent n'est chargé en mémoire que si le total reste sous le seuil.
      const precedentEnMemoire = lotPrecedent && precedent && nbLignes + precedent.source.nbLignes <= seuil;
      const exercicePrecedent: { lignes: LigneEcriture[] } | null = precedentEnMemoire ? { lignes: await lignesDuLot(tx, lotPrecedent.id) } : null;
      bruts = executerControles({ lignes, exercice: exerciceCtx, exercicePrecedent, releves: relevesCtx }, { parametres: regles.parametres });
      // Sinon la reprise des à-nouveaux (seul contrôle qui lit l'exercice précédent) se calcule en flux, sur les deux exercices.
      if (lotPrecedent && !precedentEnMemoire && ordreDetermine && precedent?.ordreDetermine) {
        const [clo002] = await flux(['CLO-002']);
        if (clo002) bruts = bruts.map((r) => (r.controleId === 'CLO-002' ? clo002 : r));
      }
    } else if (!ordreDetermine) {
      // Le calcul en flux suppose un ordre du fichier déterminé (numéros de ligne distincts) : sans lui, rien n'est conclu.
      const motif = `Volume non pris en charge : ${nbLignes.toLocaleString('fr-FR')} lignes d’écriture (seuil du traitement en mémoire : ${seuil.toLocaleString('fr-FR')}) et les numéros de ligne du lot ne sont pas distincts, ce qui interdit le traitement en flux. Aucun contrôle n’a été réalisé sur cet exercice ; ce n’est pas une absence d’anomalie.`;
      bruts = CATALOGUE_CONTROLES.map((d) => ({ controleId: d.id, version: d.version, statut: 'non_realise' as const, motif, constats: [], parametresAppliques: {}, mesures: {} }));
    } else {
      bruts = await flux();
    }
    const resultats: ResultatControle[] = bruts.map((r) => {
      // Les règles fiscales implémentées sont celles de la France métropolitaine : hors de ce territoire (ou tant qu'il
      // n'est pas confirmé), le contrôle n'est PAS réalisé et le dit, au lieu d'appliquer une règle inadaptée.
      if (territoire === 'metropole' || !CONTROLES_FISCAUX_METROPOLE.has(r.controleId)) return r;
      return {
        ...r,
        statut: 'non_realise' as const,
        motif:
          territoire === 'a_confirmer'
            ? 'Territoire fiscal du dossier à confirmer : les règles fiscales métropolitaines ne sont pas appliquées par défaut.'
            : `Territoire fiscal « ${territoire} » : seules les règles fiscales de France métropolitaine sont implémentées.`,
        constats: [],
      };
    });

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
          source: def ? { ...def.source, titre: def.titre, cycle: def.cycle, regleCabinet: regles.origines[r.controleId] ?? null } : {},
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
        lignes: nbLignes,
        chemin: enFlux ? 'flux' : 'memoire',
        constats: nbConstats,
        statuts: Object.fromEntries(resultats.map((r) => [`${r.controleId}@${r.version}`, r.statut])),
      },
    });
  });
}
