/**
 * Moteur générique des tableaux « en grille » saisis ligne par ligne (D-122) : 2059-B (plus-values à court terme et de fusion), 2059-C
 * (moins-values à long terme) et 2059-D (réserve spéciale des plus-values à long terme), régime réel normal.
 *
 * Mêmes principes que D-112 et D-121 : saisie justifiée, tracée, historisée ; « néant » explicite du formulaire ; une ligne fixe non saisie n'est
 * jamais présumée nulle (zéro explicite exigé) ; AUCUNE décision fiscale ; seuls les calculs énoncés par le formulaire (lignes « TOTAL », « TOTAL
 * (lignes 1 et 2) », « solde (2 + 3 − 4 − 5) »…) sont faits, et seulement quand toutes leurs composantes sont saisies : sinon abstention motivée,
 * sans chiffre. Statut « projet ».
 *
 * Disposition lue sur `2050-liasse_5320.pdf` (SHA-256 0bba3352…f8453e1), pages 14 (2059-B), 15 (2059-C) et 16 (2059-D), vérifiée sur le rendu
 * image le 2026-11-22. Ces tableaux n'ont pas de code de case.
 */
import { Decimal } from 'decimal.js';
import { type ChaineDecimale, versChaine } from '../montant.js';
import type { ControleDetail } from './detail-resultat.js';
import type { SaisieTableau, StatutLigneSaisie, TraceSaisie } from './saisies-tableaux.js';
import { MENTION_PROJET } from './sources-fiscales.js';

export interface ColonneGrille {
  cle: string;
  libelle: string;
  /** Montant algébrique (le formulaire demande d'indiquer + ou −) ; sinon positif. */
  signe?: boolean;
  /** Nature de la colonne : montant (défaut) ou date (AAAA-MM-JJ, jour réel du calendrier). */
  type?: 'montant' | 'date' | 'texte' | 'annee';
}
export interface LigneGrille {
  ligne: string;
  libelle: string;
  groupe?: string;
  /** Colonnes servies sur cette ligne (les autres sont grisées sur le formulaire). Défaut : toutes. */
  colonnes?: readonly string[];
}
/** Une ligne calculée : pour chaque colonne, somme signée des références (lignes saisies ou calculées) ; `'saisies'` = toutes les lignes saisies d'une grille libre. */
export interface CalculGrille {
  id: string;
  libelle: string;
  colonnes: readonly string[];
  termes: ReadonlyArray<{ ref: readonly string[] | 'saisies'; signe: 1 | -1 }>;
}
export interface CadreGrille {
  tableau: string;
  titre: string;
  colonnes: readonly ColonneGrille[];
  lignes: readonly LigneGrille[];
  /** Grille libre : lignes 01 à `max` avec un libellé d'origine saisi. */
  libre?: { max: number; libelleOrigine: string };
  calculs: readonly CalculGrille[];
  /** Contrôle indicatif de ventilation : sur chaque ligne saisie, la colonne `total` égale la somme des colonnes `parties` (les colonnes absentes de la ligne ne sont pas contrôlées). */
  ventilation?: { total: string; parties: readonly string[] };
  /** Rapprochements indicatifs avec des valeurs d'AUTRES tableaux (`valeursAutres`) : somme d'une colonne ou nombre de lignes saisies. Sans valeur externe, aucun contrôle. */
  controlesExternes?: ReadonlyArray<{ code: string; libelle: string; mode: 'somme' | 'nombre'; colonne?: string; externe: string }>;
  /** Contrôles indicatifs d'ordre entre deux colonnes date d'une même ligne (la première ne doit pas suivre la seconde). */
  ordreDates?: ReadonlyArray<[string, string]>;
  /** Colonne calculée par ligne : somme signée d'autres colonnes de la MÊME ligne (les colonnes non servies sont ignorées). */
  colonneCalculee?: { cle: string; libelle: string; termes: ReadonlyArray<{ col: string; signe: 1 | -1 }> };
}
export interface DefinitionGrille {
  id: '2059-B' | '2059-C' | '2059-D' | '2065' | '2033-E-DATES' | '2057' | '2065-BIS' | '2033-D-982' | '2058-B-K4BIS' | '2058-A-FEUILLETS';
  titre: string;
  /** Tableau portant la ligne NEANT du formulaire ; absent si le formulaire n'a pas de « néant » (le 2065 est toujours servi). */
  neantSur?: string;
  cadres: readonly CadreGrille[];
  nonPrepare: readonly string[];
}

const cols = (...x: Array<[string, string]>): ColonneGrille[] => x.map(([cle, libelle]) => ({ cle, libelle }));
const C59B = cols(['a', 'Montant net des plus-values réalisées à l’origine'], ['b', 'Montant antérieurement réintégré'], ['c', 'Montant compris dans le résultat de l’exercice (rapporté)'], ['d', 'Montant restant à réintégrer']);
const N10 = Array.from({ length: 10 }, (_, i) => `N${i + 1}`);

