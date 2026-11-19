import { z } from 'zod';
import { dec } from '../montant.js';
import { sourceInterne } from '../sources.js';
import { Agregat, DepassementBudget, aPrefixe, definir, jusquaCloture, lignesJusquaCloture, mentionCloture, montant2, schemaMaxConstats, schemaMontantPositif, schemaPrefixes } from './outils.js';
import type { Calcul } from './outils.js';
import type { Constat, LigneEcriture } from './types.js';

interface ParametresSoc001 { prefixesSalaires: string[]; prefixesCharges: string[]; prefixesPersonnel: string[]; prefixesOrganismes: string[]; seuil: string }

/** Totaux des salaires et des charges sociales, et un agrégat par compte de personnel ou d'organisme (commun aux deux chemins). */
class CollecteSociale {
  private readonly salaires = new Agregat();
  private readonly charges = new Agregat();
  private readonly tiers = new Map<string, Agregat>();
  private readonly prefixesTiers: string[];
  constructor(private readonly p: ParametresSoc001) {
    this.prefixesTiers = [...p.prefixesPersonnel, ...p.prefixesOrganismes];
  }
  get nbComptesTiers(): number {
    return this.tiers.size;
  }
  ajouter(l: LigneEcriture): void {
    if (aPrefixe(l.compteNum, this.p.prefixesSalaires)) this.salaires.ajouter(l);
    if (aPrefixe(l.compteNum, this.p.prefixesCharges)) this.charges.ajouter(l);
    if (aPrefixe(l.compteNum, this.prefixesTiers)) {
      let a = this.tiers.get(l.compteNum);
      if (a === undefined) {
        a = new Agregat(200, (x) => x.ecritureLet === null);
        this.tiers.set(l.compteNum, a);
      }
      a.ajouter(l);
    }
  }
  conclure(ctx: { exercice: { fin: string } | null }): Calcul {
    const { p, salaires, charges, tiers: parCompte } = this;
    const seuil = dec(p.seuil);
    if (salaires.n === 0 && charges.n === 0 && parCompte.size === 0) {
      return { statut: 'non_applicable', motif: 'Aucun compte de salaires (641), de charges sociales (645), de personnel (421) ni de sécurité sociale (431) mouvementé dans les écritures fournies.' };
    }
    const constats: Constat[] = [];
    const totalSalaires = salaires.solde;
    const totalCharges = charges.solde;
    if (totalSalaires.greaterThan(seuil) && !totalCharges.greaterThan(0)) {
      constats.push({
        gravite: 'moyenne',
        titre: 'Salaires comptabilisés sans charges sociales',
        explication: `Les comptes de salaires (${p.prefixesSalaires.join(', ')}) totalisent ${montant2(totalSalaires)} ${mentionCloture(ctx)} alors que les comptes de charges sociales (${p.prefixesCharges.join(', ')}) totalisent ${montant2(totalCharges)}. Contrôle de vraisemblance : une rémunération salariée donne normalement lieu à des cotisations.`,
        actionProposee: 'Vérifier l’imputation des cotisations patronales (compte 645), la comptabilisation des bordereaux de charges et la nature des rémunérations.',
        montant: montant2(totalSalaires),
        lignesConcernees: salaires.ids,
        preuves: [{ libelle: 'Total salaires (débit − crédit)', valeur: montant2(totalSalaires) }, { libelle: 'Total charges sociales (débit − crédit)', valeur: montant2(totalCharges) }],
        cle: 'SOC-001|salaires_sans_charges',
      });
    } else if (totalCharges.greaterThan(seuil) && !totalSalaires.greaterThan(0)) {
      constats.push({
        gravite: 'moyenne',
        titre: 'Charges sociales comptabilisées sans salaires',
        explication: `Les comptes de charges sociales (${p.prefixesCharges.join(', ')}) totalisent ${montant2(totalCharges)} ${mentionCloture(ctx)} alors que les comptes de salaires (${p.prefixesSalaires.join(', ')}) totalisent ${montant2(totalSalaires)}. Contrôle de vraisemblance.`,
        actionProposee: 'Vérifier l’imputation des rémunérations (compte 641) et la nature des cotisations comptabilisées (cotisations du dirigeant, régularisations).',
        montant: montant2(totalCharges),
        lignesConcernees: charges.ids,
        preuves: [{ libelle: 'Total charges sociales (débit − crédit)', valeur: montant2(totalCharges) }, { libelle: 'Total salaires (débit − crédit)', valeur: montant2(totalSalaires) }],
        cle: 'SOC-001|charges_sans_salaires',
      });
    }
    for (const compte of [...parCompte.keys()].sort()) {
      const a = parCompte.get(compte) as Agregat;
      const solde = a.solde;
      if (!solde.greaterThan(seuil)) continue;
      const personnel = aPrefixe(compte, p.prefixesPersonnel);
      constats.push({
        gravite: 'moyenne',
        titre: `Compte ${compte} débiteur de ${montant2(solde)} ${mentionCloture(ctx)}`,
        explication: personnel
          ? `Le compte de rémunérations dues ${compte} est débiteur : il a été payé plus de salaires nets qu'il n'en a été constaté. À examiner (salaire non comptabilisé, acompte à reclasser, double paiement).`
          : `Le compte d'organisme social ${compte} est débiteur : il a été réglé plus de cotisations qu'il n'en a été constaté. À examiner (charges non comptabilisées, trop-versé à récupérer).`,
        actionProposee: 'Rapprocher du journal de paie et des bordereaux de cotisations ; reclasser ou régulariser.',
        montant: montant2(solde),
        lignesConcernees: a.ids,
        preuves: [{ libelle: 'Compte', valeur: `${compte} ${a.tete.compteLib}`.trim() }, { libelle: 'Solde (débit − crédit)', valeur: montant2(solde) }],
        cle: `SOC-001|debiteur|${compte}`,
      });
    }
    return {
      statut: constats.length > 0 ? 'constat' : 'sans_anomalie',
      constats,
      mesures: { totalSalaires: montant2(totalSalaires), totalChargesSociales: montant2(totalCharges), nbComptesTiersExamines: String(parCompte.size) },
    };
  }
}

