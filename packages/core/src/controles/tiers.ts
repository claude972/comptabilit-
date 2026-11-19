import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { ecartEnJours } from '../dates.js';
import { dec } from '../montant.js';
import { sourceInterne } from '../sources.js';
import {
  ZERO, aPrefixe, cleTiers, definir, grouper, idsDe, lignesJusquaCloture, mentionCloture, montant2, mouvementDe, schemaMaxConstats,
  schemaMontantPositif, schemaPrefixes, soldeDe,
} from './outils.js';
import type { Constat, ContexteControle, LigneEcriture } from './types.js';
import type { Calcul } from './outils.js';

interface ParametresSolde { prefixesComptes: string[]; seuil: string; maxConstats: number }

function soldesAnormaux(
  ctx: ContexteControle,
  p: ParametresSolde,
  cfg: { id: string; nature: string; sensAnormal: 'crediteur' | 'debiteur'; explication: string; action: string },
): Calcul {
  const seuil = dec(p.seuil);
  const lignes = lignesJusquaCloture(ctx).filter((l) => aPrefixe(l.compteNum, p.prefixesComptes));
  if (lignes.length === 0) {
    return { statut: 'non_applicable', motif: `Aucun compte ${cfg.nature} (${p.prefixesComptes.join(', ')}) mouvementé dans les écritures fournies.` };
  }
  const constats: Constat[] = [];
  const parTiers = grouper(lignes, (l) => `${l.compteNum}\u0001${cleTiers(l)}`);
  for (const ls of parTiers.values()) {
    const premiere = ls[0] as LigneEcriture;
    const solde = soldeDe(ls);
    const anormal = cfg.sensAnormal === 'crediteur' ? solde.negated() : solde;
    if (!anormal.greaterThan(seuil)) continue;
    const tiers = cleTiers(premiere);
    const nom = premiere.compAuxLib ?? premiere.compteLib;
    constats.push({
      gravite: 'moyenne',
      titre: `Compte ${cfg.nature} ${tiers} ${cfg.sensAnormal === 'crediteur' ? 'créditeur' : 'débiteur'} de ${montant2(anormal)} ${mentionCloture(ctx)}`,
      explication: cfg.explication,
      actionProposee: cfg.action,
      montant: montant2(anormal),
      lignesConcernees: idsDe(ls.filter((l) => l.ecritureLet === null)),
      preuves: [
        { libelle: 'Tiers', valeur: `${tiers} ${nom}`.trim() },
        { libelle: 'Compte général', valeur: premiere.compteNum },
        { libelle: 'Solde (débit − crédit)', valeur: montant2(solde) },
        { libelle: 'Détail par compte auxiliaire', valeur: premiere.compAuxNum !== null ? 'oui' : 'non (compte général)' },
      ],
      cle: `${cfg.id}|${premiere.compteNum}|${tiers}`,
    });
  }
  return { statut: constats.length > 0 ? 'constat' : 'sans_anomalie', constats, mesures: { nbTiersExamines: String(parTiers.size) } };
}

const schemaSolde = z.strictObject({ prefixesComptes: schemaPrefixes, seuil: schemaMontantPositif, maxConstats: schemaMaxConstats });

export const TIE_001 = definir({
  id: 'TIE-001',
  version: '1.0.0',
  cycle: 'clients',
  titre: 'Clients créditeurs',
  objectif: 'Repérer les comptes clients présentant un solde créditeur à la clôture (avance, avoir à rembourser, double règlement, erreur d’imputation).',
  perimetre: 'Comptes 411 (paramétrable), par compte auxiliaire ; à défaut de compte auxiliaire, par compte général.',
  donneesObligatoires: ['compteNum', 'compAuxNum', 'debit', 'credit', 'ecritureDate'],
  logique: 'Solde = Σ débit − Σ crédit par (compte général, compte auxiliaire) sur les lignes datées jusqu’à la clôture. Un solde créditeur supérieur au seuil produit un constat.',
  schemaParametres: schemaSolde,
  parametresParDefaut: { prefixesComptes: ['411'], seuil: '0.00', maxConstats: 200 },
  exceptions: 'Les acomptes reçus régulièrement comptabilisés en 4191 ne sont pas concernés. Sans comptes auxiliaires, les soldes créditeurs individuels sont masqués par la compensation au sein du compte général.',
  source: sourceInterne('Convention de cabinet (revue des soldes anormaux des comptes de tiers).'),
  resultatsAttendus: 'Aucun client créditeur, ou soldes créditeurs justifiés et reclassés au passif.',
  calcul: (ctx, p) =>
    soldesAnormaux(ctx, p, {
      id: 'TIE-001',
      nature: 'client',
      sensAnormal: 'crediteur',
      explication: 'Un compte client est normalement débiteur. Un solde créditeur peut traduire une avance, un avoir non remboursé, un double règlement ou une erreur d’imputation.',
      action: 'Identifier l’origine du solde ; reclasser au passif (clients créditeurs) ou corriger l’imputation.',
    }),
});

