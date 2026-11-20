import { and, asc, eq, gt, inArray, isNull, journaliser, notifier, or, schema as s, sql } from '@comtaple/db';
import { cles, type TacheRestitution } from '@comtaple/plateforme';
import { COLONNES_ECRITURES, MOTIF_ORIGINAL_NON_CONFORME, ajouterOriginalVerifie, csv, objetJson, ouvrirArchive, tableauJson } from './archive.js';
import type { Contexte } from './contexte.js';

const LISEZMOI = `RESTITUTION D'UN DOSSIER — Comtaple
====================================

Cette archive contient les données du dossier telles qu'elles existaient à la date de génération.

  manifeste.json        Liste de tous les fichiers de l'archive avec leur taille et leur empreinte SHA-256.
  donnees/              Données structurées (JSON, UTF-8) et écritures normalisées (CSV, séparateur « ; », UTF-8).
  originaux/            Fichiers reçus, non modifiés, nommés par leur empreinte SHA-256 suivie du nom d'origine.

Montants : chaînes décimales (point décimal), jamais des nombres flottants.
Les productions du logiciel (extractions, constats, rapprochements) sont des PROJETS sauf mention d'une
validation, avec son auteur et sa date.

Non inclus : les sauvegardes, les journaux techniques, les jetons de connexion, et les originaux
écartés par l'antivirus (listés dans le manifeste, rubrique « originauxExclus »).
`;

