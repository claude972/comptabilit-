/**
 * Indicateurs de performance d'un dossier : AIDE À LA REVUE, jamais un diagnostic.
 *
 *  - Tout est calculé en `Decimal` ; les valeurs sont rendues en chaînes (euros 2 décimales, jours 1, pourcentage 2, ratio 2).
 *  - Un indicateur dont une donnée manque rend `valeur: null`, `statut: 'non_calculable'` et un motif précis : jamais un zéro par défaut.
 *  - Chaque valeur restitue les comptes (numéro, solde retenu, sens) qui la composent.
 *  - Les libellés d'écritures et de comptes ne sont jamais lus.
 *  - Les formules visent le plan de comptes en vigueur pour les exercices ouverts à compter du 1er janvier 2025.
 */
import { Decimal } from 'decimal.js';
import type { LigneEcriture, SourceRegle } from '../controles/types.js';
import { dateCivileValide, ecartEnJours, estDateIso, isoDepuisJours, joursDepuisEpoque, versIso } from '../dates.js';
import { calculerBalance } from '../etats/balance.js';
import { CORRESPONDANCE_PCG, correspondancePour } from '../etats/correspondance.js';
import { projeterCompteDeResultat } from '../etats/projection.js';
import { DATE_APPLICATION_REGLEMENT_2022_06, SOURCES_ETATS } from '../etats/sources.js';
import type { Balance, CorrespondanceRubriques, EtatProjet } from '../etats/types.js';
import { dec, estChaineDecimale, versChaine } from '../montant.js';
import type { ComposanteIndicateur, ContexteIndicateurs, DefinitionIndicateur, OptionsIndicateurs, ValeurIndicateur } from './types.js';

const ZERO = new Decimal(0);
const CENT = new Decimal(100);

/** Au-delà de ce nombre de jours entre la dernière écriture et la clôture, l'exercice est signalé comme vraisemblablement incomplet (seuil interne). */
export const SEUIL_JOURS_SANS_ECRITURE_AVANT_CLOTURE = 45;
/** Seuil interne par défaut du signal « dettes fiscales et sociales en forte hausse », en pourcentage. */
export const SEUIL_HAUSSE_DETTES_FISCALES_SOCIALES_PAR_DEFAUT = '30';

const ECHELLES: Record<DefinitionIndicateur['unite'], number> = { euros: 2, jours: 1, pourcentage: 2, ratio: 2 };

// --- Agrégats de soldes -------------------------------------------------------

interface Comp {
  libelle: string;
  /** +1 : s'ajoute à la valeur ; −1 : s'en retranche. */
  poids: 1 | -1;
  /** Montant dans le sens naturel de la composante (toujours « positif = normal »). */
  montant: Decimal;
  comptes: Array<{ compteNum: string; montant: Decimal }>;
  /** Au moins un compte de la balance correspond aux préfixes (quel que soit son solde). */
  present: boolean;
}

interface Base {
  exercice: { debut: string; fin: string };
  nbJours: number;
  balance: Balance;
  /** Solde débiteur net (débit − crédit) par compte. */
  soldes: Array<{ compteNum: string; solde: Decimal }>;
  correspondance: CorrespondanceRubriques | null;
  compteDeResultat: EtatProjet | null;
  /** Mentions valables pour tous les indicateurs. */
  mentionsGenerales: string[];
  /** Mentions propres aux indicateurs en jours, en taux et en ratio. */
  mentionsDuree: string[];
  taux: { ventes: Decimal | null; achats: Decimal | null; motifVentes: string | null; motifAchats: string | null };
  seuilDfs: Decimal;
}

type Sens = 'debiteur' | 'crediteur' | 'tous';

function agreger(b: Base, poids: 1 | -1, libelle: string, nature: 'debit' | 'credit', prefixes: readonly string[], sauf: readonly string[] = [], sens: Sens = 'tous'): Comp {
  const comp: Comp = { libelle, poids, montant: ZERO, comptes: [], present: false };
  for (const { compteNum, solde } of b.soldes) {
    if (!prefixes.some((p) => compteNum.startsWith(p)) || sauf.some((p) => compteNum.startsWith(p))) continue;
    comp.present = true;
    if (solde.isZero()) continue;
    if (sens === 'debiteur' && solde.isNegative()) continue;
    if (sens === 'crediteur' && !solde.isNegative()) continue;
    const montant = nature === 'debit' ? solde : solde.negated();
    comp.montant = comp.montant.plus(montant);
    comp.comptes.push({ compteNum, montant });
  }
  return comp;
}

const total = (comps: readonly Comp[]): Decimal => comps.reduce((s, c) => (c.poids === 1 ? s.plus(c.montant) : s.minus(c.montant)), ZERO);
const fusionner = (libelle: string, poids: 1 | -1, comps: readonly Comp[]): Comp => ({
  libelle,
  poids,
  montant: total(comps),
  comptes: comps.flatMap((c) => c.comptes.map((k) => ({ compteNum: k.compteNum, montant: c.poids === 1 ? k.montant : k.montant.negated() }))),
  present: comps.some((c) => c.present),
});

interface Calcul { valeur: Decimal | null; motif: string | null; composantes: Comp[]; mentions: string[]; aExaminer?: boolean | null }
const calcule = (composantes: Comp[], mentions: string[] = [], valeur: Decimal = total(composantes)): Calcul => ({ valeur, motif: null, composantes, mentions });
const nonCalculable = (motif: string, composantes: Comp[] = [], mentions: string[] = []): Calcul => ({ valeur: null, motif, composantes, mentions });

// --- Ensembles de comptes -------------------------------------------------------

const CLIENTS = ['411', '413', '416', '418'];
const FOURNISSEURS = ['401', '403', '408'];
const SAUF_FOURNISSEURS = ['4084'];
const FISCAL_SOCIAL = ['42', '43', '44'];
const SAUF_FISCAL_SOCIAL = ['449'];
const TRESORERIE = ['511', '512', '517', '518', '519', '53'];
const PRODUCTION_VENDUE = ['701', '702', '703', '704', '705', '706', '708', '7091', '7092', '7094', '7095', '7096', '7098'];
const NON_VENTILES_VENTES = ['7090'];
const NON_VENTILES_ACHATS = ['6090', '608', '6098'];

// --- Briques --------------------------------------------------------------------

const compCa = (b: Base): Comp => agreger(b, 1, 'Chiffre d’affaires net (70, rabais 709 déduits) — crédit', 'credit', ['70']);

function chiffreAffaires(b: Base): Calcul {
  const ca = compCa(b);
  if (!ca.present) return nonCalculable('Compte manquant : aucun compte 70 (ventes) dans les écritures de l’exercice.');
  return calcule([ca]);
}

function nonVentiles(b: Base, prefixes: readonly string[]): string | null {
  const c = agreger(b, 1, '', 'debit', prefixes);
  if (c.comptes.length === 0) return null;
  return `Comptes non ventilés entre négoce et production (${c.comptes.map((k) => k.compteNum).join(', ')}) : l’indicateur ne peut pas être établi sans hypothèse.`;
}

function margeCommerciale(b: Base): Calcul {
  const ventes = agreger(b, 1, 'Ventes de marchandises nettes (707, 7097) — crédit', 'credit', ['707', '7097']);
  const cout = agreger(b, -1, 'Coût d’achat des marchandises vendues (607, 6097, 6037) — débit', 'debit', ['607', '6097', '6037']);
  if (!ventes.present && !cout.present) return nonCalculable('Compte manquant : aucun compte 707 (ventes de marchandises) ni 607/6037 (achats et variation de stocks de marchandises).');
  const blocage = nonVentiles(b, [...NON_VENTILES_VENTES, ...NON_VENTILES_ACHATS]);
  if (blocage !== null) return nonCalculable(blocage, [ventes, cout]);
  const mentions: string[] = [];
  if (!ventes.present) mentions.push('Aucun compte 707 : achats de marchandises sans vente de marchandises comptabilisée.');
  if (!cout.present) mentions.push('Aucun compte 607/6037 : ventes de marchandises sans achat de marchandises comptabilisé.');
  if (!agreger(b, 1, '', 'debit', ['6037']).present) mentions.push('Aucune variation de stocks de marchandises (6037) comptabilisée : la marge est calculée sur les achats, non sur le coût des marchandises vendues.');
  return calcule([ventes, cout], mentions);
}

