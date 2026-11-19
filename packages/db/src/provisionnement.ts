/**
 * Opérations de l'ÉDITEUR sur les abonnements (grille tarifaire, essai, échéances, rapprochement des virements).
 * Exécutées avec le rôle d'administration, hors de l'application : un cabinet ne peut ni s'ouvrir un essai, ni
 * modifier un tarif, ni se déclarer payé. Les calculs viennent du moteur déterministe (@comtaple/core).
 */
import { calculerEcheance, type CriteresEvolution, type Offre, schemaCriteresEvolution, schemaOffre, verifierOffre } from '@comtaple/core';
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

// ───────────────────────────── Veille réglementaire (opérations de l'éditeur) ─────────────────────────────

/** Domaines officiels admis pour une surveillance : aucune autre origine n'est interrogée. */
export const DOMAINES_OFFICIELS = ['legifrance.gouv.fr', 'bofip.impots.gouv.fr', 'impots.gouv.fr', 'anc.gouv.fr', 'cnil.fr', 'eur-lex.europa.eu', 'boss.gouv.fr', 'urssaf.fr'] as const;

export function domaineOfficiel(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && DOMAINES_OFFICIELS.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/** Sources de départ : pages déjà citées par les règles du moteur (vérifiées le 2026-11-19 lors de leur développement). */
export const SURVEILLANCES_INITIALES = [
  { emetteur: 'Légifrance', libelle: 'LPF, article A47 A-1 (fichier des écritures comptables)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000027804775' },
  { emetteur: 'BOFiP', libelle: 'BOI-CF-IOR-60-40-20 (format du FEC)', url: 'https://bofip.impots.gouv.fr/bofip/9028-PGP.html' },
  { emetteur: 'BOFiP', libelle: 'BOI-BIC-CHG-20-30-10 (biens de faible valeur)', url: 'https://bofip.impots.gouv.fr/bofip/2109-PGP.html' },
  { emetteur: 'Légifrance', libelle: 'Code de commerce, article L223-21 (comptes courants d’associés, SARL)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006223124' },
] as const;

export async function enregistrerSurveillance(client: pg.ClientBase, source: { emetteur: string; libelle: string; url: string }, options: { autoriserHorsDomaines?: boolean } = {}): Promise<string> {
  if (!options.autoriserHorsDomaines && !domaineOfficiel(source.url)) throw new Error(`Source refusée : ${source.url} n'est pas une page https d'un domaine officiel admis.`);
  const r = await client.query<{ id: string }>(
    `insert into surveillances_sources (emetteur, libelle, url) values ($1, $2, $3)
     on conflict (url) do update set emetteur = excluded.emetteur, libelle = excluded.libelle returning id`,
    [source.emetteur, source.libelle, source.url],
  );
  return r.rows[0]!.id;
}

/**
 * Qualification d'une évolution par une personne de l'éditeur, après lecture de la source : résumé, dates, conditions
 * et critères d'applicabilité. C'est la seule façon de rendre une évolution visible des cabinets comme « vérifiée ».
 */
export async function qualifierEvolution(
  client: pg.ClientBase,
  evolutionId: string,
  q: { reference: string; resume: string; passage?: string; datePublication?: string; dateEffet?: string; conditions?: string; criteres: CriteresEvolution; dateVerification: string },
): Promise<void> {
  const criteres = schemaCriteresEvolution.parse(q.criteres);
  const r = await client.query(
    `update evolutions_reglementaires set reference = $2, resume = $3, passage = $4, date_publication = $5, date_effet = $6, conditions = $7,
       criteres = $8, etat_verification = 'verifiee', verifiee_le = $9 where id = $1`,
    [evolutionId, q.reference, q.resume, q.passage ?? null, q.datePublication ?? null, q.dateEffet ?? null, q.conditions ?? null, JSON.stringify(criteres), q.dateVerification],
  );
  if (!r.rowCount) throw new Error('Évolution introuvable');
}

export async function ecarterEvolution(client: pg.ClientBase, evolutionId: string): Promise<void> {
  await client.query(`update evolutions_reglementaires set etat_verification = 'ecartee' where id = $1`, [evolutionId]);
}

// ───────────────────────────── Accès temporaire du support (opération de l'éditeur) ─────────────────────────────

/**
 * Ouvre à une personne du support un accès TEMPORAIRE à un cabinet : rôle « support », borné dans le temps, inscrit
 * au journal d'audit du cabinet. Cet accès ne donne par lui-même accès à AUCUN dossier : un gestionnaire du cabinet
 * doit encore l'habiliter (en lecture au plus) sur les dossiers concernés. L'application limite ce rôle à la lecture.
 */
export async function ouvrirAccesSupport(
  client: pg.ClientBase,
  p: { cabinetId: string; sujetOidc: string; email: string; nom: string; heures: number; motif: string },
): Promise<{ utilisateurId: string; expireLe: string }> {
  if (!(p.heures > 0 && p.heures <= 72)) throw new Error('Durée d’accès support : entre 1 et 72 heures.');
  if (p.motif.trim().length < 5) throw new Error('Un motif est requis pour un accès support.');
  const u = await client.query<{ id: string }>(
    `insert into utilisateurs (sujet_oidc, email, nom) values ($1, $2, $3) on conflict (sujet_oidc) do update set email = excluded.email returning id`,
    [p.sujetOidc, p.email, p.nom],
  );
  const utilisateurId = u.rows[0]!.id;
  const existant = await client.query<{ role: string }>('select role from appartenances where cabinet_id = $1 and utilisateur_id = $2', [p.cabinetId, utilisateurId]);
  if (existant.rowCount && existant.rows[0]!.role !== 'support') throw new Error('Cette personne est déjà membre du cabinet à un autre titre : aucun accès support n’est ouvert.');
  const a = await client.query<{ expire_le: string }>(
    `insert into appartenances (cabinet_id, utilisateur_id, role, actif, expire_le) values ($1, $2, 'support', true, now() + make_interval(hours => $3))
     on conflict (cabinet_id, utilisateur_id) do update set actif = true, expire_le = excluded.expire_le returning expire_le::text`,
    [p.cabinetId, utilisateurId, Math.round(p.heures)],
  );
  await client.query(
    `insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id, details) values ($1, 'systeme', 'support.acces_ouvert', 'utilisateur', $2, $3)`,
    [p.cabinetId, utilisateurId, JSON.stringify({ heures: Math.round(p.heures), expireLe: a.rows[0]!.expire_le, motif: p.motif })],
  );
  return { utilisateurId, expireLe: a.rows[0]!.expire_le };
}

/** Ferme immédiatement un accès support et retire ses habilitations de dossier. */
export async function fermerAccesSupport(client: pg.ClientBase, cabinetId: string, utilisateurId: string): Promise<void> {
  const r = await client.query(`update appartenances set actif = false, expire_le = now() where cabinet_id = $1 and utilisateur_id = $2 and role = 'support'`, [cabinetId, utilisateurId]);
  if (!r.rowCount) return;
  await client.query('delete from habilitations_dossier where cabinet_id = $1 and utilisateur_id = $2', [cabinetId, utilisateurId]);
  await client.query(`insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id) values ($1, 'systeme', 'support.acces_ferme', 'utilisateur', $2)`, [cabinetId, utilisateurId]);
}

/** Lignes du journal d'un cabinet dont l'empreinte ou l'enchaînement est irrégulier (diagnostic, lecture seule). */
export async function ecartsJournal(client: pg.ClientBase, cabinetId: string): Promise<Array<{ ligne: number; empreinteValide: boolean; enchainementValide: boolean }>> {
  const r = await client.query<{ ligne: string; empreinte_valide: boolean; enchainement_valide: boolean }>('select * from journal_audit_ecarts($1)', [cabinetId]);
  return r.rows.map((l) => ({ ligne: Number(l.ligne), empreinteValide: l.empreinte_valide, enchainementValide: l.enchainement_valide }));
}

/**
 * Consigne une anomalie d'ENCHAÎNEMENT du journal d'un cabinet, pour une cause établie par l'éditeur. Refusée si une
 * ligne de la plage a une empreinte fausse (contenu altéré : cela ne se consigne pas, cela se signale), si la plage ne
 * contient aucune irrégularité, ou si elle n'explique pas à elle seule la rupture. La consignation est inscrite au
 * journal du cabinet, qui la voit. Irréversible (ajout seul).
 */
export async function consignerAnomalieJournal(client: pg.ClientBase, cabinetId: string, premiereLigne: number, derniereLigne: number, cause: string): Promise<string> {
  if (!Number.isSafeInteger(premiereLigne) || !Number.isSafeInteger(derniereLigne) || premiereLigne > derniereLigne) throw new Error('Plage de lignes invalide');
  if (derniereLigne - premiereLigne > 50) throw new Error('Plage trop large (50 lignes au plus) : une anomalie se consigne au plus près.');
  if (cause.trim().length < 30) throw new Error('La cause doit être décrite précisément (30 caractères au moins).');
  await client.query('begin');
  try {
    const ecarts = (await ecartsJournal(client, cabinetId)).filter((e) => e.ligne >= premiereLigne && e.ligne <= derniereLigne);
    if (ecarts.length === 0) throw new Error('Aucune irrégularité dans cette plage : rien à consigner.');
    if (ecarts.some((e) => !e.empreinteValide)) throw new Error('Une ligne de la plage a une empreinte fausse : son contenu a pu être altéré. Ce cas ne se consigne pas.');
    const a = await client.query<{ id: string }>('insert into anomalies_journal (cabinet_id, premiere_ligne, derniere_ligne, cause) values ($1, $2, $3, $4) returning id', [cabinetId, premiereLigne, derniereLigne, cause.trim()]);
    const reste = await client.query<{ r: string | null }>('select journal_audit_verifier_hors_anomalies($1) as r', [cabinetId]);
    const restant = reste.rows[0]!.r === null ? null : Number(reste.rows[0]!.r);
    if (restant !== null && restant <= derniereLigne + 1) throw new Error(`Cette plage n’explique pas la rupture (ligne ${restant} toujours incohérente).`);
    await client.query(
      `insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id, details) values ($1, 'systeme', 'journal.anomalie_consignee', 'anomalie_journal', $2, $3)`,
      [cabinetId, a.rows[0]!.id, JSON.stringify({ premiereLigne, derniereLigne, cause: cause.trim() })],
    );
    await client.query('commit');
    return a.rows[0]!.id;
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

/**
 * Politique de rétention des notifications (docs/conservation.md) : archive les notifications LUES anciennes
 * (réversible), puis supprime les notifications ARCHIVÉES depuis longtemps (irréversible). SIMULATION par défaut : sans
 * `appliquer`, rien n'est modifié. Les notifications non lues ne sont jamais touchées. Aucun traitement ne l'exécute
 * automatiquement : c'est une opération explicite de l'éditeur.
 */
export async function retentionNotifications(client: pg.ClientBase, options: { archiverApresJours?: number; supprimerApresJours?: number; appliquer?: boolean } = {}): Promise<Array<{ cabinetId: string; aArchiver: number; aSupprimer: number; simulation: boolean }>> {
  const archiver = options.archiverApresJours ?? 30;
  const supprimer = options.supprimerApresJours ?? 180;
  if (!Number.isInteger(archiver) || !Number.isInteger(supprimer)) throw new Error('Durées de rétention : nombres entiers de jours attendus');
  const r = await client.query<{ cabinet_id: string; a_archiver: string; a_supprimer: string; simulation: boolean }>(
    'select * from notifications_appliquer_retention(make_interval(days => $1), make_interval(days => $2), $3)',
    [archiver, supprimer, options.appliquer !== true],
  );
  return r.rows.map((l) => ({ cabinetId: l.cabinet_id, aArchiver: Number(l.a_archiver), aSupprimer: Number(l.a_supprimer), simulation: l.simulation }));
}
