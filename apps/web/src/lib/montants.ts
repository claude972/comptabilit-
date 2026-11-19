/**
 * Affichage des montants. Les montants circulent sous forme de chaînes décimales (« 1234.56 ») :
 * ils sont mis en forme par manipulation de chaîne, sans jamais passer par un nombre flottant,
 * et aucun calcul n'est fait côté interface.
 */
const MOTIF = /^(-?)(\d+)(?:\.(\d+))?$/;
/** Espace fine insécable, séparateur de milliers de la typographie française. */
const ESPACE_FINE = ' ';

export function estChaineDecimale(v: unknown): v is string {
  return typeof v === 'string' && MOTIF.test(v);
}

/**
 * « 1234567.5 » → « 1 234 567,50 ». Les décimales fournies sont conservées telles quelles (complétées à deux chiffres,
 * jamais arrondies). Une valeur qui n'est pas une chaîne décimale est renvoyée inchangée (contenu affiché tel quel).
 */
export function formaterMontant(valeur: string | null | undefined, devise?: string | null): string {
  if (valeur === null || valeur === undefined || valeur === '') return '—';
  const m = MOTIF.exec(valeur);
  if (!m) return valeur;
  const [, signe = '', entierBrut = '0', decimalesBrutes = ''] = m;
  const entier = entierBrut.replace(/^0+(?=\d)/, '');
  let groupes = '';
  for (let i = 0; i < entier.length; i++) {
    if (i > 0 && (entier.length - i) % 3 === 0) groupes += ESPACE_FINE;
    groupes += entier[i];
  }
  const decimales = decimalesBrutes.padEnd(2, '0');
  const nul = /^0+$/.test(entier) && /^0+$/.test(decimales);
  const texte = `${signe && !nul ? '−' : ''}${groupes},${decimales}`;
  return devise ? `${texte} ${devise}` : texte;
}

/** « 2025-12-31 » → « 31/12/2025 » (manipulation de chaîne, sans fuseau horaire). */
export function formaterDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const HORODATAGE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });

/** Horodatage serveur → date et heure de Paris. */
export function formaterHorodatage(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v.includes('T') ? v : v.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? v : HORODATAGE.format(d);
}

/** Taille de fichier lisible (entiers : aucune donnée comptable ici). */
export function formaterTaille(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(0)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}
