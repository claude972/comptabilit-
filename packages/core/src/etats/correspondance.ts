/**
 * Table de correspondance comptes → rubriques des modèles du SYSTÈME DE BASE du PCG (art. 821-1 et 821-2),
 * pour les exercices ouverts à compter du 1er janvier 2025 (présentation issue du règlement ANC n° 2022-06).
 *
 * Ce qui est vérifié sur le texte : la liste et l'ordre des rubriques et postes, les intitulés des comptes.
 * Ce qui ne l'est pas : l'affectation compte par compte, que le PCG ne donne pas. Elle résulte ici d'une lecture
 * des intitulés du plan de comptes (art. 1121-1) et reste `en_attente_de_validation_professionnelle`.
 *
 * Hors périmètre : système abrégé (art. 822-1 et 822-2), annexe, liasse fiscale, tableau des flux de trésorerie.
 *
 * Comptes volontairement SANS règle (ils ressortent en « comptes non affectés » dès qu'ils portent un solde) :
 *  - classe 8 et comptes spéciaux (dont 88 « Résultat en instance d'affectation »), classes 0 et 9, numéros non numériques ;
 *  - comptes à solder ou à reclasser avant l'arrêté : 471 à 473 et 478 (art. 1214-47), 488, 58 ;
 *  - comptes dont le sens constaté est anormal : 53 créditeur (art. 1215-53), 4091/4096/4097/4098 créditeurs, 419x débiteurs ;
 *  - comptes dont la rubrique ne se déduit pas avec certitude de l'intitulé : 102, 1062, 108, 1209, 162, 18, 206 et ses amortissements/dépréciations,
 *    22 (sauf 229), 269, 277, 278, 279, 282, 292, 36, 38, 449, 509, 52, 608, 6098, 644, 646, 648, 649, 6672, 6674, 7672, 7674, 73, 79,
 *    ainsi que les comptes globaux non subdivisés quand la rubrique dépend de la subdivision (106, 15, 409, 419, 609, 681, 709…).
 *
 * Limite connue : le sens du solde est apprécié par compte général de la balance, non par tiers. Les clients créditeurs et
 * fournisseurs débiteurs noyés dans un compte collectif ne sont pas reclassés (voir le contrôle `tiers_soldes_inverses_non_reclasses`).
 */
import { estDateIso } from '../dates.js';
import { DATE_APPLICATION_REGLEMENT_2022_06, SOURCES_ETATS } from './sources.js';
import type { CorrespondanceRubriques, EtatRubrique, RegleAffectation, RubriqueDefinition } from './types.js';

type Sens = RegleAffectation['sens'];
const regle = (sens: Sens, prefixes: string[], saufPrefixes?: string[]): RegleAffectation =>
  saufPrefixes === undefined ? { prefixes, sens } : { prefixes, saufPrefixes, sens };
const solde = (prefixes: string[], sauf?: string[]): RegleAffectation => regle('solde', prefixes, sauf);
const debiteur = (prefixes: string[], sauf?: string[]): RegleAffectation => regle('debiteur', prefixes, sauf);
const crediteur = (prefixes: string[], sauf?: string[]): RegleAffectation => regle('crediteur', prefixes, sauf);
const brut = (prefixes: string[], sauf?: string[]): RegleAffectation => ({ ...regle('solde', prefixes, sauf), colonne: 'brut' });
const deduction = (prefixes: string[], sauf?: string[]): RegleAffectation => ({ ...regle('solde', prefixes, sauf), colonne: 'amortissements_depreciations' });

type Brouillon = [code: string, libelle: string, parent: string | null, regles: RegleAffectation[]];

function rubriques(etat: EtatRubrique, base: number, brouillons: Brouillon[]): RubriqueDefinition[] {
  return brouillons.map(([code, libelle, parent, regles], i) => ({ code, libelle, etat, ordre: base + (i + 1) * 10, parent, regles }));
}

