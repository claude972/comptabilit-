/**
 * Rotation des jeux de sauvegarde LOCAUX selon une rétention paramétrable (D-099).
 *
 *  - SIMULATION par défaut : `planifierRotation` ne fait que lister, en lecture seule, ce qui serait conservé, retiré
 *    ou laissé à examiner. Les durées ne sont pas arrêtées (docs/conservation.md) : la rétention est un PARAMÈTRE.
 *  - EXÉCUTION (`appliquerRotation`) : refusée partout sauf dans un répertoire d'ESSAI marqué par
 *    `preparerRepertoireEssai` (créé par le test), distinct du répertoire réel des sauvegardes (ni le même, ni dedans,
 *    ni le contenant). Le répertoire réel ne porte jamais ce marqueur : aucune sauvegarde existante ne peut être retirée.
 *  - Un jeu INTERROMPU (marqueur `.en-cours`, ou base sans somme de contrôle) n'est jamais retiré : « à examiner ».
 *  - Les `jeuxMinimumConserves` jeux complets les plus récents sont toujours conservés, quel que soit leur âge.
 *  - Ne supprime que des fichiers dont le nom appartient à un groupe identifié ; ni lien symbolique, ni sous-dossier.
 *  - Le dépôt d'objets adressés par empreinte (`objets/`) n'est touché que par `appliquerNettoyageObjets` (D-100) : seuls les
 *    fichiers qu'AUCUN manifeste de jeu conservé ne référence plus, jamais en présence d'une sauvegarde interrompue.
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const MARQUEUR_ESSAI = '.comtaple-essai-rotation';
const JOURNAL = '.rotation.jsonl';
const MOTIF_JEU = /^(comtaple-\d{8}-\d{6})\.(.+)$/;
const MOTIF_KEYCLOAK = /^(keycloak-\d{8}-\d{6})\.(json|json\.sha256)$/;

export type TypeGroupe = 'jeu' | 'ancien_format' | 'keycloak_seul' | 'interrompu';
export type DecisionRotation = 'conserver' | 'retirer' | 'a_examiner';
export interface GroupeSauvegarde {
  id: string;
  type: TypeGroupe;
  /** Date lue dans l'identifiant (AAAAMMJJ-HHMMSS, heure locale de la sauvegarde, comptée comme UTC). */
  date: string;
  ageJours: number;
  fichiers: Array<{ nom: string; octets: number }>;
  octets: number;
  decision: DecisionRotation;
  motif: string;
}
export interface PlanRotation {
  format: 'comtaple.plan-rotation-sauvegardes/1';
  repertoire: string;
  retentionJours: number;
  jeuxMinimumConserves: number;
  maintenant: string;
  groupes: GroupeSauvegarde[];
  /** Fichiers du répertoire qui n'appartiennent à aucun groupe : jamais touchés. */
  nonReconnus: string[];
  aRetirer: { groupes: number; fichiers: number; octets: number };
}

function dateDeId(id: string): Date {
  const m = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(id)!;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
}

