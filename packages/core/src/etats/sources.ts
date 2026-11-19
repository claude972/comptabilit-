/**
 * Sources des états de travail et des indicateurs. Textes consultés le 2026-11-19 :
 *  - PCG : PDF officiel de l'ANC (version consolidée au 1er janvier 2026), lu intégralement en texte ;
 *  - Code de commerce : pages Légifrance des articles cités (version en vigueur affichée le jour de la consultation).
 * Ce qui relève d'une convention d'analyse financière absente des textes est de type `interne` et présenté comme tel.
 */
import type { SourceRegle } from '../controles/types.js';
import { DATE_VERIFICATION_SOURCES, URL_PCG_2026, sourceInterne } from '../sources.js';

/** Premier jour d'ouverture des exercices auxquels s'appliquent les modèles issus du règlement ANC n° 2022-06. */
export const DATE_APPLICATION_REGLEMENT_2022_06 = '2025-01-01';

const PERIODE_PCG_2025 =
  'Règlement ANC n° 2014-03, version consolidée au 1er janvier 2026 ; présentation et plan de comptes issus du règlement ANC n° 2022-06, applicables aux exercices ouverts à compter du 1er janvier 2025.';

function pcg(reference: string): SourceRegle {
  return { type: 'reglementaire', reference, url: URL_PCG_2026, dateVerification: DATE_VERIFICATION_SOURCES, verification: 'verifiee', periodeApplication: PERIODE_PCG_2025 };
}