export const GRILLES_2059: readonly DefinitionGrille[] = [
  {
    id: '2059-B',
    titre: 'Suivi des plus-values à court terme et des plus-values de fusion ou d’apport',
    neantSur: '2059B_A',
    cadres: [
      {
        tableau: '2059B_A',
        titre: 'A — Éléments assujettis au régime fiscal des plus-values à court terme',
        colonnes: C59B,
        lignes: [
          { ligne: 'E3', libelle: 'Réalisées au cours de l’exercice — sur 3 ans (entreprises à l’IR)', groupe: 'Plus-values de l’exercice', colonnes: ['a', 'c', 'd'] },
          { ligne: 'E10', libelle: 'Réalisées au cours de l’exercice — sur 10 ans', groupe: 'Plus-values de l’exercice', colonnes: ['a', 'c', 'd'] },
          { ligne: 'EDD', libelle: 'Réalisées au cours de l’exercice — sur une durée différente (art. 39 quaterdecies 1 ter du CGI)', groupe: 'Plus-values de l’exercice', colonnes: ['a', 'c', 'd'] },
          { ligne: 'T3N1', libelle: 'Exercices antérieurs — sur 3 ans — N-1', groupe: 'Plus-values des exercices antérieurs' },
          { ligne: 'T3N2', libelle: 'Exercices antérieurs — sur 3 ans — N-2', groupe: 'Plus-values des exercices antérieurs' },
          ...Array.from({ length: 9 }, (_, i) => ({ ligne: `T10N${i + 1}`, libelle: `Exercices antérieurs — sur 10 ans ou durée différente — N-${i + 1}`, groupe: 'Plus-values des exercices antérieurs' })),
        ],
        calculs: [
          { id: 'TOTAL1', libelle: 'TOTAL 1 (plus-values de l’exercice)', colonnes: ['a', 'c', 'd'], termes: [{ ref: ['E3', 'E10', 'EDD'], signe: 1 }] },
          { id: 'TOTAL2', libelle: 'TOTAL 2 (plus-values des exercices antérieurs)', colonnes: ['a', 'b', 'c', 'd'], termes: [{ ref: ['T3N1', 'T3N2', ...Array.from({ length: 9 }, (_, i) => `T10N${i + 1}`)], signe: 1 }] },
        ],
      },
      {
        tableau: '2059B_B',
        titre: 'B — Plus-values réintégrées dans les résultats des sociétés bénéficiaires des apports',
        colonnes: C59B,
        lignes: [],
        libre: { max: 14, libelleOrigine: 'Origine des plus-values et date des fusions ou des apports' },
        calculs: [{ id: 'TOTALB', libelle: 'TOTAL (cadre B)', colonnes: ['a', 'b', 'c', 'd'], termes: [{ ref: 'saisies', signe: 1 }] }],
      },
    ],
    nonPrepare: [
      'Identification de l’entreprise, exercice et cases à cocher (plus-values de fusion ou de scission, d’apport à une société par une entreprise individuelle) : non préparées.',
      'Aucun lien automatique avec le 2059-A ni le 2058-A : le cabinet reporte lui-même les montants.',
      'Plus de quatorze lignes d’origine au cadre B : tableaux supplémentaires non préparés.',
    ],
  },
  {
    id: '2059-C',
    titre: 'Suivi des moins-values à long terme',
    neantSur: '2059C_I',
    cadres: [
      {
        tableau: '2059C_I',
        titre: 'I — Suivi des moins-values des entreprises soumises à l’impôt sur le revenu (taux de 12,8 %)',
        colonnes: cols(['c2', '2 Moins-values à 12,8 %'], ['c3', '3 Imputations sur les plus-values à long terme de l’exercice imposables à 12,8 %'], ['c4', '4 Solde des moins-values à 12,8 %']),
        lignes: [{ ligne: 'N', libelle: 'Moins-values nettes N', colonnes: ['c2', 'c4'] }, ...N10.map((n, i) => ({ ligne: n, libelle: `Moins-values nettes à long terme subies au cours des dix exercices antérieurs — N-${i + 1}` }))],
        calculs: [],
      },
      {
        tableau: '2059C_II',
        titre: 'II — Suivi des moins-values à long terme des entreprises soumises à l’impôt sur les sociétés',
        colonnes: cols(['c2', '2 Moins-values à 19 % ou à 15 %'], ['c3', '3 À 19 % ou 15 % imputables sur le résultat de l’exercice'], ['c4', '4 Imputations sur les plus-values à long terme à 15 % ou 19 %'], ['c5', '5 Imputations sur le résultat de l’exercice']),
        lignes: [{ ligne: 'N', libelle: 'Moins-values nettes N', colonnes: ['c2', 'c3', 'c5'] }, ...N10.map((n, i) => ({ ligne: n, libelle: `Moins-values nettes à long terme subies au cours des exercices antérieurs — N-${i + 1}` }))],
        calculs: [],
        colonneCalculee: { cle: 'c6', libelle: '6 Solde des moins-values à reporter (2 + 3 − 4 − 5)', termes: [{ col: 'c2', signe: 1 }, { col: 'c3', signe: 1 }, { col: 'c4', signe: -1 }, { col: 'c5', signe: -1 }] },
      },
    ],
    nonPrepare: [
      'Identification de l’entreprise, exercice et rappels cochables du haut du tableau (taux de 15 % ou 12,8 %, titres à prépondérance immobilière, prix de revient supérieur à 22,8 M€) : non préparés.',
      'Imputation automatique des moins-values sur les plus-values du 2059-A : non préparée ; aucune décision d’imputation.',
    ],
  },
  {
    id: '2059-D',
    titre: 'Réserve spéciale des plus-values à long terme ; réserve spéciale des provisions pour fluctuation des cours',
    neantSur: '2059D_I',
    cadres: [
      {
        tableau: '2059D_I',
        titre: 'I — Situation du compte affecté à l’enregistrement de la réserve spéciale pour l’exercice N (sous-comptes de la réserve spéciale des plus-values à long terme)',
        colonnes: cols(['t10', 'Taxées à 10 %'], ['t15', 'Taxées à 15 %'], ['t18', 'Taxées à 18 %'], ['t19', 'Taxées à 19 %'], ['t25', 'Taxées à 25 %']),
        lignes: [
          { ligne: 'L1', libelle: '1 Montant de la réserve spéciale à la clôture de l’exercice précédent (N − 1)' },
          { ligne: 'L2', libelle: '2 Réserves figurant au bilan des sociétés absorbées au cours de l’exercice' },
          { ligne: 'L4', libelle: '4 Prélèvements opérés — donnant lieu à complément d’IS' },
          { ligne: 'L5', libelle: '5 Prélèvements opérés — ne donnant pas lieu à complément d’IS' },
        ],
        calculs: [
          { id: 'L3', libelle: '3 TOTAL (lignes 1 et 2)', colonnes: ['t10', 't15', 't18', 't19', 't25'], termes: [{ ref: ['L1', 'L2'], signe: 1 }] },
          { id: 'L6', libelle: '6 TOTAL (lignes 4 et 5)', colonnes: ['t10', 't15', 't18', 't19', 't25'], termes: [{ ref: ['L4', 'L5'], signe: 1 }] },
          { id: 'L7', libelle: '7 Montant de la réserve spéciale à la clôture de l’exercice (ligne 3 − ligne 6)', colonnes: ['t10', 't15', 't18', 't19', 't25'], termes: [{ ref: ['L3'], signe: 1 }, { ref: ['L6'], signe: -1 }] },
        ],
      },
      {
        tableau: '2059D_II',
        titre: 'II — Réserve spéciale des provisions pour fluctuation des cours (5e, 6e, 7e alinéas de l’article 39-1-5e du CGI)',
        colonnes: cols(['c1', '1 Montant de la réserve à l’ouverture de l’exercice'], ['c2', '2 Réserve figurant au bilan des sociétés absorbées au cours de l’année'], ['c3', '3 Montants prélevés — donnant lieu à complément d’impôt'], ['c4', '4 Montants prélevés — ne donnant pas lieu à complément d’impôt'], ['c5', '5 Montant de la réserve à la clôture de l’exercice']),
        lignes: [{ ligne: 'U', libelle: 'Réserve spéciale des provisions pour fluctuation des cours' }],
        calculs: [],
      },
    ],
    nonPrepare: [
      'Identification de l’entreprise, exercice : non préparés. Tableau réservé aux personnes morales soumises à l’impôt sur les sociétés (formulaire).',
      'Le montant de la clôture du cadre II (colonne 5) n’est pas calculé : le formulaire n’en énonce pas la formule ; il est saisi par le cabinet.',
    ],
  },
];


