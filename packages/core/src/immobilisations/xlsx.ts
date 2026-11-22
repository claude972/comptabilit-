/**
 * Lecture d'un classeur XLSX pour la reprise du fichier des immobilisations (D-124).
 *
 * Principes de sécurité (le classeur est un fichier non fiable) :
 *  - l'archive ZIP est lue À LA MAIN depuis son répertoire central, avec des bornes : 200 entrées au plus, 30 Mio décompressés par partie
 *    (`inflateRawSync` avec `maxOutputLength`, donc une bombe de décompression échoue avant d'occuper la mémoire), 60 Mio au total ; chiffrement,
 *    ZIP64, multi-volumes et méthodes autres que « stocké » et « deflate » refusés ; noms d'entrée jamais utilisés comme chemins de fichier ;
 *  - seules les parties nécessaires sont lues (workbook, relations, chaînes partagées, styles, feuille retenue) ; liaisons externes, macros,
 *    objets OLE, images et pièces jointes ne sont jamais ouverts ;
 *  - AUCUNE formule n'est évaluée : la valeur mise en cache par le tableur est lue telle quelle ; une formule sans valeur en cache donne une
 *    cellule vide ; les valeurs commençant par = + - @ sont neutralisées à l'affichage par le reste de la chaîne (D-092) ;
 *  - le XML est lu par `fast-xml-parser` sans traitement d'entités externes ; une déclaration DOCTYPE ou ENTITY est refusée.
 *
 * Restitution : tout est rendu en TEXTE, comme un CSV : les nombres en notation décimale française (« 18500,5 », 15 chiffres significatifs, la
 * précision d'affichage du tableur) ; les dates (cellules au format date) en « JJ/MM/AAAA » ; les booléens en « oui » / « non » ; les erreurs
 * du tableur (#N/A…) en texte. Rien n'est deviné : une cellule date au format personnalisé non reconnu reste un nombre.
 */
import { inflateRawSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import { Decimal } from 'decimal.js';
import { ErreurReprise, LIGNES_MAX_REPRISE } from './reprise.js';

const ENTREES_MAX = 200;
const PARTIE_MAX = 30 * 1024 * 1024;
const TOTAL_MAX = 60 * 1024 * 1024;
const COLONNES_MAX = 200;

export const estZip = (o: Uint8Array): boolean => o.length > 3 && o[0] === 0x50 && o[1] === 0x4b && (o[2] === 0x03 || o[2] === 0x05);

interface EntreeZip {
  nom: string;
  methode: number;
  tailleCompressee: number;
  tailleReelle: number;
  decalage: number;
}

function lireRepertoire(b: Buffer): Map<string, EntreeZip> {
  const refuser = (m: string): never => {
    throw new ErreurReprise('format', m);
  };
  // Fin du répertoire central : signature 0x06054b50, dans les 65 557 derniers octets.
  let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) return refuser('Ce fichier n’est pas un classeur XLSX valide (archive ZIP illisible) : seuls les formats CSV et XLSX sont pris en charge.');
  const disque = b.readUInt16LE(fin + 4);
  const nb = b.readUInt16LE(fin + 10);
  const tailleRep = b.readUInt32LE(fin + 12);
  const debutRep = b.readUInt32LE(fin + 16);
  if (disque !== 0 || b.readUInt16LE(fin + 6) !== 0) refuser('Archive multi-volumes refusée.');
  if (nb === 0xffff || tailleRep === 0xffffffff || debutRep === 0xffffffff) refuser('Archive ZIP64 refusée : classeur trop volumineux pour la reprise.');
  if (nb > ENTREES_MAX) refuser(`Classeur refusé : ${nb} parties dans l’archive (maximum ${ENTREES_MAX}).`);
  if (debutRep + tailleRep > fin) refuser('Archive ZIP mal formée (répertoire central hors limites).');
  const entrees = new Map<string, EntreeZip>();
  let p = debutRep;
  let total = 0;
  for (let i = 0; i < nb; i++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) return refuser('Archive ZIP mal formée (entrée du répertoire central illisible).');
    const drapeaux = b.readUInt16LE(p + 8);
    const methode = b.readUInt16LE(p + 10);
    const tailleCompressee = b.readUInt32LE(p + 20);
    const tailleReelle = b.readUInt32LE(p + 24);
    const lNom = b.readUInt16LE(p + 28);
    const lExtra = b.readUInt16LE(p + 30);
    const lCommentaire = b.readUInt16LE(p + 32);
    const decalage = b.readUInt32LE(p + 42);
    const nom = b.subarray(p + 46, p + 46 + lNom).toString('utf8');
    if ((drapeaux & 1) !== 0) refuser('Classeur chiffré ou protégé par mot de passe : refusé.');
    if (methode !== 0 && methode !== 8) refuser('Archive refusée : méthode de compression non prise en charge.');
    if (tailleReelle === 0xffffffff || tailleCompressee === 0xffffffff) refuser('Archive ZIP64 refusée.');
    total += tailleReelle;
    if (tailleReelle > PARTIE_MAX || total > TOTAL_MAX) refuser('Classeur refusé : contenu décompressé trop volumineux.');
    entrees.set(nom, { nom, methode, tailleCompressee, tailleReelle, decalage });
    p += 46 + lNom + lExtra + lCommentaire;
  }
  return entrees;
}

