# Catalogue des contrôles de révision

12 contrôles déterministes. Un contrôle sans données suffisantes rend le statut `non_realise` avec son motif ; jamais un résultat favorable par défaut.

| Identifiant | Version | Cycle | Titre | Type de source |
|---|---|---|---|---|
| GEN-001 | 1.0.0 | general | Équilibre débit/crédit des écritures, des journaux et de l’ensemble | interne |
| GEN-002 | 1.0.0 | general | Continuité des séquences de numéros d’écriture | interne |
| GEN-003 | 1.0.0 | general | Dates d’écriture hors exercice | interne |
| GEN-004 | 1.0.0 | general | Doublons potentiels d’écritures | interne |
| GEN-005 | 1.0.0 | cloture | Comptes d’attente non soldés à la clôture | reglementaire |
| TRE-001 | 1.0.0 | tresorerie | Caisse créditrice | reglementaire |
| TRE-002 | 1.0.0 | tresorerie | Banques : solde créditeur à la clôture | interne |
| TIE-001 | 1.0.0 | clients | Clients créditeurs | interne |
| TIE-002 | 1.0.0 | fournisseurs | Fournisseurs débiteurs | interne |
| TIE-003 | 1.0.0 | clients | Ancienneté des soldes tiers non lettrés | interne |
| CAP-001 | 1.0.0 | capitaux_propres | Comptes courants d’associés débiteurs (à examiner) | reglementaire |
| TVA-001 | 1.0.0 | tva | Cadrage global de la TVA collectée (vraisemblance) | interne |

## GEN-001 — Équilibre débit/crédit des écritures, des journaux et de l’ensemble

- **Version** : 1.0.0
- **Cycle** : general
- **Objectif** : S’assurer que chaque écriture, chaque journal et l’ensemble des écritures respectent la partie double.
- **Périmètre** : Toutes les lignes fournies.
- **Données obligatoires** : journalCode, ecritureNum, debit, credit
- **Logique** : Regroupe les lignes par (journal, numéro d’écriture), par journal, puis globalement ; calcule Σ débit − Σ crédit en décimal exact ; un écart en valeur absolue supérieur à la tolérance produit un constat (un par écriture, un par journal, un global).
- **Exceptions et limites** : Une écriture répartie sous plusieurs numéros apparaît déséquilibrée. Les lignes sans numéro d’écriture sont regroupées par journal sous un numéro vide.
- **Résultats attendus** : Aucun écart. Tout écart est une anomalie à corriger avant tout autre contrôle.

**Paramètres (valeurs par défaut)**

| Paramètre | Défaut |
|---|---|
| tolerance | "0.00" |
| maxConstats | 200 |

**Source**

- Type : interne
- Référence : Principe de la partie double (égalité des débits et des crédits de chaque écriture) ; contrôle arithmétique interne, texte non revérifié.
- URL : —
- Vérification : sans_objet
- Période d’application : —

## GEN-002 — Continuité des séquences de numéros d’écriture

- **Version** : 1.0.0
- **Cycle** : general
- **Objectif** : Repérer les numéros d’écriture manquants, indices possibles d’écritures supprimées ou d’un export incomplet.
- **Périmètre** : Numéros d’écriture se terminant par une partie numérique, par journal ou globalement.
- **Données obligatoires** : journalCode, ecritureNum
- **Logique** : HEURISTIQUE. Chaque numéro d’écriture distinct est découpé en préfixe + suffixe numérique. Les numéros sont regroupés par (journal, préfixe) (portée « journal ») ou par préfixe seul (portée « globale ») ; en portée « auto », on retient le regroupement qui produit le moins de numéros manquants (à égalité : par journal). Un groupe de moins de `minEcritures` numéros, ou dont la part de numéros manquants dépasse `tauxLacunesMax` (numérotation manifestement non séquentielle, par exemple fondée sur la date), n’est pas analysé. Chaque trou entre deux numéros consécutifs présents donne un constat.
- **Exceptions et limites** : Numérotations non séquentielles par conception (date, pièce), remises à zéro mensuelles sans préfixe distinctif, numéros réservés puis abandonnés par le logiciel : faux positifs possibles. Une suppression en fin de séquence n’est pas détectable. Les numéros sans suffixe numérique ne sont pas analysés.
- **Résultats attendus** : Aucune rupture. Une rupture appelle une explication (journal extra-comptable, écritures de simulation, suppression).

