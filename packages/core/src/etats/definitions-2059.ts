/**
 * Tableaux 2059 du régime réel normal servis par le moteur générique de formulaires par cases (D-120). Source : `2050-liasse_5320.pdf`
 * (SHA-256 0bba3352…8453e1), pages 13 à 19 ; cases lues par extraction positionnée puis vérifiées sur le rendu image (2026-11-22).
 */
import type { DefinitionFormulaire } from './formulaire-cases.js';

const c = (code: string, libelle: string, groupe: string, precision?: string) => ({ code, libelle, groupe, ...(precision ? { precision } : {}) });
const plus = (...codes: string[]) => codes.map((code) => ({ code, signe: 1 as const }));

/**
 * 2059-E-SD « Détermination des effectifs et de la valeur ajoutée » : même structure que le 2033-E (D-115) avec les codes du régime réel normal.
 * Calculs énoncés par le formulaire, seulement quand toutes les composantes sont saisies : TOTAL 1 (OX), TOTAL 2 (OM), TOTAL 3 (OJ), valeur ajoutée (OG),
 * valeur ajoutée assujettie à la CVAE (SA : OG, ou 0 si elle est négative). Case GX (« report de la ligne OX, le cas échéant ajusté à 12 mois ») proposée
 * (= OX) pour un exercice de 12 mois, jamais retenue sans saisie.
 */
export const FORMULAIRE_2059_E: DefinitionFormulaire = {
  id: '2059-E',
  titre: '2059-E — Effectifs et valeur ajoutée (CVAE)',
  prefixe: 'E59',
  source: '2050-liasse_5320.pdf, page 17 (2059-E-SD, millésime 2026).',
  groupes: [
    { id: 'EFF', titre: 'Déclaration des effectifs' },
    { id: 'I', titre: 'I — Chiffre d’affaires de référence CVAE' },
    { id: 'II', titre: 'II — Autres produits à retenir pour le calcul de la valeur ajoutée' },
    { id: 'III', titre: 'III — Charges à retenir pour le calcul de la valeur ajoutée' },
    { id: 'IV', titre: 'IV et V — Valeur ajoutée produite et assujettie à la CVAE' },
    { id: 'MONO', titre: 'Cadre réservé au mono-établissement au sens de la CVAE' },
  ],
  cases: [
    c('YP', 'Effectif moyen du personnel', 'EFF', 'Notice 2032-NOT-SD, « Déclaration des effectifs » ; notice 1330-CVAE-SD, « Répartition des salariés ».'),
    c('YF', 'dont apprentis', 'EFF'),
    c('YG', 'dont handicapés', 'EFF'),
    c('RL', 'Effectifs affectés à l’activité artisanale', 'EFF'),
    c('OA', 'Ventes de produits fabriqués, prestations de services et marchandises', 'I'),
    c('OK', 'Redevances pour concessions, brevets, licences et assimilées', 'I'),
    c('OL', 'Plus-values de cession d’immobilisations corporelles ou incorporelles si rattachées à une activité normale et courante', 'I'),
    c('OH', 'Autres produits de gestion courante (hors quotes-parts de résultat sur opérations faites en commun), y compris les plus-values de cession non rattachées à une activité normale et courante', 'II'),
    c('OE', 'Production immobilisée à hauteur des seules charges déductibles ayant concouru à sa formation', 'II'),
    c('OF', 'Subventions d’exploitation reçues et certains abandons de créances à caractère commercial', 'II'),
    c('OD', 'Variation positive des stocks', 'II'),
    c('XT', 'Rentrées sur créances amorties lorsqu’elles se rapportent au résultat d’exploitation', 'II'),
    c('ON', 'Achats', 'III', 'Renvoi (1) du formulaire : ne pas tenir compte dans les lignes ON à OW des charges déductibles afférentes à la production immobilisée déclarée ligne OE, portées en ligne OU.'),
    c('OQ', 'Variation négative des stocks', 'III'),
    c('OR', 'Services extérieurs, à l’exception des loyers et redevances', 'III'),
    c('OS', 'Loyers et redevances, à l’exception de ceux afférents à des immobilisations corporelles mises à disposition (location-gérance, crédit-bail, location de plus de 6 mois)', 'III'),
    c('OZ', 'Taxes déductibles de la valeur ajoutée', 'III'),
    c('OW', 'Autres charges de gestion courante (hors quotes-parts de résultat sur opérations faites en commun)', 'III'),
    c('OU', 'Charges déductibles de la valeur ajoutée afférentes à la production immobilisée déclarée', 'III'),
    c('O9', 'Fraction déductible de la valeur ajoutée des dotations aux amortissements afférentes à des immobilisations corporelles mises à disposition (location-gérance, crédit-bail, location de plus de 6 mois)', 'III'),
    c('OY', 'Moins-values de cession d’immobilisations corporelles ou incorporelles rattachées ou non à une activité normale et courante', 'III'),
    { code: 'EV', libelle: 'Mono-établissement au sens de la CVAE (0 = non coché, 1 = coché)', groupe: 'MONO', type: 'oui_non' as const },
    c('GX', 'Chiffre d’affaires de référence CVAE (report de la ligne OX, le cas échéant ajusté à 12 mois)', 'MONO', 'Proposition = case OX pour un exercice de 12 mois ; l’ajustement à 12 mois n’est pas calculé.'),
    c('EY', 'Effectifs au sens de la CVAE', 'MONO'),
    c('HX', 'Chiffre d’affaires du groupe économique (art. 223 A du CGI)', 'MONO'),
  ],
  calculs: [
    { code: 'OX', libelle: 'TOTAL 1', groupe: 'I', composantes: plus('OA', 'OK', 'OL') },
    { code: 'OM', libelle: 'TOTAL 2', groupe: 'II', composantes: plus('OH', 'OE', 'OF', 'OD', 'XT') },
    { code: 'OJ', libelle: 'TOTAL 3', groupe: 'III', composantes: plus('ON', 'OQ', 'OR', 'OS', 'OZ', 'OW', 'OU', 'O9', 'OY') },
    { code: 'OG', libelle: 'Calcul de la valeur ajoutée (total 1 + total 2 − total 3)', groupe: 'IV', composantes: [{ code: 'OX', signe: 1 }, { code: 'OM', signe: 1 }, { code: 'OJ', signe: -1 }] },
    { code: 'SA', libelle: 'Valeur ajoutée assujettie à la CVAE (0 si la valeur ajoutée calculée est négative, instruction du formulaire)', groupe: 'IV', composantes: [{ code: 'OG', signe: 1 }], plancherZero: true },
  ],
  controles: [],
  propositions: [{ code: 'GX', origine: 'Case OX (total 1), exercice de 12 mois', sources: ['=OX'], douzeMoisSeulement: true }],
  nonPrepare: [
    'Période de référence (cases GY, GZ) et date de cessation (HR) : dates, non préparées.',
    'Rattachement des comptes de la balance aux lignes de la valeur ajoutée : règles de la CVAE, décision du cabinet ; aucune proposition n’est tirée de la balance.',
    'Répartition des salariés et formulaire 1330-CVAE-SD (multi-établissements) : non préparés.',
  ],
  limites: [
    'Chaque case est une saisie justifiée du cabinet ; « néant » est une déclaration explicite ; une case sans saisie n’est jamais présumée nulle.',
    'Calculés comme le formulaire l’énonce, uniquement quand toutes les composantes sont saisies : OX, OM, OJ, OG et SA.',
    'Statut « projet » : aucune transmission, aucune validation professionnelle.',
  ],
};