function productionExercice(b: Base): Calcul {
  const comps = [
    agreger(b, 1, 'Production vendue (701 à 706, 708, rabais 7091 à 7096 et 7098 déduits) — crédit', 'credit', PRODUCTION_VENDUE),
    agreger(b, 1, 'Production stockée ou déstockage (71) — crédit', 'credit', ['71']),
    agreger(b, 1, 'Production immobilisée (72) — crédit', 'credit', ['72']),
  ];
  if (!comps.some((c) => c.present)) return nonCalculable('Compte manquant : aucun compte de production (701 à 706, 708, 71, 72) dans les écritures de l’exercice.');
  const blocage = nonVentiles(b, NON_VENTILES_VENTES);
  if (blocage !== null) return nonCalculable(blocage, comps);
  return calcule(comps);
}

function compsValeurAjoutee(b: Base): Comp[] {
  return [
    compCa(b),
    agreger(b, 1, 'Production stockée ou déstockage (71) — crédit', 'credit', ['71']),
    agreger(b, 1, 'Production immobilisée (72) — crédit', 'credit', ['72']),
    agreger(b, -1, 'Achats et variations de stocks (60, dont 603 et 609) — débit', 'debit', ['60']),
    agreger(b, -1, 'Services extérieurs (61) — débit', 'debit', ['61']),
    agreger(b, -1, 'Autres services extérieurs (62) — débit', 'debit', ['62']),
  ];
}

function valeurAjoutee(b: Base): Calcul {
  const comps = compsValeurAjoutee(b);
  if (!(comps[0] as Comp).present) return nonCalculable('Compte manquant : aucun compte 70 (ventes) dans les écritures de l’exercice.', comps);
  const mentions = comps.slice(3).some((c) => c.present) ? [] : ['Aucun compte 60, 61 ou 62 : aucune consommation en provenance des tiers n’est comptabilisée.'];
  return calcule(comps, mentions);
}

function excedentBrutExploitation(b: Base): Calcul {
  const va = valeurAjoutee(b);
  const personnel = agreger(b, -1, 'Charges de personnel (64) — débit', 'debit', ['64']);
  const comps = [
    ...va.composantes,
    agreger(b, 1, 'Subventions d’exploitation et d’équilibre (74 sauf 747) — crédit', 'credit', ['74'], ['747']),
    agreger(b, -1, 'Impôts, taxes et versements assimilés (63) — débit', 'debit', ['63']),
    personnel,
  ];
  if (va.valeur === null) return nonCalculable(va.motif as string, comps);
  const mentions = [...va.mentions];
  if (!personnel.present) mentions.push('Aucun compte 64 : aucune charge de personnel n’est comptabilisée.');
  return calcule(comps, mentions);
}

/** Niveaux de résultat du modèle de l'art. 821-2, à partir du projet de compte de résultat. */
function niveauDeResultat(b: Base, termes: ReadonlyArray<[code: string, poids: 1 | -1]>): Calcul {
  if (b.correspondance === null || b.compteDeResultat === null) {
    return nonCalculable(`Exercice ouvert avant le ${DATE_APPLICATION_REGLEMENT_2022_06} : le modèle de compte de résultat antérieur au règlement ANC n° 2022-06 n’est pas pris en charge.`);
  }
  const cr = b.compteDeResultat;
  if (!b.soldes.some((s) => s.compteNum.startsWith('6') || s.compteNum.startsWith('7'))) return nonCalculable('Compte manquant : aucun compte de charges ou de produits (classes 6 et 7) dans les écritures de l’exercice.');
  const nonAffectes = cr.comptesNonAffectes.filter((c) => !dec(c.solde).isZero());
  if (nonAffectes.length > 0) {
    return nonCalculable(`Comptes de gestion non affectés à une rubrique du modèle de compte de résultat (${nonAffectes.slice(0, 20).map((c) => c.compteNum).join(', ')}) : niveau de résultat non calculable sans hypothèse de classement.`);
  }
  const racineDe = new Map<string, string>();
  const parCode = new Map(b.correspondance.rubriques.map((r) => [r.code, r]));
  for (const r of b.correspondance.rubriques) {
    let racine = r;
    for (let garde = 0; racine.parent !== null && garde < 20; garde++) racine = parCode.get(racine.parent) ?? { ...racine, parent: null };
    racineDe.set(r.code, racine.code);
  }
  const comps = termes.map(([code, poids]): Comp => {
    const definition = parCode.get(code);
    const comptes = cr.rubriques.filter((r) => racineDe.get(r.code) === code).flatMap((r) => r.comptes.map((k) => ({ compteNum: k.compteNum, montant: dec(k.montant) })));
    return {
      libelle: `${definition?.libelle ?? code} — ${definition?.etat === 'resultat_charges' ? 'débit' : 'crédit'}`,
      poids,
      montant: comptes.reduce((s, k) => s.plus(k.montant), ZERO),
      comptes: comptes.filter((k) => !k.montant.isZero()),
      present: comptes.length > 0,
    };
  });
  return calcule(comps);
}

const resultatExploitation = (b: Base): Calcul => niveauDeResultat(b, [['PE', 1], ['CE', -1]]);
const resultatCourant = (b: Base): Calcul => niveauDeResultat(b, [['PE', 1], ['CE', -1], ['QPP', 1], ['QPC', -1], ['PF', 1], ['CF', -1]]);

function resultatExercice(b: Base): Calcul {
  const comps = [agreger(b, 1, 'Produits (classe 7) — crédit', 'credit', ['7']), agreger(b, -1, 'Charges (classe 6) — débit', 'debit', ['6'])];
  if (!comps.some((c) => c.present)) return nonCalculable('Compte manquant : aucun compte de charges ou de produits (classes 6 et 7) dans les écritures de l’exercice.');
  const mentions: string[] = [];
  if (comps.every((c) => c.comptes.length === 0)) mentions.push('Tous les comptes des classes 6 et 7 sont soldés : une écriture de clôture a peut-être déjà viré le résultat au compte 12.');
  return calcule(comps, mentions);
}

function quotient(numerateur: Calcul, denominateur: Calcul, facteur: Decimal, libelleDenominateur: string, comps: Comp[], mentions: string[] = []): Calcul {
  if (numerateur.valeur === null) return nonCalculable(numerateur.motif as string, comps, mentions);
  if (denominateur.valeur === null) return nonCalculable(denominateur.motif as string, comps, mentions);
  if (denominateur.valeur.isZero()) return nonCalculable(`Dénominateur nul : ${libelleDenominateur} égal à zéro.`, comps, mentions);
  if (denominateur.valeur.isNegative()) return nonCalculable(`Dénominateur négatif : ${libelleDenominateur} négatif, le quotient serait dépourvu de sens.`, comps, mentions);
  return calcule(comps, [...numerateur.mentions, ...mentions], numerateur.valeur.div(denominateur.valeur).times(facteur));
}

function tauxMargeCommerciale(b: Base): Calcul {
  const mc = margeCommerciale(b);
  const ventes = agreger(b, 1, 'Ventes de marchandises nettes (707, 7097) — crédit', 'credit', ['707', '7097']);
  const den: Calcul = ventes.present ? calcule([ventes]) : nonCalculable('Compte manquant : aucun compte 707 (ventes de marchandises).');
  return quotient(mc, den, CENT, 'ventes de marchandises', mc.composantes);
}

function tauxValeurAjoutee(b: Base): Calcul {
  const va = valeurAjoutee(b);
  return quotient(va, chiffreAffaires(b), CENT, 'chiffre d’affaires', va.composantes);
}

// --- BFR, délais, trésorerie ------------------------------------------------------

