/**
 * FIN DE VIE DU JOURNAL D'AUDIT d'un cabinet (D-100, complète D-099 point 5).
 *
 * Le journal n'est jamais réécrit ni purgé ligne à ligne : sa chaîne d'empreintes rend toute altération détectable. À
 * l'échéance de sa durée de conservation, il suit DEUX temps, jamais automatiques l'un de l'autre :
 *
 *  1. `scellerJournal` : vérification stricte, export final vérifiable HORS base (`comtaple.journal-export/1`), ancre
 *     chaînée, manifeste de scellement. Cette étape ne modifie rien dans la base : elle peut s'exécuter pour de bon
 *     (elle n'écrit que des fichiers, atomiquement) ;
 *  2. `detruireJournalEssai` : après une DÉCISION HUMAINE documentée (référence, auteur, date, motif), destruction du
 *     journal entier du cabinet, seulement si (a) toutes ses lignes sont échues, (b) l'export scellé se vérifie hors
 *     base contre l'ancre, (c) le journal n'a PAS changé depuis le scellement (même dernière ligne, même nombre de
 *     lignes). Désactivée par construction : base d'essai isolée, référence de validation des durées, confirmation.
 *
 * La destruction neutralise, dans UNE transaction, les déclencheurs d'ajout seul de `journal_audit` et d'`anomalies_journal`,
 * supprime, les rétablit, puis vérifie après coup qu'ils sont actifs. Elle prend un verrou exclusif sur ces tables : sur
 * une base partagée, elle suspendrait l'écriture du journal de TOUS les cabinets pendant la transaction (limite assumée,
 * pourquoi aucune exécution réelle n'est écrite). L'export et l'ancre ne valent comme preuve que déposés HORS de portée de
 * qui administre la base (externe : aucune destination indépendante n'est configurée).
 */
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type pg from 'pg';
import { type AncreJournal, type LigneJournalExportee, empreinteAncre, etablirAncre, exporterJournal, lireEtatJournal, serialiserAncre, verifierExport } from './ancre-journal.js';
import { CATEGORIE_JOURNAL, type LigneRapportDestruction, type ParametresDestruction, expressionEcheance, garderDestruction, ecrireAtomique, neutraliserProtection, protectionsActives, retablirProtection } from './destruction-terme.js';
import { exigerAdministration } from './provisionnement.js';

export const FORMAT_SCELLEMENT = 'comtaple.scellement-journal/1';
const PROTECTIONS = ['journal_audit_pas_de_modification', 'anomalies_journal_pas_de_modification'] as const;
const sha256Fichier = (chemin: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(chemin).on('data', (m) => h.update(m)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });

export interface ManifesteScellement {
  format: typeof FORMAT_SCELLEMENT;
  cabinetId: string;
  rang: number;
  exportFichier: string;
  exportSha256: string;
  lignes: number;
  ancreFichier: string;
  ancreEmpreinte: string;
  derniereLigne: string | null;
  empreinteTete: string | null;
  scelleLe: string;
  avertissement: string;
}
export interface ResultatScellement { manifeste: ManifesteScellement; cheminManifeste: string; deja: boolean }

const nomsScellement = (cabinetId: string, rang: number) => ({
  export: `journal-${cabinetId}-${rang}.jsonl`,
  ancre: `ancre-${cabinetId}-${rang}.json`,
  manifeste: `scellement-${cabinetId}-${rang}.json`,
});
function rangsExistants(repertoire: string, cabinetId: string): number[] {
  if (!existsSync(repertoire)) return [];
  const motif = new RegExp(`^scellement-${cabinetId}-(\\d+)\\.json$`);
  return readdirSync(repertoire).map((n) => motif.exec(n)?.[1]).filter((x): x is string => !!x).map(Number).sort((a, b) => a - b);
}
const lireAncre = (repertoire: string, cabinetId: string, rang: number): AncreJournal => JSON.parse(readFileSync(join(repertoire, nomsScellement(cabinetId, rang).ancre), 'utf8')) as AncreJournal;
const lireManifeste = (chemin: string): ManifesteScellement => JSON.parse(readFileSync(chemin, 'utf8')) as ManifesteScellement;

/**
 * Scelle le journal d'un cabinet : export JSONL + ancre + manifeste dans `repertoire`. Ne modifie pas la base (lecture
 * seule, instantané cohérent). Si le journal n'a pas changé depuis le dernier scellement, ce scellement est renvoyé.
 * Refuse si la vérification stricte échoue (aucune réparation) ou si le journal est vide.
 */
