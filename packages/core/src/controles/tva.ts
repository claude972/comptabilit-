import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { dec } from '../montant.js';
import { sourceInterne } from '../sources.js';
import {
  DepassementBudget, ZERO, aPrefixe, cleEcriture, definir, jusquaCloture, lignesJusquaCloture, montant2, mouvementDe, schemaMaxConstats, schemaMontantPositif, schemaPrefixes,
} from './outils.js';
import type { Calcul } from './outils.js';
import type { ContexteControleFlux, LigneEcriture } from './types.js';

/**
 * Cumul de la base et de la TVA d'un cadrage (commun aux deux chemins). Les écritures de liquidation sont repérées
 * d'abord (`reperer`), puis chaque ligne est cumulée (`ajouter`) : la TVA d'une écriture de liquidation est décomptée
 * mais pas cumulée. `sens` : +1 si base et TVA se lisent au débit (TVA déductible), −1 au crédit (TVA collectée).
 */
class CumulTva {
  readonly liquidation = new Set<string>();
  base: Decimal = ZERO;
  tva: Decimal = ZERO;
  nbBase = 0;
  nbTva = 0;
  constructor(
    private readonly sens: 1 | -1,
    private readonly estBase: (compte: string) => boolean,
    private readonly estTva: (compte: string) => boolean,
    private readonly estLiquidation: ((compte: string) => boolean) | null,
  ) {}
  reperer(l: LigneEcriture): void {
    if (this.estLiquidation !== null && this.estLiquidation(l.compteNum)) this.liquidation.add(cleEcriture(l));
  }
  ajouter(l: LigneEcriture): void {
    const mouvement = this.sens === 1 ? mouvementDe(l) : mouvementDe(l).negated();
    if (this.estBase(l.compteNum)) {
      this.nbBase++;
      this.base = this.base.plus(mouvement);
    } else if (this.estTva(l.compteNum)) {
      this.nbTva++;
      if (!this.liquidation.has(cleEcriture(l))) this.tva = this.tva.plus(mouvement);
    }
  }
}

/** Les deux passages d'un cadrage en flux : écritures de liquidation, puis base et TVA. */
async function cumulerEnFlux(ctx: ContexteControleFlux, cumul: CumulTva, retenue: (l: LigneEcriture) => boolean, prefixesLiquidation: readonly string[], prefixesCumul: readonly string[]): Promise<void> {
  if (prefixesLiquidation.length > 0) {
    for await (const l of ctx.source.parcourir({ ordre: 'fichier', prefixesComptes: prefixesLiquidation })) {
      if (!retenue(l)) continue;
      cumul.reperer(l);
      if (cumul.liquidation.size > ctx.budget.elements) throw new DepassementBudget(`plus de ${ctx.budget.elements.toLocaleString('fr-FR')} écritures de liquidation de TVA`);
    }
  }
  for await (const l of ctx.source.parcourir({ ordre: 'fichier', prefixesComptes: prefixesCumul })) {
    if (retenue(l)) cumul.ajouter(l);
  }
}

interface ParametresTva001 { prefixesBase: string[]; prefixesTva: string[]; prefixesLiquidation: string[]; tauxAttendus: string[]; ventesSansTvaAdmises: boolean; toleranceTaux: string }
const cumulTva001 = (p: ParametresTva001): CumulTva =>
  new CumulTva(-1, (c) => aPrefixe(c, p.prefixesBase), (c) => aPrefixe(c, p.prefixesTva), p.prefixesLiquidation.length > 0 ? (c) => aPrefixe(c, p.prefixesLiquidation) : null);

