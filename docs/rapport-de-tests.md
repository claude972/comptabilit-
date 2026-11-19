# Rapport de tests

Dernière exécution complète : 2026-11-19 (seconde passe), poste de développement macOS (Apple Silicon), services locaux dans une machine virtuelle Docker (4 processeurs, 6 Go). La base locale contient les données accumulées par les exécutions successives des parcours.

Tous les jeux de données sont SYNTHÉTIQUES. Aucun service externe réel (Google, Microsoft, OVHcloud), aucun appareil réel, aucune donnée de cabinet.

## Résultats

| Suite | Commande | Résultat | Contre quoi |
|---|---|---|---|
| Moteur métier | `pnpm --filter @comtaple/core run test` | 452 réussis / 452 | Mémoire, jeux synthétiques |
| Connecteurs mail (bibliothèque) | `pnpm --filter @comtaple/mail run test` | 57 réussis / 57 | Simulateur local des API Gmail et Graph |
| Application web (logique) | `pnpm --filter @comtaple/web run test` | 100 réussis / 100 | Mémoire |
| Isolation et audit | `pnpm --filter @comtaple/db run test:integration` | 12 réussis / 12 | PostgreSQL réel |
| Surveillance des sources | `pnpm --filter @comtaple/worker run test:integration` | 5 réussis / 5 | PostgreSQL réel, lecture HTTP injectée |
| Parcours de bout en bout | `pnpm --filter @comtaple/api run test:integration` | 98 réussis / 98 (9 fichiers) | Pile réelle : Keycloak, API, worker, PostgreSQL, Redis, S3, ClamAV, OCR. Les 20 parcours mail utilisent en plus le simulateur de messagerie |
| Navigateur, API simulée | `pnpm --filter @comtaple/web run test:e2e` | 85 réussis / 85 | Vrai Keycloak ; API remplacée par un simulateur de test ; Chromium ordinateur et émulation Pixel 7 |
| Navigateur, pile réelle | `pnpm --filter @comtaple/web exec playwright test -c playwright.reel.config.ts` | 21 réussis / 21 | Tout réel en local, Chromium ordinateur et émulation Pixel 7 |
| Service OCR | tests pytest dans l'image `comtaple-ocr:tests` | 48 réussis / 48 (exécution du développeur du service, non relancée lors des dernières passes) | Conteneur sans réseau |
| Sauvegarde et restauration | `scripts/sauvegarder.sh && scripts/essai-restauration.sh` | Réussi (84 433 lignes d'écriture, 2 855 événements d'audit, 104 politiques RLS, 20 originaux relus) | Base locale restaurée dans une base neuve |
| Images de conteneurs | `docker build --target api\|worker\|web` puis démarrage | Trois images construites et démarrées | Réseau des services locaux ; lecture seule, sans capacités, utilisateur non privilégié |
| Infrastructure | `tofu validate` dans `infra/opentofu` | Valide | Schéma du fournisseur uniquement ; jamais planifiée ni appliquée |

Typage : réussi pour tous les paquets. 18 migrations rejouées depuis zéro au moins une fois ; les suivantes appliquées de façon incrémentale sur la base locale.

Non exécuté : l'intégration continue GitHub (fichier écrit, dépôt distant non alimenté, et non mise à jour pour les suites ajoutées depuis) ; aucune analyse statique de style ; aucun test de charge ; aucun test d'intrusion ; aucune analyse de vulnérabilités des dépendances ou des images.

## Ce que couvrent les parcours de bout en bout (pile réelle)

**Authentification et cloisonnement** — jeton absent ou falsifié refusé ; un déposant ne voit que ses dossiers habilités ; une administratrice voit l'existence d'un dossier sans y accéder ; un autre cabinet ne peut ni lire ni déposer, même en forçant l'en-tête de cabinet ; journal d'audit réservé aux gestionnaires, chaîne intacte, paginé.

