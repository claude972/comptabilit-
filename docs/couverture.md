# Matrice de couverture — état réel

Document de référence sur ce qui fonctionne. Mis à jour le 2026-11-19 (quatrième passe, après relecture complète du cahier des charges : `exigences.md`).

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
| Identités OIDC (Keycloak), session côté serveur, PKCE | Testé | Royaume de développement sans second facteur (D-016). Gabarit de royaume de PRODUCTION préparé et essayé en local : second facteur (TOTP) obligatoire, pas d'accès direct par mot de passe, emplacement pour le SSO d'un cabinet ; jamais déployé, enrôlement TOTP et connexion fédérée non menés jusqu'au bout |
| Cabinets, appartenances, habilitations par dossier | Testé | Ouverture d'un cabinet par l'outil de l'éditeur ; entrée des membres par invitation (D-064). Aucun courriel n'est envoyé ; le compte se crée dans le fournisseur d'identité |
| Isolation entre cabinets et entre dossiers (RLS forcé) | Testé | Voir la limite assumée de la décision D-007 ; pas de test d'intrusion indépendant |
| Rôle « support » à accès temporaire | Testé | Ouvert par l'éditeur (ligne de commande), 72 h au plus, lecture seule, chaque consultation tracée ; le compte du support doit exister dans le fournisseur d'identité |
| Moteur décimal, montants en chaînes dans les API | Testé | — |
| Stockage documentaire par empreinte | Testé | S3 local de développement ; Object Lock non testé |
| Journal d'audit en ajout seul, chaîné, consultable | Testé sur base neuve isolée | Défaut de chaînage sous écritures simultanées trouvé et corrigé le 2026-11-19 (D-038). La base locale fictive garde une irrégularité d'ordre historique : la vérification stricte, seule référence, y échoue et c'est affiché. Lecture réservée aux gestionnaires dans la base. Pas d'ancrage ni d'archivage externe protégé |
| Files de traitements différés, reprise | Testé | Rattrapage automatique pour les pièces seulement |
| Sauvegarde et restauration | Testé en local | Base (PostgreSQL d'essai séparé), stockage objet (instance isolée, tous les objets référencés relus) et Keycloak (instance isolée, export sans arrêt du service) : essais réalisés, avec contrôle qu'aucun service local n'a redémarré. Chiffrement : jeu chiffré complet et restauration depuis des copies chiffrées essayés avec une clé éphémère, mais non activé faute de décision sur la garde de la clé privée (D-050, D-055). Restauration à un instant donné, conservation hors du poste, mécanismes de l'hébergeur : non couverts. Sur la base locale, l'essai signale le journal d'audit non intègre (D-038) |
| Intégration continue | Testé | Exécutée sur GitHub à chaque publication (construction, typage, tests unitaires, base, worker, parcours API, navigateur simulé, Chromium, WebKit et Firefox sur pile réelle, OpenTofu) ; dernier résultat dans `rapport-de-tests.md`. Les nombres de tests exécutés en CI ne sont pas relevés (journaux inaccessibles sans compte) |
| Supervision (OpenTelemetry, Prometheus, Grafana) | Partiel | Métriques exposées par l'API et le worker ; traces OpenTelemetry émises par l'API et le worker quand un point de collecte est configuré (désactivées par défaut), une même trace reliant la requête et les traitements du worker, sans donnée comptable ni secret (D-074). Pile Prometheus, Grafana et collecteur essayée en local. Pas d'entrepôt de traces, pas de span par requête SQL, web non instrumenté, rien de déployé |
| Infrastructure cible (OpenTofu, OVHcloud) | Partiel | Description complète (réseau privé, instances, base managée, buckets dont archives avec Object Lock armé sans rétention, registre) validée syntaxiquement ; composition de production, royaume Keycloak de production et script de déploiement préparés ; jamais planifiée ni appliquée (D-069) |

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
| Détection du type réel, limites de taille, antivirus, quarantaine | Testé | Décodage PDF/XML dans un processus enfant borné par fichier (testé : délai, mémoire, sortie, XXE, bombe de décompression, environnement sans secret, fichiers hors périmètre) ; réseau neutralisé dans le processus seulement, pas d'isolation par le noyau ; relevés bancaires, FEC et mail encore lus dans le worker (D-076) |
| Doublon binaire entre canaux | Testé | — |
| Nouvelle version d'une pièce : original conservé, validation explicitement invalidée | Testé | Les références à l'ancienne version (pièce jointe d'un conseil ou d'une écriture) ne sont pas basculées vers la nouvelle |
| Extraction de factures : PDF à couche texte | En attente de validation | Règles prudentes qui s'abstiennent ; qualité jamais mesurée sur des pièces réelles |
| Extraction de factures : Factur-X, CII, UBL | En attente de validation | XML embarqué dans un PDF lu depuis D-076 (il ne l'était pas avant). Chemins recoupés avec des exemples publics ; aucune facture Factur-X réelle testée ; spécification officielle non consultée |
| OCR local (PaddleOCR) | En attente de validation | Environ 4 s par page en local ; pages pivotées sans EXIF mal lues ; aucune photo réelle testée |
| Proposition de classement d'une pièce (type et dossier) | Partiel | Route et bouton sur la page de la pièce ; SANS IA aujourd'hui : repli déterministe étiqueté (rattachement par indice exact, type laissé « à qualifier »). Rien n'est appliqué à la pièce sans action humaine. Chemin « modèle » testé au niveau du paquet contre SIMULATEUR seulement |
| Revue d'une pièce : correction versionnée, validation par un réviseur | Testé | — |
| Connecteur Gmail | En attente de connexion | Bibliothèque testée contre simulateur ; branchement dans l'application : voir « Messagerie » ci-dessous |
| Connecteur Microsoft 365 | En attente de connexion | Idem ; boîtes partagées sans notifications (delta périodique) |
| Import FEC et données de travail, en flux, idempotent, versionné | Testé | Variantes testées listées dans `packages/core/docs/fec-compatibilite.md` ; aucun FEC réel d'un logiciel du marché |
| Rapport FEC : lisible / conforme / suffisant, ligne par ligne | En attente de validation | Contrôles de conformité non implémentés listés dans le rapport lui-même |
| Campagnes d'import sur plusieurs dossiers : isolation, suivi et rapport par dossier, reprise des échecs | Testé | Mesuré en local sur 200 dossiers avec de petits fichiers (192 réussis, 8 échecs attendus isolés) ; non mesuré avec de gros fichiers ni plusieurs cabinets simultanés ; dépôt fichier par fichier, pas d'archive répartie automatiquement |
| Annulation réversible d'un import (comptable ou bancaire), rétablissement, reprise, interruption d'un import en cours | Testé | Interruption exercée sur un fichier de 290 000 lignes ; un import arrêté brutalement (processus tué) reste « en cours » et se traite à la main |
| Contrôles déterministes (19 au catalogue) | En attente de validation | Tous exécutés à chaque import. Au-delà de 500 000 lignes : calcul en flux, prouvé strictement égal au calcul en mémoire, mémoire bornée (D-075) ; un contrôle dont l'état dépasserait le budget est « non réalisé » avec son motif. `TRE-003` et `CLO-002` exigent des relevés et l'exercice précédent, sinon « non réalisés » avec leur motif |
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
| Suggestions IA de rapprochement | En attente de connexion | Route livrée, vérification arithmétique par le moteur branchée ; sans IA : « IA indisponible », aucun repli. Jamais exercée avec une vraie suggestion ; bouton sur l'écran Banque (niveau révision) |
| Contrôle de rapprochement bancaire `TRE-003` alimenté par les relevés | Testé | S'abstient si plusieurs comptes bancaires ne peuvent pas être associés aux comptes 512 (pas d'écran de correspondance) |
| Cohérence entre exercices `CLO-002` alimentée par l'exercice précédent | Testé | Exercé de bout en bout avec deux exercices importés (fichiers synthétiques indépendants : le contrôle relève l'écart de reprise) ; pas de jeu où les à-nouveaux concordent |
| Contrôles immobilisations, social, césure, TVA déductible | En attente de validation | — |
| Agrégation bancaire par prestataire | En attente de connexion | Port, adaptateur d'un contrat pivot, format pivot lu par le moteur, écran d'état ; vérifié contre SIMULATEUR seulement. Aucun prestataire choisi ni contracté : statut affiché « non connecté » (D-066) |
| Abonnements : forfait, tranches, essai, quotas, changement d'offre, résiliation, virement, historique | Testé | Grille de démonstration fictive ; opérations de l'éditeur par outil en ligne de commande ; export CSV des éléments de facturation (D-065) ; TVA, facture légale et outil de facturation hors périmètre |
| Service fermé hors abonnement (dépôts refusés, consultation conservée) | Testé | Les quotas sont affichés mais ne bloquent pas la collecte (décision D-024) |
| Règles et paramètres propres au cabinet, avec mesure d'impact et approbation | Testé | Mesure d'impact synchrone, sur un seul contrôle et un exercice ; sert aussi à déclarer la correspondance comptes 512 ↔ comptes bancaires de `TRE-003`, sans écran dédié |
| Administration : dossiers, exercices, habilitations, membres (rôle, désactivation), invitations | Testé | Invitation par adresse et rôle, sans envoi de courriel (D-064) ; effectif moyen saisi sur la fiche du dossier |
| Tiers et factures (onglet du dossier) | En attente de validation | Référentiel des tiers, échéancier avec états à une date explicite, détail d'une facture (pièce, écritures, règlements partiels ou groupés, avoirs, preuve bancaire), propositions à confirmer, suspicions de double comptabilisation tranchées par un réviseur (D-077). Tout est recalculé depuis les écritures ; seules les décisions humaines sont stockées. Partiel : ventes toujours à confirmer (client non lu sur la pièce), euro seulement, aucune tolérance de montant, règlements groupés non lettrés sans référence non recherchés |
| Fin de contrat d'un cabinet (devenir de chaque catégorie à la résiliation) | Partiel | Procédure de l'éditeur en SIMULATION par défaut, testée sur base neuve isolée (22 tests) : inventaire, pré-conditions, exécution transactionnelle, journal conservé et vérifiable, procès-verbal, autres cabinets intacts, rôles applicatifs refusés (D-078). Non activée, jamais appliquée à des données conservées ; suppression d'objets exercée sur un stockage factice seulement ; sauvegardes, fournisseur d'identité et journaux techniques non traités ; durées proposées, non arrêtées |
| Export de restitution d'un dossier | Testé | Construit en flux (D-047) ; un original non conforme n'est pas restitué, comme pour le cabinet (D-052) ; mémoire mesurée sur un gros dossier synthétique (rapport de tests) |
| Correspondance comptes 512 / comptes bancaires | Testé | Proposition soumise au circuit des règles ; IBAN masqué ; par dossier seulement (D-048) |
| Restitution d'un cabinet entier | Testé | Périmètre limité aux dossiers où le demandeur a le niveau « validation » (les autres sont listés, l'archive est dite incomplète) ; archive en flux ; manifeste vérifiable hors application ; téléchargement réservé au demandeur. Ni chiffrée ni signée. Mesurée en local sur 235 dossiers (D-043) |
| Pagination des rapprochements et des règles du cabinet | Testé | Par décalage ; ancienne forme des règles conservée sans paramètre (D-044) |
| Ancres du journal d'audit | En attente de connexion | Format, export et vérification hors base testés ; aucun dépôt chez un tiers indépendant, donc aucun ancrage effectif (D-046) |
| Purge des téléversements abandonnés ; rattrapage des traitements en attente | Testé | Purge exercée sur le stockage réel ; rattrapage exercé pour une restitution, par construction identique pour les autres natures |
| Métriques techniques (Prometheus) | Partiel | Points de collecte vérifiés ; collecte, alertes et tableaux essayés en local, non déployés ; pas de traces OpenTelemetry |
| Images de conteneurs | Partiel | API, worker et web construites et démarrées en local (lecture seule, sans privilèges) ; non optimisées, jamais poussées vers un registre, aucun parcours complet à travers les trois conteneurs ; image Keycloak de production construite et essayée en local ; composition de production validée par `docker compose config`, jamais démarrée dans son ensemble |
| Description d'infrastructure OpenTofu | Partiel | Réseau, groupes de sécurité, instances, base, buckets, utilisateur S3, registre ; validée syntaxiquement, jamais planifiée ni appliquée |