function conclureTva001(cumul: CumulTva, p: ParametresTva001): Calcul {
  const { base, tva, nbBase, nbTva } = cumul;
  const mesures: Record<string, string> = { base: montant2(base), tvaCollectee: montant2(tva), nbLignesBase: String(nbBase), nbLignesTva: String(nbTva) };
  if (nbBase === 0) return { statut: 'non_realise', motif: `Aucun compte de produits (${p.prefixesBase.join(', ')}) dans les écritures : cadrage impossible.`, mesures };
  if (nbTva === 0) return { statut: 'non_realise', motif: `Aucun compte de TVA collectée (${p.prefixesTva.join(', ')}) dans les écritures : cadrage impossible.`, mesures };
  if (!base.isPositive() || base.isZero()) return { statut: 'non_realise', motif: 'Base nulle ou négative : taux apparent non calculable.', mesures };
  const taux = p.tauxAttendus.map((t) => dec(t));
  const tauxMax = Decimal.max(...taux);
  const tauxMin = p.ventesSansTvaAdmises ? ZERO : Decimal.min(...taux);
  const tolerance = dec(p.toleranceTaux);
  const tauxApparent = tva.div(base).times(100);
  mesures['tauxApparent'] = tauxApparent.toFixed(4, Decimal.ROUND_HALF_UP);
  mesures['tauxMin'] = tauxMin.toString();
  mesures['tauxMax'] = tauxMax.toString();
  let borne: Decimal | null = null;
  if (tauxApparent.greaterThan(tauxMax.plus(tolerance))) borne = tauxMax;
  else if (tauxApparent.lessThan(tauxMin.minus(tolerance))) borne = tauxMin;
  if (borne === null) return { statut: 'sans_anomalie', mesures };
  const tvaBorne = base.times(borne).div(100);
  const ecart = tva.minus(tvaBorne);
  return {
    statut: 'constat',
    mesures,
    constats: [
      {
        gravite: 'moyenne',
        titre: `TVA collectée peu vraisemblable : taux apparent de ${tauxApparent.toFixed(2, Decimal.ROUND_HALF_UP)} %`,
        explication:
          `TVA collectée comptabilisée ${montant2(tva)} pour une base de ${montant2(base)}, soit un taux apparent hors de l'intervalle attendu [${tauxMin.toString()} % ; ${tauxMax.toString()} %]. ` +
          `Écart de ${montant2(ecart)} par rapport à la borne de ${borne.toString()} %. Contrôle de vraisemblance : l'écart peut s'expliquer (exonérations, exigibilité, autres produits taxables).`,
        actionProposee: 'Réaliser un cadrage détaillé par taux et par nature d’opération, et rapprocher des déclarations de TVA.',
        montant: montant2(ecart.abs()),
        lignesConcernees: [],
        preuves: [
          { libelle: 'Base (comptes de produits)', valeur: montant2(base) },
          { libelle: 'TVA collectée (hors liquidation)', valeur: montant2(tva) },
          { libelle: 'Taux apparent (%)', valeur: tauxApparent.toFixed(4, Decimal.ROUND_HALF_UP) },
          { libelle: 'Taux attendus (%)', valeur: p.tauxAttendus.join(' ; ') },
        ],
        cle: 'TVA-001|global',
      },
    ],
  };
}

