import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { dec, schemaChaineDecimale, versChaine } from '../montant.js';
import type { Constat, ContexteControle, DefinitionControle, LigneEcriture, ResultatControle, StatutControle } from './types.js';

const cacheMouvements = new WeakMap<LigneEcriture, { debit: Decimal; credit: Decimal }>();

function montants(l: LigneEcriture): { debit: Decimal; credit: Decimal } {
  let m = cacheMouvements.get(l);
  if (m === undefined) {
    m = { debit: dec(l.debit), credit: dec(l.credit) };
    cacheMouvements.set(l, m);
  }
  return m;
}

export const debitDe = (l: LigneEcriture): Decimal => montants(l).debit;
export const creditDe = (l: LigneEcriture): Decimal => montants(l).credit;
/** Débit − crédit : positif = mouvement débiteur. */
export const mouvementDe = (l: LigneEcriture): Decimal => {
  const m = montants(l);
  return m.debit.minus(m.credit);
};

export const cleEcriture = (l: LigneEcriture): string => `${l.journalCode}\u0001${l.ecritureNum}`;
export const cleTiers = (l: LigneEcriture): string => l.compAuxNum ?? l.compteNum;

export const ZERO = new Decimal(0);
export const montant2 = (d: Decimal): string => versChaine(d, 2);

export const schemaMontantPositif = schemaChaineDecimale.refine((v) => !v.startsWith('-'), 'Montant positif ou nul attendu.');
export const schemaPrefixes = z.array(z.string().regex(/^\d{1,12}$/, 'Préfixe de compte numérique attendu.')).min(1);
export const schemaMaxConstats = z.number().int().min(1).max(10_000);

export function aPrefixe(compte: string, prefixes: readonly string[], exclus: readonly string[] = []): boolean {
  return prefixes.some((p) => compte.startsWith(p)) && !exclus.some((p) => compte.startsWith(p));
}

/** Lignes à retenir pour un solde de clôture : jusqu'à la fin d'exercice si elle est connue, sinon toutes. */
export function lignesJusquaCloture(ctx: ContexteControle): readonly LigneEcriture[] {
  const fin = ctx.exercice?.fin;
  if (fin === undefined) return ctx.lignes;
  return ctx.lignes.filter((l) => l.ecritureDate <= fin);
}

export function mentionCloture(ctx: ContexteControle): string {
  return ctx.exercice ? `au ${ctx.exercice.fin}` : 'à la dernière écriture fournie (exercice non précisé)';
}

export function grouper<T>(elements: Iterable<T>, cle: (e: T) => string): Map<string, T[]> {
  const groupes = new Map<string, T[]>();
  for (const e of elements) {
    const k = cle(e);
    const g = groupes.get(k);
    if (g === undefined) groupes.set(k, [e]);
    else g.push(e);
  }
  return groupes;
}

export function soldeDe(lignes: Iterable<LigneEcriture>): Decimal {
  let s = ZERO;
  for (const l of lignes) s = s.plus(mouvementDe(l));
  return s;
}

/** Soldes cumulés en fin de journée, par ordre chronologique (l'ordre intra-journalier est inconnu dans un FEC). */
export function soldesFinDeJour(lignes: readonly LigneEcriture[]): Array<{ date: string; solde: Decimal; lignes: LigneEcriture[] }> {
  const parJour = grouper(lignes, (l) => l.ecritureDate);
  const jours = [...parJour.keys()].sort();
  let solde = ZERO;
  return jours.map((date) => {
    const duJour = parJour.get(date) ?? [];
    solde = solde.plus(soldeDe(duJour));
    return { date, solde, lignes: duJour };
  });
}

export interface Calcul {
  statut: StatutControle;
  motif?: string | null;
  constats?: Constat[];
  mesures?: Record<string, string>;
}

interface Specification<S extends z.ZodType<Record<string, unknown>>>
  extends Omit<DefinitionControle, 'executer' | 'schemaParametres' | 'parametresParDefaut'> {
  schemaParametres: S;
  parametresParDefaut: z.input<S>;
  calcul(ctx: ContexteControle, parametres: z.output<S>): Calcul;
}

/** Tri déterministe (montant décroissant puis clé) et plafonnement du nombre de constats restitués. */
function plafonner(constats: Constat[], max: number): { retenus: Constat[]; omis: number } {
  const tries = [...constats].sort((a, b) => {
    const ma = a.montant === null ? ZERO : dec(a.montant).abs();
    const mb = b.montant === null ? ZERO : dec(b.montant).abs();
    const c = mb.comparedTo(ma);
    return c !== 0 ? c : a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0;
  });
  return { retenus: tries.slice(0, max), omis: Math.max(0, tries.length - max) };
}

export function definir<S extends z.ZodType<Record<string, unknown>>>(spec: Specification<S>): DefinitionControle {
  const { calcul, ...meta } = spec;
  return {
    ...meta,
    parametresParDefaut: spec.parametresParDefaut as Record<string, unknown>,
    executer(ctx: ContexteControle): ResultatControle {
      const parametres = spec.schemaParametres.parse({ ...(spec.parametresParDefaut as Record<string, unknown>), ...ctx.parametres });
      const base = { controleId: spec.id, version: spec.version, parametresAppliques: parametres as Record<string, unknown> };
      if (ctx.lignes.length === 0) {
        return { ...base, statut: 'non_realise', motif: 'Aucune écriture fournie : contrôle non réalisé.', constats: [], mesures: {} };
      }
      const r = calcul(ctx, parametres);
      const tous = r.constats ?? [];
      const max = typeof parametres['maxConstats'] === 'number' ? parametres['maxConstats'] : 200;
      const { retenus, omis } = plafonner(tous, max);
      const mesures: Record<string, string> = { ...(r.mesures ?? {}), nbConstats: String(tous.length) };
      let motif = r.motif ?? null;
      if (omis > 0) {
        mesures['nbConstatsOmis'] = String(omis);
        motif = `${motif ? `${motif} ` : ''}${omis} constat(s) non détaillé(s) au-delà du plafond de ${max} (les plus forts montants sont restitués).`;
      }
      // Garde-fou : un statut favorable est incompatible avec la présence de constats.
      const statut: StatutControle = tous.length > 0 && r.statut === 'sans_anomalie' ? 'constat' : r.statut;
      return { ...base, statut, motif, constats: retenus, mesures };
    },
  };
}

export function idsDe(lignes: readonly LigneEcriture[], max = 200): string[] {
  return lignes.slice(0, max).map((l) => l.id);
}