**Paramètres (valeurs par défaut)**

| Paramètre | Défaut |
|---|---|
| portee | "auto" |
| minEcritures | 3 |
| tauxLacunesMax | 0.5 |
| maxConstats | 200 |

**Source**

- Type : interne
- Référence : Heuristique interne de cabinet (aucun texte n’impose un format de numérotation ; la continuité est un indice, pas une preuve).
- URL : —
- Vérification : sans_objet
- Période d’application : —

## GEN-003 — Dates d’écriture hors exercice

- **Version** : 1.0.0
- **Cycle** : general
- **Objectif** : Repérer les écritures datées avant l’ouverture ou après la clôture de l’exercice révisé.
- **Périmètre** : Toutes les lignes, comparées aux bornes de l’exercice fournies par l’appelant.
- **Données obligatoires** : ecritureDate, exercice.debut, exercice.fin
- **Logique** : Une ligne dont la date d’écriture est strictement antérieure au début ou strictement postérieure à la fin de l’exercice est hors exercice ; un constat par écriture (journal + numéro), montant = total des débits des lignes concernées.
- **Exceptions et limites** : Si l’exercice n’est pas communiqué, le contrôle n’est pas réalisé (aucune déduction à partir des dates du fichier).
- **Résultats attendus** : Aucune écriture hors exercice.

**Paramètres (valeurs par défaut)**

| Paramètre | Défaut |
|---|---|
| maxConstats | 200 |

**Source**

- Type : interne
- Référence : Contrôle de cohérence interne : rattachement des écritures à l’exercice révisé (bornes fournies par l’appelant).
- URL : —
- Vérification : sans_objet
- Période d’application : —

## GEN-004 — Doublons potentiels d’écritures

- **Version** : 1.0.0
- **Cycle** : general
- **Objectif** : Repérer les écritures saisies deux fois (suspicion à confirmer, jamais une certitude).
- **Périmètre** : Écritures de numéros différents, comparées au sein d’un même journal.
- **Données obligatoires** : journalCode, ecritureNum, ecritureDate, compteNum, debit, credit, pieceRef
- **Logique** : Pour chaque écriture, calcule une signature : journal, date, et l’ensemble trié de ses lignes (compte, compte auxiliaire, débit, crédit, référence de pièce). Deux écritures ou plus, de numéros différents, ayant la même signature forment un doublon potentiel. Montant = total débit d’une occurrence.
- **Exceptions et limites** : Opérations réellement identiques le même jour sous la même référence (abonnements, écritures récurrentes) : faux positifs. Un doublon saisi avec une autre date, une autre référence de pièce ou dans un autre journal n’est PAS détecté.
- **Résultats attendus** : Aucun doublon potentiel ; chaque suspicion est à confirmer sur pièce.

**Paramètres (valeurs par défaut)**

| Paramètre | Défaut |
|---|---|
| inclureSansPiece | true |
| montantMinimum | "0.00" |
| maxConstats | 200 |

**Source**

- Type : interne
- Référence : Heuristique interne de cabinet : similarité exacte d’écritures.
- URL : —
- Vérification : sans_objet
- Période d’application : —

## GEN-005 — Comptes d’attente non soldés à la clôture

