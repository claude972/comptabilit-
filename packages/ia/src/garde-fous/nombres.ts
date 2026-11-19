/**
 * Garde-fou « les chiffres viennent des données » : tout nombre figurant dans un texte produit par le modèle
 * doit se retrouver dans les faits fournis. Comparaison sur une forme canonique, sans aucun flottant.
 *
 * Volontairement STRICT : un arrondi (« environ 12 000 » pour 12 345,67) ou un nombre recalculé est refusé.
 * Limite connue : un nombre écrit en toutes lettres (« douze mille ») n'est pas détecté.
 */

const ESP = '[ \\u00a0\\u202f]';
const MOTIF_NOMBRE = new RegExp(
  [
    // Dates : chaque composante est un entier (31/12/2025, 31.12.2025, 2025-12-31).
    '(?<![\\d.,/-])\\d{1,4}[./-]\\d{1,2}[./-]\\d{1,4}(?![\\d/-])',
    // Milliers séparés par des points, décimales après virgule : 1.234.567,89
    '(?<![\\d.,])\\d{1,3}(?:\\.\\d{3})+,\\d+(?!\\d)',
    // Milliers séparés par des espaces : 1 234 567,89
    `(?<![\\d.,])\\d{1,3}(?:${ESP}\\d{3})+(?:[.,]\\d+)?(?!\\d)`,
    // Forme simple : 1234,56 / 1234.56 / 1234
    '\\d+(?:[.,]\\d+)?',
  ].join('|'),
  'g',
);
const MOTIF_DATE = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/;
/** Ordinaux (« 1er », « 2e », « 3ème ») : ce ne sont pas des quantités. */
const SUITE_ORDINALE = /^(?:ers?|ères?|res?|èmes?|emes?|es?|nde?s?)(?![\p{L}\p{N}])/u;
/** Exercices relatifs (« N-1 », « N+1 »). */
const AVANT_EXERCICE_RELATIF = /(?<![\p{L}\p{N}])N\s?[-+−]\s?$/u;

function canoniser(brut: string): string {
  let s = brut.replace(/[   ]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  let [entier = '0', fraction = ''] = s.split('.');
  entier = entier.replace(/^0+(?=\d)/, '');
  fraction = fraction.replace(/0+$/, '');
  return fraction === '' ? entier : `${entier}.${fraction}`;
}

/** Nombres présents dans un texte, sous forme canonique (valeur absolue, sans zéros superflus). */
export function extraireNombres(texte: string): string[] {
  const trouves: string[] = [];
  // Les jetons de pseudonymisation (⟦IBAN_1⟧) ne sont pas des nombres.
  const t = texte.replace(/⟦[A-Z]+_\d+⟧/g, ' ');
  for (const m of t.matchAll(MOTIF_NOMBRE)) {
    const brut = m[0];
    const debut = m.index;
    if (MOTIF_DATE.test(brut)) {
      for (const partie of brut.split(/[./-]/)) trouves.push(canoniser(partie));
      continue;
    }
    if (SUITE_ORDINALE.test(t.slice(debut + brut.length, debut + brut.length + 8))) continue;
    if (/^\d$/.test(brut) && AVANT_EXERCICE_RELATIF.test(t.slice(Math.max(0, debut - 4), debut))) continue;
    trouves.push(canoniser(brut));
  }
  return trouves;
}

/** Ensemble des nombres autorisés, tirés des faits fournis (valeurs, périodes, formules, libellés). */
export function nombresAutorises(...faits: Array<string | null | undefined>): Set<string> {
  const ensemble = new Set<string>();
  for (const f of faits) if (typeof f === 'string') for (const n of extraireNombres(f)) ensemble.add(n);
  return ensemble;
}

export interface VerdictNombres {
  conforme: boolean;
  /** Nombres du texte absents des faits (forme canonique). */
  inconnus: string[];
}

export function verifierNombres(texte: string, autorises: ReadonlySet<string>): VerdictNombres {
  const inconnus = [...new Set(extraireNombres(texte).filter((n) => !autorises.has(n)))];
  return { conforme: inconnus.length === 0, inconnus };
}
