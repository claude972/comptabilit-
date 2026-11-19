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
- [ ] Restitution d'un cabinet entier ; dépôt d'une archive répartie entre dossiers ; test de charge sur plusieurs centaines de dossiers.
- [ ] Agrégation bancaire (prestataire à choisir) ; export vers l'outil de facturation de l'éditeur.

## Lot 3 — Veille et assistant : veille et recherche réalisées, assistant bloqué

- [x] Surveillance des sources, détection de changement, évolutions à qualifier par une personne.
- [x] Applicabilité par dossier, suivi par dossier.
- [x] Recherche textuelle autorisée.
- [ ] Accès à l'API officielle de Légifrance (le site refuse l'accès automatisé).
- [ ] Qualification réelle d'évolutions par une personne compétente.
- [ ] Assistant documenté (dépend de la passerelle IA).
- [ ] Recherche vectorielle.

## Lot 4 — Missions et performance : réalisé en local, à valider

- [x] Missions, lettres et avenants structurés, travaux, hors-périmètre, projet d'avenant, barème.
- [x] Registre des conseils.
- [x] Indicateurs financiers du dossier ; indicateurs d'activité du cabinet.
- [ ] Analyse automatique d'une lettre de mission existante (dépend de l'IA).
- [x] Rentabilité par mission (honoraires saisis, temps observés, coût horaire saisi).
- [x] Affectation explicite des travaux à une mission.
- [ ] Rapprochement avec la facturation réelle.
- [ ] Validation professionnelle des conventions d'indicateurs.

## Lot 5 — États et fiscalité : amorcé

- [x] Balance, projets de compte de résultat et de bilan.
- [x] Écritures d'inventaire proposées (saisie humaine), balance ajustée de travail, export.
- [ ] Validation professionnelle de la table de correspondance comptes → rubriques.
- [x] États projetés sur la balance ajustée.
- [ ] Génération assistée d'écritures d'inventaire ; annexe ; liasse.

## Chantier du 2026-11-19 (soir) : relecture complète du cahier des charges

Matrice exigence → implémentation → preuve → reste : `exigences.md`. Réalisé à cette occasion (décisions D-064 à D-072) :

- [x] Invitations et ouverture d'un cabinet ; export des éléments de facturation de l'éditeur.
- [x] Agrégation bancaire : port, contrat pivot, simulateur, écran d'état (aucun prestataire : « non connecté »).
- [x] Veille : taille et opérations identifiées.
- [x] Recette de tous les écrans par profil (bureau et émulation mobile) ; six écarts d'usage corrigés.
- [x] Paquet IA, assistant documenté et tâches IA branchés ; état réel « sans IA » ; chemin « modèle » contre simulateur.
- [x] Indexation des pièces en passages (vecteurs en attente d'un fournisseur d'embeddings).
- [x] Lot 5 : préparation de la liasse (2050 à 2053, 2033-A/B), projet d'annexe, propositions d'écritures d'inventaire.
- [x] Déploiement et exploitation préparés : OpenTofu, composition de production, royaume Keycloak de production, supervision, script de déploiement, guide d'exploitation.
- [x] Documents juridiques à l'état de projet (`docs/juridique/`).

Reste réalisable sans intervention extérieure, non fait (par ordre d'utilité) :

1. Persistance de la preuve de connexion de la passerelle IA et route de vérification (inutile tant qu'aucun jeton n'existe).
2. Amortissements autres que linéaires ; reprise du fichier des immobilisations depuis le logiciel comptable (aujourd'hui : saisie par le cabinet).
3. Assistant sur un portefeuille de plusieurs dossiers ; recherche multi-dossiers.
4. Tiers et factures (D-077) : extraction du destinataire pour apparier les ventes ; tolérances de montant ; règlements groupés non lettrés ; sort de l'ancienne table `factures`, jamais alimentée.
5. Entrepôt de traces et acheminement vers le collecteur en production (les traces sont émises, D-074).
6. Isolation par le noyau des analyseurs ; même isolement pour les relevés bancaires, les FEC et le mail (D-076) ; plafonds des écrans de l'API qui chargent encore les lignes en mémoire (D-075) ; dépôt d'une archive répartie entre dossiers ; notifications poussées.
7. Fin de contrat (D-078), avant toute activation : arrêter les durées et le délai de grâce, exercer la suppression d'objets sur un stockage d'essai distinct, mesurer sur un volume réaliste, définir la rotation des sauvegardes, traiter les comptes du fournisseur d'identité, concevoir la fin de vie du journal et des éléments conservés. Purge à l'échéance des durées : non écrite.

Le reste dépend d'une intervention extérieure : liste en tête de `acces-externes.md`.

## État de reprise (au 2026-11-19)

Pour reprendre le travail sans relire l'historique :

- **Code** : branche `main`, publiée sur le dépôt distant (accord de l'utilisateur du 2026-11-19, qui couvre les corrections de la CI). Intégration continue réussie, Firefox compris, au run 44605049111 sur le commit 42cd159 (D-063, D-073) ; suivre une exécution : API publique `actions/runs` et annotations du job (pas de jeton sur ce poste).
- **Démarrer** : `source ~/.comtaple-outils/env.sh`, `colima start` si Docker ne répond pas, `pnpm run services:up`, `pnpm run build`, `scripts/applis.sh demarrer` (API 4000, worker, web 3100). Le worker tourne avec un tas plafonné à 2 048 Mo.
- **Vérifier** : `pnpm run typecheck`, `pnpm run test`, puis les suites d'intégration (`pnpm --filter @comtaple/db|api|worker run test:integration`) et navigateur (`rapport-de-tests.md` donne les commandes et les derniers résultats).
- **Sauvegarder et essayer une restauration** : `scripts/sauvegarder.sh` (jeu cohérent), `scripts/essai-restauration.sh`, `scripts/essai-restauration-chiffree.sh` (clé éphémère). Ces essais sortent en code 3 sur cette base : c'est attendu (voir ci-dessous).
- **États dégradés connus de la base locale, à ne pas « réparer »** : journal d'audit du cabinet Alpha fictif non intègre aux lignes 7603-7604 (D-038) ; un jeu de sauvegarde interrompu `comtaple-20261119-123716` (D-060) ; neuf sauvegardes à l'ancien format ; un dossier vide `~/Library/Application Support/Firefox` (D-059).
- **Données d'essai volumineuses ajoutées** : cabinet Bêta, 200 dossiers « Mesure … » et un dossier « Mesure restitution … » (603 Mo d'originaux, plusieurs archives de 576 Mo) ; cabinet Alpha, deux archives de restitution de 359 Mo ; nombreux cabinets et dossiers d'essai créés par les parcours. Le stockage local sauvegardé pèse environ 8 Go.
- **Reste local connu** : liste ci-dessus (« Reste réalisable sans intervention extérieure »). Ce qui exige une intervention extérieure : `acces-externes.md`, section « En bref ».
- **IA** : aucune n'est connectée ; l'assistant répond « sans IA ». Ne jamais activer un jeton sans les vérifications de `packages/ia/docs/passerelle.md` § 7.
- **Migrations** : 0000 à 0038 (0038 crée le registre des fins de contrat, vide : aucune fin de contrat n'a été exécutée) ; les tests de base les rejouent toutes sur une base neuve.