export const TIE_002 = definir({
  id: 'TIE-002',
  version: '1.0.0',
  cycle: 'fournisseurs',
  titre: 'Fournisseurs débiteurs',
  objectif: 'Repérer les comptes fournisseurs présentant un solde débiteur à la clôture (acompte, avoir à recevoir, double paiement, facture non comptabilisée).',
  perimetre: 'Comptes 401 (paramétrable), par compte auxiliaire ; à défaut de compte auxiliaire, par compte général.',
  donneesObligatoires: ['compteNum', 'compAuxNum', 'debit', 'credit', 'ecritureDate'],
  logique: 'Solde = Σ débit − Σ crédit par (compte général, compte auxiliaire) sur les lignes datées jusqu’à la clôture. Un solde débiteur supérieur au seuil produit un constat.',
  schemaParametres: schemaSolde,
  parametresParDefaut: { prefixesComptes: ['401'], seuil: '0.00', maxConstats: 200 },
  exceptions: 'Les acomptes versés régulièrement comptabilisés en 4091 ne sont pas concernés. Sans comptes auxiliaires, les soldes débiteurs individuels sont masqués.',
  source: sourceInterne('Convention de cabinet (revue des soldes anormaux des comptes de tiers).'),
  resultatsAttendus: 'Aucun fournisseur débiteur, ou soldes débiteurs justifiés et reclassés à l’actif.',
  calcul: (ctx, p) =>
    soldesAnormaux(ctx, p, {
      id: 'TIE-002',
      nature: 'fournisseur',
      sensAnormal: 'debiteur',
      explication: 'Un compte fournisseur est normalement créditeur. Un solde débiteur peut traduire un acompte, un avoir à recevoir, un double paiement ou une facture non comptabilisée.',
      action: 'Identifier l’origine du solde ; rechercher la facture manquante ou reclasser à l’actif (fournisseurs débiteurs).',
    }),
});

