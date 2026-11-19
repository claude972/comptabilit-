# Qualification des rôles RGPD par finalité

> **PROJET — à faire valider par un DPO / avocat. Aucune approbation juridique n'a été donnée.**

Ce document présente une analyse et les points à trancher. Il ne conclut pas à la place d'un juriste. La CNIL rappelle que la qualification dépend des faits et non du contrat, et qu'elle n'est pas liée par les qualifications contractuelles.

## 1. Acteurs

| Acteur | Description |
|---|---|
| Entité cliente | Entreprise (TPE / PME) cliente du Cabinet. Elle tient ou fait tenir sa comptabilité ; ses salariés, clients et fournisseurs sont cités dans les pièces. |
| Cabinet | Cabinet d'expertise comptable, client de l'Éditeur. Ses membres utilisent le logiciel ; des utilisateurs de l'Entité cliente y reçoivent, à sa demande, un compte (déposant, lecture). |
| Éditeur | Éditeur et exploitant de Comtaple. |
| Fournisseurs de l'Éditeur | Hébergeur, fournisseur d'IA (prévus, non contractés — `sous-traitants.md`). |

## 2. Critères utilisés

- Responsable du traitement : détermine les finalités et les moyens (RGPD, art. 4 §7). Selon la CNIL, il décide des moyens essentiels (données collectées, durée de conservation, destinataires) ; les moyens non essentiels (choix techniques) peuvent être laissés au sous-traitant.
- Sous-traitant : traite pour le compte du responsable, sur ses instructions (art. 4 §8, art. 28). S'il détermine lui-même finalités et moyens, il est considéré comme responsable pour ce traitement (art. 28 §10).
- Responsables conjoints : déterminent ensemble finalités et moyens (art. 26).
- Référence d'interprétation : lignes directrices 07/2020 du CEPD (version finale du 7 juillet 2021), dont le corps n'a pas été relu pour ce projet.

## 3. Finalités où l'Éditeur agirait comme sous-traitant du Cabinet

Analyse : le Cabinet décide quels dossiers il ouvre, quelles pièces et quelles écritures il y fait entrer, qui y accède, quels contrôles il retient (règles du Cabinet), ce qu'il valide. L'Éditeur fournit l'outil et l'exploite. Les fonctions sont paramétrées par le Cabinet et l'Éditeur n'accède aux dossiers que par le rôle support, sur habilitation du Cabinet.

| Finalité (réf. registre) | Qualification proposée de l'Éditeur | Indices | Réserves |
|---|---|---|---|
| Collecte et conservation des pièces (ST-1) | Sous-traitant | Le Cabinet décide des dossiers, des déposants, des pièces | — |
| Extraction, OCR (ST-2) | Sous-traitant | Moyen technique au service de la finalité du Cabinet | Les règles d'extraction sont conçues par l'Éditeur : moyen non essentiel, à confirmer |
| Import d'écritures et de relevés, rapprochements (ST-3, ST-4) | Sous-traitant | Idem | — |
| Contrôles, révision, états, indicateurs du dossier (ST-5) | Sous-traitant | Le Cabinet active, paramètre, décide | Le catalogue de contrôles et ses seuils par défaut viennent de l'Éditeur |
| Missions, lettres, conseils, rentabilité (ST-6) | Sous-traitant | Données saisies par le Cabinet pour sa gestion | Ici le Cabinet est clairement responsable (sa propre gestion) |
| Messagerie (ST-7) | Sous-traitant | Le Cabinet connecte la boîte et choisit les règles | Voir §6 |
| Recherche (ST-8), notifications (ST-14) | Sous-traitant | Fonctions du service | — |
| Comptes et habilitations du Cabinet (ST-9) | Sous-traitant | Le Cabinet décide qui a accès à quoi | L'Éditeur crée aujourd'hui les comptes lui-même (provisionnement) : sur instruction à documenter |
| Journal d'audit du Cabinet (ST-10) | Sous-traitant | Trace au bénéfice du Cabinet | Voir §4.2 : la journalisation sert aussi la sécurité de l'Éditeur |
| Restitution (ST-11), sauvegarde (ST-12) | Sous-traitant | Obligations de l'article 28 §3 g) et de l'article 32 | — |
| Accès du support (ST-13) | Sous-traitant | Sur demande et habilitation du Cabinet | — |
| Fonctions d'IA (ST-15, non implémentées) | Sous-traitant, avec un sous-traitant ultérieur | Le Cabinet les active pour ses dossiers | Voir §4.4 |

