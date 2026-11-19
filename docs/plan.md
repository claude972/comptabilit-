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

## Lot 2 — Révision avancée : moteur réalisé, application à brancher

- [x] Lecture CAMT.053, OFX, CSV ; rapprochements exacts et par règles ; 7 contrôles supplémentaires (moteur).
- [ ] Import bancaire dans l'API, le worker et l'interface.
- [ ] Écran de rapprochement, validation des rapprochements proposés.
- [ ] Fourniture de l'exercice précédent et des relevés aux contrôles `CLO-002` et `TRE-003`.
- [ ] Abonnements : forfaits, tranches, essai, quotas, virement, historique.
- [ ] Règles et paramètres par cabinet, approuvés et réversibles.
- [ ] Imports par lots, annulation contrôlée.
- [ ] Purge des téléversements abandonnés ; export complet de restitution.

## Lot 3 — Veille et assistant : non commencé

Dépend de la passerelle IA (jeton et vérifications contractuelles) pour l'assistant ; la collecte des sources officielles versionnées peut démarrer sans elle.

## Lot 4 — Missions et performance : non commencé

Les indicateurs calculés par le moteur (soldes intermédiaires de gestion, BFR, délais) ne dépendent d'aucun accès externe.

## Lot 5 — États et fiscalité : non commencé

À n'engager qu'après stabilisation de la collecte et des contrôles, et avec un expert-comptable pour valider les correspondances comptes → rubriques.

## Prochaines étapes proposées, par ordre de dépendance

1. Brancher le lot 2 du moteur dans l'application (imports bancaires, rapprochements).
2. Corriger les manques de l'API relevés par l'interface (membres d'un dossier, pagination, choix du cabinet).
3. Abonnements et quotas.
4. Supervision, images de conteneurs applicatives, description de l'infrastructure.
5. Lots 3 à 5.
