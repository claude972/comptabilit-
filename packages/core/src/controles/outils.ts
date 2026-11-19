import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { dec, schemaChaineDecimale, versChaine } from '../montant.js';
import type { Constat, ContexteControle, ContexteControleFlux, DefinitionControle, LigneEcriture, ResultatControle, StatutControle } from './types.js';

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

/** Même règle que `lignesJusquaCloture`, ligne par ligne (chemin en flux). */
export function jusquaCloture(ctx: { exercice: { fin: string } | null }): (l: LigneEcriture) => boolean {
  const fin = ctx.exercice?.fin;
  return fin === undefined ? () => true : (l) => l.ecritureDate <= fin;
}

export function mentionCloture(ctx: { exercice: { fin: string } | null }): string {
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

/**
 * Ce qu'un contrôle retient d'un groupe de lignes sans garder les lignes : nombre, totaux exacts, première ligne et
 * identifiants des premières lignes (dans l'ordre d'arrivée). Sert aux DEUX chemins (en mémoire et en flux) : la
 * conclusion d'un contrôle se calcule sur ces agrégats, donc de façon identique quel que soit le chemin.
 */
export class Agregat {
  n = 0;
  debit: Decimal = ZERO;
  credit: Decimal = ZERO;
  premiere: LigneEcriture | null = null;
  readonly ids: string[] = [];
  constructor(
    private readonly maxIds = 200,
    private readonly garderId: (l: LigneEcriture) => boolean = () => true,
  ) {}
  ajouter(l: LigneEcriture): void {
    if (this.n === 0) this.premiere = l;
    this.n++;
    const m = montants(l);
    this.debit = this.debit.plus(m.debit);
    this.credit = this.credit.plus(m.credit);
    if (this.ids.length < this.maxIds && this.garderId(l)) this.ids.push(l.id);
  }
  /** Débit − crédit. */
  get solde(): Decimal {
    return this.debit.minus(this.credit);
  }
  /** Première ligne du groupe (le groupe n'est jamais vide quand on le conclut). */
  get tete(): LigneEcriture {
    return this.premiere as LigneEcriture;
  }
}

export function agreger(lignes: Iterable<LigneEcriture>, cle: (l: LigneEcriture) => string, creer: () => Agregat = () => new Agregat()): Map<string, Agregat> {
  const groupes = new Map<string, Agregat>();
  for (const l of lignes) {
    const k = cle(l);
    let g = groupes.get(k);
    if (g === undefined) {
      g = creer();
      groupes.set(k, g);
    }
    g.ajouter(l);
  }
  return groupes;
}

export interface JourDeCompte {
  date: string;
  /** Solde cumulé en fin de journée. */
  solde: Decimal;
  /** Identifiants des premières lignes du jour (100 au plus). */
  ids: string[];
}

/** Agrégat d'un compte suivi jour par jour (caisse, compte courant d'associé) : mouvement et premières lignes de chaque jour. */
export class JoursDeCompte {
  readonly ensemble = new Agregat();
  private readonly parJour = new Map<string, { mouvement: Decimal; ids: string[] }>();
  ajouter(l: LigneEcriture): void {
    this.ensemble.ajouter(l);
    let j = this.parJour.get(l.ecritureDate);
    if (j === undefined) {
      j = { mouvement: ZERO, ids: [] };
      this.parJour.set(l.ecritureDate, j);
    }
    j.mouvement = j.mouvement.plus(mouvementDe(l));
    if (j.ids.length < 100) j.ids.push(l.id);
  }
  /** Soldes cumulés en fin de journée, par ordre chronologique (l'ordre intra-journalier est inconnu dans un FEC). */
  jours(): JourDeCompte[] {
    let solde = ZERO;
    return [...this.parJour.keys()].sort().map((date) => {
      const j = this.parJour.get(date) as { mouvement: Decimal; ids: string[] };
      solde = solde.plus(j.mouvement);
      return { date, solde, ids: j.ids };
    });
  }
}

export function agregerParJour(lignes: Iterable<LigneEcriture>, cle: (l: LigneEcriture) => string): Map<string, JoursDeCompte> {
  const groupes = new Map<string, JoursDeCompte>();
  for (const l of lignes) {
    const k = cle(l);
    let g = groupes.get(k);
    if (g === undefined) {
      g = new JoursDeCompte();
      groupes.set(k, g);
    }
    g.ajouter(l);
  }
  return groupes;
}

export interface Calcul {
  statut: StatutControle;
  motif?: string | null;
  constats?: Constat[];
  /**
   * Nombre total de constats lorsque `constats` n'en porte qu'une partie (chemin en flux : seuls les constats
   * susceptibles d'être restitués sont gardés). Absent : `constats` est complet.
   */
  nbConstatsTotal?: number;
  mesures?: Record<string, string>;
}

/** Levée par un contrôle en flux qui devrait garder plus d'état que son budget : il devient « non réalisé », jamais partiel. */
export class DepassementBudget extends Error {
  constructor(readonly raison: string) {
    super(raison);
    this.name = 'DepassementBudget';
  }
}

interface Specification<S extends z.ZodType<Record<string, unknown>>>
  extends Omit<DefinitionControle, 'executer' | 'executerFlux' | 'schemaParametres' | 'parametresParDefaut'> {
  schemaParametres: S;
  parametresParDefaut: z.input<S>;
  calcul(ctx: ContexteControle, parametres: z.output<S>): Calcul;
  /** Même calcul par passages en flux (voir `DefinitionControle.executerFlux`). */
  calculFlux?(ctx: ContexteControleFlux, parametres: z.output<S>): Promise<Calcul>;
}

/** Tri déterministe (montant décroissant puis clé) et plafonnement du nombre de constats restitués. */
export function plafonner(constats: Constat[], max: number): { retenus: Constat[]; omis: number } {
  const tries = [...constats].sort((a, b) => {
    const ma = a.montant === null ? ZERO : dec(a.montant).abs();
    const mb = b.montant === null ? ZERO : dec(b.montant).abs();
    const c = mb.comparedTo(ma);
    return c !== 0 ? c : a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0;
  });
  return { retenus: tries.slice(0, max), omis: Math.max(0, tries.length - max) };
}

const maxConstatsDe = (parametres: Record<string, unknown>): number => (typeof parametres['maxConstats'] === 'number' ? parametres['maxConstats'] : 200);

/**
 * Constats d'un contrôle en flux, en mémoire bornée : compte tous les constats mais ne garde que ceux qui peuvent
 * encore figurer parmi les `max` restitués (même ordre que `plafonner`, dont il réutilise le tri).
 */
export class CollecteurConstats {
  total = 0;
  private gardes: Constat[] = [];
  private readonly max: number;
  constructor(parametres: Record<string, unknown>) {
    this.max = maxConstatsDe(parametres);
  }
  ajouter(c: Constat | null): void {
    if (c === null) return;
    this.total++;
    this.gardes.push(c);
    if (this.gardes.length >= 4 * this.max + 64) this.gardes = plafonner(this.gardes, this.max).retenus;
  }
  /** Statut et constats à rendre : `constat` s'il y en a au moins un, sinon `sans_anomalie`. */
  conclure(): Pick<Calcul, 'statut' | 'constats' | 'nbConstatsTotal'> {
    return { statut: this.total > 0 ? 'constat' : 'sans_anomalie', constats: plafonner(this.gardes, this.max).retenus, nbConstatsTotal: this.total };
  }
}

export function definir<S extends z.ZodType<Record<string, unknown>>>(spec: Specification<S>): DefinitionControle {
  const { calcul, calculFlux, ...meta } = spec;
  const preparer = (surcharges: Record<string, unknown>) => {
    const parametres = spec.schemaParametres.parse({ ...(spec.parametresParDefaut as Record<string, unknown>), ...surcharges });
    return { parametres, base: { controleId: spec.id, version: spec.version, parametresAppliques: parametres as Record<string, unknown> } };
  };
  type Base = ReturnType<typeof preparer>['base'];
  const AUCUNE_ECRITURE = { statut: 'non_realise' as const, motif: 'Aucune écriture fournie : contrôle non réalisé.', constats: [], mesures: {} };
  /** Mise en forme commune aux deux chemins : plafonnement, mesures, garde-fou sur le statut. */
  const finaliser = (base: Base, r: Calcul): ResultatControle => {
    const tous = r.constats ?? [];
    const total = r.nbConstatsTotal ?? tous.length;
    const max = maxConstatsDe(base.parametresAppliques);
    const { retenus } = plafonner(tous, max);
    const omis = Math.max(0, total - max);
    const mesures: Record<string, string> = { ...(r.mesures ?? {}), nbConstats: String(total) };
    let motif = r.motif ?? null;
    if (omis > 0) {
      mesures['nbConstatsOmis'] = String(omis);
      motif = `${motif ? `${motif} ` : ''}${omis} constat(s) non détaillé(s) au-delà du plafond de ${max} (les plus forts montants sont restitués).`;
    }
    // Garde-fou : un statut favorable est incompatible avec la présence de constats.
    const statut: StatutControle = total > 0 && r.statut === 'sans_anomalie' ? 'constat' : r.statut;
    return { ...base, statut, motif, constats: retenus, mesures };
  };
  const definition: DefinitionControle = {
    ...meta,
    parametresParDefaut: spec.parametresParDefaut as Record<string, unknown>,
    executer(ctx: ContexteControle): ResultatControle {
      const { parametres, base } = preparer(ctx.parametres);
      if (ctx.lignes.length === 0) return { ...base, ...AUCUNE_ECRITURE };
      return finaliser(base, calcul(ctx, parametres));
    },
  };
  if (calculFlux !== undefined) {
    definition.executerFlux = async (ctx: ContexteControleFlux): Promise<ResultatControle> => {
      const { parametres, base } = preparer(ctx.parametres);
      if (ctx.source.nbLignes === 0) return { ...base, ...AUCUNE_ECRITURE };
      try {
        return finaliser(base, await calculFlux(ctx, parametres));
      } catch (e) {
        if (!(e instanceof DepassementBudget)) throw e;
        return {
          ...base,
          statut: 'non_realise',
          motif:
            `Contrôle ${spec.id} non réalisé sur ce volume (${ctx.source.nbLignes.toLocaleString('fr-FR')} lignes d’écriture, traitement en flux) : ${e.raison}. ` +
            'Aucun résultat partiel n’est rendu ; ce n’est pas une absence d’anomalie.',
          constats: [],
          mesures: {},
        };
      }
    };
  }
  return definition;
}

export function idsDe(lignes: readonly LigneEcriture[], max = 200): string[] {
  return lignes.slice(0, max).map((l) => l.id);
}