export const SOURCES_ETATS = {
  /** Modèles du système de base : la LISTE des rubriques et postes est dans le texte ; l'affectation des comptes n'y est pas. */
  modelesSystemeDeBase: pcg(
    'PCG (règlement ANC n° 2014-03), art. 821-1 « Modèle de bilan » et art. 821-2 « Modèle de compte de résultat (produits et charges hors taxes) » du système de base ; ' +
      'art. 811-3 (les documents présentent au minimum les rubriques et postes des modèles) ; art. 112-2 et 112-3 (aucune compensation entre postes d’actif et de passif, ni entre charges et produits) ; ' +
      'art. 1121-1 (plan de comptes) et art. 1131-1 (« Le plan de comptes doit permettre un passage simplifié de la balance des comptes à la présentation normalisée des documents de synthèse »). ' +
      'ATTENTION : le texte donne la liste des rubriques et postes et les intitulés des comptes, PAS une table d’affectation compte par compte ; ' +
      'l’affectation retenue ici est une lecture des intitulés du plan de comptes et des règles de fonctionnement (art. 1211-10 à 1222-78), à faire valider par un professionnel.',
  ),
  resultatExceptionnel: pcg(
    'PCG (règlement ANC n° 2014-03), art. 513-5 : « Sont comptabilisés en résultat exceptionnel les produits et les charges directement liés à un événement majeur et inhabituel » ; ' +
      'y sont également inscrits les écritures d’origine purement fiscale et les changements de méthode comptabilisés en résultat pour raisons fiscales ou corrections d’erreurs (art. 122-3 et 122-6) ; ' +
      'plan de comptes : 67 « Charges exceptionnelles » (672, 678), 687, 77 « Produits exceptionnels » (772, 778), 787. ' +
      'Les cessions d’immobilisations incorporelles et corporelles relèvent désormais de l’exploitation (657 et 757), celles d’immobilisations financières du résultat financier (6671 et 7671).',
  ),
  chiffreAffaires: pcg(
    'PCG (règlement ANC n° 2014-03), art. 512-2 : « Le chiffre d’affaires correspond au montant des affaires réalisées par l’entité avec les tiers dans le cadre de son activité professionnelle normale et courante » ; ' +
      'art. 821-2 : poste « Montant net du chiffre d’affaires » (ventes de marchandises + production vendue) ; art. 1222-70 : comptes 701 à 708 crédités des ventes, 709 débité des rabais, remises et ristournes accordés.',
  ),
  niveauxDeResultat: pcg(
    'PCG (règlement ANC n° 2014-03), art. 513-2 (les produits et charges sont classés de manière à faire apparaître les différents niveaux de résultat) et art. 821-2 : ' +
      '« 1. RESULTAT D’EXPLOITATION (I - II) », « 2. RESULTAT FINANCIER (V - VI) », « 3. RESULTAT COURANT avant impôts (I - II + III - IV + V - VI) », « 4. RESULTAT EXCEPTIONNEL (VII - VIII) », ' +
      '« BENEFICE OU PERTE » = total des produits (I+III+V+VII) − total des charges (II+IV+VI+VIII+IX+X).',
  ),
  resultatExercice: pcg(
    'PCG (règlement ANC n° 2014-03), art. 513-1 : « Le résultat de l’exercice est égal tant à la différence entre les produits et les charges qu’à la variation des capitaux propres entre le début et la fin de l’exercice (…) » ; ' +
      'art. 1211-12 : le compte 12 enregistre pour solde les comptes de charges et de produits ; il est soldé après décision d’affectation.',
  ),
  capitauxPropres: pcg(
    'PCG (règlement ANC n° 2014-03), art. 1141-1, a : les capitaux propres correspondent à la somme algébrique des apports (capital, primes liées au capital), des écarts de réévaluation, des écarts d’équivalence, ' +
      'des bénéfices non distribués (réserves, report à nouveau créditeur, bénéfice de l’exercice), des pertes (report à nouveau débiteur, perte de l’exercice), des subventions d’investissement et des provisions réglementées ; ' +
      'art. 821-1 : « Total des capitaux propres (I) ».',
  ),
  concoursBancaires: pcg(
    'PCG (règlement ANC n° 2014-03), art. 1215-51 (une subdivision du compte 512 par compte bancaire, aucune compensation entre comptes à solde créditeur et à solde débiteur ; ' +
      'mobilisations de créances au compte 519 « Concours bancaires courants ») et art. 1211-16 (les concours bancaires courants ne sont pas inscrits au compte 164).',
  ),
  /**
   * Soldes intermédiaires de gestion : la recherche plein texte des expressions « soldes intermédiaires », « valeur ajoutée »,
   * « excédent brut » et « capacité d’autofinancement » dans le PCG consolidé au 1er janvier 2026 ne renvoie AUCUNE occurrence.
   */
  sigConventionInterne: sourceInterne(
    'Convention interne d’analyse financière. Le PCG en vigueur (règlement ANC n° 2014-03 consolidé au 1er janvier 2026, lu intégralement le 2026-11-19) ne définit ni tableau des soldes intermédiaires de gestion, ' +
      'ni marge commerciale, ni production de l’exercice, ni valeur ajoutée, ni excédent brut d’exploitation : ces expressions n’y figurent pas. ' +
      'Les formules retenues reprennent la cascade usuelle en analyse financière, exprimée en comptes du plan de comptes de l’art. 1121-1.',
  ),
  conventionInterneAnalyse: sourceInterne(
    'Convention interne d’analyse financière (aucun texte ne définit cet indicateur) : formule exprimée en comptes du plan de comptes du PCG (art. 1121-1), à lire avec ses limites.',
  ),
  capitauxPropresMoitieCapital: {
    type: 'reglementaire',
    reference:
      'Code de commerce, art. L223-42 (SARL) et art. L225-248 (SA), dans leur rédaction issue de la loi n° 2023-171 du 9 mars 2023, art. 14 : si, du fait de pertes constatées dans les documents comptables, ' +
      'les capitaux propres deviennent inférieurs à la moitié du capital social, les associés (SARL) ou l’assemblée générale extraordinaire convoquée par le conseil d’administration ou le directoire (SA) décident, ' +
      'dans les quatre mois qui suivent l’approbation des comptes ayant fait apparaître ces pertes, s’il y a lieu à dissolution anticipée ; à défaut de dissolution, reconstitution des capitaux propres ou réduction du capital ' +
      'au plus tard à la clôture du deuxième exercice suivant. Art. L227-1 (SAS) : les règles concernant les sociétés anonymes sont applicables à la SAS, à l’exception d’articles limitativement énumérés ' +
      'parmi lesquels L225-248 ne figure pas. La forme sociale n’est pas dans les écritures : l’article applicable est à déterminer par le réviseur.',
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047292166',
    dateVerification: DATE_VERIFICATION_SOURCES,
    verification: 'verifiee',
    periodeApplication:
      'L223-42 et L225-248 (https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047292156) : versions en vigueur depuis le 11 mars 2023 ; ' +
      'L227-1 (https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047591332) : version en vigueur depuis le 1er janvier 2025. Pages affichées « en vigueur » le 2026-11-19.',
  },
  /** Citée pour mémoire dans les limites des délais moyens : aucun seuil légal n'est appliqué par les indicateurs. */
  delaisDePaiement: {
    type: 'reglementaire',
    reference:
      'Code de commerce, art. L441-10, I : sauf dispositions contraires, délai de règlement de trente jours après la réception des marchandises ou l’exécution de la prestation ; ' +
      'délai convenu plafonné à soixante jours après la date d’émission de la facture, ou, par dérogation expressément stipulée, à quarante-cinq jours fin de mois ; quarante-cinq jours pour une facture périodique. ' +
      'Ces plafonds s’apprécient facture par facture : un délai MOYEN calculé sur des soldes de clôture ne permet pas de conclure à leur respect ou à leur dépassement.',
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038414392',
    dateVerification: DATE_VERIFICATION_SOURCES,
    verification: 'verifiee',
    periodeApplication: 'Version en vigueur depuis le 26 avril 2019 (ordonnance n° 2019-359 du 24 avril 2019, art. 1), affichée « en vigueur » le 2026-11-19.',
  },
} as const satisfies Record<string, SourceRegle>;
