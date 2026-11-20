/**
 * Reprise du fichier des immobilisations par import CSV (D-092) : lecture, correspondance des colonnes, contrôle ligne par ligne.
 *
 * Tout est PUR et DÉTERMINISTE : le fichier est lu comme du texte inerte (aucune formule n'est évaluée, aucun format tableur
 * n'est interprété), rien n'est écrit, rien n'est deviné. Les contrôles de chaque ligne sont ceux de la saisie manuelle
 * (`schemaImmobilisation`) ; s'y ajoutent les règles propres à l'import : comptes de classe 20 ou 21, durée exprimée sans ambiguïté
 * d'unité, montants à deux décimales au plus (aucun arrondi silencieux), dates JJ/MM/AAAA ou AAAA-MM-JJ.
 * Une ligne qui ne passe pas est REJETÉE avec un motif en français et la valeur lue ; une ligne qui répète une immobilisation
 * existante (ou déjà lue) est IGNORÉE comme doublon, jamais écrasante.
 */
import { Buffer } from 'node:buffer';
import iconv from 'iconv-lite';
import { normaliserEntete } from '../banque/csv.js';
import { decoderTexteReleve } from '../banque/detection.js';
import { dateCivileValide } from '../dates.js';
import { analyserMontantFr, dec, versChaine } from '../montant.js';
import { schemaImmobilisation } from './schema.js';

export const VERSION_REPRISE_IMMOBILISATIONS = '2026-11-20.1';
/** Taille maximale du fichier repris (5 Mio). */
export const TAILLE_MAX_REPRISE = 5 * 1024 * 1024;
/** Nombre maximal de lignes de données d'un fichier repris. */
export const LIGNES_MAX_REPRISE = 5000;
/** Longueur maximale d'une valeur lue conservée dans le rapport. */
export const LONGUEUR_MAX_VALEUR_LUE = 200;

export interface ChampReprise {
  code: CodeChampReprise;
  libelle: string;
  obligatoire: boolean;
  aide: string;
}
export const CODES_CHAMPS_REPRISE = [
  'libelle',
  'compteImmobilisation',
  'baseAmortissable',
  'dateAcquisition',
  'dateMiseEnService',
  'dureeMois',
  'dureeAnnees',
  'amortissementsAnterieurs',
  'modeAmortissement',
  'coefficientDegressif',
  'eligibiliteDegressifConfirmee',
  'valeurResiduelle',
  'dateSortie',
] as const;
export type CodeChampReprise = (typeof CODES_CHAMPS_REPRISE)[number];

/** Champs reconnus, dans l'ordre d'affichage. Une durée est obligatoire, en mois OU en années (jamais les deux). */
export const CHAMPS_REPRISE: readonly ChampReprise[] = [
  { code: 'libelle', libelle: 'Désignation', obligatoire: true, aide: 'Texte libre, 200 caractères au plus.' },
  { code: 'compteImmobilisation', libelle: 'Compte d’immobilisation', obligatoire: true, aide: 'Compte de classe 20 (incorporelles) ou 21 (corporelles), chiffres seuls.' },
  { code: 'baseAmortissable', libelle: 'Valeur brute à amortir (€)', obligatoire: true, aide: 'Montant strictement positif, deux décimales au plus (virgule ou point).' },
  { code: 'dateAcquisition', libelle: 'Date d’acquisition', obligatoire: false, aide: 'JJ/MM/AAAA ou AAAA-MM-JJ. Obligatoire pour un bien déclaré en dégressif.' },
  { code: 'dateMiseEnService', libelle: 'Date de mise en service', obligatoire: true, aide: 'JJ/MM/AAAA ou AAAA-MM-JJ.' },
  { code: 'dureeMois', libelle: 'Durée d’amortissement en mois', obligatoire: false, aide: 'Nombre entier de mois. À choisir à la place de la durée en années.' },
  { code: 'dureeAnnees', libelle: 'Durée d’amortissement en années', obligatoire: false, aide: 'Nombre entier d’années (converti en mois ×12). À choisir à la place de la durée en mois.' },
  { code: 'amortissementsAnterieurs', libelle: 'Amortissements antérieurs (€)', obligatoire: false, aide: 'Cumul déjà pratiqué avant l’exercice ; vide = non renseigné.' },
  { code: 'modeAmortissement', libelle: 'Mode d’amortissement', obligatoire: false, aide: 'Linéaire ou dégressif ; vide = linéaire, comme à la saisie manuelle.' },
  { code: 'coefficientDegressif', libelle: 'Coefficient dégressif', obligatoire: false, aide: '1,25 ; 1,75 ou 2,25, seulement pour un bien dégressif.' },
  { code: 'eligibiliteDegressifConfirmee', libelle: 'Éligibilité au dégressif confirmée', obligatoire: false, aide: 'Oui/non, seulement pour un bien dégressif : jamais devinée.' },
  { code: 'valeurResiduelle', libelle: 'Valeur résiduelle (€)', obligatoire: false, aide: 'Strictement inférieure à la valeur brute.' },
  { code: 'dateSortie', libelle: 'Date de sortie', obligatoire: false, aide: 'Cession ou mise au rebut.' },
];
const LIBELLE_CHAMP = Object.fromEntries(CHAMPS_REPRISE.map((c) => [c.code, c.libelle])) as Record<CodeChampReprise, string>;