export const TVA_001 = definir({
  id: 'TVA-001',
  version: '1.0.0',
  cycle: 'tva',
  titre: 'Cadrage global de la TVA collectée (vraisemblance)',
  objectif: 'Apprécier la vraisemblance de la TVA collectée comptabilisée au regard du chiffre d’affaires et des taux attendus. Ce n’est PAS un contrôle de la déclaration de TVA.',
  perimetre: 'Base : comptes 70x (crédit − débit). TVA collectée : comptes 4457x (crédit − débit), hors écritures de liquidation.',
  donneesObligatoires: ['compteNum', 'debit', 'credit', 'journalCode', 'ecritureNum'],
  logique:
    'CONTRÔLE DE VRAISEMBLANCE. Base = Σ (crédit − débit) des comptes de préfixes `prefixesBase` (défaut 70, RRR accordés 709 inclus). ' +
    'TVA = Σ (crédit − débit) des comptes de préfixes `prefixesTva` (défaut 4457), en excluant les lignes des écritures qui mouvementent aussi un compte de préfixes `prefixesLiquidation` ' +
    '(défaut 4455 : écritures de déclaration qui soldent la TVA collectée). Taux apparent = TVA / base. Le taux apparent doit être compris entre le plus petit et le plus grand des `tauxAttendus` ' +
    '(borne basse ramenée à 0 si `ventesSansTvaAdmises`), à `toleranceTaux` points près. Hors bornes : constat, montant = écart de TVA par rapport à la borne franchie.',
  schemaParametres: z.strictObject({
    prefixesBase: schemaPrefixes,
    prefixesTva: schemaPrefixes,
    prefixesLiquidation: z.array(z.string().regex(/^\d{1,12}$/)),
    tauxAttendus: z.array(schemaMontantPositif).min(1),
    ventesSansTvaAdmises: z.boolean(),
    toleranceTaux: schemaMontantPositif,
    maxConstats: schemaMaxConstats,
  }),
  parametresParDefaut: {
    prefixesBase: ['70'],
    prefixesTva: ['4457'],
    prefixesLiquidation: ['4455'],
    tauxAttendus: ['20', '10', '5.5', '2.1'],
    ventesSansTvaAdmises: false,
    toleranceTaux: '0.05',
    maxConstats: 200,
  },
  exceptions:
    'Faible pouvoir de détection lorsque plusieurs taux coexistent (seules les bornes sont testées). Ne tient pas compte de l’exigibilité (TVA sur encaissements, prestations de services), ' +
    'des opérations exonérées ou hors champ, des exportations et livraisons intracommunautaires (activer `ventesSansTvaAdmises`), de la franchise en base, des cessions d’immobilisations, des acomptes, ' +
    'de la TVA sur autres produits (comptes 74, 75, 77…). Les taux par défaut sont des paramètres (France métropolitaine) et non une source réglementaire du contrôle.',
  source: sourceInterne(
    'Contrôle de vraisemblance interne. Taux par défaut paramétrables : taux normal 20 % (CGI art. 278, consulté sur Légifrance le 2026-11-19, article signalé comme abrogé à terme par l’ordonnance n° 2025-1247 du 17 décembre 2025) ; taux 10 %, 5,5 % et 2,1 % non revérifiés.',
  ),
  resultatsAttendus: 'Taux apparent compris dans les bornes des taux attendus ; tout écart est à expliquer par un cadrage détaillé.',
  calculGrosVolume:
    'Flux, état borné aux écritures de liquidation. Deux passages restreints : les comptes de liquidation (une clé par écriture de liquidation, budget d’éléments), puis les comptes de produits et de TVA collectée, cumulés ligne par ligne.',
  calcul(ctx, p) {
    const lignes = lignesJusquaCloture(ctx);
    const cumul = cumulTva001(p);
    for (const l of lignes) cumul.reperer(l);
    for (const l of lignes) cumul.ajouter(l);
    return conclureTva001(cumul, p);
  },
  async calculFlux(ctx, p) {
    const cumul = cumulTva001(p);
    await cumulerEnFlux(ctx, cumul, jusquaCloture(ctx), p.prefixesLiquidation, [...p.prefixesBase, ...p.prefixesTva]);
    return conclureTva001(cumul, p);
  },
});

interface ParametresTva002 {
  prefixesBase: string[]; prefixesImmobilisations: string[]; prefixesTva: string[]; prefixesTvaExclus: string[]; prefixesLiquidation: string[]; journauxANouveaux: string[];
  tauxAttendus: string[]; tauxPlancher: string; toleranceTaux: string;
}
const cumulTva002 = (p: ParametresTva002): CumulTva => {
  const prefixesBase = [...p.prefixesBase, ...p.prefixesImmobilisations];
  return new CumulTva(1, (c) => aPrefixe(c, prefixesBase), (c) => aPrefixe(c, p.prefixesTva, p.prefixesTvaExclus), p.prefixesLiquidation.length > 0 ? (c) => aPrefixe(c, p.prefixesLiquidation) : null);
};

