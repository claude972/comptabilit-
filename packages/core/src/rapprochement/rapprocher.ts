/**
 * Rapprochement déterministe en deux niveaux (exact, puis règles explicites) et vérification d'une
 * suggestion externe (niveau 3). Aucune heuristique « intelligente » : chaque rapprochement cite la
 * règle appliquée et ses critères. Une ambiguïté n'est jamais tranchée ; une recherche interrompue
 * est toujours déclarée.
 *
 * Arithmétique : montants validés par `montant.ts` puis manipulés en entiers exacts (BigInt, millionièmes) ;
 * aucun flottant. Déterminisme : les éléments sont d'abord classés (date, montant, id) ; le résultat ne
 * dépend pas de l'ordre des tableaux fournis.
 *
 * Les libellés sont des contenus NON FIABLES : ils ne participent à aucun critère et ne sont repris
 * dans aucune explication.
 */
import { Decimal } from 'decimal.js';
import { estDateIso, joursDepuisEpoque } from '../dates.js';
import { dec, versChaine } from '../montant.js';
import { PARAMETRES_RAPPROCHEMENT_PAR_DEFAUT, REGLES_RAPPROCHEMENT, schemaParametresRapprochement } from './types.js';
import type { CritereRapprochement, ElementRapprochable, ParametresRapprochement, Rapprochement, ResultatRapprochement } from './types.js';

const ECHELLE = 1_000_000n;
const MAX_SOLUTIONS = 3;
const MAX_CANDIDATS_RESTITUES = 20;
const MAX_IDS_RESTITUES = 200;

function versMicro(d: Decimal): bigint {
  return BigInt(d.times(1_000_000).toFixed(0));
}

function chaineDeMicro(m: bigint): string {
  const negatif = m < 0n;
  const abs = negatif ? -m : m;
  const entier = abs / ECHELLE;
  const frac = (abs % ECHELLE).toString().padStart(6, '0');
  const d = new Decimal(`${negatif ? '-' : ''}${entier.toString()}.${frac}`);
  return versChaine(d, Math.max(2, d.decimalPlaces()));
}

const abs = (m: bigint): bigint => (m < 0n ? -m : m);
const signe = (m: bigint): number => (m > 0n ? 1 : m < 0n ? -1 : 0);

/** Référence normalisée : majuscules, caractères alphanumériques seuls. Vide → null. */
export function normaliserReference(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const t = v.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return t === '' ? null : t.slice(0, 140);
}

function normaliserTiers(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const t = v.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  return t === '' ? null : t.slice(0, 140);
}

type Cote = 'A' | 'B';
interface Elt {
  id: string;
  cote: Cote;
  type: ElementRapprochable['type'];
  date: string;
  jours: number;
  m: bigint;
  ref: string | null;
  tiers: string | null;
  rang: number;
  etat: 'libre' | 'pris' | 'gele' | 'nul';
}

interface Proposition { regle: string; niveau: 'exact' | 'regle'; a: Elt[]; b: Elt[]; fenetre: number; extra: CritereRapprochement[] }

function resoudreParametres(parametres: Partial<ParametresRapprochement> | undefined): ParametresRapprochement {
  return schemaParametresRapprochement.parse({ ...PARAMETRES_RAPPROCHEMENT_PAR_DEFAUT, ...(parametres ?? {}) });
}

function preparer(elements: readonly ElementRapprochable[], cote: Cote): Elt[] {
  if (!Array.isArray(elements)) throw new Error(`Côté ${cote} : tableau d'éléments attendu.`);
  const vus = new Set<string>();
  const liste: Elt[] = elements.map((e) => {
    if (e === null || typeof e !== 'object' || typeof e.id !== 'string' || e.id === '') throw new Error(`Côté ${cote} : élément sans identifiant.`);
    if (vus.has(e.id)) throw new Error(`Côté ${cote} : identifiant en double (${e.id.slice(0, 80)}).`);
    vus.add(e.id);
    if (!estDateIso(e.date)) throw new Error(`Côté ${cote}, élément ${e.id.slice(0, 80)} : date ISO AAAA-MM-JJ attendue.`);
    const m = versMicro(dec(e.montant));
    return {
      id: e.id, cote, type: e.type, date: e.date, jours: joursDepuisEpoque(e.date), m,
      ref: normaliserReference(e.reference), tiers: normaliserTiers(e.tiers), rang: 0, etat: m === 0n ? 'nul' : 'libre',
    };
  });
  liste.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.m < y.m ? -1 : x.m > y.m ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  liste.forEach((e, i) => {
    e.rang = i;
  });
  return liste;
}

