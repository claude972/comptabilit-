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

// ───────────────────────────── Ouverture d'un cabinet ─────────────────────────────

/**
 * Ouvre un cabinet et INVITE son premier administrateur (D-064). Aucun compte n'est créé ici : le compte de la personne
 * est créé dans le fournisseur d'identité, et son entrée dans le cabinet se fait à sa première connexion, si le
 * fournisseur atteste l'adresse. Aucun courriel n'est envoyé. L'abonnement s'ouvre à part (`ouvrirEssai`).
 */
export async function creerCabinet(client: pg.ClientBase, d: { nom: string; emailAdministrateur: string; nomAdministrateur: string; validiteJours?: number }): Promise<{ cabinetId: string; invitationId: string; expireLe: string }> {
  const nom = d.nom.trim();
  const email = d.emailAdministrateur.trim().toLowerCase();
  const nomAdmin = d.nomAdministrateur.trim();
  if (nom.length < 2) throw new Error('Nom de cabinet trop court');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Adresse de l’administrateur invalide');
  if (!nomAdmin) throw new Error('Nom de l’administrateur manquant');
  const jours = d.validiteJours ?? 14;
  if (!Number.isInteger(jours) || jours < 1 || jours > 30) throw new Error('Validité de l’invitation : 1 à 30 jours');
  await client.query('begin');
  try {
    const cabinetId = (await client.query<{ id: string }>('insert into cabinets (nom) values ($1) returning id', [nom])).rows[0]!.id;
    const inv = (
      await client.query<{ id: string; expire_le: Date }>(
        `insert into invitations (cabinet_id, email, nom, role, expire_le) values ($1, $2, $3, 'administrateur', now() + make_interval(days => $4)) returning id, expire_le`,
        [cabinetId, email, nomAdmin, jours],
      )
    ).rows[0]!;
    await client.query(
      `insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id, details) values ($1::uuid, 'systeme', 'cabinet.ouvert', 'cabinet', $2, $3)`,
      [cabinetId, cabinetId, JSON.stringify({ invitationAdministrateur: inv.id })],
    );
    await client.query('commit');
    return { cabinetId, invitationId: inv.id, expireLe: inv.expire_le.toISOString() };
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

/**
 * Éléments de facturation d'une période, pour l'outil de facturation de l'ÉDITEUR (export CSV, séparateur « ; »).
 * Ce n'est ni une facture ni un dépôt sur une plateforme agréée : les mentions légales, la TVA et l'émission relèvent
 * de l'outil de facturation. Les montants d'une grille de démonstration sont marqués « fictif ».
 */
export async function exporterElementsFacturation(client: pg.ClientBase, periodeDebut: string, periodeFin: string): Promise<{ csv: string; lignes: number }> {
  for (const v of [periodeDebut, periodeFin]) if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Dates attendues au format AAAA-MM-JJ');
  const r = await client.query<Record<string, string | number | boolean | null>>(
    `select e.id as echeance_id, e.reference_virement as reference, c.id as cabinet_id, c.nom as cabinet, e.periode_debut::text as periode_debut, e.offre,
            e.dossiers_actifs, e.total_ht::text as total_ht, e.fictif, e.statut_paiement, e.paye_le::text as paye_le
       from echeances_abonnement e join cabinets c on c.id = e.cabinet_id
      where e.periode_debut >= $1::date and e.periode_debut <= $2::date order by e.periode_debut, c.nom, e.id`,
    [periodeDebut, periodeFin],
  );
  const colonnes = ['echeance_id', 'reference', 'cabinet_id', 'cabinet', 'periode_debut', 'offre', 'dossiers_actifs', 'total_ht', 'fictif', 'statut_paiement', 'paye_le'];
  // Une cellule commençant par = + - @ est neutralisée (un tableur ne doit pas l'interpréter comme une formule).
  const cellule = (v: unknown) => {
    let t = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(t)) t = `'${t}`;
    return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const csv = [colonnes.join(';'), ...r.rows.map((l) => colonnes.map((c) => cellule(l[c])).join(';'))].join('\r\n') + '\r\n';
  return { csv, lignes: r.rows.length };
}

// ───────────────────────────── Fin de contrat d'un cabinet (opération de l'éditeur, SIMULATION par défaut) ─────────────────────────────
//
// Procédure de suppression à la résiliation (docs/conservation.md, « Fin de contrat »). Elle n'est appelée par aucun
// traitement automatique ni par l'API : seul l'outil de l'éditeur (`scripts/editeur.mjs fin-de-contrat`), avec le rôle
// d'administration de la base, l'exécute. Sans `appliquer: true`, tout se passe dans une transaction EN LECTURE SEULE :
// la base elle-même refuse alors toute écriture. Les durées citées sont PROPOSÉES, non arrêtées.
import { createHash } from 'node:crypto';

export type DevenirFinDeContrat = 'supprimer' | 'conserver_jusqu_a' | 'anonymiser' | 'restituer_puis_supprimer';

export interface CategorieFinDeContrat {
  code: string;
  libelle: string;
  /** Tables portant `cabinet_id` rangées dans cette catégorie. Une table sans catégorie bloque la procédure. */
  tables: readonly string[];
  devenir: DevenirFinDeContrat;
  /** Durée PROPOSÉE et son fondement, repris de docs/conservation.md. Rien n'est arrêté. */
  conservation?: { duree: string; pointDeDepart: string; fondement: string; statut: 'proposé, non arrêté' };
  note?: string;
}

const PROPOSE = 'proposé, non arrêté' as const;
const CINQ_ANS = { duree: '5 ans', pointDeDepart: 'fin du contrat', fondement: 'Prescription de droit commun (Code civil, art. 2224 ; Code de commerce, art. L. 110-4) — contrats et échanges avec le Cabinet', statut: PROPOSE };

/**
 * Politique de fin de contrat : devenir de CHAQUE table portant `cabinet_id`. Versionnée : toute modification change
 * `version`, que le procès-verbal reprend. Statut : proposition de travail, à valider (V8 de docs/risques.md).
 */
export const POLITIQUE_FIN_DE_CONTRAT: { version: string; statut: string; delaiGraceJoursParDefaut: number; categories: readonly CategorieFinDeContrat[] } = {
  version: '2026-11-19.2',
  statut: 'proposée, non arrêtée — durées et fondements à valider par un professionnel du droit et un expert-comptable',
  delaiGraceJoursParDefaut: 90,
  categories: [
    { code: 'comptes_appartenances', libelle: 'Comptes : appartenances, habilitations, invitations', tables: ['appartenances', 'habilitations_dossier', 'invitations'], devenir: 'supprimer', note: 'Retire tout accès au cabinet. Les comptes eux-mêmes (table « utilisateurs », sans cabinet_id, et fournisseur d’identité) ne sont PAS supprimés par cette procédure : voir « horsTables ».' },
    { code: 'dossiers', libelle: 'Dossiers : entités, établissements, exercices', tables: ['entites', 'etablissements', 'exercices'], devenir: 'restituer_puis_supprimer' },
    { code: 'pieces_fichiers', libelle: 'Pièces et fichiers : originaux, documents, réceptions, pages, extractions, échanges, téléversements, passages de recherche, factures extraites', tables: ['fichiers', 'documents', 'receptions', 'pages_document', 'extractions', 'echanges_document', 'televersements', 'passages_recherche', 'factures'], devenir: 'restituer_puis_supprimer', note: 'Les objets du stockage se suppriment par une étape séparée (objetsFinDeContrat).' },
    { code: 'ecritures_importees', libelle: 'Écritures importées : campagnes, lots d’import, lignes d’écriture', tables: ['campagnes_import', 'lots_import', 'lignes_ecriture'], devenir: 'restituer_puis_supprimer' },
    { code: 'banque', libelle: 'Relevés et mouvements bancaires, rapprochements', tables: ['releves_bancaires', 'mouvements_bancaires', 'mouvements_lots', 'executions_rapprochement', 'rapprochements'], devenir: 'restituer_puis_supprimer' },
    { code: 'controles_constats', libelle: 'Contrôles et constats, dossiers de révision', tables: ['executions_controles', 'resultats_controles', 'constats', 'exports_revision'], devenir: 'restituer_puis_supprimer' },
    { code: 'decisions_validations', libelle: 'Décisions et validations : décisions, commentaires, écritures d’inventaire, confirmations d’annexe, immobilisations saisies, suivis de veille, liens confirmés ou infirmés entre tiers et entre factures', tables: ['decisions', 'commentaires', 'ecritures_inventaire', 'confirmations_annexe', 'immobilisations', 'suivis_evolution', 'liens_tiers', 'liens_factures'], devenir: 'restituer_puis_supprimer' },
    { code: 'missions_conseils', libelle: 'Missions et conseils : missions, lettres de mission, travaux, barèmes de temps, registre des conseils', tables: ['missions', 'lettres_mission', 'travaux', 'baremes_temps', 'conseils', 'evenements_conseil'], devenir: 'restituer_puis_supprimer' },
    { code: 'regles_parametres', libelle: 'Règles et paramètres du cabinet', tables: ['regles_cabinet', 'parametres_cabinet'], devenir: 'restituer_puis_supprimer' },
    { code: 'messagerie', libelle: 'Connexions de messagerie et jetons, messages vus, pièces à qualifier', tables: ['connexions_mail', 'demandes_connexion_mail', 'pieces_mail_vues', 'pieces_a_qualifier', 'signalements_mail', 'messages_mail'], devenir: 'supprimer', note: 'Les jetons (chiffrés) ne sont jamais restitués ; ils sont détruits avec la connexion.' },
    { code: 'notifications', libelle: 'Notifications internes et préférences', tables: ['notifications', 'preferences_notification'], devenir: 'supprimer' },
    { code: 'assistant', libelle: 'Échanges avec l’assistant et propositions d’IA', tables: ['echanges_assistant', 'propositions_ia'], devenir: 'supprimer' },
    { code: 'traces_ia', libelle: 'Traces de la passerelle IA (mesures sans contenu)', tables: ['evenements_ia'], devenir: 'anonymiser', conservation: { duree: '6 mois', pointDeDepart: 'événement', fondement: 'Mesures d’exploitation de l’Éditeur (bas de la fourchette de la recommandation CNIL sur la journalisation, délibération n° 2021-122) — valeur de travail', statut: PROPOSE }, note: 'L’identifiant de la personne et celui du dossier sont effacés ; restent des décomptes rattachés au cabinet.' },
    { code: 'abonnement_facturation', libelle: 'Abonnement et éléments de facturation (échéances, événements)', tables: ['abonnements', 'echeances_abonnement', 'evenements_facturation'], devenir: 'conserver_jusqu_a', conservation: { duree: '10 ans', pointDeDepart: 'clôture de l’exercice de l’Éditeur', fondement: 'Code de commerce, art. L. 123-22 ; LPF, art. L. 102 B (6 ans) — documents comptables de l’Éditeur, responsable de ce traitement', statut: PROPOSE } },
    { code: 'restitutions_dossier', libelle: 'Restitutions par dossier (registre)', tables: ['restitutions'], devenir: 'supprimer', note: 'Archives générées : 30 jours proposés ; elles dupliquent les données.' },
    { code: 'restitutions_cabinet', libelle: 'Restitutions du cabinet (registre : périmètre, empreinte, demandeur)', tables: ['restitutions_cabinet'], devenir: 'conserver_jusqu_a', conservation: CINQ_ANS, note: 'Preuve de la restitution. L’archive elle-même est un objet du stockage, supprimé à l’étape des objets.' },
    { code: 'journal_audit', libelle: 'Journal d’audit et anomalies consignées', tables: ['journal_audit', 'anomalies_journal'], devenir: 'conserver_jusqu_a', conservation: { duree: '12 mois (traces d’accès) à 10 ans (actes métier) ; tant que le journal n’est pas scindé, la plus longue s’applique', pointDeDepart: 'événement', fondement: 'Recommandation CNIL sur la journalisation (délibération n° 2021-122) ; preuve des diligences', statut: PROPOSE }, note: 'Jamais réécrit : il reçoit une dernière ligne « fin_de_contrat.executee » et reste vérifiable. Sa destruction au terme (export scellé puis purge) n’est pas conçue.' },
    { code: 'politiques_conservation', libelle: 'Politiques de conservation déclarées pour le cabinet', tables: ['politiques_conservation'], devenir: 'conserver_jusqu_a', conservation: CINQ_ANS, note: 'Justifie ce qui a été conservé ou refusé.' },
    { code: 'fin_de_contrat', libelle: 'Procès-verbaux de fin de contrat', tables: ['fins_de_contrat'], devenir: 'conserver_jusqu_a', conservation: CINQ_ANS },
  ],
};

/** Colonnes effacées (mises à vide) dans les tables au devenir « anonymiser ». */
export const ANONYMISATION_FIN_DE_CONTRAT: Readonly<Record<string, readonly string[]>> = { evenements_ia: ['utilisateur_id', 'entite_id_cible'] };
/** Colonnes qui portent une clé du stockage objet, avec la colonne de taille quand elle existe. */
export const COLONNES_CLES_OBJETS: ReadonlyArray<{ table: string; colonne: string; taille: string | null }> = [
  { table: 'fichiers', colonne: 'cle_stockage', taille: 'taille' },
  { table: 'exports_revision', colonne: 'cle_donnees', taille: null },
  { table: 'exports_revision', colonne: 'cle_pdf', taille: null },
  { table: 'restitutions', colonne: 'cle_archive', taille: 'taille' },
  { table: 'restitutions_cabinet', colonne: 'cle_archive', taille: 'taille' },
];
/** Actions du journal qui ne modifient aucune donnée restituée (elles peuvent suivre la restitution de référence). */
const ACTIONS_SANS_MODIFICATION = ['restitution.%', 'restitution_cabinet.%', 'abonnement.%', 'support.%', 'journal.%', 'fin_de_contrat.%', 'document.consulte', 'dossier_revision.telecharge'];
/** Limite, reprise telle quelle dans le plan et le procès-verbal : les sauvegardes ne sont pas purgées par cette procédure. */
export const LIMITE_SAUVEGARDES =
  'Les sauvegardes ne sont pas modifiables une à une : les données supprimées y subsistent jusqu’à leur rotation (30 à 90 jours glissants PROPOSÉS, politique de production non définie). Cette procédure ne les purge pas et ne le prétend pas ; une restauration postérieure devrait rejouer la fin de contrat.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IDENTIFIANT = /^[a-z_][a-z0-9_]*$/;
const sha256Texte = (texte: string) => createHash('sha256').update(texte, 'utf8').digest('hex');
/** JSON canonique : clés triées, sans espace. C'est ce texte qui est haché. */
export function jsonCanonique(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(jsonCanonique).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${jsonCanonique(o[k])}`).join(',')}}`;
}
const ident = (nom: string): string => {
  if (!IDENTIFIANT.test(nom)) throw new Error(`Identifiant SQL inattendu : ${nom}`);
  return `"${nom}"`;
};

/** Préfixes du stockage objet propres à un cabinet (packages/plateforme/src/stockage.ts, `cles`). */
export function prefixesObjetsCabinet(cabinetId: string): string[] {
  if (!UUID.test(cabinetId)) throw new Error('Identifiant de cabinet invalide');
  return [`cabinets/${cabinetId}/`, `tmp/${cabinetId}/`];
}

export interface InventaireFinDeContrat {
  cabinet: { id: string; nom: string; siren: string | null };
  politique: { version: string; statut: string };
  categories: Array<{ code: string; libelle: string; devenir: DevenirFinDeContrat; conservation: CategorieFinDeContrat['conservation'] | null; note: string | null; tables: Array<{ table: string; lignes: number }>; lignes: number }>;
  /** Tables de la base portant `cabinet_id` sans catégorie dans la politique : la procédure refuse de s'exécuter. */
  tablesSansCategorie: string[];
  /** Tables de la politique absentes de la base (migration non appliquée). */
  tablesAbsentes: string[];
  /** Données liées au cabinet mais hors des tables à `cabinet_id` : non traitées par la procédure. */
  horsTables: { cabinet: string; utilisateursSansAutreCabinet: { nombre: number; devenir: string }; fournisseurIdentite: string };
  /** Objets du stockage d'après les références de la base (le stockage lui-même n'est pas interrogé ici). */
  objets: { prefixes: string[]; referencesEnBase: number; volumeOctetsConnu: number; clesHorsPrefixes: number; empreinteListeCles: string; cles: string[] };
}

async function tablesACabinet(client: pg.ClientBase): Promise<string[]> {
  const r = await client.query<{ t: string }>(
    `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'cabinet_id' and not a.attisdropped) order by 1`,
  );
  return r.rows.map((l) => l.t);
}

async function exigerAdministration(client: pg.ClientBase): Promise<string> {
  const r = await client.query<{ u: string; proprietaire: boolean }>(
    `select current_user::text as u, coalesce((select pg_has_role(current_user, t.tableowner, 'MEMBER') from pg_tables t where t.schemaname = 'public' and t.tablename = 'cabinets'), false) as proprietaire`,
  );
  const { u, proprietaire } = r.rows[0]!;
  if (!proprietaire || u === 'comtaple_app' || u === 'comtaple_worker') throw new Error(`Fin de contrat : opération réservée au rôle d’administration de la base (rôle courant : ${u}).`);
  return u;
}

async function inventorier(client: pg.ClientBase, cabinetId: string, verrouiller: boolean): Promise<InventaireFinDeContrat> {
  if (!UUID.test(cabinetId)) throw new Error('Identifiant de cabinet invalide');
  const c = await client.query<{ id: string; nom: string; siren: string | null }>(`select id, nom, siren from cabinets where id = $1${verrouiller ? ' for update' : ''}`, [cabinetId]);
  if (!c.rowCount) throw new Error(`Cabinet introuvable : ${cabinetId}`);
  const presentes = await tablesACabinet(client);
  const parTable = new Map<string, CategorieFinDeContrat>();
  for (const cat of POLITIQUE_FIN_DE_CONTRAT.categories) for (const t of cat.tables) {
    if (parTable.has(t)) throw new Error(`Politique de fin de contrat incohérente : la table ${t} figure dans deux catégories.`);
    parTable.set(t, cat);
  }
  const lignes = new Map<string, number>();
  for (const t of presentes) lignes.set(t, Number((await client.query<{ n: string }>(`select count(*) as n from ${ident(t)} where cabinet_id = $1`, [cabinetId])).rows[0]!.n));
  const categories = POLITIQUE_FIN_DE_CONTRAT.categories.map((cat) => {
    const tables = cat.tables.filter((t) => lignes.has(t)).map((t) => ({ table: t, lignes: Number(lignes.get(t)) }));
    return { code: cat.code, libelle: cat.libelle, devenir: cat.devenir, conservation: cat.conservation ?? null, note: cat.note ?? null, tables, lignes: tables.reduce((s, t) => s + t.lignes, 0) };
  });
  const orphelins = await client.query<{ n: string }>(
    `select count(*) as n from utilisateurs u where exists (select 1 from appartenances a where a.utilisateur_id = u.id and a.cabinet_id = $1)
       and not exists (select 1 from appartenances a where a.utilisateur_id = u.id and a.cabinet_id <> $1)`,
    [cabinetId],
  );
  // Clés du stockage référencées par la base pour ce cabinet.
  const prefixes = prefixesObjetsCabinet(cabinetId);
  const cles = new Map<string, number | null>();
  for (const k of COLONNES_CLES_OBJETS) {
    if (!lignes.has(k.table)) continue;
    const r = await client.query<{ cle: string; taille: string | null }>(`select ${ident(k.colonne)} as cle, ${k.taille ? `${ident(k.taille)}::text` : 'null'} as taille from ${ident(k.table)} where cabinet_id = $1 and ${ident(k.colonne)} is not null`, [cabinetId]);
    for (const l of r.rows) if (!cles.has(l.cle)) cles.set(l.cle, l.taille === null ? null : Number(l.taille));
  }
  const liste = [...cles.keys()].sort();
  return {
    cabinet: c.rows[0]!,
    politique: { version: POLITIQUE_FIN_DE_CONTRAT.version, statut: POLITIQUE_FIN_DE_CONTRAT.statut },
    categories,
    tablesSansCategorie: presentes.filter((t) => !parTable.has(t)),
    tablesAbsentes: [...parTable.keys()].filter((t) => !lignes.has(t)).sort(),
    horsTables: {
      cabinet: 'La ligne « cabinets » (nom, SIREN) est conservée : partie au contrat, référencée par la facturation, le journal et le procès-verbal (5 ans proposés, non arrêté).',
      utilisateursSansAutreCabinet: { nombre: Number(orphelins.rows[0]!.n), devenir: 'Non traités par cette procédure : conservés pour que le journal reste lisible, puis suppression ou pseudonymisation 12 mois après la désactivation (proposé, non arrêté).' },
      fournisseurIdentite: 'Les comptes du fournisseur d’identité (Keycloak) sont hors de la base : à désactiver ou supprimer à la main.',
    },
    objets: {
      prefixes,
      referencesEnBase: liste.length,
      volumeOctetsConnu: [...cles.values()].reduce((s: number, t) => s + (t ?? 0), 0),
      clesHorsPrefixes: liste.filter((k) => !prefixes.some((p) => k.startsWith(p))).length,
      empreinteListeCles: sha256Texte(liste.join('\n')),
      cles: liste,
    },
  };
}

/** Inventaire complet d'un cabinet, catégorie par catégorie, avec le devenir prévu à la résiliation. Lecture seule. */
export async function inventaireFinDeContrat(client: pg.ClientBase, cabinetId: string): Promise<InventaireFinDeContrat> {
  await client.query('begin transaction read only');
  try {
    await exigerAdministration(client);
    return await inventorier(client, cabinetId, false);
  } finally {
    await client.query('rollback');
  }
}

export interface PreconditionFinDeContrat { code: string; libelle: string; satisfaite: boolean; detail: string }
export interface EtapeFinDeContrat { rang: number; operation: 'anonymiser' | 'supprimer' | 'journaliser' | 'proces_verbal'; table: string | null; categorie: string | null; lignes: number | null; detail: string }
export interface PlanFinDeContrat {
  format: 'comtaple.plan-fin-de-contrat/1';
  simulation: boolean;
  delaiGraceJours: number;
  preconditions: PreconditionFinDeContrat[];
  /** Vrai seulement si TOUTES les pré-conditions sont satisfaites. */
  executable: boolean;
  /** Ordre d'exécution : anonymisations, suppressions (enfants avant parents), dernière ligne du journal, procès-verbal. */
  etapes: EtapeFinDeContrat[];
  conserve: Array<{ table: string; categorie: string; lignes: number; conservation: CategorieFinDeContrat['conservation'] | null }>;
  restitution: { id: string; sha256: string; taille: number | null; demandeeLe: string; termineeLe: string } | null;
  inventaire: InventaireFinDeContrat;
  sauvegardes: string;
}
export interface ProcesVerbalFinDeContrat {
  format: 'comtaple.proces-verbal-fin-de-contrat/1';
  cabinet: { id: string; nom: string; siren: string | null };
  executeLe: string;
  executePar: string;
  politique: { version: string; statut: string };
  delaiGraceJours: number;
  abonnement: { statut: string; fin: string };
  restitution: NonNullable<PlanFinDeContrat['restitution']>;
  categories: Array<{ code: string; libelle: string; devenir: DevenirFinDeContrat; conservation: CategorieFinDeContrat['conservation'] | null; tables: Array<{ table: string; avant: number; apres: number }>; avant: number; apres: number }>;
  journal: { devenir: string; lignesAvant: number; lignesApres: number; derniereLigne: string; empreinteTete: string; verificationStricte: null };
  horsTables: InventaireFinDeContrat['horsTables'];
  /** Étape SÉPARÉE, non exécutée par ce procès-verbal : suppression des objets par préfixe de cabinet. */
  objets: { etat: 'a_supprimer_par_etape_separee'; prefixes: string[]; referencesEnBase: number; volumeOctetsConnu: number; clesHorsPrefixes: number; empreinteListeCles: string };
  sauvegardes: string;
  reserves: string[];
  /** SHA-256 du JSON canonique du document SANS ce champ. */
  empreinte: string;
}

/** Empreinte d'un procès-verbal : SHA-256 du JSON canonique du document privé de son champ `empreinte`. */
export function empreinteProcesVerbal(pv: Omit<ProcesVerbalFinDeContrat, 'empreinte'> & { empreinte?: string }): string {
  const { empreinte: _e, ...corps } = pv;
  return sha256Texte(jsonCanonique(corps));
}
export const verifierProcesVerbal = (pv: ProcesVerbalFinDeContrat): boolean => pv.format === 'comtaple.proces-verbal-fin-de-contrat/1' && pv.empreinte === empreinteProcesVerbal(pv);

/** Refus motivé : l'exécution a été demandée alors qu'une pré-condition manque. Rien n'a été modifié. */
export class RefusFinDeContrat extends Error {
  constructor(public readonly motifs: string[], public readonly plan: PlanFinDeContrat) {
    super(`Fin de contrat refusée, rien n’a été modifié : ${motifs.join(' | ')}`);
    this.name = 'RefusFinDeContrat';
  }
}

export interface ParametresFinDeContrat {
  cabinetId: string;
  /** Confirmation explicite : l'identifiant ET le nom exact du cabinet. Exigée pour exécuter. */
  confirmation?: { cabinetId: string; nom: string };
  /** Délai de grâce après la fin de l'abonnement résilié (90 jours par défaut, valeur proposée ; 30 au minimum). */
  delaiGraceJours?: number;
  /** Faux par défaut : SIMULATION, en transaction en lecture seule. */
  appliquer?: boolean;
  /** Suivi de progression ; une exception levée ici interrompt l'exécution et annule TOUT (transaction). */
  surEtape?: (etape: EtapeFinDeContrat) => void | Promise<void>;
}

async function etablirPlan(client: pg.ClientBase, p: ParametresFinDeContrat, appliquer: boolean): Promise<PlanFinDeContrat & { abonnement: { statut: string; fin: string } | null }> {
  const grace = p.delaiGraceJours ?? POLITIQUE_FIN_DE_CONTRAT.delaiGraceJoursParDefaut;
  if (!Number.isInteger(grace) || grace < 30 || grace > 3650) throw new Error('Délai de grâce : nombre entier de jours, entre 30 et 3650.');
  const inv = await inventorier(client, p.cabinetId, appliquer);
  const id = inv.cabinet.id;
  const pre: PreconditionFinDeContrat[] = [];
  const noter = (code: string, libelle: string, satisfaite: boolean, detail: string) => pre.push({ code, libelle, satisfaite, detail });
  const devenirDe = new Map<string, { devenir: DevenirFinDeContrat; categorie: string }>();
  for (const c of inv.categories) for (const t of c.tables) devenirDe.set(t.table, { devenir: c.devenir, categorie: c.code });
  const aSupprimer = [...devenirDe].filter(([, d]) => d.devenir === 'supprimer' || d.devenir === 'restituer_puis_supprimer').map(([t]) => t);

  // 1. Couverture : toute table à cabinet_id a un devenir ; aucune table conservée ne référence une table supprimée.
  const fk = await client.query<{ enfant: string; parent: string; colonne: string }>(
    `select e.relname as enfant, pa.relname as parent, a.attname as colonne from pg_constraint c join pg_class e on e.oid = c.conrelid join pg_class pa on pa.oid = c.confrelid
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey) where c.contype = 'f' and c.connamespace = 'public'::regnamespace order by 1, 2, 3`,
  );
  const pendantes = fk.rows.filter((l) => aSupprimer.includes(l.parent) && !aSupprimer.includes(l.enfant) && !(ANONYMISATION_FIN_DE_CONTRAT[l.enfant] ?? []).includes(l.colonne));
  const anonymiseesSansColonnes = [...devenirDe].filter(([t, d]) => d.devenir === 'anonymiser' && !ANONYMISATION_FIN_DE_CONTRAT[t]).map(([t]) => t);
  const defautsCouverture = [
    ...inv.tablesSansCategorie.map((t) => `table ${t} sans catégorie`),
    ...pendantes.map((l) => `${l.enfant}.${l.colonne} (non supprimée) référence ${l.parent} (supprimée)`),
    ...anonymiseesSansColonnes.map((t) => `table ${t} à anonymiser sans colonnes désignées`),
  ];
  noter('couverture_politique', 'Toute table portant cabinet_id a un devenir dans la politique', defautsCouverture.length === 0, defautsCouverture.length ? defautsCouverture.join(' ; ') : `politique ${inv.politique.version} : ${devenirDe.size} tables couvertes`);

  // 2. Registre des procès-verbaux (migration 0038) présent, et fin de contrat pas déjà exécutée.
  const registre = !inv.tablesAbsentes.includes('fins_de_contrat');
  const deja = registre ? (await client.query<{ executee_le: string }>('select executee_le::text from fins_de_contrat where cabinet_id = $1', [id])).rows[0] : undefined;
  noter('registre_disponible', 'Registre des procès-verbaux présent et fin de contrat non encore exécutée', registre && !deja, !registre ? 'table fins_de_contrat absente : migration 0038 non appliquée à cette base' : deja ? `fin de contrat déjà exécutée le ${deja.executee_le}` : 'aucune fin de contrat enregistrée pour ce cabinet');

  // 3. Abonnement résilié depuis le délai de grâce.
  const ab = (await client.query<{ statut: string; fin: string | null; echu: boolean | null; au_plus_tot: string | null }>(
    `select statut, fin::text, (fin + $2::int) <= current_date as echu, (fin + $2::int)::text as au_plus_tot from abonnements where cabinet_id = $1${appliquer ? ' for update' : ''}`,
    [id, grace],
  )).rows[0];
  noter(
    'abonnement_resilie',
    `Abonnement résilié depuis au moins ${grace} jours`,
    !!ab && ab.statut === 'resilie' && ab.echu === true,
    !ab ? 'aucun abonnement : la résiliation ne peut pas être constatée' : ab.statut !== 'resilie' ? `abonnement au statut « ${ab.statut} », non résilié` : ab.fin === null ? 'abonnement résilié sans date de fin' : ab.echu ? `résilié, fin le ${ab.fin}, délai de grâce échu le ${ab.au_plus_tot}` : `résilié, fin le ${ab.fin} : délai de grâce en cours jusqu’au ${ab.au_plus_tot}`,
  );

  // 4. Restitution du cabinet terminée, complète, d'empreinte consignée, postérieure à la dernière modification.
  const re = (await client.query<{ id: string; sha256: string | null; taille: string | null; cree_le: string; termine_le: string | null; perimetre: { inclus?: string[]; ecartes?: unknown[] } | null; journalisee: boolean; dossiers_hors: string }>(
    `select r.id, r.sha256, r.taille::text, r.cree_le::text, r.termine_le::text, r.perimetre,
            exists (select 1 from journal_audit j where j.cabinet_id = r.cabinet_id and j.action = 'restitution_cabinet.generee' and j.cible_id = r.id::text) as journalisee,
            (select count(*) from entites e where e.cabinet_id = r.cabinet_id and not coalesce((r.perimetre -> 'inclus') @> to_jsonb(e.id::text), false))::text as dossiers_hors
       from restitutions_cabinet r where r.cabinet_id = $1 and r.statut = 'termine' order by r.cree_le desc limit 1`,
    [id],
  )).rows[0];
  let restitution: PlanFinDeContrat['restitution'] = null;
  if (!re) noter('restitution_a_jour', 'Restitution du cabinet terminée, complète, postérieure à la dernière modification', false, 'aucune restitution du cabinet terminée');
  else {
    const defauts: string[] = [];
    if (!re.sha256 || !/^[0-9a-f]{64}$/.test(re.sha256) || !re.termine_le) defauts.push('empreinte SHA-256 de l’archive non enregistrée');
    if (!re.journalisee) defauts.push('génération non consignée au journal d’audit');
    if ((re.perimetre?.ecartes ?? []).length > 0 || Number(re.dossiers_hors) > 0) defauts.push(`archive incomplète (${(re.perimetre?.ecartes ?? []).length} dossier(s) écarté(s), ${re.dossiers_hors} hors périmètre)`);
    // Dernière modification : horodatages des tables restituées puis supprimées, et lignes du journal qui modifient des données.
    const colonnes = await client.query<{ t: string; c: string }>(
      `select table_name as t, column_name as c from information_schema.columns where table_schema = 'public' and data_type = 'timestamp with time zone' and column_name <> 'expire_le' order by 1, 2`,
    );
    const posterieures: string[] = [];
    for (const [t, d] of devenirDe) {
      if (d.devenir !== 'restituer_puis_supprimer') continue;
      const cols = colonnes.rows.filter((l) => l.t === t).map((l) => `max(${ident(l.c)}) filter (where ${ident(l.c)} <= now())`);
      if (!cols.length) continue;
      const m = (await client.query<{ m: string | null; apres: boolean }>(`select greatest(${cols.join(', ')})::text as m, coalesce(greatest(${cols.join(', ')}) > $2::timestamptz, false) as apres from ${ident(t)} where cabinet_id = $1`, [id, re.cree_le])).rows[0]!;
      if (m.apres) posterieures.push(`${t} (${m.m})`);
    }
    const j = (await client.query<{ m: string | null; action: string | null }>(
      `select horodatage::text as m, action from journal_audit where cabinet_id = $1 and horodatage > $2::timestamptz and not (action like any ($3::text[])) order by id desc limit 1`,
      [id, re.cree_le, ACTIONS_SANS_MODIFICATION],
    )).rows[0];
    if (j) posterieures.push(`journal d’audit, action « ${j.action} » (${j.m})`);
    if (posterieures.length) defauts.push(`données modifiées après la demande de restitution du ${re.cree_le} : ${posterieures.join(', ')} — une nouvelle restitution est nécessaire`);
    noter('restitution_a_jour', 'Restitution du cabinet terminée, complète, postérieure à la dernière modification', defauts.length === 0, defauts.length ? `restitution ${re.id} : ${defauts.join(' ; ')}` : `restitution ${re.id} demandée le ${re.cree_le}, terminée le ${re.termine_le}, empreinte ${re.sha256}`);
    if (re.sha256 && re.termine_le) restitution = { id: re.id, sha256: re.sha256, taille: re.taille === null ? null : Number(re.taille), demandeeLe: re.cree_le, termineeLe: re.termine_le };
  }

  // 5. Intégrité du journal : vérification STRICTE. En cas d'échec, la procédure s'arrête ; elle ne répare rien.
  const strict = (await client.query<{ r: string | null }>('select journal_audit_verifier($1)::text as r', [id])).rows[0]!.r;
  noter('journal_integre', 'Journal d’audit intègre (vérification stricte)', strict === null, strict === null ? 'chaîne d’empreintes vérifiée de la première à la dernière ligne' : `rupture à la ligne ${strict} : la procédure s’arrête et ne répare rien (diagnostic : editeur.mjs journal-ecarts)`);

  // 6. Aucune obligation de conservation en cours sur une catégorie à supprimer (table politiques_conservation du cabinet).
  const obligations = await client.query<{ categorie: string; immuable: boolean; duree_jours: number | null; en_cours: boolean | null; echeance: string | null; fondement: string | null }>(
    `select categorie, immuable, duree_jours, (cree_le + make_interval(days => duree_jours)) > now() as en_cours, (cree_le + make_interval(days => duree_jours))::date::text as echeance, fondement
       from politiques_conservation where cabinet_id = $1 order by categorie, cree_le`,
    [id],
  );
  const bloquantes: string[] = [];
  for (const o of obligations.rows) {
    const cat = inv.categories.find((c) => c.code === o.categorie || c.tables.some((t) => t.table === o.categorie));
    if (!cat) bloquantes.push(`« ${o.categorie} » : catégorie non reconnue par la politique, ne peut pas être écartée`);
    else if (cat.devenir === 'supprimer' || cat.devenir === 'restituer_puis_supprimer') {
      if (o.immuable) bloquantes.push(`« ${o.categorie} » : conservation immuable déclarée${o.fondement ? ` (${o.fondement})` : ''}`);
      else if (o.en_cours) bloquantes.push(`« ${o.categorie} » : conservation de ${o.duree_jours} jours en cours jusqu’au ${o.echeance}${o.fondement ? ` (${o.fondement})` : ''}`);
    }
  }
  noter('aucune_obligation_de_conservation', 'Aucune obligation de conservation en cours sur une catégorie à supprimer', bloquantes.length === 0, bloquantes.length ? bloquantes.join(' ; ') : `${obligations.rowCount} politique(s) déclarée(s) pour le cabinet, aucune ne s’oppose à la suppression`);

  // 7. Confirmation explicite : identifiant ET nom exact.
  const conf = p.confirmation;
  noter('confirmation', 'Confirmation nommant le cabinet (identifiant et nom exact)', !!conf && conf.cabinetId === id && conf.nom === inv.cabinet.nom, !conf ? 'non fournie (exigée pour exécuter)' : conf.cabinetId === id && conf.nom === inv.cabinet.nom ? 'identifiant et nom conformes' : 'l’identifiant ou le nom confirmé ne correspond pas exactement au cabinet');

  // Ordre des suppressions : une table n'est supprimée qu'après toutes celles qui la référencent.
  const restantes = new Set(aSupprimer);
  const ordre: string[] = [];
  while (restantes.size) {
    const libres = [...restantes].filter((t) => !fk.rows.some((l) => l.parent === t && l.enfant !== t && restantes.has(l.enfant))).sort();
    if (!libres.length) throw new Error(`Fin de contrat : dépendances circulaires entre ${[...restantes].sort().join(', ')}`);
    for (const t of libres) {
      ordre.push(t);
      restantes.delete(t);
    }
  }
  const lignesDe = (t: string) => inv.categories.flatMap((c) => c.tables).find((x) => x.table === t)!.lignes;
  const etapes: EtapeFinDeContrat[] = [];
  const etape = (operation: EtapeFinDeContrat['operation'], table: string | null, lignes: number | null, detail: string) => etapes.push({ rang: etapes.length + 1, operation, table, categorie: table ? devenirDe.get(table)!.categorie : null, lignes, detail });
  for (const [t, d] of devenirDe) if (d.devenir === 'anonymiser') etape('anonymiser', t, lignesDe(t), `mise à vide de ${ANONYMISATION_FIN_DE_CONTRAT[t]?.join(', ') ?? '?'}`);
  for (const t of ordre) etape('supprimer', t, lignesDe(t), devenirDe.get(t)!.devenir === 'restituer_puis_supprimer' ? 'restitué, puis supprimé' : 'supprimé');
  etape('journaliser', 'journal_audit', 1, 'dernière ligne « fin_de_contrat.executee », chaînée à la suite du journal conservé');
  etape('proces_verbal', registre ? 'fins_de_contrat' : null, 1, 'procès-verbal canonique et son empreinte, inscrits au registre de l’éditeur');

  return {
    format: 'comtaple.plan-fin-de-contrat/1',
    simulation: !appliquer,
    delaiGraceJours: grace,
    preconditions: pre,
    executable: pre.every((x) => x.satisfaite),
    etapes,
    conserve: [...devenirDe].filter(([, d]) => d.devenir === 'conserver_jusqu_a').map(([t, d]) => ({ table: t, categorie: d.categorie, lignes: lignesDe(t), conservation: inv.categories.find((c) => c.code === d.categorie)!.conservation })),
    restitution,
    inventaire: inv,
    sauvegardes: LIMITE_SAUVEGARDES,
    abonnement: ab && ab.fin ? { statut: ab.statut, fin: ab.fin } : null,
  };
}

/**
 * Fin de contrat d'un cabinet. SIMULATION par défaut : établit le plan (pré-conditions, ordre, décomptes, objets) dans
 * une transaction en lecture seule, sans rien modifier. Avec `appliquer: true` ET toutes les pré-conditions réunies :
 * anonymise, supprime dans l'ordre des dépendances, inscrit la dernière ligne du journal (qui est CONSERVÉ et reste
 * vérifiable) et le procès-verbal — le tout dans UNE transaction : en cas d'échec ou d'interruption, rien n'est fait.
 * Les objets du stockage se suppriment à part (`objetsFinDeContrat`). Les sauvegardes ne sont pas touchées.
 */
export async function finDeContrat(client: pg.ClientBase, p: ParametresFinDeContrat): Promise<{ simulation: true; plan: PlanFinDeContrat } | { simulation: false; plan: PlanFinDeContrat; procesVerbal: ProcesVerbalFinDeContrat }> {
  const appliquer = p.appliquer === true;
  await client.query(appliquer ? 'begin' : 'begin transaction read only');
  try {
    const role = await exigerAdministration(client);
    const { abonnement, ...plan } = await etablirPlan(client, p, appliquer);
    if (!appliquer) {
      await client.query('rollback');
      return { simulation: true, plan };
    }
    if (!plan.executable || !plan.restitution || !abonnement) throw new RefusFinDeContrat(plan.preconditions.filter((x) => !x.satisfaite).map((x) => `${x.libelle} — ${x.detail}`), plan);
    const id = plan.inventaire.cabinet.id;
    const journalAvant = Number((await client.query<{ n: string }>('select count(*) as n from journal_audit where cabinet_id = $1', [id])).rows[0]!.n);

    for (const e of plan.etapes) {
      if (e.operation === 'anonymiser' && e.table) {
        const cols = ANONYMISATION_FIN_DE_CONTRAT[e.table]!;
        await client.query(`update ${ident(e.table)} set ${cols.map((c) => `${ident(c)} = null`).join(', ')} where cabinet_id = $1 and (${cols.map((c) => `${ident(c)} is not null`).join(' or ')})`, [id]);
      } else if (e.operation === 'supprimer' && e.table) {
        const r = await client.query(`delete from ${ident(e.table)} where cabinet_id = $1`, [id]);
        if (r.rowCount !== e.lignes) throw new Error(`Fin de contrat interrompue : ${e.table} comptait ${e.lignes} ligne(s) au plan, ${r.rowCount} supprimée(s). Les données ont changé pendant l’exécution ; tout est annulé.`);
      } else continue;
      await p.surEtape?.(e);
    }

    // Décomptes après, contrôlés contre le plan : supprimé = 0, conservé ou anonymisé = inchangé.
    const categories: ProcesVerbalFinDeContrat['categories'] = [];
    for (const c of plan.inventaire.categories) {
      const tables: Array<{ table: string; avant: number; apres: number }> = [];
      for (const t of c.tables) {
        // Le journal reçoit sa dernière ligne plus bas ; le registre reçoit le procès-verbal : comptés avant ces deux ajouts.
        const apres = Number((await client.query<{ n: string }>(`select count(*) as n from ${ident(t.table)} where cabinet_id = $1`, [id])).rows[0]!.n);
        const attendu = c.devenir === 'supprimer' || c.devenir === 'restituer_puis_supprimer' ? 0 : t.lignes;
        if (apres !== attendu) throw new Error(`Fin de contrat interrompue : ${t.table} compte ${apres} ligne(s) après exécution, ${attendu} attendue(s). Tout est annulé.`);
        tables.push({ table: t.table, avant: t.lignes, apres });
      }
      categories.push({ code: c.code, libelle: c.libelle, devenir: c.devenir, conservation: c.conservation, tables, avant: c.lignes, apres: tables.reduce((s, t) => s + t.apres, 0) });
    }
    for (const [t, cols] of Object.entries(ANONYMISATION_FIN_DE_CONTRAT)) {
      const reste = Number((await client.query<{ n: string }>(`select count(*) as n from ${ident(t)} where cabinet_id = $1 and (${cols.map((c) => `${ident(c)} is not null`).join(' or ')})`, [id])).rows[0]!.n);
      if (reste) throw new Error(`Fin de contrat interrompue : ${reste} ligne(s) de ${t} non anonymisée(s). Tout est annulé.`);
    }

    // Dernière ligne du journal, chaînée par le déclencheur habituel. Le journal n'est ni réécrit ni supprimé.
    const decomptes = categories.map((c) => ({ code: c.code, devenir: c.devenir, avant: c.avant, apres: c.apres }));
    const ligne = (await client.query<{ id: string; empreinte: string }>(
      `insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id, details) values ($1, 'systeme', 'fin_de_contrat.executee', 'cabinet', $2, $3) returning id::text, empreinte`,
      [id, id, JSON.stringify({ politique: plan.inventaire.politique.version, restitution: plan.restitution.id, empreinteRestitution: plan.restitution.sha256, empreinteDecomptes: sha256Texte(jsonCanonique(decomptes)), lignesSupprimees: categories.reduce((s, c) => s + (c.avant - c.apres), 0) })],
    )).rows[0]!;
    await p.surEtape?.(plan.etapes.find((e) => e.operation === 'journaliser')!);
    const strict = (await client.query<{ r: string | null }>('select journal_audit_verifier($1)::text as r', [id])).rows[0]!.r;
    if (strict !== null) throw new Error(`Fin de contrat interrompue : le journal ne se vérifie plus (ligne ${strict}). Tout est annulé.`);

    const horloge = (await client.query<{ t: string }>(`select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as t`)).rows[0]!.t;
    const { cles: _cles, ...objets } = plan.inventaire.objets;
    const corps: Omit<ProcesVerbalFinDeContrat, 'empreinte'> = {
      format: 'comtaple.proces-verbal-fin-de-contrat/1',
      cabinet: plan.inventaire.cabinet,
      executeLe: horloge,
      executePar: role,
      politique: plan.inventaire.politique,
      delaiGraceJours: plan.delaiGraceJours,
      abonnement,
      restitution: plan.restitution,
      categories,
      journal: { devenir: 'Conservé jusqu’à sa propre échéance (proposée, non arrêtée), jamais réécrit ; dernière ligne « fin_de_contrat.executee ».', lignesAvant: journalAvant, lignesApres: journalAvant + 1, derniereLigne: ligne.id, empreinteTete: ligne.empreinte, verificationStricte: null },
      horsTables: plan.inventaire.horsTables,
      objets: { etat: 'a_supprimer_par_etape_separee', ...objets },
      sauvegardes: LIMITE_SAUVEGARDES,
      reserves: [
        'Les durées de conservation citées sont PROPOSÉES, non arrêtées, et n’ont reçu aucune validation juridique.',
        'Les objets du stockage ne sont pas supprimés par ce procès-verbal : étape séparée, à constater à part.',
        'Les comptes du fournisseur d’identité et la table « utilisateurs » ne sont pas traités.',
      ],
    };
    const procesVerbal: ProcesVerbalFinDeContrat = { ...corps, empreinte: empreinteProcesVerbal(corps) };
    // Le registre n'accepte que le rôle d'administration : un rôle applicatif échoue ici au plus tard, et tout est annulé.
    await client.query(
      `insert into fins_de_contrat (cabinet_id, nom_cabinet, executee_le, politique_version, empreinte_restitution, empreinte_proces_verbal, proces_verbal) values ($1, $2, now(), $3, $4, $5, $6)`,
      [id, procesVerbal.cabinet.nom, procesVerbal.politique.version, procesVerbal.restitution.sha256, procesVerbal.empreinte, jsonCanonique(procesVerbal)],
    );
    await p.surEtape?.(plan.etapes.find((e) => e.operation === 'proces_verbal')!);
    await client.query('commit');
    return { simulation: false, plan, procesVerbal };
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  }
}

/** Procès-verbal enregistré pour un cabinet (texte canonique tel qu'inscrit au registre), ou null. */
export async function lireProcesVerbalFinDeContrat(client: pg.ClientBase, cabinetId: string): Promise<ProcesVerbalFinDeContrat | null> {
  const r = await client.query<{ proces_verbal: string }>('select proces_verbal from fins_de_contrat where cabinet_id = $1', [cabinetId]);
  return r.rowCount ? (JSON.parse(r.rows[0]!.proces_verbal) as ProcesVerbalFinDeContrat) : null;
}

/** Ce dont la suppression des objets a besoin : la classe `Stockage` de @comtaple/plateforme y satisfait. */
export interface StockageObjets {
  lister(prefixe: string): Promise<string[]>;
  supprimer(cles: string[]): Promise<void>;
}

/**
 * Objets du stockage d'un cabinet en fin de contrat : étape SÉPARÉE de la base. SIMULATION par défaut : liste les clés
 * sous les préfixes du cabinet, sans rien supprimer. Avec `appliquer: true` : exige que la fin de contrat ait été
 * exécutée en base (procès-verbal au registre) et la même confirmation ; ne supprime QUE des clés sous les préfixes du
 * cabinet ; refuse si une ligne d'un AUTRE cabinet référence l'une d'elles ; relit le stockage ; consigne au journal.
 * État au 2026-11-19 : exercée uniquement contre un stockage factice en mémoire ; jamais contre un stockage S3.
 */
export async function objetsFinDeContrat(
  client: pg.ClientBase,
  stockage: StockageObjets,
  p: { cabinetId: string; confirmation?: { cabinetId: string; nom: string }; appliquer?: boolean },
): Promise<{ simulation: boolean; prefixes: string[]; cles: string[]; supprimees: number; restantes: number; empreinteListeCles: string }> {
  const prefixes = prefixesObjetsCabinet(p.cabinetId);
  await exigerAdministration(client);
  const cabinet = (await client.query<{ nom: string }>('select nom from cabinets where id = $1', [p.cabinetId])).rows[0];
  if (!cabinet) throw new Error(`Cabinet introuvable : ${p.cabinetId}`);
  const cles = [...new Set((await Promise.all(prefixes.map((x) => stockage.lister(x)))).flat())].sort();
  const etrangeres = cles.filter((k) => !prefixes.some((x) => k.startsWith(x)));
  if (etrangeres.length) throw new Error(`Le stockage a renvoyé ${etrangeres.length} clé(s) hors des préfixes du cabinet : rien n’est supprimé.`);
  const empreinteListeCles = sha256Texte(cles.join('\n'));
  if (p.appliquer !== true) return { simulation: true, prefixes, cles, supprimees: 0, restantes: cles.length, empreinteListeCles };

  if (!p.confirmation || p.confirmation.cabinetId !== p.cabinetId || p.confirmation.nom !== cabinet.nom) throw new Error('Suppression des objets refusée : confirmation absente ou ne nommant pas exactement le cabinet (identifiant et nom).');
  const pv = await client.query(`select 1 from fins_de_contrat where cabinet_id = $1`, [p.cabinetId]);
  if (!pv.rowCount) throw new Error('Suppression des objets refusée : la fin de contrat n’a pas été exécutée en base pour ce cabinet (aucun procès-verbal au registre).');
  // Aucune ligne d'un autre cabinet ne doit référencer un objet de ces préfixes.
  for (const k of COLONNES_CLES_OBJETS) {
    const r = await client.query<{ n: string }>(`select count(*) as n from ${ident(k.table)} where cabinet_id <> $1 and (${prefixes.map((_, i) => `starts_with(${ident(k.colonne)}, $${i + 2})`).join(' or ')})`, [p.cabinetId, ...prefixes]);
    if (Number(r.rows[0]!.n)) throw new Error(`Suppression des objets refusée : ${r.rows[0]!.n} ligne(s) de ${k.table} d’un autre cabinet référencent un objet de ce cabinet.`);
  }
  await stockage.supprimer(cles);
  const restantes = (await Promise.all(prefixes.map((x) => stockage.lister(x)))).flat().length;
  await client.query(
    `insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id, details) values ($1, 'systeme', 'fin_de_contrat.objets_supprimes', 'cabinet', $2, $3)`,
    [p.cabinetId, p.cabinetId, JSON.stringify({ prefixes, supprimees: cles.length - restantes, restantes, empreinteListeCles })],
  );
  if (restantes) throw new Error(`Suppression des objets incomplète : ${restantes} objet(s) subsistent sous les préfixes du cabinet (consigné au journal).`);
  return { simulation: false, prefixes, cles, supprimees: cles.length, restantes, empreinteListeCles };
}