/** Colonne (indice à partir de 0) associée à chaque champ ; absent ou null : non associé. */
export type CorrespondanceColonnes = Partial<Record<CodeChampReprise, number | null>>;

// ───────────────────────────── Lecture du fichier ─────────────────────────────

export type CodeErreurReprise = 'vide' | 'trop_gros' | 'format' | 'binaire' | 'sans_separateur' | 'guillemet' | 'sans_entetes' | 'sans_donnees' | 'trop_de_lignes' | 'encodage' | 'entetes_en_double';

/** Refus de TOUT le fichier (et non d'une ligne) : le message est destiné à la personne qui l'a déposé. */
export class ErreurReprise extends Error {
  constructor(
    readonly code: CodeErreurReprise,
    message: string,
    readonly ligne?: number,
  ) {
    super(message);
    this.name = 'ErreurReprise';
  }
}

export type Separateur = ';' | ',' | '\t';
export type EncodageReprise = 'utf-8' | 'iso-8859-15' | 'windows-1252';
export interface OptionsLectureReprise {
  /** Encodage imposé (sinon détecté : UTF-8 strict, puis ISO-8859-15 ou Windows-1252). */
  encodage?: EncodageReprise;
  /** Séparateur imposé (sinon détecté). */
  separateur?: Separateur;
}
export interface FichierLu {
  encodage: string;
  /** Vrai si l'encodage a été choisi par la personne, faux s'il a été détecté. */
  encodageImpose: boolean;
  separateur: Separateur;
  separateurImpose: boolean;
  entetes: string[];
  lignes: Array<{ numero: number; cellules: string[] }>;
  /** Lignes entièrement vides, ignorées (non comptées dans le rapport). */
  lignesVidesIgnorees: number;
  avertissements: string[];
}

function ouvrirFormat(octets: Buffer): void {
  const debut = octets.subarray(0, 8);
  if (debut[0] === 0x50 && debut[1] === 0x4b && (debut[2] === 0x03 || debut[2] === 0x05)) {
    throw new ErreurReprise('format', 'Ce fichier est un classeur (XLSX, ODS) ou une archive : seul le format CSV est pris en charge. Enregistrez-le au format CSV (séparateur point-virgule) depuis votre tableur, puis déposez-le de nouveau.');
  }
  if (debut.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw new ErreurReprise('format', 'Ce fichier est un ancien classeur (XLS) : seul le format CSV est pris en charge. Enregistrez-le au format CSV, puis déposez-le de nouveau.');
  }
  if (debut.subarray(0, 4).toString('latin1') === '%PDF') throw new ErreurReprise('format', 'Ce fichier est un PDF : seul le format CSV est pris en charge.');
}

function compterHorsGuillemets(ligne: string, c: string): number {
  let n = 0;
  let dedans = false;
  for (const x of ligne) {
    if (x === '"') dedans = !dedans;
    else if (x === c && !dedans) n++;
  }
  return n;
}

function detecterSeparateur(texte: string): Separateur {
  const lignes = texte.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '').slice(0, 30);
  const entete = lignes[0];
  if (entete === undefined) throw new ErreurReprise('vide', 'Le fichier est vide.');
  let meilleur: { s: Separateur; score: number } | null = null;
  for (const s of [';', ',', '\t'] as const) {
    const h = compterHorsGuillemets(entete, s);
    if (h < 1) continue;
    const coherentes = lignes.filter((l) => compterHorsGuillemets(l, s) === h).length;
    const score = coherentes * 1000 + h;
    if (!meilleur || score > meilleur.score) meilleur = { s, score };
  }
  if (!meilleur) throw new ErreurReprise('sans_separateur', 'Aucun séparateur « ; », « , » ou tabulation n’a été trouvé dans la première ligne : au moins deux colonnes sont attendues.');
  return meilleur.s;
}

