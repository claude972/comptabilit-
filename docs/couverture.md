# Matrice de couverture — état réel

Document de référence sur ce qui fonctionne. Mis à jour le 2026-11-19.

## Légende des états

| État | Signification |
|---|---|
| **Testé** | Implémenté et vérifié par des tests automatisés exécutés (voir `rapport-de-tests.md`) |
| **En attente de connexion** | Implémenté, vérifié seulement contre un simulateur ; l'intégration réelle n'a jamais été exercée |
| **En attente de validation** | Implémenté et testé techniquement ; exige une validation métier ou juridique avant usage |
| **Partiel** | Une partie seulement fonctionne ; la colonne « Limites » dit laquelle |
| **Non implémenté** | Rien d'utilisable |

« Testé » signifie testé sur des jeux SYNTHÉTIQUES et en environnement local. Aucune donnée réelle de cabinet, aucun appareil réel, aucun service externe réel n'a été utilisé.

## Lot 0 — Socle

| Fonctionnalité | État | Limites |
|---|---|---|
| Monorepo, versions figées, environnement local reproductible | Testé | — |
| Identités OIDC (Keycloak), session côté serveur, PKCE | Testé | Royaume de développement ; MFA et SSO non configurés |
| Cabinets, appartenances, habilitations par dossier | Testé | Pas d'écran d'administration : provisionnement par script d'amorçage. Invitation d'utilisateurs non implémentée |
| Isolation entre cabinets et entre dossiers (RLS forcé) | Testé | Voir la limite assumée de la décision D-007 ; pas de test d'intrusion indépendant |
| Rôle « support » à accès temporaire | Partiel | Expiration de l'appartenance prise en compte ; aucun parcours d'attribution |
| Moteur décimal, montants en chaînes dans les API | Testé | — |
| Stockage documentaire par empreinte | Testé | S3 local de développement ; Object Lock non testé |
| Journal d'audit en ajout seul, chaîné | Testé | Pas d'archivage externe protégé |
| Files de traitements différés, reprise | Testé | Rattrapage automatique pour les pièces seulement |
| Sauvegarde et restauration | Partiel | Base : essai réussi en local. Stockage objet, Keycloak et restauration à un instant donné : non couverts |
| Intégration continue | Partiel | Fichier écrit, jamais exécuté sur GitHub |
| Supervision (OpenTelemetry, Prometheus, Grafana) | Non implémenté | — |
| Infrastructure cible (OpenTofu, OVHcloud) | Non implémenté | — |

## Lot 1 — Collecte et première révision

