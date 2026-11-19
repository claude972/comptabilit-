/**
 * Validation FORMELLE d'identifiants (clé de contrôle uniquement). Une clé juste
 * ne prouve ni l'existence ni l'activité de l'entité : seul le répertoire Sirene,
 * VIES ou la banque peuvent l'attester.
 *
 * Sources : les algorithmes (Luhn pour SIREN/SIRET, clé TVA = (12 + 3 × (SIREN mod 97)) mod 97,
 * mod 97-10 pour l'IBAN) sont des pratiques établies ; ils n'ont PAS été revérifiés
 * sur un texte officiel le 2026-11-19 (voir SOURCES_IDENTIFIANTS). L'exception La Poste
 * n'est confirmée que par des sources secondaires.
 */
import type { SourceRegle } from './controles/types.js';

export interface ResultatValidation {
  valide: boolean;
  motif?: string;
}

export const SOURCES_IDENTIFIANTS: Readonly<Record<'siren_siret' | 'tva_fr' | 'iban', SourceRegle>> = {
  siren_siret: {
    type: 'reglementaire',
    reference:
      'INSEE, répertoire Sirene : clé de contrôle de Luhn des numéros SIREN (9 chiffres) et SIRET (14 chiffres) ; exception des établissements de La Poste (SIREN 356000000).',
    url: null,
    dateVerification: null,
    verification: 'non_verifiee',
    periodeApplication: null,
  },
  tva_fr: {
    type: 'reglementaire',
    reference: 'Numéro de TVA intracommunautaire français : FR + clé (2 caractères) + SIREN ; clé numérique = (12 + 3 × (SIREN mod 97)) mod 97.',
    url: null,
    dateVerification: null,
    verification: 'non_verifiee',
    periodeApplication: null,
  },
  iban: {
    type: 'reglementaire',
    reference: 'ISO 13616 (IBAN) : contrôle mod 97-10 (ISO 7064).',
    url: null,
    dateVerification: null,
    verification: 'non_verifiee',
    periodeApplication: null,
  },
};

function compacter(s: string): string {
  return s.replace(/[\s  .]/g, '');
}

function luhnValide(chiffres: string): boolean {
  let total = 0;
  let doubler = false;
  for (let i = chiffres.length - 1; i >= 0; i--) {
    let n = chiffres.charCodeAt(i) - 48;
    if (doubler) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    total += n;
    doubler = !doubler;
  }
  return total % 10 === 0;
}

export function validerSiren(siren: string): ResultatValidation {
  if (typeof siren !== 'string') return { valide: false, motif: 'SIREN absent.' };
  const s = compacter(siren);
  if (!/^\d{9}$/.test(s)) return { valide: false, motif: 'Un SIREN comporte exactement 9 chiffres.' };
  if (s === '000000000') return { valide: false, motif: 'SIREN nul.' };
  if (!luhnValide(s)) return { valide: false, motif: 'Clé de contrôle (Luhn) du SIREN incorrecte.' };
  return { valide: true };
}

const SIREN_LA_POSTE = '356000000';

/**
 * SIRET : 14 chiffres, clé de Luhn sur l'ensemble. Exception gérée : les établissements
 * de La Poste (SIREN 356000000) dont le SIRET ne respecte pas Luhn sont admis si la
 * somme de leurs 14 chiffres est un multiple de 5 (règle rapportée par des sources
 * secondaires, non revérifiée auprès de l'INSEE).
 */
export function validerSiret(siret: string): ResultatValidation {
  if (typeof siret !== 'string') return { valide: false, motif: 'SIRET absent.' };
  const s = compacter(siret);
  if (!/^\d{14}$/.test(s)) return { valide: false, motif: 'Un SIRET comporte exactement 14 chiffres.' };
  if (/^0+$/.test(s)) return { valide: false, motif: 'SIRET nul.' };
  if (luhnValide(s)) return { valide: true };
  if (s.startsWith(SIREN_LA_POSTE)) {
    let total = 0;
    for (const c of s) total += c.charCodeAt(0) - 48;
    if (total % 5 === 0) {
      return { valide: true, motif: 'Établissement de La Poste : règle dérogatoire (somme des chiffres multiple de 5).' };
    }
  }
  return { valide: false, motif: 'Clé de contrôle (Luhn) du SIRET incorrecte.' };
}

/**
 * TVA intracommunautaire française : "FR" + clé + SIREN. Seule la clé NUMÉRIQUE est
 * vérifiable par calcul. Une clé comportant des lettres (format admis par
 * l'administration) n'est pas contrôlée : le résultat est alors `valide: false`
 * avec un motif explicite, jamais un succès par défaut.
 */
export function validerTvaIntracomFr(tva: string): ResultatValidation {
  if (typeof tva !== 'string') return { valide: false, motif: 'Numéro de TVA absent.' };
  const s = compacter(tva).toUpperCase();
  const m = /^FR([0-9A-Z]{2})(\d{9})$/.exec(s);
  if (!m) return { valide: false, motif: 'Format attendu : FR + 2 caractères de clé + 9 chiffres (SIREN).' };
  const cle = m[1] ?? '';
  const siren = m[2] ?? '';
  const vSiren = validerSiren(siren);
  if (!vSiren.valide) return { valide: false, motif: `SIREN inclus invalide : ${vSiren.motif ?? ''}` };
  if (!/^\d{2}$/.test(cle)) {
    return { valide: false, motif: 'Clé alphanumérique : contrôle par calcul non implémenté, numéro non vérifié.' };
  }
  const attendue = (12 + 3 * (Number(siren) % 97)) % 97;
  if (Number(cle) !== attendue) return { valide: false, motif: 'Clé du numéro de TVA incohérente avec le SIREN.' };
  return { valide: true };
}

/** Extrait le SIREN d'un numéro de TVA français bien formé, sinon null. */
export function sirenDeTvaFr(tva: string): string | null {
  const m = /^FR[0-9A-Z]{2}(\d{9})$/.exec(compacter(tva).toUpperCase());
  return m ? (m[1] ?? null) : null;
}

const LONGUEURS_IBAN: Readonly<Record<string, number>> = {
  FR: 27, MC: 27, BE: 16, DE: 22, ES: 24, IT: 27, LU: 20, NL: 18, PT: 25, CH: 21, GB: 22, IE: 22, AT: 20,
};

export function validerIban(iban: string): ResultatValidation {
  if (typeof iban !== 'string') return { valide: false, motif: 'IBAN absent.' };
  const s = iban.replace(/[\s  ]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) {
    return { valide: false, motif: 'Format IBAN invalide (code pays, clé à 2 chiffres, 15 à 34 caractères).' };
  }
  const pays = s.slice(0, 2);
  const longueur = LONGUEURS_IBAN[pays];
  if (longueur !== undefined && s.length !== longueur) {
    return { valide: false, motif: `Longueur incorrecte pour le pays ${pays} : ${longueur} caractères attendus.` };
  }
  const rearrange = s.slice(4) + s.slice(0, 4);
  let reste = 0;
  for (const c of rearrange) {
    const code = c.charCodeAt(0);
    const valeur = code >= 65 ? code - 55 : code - 48;
    reste = valeur > 9 ? (reste * 100 + valeur) % 97 : (reste * 10 + valeur) % 97;
  }
  if (reste !== 1) return { valide: false, motif: 'Clé de contrôle (mod 97) de l’IBAN incorrecte.' };
  if (longueur === undefined) {
    return { valide: true, motif: `Longueur non contrôlée pour le pays ${pays} (table interne limitée).` };
  }
  return { valide: true };
}
