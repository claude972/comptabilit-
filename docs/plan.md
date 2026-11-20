# Plan de travail par lot

État au 2026-11-19. Le détail fonctionnalité par fonctionnalité est dans `couverture.md`.

## Lot 0 — Socle : réalisé

Critères d'acceptation et résultat :

- [x] Environnement local reproductible, versions figées.
- [x] Migrations SQL versionnées, rôles techniques sans `BYPASSRLS`.
- [x] Un utilisateur d'un cabinet ne voit rien d'un autre ; le rôle ne suffit pas pour accéder à un dossier (tests sur PostgreSQL réel).
- [x] Journal d'audit non modifiable, intégrité vérifiable.
- [x] Aucun montant en flottant.
- [x] Tests automatisés exécutables par une commande.
- [ ] Intégration continue exécutée (écrite, pas encore lancée : dépôt distant non alimenté).
- [ ] Supervision.

## Lot 1 — Collecte et première révision : réalisé en local, connexions réelles en attente

- [x] Dépôt téléphone et ordinateur, reprenable, confirmé par le serveur.
- [x] Antivirus, type réel, extraction structurée, couche texte et OCR local.
- [x] Revue de pièce avec correction versionnée et validation.
- [x] Import FEC, 12 contrôles prioritaires, revue des constats, dossier PDF.
- [x] Connecteurs Gmail et Microsoft 365 développés et testés contre simulateur.
- [x] Connecteurs branchés dans l'API et le worker (20 parcours contre simulateur).
- [x] Contrôles fiscaux non réalisés hors du territoire couvert.
- [ ] Écrans de gestion des connexions mail et page de retour OAuth.
- [ ] Connexion à de vraies boîtes (dépend des applications OAuth : `acces-externes.md`, lignes 2 et 3).
- [ ] Essais sur appareils réels.
- [ ] Évaluation de l'extraction sur un corpus réel autorisé.
- [ ] Validation métier des contrôles.

## Lot 2 — Révision avancée : réalisé en local

- [x] Relevés bancaires (camt.053, OFX, CSV), rapprochements, validation, obsolescence — base, API, worker, écrans, parcours réels.
- [x] Relevés fournis à `TRE-003`, exercice précédent fourni à `CLO-002`.
- [x] Abonnements : moteur, provisionnement éditeur, API cabinet, service fermé hors abonnement.
- [x] Règles et paramètres par cabinet, avec mesure d'impact, approbation et retrait.
- [x] Administration : dossiers, exercices, habilitations, membres, audit.
- [x] Export de restitution d'un dossier ; purge des téléversements abandonnés.
- [x] Métriques techniques ; image de conteneur de l'API ; ébauche OpenTofu validée.
- [ ] Correspondance explicite comptes 512 ↔ comptes bancaires quand il y en a plusieurs.
- [x] Changement de rôle et désactivation d'un membre.
- [ ] Invitation et création de compte d'un membre.
- [x] Outil en ligne de commande de l'éditeur (abonnements, veille).
- [ ] Création d'un cabinet et de ses comptes par cet outil.
- [x] Annulation réversible et reprise d'un import ; campagnes d'import sur plusieurs dossiers.
- [x] Nouvelle version d'une pièce ; aperçu d'un CSV bancaire ; pièces jointes aux conseils, lettres et écritures.
- [x] Rattrapage générique des traitements en attente ; accès temporaire du support ; rotation du secret des jetons mail.
- [x] Restitution d'un cabinet entier (mesurée sur 302 dossiers, D-094) ; test de charge en LECTURE et en calcul sur 300 dossiers (D-094) : un seul poste, un seul utilisateur.
- [ ] Dépôt d'une archive répartie entre dossiers ; import de 300 dossiers avec de gros fichiers ; charge de plusieurs utilisateurs ou cabinets simultanés.
- [ ] Agrégation bancaire (prestataire à choisir) ; export vers l'outil de facturation de l'éditeur.

## Lot 3 — Veille et assistant : réalisés en local ; IA, Légifrance et qualification en attente d'accès extérieurs

- [x] Surveillance des sources, détection de changement, évolutions à qualifier par une personne.
- [x] Applicabilité par dossier, suivi par dossier.
- [x] Recherche textuelle autorisée.
- [ ] Accès à l'API officielle de Légifrance (le site refuse l'accès automatisé).
- [ ] Qualification réelle d'évolutions par une personne compétente.
- [x] Assistant documenté en mode « sans IA », sur un dossier et sur un portefeuille par tranches de vingt (D-079, D-088) ; [ ] version avec modèle : dépend de la passerelle IA (aucun jeton).
- [x] Recherche textuelle multi-dossiers (D-088) ; passages indexés, vecteurs NULL ; [ ] recherche vectorielle : attend un fournisseur d'embeddings.

## Lot 4 — Missions et performance : réalisé en local, à valider