| Fonctionnalité | État | Limites |
|---|---|---|
| PWA installable, écran hors ligne | Testé | Émulation Chromium uniquement ; installation réelle, iOS Safari et Android réels non essayés |
| Dépôt depuis le téléphone : photo, fichiers, plusieurs pages, rotation, recadrage, indicateur de lisibilité | Testé | Contre simulateur d'API pour le détail ; le parcours photo → « Reçu » → OCR → champs est vérifié sur la pile réelle en émulation mobile |
| Téléversement reprenable, « Reçu » seulement après confirmation serveur | Testé | — |
| Reprise après coupure, dépôts en attente sur l'appareil, purge | Testé | Émulation ; aucune exécution en arrière-plan (voulu) ; purge à 7 jours testée unitairement seulement |
| Suivi des statuts, champs extraits, signalement d'erreur, demandes de complément | Testé | — |
| Notifications | Non implémenté | — |
| Dépôt depuis l'ordinateur | Testé | Pas de reprise après fermeture de la page |
| Détection du type réel, limites de taille, antivirus, quarantaine | Testé | Traitements dans le processus du worker, sans bac à sable dédié |
| Doublon binaire entre canaux | Testé | — |
| Nouvelle version d'un même document | Non implémenté | Colonnes présentes ; aucun parcours |
| Extraction de factures : PDF à couche texte | En attente de validation | Règles prudentes qui s'abstiennent ; qualité jamais mesurée sur des pièces réelles |
| Extraction de factures : Factur-X, CII, UBL | En attente de validation | Chemins recoupés avec des exemples publics ; aucune facture Factur-X réelle testée ; spécification officielle non consultée |
| OCR local (PaddleOCR) | En attente de validation | Environ 4 s par page en local ; pages pivotées sans EXIF mal lues ; aucune photo réelle testée |
| Proposition IA de type de pièce et de dossier | Non implémenté | Passerelle IA non connectée |
| Revue d'une pièce : correction versionnée, validation par un réviseur | Testé | — |
| Connecteur Gmail | En attente de connexion | Bibliothèque testée contre simulateur ; branchement dans l'application : voir « Messagerie » ci-dessous |
| Connecteur Microsoft 365 | En attente de connexion | Idem ; boîtes partagées sans notifications (delta périodique) |
| Import FEC et données de travail, en flux, idempotent, versionné | Testé | Variantes testées listées dans `packages/core/docs/fec-compatibilite.md` ; aucun FEC réel d'un logiciel du marché |
| Rapport FEC : lisible / conforme / suffisant, ligne par ligne | En attente de validation | Contrôles de conformité non implémentés listés dans le rapport lui-même |
| Imports par lots de plusieurs centaines de dossiers | Non implémenté | Import dossier par dossier |
| Annulation contrôlée d'un import | Non implémenté | — |
| Contrôles déterministes (19 au catalogue) | En attente de validation | Tous exécutés à chaque import ; `TRE-003` et `CLO-002` restent « non réalisés » faute de relevés et d'exercice précédent fournis |
| Revue des constats : affectation, commentaires, décisions motivées | Testé | L'affectation à un tiers n'est pas proposée par l'interface |
| Détection des travaux à revoir après modification des données | Testé | — |
| Dossier de révision : PDF, données structurées, inventaire | Testé | Toujours « projet » ; pas de validation d'ensemble du dossier |

### Messagerie — état du branchement

| Élément | État | Limites |
|---|---|---|
| Bibliothèque `@comtaple/mail` | En attente de connexion | 57 tests contre simulateur |
| Routes d'API (connexion, configuration, suivi, déconnexion, notifications), synchronisation dans le worker, verrou par connexion, rattrapage périodique | En attente de connexion | 20 parcours de bout en bout contre simulateur |
| File des pièces à qualifier et affectation à un dossier | En attente de connexion | API seulement, pas d'écran |
| Signalement des factures disponibles derrière un lien | En attente de connexion | API seulement |
| Écrans de gestion des connexions mail et page de retour OAuth | Non implémenté | Bloquant pour une connexion réelle |
| Boîte partagée Microsoft | Partiel | Couverte par les tests de la bibliothèque, pas de bout en bout |
| Connexion à une vraie boîte Gmail ou Microsoft 365 | Jamais réalisée | Aucune application OAuth n'existe ; le statut affiché reste « non connecté » |

## Lot 2 — Révision avancée

| Fonctionnalité | État | Limites |
|---|---|---|
| Lecture de relevés CAMT.053, OFX, CSV | Partiel | Moteur testé (jeux synthétiques) ; NON branché dans l'API ni l'interface ; schémas ISO 20022 non consultés |
| Rapprochements exacts et par règles (groupés, partiels, compensations, tolérances) | Partiel | Idem : moteur seul. Appariements par somme parfois fortuits sur données dégradées (signalé par le moteur) |
| Suggestions IA de rapprochement vérifiées par le moteur | Partiel | Vérification arithmétique prête ; aucune suggestion IA |
| Contrôles immobilisations, social, césure, cohérence entre exercices, TVA déductible | En attente de validation | Dans le catalogue ; `CLO-002` et `TRE-003` restent « non réalisés » tant que l'exercice précédent et les relevés ne sont pas fournis par l'application |
| Agrégation bancaire par prestataire | Non implémenté | Aucun prestataire choisi |
| Abonnements, quotas, facturation | Non implémenté | Tables modélisées uniquement |
| Règles et paramètres propres au cabinet | Non implémenté | Table modélisée uniquement |

