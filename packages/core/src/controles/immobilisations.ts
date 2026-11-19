import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { dec } from '../montant.js';
import { SOURCES } from '../sources.js';
import {
  ZERO, aPrefixe, cleEcriture, debitDe, definir, grouper, idsDe, lignesJusquaCloture, mentionCloture, montant2, schemaMaxConstats, schemaMontantPositif,
  schemaPrefixes, soldeDe,
} from './outils.js';
import type { Constat, LigneEcriture } from './types.js';

const schemaPrefixesFacultatifs = z.array(z.string().regex(/^\d{1,12}$/, 'Préfixe de compte numérique attendu.'));

/** Racine d'un compte d'amortissement (zéros de droite retirés, 3 chiffres au moins) et racine du compte amorti (le « 8 » en moins). */
function racineBrute(compteAmortissement: string): string {
  const racine = compteAmortissement.replace(/0+$/, '').padEnd(3, '0');
  return `${racine.charAt(0)}${racine.slice(2)}`;
}

export const IMM_001 = definir({
  id: 'IMM-001',
  version: '1.0.0',
  cycle: 'immobilisations',
  titre: 'Cohérence immobilisations / amortissements',
  objectif: 'Repérer les amortissements sans immobilisation correspondante, les amortissements cumulés supérieurs à la valeur brute et les comptes d’amortissement de sens anormal.',
  perimetre: 'Comptes d’amortissement (28x) et comptes d’immobilisations amortissables correspondants (20x, 21x, 22x), soldes à la clôture, à-nouveaux compris.',
  donneesObligatoires: ['compteNum', 'debit', 'credit', 'ecritureDate'],
  logique:
    'Soldes par compte à la clôture (débit − crédit). Correspondance du PCG : le compte 28xyz amortit le compte 2xyz (280 ↔ 20, 281 ↔ 21, 2815 ↔ 215, 28183 ↔ 2183…). ' +
    'Pour chaque compte 28 soldé non nul, on cherche les comptes d’immobilisations commençant par la racine correspondante ; à défaut on remonte d’un chiffre à la fois jusqu’au compte à trois chiffres, niveau auquel le PCG établit la correspondance (28183 → 2183, puis 218). ' +
    '(1) Aucun compte d’immobilisation trouvé : constat « amortissement sans immobilisation ». (2) Au niveau de correspondance trouvé, si le cumul des amortissements (tous les comptes 28 relevant de ce niveau) ' +
    'dépasse la valeur brute (tous les comptes 2 de ce niveau) de plus de la tolérance : constat, montant = excédent. (3) Compte 28 à solde débiteur : constat de sens anormal.',
  schemaParametres: z.strictObject({
    prefixesAmortissements: schemaPrefixes,
    prefixesImmobilisations: schemaPrefixes,
    tolerance: schemaMontantPositif,
    maxConstats: schemaMaxConstats,
  }),
  parametresParDefaut: { prefixesAmortissements: ['28'], prefixesImmobilisations: ['20', '21', '22'], tolerance: '0.00', maxConstats: 200 },
  exceptions:
    'Les soldes ne sont justes que si les à-nouveaux figurent dans les écritures fournies : sans eux, un amortissement de l’exercice peut dépasser à tort une valeur brute incomplète. ' +
    'Une subdivision propre à l’entreprise qui ne suit pas la ventilation du PCG (amortissements et immobilisations numérotés différemment) donne des faux positifs. ' +
    'Les dépréciations (29x) et les immobilisations financières ou en cours (23x, 26x, 27x) ne sont pas examinées. Le contrôle ne vérifie ni les durées ni les dotations.',
  source: SOURCES.pcgAmortissements,
  resultatsAttendus: 'Chaque compte d’amortissement correspond à un compte d’immobilisation, pour un cumul créditeur inférieur ou égal à la valeur brute.',
  calcul(ctx, p) {
    const tolerance = dec(p.tolerance);
    const lignes = lignesJusquaCloture(ctx);
    const amortissements = grouper(lignes.filter((l) => aPrefixe(l.compteNum, p.prefixesAmortissements)), (l) => l.compteNum);
    const immobilisations = grouper(lignes.filter((l) => aPrefixe(l.compteNum, p.prefixesImmobilisations, p.prefixesAmortissements)), (l) => l.compteNum);
    if (amortissements.size === 0 && immobilisations.size === 0) {
      return { statut: 'non_applicable', motif: `Aucun compte d'immobilisation (${p.prefixesImmobilisations.join(', ')}) ni d'amortissement (${p.prefixesAmortissements.join(', ')}) dans les écritures fournies.` };
    }
    const constats: Constat[] = [];
    const niveaux = new Set<string>();
    const comptesAmortissement = [...amortissements.keys()].sort();
    for (const compte of comptesAmortissement) {
      const ls = amortissements.get(compte) ?? [];
      const solde = soldeDe(ls);
      if (solde.isZero()) continue;
      const libelle = `${compte} ${(ls[0] as LigneEcriture).compteLib}`.trim();
      if (solde.greaterThan(tolerance)) {
        constats.push({
          gravite: 'moyenne',
          titre: `Compte d'amortissement ${compte} débiteur ${mentionCloture(ctx)}`,
          explication: `Le compte ${compte} présente un solde débiteur de ${montant2(solde)} alors qu'un compte d'amortissement fonctionne en sens contraire des comptes d'immobilisations (PCG art. 1131-3) : son solde est créditeur ou nul.`,
          actionProposee: 'Vérifier les sorties d’immobilisations et les reprises d’amortissements ; corriger le sens ou l’imputation.',
          montant: montant2(solde),
          lignesConcernees: idsDe(ls),
          preuves: [{ libelle: 'Compte', valeur: libelle }, { libelle: 'Solde (débit − crédit)', valeur: montant2(solde) }],
          cle: `IMM-001|sens|${compte}`,
        });
      }
      const racine = racineBrute(compte);
      let niveau: string | null = null;
      for (let n = racine.length; n >= Math.min(3, racine.length) && niveau === null; n--) {
        const prefixe = racine.slice(0, n);
        if ([...immobilisations.keys()].some((c) => c.startsWith(prefixe))) niveau = prefixe;
      }
      if (niveau === null) {
        constats.push({
          gravite: 'elevee',
          titre: `Amortissements ${compte} sans immobilisation correspondante`,
          explication: `Le compte ${compte} est soldé de ${montant2(solde)} ${mentionCloture(ctx)} mais aucun compte d'immobilisation de racine ${racine} (ni de ses regroupements jusqu'à ${racine.slice(0, 3)}) n'est mouvementé dans les écritures fournies.`,
          actionProposee: 'Vérifier la reprise des à-nouveaux et l’imputation ; si l’immobilisation est sortie, solder ses amortissements.',
          montant: montant2(solde.abs()),
          lignesConcernees: idsDe(ls),
          preuves: [{ libelle: 'Compte d’amortissement', valeur: libelle }, { libelle: 'Racine d’immobilisation attendue', valeur: racine }, { libelle: 'Solde (débit − crédit)', valeur: montant2(solde) }],
          cle: `IMM-001|orphelin|${compte}`,
        });
      } else {
        niveaux.add(niveau);
      }
    }
    for (const niveau of [...niveaux].sort()) {
      const comptes28 = comptesAmortissement.filter((c) => racineBrute(c).startsWith(niveau));
      const lignes28 = comptes28.flatMap((c) => amortissements.get(c) ?? []);
      const comptes2 = [...immobilisations.keys()].filter((c) => c.startsWith(niveau)).sort();
      const cumul = soldeDe(lignes28).negated();
      const brut = soldeDe(comptes2.flatMap((c) => immobilisations.get(c) ?? []));
      const excedent = cumul.minus(brut);
      if (!excedent.greaterThan(tolerance)) continue;
      constats.push({
        gravite: 'elevee',
        titre: `Amortissements cumulés supérieurs à la valeur brute (immobilisations ${niveau})`,
        explication: `${mentionCloture(ctx).replace(/^./, (c) => c.toUpperCase())}, les amortissements cumulés des comptes ${comptes28.join(', ')} s'élèvent à ${montant2(cumul)} pour une valeur brute de ${montant2(brut)} sur les comptes ${comptes2.join(', ')} : excédent de ${montant2(excedent)}. Un bien ne peut pas être amorti au-delà de sa valeur brute.`,
        actionProposee: 'Rapprocher du tableau des immobilisations ; rechercher une sortie d’actif sans reprise des amortissements, une dotation en double ou une erreur de compte.',
        montant: montant2(excedent),
        lignesConcernees: idsDe(lignes28),
        preuves: [
          { libelle: 'Niveau de correspondance', valeur: niveau },
          { libelle: 'Valeur brute', valeur: montant2(brut) },
          { libelle: 'Amortissements cumulés', valeur: montant2(cumul) },
          { libelle: 'Excédent', valeur: montant2(excedent) },
        ],
        cle: `IMM-001|excedent|${niveau}`,
      });
    }
    return {
      statut: constats.length > 0 ? 'constat' : 'sans_anomalie',
      constats,
      mesures: { nbComptesAmortissement: String(amortissements.size), nbComptesImmobilisation: String(immobilisations.size) },
    };
  },
});

