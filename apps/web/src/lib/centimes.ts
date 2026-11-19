/**
 * Arithmétique de saisie en CENTIMES ENTIERS (BigInt), à partir de chaînes décimales : aucun nombre flottant.
 * Sert uniquement à afficher des totaux au fil de la saisie ; l'API refait tous les calculs et reste seule juge.
 */
const MOTIF = /^(-?)(\d{1,13})(?:\.(\d{1,2}))?$/;

/** « 1200.5 » → 120050n. null si la valeur n'est pas une chaîne décimale à deux décimales au plus. */
export function versCentimes(valeur: string): bigint | null {
  const m = MOTIF.exec(valeur);
  if (!m) return null;
  const n = BigInt(m[2]!) * 100n + BigInt((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -n : n;
}

/** 120050n → « 1200.50 » (toujours deux décimales). */
export function depuisCentimes(n: bigint): string {
  const abs = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/**
 * Saisie humaine (« 1 200,5 », « 1200.50 ») → chaîne décimale à deux décimales (« 1200.50 »).
 * null si ce n'est pas un montant positif ou nul à deux décimales au plus. Une saisie vide n'est pas un montant.
 */
export function normaliserMontantSaisi(saisie: string): string | null {
  const brut = saisie.replace(/[\s  ]/g, '').replace(',', '.');
  const c = /^\d{1,13}(\.\d{1,2})?$/.test(brut) ? versCentimes(brut) : null;
  return c === null ? null : depuisCentimes(c);
}

/**
 * Total de saisies de montants. Une case vide compte pour zéro ; une saisie invalide est signalée (`invalides`)
 * et n'entre pas dans le total, qui n'est alors qu'indicatif.
 */
export function totaliserSaisies(saisies: readonly string[]): { total: string; invalides: number } {
  let somme = 0n;
  let invalides = 0;
  for (const s of saisies) {
    if (!s.trim()) continue;
    const n = normaliserMontantSaisi(s);
    if (n === null) invalides++;
    else somme += versCentimes(n)!;
  }
  return { total: depuisCentimes(somme), invalides };
}

/** Différence a − b de deux chaînes décimales (deux décimales au plus) ; null si l'une n'en est pas une. */
export function difference(a: string, b: string): string | null {
  const x = versCentimes(a);
  const y = versCentimes(b);
  return x === null || y === null ? null : depuisCentimes(x - y);
}
