# Registre des risques et des validations professionnelles attendues

Le logiciel ne se substitue ni à un expert-comptable ni à un avocat. Ce registre liste ce qui doit être validé par un professionnel habilité avant tout usage réel, et les risques connus.

## Validations professionnelles attendues

| # | Objet | Valideur | État |
|---|---|---|---|
| V1 | Chaque contrôle du catalogue : objectif, logique, seuils par défaut, formulation des constats, gravité | Expert-comptable | En attente |
| V2 | Interprétation du format FEC (sens `+1`/`-1` en variante Montant/Sens, contrôles de conformité non implémentés) | Expert-comptable, sur fichiers réels | En attente |
| V3 | Référence et seuils fiscaux utilisés par les contrôles de TVA et d'immobilisations | Expert-comptable / fiscaliste | En attente |
| V4 | Qualification des rôles RGPD par finalité, contrat de sous-traitance, liste des sous-traitants, registre des traitements | DPO / avocat | Rédigés à l'état de PROJET le 2026-11-19 (dossier `juridique/` : `roles-rgpd.md`, `contrat-sous-traitance-projet.md`, `sous-traitants.md`, `registre-traitements.md`, `gestion-des-droits.md`, `procedure-incident.md` ; index dans `juridique/README.md`) ; aucune validation ; aucun sous-traitant contracté |
| V5 | Analyse de nécessité d'une AIPD | DPO | Projet rédigé le 2026-11-19 (`juridique/analyse-aipd.md`) : AIPD proposée avant mise en service et au plus tard avant l'activation de l'IA ; conclusion non validée ; aucune AIPD réalisée |
| V6 | Analyse des obligations du règlement européen sur l'IA | Avocat | Projet rédigé le 2026-11-19 (`juridique/analyse-reglement-ia.md`), tenant compte du règlement (UE) 2026/1744 : classification proposée hors haut risque, article 50 à mettre en œuvre ; non validé |
| V7 | Secret professionnel, responsabilités contractuelles, conditions générales | Avocat | Points d'attention et clauses à prévoir rédigés à l'état de PROJET le 2026-11-19 (`juridique/secret-professionnel-responsabilites.md`) ; conditions générales et politique de confidentialité non rédigées ; validation attendue |
| V8 | Durées de conservation par catégorie et leur fondement | Avocat / expert-comptable | Durées PROPOSÉES avec leur fondement le 2026-11-19 (`conservation.md`) ; plusieurs références non revérifiées sur Légifrance ; rien d'arrêté ni d'appliqué ; validation attendue |
| V9 | Autorisation de mise en production | Éditeur | Non demandée |
| V11 | Table de correspondance comptes → rubriques des projets de bilan et de compte de résultat ; conventions des indicateurs financiers | Expert-comptable | En attente |
| V12 | Référentiel de prestations et formulation des signalements « hors périmètre » | Expert-comptable | En attente |
| V13 | Préparation de la liasse : correspondance lignes → cases des formulaires du millésime, tracé des tableaux, agrégats du régime simplifié, borne d'exercice, arrondis (`etats-fiscaux.md`) | Expert-comptable | En attente ; codes de cases non vérifiés sur la source officielle |
| V14 | Projet d'annexe : rubriques requises par catégorie, seuils de taille en vigueur, contenu des mentions | Expert-comptable | En attente |
| V15 | Propositions d'écritures d'inventaire : conventions de prorata, schémas d'écriture FNP/FAE, traitement de la TVA | Expert-comptable | En attente |
| V16 | Choix d'un prestataire d'agrégation bancaire : statut réglementaire (registre de l'ACPR), conditions | Éditeur / avocat | Aucun prestataire choisi |
| V17 | Activation de l'IA : conditions contractuelles du fournisseur, évaluation sur corpus métier réel avant de confier une tâche au modèle | Éditeur / expert-comptable | Non commencée (aucun jeton) |
| V10 | Conditions des fournisseurs d'IA et d'hébergement (région, conservation, non-réutilisation) | Éditeur / avocat | Non vérifiées |

Aucune certification, conformité à une norme ou validation par une autorité n'est revendiquée.

## Risques

| # | Risque | Gravité | Mesure en place | Reste à faire |
|---|---|---|---|---|
| R1 | Un constat erroné ou un contrôle silencieux est pris pour une conclusion comptable | Élevée | Cinq statuts distincts ; « non réalisé » jamais favorable ; mention « projet » partout ; validation humaine séparée | Validation métier V1 ; évaluation sur corpus réel |
| R2 | Extraction de facture fausse utilisée telle quelle | Élevée | Extraction par règles qui s'abstient plutôt que de deviner ; vérifications arithmétiques par le moteur ; confiance « non évaluée » ; validation par un réviseur | Mesure de qualité sur pièces réelles autorisées ; aucune mesure n'existe à ce jour hors jeux synthétiques |
| R3 | Fuite de données entre cabinets ou entre dossiers | Critique | RLS activé et forcé, rôles sans `BYPASSRLS`, contexte tiré du jeton vérifié, tests d'intégration et de bout en bout | Test d'intrusion indépendant ; revue du rôle de migration en production |
| R4 | Compatibilité FEC limitée aux variantes testées | Moyenne | Rapport distinguant lisible, conforme et suffisant ; variantes testées documentées | Essais sur exports réels des logiciels du marché |
| R5 | Pièce malveillante (code, bombe de décompression, instructions cachées) | Élevée | Antivirus bloquant, type réel, décodage PDF/XML dans un processus enfant par fichier (environnement vide, lecture de fichiers restreinte, sans écriture ni processus fils, réseau neutralisé dans le processus, durée, mémoire et sortie bornées, résultat validé par schéma), DOCTYPE et ENTITY refusés, contenus traités comme données | Isolation par le noyau (conteneur ou utilisateur dédié sans réseau) ; même isolement pour les relevés bancaires, les FEC et le mail ; dimensionnement mémoire du conteneur (deux enfants de 1 024 Mo en plus du tas) |
| R6 | Royaume d'identité de développement réutilisé en production | Élevée | Royaume nommé « DÉVELOPPEMENT LOCAL », client de test documenté comme interdit en production | Royaume de production distinct, MFA imposé |
| R7 | Journal d'audit altéré par un administrateur de base | Moyenne | Ajout seul par déclencheurs, chaînage par empreinte, vérification d'intégrité | Archivage externe protégé (Object Lock) ; un superutilisateur peut désactiver les déclencheurs |
| R8 | Dépôt de code public | À apprécier | Aucun secret versionné (`.env` ignoré) | Décision du propriétaire sur la visibilité |
| R9 | Conservation illimitée des données par absence de purge | Moyenne | Aucune suppression destructive automatique | Politique de conservation et purge (V8) |
| R10 | Seuils internes non calibrés (lisibilité, couche texte, tolérances) | Moyenne | Documentés comme règles internes | Calibration sur corpus réel |
| R11 | Le navigateur du téléphone purge les dépôts en attente | Faible | Comportement expliqué à l'utilisateur ; « reçu » seulement après confirmation serveur | Essais sur appareils réels |
| R13 | Un rapprochement proposé à tort est validé sans examen | Élevée | Propositions expliquées avec leurs critères ; ambiguïtés non tranchées ; validation réservée au réviseur ; rien n'est écrit en comptabilité | Mesure du taux de faux appariements sur relevés réels |
| R14 | Projet de bilan ou indicateur pris pour un état validé | Élevée | Mention « projet » ; table de correspondance marquée en attente de validation ; comptes non affectés et écarts affichés, jamais forcés | Validation professionnelle de la table (V11) |
| R15 | Veille incomplète prise pour une absence de nouveauté | Élevée | Source indisponible affichée comme telle avec sa dernière vérification réussie ; détections brutes jamais présentées comme évolutions | Accès à l'API officielle de Légifrance ; élargir les sources |
| R16 | Fonctions SQL à droits du propriétaire mal bornées | Élevée | Chaque fonction vérifie l'appelant, ne renvoie qu'identifiants ou décomptes, et n'est exécutable que par un rôle (décision D-022) | Revue de sécurité indépendante de ces fonctions |
| R17 | Signal « à examiner » lu comme un diagnostic de difficulté | Moyenne | Formulé en question, avec la mention qu'il n'est ni un diagnostic ni une appréciation de la continuité d'exploitation | Validation des formulations par un professionnel |
| R18 | Règle de cabinet masquant des constats pertinents | Moyenne | Mesure d'impact obligatoire, approbation par une autre personne, trace dans chaque résultat, retrait réversible | Revue périodique des règles approuvées |
| R19 | Règle d'appariement trop permissive faisant croire une facture réglée | Élevée | Égalité stricte des montants, abstention par défaut, confirmation humaine, preuves affichées, états à date explicite | Validation des règles par un expert-comptable ; mesure sur des dossiers réels |
| R20 | Fin de contrat exécutée par erreur (irréversible) | Élevée | Simulation par défaut, double confirmation par identifiant et nom, sept pré-conditions, transaction tout ou rien, réservée au rôle d'administration | Arrêter les durées (V8) avant toute activation ; mesurer la transaction sur un gros cabinet ; les données subsistent dans les sauvegardes jusqu'à leur rotation |
| R12 | Dépendances très récentes (NestJS 12, Next 16, pnpm 12) | Faible | Versions figées, verrou versionné | Veille des correctifs de sécurité |