/** Comptes de tiers dont le solde débiteur va en « Autres créances » et le solde créditeur dans un poste de dettes. */
const TIERS_FOURNISSEURS_EXPLOITATION = ['401', '403', '408'];
const SAUF_FOURNISSEURS_IMMOBILISATIONS = ['4084'];
const TIERS_FOURNISSEURS_IMMOBILISATIONS = ['404', '405', '4084'];
const TIERS_CLIENTS = ['411', '413', '416', '418'];
const TIERS_FISCAL_SOCIAL = ['42', '43', '44'];
const SAUF_FISCAL_SOCIAL = ['449'];
const TIERS_GROUPE_ASSOCIES_FINANCIERS = ['451', '455'];
const TIERS_ASSOCIES_AUTRES = ['456', '457', '458'];
const SAUF_CAPITAL_APPELE_NON_VERSE = ['4562'];

const ACTIF: Brouillon[] = [
  ['A_CAPITAL_SOUSCRIT_NON_APPELE', 'Capital souscrit non appelé (I)', null, [brut(['109'])]],
  ['A_FRAIS_ETABLISSEMENT', 'Frais d’établissement (II)', null, [brut(['201']), deduction(['2801', '2901'])]],
  ['A_ACTIF_IMMOBILISE', 'Total de l’actif immobilisé (III)', null, []],
  ['A_IMMOBILISATIONS_INCORPORELLES', 'Immobilisations incorporelles', 'A_ACTIF_IMMOBILISE', []],
  ['A_FRAIS_DEVELOPPEMENT', 'Frais de développement', 'A_IMMOBILISATIONS_INCORPORELLES', [brut(['203']), deduction(['2803', '2903'])]],
  ['A_CONCESSIONS_BREVETS', 'Concessions, brevets, licences, marques, procédés, solutions informatiques, droits et valeurs similaires', 'A_IMMOBILISATIONS_INCORPORELLES', [brut(['205']), deduction(['2805', '2905'])]],
  ['A_FONDS_COMMERCIAL', 'Fonds commercial', 'A_IMMOBILISATIONS_INCORPORELLES', [brut(['207']), deduction(['2807', '2907'])]],
  ['A_AUTRES_INCORPORELLES', 'Autres immobilisations incorporelles', 'A_IMMOBILISATIONS_INCORPORELLES', [brut(['208']), deduction(['2808', '2908'])]],
  ['A_INCORPORELLES_EN_COURS', 'Immobilisations incorporelles en cours, avances et acomptes', 'A_IMMOBILISATIONS_INCORPORELLES', [brut(['232', '237']), deduction(['2932'])]],
  ['A_IMMOBILISATIONS_CORPORELLES', 'Immobilisations corporelles', 'A_ACTIF_IMMOBILISE', []],
  ['A_TERRAINS', 'Terrains', 'A_IMMOBILISATIONS_CORPORELLES', [brut(['211', '212']), deduction(['2811', '2812', '2911', '2912'])]],
  ['A_CONSTRUCTIONS', 'Constructions', 'A_IMMOBILISATIONS_CORPORELLES', [brut(['213', '214']), deduction(['2813', '2814', '2913', '2914'])]],
  ['A_INSTALLATIONS_TECHNIQUES', 'Installations techniques, matériel et outillage industriels', 'A_IMMOBILISATIONS_CORPORELLES', [brut(['215']), deduction(['2815', '2915'])]],
  ['A_AUTRES_CORPORELLES', 'Autres immobilisations corporelles', 'A_IMMOBILISATIONS_CORPORELLES', [brut(['218']), deduction(['2818', '2918'])]],
  ['A_CORPORELLES_EN_COURS', 'Immobilisations corporelles en cours, avances et acomptes', 'A_IMMOBILISATIONS_CORPORELLES', [brut(['231', '238']), deduction(['2931'])]],
  ['A_IMMOBILISATIONS_FINANCIERES', 'Immobilisations financières', 'A_ACTIF_IMMOBILISE', []],
  ['A_PARTICIPATIONS', 'Participations', 'A_IMMOBILISATIONS_FINANCIERES', [brut(['261', '262', '266']), deduction(['2961', '2962', '2966'])]],
  ['A_CREANCES_PARTICIPATIONS', 'Créances rattachées à des participations', 'A_IMMOBILISATIONS_FINANCIERES', [brut(['267', '268']), deduction(['2967', '2968'])]],
  ['A_TIAP', 'Titres immobilisés de l’activité de portefeuille', 'A_IMMOBILISATIONS_FINANCIERES', [brut(['273']), deduction(['2973'])]],
  ['A_AUTRES_TITRES_IMMOBILISES', 'Autres titres immobilisés', 'A_IMMOBILISATIONS_FINANCIERES', [brut(['271', '272', '27682']), deduction(['2971', '2972'])]],
  ['A_PRETS', 'Prêts', 'A_IMMOBILISATIONS_FINANCIERES', [brut(['274', '27684']), deduction(['2974'])]],
  ['A_AUTRES_IMMOBILISATIONS_FINANCIERES', 'Autres immobilisations financières', 'A_IMMOBILISATIONS_FINANCIERES', [brut(['275', '276'], ['27682', '27684']), deduction(['2975', '2976'])]],
  ['A_ACTIF_CIRCULANT', 'Total de l’actif circulant (IV)', null, []],
  ['A_STOCKS', 'Stocks et en-cours', 'A_ACTIF_CIRCULANT', []],
  ['A_STOCKS_MATIERES', 'Matières premières et autres approvisionnements', 'A_STOCKS', [brut(['31', '32']), deduction(['391', '392'])]],
  ['A_STOCKS_EN_COURS', 'En-cours de production', 'A_STOCKS', [brut(['33', '34']), deduction(['393', '394'])]],
  ['A_STOCKS_PRODUITS_FINIS', 'Produits finis', 'A_STOCKS', [brut(['35']), deduction(['395'])]],
  ['A_STOCKS_MARCHANDISES', 'Marchandises', 'A_STOCKS', [brut(['37']), deduction(['397'])]],
  ['A_AVANCES_VERSEES', 'Avances et acomptes versés sur commandes', 'A_ACTIF_CIRCULANT', [debiteur(['4091'])]],
  ['A_CREANCES', 'Créances', 'A_ACTIF_CIRCULANT', []],
  ['A_CLIENTS', 'Créances Clients et Comptes rattachés', 'A_CREANCES', [debiteur(TIERS_CLIENTS), deduction(['491'])]],
  ['A_AUTRES_CREANCES', 'Autres créances', 'A_CREANCES', [
    debiteur(['4096', '4097', '4098']),
    debiteur([...TIERS_FOURNISSEURS_EXPLOITATION, ...TIERS_FOURNISSEURS_IMMOBILISATIONS]),
    debiteur(TIERS_FISCAL_SOCIAL, SAUF_FISCAL_SOCIAL),
    debiteur([...TIERS_GROUPE_ASSOCIES_FINANCIERS, ...TIERS_ASSOCIES_AUTRES], SAUF_CAPITAL_APPELE_NON_VERSE),
    debiteur(['46']),
    deduction(['495', '496']),
  ]],
  ['A_CHARGES_CONSTATEES_AVANCE', 'Charges constatées d’avance', 'A_ACTIF_CIRCULANT', [brut(['486'])]],
  ['A_CAPITAL_APPELE_NON_VERSE', 'Capital souscrit appelé, non versé', 'A_ACTIF_CIRCULANT', [debiteur(SAUF_CAPITAL_APPELE_NON_VERSE)]],
  ['A_VMP', 'Valeurs mobilières de placement', 'A_ACTIF_CIRCULANT', []],
  ['A_VMP_ACTIONS_PROPRES', 'Actions propres', 'A_VMP', [brut(['502'])]],
  ['A_VMP_AUTRES_TITRES', 'Autres titres', 'A_VMP', [brut(['503', '504', '505', '506', '507', '508']), deduction(['590'])]],
  ['A_INSTRUMENTS_FINANCIERS_JETONS', 'Instruments financiers à terme et jetons détenus', 'A_ACTIF_CIRCULANT', []],
  ['A_DISPONIBILITES', 'Disponibilités', 'A_ACTIF_CIRCULANT', [debiteur(['511', '512', '517', '5188', '53'])]],
  ['A_FRAIS_EMISSION_EMPRUNTS', 'Frais d’émission des emprunts (V)', null, [brut(['481'])]],
  ['A_PRIMES_REMBOURSEMENT', 'Primes de remboursement des emprunts (VI)', null, [brut(['169'])]],
  ['A_ECARTS_CONVERSION', 'Écarts de conversion et différences d’évaluation - Actif (VII)', null, [brut(['474', '476'])]],
];

