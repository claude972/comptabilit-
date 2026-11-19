# Matrice de couverture — état réel

Document de référence sur ce qui fonctionne. Mis à jour le 2026-11-19 (seconde passe).

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
| Cabinets, appartenances, habilitations par dossier | Testé | La création d'un cabinet et de ses comptes reste un provisionnement de l'éditeur (pas d'invitation) |
| Isolation entre cabinets et entre dossiers (RLS forcé) | Testé | Voir la limite assumée de la décision D-007 ; pas de test d'intrusion indépendant |
| Rôle « support » à accès temporaire | Partiel | Expiration de l'appartenance prise en compte ; aucun parcours d'attribution |
| Moteur décimal, montants en chaînes dans les API | Testé | — |
| Stockage documentaire par empreinte | Testé | S3 local de développement ; Object Lock non testé |
| Journal d'audit en ajout seul, chaîné, consultable | Testé | Pas d'archivage externe protégé |
| Files de traitements différés, reprise | Testé | Rattrapage automatique pour les pièces seulement |
| Sauvegarde et restauration | Partiel | Base : essai réussi en local. Stockage objet, Keycloak et restauration à un instant donné : non couverts |
| Intégration continue | Partiel | Fichier écrit, jamais exécuté sur GitHub |
| Supervision (OpenTelemetry, Prometheus, Grafana) | Partiel | Métriques Prometheus exposées par l'API et le worker ; pas de collecte déployée ni de traces |
| Infrastructure cible (OpenTofu, OVHcloud) | Partiel | Ébauche validée syntaxiquement (base managée, buckets) ; jamais appliquée |

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
| Contrôles déterministes (19 au catalogue) | En attente de validation | Tous exécutés à chaque import ; `TRE-003` et `CLO-002` sont réalisés quand des relevés et l'exercice précédent existent, sinon « non réalisés » avec leur motif |
| Revue des constats : affectation, commentaires, décisions motivées | Testé | — |
| Détection des travaux à revoir après modification des données | Testé | — |
| Dossier de révision : PDF, données structurées, inventaire | Testé | Toujours « projet » ; pas de validation d'ensemble du dossier |

### Messagerie — état du branchement

| Élément | État | Limites |
|---|---|---|
| Bibliothèque `@comtaple/mail` | En attente de connexion | 57 tests contre simulateur |
| Routes d'API (connexion, configuration, suivi, déconnexion, notifications), synchronisation dans le worker, verrou par connexion, rattrapage périodique | En attente de connexion | 20 parcours de bout en bout contre simulateur |
| File des pièces à qualifier et affectation à un dossier | En attente de connexion | Pas de rejet d'une pièce sans rapport avec un dossier |
| Signalement des factures disponibles derrière un lien | En attente de connexion | — |
| Écrans de gestion des connexions mail et page de retour OAuth | En attente de connexion | Vérifiés contre simulateur ; sur la pile réelle, seul l'état « non connecté / connecteur non configuré » est vérifié |
| Boîte partagée Microsoft | Partiel | Couverte par les tests de la bibliothèque, pas de bout en bout |
| Connexion à une vraie boîte Gmail ou Microsoft 365 | Jamais réalisée | Aucune application OAuth n'existe ; le statut affiché reste « non connecté » |

## Lot 2 — Révision avancée

| Fonctionnalité | État | Limites |
|---|---|---|
| Import de relevés camt.053, OFX, CSV (sans prestataire bancaire) | Testé | Jeux synthétiques ; schémas ISO 20022 des versions .03 à .08 non consultés ; relevés de carte OFX, CFONB 120 et MT940 non lus ; aucun relevé réel |
| Idempotence des mouvements, cadrage des soldes | Testé | Deux exports chevauchants sans référence bancaire peuvent créer un doublon (décision D-020) |
| CSV ambigu : abstention puis profil confirmé par un humain | Testé | Pas d'aperçu du fichier à l'écran |
| Rapprochement banque ↔ comptabilité (exact, groupé, partiel, compensation, tolérance) | En attente de validation | Propositions seulement ; appariements par somme parfois fortuits sur données dégradées (signalés) ; aucune écriture ni lettrage produit |
| Validation et rejet des rapprochements, obsolescence quand les données changent | Testé | — |
| Suggestions IA de rapprochement | Non implémenté | La vérification arithmétique d'une suggestion existe dans le moteur ; aucune IA |
| Contrôle de rapprochement bancaire `TRE-003` alimenté par les relevés | Testé | S'abstient si plusieurs comptes bancaires ne peuvent pas être associés aux comptes 512 (pas d'écran de correspondance) |
| Cohérence entre exercices `CLO-002` alimentée par l'exercice précédent | Testé | Exercé de bout en bout avec deux exercices importés (fichiers synthétiques indépendants : le contrôle relève l'écart de reprise) ; pas de jeu où les à-nouveaux concordent |
| Contrôles immobilisations, social, césure, TVA déductible | En attente de validation | — |
| Agrégation bancaire par prestataire | Non implémenté | Aucun prestataire choisi |
| Abonnements : forfait, tranches, essai, quotas, changement d'offre, résiliation, virement, historique | Testé | Grille de démonstration fictive ; opérations de l'éditeur par module de provisionnement, sans outil d'exploitation ; TVA et facturation légale hors périmètre ; aucun export vers un outil de facturation |
| Service fermé hors abonnement (dépôts refusés, consultation conservée) | Testé | Les quotas sont affichés mais ne bloquent pas la collecte (décision D-024) |
| Règles et paramètres propres au cabinet, avec mesure d'impact et approbation | Testé | Mesure d'impact synchrone, sur un seul contrôle et un exercice |
| Administration : dossiers, exercices, habilitations, membres (rôle, désactivation) | Testé | Pas d'invitation ni de création de compte : la création d'un utilisateur reste une opération de l'éditeur dans Keycloak |
| Export de restitution d'un dossier | Testé | Par dossier seulement ; données structurées assemblées en mémoire |
| Purge des téléversements abandonnés | Partiel | Écrite dans le rattrapage du worker ; non exercée par un test (délai de 7 jours) |
| Métriques techniques (Prometheus) | Partiel | Points de collecte vérifiés ; ni Prometheus ni Grafana déployés ; pas de traces OpenTelemetry |
| Images de conteneurs | Partiel | API, worker et web construites et démarrées en local (lecture seule, sans privilèges) ; non optimisées, jamais poussées vers un registre, aucun parcours complet à travers les trois conteneurs |
| Description d'infrastructure OpenTofu | Partiel | Base managée et buckets seulement ; validée syntaxiquement, jamais planifiée ni appliquée |

