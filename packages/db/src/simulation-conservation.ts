/**
 * SIMULATIONS de conservation (D-099) : ce qui serait supprimé, anonymisé ou conservé pour un cabinet, table par table,
 * et à quelle échéance, d'après un jeu de paramètres (`durees-conservation.ts`). Fin de vie du journal et des éléments
 * conservés : simulation seulement.
 *
 * Tout ici est en LECTURE SEULE : chaque fonction ouvre une transaction `read only` (la base elle-même refuse alors toute
 * écriture), puis l'annule. Rien n'est supprimé, anonymisé, réécrit. Les échéances sont des dates calculées d'après des
 * durées PROPOSÉES ou fournies par l'éditeur : elles n'ont aucune valeur juridique tant que les durées ne sont pas validées.
 */
import type pg from 'pg';
import { lireEtatJournal } from './ancre-journal.js';
import { type ParametresCharges, type RegleCategorie, delaiEffectifSuppression, echeanceDe } from './durees-conservation.js';
import { POLITIQUE_FIN_DE_CONTRAT, exigerAdministration, inventaireFinDeContrat } from './provisionnement.js';

/** Colonne qui date l'événement, pour les catégories dont le point de départ est « événement » ou « clôture d'exercice ». */
export const COLONNE_DATE_EVENEMENT: Readonly<Record<string, string>> = {
  evenements_ia: 'cree_le',
  journal_audit: 'horodatage',
  anomalies_journal: 'consignee_le',
  abonnements: 'fin',
  echeances_abonnement: 'periode_fin',
  evenements_facturation: 'cree_le',
  restitutions_cabinet: 'cree_le',
  politiques_conservation: 'cree_le',
  fins_de_contrat: 'executee_le',
};

export type EtatEcheance = 'echue' | 'a_echoir' | 'non_calculable';
export interface LigneSimulation {
  categorie: string;
  table: string;
  devenir: string;
  lignes: number;
  /** Ce qui serait fait, en une phrase. */
  action: string;
  pointDeDepart: string;
  /** Première et dernière échéance (AAAA-MM-JJ) : une seule valeur pour un point de départ unique, deux pour un événement daté ligne par ligne. */
  premiereEcheance: string | null;
  derniereEcheance: string | null;
  etat: EtatEcheance;
  apresEcheance: string;
  detail: string;
}
export interface SimulationConservation {
  format: 'comtaple.simulation-conservation/1';
  cabinet: { id: string; nom: string };
  parametres: { version: string; statut: string; empreinte: string; source: string; nonValide: boolean };
  aujourdhui: string;
  abonnement: { statut: string; fin: string | null } | null;
  /** Délai effectif (jours) entre la fin de l'abonnement et l'exécution de la fin de contrat, d'après les paramètres. */
  delaiExecutionJours: number;
  executionAuPlusTot: string | null;
  lignes: LigneSimulation[];
  avertissements: string[];
}

const supprime = (d: string) => d === 'supprimer' || d === 'restituer_puis_supprimer';
const etatDe = (derniere: string | null, premiere: string | null, aujourdhui: string): EtatEcheance => (premiere === null || derniere === null ? 'non_calculable' : derniere <= aujourdhui ? 'echue' : 'a_echoir');

/** Plus petite et plus grande date d'événement d'une table pour un cabinet (colonne connue de COLONNE_DATE_EVENEMENT). */
async function bornesDates(client: pg.ClientBase, table: string, cabinetId: string): Promise<{ min: string | null; max: string | null }> {
  const col = COLONNE_DATE_EVENEMENT[table];
  if (!col) return { min: null, max: null };
  const r = await client.query<{ a: string | null; b: string | null }>(`select min("${col}")::date::text as a, max("${col}")::date::text as b from "${table}" where cabinet_id = $1`, [cabinetId]);
  return { min: r.rows[0]!.a, max: r.rows[0]!.b };
}
/** Fin (31 décembre) de l'exercice civil d'une date : approximation de la « clôture de l'exercice de l'éditeur ». */
const clotureCivile = (iso: string | null): string | null => (iso ? `${iso.slice(0, 4)}-12-31` : null);

