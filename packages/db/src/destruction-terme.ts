/**
 * DESTRUCTION À TERME des éléments conservés après une fin de contrat (D-100).
 *
 * La fin de contrat (`provisionnement.ts`) supprime ou restitue la plupart des données, mais CONSERVE, pour une durée
 * paramétrable (`durees-conservation.ts`), la facturation, le registre des restitutions du cabinet, les politiques
 * déclarées, le journal d'audit et le procès-verbal lui-même. Ce module écrit la fin de ces durées :
 *
 *  - `planDestructionTerme` : SIMULATION (transaction en lecture seule) : pour chaque table conservée, combien de lignes
 *    sont échues, quand arrive la prochaine échéance, ce qui bloque ;
 *  - `detruireElementsConservesEssai` : destruction des lignes ÉCHUES de la facturation, des restitutions du cabinet, des
 *    politiques et des traces d'IA anonymisées ; une transaction par catégorie, rapport JSON par ligne, reprise,
 *    idempotence ;
 *  - `cloturerCabinetEssai` : dernière étape (procès-verbal, ligne du cabinet), précédée d'un CERTIFICAT de destruction
 *    écrit hors base. Le journal, lui, a sa propre procédure (`journal-fin-de-vie.ts`) : scellement puis décision humaine.
 *
 * DÉSACTIVÉ PAR CONSTRUCTION : chaque exécution exige (1) une base d'ESSAI isolée (`exigerBaseEssai` : nom
 * `comtaple_essai_…`, distincte de la base configurée), (2) la référence de validation des durées, (3) la confirmation
 * du cabinet (identifiant et nom), (4) la fin de contrat exécutée (procès-verbal au registre). Aucune exécution contre la
 * base réelle n'est écrite : la détruire demanderait, pour le procès-verbal et le journal, de neutraliser des
 * protections d'ajout seul, ce qui n'a de sens qu'après validation des durées (D-100).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import type pg from 'pg';
import { exigerBaseEssai } from './comptes-fin-de-contrat.js';
import { type ParametresCharges, type RegleCategorie, ajouterJours, exigerReferenceValidation, traceValidation } from './durees-conservation.js';
import { POLITIQUE_FIN_DE_CONTRAT, type ProcesVerbalFinDeContrat, exigerAdministration, jsonCanonique, lireProcesVerbalFinDeContrat } from './provisionnement.js';
import { COLONNE_DATE_EVENEMENT } from './simulation-conservation.js';

/** Catégories détruites par `detruireElementsConservesEssai`, dans cet ordre (les autres ont leur procédure propre). */
export const CATEGORIES_A_TERME = ['traces_ia', 'abonnement_facturation', 'restitutions_cabinet', 'politiques_conservation'] as const;
export const CATEGORIE_JOURNAL = 'journal_audit';
export const CATEGORIE_PROCES_VERBAL = 'fin_de_contrat';
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const IDENTIFIANT = /^[a-z_][a-z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ident = (n: string): string => {
  if (!IDENTIFIANT.test(n)) throw new Error(`Identifiant SQL inattendu : ${n}`);
  return `"${n}"`;
};
const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

/** Écriture atomique d'un fichier (écriture dans un fichier voisin, puis renommage) : jamais de fichier à moitié écrit. */
export function ecrireAtomique(chemin: string, contenu: string): void {
  mkdirSync(dirname(chemin), { recursive: true });
  const tmp = `${chemin}.tmp-${process.pid}`;
  writeFileSync(tmp, contenu, { mode: 0o600 });
  renameSync(tmp, chemin);
}

/**
 * Expression SQL (de type date) de l'échéance d'une ligne d'une table, d'après la règle de sa catégorie.
 * `depart` : fin de l'abonnement (AAAA-MM-JJ) pour le point de départ « fin de contrat ».
 * Toute valeur insérée dans le texte SQL est validée (entier ou date ISO) ou vient de la liste fermée des colonnes.
 */
export function expressionEcheance(table: string, regle: RegleCategorie, depart: string | null): string {
  if ('jusqu_au' in regle.duree) {
    if (!DATE_ISO.test(regle.duree.jusqu_au)) throw new Error(`Date « jusqu_au » invalide : ${regle.duree.jusqu_au}`);
    return `'${regle.duree.jusqu_au}'::date`;
  }
  const j = regle.duree.jours;
  if (!Number.isInteger(j) || j < 0) throw new Error(`Durée invalide : ${String(j)}`);
  if (regle.pointDeDepart === 'fin_de_contrat') {
    if (depart === null) return 'null::date';
    if (!DATE_ISO.test(depart)) throw new Error(`Point de départ invalide : ${depart}`);
    return `'${ajouterJours(depart, j)}'::date`;
  }
  const col = COLONNE_DATE_EVENEMENT[table];
  if (!col) throw new Error(`Aucune colonne de date déclarée pour ${table} (COLONNE_DATE_EVENEMENT)`);
  return regle.pointDeDepart === 'evenement' ? `((${ident(col)})::date + ${j})` : `(make_date(extract(year from ${ident(col)})::int, 12, 31) + ${j})`;
}

async function tablesACabinet(client: pg.ClientBase): Promise<string[]> {
  const r = await client.query<{ t: string }>(
    `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'cabinet_id' and not a.attisdropped) order by 1`,
  );
  return r.rows.map((l) => l.t);
}
interface Fk { enfant: string; colonne: string; parent: string; colonneParent: string }
async function clesEtrangeres(client: pg.ClientBase): Promise<Fk[]> {
  return (
    await client.query<Fk>(
      `select e.relname as enfant, a.attname as colonne, pa.relname as parent, pb.attname as "colonneParent" from pg_constraint c
         join pg_class e on e.oid = c.conrelid join pg_class pa on pa.oid = c.confrelid
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] join pg_attribute pb on pb.attrelid = c.confrelid and pb.attnum = c.confkey[1]
        where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1`,
    )
  ).rows;
}
/** Tables d'une catégorie, les enfants avant leurs parents (ordre des suppressions). */
function enfantsAvantParents(tables: readonly string[], fks: readonly Fk[]): string[] {
  const reste = [...tables];
  const ordre: string[] = [];
  while (reste.length) {
    const i = reste.findIndex((t) => !fks.some((f) => f.parent === t && f.enfant !== t && reste.includes(f.enfant)));
    ordre.push(...reste.splice(i === -1 ? 0 : i, 1));
  }
  return ordre;
}

const categorie = (code: string) => {
  const c = POLITIQUE_FIN_DE_CONTRAT.categories.find((x) => x.code === code);
  if (!c) throw new Error(`Catégorie inconnue de la politique : ${code}`);
  return c;
};

// ───────────────────────────── Simulation ─────────────────────────────

export interface LignePlanDestruction {
  categorie: string;
  table: string;
  total: number;
  echues: number;
  /** Prochaine échéance parmi les lignes non échues (AAAA-MM-JJ). */
  prochaineEcheance: string | null;
}
export interface CategoriePlanDestruction {
  code: string;
  libelle: string;
  /** vide : rien à détruire ; echue : tout est échu ; partielle : une partie seulement ; a_echoir : rien n'est échu. */
  etat: 'vide' | 'a_echoir' | 'partielle' | 'echue';
  procedure: 'destruction_a_terme' | 'journal_scelle_puis_decision_humaine' | 'cloture_du_cabinet';
  tables: LignePlanDestruction[];
}
export interface PlanDestructionTerme {
  format: 'comtaple.plan-destruction-terme/1';
  cabinet: { id: string; nom: string };
  aujourdhui: string;
  finDeContratExecutee: boolean;
  /** Fin de l'abonnement, point de départ des durées « à compter de la fin de contrat ». */
  pointDeDepart: string | null;
  parametres: { version: string; statut: string; empreinte: string; nonValide: boolean };
  categories: CategoriePlanDestruction[];
  /** Prochaine date à laquelle quelque chose arrive à échéance ; null si tout est échu ou vide. */
  prochaineEcheance: string | null;
  /** Vrai quand plus aucune ligne ne reste dans les tables conservées. */
  termine: boolean;
  avertissements: string[];
}

async function pointDeDepartEtPv(client: pg.ClientBase, cabinetId: string): Promise<{ depart: string | null; pv: ProcesVerbalFinDeContrat | null }> {
  const pv = await lireProcesVerbalFinDeContrat(client, cabinetId);
  if (pv) return { depart: pv.abonnement.fin, pv };
  const ab = (await client.query<{ fin: string | null }>('select fin::text from abonnements where cabinet_id = $1', [cabinetId])).rows[0];
  return { depart: ab?.fin ?? null, pv: null };
}

async function compter(client: pg.ClientBase, table: string, cabinetId: string, expr: string, aujourdhui: string): Promise<{ total: number; echues: number; prochaine: string | null }> {
  const r = await client.query<{ total: string; echues: string; prochaine: string | null }>(
    `select count(*)::text as total, count(*) filter (where (${expr}) <= $2::date)::text as echues, min(${expr}) filter (where (${expr}) > $2::date or (${expr}) is null)::text as prochaine
       from ${ident(table)} t where t.cabinet_id = $1`,
    [cabinetId, aujourdhui],
  );
  const l = r.rows[0]!;
  return { total: Number(l.total), echues: Number(l.echues), prochaine: l.prochaine };
}

/** Plan de destruction à terme d'un cabinet : lecture seule (la base refuse toute écriture). */
export async function planDestructionTerme(client: pg.ClientBase, cabinetId: string, chargees: ParametresCharges, options: { aujourdhui?: string } = {}): Promise<PlanDestructionTerme> {
  if (!UUID.test(cabinetId)) throw new Error('Identifiant de cabinet invalide');
  await client.query('begin transaction read only');
  try {
    await exigerAdministration(client);
    const cab = (await client.query<{ id: string; nom: string }>('select id, nom from cabinets where id = $1', [cabinetId])).rows[0];
    if (!cab) throw new Error(`Cabinet introuvable : ${cabinetId}`);
    const aujourdhui = options.aujourdhui ?? (await client.query<{ d: string }>('select current_date::text as d')).rows[0]!.d;
    if (!DATE_ISO.test(aujourdhui)) throw new Error('Date « aujourd’hui » invalide');
    const { depart, pv } = await pointDeDepartEtPv(client, cabinetId);
    const presentes = new Set(await tablesACabinet(client));
    const categories: CategoriePlanDestruction[] = [];
    const avertissements: string[] = [];
    if (chargees.nonValide) avertissements.push('Durées : PROPOSITION NON VALIDÉE. Ces échéances n’ont aucune valeur juridique ; toute exécution exige --durees-validees=<référence>.');
    if (!pv) avertissements.push('Fin de contrat non exécutée pour ce cabinet : aucune destruction à terme n’est possible (les durées « à compter de la fin de contrat » courent depuis la fin de l’abonnement).');
    for (const code of [...CATEGORIES_A_TERME, CATEGORIE_JOURNAL, CATEGORIE_PROCES_VERBAL]) {
      const cat = categorie(code);
      const regle = chargees.parametres.categories[code]!;
      const lignes: LignePlanDestruction[] = [];
      for (const table of cat.tables.filter((t) => presentes.has(t))) {
        const c = await compter(client, table, cabinetId, expressionEcheance(table, regle, depart), aujourdhui);
        lignes.push({ categorie: code, table, total: c.total, echues: c.echues, prochaineEcheance: c.prochaine });
      }
      const total = lignes.reduce((s, l) => s + l.total, 0);
      const echues = lignes.reduce((s, l) => s + l.echues, 0);
      categories.push({
        code,
        libelle: cat.libelle,
        etat: total === 0 ? 'vide' : echues === 0 ? 'a_echoir' : echues === total ? 'echue' : 'partielle',
        procedure: code === CATEGORIE_JOURNAL ? 'journal_scelle_puis_decision_humaine' : code === CATEGORIE_PROCES_VERBAL ? 'cloture_du_cabinet' : 'destruction_a_terme',
        tables: lignes,
      });
    }
    const prochaines = categories.flatMap((c) => c.tables.map((t) => t.prochaineEcheance)).filter((d): d is string => d !== null).sort();
    return {
      format: 'comtaple.plan-destruction-terme/1',
      cabinet: cab,
      aujourdhui,
      finDeContratExecutee: pv !== null,
      pointDeDepart: depart,
      parametres: { version: chargees.parametres.version, statut: chargees.parametres.statut, empreinte: chargees.empreinte, nonValide: chargees.nonValide },
      categories,
      prochaineEcheance: prochaines[0] ?? null,
      termine: categories.every((c) => c.etat === 'vide'),
      avertissements,
    };
  } finally {
    await client.query('rollback');
  }
}

// ───────────────────────────── Exécution (base d'essai seulement) ─────────────────────────────

export interface ParametresDestruction {
  cabinetId: string;
  confirmation?: { cabinetId: string; nom: string };
  parametres: ParametresCharges;
  /** Référence de validation des durées (voir `exigerReferenceValidation`). */
  dureesValidees?: string;
  /** Date d'aujourd'hui (AAAA-MM-JJ) : fixable, pour éprouver les échéances sans attendre. */
  aujourdhui: string;
  /** Rapport JSON par ligne (une ligne par table traitée), ajouté à chaque passage : permet la reprise et le certificat. */
  fichierRapport?: string;
  env?: NodeJS.ProcessEnv;
  /** Appelé après chaque catégorie validée ; une exception ici interrompt le passage (essai de reprise). */
  surCategorie?: (code: string) => void | Promise<void>;
}
export interface LigneRapportDestruction {
  passage: number;
  etape: 'destruction_a_terme' | 'journal' | 'proces_verbal' | 'cabinet';
  categorie: string;
  table: string;
  supprimees: number;
  restantes: number;
  aujourdhui: string;
  le: string;
}
export interface RapportDestruction {
  passage: number;
  categories: Array<{ code: string; action: 'detruite' | 'rien_d_echu' | 'vide'; tables: LigneRapportDestruction[] }>;
  /** Plan APRÈS le passage. */
  plan: PlanDestructionTerme;
}
export const lireRapportDestruction = (chemin: string): LigneRapportDestruction[] =>
  existsSync(chemin) ? readFileSync(chemin, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as LigneRapportDestruction) : [];
const passageSuivant = (chemin: string | undefined) => (chemin ? lireRapportDestruction(chemin).reduce((m, l) => Math.max(m, l.passage), 0) + 1 : 1);

/** Garde commune de toute exécution : base d'essai, administration, référence, confirmation, fin de contrat exécutée. */
export async function garderDestruction(client: pg.ClientBase, p: Pick<ParametresDestruction, 'cabinetId' | 'confirmation' | 'parametres' | 'dureesValidees' | 'env'>, options: { cabinetPeutAvoirDisparu?: boolean } = {}): Promise<{ nom: string; pv: ProcesVerbalFinDeContrat | null; reference: string } | null> {
  await exigerBaseEssai(client, p.env);
  await exigerAdministration(client);
  const reference = exigerReferenceValidation(p.dureesValidees, p.parametres);
  if (!UUID.test(p.cabinetId)) throw new Error('Identifiant de cabinet invalide');
  const cab = (await client.query<{ nom: string }>('select nom from cabinets where id = $1', [p.cabinetId])).rows[0];
  if (!cab) {
    if (options.cabinetPeutAvoirDisparu) return null;
    throw new Error(`Cabinet introuvable : ${p.cabinetId}`);
  }
  if (!p.confirmation || p.confirmation.cabinetId !== p.cabinetId || p.confirmation.nom !== cab.nom) throw new Error('Destruction refusée : confirmation absente ou ne nommant pas exactement le cabinet (identifiant et nom).');
  const pv = await lireProcesVerbalFinDeContrat(client, p.cabinetId);
  return { nom: cab.nom, pv, reference };
}

/**
 * Détruit, pour un cabinet dont la fin de contrat est exécutée, les lignes ÉCHUES de la facturation, des restitutions du
 * cabinet, des politiques déclarées et des traces d'IA anonymisées. Ne touche NI au journal, NI au procès-verbal, NI à
 * la ligne du cabinet. Une transaction par catégorie ; chacune écrit au journal du cabinet une ligne
 * `conservation.destruction_terme` (le journal est ensuite scellé, puis détruit par sa propre procédure).
 * Une ligne parente (abonnement) n'est jamais détruite tant qu'une ligne enfant (échéance, événement) la référence.
 * Rejouée, elle ne détruit que ce qui est devenu échu depuis (idempotente) ; interrompue, elle reprend (la catégorie en
 * cours a été annulée tout entière, ou validée tout entière).
 */
export async function detruireElementsConservesEssai(client: pg.ClientBase, p: ParametresDestruction): Promise<RapportDestruction> {
  const g = await garderDestruction(client, p);
  if (!g?.pv) throw new Error('Destruction refusée : la fin de contrat n’a pas été exécutée en base pour ce cabinet (aucun procès-verbal au registre).');
  if (!DATE_ISO.test(p.aujourdhui)) throw new Error('Date « aujourd’hui » invalide');
  const depart = g.pv.abonnement.fin;
  const fks = await clesEtrangeres(client);
  const presentes = new Set(await tablesACabinet(client));
  const passage = passageSuivant(p.fichierRapport);
  const trace = traceValidation(g.reference, p.parametres);
  const rapport: RapportDestruction = { passage, categories: [], plan: undefined as unknown as PlanDestructionTerme };
  for (const code of CATEGORIES_A_TERME) {
    const regle = p.parametres.parametres.categories[code]!;
    const tables = enfantsAvantParents(categorie(code).tables.filter((t) => presentes.has(t)), fks);
    const lignesCat: LigneRapportDestruction[] = [];
    await client.query('begin');
    try {
      let totalAvant = 0;
      for (const table of tables) {
        const expr = expressionEcheance(table, regle, depart);
        const c = await compter(client, table, p.cabinetId, expr, p.aujourdhui);
        totalAvant += c.total;
        if (c.echues === 0) {
          lignesCat.push({ passage, etape: 'destruction_a_terme', categorie: code, table, supprimees: 0, restantes: c.total, aujourdhui: p.aujourdhui, le: new Date().toISOString() });
          continue;
        }
        // Une ligne référencée par une ligne qui subsiste n'est pas détruite (clé étrangère) : la condition l'exclut explicitement.
        const exclusions = fks
          .filter((f) => f.parent === table && f.enfant !== table)
          .map((f) => `and not exists (select 1 from ${ident(f.enfant)} x where x.${ident(f.colonne)} = t.${ident(f.colonneParent)})`)
          .join(' ');
        const r = await client.query(`delete from ${ident(table)} t where t.cabinet_id = $1 and (${expr}) <= $2::date ${exclusions}`, [p.cabinetId, p.aujourdhui]);
        const apres = (await client.query<{ n: string }>(`select count(*)::text as n from ${ident(table)} where cabinet_id = $1`, [p.cabinetId])).rows[0]!.n;
        lignesCat.push({ passage, etape: 'destruction_a_terme', categorie: code, table, supprimees: r.rowCount ?? 0, restantes: Number(apres), aujourdhui: p.aujourdhui, le: new Date().toISOString() });
      }
      const supprimees = lignesCat.reduce((s, l) => s + l.supprimees, 0);
      if (supprimees > 0) {
        await client.query(
          `insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id, details) values ($1, 'systeme', 'conservation.destruction_terme', 'cabinet', $2, $3)`,
          [p.cabinetId, p.cabinetId, JSON.stringify({ categorie: code, aujourdhui: p.aujourdhui, tables: lignesCat.filter((l) => l.supprimees > 0).map((l) => ({ table: l.table, supprimees: l.supprimees, restantes: l.restantes })), dureesConservation: trace })],
        );
      }
      await client.query('commit');
      for (const l of lignesCat) if (p.fichierRapport) {
        mkdirSync(dirname(p.fichierRapport), { recursive: true });
        appendFileSync(p.fichierRapport, `${JSON.stringify(l)}\n`, { mode: 0o600 });
      }
      rapport.categories.push({ code, action: totalAvant === 0 ? 'vide' : supprimees > 0 ? 'detruite' : 'rien_d_echu', tables: lignesCat });
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    }
    await p.surCategorie?.(code);
  }
  rapport.plan = await planDestructionTerme(client, p.cabinetId, p.parametres, { aujourdhui: p.aujourdhui });
  return rapport;
}

// ───────────────────────────── Clôture : procès-verbal, certificat, ligne du cabinet ─────────────────────────────

export interface CertificatDestruction {
  format: 'comtaple.certificat-destruction/1';
  cabinet: { id: string; nom: string; siren: string | null };
  emisLe: string;
  procesVerbal: { empreinte: string; executeLe: string; politique: string };
  dureesConservation: ReturnType<typeof traceValidation>;
  /** Total des lignes détruites par table, d'après le rapport (hors journal). */
  elementsDetruits: Array<{ table: string; supprimees: number }>;
  journal: { lignes: number; anomalies: number; empreinteTete: string | null; exportSha256: string; ancreEmpreinte: string; decision: { reference: string; par: string; date: string; motif: string } } | null;
  reserves: string[];
  /** SHA-256 du JSON canonique du document SANS ce champ. */
  empreinte: string;
}
export const empreinteCertificat = (c: Omit<CertificatDestruction, 'empreinte'> & { empreinte?: string }): string => {
  const { empreinte: _e, ...corps } = c;
  return sha256(jsonCanonique(corps));
};
export const verifierCertificat = (c: CertificatDestruction): boolean => c.format === 'comtaple.certificat-destruction/1' && c.empreinte === empreinteCertificat(c);

export interface ParametresCloture extends Omit<ParametresDestruction, 'surCategorie'> {
  /** Fichier du certificat de destruction (écrit AVANT la suppression du procès-verbal ; réutilisé à la reprise). */
  fichierCertificat: string;
  /** Ce que la destruction du journal a produit (voir `journal-fin-de-vie.ts`) ; null si le cabinet n'avait aucun journal. */
  journalDetruit: CertificatDestruction['journal'];
  supprimerLigneCabinet?: boolean;
  /** Appelé entre l'écriture du certificat et la suppression (essai de reprise). */
  avantSuppression?: () => void | Promise<void>;
}
export interface ResultatCloture { etat: 'cloture' | 'deja_cloture'; certificat: CertificatDestruction }

/** Interrupteur de protection : neutralise un déclencheur d'ajout seul le temps d'une transaction. Réservé aux bases d'essai. */
export async function neutraliserProtection(client: pg.ClientBase, table: string, declencheur: string): Promise<void> {
  await client.query(`alter table ${ident(table)} disable trigger ${ident(declencheur)}`);
}
export async function retablirProtection(client: pg.ClientBase, table: string, declencheur: string): Promise<void> {
  await client.query(`alter table ${ident(table)} enable trigger ${ident(declencheur)}`);
}
/** Vérifie, hors transaction, que les déclencheurs d'ajout seul sont bien actifs (état « O »). */
export async function protectionsActives(client: pg.ClientBase, declencheurs: readonly string[]): Promise<boolean> {
  const r = await client.query<{ tgname: string; tgenabled: string }>('select tgname, tgenabled from pg_trigger where tgname = any($1::text[])', [[...declencheurs]]);
  return r.rowCount === declencheurs.length && r.rows.every((l) => l.tgenabled === 'O');
}

/**
 * Dernière étape du cycle : certificat de destruction (hors base), puis suppression du procès-verbal et de la ligne du
 * cabinet. Exige que TOUTES les autres tables du cabinet soient vides et que le procès-verbal soit échu. Rejouable :
 * un certificat déjà écrit est réutilisé, un cabinet déjà clos est reconnu.
 */
export async function cloturerCabinetEssai(client: pg.ClientBase, p: ParametresCloture): Promise<ResultatCloture> {
  const g = await garderDestruction(client, p, { cabinetPeutAvoirDisparu: true });
  if (g === null) {
    if (existsSync(p.fichierCertificat)) {
      const c = JSON.parse(readFileSync(p.fichierCertificat, 'utf8')) as CertificatDestruction;
      if (verifierCertificat(c) && c.cabinet.id === p.cabinetId) return { etat: 'deja_cloture', certificat: c };
    }
    throw new Error('Clôture impossible : le cabinet n’existe plus et aucun certificat de destruction valide n’est présent.');
  }
  if (!g.pv) throw new Error('Clôture refusée : la fin de contrat n’a pas été exécutée (ou le procès-verbal est déjà détruit sans certificat).');
  const cab = (await client.query<{ siren: string | null }>('select siren from cabinets where id = $1', [p.cabinetId])).rows[0]!;
  const regle = p.parametres.parametres.categories[CATEGORIE_PROCES_VERBAL]!;
  const echu = (await client.query<{ e: boolean }>(`select (${expressionEcheance('fins_de_contrat', regle, g.pv.abonnement.fin)}) <= $1::date as e`, [p.aujourdhui])).rows[0]!.e;
  if (!echu) throw new Error('Clôture refusée : la durée de conservation du procès-verbal de fin de contrat n’est pas échue.');
  const restantes: string[] = [];
  for (const t of (await tablesACabinet(client)).filter((x) => x !== 'fins_de_contrat')) {
    const n = Number((await client.query<{ n: string }>(`select count(*)::text as n from ${ident(t)} where cabinet_id = $1`, [p.cabinetId])).rows[0]!.n);
    if (n > 0) restantes.push(`${t} : ${n} ligne(s)`);
  }
  if (restantes.length) throw new Error(`Clôture refusée : des éléments subsistent (${restantes.join(' ; ')}). Les détruire d’abord (échéance, journal scellé puis décision humaine).`);

  // Certificat : écrit AVANT toute suppression ; s'il existe déjà (reprise), il est conservé tel quel.
  let certificat: CertificatDestruction;
  if (existsSync(p.fichierCertificat)) {
    certificat = JSON.parse(readFileSync(p.fichierCertificat, 'utf8')) as CertificatDestruction;
    if (!verifierCertificat(certificat) || certificat.cabinet.id !== p.cabinetId) throw new Error('Certificat de destruction existant invalide ou d’un autre cabinet : rien n’est supprimé.');
  } else {
    const parTable = new Map<string, number>();
    for (const l of p.fichierRapport ? lireRapportDestruction(p.fichierRapport) : []) if (l.etape === 'destruction_a_terme' && l.supprimees > 0) parTable.set(l.table, (parTable.get(l.table) ?? 0) + l.supprimees);
    const corps: Omit<CertificatDestruction, 'empreinte'> = {
      format: 'comtaple.certificat-destruction/1',
      cabinet: { id: p.cabinetId, nom: g.nom, siren: cab.siren },
      emisLe: new Date().toISOString(),
      procesVerbal: { empreinte: g.pv.empreinte, executeLe: g.pv.executeLe, politique: g.pv.politique.version },
      dureesConservation: traceValidation(g.reference, p.parametres),
      elementsDetruits: [...parTable].map(([table, supprimees]) => ({ table, supprimees })).sort((a, b) => a.table.localeCompare(b.table)),
      journal: p.journalDetruit,
      reserves: [
        'Les sauvegardes antérieures contiennent encore les données jusqu’à leur rotation (voir le rapport du cycle).',
        'La destruction est attestée par l’éditeur ; ce certificat ne vaut pas validation juridique des durées appliquées.',
      ],
    };
    certificat = { ...corps, empreinte: empreinteCertificat(corps) };
    ecrireAtomique(p.fichierCertificat, `${JSON.stringify(certificat, null, 2)}\n`);
  }
  await p.avantSuppression?.();

  const protections = ['fins_de_contrat_pas_de_modification'];
  await client.query('begin');
  try {
    await neutraliserProtection(client, 'fins_de_contrat', protections[0]!);
    await client.query('delete from fins_de_contrat where cabinet_id = $1', [p.cabinetId]);
    await retablirProtection(client, 'fins_de_contrat', protections[0]!);
    if (p.supprimerLigneCabinet !== false) await client.query('delete from cabinets where id = $1', [p.cabinetId]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  }
  if (!(await protectionsActives(client, protections))) throw new Error('ALERTE : le déclencheur d’ajout seul de fins_de_contrat n’est pas actif après la clôture.');
  if (p.fichierRapport) appendFileSync(p.fichierRapport, `${JSON.stringify({ passage: passageSuivant(p.fichierRapport), etape: 'cabinet', categorie: CATEGORIE_PROCES_VERBAL, table: 'fins_de_contrat', supprimees: 1, restantes: 0, aujourdhui: p.aujourdhui, le: new Date().toISOString() } satisfies LigneRapportDestruction)}\n`, { mode: 0o600 });
  return { etat: 'cloture', certificat };
}