- [x] Missions, lettres et avenants structurés, travaux, hors-périmètre, projet d'avenant, barème.
- [x] Registre des conseils.
- [x] Indicateurs financiers du dossier ; indicateurs d'activité du cabinet.
- [ ] Analyse automatique d'une lettre de mission existante (dépend de l'IA).
- [x] Rentabilité par mission (honoraires saisis, temps observés, coût horaire saisi).
- [x] Affectation explicite des travaux à une mission.
- [ ] Rapprochement avec la facturation réelle.
- [ ] Validation professionnelle des conventions d'indicateurs.

## Lot 5 — États et fiscalité : amorcé (dégressif non activé, règles non validées par un professionnel)

- [x] Balance, projets de compte de résultat et de bilan.
- [x] Écritures d'inventaire proposées (saisie humaine), balance ajustée de travail, export.
- [ ] Validation professionnelle de la table de correspondance comptes → rubriques.
- [x] États projetés sur la balance ajustée.
- [x] Écritures d'inventaire proposées (dont amortissements, D-089 à D-092), projet d'annexe, préparation de la liasse ; [ ] génération assistée par IA ; [ ] codes de cases des formulaires du millésime ; [ ] validation professionnelle.

## Chantier du 2026-11-19 (soir) : relecture complète du cahier des charges

Matrice exigence → implémentation → preuve → reste : `exigences.md`. Réalisé à cette occasion (décisions D-064 à D-072) :

- [x] Invitations et ouverture d'un cabinet ; export des éléments de facturation de l'éditeur.
- [x] Agrégation bancaire : port, contrat pivot, simulateur, écran d'état (aucun prestataire : « non connecté »).
- [x] Veille : taille et opérations identifiées.
- [x] Recette de tous les écrans par profil (bureau et émulation mobile) ; six écarts d'usage corrigés.
- [x] Paquet IA, assistant documenté et tâches IA branchés ; état réel « sans IA » ; chemin « modèle » contre simulateur.
- [x] Indexation des pièces en passages (vecteurs en attente d'un fournisseur d'embeddings).
- [x] Reprise du fichier des immobilisations par import CSV : aperçu sans écriture, validation explicite, rapport ligne par ligne conservé et téléchargeable (D-092).
- [x] Lot 5 : préparation de la liasse (2050 à 2053, 2033-A/B), projet d'annexe, propositions d'écritures d'inventaire.
- [x] Déploiement et exploitation préparés : OpenTofu, composition de production, royaume Keycloak de production, supervision, script de déploiement, guide d'exploitation.
- [x] Documents juridiques à l'état de projet (`docs/juridique/`).

Reste réalisable sans intervention extérieure, non fait (par ordre d'utilité) :

1. FAIT (D-087, retiré de la liste) : preuve de connexion de la passerelle IA persistée ; reste seulement l'alerte d'expiration (point 6).
2. Amortissements (D-089, D-090) : activer le dégressif après lecture du texte de loi et validation par un expert-comptable (`AMORTISSEMENT_DEGRESSIF_ACTIVE`) ; unités d'œuvre, amortissement dérogatoire, plus ou moins-value de cession, coefficient majoré, exercices non annuels en dégressif ; lecture directe d'un classeur XLSX et rattachement de composants par import (la reprise du fichier des immobilisations par CSV est faite, D-092).
3. Assistant et recherche de portefeuille (D-079, D-088) : recherche par similarité quand des vecteurs réels existeront ; recherche multi-dossiers : coût par ligne dû aux politiques RLS (`app_niveau_entite` évaluée ligne à ligne, D-094), politique ensembliste posée (D-095, p50 7,4 s → 2,95 s), changement de sécurité à faire relire par un humain ; reste le calcul du plein texte par ligne (refus 503 possible vers un million de lignes) ; mesure sur un portefeuille RÉEL.
4. Tiers et factures (D-096) : tolérance de montant, règlements groupés probables et garde-fous de la table obsolète `factures` FAITS (bornes proposées à faire valider par un expert-comptable) ; reste : décider de la suppression de la table `factures` à une fin de contrat (jamais supprimée ici).
5. Traces (D-083) : source de données et tableau Grafana chargés et requêtes exécutées en local le 2026-11-20 ; reste : observer la rétention, surveiller le disque et les certificats, essayer sur deux hôtes en recette.
6. Isolation par le noyau des analyseurs (D-076, D-085) ; isolement du mail si un décodage MIME était introduit ; dépôt d'une archive répartie entre dossiers (REPORTÉ avec motif, D-096 : définition à fixer, lecture d'archive à traiter dans une isolation par le noyau) ; notifications poussées : essai sur appareils réels (retrait en masse après rotation VAPID FAIT, D-097) ; passerelle IA : alerte d'expiration FAITE (D-097), premier appel réel quand un jeton existera.
7. Fin de contrat (D-078), avant toute activation : arrêter les durées et le délai de grâce, exercer la suppression d'objets sur un stockage d'essai distinct, mesurer sur un volume réaliste, définir la rotation des sauvegardes, traiter les comptes du fournisseur d'identité, concevoir la fin de vie du journal et des éléments conservés. Purge à l'échéance des durées : non écrite.