const compCreancesClients = (b: Base, poids: 1 | -1 = 1): Comp => agreger(b, poids, 'Créances clients et comptes rattachés, soldes débiteurs (411, 413, 416, 418) — débit', 'debit', CLIENTS, [], 'debiteur');
const compDettesFournisseurs = (b: Base, poids: 1 | -1 = -1): Comp => agreger(b, poids, 'Dettes fournisseurs et comptes rattachés, soldes créditeurs (401, 403, 408 sauf 4084) — crédit', 'credit', FOURNISSEURS, SAUF_FOURNISSEURS, 'crediteur');
const compDettesFiscalesSociales = (b: Base, poids: 1 | -1 = -1): Comp => agreger(b, poids, 'Dettes fiscales et sociales, soldes créditeurs (42, 43, 44 sauf 449) — crédit', 'credit', FISCAL_SOCIAL, SAUF_FISCAL_SOCIAL, 'crediteur');

function compsBfr(b: Base): Comp[] {
  return [
    agreger(b, 1, 'Stocks et en-cours nets de dépréciations (classe 3) — débit', 'debit', ['3']),
    compCreancesClients(b),
    agreger(b, -1, 'Dépréciations des comptes de clients (491) — crédit', 'credit', ['491']),
    agreger(b, 1, 'Autres créances d’exploitation, soldes débiteurs (4091, 4096, 4097, 4098, 42, 43, 44 sauf 449, 486) — débit', 'debit', ['4091', '4096', '4097', '4098', ...FISCAL_SOCIAL, '486'], SAUF_FISCAL_SOCIAL, 'debiteur'),
    compDettesFournisseurs(b),
    compDettesFiscalesSociales(b),
  ];
}

function bfr(b: Base): Calcul {
  const comps = compsBfr(b);
  if (!b.soldes.some((s) => s.compteNum.startsWith('4'))) return nonCalculable('Compte manquant : aucun compte de tiers (classe 4) dans les écritures de l’exercice.', comps);
  const mentions: string[] = [];
  if (!(comps[0] as Comp).present) mentions.push('Aucun compte de stocks (classe 3) : soit l’entité n’a pas de stock, soit l’écriture d’inventaire n’est pas passée.');
  mentions.push('Convention : sont exclus les avances et acomptes reçus (4191), les produits constatés d’avance (487), les comptes 45 et 46 et les dettes sur immobilisations (404) ; le sens des soldes est apprécié par compte général, non par tiers.');
  return calcule(comps, mentions);
}

function bfrEnJours(b: Base): Calcul {
  const besoin = bfr(b);
  return quotient(besoin, chiffreAffaires(b), new Decimal(b.nbJours), 'chiffre d’affaires', [...besoin.composantes, { ...compCa(b), libelle: '(dénominateur) Chiffre d’affaires net hors taxes (70) — crédit' }], [`Calcul sur ${b.nbJours} jours (durée de l’exercice).`]);
}

function delaiClients(b: Base): Calcul {
  const creances = compCreancesClients(b);
  const ca = { ...compCa(b), libelle: '(dénominateur, avant TVA) Chiffre d’affaires net hors taxes (70) — crédit' };
  const comps = [creances, ca];
  if (!creances.present) return nonCalculable('Compte manquant : aucun compte client (411, 413, 416, 418) dans les écritures de l’exercice.', comps);
  if (!ca.present) return nonCalculable('Compte manquant : aucun compte 70 (ventes) dans les écritures de l’exercice.', comps);
  if (b.taux.ventes === null) return nonCalculable(b.taux.motifVentes as string, comps);
  const ttc = ca.montant.times(CENT.plus(b.taux.ventes)).div(CENT);
  if (!ttc.isPositive() || ttc.isZero()) return nonCalculable('Dénominateur nul : chiffre d’affaires nul ou négatif.', comps);
  return calcule(comps, [
    `Chiffre d’affaires TTC estimé avec le taux moyen de TVA fourni (${b.taux.ventes.toString()} %) : ${versChaine(ttc)} ; calcul sur ${b.nbJours} jours.`,
    'Délai MOYEN calculé sur les soldes de clôture (créances brutes, effets escomptés non échus et créances cédées non compris) : il ne permet pas de conclure au respect ou au dépassement des délais de paiement de l’article L441-10 du Code de commerce.',
  ], creances.montant.div(ttc).times(b.nbJours));
}

function delaiFournisseurs(b: Base): Calcul {
  const dettes = compDettesFournisseurs(b, 1);
  const achats = agreger(b, 1, '(dénominateur, avant TVA) Achats nets et charges externes hors taxes (60 sauf 603, 61, 62) — débit', 'debit', ['60', '61', '62'], ['603']);
  const comps = [dettes, achats];
  if (!dettes.present) return nonCalculable('Compte manquant : aucun compte fournisseur (401, 403, 408) dans les écritures de l’exercice.', comps);
  if (!achats.present) return nonCalculable('Compte manquant : aucun compte d’achats ou de charges externes (60, 61, 62) dans les écritures de l’exercice.', comps);
  if (b.taux.achats === null) return nonCalculable(b.taux.motifAchats as string, comps);
  const ttc = achats.montant.times(CENT.plus(b.taux.achats)).div(CENT);
  if (!ttc.isPositive() || ttc.isZero()) return nonCalculable('Dénominateur nul : achats et charges externes nuls ou négatifs.', comps);
  return calcule(comps, [
    `Achats et charges externes TTC estimés avec le taux moyen de TVA fourni (${b.taux.achats.toString()} %) : ${versChaine(ttc)} ; calcul sur ${b.nbJours} jours.`,
    'Délai MOYEN calculé sur les soldes de clôture (fournisseurs d’immobilisations exclus ; charges non soumises à TVA traitées au taux moyen) : il ne permet pas de conclure au respect ou au dépassement des délais de paiement de l’article L441-10 du Code de commerce.',
  ], dettes.montant.div(ttc).times(b.nbJours));
}

function compsTresorerie(b: Base): Comp[] {
  return [
    agreger(b, 1, 'Disponibilités, soldes débiteurs (511, 512, 517, 5188, 53) — débit', 'debit', ['511', '512', '517', '5188', '53'], [], 'debiteur'),
    agreger(b, -1, 'Soldes créditeurs de banque et de caisse (512, 517, 53) — crédit', 'credit', ['512', '517', '53'], [], 'crediteur'),
    agreger(b, -1, 'Concours bancaires courants et intérêts courus à payer (519, 5181) — crédit', 'credit', ['519', '5181']),
  ];
}

function tresorerieNette(b: Base): Calcul {
  const comps = compsTresorerie(b);
  if (!b.soldes.some((s) => TRESORERIE.some((p) => s.compteNum.startsWith(p)))) return nonCalculable('Compte manquant : aucun compte de banque, de caisse ou de concours bancaires (511, 512, 517, 518, 519, 53) dans les écritures.', comps);
  const mentions: string[] = [];
  const vmp = agreger(b, 1, '', 'debit', ['50', '590']);
  if (!vmp.montant.isZero()) mentions.push(`Valeurs mobilières de placement (50) non comprises par convention : ${versChaine(vmp.montant)}.`);
  const caisse = agreger(b, 1, '', 'credit', ['53'], [], 'crediteur');
  if (!caisse.montant.isZero()) mentions.push(`Caisse créditrice de ${versChaine(caisse.montant)} : solde anormal (PCG art. 1215-53), compté en moins.`);
  return calcule(comps, mentions);
}

// --- Structure --------------------------------------------------------------------

function compsCapitauxPropres(b: Base): Comp[] {
  return [
    agreger(b, 1, 'Capital, primes, écarts et réserves (10 sauf 109) — crédit', 'credit', ['10'], ['109']),
    agreger(b, 1, 'Report à nouveau (11) — crédit', 'credit', ['11']),
    agreger(b, 1, 'Résultat de l’exercice au compte 12 — crédit', 'credit', ['12']),
    agreger(b, 1, 'Résultat en cours : comptes de produits et de charges non soldés (classes 7 et 6) — crédit', 'credit', ['6', '7']),
    agreger(b, 1, 'Subventions d’investissement (13) — crédit', 'credit', ['13']),
    agreger(b, 1, 'Provisions réglementées (14) — crédit', 'credit', ['14']),
  ];
}