const libres = (l: readonly Elt[]): Elt[] => l.filter((e) => e.etat === 'libre');
const somme = (l: readonly Elt[]): bigint => l.reduce((s, e) => s + e.m, 0n);
const parRang = (x: Elt, y: Elt): number => x.rang - y.rang;

function grouperPar<K>(l: readonly Elt[], cle: (e: Elt) => K | null): Map<K, Elt[]> {
  const g = new Map<K, Elt[]>();
  for (const e of l) {
    const k = cle(e);
    if (k === null) continue;
    const liste = g.get(k);
    if (liste === undefined) g.set(k, [e]);
    else liste.push(e);
  }
  return g;
}

function ecartDatesMax(a: readonly Elt[], b: readonly Elt[]): number {
  let max = 0;
  for (const x of a) for (const y of b) max = Math.max(max, Math.abs(x.jours - y.jours));
  return max;
}

function valeurs(l: readonly Elt[], f: (e: Elt) => string | null): string {
  const v = [...new Set(l.map((e) => f(e) ?? '(non renseigné)'))];
  return v.length === 0 ? '(aucun)' : v.slice(0, 6).join(', ') + (v.length > 6 ? ', …' : '');
}

function intervalleDates(l: readonly Elt[]): string {
  if (l.length === 0) return '(aucune)';
  const dates = l.map((e) => e.date).sort();
  const min = dates[0] as string;
  const max = dates[dates.length - 1] as string;
  return min === max ? min : `${min} au ${max}`;
}

/** Critères communs à tout rapprochement (calculés sur les données, jamais sur les libellés). */
function criteresCommuns(a: readonly Elt[], b: readonly Elt[], fenetre: number, tolerance: bigint): CritereRapprochement[] {
  const sa = somme(a);
  const sb = somme(b);
  const refs = new Set([...a, ...b].map((e) => e.ref));
  const tiers = new Set([...a, ...b].map((e) => e.tiers).filter((t) => t !== null));
  const criteres: CritereRapprochement[] = [
    { critere: 'montant', valeurA: chaineDeMicro(sa), valeurB: chaineDeMicro(sb), satisfait: sa === sb },
    { critere: 'ecart_dans_tolerance', valeurA: chaineDeMicro(abs(sa - sb)), valeurB: chaineDeMicro(tolerance), satisfait: abs(sa - sb) <= tolerance },
    { critere: 'reference', valeurA: valeurs(a, (e) => e.ref), valeurB: valeurs(b, (e) => e.ref), satisfait: refs.size === 1 && !refs.has(null) && a.length > 0 && b.length > 0 },
    { critere: 'tiers', valeurA: valeurs(a, (e) => e.tiers), valeurB: valeurs(b, (e) => e.tiers), satisfait: tiers.size === 1 },
  ];
  if (a.length > 0 && b.length > 0) {
    const ecart = ecartDatesMax(a, b);
    criteres.push({ critere: `date (écart maximal de ${ecart} jour(s), fenêtre de ${fenetre})`, valeurA: intervalleDates(a), valeurB: intervalleDates(b), satisfait: ecart <= fenetre });
  }
  return criteres;
}