## Lot 3 — Veille et assistant

| Fonctionnalité | État | Limites |
|---|---|---|
| Surveillance planifiée de pages officielles, détection de changement | Testé | Dans l'environnement réel, BOFiP est lisible ; Légifrance refuse l'accès automatisé (403) : ces sources sont affichées indisponibles. Une surveillance fiable de Légifrance passe par son API officielle (accès à demander) |
| Évolutions qualifiées par une personne (résumé, dates, conditions, critères) | En attente de validation | Opération de l'éditeur par provisionnement ; aucune évolution réelle n'a été qualifiée (seulement des évolutions d'essai fictives, retirées) |
| Applicabilité par dossier, expliquée ; « à confirmer » si une caractéristique manque | Testé | Critères simples (territoire, régime, forme, NAF, référentiel, exercices) ; pas de critère de taille ni d'opération |
| Suivi d'une évolution par dossier | Testé | — |
| Recherche textuelle autorisée (pièces, écritures, constats) | Testé | Plein texte français ; pas de recherche vectorielle (pgvector inutilisé) ; portefeuille multi-dossiers non couvert |
| Assistant documenté | Non implémenté | Dépend de la passerelle IA, non connectée |

## Lot 4 — Missions et performance

| Fonctionnalité | État | Limites |
|---|---|---|
| Missions, lettres et avenants structurés (projet → validée) | Testé | Contenu SAISI par le cabinet : aucune analyse automatique d'une lettre existante |
| Rattachement des travaux à la lettre applicable à leur date, hors-périmètre signalé | En attente de validation | Référentiel de prestations interne ; signalement, pas conclusion contractuelle |
| Projet d'avenant avec estimation de temps sur base nommée | Testé | Honoraires de l'avenant à compléter par le cabinet ; explication par gabarit, sans IA |
| Registre des conseils : validation, autorisation d'envoi, faits constatés distincts | Testé | Le logiciel n'envoie rien ; les faits sont saisis avec justificatif |
| Indicateurs financiers du dossier (25, avec formule et traçabilité) | En attente de validation | Avant écritures d'inventaire ; SIG hors modèle réglementaire depuis la réforme du PCG (conventions internes) ; délais seulement avec un taux de TVA fourni |
| Indicateurs d'activité du cabinet et du logiciel | Testé | Par cabinet et par dossier, jamais par personne ; ne mesurent pas la qualité des extractions |
| Rentabilité par mission | Non implémenté | Temps observés disponibles ; pas de rapprochement avec les honoraires |

## Lot 5 — États et fiscalité

| Fonctionnalité | État | Limites |
|---|---|---|
| Balance générale | Testé | — |
| Projets de compte de résultat et de bilan | En attente de validation | Table de correspondance lue des intitulés du PCG, non validée par un professionnel ; exercices ouverts avant 2025 non couverts ; comptes ambigus laissés « non affectés » |
| Écritures d'inventaire proposées, approbation par un tiers, balance ajustée de travail, export CSV | Testé | Saisie humaine uniquement : aucune écriture n'est générée automatiquement ; l'intégration dans le logiciel comptable n'est pas faite par ce logiciel ; les états projetés ne tiennent pas compte de la balance ajustée |
| Annexe, liasse fiscale | Non implémenté | — |
| Télétransmission | Non implémenté, et non autorisée par conception sans périmètre et autorisation spécifiques | — |

## Écrans

Tous les domaines ci-dessus ont leurs écrans : collecte (téléphone et ordinateur), revue de pièce, comptabilité, révision, banque et rapprochements, analyse (balance, projets d'états, indicateurs), inventaire, missions et conseils, veille, recherche, restitution, messagerie, règles du cabinet, administration (dossiers, habilitations, membres, audit, abonnement, indicateurs du cabinet). Détail de ce qui est vérifié sur la pile réelle et de ce qui ne l'est que contre un simulateur : `rapport-de-tests.md`.

Non faits côté interface : jonction de pièces à un conseil, une écriture d'inventaire ou une lettre ; aperçu d'un CSV bancaire ; pagination de certaines listes longues ; notifications ; aucune vérification sur appareil réel, sur Safari ou Firefox, ni au lecteur d'écran.

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