function capitauxPropres(b: Base): Calcul {
  const comps = compsCapitauxPropres(b);
  if (!(comps[0] as Comp).present) return nonCalculable('Compte manquant : aucun compte 10 (capital et réserves) dans les écritures — à-nouveaux absents ?', comps);
  const mentions = ['Capitaux propres AVANT répartition, résultat de la période compris tel qu’il ressort des écritures (aucune écriture d’inventaire n’est simulée).'];
  if (!(comps[2] as Comp).montant.isZero() && !(comps[3] as Comp).montant.isZero()) mentions.push('Le compte 12 n’est pas soldé alors que les classes 6 et 7 sont mouvementées : résultat antérieur en instance d’affectation ? Les deux montants sont cumulés.');
  return calcule(comps, mentions);
}

function compsEndettement(b: Base): Comp[] {
  return [
    agreger(b, 1, 'Emprunts et dettes assimilées (16 sauf 169) — crédit', 'credit', ['16'], ['169']),
    agreger(b, 1, 'Dettes rattachées à des participations (17) — crédit', 'credit', ['17']),
    agreger(b, 1, 'Soldes créditeurs de banque (512, 517) — crédit', 'credit', ['512', '517'], [], 'crediteur'),
    agreger(b, 1, 'Concours bancaires courants et intérêts courus à payer (519, 5181) — crédit', 'credit', ['519', '5181']),
  ];
}

function endettementFinancier(b: Base): Calcul {
  const comps = compsEndettement(b);
  if (!b.soldes.some((s) => s.compteNum.startsWith('1'))) return nonCalculable('Compte manquant : aucun compte de capitaux (classe 1) dans les écritures — à-nouveaux absents ?', comps);
  const mentions: string[] = [];
  if (comps.every((c) => c.comptes.length === 0)) mentions.push('Aucun emprunt ni concours bancaire dans les comptes 16, 17, 512 créditeur et 519.');
  const associes = agreger(b, 1, '', 'credit', ['451', '455'], [], 'crediteur');
  if (!associes.montant.isZero()) mentions.push(`Comptes courants d’associés et du groupe créditeurs (451, 455) non compris par convention : ${versChaine(associes.montant)}.`);
  return calcule(comps, mentions);
}

function ratioEndettement(b: Base): Calcul {
  const dettes = endettementFinancier(b);
  const cp = capitauxPropres(b);
  const comps = [fusionner('Endettement financier — crédit', 1, dettes.composantes), { ...fusionner('(dénominateur) Capitaux propres — crédit', 1, cp.composantes) }];
  if (cp.valeur !== null && !cp.valeur.isPositive()) return nonCalculable('Dénominateur négatif : capitaux propres négatifs, le ratio serait dépourvu de sens.', comps);
  return quotient(dettes, cp, new Decimal(1), 'capitaux propres', comps, dettes.mentions.filter((m) => m.startsWith('Comptes courants')));
}

function compsFondsDeRoulement(b: Base): Comp[] {
  return [
    ...compsCapitauxPropres(b),
    agreger(b, 1, 'Provisions (15) — crédit', 'credit', ['15']),
    agreger(b, 1, 'Emprunts et dettes assimilées, nets des primes de remboursement (16) — crédit', 'credit', ['16']),
    agreger(b, 1, 'Dettes rattachées à des participations (17) — crédit', 'credit', ['17']),
    agreger(b, -1, 'Actif immobilisé net d’amortissements et de dépréciations (classe 2) — débit', 'debit', ['2']),
    agreger(b, -1, 'Capital souscrit non appelé (109) — débit', 'debit', ['109']),
  ];
}

function fondsDeRoulement(b: Base): Calcul {
  const comps = compsFondsDeRoulement(b);
  if (!b.soldes.some((s) => s.compteNum.startsWith('1'))) return nonCalculable('Compte manquant : aucun compte de capitaux (classe 1) dans les écritures — à-nouveaux absents, haut de bilan non calculable.', comps);
  const mentions = ['Convention : ressources stables = capitaux propres, provisions, emprunts (16) et dettes rattachées (17) ; les comptes courants d’associés (45) et les concours bancaires n’en font pas partie ; emplois stables = classe 2 nette.'];
  if (!agreger(b, 1, '', 'debit', ['2']).present) mentions.push('Aucun compte d’immobilisations (classe 2) dans les écritures.');
  return calcule(comps, mentions);
}

function coherenceFrBfrTresorerie(b: Base): Calcul {
  const fr = fondsDeRoulement(b);
  const besoin = bfr(b);
  const tn = tresorerieNette(b);
  const comps = [fusionner('Fonds de roulement net global', 1, fr.composantes), fusionner('Besoin en fonds de roulement', -1, besoin.composantes), fusionner('Trésorerie nette', -1, tn.composantes)];
  for (const c of [fr, besoin, tn]) if (c.valeur === null) return nonCalculable(c.motif as string, comps);
  const retenus = new Set([...fr.composantes, ...besoin.composantes, ...tn.composantes].flatMap((c) => c.comptes.map((k) => k.compteNum)));
  const hors = b.soldes.filter((s) => !retenus.has(s.compteNum) && !s.solde.isZero());
  const netHors = hors.reduce((s, c) => s.plus(c.solde), ZERO);
  const mentions = [
    hors.length === 0
      ? 'Tous les comptes non soldés sont compris dans l’un des trois agrégats.'
      : `Comptes hors des trois agrégats (solde net débiteur ${versChaine(netHors)}) : ${hors.slice(0, 15).map((c) => `${c.compteNum} (${versChaine(c.solde)})`).join(', ')}${hors.length > 15 ? `, et ${hors.length - 15} autre(s)` : ''}. Un écart non nul traduit ces comptes (besoin hors exploitation, comptes courants d’associés, comptes d’attente…), pas nécessairement une erreur.`,
  ];
  return calcule(comps, mentions);
}

// --- Signaux à examiner -------------------------------------------------------------

function signal(c: Calcul, condition: (v: Decimal) => boolean, mentions: string[]): Calcul {
  if (c.valeur === null) return { ...c, aExaminer: null };
  return { ...c, mentions: [...c.mentions, ...mentions], aExaminer: condition(c.valeur) };
}

const MENTION_SIGNAL = 'Signal à examiner par le réviseur, calculé sur les seules écritures fournies : ce n’est ni un diagnostic, ni une appréciation de la continuité d’exploitation.';

function signalCapitauxPropres(b: Base): Calcul {
  const cp = capitauxPropres(b);
  const capital = agreger(b, -1, 'Moitié du capital social : solde du compte 101 × 0,5 — crédit', 'credit', ['101']);
  const comps = [fusionner('Capitaux propres', 1, cp.composantes), { ...capital, montant: capital.montant.div(2), comptes: capital.comptes.map((k) => ({ compteNum: k.compteNum, montant: k.montant.div(2) })) }];
  if (cp.valeur === null) return { ...nonCalculable(cp.motif as string, comps), aExaminer: null };
  if (!capital.present) return { ...nonCalculable('Compte manquant : aucun compte 101 (capital) dans les écritures.', comps), aExaminer: null };
  if (!capital.montant.isPositive() || capital.montant.isZero()) return { ...nonCalculable('Capital (compte 101) nul ou débiteur : comparaison dépourvue de sens.', comps), aExaminer: null };
  return signal(calcule(comps, cp.mentions), (v) => v.isNegative(), [
    MENTION_SIGNAL,
    'Textes à rapprocher selon la forme sociale, qui ne figure pas dans les écritures : Code de commerce art. L223-42 (SARL), art. L225-248 (SA) et, par renvoi de l’art. L227-1, SAS. Ces textes visent les pertes constatées dans des comptes APPROUVÉS ; la valeur ci-dessus est un projet avant inventaire.',
  ]);
}

function signalTresorerie(b: Base): Calcul {
  return signal(tresorerieNette(b), (v) => v.isNegative(), [MENTION_SIGNAL]);
}

function signalEbe(b: Base): Calcul {
  return signal(excedentBrutExploitation(b), (v) => v.isNegative(), [MENTION_SIGNAL]);
}

