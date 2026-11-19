import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { ecartEnJours } from '../dates.js';
import { dec } from '../montant.js';
import { SOURCES, sourceInterne } from '../sources.js';
import { ZERO, aPrefixe, cleEcriture, creditDe, debitDe, definir, grouper, idsDe, montant2, schemaMaxConstats, schemaMontantPositif, schemaPrefixes, soldeDe } from './outils.js';
import type { Constat, LigneEcriture } from './types.js';

const schemaJournaux = z.array(z.string().min(1).max(20));

export const CLO_001 = definir({
  id: 'CLO-001',
  version: '1.0.0',
  cycle: 'cloture',
  titre: 'Césure : pièces datées hors de l’exercice (à examiner)',
  objectif: 'Repérer les charges et produits dont la date de pièce et la date d’écriture ne tombent pas dans le même exercice, indice d’un rattachement à examiner (charge ou produit de l’exercice voisin, charge à payer, produit constaté d’avance…).',
  perimetre: 'Lignes des comptes de charges et de produits (classes 6 et 7, paramétrable) portant une date de pièce.',
  donneesObligatoires: ['compteNum', 'ecritureDate', 'pieceDate', 'debit', 'credit', 'exercice'],
  logique:
    'Pour chaque ligne du périmètre dont la date de pièce est connue : la date d’écriture est-elle dans l’exercice ? la date de pièce l’est-elle ? Si l’une l’est et l’autre non, et que la date hors exercice ' +
    's’écarte de la borne franchie (ouverture ou clôture) de plus de `toleranceJours` jours, l’écriture est retenue. Un constat « à examiner » par écriture (journal + numéro), montant = somme des débits et crédits des lignes concernées.',
  schemaParametres: z.strictObject({ prefixesComptes: schemaPrefixes, toleranceJours: z.number().int().min(0).max(366), seuil: schemaMontantPositif, maxConstats: schemaMaxConstats }),
  parametresParDefaut: { prefixesComptes: ['6', '7'], toleranceJours: 0, seuil: '0.00', maxConstats: 200 },
  exceptions:
    'Une facture datée de l’exercice précédent mais reçue et comptabilisée dans l’exercice, compensée par l’extourne d’une charge à payer, est une situation normale : le contrôle signale, il ne conclut pas. ' +
    'La date de pièce d’un FEC est parfois recopiée de la date d’écriture (aucun constat possible) ou absente (lignes décomptées, non examinées). Les écritures d’inventaire (FNP, FAE, CCA, PCA) ne sont pas reconstituées.',
  source: sourceInterne(
    'Convention de cabinet (examen de la césure des charges et produits). Contexte : PCG art. 112-3 (le compte de résultat récapitule les charges et produits de l’exercice, sans tenir compte de leur date de paiement ou d’encaissement), consulté le 2026-11-19.',
  ),
  resultatsAttendus: 'Dates de pièce et d’écriture dans le même exercice, ou écarts justifiés par les écritures d’inventaire.',
  calcul(ctx, p) {
    const exercice = ctx.exercice;
    if (exercice === null) return { statut: 'non_realise', motif: 'Exercice non précisé : la césure ne peut pas être examinée.' };
    const seuil = dec(p.seuil);
    const lignes = ctx.lignes.filter((l) => aPrefixe(l.compteNum, p.prefixesComptes));
    if (lignes.length === 0) return { statut: 'non_applicable', motif: `Aucune ligne de charge ou de produit (${p.prefixesComptes.join(', ')}) dans les écritures fournies.` };
    const datees = lignes.filter((l) => l.pieceDate !== null);
    const mesures: Record<string, string> = { nbLignesExaminees: String(datees.length), nbLignesSansDatePiece: String(lignes.length - datees.length) };
    if (datees.length === 0) return { statut: 'non_realise', motif: 'Aucune ligne de charge ou de produit ne porte de date de pièce : césure non examinable.', mesures };
    const dans = (d: string): boolean => d >= exercice.debut && d <= exercice.fin;
    const ecartHors = (d: string): number => (d < exercice.debut ? ecartEnJours(d, exercice.debut) : ecartEnJours(exercice.fin, d));
    const retenues = datees.filter((l) => {
      const piece = l.pieceDate as string;
      const ecritureDans = dans(l.ecritureDate);
      const pieceDans = dans(piece);
      if (ecritureDans === pieceDans) return false;
      return ecartHors(pieceDans ? l.ecritureDate : piece) > p.toleranceJours;
    });
    const constats: Constat[] = [];
    for (const ls of grouper(retenues, cleEcriture).values()) {
      const premiere = ls[0] as LigneEcriture;
      let montant: Decimal = ZERO;
      for (const l of ls) montant = montant.plus(debitDe(l)).plus(creditDe(l));
      if (!montant.greaterThan(seuil)) continue;
      const piece = premiere.pieceDate as string;
      const pieceDans = dans(piece);
      const position = (d: string): string => (d < exercice.debut ? 'antérieure à l’ouverture' : 'postérieure à la clôture');
      constats.push({
        gravite: 'moyenne',
        titre: pieceDans
          ? `Écriture du ${premiere.ecritureDate} hors exercice pour une pièce du ${piece} (à examiner)`
          : `Pièce du ${piece} ${position(piece)} pour une écriture du ${premiere.ecritureDate} (à examiner)`,
        explication:
          `L'écriture ${premiere.journalCode} ${premiere.ecritureNum} mouvemente des comptes de charges ou de produits pour ${montant2(montant)} ; sa date d'écriture (${premiere.ecritureDate}) et sa date de pièce (${piece}) ` +
          `ne tombent pas dans le même exercice (${exercice.debut} au ${exercice.fin}). Le rattachement à l'exercice est à examiner.`,
        actionProposee: 'Consulter la pièce : période de la prestation ou date de livraison ; constater s’il y a lieu une charge à payer, un produit à recevoir ou une charge/un produit constaté d’avance.',
        montant: montant2(montant),
        lignesConcernees: idsDe(ls),
        preuves: [
          { libelle: 'Écriture', valeur: `${premiere.journalCode} ${premiere.ecritureNum}` },
          { libelle: 'Date d’écriture', valeur: premiere.ecritureDate },
          { libelle: 'Date de pièce', valeur: piece },
          { libelle: 'Pièce', valeur: premiere.pieceRef },
          { libelle: 'Tolérance (jours)', valeur: String(p.toleranceJours) },
        ],
        cle: `CLO-001|${premiere.journalCode}|${premiere.ecritureNum}|${premiere.ecritureDate}|${piece}`,
      });
    }
    const motif = lignes.length > datees.length ? `${lignes.length - datees.length} ligne(s) de charge ou de produit sans date de pièce n'ont pas pu être examinées.` : null;
    return { statut: constats.length > 0 ? 'constat' : 'sans_anomalie', motif, constats, mesures };
  },
});

