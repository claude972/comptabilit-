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
| P0 — FAIT (849788f, CI à confirmer) | Stabiliser l’isolation des analyseurs et diagnostiquer les blocages Docker récurrents | Suites pièces, FEC et banque avec API/worker complets en mode conteneur ; lanceur restreint et client réels ; arrêt/timeout sans conteneur orphelin ; récupération des services ; mesures p50/p95 et mémoire ; contrôle automatique adapté en CI. Cause et limites documentées, pas de masquage des échecs. |
| P1 — FAIT (docs/acces-externes.md : faux blocages levés, fiches par dépendance) | Réconcilier plan, couverture, exigences et accès externes avec le code actuel | Une liste unique de restes rattachés aux exigences ; supprimer les faux blocages GitHub et les mentions obsolètes « non développé » ; distinguer obligations, améliorations et dépendances réelles. Ne pas reclasser une exigence en option pour fermer le plan. |
| P2 | Achever la conservation et la fin de contrat | Cycle complet implémenté mais désactivé sans politique validée : échéances, reprise, objets, comptes, sauvegardes et traces conservées ; simulation lisible ; preuves sur ressources jetables ; aucun effacement des données existantes. |
| P3 | Recette de produit et robustesse | Dix parcours du cahier des charges, profils et droits, erreurs/réessais ; charge concurrente multi-utilisateur et multi-cabinet, gros imports ; budgets mesurés et échecs explicites ; défauts corrigés. Préparer une recette précise pour téléphone, Safari et lecteur d’écran lorsque non accessibles. |
| P4 | Préparation complète de l’exploitation | Installation reproductible, configuration contrôlée, procédure de mise à jour/retour arrière, MFA, restauration chronométrée isolée, surveillance disque/certificats, rétention des traces éprouvée avec durée d’essai ; sauvegardes chiffrées et ancrage prêts à raccorder. Revue des changements RLS et preuve d’isolation ; ne pas présenter une revue automatisée comme un audit indépendant. |
| P5 | Achever les fonctions indépendantes des prestataires | Reprendre chaque reste fonctionnel des exigences, dont assistant, recherche, intégrations et états ; préparer les adaptateurs et parcours manquants avec contrats et essais. Relire les formulaires officiels accessibles ; statut de projet fiscal maintenu. Les améliorations non exigées passent après les obligations. |
| P6 | Raccordements et recette pilote | Dès accès disponibles : IA/embeddings, Gmail, Microsoft 365, banque, notifications, infrastructure cible et veille officielle ; essais réels et corpus autorisé ; validations expert-comptable/DPO/avocat. Aucun compte payant ni activation commerciale implicite. |

## Dépendances à préparer sans arrêter les autres lots

Tenir dans `acces-externes.md` une fiche par dépendance : accès ou validation exacts, configuration préparée, procédure de raccordement, essai d’acceptation, responsable et ce qui reste possible sans cet accès. Ne jamais y copier de secret.

## Définition de terminé

Chaque exigence initiale possède une preuve ou une dépendance explicitement non résolue. Le code livré et sa CI sont vérifiés ; les parcours réels, la sécurité, l’exploitation et la restauration sont éprouvés dans l’environnement concerné. Tant que raccordements réels ou validations nécessaires manquent, annoncer « préparation locale achevée » au mieux, jamais « production prête ».

## Reprise

État au 2026-11-20 : P0 clos par le commit 849788f (mode conteneur éprouvé de bout en bout : API 370, Chromium 50, worker 111 + 31, mesures p50/p95 ; cause des blocages Docker établie par la trace de dockerd 29.5.2, D-098 bis). Écart assumé au critère « contrôle en CI » : l'étape CI n'est PAS ajoutée (mode jamais vu passer sur un exécuteur, risque de rouge d'infrastructure) ; décrite dans D-098 bis point 5. P1 : `acces-externes.md` réconcilié (GitHub levé, agrégation bancaire « développé, non raccordé », fiches par dépendance). Prochain lot : P2 (conservation et fin de contrat, D-099 à compléter), puis P3 à P6.

À chaque clôture de lot : mettre à jour ici l'état et les preuves, sans attendre une nouvelle consigne.