const PASSIF: Brouillon[] = [
  ['P_CAPITAUX_PROPRES', 'Total des capitaux propres (I)', null, []],
  ['P_CAPITAL', 'Capital', 'P_CAPITAUX_PROPRES', [solde(['101'])]],
  ['P_PRIMES', 'Primes d’émission, de fusion, d’apport', 'P_CAPITAUX_PROPRES', [solde(['104'])]],
  ['P_ECARTS_REEVALUATION', 'Écarts de réévaluation', 'P_CAPITAUX_PROPRES', [solde(['105'])]],
  ['P_ECART_EQUIVALENCE', 'Écart d’équivalence', 'P_CAPITAUX_PROPRES', [solde(['107'])]],
  ['P_RESERVES', 'Réserves', 'P_CAPITAUX_PROPRES', []],
  ['P_RESERVE_LEGALE', 'Réserve légale', 'P_RESERVES', [solde(['1061'])]],
  ['P_RESERVES_STATUTAIRES', 'Réserves statutaires ou contractuelles', 'P_RESERVES', [solde(['1063'])]],
  ['P_RESERVES_REGLEMENTEES', 'Réserves réglementées', 'P_RESERVES', [solde(['1064'])]],
  ['P_AUTRES_RESERVES', 'Autres réserves', 'P_RESERVES', [solde(['1068'])]],
  ['P_REPORT_A_NOUVEAU', 'Report à nouveau', 'P_CAPITAUX_PROPRES', [solde(['11'])]],
  ['P_RESULTAT', 'Résultat de l’exercice [bénéfice ou perte]', 'P_CAPITAUX_PROPRES', [solde(['12'], ['1209'])]],
  ['P_SUBVENTIONS_INVESTISSEMENT', 'Subventions d’investissement', 'P_CAPITAUX_PROPRES', [solde(['13'])]],
  ['P_PROVISIONS_REGLEMENTEES', 'Provisions réglementées', 'P_CAPITAUX_PROPRES', [solde(['14'])]],
  ['P_AUTRES_FONDS_PROPRES', 'Total des autres fonds propres (II)', null, []],
  ['P_FONDS_NON_REMBOURSABLES', 'Fonds non remboursables', 'P_AUTRES_FONDS_PROPRES', [solde(['1671'])]],
  ['P_AVANCES_CONDITIONNEES', 'Avances conditionnées', 'P_AUTRES_FONDS_PROPRES', [solde(['1673', '1674'])]],
  ['P_DROITS_CONCEDANT', 'Droits du concédant', 'P_AUTRES_FONDS_PROPRES', [solde(['229'])]],
  ['P_PROVISIONS', 'Total des provisions (III)', null, []],
  ['P_PROVISIONS_RISQUES', 'Provisions pour risques', 'P_PROVISIONS', [solde(['151'])]],
  ['P_PROVISIONS_CHARGES', 'Provisions pour charges', 'P_PROVISIONS', [solde(['152'])]],
  ['P_DETTES', 'Total des dettes (IV)', null, []],
  ['P_EMPRUNTS_OBLIGATAIRES_CONVERTIBLES', 'Emprunts obligataires convertibles', 'P_DETTES', [solde(['161'])]],
  ['P_AUTRES_EMPRUNTS_OBLIGATAIRES', 'Autres emprunts obligataires', 'P_DETTES', [solde(['163'])]],
  ['P_EMPRUNTS_ETABLISSEMENTS_CREDIT', 'Emprunts et dettes auprès des établissements de crédit', 'P_DETTES', [solde(['164', '519', '5181']), crediteur(['512', '517'])]],
  ['P_EMPRUNTS_DETTES_FINANCIERES_DIVERSES', 'Emprunts et dettes financières diverses', 'P_DETTES', [solde(['165', '166', '168', '17']), crediteur(TIERS_GROUPE_ASSOCIES_FINANCIERS)]],
  ['P_INSTRUMENTS_FINANCIERS', 'Instruments financiers à terme', 'P_DETTES', []],
  ['P_AVANCES_RECUES', 'Avances et acomptes reçus sur commandes en cours', 'P_DETTES', [crediteur(['4191'])]],
  ['P_FOURNISSEURS', 'Dettes fournisseurs et comptes rattachés', 'P_DETTES', [crediteur(TIERS_FOURNISSEURS_EXPLOITATION, SAUF_FOURNISSEURS_IMMOBILISATIONS)]],
  ['P_DETTES_FISCALES_SOCIALES', 'Dettes fiscales et sociales', 'P_DETTES', [crediteur(TIERS_FISCAL_SOCIAL, SAUF_FISCAL_SOCIAL)]],
  ['P_DETTES_IMMOBILISATIONS', 'Dettes sur immobilisations et comptes rattachés', 'P_DETTES', [crediteur(TIERS_FOURNISSEURS_IMMOBILISATIONS)]],
  ['P_AUTRES_DETTES', 'Autres dettes', 'P_DETTES', [crediteur(TIERS_CLIENTS), crediteur(['4196', '4197', '4198']), crediteur(TIERS_ASSOCIES_AUTRES, SAUF_CAPITAL_APPELE_NON_VERSE), crediteur(['46'])]],
  ['P_PRODUITS_CONSTATES_AVANCE', 'Produits constatés d’avance', 'P_DETTES', [solde(['487'])]],
  ['P_ECARTS_CONVERSION', 'Écarts de conversion et différences d’évaluation - Passif (V)', null, [solde(['475', '477'])]],
];