const unique = (tableau: string, titre: string, lignes: Array<[string, string]>, signe = false): CadreGrille => ({ tableau, titre, colonnes: [{ cle: 'm', libelle: 'Montant', signe }], lignes: lignes.map(([ligne, libelle]) => ({ ligne, libelle })), calculs: [] });
/** Déclaration de résultats de l'IS 2065-SD, page 1 (régimes réel normal et simplifié) : cadres C, D, E, F (CES) et I (CTM). */
export const GRILLE_2065: DefinitionGrille = {
  id: '2065',
  titre: 'Déclaration de résultats de l’impôt sur les sociétés (2065-SD) — récapitulation des éléments d’imposition et contributions',
  cadres: [
    unique('2065_C1', 'C 1 — Résultat fiscal', [['BN', 'Bénéfice imposable au taux normal'], ['DEF', 'Déficit'], ['B10', 'Résultat net de cession, de concession ou de sous-concession des brevets et droits de propriété industrielle assimilés imposable au taux de 10 %'], ['B15', 'Bénéfice imposable à 15 %']]),
    unique('2065_C2', 'C 2 — Plus-values', [['PV15', 'PV à long terme imposables à 15 %'], ['PV19', 'PV à long terme imposables à 19 %'], ['PVEX', 'PV exonérées (art. 238 quindecies)'], ['AUT19', 'Autres PV imposables à 19 %'], ['PV0', 'PV à long terme imposables à 0 %']]),
    unique('2065_C3', 'C 3 — Abattements sur le bénéfice et exonérations', [
      ['JEI', 'Jeunes entreprises innovantes, art. 44 sexies-0 A'],
      ['EN', 'Entreprise nouvelle, art. 44 sexies'],
      ['AUTD', 'Autres dispositifs'],
      ['FRRA', 'France ruralités revitalisation FRR, art. 44 quindecies A'],
      ['ZFAN', 'Zone franche d’activité nouvelle génération, art. 44 quaterdecies'],
      ['ZRD', 'Zone de restructuration de la défense, art. 44 terdecies'],
      ['BUD', 'Bassins urbains à dynamiser (BUD), art. 44 sexdecies'],
      ['ZFU', 'Zone franche urbaine – Territoire entrepreneur, art. 44 octies A'],
      ['ZRR', 'Zone de revitalisation rurale, art. 44 quindecies'],
      ['BER', 'Bassins d’emploi à redynamiser (art. 44 duodecies)'],
      ['ZDP', 'Zone de développement prioritaire, art. 44 septdecies'],
      ['PVSIIC', 'Société d’investissement immobilier cotée — plus-values exonérées relevant du taux de 15 %'],
    ]),
    unique('2065_C4', 'C 3 (suite) — Société d’investissement immobilier cotée : bénéfice ou déficit exonéré (indiquer + ou − selon le cas)', [['SIIC', 'Bénéfice ou déficit exonéré']], true),
    unique('2065_F', 'F — Contribution exceptionnelle sur les bénéfices des grandes entreprises (CES)', [['BASE', 'Base d’imposition'], ['CA', 'Chiffre d’affaires'], ['TAUX', 'Taux d’imposition']]),
    unique('2065_I', 'I — Contribution exceptionnelle sur les grandes entreprises de transport maritime (CTM)', [['BASE', 'Base d’imposition'], ['TAUX', 'Taux d’imposition']]),
    unique('2065_D', 'D — Imputations', [['D1', '1. Au titre des revenus mobiliers de source française ou étrangère, ayant donné lieu à la délivrance d’un certificat de crédits d’impôts'], ['D2', '2. Au titre des revenus auxquels est attaché, en vertu d’une convention fiscale, un crédit d’impôt représentatif de l’impôt de l’État, territoire ou collectivité étranger']]),
    unique('2065_E', 'E — Contribution annuelle sur les revenus locatifs', [['REC', 'Recettes nettes soumises à la contribution de 2,5 %']]),
  ],
  nonPrepare: [
    'Identification de l’entreprise, régime fiscal des groupes, activité, exercice, option pour le régime du tonnage, PME innovante : reprises du dossier, non ressaisies ici.',
    'Cases à cocher (option pour le crédit d’impôt outre-mer, art. 244 quater W ; comptabilité informatisée et logiciel) et rubriques de signature, professionnel de l’expertise comptable, examen de conformité fiscale : non préparées.',
    'Annexe 2065 bis-SD (répartition des revenus distribués, rémunérations versées aux associés, divers, MVLT du régime simplifié, dons) : non préparée.',
    'Liquidation de l’impôt : calculée par l’administration au dépôt électronique, non préparée ici ; aucun montant d’impôt n’est calculé.',
    'Report depuis les tableaux 2058-A, 2033-D, 2059-A à D : non automatique ; les montants du cadre C sont saisis par le cabinet.',
  ],
};

/** Dates du formulaire 2033-E-SD / 2059-E-SD (page 5 de `2033-sd_5394.pdf`) : période de référence (cases 024 et 016) et date de cessation. Mêmes saisies aux deux régimes. */
export const GRILLE_DATES_CVAE: DefinitionGrille = {
  id: '2033-E-DATES',
  titre: 'Déclaration des effectifs et valeur ajoutée (2033-E / 2059-E) — période de référence et date de cessation',
  cadres: [
    {
      tableau: '2033E_DATES',
      titre: 'Dates du cadre « mono-établissement » du formulaire',
      colonnes: [
        { cle: 'debut', libelle: 'Période de référence : du (case 024) — AAAA-MM-JJ', type: 'date' },
        { cle: 'fin', libelle: 'Période de référence : au (case 016) — AAAA-MM-JJ', type: 'date' },
        { cle: 'cessation', libelle: 'Date de cessation — AAAA-MM-JJ', type: 'date' },
      ],
      lignes: [
        { ligne: 'PER', libelle: 'Période de référence (cases 024 et 016)', colonnes: ['debut', 'fin'] },
        { ligne: 'CES', libelle: 'Date de cessation', colonnes: ['cessation'] },
      ],
      calculs: [],
      ordreDates: [['debut', 'fin']],
    },
  ],
  nonPrepare: [
    'Aucune proposition n’est reprise des dates de l’exercice : la période de référence de la CVAE est déclarée par le cabinet, justifiée.',
    'La date de cessation n’est servie qu’en cas de cessation d’activité : une ligne non saisie n’est pas présumée vide (elle n’a simplement pas été déclarée).',
  ],
};

