import { Readable } from 'node:stream';
import { and, asc, eq, getTableColumns, getTableName, gt, inArray, journaliser, notifier, schema as s, sql } from '@comtaple/db';
import { cles, type TacheRestitutionCabinet } from '@comtaple/plateforme';
import { COLONNES_ECRITURES as COLONNES_CSV, MOTIF_ORIGINAL_NON_CONFORME, ajouterOriginalVerifie, csv, ouvrirArchive } from './archive.js';
import type { Contexte } from './contexte.js';

const LISEZMOI = `RESTITUTION D'UN CABINET — Comtaple
===================================

Cette archive contient les données du cabinet telles qu'elles existaient à la date de génération, pour les
dossiers du PÉRIMÈTRE indiqué dans manifeste.json. Le périmètre a été figé à la demande, d'après les
habilitations de la personne qui a demandé la restitution : un dossier sur lequel elle n'avait pas le niveau
« validation » n'est PAS dans l'archive ; il est listé dans « perimetre.ecartes » avec le motif, et
« complet » vaut alors false.

  manifeste.json     Périmètre, décomptes, et liste de TOUS les fichiers de l'archive (taille, empreinte SHA-256).
  donnees/           Une table par fichier, au format JSON Lines (un enregistrement JSON par ligne, UTF-8).
                     cabinet.json et personnes.json décrivent le cabinet et ses membres.
  ecritures/         Écritures comptables normalisées : un CSV par import (séparateur « ; », UTF-8),
                     rangé par identifiant de dossier.
  originaux/         Fichiers reçus, non modifiés, nommés par leur empreinte SHA-256. Leur nom d'origine et leur
                     dossier figurent dans donnees/documents.jsonl et donnees/lots_import.jsonl (colonne fichierId),
                     à rapprocher de donnees/fichiers.jsonl (colonnes id et sha256).

VÉRIFIER L'ARCHIVE sans le logiciel : pour chaque entrée de « fichiers » du manifeste, calculer le SHA-256 du
fichier extrait (par exemple « shasum -a 256 chemin ») et le comparer à la valeur indiquée ; vérifier qu'aucun
fichier de l'archive n'est absent du manifeste. L'empreinte de l'archive elle-même est affichée dans
l'application, à côté du téléchargement.

Montants : chaînes décimales (point décimal), jamais des nombres flottants.
Les productions du logiciel (extractions, constats, rapprochements, projets d'états) sont des PROJETS sauf
mention d'une validation, avec son auteur et sa date.

Non inclus : les sauvegardes, les journaux techniques, les jetons et secrets de connexion (colonnes listées
dans « colonnesExclues »), les lignes brutes des relevés (présentes dans les originaux), les originaux écartés
par l'antivirus ou dont le contenu ne correspond plus à l'empreinte enregistrée (« originauxExclus »), et tout ce qui concerne un dossier hors périmètre. Le journal d'audit ne
contient que les lignes du cabinet et des dossiers du périmètre : s'il manque des dossiers, la chaîne
d'empreintes du journal ne peut pas être revérifiée à partir de cette seule archive.
`;

/** Colonnes jamais restituées : secrets, jetons, et contenus bruts déjà présents dans les originaux. */
const colonneExclue = (nom: string) => /jeton|chiffre|secret/i.test(nom) || nom === 'brut';
/** Tables traitées à part, ou sans objet dans une restitution. */
/** `restitutions_cabinet` : registre des restitutions elles-mêmes ; le périmètre de celle-ci est déjà au manifeste. */
const TABLES_A_PART = new Set(['lignes_ecriture', 'demandes_connexion_mail', 'restitutions_cabinet']);
const TRANCHE = 2000;


type Colonnes = Record<string, { name: string }>;
/** Tables du schéma portant `cabinet_id`, avec leurs colonnes. */
function tablesDuCabinet(): Array<{ nom: string; table: never; colonnes: Colonnes }> {
  const tables: Array<{ nom: string; table: never; colonnes: Colonnes }> = [];
  for (const valeur of Object.values(s)) {
    let colonnes: Colonnes | undefined;
    try {
      colonnes = getTableColumns(valeur as never) as unknown as Colonnes;
    } catch {
      continue;
    }
    if (!colonnes || typeof colonnes !== 'object' || !colonnes.cabinetId) continue;
    tables.push({ nom: getTableName(valeur as never), table: valeur as never, colonnes });
  }
  return tables.sort((a, b) => a.nom.localeCompare(b.nom));
}

