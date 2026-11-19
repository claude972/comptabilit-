# Accès et actions externes encore nécessaires

Chaque ligne indique ce qui est attendu d'un humain, pourquoi, et ce qui en dépend. Tout le reste a été réalisé sans attendre.

| # | Action attendue | Qui | Ce qui en dépend | État du code |
|---|---|---|---|---|
| 1 | S'authentifier auprès de GitHub sur ce poste (jeton d'accès personnel) et décider de la visibilité du dépôt `claude972/comptabilit-`, aujourd'hui public | Propriétaire du dépôt | Publication du code, exécution de l'intégration continue | Dépôt distant configuré, rien n'a été poussé |
| 2 | Créer l'application OAuth Google (Cloud Console), le sujet Pub/Sub, et engager la vérification des scopes restreints | Éditeur | Connexion réelle à Gmail | Voir `packages/mail/docs/guide-connexion.md` ; connecteur à l'état « non connecté » |
| 3 | Créer l'inscription d'application Microsoft Entra, obtenir le consentement des tenants clients | Éditeur, administrateurs des cabinets | Connexion réelle à Microsoft 365 | Idem |
| 4 | Ouvrir un projet OVHcloud Public Cloud et fournir un jeton AI Endpoints ; vérifier région de traitement, conservation des requêtes et conditions contractuelles | Éditeur | Toute fonction d'IA (qualification assistée, assistant, veille) | Passerelle IA non branchée ; statut « non connectée » |
| 5 | Fournir les accès à l'infrastructure cible (OVHcloud, région française) et autoriser la mise en production | Éditeur | Déploiement, sauvegardes gérées, Object Lock | Environnement local uniquement ; aucune ressource payante créée |
| 6 | Fournir un corpus de pièces et de FEC réels AUTORISÉ, avec les protections adaptées | Cabinet pilote | Calibration de l'extraction et de l'OCR, compatibilité FEC par logiciel | Recette sur jeux synthétiques uniquement |
| 7 | Valider les contrôles, leurs seuils et leurs formulations | Expert-comptable habilité | Usage professionnel des constats | Catalogue documenté, en attente de validation métier |
| 8 | Valider les documents RGPD, le contrat de sous-traitance, l'analyse AI Act et les clauses de responsabilité | Avocat / DPO | Commercialisation | Non rédigés (voir `risques.md`) |
| 9 | Choisir et contractualiser un prestataire d'agrégation bancaire autorisé | Éditeur | Connexion bancaire directe | Non développé ; les imports de fichiers bancaires ne dépendent pas de ce choix |
| 10 | Imposer le second facteur et configurer la fédération SSO dans le royaume Keycloak de production | Éditeur | Sécurité des comptes du cabinet | Royaume de développement sans MFA (décision D-016) |

Aucune dépense n'a été engagée et aucun compte externe n'a été créé.
