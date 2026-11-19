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
} as const satisfies Record<string, SourceRegle>;
