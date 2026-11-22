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
  type?: 'montant' | 'date';
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
  /** Contrôles indicatifs d'ordre entre deux colonnes date d'une même ligne (la première ne doit pas suivre la seconde). */
  ordreDates?: ReadonlyArray<[string, string]>;
  /** Colonne calculée par ligne : somme signée d'autres colonnes de la MÊME ligne (les colonnes non servies sont ignorées). */
  colonneCalculee?: { cle: string; libelle: string; termes: ReadonlyArray<{ col: string; signe: 1 | -1 }> };
}
export interface DefinitionGrille {
  id: '2059-B' | '2059-C' | '2059-D' | '2065' | '2033-E-DATES';
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

const TOUTES: readonly DefinitionGrille[] = [...GRILLES_2059, GRILLE_2065, GRILLE_DATES_CVAE];
export const TABLEAUX_GRILLES: readonly string[] = TOUTES.flatMap((g) => g.cadres.map((c) => c.tableau));

/** Lignes admises pour un tableau en grille : `null` si le tableau n'est pas une grille. Utilisée par la validation de forme. */
export function descriptionLigneGrille(tableau: string, ligne: string): { colonnes: readonly string[]; signees: readonly string[]; dates: readonly string[]; libre: boolean } | 'neant' | 'inconnue' | null {
  for (const g of TOUTES)
    for (const c of g.cadres) {
      if (c.tableau !== tableau) continue;
      if (ligne === 'NEANT') return g.neantSur === tableau ? 'neant' : 'inconnue';
      const signees = c.colonnes.filter((x) => x.signe === true).map((x) => x.cle);
      const dates = c.colonnes.filter((x) => x.type === 'date').map((x) => x.cle);
      if (c.libre !== undefined) return /^(0[1-9]|1[0-9])$/.test(ligne) && Number(ligne) <= c.libre.max ? { colonnes: c.colonnes.map((x) => x.cle), signees, dates, libre: true } : 'inconnue';
      const l = c.lignes.find((x) => x.ligne === ligne);
      return l ? { colonnes: l.colonnes ?? c.colonnes.map((x) => x.cle), signees, dates, libre: false } : 'inconnue';
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
  cadres: CadreGrilleProjet[];
  neant: TraceSaisie | null;
  controles: ControleDetail[];
  nonPrepare: string[];
  limites: string[];
  mention: string;
}
export interface DemandeGrilles {
  versionDonnees: number;
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
  for (const c of def.cadres)
    for (const [a, b] of c.ordreDates ?? [])
      for (const l of cadres.find((x) => x.tableau === c.tableau)!.lignes)
        if (l.valeurs?.[a] !== undefined && l.valeurs[b] !== undefined && l.valeurs[a]! > l.valeurs[b]!) controles.push({ code: `${def.id}_ORDRE_${l.ligne}`, statut: 'ecart', message: `${l.libelle} : la date de début (${l.valeurs[a]}) suit la date de fin (${l.valeurs[b]}). Rien n’est corrigé. Contrôle indicatif.` });
  return {
    statut: 'projet',
    id: def.id,
    titre: def.titre,
    etat,
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
