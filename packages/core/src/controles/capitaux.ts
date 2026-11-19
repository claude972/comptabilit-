import { z } from 'zod';
import { dec } from '../montant.js';
import { SOURCES } from '../sources.js';
import { aPrefixe, cleTiers, definir, grouper, idsDe, mentionCloture, montant2, schemaMaxConstats, schemaMontantPositif, schemaPrefixes, soldesFinDeJour } from './outils.js';
import type { Constat, LigneEcriture } from './types.js';

export const CAP_001 = definir({
  id: 'CAP-001',
  version: '1.0.0',
  cycle: 'capitaux_propres',
  titre: 'Comptes courants d’associés débiteurs (à examiner)',
  objectif:
    'Repérer les comptes courants d’associés débiteurs : dans les SARL, SA et SAS, un découvert en compte courant consenti à un dirigeant ou associé personne physique est interdit à peine de nullité.',
  perimetre: 'Comptes 455 (paramétrable), par compte général et compte auxiliaire.',
  donneesObligatoires: ['compteNum', 'compAuxNum', 'ecritureDate', 'debit', 'credit'],
  logique:
    'Pour chaque compte courant, solde cumulé (débit − crédit) en fin de journée par ordre chronologique. Un solde débiteur supérieur au seuil à la clôture produit un constat de gravité élevée ; ' +
    'si `controleInfraAnnuel` est actif, un solde débiteur en cours de période, résorbé à la clôture, produit un constat de gravité moyenne. ' +
    'Le constat est formulé « à examiner » : la forme sociale et la qualité du titulaire (personne physique ou morale, dirigeant ou non) ne figurent pas dans le FEC.',
  schemaParametres: z.strictObject({
    prefixesComptes: schemaPrefixes,
    seuil: schemaMontantPositif,
    controleInfraAnnuel: z.boolean(),
    maxConstats: schemaMaxConstats,
  }),
  parametresParDefaut: { prefixesComptes: ['455'], seuil: '0.00', controleInfraAnnuel: true, maxConstats: 200 },
  exceptions:
    'L’interdiction ne vise pas les associés personnes morales, ni les sociétés exploitant un établissement bancaire ou financier pour leurs opérations courantes ; elle ne concerne pas, par ces textes, les sociétés de personnes (SNC, sociétés civiles) ni l’entreprise individuelle. ' +
    'Sans compte auxiliaire ni subdivision par associé, un associé débiteur peut être masqué par un associé créditeur. Les avances à des tiers liés comptabilisées dans d’autres comptes ne sont pas couvertes.',
  source: SOURCES.comptesCourantsAssocies,
  resultatsAttendus: 'Comptes courants d’associés créditeurs ou nuls à tout moment.',
  calcul(ctx, p) {
    const seuil = dec(p.seuil);
    const fin = ctx.exercice?.fin;
    const lignes = ctx.lignes.filter((l) => aPrefixe(l.compteNum, p.prefixesComptes) && (fin === undefined || l.ecritureDate <= fin));
    if (lignes.length === 0) return { statut: 'non_applicable', motif: 'Aucun compte courant d’associé (455) mouvementé dans les écritures fournies.' };
    const constats: Constat[] = [];
    const parCompte = grouper(lignes, (l) => `${l.compteNum}\u0001${cleTiers(l)}`);
    for (const ls of parCompte.values()) {
      const premiere = ls[0] as LigneEcriture;
      const titulaire = premiere.compAuxNum !== null ? `${premiere.compteNum} / ${premiere.compAuxNum}` : premiere.compteNum;
      const jours = soldesFinDeJour(ls);
      const dernier = jours[jours.length - 1];
      if (dernier === undefined) continue;
      const debiteurs = jours.filter((j) => j.solde.greaterThan(seuil));
      const rappel =
        'À examiner selon la forme sociale et la qualité du titulaire : interdit à peine de nullité pour les gérants et associés personnes physiques de SARL (C. com. L223-21), ' +
        'les administrateurs et directeurs généraux de SA (L225-43), le président et les dirigeants de SAS (L227-12).';
      if (dernier.solde.greaterThan(seuil)) {
        constats.push({
          gravite: 'elevee',
          titre: `Compte courant d’associé ${titulaire} débiteur de ${montant2(dernier.solde)} ${mentionCloture(ctx)} (à examiner)`,
          explication: `Solde débiteur de ${montant2(dernier.solde)} à la clôture ; débiteur ${debiteurs.length} jour(s) d’écriture sur la période. ${rappel}`,
          actionProposee: 'Identifier le titulaire et la forme sociale ; faire régulariser (remboursement, affectation de rémunération ou de dividendes régulièrement décidés) et alerter le dirigeant.',
          montant: montant2(dernier.solde),
          lignesConcernees: idsDe(ls),
          preuves: [
            { libelle: 'Compte', valeur: `${titulaire} ${premiere.compAuxLib ?? premiere.compteLib}`.trim() },
            { libelle: 'Solde de clôture (débit − crédit)', valeur: montant2(dernier.solde) },
            { libelle: 'Première date débitrice', valeur: debiteurs[0]?.date ?? dernier.date },
          ],
          cle: `CAP-001|cloture|${premiere.compteNum}|${cleTiers(premiere)}`,
        });
      } else if (p.controleInfraAnnuel && debiteurs.length > 0) {
        let pire = debiteurs[0] as (typeof debiteurs)[number];
        for (const j of debiteurs) if (j.solde.greaterThan(pire.solde)) pire = j;
        constats.push({
          gravite: 'moyenne',
          titre: `Compte courant d’associé ${titulaire} débiteur en cours de période (à examiner)`,
          explication: `Solde débiteur ${debiteurs.length} jour(s) d’écriture, maximum ${montant2(pire.solde)} le ${pire.date}, résorbé à la clôture. ${rappel}`,
          actionProposee: 'Identifier le titulaire et la forme sociale ; sensibiliser le dirigeant, l’interdiction s’appréciant à tout moment.',
          montant: montant2(pire.solde),
          lignesConcernees: idsDe(pire.lignes, 100),
          preuves: [
            { libelle: 'Compte', valeur: `${titulaire} ${premiere.compAuxLib ?? premiere.compteLib}`.trim() },
            { libelle: 'Solde débiteur maximal', valeur: `${montant2(pire.solde)} le ${pire.date}` },
            { libelle: 'Solde de clôture (débit − crédit)', valeur: montant2(dernier.solde) },
          ],
          cle: `CAP-001|periode|${premiere.compteNum}|${cleTiers(premiere)}`,
        });
      }
    }
    return { statut: constats.length > 0 ? 'constat' : 'sans_anomalie', constats, mesures: { nbComptesExamines: String(parCompte.size) } };
  },
});