## Lot 3 — Veille et assistant

| Fonctionnalité | État |
|---|---|
| Surveillance des sources officielles, veille par dossier | Non implémenté |
| Recherche documentaire (texte et vecteurs) | Non implémenté (extension pgvector installée, inutilisée) |
| Assistant documenté | Non implémenté |

## Lot 4 — Missions et performance

| Fonctionnalité | État |
|---|---|
| Lettres de mission, avenants, travaux hors périmètre | Non implémenté (tables modélisées) |
| Registre des conseils | Non implémenté |
| Indicateurs dossier, cabinet, logiciel | Non implémenté |

## Lot 5 — États et fiscalité

| Fonctionnalité | État |
|---|---|
| Écritures d'inventaire, balance ajustée, projets de bilan et de compte de résultat | Non implémenté |
| Annexe, liasse fiscale | Non implémenté |
| Télétransmission | Non implémenté, et non autorisée par conception sans périmètre et autorisation spécifiques |

## Couverture par type de dossier

| Type de dossier | Collecte de pièces | Import de données | Contrôles |
|---|---|---|---|
| TPE/PME commerciale, PCG, IS, euros, métropole | Pris en charge | Pris en charge | Partiellement pris en charge (catalogue initial, en attente de validation) |
| Même profil, territoire d'outre-mer | Pris en charge | Pris en charge | Non pris en charge : aucune règle propre au territoire ; les contrôles fiscaux ne doivent pas être lus comme applicables |
| BNC, BA, associations | Pris en charge | Pris en charge si le fichier est lisible | Non pris en charge |
| Consolidation, régimes sectoriels | Pris en charge | Pris en charge si le fichier est lisible | Non pris en charge |
| Comptabilité en devise autre que l'euro | Pris en charge | Lecture des champs de devise sans traitement | Non pris en charge |

Le territoire fiscal est une donnée explicite du dossier. Hors métropole, ou tant qu'il est « à confirmer », les contrôles à fondement fiscal (`TVA-001`, `TVA-002`, `IMM-002`) ne sont pas réalisés et l'indiquent avec leur motif (testé). Les autres contrôles reposent sur le PCG ou le Code de commerce ; leur pertinence par territoire reste à valider par un professionnel.

## Parcours de bout en bout exigés par le cahier des charges

| # | Parcours | État |
|---|---|---|
| 1 | Photo sur téléphone → réception → extraction → rattachement → revue → export | Testé (API + navigateur en émulation mobile, pile réelle). L'export porte sur le dossier de révision |
| 2 | Réception mail → pièce → doublon → traitement | Testé contre simulateur de messagerie uniquement (API, worker, base et stockage réels) |
| 3 | Import FEC → contrôles → constats → dossier PDF | Testé |
| 4 | Nouvelle version d'un fichier → validations à revoir | Testé (données comptables). Non couvert pour les pièces |
| 5 | Coupure réseau pendant un dépôt | Testé (API réelle ; interface en émulation contre simulateur) |
| 6 | Notification mail répétée ou manquée | Testé contre simulateur de messagerie uniquement |
| 7 | Jeton mail révoqué | Testé contre simulateur de messagerie uniquement |
| 8 | Accès à un autre cabinet ou dossier | Testé (base, API, interface) |
| 9 | Pièce contenant des instructions malveillantes | Testé — sachant qu'aucune IA ne lit les pièces à ce jour |
| 10 | Restauration après incident | Partiel : base restaurée et vérifiée ; voir `deploiement.md` |

Environnements réellement utilisés : Chromium (ordinateur et émulation Pixel 7) sur macOS. Aucun appareil réel, ni Safari, ni Firefox.
