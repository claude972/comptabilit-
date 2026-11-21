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
| CGI art. 39 A (Légifrance) | Accès automatisé refusé (HTTP 403). Le texte de loi en vigueur n'a pas été consulté | Le dégressif est **non vérifié et non activé par défaut** (variable `AMORTISSEMENT_DEGRESSIF_ACTIVE` à faux) : aucune proposition de dotation dégressive n'est affichée tant que l'éditeur ne l'a pas activée après vérification du texte de loi et validation par un professionnel |
| API officielle de Légifrance (PISTE) | Exige un compte et des identifiants | Dépendance externe réelle, listée dans `acces-externes.md` ; aucun compte créé |

Aucun contournement n'a été tenté : ni changement d'identité du navigateur, ni miroir non officiel présenté comme officiel.
Un accès légitime (compte PISTE de l'éditeur, ou lecture par une personne qui a accès au site) lèvera cette limite.

## 4. Autres sources (contrôle à faire dans le même esprit)

- PCG consolidé au 1er janvier 2026 (ANC) : lu en texte le 2026-11-20 (articles 214-4, 214-8, 214-9, 214-11 à 214-14 et comptes 145, 6872, 7872).
- Seuils de taille de l'annexe : lus sur une page d'information officielle ancienne (mars 2024), non sur le code de commerce
  (Légifrance, même refus) : marqués « à confirmer » dans le logiciel.
- Codes de cases des formulaires de la liasse : non lus le 2026-11-19 (site des impôts en maintenance). **Mise à jour du 2026-11-20 (D-104)** : le site répond de nouveau ; ont été relus, dans les PDF officiels du millésime 2026 (téléchargés dans un dossier temporaire, extraction de texte positionnée, jamais vérifiée visuellement), le tableau 2054-SD (cadres A et B), le 2055-SD (cadre A) dans `2050-liasse_5320.pdf` (SHA-256 0bba33528b893ba8aa581d97bbc6ddb7d59a78fdbc234920596bce228f8453e1), le 2033-C-SD (cadres I et II) dans `2033-sd_5394.pdf` (SHA-256 ce4c519097fa435e9bd0ca3956016e5e05321c6f07db341285c9f46fb177b6cb) et les passages correspondants des notices `2032-not-sd_5323.pdf` (68ac6083…26f39) et `2033-sd_5395.pdf` (b0a43522…d7a6d1). Seuls ces tableaux ont des codes de cases (« lus, à confirmer ») ; tous les autres restent sans code. La notice ne donne pas de table des comptes par ligne : le rattachement est une convention interne.
- Documents du règlement ANC 2022-06 : date d'application confirmée par une page de l'ANC, texte non relu intégralement.

## 5. Refaire le contrôle

```bash
sh scripts/verifier-sources-bofip.sh
```

À rejouer avant toute activation du dégressif, de la liasse ou de l'annexe, et périodiquement : un document republié apparaît
en « OBSOLÈTE » ; il faut alors relire le document et réviser la règle correspondante avant de poursuivre.
