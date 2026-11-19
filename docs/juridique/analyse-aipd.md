# Analyse de nécessité d'une AIPD

> **PROJET — à faire valider par un DPO / avocat. Aucune approbation juridique n'a été donnée.**

Objet : déterminer si une analyse d'impact relative à la protection des données (AIPD, RGPD art. 35) est requise avant la mise en service. Ce document n'est pas une AIPD. La conclusion est une proposition.

## 1. Règle applicable

- Une AIPD est requise lorsqu'un traitement est susceptible d'engendrer un risque élevé pour les droits et libertés des personnes, en particulier par le recours à de nouvelles technologies (art. 35 §1). Elle est réalisée par le **responsable du traitement**, avant le traitement ; le sous-traitant l'aide (art. 28 §3 f)).
- Trois cas où elle est en particulier requise (art. 35 §3) : évaluation systématique et approfondie fondée sur un traitement automatisé et fondant des décisions à effet juridique ou similaire ; traitement à grande échelle de catégories particulières (art. 9) ou de données relatives aux condamnations (art. 10) ; surveillance systématique à grande échelle d'une zone accessible au public.
- Méthode de la CNIL : l'AIPD est obligatoire si le traitement figure sur la liste des traitements pour lesquels elle est requise (délibération n° 2018-327 du 11 octobre 2018), ou s'il remplit au moins deux des neuf critères issus des lignes directrices du G29 (reprises par le CEPD). Elle n'est pas requise si le traitement figure sur la liste d'exemption (délibération n° 2019-118 du 12 septembre 2019). La liste d'exemption rappelle qu'en cas de doute il est recommandé d'en effectuer une.