const cr = (...x: Array<[string, string]>): ColonneGrille[] => x.map(([cle, libelle]) => ({ cle, libelle }));
const ligne = (code: string, libelle: string, colonnes?: readonly string[]): LigneGrille => ({ ligne: code, libelle: `${libelle} (code ${code})`, ...(colonnes ? { colonnes } : {}) });
const CREANCES: LigneGrille[] = [
  ligne('UL', 'Actif immobilisé — créances rattachées à des participations'),
  ligne('UP', 'Actif immobilisé — prêts (1) (2)'),
  ligne('UT', 'Actif immobilisé — autres immobilisations financières'),
  ligne('VA', 'Actif circulant — clients douteux ou litigieux'),
  ligne('UX', 'Actif circulant — autres créances clients'),
  ligne('Z1', 'Actif circulant — créance représentative de titres prêtés ou remis en garantie'),
  ligne('UY', 'Actif circulant — personnel et comptes rattachés'),
  ligne('UZ', 'Actif circulant — sécurité sociale et autres organismes sociaux'),
  ligne('VM', 'État et autres collectivités publiques — impôts sur les bénéfices'),
  ligne('VB', 'État et autres collectivités publiques — taxe sur la valeur ajoutée'),
  ligne('VN', 'État et autres collectivités publiques — autres impôts, taxes et versements assimilés'),
  ligne('VP', 'État et autres collectivités publiques — divers'),
  ligne('VC', 'Actif circulant — groupe et associés (2)'),
  ligne('VR', 'Actif circulant — débiteurs divers (dont créances relatives à des opérations de pension de titres)'),
  ligne('VS', 'Charges constatées d’avance'),
];
const DETTES: LigneGrille[] = [
  ligne('7Y', 'Emprunts obligataires convertibles (1)'),
  ligne('7Z', 'Autres emprunts obligataires (1)'),
  ligne('VG', 'Emprunts et dettes auprès des établissements de crédit (1) — à 1 an maximum à l’origine'),
  ligne('VH', 'Emprunts et dettes auprès des établissements de crédit (1) — à plus d’1 an à l’origine'),
  ligne('8A', 'Emprunts et dettes financières divers (1) (2)'),
  ligne('8B', 'Fournisseurs et comptes rattachés'),
  ligne('8C', 'Personnel et comptes rattachés'),
  ligne('8D', 'Sécurité sociale et autres organismes sociaux'),
  ligne('8E', 'État et autres collectivités publiques — impôts sur les bénéfices'),
  ligne('VW', 'État et autres collectivités publiques — taxe sur la valeur ajoutée'),
  ligne('VX', 'État et autres collectivités publiques — obligations cautionnées'),
  ligne('VQ', 'État et autres collectivités publiques — autres impôts, taxes et assimilées'),
  ligne('8J', 'Dettes sur immobilisations et comptes rattachés'),
  ligne('VI', 'Groupe et associés (2)'),
  ligne('8K', 'Autres dettes (dont dettes relatives à des opérations de pension de titres)'),
  ligne('Z2', 'Dette représentative de titres empruntés ou remis en garantie'),
  ligne('8L', 'Produits constatés d’avance'),
];
/** État des échéances des créances et des dettes à la clôture de l'exercice (2057-SD, page 9 de `2050-liasse_5320.pdf`, régime réel normal). */
export const GRILLE_2057: DefinitionGrille = {
  id: '2057',
  titre: 'État des échéances des créances et des dettes à la clôture de l’exercice',
  neantSur: '2057_A',
  cadres: [
    {
      tableau: '2057_A',
      titre: 'Cadre A — État des créances',
      colonnes: cr(['c1', '1 Montant brut'], ['c2', '2 À 1 an au plus'], ['c3', '3 À plus d’un an']),
      lignes: CREANCES,
      calculs: [{ id: 'VT_VU_VV', libelle: 'TOTAUX (codes VT, VU, VV)', colonnes: ['c1', 'c2', 'c3'], termes: [{ ref: CREANCES.map((l) => l.ligne), signe: 1 }] }],
      ventilation: { total: 'c1', parties: ['c2', 'c3'] },
    },
    {
      tableau: '2057_AX',
      titre: 'Cadre A — Provision antérieurement constituée et renvois',
      colonnes: cr(['m', 'Montant']),
      lignes: [
        ligne('UO', 'Provisions pour dépréciation antérieurement constituée sur créance représentative de titres prêtés ou remis en garantie'),
        ligne('VD', 'Renvoi (1) — montant des prêts accordés en cours d’exercice'),
        ligne('VE', 'Renvoi (1) — montant des remboursements obtenus en cours d’exercice'),
        ligne('VF', 'Renvoi (2) — prêts et avances consentis aux associés (personnes physiques)'),
      ],
      calculs: [],
    },
    {
      tableau: '2057_B',
      titre: 'Cadre B — État des dettes',
      colonnes: cr(['c1', '1 Montant brut'], ['c2', '2 À 1 an au plus'], ['c3', '3 À plus d’1 an et 5 ans au plus'], ['c4', '4 À plus de 5 ans']),
      lignes: DETTES,
      calculs: [{ id: 'VY_VZ', libelle: 'TOTAUX (codes VY, VZ)', colonnes: ['c1', 'c2', 'c3', 'c4'], termes: [{ ref: DETTES.map((l) => l.ligne), signe: 1 }] }],
      ventilation: { total: 'c1', parties: ['c2', 'c3', 'c4'] },
    },
    {
      tableau: '2057_BX',
      titre: 'Cadre B — Renvois',
      colonnes: cr(['m', 'Montant']),
      lignes: [
        ligne('VJ', 'Renvoi (1) — emprunts souscrits en cours d’exercice'),
        ligne('VK', 'Renvoi (1) — emprunts remboursés en cours d’exercice'),
        ligne('VL', 'Renvoi (2) — montant des divers emprunts et dettes contractés auprès des associés, personnes physiques'),
      ],
      calculs: [],
    },
  ],
  nonPrepare: [
    'Identification de l’entreprise et exercice : repris du dossier, non ressaisis ici.',
    'Aucun montant n’est déduit de la balance : l’échéance d’une créance ou d’une dette ne figure pas à la balance ; chaque ligne est une saisie justifiée du cabinet.',
    'Seule la colonne « montant brut » a un code imprimé sur la plupart des lignes (UM, UN, UR, US, UV, UW pour les trois premières lignes des créances) ; les codes des autres cellules ne sont pas imprimés sur le formulaire.',
    'Relation avec les postes du bilan (2050, 2051) : non automatique ; aucun rapprochement n’est supposé.',
  ],
};

