# Matrice de couverture — état réel

Document de référence sur ce qui fonctionne. Mis à jour le 2026-11-19 (troisième passe).

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
| Rôle « support » à accès temporaire | Testé | Ouvert par l'éditeur (ligne de commande), 72 h au plus, lecture seule, chaque consultation tracée ; le compte du support doit exister dans le fournisseur d'identité |
| Moteur décimal, montants en chaînes dans les API | Testé | — |
| Stockage documentaire par empreinte | Testé | S3 local de développement ; Object Lock non testé |
| Journal d'audit en ajout seul, chaîné, consultable | Testé sur base neuve isolée | Défaut de chaînage sous écritures simultanées trouvé et corrigé le 2026-11-19 (D-038). La base locale fictive garde une irrégularité d'ordre historique : la vérification stricte, seule référence, y échoue et c'est affiché. Lecture réservée aux gestionnaires dans la base. Pas d'ancrage ni d'archivage externe protégé |
| Files de traitements différés, reprise | Testé | Rattrapage automatique pour les pièces seulement |
| Sauvegarde et restauration | Testé en local | Base (PostgreSQL d'essai séparé), stockage objet (instance isolée, tous les objets référencés relus) et Keycloak (instance isolée, export sans arrêt du service) : essais réalisés, avec contrôle qu'aucun service local n'a redémarré. Chiffrement : jeu chiffré complet et restauration depuis des copies chiffrées essayés avec une clé éphémère, mais non activé faute de décision sur la garde de la clé privée (D-050, D-055). Restauration à un instant donné, conservation hors du poste, mécanismes de l'hébergeur : non couverts. Sur la base locale, l'essai signale le journal d'audit non intègre (D-038) |
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
| Notifications | Testé | Internes à l'application uniquement : aucun courriel, SMS ni notification poussée. Complément demandé sur une pièce et réponse, règles à décider et décidées, archives de restitution, imports terminés ou en échec, constats affectés ; préférences par famille ; regroupement, archivage réversible ; rétention définie, appliquée sur données de test seulement (D-049, D-054, D-058) |
| Dépôt depuis l'ordinateur | Testé | Pas de reprise après fermeture de la page |
| Détection du type réel, limites de taille, antivirus, quarantaine | Testé | Traitements dans le processus du worker, sans bac à sable dédié |
| Doublon binaire entre canaux | Testé | — |
| Nouvelle version d'une pièce : original conservé, validation explicitement invalidée | Testé | Les références à l'ancienne version (pièce jointe d'un conseil ou d'une écriture) ne sont pas basculées vers la nouvelle |
| Extraction de factures : PDF à couche texte | En attente de validation | Règles prudentes qui s'abstiennent ; qualité jamais mesurée sur des pièces réelles |
| Extraction de factures : Factur-X, CII, UBL | En attente de validation | Chemins recoupés avec des exemples publics ; aucune facture Factur-X réelle testée ; spécification officielle non consultée |
| OCR local (PaddleOCR) | En attente de validation | Environ 4 s par page en local ; pages pivotées sans EXIF mal lues ; aucune photo réelle testée |
| Proposition IA de type de pièce et de dossier | Non implémenté | Passerelle IA non connectée |
| Revue d'une pièce : correction versionnée, validation par un réviseur | Testé | — |
| Connecteur Gmail | En attente de connexion | Bibliothèque testée contre simulateur ; branchement dans l'application : voir « Messagerie » ci-dessous |
| Connecteur Microsoft 365 | En attente de connexion | Idem ; boîtes partagées sans notifications (delta périodique) |
| Import FEC et données de travail, en flux, idempotent, versionné | Testé | Variantes testées listées dans `packages/core/docs/fec-compatibilite.md` ; aucun FEC réel d'un logiciel du marché |
| Rapport FEC : lisible / conforme / suffisant, ligne par ligne | En attente de validation | Contrôles de conformité non implémentés listés dans le rapport lui-même |
| Campagnes d'import sur plusieurs dossiers : isolation, suivi et rapport par dossier, reprise des échecs | Testé | Mesuré en local sur 200 dossiers avec de petits fichiers (192 réussis, 8 échecs attendus isolés) ; non mesuré avec de gros fichiers ni plusieurs cabinets simultanés ; dépôt fichier par fichier, pas d'archive répartie automatiquement |
| Annulation réversible d'un import (comptable ou bancaire), rétablissement, reprise, interruption d'un import en cours | Testé | Interruption exercée sur un fichier de 290 000 lignes ; un import arrêté brutalement (processus tué) reste « en cours » et se traite à la main |
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
| CSV ambigu : abstention, aperçu du fichier, profil confirmé par un humain | Testé | — |
| Rapprochement banque ↔ comptabilité (exact, groupé, partiel, compensation, tolérance) | En attente de validation | Propositions seulement ; appariements par somme parfois fortuits sur données dégradées (signalés) ; aucune écriture ni lettrage produit |
| Validation et rejet des rapprochements, obsolescence quand les données changent | Testé | — |
| Suggestions IA de rapprochement | Non implémenté | La vérification arithmétique d'une suggestion existe dans le moteur ; aucune IA |
| Contrôle de rapprochement bancaire `TRE-003` alimenté par les relevés | Testé | S'abstient si plusieurs comptes bancaires ne peuvent pas être associés aux comptes 512 (pas d'écran de correspondance) |
| Cohérence entre exercices `CLO-002` alimentée par l'exercice précédent | Testé | Exercé de bout en bout avec deux exercices importés (fichiers synthétiques indépendants : le contrôle relève l'écart de reprise) ; pas de jeu où les à-nouveaux concordent |
| Contrôles immobilisations, social, césure, TVA déductible | En attente de validation | — |
| Agrégation bancaire par prestataire | Non implémenté | Aucun prestataire choisi |
| Abonnements : forfait, tranches, essai, quotas, changement d'offre, résiliation, virement, historique | Testé | Grille de démonstration fictive ; opérations de l'éditeur par module de provisionnement, sans outil d'exploitation ; TVA et facturation légale hors périmètre ; aucun export vers un outil de facturation |
| Service fermé hors abonnement (dépôts refusés, consultation conservée) | Testé | Les quotas sont affichés mais ne bloquent pas la collecte (décision D-024) |
| Règles et paramètres propres au cabinet, avec mesure d'impact et approbation | Testé | Mesure d'impact synchrone, sur un seul contrôle et un exercice ; sert aussi à déclarer la correspondance comptes 512 ↔ comptes bancaires de `TRE-003`, sans écran dédié |
| Administration : dossiers, exercices, habilitations, membres (rôle, désactivation) | Testé | Pas d'invitation ni de création de compte : la création d'un utilisateur reste une opération de l'éditeur dans Keycloak |
| Export de restitution d'un dossier | Testé | Construit en flux (D-047) ; un original non conforme n'est pas restitué, comme pour le cabinet (D-052) ; mémoire mesurée sur un gros dossier synthétique (rapport de tests) |
| Correspondance comptes 512 / comptes bancaires | Testé | Proposition soumise au circuit des règles ; IBAN masqué ; par dossier seulement (D-048) |
| Restitution d'un cabinet entier | Testé | Périmètre limité aux dossiers où le demandeur a le niveau « validation » (les autres sont listés, l'archive est dite incomplète) ; archive en flux ; manifeste vérifiable hors application ; téléchargement réservé au demandeur. Ni chiffrée ni signée. Mesurée en local sur 235 dossiers (D-043) |
| Pagination des rapprochements et des règles du cabinet | Testé | Par décalage ; ancienne forme des règles conservée sans paramètre (D-044) |
| Ancres du journal d'audit | En attente de connexion | Format, export et vérification hors base testés ; aucun dépôt chez un tiers indépendant, donc aucun ancrage effectif (D-046) |
| Purge des téléversements abandonnés ; rattrapage des traitements en attente | Testé | Purge exercée sur le stockage réel ; rattrapage exercé pour une restitution, par construction identique pour les autres natures |
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
| Missions, lettres et avenants structurés (projet → validée), lettre signée jointe | Testé | Contenu SAISI par le cabinet : aucune analyse automatique d'une lettre existante |
| Rattachement des travaux à la lettre applicable à leur date, hors-périmètre signalé | En attente de validation | Référentiel de prestations interne ; signalement, pas conclusion contractuelle |
| Projet d'avenant avec estimation de temps sur base nommée | Testé | Honoraires de l'avenant à compléter par le cabinet ; explication par gabarit, sans IA |
| Registre des conseils : validation, autorisation d'envoi, faits constatés distincts, pièces jointes | Testé | Le logiciel n'envoie rien ; les faits sont saisis avec justificatif |
| Indicateurs financiers du dossier (25, avec formule et traçabilité) | En attente de validation | Avant écritures d'inventaire ; SIG hors modèle réglementaire depuis la réforme du PCG (conventions internes) ; délais seulement avec un taux de TVA fourni |
| Indicateurs d'activité du cabinet et du logiciel | Testé | Par cabinet et par dossier, jamais par personne ; ne mesurent pas la qualité des extractions |
| Rentabilité par mission (honoraires saisis, temps observés, marge si un coût horaire est saisi) | En attente de validation | Prorata des forfaits sur 365 jours (convention interne) ; affectation des travaux à une mission explicite et facultative (les non affectés sont comptés dans chaque mission du dossier, et signalés) ; aucune facturation réelle rapprochée |