function signalResultatNegatifDeuxExercices(b: Base, precedent: Base | null): Calcul {
  const n = resultatExercice(b);
  if (precedent === null) return { ...nonCalculable('Exercice précédent non fourni : la question porte sur deux exercices consécutifs.', n.composantes), aExaminer: null };
  const n1 = resultatExercice(precedent);
  const comps = [fusionner(`Résultat de l’exercice clos le ${b.exercice.fin}`, 1, n.composantes), { ...fusionner(`(pour mémoire) Résultat de l’exercice clos le ${precedent.exercice.fin}`, 1, n1.composantes) }];
  if (n.valeur === null) return { ...nonCalculable(n.motif as string, comps), aExaminer: null };
  if (n1.valeur === null) return { ...nonCalculable(`Exercice précédent : ${n1.motif as string}`, comps), aExaminer: null };
  const precedentNegatif = n1.valeur.isNegative();
  return { ...signal(calcule(comps, [], n.valeur), (v) => v.isNegative() && precedentNegatif, [MENTION_SIGNAL, `Résultat de l’exercice précédent : ${versChaine(n1.valeur)}. Résultats avant écritures d’inventaire éventuelles.`]) };
}

function dettesFiscalesSociales(b: Base): Calcul {
  const c = compDettesFiscalesSociales(b, 1);
  if (!c.present) return nonCalculable('Compte manquant : aucun compte 42, 43 ou 44 dans les écritures de l’exercice.', [c]);
  return calcule([c]);
}

function signalDettesFiscalesSociales(b: Base, precedent: Base | null): Calcul {
  const n = dettesFiscalesSociales(b);
  if (precedent === null) return { ...nonCalculable('Exercice précédent non fourni : la hausse ne peut pas être mesurée.', n.composantes), aExaminer: null };
  const n1 = dettesFiscalesSociales(precedent);
  const comps = [...n.composantes, { ...fusionner(`(base) Dettes fiscales et sociales à la clôture du ${precedent.exercice.fin}`, 1, n1.composantes) }];
  if (n.valeur === null) return { ...nonCalculable(n.motif as string, comps), aExaminer: null };
  if (n1.valeur === null) return { ...nonCalculable(`Exercice précédent : ${n1.motif as string}`, comps), aExaminer: null };
  if (!n1.valeur.isPositive() || n1.valeur.isZero()) return { ...nonCalculable('Dénominateur nul : dettes fiscales et sociales nulles à la clôture précédente, hausse en pourcentage non calculable.', comps), aExaminer: null };
  const hausse = n.valeur.minus(n1.valeur).div(n1.valeur).times(CENT);
  return signal(calcule(comps, [], hausse), (v) => v.greaterThan(b.seuilDfs), [MENTION_SIGNAL, `Seuil interne paramétrable : ${b.seuilDfs.toString()} %. Une hausse peut tenir à l’activité, à un changement de périodicité déclarative ou à un retard de paiement : à documenter.`]);
}

// --- Catalogue ------------------------------------------------------------------------

type Calculateur = (b: Base, precedent: Base | null) => Calcul;
interface Entree { definition: DefinitionIndicateur; calculer: Calculateur; signal: boolean }

const MANQUE_70 = 'Sans compte 70 mouvementé : non calculable (motif « compte manquant »).';
const INTERNE = SOURCES_ETATS.conventionInterneAnalyse;
const SIG = SOURCES_ETATS.sigConventionInterne;

function def(
  id: string, famille: DefinitionIndicateur['famille'], unite: DefinitionIndicateur['unite'], libelle: string, formule: string, convention: string,
  entrees: string[], regleDonneeManquante: string, source: SourceRegle, calculer: Calculateur,
): Entree {
  return { definition: { id, version: '1.0.0', libelle, famille, formule, convention, unite, entrees, regleDonneeManquante, source }, calculer, signal: famille === 'signal' };
}

