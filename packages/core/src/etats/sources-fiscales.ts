/**
 * Sources du lot « États et fiscalité » : liasse fiscale, projet d'annexe, propositions d'écritures d'inventaire.
 *
 * État des consultations du 2026-11-19 — on ne fait pas semblant :
 *  - PCG (ANC, version consolidée au 1er janvier 2026) : PDF officiel téléchargé et lu en texte ; les articles cités ici
 *    ont été relus un par un → `verifiee` ;
 *  - BOFiP : pages lues en ligne → `verifiee` (pour ce qu'elles disent : la LISTE et les intitulés des tableaux, pas leurs cases) ;
 *  - impots.gouv.fr : site « en maintenance » le jour de la consultation (« vous ne pouvez pas consulter la documentation
 *    […] ni télécharger de formulaire ») : AUCUN formulaire (2050 à 2059-G, 2033-A à G, 2065) ni notice n'a pu être lu
 *    → `non_verifiee`. Conséquence : aucun code de case n'est fourni ;
 *  - Légifrance : accès automatisé refusé (HTTP 403) → `non_verifiee` ; les seuils de taille ont été lus sur
 *    entreprendre.service-public.gouv.fr (page du 5 mars 2024), pas sur l'article D. 123-200 lui-même.
 *
 * Consultation du 2026-11-20 (amortissements dégressifs, valeur résiduelle, composants, dérogatoires) :
 *  - PCG (version consolidée au 1er janvier 2026) : PDF officiel de l'ANC relu en texte, articles 214-4, 214-8, 214-9, 214-11 à 214-14
 *    et comptes 145, 6872, 7872 → `verifiee` ;
 *  - BOFiP (série « Amortissements », 5 documents) : pages officielles consultées le 2026-11-20, chacune portant la mention « en vigueur du
 *    12/09/2012 à aujourd'hui » (aucune version postérieure) ; même version unique dans le stock open data officiel des documents en
 *    vigueur `bofip_stock_live_20261028` (MD5 publié vérifié) ; les flux de mises à jour postérieurs identifiés ne touchent pas la série.
 *    Lacune dite : les flux du 2026-10-29 au 2026-11-11 n'ont pas pu être identifiés ; la mention « à aujourd'hui » de chaque page couvre
 *    cette période → `verifiee` (VALIDITÉ ACTUELLE ÉTABLIE : une date ancienne n'invalide pas la règle). Le renvoi vers
 *    BOI-BIC-AMT-20-20-50 (coefficients majorés ou diminués de certains biens d'équipement, version 2015-09-02) n'a PAS été lu :
 *    ces cas ne sont pas gérés ;
 *  - CGI art. 39 A : Légifrance refuse l'accès automatisé (HTTP 403) ; l'API officielle PISTE exige un compte → `non_verifiee`, SANS URL
 *    inventée ; son contenu n'est connu que par les citations du BOFiP (doctrine, pas texte de loi). Le dégressif reste donc NON ACTIVÉ
 *    par défaut (AMORTISSEMENT_DEGRESSIF_ACTIVE) tant que le texte de loi n'a pas été vérifié et les règles validées par un professionnel.
 */
import type { SourceRegle } from '../controles/types.js';
import { DATE_VERIFICATION_SOURCES, URL_PCG_2026, sourceInterne } from '../sources.js';

const PERIODE_PCG_2025 =
  'Règlement ANC n° 2014-03, version consolidée au 1er janvier 2026 ; dispositions issues du règlement ANC n° 2022-06, applicables aux exercices ouverts à compter du 1er janvier 2025.';

function pcg(reference: string): SourceRegle {
  return { type: 'reglementaire', reference, url: URL_PCG_2026, dateVerification: DATE_VERIFICATION_SOURCES, verification: 'verifiee', periodeApplication: PERIODE_PCG_2025 };
}

function lue(reference: string, url: string, periodeApplication: string): SourceRegle {
  return { type: 'reglementaire', reference, url, dateVerification: DATE_VERIFICATION_SOURCES, verification: 'verifiee', periodeApplication };
}

/** Source officielle identifiée mais NON LUE le jour de la vérification (site indisponible ou accès refusé). */
function nonLue(reference: string, url: string, periodeApplication: string): SourceRegle {
  return { type: 'reglementaire', reference, url, dateVerification: DATE_VERIFICATION_SOURCES, verification: 'non_verifiee', periodeApplication };
}