export const IMM_002 = definir({
  id: 'IMM-002',
  version: '1.0.0',
  cycle: 'immobilisations',
  titre: 'Charges potentiellement immobilisables (à examiner)',
  objectif: 'Signaler les achats passés en charges dont le montant unitaire dépasse le seuil de tolérance des biens de faible valeur, pour examen de leur inscription à l’actif.',
  perimetre: 'Lignes débitrices des comptes 60x et 61x (paramétrable), hors comptes exclus par défaut car sans rapport avec une immobilisation (achats stockés et de marchandises, énergie, sous-traitance, loyers, assurances…). Restent par défaut 605, 606 (hors 6061), 608 et 615.',
  donneesObligatoires: ['compteNum', 'debit', 'ecritureDate', 'journalCode', 'ecritureNum'],
  logique:
    'Chaque ligne débitrice d’un compte du périmètre dont le débit est STRICTEMENT supérieur au seuil (défaut 500,00, montant hors taxes : une charge est comptabilisée hors TVA récupérable) produit un constat « à examiner », montant = débit de la ligne. ' +
    'Le seuil par défaut est celui de la tolérance administrative des biens de faible valeur (500 € HT par bien, BOI-BIC-CHG-20-30-10). Les lignes des journaux d’à-nouveaux sont ignorées.',
  schemaParametres: z.strictObject({
    prefixesComptes: schemaPrefixes,
    prefixesExclus: schemaPrefixesFacultatifs,
    seuil: schemaMontantPositif,
    journauxANouveaux: z.array(z.string().min(1).max(20)),
    maxConstats: schemaMaxConstats,
  }),
  parametresParDefaut: {
    prefixesComptes: ['60', '61'],
    prefixesExclus: ['601', '602', '603', '604', '6061', '607', '609', '611', '612', '613', '614', '616', '617', '618', '619'],
    seuil: '500.00',
    journauxANouveaux: ['AN', 'ANO', 'RAN'],
    maxConstats: 200,
  },
  exceptions:
    'Le FEC ne donne pas le prix unitaire : une ligne peut regrouper plusieurs biens dont chacun est sous le seuil, ou concerner une dépense non immobilisable (consommables, entretien courant). ' +
    'La tolérance fiscale ne vise que les matériels et outillages, les matériels et mobiliers de bureau et les logiciels ; elle ne s’applique pas aux biens qui sont l’objet même de l’activité. ' +
    'Si la TVA n’est pas récupérable, la charge est comptabilisée TTC alors que le seuil s’entend hors taxes. Constat d’examen, non d’anomalie.',
  source: SOURCES.bofipBiensFaibleValeur,
  resultatsAttendus: 'Aucune ligne de charge du périmètre au-delà du seuil, ou des lignes justifiées (dépense non immobilisable, lot de biens de faible valeur).',
  calcul(ctx, p) {
    const seuil = dec(p.seuil);
    const lignes = lignesJusquaCloture(ctx).filter((l) => aPrefixe(l.compteNum, p.prefixesComptes, p.prefixesExclus) && !p.journauxANouveaux.includes(l.journalCode));
    if (lignes.length === 0) return { statut: 'non_applicable', motif: `Aucune ligne de charge du périmètre (${p.prefixesComptes.join(', ')}, hors exclusions) dans les écritures fournies.` };
    const constats: Constat[] = [];
    const occurrences = new Map<string, number>();
    let total: Decimal = ZERO;
    for (const l of lignes) {
      const debit = debitDe(l);
      if (!debit.greaterThan(seuil)) continue;
      const base = `IMM-002|${cleEcriture(l).replace('\u0001', '|')}|${l.compteNum}|${montant2(debit)}`;
      const n = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, n);
      total = total.plus(debit);
      constats.push({
        gravite: 'faible',
        titre: `Charge de ${montant2(debit)} au compte ${l.compteNum} : immobilisation à examiner`,
        explication: `La ligne débite le compte ${l.compteNum} de ${montant2(debit)}, au-delà du seuil de ${montant2(seuil)} hors taxes par bien en deçà duquel l'administration admet la déduction immédiate des biens de faible valeur. Si la dépense porte sur un bien durable, elle est à inscrire à l'actif.`,
        actionProposee: 'Consulter la pièce : nature du bien, prix unitaire hors taxes, durée d’utilisation ; reclasser en immobilisation le cas échéant.',
        montant: montant2(debit),
        lignesConcernees: [l.id],
        preuves: [
          { libelle: 'Écriture', valeur: `${l.journalCode} ${l.ecritureNum} du ${l.ecritureDate}` },
          { libelle: 'Compte', valeur: `${l.compteNum} ${l.compteLib}`.trim() },
          { libelle: 'Pièce', valeur: l.pieceRef },
          { libelle: 'Seuil appliqué (HT)', valeur: montant2(seuil) },
        ],
        cle: n === 1 ? base : `${base}|${n}`,
      });
    }
    return { statut: constats.length > 0 ? 'constat' : 'sans_anomalie', constats, mesures: { nbLignesExaminees: String(lignes.length), totalAuDessusDuSeuil: montant2(total) } };
  },
});
