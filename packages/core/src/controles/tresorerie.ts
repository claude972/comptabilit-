import { z } from 'zod';
import { dec } from '../montant.js';
import { SOURCES, sourceInterne } from '../sources.js';
import type { Decimal } from 'decimal.js';
import { parGroupes } from './flux.js';
import {
  Agregat, CollecteurConstats, JoursDeCompte, aPrefixe, agreger, agregerParJour, definir, jusquaCloture, lignesJusquaCloture, mentionCloture, montant2,
  schemaMaxConstats, schemaMontantPositif, schemaPrefixes,
} from './outils.js';
import type { Constat, LigneEcriture } from './types.js';

const MOTIF_AUCUNE_CAISSE = 'Aucun compte de caisse (53) mouvementé dans les écritures fournies.';

function constatCaisse(compte: string, j: JoursDeCompte, seuil: Decimal): Constat | null {
  const crediteurs = j.jours().filter((x) => x.solde.negated().greaterThan(seuil));
  const premier = crediteurs[0];
  if (premier === undefined) return null;
  let pire = premier;
  for (const x of crediteurs) if (x.solde.lessThan(pire.solde)) pire = x;
  return {
    gravite: 'elevee',
    titre: `Caisse ${compte} créditrice à compter du ${premier.date}`,
    explication:
      `Le solde de fin de journée du compte ${compte} est créditeur ${crediteurs.length} jour(s) ; maximum créditeur de ${montant2(pire.solde.abs())} le ${pire.date}. ` +
      'Le solde d’un compte de caisse est soit débiteur soit nul (PCG art. 1215-53).',
    actionProposee: 'Rechercher les recettes non enregistrées, les apports non comptabilisés ou les erreurs de date ; régulariser.',
    montant: montant2(pire.solde.abs()),
    lignesConcernees: premier.ids,
    preuves: [
      { libelle: 'Compte', valeur: `${compte} ${j.ensemble.tete.compteLib}`.trim() },
      { libelle: 'Première date créditrice', valeur: premier.date },
      { libelle: 'Solde à cette date', valeur: montant2(premier.solde) },
      { libelle: 'Solde créditeur maximal', valeur: `${montant2(pire.solde)} le ${pire.date}` },
      { libelle: 'Jours créditeurs', valeur: String(crediteurs.length) },
    ],
    cle: `TRE-001|${compte}`,
  };
}

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
  calculGrosVolume:
    'Flux, état borné. Un passage groupé par compte, restreint aux comptes de caisse : un compte à la fois, avec un mouvement par jour d’écriture.',
  calcul(ctx, p) {
    const seuil = dec(p.seuil);
    const lignes = ctx.lignes.filter((l) => aPrefixe(l.compteNum, p.prefixesComptes));
    if (lignes.length === 0) return { statut: 'non_applicable', motif: MOTIF_AUCUNE_CAISSE };
    const constats: Constat[] = [];
    const parCompte = agregerParJour(lignes, (l) => l.compteNum);
    for (const [compte, j] of parCompte) {
      const c = constatCaisse(compte, j, seuil);
      if (c !== null) constats.push(c);
    }
    return { statut: constats.length > 0 ? 'constat' : 'sans_anomalie', constats, mesures: { nbComptesExamines: String(parCompte.size) } };
  },
  async calculFlux(ctx, p) {
    const seuil = dec(p.seuil);
    const constats = new CollecteurConstats(p);
    let nbComptes = 0;
    const retenue = (l: LigneEcriture): boolean => aPrefixe(l.compteNum, p.prefixesComptes);
    for await (const j of parGroupes(ctx.source.parcourir({ ordre: 'compte', prefixesComptes: p.prefixesComptes }), (l) => l.compteNum, () => new JoursDeCompte(), (g, l) => g.ajouter(l), retenue)) {
      nbComptes++;
      constats.ajouter(constatCaisse(j.ensemble.tete.compteNum, j, seuil));
    }
    if (nbComptes === 0) return { statut: 'non_applicable', motif: MOTIF_AUCUNE_CAISSE };
    return { ...constats.conclure(), mesures: { nbComptesExamines: String(nbComptes) } };
  },
});

const MOTIF_AUCUNE_BANQUE = 'Aucun compte de banque (512) mouvementé dans les écritures fournies.';

function constatBanqueCreditrice(compte: string, a: Agregat, ctx: { exercice: { fin: string } | null }, seuil: Decimal): Constat | null {
  const solde = a.solde;
  if (!solde.negated().greaterThan(seuil)) return null;
  return {
    gravite: 'faible',
    titre: `Banque ${compte} créditrice ${mentionCloture(ctx)} (à examiner)`,
    explication: `Solde créditeur de ${montant2(solde.abs())}. Situation possible (découvert) mais à examiner : présentation au passif sans compensation avec les banques débitrices, rapprochement bancaire.`,
    actionProposee: 'Vérifier le rapprochement bancaire et l’autorisation de découvert ; contrôler la présentation au bilan.',
    montant: montant2(solde.abs()),
    lignesConcernees: [],
    preuves: [
      { libelle: 'Compte', valeur: `${compte} ${a.tete.compteLib}`.trim() },
      { libelle: 'Solde (débit − crédit)', valeur: montant2(solde) },
    ],
    cle: `TRE-002|${compte}`,
  };
}

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
  calculGrosVolume:
    'Flux, état borné. Un passage groupé par compte, restreint aux comptes de banque : un compte à la fois.',
  calcul(ctx, p) {
    const seuil = dec(p.seuil);
    const lignes = lignesJusquaCloture(ctx).filter((l) => aPrefixe(l.compteNum, p.prefixesComptes));
    if (lignes.length === 0) return { statut: 'non_applicable', motif: MOTIF_AUCUNE_BANQUE };
    const constats: Constat[] = [];
    const parCompte = agreger(lignes, (l) => l.compteNum);
    for (const [compte, a] of parCompte) {
      const c = constatBanqueCreditrice(compte, a, ctx, seuil);
      if (c !== null) constats.push(c);
    }
    return { statut: constats.length > 0 ? 'constat' : 'sans_anomalie', constats, mesures: { nbComptesExamines: String(parCompte.size) } };
  },
  async calculFlux(ctx, p) {
    const seuil = dec(p.seuil);
    const constats = new CollecteurConstats(p);
    let nbComptes = 0;
    const avantCloture = jusquaCloture(ctx);
    const retenue = (l: LigneEcriture): boolean => avantCloture(l) && aPrefixe(l.compteNum, p.prefixesComptes);
    for await (const a of parGroupes(ctx.source.parcourir({ ordre: 'compte', prefixesComptes: p.prefixesComptes }), (l) => l.compteNum, () => new Agregat(), (g, l) => g.ajouter(l), retenue)) {
      nbComptes++;
      constats.ajouter(constatBanqueCreditrice(a.tete.compteNum, a, ctx, seuil));
    }
    if (nbComptes === 0) return { statut: 'non_applicable', motif: MOTIF_AUCUNE_BANQUE };
    return { ...constats.conclure(), mesures: { nbComptesExamines: String(nbComptes) } };
  },
});
