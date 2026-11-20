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
 *  - Le dépôt d'objets adressés par empreinte (`objets/`) n'est PAS touché : son nettoyage n'est pas conçu.
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
