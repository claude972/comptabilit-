/**
 * Sources des règles. Chaque source réglementaire porte sa référence précise, son
 * URL officielle, la date de vérification et sa période d'application. Une source
 * non consultée est marquée `non_verifiee` : on ne fait pas semblant.
 */
import type { SourceRegle } from './controles/types.js';

export const DATE_VERIFICATION_SOURCES = '2026-11-19';

function reglementaire(reference: string, url: string, periodeApplication: string): SourceRegle {
  return {
    type: 'reglementaire',
    reference,
    url,
    dateVerification: DATE_VERIFICATION_SOURCES,
    verification: 'verifiee',
    periodeApplication,
  };
}

export function sourceInterne(reference: string): SourceRegle {
  return { type: 'interne', reference, url: null, dateVerification: null, verification: 'sans_objet', periodeApplication: null };
}

export const URL_PCG_2026 =
  'https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Plans%20comptables/2026/PCG--1er-janvier-2026.pdf';

const PERIODE_PCG =
  'Règlement ANC n° 2014-03, version consolidée au 1er janvier 2026 (numérotation des articles issue du règlement ANC n° 2022-06, applicable aux exercices ouverts à compter du 1er janvier 2025).';

export const SOURCES = {
  fecA47A1: reglementaire(
    'Livre des procédures fiscales, article A47 A-1 (modifié par l’arrêté du 29 juillet 2013, art. 1) : VI (fichiers à plat, séparateur tabulation ou « | »), VII à VIII (18 champs du FEC et leur ordre), IX (nom SirenFECAAAAMMJJ), X (Montant/Sens), XII (jeux de caractères, valeurs numériques et dates).',
    'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000027804775',
    'Version en vigueur depuis le 2 août 2013 (toujours en vigueur le 2026-11-19).',
  ),
  fecBofip: reglementaire(
    'BOFiP, BOI-CF-IOR-60-40-20 « Contrôle des comptabilités informatisées – Format du fichier des écritures comptables ».',
    'https://bofip.impots.gouv.fr/bofip/9028-PGP.html',
    'Version publiée le 07/06/2017, en vigueur depuis cette date.',
  ),
  pcgCompte47: reglementaire(
    'PCG (règlement ANC n° 2014-03), art. 1214-47 « 47 : Comptes transitoires ou d’attente » : les opérations inscrites dans les subdivisions 471 à 473 sont reclassées en fin d’exercice parmi les comptes figurant au modèle de bilan ; plan de comptes : « 471 à 473 Comptes d’attente », « 478 Autres comptes transitoires ».',
    URL_PCG_2026,
    PERIODE_PCG,
  ),
  pcgCaisse: reglementaire(
    'PCG (règlement ANC n° 2014-03), art. 1215-53 « 53 : Caisse » : « Son solde est soit débiteur soit nul. »',
    URL_PCG_2026,
    PERIODE_PCG,
  ),
  pcgBanque: reglementaire(
    'PCG (règlement ANC n° 2014-03), art. 1215-51 : une subdivision du compte 512 par compte bancaire ; « Aucune compensation ne peut être opérée entre les comptes à solde créditeur et les comptes à solde débiteur. »',
    URL_PCG_2026,
    PERIODE_PCG,
  ),
  comptesCourantsAssocies: reglementaire(
    'Code de commerce, art. L223-21 (SARL : gérants et associés autres que les personnes morales), art. L225-43 (SA : administrateurs autres que les personnes morales, directeur général, directeurs généraux délégués) et art. L227-12 (SAS : renvoi à L225-43 pour le président et les dirigeants) : interdiction, à peine de nullité du contrat, de se faire consentir par la société un découvert, en compte courant ou autrement. PCG art. 1214-45 : le compte 455 enregistre à son crédit les fonds mis ou laissés à disposition par les associés.',
    'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006223124',
    'L223-21 : version en vigueur depuis le 21 septembre 2000 ; L225-43 : version en vigueur depuis le 28 mars 2009 (https://www.legifrance.gouv.fr/codes/id/LEGIARTI000020465599) ; L227-12 : version en vigueur depuis le 21 septembre 2000 (https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006227093).',
  ),
  pcgAmortissements: reglementaire(
    'PCG (règlement ANC n° 2014-03), plan de comptes, classe 2 : « 280 Amortissements des immobilisations incorporelles et des frais d’établissement (même ventilation que celle du compte 20) », ' +
      '« 281 Amortissements des immobilisations corporelles (même ventilation que celle du compte 21) », 2812 ↔ 212, 2813 ↔ 213, 2814 ↔ 214, 2815 ↔ 215, 2818 ↔ 218, « 282 Amortissements des immobilisations mises en concession » ; ' +
      'art. 1131-3, I : « le compte 28 “Amortissements des immobilisations” fonctionne comme un compte de sens contraire de celui des comptes de la classe concernée » ; art. 1212-28 : les comptes d’amortissements sont crédités par le débit des comptes 681, 686 ou 687.',
    URL_PCG_2026,
    PERIODE_PCG,
  ),
  pcgBilanOuverture: reglementaire(
    'PCG (règlement ANC n° 2014-03), art. 112-2, dernier alinéa : « Le bilan d’ouverture d’un exercice correspond au bilan de clôture avant répartition de l’exercice précédent. »',
    URL_PCG_2026,
    PERIODE_PCG,
  ),
  bofipBiensFaibleValeur: reglementaire(
    'BOFiP, BOI-BIC-CHG-20-30-10 « BIC - Frais et charges - Distinction entre éléments d’actif et charges - Dérogation aux principes généraux de détermination des actifs et décisions de gestion - Dépenses d’acquisition de biens de faible valeur » : ' +
      'tolérance permettant de comprendre parmi les charges immédiatement déductibles le prix d’acquisition des matériels et outillages « d’une valeur unitaire hors taxes n’excédant pas 500 € » (§ 20), ' +
      'des matériels de bureau et mobiliers « dont le prix d’achat unitaire hors taxes n’excède pas 500 € » (§ 30) et des logiciels « d’une valeur unitaire hors taxes n’excédant pas 500 € » (§ 40). Seuil : 500 € HORS TAXES, par bien.',
    'https://bofip.impots.gouv.fr/bofip/2109-PGP.html',
    'Version publiée le 01/03/2017 (identifiant BOI-BIC-CHG-20-30-10-20170301), affichée « en vigueur du 01/03/2017 à aujourd’hui » lors de la consultation du 2026-11-19.',
  ),
} as const satisfies Record<string, SourceRegle>;
