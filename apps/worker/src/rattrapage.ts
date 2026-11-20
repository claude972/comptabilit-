import { and, eq, schema as s } from '@comtaple/db';
import { cles } from '@comtaple/plateforme';
import type { Contexte } from './contexte.js';

export interface BilanRattrapage {
  documents: number;
  traitements: Record<string, number>;
  televersementsPurges: number;
}

/**
 * Rattrapage périodique. Les traitements confirmés en base mais absents de la file (file vidée, redémarrage de Redis,
 * mise en file manquée après la validation d'une transaction) y sont remis. Remettre une tâche déjà présente est sans
 * effet : chaque traitement vérifie le statut de son enregistrement avant d'agir.
 */
export async function rattraper(c: Contexte, minutes = 10): Promise<BilanRattrapage> {
  const bilan: BilanRattrapage = { documents: 0, traitements: {}, televersementsPurges: 0 };
  const docs = await c.bd.pool.query<{ cabinet_id: string; document_id: string }>('select * from worker_documents_en_retard($1, 500)', [minutes]);
  for (const r of docs.rows) {
    await c.taches.analyserDocument({ cabinetId: r.cabinet_id, documentId: r.document_id });
    bilan.documents++;
  }
  const attente = await c.bd.pool.query<{ cabinet_id: string; nature: string; identifiant: string }>('select * from worker_traitements_en_attente($1, 200)', [minutes]);
  for (const r of attente.rows) {
    const cabinetId = r.cabinet_id;
    if (r.nature === 'import_fec') await c.taches.importerFec({ cabinetId, lotImportId: r.identifiant });
    else if (r.nature === 'import_releve') await c.taches.importerReleve({ cabinetId, lotImportId: r.identifiant });
    else if (r.nature === 'controles') await c.taches.executerControles({ cabinetId, executionId: r.identifiant });
    else if (r.nature === 'rapprochement') await c.taches.executerRapprochement({ cabinetId, executionId: r.identifiant });
    else if (r.nature === 'dossier_revision') await c.taches.genererDossier({ cabinetId, exportId: r.identifiant });
    else if (r.nature === 'restitution') await c.taches.genererRestitution({ cabinetId, restitutionId: r.identifiant });
    else if (r.nature === 'reanalyse_destinataire') await c.taches.reanalyserDestinataire({ cabinetId, lotId: r.identifiant });
    else if (r.nature === 'restitution_cabinet') await c.taches.genererRestitutionCabinet({ cabinetId, restitutionCabinetId: r.identifiant });
    else continue;
    bilan.traitements[r.nature] = (bilan.traitements[r.nature] ?? 0) + 1;
  }
  bilan.televersementsPurges = await purgerTeleversements(c);
  return bilan;
}

/** Téléversements jamais terminés et expirés : leurs morceaux temporaires sont supprimés du stockage. */
export async function purgerTeleversements(c: Contexte): Promise<number> {
  const { rows } = await c.bd.pool.query<{ cabinet_id: string; televersement_id: string }>('select * from worker_televersements_expires(200)');
  for (const r of rows) {
    await c.stockage.supprimer(await c.stockage.lister(cles.prefixeMorceaux(r.cabinet_id, r.televersement_id)));
    await c.bd.avecContexte({ cabinetId: r.cabinet_id }, (tx) =>
      tx.update(s.televersements).set({ statut: 'abandonne' }).where(and(eq(s.televersements.id, r.televersement_id), eq(s.televersements.statut, 'ouvert'))),
    );
  }
  return rows.length;
}
