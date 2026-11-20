# Plan d’achèvement autonome — 20 novembre 2026

Mandat utilisateur : terminer le produit selon le cahier des charges initial, décider des choix techniques courants, publier les corrections dans le dépôt autorisé et poursuivre au-delà d’une CI verte. Claude reste l’exécutant du code ; la supervision vérifie les preuves et relance le prochain lot. Ce plan ordonne le travail et ne remplace pas les exigences initiales.

## Règles de conduite

- Un seul chantier de code actif dans la copie de travail. Ne pas interrompre une tâche qui progresse réellement.
- Pour chaque lot : exigence, changement, preuve exécutée, limites, commit et résultat CI. Corriger les documents contradictoires ; ne pas clôturer sur une simple déclaration.
- Continuer les travaux indépendants lorsqu’un accès manque. Séparer implémenté, testé avec simulateur, connecté et validé professionnellement.
- Préserver données, secrets et historique. Aucune dépense, purge de données existantes, souscription ou contournement de protection. Préparer les mécanismes destructifs désactivés et les tester sur ressources jetables.
- Les validations métier et juridiques ne peuvent pas être remplacées par un arbitrage technique.

## Ordre d’exécution et critères de fin

| Priorité | Travail | Critère de fin vérifiable |
|---|---|---|
| P0 — PARTIEL (rouvert par la supervision le 2026-11-20 ; 3e passe : cause reproduite, atténuée, essais groupés stables, CI expérimentale ajoutée ; NON clos) | Stabiliser l’isolation des analyseurs et diagnostiquer les blocages Docker récurrents | Suites pièces, FEC et banque avec API/worker complets en mode conteneur ; lanceur restreint et client réels ; arrêt/timeout sans conteneur orphelin ; récupération des services ; mesures p50/p95 et mémoire ; contrôle automatique adapté en CI. Cause et limites documentées, pas de masquage des échecs. |
| P1 — fait (acces-externes.md) | Réconcilier plan, couverture, exigences et accès externes avec le code actuel | Une liste unique de restes rattachés aux exigences ; supprimer les faux blocages GitHub et les mentions obsolètes « non développé » ; distinguer obligations, améliorations et dépendances réelles. Ne pas reclasser une exigence en option pour fermer le plan. |
| P2 — FAIT (D-100 ; aucune exécution réelle) | Achever la conservation et la fin de contrat | Cycle complet implémenté mais désactivé sans politique validée : échéances, reprise, objets, comptes, sauvegardes et traces conservées ; simulation lisible ; preuves sur ressources jetables ; aucun effacement des données existantes. |
| P3 | Recette de produit et robustesse | Dix parcours du cahier des charges, profils et droits, erreurs/réessais ; charge concurrente multi-utilisateur et multi-cabinet, gros imports ; budgets mesurés et échecs explicites ; défauts corrigés. Préparer une recette précise pour téléphone, Safari et lecteur d’écran lorsque non accessibles. |
| P4 | Préparation complète de l’exploitation | Installation reproductible, configuration contrôlée, procédure de mise à jour/retour arrière, MFA, restauration chronométrée isolée, surveillance disque/certificats, rétention des traces éprouvée avec durée d’essai ; sauvegardes chiffrées et ancrage prêts à raccorder. Revue des changements RLS et preuve d’isolation ; ne pas présenter une revue automatisée comme un audit indépendant. |
| P5 | Achever les fonctions indépendantes des prestataires | Reprendre chaque reste fonctionnel des exigences, dont assistant, recherche, intégrations et états ; préparer les adaptateurs et parcours manquants avec contrats et essais. Relire les formulaires officiels accessibles ; statut de projet fiscal maintenu. Les améliorations non exigées passent après les obligations. |
| P6 | Raccordements et recette pilote | Dès accès disponibles : IA/embeddings, Gmail, Microsoft 365, banque, notifications, infrastructure cible et veille officielle ; essais réels et corpus autorisé ; validations expert-comptable/DPO/avocat. Aucun compte payant ni activation commerciale implicite. |

