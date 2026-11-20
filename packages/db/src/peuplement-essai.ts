/**
 * Peuplement GÉNÉRIQUE d'un cabinet d'essai : une ligne au moins dans CHAQUE table portant `cabinet_id`, d'après le
 * catalogue de la base. Copie assumée de la partie correspondante de `fin-de-contrat.itest.ts` (laissée intacte pour ne
 * pas toucher aux tests existants), utilisée par les essais de conservation et la mesure de la transaction.
 * À n'employer que sur une base d'essai jetable.
 */
import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { COLONNES_CLES_OBJETS } from './provisionnement.js';

export interface Cabinet { id: string; nom: string; utilisateur: string; lignes: Map<string, Record<string, unknown>> }

export interface Colonne { t: string; col: string; typname: string; typtype: string; cat: string; nn: boolean; def: boolean }
export interface Cle { enfant: string; col: string; parent: string; pcol: string }

export function creerPeuplement(admin: pg.Client) {
  const alea = () => randomUUID().slice(0, 8);
let colonnes: Colonne[];
let cles: Cle[];
let controles: Array<{ t: string; d: string }>;
let enums: Map<string, string>;
let tablesCabinet: string[];
let globalesPartagees: Map<string, Record<string, unknown>> = new Map();

async function lireCatalogue(): Promise<void> {
  colonnes = (
    await admin.query<Colonne>(
      `select c.relname as t, a.attname as col, ty.typname, ty.typtype, ty.typcategory as cat, a.attnotnull as nn, (a.atthasdef or a.attidentity <> '' or a.attgenerated <> '') as def
         from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped join pg_type ty on ty.oid = a.atttypid
        where n.nspname = 'public' and c.relkind = 'r' order by c.relname, a.attnum`,
    )
  ).rows;
  cles = (
    await admin.query<Cle>(
      `select e.relname as enfant, a.attname as col, pa.relname as parent, pb.attname as pcol from pg_constraint c join pg_class e on e.oid = c.conrelid join pg_class pa on pa.oid = c.confrelid
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] join pg_attribute pb on pb.attrelid = c.confrelid and pb.attnum = c.confkey[1]
        where c.contype = 'f' and c.connamespace = 'public'::regnamespace`,
    )
  ).rows;
  controles = (await admin.query<{ t: string; d: string }>(`select e.relname as t, pg_get_constraintdef(c.oid) as d from pg_constraint c join pg_class e on e.oid = c.conrelid where c.contype = 'c' and c.connamespace = 'public'::regnamespace`)).rows;
  enums = new Map((await admin.query<{ typname: string; premier: string }>(`select t.typname, (array_agg(e.enumlabel order by e.enumsortorder))[1] as premier from pg_enum e join pg_type t on t.oid = e.enumtypid group by 1`)).rows.map((l) => [l.typname, l.premier]));
  tablesCabinet = [...new Set(colonnes.filter((c) => c.col === 'cabinet_id').map((c) => c.t))].sort();
}

const REFERENCES_LAISSEES_VIDES = new Set(['reanalyses_destinataire_pieces.extraction_apres_id']);
/** Valeurs imposées par une contrainte que le peuplement générique ne sait pas deviner. */
const VALEURS: Record<string, (c: Cabinet | null) => unknown> = {
  'invitations.email': () => `essai-${alea()}@exemple.test`,
  'invitations.role': () => 'collaborateur',
  'immobilisations.compte_immobilisation': () => '2183',
  // Provenance d'une reprise par import : l'identifiant de la reprise et le numéro de ligne vont ensemble (contrainte de la base).
  'immobilisations.reprise_ligne': () => 2,
  'politiques_conservation.categorie': () => 'journal_audit', // catégorie conservée : ne s'oppose à aucune suppression
  'abonnements.statut': () => 'resilie',
  'liens_tiers.decision': () => 'confirme',
  'liens_tiers.cle_comptable': () => 'aux:411ESSAI',
  'liens_tiers.cle_piece': () => 'siren:123456789',
  // Lien de comptabilisation : l'objet est la pièce, à une version d'extraction donnée.
  'liens_factures.type': () => 'comptabilisation',
  'liens_factures.decision': () => 'confirme',
  'liens_factures.objet': (c) => c?.lignes.get('documents')?.id,
  'liens_factures.version_extraction': () => 1,
  // Réanalyse du destinataire : formes contrôlées par la base (une simulation sans simulation de référence ; rapport d'une pièce en attente).
  'reanalyses_destinataire.mode': () => 'simulation',
  'reanalyses_destinataire.statut': () => 'en_attente',
  'reanalyses_destinataire.taille_lot': () => 50,
  'reanalyses_destinataire.nb_pieces': () => 1,
  'reanalyses_destinataire_pieces.statut': () => 'en_attente',
  'reanalyses_destinataire_pieces.execution': () => false,
  // Reprise des immobilisations par import : empreintes hexadécimales, décomptes cohérents, ligne rejetée avec son motif (formes contrôlées par la base).
  'reprises_immobilisations.sha256': () => createHash('sha256').update(alea()).digest('hex'),
  'reprises_immobilisations.empreinte_apercu': () => createHash('sha256').update(alea()).digest('hex'),
  'reprises_immobilisations.empreinte_correspondance': () => createHash('sha256').update(alea()).digest('hex'),
  'reprises_immobilisations.taille': () => 100,
  'reprises_immobilisations.separateur': () => ';',
  'reprises_immobilisations.nb_lignes': () => 1,
  'reprises_immobilisations.nb_creees': () => 1,
  'reprises_immobilisations.nb_ignorees': () => 0,
  'reprises_immobilisations.nb_rejetees': () => 0,
  'lignes_reprise_immobilisations.sha256': () => createHash('sha256').update(alea()).digest('hex'),
  'lignes_reprise_immobilisations.statut': () => 'rejetee',
  'lignes_reprise_immobilisations.motif': () => 'Ligne d’essai rejetée',
  // Réglage de la tolérance de montant (D-096) : valeur dans les bornes, motif non vide.
  'reglages_tiers_factures.tolerance_montant': () => '5.00',
  'reglages_tiers_factures.motif': () => 'Réglage d’essai',
  // Notifications poussées : formes contrôlées par la base (empreinte hexadécimale, enveloppe chiffrée, type).
  'abonnements_pousses.empreinte_point_acces': () => createHash('sha256').update(alea()).digest('hex'),
  'abonnements_pousses.empreinte_cle_vapid': () => createHash('sha256').update(alea()).digest('hex'),
  'abonnements_pousses.service': () => 'fcm',
  'abonnements_pousses.secrets_chiffres': () => 'a1.p-essai.aaaa.bbbb.cccc',
  'abonnements_pousses.agent': () => 'Chrome sur Android',
  'envois_pousses.type': () => 'document.complement_demande',
};

function valeur(c: Colonne, cabinet: Cabinet | null): unknown {
  const cabinetId = cabinet?.id ?? null;
  const imposee = VALEURS[`${c.t}.${c.col}`];
  if (imposee) return imposee(cabinet);
  if (cabinetId && COLONNES_CLES_OBJETS.some((k) => k.table === c.t && k.colonne === c.col)) return `cabinets/${cabinetId}/essai/${c.t}-${c.col}-${alea()}`;
  if (c.typtype === 'e') return enums.get(c.typname);
  if (c.cat === 'A') return '{}';
  switch (c.typname) {
    case 'uuid':
      return randomUUID();
    case 'text':
    case 'varchar': {
      // Première valeur admise par une contrainte « colonne = ANY (ARRAY[...]) », sinon un texte unique.
      for (const k of controles.filter((x) => x.t === c.t)) {
        const m = new RegExp(`\\(${c.col} = ANY \\(ARRAY\\['([^']+)'`).exec(k.d);
        if (m) return m[1];
      }
      return `essai-${c.col}-${alea()}`;
    }
    case 'int2':
    case 'int4':
    case 'int8':
      return 12;
    case 'numeric':
    case 'float4':
    case 'float8':
      return '100.00';
    case 'bool':
      return false;
    case 'date':
      return '2025-01-01';
    case 'timestamptz':
    case 'timestamp':
      // Une heure dans le passé : l'horloge de l'hôte et celle de la VM de la base peuvent différer de plusieurs
      // millisecondes ; une valeur « maintenant » côté hôte pouvait paraître POSTÉRIEURE à la restitution créée par la base.
      return new Date(Date.now() - 3_600_000);
    case 'jsonb':
    case 'json':
      return '{}';
    case 'bytea':
      return Buffer.from('essai');
    default:
      throw new Error(`Peuplement générique : type ${c.typname} non géré (${c.t}.${c.col}) — compléter VALEURS dans fin-de-contrat.itest.ts`);
  }
}


async function inserer(t: string, c: Cabinet | null): Promise<Record<string, unknown>> {
  const noms: string[] = [];
  const valeurs: unknown[] = [];
  for (const col of colonnes.filter((x) => x.t === t)) {
    const fk = cles.find((k) => k.enfant === t && k.col === col.col);
    // Références facultatives que la contrainte de la table veut vides dans la ligne d'essai (rapport d'une pièce « en attente »).
    if (!col.nn && REFERENCES_LAISSEES_VIDES.has(`${t}.${col.col}`)) continue;
    let v: unknown;
    if (col.col === 'cabinet_id' && c) v = c.id;
    else if (fk) {
      if (fk.parent === 'cabinets') v = c?.id;
      else if (fk.parent === 'utilisateurs') v = c?.utilisateur;
      else if (tablesCabinet.includes(fk.parent)) v = c?.lignes.get(fk.parent)?.[fk.pcol];
      else {
        // Référentiel partagé (offres, évolutions réglementaires…) : une ligne commune à tous les cabinets d'essai.
        if (!globalesPartagees.has(fk.parent)) globalesPartagees.set(fk.parent, await inserer(fk.parent, null));
        v = globalesPartagees.get(fk.parent)![fk.pcol];
      }
      if (v === undefined) {
        if (col.nn) throw new Error(`Peuplement générique : ${t}.${col.col} référence ${fk.parent}, pas encore peuplée`);
        continue;
      }
    } else if ((col.nn && !col.def) || VALEURS[`${t}.${col.col}`] || COLONNES_CLES_OBJETS.some((k) => k.table === t && (k.colonne === col.col || k.taille === col.col))) v = valeur(col, c);
    else continue;
    noms.push(`"${col.col}"`);
    valeurs.push(v);
  }
  try {
    return (await admin.query(`insert into "${t}" (${noms.join(', ')}) values (${noms.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, valeurs)).rows[0];
  } catch (e) {
    throw new Error(`Peuplement générique de ${t} impossible : ${(e as Error).message} — compléter VALEURS dans fin-de-contrat.itest.ts`);
  }
}

/** Tables portant cabinet_id, parents avant enfants. */
function ordrePeuplement(): string[] {
  const restantes = new Set(tablesCabinet);
  const ordre: string[] = [];
  while (restantes.size) {
    const libres = [...restantes].filter((t) => !cles.some((k) => k.enfant === t && k.parent !== t && restantes.has(k.parent))).sort();
    // Dépendances circulaires : on avance quand même ; une référence obligatoire non satisfaite échouera avec un message clair.
    const lot = libres.length ? libres : [[...restantes].sort()[0]!];
    for (const t of lot) {
      ordre.push(t);
      restantes.delete(t);
    }
  }
  return ordre;
}

/** Le registre des procès-verbaux n'est écrit que par la procédure elle-même. */
const NON_PEUPLEES = ['fins_de_contrat'];

/** Cabinet peuplé dans toutes les tables, résilié depuis 200 jours. Sans restitution terminée (voir `restituer`). */
async function peupler(nom: string): Promise<Cabinet> {
  const id = (await admin.query<{ id: string }>('insert into cabinets (nom) values ($1) returning id', [nom])).rows[0]!.id;
  const utilisateur = (await admin.query<{ id: string }>('insert into utilisateurs (sujet_oidc, email, nom) values ($1, $2, $3) returning id', [`essai-${alea()}-${alea()}`, `membre-${alea()}@exemple.test`, `Membre de ${nom}`])).rows[0]!.id;
  const c: Cabinet = { id, nom, utilisateur, lignes: new Map() };
  for (const t of ordrePeuplement()) if (!NON_PEUPLEES.includes(t)) c.lignes.set(t, await inserer(t, c));
  await admin.query(`update abonnements set fin = current_date - 200, motif_resiliation = 'essai' where cabinet_id = $1`, [id]);
  return c;
}

const EMPREINTE_ARCHIVE = (c: Cabinet) => createHash('sha256').update(`archive de ${c.id}`).digest('hex');

/** Restitution du cabinet terminée MAINTENANT, complète, d'empreinte enregistrée et consignée au journal. */
async function restituer(c: Cabinet, options: { ecartes?: unknown[]; sha256?: string | null } = {}): Promise<string> {
  const inclus = (await admin.query<{ id: string }>('select id from entites where cabinet_id = $1', [c.id])).rows.map((l) => l.id);
  const id = (
    await admin.query<{ id: string }>(
      `insert into restitutions_cabinet (cabinet_id, statut, perimetre, cle_archive, sha256, taille, demande_par, termine_le) values ($1, 'termine', $2, $3, $4, 4096, $5, now()) returning id`,
      [c.id, JSON.stringify({ inclus, ecartes: options.ecartes ?? [] }), `cabinets/${c.id}/restitutions/cabinet-${alea()}.zip`, options.sha256 === undefined ? EMPREINTE_ARCHIVE(c) : options.sha256, c.utilisateur],
    )
  ).rows[0]!.id;
  await admin.query(`insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id) values ($1, 'systeme', 'restitution_cabinet.generee', 'restitution_cabinet', $2)`, [c.id, id]);
  return id;
}

  const pret = async (nom: string) => {
    const c = await peupler(`${nom} ${alea()} (essai)`);
    await restituer(c);
    return c;
  };
  return {
    lireCatalogue, peupler, restituer, pret, alea, inserer, EMPREINTE_ARCHIVE,
    get colonnes() { return colonnes; },
    get cles() { return cles; },
    get tablesCabinet() { return tablesCabinet; },
  };
}