/** Découpe en enregistrements (RFC 4180 : guillemets doublés, retours à la ligne dans un champ entre guillemets). `ligne` = ligne physique du début. */
function decouper(texte: string, separateur: string): Array<{ numero: number; cellules: string[] }> {
  const sortie: Array<{ numero: number; cellules: string[] }> = [];
  let cellules: string[] = [];
  let champ = '';
  let entre = false;
  let debutGuillemets = 0;
  let ligne = 1;
  let ligneDebut = 1;
  let vu = false;
  const terminer = (): void => {
    cellules.push(champ);
    sortie.push({ numero: ligneDebut, cellules });
    cellules = [];
    champ = '';
    vu = false;
  };
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charAt(i);
    if (entre) {
      if (c === '"') {
        if (texte.charAt(i + 1) === '"') {
          champ += '"';
          i++;
        } else entre = false;
      } else {
        if (c === '\n') ligne++;
        champ += c;
      }
      continue;
    }
    if (c === '"' && champ === '') {
      entre = true;
      debutGuillemets = ligne;
      vu = true;
    } else if (c === separateur) {
      cellules.push(champ);
      champ = '';
      vu = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte.charAt(i + 1) === '\n') i++;
      terminer();
      ligne++;
      ligneDebut = ligne;
    } else {
      champ += c;
      vu = true;
    }
  }
  if (entre) throw new ErreurReprise('guillemet', `Un guillemet ouvert à la ligne ${debutGuillemets} n’est jamais refermé : le fichier est mal formé.`, debutGuillemets);
  if (vu || champ !== '' || cellules.length > 0) terminer();
  return sortie;
}

/**
 * Lit un fichier CSV d'immobilisations. Refuse le fichier entier (ErreurReprise) s'il est vide, trop gros, d'un autre format,
 * binaire, sans séparateur, mal formé ou au-delà de 5 000 lignes. Ne lève jamais pour un problème propre à une ligne.
 */
export function lireFichierReprise(octets: Uint8Array, options: OptionsLectureReprise = {}): FichierLu {
  if (!(octets instanceof Uint8Array)) throw new Error('Octets attendus (Uint8Array).');
  if (octets.length === 0) throw new ErreurReprise('vide', 'Le fichier est vide.');
  if (octets.length > TAILLE_MAX_REPRISE) throw new ErreurReprise('trop_gros', `Fichier trop volumineux : ${octets.length} octets, maximum ${TAILLE_MAX_REPRISE} octets (5 Mio).`);
  const tampon = Buffer.from(octets.buffer, octets.byteOffset, octets.byteLength);
  ouvrirFormat(tampon);
  const utf16 = (tampon[0] === 0xff && tampon[1] === 0xfe) || (tampon[0] === 0xfe && tampon[1] === 0xff);
  if (!utf16 && tampon.includes(0)) throw new ErreurReprise('binaire', 'Ce fichier contient des octets nuls : ce n’est pas un fichier texte CSV.');

  let texte: string;
  let encodage: string;
  const avertissements: string[] = [];
  if (options.encodage) {
    texte = options.encodage === 'utf-8' ? new TextDecoder('utf-8', { fatal: false }).decode(tampon) : iconv.decode(tampon, options.encodage);
    encodage = options.encodage;
  } else {
    ({ texte, encodage } = decoderTexteReleve(tampon));
  }
  if (texte.charCodeAt(0) === 0xfeff) texte = texte.slice(1);
  if (texte.includes('\uFFFD')) avertissements.push('Des caractères illisibles (U+FFFD) ont été trouvés : l’encodage choisi ne convient peut-être pas ; essayez l’autre encodage.');
  if (texte.trim() === '') throw new ErreurReprise('vide', 'Le fichier ne contient aucune donnée.');

  const separateur = options.separateur ?? detecterSeparateur(texte);
  const enregistrements = decouper(texte, separateur);
  let vides = 0;
  const utiles = enregistrements.filter((e) => {
    const vide = e.cellules.every((c) => c.trim() === '');
    if (vide) vides++;
    return !vide;
  });
  const [entete, ...donnees] = utiles;
  if (!entete) throw new ErreurReprise('sans_entetes', 'Le fichier ne contient aucune ligne d’en-têtes.');
  if (entete.cellules.length < 2) throw new ErreurReprise('sans_separateur', 'La première ligne ne comporte qu’une colonne avec ce séparateur : choisissez le bon séparateur.');
  if (donnees.length === 0) throw new ErreurReprise('sans_donnees', 'Le fichier ne contient que la ligne d’en-têtes : aucune immobilisation à reprendre.');
  if (donnees.length > LIGNES_MAX_REPRISE) throw new ErreurReprise('trop_de_lignes', `Trop de lignes : ${donnees.length} lignes de données, maximum ${LIGNES_MAX_REPRISE}. Découpez le fichier en plusieurs fichiers.`);
  return {
    encodage,
    encodageImpose: Boolean(options.encodage),
    separateur,
    separateurImpose: Boolean(options.separateur),
    entetes: entete.cellules.map((e) => e.trim()),
    lignes: donnees,
    lignesVidesIgnorees: vides,
    avertissements,
  };
}