## Dépendances à préparer sans arrêter les autres lots

Tenir dans `acces-externes.md` une fiche par dépendance : accès ou validation exacts, configuration préparée, procédure de raccordement, essai d’acceptation, responsable et ce qui reste possible sans cet accès. Ne jamais y copier de secret.

## Définition de terminé

Chaque exigence initiale possède une preuve ou une dépendance explicitement non résolue. Le code livré et sa CI sont vérifiés ; les parcours réels, la sécurité, l’exploitation et la restauration sont éprouvés dans l’environnement concerné. Tant que raccordements réels ou validations nécessaires manquent, annoncer « préparation locale achevée » au mieux, jamais « production prête ».

## Reprise

État au 2026-11-20 : **P0 PARTIEL, non clos.** Preuves acquises (849788f) : mode conteneur éprouvé de bout en bout (API 370, Chromium 50, worker 111 + 31 isolés), lanceur et client réels, 21 requêtes hors politique et 37 écarts de création traités, mesures p50/p95 (≈ +0,3 s par pièce, FEC +64 %). Mise à jour 3e passe P0 (2026-11-20, D-098 bis « PASSE P0-3 »), P0 TOUJOURS PARTIEL, NON déclaré clos : (1) blocage de dockerd : REPRODUIT de façon déterministe sur un moteur d'essai jetable (recette `scripts/repro-arret-force.mjs flux-annule` : 7 / 7 avec l'ancien code, dockerd 29.5.2 et 29.10.0) ; aucune version officielle publiée (jusqu'à 29.10.0, 2026-11-16) ne le corrige (défauts voisins moby/moby#41827 et #53614 ouverts) ; ATTÉNUÉ par un arrêt ordonné (sortie vidée, conteneur tué client attaché, entrée par blocs) : 280 arrêts sans blocage, essai de non-régression de 30 arrêts (échoue avec l'ancien code), confinement inchangé ; atténuation empirique, non garantie ; (2) essais groupés STABLES : suite worker en un bloc, 2 passes de 142 / 142 (contre un moteur d'essai) ; la cascade venait d'UN conteneur bloqué, pas du nettoyage ; (3) étape CI EXPÉRIMENTALE ajoutée (`continue-on-error`, bornée, diagnostic et nettoyage garantis), jamais exécutée sur GitHub : à suivre à la prochaine CI. RESTE pour clore P0 : verdict de l'étape CI sur un exécuteur, décision sur le chemin « worker tué brutalement » (non atténué) et sur le protocole d'entrée à crédit, suite groupée rejouée contre le moteur de la pile (non fait ici pour ne pas l'exposer), mode jamais activé en production. Texte de la 2e passe, conservé : le blocage n'était alors « PAS prévenu », les essais groupés pendaient et aucun contrôle CI n'existait ; la cause était un déclencheur PROBABLE non reproduit. P0 ne sera déclaré clos qu'après la supervision de ces restes ; ne pas avoir exécuté l'étape sur GitHub ne justifie pas de ne pas l'avoir ajoutée.

P1 : `acces-externes.md` réconcilié. P2 clos par l'agent (D-100, à valider par la supervision ; non commité) : cycle complet de conservation et de fin de contrat implémenté, désactivé, éprouvé de bout en bout sur ressources jetables (base, bucket S3 versionné avec Object Lock, royaume Keycloak, répertoire de sauvegardes) — destruction à terme des éléments conservés, journal scellé puis détruit sur décision humaine, clôture avec certificat, nettoyage du dépôt d'objets des sauvegardes, cycle à état persistant avec reprise, échéancier et rapports lisibles ; AUCUNE exécution réelle, aucune donnée existante touchée. Reste hors lot : durées juridiques (externe), destruction du journal en production (décision de conception, R34), sort de l'export scellé (DPO). Ordre : reste de P0, puis P3 à P6. CI publiées à suivre : 849788f (P0) et le commit P1.

À chaque clôture de lot : mettre à jour ici l'état et les preuves, sans attendre une nouvelle consigne.