export async function scellerJournal(client: pg.ClientBase, cabinetId: string, p: { repertoire: string }): Promise<ResultatScellement> {
  mkdirSync(p.repertoire, { recursive: true });
  await client.query('begin transaction isolation level repeatable read read only');
  try {
    await exigerAdministration(client);
    const etat = await lireEtatJournal(client, cabinetId);
    if (etat.nombreLignes === 0) throw new Error('Scellement impossible : le journal du cabinet est vide.');
    if (etat.verificationStricte !== null) throw new Error(`Scellement refusé : le journal ne se vérifie pas (rupture à la ligne ${etat.verificationStricte}). Rien n’est réparé ni scellé.`);
    const rangs = rangsExistants(p.repertoire, cabinetId);
    const dernierRang = rangs.at(-1) ?? 0;
    const precedente = dernierRang ? lireAncre(p.repertoire, cabinetId, dernierRang) : null;
    if (precedente && precedente.derniereLigne === etat.derniereLigne && precedente.nombreLignes === etat.nombreLignes && precedente.empreinteTete === etat.empreinteTete) {
      const chemin = join(p.repertoire, nomsScellement(cabinetId, dernierRang).manifeste);
      return { manifeste: lireManifeste(chemin), cheminManifeste: chemin, deja: true };
    }
    const rang = dernierRang + 1;
    const noms = nomsScellement(cabinetId, rang);
    const cheminExport = join(p.repertoire, noms.export);
    const tmp = `${cheminExport}.tmp-${process.pid}`;
    const hash = createHash('sha256');
    const sortie = createWriteStream(tmp, { mode: 0o600 });
    let n = 0;
    for await (const l of exporterJournal(client, cabinetId)) {
      const texte = `${JSON.stringify(l)}\n`;
      hash.update(texte, 'utf8');
      if (!sortie.write(texte)) await new Promise<void>((r) => sortie.once('drain', () => r()));
      n++;
    }
    await new Promise<void>((resolve, reject) => sortie.end((e?: Error | null) => (e ? reject(e) : resolve())));
    if (n !== etat.nombreLignes) throw new Error(`Scellement interrompu : ${n} ligne(s) exportée(s) pour ${etat.nombreLignes} en base.`);
    renameSync(tmp, cheminExport);
    const ancre = etablirAncre({ cabinetId, derniereLigne: etat.derniereLigne, empreinteTete: etat.empreinteTete, nombreLignes: etat.nombreLignes, verificationStricte: null }, precedente);
    ecrireAtomique(join(p.repertoire, noms.ancre), `${serialiserAncre(ancre)}\n`);
    const manifeste: ManifesteScellement = {
      format: FORMAT_SCELLEMENT,
      cabinetId,
      rang,
      exportFichier: noms.export,
      exportSha256: hash.digest('hex'),
      lignes: n,
      ancreFichier: noms.ancre,
      ancreEmpreinte: empreinteAncre(ancre),
      derniereLigne: etat.derniereLigne,
      empreinteTete: etat.empreinteTete,
      scelleLe: new Date().toISOString(),
      avertissement: 'Une ancre ne prouve rien contre un administrateur de la base tant qu’elle n’est pas déposée HORS de sa portée (externe : aucune destination indépendante n’est configurée).',
    };
    const cheminManifeste = join(p.repertoire, noms.manifeste);
    ecrireAtomique(cheminManifeste, `${JSON.stringify(manifeste, null, 2)}\n`);
    return { manifeste, cheminManifeste, deja: false };
  } finally {
    await client.query('rollback');
  }
}

async function* lignesDe(chemin: string): AsyncGenerator<LigneJournalExportee> {
  const rl = createInterface({ input: createReadStream(chemin, 'utf8'), crlfDelay: Infinity });
  for await (const l of rl) if (l) yield JSON.parse(l) as LigneJournalExportee;
}

