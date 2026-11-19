/**
 * Opérations de l'ÉDITEUR sur les abonnements (grille tarifaire, essai, échéances, rapprochement des virements).
 * Exécutées avec le rôle d'administration, hors de l'application : un cabinet ne peut ni s'ouvrir un essai, ni
 * modifier un tarif, ni se déclarer payé. Les calculs viennent du moteur déterministe (@comtaple/core).
 */
import { calculerEcheance, type Offre, schemaOffre, verifierOffre } from '@comtaple/core';
import type pg from 'pg';

/** Grille de DÉMONSTRATION : montants fictifs, sans valeur commerciale. */
export const OFFRES_DEMO: Offre[] = [
  {
    code: 'demo-essentiel',
    libelle: 'Essentiel (démonstration)',
    forfaitMensuel: '100.00',
    dossiersInclus: 10,
    tranches: [
      { jusqua: 50, prixParDossier: '4.00' },
      { jusqua: null, prixParDossier: '3.00' },
    ],
    quotas: { piecesParMois: 2000, stockageGo: 20 },
    joursEssai: 30,
    fictif: true,
  },
  {
    code: 'demo-cabinet',
    libelle: 'Cabinet (démonstration)',
    forfaitMensuel: '300.00',
    dossiersInclus: 60,
    tranches: [
      { jusqua: 200, prixParDossier: '3.00' },
      { jusqua: null, prixParDossier: '2.00' },
    ],
    quotas: { piecesParMois: 15000, stockageGo: 150 },
    joursEssai: 30,
    fictif: true,
  },
];

export async function definirOffre(client: pg.ClientBase, offre: Offre): Promise<void> {
  const valide = schemaOffre.parse(offre);
  const erreurs = verifierOffre(valide);
  if (erreurs.length) throw new Error(`Offre « ${offre.code} » incohérente : ${erreurs.join(' ')}`);
  await client.query(
    `insert into offres_abonnement (code, definition, fictif) values ($1, $2, $3)
     on conflict (code) do update set definition = excluded.definition, fictif = excluded.fictif`,
    [valide.code, JSON.stringify(valide), valide.fictif],
  );
}

async function lireOffre(client: pg.ClientBase, code: string): Promise<Offre> {
  const r = await client.query<{ definition: unknown }>('select definition from offres_abonnement where code = $1', [code]);
  if (!r.rowCount) throw new Error(`Offre inconnue : ${code}`);
  return schemaOffre.parse(r.rows[0]!.definition);
}

const plusJours = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Ouvre (ou réinitialise, en démonstration) la période d'essai d'un cabinet. */
export async function ouvrirEssai(client: pg.ClientBase, cabinetId: string, codeOffre: string, aujourdhui: string): Promise<string> {
  const offre = await lireOffre(client, codeOffre);
  const r = await client.query<{ id: string }>(
    `insert into abonnements (cabinet_id, offre, statut, debut, fin_essai, quotas) values ($1, $2, 'essai', $3, $4, $5)
     on conflict (cabinet_id) do update set offre = excluded.offre, statut = 'essai', debut = excluded.debut, fin_essai = excluded.fin_essai,
       fin = null, offre_demandee = null, motif_resiliation = null, quotas = excluded.quotas
     returning id`,
    [cabinetId, codeOffre, aujourdhui, plusJours(aujourdhui, offre.joursEssai), JSON.stringify(offre.quotas)],
  );
  await client.query(`insert into evenements_facturation (cabinet_id, abonnement_id, type, detail) values ($1, $2, 'essai_ouvert', $3)`, [
    cabinetId,
    r.rows[0]!.id,
    JSON.stringify({ offre: codeOffre, finEssai: plusJours(aujourdhui, offre.joursEssai) }),
  ]);
  return r.rows[0]!.id;
}

/**
 * Génère l'échéance d'un mois (idempotent par cabinet et par période). Applique d'abord un changement d'offre demandé.
 * Renvoie null si le moteur ne peut pas calculer (aucune échéance n'est alors créée).
 */