const ENTREES: readonly Entree[] = [
  def('SIG-CA', 'activite', 'euros', 'Chiffre d’affaires net', 'Solde créditeur des comptes 70 (701 à 708, moins 709).',
    'Montant net hors taxes tel que comptabilisé ; aucune écriture d’inventaire (factures à établir, produits constatés d’avance) n’est simulée.',
    ['70'], MANQUE_70, SOURCES_ETATS.chiffreAffaires, chiffreAffaires),
  def('SIG-MARGE-COMMERCIALE', 'activite', 'euros', 'Marge commerciale', '(707 − 7097) − (607 − 6097 + 6037).',
    'Solde intermédiaire usuel, non défini par le PCG en vigueur. Sans variation de stocks comptabilisée (6037), la marge est calculée sur les achats : mention restituée.',
    ['707', '7097', '607', '6097', '6037'], 'Sans compte 707 ni 607/6037 : non calculable. Si des comptes 709, 609, 608 ou 6098 non ventilés portent un solde : non calculable (pas d’hypothèse de répartition).', SIG, margeCommerciale),
  def('SIG-PRODUCTION', 'activite', 'euros', 'Production de l’exercice', '(701 à 706 + 708 − 7091 à 7096 − 7098) + 71 + 72.',
    'Solde intermédiaire usuel, non défini par le PCG en vigueur. La production stockée (71) peut être négative (déstockage).',
    ['701 à 706', '708', '7091 à 7098 sauf 7097', '71', '72'], 'Sans aucun de ces comptes : non calculable. Compte 709 non ventilé portant un solde : non calculable.', SIG, productionExercice),
  def('SIG-VALEUR-AJOUTEE', 'activite', 'euros', 'Valeur ajoutée', '70 + 71 + 72 − 60 − 61 − 62.',
    'Équivaut à marge commerciale + production de l’exercice − consommations en provenance des tiers. Redevances de crédit-bail et personnel extérieur non retraités ; subventions d’exploitation non comprises.',
    ['70', '71', '72', '60', '61', '62'], `${MANQUE_70} Sans compte 60, 61 ou 62 : calculé, avec mention.`, SIG, valeurAjoutee),
  def('SIG-EBE', 'activite', 'euros', 'Excédent brut d’exploitation', 'Valeur ajoutée + 74 (sauf 747) − 63 − 64.',
    'Solde intermédiaire usuel, non défini par le PCG en vigueur. La quote-part de subventions d’investissement virée au résultat (747) est exclue ; les autres produits et charges de gestion courante (75, 65) ne sont pas compris.',
    ['70', '71', '72', '60', '61', '62', '74 sauf 747', '63', '64'], `${MANQUE_70} Sans compte 64 : calculé, avec mention.`, SIG, excedentBrutExploitation),
  def('SIG-RESULTAT-EXPLOITATION', 'activite', 'euros', 'Résultat d’exploitation', 'Total des produits d’exploitation (I) − total des charges d’exploitation (II) du modèle de l’art. 821-2.',
    'Calculé sur le projet de compte de résultat (table de correspondance en attente de validation professionnelle). Depuis le règlement ANC n° 2022-06, les cessions d’immobilisations incorporelles et corporelles (657, 757) en font partie.',
    ['Rubriques PE et CE du projet de compte de résultat'], 'Exercice ouvert avant le 1er janvier 2025, absence de comptes des classes 6 et 7, ou compte de gestion non affecté à une rubrique : non calculable.', SOURCES_ETATS.niveauxDeResultat, resultatExploitation),
  def('SIG-RESULTAT-COURANT', 'activite', 'euros', 'Résultat courant avant impôts', 'I − II + III − IV + V − VI du modèle de l’art. 821-2.',
    'Calculé sur le projet de compte de résultat (table de correspondance en attente de validation professionnelle).',
    ['Rubriques PE, CE, QPP, QPC, PF et CF du projet de compte de résultat'], 'Mêmes règles que le résultat d’exploitation.', SOURCES_ETATS.niveauxDeResultat, resultatCourant),
  def('SIG-RESULTAT-EXERCICE', 'activite', 'euros', 'Résultat de l’exercice', 'Solde créditeur de la classe 7 − solde débiteur de la classe 6.',
    'Résultat tel qu’il ressort des écritures fournies : ni écriture d’inventaire, ni impôt non comptabilisé ne sont simulés. Si les classes 6 et 7 sont déjà soldées, la valeur est nulle et une mention renvoie au compte 12.',
    ['6', '7'], 'Sans aucun compte des classes 6 et 7 : non calculable.', SOURCES_ETATS.resultatExercice, resultatExercice),
  def('TAUX-MARGE-COMMERCIALE', 'rentabilite', 'pourcentage', 'Taux de marge commerciale', 'Marge commerciale ÷ (707 − 7097) × 100.',
    'Rapporté aux seules ventes de marchandises, hors taxes.', ['707', '7097', '607', '6097', '6037'], 'Marge commerciale non calculable ou ventes de marchandises nulles (dénominateur nul) : non calculable.', INTERNE, tauxMargeCommerciale),
  def('TAUX-VALEUR-AJOUTEE', 'rentabilite', 'pourcentage', 'Taux de valeur ajoutée', 'Valeur ajoutée ÷ chiffre d’affaires net × 100.',
    'Rapporté au chiffre d’affaires net hors taxes.', ['70', '71', '72', '60', '61', '62'], 'Chiffre d’affaires absent ou nul (dénominateur nul) : non calculable.', INTERNE, tauxValeurAjoutee),
  def('BFR', 'bfr', 'euros', 'Besoin en fonds de roulement d’exploitation',
    'Classe 3 (nette de 39) + soldes débiteurs 411/413/416/418 − 491 + soldes débiteurs 4091/4096/4097/4098/42/43/44 (sauf 449)/486 − soldes créditeurs 401/403/408 (sauf 4084) − soldes créditeurs 42/43/44 (sauf 449).',
    'Convention interne. Exclus : avances reçues (4191), produits constatés d’avance (487), comptes 45 et 46, fournisseurs d’immobilisations (404, 405, 4084). Sens des soldes apprécié par compte général, non par tiers. Soldes de clôture, sensibles à la saisonnalité.',
    ['3', '411', '413', '416', '418', '491', '4091', '4096 à 4098', '42', '43', '44', '486', '401', '403', '408'], 'Sans aucun compte de classe 4 : non calculable. Sans compte de stocks : calculé, avec mention.', INTERNE, bfr),
  def('BFR-JOURS', 'bfr', 'jours', 'BFR en jours de chiffre d’affaires', 'BFR ÷ chiffre d’affaires net hors taxes × nombre de jours de l’exercice.',
    'Le nombre de jours est la durée réelle de l’exercice (date de clôture − date d’ouverture + 1), jamais 360 ou 365 forfaitaires.', ['BFR', '70'], 'BFR non calculable, chiffre d’affaires absent ou nul : non calculable.', INTERNE, bfrEnJours),
  def('DELAI-CLIENTS', 'bfr', 'jours', 'Délai moyen de règlement des clients', 'Soldes débiteurs 411/413/416/418 (TTC) ÷ [chiffre d’affaires net × (1 + taux moyen de TVA sur ventes)] × nombre de jours de l’exercice.',
    'Le taux moyen de TVA doit être FOURNI (`tauxTvaMoyen.ventes`, en pourcentage). Il n’est pas déduit des comptes 4457 : ces comptes sont soldés à chaque déclaration, enregistrent aussi des régularisations, et leurs mouvements créditeurs ne donnent pas un taux moyen fiable. Créances brutes à la clôture ; effets escomptés et créances cédées non compris ; ventes au comptant comprises au dénominateur.',
    ['411', '413', '416', '418', '70', 'tauxTvaMoyen.ventes'], 'Taux non fourni : non calculable, motif « taux de TVA moyen à renseigner ». Sans compte client ou sans compte 70, ou chiffre d’affaires nul : non calculable.', INTERNE, delaiClients),
  def('DELAI-FOURNISSEURS', 'bfr', 'jours', 'Délai moyen de règlement des fournisseurs', 'Soldes créditeurs 401/403/408 sauf 4084 (TTC) ÷ [(60 sauf 603 + 61 + 62) × (1 + taux moyen de TVA sur achats)] × nombre de jours de l’exercice.',
    'Le taux moyen de TVA doit être FOURNI (`tauxTvaMoyen.achats`, en pourcentage) : toutes les charges externes ne supportent pas la TVA (loyers, assurances…), le taux moyen relève de l’appréciation du réviseur. Fournisseurs d’immobilisations exclus.',
    ['401', '403', '408', '60 sauf 603', '61', '62', 'tauxTvaMoyen.achats'], 'Taux non fourni : non calculable, motif « taux de TVA moyen à renseigner ». Sans compte fournisseur ou sans compte 60/61/62, ou achats nuls : non calculable.', INTERNE, delaiFournisseurs),
  def('TRESORERIE-NETTE', 'tresorerie', 'euros', 'Trésorerie nette', 'Soldes débiteurs 511/512/517/5188/53 − soldes créditeurs 512/517/53 − 519 − 5181.',
    'Disponibilités moins concours bancaires courants et soldes créditeurs de banque, sans compensation entre comptes bancaires (PCG art. 1215-51). Valeurs mobilières de placement non comprises (mention). Solde comptable, non rapproché des relevés.',
    ['511', '512', '517', '518', '519', '53'], 'Sans aucun de ces comptes : non calculable.', SOURCES_ETATS.concoursBancaires, tresorerieNette),
  def('CAPITAUX-PROPRES', 'structure', 'euros', 'Capitaux propres', '10 (sauf 109) + 11 + 12 + (classe 7 − classe 6 non soldées) + 13 + 14, soldes créditeurs nets.',
    'Avant répartition, résultat de la période compris tel qu’il ressort des écritures. Le capital souscrit non appelé (109) n’est pas déduit.',
    ['10 sauf 109', '11', '12', '13', '14', '6', '7'], 'Sans compte 10 (à-nouveaux absents) : non calculable.', SOURCES_ETATS.capitauxPropres, capitauxPropres),
  def('ENDETTEMENT-FINANCIER', 'structure', 'euros', 'Endettement financier', '16 (sauf 169) + 17 + soldes créditeurs 512/517 + 519 + 5181.',
    'Convention interne. Les comptes courants d’associés et du groupe (451, 455) ne sont pas compris : leur montant créditeur est restitué en mention. Les engagements de crédit-bail ne figurent pas dans les écritures.',
    ['16 sauf 169', '17', '512', '517', '519', '5181'], 'Sans aucun compte de classe 1 (à-nouveaux absents) : non calculable. Classe 1 présente sans emprunt : 0.00 avec mention.', INTERNE, endettementFinancier),
  def('RATIO-ENDETTEMENT', 'structure', 'ratio', 'Ratio d’endettement financier', 'Endettement financier ÷ capitaux propres.',
    'Convention interne ; mêmes limites que ses deux composantes.', ['ENDETTEMENT-FINANCIER', 'CAPITAUX-PROPRES'], 'Capitaux propres non calculables, nuls ou négatifs : non calculable.', INTERNE, ratioEndettement),
  def('FONDS-DE-ROULEMENT', 'structure', 'euros', 'Fonds de roulement net global (haut de bilan)', 'Capitaux propres + 15 + 16 + 17 − classe 2 nette (20 à 27 − 28 − 29) − 109.',
    'Convention interne, par le haut du bilan, sur valeurs nettes. Comptes courants d’associés (45) et concours bancaires exclus des ressources stables.',
    ['10 à 17', '6', '7', '2'], 'Sans aucun compte de classe 1 : non calculable.', INTERNE, fondsDeRoulement),
  def('COHERENCE-FR-BFR-TRESORERIE', 'structure', 'euros', 'Contrôle de cohérence : fonds de roulement − BFR − trésorerie nette', 'FONDS-DE-ROULEMENT − BFR − TRESORERIE-NETTE.',
    'Avec une balance équilibrée, l’écart est égal au solde net débiteur des comptes qui n’entrent dans aucun des trois agrégats (BFR hors exploitation, comptes courants d’associés, valeurs mobilières de placement, comptes d’attente…), restitués en mention. Un écart non nul n’est pas en soi une erreur.',
    ['FONDS-DE-ROULEMENT', 'BFR', 'TRESORERIE-NETTE'], 'L’un des trois agrégats non calculable : non calculable.', INTERNE, coherenceFrBfrTresorerie),
  def('SIGNAL-CAPITAUX-PROPRES-MOITIE-CAPITAL', 'signal', 'euros', 'Les capitaux propres sont-ils inférieurs à la moitié du capital social ?', 'Capitaux propres − (solde créditeur du compte 101 ÷ 2) ; à examiner si la valeur est négative.',
    'Question posée au réviseur, pas une conclusion. La forme sociale n’est pas dans les écritures ; les textes visent des comptes approuvés, la valeur est un projet avant inventaire.',
    ['CAPITAUX-PROPRES', '101'], 'Capitaux propres non calculables, compte 101 absent, nul ou débiteur : non calculable.', SOURCES_ETATS.capitauxPropresMoitieCapital, signalCapitauxPropres),
  def('SIGNAL-TRESORERIE-NETTE-NEGATIVE', 'signal', 'euros', 'La trésorerie nette est-elle négative à la clôture ?', 'TRESORERIE-NETTE ; à examiner si la valeur est négative.',
    'Question posée au réviseur, pas une conclusion : un découvert autorisé ou saisonnier peut l’expliquer.', ['TRESORERIE-NETTE'], 'Trésorerie nette non calculable : non calculable.', INTERNE, signalTresorerie),
  def('SIGNAL-EBE-NEGATIF', 'signal', 'euros', 'L’excédent brut d’exploitation est-il négatif ?', 'SIG-EBE ; à examiner si la valeur est négative.',
    'Question posée au réviseur, pas une conclusion.', ['SIG-EBE'], 'EBE non calculable : non calculable.', INTERNE, signalEbe),
  def('SIGNAL-RESULTAT-NEGATIF-DEUX-EXERCICES', 'signal', 'euros', 'Le résultat est-il négatif pour le deuxième exercice consécutif ?', 'SIG-RESULTAT-EXERCICE de N ; à examiner si N et N-1 sont tous deux négatifs.',
    'Question posée au réviseur, pas une conclusion. Résultats avant écritures d’inventaire éventuelles.', ['6', '7', 'exercice précédent'], 'Exercice précédent non fourni ou résultat non calculable sur l’un des deux exercices : non calculable.', INTERNE, signalResultatNegatifDeuxExercices),
  def('SIGNAL-DETTES-FISCALES-SOCIALES-HAUSSE', 'signal', 'pourcentage', 'Les dettes fiscales et sociales sont-elles en forte hausse ?', '(Soldes créditeurs 42/43/44 sauf 449 de N − ceux de N-1) ÷ ceux de N-1 × 100 ; à examiner au-delà du seuil.',
    `Seuil interne paramétrable (défaut ${SEUIL_HAUSSE_DETTES_FISCALES_SOCIALES_PAR_DEFAUT} %). Question posée au réviseur, pas une conclusion.`, ['42', '43', '44 sauf 449', 'exercice précédent'], 'Exercice précédent non fourni, comptes absents ou base nulle : non calculable.', INTERNE, signalDettesFiscalesSociales),
];