const PRODUITS: Brouillon[] = [
  ['PE', 'Total des produits d’exploitation (I)', null, []],
  ['PE_CHIFFRE_AFFAIRES', 'Montant net du chiffre d’affaires', 'PE', []],
  ['PE_VENTES_MARCHANDISES', 'Ventes de marchandises', 'PE_CHIFFRE_AFFAIRES', [solde(['707', '7097'])]],
  ['PE_PRODUCTION_VENDUE', 'Production vendue', 'PE_CHIFFRE_AFFAIRES', [solde(['701', '702', '703', '704', '705', '706', '708', '7091', '7092', '7094', '7095', '7096', '7098'])]],
  ['PE_PRODUCTION_STOCKEE', 'Production stockée', 'PE', [solde(['71'])]],
  ['PE_PRODUCTION_IMMOBILISEE', 'Production immobilisée', 'PE', [solde(['72'])]],
  ['PE_SUBVENTIONS', 'Subventions', 'PE', [solde(['74'])]],
  ['PE_REPRISES', 'Reprises sur amortissements, dépréciations et provisions', 'PE', [solde(['7811', '7815', '7816', '7817'])]],
  ['PE_CESSIONS_IMMOBILISATIONS', 'Produits des cessions d’immobilisations incorporelles et corporelles', 'PE', [solde(['757'])]],
  ['PE_AUTRES_PRODUITS', 'Autres produits', 'PE', [solde(['751', '752', '753', '754', '756', '758'])]],
  ['QPP', 'Quote-part de résultat sur opérations faites en commun : bénéfice attribué ou perte transférée (III)', null, [solde(['755'])]],
  ['PF', 'Total des produits financiers (V)', null, []],
  ['PF_PARTICIPATION', 'De participation', 'PF', [solde(['761'])]],
  ['PF_AUTRES_VALEURS_MOBILIERES', 'D’autres valeurs mobilières et créances de l’actif immobilisé', 'PF', [solde(['762'])]],
  ['PF_AUTRES_INTERETS', 'Autres intérêts et produits assimilés', 'PF', [solde(['763', '764', '765', '768'])]],
  ['PF_REPRISES', 'Reprises sur dépréciations et provisions', 'PF', [solde(['786'])]],
  ['PF_DIFFERENCES_CHANGE', 'Différences positives de change', 'PF', [solde(['766'])]],
  ['PF_CESSIONS_IMMOBILISATIONS_FINANCIERES', 'Produits des cessions d’immobilisations financières', 'PF', [solde(['7671'])]],
  ['PF_CESSIONS_VMP', 'Produits nets sur cessions de valeurs mobilières de placement et d’instruments de trésorerie', 'PF', [solde(['7673'])]],
  ['PX', 'Produits exceptionnels (VII)', null, [solde(['77', '787'])]],
];