/** Nom de fichier sûr dans l'archive : aucun séparateur de chemin, aucun caractère de contrôle (noms d'origine non fiables). */
const nomSur = (n: string) => n.normalize('NFC').replace(/[\\/\u0000-\u001f\u007f:*?"<>|]/g, '_').replace(/\.{2,}/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'fichier';
const TRANCHE = 1000;

/**
 * Restitution complète d'un dossier : originaux, données, liens, constats, décisions et règles applicables.
 * L'archive est construite EN FLUX : chaque table est lue par tranches et écrite au fil de l'eau, chaque original est
 * relu du stockage sans être chargé en mémoire, et l'archive part dans le stockage pendant sa construction. Son
 * empreinte est enregistrée. Aucune donnée d'un autre dossier n'y entre.
 */
export async function genererRestitution(c: Contexte, t: TacheRestitution): Promise<void> {
  const ctx = { cabinetId: t.cabinetId };
  const debut = await c.bd.avecContexte(ctx, async (tx) => {
    const [r] = await tx.select().from(s.restitutions).where(eq(s.restitutions.id, t.restitutionId));
    if (!r || r.statut === 'termine') return null;
    await tx.update(s.restitutions).set({ statut: 'en_cours' }).where(eq(s.restitutions.id, r.id));
    return r;
  });
  if (!debut) return;
  const e = debut.entiteId;
  const cle = cles.restitution(t.cabinetId, debut.id);
  const archive = ouvrirArchive(c, cle);

  try {
    const [entite] = await c.bd.avecContexte(ctx, (tx) => tx.select().from(s.entites).where(eq(s.entites.id, e)));
    if (!entite) throw new Error('Dossier introuvable');
    const decomptes: Record<string, number> = {};
    /** Lit une table du dossier par tranches, dans l'ordre de ses identifiants ; compte les lignes au passage. */
    const lire = <T extends { id: unknown; entiteId?: unknown }>(nom: string, table: T, condition?: unknown, transformer: (ligne: Record<string, unknown>) => unknown = (l) => l) =>
      (async function* () {
        const tb = table as unknown as Record<string, never>;
        let dernier: string | number | undefined;
        decomptes[nom] ??= 0;
        for (;;) {
          const tranche = (await c.bd.avecContexte(ctx, (tx) =>
            tx
              .select()
              .from(table as never)
              .where(and((condition as never) ?? eq(tb.entiteId as never, e), dernier === undefined ? undefined : gt(tb.id as never, dernier as never)))
              .orderBy(asc(tb.id as never))
              .limit(TRANCHE),
          )) as Array<Record<string, unknown>>;
          if (!tranche.length) return;
          dernier = tranche[tranche.length - 1]!.id as string | number;
          decomptes[nom]! += tranche.length;
          yield tranche.map(transformer);
          if (tranche.length < TRANCHE) return;
        }
      })();
    const sansBrut = ({ brut: _b, ...reste }: Record<string, unknown>) => reste;

    await archive.ajouterTexte('LISEZMOI.txt', LISEZMOI);
    const [exercices, personnes] = await c.bd.avecContexte(ctx, async (tx) => [
      await tx.select().from(s.exercices).where(eq(s.exercices.entiteId, e)).orderBy(asc(s.exercices.debut)),
      (await tx.execute(sql`select u.id, u.nom from utilisateurs u where exists (select 1 from appartenances a where a.utilisateur_id = u.id and a.cabinet_id = ${t.cabinetId}::uuid)`)).rows,
    ] as const);
    await archive.ajouterTexte('donnees/dossier.json', JSON.stringify({ dossier: entite, exercices, personnes }, null, 2));

    // Pièces : par tranches de documents, chacune enrichie de ses réceptions, extractions et échanges.
    const pieces = (async function* () {
      for await (const documents of lire('pieces', s.documents)) {
        const docs = documents as Array<Record<string, unknown> & { id: string; fichierId: string }>;
        const ids = docs.map((d) => d.id);
        const lies = await c.bd.avecContexte(ctx, async (tx) => ({
          fichiers: await tx.select({ id: s.fichiers.id, sha256: s.fichiers.sha256 }).from(s.fichiers).where(inArray(s.fichiers.id, [...new Set(docs.map((d) => d.fichierId))])),
          receptions: await tx.select().from(s.receptions).where(inArray(s.receptions.documentId, ids)),
          extractions: await tx.select().from(s.extractions).where(inArray(s.extractions.documentId, ids)).orderBy(asc(s.extractions.version)),
          echanges: await tx.select().from(s.echangesDocument).where(inArray(s.echangesDocument.documentId, ids)),
        }));
        const sha = new Map(lies.fichiers.map((f) => [f.id, f.sha256]));
        yield docs.map((doc) => ({
          ...doc,
          sha256: sha.get(doc.fichierId) ?? null,
          receptions: lies.receptions.filter((r) => r.documentId === doc.id),
          extractions: lies.extractions.filter((x) => x.documentId === doc.id),
          echanges: lies.echanges.filter((x) => x.documentId === doc.id),
        }));
      }
    })();
    await archive.ajouterFragments('donnees/pieces.json', objetJson({ documents: tableauJson(pieces) }));

    const lots = await c.bd.avecContexte(ctx, (tx) =>
      tx.select({ lot: s.lotsImport, sha256: s.fichiers.sha256 }).from(s.lotsImport).leftJoin(s.fichiers, eq(s.fichiers.id, s.lotsImport.fichierId)).where(eq(s.lotsImport.entiteId, e)).orderBy(asc(s.lotsImport.creeLe)),
    );
    await archive.ajouterTexte('donnees/imports.json', JSON.stringify(lots.map(({ lot, sha256 }) => ({ ...lot, sha256: sha256 ?? null })), null, 2));
    await archive.ajouterFragments('donnees/revision.json', objetJson({
      executions: tableauJson(lire('executions', s.executionsControles)),
      resultats: tableauJson(lire('resultats', s.resultatsControles)),
      constats: tableauJson(lire('constats', s.constats)),
    }));
    await archive.ajouterFragments('donnees/decisions.json', tableauJson(lire('decisions', s.decisions)));
    await archive.ajouterFragments('donnees/reanalyses-destinataire.json', objetJson({
      demandes: tableauJson(lire('reanalysesDestinataire', s.reanalysesDestinataire)),
      pieces: tableauJson(lire('reanalysesDestinatairePieces', s.reanalysesDestinatairePieces)),
    }));
    await archive.ajouterFragments('donnees/banque.json', objetJson({
      releves: tableauJson(lire('releves', s.relevesBancaires, undefined, sansBrut)),
      mouvements: tableauJson(lire('mouvementsBancaires', s.mouvementsBancaires, undefined, sansBrut)),
    }));
    await archive.ajouterFragments('donnees/rapprochements.json', objetJson({
      executions: tableauJson(lire('executionsRapprochement', s.executionsRapprochement)),
      rapprochements: tableauJson(lire('rapprochements', s.rapprochements)),
    }));
    await archive.ajouterFragments('donnees/regles-cabinet.json', tableauJson(lire('reglesCabinet', s.reglesCabinet, or(isNull(s.reglesCabinet.entiteId), eq(s.reglesCabinet.entiteId, e)))));
    await archive.ajouterFragments('donnees/journal-audit.json', tableauJson(lire('evenementsAudit', s.journalAudit, eq(s.journalAudit.entiteId, e))));

    // Écritures normalisées : un CSV par lot comptable, lu par tranches sur le numéro de ligne.
    let nbLignes = 0;
    for (const { lot } of lots.filter((l) => l.lot.type === 'fec')) {
      const tranches = (async function* () {
        let dernier = 0;
        for (;;) {
          const tranche = await c.bd.avecContexte(ctx, (tx) =>
            tx.select().from(s.lignesEcriture).where(and(eq(s.lignesEcriture.lotImportId, lot.id), gt(s.lignesEcriture.numeroLigne, dernier))).orderBy(asc(s.lignesEcriture.numeroLigne)).limit(5000),
          );
          if (!tranche.length) return;
          dernier = tranche[tranche.length - 1]!.numeroLigne;
          nbLignes += tranche.length;
          yield tranche.map((l) => COLONNES_ECRITURES.map((k) => csv(l[k])).join(';')).join('\n') + '\n';
        }
      })();
      const premiere = await tranches.next();
      if (premiere.done) continue;
      await archive.ajouterFragments(`donnees/ecritures/lot-v${lot.version}-${lot.id}.csv`, (async function* () {
        yield `${COLONNES_ECRITURES.join(';')}\n`;
        yield premiere.value;
        yield* tranches;
      })());
    }

    // Originaux : chaque fichier est d'abord relu en flux pour vérifier son empreinte, puis recopié en flux dans l'archive.
    // Un original écarté par l'antivirus, ou dont le contenu ne correspond plus à son empreinte, n'est pas restitué.
    const exclus: Array<{ sha256: string; motif: string }> = [];
    let nbOriginaux = 0;
    let dernierFichier: string | undefined;
    for (;;) {
      const tranche = (
        await c.bd.avecContexte(ctx, (tx) =>
          tx.execute(sql`
            select f.id, f.sha256, f.cle_stockage as "cleStockage", f.analyse_antivirus as "analyseAntivirus",
                   (select d.nom_origine from documents d where d.fichier_id = f.id and d.entite_id = ${e}::uuid order by d.cree_le limit 1) as "nomPiece",
                   (select coalesce(l.rapport->>'nomFichier', 'import') from lots_import l where l.fichier_id = f.id and l.entite_id = ${e}::uuid order by l.cree_le limit 1) as "nomImport"
              from fichiers f
             where f.cabinet_id = ${t.cabinetId}::uuid ${dernierFichier === undefined ? sql`` : sql`and f.id > ${dernierFichier}::uuid`}
               and f.id in (select d.fichier_id from documents d where d.entite_id = ${e}::uuid
                            union select l.fichier_id from lots_import l where l.entite_id = ${e}::uuid and l.fichier_id is not null)
             order by f.id limit 200`),
        )
      ).rows as Array<{ id: string; sha256: string; cleStockage: string; analyseAntivirus: string; nomPiece: string | null; nomImport: string | null }>;
      if (!tranche.length) break;
      dernierFichier = tranche[tranche.length - 1]!.id;
      for (const f of tranche) {
        if (f.analyseAntivirus === 'infecte') {
          exclus.push({ sha256: f.sha256, motif: 'écarté par l’antivirus' });
          continue;
        }
        const r = await ajouterOriginalVerifie(c, archive, `originaux/${f.sha256}-${nomSur(f.nomImport ?? f.nomPiece ?? 'fichier')}`, f.cleStockage, f.sha256);
        if (!r.restitue) {
          exclus.push({ sha256: f.sha256, motif: MOTIF_ORIGINAL_NON_CONFORME });
          continue;
        }
        nbOriginaux++;
      }
      if (tranche.length < 200) break;
    }

    const resume = {
      genereLe: new Date().toISOString(),
      dossier: entite.raisonSociale,
      pieces: decomptes.pieces ?? 0,
      originaux: nbOriginaux,
      originauxExclus: exclus,
      lotsImport: lots.length,
      lignesEcriture: nbLignes,
      constats: decomptes.constats ?? 0,
      decisions: decomptes.decisions ?? 0,
      mouvementsBancaires: decomptes.mouvementsBancaires ?? 0,
      rapprochements: decomptes.rapprochements ?? 0,
      reglesCabinet: decomptes.reglesCabinet ?? 0,
      evenementsAudit: decomptes.evenementsAudit ?? 0,
    };
    const { sha256, taille, memoire } = await archive.terminer({ format: 'comtaple.restitution/1', ...resume });
    Object.assign(resume, { memoireGeneration: memoire });

    await c.bd.avecContexte(ctx, async (tx) => {
      await tx.update(s.restitutions).set({ statut: 'termine', cleArchive: cle, sha256, taille, resume, termineLe: sql`now()` }).where(eq(s.restitutions.id, debut.id));
      await journaliser(tx, { cabinetId: t.cabinetId, acteurType: 'systeme', action: 'restitution.generee', cibleType: 'restitution', cibleId: debut.id, entiteId: e, details: { taille, originaux: nbOriginaux, exclus: exclus.length } });
      await notifier(tx, [debut.demandePar], { type: 'restitution.prete', entiteId: e, cibleType: 'restitution', cibleId: debut.id });
    });
  } catch (err) {
    archive.abandonner(err);
    await c.bd.avecContexte(ctx, async (tx) => {
      await tx.update(s.restitutions).set({ statut: 'echec', erreur: err instanceof Error ? err.message.slice(0, 500) : 'erreur' }).where(eq(s.restitutions.id, debut.id));
      await notifier(tx, [debut.demandePar], { type: 'restitution.echec', entiteId: e, cibleType: 'restitution', cibleId: debut.id });
    });
    throw err;
  }
}
