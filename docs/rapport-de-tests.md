# Rapport de tests

Dernière exécution complète : 2026-11-19, poste de développement macOS (Apple Silicon), services locaux dans une machine virtuelle Docker (4 processeurs, 6 Go). Base de données recréée à partir de zéro (toutes les migrations rejouées) juste avant cette exécution.

Tous les jeux de données sont SYNTHÉTIQUES. Aucun service externe réel (Google, Microsoft, OVHcloud), aucun appareil réel, aucune donnée de cabinet.

## Résultats

| Suite | Commande | Résultat | Contre quoi |
|---|---|---|---|
| Moteur métier | `pnpm --filter @comtaple/core run test` | 370 réussis / 370 | Mémoire, jeux synthétiques |
| Connecteurs mail (bibliothèque) | `pnpm --filter @comtaple/mail run test` | 57 réussis / 57 | Simulateur local des API Gmail et Graph |
| Application web (logique) | `pnpm --filter @comtaple/web run test` | 50 réussis / 50 | Mémoire |
| Isolation et audit | `pnpm --filter @comtaple/db run test:integration` | 12 réussis / 12 | PostgreSQL réel |
| Parcours de bout en bout | `pnpm --filter @comtaple/api run test:integration` | 45 réussis / 45 | Pile réelle : Keycloak, API, worker, PostgreSQL, Redis, S3, ClamAV, OCR. Les 20 parcours mail utilisent en plus le simulateur de messagerie |
| Navigateur, API simulée | `pnpm --filter @comtaple/web run test:e2e` | 40 réussis / 40 | Vrai Keycloak ; API remplacée par un simulateur de test ; Chromium ordinateur et émulation Pixel 7 |
| Navigateur, pile réelle | `pnpm --filter @comtaple/web exec playwright test -c playwright.reel.config.ts` | 4 réussis / 4 | Tout réel en local, Chromium ordinateur et émulation Pixel 7 |
| Service OCR | tests pytest dans l'image `comtaple-ocr:tests` | 48 réussis / 48 (exécution du développeur du service, non relancée lors de la dernière passe) | Conteneur sans réseau |
| Sauvegarde et restauration | `scripts/sauvegarder.sh && scripts/essai-restauration.sh` | Réussi | Base locale restaurée dans une base neuve |

Typage (`typecheck`) et construction (`build`) : réussis pour tous les paquets.

Non exécuté : l'intégration continue GitHub (fichier écrit, dépôt distant non alimenté) ; aucune analyse statique de style (pas de configuration de lint) ; aucun test de charge ; aucun test d'intrusion.

## Ce que couvrent les parcours de bout en bout (pile réelle)

**Authentification et cloisonnement** — jeton absent ou falsifié refusé ; un déposant ne voit que son dossier ; une administratrice voit l'existence d'un dossier sans y accéder ; un autre cabinet ne peut ni lire ni déposer, même en forçant l'en-tête de cabinet ; journal d'audit réservé aux gestionnaires, chaîne intacte.

**Dépôt et pièce** — « reçu » seulement après vérification serveur de la taille et de l'empreinte ; extraction par couche texte ; image sans texte lue par l'OCR local puis extraite ; doublon binaire entre canaux ; signalement par le déposant ; correction versionnée par la collaboratrice avec recalcul des vérifications ; validation réservée au réviseur ; contenu servi sous contrôle d'accès ; un déposant ne voit pas les dépôts des autres.

**Coupure réseau** — reprise au décalage confirmé ; décalage faux refusé ; morceau rejoué sans effet ; clôture rejouée sans doublon ; empreinte différente refusée.

**Fichiers hostiles** — texte d'injection sans effet sur les statuts ni sur les droits ; fichier de test antivirus EICAR mis en quarantaine et jamais servi ; type non pris en charge renvoyé au déposant.

**Comptabilité** — import FEC en flux ; chaque anomalie injectée détectée par le contrôle attendu ; réimport idempotent ; revue des constats avec motif obligatoire et droits par niveau ; dossier de révision (PDF, données, inventaire, empreintes) ; nouvelle version du fichier rendant l'exécution précédente obsolète et les décisions « à revoir » ; faux FEC rejeté sans remplacer les données actives ; dossier d'outre-mer : contrôles fiscaux métropolitains non réalisés et motivés.

**Messagerie (contre simulateur)** — réception d'un message, récupération de la pièce jointe, analyse ; doublon entre mail et téléversement dans les deux sens ; notification répétée, falsifiée, manquée puis rattrapée ; jeton révoqué sans boucle de tentatives ; cloisonnement entre cabinets et refus aux non-gestionnaires ; pièce ambiguë placée en file de qualification puis affectée ; facture derrière un lien signalée sans qu'aucune requête ne parte vers le lien ; notifications Graph, déconnexion, audit.

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
| Lignes d'un constat renvoyées dans un format incohérent | Corrigé |
| Contrôles fiscaux exécutés quel que soit le territoire | Corrigé pour `TVA-001`, `TVA-002`, `IMM-002` ; testé |
| Pas de liste des membres d'un dossier (affectation d'un constat impossible depuis l'interface) | Ouvert |
| Pas de route listant les cabinets d'un compte multi-cabinets | Ouvert |
| Pas de pagination des documents (plafond 500) ni des anomalies d'import | Ouvert |
| Progression d'import sans total | Ouvert |
| Pas de suppression d'un téléversement abandonné ; morceaux non purgés | Ouvert |
| Page web de retour OAuth pour la messagerie, et écrans de gestion des connexions mail | Ouvert : sans elle, une connexion réelle ne peut pas aboutir même avec des identifiants |
| Points d'entrée publics de notification mail sans limitation de débit | Ouvert |
| Rotation de la clé de chiffrement des jetons mail | Ouvert |
