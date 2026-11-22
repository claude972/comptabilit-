/**
 * Analyse ISOLÉE des fichiers non fiables : le décodage (PDF, XML, texte reconnu) s'exécute dans un processus enfant
 * dédié, jamais dans le processus du worker. Ce module est le côté PARENT : il lance l'enfant, lui transmet les octets
 * sans les interpréter, impose les bornes (durée, mémoire, taille de sortie) et valide le résultat par schéma.
 *
 * Un processus PAR FICHIER, non réutilisé : aucun état ne passe d'une pièce à la suivante (ni d'un cabinet à l'autre),
 * un lecteur corrompu par un fichier ne voit jamais le fichier d'après, et la mémoire est rendue à chaque fois. Le coût
 * (démarrage de Node et chargement du lecteur à chaque pièce) est mesuré dans docs/architecture.md.
 *
 * Un enfant qui plante, boucle, dépasse sa mémoire ou renvoie une sortie invalide ne fait pas tomber le worker :
 * `executerEnfant` rend une issue `{ ok: false, cause }` ; seul l'échec du LANCEMENT lui-même lève (tâche retentée).
 */
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type LigneFec, PLAFOND_ANOMALIES_FEC, type PageTexte, type ProfilCsvBanque, type RapportFec, referentielFec, schemaProfilCsvBanque, TAILLE_MAX_LIGNE_FEC } from '@comtaple/core';
import { z } from 'zod';
import { demarrerConteneur, type ParametresConteneur, RACINE_IMAGE } from './analyse-conteneur.js';
import { FENETRE_CREDIT_OCTETS, MARQUEUR_CREDIT, type DemandeAnalyse, LIGNES_MAX_PAR_PAGE, MOUVEMENTS_MAX_RELEVE, PAGES_MAX, PAGES_MAX_TEXTE, type ResultatPiece, type ResultatReleve, type ResultatTexte, type TypePieceDecodee } from './analyse-types.js';

export interface LimitesAnalyse {
  /** Durée maximale d'un enfant, lancement compris ; au-delà il est arrêté de force (SIGKILL). */
  dureeMaxMs: number;
  /** Plafond du tas JavaScript de l'enfant (`--max-old-space-size`). */
  tasMaxMo: number;
  /** Plafond de la mémoire résidente de l'enfant (tampons hors tas compris), surveillée par le parent. */
  memoireMaxMo: number;
  /** Taille maximale de la sortie renvoyée par l'enfant. */
  sortieMaxOctets: number;
}

export const LIMITES_PAR_DEFAUT: LimitesAnalyse = { dureeMaxMs: 60_000, tasMaxMo: 512, memoireMaxMo: 1024, sortieMaxOctets: 8 * 1024 * 1024 };

export type CauseEchec = 'delai' | 'memoire' | 'sortie_trop_grande' | 'sortie_invalide' | 'plantage';
export type Issue<T> = { ok: true; valeur: T; dureeMs: number } | { ok: false; cause: CauseEchec; dureeMs: number };

/** Options d'isolement : bornes, et — pour les essais seulement — un autre point d'entrée que l'enfant réel. */
export interface OptionsAnalyse extends Partial<LimitesAnalyse> {
  entree?: string;
  lecturesSupplementaires?: string[];
  /** Mode d'exécution (D-098) : `processus` (défaut) ou `conteneur`. */
  isolation?: 'processus' | 'conteneur';
  /** Paramètres du mode `conteneur` (image, client docker, bornes) ; ignorés en mode `processus`. */
  conteneur?: ParametresConteneur;
  /** Mesure du protocole d'entrée à crédit, REMPLIE par l'appel (essais, D-171) : octets de corps écrits, crédités, maximum en vol, protocole actif ou non. */
  /** ESSAIS SEULEMENT : applique le protocole de crédit même avec un enfant d'essai (point d'entrée explicite). */
  creditForce?: boolean;
  mesureCredit?: { actif: boolean; ecrit: number; credite: number; maxEnVol: number };
}

/** Options d'isolement issues de la configuration (mode, image, bornes du conteneur) : à répandre dans les options d'un appel. */
export function isolementDepuisConfig(cfg: {
  ANALYSE_ISOLATION: 'processus' | 'conteneur';
  ANALYSE_CONTENEUR_IMAGE: string;
  ANALYSE_CONTENEUR_DOCKER: string;
  ANALYSE_CONTENEUR_HOTE: string;
  ANALYSE_CONTENEUR_CPUS: number;
  ANALYSE_CONTENEUR_PIDS: number;
  ANALYSE_CONTENEUR_TMPFS_MO: number;
}): Pick<OptionsAnalyse, 'isolation' | 'conteneur'> {
  if (cfg.ANALYSE_ISOLATION !== 'conteneur') return {};
  return {
    isolation: 'conteneur',
    conteneur: { image: cfg.ANALYSE_CONTENEUR_IMAGE, docker: cfg.ANALYSE_CONTENEUR_DOCKER, hote: cfg.ANALYSE_CONTENEUR_HOTE, cpus: cfg.ANALYSE_CONTENEUR_CPUS, pidsMax: cfg.ANALYSE_CONTENEUR_PIDS, tmpfsMo: cfg.ANALYSE_CONTENEUR_TMPFS_MO },
  };
}