/**
 * Pour un cabinet : table par table, ce qui serait supprimé / anonymisé / conservé et à quelle échéance. Lecture seule.
 * `aujourdhui` (AAAA-MM-JJ) est fixable pour les essais.
 */
export async function simulerConservationCabinet(client: pg.ClientBase, cabinetId: string, chargees: ParametresCharges, options: { aujourdhui?: string; graceJours?: number } = {}): Promise<SimulationConservation> {
  const inv = await inventaireFinDeContrat(client, cabinetId);
  await client.query('begin transaction read only');
  try {
    await exigerAdministration(client);
    const aujourdhui = options.aujourdhui ?? (await client.query<{ d: string }>('select current_date::text as d')).rows[0]!.d;
    const p = chargees.parametres;
    const ab = (await client.query<{ statut: string; fin: string | null }>('select statut, fin::text from abonnements where cabinet_id = $1', [cabinetId])).rows[0] ?? null;
    const supprimees = inv.categories.filter((c) => supprime(c.devenir)).map((c) => c.code);
    const delai = delaiEffectifSuppression(p, supprimees, options.graceJours);
    const fin = ab?.fin ?? null;
    const avertissements: string[] = [];
    if (chargees.nonValide) avertissements.push('Durées : PROPOSITION NON VALIDÉE. Ces échéances n’ont aucune valeur juridique ; une exécution réelle exige --durees-validees=<référence>.');
    if (!ab) avertissements.push('Aucun abonnement : la résiliation ne peut pas être constatée, les échéances dépendantes ne sont pas calculables.');
    else if (ab.statut !== 'resilie') avertissements.push(`Abonnement « ${ab.statut} », non résilié : aucune échéance de fin de contrat ne court encore.`);
    else if (!fin) avertissements.push('Abonnement résilié sans date de fin : échéances non calculables.');
    const depart = ab?.statut === 'resilie' ? fin : null;
    const executionAuPlusTot = depart ? echeanceDe({ duree: { jours: delai }, pointDeDepart: 'fin_de_contrat', apresEcheance: 'supprimer' }, depart) : null;
    const lignes: LigneSimulation[] = [];
    for (const cat of inv.categories) {
      const regle: RegleCategorie = p.categories[cat.code]!;
      for (const t of cat.tables) {
        let premiere: string | null = null;
        let derniere: string | null = null;
        let action: string;
        let detail = '';
        let pointDeDepart = 'fin de contrat';
        if (supprime(cat.devenir)) {
          premiere = derniere = executionAuPlusTot;
          action = cat.devenir === 'restituer_puis_supprimer' ? 'restituer (archive du cabinet) puis SUPPRIMER à l’exécution de la fin de contrat' : 'SUPPRIMER à l’exécution de la fin de contrat';
          detail = `exécution possible à partir de la fin de l’abonnement + ${delai} jour(s)`;
        } else {
          pointDeDepart = regle.pointDeDepart === 'fin_de_contrat' ? 'fin de contrat' : regle.pointDeDepart === 'evenement' ? `événement (${COLONNE_DATE_EVENEMENT[t.table] ?? 'colonne non déclarée'})` : 'clôture de l’exercice de l’éditeur (31 décembre de l’année de l’événement — approximation)';
          if (regle.pointDeDepart === 'fin_de_contrat') premiere = derniere = echeanceDe(regle, depart);
          else if (t.lignes === 0) detail = 'aucune ligne';
          else {
            const b = await bornesDates(client, t.table, cabinetId);
            if (regle.pointDeDepart === 'cloture_exercice_editeur') {
              premiere = echeanceDe(regle, clotureCivile(b.min));
              derniere = echeanceDe(regle, clotureCivile(b.max));
            } else {
              premiere = echeanceDe(regle, b.min);
              derniere = echeanceDe(regle, b.max);
            }
          }
          if ('jusqu_au' in regle.duree) detail = `conservation jusqu’au ${regle.duree.jusqu_au}`;
          else detail ||= `conservation ${regle.duree.jours} jour(s) à partir du point de départ`;
          const apres = regle.apresEcheance === 'supprimer' ? 'SUPPRIMER' : regle.apresEcheance === 'pseudonymiser' ? 'PSEUDONYMISER' : 'SCELLER (export + ancre, revue humaine ; jamais réécrit ni purgé automatiquement)';
          action = cat.devenir === 'anonymiser'
            ? `ANONYMISER à l’exécution (${t.lignes} ligne(s)), puis, à l’échéance : ${apres}`
            : `CONSERVER jusqu’à l’échéance, puis ${apres}`;
          if (t.lignes === 0 && cat.devenir !== 'anonymiser') action = 'rien à conserver (aucune ligne)';
        }
        lignes.push({ categorie: cat.code, table: t.table, devenir: cat.devenir, lignes: t.lignes, action, pointDeDepart, premiereEcheance: t.lignes === 0 ? null : premiere, derniereEcheance: t.lignes === 0 ? null : derniere, etat: t.lignes === 0 ? 'non_calculable' : etatDe(derniere, premiere, aujourdhui), apresEcheance: regle.apresEcheance, detail });
      }
    }
    return { format: 'comtaple.simulation-conservation/1', cabinet: { id: inv.cabinet.id, nom: inv.cabinet.nom }, parametres: { version: p.version, statut: p.statut, empreinte: chargees.empreinte, source: chargees.source, nonValide: chargees.nonValide }, aujourdhui, abonnement: ab, delaiExecutionJours: delai, executionAuPlusTot, lignes, avertissements };
  } finally {
    await client.query('rollback');
  }
}