const DATE_CONSULTATION_AMORTISSEMENTS = '2026-11-20';

function pcgAmortissement(reference: string): SourceRegle {
  return { type: 'reglementaire', reference, url: URL_PCG_2026, dateVerification: DATE_CONSULTATION_AMORTISSEMENTS, verification: 'verifiee', periodeApplication: PERIODE_PCG_2025 };
}


/** Document officiel LU le 2026-11-20 (impots.gouv.fr de nouveau accessible) : texte extrait du PDF, jamais vérifié visuellement. */
function luLe20Novembre(reference: string, url: string, periodeApplication: string): SourceRegle {
  return { type: 'reglementaire', reference, url, dateVerification: DATE_CONSULTATION_AMORTISSEMENTS, verification: 'verifiee', periodeApplication };
}

const PRECISION_BOFIP_EN_VIGUEUR =
  'En vigueur du 12/09/2012 à aujourd’hui, consultée le 2026-11-20 sur la page officielle ; confirmée dans le stock open data `bofip_stock_live_20261028` (https://bofip.impots.gouv.fr/opendata/stock/10, MD5 492e3cb39df9b8101ccf182aa23220b8 vérifié). ' +
  'Aucune version postérieure ; flux du 2026-10-29 au 2026-11-11 non identifiés (couverts par la mention « à aujourd’hui » de la page). Règle non validée par un professionnel.';

function bofipEnVigueur(reference: string, url: string, perimetre: string): SourceRegle {
  return { type: 'reglementaire', reference: `${reference} — périmètre : ${perimetre}`, url, dateVerification: DATE_CONSULTATION_AMORTISSEMENTS, verification: 'verifiee', periodeApplication: PRECISION_BOFIP_EN_VIGUEUR };
}

const MOTIF_IMPOTS_GOUV =
  'NON LU : le 2026-11-19, impots.gouv.fr affichait « Le site impots.gouv.fr est actuellement en maintenance […] vous ne pouvez pas consulter la documentation et les actualités, ni télécharger de formulaire ». ' +
  'Le tracé, les libellés de lignes et les codes de cases du millésime 2026 sont donc À CONFIRMER sur le formulaire.';