// ───────────────────────────── Correspondance des colonnes ─────────────────────────────

const SYNONYMES: Partial<Record<CodeChampReprise, readonly string[]>> = {
  libelle: ['designation', 'libelle', 'intitule', 'description', 'nom', 'bien', 'immobilisation', 'designation du bien', 'libelle du bien', 'nom du bien', 'designation immobilisation', 'libelle immobilisation'],
  compteImmobilisation: ['compte', 'compte immobilisation', 'compte d immobilisation', 'n compte', 'no compte', 'numero de compte', 'numero compte', 'compte comptable', 'compte general', 'cpte', 'n de compte'],
  baseAmortissable: ['valeur brute', 'valeur d acquisition', 'valeur acquisition', 'valeur origine', 'valeur d origine', 'montant', 'base amortissable', 'base', 'cout d acquisition', 'cout acquisition', 'prix d achat', 'prix achat', 'montant ht', 'valeur ht', 'valeur brute ht', 'valeur', 'valeur brute eur', 'montant acquisition', 'base amortissable eur'],
  dateAcquisition: ['date acquisition', 'date d acquisition', 'date achat', 'date d achat', 'acquisition', 'date acquisition ou construction', 'date d acquisition ou de construction', 'date de construction', 'achat', 'date d acquisition ou construction'],
  dateMiseEnService: ['date mise en service', 'date de mise en service', 'mise en service', 'date mes', 'date de mes', 'date service', 'date d entree en service', 'date mise service'],
  amortissementsAnterieurs: ['amortissements anterieurs', 'amortissement anterieur', 'cumul amortissements', 'cumul des amortissements', 'amortissements cumules', 'amort cumules', 'amort anterieurs', 'cumul amort', 'cumul amortissements anterieurs', 'amortissements deja pratiques', 'amortissements anterieurs eur'],
  modeAmortissement: ['mode amortissement', 'mode d amortissement', 'mode', 'type amortissement', 'type d amortissement', 'methode d amortissement', 'methode amortissement'],
  coefficientDegressif: ['coefficient degressif', 'coefficient', 'coef degressif', 'coef'],
  eligibiliteDegressifConfirmee: ['eligibilite degressif', 'eligibilite au degressif', 'degressif eligible', 'eligible degressif', 'eligibilite degressif confirmee', 'eligible au degressif'],
  valeurResiduelle: ['valeur residuelle', 'valeur resid', 'residuelle', 'vr', 'valeur residuelle eur'],
  dateSortie: ['date sortie', 'date de sortie', 'sortie', 'date cession', 'date de cession', 'date de mise au rebut', 'date rebut', 'date de sortie de l actif'],
};

/** Unité d'une colonne de durée, d'après son seul en-tête ; null si absente ou ambiguë (jamais devinée). */
function uniteDuree(normalise: string): 'mois' | 'annees' | 'sans_unite' | null {
  const est = /(^| )(duree|nombre|nb)( |$)/.test(normalise);
  if (!est) return null;
  const mois = /(^| )mois( |$)/.test(normalise);
  const annees = /(^| )(ans?|annees?)( |$)/.test(normalise);
  if (mois && annees) return 'sans_unite';
  if (mois) return 'mois';
  if (annees) return 'annees';
  return /(^| )duree( |$)/.test(normalise) ? 'sans_unite' : null;
}

