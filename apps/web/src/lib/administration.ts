/** Administration du cabinet : formes de `apps/api/src/administration.controller.ts` et `audit.controller.ts`, logique pure. */
import type { Niveau, Role } from './types-api';
import { ORDRE_NIVEAUX } from './types-api';

export interface Cabinet {
  id: string;
  nom: string;
  role: Role;
}
export interface MembreCabinet {
  utilisateurId: string;
  nom: string;
  email: string;
  role: Role;
  actif: boolean;
  expireLe: string | null;
}
export interface MembreDossier {
  utilisateurId: string;
  nom: string;
  email: string;
  niveau: Niveau;
  role: Role;
}
export interface FicheDossier {
  id: string;
  raisonSociale: string;
  siren: string | null;
  formeJuridique: string | null;
  regimeFiscal: string | null;
  territoireFiscal: string;
  codeNaf: string | null;
  actif: boolean;
  niveau: Niveau | null;
}
export interface LigneAudit {
  id: number;
  acteurId: string | null;
  acteurType: string;
  action: string;
  cibleType: string | null;
  cibleId: string | null;
  entiteId: string | null;
  details: unknown;
  horodatage: string;
}
export interface JournalAudit {
  integrite: { rupture: number | string | null };
  lignes: LigneAudit[];
}

/** Niveau maximal qu'un rôle peut recevoir sur un dossier (même table que `PLAFOND` dans l'API, qui reste seule juge). */
const PLAFOND: Record<Role, readonly Niveau[]> = {
  client_deposant: ['depot'],
  client_lecture: ['depot', 'lecture'],
  collaborateur: ['depot', 'lecture', 'collaboration'],
  support: ['lecture'],
  reviseur: ['depot', 'lecture', 'collaboration', 'revision'],
  associe: ['depot', 'lecture', 'collaboration', 'revision', 'validation'],
  administrateur: ['depot', 'lecture', 'collaboration', 'revision', 'validation'],
};
export function niveauxPermis(role: string): Niveau[] {
  const permis = PLAFOND[role as Role] ?? [];
  return ORDRE_NIVEAUX.filter((n) => permis.includes(n));
}

export const TERRITOIRES: ReadonlyArray<{ valeur: string; libelle: string }> = [
  { valeur: 'metropole', libelle: 'France métropolitaine' },
  { valeur: 'guadeloupe', libelle: 'Guadeloupe' },
  { valeur: 'martinique', libelle: 'Martinique' },
  { valeur: 'guyane', libelle: 'Guyane' },
  { valeur: 'reunion', libelle: 'La Réunion' },
  { valeur: 'mayotte', libelle: 'Mayotte' },
  { valeur: 'autre', libelle: 'Autre territoire' },
  { valeur: 'a_confirmer', libelle: 'À confirmer' },
];
export const libelleTerritoire = (v: string) => TERRITOIRES.find((t) => t.valeur === v)?.libelle ?? v;
/** Hors métropole ou territoire à confirmer : les contrôles fiscaux métropolitains ne sont pas réalisés. */
export const controlesFiscauxRealises = (territoire: string) => territoire === 'metropole';

/** Clé de Luhn d'un SIREN (9 chiffres) : évite un aller-retour, l'API refait la vérification. */
export function sirenPlausible(siren: string): boolean {
  if (!/^\d{9}$/.test(siren)) return false;
  let somme = 0;
  for (let i = 0; i < 9; i++) {
    let c = siren.charCodeAt(8 - i) - 48;
    if (i % 2 === 1) {
      c *= 2;
      if (c > 9) c -= 9;
    }
    somme += c;
  }
  return somme % 10 === 0;
}

/** Détails d'une ligne d'audit réduits à leurs clés simples (chaînes courtes, nombres, booléens) : jamais d'objet brut. */
export function detailsSimples(details: unknown, max = 6): Array<{ cle: string; valeur: string }> {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
  const sortie: Array<{ cle: string; valeur: string }> = [];
  for (const [cle, v] of Object.entries(details as Record<string, unknown>)) {
    if (sortie.length >= max) break;
    if (typeof v === 'string' && v.length <= 60) sortie.push({ cle, valeur: v });
    else if (typeof v === 'number' || typeof v === 'boolean') sortie.push({ cle, valeur: String(v) });
  }
  return sortie;
}