// ───────────────────────────── Fin de vie du journal et des éléments conservés ─────────────────────────────

export interface SimulationFinDeVieJournal {
  format: 'comtaple.simulation-fin-de-vie-journal/1';
  cabinetId: string;
  aujourdhui: string;
  regle: RegleCategorie;
  journal: { lignes: number; premiere: string | null; derniere: string | null; echeancesPassees: number; premiereEcheance: string | null; derniereEcheance: string | null };
  etat: { derniereLigne: string | null; empreinteTete: string | null; verificationStricte: string | null };
  /** Lignes par famille d'action (préfixe avant le premier point). */
  familles: Array<{ famille: string; lignes: number }>;
  /** Données personnelles retrouvées DANS les lignes du journal (adresses de courriel) : le journal ne peut pas être réécrit, elles y resteraient. */
  donneesPersonnellesDansLeJournal: { lignesAvecCourriel: number; actions: Array<{ action: string; lignes: number }> };
  /** Fiches de la table « utilisateurs » désignées par les lignes (acteur_id) : seule leur pseudonymisation efface le lien avec une personne. */
  acteurs: { distincts: number; fichesExistantes: number; fichesSansAppartenance: number };
  /** Ce que la procédure ferait à l'échéance, sans jamais modifier une ligne du journal. */
  plan: string[];
  ancre: string;
  avertissements: string[];
}

/**
 * Fin de vie du journal d'un cabinet : SIMULATION. Le journal n'est jamais réécrit ni purgé (ses empreintes en chaîne
 * rendraient toute altération détectable, et sa suppression exigerait de désactiver ses protections). Ce que la
 * simulation établit : combien de lignes arrivent à échéance, ce que les lignes contiennent de personnel, quelles fiches
 * elles désignent, et le plan de scellement (export final vérifiable + ancre) qui précéderait toute décision humaine.
 */
