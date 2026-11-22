# Registre des sources officielles : version en vigueur, URL, date, périmètre

Ce document répond à une exigence de l'utilisateur : « Vérifie les règles implémentées contre les versions officielles
actuellement en vigueur, en conservant URL, date et périmètre de chaque source. Une ancienne date n'invalide pas à elle
seule une règle, mais sa validité actuelle doit être établie. Si l'accès officiel empêche cette vérification, garde le
calcul concerné explicitement non vérifié/non activé. »

**Statut de ce registre : vérification de la VERSION EN VIGUEUR et du contenu cité, par un développeur, le 2026-11-20.
Ce n'est pas une validation par un expert-comptable ni par un fiscaliste.** Les tests automatisés de Comtaple utilisent des
jeux synthétiques : ils prouvent que le code fait ce que la règle dit, pas que la règle est fiscalement exacte.

## 1. Documents du BOFiP : version en vigueur établie

Méthode : pour chaque document cité par les règles, la page officielle publique du BOFiP a été consultée le 2026-11-20 et
sa mention « en vigueur du … à aujourd'hui » relevée ; la même version a été retrouvée comme seule version du document
dans le stock open data officiel des documents en vigueur. Le script `scripts/verifier-sources-bofip.sh` refait ce
contrôle à la demande (registre : `docs/sources-officielles.tsv`) et sort en erreur si une version a changé ou si une page
ne répond plus.

| Document | Version en vigueur | Adresse officielle consultée | Usage dans Comtaple |
|---|---|---|---|
| BOI-BIC-AMT-20-20-30 | du 12/09/2012 à aujourd'hui | https://bofip.impots.gouv.fr/bofip/4699-PGP.html/identifiant%3DBOI-BIC-AMT-20-20-30-20120912 | Dégressif : coefficients, prorata, annuités suivantes, bascule |
| BOI-BIC-AMT-20-20-20-10 | du 12/09/2012 à aujourd'hui | https://bofip.impots.gouv.fr/bofip/4698-PGP.html/identifiant%3DBOI-BIC-AMT-20-20-20-10-20120912 | Dégressif : biens éligibles selon leur nature |
| BOI-BIC-AMT-20-20-40 | du 12/09/2012 à aujourd'hui | https://bofip.impots.gouv.fr/bofip/4749-PGP.html/identifiant%3DBOI-BIC-AMT-20-20-40-20120912 | Dégressif : biens décomposés |
| BOI-BIC-AMT-20-20-10 | du 12/09/2012 à aujourd'hui | https://bofip.impots.gouv.fr/bofip/4748-PGP.html/identifiant%3DBOI-BIC-AMT-20-20-10-20120912 | Dégressif : entreprises concernées |
| BOI-BIC-AMT-20-10 | du 12/09/2012 à aujourd'hui | https://bofip.impots.gouv.fr/bofip/4543-PGP.html/identifiant%3DBOI-BIC-AMT-20-10-20120912 | Linéaire : point de départ, durée |
| BOI-BIC-AMT-20-40-10 | du 12/09/2012 à aujourd'hui | https://bofip.impots.gouv.fr/bofip/3921-PGP.html/identifiant%3DBOI-BIC-AMT-20-40-10-20120912 | Biens donnés en location (cité, non appliqué) |
| BOI-BIC-CHG-20-30-10 | du 01/03/2017 à aujourd'hui | https://bofip.impots.gouv.fr/bofip/2109-PGP.html/identifiant%3DBOI-BIC-CHG-20-30-10-20170301 | Charges constatées d'avance |
| BOI-CF-IOR-60-40-20 | du 07/06/2017 à aujourd'hui | https://bofip.impots.gouv.fr/bofip/9028-PGP.html/identifiant%3DBOI-CF-IOR-60-40-20-20170607 | Rattachement des charges à l'exercice (césure) |
| BOI-IS-DECLA-10 | du 18/03/2013 à aujourd'hui | https://bofip.impots.gouv.fr/bofip/3569-PGP.html/identifiant%3DBOI-IS-DECLA-10-20130318 | Déclaration des résultats à l'IS |
| BOI-BIC-DECLA-30-20-10 | du 19/08/2026 à aujourd'hui | https://bofip.impots.gouv.fr/bofip/2833-PGP.html/identifiant%3DBOI-BIC-DECLA-30-20-10-20260819 | Tableaux 2033-A à G (régime simplifié) |
| BOI-BIC-DECLA-30-10-10-20 | du 17/02/2017 à aujourd'hui | https://bofip.impots.gouv.fr/bofip/3385-PGP.html/identifiant%3DBOI-BIC-DECLA-30-10-10-20-20170217 | Tableaux 2050 à 2059-G (régime réel normal) |
| BOI-BAREME-000044 | du 19/08/2026 à aujourd'hui | https://bofip.impots.gouv.fr/bofip/14069-PGP.html/identifiant%3DBOI-BAREME-000044-20260819 | Seuils des régimes d'imposition (cité ; le régime reste un choix du cabinet) |