/** Lit le répertoire (lecture seule) et décide, groupe par groupe, de conserver, retirer ou examiner. */
export function planifierRotation(repertoire: string, p: { retentionJours: number; jeuxMinimumConserves: number; maintenant?: Date }): PlanRotation {
  if (!Number.isInteger(p.retentionJours) || p.retentionJours < 1) throw new Error('Rétention : entier de jours, 1 au moins.');
  if (!Number.isInteger(p.jeuxMinimumConserves) || p.jeuxMinimumConserves < 1) throw new Error('Jeux minimum conservés : entier, 1 au moins.');
  const maintenant = p.maintenant ?? new Date();
  const noms = readdirSync(repertoire).sort();
  const groupes = new Map<string, { id: string; fichiers: Array<{ nom: string; octets: number }>; suffixes: Set<string> }>();
  const nonReconnus: string[] = [];
  for (const nom of noms) {
    const chemin = join(repertoire, nom);
    const st = lstatSync(chemin);
    const m = MOTIF_JEU.exec(nom) ?? MOTIF_KEYCLOAK.exec(nom);
    if (!m || !st.isFile()) {
      if (!nom.startsWith('.') && nom !== 'objets') nonReconnus.push(nom);
      continue;
    }
    const g = groupes.get(m[1]!) ?? { id: m[1]!, fichiers: [], suffixes: new Set<string>() };
    g.fichiers.push({ nom, octets: st.size });
    g.suffixes.add(m[2]!);
    groupes.set(m[1]!, g);
  }
  // Reprise : un groupe dont le retrait a commencé (journal) et n'est pas terminé est retiré jusqu'au bout.
  const enCours = groupesEnCours(repertoire);
  const liste: GroupeSauvegarde[] = [...groupes.values()].map((g) => {
    const interrompu = !enCours.has(g.id) && (g.suffixes.has('en-cours') || (g.suffixes.has('dump') && !g.suffixes.has('dump.sha256') && !g.suffixes.has('jeu.json')));
    const type: TypeGroupe = g.id.startsWith('keycloak-') ? 'keycloak_seul' : interrompu ? 'interrompu' : g.suffixes.has('jeu.json') ? 'jeu' : 'ancien_format';
    const date = dateDeId(g.id);
    return { id: g.id, type, date: date.toISOString(), ageJours: Math.floor((maintenant.getTime() - date.getTime()) / 86_400_000), fichiers: g.fichiers, octets: g.fichiers.reduce((s, f) => s + f.octets, 0), decision: 'conserver' as DecisionRotation, motif: '' };
  });
  for (const famille of [['jeu', 'ancien_format'], ['keycloak_seul']] as TypeGroupe[][]) {
    const complets = liste.filter((g) => famille.includes(g.type)).sort((a, b) => b.date.localeCompare(a.date));
    complets.forEach((g, i) => {
      if (enCours.has(g.id)) {
        g.decision = 'retirer';
        g.motif = 'retrait commencé lors d’un passage interrompu : repris jusqu’au bout';
      } else if (i < p.jeuxMinimumConserves) {
        g.decision = 'conserver';
        g.motif = `parmi les ${p.jeuxMinimumConserves} plus récents : toujours conservé`;
      } else if (g.ageJours > p.retentionJours) {
        g.decision = 'retirer';
        g.motif = `âgé de ${g.ageJours} jours, rétention ${p.retentionJours} jours`;
      } else g.motif = `âgé de ${g.ageJours} jours, dans la rétention de ${p.retentionJours} jours`;
    });
  }
  for (const g of liste.filter((x) => x.type === 'interrompu')) {
    g.decision = 'a_examiner';
    g.motif = 'sauvegarde interrompue : jamais retirée automatiquement, à examiner par une personne';
  }
  liste.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const retirer = liste.filter((g) => g.decision === 'retirer');
  return {
    format: 'comtaple.plan-rotation-sauvegardes/1',
    repertoire,
    retentionJours: p.retentionJours,
    jeuxMinimumConserves: p.jeuxMinimumConserves,
    maintenant: maintenant.toISOString(),
    groupes: liste,
    nonReconnus,
    aRetirer: { groupes: retirer.length, fichiers: retirer.reduce((s, g) => s + g.fichiers.length, 0), octets: retirer.reduce((s, g) => s + g.octets, 0) },
  };
}

function groupesEnCours(repertoire: string): Set<string> {
  const j = join(repertoire, JOURNAL);
  if (!existsSync(j)) return new Set();
  const etat = new Map<string, boolean>();
  for (const l of readFileSync(j, 'utf8').split('\n').filter(Boolean)) {
    const e = JSON.parse(l) as { id: string; evenement: 'debut' | 'fin' };
    etat.set(e.id, e.evenement === 'debut');
  }
  return new Set([...etat].filter(([, ouvert]) => ouvert).map(([id]) => id));
}