const ICI = dirname(fileURLToPath(import.meta.url)); // apps/worker/dist en service, apps/worker/src sous vitest
const PAQUET = resolve(ICI, '..');
const RACINE = resolve(PAQUET, '../..');
/** L'enfant est toujours le fichier COMPILÉ : il doit être présent dans `dist` (donc dans l'image de conteneur). */
export const ENTREE_ENFANT = join(PAQUET, 'dist', 'analyse-enfant.js');

/**
 * Seuls chemins lisibles par l'enfant (modèle de permissions de Node) : son propre code et ses dépendances.
 * Ni la racine du dépôt (fichier `.env`), ni le répertoire personnel, ni /etc, ni /proc ; aucune écriture nulle part.
 */
const lecturesEnfant = (paquet: string, racine: string) => [join(paquet, 'dist'), join(paquet, 'node_modules'), join(paquet, 'package.json'), join(racine, 'node_modules'), join(racine, 'packages', 'core')];
const LECTURES_ENFANT = lecturesEnfant(PAQUET, RACINE);
/** Même disposition dans l'image d'analyse : `/app/apps/worker/…`, `/app/node_modules`, `/app/packages/core`. */
const PAQUET_IMAGE = `${RACINE_IMAGE}/apps/worker`;
export const ENTREE_ENFANT_IMAGE = `${PAQUET_IMAGE}/dist/analyse-enfant.js`;

export function argumentsEnfant(limites: LimitesAnalyse, entree: string, lecturesSupplementaires: string[] = [], dansImage = false): string[] {
  const lectures = dansImage ? lecturesEnfant(PAQUET_IMAGE, RACINE_IMAGE) : LECTURES_ENFANT;
  return [
    `--max-old-space-size=${limites.tasMaxMo}`,
    // Modèle de permissions (stable depuis Node 22.13 / 23.5) : lecture limitée aux chemins listés ; écriture, processus
    // fils, fils d'exécution, modules natifs, WASI et inspecteur refusés faute d'autorisation explicite.
    '--permission',
    ...[...lectures, ...lecturesSupplementaires].map((c) => `--allow-fs-read=${c}`),
    // Les lecteurs n'ont pas à fabriquer de code : eval et new Function sont refusés.
    '--disallow-code-generation-from-strings',
    entree,
  ];
}

/** Mémoire résidente d'un processus, en Mo (null si illisible : processus terminé, outil absent). */
async function memoireResidenteMo(pid: number): Promise<number | null> {
  if (process.platform === 'linux') {
    try {
      const m = /^VmRSS:\s+(\d+)\s+kB/m.exec(await readFile(`/proc/${pid}/status`, 'utf8'));
      return m ? Number(m[1]) / 1024 : null;
    } catch {
      return null;
    }
  }
  return new Promise((rendre) => {
    execFile('ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 2000 }, (erreur, sortie) => {
      const ko = erreur ? Number.NaN : Number.parseInt(String(sortie).trim(), 10);
      rendre(Number.isFinite(ko) ? ko / 1024 : null);
    });
  });
}

const enCours = new Set<ReturnType<typeof spawn>>();
// Arrêt du worker (normal ou sur exception) : aucun enfant ne lui survit. Un SIGKILL du worker n'est pas couvert ici ;
// en conteneur, l'arrêt du processus principal emporte tous les processus du conteneur.
process.once('exit', () => {
  for (const e of enCours) e.kill('SIGKILL');
});

interface Lancement {
  enfant: ReturnType<typeof spawn>;
  limites: LimitesAnalyse;
  debut: number;
  /** Arrête l'enfant de force ; la première cause donnée est retenue. */
  arreter(cause: CauseEchec): void;
  cause(): CauseEchec | null;
  /** Code de sortie de l'enfant ; rejette seulement si le LANCEMENT a échoué. */
  fin: Promise<number | null>;
  /** Issue d'un enfant terminé sans arrêt forcé mais avec un code non nul. */
  causeSortie(): CauseEchec;
  /** Écriture à crédit du corps (D-171) : rend la main quand `octets` de plus tiennent dans la fenêtre annoncée par l'enfant, ou quand l'enfant est arrêté. */
  attendreCredit(octets: number): Promise<boolean>;
}

/**
 * Lance un enfant borné (durée, tas, mémoire résidente surveillée) dans un environnement VIDE : aucune variable de
 * connexion (base, Redis, stockage), aucun jeton. Commun aux deux modes d'échange (résultat unique, trames en flux).
 */