export const SOURCES_FISCALES = {
  // ───────────────────────────── Liasse fiscale ─────────────────────────────
  liasseReelNormalFormulaire: nonLue(
    'DGFiP, formulaire n° 2050-LIASSE « Liasse fiscale BIC/IS – régime réel normal » (tableaux n° 2050-SD à 2059-G-SD), millésime 2026. ' +
      'Le numéro CERFA (15949) n’est connu que par un extrait de moteur de recherche et par le BOFiP : à confirmer. ' + MOTIF_IMPOTS_GOUV,
    'https://www.impots.gouv.fr/formulaire/2050-liasse/liasse-fiscale-du-regime-reel-normal-en-matiere-de-bic-et-dis',
    'Millésime 2026 (déclarations de résultats déposées en 2026). Millésimes suivants : à vérifier à leur publication.',
  ),
  liasseReelNormalNotice: nonLue(
    'DGFiP, notice n° 2032-NOT-SD « Notice pour remplir la liasse BIC/IS – régime RN (tableaux n° 2050-SD à 2059-G-SD) », millésime 2026. ' + MOTIF_IMPOTS_GOUV,
    'https://www.impots.gouv.fr/formulaire/2032-not-sd/notice-pour-remplir-la-liasse-bicis-regime-rn-tableaux-ndeg-2050-sd-2059-g-s',
    'Millésime 2026.',
  ),
  liasseReelSimplifieFormulaire: nonLue(
    'DGFiP, formulaire n° 2033-SD « Liasse BIC/IS – régime RSI » (tableaux n° 2033-A-SD à 2033-G-SD) et notice n° 2033-NOT-SD, millésime 2026. ' +
      'Le numéro CERFA (15948) n’est connu que par un extrait de moteur de recherche : à confirmer. ' + MOTIF_IMPOTS_GOUV,
    'https://www.impots.gouv.fr/formulaire/2033-sd/liasse-bicsi-regime-rsi-tableaux-ndeg-2033-sd-2033-g-sd',
    'Millésime 2026 (déclarations de résultats déposées en 2026). Millésimes suivants : à vérifier à leur publication.',
  ),
  declarationResultatsIs: nonLue(
    'DGFiP, formulaire n° 2065-SD « Impôt sur les sociétés » (déclaration de résultats) et annexes. Formulaire non recherché ni lu le 2026-11-19 (impots.gouv.fr en maintenance) : son contenu n’est pas couvert par le moteur.',
    'https://www.impots.gouv.fr/formulaire/2065-sd/impot-sur-les-societes',
    'À vérifier.',
  ),
  bofipListeTableauxReelNormal: lue(
    'BOFiP, BOI-BIC-DECLA-30-10-10-20 « BIC – Obligations fiscales et comptables dans le cadre du régime du réel normal d’imposition – Forme et contenu de la déclaration spéciale de résultats » : ' +
      'liste des tableaux annexes 2050-SD « Bilan-actif », 2051-SD « Bilan-passif », 2052-SD « Compte de résultat », 2053-SD « Compte de résultat (suite) », 2054-SD « Immobilisations », 2055-SD « Amortissements », ' +
      '2056-SD « Provisions inscrites au bilan », 2057-SD « État des échéances des créances et des dettes à la clôture de l’exercice », 2058-A-SD « Détermination du résultat fiscal », ' +
      '2058-B-SD « Déficits, indemnités de congés payés et provisions non déductibles », 2058-C-SD « Tableau d’affectation du résultat et renseignements divers », 2059-A-SD à 2059-D-SD (plus-values et moins-values), ' +
      '2059-E-SD « Détermination de la valeur ajoutée produite au cours de l’exercice », 2059-F-SD « Composition du capital social », 2059-G-SD « Filiales et participation », et 2054 bis-SD (écarts de réévaluation). ' +
      'La page indique que les tableaux comptables suivent le tracé prévu par le plan comptable général et que le compte de résultat est présenté hors taxes. ' +
      'LIMITES : la page ne décrit ni les lignes ni les cases ; elle date de 2017 et vise le tracé du PCG alors en vigueur, antérieur au règlement ANC n° 2022-06.',
    'https://bofip.impots.gouv.fr/bofip/3385-PGP.html/identifiant=BOI-BIC-DECLA-30-10-10-20-20170217',
    'Version publiée le 17/02/2017, affichée « en vigueur » lors de la consultation du 2026-11-19.',
  ),
  bofipListeTableauxReelSimplifie: lue(
    'BOFiP, BOI-BIC-DECLA-30-20-10 « BIC – Obligations fiscales et comptables dans le cadre du régime du réel simplifié d’imposition – Obligations fiscales » : ' +
      'liste des tableaux annexes 2033-A-SD « bilan simplifié actif et passif », 2033-B-SD « compte de résultat simplifié de l’exercice », 2033-C-SD « immobilisations, amortissements, plus-values et moins-values », ' +
      '2033-D-SD « relevé des provisions, amortissements dérogatoires, déficits reportables et divers », 2033-E-SD « tableau de détermination de la valeur ajoutée produite au cours de l’exercice et des effectifs », ' +
      '2033-F-SD « tableau de composition du capital social », 2033-G-SD « filiales et participations ». ' +
      'LIMITES : la page traite des entreprises relevant de l’impôt sur le revenu et renvoie au BOI-IS-DECLA-10 (non lu) pour les sociétés à l’IS ; elle ne décrit ni les lignes ni les cases ; ' +
      'les limites de chiffre d’affaires du régime simplifié sont renvoyées au BOI-BAREME-000044 (non lu).',
    'https://bofip.impots.gouv.fr/bofip/2833-PGP.html/identifiant=BOI-BIC-DECLA-30-20-10-20260819',
    'Version publiée le 19/08/2026.',
  ),
  bofipSeuilsRegimeSimplifie: nonLue(
    'BOFiP, BOI-BAREME-000044 (IV § 60) : montants limites de chiffre d’affaires du régime simplifié d’imposition, révisés tous les trois ans. Barème NON LU : le moteur ne détermine pas le régime d’imposition, ' +
      'qui est une donnée d’entrée fournie par le cabinet.',
    'https://bofip.impots.gouv.fr/bofip/2833-PGP.html/identifiant=BOI-BIC-DECLA-30-20-10-20260819',
    'À vérifier.',
  ),
  conventionLiasse: sourceInterne(
    'Convention interne : les lignes de la liasse sont des regroupements des rubriques de la table PCG-SYSTEME-DE-BASE (elle-même en attente de validation professionnelle). ' +
      'Aucune case du formulaire n’est désignée : les identifiants de lignes sont internes et le code de case est « à confirmer ».',
  ),

  formulaires2054_2055Lus: luLe20Novembre(
    'DGFiP, formulaire n° 2050-LIASSE millésime 2026 (PDF 2050-liasse_5320.pdf, 19 pages, SHA-256 0bba33528b893ba8aa581d97bbc6ddb7d59a78fdbc234920596bce228f8453e1, téléchargé le 2026-11-20 depuis la page officielle) : ' +
      'SEULS les tableaux 2054-SD « Immobilisations » (cadres A et B) et 2055-SD « Amortissements » (cadre A) ont été relus, pour leurs lignes, leurs colonnes et leurs codes de cases. ' +
      'LIMITES : le texte a été extrait du PDF par programme (positions des libellés et des codes), non vérifié visuellement ; le symbole « Ø » (zéro barré) est repris tel quel ; les cadres B et C du 2055, le 2054 bis et tous les autres tableaux n’ont pas été exploités.',
    'https://www.impots.gouv.fr/formulaire/2050-liasse/liasse-fiscale-du-regime-reel-normal-en-matiere-de-bic-et-dis',
    'Millésime 2026 (déclarations de résultats déposées en 2026).',
  ),
  formulaire2033CLu: luLe20Novembre(
    'DGFiP, formulaire n° 2033-SD millésime 2026 (PDF 2033-sd_5394.pdf, 7 pages, SHA-256 ce4c519097fa435e9bd0ca3956016e5e05321c6f07db341285c9f46fb177b6cb, téléchargé le 2026-11-20 depuis la page officielle) : ' +
      'SEUL le tableau 2033-C-SD, cadres I « Immobilisations » et II « Amortissements », a été relu, pour ses lignes, ses colonnes et ses codes de cases (numériques). ' +
      'LIMITES : texte extrait du PDF par programme, non vérifié visuellement ; le cadre III (plus-values et moins-values) et les autres tableaux n’ont pas été exploités ; la colonne 5 du cadre I (réévaluation légale) n’a pas de code de case lisible.',
    'https://www.impots.gouv.fr/formulaire/2033-sd/liasse-bicsi-regime-rsi-tableaux-ndeg-2033-sd-2033-g-sd',
    'Millésime 2026 (déclarations de résultats déposées en 2026).',
  ),
  noticesImmobilisationsLues: luLe20Novembre(
    'DGFiP, notice n° 2032-NOT-SD millésime 2026 (PDF 2032-not-sd_5323.pdf, SHA-256 68ac608323f7dfca3fa86606856f115db800a20c5cb7c0505d69f56c50f26f39) et notice n° 2033-NOT-SD millésime 2026 (PDF 2033-sd_5395.pdf, SHA-256 b0a4352237d3ef279a87180831a7ae5e32ba417cdbaca8fb831dbd9081c7a6d1), téléchargées le 2026-11-20 : ' +
      'passages relus sur les tableaux 2054, 2055 et 2033-C : « les postes particuliers prévus par les plans comptables professionnels doivent être rattachés aux postes dont relèvent normalement les immobilisations, compte tenu de leur nature » ; ' +
      'le cadre A du 2055 « retrace la situation des comptes d’amortissement présentés en déduction des postes d’immobilisations à l’actif du bilan » ; la colonne 4 du cadre B du 2054 porte la valeur d’origine servant au calcul des amortissements ; les amortissements dérogatoires relèvent du cadre B du 2055. ' +
      'LIMITES : la notice ne donne PAS de table des comptes par ligne : le rattachement des comptes du PCG aux lignes est une convention interne (voir `conventionRattachementImmobilisations`).',
    'https://www.impots.gouv.fr/formulaire/2032-not-sd/notice-pour-remplir-la-liasse-bicis-regime-rn-tableaux-ndeg-2050-sd-2059-g-s',
    'Millésime 2026.',
  ),
  conventionRattachementImmobilisations: sourceInterne(
    'Convention interne : chaque compte de classe 20 à 27 (valeurs brutes) ou 28 (amortissements) est rattaché à la ligne du formulaire par son numéro dans le plan comptable général (préfixe le plus précis : p. ex. 2135 et 2145 aux « installations générales, agencements et aménagements des constructions », 2181 à « installations générales, agencements, aménagements divers », 2182 au matériel de transport, 2183 et 2184 au matériel de bureau, informatique et mobilier, le reste du 218 à « emballages récupérables et divers »). ' +
      'Un compte qu’aucune ligne ne reprend est présenté à part (« non ventilé ») et n’entre dans aucun total du formulaire. Rattachement NON validé par un professionnel ; la ventilation fine des comptes 218 et des immobilisations financières est à confirmer.',
  ),

  // ───────────────────────────── Annexe ─────────────────────────────
  annexeContenu: pcg(
    'PCG (règlement ANC n° 2014-03), livre III, titre VIII, chapitre III « Contenu de l’annexe des comptes annuels » : art. 831-1 à 831-4 (principes et méthodes comptables), 832-1 à 832-10 (actif), ' +
      '832-11 à 832-17 (passif), 832-18 à 832-21 (compte de résultat), 833-1 à 833-4 (fiscalité), 834-1 et 834-2 (transactions non conclues aux conditions normales de marché), ' +
      '835-1 et 835-2 (organes d’administration, de direction ou de surveillance), 836-1 à 836-5 (opérations et engagements hors bilan), 837-1 et 837-2 (effectif), 838-1 à 838-19 (autres informations). ' +
      'Art. 811-6 : « Ces informations ne sont pas limitatives. En revanche, les informations sans importance significative ne sont pas à fournir. »',
  ),
  annexeAllegements: pcg(
    'PCG (règlement ANC n° 2014-03), art. 811-7 (les micro-entreprises définies à l’article L. 123-16-1 du code de commerce peuvent ne pas établir d’annexe ; elles mentionnent alors six informations à la suite de leur bilan), ' +
      'art. 811-8 (personnes morales relevant de l’article L. 123-25 du code de commerce, régime réel simplifié d’imposition : art. 831-1, 831-2, 832-1, 832-3, 832-8, 832-9, 832-12, 832-13, 832-15, 834-2, 836-1, 836-3, 836-5, 838-1 et suivants), ' +
      'art. 811-9 (personnes morales répondant aux critères de la petite entreprise de l’article L. 123-16 : art. 831-1, 831-2, 832-1 à 832-15, 832-17, 832-19, 832-21, 833-1, 833-2, 834-2, 835-1, 836-1, 836-2, 836-3, 836-5, 837-1, 838-1 et suivants), ' +
      'art. 811-12 (tableau récapitulatif par type d’entité). LIMITE : dans l’extraction en texte du PDF, les cases grisées du tableau de l’art. 811-12 ne sont pas lisibles ; pour les moyennes entreprises et les autres personnes morales, ' +
      'le moteur retient l’ensemble des articles 831-1 à 838-19, ce qui reste à confirmer sur le tableau.',
  ),
  seuilsTailleServicePublic: lue(
    'Entreprendre.service-public.gouv.fr (DILA), actualité A17100 du 5 mars 2024, citant le décret n° 2024-152 du 28 février 2024 et l’article D. 123-200 du code de commerce : ' +
      'micro-entreprise : total du bilan 450 000 €, chiffre d’affaires net 900 000 €, 10 salariés ; petite entreprise : 7 500 000 €, 15 000 000 €, 50 salariés ; moyenne entreprise : 25 000 000 €, 50 000 000 €, 250 salariés ; ' +
      'une entreprise ne doit pas dépasser deux des trois seuils ; seuils applicables aux comptes des exercices ouverts à compter du 1er janvier 2024. ' +
      'LIMITE : page d’actualité de mars 2024, signalée par le site comme ancienne ; la version en vigueur de l’article D. 123-200 n’a pas pu être relue sur Légifrance : SEUILS À CONFIRMER.',
    'https://entreprendre.service-public.gouv.fr/actualites/A17100',
    'Exercices ouverts à compter du 1er janvier 2024, sous réserve d’une modification ultérieure non vérifiée.',
  ),
  seuilsTailleCodeDeCommerce: nonLue(
    'Code de commerce, art. L. 123-16 (petites et moyennes entreprises), L. 123-16-1 (micro-entreprises), L. 123-25 (régime simplifié) et D. 123-200 (seuils, modifié par le décret n° 2024-152 du 28 février 2024). ' +
      'NON LUS : Légifrance a refusé l’accès automatisé (HTTP 403) le 2026-11-19. Ne sont donc pas vérifiés : les montants en vigueur, la règle de franchissement sur deux exercices consécutifs, ' +
      'la définition du total du bilan, du chiffre d’affaires net et du nombre moyen de salariés, et les entités exclues des allègements.',
    'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000049216681',
    'À vérifier.',
  ),
  reglement2022_06: lue(
    'Autorité des normes comptables, règlement n° 2022-06 du 4 novembre 2022 modifiant le règlement n° 2014-03 relatif au plan comptable général (homologué par arrêté du 26 décembre 2023, JO du 30 décembre 2023) : ' +
      'applicable aux comptes afférents aux exercices ouverts à compter du 1er janvier 2025, application anticipée possible. Date confirmée sur anc.gouv.fr (extrait du règlement) ; le règlement n’a pas été relu intégralement : ' +
      'c’est la version consolidée du PCG au 1er janvier 2026 qui a été lue.',
    'https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Reglements/2022/R2022_06/R2022_06.pdf',
    'Exercices ouverts à compter du 1er janvier 2025.',
  ),

  // ───────────────────────────── Écritures d'inventaire ─────────────────────────────
  chargesConstateesAvance: pcg(
    'PCG (règlement ANC n° 2014-03), art. 211-8 : « Les charges constatées d’avance sont des actifs qui correspondent à des achats de biens ou de services dont la fourniture ou la prestation interviendra ultérieurement. » ; ' +
      'art. 1214-48 : le compte 486 « est débité, en fin d’exercice, par le crédit des comptes de charges intéressés. Il est crédité, à l’ouverture de l’exercice suivant, par le débit de ces mêmes comptes. » ' +
      'Le PCG ne fixe pas la méthode de calcul du prorata : le prorata temporis en jours est une convention interne.',
  ),
  produitsConstatesAvance: pcg(
    'PCG (règlement ANC n° 2014-03), art. 321-7 : « Les produits constatés d’avance constituent des passifs. » ; art. 1214-48 : le compte 487 « enregistre les produits perçus ou comptabilisés avant que les prestations ou les fournitures ' +
      'les justifiant aient été effectuées ou fournies. Il est crédité, en fin d’exercice, par le débit des comptes de produits intéressés. » Le PCG ne fixe pas la méthode de calcul du prorata : convention interne.',
  ),
  facturesNonParvenues: pcg(
    'PCG (règlement ANC n° 2014-03), art. 1214-40 : « Le compte 408 “Fournisseurs - Factures non parvenues” est crédité, à la clôture de la période comptable, du montant, taxes comprises, des factures imputables à la période close ' +
      'mais non encore parvenues, dont le montant est suffisamment connu et évaluable, par le débit des comptes concernés des classes 4 et 6. À l’ouverture de la période suivante, ces écritures sont contre-passées. » ; ' +
      'plan de comptes : 44586 « Taxes sur le chiffre d’affaires sur factures non parvenues ».',
  ),
  facturesAEtablir: pcg(
    'PCG (règlement ANC n° 2014-03), plan de comptes : 4181 « Clients - Factures à établir », 44587 « Taxes sur le chiffre d’affaires sur factures à établir » ; ' +
      '« Dans les comptes de la classe 4, la terminaison 8 est affectée à l’enregistrement des produits à recevoir et des charges à payer rattachés aux comptes qu’ils concernent. » ' +
      'Le schéma d’écriture (débit 4181 toutes taxes comprises, crédit du compte de produits et du compte 44587) est le symétrique de celui que l’art. 1214-40 décrit pour les factures non parvenues : lecture interne, à valider.',
  ),
  amortissementLineaire: pcg(
    'PCG (règlement ANC n° 2014-03), art. 214-4 (« Le montant amortissable d\'un actif est sa valeur brute sous déduction de sa valeur résiduelle » ; la valeur résiduelle n\'est prise en compte que « lorsqu\'elle est à la fois significative et mesurable »), art. 214-9 (composants : « un plan d\'amortissement propre à chacun de ces éléments »), art. 214-11 (« A la clôture de l’exercice, une dotation aux amortissements est comptabilisée conformément au plan d’amortissement pour chaque actif amortissable »), ' +
      'art. 214-12 (« L’amortissement d’un actif commence à la date de début de consommation des avantages économiques qui lui sont attachés. Cette date correspond généralement à la mise en service de l’actif. »), ' +
      'art. 214-13 (« Le mode linéaire est appliqué à défaut de mode mieux adapté. »), art. 1212-28 (les comptes d’amortissements sont crédités par le débit des comptes 681, 686 ou 687) ; ' +
      'plan de comptes : 68111 « Immobilisations incorporelles et frais d’établissement », 68112 « Immobilisations corporelles », 280 et 281 « même ventilation » que les comptes 20 et 21. ' +
      'Le PCG ne fixe pas la convention de décompte des jours (année de 360 jours ou jours réels) : convention interne paramétrable.',
  ),
  amortissementDegressif: {
    type: 'reglementaire',
    reference:
      'BOFiP BOI-BIC-AMT-20-20-30 « Régime de l’amortissement dégressif — calcul » : taux = taux linéaire (100 ÷ durée normale d’utilisation) × coefficient (§ 100 et 120 : 1,25 pour 3 ou 4 ans, 1,75 pour 5 ou 6 ans, 2,25 au-delà de 6 ans) ; ' +
      'première annuité réduite des mois écoulés avant le premier jour du mois de départ (§ 180 à 220) ; annuités suivantes sur la valeur résiduelle comptable (§ 230) ; bascule au linéaire quand l’annuité dégressive est inférieure à valeur résiduelle ÷ nombre d’années restantes (§ 240 à 260) ; ' +
      'exemple chiffré à dix ans, coefficient 2,25 (§ 350 et 360). Conditions : BOI-BIC-AMT-20-20-20-10 (biens neufs, § 410 ; voitures de tourisme exclues, § 60 ; mobilier de bureau exclu, § 250) et BOI-BIC-AMT-20-10 § 90 (durée inférieure à trois ans exclue). ' +
      'Le complément d’amortissement dégressif fiscal se comptabilise en amortissement dérogatoire (BOI-BIC-AMT-20-20, introduction du régime).',
    url: 'https://bofip.impots.gouv.fr/bofip/4699-PGP.html/identifiant%3DBOI-BIC-AMT-20-20-30-20120912',
    dateVerification: DATE_CONSULTATION_AMORTISSEMENTS,
    verification: 'verifiee',
    periodeApplication: PRECISION_BOFIP_EN_VIGUEUR + ' Périmètre : régime de l’amortissement dégressif, modalités de calcul des amortissements déductibles. Point de départ de la première annuité : premier jour du mois d’acquisition ou de construction (§ 190 à 200). Coefficients majorés ou diminués de certains biens d’équipement (BOI-BIC-AMT-20-20-50) : non analysés, non gérés.',
  },
  bofipBiensEligibles: bofipEnVigueur(
    'BOFiP BOI-BIC-AMT-20-20-20-10-20120912 « Biens éligibles en raison de la nature des immobilisations »',
    'https://bofip.impots.gouv.fr/bofip/4698-PGP.html/identifiant%3DBOI-BIC-AMT-20-20-20-10-20120912',
    'biens éligibles au dégressif en raison de leur nature',
  ),
  bofipBiensDecomposes: bofipEnVigueur(
    'BOFiP BOI-BIC-AMT-20-20-40-20120912 « Amortissement des biens décomposés »',
    'https://bofip.impots.gouv.fr/bofip/4749-PGP.html/identifiant%3DBOI-BIC-AMT-20-20-40-20120912',
    'structure et composants d’un bien décomposé, amortissables en dégressif si le bien est éligible',
  ),
  bofipEntreprisesConcernees: bofipEnVigueur(
    'BOFiP BOI-BIC-AMT-20-20-10-20120912 « Entreprises concernées »',
    'https://bofip.impots.gouv.fr/bofip/4748-PGP.html/identifiant%3DBOI-BIC-AMT-20-20-10-20120912',
    'entreprises pouvant pratiquer l’amortissement dégressif',
  ),
  bofipLineaire: bofipEnVigueur(
    'BOFiP BOI-BIC-AMT-20-10-20120912 « Régime de l’amortissement linéaire »',
    'https://bofip.impots.gouv.fr/bofip/4543-PGP.html/identifiant%3DBOI-BIC-AMT-20-10-20120912',
    'régime de l’amortissement linéaire, point de départ à la mise en service, durée inférieure à trois ans',
  ),
  amortissementDegressifPcg: pcgAmortissement(
    'PCG (règlement ANC n° 2014-03), art. 214-13 (« Le mode d’amortissement doit permettre de traduire au mieux le rythme de consommation des avantages économiques attendus de l’actif […] Le mode linéaire est appliqué à défaut de mode mieux adapté »), ' +
      'art. 214-14 (plan défini à l’entrée du bien à l’actif, révision prospective) et art. 214-4 (valeur résiduelle). Le PCG ne définit pas le dégressif : le choix du mode comptable est celui de l’entité.',
  ),
  cgiArticle39A: {
    type: 'reglementaire',
    reference:
      'CGI art. 39 A (amortissement dégressif, coefficients de majoration) et annexe II art. 22 : NON VÉRIFIÉ — accès automatisé à Légifrance refusé (HTTP 403) le 2026-11-20 ; texte de loi non consulté ; l’API officielle PISTE exige un compte. Le contenu n’en est connu que par les citations du BOFiP (doctrine, pas texte de loi) ; ' +
      'les conditions (bien neuf, durée normale d’utilisation d’au moins trois ans, catégories de biens), les majorations et les coefficients sont à confirmer sur le texte en vigueur par une personne ayant accès à Légifrance.',
    url: null,
    dateVerification: DATE_CONSULTATION_AMORTISSEMENTS,
    verification: 'non_verifiee',
    periodeApplication: 'À vérifier : texte en vigueur au 2026-11-20 non lu (accès automatisé à Légifrance refusé, HTTP 403).',
  },
  amortissementDerogatoire: pcgAmortissement(
    'PCG (règlement ANC n° 2014-03), art. 214-8 (amortissements dérogatoires, comptabilisés au sein des provisions réglementées lorsque des textes de niveau supérieur les prescrivent ou les autorisent) ; ' +
      'plan de comptes : 145 « Amortissements dérogatoires », 6872 « Dotations aux provisions réglementées (immobilisations) » (68725 « Amortissements dérogatoires »), 7872 « Reprises sur provisions réglementées (immobilisations) » (78725). ' +
      'BOFiP BOI-BIC-AMT-20-20 (introduction du régime) : « Le complément d’amortissement résultant de l’application du mode dégressif sera comptabilisé en amortissements dérogatoires » (page BOFiP en vigueur du 12/09/2012 à aujourd’hui, consultée le 2026-11-20).',
  ),
  conventionProrata: sourceInterne(
    'Convention interne de calcul : prorata temporis en jours calendaires réels, bornes incluses, pour les charges et produits constatés d’avance ; pour l’amortissement linéaire, année de 360 jours (mois de 30 jours) par défaut ' +
      'ou jours réels sur option. Arrondi au centime, demi-unité éloignée de zéro. Aucun texte ne fixe ces conventions : à valider par le cabinet.',
  ),
  cesure: pcg(
    'PCG (règlement ANC n° 2014-03), art. 112-3 (le compte de résultat récapitule les produits et les charges de l’exercice, sans qu’il soit tenu compte de leur date d’encaissement ou de paiement) et art. 513-1 (résultat de l’exercice). ' +
      'Le rattachement proposé à partir du contrôle de césure CLO-001 repose sur la date de pièce, qui n’est qu’un indice : convention interne.',
  ),
} as const satisfies Record<string, SourceRegle>;

/** Mention portée par tous les états de ce lot. */
export const MENTION_PROJET = 'Projet, en attente de validation professionnelle : ni comptes annuels, ni déclaration fiscale, ni document validé ou certifié.';