## Lot 5 — États et fiscalité

| Fonctionnalité | État | Limites |
|---|---|---|
| Balance générale | Testé | — |
| Projets de compte de résultat et de bilan | En attente de validation | Table de correspondance lue des intitulés du PCG, non validée par un professionnel ; exercices ouverts avant 2025 non couverts ; comptes ambigus laissés « non affectés » |
| Écritures d'inventaire proposées, approbation par un tiers, balance ajustée de travail, export CSV, états projetés sur la balance ajustée | Testé | Saisie humaine uniquement : aucune écriture n'est générée automatiquement ; l'intégration dans le logiciel comptable n'est pas faite par ce logiciel |
| Annexe, liasse fiscale | Non implémenté | — |
| Télétransmission | Non implémenté, et non autorisée par conception sans périmètre et autorisation spécifiques | — |

## Écrans

Tous les domaines ci-dessus ont leurs écrans : collecte (téléphone et ordinateur), revue de pièce, comptabilité, révision, banque et rapprochements, analyse (balance, projets d'états, indicateurs), inventaire, missions et conseils, veille, recherche, restitution, messagerie, règles du cabinet, administration (dossiers, habilitations, membres, audit, abonnement, indicateurs du cabinet). Détail de ce qui est vérifié sur la pile réelle et de ce qui ne l'est que contre un simulateur : `rapport-de-tests.md`.

S'y ajoutent : nouvelle version d'une pièce (historique des versions, validation invalidée affichée), aperçu d'un CSV bancaire avant confirmation du profil, jonction de pièces à un conseil, une lettre ou une écriture d'inventaire, annulation motivée, rétablissement et reprise d'un import, campagnes d'import, rentabilité par mission, affectation d'un travail à une mission, diagnostic consigné affiché dans l'alerte de rupture du journal d'audit, restitution du cabinet (périmètre, archives, empreinte), pages de propositions de rapprochement et de règles, correspondance des comptes de banque, notifications internes (page et décompte dans l'en-tête).

