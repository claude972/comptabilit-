# États et fiscalité (lot 5) — liasse fiscale, projet d’annexe, écritures d’inventaire proposées

Moteur déterministe et pur (`packages/core/src/etats/`) : aucune base, aucun réseau, aucun flottant (montants en chaînes décimales à deux décimales, calculs en décimal exact).

**Rien de ce que produit ce lot n’est « validé ».** Chaque résultat porte le statut `projet` et la mention « Projet, en attente de validation professionnelle : ni comptes annuels, ni déclaration fiscale, ni document validé ou certifié. » Les tables de correspondance sont à l’état `en_attente_de_validation_professionnelle`.

Dernière vérification des sources : **2026-11-19**.

## 1. Ce qui est couvert, partiellement couvert, non couvert

### 1.1 Liasse fiscale — `preparerLiasse`

Périmètre explicite : **société commerciale soumise à l’impôt sur les sociétés, plan comptable général, euros, France métropolitaine**, exercice ouvert à compter du 1er janvier 2025 et clos au plus tard le 30 décembre 2026.

| Tableau | État | Ce qui est préparé | Ce qui manque |
|---|---|---|---|
| 2050 Bilan-actif (réel normal) | partiel | Brut, amortissements et dépréciations, net de l’exercice, par poste ; colonne N-1 (D-103) | Renvois de bas de tableau, codes de cases ; euros entiers à l’écran (D-105) |
| 2051 Bilan-passif | partiel | Montants de l’exercice (avant répartition) | idem |
| 2052 Compte de résultat | partiel | Montants de l’exercice jusqu’au résultat courant | idem + ventilation France / export du chiffre d’affaires |
| 2053 Compte de résultat (suite) | partiel | Exceptionnel, participation, impôt, totaux, bénéfice ou perte | idem + détail des produits et charges exceptionnels |
| 2033-A Bilan simplifié (régime simplifié) | partiel | Montants de l’exercice par ligne agrégée | idem + postes sans ligne certaine (voir 3.3) |
| 2033-B Compte de résultat simplifié | partiel | Partie comptable seulement | idem + **toute la partie « résultat fiscal »** |
| 2054 Immobilisations (cadres A et B) | partiel (D-104) | Valeurs brutes à l’ouverture et à la clôture, augmentations (débits), diminutions totales, par ligne du formulaire, avec N-1 et rapprochement avec le fichier des immobilisations | Réévaluations, ventilation des diminutions (virement / cession) quand des crédits existent, « dont composants » ; euros entiers à l’écran (D-105) ; codes de cases lus, à confirmer |
| 2055 cadres B et C | partiel (D-113) | Saisie ligne par ligne, colonne 7, totaux, non ventilé et montant net à la fin calculés comme le formulaire | Origine des dotations et reprises (décision du cabinet) ; 2053 HG et HC, 2056 TM et TN non préparés |
| 2055 Amortissements (cadre A) | partiel (D-104) | Amortissements à l’ouverture, dotations, diminutions, clôture, avec N-1 ; dotation du moteur comparée à la dotation comptabilisée | Cadres B (amortissements dérogatoires) et C (charges réparties) |
| 2054 bis | partiel (D-112) | Saisie ligne par ligne (cadres A et B), écart, colonne ⑥ et totaux calculés comme le formulaire | Aucune donnée de la balance ; colonne ⑤ non reconstituée |
| 2033-D | partiel (D-114) | Cadres I-A, I-B, I-C, II et III par saisie case par case ; totaux 870 et 780 calculés comme la notice ; contrôles indicatifs | Cadre IV (travailleurs indépendants), feuillets joints |
| 2033-E | partiel (D-115) | Effectifs, produits et charges de la valeur ajoutée par saisie case par case ; totaux 106, 144, 152, valeur ajoutée 137 et case 117 calculés comme le formulaire, seulement si tout est saisi | Dates de période (024, 016), 1330-CVAE-SD |
| 2033-F | partiel (D-116) | Nombres 901 à 904, quatre personnes morales, deux personnes physiques par saisie ligne par ligne ; totaux 905 et 906 calculés comme le formulaire | Tableaux supplémentaires ; données personnelles : voir D-116 |
| 2033-D cadre IV, dates 2033-E / 2059-E | partiel (D-126) | Cases 690 à 693 saisies ; dates 024, 016 et cessation saisies | Revenu brut social non calculé |
| 2033-G | partiel (D-117) | Nombre de filiales (905) et sept lignes par saisie ligne par ligne ; contrôles indicatifs | Tableaux supplémentaires |
| 2056, 2057 | **non couvert** | — | Provisions, état des échéances |
| 2058-A | partiel (D-118) | 73 cases par saisie ; XI, XJ, XN, XO calculés comme le formulaire et la notice ; contrôles indicatifs | Feuillets joints |
| 2058-B, 2058-C | partiel (D-119) | 29 et 47 cases par saisie ; K6, YK, YN, YO, ØF, ZH, ZJ, YX calculés comme le formulaire ; propositions et rapprochements avec le 2058-A | Libellés de nature des provisions, cellules sans code, rapprochement ZJ / YX avec le 2052 | | — | Réintégrations et déductions extra-comptables, déficits, affectation du résultat |
| 2059-E, 2059-F, 2059-G | partiel (D-120) | Mêmes calculs et saisies que 2033-E, 2033-F et 2033-G (codes du régime réel normal pour le 2059-E) | Dates, tableaux supplémentaires |
| 2059-A | partiel (D-121) | Cessions (12 lignes) et rubrique II (7 lignes) par saisie ligne par ligne ; cadres A, B, C calculés comme le formulaire ; contrôles indicatifs | Divers (note annexe), report vers 2058-A |
| 2059-B, 2059-C, 2059-D | partiel (D-122) | Grilles saisies ligne par ligne ; totaux, solde (2+3−4−5) et lignes 3, 6, 7 calculés comme les formulaires | En-têtes cochables, report entre tableaux |
| 2033-C Immobilisations et amortissements (cadres I et II) | partiel (D-104) | Mêmes calculs que 2054 et 2055 au format simplifié, avec N-1 | Cadre III (plus-values et moins-values, prix de cession), colonne 5 (réévaluation) |
| 2033-D à 2033-G | **non couvert** | — | Provisions et dérogatoires, valeur ajoutée, capital, filiales |
| 2065 (page 1) | partiel (D-123) | Cadres C, D, E, F (CES), I (CTM) saisis rubrique par rubrique, deux régimes ; aucun calcul énoncé | Identification, cases à cocher, liquidation, annexe 2065 bis |