export const SOC_001 = definir({
  id: 'SOC-001',
  version: '1.0.0',
  cycle: 'social',
  titre: 'Cohérence sociale : salaires, charges sociales et soldes des comptes de personnel (vraisemblance)',
  objectif: 'Repérer des salaires sans charges sociales (ou l’inverse) et des soldes de sens anormal sur les comptes de rémunérations dues et de sécurité sociale à la clôture.',
  perimetre: 'Comptes 641 (rémunérations du personnel), 645 (cotisations de sécurité sociale et de prévoyance), 421 (personnel – rémunérations dues) et 431 (sécurité sociale), paramétrables.',
  donneesObligatoires: ['compteNum', 'debit', 'credit', 'ecritureDate'],
  logique:
    'CONTRÔLE DE VRAISEMBLANCE. (1) Total net (débit − crédit) des comptes 641 et des comptes 645 jusqu’à la clôture : si l’un dépasse le seuil alors que l’autre est nul ou négatif, constat (montant = total du compte présent). ' +
    '(2) Pour chaque compte 421 et 431, solde à la clôture : un solde DÉBITEUR supérieur au seuil est anormal (ces comptes enregistrent à leur crédit les sommes dues au personnel et aux organismes), constat par compte.',
  schemaParametres: z.strictObject({
    prefixesSalaires: schemaPrefixes,
    prefixesCharges: schemaPrefixes,
    prefixesPersonnel: schemaPrefixes,
    prefixesOrganismes: schemaPrefixes,
    seuil: schemaMontantPositif,
    maxConstats: schemaMaxConstats,
  }),
  parametresParDefaut: { prefixesSalaires: ['641'], prefixesCharges: ['645'], prefixesPersonnel: ['421'], prefixesOrganismes: ['431'], seuil: '0.00', maxConstats: 200 },
  exceptions:
    'Des rémunérations sans cotisations existent (gratifications de stage sous le seuil, certaines indemnités) ; un dirigeant non salarié relève d’autres comptes (644, 646). ' +
    'Un compte 421 ou 431 peut être débiteur à juste titre (trop-versé à récupérer, acompte non reclassé en 425, régularisation de cotisations). ' +
    'Le contrôle ne vérifie ni les taux de cotisations ni la concordance avec les déclarations sociales (DSN).',
  source: sourceInterne(
    'Contrôle de vraisemblance interne. Contexte (PCG, règlement ANC n° 2014-03, consulté le 2026-11-19) : art. 1214-42, le compte 421 est crédité des rémunérations à payer ; art. 1214-43, le compte 431 est crédité des cotisations dues et débité des règlements.',
  ),
  resultatsAttendus: 'Salaires et charges sociales tous deux présents (ou tous deux absents) ; comptes 421 et 431 créditeurs ou soldés à la clôture.',
  calculGrosVolume:
    'Flux, état borné au plan de comptes. Un passage dans l’ordre du fichier, restreint aux comptes de salaires, de charges sociales, de personnel et d’organismes : deux totaux et un agrégat par compte de tiers (budget d’éléments).',
  calcul(ctx, p) {
    const collecte = new CollecteSociale(p);
    for (const l of lignesJusquaCloture(ctx)) collecte.ajouter(l);
    return collecte.conclure(ctx);
  },
  async calculFlux(ctx, p) {
    const avantCloture = jusquaCloture(ctx);
    const collecte = new CollecteSociale(p);
    // Ordre du fichier : les lignes concernées sont les premières lignes de salaires (ou de charges) du fichier.
    for await (const l of ctx.source.parcourir({ ordre: 'fichier', prefixesComptes: [...p.prefixesSalaires, ...p.prefixesCharges, ...p.prefixesPersonnel, ...p.prefixesOrganismes] })) {
      if (!avantCloture(l)) continue;
      collecte.ajouter(l);
      if (collecte.nbComptesTiers > ctx.budget.elements) throw new DepassementBudget(`plus de ${ctx.budget.elements.toLocaleString('fr-FR')} comptes de personnel et d’organismes sociaux`);
    }
    return collecte.conclure(ctx);
  },
});
