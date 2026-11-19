/**
 * Pseudonymisation réversible LOCALEMENT, appliquée par la passerelle avant tout appel.
 * IBAN, adresses e-mail, téléphones, SIRET, SIREN, numéros de TVA intracommunautaire et noms de personnes
 * fournis en liste sont remplacés par des jetons stables `⟦TYPE_n⟧` ; la table de correspondance ne quitte
 * jamais le processus. Une même valeur reçoit toujours le même jeton pour un même pseudonymiseur.
 *
 * Limites (voir docs/passerelle.md) : repérage par motifs — un nom absent de la liste, une adresse postale,
 * un numéro mal formé ne sont pas masqués. La minimisation en amont reste nécessaire.
 */

export type TypePseudonyme = 'IBAN' | 'EMAIL' | 'TEL' | 'SIRET' | 'SIREN' | 'TVA' | 'PERSONNE';

export interface Pseudonymiseur {
  pseudonymiser(texte: string): string;
  /** Remplace les jetons connus par leur valeur d'origine. Un jeton inconnu (inventé par le modèle) est laissé tel quel. */
  restaurer(texte: string): string;
  /** Restaure toutes les chaînes d'une valeur JSON (clés d'objet comprises). */
  restaurerProfond<T>(valeur: T): T;
  /** Nombre de valeurs distinctes masquées, par type. Aucune valeur n'est exposée. */
  decompte(): Record<TypePseudonyme, number>;
}

const MOTIF_JETON = /⟦(IBAN|EMAIL|TEL|SIRET|SIREN|TVA|PERSONNE)_(\d+)⟧/g;

function luhn(chiffres: string): boolean {
  let somme = 0;
  for (let i = 0; i < chiffres.length; i++) {
    let n = chiffres.charCodeAt(chiffres.length - 1 - i) - 48;
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    somme += n;
  }
  return somme % 10 === 0;
}

const SEP = '[ \\u00a0\\u202f]';
const AVANT = '(?<![\\w⟦-])';
const APRES = '(?![\\w⟧-])';

/** Ordre d'application : du plus spécifique au plus général. */
const MOTIFS: Array<{ type: TypePseudonyme; motif: RegExp; valide?: (brut: string) => boolean; cle: (brut: string) => string }> = [
  // La TVA avant l'IBAN : « FR44732829320 » a aussi la forme d'un début d'IBAN.
  {
    type: 'TVA',
    motif: new RegExp(`${AVANT}FR${SEP}?[0-9A-Z]{2}${SEP}?\\d{3}${SEP}?\\d{3}${SEP}?\\d{3}${APRES}`, 'g'),
    cle: (b) => b.replace(/\s/g, '').toUpperCase(),
  },
  {
    type: 'IBAN',
    motif: new RegExp(`${AVANT}[A-Z]{2}\\d{2}(?:${SEP}?[A-Z0-9]{4}){3,7}(?:${SEP}?[A-Z0-9]{1,3})?${APRES}`, 'g'),
    cle: (b) => b.replace(/\s/g, '').toUpperCase(),
  },
  { type: 'EMAIL', motif: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, cle: (b) => b.toLowerCase() },
  {
    type: 'SIRET',
    motif: new RegExp(`${AVANT}\\d{3}${SEP}?\\d{3}${SEP}?\\d{3}${SEP}?\\d{5}${APRES}`, 'g'),
    valide: (b) => luhn(b.replace(/\D/g, '')),
    cle: (b) => b.replace(/\D/g, ''),
  },
  {
    type: 'SIREN',
    motif: new RegExp(`${AVANT}\\d{3}${SEP}?\\d{3}${SEP}?\\d{3}${APRES}`, 'g'),
    valide: (b) => luhn(b.replace(/\D/g, '')),
    cle: (b) => b.replace(/\D/g, ''),
  },
  {
    type: 'TEL',
    motif: /(?<![\w⟦])(?:(?:\+|00)33[ . ]?(?:\(0\)[ . ]?)?|0)[1-9](?:[ . -]?\d{2}){4}(?![\w⟧])/g,
    cle: (b) => b.replace(/\(0\)/, '').replace(/[^\d+]/g, '').replace(/^(?:\+33|0033)/, '0'),
  },
];

function echapper(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param nomsPersonnes Noms (et prénoms-noms) à masquer, fournis par l'appelant : dirigeants, salariés, contacts.
 *   Comparaison insensible à la casse, sur mots entiers. Les noms de moins de 3 caractères sont ignorés.
 */
export function creerPseudonymiseur(nomsPersonnes: readonly string[] = []): Pseudonymiseur {
  const versJeton = new Map<string, string>();
  const versValeur = new Map<string, string>();
  const compteurs: Record<TypePseudonyme, number> = { IBAN: 0, EMAIL: 0, TEL: 0, SIRET: 0, SIREN: 0, TVA: 0, PERSONNE: 0 };

  const jetonPour = (type: TypePseudonyme, cle: string, brut: string): string => {
    const k = `${type}\u0000${cle}`;
    const connu = versJeton.get(k);
    if (connu !== undefined) return connu;
    compteurs[type] += 1;
    const jeton = `⟦${type}_${compteurs[type]}⟧`;
    versJeton.set(k, jeton);
    versValeur.set(jeton, brut);
    return jeton;
  };

  // Les noms les plus longs d'abord : « Jean Dupont » avant « Dupont ».
  const noms = [...new Set(nomsPersonnes.map((n) => n.normalize('NFC').trim().replace(/\s+/g, ' ')).filter((n) => n.length >= 3))].sort(
    (a, b) => b.length - a.length || (a < b ? -1 : 1),
  );
  const motifNoms =
    noms.length === 0 ? null : new RegExp(`(?<![\\p{L}\\p{N}_⟦])(?:${noms.map((n) => echapper(n).replace(/ /g, '\\s+')).join('|')})(?![\\p{L}\\p{N}_⟧])`, 'giu');

  const pseudonymiser = (texte: string): string => {
    let t = texte.normalize('NFC');
    for (const { type, motif, valide, cle } of MOTIFS) {
      t = t.replace(motif, (brut) => (valide && !valide(brut) ? brut : jetonPour(type, cle(brut), brut)));
    }
    if (motifNoms) t = t.replace(motifNoms, (brut) => jetonPour('PERSONNE', brut.replace(/\s+/g, ' ').toLocaleLowerCase('fr'), brut));
    return t;
  };

  const restaurer = (texte: string): string => texte.replace(MOTIF_JETON, (jeton) => versValeur.get(jeton) ?? jeton);

  const restaurerProfond = <T>(valeur: T): T => {
    if (typeof valeur === 'string') return restaurer(valeur) as T;
    if (Array.isArray(valeur)) return valeur.map((v) => restaurerProfond(v)) as T;
    if (valeur !== null && typeof valeur === 'object') {
      return Object.fromEntries(Object.entries(valeur as Record<string, unknown>).map(([k, v]) => [restaurer(k), restaurerProfond(v)])) as T;
    }
    return valeur;
  };

  return { pseudonymiser, restaurer, restaurerProfond, decompte: () => ({ ...compteurs }) };
}

/** Vrai si le texte contient encore un jeton de pseudonymisation (jeton inventé ou non restauré). */
export function contientJeton(texte: string): boolean {
  MOTIF_JETON.lastIndex = 0;
  return MOTIF_JETON.test(texte);
}