**Dépôt et pièce** — « reçu » seulement après vérification serveur ; extraction par couche texte ; image lue par l'OCR local ; doublon binaire entre canaux ; signalement ; correction versionnée ; validation réservée au réviseur ; contenu servi sous contrôle d'accès ; nom de fichier à caractère nul refusé.

**Coupure réseau** — reprise au décalage confirmé ; décalage faux refusé ; morceau et clôture rejoués sans effet ; empreinte différente refusée ; abandon explicite.

**Fichiers hostiles** — texte d'injection sans effet ; fichier EICAR en quarantaine ; type non pris en charge renvoyé au déposant ; requête de recherche hostile traitée comme une donnée.

**Comptabilité** — import FEC en flux et idempotent ; anomalies injectées détectées ; revue des constats ; dossier de révision ; nouvelle version rendant les travaux « à revoir » ; faux FEC rejeté ; contrôles fiscaux non réalisés hors métropole ; cohérence entre deux exercices importés.

**Banque** — relevé camt.053 cadré ; réimport sans doublon ; CSV ambigu puis profil confirmé ; faux relevé rejeté ; rapprochement vérifié arithmétiquement de façon indépendante ; mouvements sans contrepartie jamais appariés ; validation et rejet par le réviseur ; obsolescence après nouveau relevé.

**Administration et abonnement** — dossier créé avec territoire explicite ; habilitations plafonnées et journalisées ; membres ; rôle et désactivation avec garde-fous ; essai, échéance, virement rapproché par l'éditeur, changement d'offre, suspension, essai expiré, résiliation ; aucune écriture de tarif ni de paiement possible avec le rôle applicatif.

**Règles, états, inventaire** — règle proposée, impact mesuré, approuvée par une autre personne, appliquée et tracée, retirée ; balance, projets d'états, indicateurs tracés et non calculables motivés ; écriture d'inventaire équilibrée, approuvée par un tiers, balance ajustée, export, « à revoir » après changement des données.

**Missions, conseils, veille, recherche, restitution** — lettre validée, travail hors périmètre, projet d'avenant avec estimation sur base nommée ; conseil validé puis autorisé puis faits consignés ; évolution qualifiée, applicabilité en trois états, suivi par cabinet ; recherche citant ses sources ; archive de restitution rouverte et vérifiée fichier par fichier contre son manifeste.

**Messagerie (contre simulateur)** — réception, pièce jointe, analyse ; doublon entre mail et téléversement ; notification répétée, falsifiée, manquée ; jeton révoqué ; cloisonnement ; file de qualification ; facture derrière un lien signalée sans requête vers le lien.

## Ce que couvrent les parcours navigateur sur la pile réelle

Dépôt depuis le téléphone (émulation) jusqu'aux champs extraits ; validation par le réviseur ; révision et catalogue ; cloisonnement dans l'interface ; messagerie « non connectée » ; création d'un dossier, habilitations et exercice par l'interface ; import d'un FEC et d'un relevé, cadrage, rapprochement, décisions ; ouverture d'un constat ; analyse (balance, états, indicateur tracé) ; abonnement ; règle de cabinet de la proposition à l'effet ; écriture d'inventaire ; lettre, travail, avenant ; conseil jusqu'à l'envoi consigné ; veille et sources ; recherche avec surlignage ; restitution téléchargée ; indicateurs du cabinet.

Vérifié contre le simulateur d'API seulement : service fermé et actions d'abonnement, changement de rôle et désactivation dans l'interface, CSV à confirmer, cadrages « écart » et « non vérifiable », obsolescence d'un rapprochement, les trois états d'applicabilité de la veille, compte multi-cabinets, connexion et configuration d'une boîte mail, retour OAuth.

## Mesures relevées

