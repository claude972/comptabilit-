/** Types et utilitaires de la reprise du fichier des immobilisations par import CSV (D-092). */

/** Limites annoncées à l'écran (les mêmes que celles de l'API, qui reste seule juge). */
export const TAILLE_MAX_FICHIER = 5 * 1024 * 1024;
export const LIGNES_MAX = 5000;

export interface ChampReprise {
  code: string;
  libelle: string;
  obligatoire: boolean;
  aide: string;
}
export type Correspondance = Record<string, number | null>;
export type StatutApercu = 'valide' | 'invalide' | 'doublon';
export type StatutRapport = 'creee' | 'ignoree_doublon' | 'rejetee';

export interface LigneApercu {
  ligne: number;
  statut: StatutApercu;
  cause: string | null;
  motifs: string[];
  lues: Record<string, string>;
}
export interface ApercuReprise {
  fichier: { nom: string; taille: number; sha256: string; encodage: string; encodageImpose: boolean; separateur: ';' | ',' | '\t'; separateurImpose: boolean; nbLignes: number; lignesVidesIgnorees: number; avertissements: string[] };
  limites: { tailleMaxOctets: number; lignesMax: number };
  champs: ChampReprise[];
  entetes: string[];
  correspondance: Correspondance;
  correspondanceProposee: Correspondance;
  remarques: string[];
  problemes: string[];
  comptes: { total: number; valides: number; invalides: number; doublons: number };
  lignes: LigneApercu[];
  empreinteApercu: string;
  peutValider: boolean;
}
export interface RepriseVue {
  id: string;
  entiteId: string;
  nomFichier: string;
  sha256: string;
  taille: number;
  encodage: string;
  separateur: string;
  correspondance: Correspondance;
  versionAnalyseur: string;
  nbLignes: number;
  nbCreees: number;
  nbIgnorees: number;
  nbRejetees: number;
  importePar: string;
  importeurNom: string | null;
  creeLe: string;
  dejaImporte?: boolean;
}
export interface LigneRapport {
  ligne: number;
  statut: StatutRapport;
  cause: string | null;
  motif: string | null;
  lues: Record<string, string>;
  immobilisationId: string | null;
}
export interface RapportReprise {
  reprise: RepriseVue;
  champs: ChampReprise[];
  lignes: LigneRapport[];
  total: number;
  page: number;
  parPage: number;
}

export const LIBELLE_STATUT_APERCU: Record<StatutApercu, string> = { valide: 'Valide', invalide: 'Invalide', doublon: 'Doublon ignoré' };
export const LIBELLE_STATUT_RAPPORT: Record<StatutRapport, string> = { creee: 'Créée', ignoree_doublon: 'Ignorée (doublon)', rejetee: 'Rejetée' };
export const LIBELLE_SEPARATEUR: Record<string, string> = { ';': 'point-virgule (;)', ',': 'virgule (,)', '\t': 'tabulation' };
export const LIBELLE_ENCODAGE: Record<string, string> = {
  'utf-8': 'UTF-8',
  'utf-8-bom': 'UTF-8',
  ascii: 'ASCII (sans accent)',
  'iso-8859-15': 'ISO-8859-15',
  'windows-1252': 'Windows-1252',
  'utf-16le': 'UTF-16',
  'utf-16be': 'UTF-16',
};

/**
 * Neutralise l'interprétation d'une valeur par un tableur : une valeur commençant par = + - @ (ou tabulation, retour chariot, formes
 * pleine chasse) est précédée d'une apostrophe. Même règle que le moteur et que l'export CSV du rapport. À appliquer à toute valeur
 * LUE dans le fichier avant de l'afficher.
 */
export function neutraliserCellule(valeur: string): string {
  return /^\s*[=+\-@＝＋－＠\t\r]/.test(valeur) ? `'${valeur}` : valeur;
}

/** Contenu d'un fichier en Base64 (par tranches : pas de dépassement de pile sur 5 Mio). */
export async function versBase64(fichier: Blob): Promise<string> {
  const octets = new Uint8Array(await fichier.arrayBuffer());
  let binaire = '';
  for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(binaire);
}

/** Texte lisible d'une taille en octets. */
export function formaterTaille(octets: number): string {
  if (octets < 1024) return `${octets} octets`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1).replace('.', ',')} Kio`;
  return `${(octets / 1024 / 1024).toFixed(1).replace('.', ',')} Mio`;
}

/** Valeurs lues dans l'ordre des champs, sans les cellules vides, déjà neutralisées pour l'affichage. */
export function valeursLuesAffichables(champs: readonly ChampReprise[], lues: Record<string, string>): Array<{ code: string; libelle: string; valeur: string }> {
  return champs.filter((c) => lues[c.code] !== undefined && lues[c.code] !== '').map((c) => ({ code: c.code, libelle: c.libelle, valeur: neutraliserCellule(lues[c.code]!) }));
}