const mt = (cle: string, libelle: string): ColonneGrille => ({ cle, libelle });
const lg = (ligne: string, libelle: string, colonnes?: readonly string[]): LigneGrille => ({ ligne, libelle, ...(colonnes ? { colonnes } : {}) });
/** Annexe 2065 bis-SD (page 2 de `2065-sd_5381.pdf`) : cadres G, H, I, J, K. Lettres de lignes du cadre G en majuscules (a → A). */
export const GRILLE_2065_BIS: DefinitionGrille = {
  id: '2065-BIS',
  titre: 'Annexe au formulaire 2065-SD (2065 bis-SD) — revenus distribués, rémunérations, divers, régime simplifié, dons',
  cadres: [
    {
      tableau: '2065B_G',
      titre: 'G — Répartition des produits des actions et parts sociales, ainsi que des revenus assimilés distribués',
      colonnes: [mt('m', 'Montant')],
      lignes: [
        lg('A', 'a — Montant global brut des distributions payées par la société elle-même'),
        lg('B', 'b — Montant global brut des distributions payées par un établissement chargé du service des titres'),
        lg('C', 'c — Montant des distributions correspondant à des rémunérations ou avantages dont la société ne désigne pas le (les) bénéficiaire(s)'),
        lg('D', 'd — Montant des prêts, avances ou acomptes consentis aux associés, actionnaires et porteurs de parts, directement ou par personnes interposées'),
        lg('E', 'e — Montant des distributions autres que celles visées en (a), (b), (c) et (d) ci-dessus (ligne 1)'),
        lg('F', 'f — Montant des distributions autres (ligne 2)'),
        lg('G', 'g — Montant des distributions autres (ligne 3)'),
        lg('H', 'h — Montant des distributions autres (ligne 4)'),
        lg('I', 'i — Montant des revenus distribués éligibles à l’abattement de 40 % prévu au 2° du 3 de l’article 158 du CGI'),
        lg('J', 'j — Montant des revenus distribués non éligibles à l’abattement de 40 % prévu au 2° du 3 de l’article 158 du CGI'),
      ],
      calculs: [{ id: 'TOTAL_AH', libelle: 'Montant des revenus répartis (Total a à h)', colonnes: ['m'], termes: [{ ref: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], signe: 1 }] }],
    },
    {
      tableau: '2065B_H',
      titre: 'H — Rémunérations nettes versées aux membres de certaines sociétés (SARL, SCA, SNC ou SCS, SEP et sociétés de copropriétaires de navires)',
      colonnes: [
        mt('c2', '2 Nombre de parts sociales appartenant à chaque associé en toute propriété ou en usufruit (SARL)'),
        { cle: 'c3', libelle: '3 Année au cours de laquelle le versement a été effectué', type: 'annee' },
        mt('c4', '4 À titre de traitements, émoluments et indemnités proprement dits'),
        mt('c5', '5 Frais de représentation, de mission et de déplacement : indemnités forfaitaires'),
        mt('c6', '6 Frais de représentation, de mission et de déplacement : remboursements'),
        mt('c7', '7 Frais professionnels autres que ceux visés aux colonnes 5 et 6 : indemnités forfaitaires'),
        mt('c8', '8 Frais professionnels autres que ceux visés aux colonnes 5 et 6 : remboursements'),
      ],
      lignes: [],
      libre: { max: 10, libelleOrigine: '1 Nom, prénoms, domicile et qualité' },
      calculs: [],
    },
    {
      tableau: '2065B_I',
      titre: 'I — Divers',
      colonnes: [{ cle: 't', libelle: 'Texte', type: 'texte' }],
      lignes: [lg('PROP', 'Nom et adresse du propriétaire du fonds (en cas de gérance libre)'), lg('ETAB', 'Adresses des autres établissements (si ce cadre est insuffisant, joindre un état du même modèle)')],
      calculs: [],
    },
    {
      tableau: '2065B_J1',
      titre: 'J — Cadre ne concernant que les entreprises placées sous le régime simplifié d’imposition : rémunérations',
      colonnes: [mt('m', 'Montant')],
      lignes: [lg('SAL', 'Montant brut des salaires, abstraction faite des sommes comprises dans les DSN et versées aux apprentis sous contrat et aux handicapés'), lg('RETRO', 'Rétrocessions d’honoraires, de commissions et de courtages')],
      calculs: [],
    },
    {
      tableau: '2065B_J2',
      titre: 'J — Moins-values à long terme imposées à 0 %, 15 % ou 19 %',
      colonnes: [mt('m0', 'À 0 %'), mt('m15', 'À 15 %'), mt('m19', 'À 19 %')],
      lignes: [lg('OUVERT', 'MVLT restant à reporter à l’ouverture de l’exercice'), lg('IMPUTE', 'MVLT imputée sur les PVLT de l’exercice'), lg('REALISE', 'MVLT réalisée au cours de l’exercice'), lg('REPORT', 'MVLT restant à reporter')],
      calculs: [],
    },
    {
      tableau: '2065B_K',
      titre: 'K — Cadre ne concernant que les organismes bénéficiaires de dons (article 222 bis du CGI)',
      colonnes: [mt('m', 'Montant ou nombre')],
      lignes: [lg('DONS', 'Montant cumulé des dons et versements mentionnés sur les reçus, attestations ou autres documents et perçus au titre de l’exercice'), lg('RECUS', 'Nombre de reçus, attestations ou autres documents délivrés au titre de l’exercice')],
      calculs: [],
    },
  ],
  nonPrepare: [
    'Identification de l’entreprise, exercice : repris du dossier, non ressaisis ici.',
    'Aucun montant n’est déduit de la balance : les distributions, les rémunérations des associés et les moins-values à long terme sont des saisies justifiées du cabinet ; aucun report automatique depuis le 2065, le 2058-A ou le 2059-C.',
    'Cadre G : le total « a à h » est calculé comme le formulaire l’énonce ; la répartition entre revenus éligibles (i) et non éligibles (j) à l’abattement de 40 % n’est pas contrôlée.',
    'Cadre J : le solde « MVLT restant à reporter » est saisi : le formulaire n’en énonce pas la formule.',
    'Cadre H : au-delà de dix lignes, un état du même modèle est à joindre : non préparé.',
  ],
};