- **Version** : 1.0.0
- **Cycle** : cloture
- **Objectif** : S’assurer que les comptes d’attente (471 à 473) et transitoires (478) sont soldés ou justifiés à la clôture.
- **Périmètre** : Comptes dont le numéro commence par un des préfixes paramétrés (défaut 471, 472, 473, 478 hors 4781).
- **Données obligatoires** : compteNum, debit, credit, ecritureDate
- **Logique** : Solde = Σ débit − Σ crédit par numéro de compte, sur les lignes datées jusqu’à la clôture (toutes les lignes si l’exercice est inconnu). Un solde dont la valeur absolue dépasse le seuil produit un constat. Les comptes 471 à 473 relèvent de l’obligation de reclassement du PCG ; le compte 478 « Autres comptes transitoires » est ajouté par convention de cabinet (constat de gravité faible).
- **Exceptions et limites** : Le PCG ne qualifie de « comptes d’attente » que les subdivisions 471 à 473 ; 474 à 477 (différences d’évaluation et de conversion) ne sont pas contrôlés ; 4781 « Mali de fusion sur actif circulant » est exclu par défaut car son solde est normal.
- **Résultats attendus** : Solde nul pour chaque compte d’attente à la clôture.

**Paramètres (valeurs par défaut)**

| Paramètre | Défaut |
|---|---|
| prefixesComptes | ["471","472","473","478"] |
| prefixesExclus | ["4781"] |
| seuil | "0.00" |
| maxConstats | 200 |

**Source**

- Type : reglementaire
- Référence : PCG (règlement ANC n° 2014-03), art. 1214-47 « 47 : Comptes transitoires ou d’attente » : les opérations inscrites dans les subdivisions 471 à 473 sont reclassées en fin d’exercice parmi les comptes figurant au modèle de bilan ; plan de comptes : « 471 à 473 Comptes d’attente », « 478 Autres comptes transitoires ».
- URL : https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Plans%20comptables/2026/PCG--1er-janvier-2026.pdf
- Vérification : verifiee (le 2026-11-19)
- Période d’application : Règlement ANC n° 2014-03, version consolidée au 1er janvier 2026 (numérotation des articles issue du règlement ANC n° 2022-06, applicable aux exercices ouverts à compter du 1er janvier 2025).

## TRE-001 — Caisse créditrice

- **Version** : 1.0.0
- **Cycle** : tresorerie
- **Objectif** : Détecter un solde de caisse créditeur à une date quelconque : une caisse ne peut pas contenir un montant négatif d’espèces.
- **Périmètre** : Comptes dont le numéro commence par 53 (paramétrable), chacun suivi séparément.
- **Données obligatoires** : compteNum, ecritureDate, debit, credit
- **Logique** : Pour chaque compte de caisse, les lignes sont classées par date d’écriture et le solde cumulé (débit − crédit) est calculé à la fin de chaque journée (l’ordre des opérations au sein d’une journée n’est pas connu dans un FEC). Un solde de fin de journée inférieur à −seuil produit un constat par compte, avec la première date créditrice, le nombre de jours créditeurs et le solde créditeur maximal (montant du constat). Toutes les lignes fournies sont prises en compte, y compris les à-nouveaux.
- **Exceptions et limites** : Un solde créditeur en cours de journée, résorbé le jour même, n’est pas détecté. Si les à-nouveaux ne figurent pas dans les écritures fournies, le solde calculé part de zéro et le contrôle peut produire de faux positifs. Des écritures de caisse centralisées en fin de mois peuvent masquer ou créer des positions créditrices.
- **Résultats attendus** : Solde de caisse débiteur ou nul à chaque fin de journée.

**Paramètres (valeurs par défaut)**

| Paramètre | Défaut |
|---|---|
| prefixesComptes | ["53"] |
| seuil | "0.00" |
| maxConstats | 200 |

**Source**

- Type : reglementaire
- Référence : PCG (règlement ANC n° 2014-03), art. 1215-53 « 53 : Caisse » : « Son solde est soit débiteur soit nul. »
- URL : https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Plans%20comptables/2026/PCG--1er-janvier-2026.pdf
- Vérification : verifiee (le 2026-11-19)
- Période d’application : Règlement ANC n° 2014-03, version consolidée au 1er janvier 2026 (numérotation des articles issue du règlement ANC n° 2022-06, applicable aux exercices ouverts à compter du 1er janvier 2025).

## TRE-002 — Banques : solde créditeur à la clôture