export async function genererEcheance(client: pg.ClientBase, cabinetId: string, periodeDebut: string): Promise<{ id: string; totalHt: string; reference: string } | null> {
  if (!/^\d{4}-\d{2}-01$/.test(periodeDebut)) throw new Error('La période commence le premier jour d’un mois (AAAA-MM-01).');
  const a = await client.query<{ id: string; offre: string; offre_demandee: string | null }>('select id, offre, offre_demandee from abonnements where cabinet_id = $1 for update', [cabinetId]);
  if (!a.rowCount) throw new Error('Aucun abonnement pour ce cabinet');
  let { id, offre: codeOffre } = a.rows[0]!;
  if (a.rows[0]!.offre_demandee) {
    const nouvelle = await lireOffre(client, a.rows[0]!.offre_demandee);
    await client.query('update abonnements set offre = $2, offre_demandee = null, quotas = $3 where id = $1', [id, nouvelle.code, JSON.stringify(nouvelle.quotas)]);
    await client.query(`insert into evenements_facturation (cabinet_id, abonnement_id, type, detail) values ($1, $2, 'changement_offre_applique', $3)`, [cabinetId, id, JSON.stringify({ de: codeOffre, vers: nouvelle.code })]);
    codeOffre = nouvelle.code;
  }
  const offre = await lireOffre(client, codeOffre);
  const n = await client.query<{ n: number }>('select count(*)::int as n from entites where cabinet_id = $1 and actif', [cabinetId]);
  const calcul = calculerEcheance(offre, n.rows[0]!.n);
  if (calcul.statut !== 'calcule' || calcul.totalHt === null) return null;
  const fin = new Date(Date.UTC(Number(periodeDebut.slice(0, 4)), Number(periodeDebut.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const reference = `CTP-${cabinetId.slice(0, 8).toUpperCase()}-${periodeDebut.slice(0, 4)}${periodeDebut.slice(5, 7)}`;
  const e = await client.query<{ id: string; total_ht: string; reference_virement: string }>(
    `insert into echeances_abonnement (cabinet_id, abonnement_id, periode_debut, periode_fin, offre, dossiers_actifs, lignes, total_ht, fictif, reference_virement)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (cabinet_id, periode_debut) do update set cabinet_id = excluded.cabinet_id
     returning id, total_ht, reference_virement`,
    [cabinetId, id, periodeDebut, fin, codeOffre, calcul.dossiersActifs, JSON.stringify(calcul.lignes), calcul.totalHt, calcul.fictif, reference],
  );
  await client.query(`insert into evenements_facturation (cabinet_id, abonnement_id, type, montant, detail) values ($1, $2, 'echeance_emise', $3, $4)`, [cabinetId, id, e.rows[0]!.total_ht, JSON.stringify({ periode: periodeDebut, reference })]);
  return { id: e.rows[0]!.id, totalHt: e.rows[0]!.total_ht, reference: e.rows[0]!.reference_virement };
}

/** Rapproche un virement reçu avec une échéance ; le premier paiement transforme l'essai en abonnement actif. */
export async function enregistrerVirement(client: pg.ClientBase, echeanceId: string, dateReception: string): Promise<void> {
  const e = await client.query<{ cabinet_id: string; abonnement_id: string; total_ht: string; statut_paiement: string }>(
    `update echeances_abonnement set statut_paiement = 'paye', paye_le = $2 where id = $1 and statut_paiement <> 'paye' returning cabinet_id, abonnement_id, total_ht, statut_paiement`,
    [echeanceId, dateReception],
  );
  if (!e.rowCount) return; // déjà rapproché : sans effet
  const { cabinet_id, abonnement_id, total_ht } = e.rows[0]!;
  await client.query(`update abonnements set statut = 'actif' where id = $1 and statut in ('essai', 'suspendu')`, [abonnement_id]);
  await client.query(`insert into evenements_facturation (cabinet_id, abonnement_id, type, montant, detail) values ($1, $2, 'virement_recu', $3, $4)`, [cabinet_id, abonnement_id, total_ht, JSON.stringify({ echeanceId, dateReception })]);
}

export async function suspendre(client: pg.ClientBase, cabinetId: string, motif: string): Promise<void> {
  const a = await client.query<{ id: string }>(`update abonnements set statut = 'suspendu' where cabinet_id = $1 returning id`, [cabinetId]);
  if (a.rowCount) await client.query(`insert into evenements_facturation (cabinet_id, abonnement_id, type, detail) values ($1, $2, 'suspension', $3)`, [cabinetId, a.rows[0]!.id, JSON.stringify({ motif })]);
}