/** Feuillet des déficits transférés de plein droit (case 982 bis du 2033-D, art. 209 II-2-a du CGI) : « identifier, opération par opération, la société d'origine sur feuillet séparé » (formulaire). Pas de modèle officiel de feuillet : disposition propre à Comtaple. */
export const GRILLE_2033D_982: DefinitionGrille = {
  id: '2033-D-982',
  titre: 'Feuillet des déficits transférés de plein droit (cases 982 bis et 982 ter du 2033-D)',
  cadres: [
    {
      tableau: '2033D_982',
      titre: 'Opérations de transfert : société d’origine, date de l’opération, montant du déficit transféré',
      colonnes: [{ cle: 'siren', libelle: 'SIREN de la société d’origine', type: 'texte' }, { cle: 'date', libelle: 'Date de l’opération — AAAA-MM-JJ', type: 'date' }, { cle: 'm', libelle: 'Montant du déficit transféré' }],
      lignes: [],
      libre: { max: 20, libelleOrigine: 'Dénomination de la société d’origine' },
      calculs: [{ id: 'TOTAL', libelle: 'Total des déficits transférés listés', colonnes: ['m'], termes: [{ ref: 'saisies', signe: 1 }] }],
      controlesExternes: [
        { code: 'SOMME_982BIS', libelle: 'Total des déficits transférés listés et case 982 bis du 2033-D', mode: 'somme', colonne: 'm', externe: 'D_982B' },
        { code: 'NOMBRE_982TER', libelle: 'Nombre d’opérations listées et case 982 ter du 2033-D', mode: 'nombre', externe: 'D_982T' },
      ],
    },
  ],
  nonPrepare: [
    'Le formulaire demande ce feuillet sans en fixer le modèle : la disposition (société d’origine, SIREN, date, montant) est propre à Comtaple et non officielle.',
    'Le SIREN n’est pas contrôlé ; l’identification de la société d’origine et le calcul du déficit transférable relèvent du cabinet.',
    'Au-delà de vingt opérations : non préparé.',
  ],
};

const FEUILLET_LIBRE = (tableau: string, titre: string, libelleOrigine: string, libelleTotal: string, externe?: { code: string; libelle: string; cle: string }): CadreGrille => ({
  tableau,
  titre,
  colonnes: [{ cle: 'm', libelle: 'Montant' }],
  lignes: [],
  libre: { max: 20, libelleOrigine },
  calculs: [{ id: 'TOTAL', libelle: libelleTotal, colonnes: ['m'], termes: [{ ref: 'saisies', signe: 1 }] }],
  ...(externe ? { controlesExternes: [{ code: externe.code, libelle: externe.libelle, mode: 'somme' as const, colonne: 'm', externe: externe.cle }] } : {}),
});
/** Feuillet des déficits transférés de plein droit du régime réel normal (case K4 bis du 2058-B, renvoi 2 : « identifier, opération par opération, la société d'origine sur feuillet séparé »). Disposition propre à Comtaple. */
export const GRILLE_2058B_K4BIS: DefinitionGrille = {
  id: '2058-B-K4BIS',
  titre: 'Feuillet des déficits transférés de plein droit (case K4 bis du 2058-B)',
  cadres: [
    {
      tableau: '2058B_K4BIS',
      titre: 'Opérations de transfert : société d’origine, date de l’opération, montant du déficit transféré',
      colonnes: [{ cle: 'siren', libelle: 'SIREN de la société d’origine', type: 'texte' }, { cle: 'date', libelle: 'Date de l’opération — AAAA-MM-JJ', type: 'date' }, { cle: 'm', libelle: 'Montant du déficit transféré' }],
      lignes: [],
      libre: { max: 20, libelleOrigine: 'Dénomination de la société d’origine' },
      calculs: [{ id: 'TOTAL', libelle: 'Total des déficits transférés listés', colonnes: ['m'], termes: [{ ref: 'saisies', signe: 1 }] }],
      controlesExternes: [{ code: 'SOMME_K4BIS', libelle: 'Total des déficits transférés listés et case K4 bis du 2058-B', mode: 'somme', colonne: 'm', externe: 'B58_K4BIS' }],
    },
  ],
  nonPrepare: [
    'Le formulaire ne fixe pas de modèle de feuillet : la disposition est propre à Comtaple et non officielle ; le SIREN n’est pas contrôlé ; le calcul du déficit transférable relève du cabinet.',
    'Au-delà de vingt opérations : non préparé.',
  ],
};
/** Feuillets séparés « à détailler » du 2058-A : réintégrations diverses (case SU) et déductions diverses (case XG). Disposition propre à Comtaple ; aucun rapprochement : la notice n'énonce pas la relation entre le feuillet et les cases de détail. */
export const GRILLE_2058A_FEUILLETS: DefinitionGrille = {
  id: '2058-A-FEUILLETS',
  titre: 'Feuillets de détail du 2058-A : réintégrations diverses et déductions diverses « à détailler sur feuillet séparé »',
  cadres: [
    FEUILLET_LIBRE('2058A_REINT', 'Réintégrations diverses à détailler sur feuillet séparé (case SU)', 'Nature de la réintégration', 'Total des réintégrations listées'),
    FEUILLET_LIBRE('2058A_DEDUC', 'Déductions diverses à détailler sur feuillet séparé (case XG)', 'Nature de la déduction', 'Total des déductions listées'),
  ],
  nonPrepare: [
    'Le formulaire demande ces feuillets sans en fixer le modèle : la disposition (nature, montant) est propre à Comtaple et non officielle.',
    'Aucun rapprochement avec les cases SU, WQ, XG du 2058-A : la notice n’énonce pas la relation entre le détail du feuillet et les cases « dont » ; le total listé est un simple total des lignes saisies.',
    'Aucune décision fiscale : chaque réintégration ou déduction est une saisie justifiée du cabinet. Au-delà de vingt lignes par feuillet : non préparé.',
  ],
};