function redigerExplication(regle: string, a: readonly Elt[], b: readonly Elt[], criteres: readonly CritereRapprochement[], ecart: bigint): string {
  const description = REGLES_RAPPROCHEMENT.find((r) => r.id === regle)?.description ?? '';
  const detail = criteres.map((c) => `${c.critere} — A : ${c.valeurA} ; B : ${c.valeurB} ; ${c.satisfait ? 'satisfait' : 'non satisfait'}`).join(' | ');
  return `Règle ${regle} appliquée à ${a.length} élément(s) du côté A et ${b.length} élément(s) du côté B. ${description} Critères : ${detail}. Écart (A − B) : ${chaineDeMicro(ecart)}.`;
}

function versRapprochement(p: Proposition, tolerance: bigint): Rapprochement {
  const a = [...p.a].sort(parRang);
  const b = [...p.b].sort(parRang);
  const ecart = somme(a) - somme(b);
  const criteres = [...criteresCommuns(a, b, p.fenetre, tolerance), ...p.extra];
  return { niveau: p.niveau, regle: p.regle, cotesA: a.map((e) => e.id), cotesB: b.map((e) => e.id), ecart: chaineDeMicro(ecart), criteres, explication: redigerExplication(p.regle, a, b, criteres, ecart) };
}

interface Recherche { solutions: Elt[][]; epuise: boolean; explorees: number }

/**
 * Sous-ensembles de 2 à `tailleMax` candidats dont la somme égale exactement `cible`.
 * S'arrête à MAX_SOLUTIONS (cela suffit à établir l'ambiguïté) ou à l'épuisement du budget.
 * `mixte` : candidats de signes opposés admis, la solution doit alors contenir les deux signes.
 */
function chercherSousEnsembles(candidats: readonly Elt[], cible: bigint, tailleMax: number, budget: number, mixte: boolean): Recherche {
  const tri = [...candidats].sort((x, y) => (abs(x.m) > abs(y.m) ? -1 : abs(x.m) < abs(y.m) ? 1 : x.rang - y.rang));
  const n = tri.length;
  const suffixePos: bigint[] = new Array<bigint>(n + 1).fill(0n);
  const suffixeNeg: bigint[] = new Array<bigint>(n + 1).fill(0n);
  for (let i = n - 1; i >= 0; i--) {
    const m = (tri[i] as Elt).m;
    suffixePos[i] = (suffixePos[i + 1] as bigint) + (m > 0n ? m : 0n);
    suffixeNeg[i] = (suffixeNeg[i + 1] as bigint) + (m < 0n ? m : 0n);
  }
  const solutions: Elt[][] = [];
  const choisis: Elt[] = [];
  let explorees = 0;
  let epuise = false;
  const descendre = (i: number, reste: bigint): void => {
    if (epuise || solutions.length >= MAX_SOLUTIONS) return;
    if (++explorees > budget) {
      epuise = true;
      return;
    }
    if (reste === 0n && choisis.length >= 2) {
      if (!mixte || (choisis.some((e) => e.m > 0n) && choisis.some((e) => e.m < 0n))) solutions.push([...choisis]);
      if (!mixte) return;
    }
    if (i >= n || choisis.length >= tailleMax) return;
    if (reste > (suffixePos[i] as bigint) || reste < (suffixeNeg[i] as bigint)) return;
    const e = tri[i] as Elt;
    choisis.push(e);
    descendre(i + 1, reste - e.m);
    choisis.pop();
    descendre(i + 1, reste);
  };
  descendre(0, cible);
  return { solutions, epuise: epuise && solutions.length < 2, explorees };
}

