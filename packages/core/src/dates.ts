/** Dates civiles ISO (AAAA-MM-JJ), sans fuseau ni horloge : calculs purement arithmétiques. */

const JOURS_PAR_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function estBissextile(annee: number): boolean {
  return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
}

export function dateCivileValide(annee: number, mois: number, jour: number): boolean {
  if (!Number.isInteger(annee) || !Number.isInteger(mois) || !Number.isInteger(jour)) return false;
  if (annee < 1 || annee > 9999 || mois < 1 || mois > 12 || jour < 1) return false;
  const max = mois === 2 && estBissextile(annee) ? 29 : (JOURS_PAR_MOIS[mois - 1] ?? 0);
  return jour <= max;
}

function deuxChiffres(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function versIso(annee: number, mois: number, jour: number): string {
  return `${String(annee).padStart(4, '0')}-${deuxChiffres(mois)}-${deuxChiffres(jour)}`;
}

export function estDateIso(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m !== null && dateCivileValide(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** Nombre de jours depuis 1970-01-01 (algorithme civil, sans objet Date). */
export function joursDepuisEpoque(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Date ISO invalide : ${iso}`);
  let a = Number(m[1]);
  const mo = Number(m[2]);
  const j = Number(m[3]);
  a -= mo <= 2 ? 1 : 0;
  const ere = Math.floor(a / 400);
  const anneeDansEre = a - ere * 400;
  const jourDansAnnee = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + j - 1;
  const jourDansEre = anneeDansEre * 365 + Math.floor(anneeDansEre / 4) - Math.floor(anneeDansEre / 100) + jourDansAnnee;
  return ere * 146097 + jourDansEre - 719468;
}

export function isoDepuisJours(jours: number): string {
  const z = jours + 719468;
  const ere = Math.floor(z / 146097);
  const jourDansEre = z - ere * 146097;
  const anneeDansEre = Math.floor(
    (jourDansEre - Math.floor(jourDansEre / 1460) + Math.floor(jourDansEre / 36524) - Math.floor(jourDansEre / 146096)) / 365,
  );
  const jourDansAnnee = jourDansEre - (365 * anneeDansEre + Math.floor(anneeDansEre / 4) - Math.floor(anneeDansEre / 100));
  const mp = Math.floor((5 * jourDansAnnee + 2) / 153);
  const j = jourDansAnnee - Math.floor((153 * mp + 2) / 5) + 1;
  const mo = mp < 10 ? mp + 3 : mp - 9;
  const a = anneeDansEre + ere * 400 + (mo <= 2 ? 1 : 0);
  return versIso(a, mo, j);
}

export function ecartEnJours(debutIso: string, finIso: string): number {
  return joursDepuisEpoque(finIso) - joursDepuisEpoque(debutIso);
}

/** AAAAMMJJ → AAAA-MM-JJ, ou null si la date n'existe pas. */
export function isoDepuisCompact(s: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const a = Number(m[1]);
  const mo = Number(m[2]);
  const j = Number(m[3]);
  return dateCivileValide(a, mo, j) ? versIso(a, mo, j) : null;
}

export function compactDepuisIso(iso: string): string {
  return iso.replaceAll('-', '');
}