Le reste dépend d'une intervention extérieure : liste en tête de `acces-externes.md`.

## État de reprise (au 2026-11-20, réconcilié)

Pour reprendre le travail sans relire l'historique :

- **Code** : branche `main`, publiée sur le dépôt distant (accord de l'utilisateur du 2026-11-19, qui couvre les corrections de la CI). Dernière intégration continue vérifiée verte, Chromium, WebKit et Firefox compris : commit 0b9a229 (run 44707536419) ; les lots suivants (D-093, D-094, commit 86ffed2 et après) sont à vérifier dans `git log` et l'API publique des runs ; la CI est rouge de temps à autre sur des courses de tests qu'il faut corriger, pas masquer ; suivre une exécution : API publique `actions/runs` et annotations du job (pas de jeton sur ce poste).
- **Démarrer** : `source ~/.comtaple-outils/env.sh`, `colima start` si Docker ne répond pas, `pnpm run services:up`, `pnpm run build`, `scripts/applis.sh demarrer` (API 4000, worker, web 3100). Le worker tourne avec un tas plafonné à 2 048 Mo.
- **Vérifier** : `pnpm run typecheck`, `pnpm run test`, puis les suites d'intégration (`pnpm --filter @comtaple/db|api|worker run test:integration`) et navigateur (`rapport-de-tests.md` donne les commandes et les derniers résultats).
- **Sauvegarder et essayer une restauration** : `scripts/sauvegarder.sh` (jeu cohérent), `scripts/essai-restauration.sh`, `scripts/essai-restauration-chiffree.sh` (clé éphémère). Ces essais sortent en code 3 sur cette base : c'est attendu (voir ci-dessous).
- **États dégradés connus de la base locale, à ne pas « réparer »** : journal d'audit du cabinet Alpha fictif non intègre aux lignes 7603-7604 (D-038) ; un jeu de sauvegarde interrompu `comtaple-20261119-123716` (D-060) ; neuf sauvegardes à l'ancien format ; un dossier vide `~/Library/Application Support/Firefox` (D-059).
- **Données d'essai volumineuses ajoutées** : cabinet Bêta, 200 dossiers « Mesure … », 100 dossiers « Mesure portefeuille … » (ajoutés le 2026-11-20 par `scripts/mesure-portefeuille.mjs`, avec pièces et constats ; plus un dossier « … reprise immobilisations » de 5 000 immobilisations) et un dossier « Mesure restitution … » (603 Mo d'originaux, plusieurs archives de 576 Mo ; deux archives de 577 et 589 Mo de plus, du cabinet entier) ; cabinet Alpha, deux archives de restitution de 359 Mo ; nombreux cabinets et dossiers d'essai créés par les parcours. Le stockage local sauvegardé pèse environ 8 Go.
- **Reste local connu** : liste ci-dessus (« Reste réalisable sans intervention extérieure »). Ce qui exige une intervention extérieure : `acces-externes.md`, section « En bref ».
- **Disque de la machine Docker** : 50 Go depuis le 2026-11-20 (il en avait 30 et le stockage de test, ≈ 20 Go, l'avait saturé). Agrandir = `colima stop`, `colima start --disk <Go>`, puis `pnpm run services:up` (seuls certains conteneurs repartent seuls), puis `scripts/applis.sh demarrer`. Le stockage de test grossit à chaque campagne : surveiller l'espace.
- **Fonctions préparées mais désactivées par défaut** (aucune variable n'est définie dans le fichier d'environnement local) : traces OpenTelemetry (`OTEL_EXPORTER_OTLP_ENDPOINT`), notifications poussées (`PUSH_VAPID_*`), agrégation bancaire, IA. La procédure de fin de contrat n'a jamais été exécutée et ne fait que simuler sans `--appliquer`.
- **Troisième ensemble de lots du 2026-11-20** (D-083 à D-097) : traces conservées et essayées avec Grafana, destinataire lu, corrigé et réanalysé (D-084, D-091), isolation des relevés et FEC, cycle de vie des notifications poussées, preuve de connexion IA persistée, dégressif corrigé et NON ACTIVÉ (D-089, D-090, `docs/sources-officielles.md`), reprise des immobilisations par CSV (D-092), plafonds de l'API et mesure d'un portefeuille de 300 dossiers (D-093, D-094).
- **Seconde relecture du cahier des charges** (D-074 à D-081) : traces, contrôles en flux, analyse isolée, tiers et factures, fin de contrat, assistant de portefeuille, suggestions tirées des corrections, notifications poussées — tous publiés, CI verte.
- **IA** : aucune n'est connectée ; l'assistant répond « sans IA ». Ne jamais activer un jeton sans les vérifications de `packages/ia/docs/passerelle.md` § 7.
- **Migrations** : 0000 à 0046 (aucune migration 0047 : aucun index n'aurait corrigé le défaut de recherche mesuré, D-094 ; 0038 crée le registre des fins de contrat, vide : aucune fin de contrat n'a été exécutée) ; les tests de base les rejouent toutes sur une base neuve.