export interface VerificationScellement { conforme: boolean; lignes: number; motifs: string[] }
/** Vérifie un scellement SANS base ni réseau : empreinte du fichier d'export, chaîne des lignes, chaîne des ancres jusqu'à ce rang. */
export async function verifierScellement(cheminManifeste: string): Promise<VerificationScellement> {
  const motifs: string[] = [];
  let m: ManifesteScellement;
  try {
    m = lireManifeste(cheminManifeste);
  } catch {
    return { conforme: false, lignes: 0, motifs: ['manifeste illisible'] };
  }
  const dossier = join(cheminManifeste, '..');
  if (m.format !== FORMAT_SCELLEMENT) return { conforme: false, lignes: 0, motifs: ['format de scellement inconnu'] };
  const cheminExport = join(dossier, m.exportFichier);
  if (!existsSync(cheminExport)) return { conforme: false, lignes: 0, motifs: ['export absent'] };
  if ((await sha256Fichier(cheminExport)) !== m.exportSha256) motifs.push('l’empreinte du fichier d’export ne correspond pas au manifeste');
  const ancres: AncreJournal[] = [];
  for (let r = 1; r <= m.rang; r++) {
    try {
      ancres.push(lireAncre(dossier, m.cabinetId, r));
    } catch {
      motifs.push(`ancre de rang ${r} absente ou illisible`);
    }
  }
  const derniere = ancres.at(-1);
  if (derniere && empreinteAncre(derniere) !== m.ancreEmpreinte) motifs.push('l’ancre ne correspond pas à l’empreinte du manifeste');
  const v = await verifierExport(lignesDe(cheminExport), ancres);
  if (!v.conforme) motifs.push(`export non conforme : ${v.rupture ? `ligne ${v.rupture.ligne} (${v.rupture.motif})` : v.ancres.filter((a) => !a.conforme).map((a) => `ancre ${a.rang} : ${a.motif}`).join(' ; ')}`);
  if (v.lignes !== m.lignes) motifs.push(`l’export compte ${v.lignes} ligne(s), le manifeste en annonce ${m.lignes}`);
  return { conforme: motifs.length === 0, lignes: v.lignes, motifs };
}

// ───────────────────────────── Destruction du journal (base d'essai seulement) ─────────────────────────────