const TOUTES: readonly DefinitionGrille[] = [...GRILLES_2059, GRILLE_2065, GRILLE_DATES_CVAE, GRILLE_2057, GRILLE_2065_BIS, GRILLE_2033D_982, GRILLE_2058B_K4BIS, GRILLE_2058A_FEUILLETS];
export const TABLEAUX_GRILLES: readonly string[] = TOUTES.flatMap((g) => g.cadres.map((c) => c.tableau));

/** Lignes admises pour un tableau en grille : `null` si le tableau n'est pas une grille. Utilisée par la validation de forme. */
export function descriptionLigneGrille(tableau: string, ligne: string): { colonnes: readonly string[]; signees: readonly string[]; dates: readonly string[]; textes: readonly string[]; annees: readonly string[]; libre: boolean } | 'neant' | 'inconnue' | null {
  for (const g of TOUTES)
    for (const c of g.cadres) {
      if (c.tableau !== tableau) continue;
      if (ligne === 'NEANT') return g.neantSur === tableau ? 'neant' : 'inconnue';
      const signees = c.colonnes.filter((x) => x.signe === true).map((x) => x.cle);
      const dates = c.colonnes.filter((x) => x.type === 'date').map((x) => x.cle);
      const textes = c.colonnes.filter((x) => x.type === 'texte').map((x) => x.cle);
      const annees = c.colonnes.filter((x) => x.type === 'annee').map((x) => x.cle);
      if (c.libre !== undefined) return /^(0[1-9]|1[0-9]|20)$/.test(ligne) && Number(ligne) <= c.libre.max ? { colonnes: c.colonnes.map((x) => x.cle), signees, dates, textes, annees, libre: true } : 'inconnue';
      const l = c.lignes.find((x) => x.ligne === ligne);
      return l ? { colonnes: l.colonnes ?? c.colonnes.map((x) => x.cle), signees, dates, textes, annees, libre: false } : 'inconnue';
    }
  return null;
}

// ── Projet d'une grille ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type CelluleGrille = { statut: 'etabli'; montant: ChaineDecimale } | { statut: 'abstention'; motifs: string[] };
export interface LigneGrilleProjet {
  ligne: string;
  libelle: string;
  groupe: string | null;
  colonnes: readonly string[];
  statut: StatutLigneSaisie;
  trace: TraceSaisie | null;
  origine: string | null;
  valeurs: Record<string, string> | null;
  calculee: CelluleGrille | null;
}
export interface CadreGrilleProjet {
  tableau: string;
  titre: string;
  colonnes: readonly ColonneGrille[];
  colonneCalculee: { cle: string; libelle: string } | null;
  libelleOrigine: string | null;
  lignes: LigneGrilleProjet[];
  calculs: Array<{ id: string; libelle: string; cellules: Record<string, CelluleGrille> }>;
}
export interface GrilleProjet {
  statut: 'projet';
  id: string;
  titre: string;
  etat: 'a_saisir' | 'neant' | 'saisi';
  /** Le formulaire admet une déclaration « néant » (ligne NEANT du premier tableau). */
  neantPossible: boolean;
  cadres: CadreGrilleProjet[];
  neant: TraceSaisie | null;
  controles: ControleDetail[];
  nonPrepare: string[];
  limites: string[];
  mention: string;
}
export interface DemandeGrilles {
  versionDonnees: number;
  /** Valeurs d'autres tableaux pour les rapprochements indicatifs (`controlesExternes`). */
  valeursAutres?: Readonly<Record<string, string>>;
  saisiesTableaux: readonly SaisieTableau[];
}

const trace = (s: SaisieTableau): TraceSaisie => ({ note: s.note, qualifieePar: s.qualifieePar, le: s.le, versionDonnees: s.versionDonnees });
const statutDe = (s: SaisieTableau | undefined, v: number): StatutLigneSaisie => (s === undefined ? 'a_saisir' : s.versionDonnees !== v ? 'a_revoir' : 'saisi');
const abst = (...motifs: string[]): CelluleGrille => ({ statut: 'abstention', motifs });