/** Prépare un répertoire d'ESSAI : y inscrit le marqueur sans lequel aucune exécution n'est admise. Réservé aux tests. */
export function preparerRepertoireEssai(repertoire: string): void {
  mkdirSync(repertoire, { recursive: true });
  writeFileSync(join(repertoire, MARQUEUR_ESSAI), `comtaple-essai-rotation:${randomUUID()}\n`, { mode: 0o600 });
}

/** Lève si l'exécution n'est pas admise dans ce répertoire. */
export function exigerRepertoireEssai(repertoire: string, repertoireReel: string): void {
  const r = realpathSync(repertoire);
  const reel = existsSync(repertoireReel) ? realpathSync(repertoireReel) : resolve(repertoireReel);
  const contient = (parent: string, enfant: string) => {
    const rel = relative(parent, enfant);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  };
  if (contient(reel, r) || contient(r, reel)) throw new Error(`Refus : « ${repertoire} » est le répertoire des sauvegardes réelles, en fait partie ou le contient. La rotation ne s’exécute que dans un répertoire d’essai distinct.`);
  const marqueur = join(r, MARQUEUR_ESSAI);
  if (!existsSync(marqueur) || !/^comtaple-essai-rotation:[0-9a-f-]{36}\n?$/.test(readFileSync(marqueur, 'utf8'))) throw new Error(`Refus : « ${repertoire} » n’est pas déclaré répertoire d’essai (marqueur ${MARQUEUR_ESSAI} absent). Aucune sauvegarde n’est retirée.`);
  if (!lstatSync(marqueur).isFile()) throw new Error('Refus : marqueur d’essai invalide.');
}

export interface RapportRotation {
  retires: Array<{ id: string; fichiers: number; octets: number }>;
  conserves: number;
  aExaminer: string[];
  fichiersSupprimes: number;
  octetsLiberes: number;
}

/**
 * Retire les groupes « retirer » du plan, dans un répertoire d'ESSAI seulement. Un groupe à la fois ; le début et la fin
 * de chaque retrait sont consignés (reprise après interruption). Rejouée, elle ne retire plus rien (idempotente).
 * `apresFichier` est appelé après chaque fichier supprimé ; une exception interrompt le passage.
 */
export function appliquerRotation(repertoire: string, repertoireReel: string, p: { retentionJours: number; jeuxMinimumConserves: number; maintenant?: Date; apresFichier?: (nom: string) => void }): RapportRotation {
  exigerRepertoireEssai(repertoire, repertoireReel);
  const plan = planifierRotation(repertoire, p);
  const rapport: RapportRotation = { retires: [], conserves: plan.groupes.filter((g) => g.decision === 'conserver').length, aExaminer: plan.groupes.filter((g) => g.decision === 'a_examiner').map((g) => g.id), fichiersSupprimes: 0, octetsLiberes: 0 };
  const journal = join(repertoire, JOURNAL);
  for (const g of plan.groupes.filter((x) => x.decision === 'retirer')) {
    appendFileSync(journal, `${JSON.stringify({ id: g.id, evenement: 'debut', le: new Date().toISOString() })}\n`);
    let n = 0;
    let o = 0;
    // Le descripteur « .jeu.json » est retiré en dernier : tant qu'il existe, le jeu se reconnaît comme tel.
    for (const f of [...g.fichiers].sort((a, b) => Number(a.nom.endsWith('.jeu.json')) - Number(b.nom.endsWith('.jeu.json')))) {
      const chemin = join(repertoire, f.nom);
      if (dirname(resolve(chemin)) !== resolve(repertoire) || !(MOTIF_JEU.test(f.nom) || MOTIF_KEYCLOAK.test(f.nom))) throw new Error(`Refus : « ${f.nom} » n’est pas un fichier de sauvegarde reconnu.`);
      if (!existsSync(chemin)) continue;
      if (!lstatSync(chemin).isFile()) throw new Error(`Refus : « ${f.nom} » n’est pas un fichier ordinaire.`);
      unlinkSync(chemin);
      n++;
      o += f.octets;
      p.apresFichier?.(f.nom);
    }
    appendFileSync(journal, `${JSON.stringify({ id: g.id, evenement: 'fin', le: new Date().toISOString() })}\n`);
    rapport.retires.push({ id: g.id, fichiers: n, octets: o });
    rapport.fichiersSupprimes += n;
    rapport.octetsLiberes += o;
  }
  return rapport;
}