/**
 * Restitution d'un cabinet entier, pour les dossiers du périmètre figé à la demande. Tout est écrit EN FLUX : chaque
 * table est lue par tranches, chaque original est relu du stockage et recopié sans être chargé en mémoire, et l'archive
 * part dans le stockage au fil de sa construction. Aucune donnée d'un dossier hors périmètre, ni d'un autre cabinet.
 */
export async function genererRestitutionCabinet(c: Contexte, t: TacheRestitutionCabinet): Promise<void> {
  const ctx = { cabinetId: t.cabinetId };
  // Prise en charge atomique : une tâche en double s'efface.
  const debut = await c.bd.avecContexte(ctx, async (tx) => {
    const [r] = await tx
      .update(s.restitutionsCabinet)
      .set({ statut: 'en_cours', erreur: null })
      .where(and(eq(s.restitutionsCabinet.id, t.restitutionCabinetId), eq(s.restitutionsCabinet.cabinetId, t.cabinetId), inArray(s.restitutionsCabinet.statut, ['en_attente', 'echec'])))
      .returning();
    return r ?? null;
  });
  if (!debut) return;
  const perimetre = debut.perimetre as { inclus: string[]; ecartes: Array<{ id: string; motif: string }> };
  const inclus = perimetre.inclus.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const tableauInclus = `{${inclus.join(',')}}`;
  const dansPerimetre = (colonne: unknown) => sql`(${colonne} is null or ${colonne} = any(${tableauInclus}::uuid[]))`;

  const cle = cles.restitutionCabinet(t.cabinetId, debut.id);
  const archive = ouvrirArchive(c, cle);
  const { ajouterFlux, ajouterTexte } = archive;

  try {

    await ajouterTexte('LISEZMOI.txt', LISEZMOI);

    // ── Cabinet, personnes, périmètre ──
    const entete = await c.bd.avecContexte(ctx, async (tx) => ({
      cabinet: (await tx.select().from(s.cabinets).where(eq(s.cabinets.id, t.cabinetId)))[0],
      personnes: (await tx.execute(sql`select u.id, u.nom, u.email from utilisateurs u where exists (select 1 from appartenances a where a.utilisateur_id = u.id and a.cabinet_id = ${t.cabinetId}::uuid) order by u.nom`)).rows,
      // Résultat de la vérification STRICTE du journal au moment de la génération (seule référence, D-038).
      journal: (await tx.execute(sql`select journal_audit_verifier(${t.cabinetId}::uuid) as rupture`)).rows[0]?.rupture ?? null,
    }));
    if (!entete.cabinet) throw new Error('Cabinet introuvable');
    await ajouterTexte('donnees/cabinet.json', JSON.stringify({ cabinet: entete.cabinet, perimetre }, null, 2));
    await ajouterTexte('donnees/personnes.json', JSON.stringify(entete.personnes, null, 2));

    // ── Tables : une par fichier, en JSON Lines, lues par tranches ──
    const decomptes: Record<string, number> = {};
    const colonnesExclues: string[] = [];
    for (const { nom, table, colonnes } of tablesDuCabinet()) {
      if (TABLES_A_PART.has(nom)) continue;
      const tb = table as unknown as Record<string, never>;
      const conditions = [eq(tb.cabinetId as never, t.cabinetId)];
      if (nom === 'entites') conditions.push(sql`${tb.id} = any(${tableauInclus}::uuid[])` as never);
      if (colonnes.entiteId) conditions.push(dansPerimetre(tb.entiteId) as never);
      if (colonnes.dossierAffecteId) conditions.push(dansPerimetre(tb.dossierAffecteId) as never);
      if (nom === 'fichiers') {
        // Uniquement les fichiers référencés par une pièce ou un import d'un dossier du périmètre.
        conditions.push(sql`${tb.id} in (
          select d.fichier_id from documents d where d.entite_id = any(${tableauInclus}::uuid[])
          union select l.fichier_id from lots_import l where l.entite_id = any(${tableauInclus}::uuid[]) and l.fichier_id is not null)` as never);
      }
      const gardees = Object.keys(colonnes).filter((k) => !colonneExclue(k));
      for (const k of Object.keys(colonnes)) if (colonneExclue(k)) colonnesExclues.push(`${nom}.${colonnes[k]!.name}`);
      const cleOrdre = colonnes.id ? ['id'] : Object.keys(colonnes).filter((k) => k !== 'cabinetId').slice(0, 3);
      let total = 0;
      const lire = async function* () {
        let dernier: unknown;
        for (let decalage = 0; ; decalage += TRANCHE) {
          const tranche = (await c.bd.avecContexte(ctx, (tx) => {
            const base = tx.select().from(table);
            return colonnes.id
              ? base.where(and(...conditions, dernier === undefined ? undefined : gt(tb.id as never, dernier as never))).orderBy(asc(tb.id as never)).limit(TRANCHE)
              : base.where(and(...conditions)).orderBy(...cleOrdre.map((k) => asc(tb[k] as never))).limit(TRANCHE).offset(decalage);
          })) as Array<Record<string, unknown>>;
          if (!tranche.length) return;
          dernier = tranche[tranche.length - 1]!.id;
          total += tranche.length;
          yield Buffer.from(tranche.map((ligne) => JSON.stringify(Object.fromEntries(gardees.map((k) => [k, ligne[k]])))).join('\n') + '\n', 'utf8');
          if (tranche.length < TRANCHE) return;
        }
      };
      // La première tranche décide de la présence du fichier : une table vide n'en produit pas, mais figure aux décomptes.
      const iterateur = lire();
      const premiere = await iterateur.next();
      if (!premiere.done) {
        await ajouterFlux(`donnees/${nom}.jsonl`, Readable.from((async function* () {
          yield premiere.value;
          yield* iterateur;
        })()));
      }
      decomptes[nom] = total;
    }

    // ── Écritures normalisées : un CSV par import comptable, lu par tranches sur le numéro de ligne ──
    const lots = inclus.length
      ? await c.bd.avecContexte(ctx, (tx) => tx.select({ id: s.lotsImport.id, entiteId: s.lotsImport.entiteId, version: s.lotsImport.version }).from(s.lotsImport).where(and(eq(s.lotsImport.type, 'fec'), sql`${s.lotsImport.entiteId} = any(${tableauInclus}::uuid[])`)).orderBy(asc(s.lotsImport.creeLe)))
      : [];
    let lignesEcriture = 0;
    for (const lot of lots) {
      let nb = 0;
      const lire = async function* () {
        let dernier = 0;
        for (;;) {
          const tranche = await c.bd.avecContexte(ctx, (tx) =>
            tx.select().from(s.lignesEcriture).where(and(eq(s.lignesEcriture.lotImportId, lot.id), gt(s.lignesEcriture.numeroLigne, dernier))).orderBy(asc(s.lignesEcriture.numeroLigne)).limit(5000),
          );
          if (!tranche.length) return;
          dernier = tranche[tranche.length - 1]!.numeroLigne;
          nb += tranche.length;
          yield Buffer.from(tranche.map((l) => COLONNES_CSV.map((k) => csv(l[k])).join(';')).join('\n') + '\n', 'utf8');
        }
      };
      const iterateur = lire();
      const premiere = await iterateur.next();
      if (premiere.done) continue;
      await ajouterFlux(`ecritures/${lot.entiteId}/lot-v${lot.version}-${lot.id}.csv`, Readable.from((async function* () {
        yield Buffer.from(`${COLONNES_CSV.join(';')}\n`, 'utf8');
        yield premiere.value;
        yield* iterateur;
      })()));
      lignesEcriture += nb;
    }

    // ── Originaux : recopiés en flux, une seule fois par empreinte, et comparés à l'empreinte enregistrée ──
    const exclus: Array<{ sha256: string; motif: string }> = [];
    const nonConformes: Array<{ sha256: string }> = [];
    const deja = new Set<string>();
    let originaux = 0;
    let octetsOriginaux = 0;
    let dernierFichier: string | undefined;
    for (;;) {
      const tranche = inclus.length
        ? await c.bd.avecContexte(ctx, (tx) =>
            tx
              .select({ id: s.fichiers.id, sha256: s.fichiers.sha256, cleStockage: s.fichiers.cleStockage, analyseAntivirus: s.fichiers.analyseAntivirus })
              .from(s.fichiers)
              .where(
                and(
                  eq(s.fichiers.cabinetId, t.cabinetId),
                  dernierFichier === undefined ? undefined : gt(s.fichiers.id, dernierFichier),
                  sql`${s.fichiers.id} in (
                    select d.fichier_id from documents d where d.entite_id = any(${tableauInclus}::uuid[])
                    union select l.fichier_id from lots_import l where l.entite_id = any(${tableauInclus}::uuid[]) and l.fichier_id is not null)`,
                ),
              )
              .orderBy(asc(s.fichiers.id))
              .limit(500),
          )
        : [];
      if (!tranche.length) break;
      dernierFichier = tranche[tranche.length - 1]!.id;
      for (const f of tranche) {
        if (deja.has(f.sha256)) continue;
        deja.add(f.sha256);
        if (f.analyseAntivirus === 'infecte') {
          exclus.push({ sha256: f.sha256, motif: 'écarté par l’antivirus' });
          continue;
        }
        // Même règle que la restitution d'un dossier : un original dont le contenu ne correspond plus à son empreinte
        // n'est PAS restitué ; il est listé parmi les exclus, et à part pour être retrouvé facilement.
        const r = await ajouterOriginalVerifie(c, archive, `originaux/${f.sha256}`, f.cleStockage, f.sha256);
        if (!r.restitue) {
          exclus.push({ sha256: f.sha256, motif: MOTIF_ORIGINAL_NON_CONFORME });
          nonConformes.push({ sha256: f.sha256 });
          continue;
        }
        originaux++;
        octetsOriginaux += r.taille;
      }
      if (tranche.length < 500) break;
    }

    const resume = {
      genereLe: new Date().toISOString(),
      cabinet: entete.cabinet.nom,
      complet: perimetre.ecartes.length === 0,
      dossiersInclus: inclus.length,
      dossiersEcartes: perimetre.ecartes.length,
      tables: decomptes,
      lignesEcriture,
      originaux,
      octetsOriginaux,
      originauxExclus: exclus,
      originauxNonConformes: nonConformes,
      journalAudit: {
        verificationStricte: entete.journal === null ? 'intègre' : `rupture à la ligne ${String(entete.journal)}`,
        lignesRestituees: decomptes.journal_audit ?? 0,
        partiel: perimetre.ecartes.length > 0,
      },
    };
    const { sha256, taille: tailleArchive, memoire } = await archive.terminer({ format: 'comtaple.restitution-cabinet/1', ...resume, perimetre, colonnesExclues: [...new Set(colonnesExclues)].sort() });

    await c.bd.avecContexte(ctx, async (tx) => {
      await tx.update(s.restitutionsCabinet).set({ statut: 'termine', cleArchive: cle, sha256, taille: tailleArchive, resume: { ...resume, memoireGeneration: memoire }, termineLe: sql`now()` }).where(eq(s.restitutionsCabinet.id, debut.id));
      await journaliser(tx, {
        cabinetId: t.cabinetId,
        acteurType: 'systeme',
        action: 'restitution_cabinet.generee',
        cibleType: 'restitution_cabinet',
        cibleId: debut.id,
        details: { taille: tailleArchive, dossiersInclus: inclus.length, dossiersEcartes: perimetre.ecartes.length, originaux, exclus: exclus.length, nonConformes: nonConformes.length },
      });
      await notifier(tx, [debut.demandePar], { type: 'restitution_cabinet.prete', cibleType: 'restitution_cabinet', cibleId: debut.id });
    });
  } catch (err) {
    archive.abandonner(err);
    await c.bd.avecContexte(ctx, async (tx) => {
      await tx.update(s.restitutionsCabinet).set({ statut: 'echec', erreur: err instanceof Error ? err.message.slice(0, 500) : 'erreur' }).where(eq(s.restitutionsCabinet.id, debut.id));
      await notifier(tx, [debut.demandePar], { type: 'restitution_cabinet.echec', cibleType: 'restitution_cabinet', cibleId: debut.id });
    });
    throw err;
  }
}