function extraire(b: Buffer, e: EntreeZip): Buffer {
  if (e.decalage + 30 > b.length || b.readUInt32LE(e.decalage) !== 0x04034b50) throw new ErreurReprise('format', 'Archive ZIP mal formée (entrée locale illisible).');
  const debut = e.decalage + 30 + b.readUInt16LE(e.decalage + 26) + b.readUInt16LE(e.decalage + 28);
  if (debut + e.tailleCompressee > b.length) throw new ErreurReprise('format', 'Archive ZIP mal formée (données hors limites).');
  const brut = b.subarray(debut, debut + e.tailleCompressee);
  if (e.methode === 0) return Buffer.from(brut);
  try {
    const sortie = inflateRawSync(brut, { maxOutputLength: Math.min(PARTIE_MAX, e.tailleReelle + 1) });
    if (sortie.length !== e.tailleReelle) throw new Error('taille');
    return sortie;
  } catch {
    throw new ErreurReprise('format', 'Classeur refusé : une partie de l’archive est corrompue ou se décompresse en un volume anormal.');
  }
}

const analyseur = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  ignoreDeclaration: true,
  removeNSPrefix: true,
  isArray: (nom) => ['sheet', 'Relationship', 'si', 'r', 'row', 'c', 'xf', 'numFmt'].includes(nom),
});

function xml(b: Buffer): any {
  const texte = b.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(texte)) throw new ErreurReprise('format', 'Classeur refusé : déclaration DOCTYPE ou ENTITY interdite dans le XML.');
  return analyseur.parse(texte);
}
const tableau = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
/** Texte d'un élément `<t>` ou `<r><t>` (chaînes riches) ; `#text` si l'élément a des attributs (xml:space). */
const texteNoeud = (t: unknown): string => (typeof t === 'string' ? t : t !== null && typeof t === 'object' && '#text' in (t as object) ? String((t as { '#text': unknown })['#text']) : '');
function texteSi(si: any): string {
  if (si === undefined || si === null) return '';
  if (typeof si === 'string') return si;
  let s = texteNoeud(si.t);
  for (const r of tableau<any>(si.r)) s += texteNoeud(r.t);
  return s;
}

/** Indice de colonne (0 pour A) d'une référence « C12 ». */
function colonneDe(ref: string): number {
  let n = 0;
  for (const c of ref) {
    const k = c.charCodeAt(0) - 64;
    if (k < 1 || k > 26) break;
    n = n * 26 + k;
  }
  return n - 1;
}