- **Version** : 1.0.0
- **Cycle** : tresorerie
- **Objectif** : Signaler les comptes de banque créditeurs à la clôture pour examen (découvert, présentation au passif, erreur de sens).
- **Périmètre** : Comptes dont le numéro commence par 512 (paramétrable), chacun suivi séparément.
- **Données obligatoires** : compteNum, debit, credit, ecritureDate
- **Logique** : Solde = Σ débit − Σ crédit par numéro de compte sur les lignes datées jusqu’à la clôture (toutes si l’exercice est inconnu). Un solde créditeur supérieur au seuil produit un constat « à examiner » : ce n’est pas une anomalie en soi.
- **Exceptions et limites** : Un découvert autorisé est une situation normale. Le solde comptable n’est pas le solde bancaire : ce contrôle ne remplace pas le rapprochement bancaire.
- **Résultats attendus** : Constat informatif pour chaque banque créditrice ; à rapprocher de l’autorisation de découvert et du relevé.

**Paramètres (valeurs par défaut)**

| Paramètre | Défaut |
|---|---|
| prefixesComptes | ["512"] |
| seuil | "0.00" |
| maxConstats | 200 |

**Source**

- Type : interne
- Référence : Convention de cabinet (point d’attention de présentation). Contexte : PCG art. 1215-51, pas de compensation entre comptes de banque créditeurs et débiteurs.
- URL : —
- Vérification : sans_objet
- Période d’application : —

## TIE-001 — Clients créditeurs

- **Version** : 1.0.0
- **Cycle** : clients
- **Objectif** : Repérer les comptes clients présentant un solde créditeur à la clôture (avance, avoir à rembourser, double règlement, erreur d’imputation).
- **Périmètre** : Comptes 411 (paramétrable), par compte auxiliaire ; à défaut de compte auxiliaire, par compte général.
- **Données obligatoires** : compteNum, compAuxNum, debit, credit, ecritureDate
- **Logique** : Solde = Σ débit − Σ crédit par (compte général, compte auxiliaire) sur les lignes datées jusqu’à la clôture. Un solde créditeur supérieur au seuil produit un constat.
- **Exceptions et limites** : Les acomptes reçus régulièrement comptabilisés en 4191 ne sont pas concernés. Sans comptes auxiliaires, les soldes créditeurs individuels sont masqués par la compensation au sein du compte général.
- **Résultats attendus** : Aucun client créditeur, ou soldes créditeurs justifiés et reclassés au passif.

**Paramètres (valeurs par défaut)**

| Paramètre | Défaut |
|---|---|
| prefixesComptes | ["411"] |
| seuil | "0.00" |
| maxConstats | 200 |

**Source**

- Type : interne
- Référence : Convention de cabinet (revue des soldes anormaux des comptes de tiers).
- URL : —
- Vérification : sans_objet
- Période d’application : —

## TIE-002 — Fournisseurs débiteurs

- **Version** : 1.0.0
- **Cycle** : fournisseurs
- **Objectif** : Repérer les comptes fournisseurs présentant un solde débiteur à la clôture (acompte, avoir à recevoir, double paiement, facture non comptabilisée).
- **Périmètre** : Comptes 401 (paramétrable), par compte auxiliaire ; à défaut de compte auxiliaire, par compte général.
- **Données obligatoires** : compteNum, compAuxNum, debit, credit, ecritureDate
- **Logique** : Solde = Σ débit − Σ crédit par (compte général, compte auxiliaire) sur les lignes datées jusqu’à la clôture. Un solde débiteur supérieur au seuil produit un constat.
- **Exceptions et limites** : Les acomptes versés régulièrement comptabilisés en 4091 ne sont pas concernés. Sans comptes auxiliaires, les soldes débiteurs individuels sont masqués.
- **Résultats attendus** : Aucun fournisseur débiteur, ou soldes débiteurs justifiés et reclassés à l’actif.

**Paramètres (valeurs par défaut)**

| Paramètre | Défaut |
|---|---|
| prefixesComptes | ["401"] |
| seuil | "0.00" |
| maxConstats | 200 |