// ───────────────────────────── Dépôt d'objets adressés par empreinte (D-100) ─────────────────────────────

const MOTIF_BLOB = /^[0-9a-f]{64}$/;
const MOTIF_MANIFESTE = /^(comtaple-\d{8}-\d{6})\.objets\.json$/;
const JOURNAL_NETTOYAGE = '.nettoyage-objets.jsonl';

export interface PlanNettoyageObjets {
  format: 'comtaple.plan-nettoyage-objets/1';
  repertoire: string;
  manifestes: number;
  /** Empreintes référencées par au moins un manifeste de jeu conservé. */
  references: number;
  blobs: number;
  octets: number;
  orphelins: { fichiers: Array<{ chemin: string; octets: number }>; octets: number };
  /** Fichiers de `objets/` qui n'ont pas la forme d'un objet adressé : jamais touchés. */
  nonReconnus: string[];
  /** Raison pour laquelle aucun nettoyage ne doit avoir lieu (manifeste illisible, sauvegarde interrompue) ; null sinon. */
  bloque: string | null;
}

/**
 * Plan de nettoyage du dépôt `objets/` : quels fichiers ne sont plus référencés par AUCUN manifeste (`*.objets.json`) de
 * jeu présent. Lecture seule. Un jeu retiré par la rotation laisse ses objets orphelins ; c'est ce nettoyage qui les efface
 * (y compris les pièces d'un cabinet dont le contrat est terminé). Bloqué par prudence si un manifeste est illisible ou si
 * une sauvegarde est interrompue ou en cours (ses objets peuvent précéder son manifeste).
 */
export function planifierNettoyageObjets(repertoire: string): PlanNettoyageObjets {
  const references = new Set<string>();
  let manifestes = 0;
  let bloque: string | null = null;
  for (const nom of readdirSync(repertoire)) {
    if (nom.endsWith('.en-cours')) bloque ??= `sauvegarde en cours ou interrompue (${nom}) : ses objets peuvent précéder son manifeste`;
    if (!MOTIF_MANIFESTE.test(nom)) continue;
    manifestes++;
    try {
      const m = JSON.parse(readFileSync(join(repertoire, nom), 'utf8')) as { objets?: Array<{ sha256?: string }> };
      if (!Array.isArray(m.objets)) throw new Error('sans liste d’objets');
      for (const o of m.objets) if (typeof o.sha256 === 'string') references.add(o.sha256);
    } catch (e) {
      bloque ??= `manifeste illisible (${nom} : ${(e as Error).message}) : aucun objet ne peut être déclaré orphelin`;
    }
  }
  // Un jeu interrompu sans « .en-cours » : dump sans manifeste ni descripteur.
  for (const g of planifierRotation(repertoire, { retentionJours: 1, jeuxMinimumConserves: 1 }).groupes) if (g.type === 'interrompu') bloque ??= `sauvegarde interrompue (${g.id}) : à examiner avant tout nettoyage`;
  const racine = join(repertoire, 'objets');
  const orphelins: Array<{ chemin: string; octets: number }> = [];
  const nonReconnus: string[] = [];
  let blobs = 0;
  let octets = 0;
  if (existsSync(racine)) {
    for (const d of readdirSync(racine)) {
      const dossier = join(racine, d);
      if (!/^[0-9a-f]{2}$/.test(d) || !lstatSync(dossier).isDirectory()) {
        nonReconnus.push(`objets/${d}`);
        continue;
      }
      for (const f of readdirSync(dossier)) {
        const st = lstatSync(join(dossier, f));
        if (!MOTIF_BLOB.test(f) || !f.startsWith(d) || !st.isFile()) {
          nonReconnus.push(`objets/${d}/${f}`);
          continue;
        }
        blobs++;
        octets += st.size;
        if (!references.has(f)) orphelins.push({ chemin: `objets/${d}/${f}`, octets: st.size });
      }
    }
  }
  return { format: 'comtaple.plan-nettoyage-objets/1', repertoire, manifestes, references: references.size, blobs, octets, orphelins: { fichiers: orphelins, octets: orphelins.reduce((s, o) => s + o.octets, 0) }, nonReconnus, bloque };
}