**Constat sur l'âge des textes.** Plusieurs documents datent de 2012 à 2017 : ils n'ont simplement pas été republiés,
leur mention est toujours « à aujourd'hui ». Leur ancienneté n'est donc pas un indice d'obsolescence ; la version en
vigueur est bien celle-là. Deux documents ont été republiés en août 2026 (2033-A à G, barème des seuils).

**Source de la vérification, en détail.**
- Stock open data officiel : `bofip_stock_live_20261028.tgz`, https://bofip.impots.gouv.fr/opendata/stock/10, MD5 publié par la DGFiP
  et recalculé : 492e3cb39df9b8101ccf182aa23220b8 ; SHA-256 calculé : 7563fbf49dd18b5fb5412dbac56364ec973a01402830593a5bdcd3c6c6f85511 ;
  téléchargé le 2026-11-20, 117 Mo.
- Flux de mises à jour postérieurs consultés : n° 46 (un document de 2025) et n° 47 (2026-11-12 au 2026-11-18, trois documents,
  aucun de la série « Amortissements »).
- **Lacune dite** : les flux de la quinzaine du 2026-10-29 au 2026-11-11 n'ont pas pu être identifiés dans la liste officielle
  (le n° 45 est vide). La mention « à aujourd'hui » des pages consultées le 2026-11-20 couvre néanmoins cette période.

## 2. Ce que le texte en vigueur confirme, contredit ou laisse non établi (amortissement dégressif)

| Point | Résultat | Détail |
|---|---|---|
| Coefficients 1,25 (3 ou 4 ans), 1,75 (5 ou 6 ans), 2,25 (plus de 6 ans) | **Confirmé** | BOI-BIC-AMT-20-20-30, § 120 ; le texte ajoute que « pour certains biens d'équipement, ces coefficients sont soit majorés, soit diminués » (BOI-BIC-AMT-20-20-50, version du 02/09/2015, non lue) |
| Taux dégressif = taux linéaire × coefficient ; annuités suivantes sur la valeur résiduelle comptable | **Confirmé** | § 90 à 100, § 230 |
| Bascule vers le linéaire quand l'annuité dégressive devient inférieure à valeur résiduelle ÷ années restantes | **Confirmé**, présentée comme une **faculté** | § 230 : l'entreprise « a la faculté » de passer au linéaire ; Comtaple l'applique systématiquement et le dit dans chaque proposition |
| Point de départ de la première annuité | **Contredit l'implémentation d'origine, corrigé** | § 190 à 200 : premier jour du **mois d'acquisition ou de construction**, et non la mise en service (réservée au linéaire). Le moteur utilisait la mise en service ; la date d'acquisition est désormais exigée |
| Exemple chiffré 10 000 euros, 10 ans, 22,5 %, 2/12 | **Confirmé** | Retrouvé à l'euro près par les tests (dernière annuité 672,75 au centime contre 672 imprimé : solde des arrondis du texte) |
| Biens décomposés : structure et composants amortissables en dégressif si le bien est éligible | **Confirmé** | BOI-BIC-AMT-20-20-40 |
| Coefficients majorés ou diminués de certains biens d'équipement | **Non géré** | Le moteur s'abstient et le dit |
| Conditions d'éligibilité tirées de la loi : bien NEUF, durée normale d'utilisation d'au moins 3 ans, catégories de biens visées | **Non établi** | Elles relèvent du CGI art. 39 A, dont le texte n'a pas pu être consulté (voir § 3) ; le BOFiP les commente mais c'est de la doctrine |

