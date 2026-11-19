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

## Prochaines étapes proposées, par ordre de dépendance

1. Faire valider par un expert-comptable : catalogue des contrôles, table de correspondance des états, conventions d'indicateurs, convention de rentabilité.
2. Obtenir les accès externes (`acces-externes.md`) : OAuth Google et Microsoft, jeton OVHcloud, API Légifrance, corpus réel autorisé, authentification GitHub pour alimenter le dépôt distant.
3. Réalisé le 2026-11-19 : restitution d'un cabinet entier (D-043), pagination des rapprochements et des règles (D-044), essais de restauration isolés (D-045), format d'ancre du journal (D-046), restitution d'un dossier en flux (D-047), correspondance comptes 512 / comptes bancaires (D-048), notifications internes (D-049), outil de chiffrement des sauvegardes (D-050), CI rendue auto-explicative (D-051).
   Réalisé ensuite, le même jour : même traitement d'un original non conforme dans les deux restitutions (D-052), suites navigateur ajoutées à la CI (D-053, non exécutées sur GitHub), notifications d'import et de constat affecté et préférences (D-054), jeu chiffré complet et restauration depuis des copies chiffrées avec clé éphémère (D-055), mesure de mémoire de la restitution sur un gros dossier.
   Réalisé ensuite : export Keycloak dans le jeu chiffré et restauration isolée prouvée avec une clé éphémère (D-057) ; regroupement des notifications, archivage réversible, politique de rétention testée sur données temporaires seulement (D-058) ; cause du blocage de Firefox établie (D-059).
   Réalisé ensuite : jeu de sauvegarde cohérent base + Keycloak (D-060), plafond de tas du worker et limite de volume par traitement (D-061), essai de restauration du stockage par tranches (D-062), revue des écarts ouverts (un défaut corrigé sur la rentabilité, deux écarts déjà corrigés reclassés).
   Plus aucune lacune locale n'est en attente dans ce plan. Limites connues et assumées, non planifiées : contrôles en flux au-delà de 500 000 lignes par exercice ; horodatages de formes différentes selon les routes ; progression d'import sans total ; choix de la lettre de référence d'un avenant ; lot 5 (annexe, liasse) et assistant, qui dépendent d'une validation ou d'un accès. Le reste dépend d'une intervention extérieure : liste en tête de `acces-externes.md`.
   Bloqué par l'extérieur : voir « En bref » dans `acces-externes.md` (journal de la CI, push, Firefox, clé des sauvegardes, ancres du journal, accès de services, corpus réel, validations, appareils réels).
4. Lacunes dépendant d'une validation ou d'un accès : génération assistée d'écritures d'inventaire, annexe et liasse (professionnel) ; assistant et recherche vectorielle (passerelle IA).
5. Description complète de l'infrastructure, supervision déployée (jeton OVHcloud).
6. Essais sur appareils réels, sur Safari et sur Firefox (non lançable sur le poste actuel), et évaluation de l'extraction sur pièces réelles.

## État de reprise (au 2026-11-19)

Pour reprendre le travail sans relire l'historique :

- **Code** : branche `main`, publiée sur le dépôt distant (accord de l'utilisateur du 2026-11-19, qui couvre les corrections de la CI). Intégration continue réussie au run 44560095560 (D-063) ; suivre une exécution : API publique `actions/runs` et annotations du job (pas de jeton sur ce poste).
- **Démarrer** : `source ~/.comtaple-outils/env.sh`, `colima start` si Docker ne répond pas, `pnpm run services:up`, `pnpm run build`, `scripts/applis.sh demarrer` (API 4000, worker, web 3100). Le worker tourne avec un tas plafonné à 2 048 Mo.
- **Vérifier** : `pnpm run typecheck`, `pnpm run test`, puis les suites d'intégration (`pnpm --filter @comtaple/db|api|worker run test:integration`) et navigateur (`rapport-de-tests.md` donne les commandes et les derniers résultats).
- **Sauvegarder et essayer une restauration** : `scripts/sauvegarder.sh` (jeu cohérent), `scripts/essai-restauration.sh`, `scripts/essai-restauration-chiffree.sh` (clé éphémère). Ces essais sortent en code 3 sur cette base : c'est attendu (voir ci-dessous).
- **États dégradés connus de la base locale, à ne pas « réparer »** : journal d'audit du cabinet Alpha fictif non intègre aux lignes 7603-7604 (D-038) ; un jeu de sauvegarde interrompu `comtaple-20261119-123716` (D-060) ; neuf sauvegardes à l'ancien format ; un dossier vide `~/Library/Application Support/Firefox` (D-059).
- **Données d'essai volumineuses ajoutées** : cabinet Bêta, 200 dossiers « Mesure … » et un dossier « Mesure restitution … » (603 Mo d'originaux, plusieurs archives de 576 Mo) ; cabinet Alpha, deux archives de restitution de 359 Mo ; nombreux cabinets et dossiers d'essai créés par les parcours. Le stockage local sauvegardé pèse environ 8 Go.
- **Rien n'est en attente côté local.** Ce qui reste exige une intervention extérieure : `acces-externes.md`, section « En bref ».