const CHARGES: Brouillon[] = [
  ['CE', 'Total des charges d’exploitation (II)', null, []],
  ['CE_ACHATS_MARCHANDISES', 'Achats de marchandises', 'CE', [solde(['607', '6097'])]],
  ['CE_VARIATION_STOCKS_MARCHANDISES', 'Variation de stocks (marchandises)', 'CE', [solde(['6037'])]],
  ['CE_ACHATS_MATIERES', 'Achats de matières premières et autres approvisionnements', 'CE', [solde(['601', '602', '6091', '6092'])]],
  ['CE_VARIATION_STOCKS_MATIERES', 'Variation de stocks (matières premières et approvisionnements)', 'CE', [solde(['6031', '6032'])]],
  ['CE_AUTRES_ACHATS_CHARGES_EXTERNES', 'Autres achats et charges externes', 'CE', [solde(['604', '605', '606', '6094', '6095', '6096', '61', '62'])]],
  ['CE_IMPOTS_TAXES', 'Impôts, taxes et versements assimilés', 'CE', [solde(['63'])]],
  ['CE_SALAIRES', 'Salaires', 'CE', [solde(['641'])]],
  ['CE_COTISATIONS_SOCIALES', 'Cotisations sociales', 'CE', [solde(['645', '647'])]],
  ['CE_DOTATIONS', 'Dotations aux amortissements et aux dépréciations', 'CE', []],
  ['CE_DOTATIONS_AMORTISSEMENTS', 'Sur immobilisations : dotations aux amortissements', 'CE_DOTATIONS', [solde(['6811'])]],
  ['CE_DOTATIONS_DEPRECIATIONS_IMMOBILISATIONS', 'Sur immobilisations : dotations aux dépréciations', 'CE_DOTATIONS', [solde(['6816'])]],
  ['CE_DOTATIONS_DEPRECIATIONS_ACTIF_CIRCULANT', 'Sur actif circulant : dotations aux dépréciations', 'CE_DOTATIONS', [solde(['6817'])]],
  ['CE_DOTATIONS_PROVISIONS', 'Dotations aux provisions', 'CE', [solde(['6815'])]],
  ['CE_VALEURS_COMPTABLES_CESSIONS', 'Valeurs comptables des immobilisations incorporelles et corporelles cédées', 'CE', [solde(['657'])]],
  ['CE_AUTRES_CHARGES', 'Autres charges', 'CE', [solde(['651', '653', '654', '656', '658'])]],
  ['QPC', 'Quote-part de résultat sur opérations faites en commun : perte supportée ou bénéfice transféré (IV)', null, [solde(['655'])]],
  ['CF', 'Total des charges financières (VI)', null, []],
  ['CF_DOTATIONS', 'Dotations aux amortissements, aux dépréciations et aux provisions', 'CF', [solde(['686'])]],
  ['CF_INTERETS', 'Intérêts et charges assimilées', 'CF', [solde(['661', '664', '665', '668'])]],
  ['CF_DIFFERENCES_CHANGE', 'Différences négatives de change', 'CF', [solde(['666'])]],
  ['CF_VALEURS_COMPTABLES_IMMOBILISATIONS_FINANCIERES', 'Valeurs comptables des immobilisations financières cédées', 'CF', [solde(['6671'])]],
  ['CF_CESSIONS_VMP', 'Charges nettes sur cessions de valeurs mobilières de placement et d’instruments de trésorerie', 'CF', [solde(['6673'])]],
  ['CX', 'Charges exceptionnelles (VIII)', null, [solde(['67', '687'])]],
  ['PART', 'Participation des salariés aux résultats (IX)', null, [solde(['691'])]],
  ['IS', 'Impôts sur les bénéfices (X)', null, [solde(['695', '696', '698', '699'])]],
];

