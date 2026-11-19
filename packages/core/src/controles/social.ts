import { z } from 'zod';
import { dec } from '../montant.js';
import { sourceInterne } from '../sources.js';
import { aPrefixe, definir, grouper, idsDe, lignesJusquaCloture, mentionCloture, montant2, schemaMaxConstats, schemaMontantPositif, schemaPrefixes, soldeDe } from './outils.js';
import type { Constat, LigneEcriture } from './types.js';

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
  calcul(ctx, p) {
    const seuil = dec(p.seuil);
    const lignes = lignesJusquaCloture(ctx);
    const salaires = lignes.filter((l) => aPrefixe(l.compteNum, p.prefixesSalaires));
    const charges = lignes.filter((l) => aPrefixe(l.compteNum, p.prefixesCharges));
    const tiers = lignes.filter((l) => aPrefixe(l.compteNum, [...p.prefixesPersonnel, ...p.prefixesOrganismes]));
    if (salaires.length === 0 && charges.length === 0 && tiers.length === 0) {
      return { statut: 'non_applicable', motif: 'Aucun compte de salaires (641), de charges sociales (645), de personnel (421) ni de sécurité sociale (431) mouvementé dans les écritures fournies.' };
    }
    const constats: Constat[] = [];
    const totalSalaires = soldeDe(salaires);
    const totalCharges = soldeDe(charges);
    if (totalSalaires.greaterThan(seuil) && !totalCharges.greaterThan(0)) {
      constats.push({
        gravite: 'moyenne',
        titre: 'Salaires comptabilisés sans charges sociales',
        explication: `Les comptes de salaires (${p.prefixesSalaires.join(', ')}) totalisent ${montant2(totalSalaires)} ${mentionCloture(ctx)} alors que les comptes de charges sociales (${p.prefixesCharges.join(', ')}) totalisent ${montant2(totalCharges)}. Contrôle de vraisemblance : une rémunération salariée donne normalement lieu à des cotisations.`,
        actionProposee: 'Vérifier l’imputation des cotisations patronales (compte 645), la comptabilisation des bordereaux de charges et la nature des rémunérations.',
        montant: montant2(totalSalaires),
        lignesConcernees: idsDe(salaires),
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
        lignesConcernees: idsDe(charges),
        preuves: [{ libelle: 'Total charges sociales (débit − crédit)', valeur: montant2(totalCharges) }, { libelle: 'Total salaires (débit − crédit)', valeur: montant2(totalSalaires) }],
        cle: 'SOC-001|charges_sans_salaires',
      });
    }
    const parCompte = grouper(tiers, (l) => l.compteNum);
    for (const compte of [...parCompte.keys()].sort()) {
      const ls = parCompte.get(compte) ?? [];
      const solde = soldeDe(ls);
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
        lignesConcernees: idsDe(ls.filter((l) => l.ecritureLet === null)),
        preuves: [{ libelle: 'Compte', valeur: `${compte} ${(ls[0] as LigneEcriture).compteLib}`.trim() }, { libelle: 'Solde (débit − crédit)', valeur: montant2(solde) }],
        cle: `SOC-001|debiteur|${compte}`,
      });
    }
    return {
      statut: constats.length > 0 ? 'constat' : 'sans_anomalie',
      constats,
      mesures: { totalSalaires: montant2(totalSalaires), totalChargesSociales: montant2(totalCharges), nbComptesTiersExamines: String(parCompte.size) },
    };
  },
});