**Colonne N-1 (D-103).** Voir `comparatif-n1.md`. `LiasseProjet.comparatif` vaut `fourni` (exercice précédent contigu, préparé par la même table, avant inventaire) ou `indisponible` avec ses motifs ; chaque ligne porte `n1` (`null` si indisponible). Le « idem » des lignes ci-dessus ne contient plus la colonne N-1.

La liste structurée est dans `LiasseProjet.tableauxNonCouverts` (`code`, `intitule`, `couverture`, `motif`, `informationsComplementairesNecessaires`). `complet` vaut toujours `false` dans cette version, et `manques` dit pourquoi.

**Abstention.** Hors périmètre, la fonction rend `{ statut: 'abstention', motifs }` et **aucun chiffre** : territoire autre que la métropole ou « à confirmer », résultat non soumis à l’impôt sur les sociétés ou à confirmer, entité non commerciale ou non renseignée, référentiel autre que PCG, devise autre que EUR, exercice invalide ou hors de la période de la table.

Le régime d’imposition (`reel_normal` / `reel_simplifie`) est une **donnée d’entrée** : le moteur ne le déduit d’aucun seuil (le barème BOI-BAREME-000044 n’a pas été lu).

### 1.1 bis Tableaux 2054, 2055 et 2033-C — `preparerTableauxImmobilisations` (D-104)

Guide utilisateur : `tableaux-immobilisations.md`. Entrées : écritures de l’exercice (et de l’exercice précédent contigu), fichier des immobilisations, régime. Sortie : `TableauxImmobilisationsProjet` (ou la même abstention que la liasse), exposée par `GET v1/exercices/:id/liasse` (champ `tableauxImmobilisations`).

- **Lignes, colonnes et codes de cases** : relus le 2026-11-20 sur les PDF officiels du millésime 2026 (formulaire 2050-LIASSE pages 2054-SD et 2055-SD ; formulaire 2033-SD page 2033-C-SD), par extraction de texte positionnée ; les codes sont `lu_a_confirmer` (jamais vérifiés visuellement ; « Ø » = zéro barré). Une cellule hors formulaire (colonne « diminutions totales ») ou sans code lisible (colonne 5 du 2033-C) porte `codeCase: null`.
- **Calcul** : par compte (`suivreComptes`, partagé avec la rubrique 832-1), regroupé par ligne du formulaire (préfixe de compte le plus précis ; convention interne `conventionRattachementImmobilisations`). Ouverture = journaux d’à-nouveaux ; augmentations = débits hors à-nouveaux ; diminutions = crédits ; clôture = solde. Amortissements : sens inverse.
- **Abstentions** : sans journal d’à-nouveaux → ouverture et mouvements `null` ; réévaluation, valeur d’origine, « dont composants » → à saisir ; ventilation des diminutions → établie seulement si les crédits sont nuls ; totaux tout ou rien ; compte sans ligne → « non ventilé », hors totaux.
- **Fichier des immobilisations** : valeurs brutes à l’ouverture et à la clôture selon le fichier, amortissements antérieurs saisis, sorties d’actif, composants, dotation calculée par le moteur (linéaire ; dégressif non activé) ; immobilisation sans date ou sans base exclue avec motif ; écarts avec la balance affichés, jamais corrigés.
- **Contrôles** : `valeur_brute_egale_projet_de_bilan`, `ouverture_brute_egale_cloture_n1`, `ouverture_amortissements_egale_cloture_n1`, `fichier_valeurs_brutes`, `fichier_dotations`, `dotations_egales_compte_6811`.
- Détail 2052 / 2053 (D-106) et 2033-B (D-107, « dont export » 209 / 215 / 217, huit lignes « dont » en saisie tracée, codes de 24 lignes vérifiés sur le rendu du formulaire) : ventilation France / exportations qualifiée par compte (tracée, abstention sans qualification), détail des produits et charges exceptionnels, 13 renvois en saisie tracée ; partie B « résultat fiscal » du 2033-B (D-110 : saisie justifiée et historisée des neuf lignes, néant explicite, calcul 352 / 354 puis 370 / 372, plafond d’imputation de la notice, abstention explicite) ; détail justifié des totaux 330, 342 et 350 (D-111, 24 cases, contrôle indicatif) ; non préparés : régime de taxation au tonnage, renvois d’exploitant individuel, détail (8) des exercices antérieurs.
- Cadre III du 2033-C et 2054 bis (D-112) : saisie ligne par ligne, justifiée, historisée, avec néant explicite et abstention sans saisie (le classement des plus-values reste une décision du cabinet). 2055 cadres B (amortissements dérogatoires) et C (charges réparties) par saisie justifiée et historisée (D-113). Non préparés : renvois de bas de tableau. L’arrondi à l’euro est proposé à l’écran (D-105).

### 1.2 Projet d’annexe — `preparerAnnexe`

Modèle `ANNEXE-PCG-PERSONNE-MORALE` version `2025.1` : une rubrique par article du chapitre III du titre VIII du PCG, **art. 831-1 à 838-19 (59 articles)**, pour une personne morale.

Statuts par rubrique :