export async function simulerFinDeVieJournal(client: pg.ClientBase, cabinetId: string, chargees: ParametresCharges, options: { aujourdhui?: string } = {}): Promise<SimulationFinDeVieJournal> {
  const etatJournal = await lireEtatJournal(client, cabinetId);
  await client.query('begin transaction read only');
  try {
    await exigerAdministration(client);
    const aujourdhui = options.aujourdhui ?? (await client.query<{ d: string }>('select current_date::text as d')).rows[0]!.d;
    const regle = chargees.parametres.categories.journal_audit!;
    const b = (await client.query<{ n: string; a: string | null; b: string | null }>(`select count(*)::text as n, min(horodatage)::date::text as a, max(horodatage)::date::text as b from journal_audit where cabinet_id = $1`, [cabinetId])).rows[0]!;
    const premiere = b.a ? echeanceDe(regle, b.a) : null;
    const derniere = b.b ? echeanceDe(regle, b.b) : null;
    // Lignes dont l'échéance est passée : horodatage + durée <= aujourd'hui (ou toutes si « jusqu'au » est passé).
    const passees = 'jusqu_au' in regle.duree
      ? (regle.duree.jusqu_au <= aujourdhui ? Number(b.n) : 0)
      : Number((await client.query<{ n: string }>(`select count(*)::text as n from journal_audit where cabinet_id = $1 and (horodatage::date + $2::int) <= $3::date`, [cabinetId, regle.duree.jours, aujourdhui])).rows[0]!.n);
    const familles = (await client.query<{ f: string; n: string }>(`select split_part(action, '.', 1) as f, count(*)::text as n from journal_audit where cabinet_id = $1 group by 1 order by 2 desc, 1`, [cabinetId])).rows.map((r) => ({ famille: r.f, lignes: Number(r.n) }));
    const motif = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}';
    const personnelles = (await client.query<{ action: string; n: string }>(`select action, count(*)::text as n from journal_audit where cabinet_id = $1 and (details::text ~* $2 or coalesce(cible_id, '') ~* $2) group by 1 order by 2 desc, 1`, [cabinetId, motif])).rows;
    const acteurs = (await client.query<{ distincts: string; existantes: string; sans: string }>(
      `select count(distinct j.acteur_id)::text as distincts,
              count(distinct u.id)::text as existantes,
              count(distinct u.id) filter (where not exists (select 1 from appartenances a where a.utilisateur_id = u.id))::text as sans
         from journal_audit j left join utilisateurs u on u.id = j.acteur_id where j.cabinet_id = $1 and j.acteur_id is not null`,
      [cabinetId],
    )).rows[0]!;
    const avertissements: string[] = [];
    if (chargees.nonValide) avertissements.push('Durées : PROPOSITION NON VALIDÉE. Aucune valeur juridique.');
    if (etatJournal.verificationStricte !== null) avertissements.push(`Journal NON intègre (rupture à la ligne ${etatJournal.verificationStricte}) : aucun scellement ne serait établi.`);
    const lignesCourriel = personnelles.reduce((s, r) => s + Number(r.n), 0);
    if (lignesCourriel > 0) avertissements.push(`${lignesCourriel} ligne(s) du journal contiennent une adresse de courriel : le journal ne se réécrit pas, elles y subsisteraient. À arbitrer avec le DPO (voir docs/conservation.md, « Fin de vie du journal »).`);
    return {
      format: 'comtaple.simulation-fin-de-vie-journal/1',
      cabinetId,
      aujourdhui,
      regle,
      journal: { lignes: Number(b.n), premiere: b.a, derniere: b.b, echeancesPassees: passees, premiereEcheance: premiere, derniereEcheance: derniere },
      etat: { derniereLigne: etatJournal.derniereLigne, empreinteTete: etatJournal.empreinteTete, verificationStricte: etatJournal.verificationStricte },
      familles,
      donneesPersonnellesDansLeJournal: { lignesAvecCourriel: lignesCourriel, actions: personnelles.map((r) => ({ action: r.action, lignes: Number(r.n) })) },
      acteurs: { distincts: Number(acteurs.distincts), fichesExistantes: Number(acteurs.existantes), fichesSansAppartenance: Number(acteurs.sans) },
      plan: [
        '1. Vérification stricte de la chaîne (journal_audit_verifier) : en cas de rupture, arrêt, aucune réparation.',
        '2. Export final du journal du cabinet (format comtaple.journal-export/1), vérifiable sans base ; ancre finale chaînée à la précédente.',
        '3. Dépôt de l’export et de l’ancre HORS de portée de l’administrateur de la base (aucune destination indépendante n’est configurée : externe).',
        '4. Pseudonymisation des fiches « utilisateurs » désignées par acteur_id et sans appartenance (le lien entre une ligne et une personne disparaît ; les lignes restent identiques).',
        `5. À l'échéance : ${regle.apresEcheance === 'sceller' ? 'décision humaine documentée (conservation prolongée, ou destruction du journal du cabinet par une procédure distincte, jamais automatique)' : regle.apresEcheance}. Aucune ligne n'est modifiée par les étapes 1 à 4.`,
      ],
      ancre: 'Une ancre n’a de valeur que conservée hors de portée de qui administre la base ; cette simulation n’en dépose aucune.',
      avertissements,
    };
  } finally {
    await client.query('rollback');
  }
}