/**
 * Codes de rubriques RÉSERVÉS, utilisés par les projections pour calculer les niveaux de résultat et porter le résultat au bilan :
 * compte de résultat : PE, CE, QPP, QPC, PF, CF, PX, CX, PART, IS ; bilan : P_RESULTAT.
 */
export const CODES_RUBRIQUES_RESERVES = Object.freeze(['PE', 'CE', 'QPP', 'QPC', 'PF', 'CF', 'PX', 'CX', 'PART', 'IS', 'P_RESULTAT'] as const);

/** Version en vigueur, vérifiée sur le PCG consolidé au 1er janvier 2026. */
export const CORRESPONDANCE_PCG: CorrespondanceRubriques = {
  id: 'PCG-SYSTEME-DE-BASE',
  version: '2025.1',
  periodeApplication: `Exercices ouverts à compter du ${DATE_APPLICATION_REGLEMENT_2022_06} (modèles des art. 821-1 et 821-2 du PCG issus du règlement ANC n° 2022-06).`,
  source: SOURCES_ETATS.modelesSystemeDeBase,
  etat: 'en_attente_de_validation_professionnelle',
  rubriques: [...rubriques('bilan_actif', 1000, ACTIF), ...rubriques('bilan_passif', 2000, PASSIF), ...rubriques('resultat_produits', 3000, PRODUITS), ...rubriques('resultat_charges', 4000, CHARGES)],
};