**Source**

- Type : interne
- Référence : Convention de cabinet (revue des soldes anormaux des comptes de tiers).
- URL : —
- Vérification : sans_objet
- Période d’application : —

## TIE-003 — Ancienneté des soldes tiers non lettrés

- **Version** : 1.0.0
- **Cycle** : clients
- **Objectif** : Repérer les créances clients et dettes fournisseurs non lettrées anciennes (risque de non-recouvrement, de litige ou d’erreur).
- **Périmètre** : Comptes 411 et 401 (paramétrable), par compte auxiliaire ; lignes sans code de lettrage.
- **Données obligatoires** : compteNum, compAuxNum, ecritureLet, pieceDate, ecritureDate, debit, credit, exercice.fin
- **Logique** : Pour chaque tiers, on retient les lignes non lettrées (EcritureLet vide) datées jusqu’à la clôture. L’âge d’une ligne est le nombre de jours entre sa date de pièce (à défaut sa date d’écriture) et la date de clôture. Si la somme algébrique (débit − crédit) des lignes non lettrées d’âge strictement supérieur à `seuilJours` dépasse en valeur absolue `seuilMontant`, un constat est produit pour ce montant. Seuil par défaut de 90 jours : convention interne.
- **Exceptions et limites** : Si l’exercice est inconnu, ou si aucune ligne des comptes de tiers ne porte de lettrage (lettrage non tenu ou non exporté), le contrôle n’est PAS réalisé : l’ancienneté n’est pas mesurable. Un lettrage partiel peut être exporté sous des formes diverses et fausser le calcul. Les à-nouveaux non détaillés sont datés de l’ouverture.
- **Résultats attendus** : Aucun solde non lettré ancien, ou soldes anciens justifiés (litige, échéancier, dépréciation).

**Paramètres (valeurs par défaut)**

| Paramètre | Défaut |
|---|---|
| prefixesComptes | ["411","401"] |
| seuilJours | 90 |
| seuilMontant | "0.00" |
| maxConstats | 200 |

**Source**

- Type : interne
- Référence : Convention de cabinet : seuil d’ancienneté de 90 jours, paramétrable (aucun texte ne fixe ce seuil).
- URL : —
- Vérification : sans_objet
- Période d’application : —

## CAP-001 — Comptes courants d’associés débiteurs (à examiner)

- **Version** : 1.0.0
- **Cycle** : capitaux_propres
- **Objectif** : Repérer les comptes courants d’associés débiteurs : dans les SARL, SA et SAS, un découvert en compte courant consenti à un dirigeant ou associé personne physique est interdit à peine de nullité.
- **Périmètre** : Comptes 455 (paramétrable), par compte général et compte auxiliaire.
- **Données obligatoires** : compteNum, compAuxNum, ecritureDate, debit, credit
- **Logique** : Pour chaque compte courant, solde cumulé (débit − crédit) en fin de journée par ordre chronologique. Un solde débiteur supérieur au seuil à la clôture produit un constat de gravité élevée ; si `controleInfraAnnuel` est actif, un solde débiteur en cours de période, résorbé à la clôture, produit un constat de gravité moyenne. Le constat est formulé « à examiner » : la forme sociale et la qualité du titulaire (personne physique ou morale, dirigeant ou non) ne figurent pas dans le FEC.
- **Exceptions et limites** : L’interdiction ne vise pas les associés personnes morales, ni les sociétés exploitant un établissement bancaire ou financier pour leurs opérations courantes ; elle ne concerne pas, par ces textes, les sociétés de personnes (SNC, sociétés civiles) ni l’entreprise individuelle. Sans compte auxiliaire ni subdivision par associé, un associé débiteur peut être masqué par un associé créditeur. Les avances à des tiers liés comptabilisées dans d’autres comptes ne sont pas couvertes.
- **Résultats attendus** : Comptes courants d’associés créditeurs ou nuls à tout moment.

**Paramètres (valeurs par défaut)**