export const TIE_003 = definir({
  id: 'TIE-003',
  version: '1.0.0',
  cycle: 'clients',
  titre: 'Ancienneté des soldes tiers non lettrés',
  objectif: 'Repérer les créances clients et dettes fournisseurs non lettrées anciennes (risque de non-recouvrement, de litige ou d’erreur).',
  perimetre: 'Comptes 411 et 401 (paramétrable), par compte auxiliaire ; lignes sans code de lettrage.',
  donneesObligatoires: ['compteNum', 'compAuxNum', 'ecritureLet', 'pieceDate', 'ecritureDate', 'debit', 'credit', 'exercice.fin'],
  logique:
    'Pour chaque tiers, on retient les lignes non lettrées (EcritureLet vide) datées jusqu’à la clôture. L’âge d’une ligne est le nombre de jours entre sa date de pièce ' +
    '(à défaut sa date d’écriture) et la date de clôture. Si la somme algébrique (débit − crédit) des lignes non lettrées d’âge strictement supérieur à `seuilJours` ' +
    'dépasse en valeur absolue `seuilMontant`, un constat est produit pour ce montant. Seuil par défaut de 90 jours : convention interne.',
  schemaParametres: z.strictObject({
    prefixesComptes: schemaPrefixes,
    seuilJours: z.number().int().min(0).max(3650),
    seuilMontant: schemaMontantPositif,
    maxConstats: schemaMaxConstats,
  }),
  parametresParDefaut: { prefixesComptes: ['411', '401'], seuilJours: 90, seuilMontant: '0.00', maxConstats: 200 },
  exceptions:
    'Si l’exercice est inconnu, ou si aucune ligne des comptes de tiers ne porte de lettrage (lettrage non tenu ou non exporté), le contrôle n’est PAS réalisé : ' +
    'l’ancienneté n’est pas mesurable. Un lettrage partiel peut être exporté sous des formes diverses et fausser le calcul. Les à-nouveaux non détaillés sont datés de l’ouverture.',
  source: sourceInterne('Convention de cabinet : seuil d’ancienneté de 90 jours, paramétrable (aucun texte ne fixe ce seuil).'),
  resultatsAttendus: 'Aucun solde non lettré ancien, ou soldes anciens justifiés (litige, échéancier, dépréciation).',
  calcul(ctx, p) {
    const exercice = ctx.exercice;
    if (exercice === null) return { statut: 'non_realise', motif: 'Exercice inconnu : la date de clôture servant au calcul de l’ancienneté n’est pas communiquée.' };
    const lignes = lignesJusquaCloture(ctx).filter((l) => aPrefixe(l.compteNum, p.prefixesComptes));
    if (lignes.length === 0) return { statut: 'non_applicable', motif: 'Aucun compte de tiers (411, 401) mouvementé dans les écritures fournies.' };
    if (!lignes.some((l) => l.ecritureLet !== null)) {
      return { statut: 'non_realise', motif: 'Aucun lettrage dans les comptes de tiers : ancienneté des soldes non mesurable.' };
    }
    const seuilMontant = dec(p.seuilMontant);
    const constats: Constat[] = [];
    const parTiers = grouper(lignes.filter((l) => l.ecritureLet === null), (l) => `${l.compteNum}\u0001${cleTiers(l)}`);
    for (const ls of parTiers.values()) {
      const premiere = ls[0] as LigneEcriture;
      const anciennes: LigneEcriture[] = [];
      let ageMax = 0;
      let net: Decimal = ZERO;
      for (const l of ls) {
        const age = ecartEnJours(l.pieceDate ?? l.ecritureDate, exercice.fin);
        if (age > p.seuilJours) {
          anciennes.push(l);
          net = net.plus(mouvementDe(l));
          if (age > ageMax) ageMax = age;
        }
      }
      if (anciennes.length === 0 || !net.abs().greaterThan(seuilMontant)) continue;
      const tiers = cleTiers(premiere);
      constats.push({
        gravite: ageMax > 2 * p.seuilJours ? 'moyenne' : 'faible',
        titre: `Tiers ${tiers} : ${montant2(net.abs())} non lettré depuis plus de ${p.seuilJours} jours`,
        explication: `${anciennes.length} ligne(s) non lettrée(s) de plus de ${p.seuilJours} jours à la clôture du ${exercice.fin} ; solde net ${net.isPositive() ? 'débiteur' : 'créditeur'} de ${montant2(net.abs())} ; ancienneté maximale ${ageMax} jours.`,
        actionProposee: 'Relancer ou justifier (litige, échéancier) ; apprécier une dépréciation pour les créances ; compléter le lettrage.',
        montant: montant2(net.abs()),
        lignesConcernees: idsDe(anciennes),
        preuves: [
          { libelle: 'Tiers', valeur: `${tiers} ${premiere.compAuxLib ?? premiere.compteLib}`.trim() },
          { libelle: 'Compte général', valeur: premiere.compteNum },
          { libelle: 'Solde net non lettré ancien (débit − crédit)', valeur: montant2(net) },
          { libelle: 'Ancienneté maximale (jours)', valeur: String(ageMax) },
        ],
        cle: `TIE-003|${premiere.compteNum}|${tiers}`,
      });
    }
    return { statut: constats.length > 0 ? 'constat' : 'sans_anomalie', constats, mesures: { nbTiersAvecLignesNonLettrees: String(parTiers.size), dateReference: exercice.fin } };
  },
});