- `pre_rempli` — le moteur a rempli des tableaux à partir des écritures ; `aSaisir` liste ce qui reste à apporter ;
- `a_completer` — information que les écritures ne contiennent pas (règles et méthodes, événements postérieurs, engagements hors bilan, effectif, rémunérations, crédits d’impôt, parties liées…) ;
- `non_applicable_a_confirmer` — l’objet paraît absent de la balance, ou l’article n’est pas requis pour la catégorie retenue. Jamais « non applicable » tout court.

Pré-remplissages : immobilisations, amortissements et dépréciations (ouverture, mouvements débit et crédit hors à-nouveaux, clôture — art. 832-1) ; stocks (832-7) ; dépréciations de l’actif circulant (832-8) ; créances et dettes **sans ventilation par échéance** (832-9, 832-15) ; comptes de régularisation (832-10, 832-17) ; capitaux propres (832-11) ; provisions (832-13) ; chiffre d’affaires par poste (832-18) ; charges à payer et produits à recevoir (832-19) ; résultat exceptionnel (832-21) ; impôt comptabilisé (833-4) ; fonds non remboursables et avances conditionnées (838-18). Détections simples : écart de réévaluation (105), actions propres (502, 2771, 2772), crédit-bail (612), participations (26).

**Complétude.** `complet` n’est vrai que si **chaque rubrique requise** porte une décision du cabinet transmise dans `confirmations` (`complete` ou `non_applicable`). Même alors, le statut reste `projet`.

**Allègements.** La catégorie est fournie par le cabinet : `petite_entreprise` (liste de l’art. 811-9), `personne_morale_regime_simplifie` (art. 811-8), `micro_entreprise` (dispense de l’art. 811-7 si `dispenseAnnexeMicro: true` : six mentions à la suite du bilan ; sinon contenu de la petite entreprise), `moyenne_ou_grande_entreprise` (tout, sauf 834-2), `a_confirmer` (tout, par prudence). `evaluerCategorieTaille` est une aide indicative sur des seuils **paramétrables, marqués « seuil à confirmer »**.

Non couvert : personnes physiques (art. 811-10 et 811-11), rédaction des notes, tableau des flux de trésorerie, appréciation du caractère significatif, exercices ouverts avant le 1er janvier 2025 (abstention).

### 1.3 Écritures d’inventaire proposées — `proposerEcrituresInventaire`

Jamais comptabilisées (décision D-028) : statut `proposee`, équilibre vérifié en décimal exact, origine, justification, calcul détaillé, sources, impacts, hypothèses.

| Règle | Signal exigé | Écriture proposée |
|---|---|---|
| `INV-CCA` 1.0.0 | Ligne de classe 6 de l’exercice dont la période couverte dépasse la clôture (période fournie, ou deux dates complètes dans le libellé) | Débit 486, crédit du compte de charge |
| `INV-PCA` 1.0.0 | Idem pour une ligne de classe 7 | Débit du compte de produit, crédit 487 |
| `INV-FNP` 1.0.0 | Constat `CLO-001` : écriture postérieure à la clôture sur une pièce datée dans l’exercice, réductible à charges + TVA déductible + fournisseur | Débit charges et 44586, crédit 408 TTC |
| `INV-FAE` 1.0.0 | Idem, réductible à produits + TVA collectée + client | Débit 4181 TTC, crédit produits et 44587 |
| `INV-AMORT` 1.1.0 | Valeur brute, date de mise en service et durée **fournies** (valeur résiduelle facultative, déduite du montant amortissable) ; mode linéaire | Débit 6811x, crédit 28x |
| `INV-AMORT-DEG` 1.1.0 | **Calcul activé par l’éditeur** (`AMORTISSEMENT_DEGRESSIF_ACTIVE=true`, **faux par défaut** : abstention motivée, aucun montant) ; mode **dégressif déclaré** par le cabinet, **date d’acquisition** saisie, éligibilité **confirmée** par lui, coefficient **déclaré** et cohérent avec la durée (1,25 : 3 ou 4 ans ; 1,75 : 5 ou 6 ans ; 2,25 : plus de 6 ans) ; durée en années entières (3 à 50) ; exercices de douze mois | Débit 6811x, crédit 28x ; plan année par année joint à la proposition |

Abstention motivée (jamais d’estimation) : début de période absent, années sur deux chiffres, plusieurs périodes dans un libellé, avoir ou sens inverse, comptes exclus (603, 68, 69, 71, 72, 78, 79), pièce postérieure à la clôture sans période, pièce antérieure à l’ouverture, écriture non réductible, donnée d’amortissement manquante ou invalide, plan achevé, bien totalement amorti, compte non déductible.

Non couvert : provisions, dépréciations, stocks, charges à payer sans facture ultérieure, congés payés, intérêts courus, amortissement par unités d’œuvre (il exigerait des données de production), amortissement dérogatoire, plus ou moins-values de cession, exercices de durée différente de douze mois pour le dégressif, écarts de conversion, impôt.

### 1 bis. Amortissements : dégressif, résiduelle, sortie, composants, rapprochement

**État par défaut : le dégressif n’est PAS activé.** La variable `AMORTISSEMENT_DEGRESSIF_ACTIVE` (`packages/plateforme/src/config.ts`, `.env.example`, `infra/production/exemple.env`, `compose.production.yaml`) vaut `false` par défaut ; seule la valeur exacte `true` l’active. Tant qu’elle est fausse, toute immobilisation déclarée en dégressif reçoit une **abstention motivée** (code `degressif_non_active`) : « Calcul du dégressif non activé : le texte de loi (CGI art. 39 A) n’a pas été vérifié sur une source officielle et les règles n’ont pas été validées par un professionnel. L’activation relève de l’éditeur. » Aucun montant, aucun plan, aucune écriture proposée ni reprenable, aucun point « amortissement dérogatoire ». La saisie du mode dégressif reste possible (déclaration du cabinet) ; l’écran de saisie et celui des propositions disent « non activé » avec le motif ; `GET v1/exercices/:id/inventaire/propositions` expose `degressif: { active, motif }`. Le linéaire n’est pas concerné. Les tests du moteur exercent le calcul avec l’option activée **explicitement** (`options.amortissementDegressifActive`) : ce sont des tests de **calcul**, pas une validation fiscale.