`[À TRANCHER : confirmer la qualification de sous-traitant pour l'ensemble du service ; vérifier qu'aucune fonction ne conduit l'Éditeur à décider d'un moyen essentiel — par exemple une durée de conservation imposée par défaut, voir §4.5]`

## 4. Finalités où l'Éditeur serait responsable du traitement

### 4.1 Peu discutables

| Finalité (réf. registre) | Pourquoi l'Éditeur déciderait seul |
|---|---|
| Gestion de ses comptes clients : ouverture d'un cabinet, essai, abonnement, résiliation (RT-1) | Sa propre relation commerciale. Dans le code, ces opérations sont réservées à l'Éditeur (décision D-023). |
| Facturation et comptabilité de l'Éditeur (RT-2) | Ses propres obligations légales. |
| Gestion de son personnel et de ses habilitations internes (RT-7) | Son organisation. |
| Tenue de son registre des violations, réponses aux autorités (RT-6) | Ses propres obligations. |

### 4.2 Sécurité du service — à trancher

La journalisation technique, la détection d'abus et les sauvegardes servent à la fois le Cabinet (obligation de sécurité qu'il délègue, art. 32) et l'Éditeur (protéger sa plateforme, se défendre). Deux lectures :

- (a) Tout relève de la sous-traitance : l'Éditeur exécute des mesures de sécurité prévues au contrat.
- (b) L'Éditeur est responsable d'un traitement propre de sécurité de sa plateforme, fondé sur son intérêt légitime, distinct du journal d'audit métier tenu pour le Cabinet.

Conséquences pratiques : durées de conservation des traces, information des utilisateurs, qui répond à une demande d'accès portant sur ces traces. `[À TRANCHER]`

### 4.3 Mesure d'usage et amélioration du produit — à trancher

État réel : le logiciel calcule des indicateurs d'activité « du cabinet et du logiciel », par cabinet et par dossier, jamais par personne, et les affiche au Cabinet. Les métriques techniques ne portent aucun identifiant de cabinet, de dossier ou de personne. L'Éditeur n'exploite rien de cela aujourd'hui.