| Paramètre | Défaut |
|---|---|
| prefixesComptes | ["455"] |
| seuil | "0.00" |
| controleInfraAnnuel | true |
| maxConstats | 200 |

**Source**

- Type : reglementaire
- Référence : Code de commerce, art. L223-21 (SARL : gérants et associés autres que les personnes morales), art. L225-43 (SA : administrateurs autres que les personnes morales, directeur général, directeurs généraux délégués) et art. L227-12 (SAS : renvoi à L225-43 pour le président et les dirigeants) : interdiction, à peine de nullité du contrat, de se faire consentir par la société un découvert, en compte courant ou autrement. PCG art. 1214-45 : le compte 455 enregistre à son crédit les fonds mis ou laissés à disposition par les associés.
- URL : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006223124
- Vérification : verifiee (le 2026-11-19)
- Période d’application : L223-21 : version en vigueur depuis le 21 septembre 2000 ; L225-43 : version en vigueur depuis le 28 mars 2009 (https://www.legifrance.gouv.fr/codes/id/LEGIARTI000020465599) ; L227-12 : version en vigueur depuis le 21 septembre 2000 (https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006227093).

## TVA-001 — Cadrage global de la TVA collectée (vraisemblance)

- **Version** : 1.0.0
- **Cycle** : tva
- **Objectif** : Apprécier la vraisemblance de la TVA collectée comptabilisée au regard du chiffre d’affaires et des taux attendus. Ce n’est PAS un contrôle de la déclaration de TVA.
- **Périmètre** : Base : comptes 70x (crédit − débit). TVA collectée : comptes 4457x (crédit − débit), hors écritures de liquidation.
- **Données obligatoires** : compteNum, debit, credit, journalCode, ecritureNum
- **Logique** : CONTRÔLE DE VRAISEMBLANCE. Base = Σ (crédit − débit) des comptes de préfixes `prefixesBase` (défaut 70, RRR accordés 709 inclus). TVA = Σ (crédit − débit) des comptes de préfixes `prefixesTva` (défaut 4457), en excluant les lignes des écritures qui mouvementent aussi un compte de préfixes `prefixesLiquidation` (défaut 4455 : écritures de déclaration qui soldent la TVA collectée). Taux apparent = TVA / base. Le taux apparent doit être compris entre le plus petit et le plus grand des `tauxAttendus` (borne basse ramenée à 0 si `ventesSansTvaAdmises`), à `toleranceTaux` points près. Hors bornes : constat, montant = écart de TVA par rapport à la borne franchie.
- **Exceptions et limites** : Faible pouvoir de détection lorsque plusieurs taux coexistent (seules les bornes sont testées). Ne tient pas compte de l’exigibilité (TVA sur encaissements, prestations de services), des opérations exonérées ou hors champ, des exportations et livraisons intracommunautaires (activer `ventesSansTvaAdmises`), de la franchise en base, des cessions d’immobilisations, des acomptes, de la TVA sur autres produits (comptes 74, 75, 77…). Les taux par défaut sont des paramètres (France métropolitaine) et non une source réglementaire du contrôle.
- **Résultats attendus** : Taux apparent compris dans les bornes des taux attendus ; tout écart est à expliquer par un cadrage détaillé.

**Paramètres (valeurs par défaut)**

| Paramètre | Défaut |
|---|---|
| prefixesBase | ["70"] |
| prefixesTva | ["4457"] |
| prefixesLiquidation | ["4455"] |
| tauxAttendus | ["20","10","5.5","2.1"] |
| ventesSansTvaAdmises | false |
| toleranceTaux | "0.05" |
| maxConstats | 200 |

**Source**

- Type : interne
- Référence : Contrôle de vraisemblance interne. Taux par défaut paramétrables : taux normal 20 % (CGI art. 278, consulté sur Légifrance le 2026-11-19, article signalé comme abrogé à terme par l’ordonnance n° 2025-1247 du 17 décembre 2025) ; taux 10 %, 5,5 % et 2,1 % non revérifiés.
- URL : —
- Vérification : sans_objet
- Période d’application : —