export interface PropositionCorrespondance {
  correspondance: CorrespondanceColonnes;
  /** Raisons pour lesquelles un champ n'a PAS été proposé (colonne ambiguë, durée sans unité…). */
  remarques: string[];
}

/** Propose une correspondance d'après les en-têtes usuels. Une proposition ambiguë n'est jamais faite : la personne choisit. */
export function proposerCorrespondance(entetes: readonly string[]): PropositionCorrespondance {
  const normalises = entetes.map(normaliserEntete);
  const remarques: string[] = [];
  const candidats = new Map<CodeChampReprise, number[]>();
  const ajouter = (code: CodeChampReprise, i: number): void => {
    candidats.set(code, [...(candidats.get(code) ?? []), i]);
  };
  normalises.forEach((n, i) => {
    for (const [code, liste] of Object.entries(SYNONYMES) as Array<[CodeChampReprise, readonly string[]]>) {
      if (liste.includes(n)) ajouter(code, i);
    }
    const u = uniteDuree(n);
    if (u === 'mois') ajouter('dureeMois', i);
    else if (u === 'annees') ajouter('dureeAnnees', i);
    else if (u === 'sans_unite') remarques.push(`La colonne « ${entetes[i] ?? ''} » ne dit pas si la durée est en mois ou en années : choisissez-la vous-même dans la liste de la durée en mois ou de la durée en années.`);
  });
  const correspondance: CorrespondanceColonnes = {};
  const prises = new Set<number>();
  for (const champ of CHAMPS_REPRISE) {
    const liste = candidats.get(champ.code) ?? [];
    if (liste.length === 1 && !prises.has(liste[0]!)) {
      correspondance[champ.code] = liste[0]!;
      prises.add(liste[0]!);
    } else if (liste.length > 1) {
      remarques.push(`Plusieurs colonnes pourraient correspondre à « ${champ.libelle} » (${liste.map((i) => `« ${entetes[i] ?? ''} »`).join(', ')}) : choisissez-la vous-même.`);
    }
  }
  if (correspondance.dureeMois != null && correspondance.dureeAnnees != null) {
    remarques.push('Une durée en mois et une durée en années sont toutes deux présentes : choisissez-en une seule.');
    delete correspondance.dureeMois;
    delete correspondance.dureeAnnees;
  }
  return { correspondance, remarques };
}

/** Problèmes qui empêchent d'interpréter le fichier avec cette correspondance (liste vide : correspondance utilisable). */
export function problemesCorrespondance(correspondance: CorrespondanceColonnes, nbColonnes: number): string[] {
  const p: string[] = [];
  const utilisees = new Map<number, CodeChampReprise>();
  for (const code of CODES_CHAMPS_REPRISE) {
    const i = correspondance[code];
    if (i == null) continue;
    if (!Number.isInteger(i) || i < 0 || i >= nbColonnes) {
      p.push(`« ${LIBELLE_CHAMP[code]} » : la colonne ${String(i)} n’existe pas dans ce fichier.`);
      continue;
    }
    const autre = utilisees.get(i);
    if (autre) p.push(`La même colonne ne peut pas servir à la fois pour « ${LIBELLE_CHAMP[autre]} » et « ${LIBELLE_CHAMP[code]} ».`);
    utilisees.set(i, code);
  }
  for (const c of CHAMPS_REPRISE) {
    if (c.obligatoire && correspondance[c.code] == null) p.push(`Colonne obligatoire absente : « ${c.libelle} » n’est associée à aucune colonne du fichier.`);
  }
  const m = correspondance.dureeMois != null;
  const a = correspondance.dureeAnnees != null;
  if (!m && !a) p.push('Colonne obligatoire absente : la durée d’amortissement (en mois ou en années) n’est associée à aucune colonne du fichier.');
  if (m && a) p.push('Choisissez une seule durée : en mois ou en années, pas les deux.');
  return p;
}

// ───────────────────────────── Contrôle ligne par ligne ─────────────────────────────

/** Valeur prête pour l'insertion : champs de la saisie manuelle, valeurs normalisées (montants en chaîne décimale exacte). */
export interface ImmobilisationReprise {
  libelle: string;
  compteImmobilisation: string;
  baseAmortissable: string;
  dateAcquisition: string | null;
  dateMiseEnService: string;
  dureeMois: number;
  amortissementsAnterieurs: string | null;
  modeAmortissement: 'lineaire' | 'degressif';
  coefficientDegressif: string | null;
  eligibiliteDegressifConfirmee: boolean | null;
  valeurResiduelle: string | null;
  dateSortie: string | null;
}