function conclureTva002(cumul: CumulTva, p: ParametresTva002): Calcul {
  const { base, tva, nbBase, nbTva } = cumul;
  const prefixesBase = [...p.prefixesBase, ...p.prefixesImmobilisations];
  const mesures: Record<string, string> = { base: montant2(base), tvaDeductible: montant2(tva), nbLignesBase: String(nbBase), nbLignesTva: String(nbTva) };
  if (nbBase === 0) return { statut: 'non_realise', motif: `Aucun compte d'achats, de charges externes ou d'immobilisations (${prefixesBase.join(', ')}) dans les écritures : cadrage impossible.`, mesures };
  if (nbTva === 0) return { statut: 'non_realise', motif: `Aucun compte de TVA déductible (${p.prefixesTva.join(', ')}) dans les écritures : cadrage impossible (franchise en base ou TVA non comptabilisée ?).`, mesures };
  if (!base.isPositive() || base.isZero()) return { statut: 'non_realise', motif: 'Base nulle ou négative : taux apparent non calculable.', mesures };
  const tauxMax = Decimal.max(...p.tauxAttendus.map((t) => dec(t)));
  const plancher = dec(p.tauxPlancher);
  const tolerance = dec(p.toleranceTaux);
  const tauxApparent = tva.div(base).times(100);
  mesures['tauxApparent'] = tauxApparent.toFixed(4, Decimal.ROUND_HALF_UP);
  mesures['tauxMax'] = tauxMax.toString();
  mesures['tauxPlancher'] = plancher.toString();
  let borne: Decimal | null = null;
  if (tauxApparent.greaterThan(tauxMax.plus(tolerance))) borne = tauxMax;
  else if (plancher.isPositive() && !plancher.isZero() && tauxApparent.lessThan(plancher.minus(tolerance))) borne = plancher;
  if (borne === null) return { statut: 'sans_anomalie', mesures };
  const ecart = tva.minus(base.times(borne).div(100));
  const exces = borne.equals(tauxMax) && tauxApparent.greaterThan(tauxMax);
  return {
    statut: 'constat',
    mesures,
    constats: [
      {
        gravite: 'moyenne',
        titre: `TVA déductible peu vraisemblable : taux apparent de ${tauxApparent.toFixed(2, Decimal.ROUND_HALF_UP)} %`,
        explication:
          `TVA déductible comptabilisée ${montant2(tva)} pour une base d'achats, charges externes et immobilisations de ${montant2(base)}. ` +
          (exces
            ? `Le taux apparent dépasse le taux maximal attendu de ${tauxMax.toString()} % : la TVA déduite excède de ${montant2(ecart)} le maximum théorique. `
            : `Le taux apparent est inférieur au plancher paramétré de ${plancher.toString()} % (écart de ${montant2(ecart)}). `) +
          'Contrôle de vraisemblance : l’écart peut s’expliquer (régularisations, TVA sur immobilisations d’un autre exercice, autoliquidation).',
        actionProposee: 'Réaliser un cadrage détaillé de la TVA déductible par nature de dépense et rapprocher des déclarations de TVA.',
        montant: montant2(ecart.abs()),
        lignesConcernees: [],
        preuves: [
          { libelle: 'Base (achats, charges externes, immobilisations)', valeur: montant2(base) },
          { libelle: 'TVA déductible (hors liquidation)', valeur: montant2(tva) },
          { libelle: 'Taux apparent (%)', valeur: tauxApparent.toFixed(4, Decimal.ROUND_HALF_UP) },
          { libelle: 'Taux attendus (%)', valeur: p.tauxAttendus.join(' ; ') },
        ],
        cle: 'TVA-002|global',
      },
    ],
  };
}