export const CLO_002 = definir({
  id: 'CLO-002',
  version: '1.0.0',
  cycle: 'cloture',
  titre: 'Cohérence entre exercices : à-nouveaux et soldes de clôture N-1',
  objectif: 'Vérifier que les à-nouveaux de l’exercice reprennent exactement les soldes de clôture des comptes de bilan de l’exercice précédent.',
  perimetre: 'Comptes de bilan (classes 1 à 5, paramétrable) : soldes de toutes les écritures N-1 fournies, comparés aux lignes du ou des journaux d’à-nouveaux de l’exercice N.',
  donneesObligatoires: ['compteNum', 'debit', 'credit', 'journalCode', 'exercicePrecedent'],
  logique:
    'Solde de clôture N-1 = Σ (débit − crédit) par numéro de compte sur les écritures de `exercicePrecedent`. À-nouveau N = Σ (débit − crédit) par numéro de compte des lignes dont le journal figure dans `journauxANouveaux`. ' +
    'Les comptes de résultat de bilan (préfixes `prefixesResultat`, défaut 12) sont comparés en bloc : leur à-nouveau doit égaler leur solde N-1 augmenté du solde des comptes de classes 6 et 7 de N-1 ' +
    '(résultat non encore viré si le FEC N-1 est fourni avant écritures de clôture). Tout écart supérieur à la tolérance produit un constat par compte, montant = valeur absolue de l’écart.',
  schemaParametres: z.strictObject({
    journauxANouveaux: schemaJournaux.min(1),
    prefixesBilan: schemaPrefixes,
    prefixesResultat: schemaPrefixes,
    prefixesGestion: schemaPrefixes,
    tolerance: schemaMontantPositif,
    maxConstats: schemaMaxConstats,
  }),
  parametresParDefaut: { journauxANouveaux: ['AN', 'ANO', 'RAN'], prefixesBilan: ['1', '2', '3', '4', '5'], prefixesResultat: ['12'], prefixesGestion: ['6', '7'], tolerance: '0.00', maxConstats: 200 },
  exceptions:
    'La comparaison se fait par numéro de compte général : un changement de plan de comptes ou de longueur de numéros entre les deux exercices produit des écarts de pure forme. ' +
    'Une affectation du résultat ou des reclassements passés directement dans le journal d’à-nouveaux produisent des écarts à justifier. ' +
    'Si le journal d’à-nouveaux porte un autre code que ceux paramétrés, le contrôle n’est pas réalisé. Les à-nouveaux détaillés par pièce sont additionnés par compte.',
  source: SOURCES.pcgBilanOuverture,
  resultatsAttendus: 'Pour chaque compte de bilan, à-nouveau N égal au solde de clôture N-1.',
  calcul(ctx, p) {
    const precedent = ctx.exercicePrecedent?.lignes;
    if (precedent === undefined || precedent === null || precedent.length === 0) {
      return { statut: 'non_realise', motif: 'Écritures de l’exercice précédent non fournies : la reprise des à-nouveaux ne peut pas être vérifiée.' };
    }
    const tolerance = dec(p.tolerance);
    const aNouveaux = ctx.lignes.filter((l) => p.journauxANouveaux.includes(l.journalCode));
    if (aNouveaux.length === 0) {
      return { statut: 'non_realise', motif: `Aucune ligne dans les journaux d'à-nouveaux paramétrés (${p.journauxANouveaux.join(', ')}) : identifier le journal d'à-nouveaux pour réaliser le contrôle.` };
    }
    const estResultat = (c: string): boolean => aPrefixe(c, p.prefixesResultat);
    const estBilan = (c: string): boolean => aPrefixe(c, p.prefixesBilan);
    const CLE_RESULTAT = `résultat (${p.prefixesResultat.join(', ')})`;
    const cle = (l: LigneEcriture): string => (estResultat(l.compteNum) ? CLE_RESULTAT : l.compteNum);
    const cloture = grouper(precedent.filter((l) => estBilan(l.compteNum)), cle);
    const ouverture = grouper(aNouveaux.filter((l) => estBilan(l.compteNum)), cle);
    const resultatNonVire = soldeDe(precedent.filter((l) => aPrefixe(l.compteNum, p.prefixesGestion)));
    const horsBilan = aNouveaux.filter((l) => !estBilan(l.compteNum));
    const constats: Constat[] = [];
    const comptes = [...new Set([...cloture.keys(), ...ouverture.keys()])].sort();
    let nbCompares = 0;
    for (const compte of comptes) {
      const lignesOuverture = ouverture.get(compte) ?? [];
      const soldeCloture = soldeDe(cloture.get(compte) ?? []).plus(compte === CLE_RESULTAT ? resultatNonVire : ZERO);
      const soldeOuverture = soldeDe(lignesOuverture);
      nbCompares++;
      const ecart = soldeOuverture.minus(soldeCloture);
      if (!ecart.abs().greaterThan(tolerance)) continue;
      constats.push({
        gravite: 'elevee',
        titre: `À-nouveau du compte ${compte} différent du solde de clôture N-1 (écart ${montant2(ecart)})`,
        explication: `Le solde de clôture N-1 du compte ${compte} est de ${montant2(soldeCloture)} (débit − crédit) alors que l'à-nouveau repris est de ${montant2(soldeOuverture)}. Le bilan d'ouverture doit correspondre au bilan de clôture de l'exercice précédent (PCG art. 112-2).`,
        actionProposee: 'Rapprocher la balance de clôture N-1 de la balance d’ouverture N ; rechercher une écriture N-1 passée après la génération des à-nouveaux ou une reprise incomplète.',
        montant: montant2(ecart.abs()),
        lignesConcernees: idsDe(lignesOuverture),
        preuves: [
          { libelle: 'Compte', valeur: compte },
          { libelle: 'Solde de clôture N-1 (débit − crédit)', valeur: montant2(soldeCloture) },
          { libelle: 'À-nouveau N (débit − crédit)', valeur: montant2(soldeOuverture) },
          ...(compte === CLE_RESULTAT ? [{ libelle: 'Dont résultat N-1 non viré (classes 6 et 7)', valeur: montant2(resultatNonVire) }] : []),
        ],
        cle: `CLO-002|${compte}`,
      });
    }
    if (horsBilan.length > 0) {
      const total = horsBilan.reduce((s, l) => s.plus(debitDe(l)).plus(creditDe(l)), ZERO);
      constats.push({
        gravite: 'moyenne',
        titre: 'Journal d’à-nouveaux mouvementant des comptes hors bilan',
        explication: `${horsBilan.length} ligne(s) du journal d'à-nouveaux portent sur des comptes hors des classes de bilan (${p.prefixesBilan.join(', ')}) : seuls les comptes de bilan se reportent d'un exercice à l'autre.`,
        actionProposee: 'Vérifier le paramétrage du journal d’à-nouveaux et reclasser les écritures qui n’en sont pas.',
        montant: montant2(total),
        lignesConcernees: idsDe(horsBilan),
        preuves: [{ libelle: 'Comptes concernés', valeur: [...new Set(horsBilan.map((l) => l.compteNum))].sort().slice(0, 20).join(', ') }],
        cle: 'CLO-002|hors_bilan',
      });
    }
    return {
      statut: constats.length > 0 ? 'constat' : 'sans_anomalie',
      constats,
      mesures: { nbComptesCompares: String(nbCompares), nbLignesANouveaux: String(aNouveaux.length), resultatN1NonVire: montant2(resultatNonVire) },
    };
  },
});