export type StatutLigneReprise = 'valide' | 'invalide' | 'doublon';
export type CauseDoublon = 'doublon_dossier' | 'doublon_fichier' | 'deja_repris';
export interface LigneReprise {
  /** Numéro de la ligne dans le fichier (l'en-tête est la ligne de tête, les données commencent après). */
  ligne: number;
  statut: StatutLigneReprise;
  cause: CauseDoublon | null;
  motifs: string[];
  /** Valeurs lues dans les colonnes associées, telles quelles (tronquées à 200 caractères). Jamais neutralisées ici. */
  lues: Partial<Record<CodeChampReprise, string>>;
  immobilisation: ImmobilisationReprise | null;
  cle: string | null;
}

/** Normalise une désignation pour la comparaison des doublons : sans accents, minuscules, ponctuation et espaces réduits. */
export function normaliserDesignation(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Clé de doublon : même désignation normalisée, même date de mise en service, même valeur brute (dossier fixé par l'appelant). */
export function cleDoublon(libelle: string, dateMiseEnService: string, baseAmortissable: string): string {
  return `${normaliserDesignation(libelle)}|${dateMiseEnService}|${versChaine(dec(baseAmortissable))}`;
}

/**
 * Neutralise l'interprétation d'une cellule par un tableur : toute valeur commençant par = + - @ (ou tabulation, retour chariot,
 * y compris leurs formes pleine chasse) est précédée d'une apostrophe. À appliquer à l'AFFICHAGE du rapport et à son export.
 */
export function neutraliserCellule(valeur: string): string {
  return /^\s*[=+\-@＝＋－＠\t\r]/.test(valeur) ? `'${valeur}` : valeur;
}

const tronquer = (v: string): string => (v.length > LONGUEUR_MAX_VALEUR_LUE ? `${v.slice(0, LONGUEUR_MAX_VALEUR_LUE)}…` : v).replace(/\u0000/g, '');
const CONTROLE = /[\u0000-\u001f\u007f]/;

type Lecture<T> = { ok: true; valeur: T } | { ok: false; motif: string };
const ok = <T>(valeur: T): Lecture<T> => ({ ok: true, valeur });
const ko = (motif: string): Lecture<never> => ({ ok: false, motif });

function lireDate(t: string): Lecture<string> {
  let iso: string | null = null;
  let m = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(t);
  if (m) iso = `${m[3]}-${m[2]}-${m[1]}`;
  else if ((m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(t))) iso = `${m[1]}-${m[2]}-${m[3]}`;
  if (!iso) return ko(`date illisible : JJ/MM/AAAA ou AAAA-MM-JJ attendu (années sur quatre chiffres)`);
  const [a, mo, j] = iso.split('-').map(Number) as [number, number, number];
  return dateCivileValide(a, mo, j) ? ok(iso) : ko('date inexistante dans le calendrier');
}

function lireMontant(t: string): Lecture<string> {
  const d = analyserMontantFr(t);
  if (!d) return ko('montant illisible ou ambigu (exemples acceptés : 1234,56 ; 1 234.56 ; 1.234,56)');
  if (d.decimalPlaces() > 2) return ko('plus de deux décimales : aucun arrondi n’est fait, corrigez le fichier');
  return ok(versChaine(d));
}

function lireEntierPositif(t: string, unite: string): Lecture<number> {
  if (!/^\d{1,5}$/.test(t)) return ko(`durée entière attendue en ${unite} (chiffres seuls, sans décimale)`);
  return ok(Number(t));
}

function lireBooleen(t: string): Lecture<boolean> {
  const n = normaliserEntete(t);
  if (['oui', 'o', 'vrai', 'true', '1', 'yes', 'y'].includes(n)) return ok(true);
  if (['non', 'n', 'faux', 'false', '0', 'no'].includes(n)) return ok(false);
  return ko('oui ou non attendu');
}

function lireMode(t: string): Lecture<'lineaire' | 'degressif'> {
  const n = normaliserEntete(t);
  if (['lineaire', 'lin', 'l'].includes(n)) return ok('lineaire');
  if (['degressif', 'deg', 'd'].includes(n)) return ok('degressif');
  return ko('mode inconnu : « linéaire » ou « dégressif » attendu');
}

/** Contrôle une ligne (cellules brutes) : renvoie l'immobilisation prête à insérer, ou les motifs de rejet. */
export function controlerLigne(numero: number, cellules: readonly string[], entetes: readonly string[], correspondance: CorrespondanceColonnes): LigneReprise {
  const lues: Partial<Record<CodeChampReprise, string>> = {};
  const motifs: string[] = [];
  const probleme = problemesCorrespondance(correspondance, entetes.length);
  for (const code of CODES_CHAMPS_REPRISE) {
    const i = correspondance[code];
    if (i != null && Number.isInteger(i) && i >= 0 && i < entetes.length) lues[code] = tronquer(cellules[i] ?? '');
  }
  const rejet = (m: string[]): LigneReprise => ({ ligne: numero, statut: 'invalide', cause: null, motifs: m, lues, immobilisation: null, cle: null });
  if (probleme.length) return rejet(probleme);
  if (cellules.length !== entetes.length) {
    return rejet([`Nombre de colonnes inattendu : ${cellules.length} colonne(s) lue(s) au lieu de ${entetes.length} (ligne mal formée, séparateur dans une valeur non entre guillemets ?). Aucune valeur n’est devinée.`]);
  }
  const brut = (code: CodeChampReprise): string => {
    const i = correspondance[code];
    return i == null ? '' : (cellules[i] ?? '').trim();
  };
  const lire = <T,>(code: CodeChampReprise, f: (t: string) => Lecture<T>, obligatoire: boolean): T | undefined => {
    const t = brut(code);
    if (t === '') {
      if (obligatoire) motifs.push(`${LIBELLE_CHAMP[code]} : valeur obligatoire absente`);
      return undefined;
    }
    const r = f(t);
    if (!r.ok) {
      motifs.push(`${LIBELLE_CHAMP[code]} : ${r.motif}`);
      return undefined;
    }
    return r.valeur;
  };

  const libelle = lire('libelle', (t) => (CONTROLE.test(t) ? ko('caractères de contrôle interdits') : ok(t.replace(/\s+/g, ' '))), true);
  const compte = lire(
    'compteImmobilisation',
    (t) => {
      if (!/^\d+$/.test(t)) return ko('chiffres seuls attendus (exemple : 218300)');
      if (!/^2[01]/.test(t)) return ko('compte de classe 20 (incorporelles) ou 21 (corporelles) attendu');
      return ok(t);
    },
    true,
  );
  const base = lire('baseAmortissable', lireMontant, true);
  const acquisition = lire('dateAcquisition', lireDate, false);
  const service = lire('dateMiseEnService', lireDate, true);
  const duree =
    correspondance.dureeAnnees != null
      ? (() => {
          const a = lire('dureeAnnees', (t) => lireEntierPositif(t, 'années'), true);
          return a === undefined ? undefined : a * 12;
        })()
      : lire('dureeMois', (t) => lireEntierPositif(t, 'mois'), true);
  const anterieurs = lire('amortissementsAnterieurs', lireMontant, false);
  const mode = lire('modeAmortissement', lireMode, false);
  const coefficient = lire(
    'coefficientDegressif',
    (t) => {
      const d = analyserMontantFr(t);
      return d && d.decimalPlaces() <= 2 ? ok(d.toFixed(2)) : ko('coefficient illisible (1,25 ; 1,75 ou 2,25 attendu)');
    },
    false,
  );
  const eligible = lire('eligibiliteDegressifConfirmee', lireBooleen, false);
  const residuelle = lire('valeurResiduelle', lireMontant, false);
  const sortie = lire('dateSortie', lireDate, false);
  if (motifs.length) return rejet(motifs);

  const candidat = {
    libelle: libelle!,
    compteImmobilisation: compte!,
    baseAmortissable: base!,
    dateMiseEnService: service!,
    dureeMois: duree!,
    modeAmortissement: mode ?? 'lineaire',
    ...(acquisition !== undefined ? { dateAcquisition: acquisition } : {}),
    ...(anterieurs !== undefined ? { amortissementsAnterieurs: anterieurs } : {}),
    ...(coefficient !== undefined ? { coefficientDegressif: coefficient } : {}),
    ...(eligible !== undefined ? { eligibiliteDegressifConfirmee: eligible } : {}),
    ...(residuelle !== undefined ? { valeurResiduelle: residuelle } : {}),
    ...(sortie !== undefined ? { dateSortie: sortie } : {}),
  };
  const r = schemaImmobilisation.safeParse(candidat);
  if (!r.success) {
    const vus = new Set<string>();
    for (const issue of r.error.issues) {
      const champ = String(issue.path[0] ?? '');
      const code: CodeChampReprise | undefined = champ === 'dureeMois' && correspondance.dureeAnnees != null ? 'dureeAnnees' : (champ as CodeChampReprise);
      const texte = `${LIBELLE_CHAMP[code] ?? champ} : ${issue.message}`;
      if (!vus.has(texte)) {
        vus.add(texte);
        motifs.push(texte);
      }
    }
    return rejet(motifs);
  }
  const d = r.data;
  const immobilisation: ImmobilisationReprise = {
    libelle: d.libelle,
    compteImmobilisation: d.compteImmobilisation,
    baseAmortissable: d.baseAmortissable,
    dateAcquisition: d.dateAcquisition ?? null,
    dateMiseEnService: d.dateMiseEnService,
    dureeMois: d.dureeMois,
    amortissementsAnterieurs: d.amortissementsAnterieurs ?? null,
    modeAmortissement: d.modeAmortissement,
    coefficientDegressif: d.modeAmortissement === 'degressif' ? (d.coefficientDegressif as string) : null,
    eligibiliteDegressifConfirmee: d.modeAmortissement === 'degressif' ? (d.eligibiliteDegressifConfirmee as boolean) : null,
    valeurResiduelle: d.valeurResiduelle ?? null,
    dateSortie: d.dateSortie ?? null,
  };
  return { ligne: numero, statut: 'valide', cause: null, motifs: [], lues, immobilisation, cle: cleDoublon(d.libelle, d.dateMiseEnService, d.baseAmortissable) };
}

export interface ContexteReprise {
  /** Immobilisations déjà présentes dans le dossier (jamais modifiées). */
  existantes: ReadonlyArray<{ libelle: string; dateMiseEnService: string; baseAmortissable: string }>;
  /** Lignes de CE fichier (même empreinte) déjà reprises lors d'un import antérieur dans ce dossier. */
  dejaRepris?: ReadonlySet<number>;
}
export interface ResultatAnalyseReprise {
  lignes: LigneReprise[];
  comptes: { total: number; valides: number; invalides: number; doublons: number };
  /** Vide si la correspondance est utilisable. */
  problemes: string[];
}

/** Analyse complète, sans aucune écriture : statut de chaque ligne (valide, invalide, doublon). */
export function analyserReprise(fichier: FichierLu, correspondance: CorrespondanceColonnes, contexte: ContexteReprise): ResultatAnalyseReprise {
  const problemes = problemesCorrespondance(correspondance, fichier.entetes.length);
  const connues = new Map<string, string>();
  for (const e of contexte.existantes) connues.set(cleDoublon(e.libelle, e.dateMiseEnService, e.baseAmortissable), 'dossier');
  const dansFichier = new Map<string, number>();
  const lignes: LigneReprise[] = fichier.lignes.map((l) => {
    const r = controlerLigne(l.numero, l.cellules, fichier.entetes, correspondance);
    if (r.statut !== 'valide' || !r.cle) return r;
    if (contexte.dejaRepris?.has(l.numero)) {
      return { ...r, statut: 'doublon', cause: 'deja_repris', motifs: ['Ignorée : cette ligne de ce même fichier a déjà été reprise lors d’un import précédent (reprise idempotente).'], immobilisation: null };
    }
    if (connues.has(r.cle)) {
      return { ...r, statut: 'doublon', cause: 'doublon_dossier', motifs: ['Ignorée : une immobilisation identique existe déjà dans ce dossier (même désignation, même date de mise en service, même valeur brute). Elle n’est ni modifiée ni remplacée.'], immobilisation: null };
    }
    const avant = dansFichier.get(r.cle);
    if (avant !== undefined) {
      return { ...r, statut: 'doublon', cause: 'doublon_fichier', motifs: [`Ignorée : identique à la ligne ${avant} de ce fichier (même désignation, même date de mise en service, même valeur brute).`], immobilisation: null };
    }
    dansFichier.set(r.cle, l.numero);
    return r;
  });
  const comptes = { total: lignes.length, valides: 0, invalides: 0, doublons: 0 };
  for (const l of lignes) {
    if (l.statut === 'valide') comptes.valides++;
    else if (l.statut === 'invalide') comptes.invalides++;
    else comptes.doublons++;
  }
  return { lignes, comptes, problemes };
}