| Mesure | Valeur | Conditions |
|---|---|---|
| Analyse d'un FEC de 105 869 lignes (14,1 Mo), en flux | 0,46 à 0,49 s, croissance du tas ≤ 0,17 Mo | Moteur seul, machine au repos. Jusqu'à 3,4 s observés machine chargée |
| OCR d'une page A4 à 200 ppp | 3,3 à 4,5 s | Conteneur limité à 2 Go, 2 fils d'exécution |
| OCR d'un PDF de 30 pages | 127 s (4,2 s par page) | Idem |
| Mémoire du service OCR | 260 Mio au repos, pic à 1 459 Mio | Idem |
| Rapprochement de 8 800 × 8 800 éléments | 81 ms au cas nominal, environ 1 s en données dégradées | Moteur seul |
| Restauration de la base | 1 à 2 s pour une sauvegarde de 364 à 412 Ko | Base de test, volume négligeable |

Ces chiffres décrivent ce poste et ces jeux. Ils ne sont pas des engagements de performance, et les objectifs de dimensionnement du cahier des charges (plusieurs centaines de dossiers, plusieurs cabinets simultanés) n'ont pas été mesurés. L'import complet d'un FEC de 100 000 lignes à travers l'API, le worker et la base n'a pas été chronométré (seul le moteur l'a été).

## Qualité de l'extraction et de l'OCR

Aucune mesure sur des pièces réelles. Sur les gabarits synthétiques, numéro, date, SIRET et totaux sont retrouvés ; l'extraction s'abstient (champ vide) plutôt que de corriger une erreur d'OCR. Limites observées : page pivotée de 90° ou 180° sans information d'orientation → texte faux sans que le score du moteur d'OCR le signale ; ordre de lecture perturbé à 10° d'inclinaison ; pas de structure de tableau. Aucun taux d'erreur, de faux positif ou d'abstention ne peut être annoncé avant une évaluation sur un corpus réel autorisé.

## Écarts connus révélés par les tests ou les revues

| Sujet | État |
|---|---|
| Lignes d'un constat dans un format incohérent ; contrôles fiscaux exécutés quel que soit le territoire | Corrigés |
| Membres d'un dossier, cabinets d'un compte, pagination des documents et des anomalies, abandon et purge d'un téléversement, doublon à la clôture rejouée | Corrigés |
| Caractère nul dans un nom de fichier provoquant une erreur serveur | Corrigé (refus 400) |
| Rubriques des états sans nature ni parent ; audit sans nom d'acteur ni pagination | Corrigés |
| Noms des auteurs absents des listes de règles et d'écritures d'inventaire (identifiants seuls) | Ouvert |
| Motif de refus d'une règle conservé seulement dans l'audit | Ouvert |
| Estimation d'un projet d'avenant non conservée après rechargement | Ouvert |
| Marqueurs de surlignage de la recherche ambigus avec les guillemets français d'une pièce | Ouvert |
| Horodatages de formes différentes selon les routes | Ouvert (l'interface gère les deux) |
| `referentielComptable` et effacement d'un champ facultatif non modifiables sur un dossier | Ouvert |
| Jonction de pièces à un conseil, une écriture d'inventaire, une lettre : API prête, formulaires absents | Ouvert |
| Listes sans total (pièces au-delà de 100, rapprochements au-delà de 2 000, règles au-delà de 500) | Ouvert |
| Aperçu d'un CSV bancaire avant confirmation du profil | Ouvert |
| Correspondance comptes 512 ↔ comptes bancaires : possible par une règle de cabinet sur `TRE-003`, sans écran dédié | Ouvert |
| Progression d'import sans total | Ouvert |
| Points d'entrée publics de notification mail sans limitation de débit ; rotation de la clé de chiffrement des jetons | Ouverts |
| Reprise après redémarrage de Redis pour les imports, rapprochements, exports et restitutions en attente | Ouvert |
| Base locale encombrée par les dossiers d'essai des parcours | Contournement : `scripts/reinitialiser-base-locale.sh` |