export const CATALOGUE_INDICATEURS: readonly DefinitionIndicateur[] = Object.freeze(ENTREES.map((e) => Object.freeze(e.definition)));

// --- Préparation des données -------------------------------------------------------------

function finDouzeMois(debut: string): string {
  const [a, m, j] = debut.split('-').map(Number) as [number, number, number];
  const anniversaire = dateCivileValide(a + 1, m, j) ? versIso(a + 1, m, j) : versIso(a + 1, 3, 1);
  return isoDepuisJours(joursDepuisEpoque(anniversaire) - 1);
}

function lireTaux(v: string | undefined, sens: string): { taux: Decimal | null; motif: string | null } {
  if (v === undefined) return { taux: null, motif: `Taux de TVA moyen à renseigner (${sens}) : le passage du hors taxes au TTC n’est pas déduit des écritures.` };
  if (!estChaineDecimale(v) || dec(v).isNegative() || dec(v).greaterThan(100)) return { taux: null, motif: `Taux de TVA moyen invalide (${sens}) : pourcentage entre 0 et 100 attendu, en chaîne décimale.` };
  return { taux: dec(v), motif: null };
}

function preparer(lignes: readonly LigneEcriture[], exercice: { debut: string; fin: string }, ctx: ContexteIndicateurs, seuilDfs: Decimal): Base {
  const dansExercice = lignes.filter((l) => l.ecritureDate >= exercice.debut && l.ecritureDate <= exercice.fin);
  const balance = calculerBalance(dansExercice);
  const nbJours = ecartEnJours(exercice.debut, exercice.fin) + 1;
  const mentionsGenerales: string[] = [];
  const mentionsDuree: string[] = [];
  const horsExercice = lignes.length - dansExercice.length;
  if (horsExercice > 0) mentionsGenerales.push(`${horsExercice} ligne(s) d’écriture datée(s) hors de l’exercice (${exercice.debut} au ${exercice.fin}) non retenue(s).`);
  if (!balance.equilibree) mentionsGenerales.push(`Balance de l’exercice non équilibrée (débits − crédits = ${balance.ecart}) : indicateurs à lire avec réserve.`);
  let derniere = '';
  for (const l of dansExercice) if (l.ecritureDate > derniere) derniere = l.ecritureDate;
  if (derniere !== '') {
    const retard = ecartEnJours(derniere, exercice.fin);
    if (retard > SEUIL_JOURS_SANS_ECRITURE_AVANT_CLOTURE) {
      mentionsGenerales.push(`Dernière écriture datée du ${derniere}, soit ${retard} jours avant la clôture : les écritures ne couvrent vraisemblablement pas tout l’exercice ; les flux, les taux et les durées en jours en sont affectés.`);
    }
  }
  if (exercice.fin !== finDouzeMois(exercice.debut)) {
    mentionsDuree.push(`Exercice de ${nbJours} jours, différent de douze mois : les durées en jours sont calculées sur ${nbJours} jours ; les taux et ratios ne sont pas annualisés et ne se comparent pas directement à ceux d’un exercice de douze mois.`);
  }
  const correspondance = correspondancePour(exercice.debut);
  const ventes = lireTaux(ctx.tauxTvaMoyen?.ventes, 'ventes');
  const achats = lireTaux(ctx.tauxTvaMoyen?.achats, 'achats');
  return {
    exercice,
    nbJours,
    balance,
    soldes: balance.lignes.map((l) => ({ compteNum: l.compteNum, solde: dec(l.totalDebit).minus(dec(l.totalCredit)) })),
    correspondance,
    compteDeResultat: correspondance === null ? null : projeterCompteDeResultat(balance, correspondance),
    mentionsGenerales,
    mentionsDuree,
    taux: { ventes: ventes.taux, achats: achats.taux, motifVentes: ventes.motif, motifAchats: achats.motif },
    seuilDfs,
  };
}

function versComposantes(comps: readonly Comp[]): ComposanteIndicateur[] {
  return comps.map((c) => ({
    libelle: c.libelle.startsWith('(') ? c.libelle : `${c.poids === 1 ? '(+)' : '(−)'} ${c.libelle}`,
    montant: versChaine(c.montant),
    comptes: c.comptes.map((k) => ({ compteNum: k.compteNum, montant: versChaine(k.montant) })),
  }));
}

const exerciceValide = (e: { debut: string; fin: string } | undefined): e is { debut: string; fin: string } =>
  e !== undefined && estDateIso(e.debut) && estDateIso(e.fin) && e.fin > e.debut;

/**
 * Calcule les indicateurs du catalogue (ou la sélection `ids`). Ne lève pas pour des données manquantes : chaque indicateur
 * non calculable rend `valeur: null` et son motif. Un identifiant inconnu rend un résultat `non_calculable`.
 */
