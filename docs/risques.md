# Registre des risques et des validations professionnelles attendues

Le logiciel ne se substitue ni à un expert-comptable ni à un avocat. Ce registre liste ce qui doit être validé par un professionnel habilité avant tout usage réel, et les risques connus.

## Validations professionnelles attendues

| # | Objet | Valideur | État |
|---|---|---|---|
| V1 | Chaque contrôle du catalogue : objectif, logique, seuils par défaut, formulation des constats, gravité | Expert-comptable | En attente |
| V2 | Interprétation du format FEC (sens `+1`/`-1` en variante Montant/Sens, contrôles de conformité non implémentés) | Expert-comptable, sur fichiers réels | En attente |
| V3 | Référence et seuils fiscaux utilisés par les contrôles de TVA et d'immobilisations | Expert-comptable / fiscaliste | En attente |
| V4 | Qualification des rôles RGPD par finalité, contrat de sous-traitance, liste des sous-traitants, registre des traitements | DPO / avocat | Documents non rédigés |
| V5 | Analyse de nécessité d'une AIPD | DPO | Non réalisée |
| V6 | Analyse des obligations du règlement européen sur l'IA | Avocat | Non réalisée |
| V7 | Secret professionnel, responsabilités contractuelles, conditions générales | Avocat | Non réalisé |
| V8 | Durées de conservation par catégorie et leur fondement | Avocat / expert-comptable | Non définies (voir `conservation.md`) |
| V9 | Autorisation de mise en production | Éditeur | Non demandée |
| V10 | Conditions des fournisseurs d'IA et d'hébergement (région, conservation, non-réutilisation) | Éditeur / avocat | Non vérifiées |

Aucune certification, conformité à une norme ou validation par une autorité n'est revendiquée.

## Risques

| # | Risque | Gravité | Mesure en place | Reste à faire |
|---|---|---|---|---|
| R1 | Un constat erroné ou un contrôle silencieux est pris pour une conclusion comptable | Élevée | Cinq statuts distincts ; « non réalisé » jamais favorable ; mention « projet » partout ; validation humaine séparée | Validation métier V1 ; évaluation sur corpus réel |
| R2 | Extraction de facture fausse utilisée telle quelle | Élevée | Extraction par règles qui s'abstient plutôt que de deviner ; vérifications arithmétiques par le moteur ; confiance « non évaluée » ; validation par un réviseur | Mesure de qualité sur pièces réelles autorisées ; aucune mesure n'existe à ce jour hors jeux synthétiques |
| R3 | Fuite de données entre cabinets ou entre dossiers | Critique | RLS activé et forcé, rôles sans `BYPASSRLS`, contexte tiré du jeton vérifié, tests d'intégration et de bout en bout | Test d'intrusion indépendant ; revue du rôle de migration en production |
| R4 | Compatibilité FEC limitée aux variantes testées | Moyenne | Rapport distinguant lisible, conforme et suffisant ; variantes testées documentées | Essais sur exports réels des logiciels du marché |
| R5 | Pièce malveillante (code, bombe de décompression, instructions cachées) | Élevée | Antivirus bloquant, détection du type réel, analyseurs sans exécution ni réseau, limites de taille, contenus traités comme données | Isolation des traitements en bac à sable dédié (aujourd'hui : même processus worker) ; limites de ressources par tâche |
| R6 | Royaume d'identité de développement réutilisé en production | Élevée | Royaume nommé « DÉVELOPPEMENT LOCAL », client de test documenté comme interdit en production | Royaume de production distinct, MFA imposé |
| R7 | Journal d'audit altéré par un administrateur de base | Moyenne | Ajout seul par déclencheurs, chaînage par empreinte, vérification d'intégrité | Archivage externe protégé (Object Lock) ; un superutilisateur peut désactiver les déclencheurs |
| R8 | Dépôt de code public | À apprécier | Aucun secret versionné (`.env` ignoré) | Décision du propriétaire sur la visibilité |
| R9 | Conservation illimitée des données par absence de purge | Moyenne | Aucune suppression destructive automatique | Politique de conservation et purge (V8) |
| R10 | Seuils internes non calibrés (lisibilité, couche texte, tolérances) | Moyenne | Documentés comme règles internes | Calibration sur corpus réel |
| R11 | Le navigateur du téléphone purge les dépôts en attente | Faible | Comportement expliqué à l'utilisateur ; « reçu » seulement après confirmation serveur | Essais sur appareils réels |
| R12 | Dépendances très récentes (NestJS 12, Next 16, pnpm 12) | Faible | Versions figées, verrou versionné | Veille des correctifs de sécurité |
