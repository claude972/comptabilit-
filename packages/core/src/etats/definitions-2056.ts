/**
 * Tableau 2056-SD « Provisions inscrites au bilan » (régime réel normal), servi par le moteur générique de formulaires par cases (D-129). Source :
 * `2050-liasse_5320.pdf` (SHA-256 0bba3352…f8453e1), page 8 ; les 4 codes de chaque ligne (montant au début, augmentations : dotations, diminutions :
 * reprises, montant à la fin) ont été lus par extraction positionnée puis VÉRIFIÉS sur le rendu image (2026-11-22).
 *
 * Calculs énoncés par le formulaire (lignes « TOTAL »), seulement quand toutes leurs composantes sont saisies (néant compris) : TOTAL I (provisions
 * réglementées, hors la ligne « dont majorations exceptionnelles de 30 % », qui n'est pas additionnée), TOTAL II (risques et charges), TOTAL III
 * (dépréciation), TOTAL GÉNÉRAL (I + II + III), pour chacune des quatre colonnes. Contrôles INDICATIFS (jamais corrigés) : début + dotations −
 * reprises = fin sur chaque ligne ; le « dont dotations et reprises » ventile les dotations et reprises du total général.
 */
import type { DefinitionCase, DefinitionCalcul, DefinitionControle, DefinitionFormulaire } from './formulaire-cases.js';

type Ligne = readonly [id: string, libelle: string, groupe: string, codes: readonly [string, string, string, string]];
const COLONNES = ['Montant au début de l’exercice', 'Augmentations : dotations de l’exercice', 'Diminutions : reprises de l’exercice', 'Montant à la fin de l’exercice'] as const;

const REGLEMENTEES: readonly Ligne[] = [
  ['GIS', 'Provisions pour reconstitution des gisements miniers et pétroliers', 'REG', ['3T', 'TA', 'TB', 'TC']],
  ['INV', 'Provisions pour investissement (art. 237 bis A-II du CGI)', 'REG', ['3U', 'TD', 'TE', 'TF']],
  ['HPX', 'Provisions pour hausse des prix', 'REG', ['3V', 'TG', 'TH', 'TI']],
  ['AMD', 'Amortissements dérogatoires', 'REG', ['3X', 'TM', 'TN', 'TO']],
  ['D30', 'dont majorations exceptionnelles de 30 %', 'REG', ['D3', 'D4', 'D5', 'D6']],
  ['PRI', 'Provisions pour prêts d’installation (art. 39 quinquies H du CGI)', 'REG', ['IJ', 'IK', 'IL', 'IM']],
  ['APR', 'Autres provisions réglementées', 'REG', ['3Y', 'TP', 'TQ', 'TR']],
];
const RISQUES: readonly Ligne[] = [
  ['LIT', 'Provisions pour litiges', 'RC', ['4A', '4B', '4C', '4D']],
  ['GAR', 'Provisions pour garanties données aux clients', 'RC', ['4E', '4F', '4G', '4H']],
  ['AME', 'Provisions pour amendes et pénalités', 'RC', ['4N', '4P', '4R', '4S']],
  ['CHG', 'Provisions pour pertes de change', 'RC', ['4T', '4U', '4V', '4W']],
  ['PEN', 'Provisions pour pensions et obligations similaires', 'RC', ['4X', '4Y', '4Z', '5A']],
  ['IMP', 'Provisions pour impôts', 'RC', ['5B', '5C', '5D', '5E']],
  ['REN', 'Provisions pour renouvellement des immobilisations', 'RC', ['5F', '5H', '5J', '5K']],
  ['GEG', 'Provisions pour gros entretien et grandes révisions', 'RC', ['EO', 'EP', 'EQ', 'ER']],
  ['CAP', 'Provisions pour charges sociales et fiscales sur congés à payer', 'RC', ['5R', '5S', '5T', '5U']],
  ['ARC', 'Autres provisions pour risques et charges', 'RC', ['5V', '5W', '5X', '5Y']],
];
const DEPRECIATION: readonly Ligne[] = [
  ['INC', 'Dépréciation sur immobilisations : incorporelles', 'DEP', ['6A', '6B', '6C', '6D']],
  ['COR', 'Dépréciation sur immobilisations : corporelles', 'DEP', ['6E', '6F', '6G', '6H']],
  ['TME', 'Dépréciation sur immobilisations : titres mis en équivalence', 'DEP', ['Ø2', 'Ø3', 'Ø4', 'Ø5']],
  ['TPA', 'Dépréciation sur immobilisations : titres de participations', 'DEP', ['9U', '9V', '9W', '9X']],
  ['AIF', 'Dépréciation sur immobilisations : autres immobilisations financières', 'DEP', ['Ø6', 'Ø7', 'Ø8', 'Ø9']],
  ['STO', 'Dépréciation sur stocks et en cours', 'DEP', ['6N', '6P', '6R', '6S']],
  ['CLI', 'Dépréciation sur comptes clients', 'DEP', ['6T', '6U', '6V', '6W']],
  ['ADE', 'Autres provisions pour dépréciation', 'DEP', ['6X', '6Y', '6Z', '7A']],
];
const TOTAUX = {
  I: ['3Z', 'TS', 'TT', 'TU'],
  II: ['5Z', 'TV', 'TW', 'TX'],
  III: ['7B', 'TY', 'TZ', 'UA'],
  G: ['7C', 'UB', 'UC', 'UD'],
} as const;