## 3. Ce qui n'a PAS pu être vérifié : le texte de loi

| Source | Résultat | Conséquence |
|---|---|---|
| CGI art. 39 A (Légifrance) | Accès automatisé refusé (HTTP 403), de nouveau le 2026-11-22. Le texte de loi en vigueur n'a pas été consulté ; BOI-BIC-AMT-20-20-20-10 relu le même jour (version du 12/09/2012 à aujourd'hui) : il renvoie les conditions générales à l'article 22 de l'annexe II et au 2 de l'article 39 A | Le dégressif est **non vérifié et non activé par défaut** (variable `AMORTISSEMENT_DEGRESSIF_ACTIVE` à faux) : aucune proposition de dotation dégressive n'est affichée tant que l'éditeur ne l'a pas activée après vérification du texte de loi et validation par un professionnel |
| API officielle de Légifrance (PISTE) | Exige un compte et des identifiants | Dépendance externe réelle, listée dans `acces-externes.md` ; aucun compte créé |

Aucun contournement n'a été tenté : ni changement d'identité du navigateur, ni miroir non officiel présenté comme officiel.
Un accès légitime (compte PISTE de l'éditeur, ou lecture par une personne qui a accès au site) lèvera cette limite.

## 4. Autres sources (contrôle à faire dans le même esprit)

- PCG consolidé au 1er janvier 2026 (ANC) : lu en texte le 2026-11-20 (articles 214-4, 214-8, 214-9, 214-11 à 214-14 et comptes 145, 6872, 7872).
- Seuils de taille de l'annexe : lus sur une page d'information officielle ancienne (mars 2024), non sur le code de commerce
  (Légifrance, même refus) : marqués « à confirmer » dans le logiciel.
- Codes de cases des formulaires de la liasse : non lus le 2026-11-19 (site des impôts en maintenance). **Mise à jour du 2026-11-20 (D-104)** : le site répond de nouveau ; ont été relus, dans les PDF officiels du millésime 2026 (téléchargés dans un dossier temporaire, extraction de texte positionnée, jamais vérifiée visuellement), le tableau 2054-SD (cadres A et B), le 2055-SD (cadre A) dans `2050-liasse_5320.pdf` (SHA-256 0bba33528b893ba8aa581d97bbc6ddb7d59a78fdbc234920596bce228f8453e1), le 2033-C-SD (cadres I et II) dans `2033-sd_5394.pdf` (SHA-256 ce4c519097fa435e9bd0ca3956016e5e05321c6f07db341285c9f46fb177b6cb) et les passages correspondants des notices `2032-not-sd_5323.pdf` (68ac6083…26f39) et `2033-sd_5395.pdf` (b0a43522…d7a6d1). Seuls ces tableaux ont des codes de cases (« lus, à confirmer ») ; tous les autres restent sans code. La notice ne donne pas de table des comptes par ligne : le rattachement est une convention interne.
- 2065-SD 2026 (cerfa 11084*28) : `2065-sd_5381.pdf`, SHA-256 c4f8d73574b6aa5667dba91ad8a918aaca3c71587f4d863938d0223f207d06de (D-123).
- Documents du règlement ANC 2022-06 : date d'application confirmée par une page de l'ANC, texte non relu intégralement.

## 5. Refaire le contrôle

```bash
sh scripts/verifier-sources-bofip.sh
```

À rejouer avant toute activation du dégressif, de la liasse ou de l'annexe, et périodiquement : un document republié apparaît
en « OBSOLÈTE » ; il faut alors relire le document et réviser la règle correspondante avant de poursuivre.

## 6. Arrondi à l'euro des tableaux (D-105, 2026-11-21)

Lu dans les notices du millésime 2026 téléchargées le 2026-11-21 sur impots.gouv.fr (sans compte ; SHA-256 identiques à ceux du § 4) : `2032-not-sd_5323.pdf` (régime réel normal) et `2033-sd_5395.pdf` (notice du régime simplifié), rubrique « Indication des montants en euros » et « Les arrondis fiscaux » : tableaux sans centimes ; arrondi à l'euro le plus proche, 0,50 compté pour 1. Non établis : arrondi des totaux, montants négatifs. Texte extrait par programme, non vérifié visuellement.

## 7. Vérification visuelle des codes de cases (D-107, 2026-11-21)

Les pages 2052 (page 3), 2053 (page 4) de `2050-liasse_5320.pdf` (SHA-256 0bba3352…8453e1) et 2033-B (page 2) de `2033-sd_5394.pdf` (SHA-256 ce4c5190…b6cb) ont été rendues en image (pdf.js dans le navigateur intégré) et comparées aux codes lus par extraction de texte positionnée : concordance totale (cases FA à FL ; HO, HY, 1G, HP, HQ, 1H, 1J, 1K, HX, RC, RD, A3, A4, HS ; 209 à 310 du 2033-B). Les renvois A2, A5, A8, A10 et A11 (exploitant individuel) sont hors périmètre. Seuls ces tableaux sont « vérifiés » ; ce n'est pas une validation professionnelle.

## 8. État détaillé des charges à payer : ce que les sources accessibles établissent (D-169, 2026-11-22)

- **Renvoi du formulaire 2056** (`2050-liasse_5320.pdf`, SHA-256 0bba3352…8453e1, page du 2056, NOTA) : « les charges à payer ne doivent pas être mentionnées sur ce tableau mais être ventilées sur l'état détaillé des charges à payer dont la production est prévue par l'article 38 II de l'annexe III au CGI ». Le texte de l'article est sur Légifrance (accès refusé en 403, jamais contourné).
- **BOFiP `BOI-BIC-DECLA-30-10-10-30-20120912`** (« Documents annexes à la déclaration spéciale de résultats », paragraphe 260, exporté le 2026-11-22 depuis `bofip.impots.gouv.fr/export/pdf/…`, SHA-256 93da4827…72fd) : un « relevé détaillé » des frais à payer est exigé des entreprises qui ont inscrit en « frais à payer » des dépenses qui, fiscalement, auraient dû être des provisions ; il est annexé à la déclaration. **Version à fin de publication le 2013-01-04** : elle ne prouve pas le texte en vigueur en 2026.
- **Ce que ces sources ne donnent pas** : aucun modèle, aucune colonne, aucun seuil, aucune règle de calcul ni de rapprochement. Le logiciel ne prépare donc PAS cet état : implémenter une grille reviendrait à inventer sa structure. Manque précis : le texte à jour de l'article 38 II de l'annexe III au CGI ou un modèle officiel publié ; à chercher sur une source officielle accessible (BOFiP à jour, notice 2032 d'un millésime ultérieur, impots.gouv.fr).
- **Mise à jour D-175 (2026-11-22) — BOFiP `BOI-BIC-DECLA-30-10-10-30` version du 26/05/2021** (`bofip.impots.gouv.fr/bofip/3371-PGP.html/identifiant=BOI-BIC-DECLA-30-10-10-30-20210526`, lue le 2026-11-22, accès HTTP 200) : le bloc « Versions sur la période » indique « Version en vigueur du 26/05/2021 à aujourd'hui » ; aucune mention d'abrogation ni de remplacement. L'applicabilité en 2026 n'est établie que par ce bloc (aucune autre source de mise à jour consultée) : elle est donc retenue comme « en vigueur d'après la page », sans plus. **§260** (« Relevé des frais à payer présentant le caractère de provisions du point de vue fiscal ») : l'absence d'inscription des frais à payer sur le tableau des provisions inscrites au bilan (2056-SD, CERFA 10949, art. 38 II de l'annexe III) expose à l'amende de l'article 1763 du CGI ; par tolérance, elle n'est pas appliquée aux entreprises qui ont inscrit en « frais à payer » des dépenses qui auraient dû être des provisions, tolérance « subordonnée à la production d'un relevé détaillé de ces frais, en annexe à la déclaration des résultats ». **§270** : les provisions du 2056-SD sont détaillées sur feuillets distincts selon leur objet ou l'année de constitution ; le chiffre global de chaque catégorie suffit sauf demande du service. **Ce que la page ne contient pas** : aucun modèle ni formulaire dédié à l'« état des charges à payer », aucune colonne, aucun seuil, aucun renvoi à un 2058-C. **Conséquence** : l'obligation et le caractère détaillé sont établis ; le modèle officiel reste inconnu. Comtaple prépare donc un RELEVÉ INTERNE (nature ou tiers, montant, justification), clairement distinct du formulaire officiel (D-175).