Si l'Éditeur veut exploiter des données d'usage pour son propre compte (pilotage du produit, statistiques commerciales), il devient responsable de ce traitement. La CNIL encadre la réutilisation par un sous-traitant : autorisation écrite préalable du responsable, donnée traitement par traitement (une autorisation générale n'est pas admise), après un test de compatibilité, avec information des personnes. Alternative : ne produire que des statistiques anonymes. `[À TRANCHER : périmètre exact, anonymisation suffisante ou non, clause d'autorisation au contrat]`

### 4.4 Entraînement de modèles — exclu

Engagement de conception : les données des Cabinets ne servent jamais à entraîner un modèle. Aucun code d'entraînement n'existe. À inscrire au contrat comme interdiction, et à obtenir du fournisseur d'IA (non vérifié à ce jour).

### 4.5 Durées de conservation par défaut

Le logiciel modélise une politique de conservation par cabinet (`politiques_conservation`), non appliquée. Si l'Éditeur imposait des durées, il déciderait d'un moyen essentiel. Proposition : le Cabinet fixe les durées (avec des valeurs proposées par défaut, voir `../conservation.md`) ; l'Éditeur ne fixe seul que les durées des traitements dont il est responsable. `[À TRANCHER]`

## 5. Le Cabinet vis-à-vis de l'Entité cliente

C'est la question la plus ouverte, et elle détermine le rang de l'Éditeur : sous-traitant du Cabinet (si le Cabinet est responsable) ou sous-traitant ultérieur (si le Cabinet est lui-même sous-traitant de l'Entité cliente ; il faut alors l'autorisation de l'Entité cliente, art. 28 §2 et §4).

Aucune position officielle de la CNIL propre aux experts-comptables n'a été trouvée lors de la recherche du 2026-11-19 (une page CNIL « Qualification juridique : les cas sectoriels » existe ; elle n'a pas été lue). Les éléments ci-dessous sont une analyse à confronter à la doctrine de l'Ordre et à l'avis d'un juriste.

| Mission du Cabinet | Arguments pour « Cabinet responsable » | Arguments pour « Cabinet sous-traitant de l'Entité cliente » | Position proposée |
|---|---|---|---|
| Présentation, examen limité, audit contractuel des comptes ; révision | Profession réglementée, indépendante, soumise à ses propres normes et à sa déontologie ; le Cabinet décide de ses diligences et de ses dossiers de travail | L'Entité cliente fournit les données et reste tenue de sa comptabilité | `[À TRANCHER]` — l'analyse penche vers responsable pour les travaux de révision et les dossiers de travail |
| Tenue de comptabilité | Mêmes arguments d'indépendance | Exécution d'une tâche que l'Entité cliente pourrait faire elle-même, sur ses données, pour sa finalité (tenir sa comptabilité) | `[À TRANCHER]` |
| Paie et déclarations sociales (hors périmètre fonctionnel du logiciel, mais des pièces sociales peuvent être déposées) | — | Finalité de l'employeur (payer ses salariés) ; cas souvent présenté comme de la sous-traitance par les commentateurs (sources non officielles) | `[À TRANCHER]` |
| Conseil, registre des conseils | Activité propre du Cabinet | — | Responsable (proposé) |
| Gestion interne du Cabinet : missions, lettres, temps, rentabilité, comptes de ses collaborateurs | Sa propre gestion | — | Responsable |
| Obligations propres du Cabinet (lutte contre le blanchiment, contrôle qualité de l'Ordre) | Obligations légales personnelles | — | Responsable ; hors périmètre fonctionnel du logiciel |

Hypothèse de responsabilité conjointe (art. 26) : à examiner si le Cabinet et l'Entité cliente décident ensemble (par exemple un portail commun de dépôt dont les règles seraient fixées à deux). L'analyse actuelle ne la retient pas : c'est le Cabinet qui ouvre le dossier, habilite les utilisateurs de l'Entité cliente et fixe les règles. `[À TRANCHER]`

Conséquences pour le produit selon l'issue :

- Cabinet responsable partout : un seul contrat Cabinet ↔ Éditeur (art. 28) ; le Cabinet informe les personnes et répond aux demandes de droits.
- Cabinet sous-traitant pour certaines missions : l'Éditeur est sous-traitant ultérieur ; le contrat doit reprendre les obligations que l'Entité cliente impose au Cabinet (art. 28 §4) ; l'Entité cliente doit avoir autorisé le recours à l'Éditeur et à ses propres sous-traitants ; les demandes de droits remontent jusqu'à l'Entité cliente. Le projet de contrat prévoit les deux cas (`contrat-sous-traitance-projet.md`, article 2).
- Le logiciel ne distingue pas aujourd'hui les missions selon ce critère : rien dans le modèle de données ne porte la qualification du Cabinet par dossier. `[À TRANCHER : faut-il la porter au niveau du dossier ou de la mission]`

## 6. Utilisateurs de l'Entité cliente et messagerie

- Clients déposant et en lecture : leurs comptes sont créés à la demande du Cabinet ; l'Éditeur resterait sous-traitant. L'information de ces utilisateurs (art. 13) incombe au responsable ; aucune mention d'information n'est rédigée ni affichée dans l'application à ce jour.
- Messagerie : la boîte connectée contient des messages de tiers sans rapport avec la comptabilité. Le connecteur est en lecture seule et ne retient que des pièces à qualifier. Le responsable de cette collecte serait le Cabinet (ou la personne dont la boîte est connectée, si c'est une boîte de l'Entité cliente). `[À TRANCHER : base légale et information des correspondants ; minimisation des métadonnées conservées]`

## 7. Synthèse des points à trancher

1. Sous-traitance pour l'ensemble du service (§3).
2. Sécurité : sous-traitance ou traitement propre (§4.2).
3. Mesure d'usage : cadre de réutilisation ou anonymisation (§4.3).
4. Qui fixe les durées de conservation (§4.5).
5. Rôle du Cabinet par mission et rang de l'Éditeur (§5).
6. Responsabilité conjointe écartée ou non (§5).
7. Messagerie : responsable, base légale, information (§6).

## Références

Consultées le 2026-11-19.

- RGPD, art. 4 §7 et §8, 26, 28 : <https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32016R0679>
- CNIL, « Responsable du traitement, sous-traitants : comment bien identifier son rôle ? » (page du 6 juin 2025) : <https://www.cnil.fr/fr/rgpd-comment-bien-identifier-son-role>
- CNIL, « Sous-traitants : la réutilisation de données confiées par un responsable de traitement » (page du 11 janvier 2022) : <https://www.cnil.fr/fr/sous-traitants-la-reutilisation-de-donnees-confiees-par-un-responsable-de-traitement>
- CEPD, lignes directrices 07/2020 concernant les notions de responsable du traitement et de sous-traitant dans le RGPD, version finale du 7 juillet 2021 (page de présentation consultée ; texte non relu) : <https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-072020-concepts-controller-and-processor-gdpr_fr>
- CEPD, avis 22/2024 sur le recours à des sous-traitants et sous-traitants ultérieurs : cité par la page CNIL ci-dessus ; non consulté.
- CNIL, « Qualification juridique : les cas sectoriels » : page signalée par la CNIL, non lue.