#### Sources des règles du dégressif (vérification du 2026-11-20)

Les cinq documents BOFiP ont été consultés sur le site officiel public le 2026-11-20 ; chacun porte la mention « en vigueur du 12/09/2012 à aujourd’hui » (aucune version postérieure) et figure comme version unique dans le stock open data officiel des documents en vigueur `bofip_stock_live_20261028.tgz` (https://bofip.impots.gouv.fr/opendata/stock/10, MD5 publié et vérifié `492e3cb39df9b8101ccf182aa23220b8`). Les flux de mises à jour postérieurs identifiés (n° 46 et 47, jusqu’au 2026-11-18) ne touchent pas la série « Amortissements ». **Lacune** : les flux du 2026-10-29 au 2026-11-11 n’ont pas pu être identifiés dans la liste officielle (le n° 45 est vide, le n° 46 date de 2025) ; la mention « à aujourd’hui » de chaque page, consultée le 2026-11-20, couvre pourtant cette période. Une date ancienne n’invalide pas la règle : sa validité actuelle est établie pour le BOFiP.

| Identifiant | Adresse officielle consultée | Périmètre | Date de consultation | État |
|---|---|---|---|---|
| BOI-BIC-AMT-20-20-30-20120912 | https://bofip.impots.gouv.fr/bofip/4699-PGP.html/identifiant%3DBOI-BIC-AMT-20-20-30-20120912 | Régime de l’amortissement dégressif — modalités de calcul des amortissements déductibles | 2026-11-20 | Vérifiée, en vigueur |
| BOI-BIC-AMT-20-20-20-10-20120912 | https://bofip.impots.gouv.fr/bofip/4698-PGP.html/identifiant%3DBOI-BIC-AMT-20-20-20-10-20120912 | Biens éligibles en raison de la nature des immobilisations | 2026-11-20 | Vérifiée, en vigueur |
| BOI-BIC-AMT-20-20-40-20120912 | https://bofip.impots.gouv.fr/bofip/4749-PGP.html/identifiant%3DBOI-BIC-AMT-20-20-40-20120912 | Amortissement des biens décomposés | 2026-11-20 | Vérifiée, en vigueur |
| BOI-BIC-AMT-20-20-10-20120912 | https://bofip.impots.gouv.fr/bofip/4748-PGP.html/identifiant%3DBOI-BIC-AMT-20-20-10-20120912 | Entreprises concernées | 2026-11-20 | Vérifiée, en vigueur |
| BOI-BIC-AMT-20-10-20120912 | https://bofip.impots.gouv.fr/bofip/4543-PGP.html/identifiant%3DBOI-BIC-AMT-20-10-20120912 | Régime de l’amortissement linéaire | 2026-11-20 | Vérifiée, en vigueur |
| CGI art. 39 A | aucune (aucune adresse inventée) | Conditions d’éligibilité (bien neuf, durée normale d’utilisation d’au moins 3 ans, catégories de biens), majorations | 2026-11-20 | **NON VÉRIFIÉE** : accès automatisé à Légifrance refusé (HTTP 403) ; texte de loi non consulté ; l’API officielle PISTE exige un compte |
| PCG consolidé au 1er janvier 2026 (ANC) | Voir tableau 3 | Art. 214-4, 214-8, 214-9, 214-11 à 214-14, comptes 145, 6872, 7872 | 2026-11-20 | Vérifiée |

« Vérifiée » signifie : la source a été lue sur son site officiel ; **aucune règle n’est pour autant validée par un professionnel**.

**Confirmé par le texte en vigueur** (BOI-BIC-AMT-20-20-30 § 120 à 160, § 190 à 240, et les autres documents) : coefficient 1,25 pour une durée normale d’utilisation de 3 ou 4 ans, 1,75 pour 5 ou 6 ans, 2,25 au-delà de 6 ans ; taux dégressif = taux linéaire × coefficient ; annuités suivantes sur la valeur résiduelle comptable ; bascule vers le linéaire quand l’annuité dégressive devient inférieure à valeur résiduelle ÷ années restantes (présentée comme une **faculté** de l’entreprise) ; exemple chiffré (10 000 €, 10 ans, 22,5 %, 2/12 la première année) ; structure et composants d’un bien décomposé amortissables en dégressif si le bien est éligible (20-20-40).

**Contredit par le texte en vigueur, corrigé** : le point de départ de la première annuité dégressive est le **premier jour du mois d’acquisition (ou de construction)**, non la mise en service (§ 190 à 200) ; le moteur partait de la mise en service. Il exige désormais une **date d’acquisition** saisie (colonne `immobilisations.date_acquisition`, migration 0044, contrainte `date_acquisition <= date_mise_en_service`) : sans elle, abstention motivée (`date_acquisition_manquante`) ; l’API la rend obligatoire en dégressif, facultative sinon, et la refuse si elle est postérieure à la mise en service.

**Non établi** : (1) le texte de loi (CGI art. 39 A) — le BOFiP cite ces conditions, mais c’est de la doctrine ; (2) les coefficients **majorés ou diminués** de certains biens d’équipement, renvoyés par le BOFiP à BOI-BIC-AMT-20-20-50 (version du 2015-09-02), **non lu**. Le moteur ne les gère pas : un coefficient différent de la règle générale provoque une abstention (`coefficient_incoherent`) qui le dit ; la contrainte de base de données (coefficient ∈ {1,25 ; 1,75 ; 2,25}) est inchangée. Les cas particuliers ne sont **pas pris en charge** (le dire à l’écran et ici).

#### Activer le dégressif (procédure)

1. Une personne ayant accès à Légifrance (l’accès automatisé est refusé) vérifie le texte en vigueur du CGI art. 39 A et de l’annexe II art. 22 : conditions d’éligibilité, catégories de biens, majorations ; et lit BOI-BIC-AMT-20-20-50 pour les coefficients majorés ou diminués.
2. Un expert-comptable valide les règles du moteur (coefficients, point de départ, bascule, traitement de l’amortissement dérogatoire).
3. Seulement ensuite, l’éditeur passe `AMORTISSEMENT_DEGRESSIF_ACTIVE=true` dans l’environnement de l’API (`.env`, `infra/production/exemple.env` / `compose.production.yaml`) et redémarre l’API. L’écran affiche alors « activé » avec la mention que le texte de loi et la validation sont à confirmer tant qu’ils ne l’ont pas été ; mettre à jour `SOURCES_FISCALES.cgiArticle39A` (`verification`, URL, date) au même moment.

#### Règles de calcul (lorsque le calcul est activé)

- **Dégressif** : jamais proposé sans activation par l’éditeur, déclaration explicite du mode, date d’acquisition, confirmation de l’éligibilité (bien neuf, durée d’au moins trois ans, bien visé par l’art. 39 A, hors exclusions : le cabinet en répond, le moteur ne la vérifie pas) et coefficient déclaré égal à celui de la règle générale. Taux = 100 ÷ durée en années × coefficient ; première annuité = montant amortissable × taux × mois ÷ 12, **à compter du premier jour du mois d’acquisition** (mois d’acquisition compris) ; annuités suivantes sur la valeur nette comptable ; **bascule au linéaire** dès que valeur nette ÷ exercices restants dépasse l’annuité dégressive (annuité linéaire ensuite constante) : c’est une **faculté** de l’entreprise que le moteur applique systématiquement, ce que chaque proposition écrit dans ses hypothèses (« bascule au linéaire appliquée dès qu’elle devient plus favorable ; c’est une faculté de l’entreprise ») ; dernière annuité = solde : la somme des dotations égale **exactement** le montant amortissable. Le test reprend l’exemple du BOFiP (10 000 €, 10 ans, taux 22,5 %, acquisition en novembre : 375 ; 2 166 ; 1 678 ; 1 301 ; 1 008 ; 781 ; 673…) : écart nul à l’euro près sur les neuf premières annuités ; la dernière (672 imprimée) est le solde des arrondis du BOFiP, le moteur donne 672,75 au centime. Ces tests vérifient le **calcul** contre un exemple de la doctrine, pas la conformité fiscale.
- **Point de départ** : le premier jour du mois d’acquisition saisi (voir ci-dessus) ; pour le **linéaire**, la mise en service (inchangé).
- **Amortissement dérogatoire** : jamais fabriqué. Le dégressif déclaré est le mode du plan **comptable** (PCG art. 214-13) ; s’il n’est que fiscal, le complément est un amortissement dérogatoire (compte 145, dotation 6872, reprise 7872 ; PCG art. 214-8) : le moteur le **signale** (« À traiter par le professionnel ») sans proposer d’écriture.
- **Valeur résiduelle** (PCG art. 214-4, seulement si significative et mesurable) : `baseAmortissable` est désormais la **valeur brute** ; montant amortissable = valeur brute − valeur résiduelle (strictement inférieure à la brute).
- **Sortie d’actif** : si la date de sortie est antérieure ou égale à la clôture, abstention motivée (ni dotation prorata, ni plus ou moins-value de cession) : l’immobilisation n’est pas ignorée.
- **Composants** (PCG art. 214-9) : chaque composant est une ligne d’immobilisation avec sa durée, rattachée à sa structure (un seul niveau) ; chaque ligne a son plan.
- **Rapprochement avec la comptabilité importée** : dotation déjà comptabilisée (débit − crédit du compte de dotation de l’exercice, 68111 ou 68112) → **aucune dotation n’est reproposée** pour les immobilisations de ce compte, l’écart avec le calcul est affiché et jamais corrigé ; dotation à un compte 6811 non ventilé → prudence, pas de doublon ; solde d’un compte d’immobilisation rapproché de la valeur brute saisie (écart, ou absence de solde) ; comptes 20x/21x de la balance sans immobilisation saisie (hors 206, 207, 211) → « à saisir ». Limite : plusieurs immobilisations alimentent le même compte de dotation, donc une dotation passée au 68112 écarte les propositions de **toutes** les immobilisations corporelles.

#### Reprise du fichier des immobilisations par import CSV (D-092)

Le fichier des immobilisations d'un dossier peut être **repris d'un fichier CSV** (page `/dossiers/:id/inventaire/reprise`, `POST v1/dossiers/:id/reprises-immobilisations/apercu` puis `POST …/reprises-immobilisations`) en trois temps : **aperçu** sans aucune écriture (correspondance des colonnes proposée d'après les en-têtes usuels et modifiable, statut de chaque ligne), **validation explicite** par une personne de niveau « collaboration » (celui de la saisie manuelle) sur l'empreinte de l'aperçu confirmé, **rapport** ligne par ligne conservé et téléchargeable. Formats : CSV (séparateur `;` `,` ou tabulation, UTF-8 ou ISO-8859-15 détectés ou imposés, virgule ou point décimal, dates JJ/MM/AAAA ou AAAA-MM-JJ) ; **XLSX non pris en charge** (aucune bibliothèque de lecture de classeur dans le dépôt) ; 5 Mio et 5 000 lignes au plus.

- **Mêmes contrôles que la saisie manuelle** (même schéma `schemaImmobilisation` du moteur) : valeur brute strictement positive, valeur résiduelle inférieure à la brute, amortissements antérieurs bornés, sortie après la mise en service, et, en dégressif, **date d'acquisition obligatoire**, compte de classe 21, durée en années entières de 3 à 50, éligibilité confirmée ou infirmée (jamais devinée), coefficient déclaré cohérent avec la durée. Règles propres à l'import : comptes 20 et 21, durée en mois ou en années (une colonne sans unité n'est pas proposée), montants à deux décimales au plus sans arrondi (un montant ambigu est rejeté), dates sans ambiguïté.
- **Le dégressif d'un fichier est enregistré comme déclaration du cabinet ; le calcul reste en abstention tant que `AMORTISSEMENT_DEGRESSIF_ACTIVE` est faux** (non modifiée par cette reprise).
- **Doublons** (même dossier, désignation normalisée, date de mise en service, valeur brute) : ignorés avec motif, jamais écrasants ; une immobilisation existante n'est ni modifiée, ni remplacée, ni supprimée ; rejeu d'un même fichier idempotent.
- Les valeurs commençant par `=`, `+`, `-` ou `@` sont neutralisées à l'affichage du rapport et dans son CSV ; aucune formule n'est évaluée.
- Ces règles de lecture (noms de colonnes, formats, comptes 20 et 21) sont des conventions d'ingénierie, essayées sur des fichiers synthétiques seulement, non validées par un professionnel ni éprouvées sur de vrais exports de logiciels comptables.

## 2. Tables et versions

| Table | Version | Portée | Source | État |
|---|---|---|---|---|
| `PCG-SYSTEME-DE-BASE` (existante) | 2025.1 | Comptes → rubriques des modèles du PCG | PCG art. 821-1, 821-2 | En attente de validation professionnelle |
| `LIASSE-BIC-IS-RN` | 2026.1 | Rubriques → lignes des tableaux 2050 à 2053, millésime 2026 | Formulaire 2050-LIASSE (**non lu**) | En attente de validation professionnelle |
| `LIASSE-BIC-IS-RSI` | 2026.1 | Rubriques → lignes des tableaux 2033-A et 2033-B, millésime 2026 | Formulaire 2033-SD (**non lu**) | En attente de validation professionnelle |
| `ANNEXE-PCG-PERSONNE-MORALE` | 2025.1 | Articles du PCG → rubriques d’annexe | PCG art. 811-6 à 811-12, 831-1 à 838-19 | En attente de validation professionnelle |
| Règles `INV-*` | 1.0.0 | Écritures d’inventaire | PCG (articles cités par règle) | En attente de validation professionnelle |

Période des tables de liasse : exercices ouverts à compter du `2025-01-01` et clos au plus tard le `2026-12-30`. La borne de clôture est une **convention interne prudente** (le millésime 2026 sert aux déclarations déposées en 2026 ; un exercice clos le 31 décembre 2026 relèvera du millésime 2027, à vérifier à sa publication).

Une ligne de liasse est toujours un **regroupement de rubriques de la table des comptes**, jamais une nouvelle affectation : les totaux de la liasse se rapprochent donc mécaniquement des projets de bilan et de compte de résultat. `verifierTableLiasse` contrôle qu’aucune rubrique n’est reprise deux fois ni oubliée.

## 3. Sources et état de vérification

| Source | Référence | État au 2026-11-19 |
|---|---|---|
| PCG, version consolidée au 1er janvier 2026 (ANC) | Art. 211-8, 214-11 à 214-14, 321-7, 811-1 à 811-12, 821-1, 821-2, 822-1, 822-2, 831-1 à 838-19, 1212-28, 1214-40, 1214-48, plan de comptes | **Vérifiée** — PDF officiel lu en texte |
| Règlement ANC n° 2022-06 du 4 novembre 2022 | Application aux exercices ouverts à compter du 1er janvier 2025 | **Vérifiée** pour la date (extrait sur anc.gouv.fr) ; règlement non relu intégralement |
| BOFiP BOI-BIC-DECLA-30-10-10-20 (17/02/2017) | Liste et intitulés des tableaux 2050 à 2059-G ; « tracé prévu par le plan comptable général » | **Vérifiée** — ne décrit ni lignes ni cases ; antérieure au règlement 2022-06 |
| BOFiP BOI-BIC-DECLA-30-20-10 (19/08/2026) | Liste et intitulés des tableaux 2033-A à 2033-G | **Vérifiée** — vise les entreprises à l’impôt sur le revenu ; renvoie au BOI-IS-DECLA-10 (non lu) |
| BOFiP BOI-BIC-AMT-20-20-30, 20-20-20-10, 20-20-40, 20-20-10 et 20-10 (version du 12/09/2012) | Amortissement dégressif et linéaire (voir 1 bis : adresses, périmètres) | **Vérifiée** le 2026-11-20 — « en vigueur du 12/09/2012 à aujourd’hui » ; confirmée dans le stock open data `bofip_stock_live_20261028` |
| Légifrance, CGI art. 39 A | Conditions et majorations du dégressif | **Non vérifiée** — accès automatisé refusé (HTTP 403) ; aucune URL consignée |
| Entreprendre.service-public.gouv.fr, actualité A17100 (05/03/2024) | Seuils micro / petite / moyenne entreprise (décret n° 2024-152) | **Vérifiée** — page ancienne : seuils **à confirmer** |
| impots.gouv.fr, formulaire 2050-LIASSE et notice 2032-NOT-SD, millésime 2026 | Tracé, libellés et cases des tableaux 2050 à 2059-G | **Lus le 2026-11-20 pour 2054 et 2055 seulement** (PDF, SHA-256 dans `SOURCES_FISCALES`) ; **non lus** pour 2050 à 2053 et 2056 à 2059-G (site en maintenance le 2026-11-19) |
| impots.gouv.fr, formulaire 2033-SD et notice, millésime 2026 | Tracé, libellés et cases des tableaux 2033-A à 2033-G | **Lus le 2026-11-20 pour 2033-C seulement** (cadres I et II) ; **non lus** pour les autres tableaux |
| impots.gouv.fr, formulaire 2065-SD | Déclaration de résultats à l’impôt sur les sociétés | **Non vérifiée** |
| Légifrance, code de commerce L. 123-16, L. 123-16-1, L. 123-25, D. 123-200 | Catégories de taille, seuils, règle des deux exercices | **Non vérifiée** — accès automatisé refusé (HTTP 403) |
| BOFiP BOI-BAREME-000044 | Limites de chiffre d’affaires du régime simplifié | **Non vérifiée** — non lu |

Toutes les références sont dans `SOURCES_FISCALES` au format `SourceRegle` (référence, URL, date de vérification, `verification`, période d’application). Chaque résultat restitue ses sources.

### 3.1 Conséquence : aucun code de case (sauf 2054, 2055 et 2033-C)

*Mise à jour du 2026-11-20 (D-104) : impots.gouv.fr répond de nouveau ; les tableaux 2054, 2055 et 2033-C ont été relus (lignes, colonnes, codes « lus, à confirmer » — voir 1.1 bis). Ce qui suit reste vrai de tous les autres tableaux de la liasse.*

Le 2026-11-19, impots.gouv.fr affichait « Le site impots.gouv.fr est actuellement en maintenance […] vous ne pouvez pas consulter la documentation et les actualités, ni télécharger de formulaire ». **Aucun formulaire n’a donc été lu.** Par conséquent :

- chaque ligne porte `codeCase: null` et `etatCodeCase: 'a_confirmer'` ; les identifiants (`RN_2050_A_TERRAINS`, `RSI_2033B_AUTRES_PRODUITS`…) sont **internes** ;
- les numéros CERFA (15949, 15948) ne sont connus que par des extraits de moteur de recherche : à confirmer ;
- avant toute saisie ou télétransmission, il faut relire le formulaire du millésime et établir la correspondance ligne interne → case.

### 3.2 Régime réel normal

Les lignes sont **dérivées par programme** des postes des modèles du PCG (art. 821-1 et 821-2) — `origineLibelle: 'modele_pcg'`, libellés relus sur le texte. Le BOFiP indique que les tableaux comptables suivent le tracé du plan comptable général, mais dans une version de 2017 : la façon dont le millésime 2026 a intégré les changements du règlement 2022-06 (cessions d’immobilisations en exploitation, résultat exceptionnel restreint, disparition des transferts de charges) **n’a pas pu être vérifiée**. La répartition entre 2052 (jusqu’au résultat courant) et 2053 (exceptionnel et suite) est le tracé usuel, à confirmer.

### 3.3 Régime simplifié

Les lignes agrégées reprennent le **tracé usuel** des tableaux 2033-A et 2033-B — `origineLibelle: 'trace_usuel_non_relu'`. Les postes du bilan ou du compte de résultat sans ligne certaine restent **non affectés** (`rubriquesNonAffectees`) et hors de tout total de la liasse ; l’écart apparaît alors dans les contrôles : capital souscrit non appelé, frais d’établissement, capital appelé non versé, frais d’émission et primes de remboursement des emprunts, écarts de conversion, primes d’émission, écart d’équivalence, subventions d’investissement, autres fonds propres, quotes-parts de résultat sur opérations faites en commun, participation des salariés.

## 4. Contrôles de cohérence de la liasse

Un écart est **affiché, jamais forcé** ; il est repris dans `manques`.

| Code | Vérifie |
|---|---|
| `balance_equilibree` | Total des débits = total des crédits |
| `total_actif_egal_total_passif` | Total général actif = total général passif |
| `resultat_compte_de_resultat_egal_resultat_bilan` | Résultat du 2053 ou 2033-B = résultat porté au bilan |
| `report_total_actif_projet_de_bilan`, `report_total_passif_projet_de_bilan`, `report_resultat_projet_de_compte_de_resultat` | Les totaux de la liasse reprennent ceux des projets existants |
| `resultat_egal_solde_des_classes_6_et_7` | Aucun compte de gestion n’est resté hors du résultat |
| `tiers_soldes_inverses_non_reclasses` | Clients créditeurs et fournisseurs débiteurs non reclassés |

## 5. Conventions

- **Montants** : chaînes décimales à deux décimales ; arrondi demi-unité éloignée de zéro. **L’arrondi à l’euro n’est pas pratiqué par l’API ; l’écran l’offre en présentation (`?montants=euros`, D-105).**
- **Signes** : actif = net ; passif et produits = crédit − débit ; charges = débit − crédit ; résultats = produits − charges. Impacts des propositions : positif = augmentation.
- **Résultat au bilan** : celui de la balance (compte 12 augmenté du solde des classes 6 et 7 non soldées), jamais substitué.
- **Sens des soldes** : apprécié par compte général, pas par tiers.
- **Charges et produits constatés d’avance** : prorata en **jours calendaires réels, bornes incluses** ; part postérieure = du lendemain de la clôture à la fin de la période. Montant de la ligne réputé hors taxes.
- **Période dans un libellé** : retenue seulement si deux dates complètes (année sur quatre chiffres) y figurent une seule fois. Un libellé est un contenu non fiable : l’hypothèse est écrite dans la proposition.
- **Amortissement dégressif** : voir 1 bis (calcul non activé par défaut ; durée en années entières, exercices de douze mois du premier au dernier jour d’un mois, sinon abstention).
- **Amortissement linéaire** : par défaut **année de 360 jours** (mois de 30 jours, le dernier jour d’un mois compte pour le 30), jour de mise en service inclus ; option `jours_reels`. Si les amortissements antérieurs sont fournis, ils plafonnent la dotation et soldent le plan.
- **Comptes des écritures proposées** : fournis par le cabinet, sinon repris des écritures du dossier, sinon construits à partir de la racine du plan de comptes complétée de zéros — toujours signalé en hypothèse.
- **Annexe** : à-nouveaux reconnus par leur journal (`AN`, `ANO`, `RAN` par défaut) ; sans à-nouveaux identifiés, ouverture et mouvements valent `null`. « Augmentations » et « diminutions » sont des mouvements débit et crédit bruts, à qualifier.

## 6. Ce qui exige une validation par un expert-comptable

1. **Correspondance lignes internes → cases** des formulaires du millésime 2026, à établir sur les formulaires et leurs notices.
2. **Tracé des tableaux 2052 et 2053** après le règlement ANC n° 2022-06.
3. **Tracé du 2033-A et du 2033-B** : contenu de chaque ligne agrégée et ligne d’accueil des postes laissés non affectés.
4. **Table des comptes `PCG-SYSTEME-DE-BASE`** dont tout dépend (déjà en attente de validation, D-030).
5. **Borne de clôture** de la période des tables de liasse et millésime applicable aux exercices décalés.
6. **Seuils et règles de taille** (code de commerce, non relu) : montants en vigueur, règle des deux exercices consécutifs, entités exclues ; **contenu de l’annexe des moyennes entreprises** (tableau de l’art. 811-12 illisible en extraction texte) et de la micro-entreprise qui établit une annexe.
7. **Caractère significatif** des informations d’annexe et rédaction des notes.
8. **Conventions de prorata** : jours réels pour les charges et produits constatés d’avance, 360 jours par défaut pour l’amortissement.
9. **Factures non parvenues et à établir** : la date de pièce n’est qu’un indice du rattachement ; traitement de la TVA (44586, 44587) ; schéma d’écriture des factures à établir (symétrique de l’art. 1214-40, lecture interne).
10. **Dérivation des comptes** d’amortissement (28x) et de dotation (68111, 68112).
10 bis. **Amortissements dégressifs** (calcul non activé par défaut) : texte du CGI art. 39 A (non lu : Légifrance refuse l’accès automatisé) ; BOI-BIC-AMT-20-20-50 (coefficients majorés ou diminués, non lu) ; coefficients et conditions d’éligibilité ; point de départ (premier jour du mois d’acquisition, établi par le BOFiP en vigueur) ; bascule au linéaire (faculté appliquée systématiquement) ; traitement de l’amortissement dérogatoire (non proposé) ; rapprochement par compte de dotation ; non-prise en compte de la valeur résiduelle dans le dégressif fiscal.
11. **Arrondi à l’euro** : règle lue sur les notices 2026 et appliquée à l’affichage (D-105) ; non établis : l’arrondi des totaux (somme des arrondis ou arrondi de la somme) et celui des montants négatifs. **Renvois de bas de tableau** : non préparés (consignes de remplissage).
11 bis. **Détail du compte de résultat (D-106, D-107)** : scission des comptes 70 entre biens et services ; nature des comptes proposés pour les renvois HP, HQ, HX, A3, A4, CB_MOB, CB_IMM. Les codes de cases des tableaux 2052, 2053 (lignes FA à FL et 14 renvois) et 2033-B (24 lignes, 209 / 215 / 217, 243, 255, 259, 260, 347, 348) sont vérifiés sur le rendu image des PDF 2026 le 2026-11-21 ; les codes des autres tableaux restent à confirmer.
12. Tout ce qui n’est pas couvert : résultat fiscal, tableaux 2054 bis à 2059-G (2054 et 2055 préparés en partie), 2033-D à G (2033-C préparé en partie), 2065.
13. **Tableaux 2054, 2055 et 2033-C** (D-104) : rattachement des comptes aux lignes (convention interne fondée sur la numérotation du PCG ; ventilation fine du 218, des immobilisations financières et des frais d’établissement du régime simplifié), ventilation des diminutions, réévaluation, composants, vérification visuelle des codes de cases lus.

## 7. Écarts entre les sources et la demande initiale

- Les codes de cases n’ont pas pu être vérifiés : aucun n’est fourni (voir 3.1).
- Les seuils micro et petite entreprise ont été lus sur service-public.gouv.fr, pas sur Légifrance : paramétrables et marqués « à confirmer ».
- Le BOFiP lu pour le régime simplifié vise les entreprises à l’impôt sur le revenu ; la page propre à l’impôt sur les sociétés n’a pas été lue.
- Le règlement ANC n° 2022-06 n’est pas cité dans le texte du PCG consolidé ; sa date d’application a été confirmée séparément sur anc.gouv.fr.
- L’annexe comporte 59 articles (831-1 à 838-19), dont 19 « autres informations » situationnelles.

## 8. API publique (exportée par `@comtaple/core`)

```ts
preparerLiasse(demande: DemandeLiasse): ResultatLiasse            // LiasseProjet | LiasseAbstention
tableLiassePour(regime, exercice): TableLiasse | null
verifierTableLiasse(table, correspondance?): string[]
preparerAnnexe(demande: DemandeAnnexe): ResultatAnnexe            // AnnexeProjet | AnnexeAbstention
evaluerCategorieTaille(mesures, seuils?): EvaluationTaille
articlesRequisPourCategorie(categorie, tousLesArticles): { articles: string[]; motif: string }
proposerEcrituresInventaire(demande: DemandeInventaire): ResultatInventaire
preparerTableauxImmobilisations(demande: DemandeTableauxImmobilisations): ResultatTableauxImmobilisations // TableauxImmobilisationsProjet | LiasseAbstention (D-104)
lirePeriodeDansLibelle(libelle: string)
```

Constantes : `TABLE_LIASSE_REEL_NORMAL_2026`, `TABLE_LIASSE_REEL_SIMPLIFIE_2026`, `TABLES_LIASSE`, `PERIMETRE_LIASSE`, `DERNIERE_CLOTURE_COUVERTE_LIASSE_2026`, `MODELE_ANNEXE`, `ARTICLES_ANNEXE`, `SEUILS_TAILLE_PAR_DEFAUT`, `REGLES_INVENTAIRE`, `CONVENTIONS_INVENTAIRE`, `SOURCES_FISCALES`, `MENTION_PROJET`.

Tous les résultats sont sérialisables en JSON tels quels. Fichiers : `liasse.ts`, `annexe.ts`, `inventaire.ts`, `tableaux-immobilisations.ts`, `sources-fiscales.ts` et leurs tests.