Qui est concerné : pour les données des dossiers, le responsable est le Cabinet (ou l'Entité cliente — `roles-rgpd.md` §5). L'analyse ci-dessous est faite du point de vue du traitement tel que le service le permet ; elle sert à l'Éditeur pour (a) informer les Cabinets, (b) préparer la documentation qu'il leur doit, (c) apprécier ses propres traitements de responsable.

## 2. Confrontation à la liste CNIL des traitements pour lesquels l'AIPD est requise

Liste lue le 2026-11-19 (PDF CNIL). Aucun des types d'opérations listés ne correspond au service :

| Type listé | Le service en relève-t-il ? |
|---|---|
| Données de santé traitées par des établissements de santé ou médico-sociaux ; entrepôts de données de santé ; données génétiques ; accompagnement social ou médico-social | Non |
| Profils de personnes physiques à des fins de ressources humaines | Non. Les indicateurs d'activité sont calculés par cabinet et par dossier, jamais par personne (`../couverture.md`). **À maintenir** : un indicateur par collaborateur ferait basculer l'analyse. |
| Surveillance constante de l'activité des employés | Non a priori. Le journal d'audit trace les actions des collaborateurs à des fins de preuve et de sécurité, non d'évaluation ; il n'est lisible que par les gestionnaires. `[À TRANCHER : confirmer que cette journalisation n'est pas une « surveillance constante » ; encadrer son usage par le Cabinet]` |
| Alertes et signalements (sociaux, sanitaires, professionnels) | Non |
| Profilage pouvant conduire à l'exclusion d'un contrat ; traitements mutualisés de manquements contractuels ; profilage sur sources externes | Non. Aucun score de personne. Les « signaux à examiner » portent sur une entité, sont formulés en question et ne sont pas un diagnostic. `[À TRANCHER : cas de l'entrepreneur individuel, où l'entité est une personne physique]` |
| Biométrie de personnes vulnérables ; localisation à large échelle ; logement social | Non |

## 3. Confrontation à la liste d'exemption

Liste lue le 2026-11-19. Deux rubriques sont voisines sans couvrir le service :

- « Gestion de la relation fournisseurs » (contrats, commandes, factures, règlements, comptabilité fournisseurs) : vise le traitement par une entreprise de ses propres fournisseurs. Le service traite ces mêmes données, mais pour de nombreuses entités, par un tiers, avec extraction automatique.
- Gestion du personnel des organismes de moins de 250 personnes : sans rapport direct ; pertinent seulement si des pièces de paie sont déposées.

Les exemptions visant les avocats exerçant à titre individuel, les notaires et les greffiers ne s'étendent pas aux experts-comptables : la liste ne les mentionne pas.

Proposition : aucune exemption ne s'applique. `[À TRANCHER]`

## 4. Les neuf critères

| # | Critère | Appréciation proposée | Motifs |
|---|---|---|---|
| 1 | Évaluation ou notation, y compris profilage | Non rempli | Les contrôles évaluent des écritures et des comptes, pas des personnes. Réserve : entrepreneurs individuels ; futures fonctions d'IA |
| 2 | Décision automatisée avec effet juridique ou similaire | Non rempli | Toute sortie est une proposition soumise à validation humaine ; aucune écriture, aucun envoi, aucune télétransmission automatique |
| 3 | Surveillance systématique | Non rempli (à confirmer) | Journal d'audit à finalité de preuve ; connecteur de messagerie en lecture seule limité à la recherche de pièces — `[À TRANCHER : la lecture continue d'une boîte de messagerie, une fois activée, est-elle une surveillance systématique]` |
| 4 | Données sensibles ou à caractère hautement personnel | **Rempli (proposé)** | Relevés bancaires, IBAN, détail des opérations, rémunérations dans les écritures : données financières à caractère hautement personnel. Données de l'article 9 non recherchées mais présentes de façon fortuite dans des pièces |
| 5 | Traitement à grande échelle | **Incertain — dépend du déploiement** | Pour un cabinet isolé : quelques dizaines à quelques centaines de dossiers. Pour la plateforme : potentiellement de nombreux cabinets, des milliers de dossiers et, à travers les pièces, un grand nombre de personnes citées. Aucun seuil chiffré n'est fixé par les textes. `[À TRANCHER]` |
| 6 | Croisement ou combinaison d'ensembles de données | Partiellement | Rapprochement banque ↔ comptabilité, pièces ↔ écritures : croisements au sein d'un même dossier, attendus par les personnes dans le cadre d'une comptabilité. Aucun croisement entre dossiers ou entre cabinets (cloisonnement). Proposé : non rempli au sens du critère |
| 7 | Personnes vulnérables | Partiellement | Des salariés figurent dans les pièces et écritures (déséquilibre vis-à-vis de l'employeur), mais le traitement ne les vise pas. Les collaborateurs du Cabinet sont tracés au journal. Proposé : non rempli, à confirmer |
| 8 | Usage innovant ou nouvelles solutions technologiques | **Aujourd'hui : non. Rempli (proposé) dès l'activation de l'IA** | Aujourd'hui : extraction par règles et OCR local, techniques établies. Prévu : modèle de langage pour le classement, l'assistant documenté, les suggestions (non connecté) |
| 9 | Exclusion du bénéfice d'un droit ou d'un contrat | Non rempli | — |

Décompte proposé :

- **Service tel que livré aujourd'hui (sans IA, sans messagerie connectée)** : critère 4 rempli ; critère 5 incertain. Un à deux critères.
- **Service avec IA activée** : critères 4 et 8, et éventuellement 5. Deux à trois critères.

## 5. Conclusion proposée

1. **Une AIPD est proposée comme nécessaire avant l'activation des fonctions d'IA**, celles-ci faisant passer le traitement à au moins deux critères (4 et 8). Elle devrait porter aussi sur le flux vers le fournisseur d'inférence.
2. **Pour le service sans IA, la nécessité dépend de l'appréciation de la grande échelle.** Compte tenu de la sensibilité des données financières, de la concentration de nombreux dossiers sur une plateforme mutualisée, du secret professionnel en jeu et de la recommandation de réaliser une AIPD en cas de doute, il est proposé d'en réaliser une avant la mise en service, sans attendre l'IA.
3. Forme proposée : l'Éditeur prépare une **AIPD de référence** décrivant le service, ses risques et ses mesures (une même analyse peut couvrir des traitements similaires, art. 35 §1), que chaque Cabinet responsable s'approprie, complète et signe. L'Éditeur ne peut pas réaliser l'AIPD à la place du responsable. `[À TRANCHER : cette répartition ; nécessité d'une AIPD propre à l'Éditeur pour ses traitements de responsable — proposé : non, ils portent sur des données de contact et de facturation courantes]`
4. Si l'AIPD révèle un risque résiduel élevé, consultation préalable de la CNIL par le responsable (art. 36).

Rien de cela n'est fait : aucune AIPD n'a été réalisée, et aucun traitement réel n'a commencé.

## 6. Éléments à verser à la future AIPD

Risques déjà identifiés dans `../risques.md` et mesures existantes :

| Événement redouté | Mesures en place | Faiblesses connues |
|---|---|---|
| Accès illégitime entre cabinets ou dossiers (R3) | RLS forcé, rôles séparés, tests | Pas de test d'intrusion ; rôle de migration hors cloisonnement ; fonctions SQL à droits du propriétaire (R16) |
| Accès illégitime par le personnel de l'Éditeur | Compte support borné, tracé, sur habilitation du Cabinet | Opérations d'exploitation par le rôle de migration, sans outil ni traçabilité dédiée |
| Compromission d'un compte | OIDC, session côté serveur | MFA non imposé (R6) |
| Fuite par une sauvegarde ou une archive | — | Sauvegardes en clair ; archives de restitution non chiffrées |
| Altération des preuves (R7) | Journal chaîné, originaux adressés par empreinte | Pas d'ancrage externe ; superutilisateur |
| Pièce malveillante (R5) | Antivirus bloquant, analyseurs sans exécution | Pas de bac à sable dédié |
| Conservation excessive (R9) | — | Aucune purge |
| Fuite ou réutilisation par le fournisseur d'IA (V10) | IA non connectée | Conditions non vérifiées |
| Erreur d'extraction ou de suggestion prise pour un fait (R1, R2, R13) | Abstention, statuts explicites, validation humaine | Qualité jamais mesurée sur données réelles |

## 7. Points à valider

1. Appréciation de chaque critère du §4, en particulier 3, 5 et 7.
2. Conclusion du §5 et moment de l'AIPD (avant mise en service ou avant IA).
3. Répartition Éditeur / Cabinet pour sa réalisation.
4. Traitement du cas des entrepreneurs individuels.
5. Méthode (outil PIA de la CNIL ou autre).

## Références

Consultées le 2026-11-19, sauf mention contraire.

- RGPD, art. 35 et 36 : <https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32016R0679>
- CNIL, « Ce qu'il faut savoir sur l'analyse d'impact relative à la protection des données (AIPD) » (page du 18 octobre 2017) : <https://www.cnil.fr/fr/ce-quil-faut-savoir-sur-lanalyse-dimpact-relative-la-protection-des-donnees-aipd>
- CNIL, liste des types d'opérations de traitement pour lesquelles une AIPD est requise : <https://www.cnil.fr/sites/default/files/atoms/files/liste-traitements-aipd-requise.pdf>
- CNIL, liste des types d'opérations de traitement pour lesquelles une AIPD n'est pas requise : <https://www.cnil.fr/sites/default/files/atoms/files/liste-traitements-aipd-non-requise.pdf>
- Délibérations CNIL n° 2018-326 et n° 2018-327 du 11 octobre 2018 et n° 2019-118 du 12 septembre 2019 : numéros et dates repris de la page CNIL ci-dessus ; textes au Journal officiel non revérifiés sur Légifrance le 2026-11-19 (accès automatisé refusé).
- Lignes directrices du G29 sur l'AIPD, reprises par le CEPD (référence « WP 248 » donnée de mémoire, non vérifiée) : les neuf critères sont cités d'après la page CNIL ; le texte des lignes directrices n'a pas été relu.