function lancer(options: OptionsAnalyse): Lancement {
  const limites: LimitesAnalyse = {
    dureeMaxMs: options.dureeMaxMs ?? LIMITES_PAR_DEFAUT.dureeMaxMs,
    tasMaxMo: options.tasMaxMo ?? LIMITES_PAR_DEFAUT.tasMaxMo,
    memoireMaxMo: options.memoireMaxMo ?? LIMITES_PAR_DEFAUT.memoireMaxMo,
    sortieMaxOctets: options.sortieMaxOctets ?? LIMITES_PAR_DEFAUT.sortieMaxOctets,
  };
  const modeConteneur = options.isolation === 'conteneur';
  if (modeConteneur && !options.conteneur) throw new Error('Mode conteneur demandé sans paramètres de conteneur');
  const debut = performance.now();
  let conteneur: ReturnType<typeof demarrerConteneur> | null = null;
  let enfant: ReturnType<typeof spawn>;
  if (modeConteneur) {
    // Mode conteneur : l'enfant est le CLIENT docker qui pilote un conteneur dédié. Mêmes arguments Node qu'en mode processus
    // (tas, permissions, code non généré), avec les chemins de l'image ; les bornes de mémoire et de processus sont celles du conteneur.
    const p = options.conteneur!;
    conteneur = demarrerConteneur(p, { dureeMaxMs: limites.dureeMaxMs, memoireMaxMo: limites.memoireMaxMo }, argumentsEnfant(limites, options.entree ?? ENTREE_ENFANT_IMAGE, options.lecturesSupplementaires, true));
    enfant = conteneur.client;
  } else {
    const entree = options.entree ?? ENTREE_ENFANT;
    enfant = spawn(process.execPath, argumentsEnfant(limites, entree, options.lecturesSupplementaires), {
      env: {},
      cwd: dirname(entree),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    enCours.add(enfant);
  }
  let arret: CauseEchec | null = null;
  const arreter = (cause: CauseEchec) => {
    arret ??= cause;
    if (conteneur) conteneur.arreter();
    else enfant.kill('SIGKILL');
    reveiller();
  };
  const minuterie = setTimeout(() => arreter('delai'), limites.dureeMaxMs);
  let mesureEnCours = false;
  // La mémoire d'un conteneur est bornée par son cgroup (arrêt par le noyau, constaté par le moteur) : pas de sondage.
  const surveillance = conteneur
    ? null
    : setInterval(() => {
        if (mesureEnCours || enfant.pid === undefined) return;
        mesureEnCours = true;
        void memoireResidenteMo(enfant.pid).then((mo) => {
          mesureEnCours = false;
          if (mo !== null && mo > limites.memoireMaxMo) arreter('memoire');
        });
      }, 100);
  // Sortie d'erreur : seuls ses premiers octets servent, à reconnaître un dépassement du tas ; jamais relayée. Les lignes de CRÉDIT (D-171) en sont retirées : elles alimentent la fenêtre
  // d'écriture et ne comptent ni dans le texte d'erreur ni dans sa limite.
  let erreurs = '';
  let partiel = '';
  const mesure = options.mesureCredit;
  // Protocole actif seulement avec l'enfant RÉEL (ni point d'entrée d'essai, ni image d'essai) : un enfant d'essai qui ne parle pas le protocole est servi à l'ancienne.
  const creditActif = options.creditForce === true || (options.entree === undefined && options.conteneur?.essai === undefined);
  const credit = { ecrit: 0, credite: 0, maxEnVol: 0 };
  let attentes: Array<() => void> = [];
  const reveiller = () => {
    const a = attentes;
    attentes = [];
    for (const r of a) r();
  };
  if (mesure) Object.assign(mesure, { actif: creditActif, ecrit: 0, credite: 0, maxEnVol: 0 });
  const ajouterErreur = (texte: string) => {
    if (erreurs.length < 8192) erreurs += texte.slice(0, 8192 - erreurs.length);
  };
  const viderPartiel = () => {
    if (partiel) ajouterErreur(partiel);
    partiel = '';
  };
  enfant.stderr!.on('data', (m: Buffer) => {
    const lignes = (partiel + m.toString('latin1')).split('\n');
    partiel = lignes.pop() ?? '';
    for (const ligne of lignes) {
      const n = ligne.startsWith(MARQUEUR_CREDIT) ? /^\d{1,10}$/.exec(ligne.slice(MARQUEUR_CREDIT.length)) : null;
      if (n) {
        credit.credite = Math.min(credit.credite + Number(n[0]), credit.ecrit); // jamais plus que ce qui a été écrit : un crédit inventé ne rouvre rien
        if (mesure) mesure.credite = credit.credite;
        reveiller();
      } else ajouterErreur(`${ligne}\n`);
    }
    if (partiel.length > 8192) viderPartiel();
  });
  // Un enfant mort avant d'avoir tout lu ferme son entrée : l'erreur d'écriture est attendue, l'issue vient de « close ».
  enfant.stdin!.on('error', () => undefined);
  const finir = () => {
    clearTimeout(minuterie);
    if (surveillance) clearInterval(surveillance);
    enCours.delete(enfant);
  };
  const fin = new Promise<number | null>((rendre, rejeter) => {
    enfant.on('error', (e) => {
      finir();
      void conteneur?.nettoyer();
      rejeter(new Error(`Lancement du processus d'analyse impossible : ${e.message}`));
    });
    enfant.on('close', (code) => {
      viderPartiel();
      reveiller();
      void (async () => {
        if (conteneur) {
          // Le conteneur est constaté puis supprimé AVANT de rendre l'issue : aucun conteneur ne survit à son analyse.
          const etat = await conteneur.nettoyer();
          if (etat.memoire) arret ??= 'memoire'; // arrêté par le noyau pour dépassement de mémoire (OOM)
          // Sur certains moteurs (exécuteur GitHub, constaté en CI le 2026-11-21) l'indicateur OOMKilled n'est pas positionné alors que le noyau a
          // bien tué le processus : un SIGKILL (code 137) que le worker n'a PAS demandé, dans un conteneur dont la mémoire est bornée et sans
          // swap, ou une erreur d'allocation écrite par l'enfant, est rangé sous « memoire ». INTERPRÉTATION, signalée comme telle : un
          // SIGKILL extérieur (administrateur) serait rangé de la même façon ; le message n'engage que la cause affichée, pas la sécurité.
          if (arret === null && !etat.absent && (code === 137 || /MemoryError|Cannot allocate memory/i.test(erreurs))) arret = 'memoire';
          if (etat.absent && arret === null && code !== 0) {
            // Aucun conteneur n'a existé : le moteur a refusé le lancement (image absente, moteur injoignable) : tâche retentée.
            finir();
            return rejeter(new Error(`Lancement du conteneur d'analyse impossible (code ${String(code)}) : ${etat.erreurClient.replace(/\s+/g, ' ').trim().slice(0, 300)}`));
          }
        }
        finir();
        rendre(code);
      })();
    });
  });
  const attendreCredit = async (octets: number): Promise<boolean> => {
    // Rien en vol : on écrit toujours (un bloc plus grand que la fenêtre passe seul) ; sinon on attend que l'enfant ait consommé de quoi faire de la place.
    while (creditActif && credit.ecrit - credit.credite > 0 && credit.ecrit - credit.credite + octets > FENETRE_CREDIT_OCTETS && arret === null && !enfant.stdin!.destroyed && enfant.exitCode === null) {
      await new Promise<void>((r) => attentes.push(r));
    }
    if (arret !== null || enfant.stdin!.destroyed || enfant.exitCode !== null) return false; // enfant arrêté pendant l'attente : rien n'est écrit, rien n'est compté
    credit.ecrit += octets;
    credit.maxEnVol = Math.max(credit.maxEnVol, credit.ecrit - credit.credite);
    if (mesure) Object.assign(mesure, { ecrit: credit.ecrit, maxEnVol: credit.maxEnVol });
    return true;
  };
  return { enfant, limites, debut, arreter, cause: () => arret, fin, attendreCredit, causeSortie: () => (/heap out of memory|Allocation failed|out of memory/i.test(erreurs) ? 'memoire' : 'plantage') };
}

/** Taille d'un bloc d'entrée écrit à l'enfant. */
const BLOC_ENTREE = 64 * 1024;

function ecrireEntete(l: Lancement, entete: unknown): void {
  const octets = Buffer.from(JSON.stringify(entete), 'utf8');
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(octets.length);
  l.enfant.stdin!.write(longueur);
  l.enfant.stdin!.write(octets);
}

/**
 * Lance un enfant, lui transmet `entete` puis `corps`, et rend sa sortie validée par `schema`, ou la cause de l'échec.
 */
export async function executerEnfant<T>(demande: { entete: unknown; corps: Buffer; schema: z.ZodType<T> }, options: OptionsAnalyse = {}): Promise<Issue<T>> {
  const l = lancer(options);
  const sortie: Buffer[] = [];
  let tailleSortie = 0;
  l.enfant.stdout!.on('data', (m: Buffer) => {
    tailleSortie += m.length;
    if (tailleSortie > l.limites.sortieMaxOctets) {
      sortie.length = 0;
      l.arreter('sortie_trop_grande');
    } else if (!l.cause()) sortie.push(m);
  });
  ecrireEntete(l, demande.entete);
  // Écriture PAR BLOCS avec contre-pression, interrompue dès l'arrêt de l'enfant : au moment d'un arrêt forcé il reste au plus un bloc en vol
  // (atténuation du blocage de dockerd 29.5.2 quand l'entrée est encore écrite, D-098 bis point 4). Octets et ordre inchangés.
  const entree = l.enfant.stdin!;
  for (let i = 0; i < demande.corps.length && !l.cause() && !entree.destroyed; i += BLOC_ENTREE) {
    const bloc = demande.corps.subarray(i, i + BLOC_ENTREE);
    if (!(await l.attendreCredit(bloc.length)) || l.cause() || entree.destroyed) break;
    if (!entree.write(bloc)) {
      await new Promise<void>((suite) => {
        const reprendre = () => {
          entree.off('drain', reprendre);
          entree.off('close', reprendre);
          suite();
        };
        entree.once('drain', reprendre);
        entree.once('close', reprendre);
      });
    }
  }
  if (!entree.destroyed) entree.end();
  const code = await l.fin;
  const dureeMs = Math.round(performance.now() - l.debut);
  const arret = l.cause();
  if (arret) return { ok: false, cause: arret, dureeMs };
  if (code !== 0) return { ok: false, cause: l.causeSortie(), dureeMs };
  let brut: unknown;
  try {
    brut = JSON.parse(Buffer.concat(sortie).toString('utf8'));
  } catch {
    return { ok: false, cause: 'sortie_invalide', dureeMs };
  }
  const valide = demande.schema.safeParse(brut);
  return valide.success ? { ok: true, valeur: valide.data, dureeMs } : { ok: false, cause: 'sortie_invalide', dureeMs };
}

/**
 * Variante EN FLUX : le corps est transmis à l'enfant au fil de l'eau, et l'enfant répond par des TRAMES (4 octets de
 * longueur, puis JSON) — des lots `{ t: 'lignes', lignes }` remis un par un à `surLot`, puis un `{ t: 'rapport', rapport }`.
 *
 * Mémoire bornée des deux côtés (contre-pression) : tant que `surLot` n'a pas rendu la main, le parent ne lit plus la
 * sortie de l'enfant ; le tube plein bloque l'enfant, qui cesse de lire son entrée ; le parent cesse alors de lire la
 * source. `sortieMaxOctets` borne ici la taille d'UNE trame (le volume total est borné par la durée et par la source).
 *
 * Une erreur levée par `surLot` ou par la lecture de la source arrête l'enfant et est RELANCÉE telle quelle (annulation
 * demandée, base indisponible…) : ce n'est pas un échec de l'enfant.
 */
function lireTrame(octets: Buffer): { t?: unknown; lignes?: unknown; rapport?: unknown } | null {
  try {
    const v: unknown = JSON.parse(octets.toString('utf8'));
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as { t?: unknown }) : null;
  } catch {
    return null;
  }
}

export async function executerEnfantFlux<L, F>(
  demande: { entete: unknown; corps: AsyncIterable<Uint8Array>; schemaLot: z.ZodType<L>; schemaFin: z.ZodType<F>; surLot: (lot: L) => Promise<void> },
  options: OptionsAnalyse = {},
): Promise<Issue<F>> {
  const l = lancer(options);
  const entree = l.enfant.stdin!;
  let erreurExterne: { e: unknown } | null = null;
  const abandonner = (e: unknown) => {
    erreurExterne ??= { e };
    l.arreter('plantage');
  };
  ecrireEntete(l, demande.entete);
  const alimentation = (async () => {
    try {
      for await (const bloc of demande.corps) {
        if (l.cause() || entree.destroyed) break;
        if (!(await l.attendreCredit(bloc.length)) || l.cause() || entree.destroyed) break;
        if (!entree.write(bloc)) {
          await new Promise<void>((suite) => {
            const reprendre = () => {
              entree.off('drain', reprendre);
              entree.off('close', reprendre);
              suite();
            };
            entree.once('drain', reprendre);
            entree.once('close', reprendre);
          });
        }
      }
      entree.end();
    } catch (e) {
      abandonner(e);
    } finally {
      // Source abandonnée en cours de route (enfant arrêté) : on la ferme pour libérer la connexion au stockage.
      const source = demande.corps as { destroy?: () => void };
      if (l.cause() && typeof source.destroy === 'function') source.destroy();
    }
  })();

  let attente: Buffer = Buffer.alloc(0);
  let fin: { valeur: F } | null = null;
  try {
   for await (const m of l.enfant.stdout! as AsyncIterable<Buffer>) {
    if (l.cause()) continue; // enfant déjà condamné : sa sortie est vidée sans être lue
    attente = attente.length > 0 ? Buffer.concat([attente, m]) : m;
    while (attente.length >= 4 && !l.cause()) {
      const longueur = attente.readUInt32BE(0);
      if (longueur > l.limites.sortieMaxOctets) {
        l.arreter('sortie_trop_grande');
        break;
      }
      if (attente.length < 4 + longueur) break;
      const brut = lireTrame(attente.subarray(4, 4 + longueur));
      attente = attente.subarray(4 + longueur);
      if (brut === null || fin !== null) {
        l.arreter('sortie_invalide'); // trame illisible, ou trame après le rapport final
      } else if (brut.t === 'lignes') {
        const lot = demande.schemaLot.safeParse(brut.lignes);
        if (!lot.success) l.arreter('sortie_invalide');
        else {
          try {
            await demande.surLot(lot.data);
          } catch (e) {
            abandonner(e);
          }
        }
      } else if (brut.t === 'rapport') {
        const rapport = demande.schemaFin.safeParse(brut.rapport);
        if (rapport.success) fin = { valeur: rapport.data };
        else l.arreter('sortie_invalide');
      } else l.arreter('sortie_invalide');
    }
   }
  } catch {
    l.arreter('plantage'); // sortie de l'enfant rompue avant sa fin
  }
  const code = await l.fin;
  await alimentation;
  const dureeMs = Math.round(performance.now() - l.debut);
  if (erreurExterne) throw (erreurExterne as { e: unknown }).e;
  const arret = l.cause();
  if (arret) return { ok: false, cause: arret, dureeMs };
  if (code !== 0) return { ok: false, cause: l.causeSortie(), dureeMs };
  if (fin === null || attente.length > 0) return { ok: false, cause: 'sortie_invalide', dureeMs };
  return { ok: true, valeur: (fin as { valeur: F }).valeur, dureeMs };
}

// ── Schémas des résultats : seul ce qui les satisfait entre dans le processus du worker (clés inconnues retirées). ──
const boite = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const champ = <V extends z.ZodType>(valeur: V) =>
  z
    .object({
      valeur,
      page: z.number().int().nullable(),
      extrait: z.string().max(5000).nullable(),
      boite: boite.nullable(),
      methode: z.enum(['structure', 'regle', 'ia']),
      confiance: z.literal('non_evaluee'),
    })
    .nullable();
const texteCourt = z.string().max(2000);
const champTexte = champ(texteCourt);
const schemaChamps = z.object({
  typeDocument: champ(z.enum(['facture', 'avoir', 'inconnu'])),
  numero: champTexte,
  dateEmission: champTexte,
  dateEcheance: champTexte,
  emetteurNom: champTexte,
  emetteurSiren: champTexte,
  emetteurSiret: champTexte,
  emetteurTva: champTexte,
  destinataireNom: champTexte,
  destinataireSiren: champTexte,
  destinataireSiret: champTexte,
  destinataireTva: champTexte,
  destinatairePays: champTexte,
  destinataireAbstention: z.string().max(1000).nullable(),
  totalHt: champTexte,
  totalTva: champTexte,
  totalTtc: champTexte,
  devise: champTexte,
  ventilationTva: z.array(z.object({ taux: z.string().max(40), base: z.string().max(40), montant: z.string().max(40) })).max(1000),
});
const schemaPage = z.object({
  page: z.number().int().min(0).max(1_000_000),
  texte: z.string(),
  lignes: z.array(z.object({ texte: z.string(), boite: boite.optional() })).max(LIGNES_MAX_PAR_PAGE).optional(),
});
export const schemaResultatPiece: z.ZodType<ResultatPiece> = z.object({
  pages: z.array(schemaPage).max(PAGES_MAX),
  nbPages: z.number().int().min(0).max(2_147_483_647).nullable(),
  champs: schemaChamps.nullable(),
  methode: z.enum(['structure', 'couche_texte', 'aucune']),
  moteur: z.string().max(200).nullable(),
  lectureImpossible: z.boolean(),
});
export const schemaResultatTexte: z.ZodType<ResultatTexte> = z.object({ champs: schemaChamps.nullable() });

/** Décode une pièce PDF ou XML dans un enfant borné. */
export function analyserPieceIsolee(type: TypePieceDecodee, contenu: Buffer, options?: OptionsAnalyse): Promise<Issue<ResultatPiece>> {
  const entete: DemandeAnalyse = { op: 'piece', type };
  return executerEnfant({ entete, corps: contenu, schema: schemaResultatPiece }, options);
}

/** Extrait les champs d'un texte déjà reconnu (sortie du service OCR) dans un enfant borné. */
export function extraireTexteIsole(pages: PageTexte[], options?: OptionsAnalyse): Promise<Issue<ResultatTexte>> {
  const entete: DemandeAnalyse = { op: 'texte' };
  return executerEnfant({ entete, corps: Buffer.from(JSON.stringify(pages.slice(0, PAGES_MAX_TEXTE)), 'utf8'), schema: schemaResultatTexte }, options);
}

/** Motif présenté à l'utilisateur quand l'analyse isolée n'aboutit pas : en français, sans message technique. */
export function motifEchecAnalyse(cause: CauseEchec): string {
  const suite = ' La pièce est conservée telle quelle ; son contenu est à vérifier ou à saisir à la main.';
  if (cause === 'delai') return `Analyse interrompue : la lecture du fichier a dépassé la durée autorisée.${suite}`;
  if (cause === 'memoire') return `Analyse interrompue : la lecture du fichier a dépassé la mémoire autorisée.${suite}`;
  return `Analyse interrompue : le fichier n’a pas pu être lu de façon sûre.${suite}`;
}

// ── Relevés bancaires ────────────────────────────────────────────────────────────────────────────────────────────────
const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const decimal = z.string().max(60).regex(/^-?\d+(\.\d+)?$/);
const texteBancaire = z.string().max(4000);
const schemaSource = z.object({
  type: z.enum(['reglementaire', 'interne']),
  reference: z.string().max(10_000),
  url: z.string().max(2000).nullable(),
  dateVerification: z.string().max(20).nullable(),
  verification: z.enum(['verifiee', 'non_verifiee', 'sans_objet']),
  periodeApplication: z.string().max(10_000).nullable(),
});
const schemaMouvement = z.object({
  rang: z.number().int().min(0).max(2_147_483_647),
  compte: z.object({ iban: texteBancaire.nullable(), bic: texteBancaire.nullable(), identifiant: texteBancaire.nullable(), devise: texteBancaire.nullable() }),
  dateOperation: dateIso,
  dateValeur: dateIso.nullable(),
  montant: decimal,
  libelle: texteBancaire,
  referenceBanque: texteBancaire.nullable(),
  referenceBoutEnBout: texteBancaire.nullable(),
  contrepartie: z.object({ nom: texteBancaire.nullable(), iban: texteBancaire.nullable() }).nullable(),
  codeOperation: texteBancaire.nullable(),
  cleIdempotence: z.string().min(1).max(200),
});
const schemaCompte = z.object({
  iban: texteBancaire.nullable(),
  identifiant: texteBancaire.nullable(),
  devise: texteBancaire.nullable(),
  soldeOuverture: decimal.nullable(),
  dateOuverture: dateIso.nullable(),
  soldeCloture: decimal.nullable(),
  dateCloture: dateIso.nullable(),
  totalMouvements: decimal,
  nbMouvements: z.number().int().min(0).max(2_147_483_647),
  cadrage: z.enum(['ok', 'ecart', 'non_verifiable']),
  ecart: decimal.nullable(),
});
const schemaRapportReleve = z.object({
  format: z.enum(['camt.053', 'ofx', 'csv', 'agregation']),
  version: z.string().max(200).nullable(),
  comptes: z.array(schemaCompte).max(MOUVEMENTS_MAX_RELEVE),
  mouvements: z.array(schemaMouvement).max(MOUVEMENTS_MAX_RELEVE),
  anomalies: z.array(z.object({ rang: z.number().int().nullable(), code: z.string().max(100), gravite: z.enum(['bloquante', 'majeure', 'mineure', 'information']), message: z.string().max(2000) })).max(MOUVEMENTS_MAX_RELEVE),
  lisible: z.boolean(),
  source: schemaSource,
});
const raisons = z.array(z.string().max(2000)).max(200);
const formatLu = z.string().max(40);
export const schemaResultatReleve: z.ZodType<ResultatReleve> = z.discriminatedUnion('etat', [
  z.object({
    etat: z.literal('lu'),
    encodage: z.string().max(40),
    rapport: schemaRapportReleve,
    profil: schemaProfilCsvBanque.nullable(),
    origineProfil: z.enum(['confirme', 'propose_automatiquement']).nullable(),
    raisons,
  }),
  z.object({ etat: z.literal('format_inconnu'), format: formatLu }),
  z.object({ etat: z.literal('profil_invalide'), format: formatLu }),
  z.object({ etat: z.literal('profil_a_confirmer'), format: formatLu, raisons }),
]) as z.ZodType<ResultatReleve>;

/** Lit un relevé bancaire (camt.053, OFX, CSV, document d'agrégation) dans un enfant borné. */
export function lireReleveIsole(contenu: Buffer, demande: { profilCsv: ProfilCsvBanque | null; profilInvalide: boolean }, options?: OptionsAnalyse): Promise<Issue<ResultatReleve>> {
  const entete: DemandeAnalyse = { op: 'releve', profilCsv: demande.profilCsv, profilInvalide: demande.profilInvalide };
  return executerEnfant({ entete, corps: contenu, schema: schemaResultatReleve }, options);
}

/** Motif présenté à l'utilisateur quand la lecture isolée d'un relevé n'aboutit pas : en français, sans message technique. */
export function motifEchecReleve(cause: CauseEchec): string {
  const suite = ' Le fichier est conservé tel quel ; aucun mouvement n’a été importé.';
  if (cause === 'delai') return `Lecture du relevé interrompue : elle a dépassé la durée autorisée.${suite}`;
  if (cause === 'memoire') return `Lecture du relevé interrompue : elle a dépassé la mémoire autorisée.${suite}`;
  if (cause === 'sortie_trop_grande') return `Lecture du relevé interrompue : le relevé contient trop de mouvements pour être lu en une fois (plus de ${MOUVEMENTS_MAX_RELEVE.toLocaleString('fr-FR')} environ). Scindez-le en plusieurs périodes.${suite}`;
  return `Lecture du relevé interrompue : le fichier n’a pas pu être lu de façon sûre.${suite}`;
}

// ── FEC ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// L'analyseur borne une ligne à TAILLE_MAX_LIGNE_FEC octets au fil des blocs lus : un champ peut dépasser cette taille
// d'au plus un bloc. La borne du schéma est donc le double (une valeur plus longue ne peut pas venir de l'analyseur).
const texteFec = z.string().max(2 * TAILLE_MAX_LIGNE_FEC);
const schemaLigneFec = z.object({
  numeroLigne: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  journalCode: texteFec,
  journalLib: texteFec,
  ecritureNum: texteFec,
  ecritureDate: dateIso,
  compteNum: texteFec,
  compteLib: texteFec,
  compAuxNum: texteFec.nullable(),
  compAuxLib: texteFec.nullable(),
  pieceRef: texteFec,
  pieceDate: dateIso.nullable(),
  ecritureLib: texteFec,
  debit: decimal,
  credit: decimal,
  ecritureLet: texteFec.nullable(),
  dateLet: dateIso.nullable(),
  validDate: dateIso.nullable(),
  montantDevise: decimal.nullable(),
  idevise: texteFec.nullable(),
});
/** Un lot ne dépasse jamais le nombre de lignes convenu avec l'enfant (marge : un enfant défaillant est rejeté, pas toléré). */
const schemaLotFec: z.ZodType<LigneFec[]> = z.array(schemaLigneFec).max(10_000);
/** Rapport de l'enfant, SANS le référentiel : celui-ci est une constante du moteur, reposée par le parent. */
const schemaRapportFec = z.object({
  encodage: z.string().max(40),
  separateur: z.enum(['tabulation', 'pipe', 'point_virgule', 'inconnu']),
  variante: z.enum(['debit_credit', 'montant_sens']),
  entetes: z.array(texteFec).max(100_000),
  nbLignesLues: z.number().int().min(0),
  nbLignesNormalisees: z.number().int().min(0),
  anomalies: z.array(z.object({ ligne: z.number().int().nullable(), colonne: z.string().max(1000).nullable(), code: z.string().max(100), gravite: z.enum(['bloquante', 'majeure', 'mineure', 'information']), message: texteFec })).max(PLAFOND_ANOMALIES_FEC),
  nbAnomaliesParCode: z.record(z.string().max(100), z.number().int().min(0)),
  lisible: z.boolean(),
  conforme: z.boolean(),
  suffisantPourTravaux: z.boolean(),
  totalDebit: decimal,
  totalCredit: decimal,
  dateMin: dateIso.nullable(),
  dateMax: dateIso.nullable(),
});

/** Bornes par défaut d'un import de FEC : la durée couvre tout l'import (insertions en base comprises). */
export const LIMITES_FEC_PAR_DEFAUT: LimitesAnalyse = { dureeMaxMs: 3_600_000, tasMaxMo: 512, memoireMaxMo: 1024, sortieMaxOctets: 16 * 1024 * 1024 };

/**
 * Analyse un FEC EN FLUX dans un enfant borné. Les lignes normalisées, validées par schéma, sont remises par lots à
 * `surLot` dans l'ordre du fichier ; le rapport n'est rendu que si le nombre de lignes reçues est celui qu'il annonce.
 */
export async function analyserFecIsole(
  source: AsyncIterable<Uint8Array>,
  demande: { exerciceDebut: string; exerciceFin: string; nomFichier: string | null; surLot: (lignes: LigneFec[]) => Promise<void> },
  options: OptionsAnalyse = {},
): Promise<Issue<RapportFec>> {
  const entete: DemandeAnalyse = { op: 'fec', exerciceDebut: demande.exerciceDebut, exerciceFin: demande.exerciceFin, nomFichier: demande.nomFichier };
  let recues = 0;
  const issue = await executerEnfantFlux(
    {
      entete,
      corps: source,
      schemaLot: schemaLotFec,
      schemaFin: schemaRapportFec,
      surLot: async (lignes) => {
        recues += lignes.length;
        await demande.surLot(lignes);
      },
    },
    { ...LIMITES_FEC_PAR_DEFAUT, ...options },
  );
  if (!issue.ok) return issue;
  if (issue.valeur.nbLignesNormalisees !== recues) return { ok: false, cause: 'sortie_invalide', dureeMs: issue.dureeMs };
  return { ok: true, valeur: { ...issue.valeur, referentiel: referentielFec() }, dureeMs: issue.dureeMs };
}

/** Motif présenté à l'utilisateur quand l'analyse isolée d'un FEC n'aboutit pas : en français, sans message technique. */
export function motifEchecFec(cause: CauseEchec): string {
  const suite = ' Le fichier est conservé tel quel ; aucune ligne n’a été importée et les données actives du dossier sont inchangées.';
  if (cause === 'delai') return `Import interrompu : la lecture du fichier a dépassé la durée autorisée.${suite}`;
  if (cause === 'memoire') return `Import interrompu : la lecture du fichier a dépassé la mémoire autorisée.${suite}`;
  return `Import interrompu : le fichier n’a pas pu être lu de façon sûre.${suite}`;
}