## Lot 3 — Veille et assistant

| Fonctionnalité | État | Limites |
|---|---|---|
| Surveillance planifiée de pages officielles, détection de changement | Testé | Dans l'environnement réel, BOFiP est lisible ; Légifrance refuse l'accès automatisé (403) : ces sources sont affichées indisponibles. Une surveillance fiable de Légifrance passe par son API officielle (accès à demander) |
| Évolutions qualifiées par une personne (résumé, dates, conditions, critères) | En attente de validation | Opération de l'éditeur par provisionnement ; aucune évolution réelle n'a été qualifiée (seulement des évolutions d'essai fictives, retirées) |
| Applicabilité par dossier, expliquée ; « à confirmer » si une caractéristique manque | Testé | Critères : territoire, régime, forme, NAF, référentiel, exercices, taille (chiffre d'affaires, total du bilan, effectif saisi) et opérations repérées dans les comptes (D-068). Taille tirée des écritures importées, avant inventaire ; une opération repérée est un indice comptable |
| Suivi d'une évolution par dossier | Testé | — |
| Recherche textuelle autorisée (pièces, écritures, constats) | Testé | Plein texte français, par dossier ; portefeuille multi-dossiers non couvert. Recherche vectorielle : passages indexés par le worker, vecteurs NULL tant qu'aucun fournisseur d'embeddings n'est connecté ; fusion texte + vecteur testée avec des vecteurs SIMULÉS seulement |
| Assistant documenté — mode sans IA | Testé | API sur pile réelle, navigateur simulé et réel. Habilitations vérifiées avant toute recherche, citations vers les vraies pièces, écritures et constats, période et périmètre affichés, abstention. Recherche par mots-clés, sans compréhension de la question ; pas de rédaction ; un seul dossier à la fois (pas de portefeuille) ; limite de débit en mémoire du processus |
| Assistant documenté — rédaction par un modèle | En attente de connexion | Orchestration et garde-fous (fonctions métier en liste blanche, citations et chiffres vérifiés par code, refus d'un modèle manipulé) testés contre le SIMULATEUR avec les ports réels sous RLS : cela ne dit rien d'un modèle réel. Aucun jeton, aucun appel réel jamais fait |
| Passerelle IA unique, traces sans contenu, mesures pour les gestionnaires | En attente de connexion | Statut réel : « non connecté ». Natures « réel », « simulateur » et « sans IA » distinguées. Preuve de connexion non persistée et aucune route de vérification : avec un jeton, le statut resterait « configuré, non vérifié » et aucun modèle ne serait sollicité. Coût non estimé (aucun tarif configuré) |
| Explication d'un constat, commentaire d'indicateurs | Partiel | Sans IA : message du moteur ou gabarit, étiquetés. Boutons sur la page du constat et sur l'écran Analyse |

## Lot 4 — Missions et performance

| Fonctionnalité | État | Limites |
|---|---|---|
| Missions, lettres et avenants structurés (projet → validée), lettre signée jointe | Testé | Contenu SAISI par le cabinet. Analyse automatique d'une lettre existante : route livrée (citations exactes exigées, résultat = projet jamais appliqué), « IA indisponible » sans modèle ; bouton sous chaque lettre de l'écran Mission |
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
| Écritures d'inventaire proposées, approbation par un tiers, balance ajustée de travail, export CSV, états projetés sur la balance ajustée | Testé | Saisie humaine, ou reprise d'une proposition du moteur (ligne suivante) ; l'intégration dans le logiciel comptable n'est pas faite par ce logiciel |
| Propositions déterministes d'écritures d'inventaire (charges et produits constatés d'avance, factures non parvenues et à établir, dotations linéaires) | En attente de validation | Règles explicites et versionnées, sans IA ; rien n'est enregistré d'office ; une proposition reprise suit le circuit d'approbation. Période lue dans le libellé ou fournie ; FNP et FAE seulement à partir des constats de césure. Dotations aux amortissements LINÉAIRES seulement, à partir d'un fichier des immobilisations saisi par le cabinet (ce n'est pas celui du logiciel comptable) |
| Préparation de la liasse fiscale : 2050 à 2053 (réel normal), 2033-A et 2033-B (simplifié) | En attente de validation | Périmètre : société commerciale à l'IS, PCG, euros, métropole ; sinon ABSTENTION sans chiffre. Toujours « projet », jamais « complet ». Codes de cases NON vérifiés (site des impôts en maintenance le jour de la vérification) : lignes désignées par leur libellé. Seize autres tableaux listés non couverts, avec les informations qu'ils exigent. Pas de colonne N-1, pas d'arrondi à l'euro, pas de résultat fiscal. Détail : `etats-fiscaux.md` |
| Projet d'annexe (59 rubriques du PCG, pré-remplissage, confirmations du cabinet) | En attente de validation | Personne morale uniquement ; catégorie de taille déclarée par le cabinet (seuils « à confirmer ») ; une rubrique n'est complète que confirmée par une personne habilitée, et la confirmation tombe si les données changent ; le texte de l'annexe n'est pas rédigé par le logiciel |
| Télétransmission | Non implémenté, et non autorisée par conception sans périmètre et autorisation spécifiques | — |

## Écrans

Tous les domaines ci-dessus ont leurs écrans : collecte (téléphone et ordinateur), revue de pièce, comptabilité, révision, banque et rapprochements, analyse (balance, projets d'états, indicateurs), inventaire, missions et conseils, veille, recherche, restitution, messagerie, règles du cabinet, administration (dossiers, habilitations, membres, audit, abonnement, indicateurs du cabinet). Détail de ce qui est vérifié sur la pile réelle et de ce qui ne l'est que contre un simulateur : `rapport-de-tests.md`.

S'y ajoutent : nouvelle version d'une pièce (historique des versions, validation invalidée affichée), aperçu d'un CSV bancaire avant confirmation du profil, jonction de pièces à un conseil, une lettre ou une écriture d'inventaire, annulation motivée, rétablissement et reprise d'un import, campagnes d'import, rentabilité par mission, affectation d'un travail à une mission, diagnostic consigné affiché dans l'alerte de rupture du journal d'audit, restitution du cabinet (périmètre, archives, empreinte), pages de propositions de rapprochement et de règles, correspondance des comptes de banque, notifications internes (page et décompte dans l'en-tête).

Non faits côté interface : aucune vérification sur appareil réel, sur Safari lui-même, ni au lecteur d'écran. Firefox n'est exécuté que par l'intégration continue.

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
| 9 | Pièce contenant des instructions malveillantes | Testé : restituée comme donnée par l'assistant sans IA ; avec un modèle SIMULÉ jouant un modèle manipulé, les garde-fous refusent et tracent. Aucun modèle réel n'a lu de pièce |
| 10 | Restauration après incident | Testé en local : base, stockage objet et Keycloak restaurés dans des instances isolées et vérifiés ; limites dans `deploiement.md` |

Environnements réellement utilisés : Chromium (ordinateur et émulation Pixel 7) et WebKit (ordinateur et émulation iPhone 15, parcours sur pile réelle seulement) sur macOS. WebKit est le moteur de Safari, pas Safari. Firefox ne peut pas être lancé par l'agent de développement sur le poste (D-059) : sa suite est exécutée, et réussie, par l'intégration continue (D-063). Aucun appareil réel, aucun lecteur d'écran.