Non faits côté interface : aucune vérification sur appareil réel, sur Safari lui-même ou sur Firefox, ni au lecteur d'écran.

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
| 4 | Nouvelle version d'un fichier → validations à revoir | Testé pour les données comptables (travaux « à revoir ») et pour les pièces (validation invalidée, original conservé) |
| 5 | Coupure réseau pendant un dépôt | Testé (API réelle ; interface en émulation contre simulateur) |
| 6 | Notification mail répétée ou manquée | Testé contre simulateur de messagerie uniquement |
| 7 | Jeton mail révoqué | Testé contre simulateur de messagerie uniquement |
| 8 | Accès à un autre cabinet ou dossier | Testé (base, API, interface) |
| 9 | Pièce contenant des instructions malveillantes | Testé — sachant qu'aucune IA ne lit les pièces à ce jour |
| 10 | Restauration après incident | Testé en local : base, stockage objet et Keycloak restaurés dans des instances isolées et vérifiés ; limites dans `deploiement.md` |

Environnements réellement utilisés : Chromium (ordinateur et émulation Pixel 7) et WebKit (ordinateur et émulation iPhone 15, parcours sur pile réelle seulement) sur macOS. WebKit est le moteur de Safari, pas Safari. Firefox ne peut pas être lancé par l'agent de développement (protections du poste, cause établie en D-059) : sa suite reste à exécuter par l'utilisateur ou par la CI. Aucun appareil réel, aucun lecteur d'écran.