/**
 * Table applicable à un exercice selon sa date d'ouverture. Rend `null` pour un exercice ouvert avant le 1er janvier 2025 :
 * les modèles et le plan de comptes antérieurs au règlement ANC n° 2022-06 (résultat exceptionnel « par nature », comptes 79,
 * 675/775…) n'ont pas été vérifiés et ne sont pas fournis — mieux vaut aucun état qu'un état projeté sur la mauvaise présentation.
 */
export function correspondancePour(exerciceDebut: string): CorrespondanceRubriques | null {
  if (!estDateIso(exerciceDebut)) throw new Error('Date d’ouverture d’exercice invalide : date ISO AAAA-MM-JJ attendue.');
  return exerciceDebut >= DATE_APPLICATION_REGLEMENT_2022_06 ? CORRESPONDANCE_PCG : null;
}

/** Contrôle de forme d'une table : codes uniques, parents existants, pas de règle sur une rubrique de regroupement. Liste d'erreurs (vide si la table est cohérente). */
export function verifierCorrespondance(c: CorrespondanceRubriques): string[] {
  const erreurs: string[] = [];
  const parCode = new Map<string, RubriqueDefinition>();
  for (const r of c.rubriques) {
    if (parCode.has(r.code)) erreurs.push(`Code de rubrique en double : ${r.code}.`);
    parCode.set(r.code, r);
  }
  const parents = new Set(c.rubriques.map((r) => r.parent).filter((p): p is string => p !== null));
  for (const r of c.rubriques) {
    if (r.parent !== null) {
      const p = parCode.get(r.parent);
      if (p === undefined) erreurs.push(`Rubrique ${r.code} : parent inconnu ${r.parent}.`);
      else if (p.etat !== r.etat) erreurs.push(`Rubrique ${r.code} : parent ${r.parent} d’un autre état.`);
    }
    if (parents.has(r.code) && r.regles.length > 0) erreurs.push(`Rubrique de regroupement ${r.code} : aucune règle d’affectation attendue.`);
    for (const g of r.regles) {
      if (g.prefixes.length === 0 || [...g.prefixes, ...(g.saufPrefixes ?? [])].some((p) => !/^\d{1,12}$/.test(p))) erreurs.push(`Rubrique ${r.code} : préfixe de compte invalide.`);
      if (g.colonne === 'amortissements_depreciations' && r.etat !== 'bilan_actif') erreurs.push(`Rubrique ${r.code} : colonne amortissements et dépréciations réservée à l’actif.`);
    }
    // Cycle dans la hiérarchie.
    const vus = new Set<string>([r.code]);
    for (let p = r.parent; p !== null; p = parCode.get(p)?.parent ?? null) {
      if (vus.has(p)) { erreurs.push(`Rubrique ${r.code} : hiérarchie cyclique.`); break; }
      vus.add(p);
    }
  }
  return erreurs;
}