export function rapprocher(
  a: readonly ElementRapprochable[],
  b: readonly ElementRapprochable[],
  parametres?: Partial<ParametresRapprochement>,
): ResultatRapprochement {
  const p = resoudreParametres(parametres);
  const tolerance = versMicro(dec(p.toleranceMontant));
  const fraisMax = versMicro(dec(p.fraisBancairesMax));
  const A = preparer(a, 'A');
  const B = preparer(b, 'B');
  const retenus: Proposition[] = [];
  const ambiguites: ResultatRapprochement['ambiguites'] = [];
  const abandons: ResultatRapprochement['abandons'] = [];
  const compte: Record<string, number> = {};
  let combinaisons = 0;

  const idsDe = (l: readonly Elt[]): string[] => [...l].sort((x, y) => (x.cote === y.cote ? x.rang - y.rang : x.cote === 'A' ? -1 : 1)).map((e) => e.id);

  /** Retient les propositions isolées ; des propositions qui se disputent un élément deviennent une ambiguïté. */
  const arbitrer = (propositions: Proposition[], raison: string): void => {
    const parent = propositions.map((_, i) => i);
    const racine = (i: number): number => {
      let r = i;
      while (parent[r] !== r) r = parent[r] as number;
      while (parent[i] !== r) {
        const suivant = parent[i] as number;
        parent[i] = r;
        i = suivant;
      }
      return r;
    };
    const premier = new Map<Elt, number>();
    propositions.forEach((prop, i) => {
      for (const e of [...prop.a, ...prop.b]) {
        const j = premier.get(e);
        if (j === undefined) premier.set(e, i);
        else parent[racine(i)] = racine(j);
      }
    });
    const groupes = new Map<number, Proposition[]>();
    propositions.forEach((prop, i) => {
      const r = racine(i);
      const g = groupes.get(r);
      if (g === undefined) groupes.set(r, [prop]);
      else g.push(prop);
    });
    for (const g of groupes.values()) {
      if (g.length === 1) {
        const prop = g[0] as Proposition;
        for (const e of [...prop.a, ...prop.b]) e.etat = 'pris';
        retenus.push(prop);
        compte[prop.regle] = (compte[prop.regle] ?? 0) + 1;
        continue;
      }
      const tous = new Set<Elt>();
      for (const prop of g) for (const e of [...prop.a, ...prop.b]) tous.add(e);
      for (const e of tous) e.etat = 'gele';
      const regle = (g[0] as Proposition).regle;
      ambiguites.push({
        ids: idsDe([...tous]).slice(0, MAX_IDS_RESTITUES),
        candidats: g.slice(0, MAX_CANDIDATS_RESTITUES).map((prop) => idsDe([...prop.a, ...prop.b])),
        raison: `${regle} : ${raison} (${g.length} solution(s) concurrente(s)${g.length > MAX_CANDIDATS_RESTITUES ? `, ${MAX_CANDIDATS_RESTITUES} restituées` : ''}). Aucune n'est retenue.`,
      });
    }
  };

  // --- Niveau 1 : exact -------------------------------------------------------------------
  {
    const cle = (e: Elt): string | null => (e.ref === null ? null : `${e.ref}\u0001${e.m.toString()}`);
    const gb = grouperPar(libres(B), cle);
    const propositions: Proposition[] = [];
    for (const [k, la] of grouperPar(libres(A), cle)) {
      for (const x of la) for (const y of gb.get(k) ?? []) propositions.push({ regle: 'EXACT-REFERENCE', niveau: 'exact', a: [x], b: [y], fenetre: p.fenetreJours, extra: [] });
    }
    arbitrer(propositions, 'plusieurs éléments portent la même référence et le même montant');
  }
  {
    const gb = grouperPar(libres(B), (e) => e.m.toString());
    const propositions: Proposition[] = [];
    for (const [k, la] of grouperPar(libres(A), (e) => e.m.toString())) {
      for (const x of la) for (const y of gb.get(k) ?? []) {
        if (Math.abs(x.jours - y.jours) <= p.fenetreJours) propositions.push({ regle: 'EXACT-MONTANT-DATE', niveau: 'exact', a: [x], b: [y], fenetre: p.fenetreJours, extra: [] });
      }
    }
    arbitrer(propositions, 'plusieurs candidats de même montant dans la fenêtre de dates');
  }

  // --- Niveau 2 : règles explicites -----------------------------------------------------------
  /** Paires (x de A, y de B) de même sens, dans la fenêtre des règles, dont la différence x − y vérifie `test`. */
  const paires = (min: bigint, max: bigint, test: (x: Elt, y: Elt, diff: bigint) => boolean): Array<[Elt, Elt]> => {
    const tri = libres(B).sort((x, y) => (x.m < y.m ? -1 : x.m > y.m ? 1 : x.rang - y.rang));
    const resultat: Array<[Elt, Elt]> = [];
    for (const x of libres(A)) {
      // y.m ∈ [x.m − max, x.m − min]
      const bas = x.m - max;
      const haut = x.m - min;
      let g = 0;
      let d = tri.length;
      while (g < d) {
        const milieu = (g + d) >> 1;
        if ((tri[milieu] as Elt).m < bas) g = milieu + 1;
        else d = milieu;
      }
      for (let i = g; i < tri.length && (tri[i] as Elt).m <= haut; i++) {
        const y = tri[i] as Elt;
        if (signe(x.m) !== signe(y.m) || Math.abs(x.jours - y.jours) > p.fenetreJoursRegles) continue;
        if (test(x, y, x.m - y.m)) resultat.push([x, y]);
      }
    }
    return resultat;
  };

  if (tolerance > 0n) {
    const propositions = paires(-tolerance, tolerance, (_x, _y, diff) => diff !== 0n).map(([x, y]): Proposition => ({
      regle: 'REGLE-ECART-REGLEMENT', niveau: 'regle', a: [x], b: [y], fenetre: p.fenetreJoursRegles, extra: [],
    }));
    arbitrer(propositions, 'plusieurs candidats dans la tolérance de montant');
  }

  if (fraisMax > 0n) {
    // attendu − banque ∈ ]0 ; fraisMax] : la banque a encaissé moins, ou décaissé davantage, que l'attendu.
    const propositions = paires(-fraisMax, fraisMax, (x, y, diff) => {
      const banqueA = x.type === 'mouvement_bancaire';
      const banqueB = y.type === 'mouvement_bancaire';
      if (banqueA === banqueB) return false;
      const frais = banqueB ? diff : -diff;
      return frais > 0n && frais <= fraisMax;
    }).map(([x, y]): Proposition => {
      const frais = abs(x.m - y.m);
      return {
        regle: 'REGLE-FRAIS-BANCAIRES', niveau: 'regle', a: [x], b: [y], fenetre: p.fenetreJoursRegles,
        extra: [{ critere: 'frais_bancaires', valeurA: chaineDeMicro(frais), valeurB: chaineDeMicro(fraisMax), satisfait: true }],
      };
    });
    arbitrer(propositions, 'plusieurs candidats compatibles avec des frais bancaires');
  }

  /** Recherche « un élément = somme d'un groupe d'un même tiers » dans les deux directions. */
  const rechercherGroupes = (regle: string, mixte: boolean): void => {
    const propositions: Proposition[] = [];
    for (const [seuls, autres] of [[A, B], [B, A]] as const) {
      const parTiers = grouperPar(libres(autres), (e) => e.tiers);
      const tiersTries = [...parTiers.keys()].sort();
      for (const s of libres(seuls)) {
        const solutions: Elt[][] = [];
        let abandonne = false;
        for (const t of tiersTries) {
          if (s.tiers !== null && s.tiers !== t) continue;
          const candidats = (parTiers.get(t) ?? []).filter((e) => e.etat === 'libre' && Math.abs(e.jours - s.jours) <= p.fenetreJoursRegles
            && (mixte ? true : signe(e.m) === signe(s.m) && abs(e.m) < abs(s.m)));
          if (candidats.length < 2) continue;
          if (!mixte && abs(somme(candidats)) < abs(s.m)) continue;
          if (mixte && !(candidats.some((e) => e.m > 0n) && candidats.some((e) => e.m < 0n))) continue;
          const r = chercherSousEnsembles(candidats, s.m, p.tailleMaxGroupe, p.budgetCombinaisons, mixte);
          combinaisons += r.explorees;
          if (r.epuise) {
            abandonne = true;
            abandons.push({
              raison: `${regle} : budget de ${p.budgetCombinaisons} combinaisons épuisé pour l'élément ${s.id.slice(0, 80)} face à ${candidats.length} candidats du tiers ${t.slice(0, 80)} ; recherche abandonnée, aucun rapprochement retenu pour cet élément.`,
              ids: idsDe([s, ...candidats]).slice(0, MAX_IDS_RESTITUES),
            });
            break;
          }
          solutions.push(...r.solutions);
        }
        if (abandonne || solutions.length === 0) continue;
        for (const sol of solutions) {
          propositions.push({
            regle, niveau: 'regle', a: s.cote === 'A' ? [s] : sol, b: s.cote === 'A' ? sol : [s], fenetre: p.fenetreJoursRegles,
            extra: [{ critere: 'groupe', valeurA: String(s.cote === 'A' ? 1 : sol.length), valeurB: String(s.cote === 'A' ? sol.length : 1), satisfait: true }],
          });
        }
      }
    }
    arbitrer(propositions, 'plusieurs combinaisons donnent la même somme, ou plusieurs éléments se disputent le même groupe');
  };

  rechercherGroupes('REGLE-PAIEMENT-GROUPE', false);

  if (p.autoriserCompensations) {
    rechercherGroupes('REGLE-COMPENSATION', true);
    // (b) Facture et avoir d'un même tiers, du même côté, de montants exactement opposés.
    const propositions: Proposition[] = [];
    for (const cote of [A, B]) {
      for (const groupe of grouperPar(libres(cote), (e) => (e.tiers === null ? null : `${e.tiers}\u0001${abs(e.m).toString()}`)).values()) {
        const positifs = groupe.filter((e) => e.m > 0n);
        const negatifs = groupe.filter((e) => e.m < 0n);
        for (const x of positifs) for (const y of negatifs) {
          if (Math.abs(x.jours - y.jours) > p.fenetreJoursRegles) continue;
          const paire = [x, y].sort(parRang);
          propositions.push({
            regle: 'REGLE-COMPENSATION', niveau: 'regle', a: x.cote === 'A' ? paire : [], b: x.cote === 'A' ? [] : paire, fenetre: p.fenetreJoursRegles,
            extra: [{ critere: `compensation_meme_cote (${x.cote})`, valeurA: chaineDeMicro(x.m), valeurB: chaineDeMicro(y.m), satisfait: true }],
          });
        }
      }
    }
    arbitrer(propositions, 'plusieurs factures ou avoirs de même montant peuvent se compenser');
  }

  if (p.autoriserPartiels) {
    const propositions: Proposition[] = [];
    for (const [seuls, autres] of [[A, B], [B, A]] as const) {
      const autresParRef = grouperPar(libres(autres), (e) => e.ref);
      const autresParTiers = grouperPar(libres(autres), (e) => e.tiers);
      const seulsParTiers = grouperPar(libres(seuls), (e) => e.tiers);
      for (const x of libres(seuls)) {
        const compatibles = (l: readonly Elt[] | undefined): Elt[] => (l ?? []).filter((e) => signe(e.m) === signe(x.m) && Math.abs(e.jours - x.jours) <= p.fenetreJoursRegles);
        let ancrage = 'reference';
        let parts = x.ref === null ? [] : compatibles(autresParRef.get(x.ref));
        if (parts.length === 0 && x.tiers !== null && (seulsParTiers.get(x.tiers) ?? []).length === 1) {
          ancrage = 'tiers';
          parts = compatibles(autresParTiers.get(x.tiers));
        }
        if (parts.length === 0) continue;
        const total = abs(somme(parts));
        if (total > abs(x.m) || (parts.length === 1 && total === abs(x.m))) continue;
        if (parts.length > p.tailleMaxGroupe) {
          abandons.push({
            raison: `REGLE-PAIEMENTS-PARTIELS : ${parts.length} éléments rattachés à ${x.id.slice(0, 80)}, au-delà de la taille maximale de groupe (${p.tailleMaxGroupe}) ; aucun rapprochement retenu.`,
            ids: idsDe([x, ...parts]).slice(0, MAX_IDS_RESTITUES),
          });
          continue;
        }
        const reste = x.m - somme(parts);
        propositions.push({
          regle: 'REGLE-PAIEMENTS-PARTIELS', niveau: 'regle', a: x.cote === 'A' ? [x] : parts, b: x.cote === 'A' ? parts : [x], fenetre: p.fenetreJoursRegles,
          extra: [
            { critere: `ancrage (${ancrage})`, valeurA: x.cote === 'A' ? '1' : String(parts.length), valeurB: x.cote === 'A' ? String(parts.length) : '1', satisfait: true },
            { critere: 'solde_restant', valeurA: chaineDeMicro(reste), valeurB: chaineDeMicro(0n), satisfait: reste === 0n },
          ],
        });
      }
    }
    arbitrer(propositions, 'plusieurs éléments se disputent les mêmes règlements partiels');
  }

  // --- Restitution ------------------------------------------------------------------------
  const rangMin = (prop: Proposition): [number, number] => [
    prop.a.length > 0 ? Math.min(...prop.a.map((e) => e.rang)) : Number.MAX_SAFE_INTEGER,
    prop.b.length > 0 ? Math.min(...prop.b.map((e) => e.rang)) : Number.MAX_SAFE_INTEGER,
  ];
  retenus.sort((x, y) => {
    const [xa, xb] = rangMin(x);
    const [ya, yb] = rangMin(y);
    return xa !== ya ? xa - ya : xb - yb;
  });
  ambiguites.sort((x, y) => (x.ids.join('\u0001') < y.ids.join('\u0001') ? -1 : x.ids.join('\u0001') > y.ids.join('\u0001') ? 1 : x.raison < y.raison ? -1 : 1));
  abandons.sort((x, y) => (x.ids.join('\u0001') < y.ids.join('\u0001') ? -1 : x.ids.join('\u0001') > y.ids.join('\u0001') ? 1 : x.raison < y.raison ? -1 : 1));
  const mesures: Record<string, string> = {
    nbA: String(A.length),
    nbB: String(B.length),
    nbRapprochements: String(retenus.length),
    nbAmbiguites: String(ambiguites.length),
    nbAbandons: String(abandons.length),
    nbMontantsNuls: String([...A, ...B].filter((e) => e.etat === 'nul').length),
    combinaisonsExplorees: String(combinaisons),
  };
  for (const r of REGLES_RAPPROCHEMENT) mesures[`nb_${r.id}`] = String(compte[r.id] ?? 0);
  return {
    rapprochements: retenus.map((prop) => versRapprochement(prop, tolerance)),
    nonRapprochesA: A.filter((e) => e.etat !== 'pris').map((e) => e.id),
    nonRapprochesB: B.filter((e) => e.etat !== 'pris').map((e) => e.id),
    ambiguites,
    abandons,
    mesures,
  };
}

