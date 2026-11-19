import { z } from 'zod';
import { dec } from '../montant.js';
import { SOURCES, sourceInterne } from '../sources.js';
import {
  aPrefixe, definir, grouper, idsDe, lignesJusquaCloture, mentionCloture, montant2, schemaMaxConstats, schemaMontantPositif,
  schemaPrefixes, soldeDe, soldesFinDeJour,
} from './outils.js';
import type { Constat, LigneEcriture } from './types.js';

export const TRE_001 = definir({
  id: 'TRE-001',
  version: '1.0.0',
  cycle: 'tresorerie',
  titre: 'Caisse créditrice',
  objectif: 'Détecter un solde de caisse créditeur à une date quelconque : une caisse ne peut pas contenir un montant négatif d’espèces.',
  perimetre: 'Comptes dont le numéro commence par 53 (paramétrable), chacun suivi séparément.',
  donneesObligatoires: ['compteNum', 'ecritureDate', 'debit', 'credit'],
  logique:
    'Pour chaque compte de caisse, les lignes sont classées par date d’écriture et le solde cumulé (débit − crédit) est calculé à la fin de chaque journée ' +
    '(l’ordre des opérations au sein d’une journée n’est pas connu dans un FEC). Un solde de fin de journée inférieur à −seuil produit un constat par compte, ' +
    'avec la première date créditrice, le nombre de jours créditeurs et le solde créditeur maximal (montant du constat). ' +
    'Toutes les lignes fournies sont prises en compte, y compris les à-nouveaux.',
  schemaParametres: z.strictObject({ prefixesComptes: schemaPrefixes, seuil: schemaMontantPositif, maxConstats: schemaMaxConstats }),
  parametresParDefaut: { prefixesComptes: ['53'], seuil: '0.00', maxConstats: 200 },
  exceptions:
    'Un solde créditeur en cours de journée, résorbé le jour même, n’est pas détecté. Si les à-nouveaux ne figurent pas dans les écritures fournies, le solde calculé part de zéro et le contrôle peut produire de faux positifs. ' +
    'Des écritures de caisse centralisées en fin de mois peuvent masquer ou créer des positions créditrices.',
  source: SOURCES.pcgCaisse,
  resultatsAttendus: 'Solde de caisse débiteur ou nul à chaque fin de journée.',
  calcul(ctx, p) {
    const seuil = dec(p.seuil);
    const lignes = ctx.lignes.filter((l) => aPrefixe(l.compteNum, p.prefixesComptes));
    if (lignes.length === 0) return { statut: 'non_applicable', motif: 'Aucun compte de caisse (53) mouvementé dans les écritures fournies.' };
    const constats: Constat[] = [];
    const parCompte = grouper(lignes, (l) => l.compteNum);
    for (const [compte, ls] of parCompte) {
      const jours = soldesFinDeJour(ls);
      const crediteurs = jours.filter((j) => j.solde.negated().greaterThan(seuil));
      const premier = crediteurs[0];
      if (premier === undefined) continue;
      let pire = premier;
      for (const j of crediteurs) if (j.solde.lessThan(pire.solde)) pire = j;
      constats.push({
        gravite: 'elevee',
        titre: `Caisse ${compte} créditrice à compter du ${premier.date}`,
        explication:
          `Le solde de fin de journée du compte ${compte} est créditeur ${crediteurs.length} jour(s) ; maximum créditeur de ${montant2(pire.solde.abs())} le ${pire.date}. ` +
          'Le solde d’un compte de caisse est soit débiteur soit nul (PCG art. 1215-53).',
        actionProposee: 'Rechercher les recettes non enregistrées, les apports non comptabilisés ou les erreurs de date ; régulariser.',
        montant: montant2(pire.solde.abs()),
        lignesConcernees: idsDe(premier.lignes, 100),
        preuves: [
          { libelle: 'Compte', valeur: `${compte} ${(ls[0] as LigneEcriture).compteLib}`.trim() },
          { libelle: 'Première date créditrice', valeur: premier.date },
          { libelle: 'Solde à cette date', valeur: montant2(premier.solde) },
          { libelle: 'Solde créditeur maximal', valeur: `${montant2(pire.solde)} le ${pire.date}` },
          { libelle: 'Jours créditeurs', valeur: String(crediteurs.length) },
        ],
        cle: `TRE-001|${compte}`,
      });
    }
    return { statut: constats.length > 0 ? 'constat' : 'sans_anomalie', constats, mesures: { nbComptesExamines: String(parCompte.size) } };
  },
});