const lignes: readonly Ligne[] = [...REGLEMENTEES, ...RISQUES, ...DEPRECIATION];
const cases: DefinitionCase[] = lignes.flatMap(([, libelle, groupe, codes]) => codes.map((code, i) => ({ code, libelle: `${libelle} — ${COLONNES[i]}`, groupe })));
cases.push(
  { code: 'UE', libelle: 'Dont dotations et reprises d’exploitation — dotations', groupe: 'DONT' },
  { code: 'UF', libelle: 'Dont dotations et reprises d’exploitation — reprises', groupe: 'DONT' },
  { code: 'UG', libelle: 'Dont dotations et reprises financières — dotations', groupe: 'DONT' },
  { code: 'UH', libelle: 'Dont dotations et reprises financières — reprises', groupe: 'DONT' },
  { code: 'UJ', libelle: 'Dont dotations et reprises exceptionnelles — dotations', groupe: 'DONT' },
  { code: 'UK', libelle: 'Dont dotations et reprises exceptionnelles — reprises', groupe: 'DONT' },
  { code: '10', libelle: 'Titres mis en équivalence : montant de la dépréciation à la clôture de l’exercice calculé selon les règles de l’art. 39-1-5° du CGI', groupe: 'DONT' },
);

const colonne = (ls: readonly Ligne[], i: number, sans: readonly string[] = []) => ls.filter((l) => !sans.includes(l[0])).map(([, , , codes]) => ({ code: codes[i]!, signe: 1 as const }));
const calculs: DefinitionCalcul[] = [];
([['I', 'TOTAL I — provisions réglementées', 'REG', REGLEMENTEES], ['II', 'TOTAL II — provisions pour risques et charges', 'RC', RISQUES], ['III', 'TOTAL III — provisions pour dépréciation', 'DEP', DEPRECIATION]] as const).forEach(([cle, libelle, groupe, ls]) => {
  TOTAUX[cle].forEach((code, i) => calculs.push({ code, libelle: `${libelle} — ${COLONNES[i]}`, groupe, composantes: colonne(ls, i, ['D30']) }));
});
TOTAUX.G.forEach((code, i) => calculs.push({ code, libelle: `TOTAL GÉNÉRAL (I + II + III) — ${COLONNES[i]}`, groupe: 'TOT', composantes: [TOTAUX.I[i]!, TOTAUX.II[i]!, TOTAUX.III[i]!].map((c) => ({ code: c, signe: 1 as const })) }));

const controles: DefinitionControle[] = lignes.map(([id, libelle, , codes]) => ({
  code: `FIN_${id}`,
  libelle: `${libelle} : montant au début + dotations − reprises = montant à la fin`,
  total: codes[3],
  somme: [{ code: codes[0], signe: 1 }, { code: codes[1], signe: 1 }, { code: codes[2], signe: -1 }],
}));
controles.push(
  { code: 'DONT_DOTATIONS', libelle: 'Dont dotations (exploitation + financières + exceptionnelles) et dotations du total général', total: 'UB', somme: ['UE', 'UG', 'UJ'].map((code) => ({ code, signe: 1 as const })) },
  { code: 'DONT_REPRISES', libelle: 'Dont reprises (exploitation + financières + exceptionnelles) et reprises du total général', total: 'UC', somme: ['UF', 'UH', 'UK'].map((code) => ({ code, signe: 1 as const })) },
);

export const FORMULAIRE_2056: DefinitionFormulaire = {
  id: '2056',
  titre: '2056 — Provisions inscrites au bilan',
  prefixe: 'P56',
  source: '2050-liasse_5320.pdf, page 8 (2056-SD, millésime 2026).',
  groupes: [
    { id: 'REG', titre: 'Provisions réglementées' },
    { id: 'RC', titre: 'Provisions pour risques et charges' },
    { id: 'DEP', titre: 'Provisions pour dépréciation' },
    { id: 'TOT', titre: 'Total général' },
    { id: 'DONT', titre: 'Dont dotations et reprises ; titres mis en équivalence' },
  ],
  cases,
  calculs,
  controles,
  nonPrepare: [
    'Les lignes marquées (1) du formulaire (hausse des prix, autres provisions réglementées, impôts, autres provisions pour risques et charges, autres immobilisations financières, autres provisions pour dépréciation) se détaillent sur un feuillet séparé selon l’année de constitution ou l’objet de la provision : feuillet non préparé.',
    'Les charges à payer ne figurent pas sur ce tableau mais sur l’état détaillé des charges à payer (art. 38 II de l’annexe III au CGI) : non préparé.',
    'Aucune provision n’est déduite de la balance : la balance ne distingue ni la nature (réglementée, risques, dépréciation) ni les dotations et reprises par catégorie ; chaque case est une saisie justifiée du cabinet.',
    'Relation avec le tableau 2058-B (provisions non déductibles) et l’annexe : non automatique ; aucune décision de déductibilité n’est prise.',
  ],
  limites: [
    'Chaque case est saisie avec une justification obligatoire, tracée et historisée ; « néant » (0,00) est une déclaration explicite, distincte d’une case non renseignée.',
    'Les totaux sont calculés comme le formulaire l’énonce, seulement quand toutes leurs composantes sont saisies ; les rapprochements début + dotations − reprises = fin et « dont » sont indicatifs, jamais corrigés.',
    'Statut « projet » : aucune transmission, aucune validation professionnelle.',
  ],
};
