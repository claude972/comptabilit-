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
import type { PageTexte } from '@comtaple/core';
import { z } from 'zod';
import { type DemandeAnalyse, LIGNES_MAX_PAR_PAGE, PAGES_MAX, PAGES_MAX_TEXTE, type ResultatPiece, type ResultatTexte, type TypePieceDecodee } from './analyse-types.js';

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
const LECTURES_ENFANT = [join(PAQUET, 'dist'), join(PAQUET, 'node_modules'), join(PAQUET, 'package.json'), join(RACINE, 'node_modules'), join(RACINE, 'packages', 'core')];

export function argumentsEnfant(limites: LimitesAnalyse, entree: string, lecturesSupplementaires: string[] = []): string[] {
  return [
    `--max-old-space-size=${limites.tasMaxMo}`,
    // Modèle de permissions (stable depuis Node 22.13 / 23.5) : lecture limitée aux chemins listés ; écriture, processus
    // fils, fils d'exécution, modules natifs, WASI et inspecteur refusés faute d'autorisation explicite.
    '--permission',
    ...[...LECTURES_ENFANT, ...lecturesSupplementaires].map((c) => `--allow-fs-read=${c}`),
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

/**
 * Lance un enfant, lui transmet `entete` puis `corps`, et rend sa sortie validée par `schema`, ou la cause de l'échec.
 * L'environnement de l'enfant est VIDE : aucune variable de connexion (base, Redis, stockage), aucun jeton.
 */
export function executerEnfant<T>(demande: { entete: unknown; corps: Buffer; schema: z.ZodType<T> }, options: OptionsAnalyse = {}): Promise<Issue<T>> {
  const limites: LimitesAnalyse = {
    dureeMaxMs: options.dureeMaxMs ?? LIMITES_PAR_DEFAUT.dureeMaxMs,
    tasMaxMo: options.tasMaxMo ?? LIMITES_PAR_DEFAUT.tasMaxMo,
    memoireMaxMo: options.memoireMaxMo ?? LIMITES_PAR_DEFAUT.memoireMaxMo,
    sortieMaxOctets: options.sortieMaxOctets ?? LIMITES_PAR_DEFAUT.sortieMaxOctets,
  };
  const entree = options.entree ?? ENTREE_ENFANT;
  const debut = performance.now();
  return new Promise((rendre, rejeter) => {
    const enfant = spawn(process.execPath, argumentsEnfant(limites, entree, options.lecturesSupplementaires), {
      env: {},
      cwd: dirname(entree),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    enCours.add(enfant);
    let arret: CauseEchec | null = null;
    const arreter = (cause: CauseEchec) => {
      arret ??= cause;
      enfant.kill('SIGKILL');
    };

    const minuterie = setTimeout(() => arreter('delai'), limites.dureeMaxMs);
    let mesureEnCours = false;
    const surveillance = setInterval(() => {
      if (mesureEnCours || enfant.pid === undefined) return;
      mesureEnCours = true;
      void memoireResidenteMo(enfant.pid).then((mo) => {
        mesureEnCours = false;
        if (mo !== null && mo > limites.memoireMaxMo) arreter('memoire');
      });
    }, 100);

    const sortie: Buffer[] = [];
    let tailleSortie = 0;
    enfant.stdout.on('data', (m: Buffer) => {
      tailleSortie += m.length;
      if (tailleSortie > limites.sortieMaxOctets) {
        sortie.length = 0;
        arreter('sortie_trop_grande');
      } else if (!arret) sortie.push(m);
    });
    // Sortie d'erreur : seuls ses premiers octets servent, à reconnaître un dépassement du tas ; jamais relayée.
    let erreurs = '';
    enfant.stderr.on('data', (m: Buffer) => {
      if (erreurs.length < 8192) erreurs += m.toString('latin1').slice(0, 8192 - erreurs.length);
    });

    const finir = () => {
      clearTimeout(minuterie);
      clearInterval(surveillance);
      enCours.delete(enfant);
    };
    enfant.on('error', (e) => {
      finir();
      rejeter(new Error(`Lancement du processus d'analyse impossible : ${e.message}`));
    });
    enfant.on('close', (code) => {
      finir();
      const dureeMs = Math.round(performance.now() - debut);
      if (arret) return rendre({ ok: false, cause: arret, dureeMs });
      if (code !== 0) return rendre({ ok: false, cause: /heap out of memory|Allocation failed|out of memory/i.test(erreurs) ? 'memoire' : 'plantage', dureeMs });
      let brut: unknown;
      try {
        brut = JSON.parse(Buffer.concat(sortie).toString('utf8'));
      } catch {
        return rendre({ ok: false, cause: 'sortie_invalide', dureeMs });
      }
      const valide = demande.schema.safeParse(brut);
      rendre(valide.success ? { ok: true, valeur: valide.data, dureeMs } : { ok: false, cause: 'sortie_invalide', dureeMs });
    });

    // Un enfant mort avant d'avoir tout lu ferme son entrée : l'erreur d'écriture est attendue, l'issue vient de « close ».
    enfant.stdin.on('error', () => undefined);
    const entete = Buffer.from(JSON.stringify(demande.entete), 'utf8');
    const longueur = Buffer.alloc(4);
    longueur.writeUInt32BE(entete.length);
    enfant.stdin.write(longueur);
    enfant.stdin.write(entete);
    enfant.stdin.end(demande.corps);
  });
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