/**
 * Niveau 3 : VÉRIFIE une suggestion venue d'ailleurs (par exemple d'une IA). Ne suggère rien et
 * n'accepte rien : le résultat est un constat arithmétique et une liste de conflits, la décision
 * reste à l'appelant (et à un humain). `arithmetiqueOk` exige des identifiants tous connus, sans
 * doublon, et une somme A égale à la somme B au centime près exact.
 *
 * Conflits détectés : identifiant inconnu, identifiant répété, suggestion vide, élément déjà engagé
 * dans un rapprochement existant de composition différente. Les rapprochements existants sont ceux
 * fournis dans `dejaRapproches` ; à défaut, ceux que `rapprocher` établit de façon déterministe.
 */
export function verifierSuggestion(
  suggestion: { cotesA: string[]; cotesB: string[] },
  a: readonly ElementRapprochable[],
  b: readonly ElementRapprochable[],
  parametres?: Partial<ParametresRapprochement>,
  dejaRapproches?: ReadonlyArray<{ cotesA: readonly string[]; cotesB: readonly string[]; regle?: string }>,
): { arithmetiqueOk: boolean; ecart: string; dansTolerance: boolean; conflits: string[]; criteres: Rapprochement['criteres'] } {
  const p = resoudreParametres(parametres);
  const tolerance = versMicro(dec(p.toleranceMontant));
  const A = preparer(a, 'A');
  const B = preparer(b, 'B');
  const conflits: string[] = [];
  const court = (id: unknown): string => String(id).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 80);
  const resoudre = (ids: unknown, liste: Elt[], cote: Cote): Elt[] => {
    if (!Array.isArray(ids)) {
      conflits.push(`Côté ${cote} : liste d'identifiants attendue.`);
      return [];
    }
    const index = new Map(liste.map((e) => [e.id, e]));
    const vus = new Set<string>();
    const trouves: Elt[] = [];
    for (const id of ids) {
      if (typeof id !== 'string' || !index.has(id)) {
        conflits.push(`Côté ${cote} : identifiant inconnu (${court(id)}).`);
        continue;
      }
      if (vus.has(id)) {
        conflits.push(`Côté ${cote} : identifiant répété (${court(id)}).`);
        continue;
      }
      vus.add(id);
      trouves.push(index.get(id) as Elt);
    }
    return trouves.sort(parRang);
  };
  const ea = resoudre(suggestion?.cotesA, A, 'A');
  const eb = resoudre(suggestion?.cotesB, B, 'B');
  if (ea.length + eb.length === 0) conflits.push('Suggestion vide : aucun élément connu.');
  else if ((ea.length === 0 || eb.length === 0) && (somme(ea) - somme(eb) !== 0n || ea.length + eb.length < 2)) {
    conflits.push(`Suggestion sans élément du côté ${ea.length === 0 ? 'A' : 'B'} : seule une compensation à somme nulle peut se passer d'un côté.`);
  }

  const existants = dejaRapproches ?? rapprocher(a, b, p).rapprochements;
  const cleSuggestion = `${ea.map((e) => e.id).sort().join('\u0001')}\u0002${eb.map((e) => e.id).sort().join('\u0001')}`;
  for (const r of existants) {
    const cle = `${[...r.cotesA].sort().join('\u0001')}\u0002${[...r.cotesB].sort().join('\u0001')}`;
    if (cle === cleSuggestion) continue;
    const prisA = new Set(r.cotesA);
    const prisB = new Set(r.cotesB);
    for (const e of ea) if (prisA.has(e.id)) conflits.push(`Côté A : élément ${court(e.id)} déjà rapproché${r.regle ? ` (${court(r.regle)})` : ''}.`);
    for (const e of eb) if (prisB.has(e.id)) conflits.push(`Côté B : élément ${court(e.id)} déjà rapproché${r.regle ? ` (${court(r.regle)})` : ''}.`);
  }
  const ecart = somme(ea) - somme(eb);
  const signes = new Set([...ea, ...eb].map((e) => signe(e.m)).filter((s) => s !== 0));
  const criteres: CritereRapprochement[] = [
    ...criteresCommuns(ea, eb, p.fenetreJoursRegles, tolerance),
    { critere: 'meme_sens', valeurA: valeurs(ea, (e) => (e.m >= 0n ? 'encaissement' : 'décaissement')), valeurB: valeurs(eb, (e) => (e.m >= 0n ? 'encaissement' : 'décaissement')), satisfait: signes.size <= 1 },
    { critere: 'taille_groupe', valeurA: String(ea.length), valeurB: String(eb.length), satisfait: ea.length <= p.tailleMaxGroupe && eb.length <= p.tailleMaxGroupe },
  ];
  const sansConflit = conflits.length === 0;
  return {
    arithmetiqueOk: sansConflit && ecart === 0n,
    ecart: chaineDeMicro(ecart),
    dansTolerance: sansConflit && abs(ecart) <= tolerance,
    conflits,
    criteres,
  };
}
