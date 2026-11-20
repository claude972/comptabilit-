/**
 * Réception d'une pièce, commune à tous les canaux (téléphone, ordinateur, mail, affectation manuelle).
 * - l'original est adressé par empreinte SHA-256 (D-010) : une ligne `fichiers` par binaire et par cabinet ;
 * - un binaire déjà présent dans le dossier donne une nouvelle occurrence de réception (doublon binaire),
 *   sans nouveau document : c'est ce qui détecte un doublon ENTRE canaux.
 */
import { and, eq, journaliser, schema as s, sql, type Tx } from '@comtaple/db';

type Fichier = typeof s.fichiers.$inferSelect;

/** Retrouve la ligne `fichiers` de l'original (même empreinte dans le cabinet du contexte) ou la crée. */
export async function assurerFichierOriginal(
  tx: Tx,
  p: { cabinetId: string; sha256: string; taille: number; typeMimeDeclare: string | null; cleStockage: string },
): Promise<Fichier> {
  // Sérialise les clôtures SIMULTANÉES du même contenu dans le même cabinet (verrou tenu jusqu'à la fin de la transaction) :
  // sans lui, deux dépôts identiques en même temps ne voient pas l'un l'autre (lecture avant écriture) et créent chacun un
  // document ou un lot d'import (doublon constaté en essai de charge), ou échouent sur une contrainte d'unicité.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`fichier:${p.cabinetId}:${p.sha256}`}, 0))`);
  const [existant] = await tx
    .select()
    .from(s.fichiers)
    .where(and(eq(s.fichiers.sha256, p.sha256), eq(s.fichiers.nature, 'original')));
  if (existant) return existant;
  const [cree] = await tx
    .insert(s.fichiers)
    .values({ cabinetId: p.cabinetId, sha256: p.sha256, taille: p.taille, typeMimeDeclare: p.typeMimeDeclare, cleStockage: p.cleStockage })
    .returning();
  return cree!;
}

export interface ReceptionPiece {
  cabinetId: string;
  entiteId: string;
  fichier: Pick<Fichier, 'id' | 'sha256' | 'taille'>;
  nomFichier: string;
  nature?: (typeof s.natureDocument.enumValues)[number];
  commentaire?: string | null;
  canal: (typeof s.canalReception.enumValues)[number];
  /** Utilisateur déposant ; `null` pour une réception automatique (mail). */
  deposantId: string | null;
  /** Auteur de l'action au journal d'audit quand il diffère du déposant (affectation d'une pièce reçue par mail). */
  acteurId?: string | null;
  /** Provenance conservée avec l'occurrence de réception (jamais de jeton ni de contenu). */
  provenance: Record<string, unknown>;
}

export interface ResultatReception {
  documentId: string;
  /** Un nouveau document a été créé (à analyser). */
  nouveau: boolean;
  doublonBinaire: boolean;
  statutDocument: (typeof s.statutDocument.enumValues)[number];
}

/** Crée le document `recu` (ou réutilise celui du dossier), l'occurrence de réception et la ligne d'audit. */
export async function enregistrerReception(tx: Tx, p: ReceptionPiece): Promise<ResultatReception> {
  const [dejaLa] = await tx
    .select()
    .from(s.documents)
    .where(and(eq(s.documents.entiteId, p.entiteId), eq(s.documents.fichierId, p.fichier.id)));
  let document = dejaLa;
  if (!document) {
    [document] = await tx
      .insert(s.documents)
      .values({
        cabinetId: p.cabinetId,
        entiteId: p.entiteId,
        fichierId: p.fichier.id,
        nature: p.nature ?? 'a_qualifier',
        statut: 'recu',
        nomOrigine: p.nomFichier,
        commentaire: p.commentaire ?? null,
      })
      .returning();
  }
  await tx.insert(s.receptions).values({
    cabinetId: p.cabinetId,
    entiteId: p.entiteId,
    documentId: document!.id,
    canal: p.canal,
    deposantId: p.deposantId,
    doublonBinaire: Boolean(dejaLa),
    provenance: p.provenance,
  });
  await journaliser(tx, {
    cabinetId: p.cabinetId,
    acteurId: p.acteurId ?? p.deposantId,
    acteurType: (p.acteurId ?? p.deposantId) ? 'utilisateur' : 'systeme',
    action: dejaLa ? 'document.doublon_binaire' : 'document.recu',
    cibleType: 'document',
    cibleId: document!.id,
    entiteId: p.entiteId,
    details: { sha256: p.fichier.sha256, taille: p.fichier.taille, canal: p.canal },
  });
  return { documentId: document!.id, nouveau: !dejaLa, doublonBinaire: Boolean(dejaLa), statutDocument: document!.statut };
}

export interface ResultatRemplacement {
  version: number;
  /** Une validation existait sur l'ancienne version et a été explicitement invalidée. */
  validationInvalidee: boolean;
}

/**
 * Fait de `nouveauId` la version suivante de `ancienId`.
 *  - L'ancienne version et son fichier original sont CONSERVÉS et restent consultables ; elle passe au statut « remplace ».
 *  - Si son extraction avait été validée, cette validation est explicitement invalidée (statut dédié, décision
 *    historisée avec son auteur, ligne d'audit) : une validation porte sur une version déterminée et ne se transmet pas.
 *  - La nouvelle version repart de « reçu » et doit être analysée puis validée à son tour.
 * Distinct d'un doublon binaire (même fichier) et d'une suspicion de double comptabilisation (contrôle GEN-004).
 */
export async function remplacerDocument(tx: Tx, p: { cabinetId: string; ancienId: string; nouveauId: string; acteurId: string }): Promise<ResultatRemplacement> {
  const [ancien] = await tx.select().from(s.documents).where(eq(s.documents.id, p.ancienId)).for('update');
  if (!ancien) throw new Error('Document à remplacer introuvable');
  if (ancien.remplacePar) throw new Error('Ce document a déjà été remplacé');
  const version = ancien.version + 1;
  await tx.update(s.documents).set({ version, remplaceDocumentId: ancien.id, nature: ancien.nature, exerciceId: ancien.exerciceId }).where(eq(s.documents.id, p.nouveauId));
  await tx
    .update(s.documents)
    .set({ statut: 'remplace', remplacePar: p.nouveauId, motifStatut: `Remplacé par la version ${version}`, majLe: new Date().toISOString() })
    .where(eq(s.documents.id, ancien.id));

  const [extraction] = await tx.select().from(s.extractions).where(and(eq(s.extractions.documentId, ancien.id), eq(s.extractions.actuelle, true))).for('update');
  const validationInvalidee = extraction?.statut === 'valide';
  if (extraction && validationInvalidee) {
    await tx.update(s.extractions).set({ statut: 'validation_invalidee' }).where(eq(s.extractions.id, extraction.id));
    await tx.insert(s.decisions).values({
      cabinetId: p.cabinetId,
      entiteId: ancien.entiteId,
      cibleType: 'extraction',
      cibleId: extraction.id,
      versionCible: extraction.version,
      action: 'validation_invalidee',
      motif: `Nouvelle version de la pièce reçue (version ${version}) : la validation de la version ${ancien.version} ne vaut pas pour elle.`,
      auteurId: p.acteurId,
    });
  }
  await journaliser(tx, {
    cabinetId: p.cabinetId,
    acteurId: p.acteurId,
    action: 'document.nouvelle_version',
    cibleType: 'document',
    cibleId: p.nouveauId,
    entiteId: ancien.entiteId,
    details: { remplace: ancien.id, version, statutAncien: ancien.statut, validationInvalidee },
  });
  return { version, validationInvalidee };
}
