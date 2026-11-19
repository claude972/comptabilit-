# États et fiscalité (lot 5) — liasse fiscale, projet d’annexe, écritures d’inventaire proposées

Moteur déterministe et pur (`packages/core/src/etats/`) : aucune base, aucun réseau, aucun flottant (montants en chaînes décimales à deux décimales, calculs en décimal exact).

**Rien de ce que produit ce lot n’est « validé ».** Chaque résultat porte le statut `projet` et la mention « Projet, en attente de validation professionnelle : ni comptes annuels, ni déclaration fiscale, ni document validé ou certifié. » Les tables de correspondance sont à l’état `en_attente_de_validation_professionnelle`.

Dernière vérification des sources : **2026-11-19**.

## 1. Ce qui est couvert, partiellement couvert, non couvert

### 1.1 Liasse fiscale — `preparerLiasse`

Périmètre explicite : **société commerciale soumise à l’impôt sur les sociétés, plan comptable général, euros, France métropolitaine**, exercice ouvert à compter du 1er janvier 2025 et clos au plus tard le 30 décembre 2026.

| Tableau | État | Ce qui est préparé | Ce qui manque |
|---|---|---|---|
| 2050 Bilan-actif (réel normal) | partiel | Brut, amortissements et dépréciations, net de l’exercice, par poste | Colonne N-1, renvois de bas de tableau, arrondi à l’euro, codes de cases |
| 2051 Bilan-passif | partiel | Montants de l’exercice (avant répartition) | idem |
| 2052 Compte de résultat | partiel | Montants de l’exercice jusqu’au résultat courant | idem + ventilation France / export du chiffre d’affaires |
| 2053 Compte de résultat (suite) | partiel | Exceptionnel, participation, impôt, totaux, bénéfice ou perte | idem + détail des produits et charges exceptionnels |
| 2033-A Bilan simplifié (régime simplifié) | partiel | Montants de l’exercice par ligne agrégée | idem + postes sans ligne certaine (voir 3.3) |
| 2033-B Compte de résultat simplifié | partiel | Partie comptable seulement | idem + **toute la partie « résultat fiscal »** |
| 2054, 2054 bis, 2055, 2056, 2057 | **non couvert** | — | Mouvements d’immobilisations et d’amortissements, provisions, état des échéances |
| 2058-A, 2058-B, 2058-C | **non couvert** | — | Réintégrations et déductions extra-comptables, déficits, affectation du résultat |
| 2059-A à 2059-G | **non couvert** | — | Plus-values, valeur ajoutée fiscale, composition du capital, filiales |
| 2033-C à 2033-G | **non couvert** | — | Mêmes informations, au format simplifié |
| 2065 et annexes | **non couvert** | — | Résultat fiscal, identification, liquidation de l’impôt |

La liste structurée est dans `LiasseProjet.tableauxNonCouverts` (`code`, `intitule`, `couverture`, `motif`, `informationsComplementairesNecessaires`). `complet` vaut toujours `false` dans cette version, et `manques` dit pourquoi.

**Abstention.** Hors périmètre, la fonction rend `{ statut: 'abstention', motifs }` et **aucun chiffre** : territoire autre que la métropole ou « à confirmer », résultat non soumis à l’impôt sur les sociétés ou à confirmer, entité non commerciale ou non renseignée, référentiel autre que PCG, devise autre que EUR, exercice invalide ou hors de la période de la table.

Le régime d’imposition (`reel_normal` / `reel_simplifie`) est une **donnée d’entrée** : le moteur ne le déduit d’aucun seuil (le barème BOI-BAREME-000044 n’a pas été lu).

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
| `INV-AMORT` 1.0.0 | Base, date de mise en service et durée **fournies** | Débit 6811x, crédit 28x |