export function preparerGrille(def: DefinitionGrille, demande: DemandeGrilles): GrilleProjet {
  const v = demande.versionDonnees;
  const neantS = def.neantSur === undefined ? undefined : demande.saisiesTableaux.find((s) => s.tableau === def.neantSur && s.ligne === 'NEANT');
  const neantStatut = statutDe(neantS, v);
  let nbSaisies = 0;
  const cadres: CadreGrilleProjet[] = def.cadres.map((c) => {
    const saisies = new Map(demande.saisiesTableaux.filter((s) => s.tableau === c.tableau).map((s) => [s.ligne, s]));
    const defsLignes: LigneGrille[] = c.libre ? Array.from({ length: c.libre.max }, (_, i) => ({ ligne: String(i + 1).padStart(2, '0'), libelle: `Ligne ${i + 1}` })) : [...c.lignes];
    const lignes: LigneGrilleProjet[] = defsLignes.map((d) => {
      const s = saisies.get(d.ligne);
      const statut = statutDe(s, v);
      if (statut === 'saisi') nbSaisies++;
      const permises = d.colonnes ?? c.colonnes.map((x) => x.cle);
      const valeurs = statut === 'saisi' ? s!.valeurs : null;
      let calculee: CelluleGrille | null = null;
      if (c.colonneCalculee) {
        if (valeurs === null) calculee = abst(statut === 'a_revoir' ? 'Ligne à revoir : données modifiées depuis la saisie.' : 'Ligne à saisir.');
        else calculee = { statut: 'etabli', montant: versChaine(c.colonneCalculee.termes.filter((t) => permises.includes(t.col)).reduce((a, t) => a.plus(new Decimal(valeurs[t.col] ?? '0').times(t.signe)), new Decimal(0))) };
      }
      return { ligne: d.ligne, libelle: d.libelle, groupe: d.groupe ?? null, colonnes: permises, statut, trace: s ? trace(s) : null, origine: valeurs?.origine ?? null, valeurs, calculee };
    });
    // Calculs de lignes (TOTAL…) : établis seulement si toutes les composantes sont saisies (grille libre : au moins une ligne saisie, aucune à revoir).
    const resolu = new Map<string, Record<string, CelluleGrille>>();
    const calculs = c.calculs.map((k) => {
      const cellules: Record<string, CelluleGrille> = {};
      for (const col of k.colonnes) {
        const motifs: string[] = [];
        let total = new Decimal(0);
        for (const t of k.termes) {
          if (t.ref === 'saisies') {
            const saisies2 = lignes.filter((l) => l.statut === 'saisi');
            const arevoir = lignes.filter((l) => l.statut === 'a_revoir').length;
            if (arevoir > 0) motifs.push(`${arevoir} ligne(s) à revoir : données modifiées depuis la saisie.`);
            if (saisies2.length === 0) motifs.push(neantStatut === 'saisi' ? 'Tableau déclaré « néant » : aucun total à établir.' : 'Aucune ligne saisie.');
            for (const l of saisies2) total = total.plus(new Decimal(l.valeurs![col] ?? '0').times(t.signe));
          } else
            for (const r of t.ref) {
              const l = lignes.find((x) => x.ligne === r);
              if (l) {
                if (!l.colonnes.includes(col)) continue; // colonne grisée sur cette ligne : sans objet
                if (l.statut !== 'saisi') motifs.push(l.statut === 'a_revoir' ? `Ligne « ${l.libelle} » à revoir.` : `Ligne « ${l.libelle} » à saisir (aucune ligne n’est présumée nulle).`);
                else total = total.plus(new Decimal(l.valeurs![col] ?? '0').times(t.signe));
              } else {
                const cell = resolu.get(r)?.[col];
                if (cell === undefined || cell.statut === 'abstention') motifs.push(`Ligne calculée ${r} sans valeur établie.`);
                else total = total.plus(new Decimal(cell.montant).times(t.signe));
              }
            }
        }
        cellules[col] = motifs.length > 0 ? abst(...new Set(motifs)) : { statut: 'etabli', montant: versChaine(total) };
      }
      resolu.set(k.id, cellules);
      return { id: k.id, libelle: k.libelle, cellules };
    });
    return {
      tableau: c.tableau,
      titre: c.titre,
      colonnes: c.colonnes,
      colonneCalculee: c.colonneCalculee ? { cle: c.colonneCalculee.cle, libelle: c.colonneCalculee.libelle } : null,
      libelleOrigine: c.libre?.libelleOrigine ?? null,
      lignes,
      calculs,
    };
  });
  const etat: GrilleProjet['etat'] = nbSaisies > 0 ? 'saisi' : neantStatut === 'saisi' ? 'neant' : 'a_saisir';
  const controles: ControleDetail[] = [];
  if (neantStatut === 'saisi' && etat === 'saisi') controles.push({ code: `${def.id}_NEANT_ET_LIGNES`, statut: 'ecart', message: 'Le tableau est déclaré « néant » ET porte des saisies : retirer l’une des deux ; les saisies sont retenues.' });
  if (etat === 'saisi') {
    const avecCalculs = def.cadres.some((c) => c.calculs.length > 0 || c.colonneCalculee !== undefined);
    controles.push({ code: `${def.id}_SANS_SAISIE`, statut: 'non_verifie', message: avecCalculs ? 'Les lignes sans saisie ne sont jamais présumées nulles : les totaux ne sont établis que lorsque toutes leurs composantes sont saisies (zéro compris).' : 'Les rubriques sans saisie ne sont jamais présumées nulles : une rubrique à zéro se saisit explicitement.' });
  }
  for (const c of def.cadres) {
    const v2 = c.ventilation;
    if (v2 === undefined) continue;
    for (const l of cadres.find((x) => x.tableau === c.tableau)!.lignes) {
      const x = l.valeurs;
      if (x === null || x[v2.total] === undefined || v2.parties.some((k) => x[k] === undefined)) continue;
      const somme = v2.parties.reduce((a, k) => a.plus(x[k]!), new Decimal(0));
      const ecart = new Decimal(x[v2.total]!).minus(somme);
      controles.push(ecart.isZero()
        ? { code: `${def.id}_VENT_${l.ligne}`, statut: 'coherent', message: `${l.libelle} : le montant brut égale la somme de ses échéances. Contrôle indicatif.` }
        : { code: `${def.id}_VENT_${l.ligne}`, statut: 'ecart', message: `${l.libelle} : le montant brut (${versChaine(new Decimal(x[v2.total]!))}) diffère de la somme de ses échéances (${versChaine(somme)}). Rien n’est corrigé. Contrôle indicatif.`, ecart: versChaine(ecart) });
    }
  }
  for (const c of def.cadres)
    for (const k of c.controlesExternes ?? []) {
      const externe = demande.valeursAutres?.[k.externe];
      if (externe === undefined) continue;
      const saisies2 = cadres.find((x) => x.tableau === c.tableau)!.lignes.filter((l) => l.statut === 'saisi');
      const interne = k.mode === 'nombre' ? new Decimal(saisies2.length) : saisies2.reduce((a, l) => a.plus(l.valeurs![k.colonne ?? 'm'] ?? '0'), new Decimal(0));
      const ecart = interne.minus(externe);
      controles.push(ecart.isZero()
        ? { code: `${def.id}_${k.code}`, statut: 'coherent', message: `${k.libelle} : égaux (${versChaine(interne)}). Contrôle indicatif.` }
        : { code: `${def.id}_${k.code}`, statut: 'ecart', message: `${k.libelle} : ${versChaine(interne)} ici contre ${versChaine(new Decimal(externe))} dans l’autre tableau. Rien n’est corrigé. Contrôle indicatif.`, ecart: versChaine(ecart) });
    }
  for (const c of def.cadres)
    for (const [a, b] of c.ordreDates ?? [])
      for (const l of cadres.find((x) => x.tableau === c.tableau)!.lignes)
        if (l.valeurs?.[a] !== undefined && l.valeurs[b] !== undefined && l.valeurs[a]! > l.valeurs[b]!) controles.push({ code: `${def.id}_ORDRE_${l.ligne}`, statut: 'ecart', message: `${l.libelle} : la date de début (${l.valeurs[a]}) suit la date de fin (${l.valeurs[b]}). Rien n’est corrigé. Contrôle indicatif.` });
  return {
    statut: 'projet',
    id: def.id,
    titre: def.titre,
    etat,
    neantPossible: def.neantSur !== undefined,
    cadres,
    neant: neantS ? trace(neantS) : null,
    controles,
    nonPrepare: [...def.nonPrepare],
    limites: [
      'Chaque ligne est une saisie justifiée du cabinet, tracée et historisée ; « néant » est une déclaration explicite du tableau ; une ligne non saisie n’est jamais présumée nulle.',
      'Seuls les calculs énoncés par le formulaire sont faits, quand toutes leurs composantes sont saisies ; aucune qualification ni imputation n’est décidée par le logiciel.',
      'Statut « projet » : aucune transmission, aucune validation professionnelle.',
    ],
    mention: MENTION_PROJET,
  };
}