/** Décision humaine documentée : sans elle, aucune destruction du journal. */
export interface DecisionHumaine { reference: string; par: string; date: string; motif: string }
export class ScellementPerime extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScellementPerime';
  }
}
export interface ParametresDestructionJournal extends Omit<ParametresDestruction, 'surCategorie'> {
  /** Manifeste du scellement (voir `scellerJournal`). */
  cheminManifeste: string;
  decision?: DecisionHumaine;
  /** Appelé après la vérification et avant la suppression (essai de journal modifié entre-temps). */
  avantSuppression?: () => void | Promise<void>;
}
export interface ResultatDestructionJournal {
  etat: 'detruit' | 'deja_detruit';
  lignes: number;
  anomalies: number;
  empreinteTete: string | null;
  exportSha256: string;
  ancreEmpreinte: string;
  decision: DecisionHumaine;
}
const REFERENCE_VIDE = /^(oui|ok|yes|true|test|essai|x+|n\/?a|aucune?|todo|tbd|\?+|-+)$/i;
function exigerDecision(d: DecisionHumaine | undefined, aujourdhui: string): DecisionHumaine {
  if (!d) throw new Error('Destruction du journal refusée : aucune décision humaine documentée (référence, auteur, date, motif). Elle n’est jamais automatique.');
  const ref = d.reference?.trim() ?? '';
  if (ref.length < 6 || REFERENCE_VIDE.test(ref)) throw new Error('Destruction du journal refusée : la référence de la décision humaine n’est pas exploitable.');
  if (!d.par?.trim() || !d.motif?.trim() || d.motif.trim().length < 10) throw new Error('Destruction du journal refusée : auteur et motif (10 caractères au moins) de la décision humaine exigés.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date ?? '') || d.date > aujourdhui) throw new Error('Destruction du journal refusée : la date de la décision humaine est absente, invalide ou postérieure à aujourd’hui.');
  return { reference: ref, par: d.par.trim(), date: d.date, motif: d.motif.trim() };
}

/**
 * Détruit le journal d'audit (et les anomalies consignées) d'UN cabinet, après scellement vérifié et décision humaine.
 * Toutes les lignes doivent être échues ; le journal ne doit pas avoir changé depuis le scellement (sinon `ScellementPerime` :
 * resceller). Une seule transaction, tout ou rien ; les protections d'ajout seul sont rétablies et vérifiées.
 */
export async function detruireJournalEssai(client: pg.ClientBase, p: ParametresDestructionJournal): Promise<ResultatDestructionJournal> {
  const g = await garderDestruction(client, p);
  if (!g?.pv) throw new Error('Destruction du journal refusée : la fin de contrat n’a pas été exécutée en base pour ce cabinet.');
  const decision = exigerDecision(p.decision, p.aujourdhui);
  const m = lireManifeste(p.cheminManifeste);
  if (m.cabinetId !== p.cabinetId) throw new Error('Destruction du journal refusée : le scellement est celui d’un autre cabinet.');
  // Reprise : journal déjà détruit (plus aucune ligne) alors qu'un scellement existe.
  const restant = await client.query<{ a: string; b: string }>('select (select count(*) from journal_audit where cabinet_id = $1)::text as a, (select count(*) from anomalies_journal where cabinet_id = $1)::text as b', [p.cabinetId]);
  if (Number(restant.rows[0]!.a) === 0 && Number(restant.rows[0]!.b) === 0) return { etat: 'deja_detruit', lignes: m.lignes, anomalies: 0, empreinteTete: m.empreinteTete, exportSha256: m.exportSha256, ancreEmpreinte: m.ancreEmpreinte, decision };

  const verif = await verifierScellement(p.cheminManifeste);
  if (!verif.conforme) throw new Error(`Destruction du journal refusée : le scellement ne se vérifie pas hors base (${verif.motifs.join(' ; ')}).`);
  const regle = p.parametres.parametres.categories[CATEGORIE_JOURNAL]!;
  const lire = async () => {
    const etat = await lireEtatJournal(client, p.cabinetId);
    const nonEchues = (await client.query<{ n: string }>(`select ((select count(*) from journal_audit t where t.cabinet_id = $1 and not ((${expressionEcheance('journal_audit', regle, g.pv!.abonnement.fin)}) <= $2::date)) + (select count(*) from anomalies_journal t where t.cabinet_id = $1 and not ((${expressionEcheance('anomalies_journal', regle, g.pv!.abonnement.fin)}) <= $2::date)))::text as n`, [p.cabinetId, p.aujourdhui])).rows[0]!.n;
    return { etat, nonEchues: Number(nonEchues) };
  };
  const avant = await lire();
  if (avant.nonEchues > 0) throw new Error(`Destruction du journal refusée : ${avant.nonEchues} ligne(s) ne sont pas échues (le journal se détruit en entier, jamais par tranche : sa chaîne serait rompue).`);
  if (avant.etat.derniereLigne !== m.derniereLigne || avant.etat.nombreLignes !== m.lignes || avant.etat.empreinteTete !== m.empreinteTete) {
    throw new ScellementPerime(`Le journal a changé depuis le scellement (dernière ligne ${avant.etat.derniereLigne} pour ${m.derniereLigne} scellée, ${avant.etat.nombreLignes} ligne(s) pour ${m.lignes}) : le sceller de nouveau avant toute destruction.`);
  }
  if (avant.etat.verificationStricte !== null) throw new Error('Destruction du journal refusée : la vérification stricte échoue.');
  await p.avantSuppression?.();

  let lignes = 0;
  let anomalies = 0;
  await client.query('begin');
  try {
    // Revérifie DANS la transaction, après verrouillage : une écriture concurrente au journal ne doit pas passer entre-temps.
    await client.query('lock table journal_audit, anomalies_journal in access exclusive mode');
    const encore = await lireEtatJournal(client, p.cabinetId);
    if (encore.derniereLigne !== m.derniereLigne || encore.nombreLignes !== m.lignes) throw new ScellementPerime('Le journal a changé pendant la préparation de la destruction : rien n’est supprimé.');
    for (const [t, d] of [['journal_audit', PROTECTIONS[0]], ['anomalies_journal', PROTECTIONS[1]]] as const) await neutraliserProtection(client, t, d);
    lignes = (await client.query('delete from journal_audit where cabinet_id = $1', [p.cabinetId])).rowCount ?? 0;
    anomalies = (await client.query('delete from anomalies_journal where cabinet_id = $1', [p.cabinetId])).rowCount ?? 0;
    for (const [t, d] of [['journal_audit', PROTECTIONS[0]], ['anomalies_journal', PROTECTIONS[1]]] as const) await retablirProtection(client, t, d);
    if (lignes !== m.lignes) throw new Error(`${lignes} ligne(s) supprimée(s) pour ${m.lignes} scellée(s) : tout est annulé.`);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  }
  if (!(await protectionsActives(client, PROTECTIONS))) throw new Error('ALERTE : les déclencheurs d’ajout seul du journal ne sont pas actifs après la destruction.');
  if (p.fichierRapport) {
    mkdirSync(join(p.fichierRapport, '..'), { recursive: true });
    const l: LigneRapportDestruction = { passage: 0, etape: 'journal', categorie: CATEGORIE_JOURNAL, table: 'journal_audit', supprimees: lignes, restantes: 0, aujourdhui: p.aujourdhui, le: new Date().toISOString() };
    appendFileSync(p.fichierRapport, `${JSON.stringify(l)}\n${JSON.stringify({ ...l, table: 'anomalies_journal', supprimees: anomalies })}\n`, { mode: 0o600 });
  }
  return { etat: 'detruit', lignes, anomalies, empreinteTete: m.empreinteTete, exportSha256: m.exportSha256, ancreEmpreinte: m.ancreEmpreinte, decision };
}

export { lireManifeste as lireManifesteScellement };