export const TRE_002 = definir({
  id: 'TRE-002',
  version: '1.0.0',
  cycle: 'tresorerie',
  titre: 'Banques : solde créditeur à la clôture',
  objectif: 'Signaler les comptes de banque créditeurs à la clôture pour examen (découvert, présentation au passif, erreur de sens).',
  perimetre: 'Comptes dont le numéro commence par 512 (paramétrable), chacun suivi séparément.',
  donneesObligatoires: ['compteNum', 'debit', 'credit', 'ecritureDate'],
  logique:
    'Solde = Σ débit − Σ crédit par numéro de compte sur les lignes datées jusqu’à la clôture (toutes si l’exercice est inconnu). ' +
    'Un solde créditeur supérieur au seuil produit un constat « à examiner » : ce n’est pas une anomalie en soi.',
  schemaParametres: z.strictObject({ prefixesComptes: schemaPrefixes, seuil: schemaMontantPositif, maxConstats: schemaMaxConstats }),
  parametresParDefaut: { prefixesComptes: ['512'], seuil: '0.00', maxConstats: 200 },
  exceptions: 'Un découvert autorisé est une situation normale. Le solde comptable n’est pas le solde bancaire : ce contrôle ne remplace pas le rapprochement bancaire.',
  source: sourceInterne(
    'Convention de cabinet (point d’attention de présentation). Contexte : PCG art. 1215-51, pas de compensation entre comptes de banque créditeurs et débiteurs.',
  ),
  resultatsAttendus: 'Constat informatif pour chaque banque créditrice ; à rapprocher de l’autorisation de découvert et du relevé.',
  calcul(ctx, p) {
    const seuil = dec(p.seuil);
    const lignes = lignesJusquaCloture(ctx).filter((l) => aPrefixe(l.compteNum, p.prefixesComptes));
    if (lignes.length === 0) return { statut: 'non_applicable', motif: 'Aucun compte de banque (512) mouvementé dans les écritures fournies.' };
    const constats: Constat[] = [];
    const parCompte = grouper(lignes, (l) => l.compteNum);
    for (const [compte, ls] of parCompte) {
      const solde = soldeDe(ls);
      if (!solde.negated().greaterThan(seuil)) continue;
      constats.push({
        gravite: 'faible',
        titre: `Banque ${compte} créditrice ${mentionCloture(ctx)} (à examiner)`,
        explication: `Solde créditeur de ${montant2(solde.abs())}. Situation possible (découvert) mais à examiner : présentation au passif sans compensation avec les banques débitrices, rapprochement bancaire.`,
        actionProposee: 'Vérifier le rapprochement bancaire et l’autorisation de découvert ; contrôler la présentation au bilan.',
        montant: montant2(solde.abs()),
        lignesConcernees: [],
        preuves: [
          { libelle: 'Compte', valeur: `${compte} ${(ls[0] as LigneEcriture).compteLib}`.trim() },
          { libelle: 'Solde (débit − crédit)', valeur: montant2(solde) },
        ],
        cle: `TRE-002|${compte}`,
      });
    }
    return { statut: constats.length > 0 ? 'constat' : 'sans_anomalie', constats, mesures: { nbComptesExamines: String(parCompte.size) } };
  },
});