export const TVA_002 = definir({
  id: 'TVA-002',
  version: '1.0.0',
  cycle: 'tva',
  titre: 'Cadrage global de la TVA déductible (vraisemblance)',
  objectif: 'Apprécier la vraisemblance de la TVA déductible comptabilisée au regard des achats, charges externes et acquisitions d’immobilisations. Ce n’est PAS un contrôle de la déclaration de TVA ni du droit à déduction.',
  perimetre: 'Base : comptes 60x, 61x, 62x (débit − crédit) et acquisitions d’immobilisations 20x, 21x, 23x, hors journaux d’à-nouveaux. TVA déductible : comptes 4456x (débit − crédit), hors crédit de TVA à reporter (44567), hors écritures de liquidation et à-nouveaux.',
  donneesObligatoires: ['compteNum', 'debit', 'credit', 'journalCode', 'ecritureNum'],
  logique:
    'CONTRÔLE DE VRAISEMBLANCE. Base = Σ (débit − crédit) des comptes de préfixes `prefixesBase` et `prefixesImmobilisations`. TVA = Σ (débit − crédit) des comptes de préfixes `prefixesTva` hors `prefixesTvaExclus`, ' +
    'en excluant les lignes des écritures qui mouvementent aussi un compte de préfixes `prefixesLiquidation` (défaut 4455). Les lignes des journaux d’à-nouveaux sont ignorées des deux côtés. ' +
    'Taux apparent = TVA / base. Constat si le taux apparent dépasse le plus grand des `tauxAttendus` de plus de `toleranceTaux` points (TVA déduite supérieure au maximum théorique), ' +
    'ou s’il est inférieur à `tauxPlancher` (défaut 0 : pas de borne basse, de nombreuses charges ne supportant pas de TVA). Montant = écart de TVA par rapport à la borne franchie.',
  schemaParametres: z.strictObject({
    prefixesBase: schemaPrefixes,
    prefixesImmobilisations: z.array(z.string().regex(/^\d{1,12}$/)),
    prefixesTva: schemaPrefixes,
    prefixesTvaExclus: z.array(z.string().regex(/^\d{1,12}$/)),
    prefixesLiquidation: z.array(z.string().regex(/^\d{1,12}$/)),
    journauxANouveaux: z.array(z.string().min(1).max(20)),
    tauxAttendus: z.array(schemaMontantPositif).min(1),
    tauxPlancher: schemaMontantPositif,
    toleranceTaux: schemaMontantPositif,
    maxConstats: schemaMaxConstats,
  }),
  parametresParDefaut: {
    prefixesBase: ['60', '61', '62'],
    prefixesImmobilisations: ['20', '21', '23'],
    prefixesTva: ['4456'],
    prefixesTvaExclus: ['44567'],
    prefixesLiquidation: ['4455'],
    journauxANouveaux: ['AN', 'ANO', 'RAN'],
    tauxAttendus: ['20', '10', '5.5', '2.1'],
    tauxPlancher: '0',
    toleranceTaux: '0.05',
    maxConstats: 200,
  },
  exceptions:
    'Pouvoir de détection limité : seule une TVA déductible excédant le taux maximal appliqué à toute la base est signalée par défaut. Ne tient pas compte des charges sans TVA (loyers nus, assurances, salaires hors périmètre), ' +
    'des exclusions du droit à déduction (véhicules de tourisme, cadeaux), du prorata, de l’autoliquidation (acquisitions intracommunautaires, sous-traitance du bâtiment), de la TVA sur les débits ou les encaissements, ni des variations de stock (603). ' +
    'Les taux par défaut sont des paramètres (France métropolitaine) et non une source réglementaire du contrôle.',
  source: sourceInterne(
    'Contrôle de vraisemblance interne, symétrique de TVA-001. Taux par défaut paramétrables : taux normal 20 % (CGI art. 278, consulté sur Légifrance le 2026-11-19) ; taux 10 %, 5,5 % et 2,1 % non revérifiés.',
  ),
  resultatsAttendus: 'Taux apparent de TVA déductible inférieur ou égal au taux maximal attendu ; tout dépassement est à expliquer par un cadrage détaillé.',
  calculGrosVolume:
    'Flux, état borné aux écritures de liquidation. Deux passages restreints : les comptes de liquidation (une clé par écriture de liquidation, budget d’éléments), puis les comptes d’achats, de charges externes, d’immobilisations et de TVA déductible, cumulés ligne par ligne.',
  calcul(ctx, p) {
    const lignes = lignesJusquaCloture(ctx).filter((l) => !p.journauxANouveaux.includes(l.journalCode));
    const cumul = cumulTva002(p);
    for (const l of lignes) cumul.reperer(l);
    for (const l of lignes) cumul.ajouter(l);
    return conclureTva002(cumul, p);
  },
  async calculFlux(ctx, p) {
    const avantCloture = jusquaCloture(ctx);
    const cumul = cumulTva002(p);
    await cumulerEnFlux(ctx, cumul, (l) => avantCloture(l) && !p.journauxANouveaux.includes(l.journalCode), p.prefixesLiquidation, [...p.prefixesBase, ...p.prefixesImmobilisations, ...p.prefixesTva]);
    return conclureTva002(cumul, p);
  },
});