Abstention motivée (jamais d’estimation) : début de période absent, années sur deux chiffres, plusieurs périodes dans un libellé, avoir ou sens inverse, comptes exclus (603, 68, 69, 71, 72, 78, 79), pièce postérieure à la clôture sans période, pièce antérieure à l’ouverture, écriture non réductible, donnée d’amortissement manquante ou invalide, plan achevé, bien totalement amorti, compte non déductible.

Non couvert : provisions, dépréciations, stocks, charges à payer sans facture ultérieure, congés payés, intérêts courus, amortissement dégressif ou par unités d’œuvre, composants, écarts de conversion, impôt.

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
| Entreprendre.service-public.gouv.fr, actualité A17100 (05/03/2024) | Seuils micro / petite / moyenne entreprise (décret n° 2024-152) | **Vérifiée** — page ancienne : seuils **à confirmer** |
| impots.gouv.fr, formulaire 2050-LIASSE et notice 2032-NOT-SD, millésime 2026 | Tracé, libellés et cases des tableaux 2050 à 2059-G | **Non vérifiée** — site en maintenance |
| impots.gouv.fr, formulaire 2033-SD et notice, millésime 2026 | Tracé, libellés et cases des tableaux 2033-A à 2033-G | **Non vérifiée** — site en maintenance |
| impots.gouv.fr, formulaire 2065-SD | Déclaration de résultats à l’impôt sur les sociétés | **Non vérifiée** |
| Légifrance, code de commerce L. 123-16, L. 123-16-1, L. 123-25, D. 123-200 | Catégories de taille, seuils, règle des deux exercices | **Non vérifiée** — accès automatisé refusé (HTTP 403) |
| BOFiP BOI-BAREME-000044 | Limites de chiffre d’affaires du régime simplifié | **Non vérifiée** — non lu |

Toutes les références sont dans `SOURCES_FISCALES` au format `SourceRegle` (référence, URL, date de vérification, `verification`, période d’application). Chaque résultat restitue ses sources.

### 3.1 Conséquence : aucun code de case

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

- **Montants** : chaînes décimales à deux décimales ; arrondi demi-unité éloignée de zéro. **L’arrondi à l’euro n’est pas pratiqué.**
- **Signes** : actif = net ; passif et produits = crédit − débit ; charges = débit − crédit ; résultats = produits − charges. Impacts des propositions : positif = augmentation.
- **Résultat au bilan** : celui de la balance (compte 12 augmenté du solde des classes 6 et 7 non soldées), jamais substitué.
- **Sens des soldes** : apprécié par compte général, pas par tiers.
- **Charges et produits constatés d’avance** : prorata en **jours calendaires réels, bornes incluses** ; part postérieure = du lendemain de la clôture à la fin de la période. Montant de la ligne réputé hors taxes.
- **Période dans un libellé** : retenue seulement si deux dates complètes (année sur quatre chiffres) y figurent une seule fois. Un libellé est un contenu non fiable : l’hypothèse est écrite dans la proposition.
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
11. **Arrondi à l’euro** et règles de présentation propres aux formulaires.
12. Tout ce qui n’est pas couvert : résultat fiscal, tableaux 2054 à 2059-G, 2033-C à G, 2065.

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
lirePeriodeDansLibelle(libelle: string)
```

Constantes : `TABLE_LIASSE_REEL_NORMAL_2026`, `TABLE_LIASSE_REEL_SIMPLIFIE_2026`, `TABLES_LIASSE`, `PERIMETRE_LIASSE`, `DERNIERE_CLOTURE_COUVERTE_LIASSE_2026`, `MODELE_ANNEXE`, `ARTICLES_ANNEXE`, `SEUILS_TAILLE_PAR_DEFAUT`, `REGLES_INVENTAIRE`, `CONVENTIONS_INVENTAIRE`, `SOURCES_FISCALES`, `MENTION_PROJET`.

Tous les résultats sont sérialisables en JSON tels quels. Fichiers : `liasse.ts`, `annexe.ts`, `inventaire.ts`, `sources-fiscales.ts` et leurs tests.