export interface RapportNettoyageObjets { supprimes: number; octetsLiberes: number; dejaAbsents: number }

/** Supprime les objets orphelins d'un répertoire d'ESSAI (mêmes garde-fous que `appliquerRotation`). Idempotente, reprenable. */
export function appliquerNettoyageObjets(repertoire: string, repertoireReel: string, p: { apresFichier?: (chemin: string) => void } = {}): RapportNettoyageObjets {
  exigerRepertoireEssai(repertoire, repertoireReel);
  const plan = planifierNettoyageObjets(repertoire);
  if (plan.bloque) throw new Error(`Nettoyage des objets refusé : ${plan.bloque}.`);
  const rapport: RapportNettoyageObjets = { supprimes: 0, octetsLiberes: 0, dejaAbsents: 0 };
  const racine = realpathSync(join(repertoire, 'objets'));
  for (const o of plan.orphelins.fichiers) {
    const chemin = join(repertoire, o.chemin);
    if (!existsSync(chemin)) {
      rapport.dejaAbsents++;
      continue;
    }
    if (realpathSync(chemin) !== join(racine, o.chemin.split('/')[1]!, o.chemin.split('/')[2]!) || !MOTIF_BLOB.test(o.chemin.split('/')[2]!)) throw new Error(`Refus : « ${o.chemin} » n'est pas un objet adressé du dépôt.`);
    if (!lstatSync(chemin).isFile()) throw new Error(`Refus : « ${o.chemin} » n'est pas un fichier ordinaire.`);
    unlinkSync(chemin);
    appendFileSync(join(repertoire, JOURNAL_NETTOYAGE), `${JSON.stringify({ chemin: o.chemin, octets: o.octets, le: new Date().toISOString() })}\n`);
    rapport.supprimes++;
    rapport.octetsLiberes += o.octets;
    p.apresFichier?.(o.chemin);
  }
  return rapport;
}

export interface JeuContenantCabinet { id: string; type: TypeGroupe; raison: string }
/**
 * Jeux de sauvegarde (et exports Keycloak) qui contiennent ENCORE des données d'un cabinet dont le contrat est terminé :
 * antérieurs à `pivot` (fin de contrat, suppression des objets, fermeture des comptes : le plus tardif), ou dont le manifeste
 * d'objets cite encore des clés du cabinet, ou interrompus (contenu inconnu : compté par prudence).
 */
export function jeuxContenantCabinet(repertoire: string, cabinetId: string, pivot: Date): JeuContenantCabinet[] {
  const marge = 86_400_000; // l'identifiant d'un jeu est une heure locale lue comme UTC : un jour de marge
  const plan = planifierRotation(repertoire, { retentionJours: 1, jeuxMinimumConserves: 1 });
  const res: JeuContenantCabinet[] = [];
  for (const g of plan.groupes) {
    if (g.type === 'interrompu') {
      res.push({ id: g.id, type: g.type, raison: 'sauvegarde interrompue : contenu inconnu, à examiner' });
      continue;
    }
    if (new Date(g.date).getTime() <= pivot.getTime() + marge) {
      res.push({ id: g.id, type: g.type, raison: 'créé avant ou au moment de la fin de contrat, de la suppression des objets ou de la fermeture des comptes' });
      continue;
    }
    const manifeste = join(repertoire, `${g.id}.objets.json`);
    if (existsSync(manifeste)) {
      const t = readFileSync(manifeste, 'utf8');
      if (t.includes(`cabinets/${cabinetId}/`) || t.includes(`tmp/${cabinetId}/`)) res.push({ id: g.id, type: g.type, raison: 'son manifeste d’objets cite encore des clés du cabinet' });
    }
  }
  return res;
}