const FORMATS_DATE_INTEGRES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
function formatPersonnaliseEstDate(code: string): boolean {
  const sansLitteraux = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(sansLitteraux) && !/[#0?]/.test(sansLitteraux.replace(/[dmyhs/:.\-\s,AaPp]/gi, ''));
}

function serieVersDate(n: number, base1904: boolean): string | null {
  if (!Number.isFinite(n) || n < 1 || n > 2_958_465) return null;
  const jours = Math.floor(n);
  // Base 1900 : le tableur compte à tort le 29/02/1900 ; les séries >= 61 sont décalées de deux jours depuis le 1900-01-00.
  const ms = base1904 ? Date.UTC(1904, 0, 1) + jours * 86_400_000 : Date.UTC(1899, 11, 30) + jours * 86_400_000;
  if (!base1904 && jours < 61) return null; // dates antérieures au 01/03/1900 : sans objet ici, jamais devinées
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear()).padStart(4, '0')}`;
}

function nombreVersTexte(brut: string): string {
  try {
    const d = new Decimal(brut.trim());
    if (!d.isFinite()) return brut;
    return d.toSignificantDigits(15).toFixed().replace('.', ',');
  } catch {
    return brut;
  }
}

export interface ClasseurLu {
  /** Feuille lue (nom). */
  feuille: string;
  /** Lignes du classeur, indexées depuis le haut de la feuille : `numero` est le numéro de ligne de la feuille. */
  lignes: Array<{ numero: number; cellules: string[] }>;
  avertissements: string[];
}

/** Lit la première feuille visible non vide d'un classeur XLSX. Lève ErreurReprise pour tout classeur refusé. */
export function lireClasseurXlsx(octets: Uint8Array): ClasseurLu {
  const b = Buffer.from(octets.buffer, octets.byteOffset, octets.byteLength);
  const entrees = lireRepertoire(b);
  const partie = (nom: string): Buffer | null => {
    const e = entrees.get(nom);
    return e ? extraire(b, e) : null;
  };
  const wbBuf = partie('xl/workbook.xml');
  if (!wbBuf) throw new ErreurReprise('format', 'Ce fichier est une archive, mais pas un classeur Excel (XLSX) : seuls CSV et XLSX sont pris en charge.');
  const wb = xml(wbBuf).workbook ?? {};
  const base1904 = wb.workbookPr?.['@date1904'] === '1' || wb.workbookPr?.['@date1904'] === 'true';
  const rels = new Map<string, string>();
  const relBuf = partie('xl/_rels/workbook.xml.rels');
  if (relBuf) for (const r of tableau<any>(xml(relBuf).Relationships?.Relationship)) rels.set(r['@Id'], String(r['@Target']));
  const feuilles = tableau<any>(wb.sheets?.sheet).map((s) => ({ nom: String(s['@name'] ?? ''), etat: String(s['@state'] ?? 'visible'), rid: String(s['@id'] ?? '') }));
  if (feuilles.length === 0) throw new ErreurReprise('vide', 'Le classeur ne contient aucune feuille.');

  const chaines: string[] = [];
  const ssBuf = partie('xl/sharedStrings.xml');
  if (ssBuf) for (const si of tableau<any>(xml(ssBuf).sst?.si)) chaines.push(texteSi(si));

  // Styles : indices de style (cellXfs) dont le format est une date.
  const stylesDate = new Set<number>();
  const stBuf = partie('xl/styles.xml');
  if (stBuf) {
    const st = xml(stBuf).styleSheet ?? {};
    const perso = new Map<number, string>();
    for (const f of tableau<any>(st.numFmts?.numFmt)) perso.set(Number(f['@numFmtId']), String(f['@formatCode'] ?? ''));
    tableau<any>(st.cellXfs?.xf).forEach((xf, i) => {
      const id = Number(xf['@numFmtId'] ?? 0);
      if (FORMATS_DATE_INTEGRES.has(id) || (perso.has(id) && formatPersonnaliseEstDate(perso.get(id)!))) stylesDate.add(i);
    });
  }

  const avertissements: string[] = [];
  const ignorees: string[] = [];
  for (const f of feuilles) {
    if (f.etat !== 'visible') {
      ignorees.push(`${f.nom} (masquée)`);
      continue;
    }
    let cible = rels.get(f.rid);
    if (cible === undefined) continue;
    cible = cible.startsWith('/') ? cible.slice(1) : `xl/${cible}`;
    if (!/^xl\/worksheets\/[A-Za-z0-9_\-]+\.xml$/.test(cible)) continue; // jamais d'autres parties (liaisons externes, chartsheets…)
    const buf = partie(cible);
    if (!buf) continue;
    const lignes: ClasseurLu['lignes'] = [];
    for (const row of tableau<any>(xml(buf).worksheet?.sheetData?.row)) {
      const numero = Number(row['@r'] ?? lignes.length + 1);
      const cellules: string[] = [];
      for (const c of tableau<any>(row.c)) {
        const col = colonneDe(String(c['@r'] ?? ''));
        if (col < 0 || col >= COLONNES_MAX) continue;
        const type = String(c['@t'] ?? 'n');
        const v = c.v === undefined ? '' : texteNoeud(c.v);
        let t = '';
        if (type === 's') t = chaines[Number(v)] ?? '';
        else if (type === 'inlineStr') t = texteSi(c.is);
        else if (type === 'str' || type === 'e') t = v;
        else if (type === 'b') t = v === '1' ? 'oui' : v === '0' ? 'non' : '';
        else if (type === 'd') {
          const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
          t = m ? `${m[3]}/${m[2]}/${m[1]}` : v;
        } else if (v.trim() !== '') t = stylesDate.has(Number(c['@s'] ?? 0)) ? (serieVersDate(Number(v), base1904) ?? nombreVersTexte(v)) : nombreVersTexte(v);
        while (cellules.length < col) cellules.push('');
        cellules[col] = t;
      }
      if (cellules.some((x) => x.trim() !== '')) lignes.push({ numero, cellules });
      if (lignes.length > LIGNES_MAX_REPRISE + 1) throw new ErreurReprise('trop_de_lignes', `Trop de lignes : plus de ${LIGNES_MAX_REPRISE} lignes de données dans la feuille « ${f.nom} ». Découpez le classeur.`);
    }
    if (lignes.length === 0) {
      ignorees.push(`${f.nom} (vide)`);
      continue;
    }
    const autres = feuilles.filter((x) => x !== f).length;
    if (autres > 0) avertissements.push(`Feuille « ${f.nom} » lue ; ${autres} autre(s) feuille(s) du classeur ne sont pas lues${ignorees.length > 0 ? ` (déjà écartées : ${ignorees.join(', ')})` : ''}.`);
    avertissements.push('Classeur XLSX : les formules ne sont pas évaluées, seules les valeurs enregistrées par le tableur sont lues ; les dates sont lues au format JJ/MM/AAAA.');
    return { feuille: f.nom, lignes, avertissements };
  }
  throw new ErreurReprise('vide', `Le classeur ne contient aucune feuille visible avec des données${ignorees.length > 0 ? ` (${ignorees.join(', ')})` : ''}.`);
}