export function calculerIndicateurs(contexte: ContexteIndicateurs, options: OptionsIndicateurs = {}): ValeurIndicateur[] {
  const selection: Array<Entree | string> = options.ids === undefined ? [...ENTREES] : options.ids.map((id) => ENTREES.find((e) => e.definition.id === id) ?? String(id));
  const periode = { debut: String(contexte.exercice?.debut), fin: String(contexte.exercice?.fin) };
  const echec = (motif: string): ValeurIndicateur[] => selection.map((e) => typeof e === 'string'
    ? { id: e, version: '?', statut: 'non_calculable', motif: `Indicateur inconnu : ${e.slice(0, 80)}.`, valeur: null, unite: 'euros', periode, composantes: [], mentions: [], aExaminer: null }
    : { id: e.definition.id, version: e.definition.version, statut: 'non_calculable', motif, valeur: null, unite: e.definition.unite, periode, composantes: [], mentions: [], aExaminer: null });

  if (!exerciceValide(contexte.exercice)) return echec('Exercice invalide : dates ISO AAAA-MM-JJ attendues, clôture postérieure à l’ouverture.');
  if (contexte.lignes.length === 0) return echec('Aucune écriture fournie : indicateur non calculable.');
  const seuilBrut = options.seuilHausseDettesFiscalesSocialesPourcent ?? SEUIL_HAUSSE_DETTES_FISCALES_SOCIALES_PAR_DEFAUT;
  if (!estChaineDecimale(seuilBrut) || dec(seuilBrut).isNegative()) return echec('Option invalide : seuil de hausse des dettes fiscales et sociales (pourcentage positif en chaîne décimale attendu).');
  const seuil = dec(seuilBrut);

  const base = preparer(contexte.lignes, contexte.exercice, contexte, seuil);
  if (base.balance.lignes.length === 0) return echec(`Aucune écriture datée dans l’exercice (${contexte.exercice.debut} au ${contexte.exercice.fin}) : indicateur non calculable.`);
  const fourni = contexte.exercicePrecedent ?? null;
  let precedent: Base | null = null;
  let motifPrecedent: string | null = null;
  if (fourni !== null) {
    if (!exerciceValide(fourni.exercice)) motifPrecedent = 'Exercice précédent invalide : comparaison non établie.';
    else if (fourni.exercice.fin >= contexte.exercice.debut) motifPrecedent = 'Exercice précédent non antérieur à l’exercice : comparaison non établie.';
    else {
      precedent = preparer(fourni.lignes, fourni.exercice, contexte, seuil);
      if (precedent.balance.lignes.length === 0) { precedent = null; motifPrecedent = 'Aucune écriture datée dans l’exercice précédent : comparaison non établie.'; }
    }
  }
  const mentionsComparaison: string[] = [];
  if (precedent !== null) {
    if (precedent.nbJours !== base.nbJours) mentionsComparaison.push(`Exercices de durées différentes (${base.nbJours} jours contre ${precedent.nbJours} jours pour le précédent) : la variation est calculée sur les valeurs brutes, sans prorata.`);
    if (precedent.exercice.debut < DATE_APPLICATION_REGLEMENT_2022_06 && base.exercice.debut >= DATE_APPLICATION_REGLEMENT_2022_06) {
      mentionsComparaison.push('Exercice précédent ouvert avant le 1er janvier 2025 : le plan de comptes et la présentation ont été modifiés par le règlement ANC n° 2022-06 (résultat exceptionnel, comptes 79 supprimés…) ; comparaison à examiner.');
    }
    mentionsComparaison.push(...precedent.mentionsGenerales.map((m) => `Exercice précédent — ${m}`));
  } else if (motifPrecedent !== null) mentionsComparaison.push(motifPrecedent);

  const resultats: ValeurIndicateur[] = [];
  for (const e of selection) {
    if (typeof e === 'string') { resultats.push(...echec('').filter((r) => r.id === e && r.version === '?').slice(0, 1)); continue; }
    const { definition } = e;
    const echelle = ECHELLES[definition.unite];
    const c = e.calculer(base, precedent);
    const sensibleDuree = definition.unite !== 'euros';
    const mentions = [...c.mentions, ...base.mentionsGenerales, ...(sensibleDuree ? base.mentionsDuree : [])];
    let comparaison: ValeurIndicateur['precedent'] = null;
    if (precedent !== null) {
      const p = e.calculer(precedent, null);
      // Les signaux qui portent eux-mêmes sur deux exercices n'ont pas de valeur N-1 isolée.
      const valeurPrecedente = p.valeur;
      const variation = c.valeur !== null && valeurPrecedente !== null ? c.valeur.minus(valeurPrecedente) : null;
      const variationPourcent = variation !== null && valeurPrecedente !== null && !valeurPrecedente.isZero() ? variation.div(valeurPrecedente.abs()).times(CENT) : null;
      comparaison = {
        valeur: valeurPrecedente === null ? null : versChaine(valeurPrecedente, echelle),
        variation: variation === null ? null : versChaine(variation, echelle),
        variationPourcent: variationPourcent === null ? null : versChaine(variationPourcent, 2),
      };
      if (valeurPrecedente === null && p.motif !== null && definition.famille !== 'signal') mentions.push(`Exercice précédent non calculable : ${p.motif}`);
      if (valeurPrecedente !== null && valeurPrecedente.isZero() && c.valeur !== null) mentions.push('Base nulle sur l’exercice précédent : variation en pourcentage non calculable.');
    }
    mentions.push(...mentionsComparaison);
    resultats.push({
      id: definition.id,
      version: definition.version,
      statut: c.valeur === null ? 'non_calculable' : 'calcule',
      motif: c.valeur === null ? c.motif : null,
      valeur: c.valeur === null ? null : versChaine(c.valeur, echelle),
      unite: definition.unite,
      periode: { debut: base.exercice.debut, fin: base.exercice.fin },
      composantes: versComposantes(c.composantes),
      precedent: comparaison,
      mentions,
      aExaminer: e.signal && c.valeur !== null ? (c.aExaminer ?? null) : null,
    });
  }
  return resultats;
}

const cellule = (s: string): string => s.replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Catalogue lisible des indicateurs (Markdown), généré à partir des définitions. */
export function genererCatalogueIndicateursMarkdown(): string {
  const lignes: string[] = [
    '# Catalogue des indicateurs d’aide à la revue',
    '',
    `${CATALOGUE_INDICATEURS.length} indicateurs déterministes, calculés sur les seules écritures fournies. Ce sont des aides à la revue : aucun ne constitue une validation, une certification ou un diagnostic. ` +
      'Un indicateur dont une donnée manque rend `valeur: null` et le statut `non_calculable` avec son motif ; jamais un zéro par défaut. ' +
      'Les indicateurs de la famille `signal` sont des questions à examiner, jamais une conclusion sur la continuité d’exploitation.',
    '',
    'Échelles : euros 2 décimales, jours 1 décimale, pourcentage 2 décimales, ratio 2 décimales (arrondi comptable). ' +
      `Les formules visent le plan de comptes applicable aux exercices ouverts à compter du ${DATE_APPLICATION_REGLEMENT_2022_06} (table ${CORRESPONDANCE_PCG.id} ${CORRESPONDANCE_PCG.version}).`,
    '',
    '| Identifiant | Version | Famille | Libellé | Unité | Type de source |',
    '|---|---|---|---|---|---|',
    ...CATALOGUE_INDICATEURS.map((d) => `| ${d.id} | ${d.version} | ${d.famille} | ${cellule(d.libelle)} | ${d.unite} | ${d.source.type} |`),
    '',
  ];
  for (const d of CATALOGUE_INDICATEURS) {
    lignes.push(
      `## ${d.id} — ${d.libelle}`,
      '',
      `- **Version** : ${d.version}`,
      `- **Famille** : ${d.famille}`,
      `- **Unité** : ${d.unite}`,
      `- **Formule** : ${d.formule}`,
      `- **Convention et limites** : ${d.convention}`,
      `- **Entrées** : ${d.entrees.join(', ')}`,
      `- **Donnée manquante** : ${d.regleDonneeManquante}`,
      `- **Source** (${d.source.type}, ${d.source.verification}) : ${d.source.reference}${d.source.url ? ` — ${d.source.url}` : ''}${d.source.dateVerification ? ` (consultée le ${d.source.dateVerification})` : ''}`,
      '',
    );
  }
  return lignes.join('\n');
}
