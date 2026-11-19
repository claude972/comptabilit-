import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { dec } from '../montant.js';
import { sourceInterne } from '../sources.js';
import { ZERO, aPrefixe, cleEcriture, definir, lignesJusquaCloture, montant2, schemaMaxConstats, schemaMontantPositif, schemaPrefixes } from './outils.js';
import { creditDe, debitDe } from './outils.js';

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
  calcul(ctx, p) {
    const lignes = lignesJusquaCloture(ctx);
    const ecrituresDeLiquidation = new Set<string>();
    if (p.prefixesLiquidation.length > 0) {
      for (const l of lignes) if (aPrefixe(l.compteNum, p.prefixesLiquidation)) ecrituresDeLiquidation.add(cleEcriture(l));
    }
    let base: Decimal = ZERO;
    let tva: Decimal = ZERO;
    let nbBase = 0;
    let nbTva = 0;
    for (const l of lignes) {
      if (aPrefixe(l.compteNum, p.prefixesBase)) {
        nbBase++;
        base = base.plus(creditDe(l)).minus(debitDe(l));
      } else if (aPrefixe(l.compteNum, p.prefixesTva)) {
        nbTva++;
        if (!ecrituresDeLiquidation.has(cleEcriture(l))) tva = tva.plus(creditDe(l)).minus(debitDe(l));
      }
    }
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
  },
});

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
  calcul(ctx, p) {
    const lignes = lignesJusquaCloture(ctx).filter((l) => !p.journauxANouveaux.includes(l.journalCode));
    const ecrituresDeLiquidation = new Set<string>();
    if (p.prefixesLiquidation.length > 0) {
      for (const l of lignes) if (aPrefixe(l.compteNum, p.prefixesLiquidation)) ecrituresDeLiquidation.add(cleEcriture(l));
    }
    let base: Decimal = ZERO;
    let tva: Decimal = ZERO;
    let nbBase = 0;
    let nbTva = 0;
    const prefixesBase = [...p.prefixesBase, ...p.prefixesImmobilisations];
    for (const l of lignes) {
      if (aPrefixe(l.compteNum, prefixesBase)) {
        nbBase++;
        base = base.plus(debitDe(l)).minus(creditDe(l));
      } else if (aPrefixe(l.compteNum, p.prefixesTva, p.prefixesTvaExclus)) {
        nbTva++;
        if (!ecrituresDeLiquidation.has(cleEcriture(l))) tva = tva.plus(debitDe(l)).minus(creditDe(l));
      }
    }
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
  },
});
