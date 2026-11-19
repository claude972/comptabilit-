# Rapport de tests

Dernière exécution complète : 2026-11-19 (sixième passe, après la révision de D-038, les restaurations isolées (stockage objet, Keycloak), WebKit (vérification stricte comme référence), l'affectation des travaux et les lots versions de pièces, aperçu CSV, pièces jointes, annulation et campagnes d'import, rentabilité), poste de développement macOS (Apple Silicon), services locaux dans une machine virtuelle Docker (4 processeurs, 6 Go). La base locale contient les données accumulées par les exécutions successives des parcours.

Tous les jeux de données sont SYNTHÉTIQUES. Aucun service externe réel (Google, Microsoft, OVHcloud), aucun appareil réel, aucune donnée de cabinet.

## Résultats

| Suite | Commande | Résultat | Contre quoi |
|---|---|---|---|
| Moteur métier | `pnpm --filter @comtaple/core run test` | 458 réussis / 458 | Mémoire, jeux synthétiques |
| Connecteurs mail (bibliothèque) | `pnpm --filter @comtaple/mail run test` | 57 réussis / 57 | Simulateur local des API Gmail et Graph |
| Application web (logique) | `pnpm --filter @comtaple/web run test` | 139 réussis / 139 | Mémoire |
| Isolation et audit | `pnpm --filter @comtaple/db run test:integration` | 32 réussis / 32 (13 sur la base locale existante, 19 sur une base neuve isolée) | PostgreSQL réel. La base neuve est créée, migrée depuis zéro, amorcée puis supprimée à chaque exécution |
| Surveillance des sources et rattrapage | `pnpm --filter @comtaple/worker run test:integration` | 8 réussis / 8 | PostgreSQL réel, lecture HTTP injectée |
| Parcours de bout en bout | `pnpm --filter @comtaple/api run test:integration` | 122 réussis / 122 (11 fichiers) | Pile réelle : Keycloak, API, worker, PostgreSQL, Redis, S3, ClamAV, OCR. Les 20 parcours mail utilisent en plus le simulateur de messagerie |
| Navigateur, API simulée | `pnpm --filter @comtaple/web run test:e2e` | 108 réussis / 108 | Vrai Keycloak ; API remplacée par un simulateur de test ; Chromium ordinateur et émulation Pixel 7 |
| Navigateur, pile réelle | `pnpm --filter @comtaple/web exec playwright test -c playwright.reel.config.ts` | 28 réussis / 28 | Tout réel en local, Chromium ordinateur et émulation Pixel 7 |
| Service OCR | tests pytest dans l'image `comtaple-ocr:tests` | 48 réussis / 48 (exécution du développeur du service, non relancée lors des dernières passes) | Conteneur sans réseau |
| Navigateur WebKit, pile réelle | `pnpm --filter @comtaple/web exec playwright test -c playwright.navigateurs.config.ts --project=webkit` | 28 réussis / 28 | Mêmes parcours que la ligne précédente, moteur WebKit 27.2 de Playwright (moteur de Safari, pas Safari), téléphone émulé en iPhone 15 |
| Navigateur Firefox, pile réelle | idem `--project=firefox` | **Non exécuté** : Firefox 159 de Playwright ne se lance pas sur ce poste (« Could not find profile folder », refus du bac à sable macOS), y compris depuis le disque interne | — |
| Sauvegarde et restauration : base et stockage objet | `scripts/sauvegarder.sh && scripts/essai-restauration.sh` | **Restauration fidèle, contrôle d'intégrité du journal EN ÉCHEC** (code de sortie 3). Base : 432 181 lignes d'écriture, 112 politiques RLS, journal identique à l'origine. Stockage objet : 1 521 objets (3,6 Go) rechargés dans une instance isolée, 1 422 objets référencés par la base restaurée tous relus et conformes. La vérification stricte désigne la ligne 7603 du cabinet Alpha fictif (état historique dégradé, D-038) : l'essai ne sortira « réussi » que sur une base au journal intègre | Base neuve et instance de stockage séparée, détruites après l'essai |
| Sauvegarde et restauration : Keycloak | `scripts/essai-restauration-keycloak.sh` | Réussi : 16 contrôles conformes (comptes, « sub », connexions, refus d'un mauvais mot de passe, clients, secret, rôles) | Instance Keycloak d'essai séparée, détruite après l'essai ; 7 s d'arrêt du Keycloak local pour l'export |
| Images de conteneurs | `docker build --target api\|worker\|web` puis démarrage | Trois images construites et démarrées | Réseau des services locaux ; lecture seule, sans capacités, utilisateur non privilégié |
| Infrastructure | `tofu validate` dans `infra/opentofu` | Valide | Schéma du fournisseur uniquement ; jamais planifiée ni appliquée |

Typage : réussi pour tous les paquets. Les 27 migrations sont rejouées depuis une base vide à chaque exécution de la suite « Isolation et audit » (base neuve isolée), avec vérification que RLS est activé et forcé sur toute table portant `cabinet_id`.

Les images de conteneurs, la validation OpenTofu et les tests du service OCR n'ont PAS été relancés lors de cette passe : leurs résultats datent des passes précédentes.

Non exécuté : l'intégration continue GitHub (fichier écrit, dépôt distant non alimenté, et non mise à jour pour les suites ajoutées depuis) ; aucune analyse statique de style ; aucun test de charge ; aucun test d'intrusion ; aucune analyse de vulnérabilités des dépendances ou des images.

## Ce que couvrent les parcours de bout en bout (pile réelle)

**Authentification et cloisonnement** — jeton absent ou falsifié refusé ; un déposant ne voit que ses dossiers habilités ; une administratrice voit l'existence d'un dossier sans y accéder ; un autre cabinet ne peut ni lire ni déposer, même en forçant l'en-tête de cabinet ; journal d'audit réservé aux gestionnaires, chaîne intacte, paginé.

**Dépôt et pièce** — « reçu » seulement après vérification serveur ; extraction par couche texte ; image lue par l'OCR local ; doublon binaire entre canaux ; signalement ; correction versionnée ; validation réservée au réviseur ; contenu servi sous contrôle d'accès ; nom de fichier à caractère nul refusé.

**Coupure réseau** — reprise au décalage confirmé ; décalage faux refusé ; morceau et clôture rejoués sans effet ; empreinte différente refusée ; abandon explicite.

**Fichiers hostiles** — texte d'injection sans effet ; fichier EICAR en quarantaine ; type non pris en charge renvoyé au déposant ; requête de recherche hostile traitée comme une donnée.

**Versions d'une pièce** — nouvelle version déposée, original conservé et consultable, validation de l'ancienne version invalidée explicitement et tracée, fichier identique refusé sans remplacement, déposant limité à ses pièces non validées, liste filtrable sur les versions courantes et recherche par nom (jokers pris littéralement).

**Annulation et campagnes d'import** — annulation motivée par un réviseur, lot précédent réactivé, rétablissement, annulation pendant le traitement sans ligne conservée, reprise d'un import en échec, campagne sur plusieurs dossiers avec échec isolé, décompte en dossiers distincts, dossiers hors habilitation comptés sans être révélés, nom de l'auteur d'une annulation.

**Journal d'audit, sur base neuve isolée (non-régression)** — 240 écritures simultanées par deux rôles sur deux cabinets sans irrégularité ni prédécesseur déclaré deux fois ; modification, suppression, troncature refusées aux rôles applicatifs ; numéro, empreinte, prédécesseur et horodatage fournis par l'appelant ignorés ; écriture dans le journal d'un autre cabinet refusée ; avec les droits du propriétaire : contenu modifié, empreinte recalculée, ligne supprimée, début tronqué, prédécesseur inexistant, vidé ou emprunté à un autre cabinet — tous désignés par la vérification stricte et non consignables ; une consignation ne change jamais le résultat strict et ne masque pas une altération dans ou après sa plage ; lecture du journal réservée aux gestionnaires dans la base, écriture d'un non-gestionnaire correctement enchaînée.

**Journal d'audit, sur la base locale existante (état historique dégradé)** — aucune conclusion d'intégrité : seulement l'absence de nouvelle irrégularité sur les lignes écrites pendant le test, et la cohérence entre l'API et la vérification stricte (rupture affichée, diagnostic à part).

**Comptabilité** — import FEC en flux et idempotent ; anomalies injectées détectées ; revue des constats ; dossier de révision ; nouvelle version rendant les travaux « à revoir » ; faux FEC rejeté ; contrôles fiscaux non réalisés hors métropole ; cohérence entre deux exercices importés.

**Banque** — relevé camt.053 cadré ; réimport sans doublon ; CSV ambigu : aperçu des premières lignes puis profil confirmé ; faux relevé rejeté ; rapprochement vérifié arithmétiquement de façon indépendante ; mouvements sans contrepartie jamais appariés ; validation et rejet par le réviseur ; obsolescence après nouveau relevé.

**Administration et abonnement** — dossier créé avec territoire explicite ; habilitations plafonnées et journalisées ; membres ; rôle et désactivation avec garde-fous ; essai, échéance, virement rapproché par l'éditeur, changement d'offre, suspension, essai expiré, résiliation ; aucune écriture de tarif ni de paiement possible avec le rôle applicatif.

**Règles, états, inventaire** — règle proposée, impact mesuré, approuvée par une autre personne, appliquée et tracée, retirée ; balance, projets d'états, indicateurs tracés et non calculables motivés ; écriture d'inventaire équilibrée, approuvée par un tiers, balance ajustée, export, « à revoir » après changement des données.

**Missions, conseils, veille, recherche, restitution** — lettre validée, travail hors périmètre, projet d'avenant avec estimation sur base nommée ; rentabilité par mission (honoraires saisis, temps observés, coût horaire saisi, « non calculable » motivé sinon) ; affectation explicite d'un travail à une mission, écartée de la rentabilité des autres, retirée, journalisée ; pièces du dossier jointes à un conseil, une lettre, une écriture d'inventaire ; conseil validé puis autorisé puis faits consignés ; évolution qualifiée, applicabilité en trois états, suivi par cabinet ; recherche citant ses sources ; archive de restitution rouverte et vérifiée fichier par fichier contre son manifeste.

**Messagerie (contre simulateur)** — réception, pièce jointe, analyse ; doublon entre mail et téléversement ; notification répétée, falsifiée, manquée ; jeton révoqué ; cloisonnement ; file de qualification ; facture derrière un lien signalée sans requête vers le lien.

## Ce que couvrent les parcours navigateur sur la pile réelle

Dépôt depuis le téléphone (émulation) jusqu'aux champs extraits ; validation par le réviseur ; révision et catalogue ; cloisonnement dans l'interface ; messagerie « non connectée » ; création d'un dossier, habilitations et exercice par l'interface ; import d'un FEC et d'un relevé, cadrage, rapprochement, décisions ; ouverture d'un constat ; analyse (balance, états, indicateur tracé) ; abonnement ; règle de cabinet de la proposition à l'effet ; écriture d'inventaire ; lettre, travail, avenant ; conseil jusqu'à l'envoi consigné ; veille et sources ; recherche avec surlignage ; restitution téléchargée ; indicateurs du cabinet ; nouvelle version d'une pièce ; aperçu d'un CSV bancaire et confirmation du profil ; pièces jointes à un conseil et à une écriture d'inventaire ; annulation motivée puis rétablissement d'un import ; campagne d'import sur deux dossiers dont un fichier illisible ; rentabilité avec marge « non calculable » sans coût horaire.

Vérifié contre le simulateur d'API seulement : service fermé et actions d'abonnement, changement de rôle et désactivation dans l'interface, CSV à confirmer, cadrages « écart » et « non vérifiable », obsolescence d'un rapprochement, les trois états d'applicabilité de la veille, compte multi-cabinets, connexion et configuration d'une boîte mail, retour OAuth.

## Mesures relevées

| Mesure | Valeur | Conditions |
|---|---|---|
| Analyse d'un FEC de 105 869 lignes (14,1 Mo), en flux | 0,46 à 0,49 s, croissance du tas ≤ 0,17 Mo | Moteur seul, machine au repos. Jusqu'à 3,4 s observés machine chargée |
| OCR d'une page A4 à 200 ppp | 3,3 à 4,5 s | Conteneur limité à 2 Go, 2 fils d'exécution |
| OCR d'un PDF de 30 pages | 127 s (4,2 s par page) | Idem |
| Mémoire du service OCR | 260 Mio au repos, pic à 1 459 Mio | Idem |
| Rapprochement de 8 800 × 8 800 éléments | 81 ms au cas nominal, environ 1 s en données dégradées | Moteur seul |
| Campagne d'import sur 200 dossiers (`scripts/mesure-campagne.mjs`) | 192 imports réussis, 8 échecs (les 8 fichiers volontairement illisibles), aucun échec propagé ; 76 635 lignes importées et contrôlées ; 13,4 s de dépôt séquentiel, 1,3 s de plus pour la fin des imports, 14,8 s du premier dépôt à la fin des contrôles | Fichiers de 150 écritures (≈ 54 Ko), un seul utilisateur, worker à 2 traitements simultanés, poste local au repos |
| Annulation d'un import en cours | Fichier de 291 567 lignes interrompu pendant le traitement, aucune ligne conservée, lot actif inchangé | Parcours de bout en bout |
| Restauration de la base | 6 s pour une sauvegarde de 24 Mo (402 800 lignes d'écriture) | Base locale d'essai ; 1 à 2 s pour 364 à 412 Ko lors des premières passes |

Ces chiffres décrivent ce poste et ces jeux. Ils ne sont pas des engagements de performance. La campagne de 200 dossiers porte sur de PETITS fichiers et un seul cabinet : ni des fichiers de 100 000 lignes par dossier, ni plusieurs cabinets simultanés n'ont été mesurés. L'import complet d'un FEC de 100 000 lignes à travers l'API, le worker et la base n'a pas été chronométré (seul le moteur l'a été).

## Qualité de l'extraction et de l'OCR

Aucune mesure sur des pièces réelles. Sur les gabarits synthétiques, numéro, date, SIRET et totaux sont retrouvés ; l'extraction s'abstient (champ vide) plutôt que de corriger une erreur d'OCR. Limites observées : page pivotée de 90° ou 180° sans information d'orientation → texte faux sans que le score du moteur d'OCR le signale ; ordre de lecture perturbé à 10° d'inclinaison ; pas de structure de tableau. Aucun taux d'erreur, de faux positif ou d'abstention ne peut être annoncé avant une évaluation sur un corpus réel autorisé.

## Écarts connus révélés par les tests ou les revues

| Sujet | État |
|---|---|
| **PostgreSQL redémarré pendant un essai de restauration** (sonde de santé expirée sous charge disque, processus orphelin recueilli par le serveur) | Corrigé dans `compose.yaml` (processus d'init, sonde sans shell). Aucune donnée perdue ; essai rejoué sans redémarrage. Détail : `deploiement.md` |
| Firefox impossible à lancer sur ce poste | Ouvert (cause non élucidée ; la configuration du projet Firefox est en place) |
| **Journal d'audit : bifurcation de la chaîne sous écritures simultanées** (numéro attribué avant le verrou). Constaté une fois en local, reproduit sur une copie | Défaut corrigé (migration 0025) et couvert par des tests sur base neuve. La base locale fictive reste dans un état historique dégradé : la vérification stricte y échoue et l'écran, l'API et l'essai de restauration le disent ; la consignation n'est qu'un diagnostic (D-038 révisée). Aucun ancrage externe des empreintes |
| Lecture du journal d'audit protégée par l'API seulement, pas par la base | Corrigé (migration 0026) |
| `scripts/applis.sh web` relance l'application sans la reconstruire : un build périmé a fait échouer un parcours réel | Contournement : `pnpm --filter @comtaple/web run build` avant de relancer |
| Lignes d'un constat dans un format incohérent ; contrôles fiscaux exécutés quel que soit le territoire | Corrigés |
| Membres d'un dossier, cabinets d'un compte, pagination des documents et des anomalies, abandon et purge d'un téléversement, doublon à la clôture rejouée | Corrigés |
| Caractère nul dans un nom de fichier provoquant une erreur serveur | Corrigé (refus 400) |
| Rubriques des états sans nature ni parent ; audit sans nom d'acteur ni pagination | Corrigés |
| Noms des auteurs absents des listes de règles et d'écritures d'inventaire | Corrigé (noms renvoyés par l'API) |
| Motif de refus d'une règle conservé seulement dans l'audit | Corrigé (motif conservé sur la règle) |
| Estimation d'un projet d'avenant non conservée après rechargement | Corrigé (conservée avec le projet) |
| Marqueurs de surlignage de la recherche ambigus avec les guillemets français d'une pièce | Ouvert |
| Horodatages de formes différentes selon les routes | Ouvert (l'interface gère les deux) |
| `referentielComptable` et effacement d'un champ facultatif non modifiables sur un dossier | Ouvert |
| Jonction de pièces à un conseil, une écriture d'inventaire, une lettre | Corrigé (formulaires livrés ; conseil et écriture vérifiés au navigateur sur pile réelle, lettre contre simulateur et par l'API) |
| Listes sans total | Corrigé pour les pièces (total, pagination, recherche). Ouvert pour les rapprochements au-delà de 2 000 et les règles au-delà de 500 |
| Aperçu d'un CSV bancaire avant confirmation du profil | Corrigé. Limite : aucun profil n'est pré-proposé (`profilPropose` toujours vide), l'utilisateur choisit toutes les colonnes |
| Correspondance comptes 512 ↔ comptes bancaires : possible par une règle de cabinet sur `TRE-003`, sans écran dédié | Ouvert |
| Progression d'import sans total | Ouvert |
| Points d'entrée publics de notification mail sans limitation de débit | Corrigé (l'écart était resté noté « ouvert » à tort) : limite globale par fournisseur, 300 par minute, testée unitairement. Limite : comptée par processus, donc non partagée entre plusieurs instances de l'API |
| Rotation de la clé de chiffrement des jetons mail | Corrigé (anciennes clés acceptées en déchiffrement seulement ; testé en bibliothèque) |
| Reprise après redémarrage de Redis pour les traitements en attente | Rattrapage au démarrage du worker, testé sur base réelle ; aucun essai avec un arrêt réel de Redis |
| Travaux non affectés comptés dans chaque mission d'un même dossier | Voulu et signalé avec leur nombre ; l'affectation explicite les départage |
| Rentabilité : quand la marge n'est pas calculable, des sommes partielles non nulles restent renvoyées à côté du motif | Ouvert (l'interface affiche « non calculable ») |
| Projet d'avenant automatique : pas de choix de la lettre signée de référence quand il y en a plusieurs | Ouvert |
| Tests d'abonnement et d'isolation dépendant du nombre de dossiers présents en base | Corrigé (les attendus sont calculés d'après l'état réel) |
| Base locale encombrée par les dossiers d'essai des parcours (dont 200 dossiers « Mesure » dans le cabinet Bêta) | Laissée en l'état pour préserver les données ; `scripts/reinitialiser-base-locale.sh` existe mais est destructif et n'a jamais été lancé |
