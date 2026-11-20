# Architecture

Monolithe modulaire en monorepo pnpm, avec des traitements différés séparés du serveur interactif. Pas de microservices ni de Kubernetes au lancement.

## Vue d'ensemble

```
Téléphone / navigateur
        │  HTTPS (cookie de session chiffré ; aucun jeton côté navigateur)
        ▼
apps/web  — Next.js (App Router) + PWA ; BFF : détient la session OIDC, relaie vers l'API
        │  Bearer (jeton d'accès Keycloak)
        ▼
apps/api  — NestJS, REST + OpenAPI ; rôle PostgreSQL comtaple_app (RLS cabinet + dossier)
        │                         │ identifiants seulement
        │                         ▼
        │                   Redis / BullMQ
        │                         │
        ▼                         ▼
PostgreSQL 18 (+ pgvector)  apps/worker — rôle comtaple_worker (RLS cabinet)
        ▲                         │
        │                         ├── ClamAV (clamd, INSTREAM)
        │                         ├── services/ocr (PaddleOCR local, HTTP)
        │                         ├── pdf.js (couche texte, XML Factur-X embarqué)
        │                         └── Chromium/Playwright (rendu PDF hors ligne)
        ▼
Stockage objet S3 (originaux adressés par SHA-256, dérivés, exports)
```

## Paquets

| Paquet | Rôle | Dépend de |
|---|---|---|
| `packages/core` | Moteur métier déterministe et pur : montants décimaux, identifiants, analyse de FEC en flux, catalogue de contrôles, extraction de factures (texte, Factur-X/CII, UBL), jeux synthétiques. Aucun accès réseau, base ou fichier. | decimal.js, zod, fast-xml-parser, iconv-lite |
| `packages/db` | Schéma Drizzle, migrations SQL versionnées, contexte de sécurité par transaction, journal d'audit, amorçage de démonstration. | drizzle-orm, pg |
| `packages/plateforme` | Configuration validée, stockage S3, files BullMQ (charges utiles = identifiants). | AWS SDK S3, bullmq |
| `packages/mail` | Connecteurs Gmail et Microsoft Graph en lecture seule, moteur de synchronisation, simulateur de test. | (ports injectés) |
| `apps/api` | API REST : téléversements reprenables, documents, révision, exports, référentiel. | core, db, plateforme |
| `apps/worker` | Traitements différés : analyse de pièce, import FEC, contrôles, dossier de révision. | core, db, plateforme |
| `apps/web` | Application web et PWA installable. | API via BFF |
| `services/ocr` | Service OCR conteneurisé (Python, PaddleOCR), sans accès réseau à l'exécution. | — |

## Principes structurants

**Calcul et IA séparés.** Tout chiffre (solde, total, écart, seuil) vient du moteur `core` ou d'une donnée identifiée. Aucun montant n'est un flottant : `NUMERIC(18,2)` en base, `decimal.js` dans le moteur, chaînes décimales dans les API. L'IA n'intervient dans aucun traitement livré à ce jour ; la passerelle IA est à l'état « non connectée ».

**Isolation.** Voir la décision D-007 : trois rôles PostgreSQL, RLS activé et forcé, politique par cabinet pour tous, politique par dossier pour le serveur interactif, contexte posé par transaction depuis le jeton vérifié.

**Traçabilité des versions.** Un lot d'import porte une version ; l'exercice porte un compteur `version_donnees` incrémenté à chaque nouveau lot actif. Une exécution de contrôles référence le lot et la version des données ; chaque résultat référence l'identifiant et la version du contrôle, ses paramètres et sa source. Une extraction de pièce est versionnée ; une validation référence la version validée. Quand les données changent, les exécutions antérieures passent `obsolete` et les constats déjà décidés passent `a_revoir`.

**Trois notions distinctes pour une pièce.** Nouvelle version d'un document (`documents.version`, `remplace_document_id`), doublon binaire (même empreinte dans le même dossier : nouvelle ligne `receptions` avec `doublon_binaire`), suspicion de double comptabilisation (contrôle `GEN-004` sur les écritures).

**Contenus non fiables.** Pièces, messages, libellés d'écritures et noms de fichiers sont des données. Ils ne sont jamais interprétés comme des instructions, toujours échappés à l'affichage et au rendu PDF, et lus par des analyseurs sans exécution (pas de JavaScript PDF, pas d'entité XML externe, pas de requête réseau). Le décodage des pièces déposées a lieu hors du processus du worker, dans un processus enfant borné : voir « Traitements isolés ».

**Mode dégradé.** La collecte, la conservation et les contrôles déterministes ne dépendent ni de l'IA ni de l'OCR. OCR indisponible : la pièce est conservée et part en saisie manuelle. Antivirus indisponible : la pièce est conservée mais n'est ni analysée ni servie tant qu'aucun verdict n'est rendu.

## Cycle de vie d'une pièce

1. `POST /v1/televersements` — taille et SHA-256 annoncés ; vérification de l'habilitation sur le dossier.
2. `PUT …/morceaux?decalage=N` — morceaux de 4 Mo, décalage vérifié, rejeu sans effet.
3. `POST …/terminer` — assemblage, vérification taille + empreinte, original stocké par empreinte, création du document (ou d'une réception supplémentaire si doublon binaire), statut `recu`, écriture d'audit, mise en file.
4. Worker — antivirus → type réel → extraction dans un processus enfant borné (structuré > couche texte > OCR) → vérifications arithmétiques → statut `a_controler` (ou `a_completer`, `quarantaine`).
5. Revue — corrections versionnées par un collaborateur, validation par un réviseur → `traite`.

## Traitements isolés

Le décodage d'une pièce déposée (PDF, XML de facture, texte reconnu par l'OCR) ne s'exécute pas dans le processus du worker. `apps/worker/src/analyse-isolee.ts` lance pour chaque fichier un **processus enfant** Node (`dist/analyse-enfant.js`), lui transmet les octets par son entrée standard et n'en reçoit qu'un résultat JSON, validé par schéma (Zod, clés inconnues retirées) avant d'entrer dans le worker.

| | Processus du worker (parent) | Processus enfant (un par fichier) |
|---|---|---|
| Fait | Lit la pièce dans le stockage ; compare ses premiers octets à des signatures fixes (type réel) ; la transmet à l'antivirus, au service OCR et à l'enfant ; valide le résultat ; écrit en base | Lit le PDF (pdf.js : couche texte, fichier Factur-X embarqué), lit le XML CII/UBL, extrait les champs par règles depuis le texte (couche texte ou sortie de l'OCR) |
| Détient | Connexions à la base, à Redis et au stockage, configuration, secrets | Rien : environnement vide, aucun argument, seulement les octets reçus |

Un processus par fichier, non réutilisé : aucun état ne passe d'une pièce à la suivante ni d'un cabinet à l'autre, et la mémoire est rendue à chaque fois. Les images ne sont décodées que par le service OCR (conteneur dédié) ; l'antivirus et l'OCR restent appelés par le parent.

**Bornes imposées par le parent** (réglables par l'environnement, valeurs par défaut) :

| Borne | Variable | Défaut | Au-delà |
|---|---|---|---|
| Durée par fichier | `ANALYSE_DUREE_MAX_MS` | 60 000 ms | enfant arrêté de force |
| Tas JavaScript de l'enfant (`--max-old-space-size`) | `ANALYSE_TAS_MAX_MO` | 512 Mo | l'enfant s'arrête de lui-même |
| Mémoire résidente (tampons hors tas compris), relevée toutes les 100 ms par le parent | `ANALYSE_MEMOIRE_MAX_MO` | 1 024 Mo | enfant arrêté de force |
| Taille du résultat renvoyé | `ANALYSE_SORTIE_MAX_OCTETS` | 8 Mo | enfant arrêté, résultat rejeté |
| Éléments du résultat | (schéma) | 60 pages lues par PDF, 20 000 lignes par page, champs de longueur bornée | résultat rejeté |

Un enfant qui plante, boucle, dépasse sa mémoire ou renvoie une sortie invalide ne fait pas tomber le worker et ne met pas la tâche en échec : la pièce passe « à contrôler » avec un motif en français (« Analyse interrompue : … La pièce est conservée telle quelle… »), sans message de bibliothèque ; le fichier original n'est pas modifié ; la cause technique (`delai`, `memoire`, `sortie_trop_grande`, `sortie_invalide`, `plantage`) va au journal du worker avec l'identifiant de la pièce. Seule l'impossibilité de LANCER l'enfant met la tâche en échec (elle est retentée).

**Cloisonnement de l'enfant, tel qu'il est réellement obtenu** (Node 24.22) :

- *Environnement* : vide (`env: {}`) — aucune variable de connexion, aucun jeton, pas de `NODE_OPTIONS` hérité.
- *Système de fichiers, processus, modules natifs* : modèle de permissions de Node (`--permission`). Lecture limitée au code de l'enfant et à ses dépendances (`apps/worker/dist`, `apps/worker/node_modules`, `node_modules`, `packages/core`) ; ni le fichier `.env`, ni `/etc`, ni le reste du dépôt. Aucune écriture, aucun processus fils, aucun fil d'exécution, aucun module natif, pas de WASI. Limite documentée par Node : les liens symboliques sont suivis ; ceux de `node_modules` (pnpm) donnent donc aussi accès en lecture au code des autres paquets du dépôt (`packages/*`), qui ne contient aucun secret ; l'enfant ne peut créer aucun lien, faute de droit d'écriture. `eval` et `new Function` sont refusés (`--disallow-code-generation-from-strings`).
- *Réseau* : Node 24 n'a PAS d'interdiction du réseau dans son modèle de permissions (`--allow-net` n'existe qu'à partir de Node 25). L'enfant neutralise donc lui-même, avant de charger les lecteurs, les points d'entrée réseau de Node (TCP et donc TLS/HTTP/fetch, écoute, UDP, DNS) : `analyse-verrou.ts`. C'est un **verrou applicatif, pas un bac à sable du noyau** : il arrête un accès réseau qu'un lecteur déclencherait (ressource distante, DTD), il ne résisterait pas à une exécution de code natif arbitraire dans l'enfant. Le modèle de permissions de Node est lui-même présenté par sa documentation comme un garde-fou contre les accès involontaires d'un code de confiance, non comme une barrière contre un code malveillant.
- *XML* : toute déclaration DOCTYPE ou ENTITY est refusée avant analyse (pas d'entité externe, pas de bombe d'entités), profondeur limitée à 64 niveaux.

**Limites connues du mode « processus » (défaut).** Pas d'isolation par le noyau (espaces de noms, seccomp, utilisateur distinct) : l'enfant tourne sous le même utilisateur et dans le même conteneur que le worker ; la barrière réseau forte reste celle du déploiement. L'isolation par le noyau existe désormais en mode « conteneur » (section suivante). Un worker tué brutalement (SIGKILL) pendant une analyse peut laisser un enfant en cours jusqu'à la fin de son propre traitement ; en conteneur, l'arrêt du processus principal emporte tous les processus. La mémoire résidente est relevée par sondage (100 ms) : un dépassement très bref peut précéder l'arrêt. Deux pièces sont analysées à la fois : prévoir jusqu'à 2 × 1 024 Mo pour les enfants, en plus du tas du worker. Les lots de lignes d'un FEC et les mouvements d'un relevé sont validés par schéma dans le processus du worker : cette validation, et l'analyse JSON qui la précède, restent le seul traitement de données venues d'un fichier dans ce processus.

**Coût mesuré** (2026-11-19, machine de développement macOS arm64, Node 24.22.3, médiane de 15 lectures ; « avant » = même lecteur appelé dans le processus, pdf.js déjà chargé) : XML UBL 0 → 106 ms ; PDF 1 page 1 → 135 ms ; PDF 10 pages 12 → 158 ms ; PDF 60 pages denses 62 → 214 ms ; PDF de 48 Mo 2 → 156 ms. Soit 105 à 155 ms par pièce (démarrage de Node et chargement du lecteur), indépendant de la taille. Mémoire résidente maximale de l'enfant : 158 Mo (60 pages denses), 248 Mo (PDF de 48 Mo). Une bombe de décompression PDF (1 Mo déployé en 300 Mo) est arrêtée pour mémoire après 18 s avec les bornes par défaut.

Essais : `apps/worker/src/analyse-isolee.itest.ts` (enfant réel et enfant hostile `apps/worker/essais/enfant-hostile.mjs`, lancé avec les mêmes options).

### Exécution dans des conteneurs dédiés : `ANALYSE_ISOLATION=conteneur` (D-098)

Défaut : `processus` (ci-dessus). En mode `conteneur`, le MÊME code compilé (`analyse-enfant.js`) s'exécute dans un conteneur créé pour UN fichier, puis supprimé. Même protocole (en-tête, octets, résultat ou trames), même validation par schéma côté worker, mêmes types et mêmes causes d'échec : les appelants (pièces, relevés, FEC) ne changent pas.

| | Mode `processus` (défaut) | Mode `conteneur` |
|---|---|---|
| Réseau | Verrou applicatif dans l'enfant (pas une barrière du noyau) | `--network none` : aucune interface hors la boucle locale ; TCP, DNS et UDP échouent (testé) |
| Système de fichiers | Permissions de Node : lecture de `dist` et `node_modules`, aucune écriture | Racine en lecture seule ; seul écrivable : un tmpfs de 64 Mo, `noexec,nosuid,nodev` ; permissions de Node conservées en plus |
| Identité et privilèges | Utilisateur du worker | UID 65532 sans compte, `--cap-drop ALL`, `no-new-privileges`, seccomp et AppArmor par défaut du moteur |
| Mémoire | Sondage de la mémoire résidente toutes les 100 ms | `--memory` = `--memory-swap` : arrêt par le noyau (cause `memoire` lue dans `State.OOMKilled`) |
| Processus et fils | Interdits par Node | `--pids-limit 64` (processus et fils d'exécution) |
| Processeur | Non borné | `--cpus 1` |
| Durée | Minuterie du parent, SIGKILL | Minuterie du parent, suppression du conteneur (tuer le client ne l'arrêterait pas) |
| Environnement | Vide | Aucune variable : ni `-e`, ni fichier d'environnement ; l'image n'en porte aucune de sensible |
| Fichiers de l'hôte, `.env`, socket du moteur | Hors des chemins lisibles | Absents : aucun montage, `.env` exclu du contexte de construction, jamais `--privileged` |
| Entrée / sortie | Tubes du processus | Entrée et sortie standard du client `docker run -i` : rien d'autre n'est échangé ; `--log-driver none` |
| Coût mesuré | 105 à 155 ms par pièce | Voir « Coût » ci-dessous |

**Parent.** `apps/worker/src/analyse-conteneur.ts` impose les options en dur (jamais issues du fichier ni d'une variable ; les nombres de la configuration sont bornés dans le code), nomme le conteneur `comtaple-analyse-<uuid>`, lui pose l'étiquette `comtaple.analyse=<uuid>` et une date d'expiration, constate puis supprime SON conteneur (retrouvé par étiquette ET nom) à la fin de chaque analyse, sur délai, erreur ou annulation. Aucun nettoyage global, aucun `prune`. Les conteneurs oubliés par un worker tué brutalement sont retirés quand leur date d'expiration est passée, au démarrage puis toutes les 5 minutes. L'image est locale, `--pull never`.

**Image** (`Dockerfile`, cible `analyse`) : Node 24.22.3 (base de l'application), les sept fichiers compilés de l'enfant, le paquet de cœur et 13 paquets de dépendances (51 Mo) ; aucun code du worker, aucune clé, aucun `.env`. Préparée par `scripts/preparer-image-analyse.mjs`, vérifiée en exécutant l'enfant réel sur l'arbre produit.

**Production : pas de socket dans le worker.** Le worker de production est un conteneur ; lui monter le socket du moteur reviendrait à lui donner l'hôte. Le moteur est piloté par un **lanceur restreint** (`scripts/lanceur-analyse.mjs`, cible `lanceur`), proxy filtrant de l'API du moteur : seul à monter le socket, sans réseau, joignable par le seul worker par un socket Unix partagé. Il reconstruit lui-même chaque demande de création avec des valeurs imposées (image fixée, options ci-dessus, plafonds), refuse tout écart, n'autorise que `attach`, `wait`, `start`, inspection, journaux, `kill` et suppression sur des conteneurs d'analyse (étiquette et nom lus auprès du moteur), liste restreinte à ces conteneurs, nombre simultané plafonné ; tout le reste est refusé (images, volumes, réseaux, `exec`, système, archives, `prune`, conteneurs sans étiquette). Le worker utilise le client docker (image `worker-conteneurs`) avec `DOCKER_HOST` sur ce socket. Dans `infra/production/compose.production.yaml`, le service est au profil facultatif `analyse-conteneur`, désactivé par défaut.

Autres voies examinées : socket monté dans le worker (refusé : équivaut à l'accès administrateur de l'hôte) ; Docker dans Docker (refusé : conteneur privilégié) ; hôte d'analyse séparé (plus fort, non implémenté : une seconde instance et un canal authentifié entre elles).

**Ce qui est vérifié, et ce qui ne l'est pas.** Vérifié sur le moteur réel (Colima, Docker 29.5.2), avec une image d'essai locale et des enfants d'essai Python passant par le même code et les mêmes options : confinement (réseau, écriture, tmpfs borné, identité, capacités, élévation, montage, variables, socket, fichiers de l'hôte), arrêt sur durée, mémoire et nombre de processus (bombe de processus), sorties excessive ou invalide, plantage, simultanéité, orphelins, absence de conteneur résiduel, refus du lanceur (24 demandes de création, 23 routes, client détourné, plafond), flux de FEC à travers le conteneur. **Non vérifié, faute de Node pour Linux en local (aucune image locale n'en contient et aucun téléchargement n'est permis)** : la construction du Dockerfile (`analyse`, `lanceur`, `worker-conteneurs`), l'exécution de l'enfant réel dans un conteneur, l'équivalence des résultats pièces / relevés / FEC entre les deux modes (essais écrits, ignorés tant que l'image `comtaple-analyse:dev` est absente), le coût réel par pièce, l'arrêt pour mémoire du tas de Node. Procédure : `docker build --target analyse -t comtaple-analyse:dev .` puis `ESSAIS_CONTENEUR=1 pnpm --filter @comtaple/worker run test:integration`.

**Coût mesuré** (2026-11-20, mêmes machine et moteur). Mécanisme de conteneur seul (création, démarrage d'un enfant Python minimal, exécution, constat, suppression) : médiane 192 ms, minimum 162, maximum 244 sur 15 lancements ; les 105 à 155 ms du démarrage de Node et du chargement du lecteur s'y ajoutent en mode conteneur, soit une estimation de 300 à 350 ms par pièce (NON MESURÉE avec l'enfant réel). Par le lanceur : médiane 183 ms contre 202 ms en direct sur 20 lancements du même enfant minimal, soit aucun surcoût mesurable. Flux en entrée à travers le conteneur : 291 Mo/s. Contre-pression d'un FEC (enfant d'essai émettant une trame de 12 Ko par 4 Ko lus, parent arrêté 2 s) : 21,6 Mo lus sur 64 Mo comme sur 160 Mo, contre moins de 3 Mo en mode processus ; le plafond ne croît pas avec la taille du fichier, ces tampons étant dans le client docker et le moteur et non dans la mémoire du worker : le FEC suit donc le mode choisi.

**Limites du mode conteneur.** Le conteneur partage le noyau de l'hôte : seccomp et AppArmor par défaut réduisent la surface sans valoir une machine virtuelle ; pas de profil seccomp plus strict, pas de `userns-remap`, pas de gVisor ni Kata (non évalués). Le lanceur détient le socket du moteur : sa compromission est celle de l'hôte (surface réduite à un petit proxy sans dépendance, pas nulle). L'enfant de PID 1 d'un conteneur ignore les signaux qu'il s'envoie à lui-même : un plantage se constate par défaut de segmentation, non par `kill`. Jamais démarré sur un hôte de production. La CI GitHub n'exécute pas ces essais (désactivés sans `ESSAIS_CONTENEUR=1`).

Essais : `apps/worker/src/analyse-conteneur.itest.ts` (moteur réel), `apps/worker/src/analyse-conteneur.test.ts` (options imposées, unitaires).

### Relevés bancaires, FEC et messages de la collecte par mail

| Entrée | Où elle est décodée | Bornes |
|---|---|---|
| Relevé bancaire (camt.053, OFX, CSV, document d'agrégation) | Enfant, un par fichier : détection de l'encodage et du format, analyse XML, OFX, CSV (`apps/worker/src/releve-contenu.ts`). Le parent lit le stockage, valide le profil de colonnes de la demande, valide le résultat par schéma, écrit en base. | Fichier : 20 Mo. Durée, tas et mémoire : celles des pièces. Résultat : `ANALYSE_RELEVE_SORTIE_MAX_OCTETS` (192 Mo) et 200 000 mouvements. |
| FEC | Enfant, EN FLUX (`apps/worker/src/fec-contenu.ts`) : les octets passent du stockage à l'entrée de l'enfant, les lignes normalisées reviennent par lots de 500 au plus (ou 1 Mo) dans des trames, puis le rapport. Le parent valide chaque lot par schéma, insère, tient la progression et l'annulation. | Fichier : `TAILLE_MAX_FEC` (500 Mo, au dépôt). Durée de l'import complet : `ANALYSE_FEC_DUREE_MAX_MS` (1 h). Tas et mémoire : celles des pièces. Une trame : 16 Mo. Une ligne : 1 Mo (analyseur). |
| Message de la collecte par mail | Processus du worker. Le paquet `@comtaple/mail` ne décode PAS de MIME : Gmail et Microsoft Graph rendent des messages déjà analysés, en JSON, lus par `JSON.parse`. Les pièces jointes sont déposées telles quelles puis analysées comme toute pièce (enfant). | Réponse JSON : 64 Mo. Arbre des parties : 20 niveaux, 2 000 parties, 200 pièces par message. Corps : 256 Ko lus, 500 caractères conservés. Nom de pièce : assaini, 255 caractères. Image examinée (en-tête PNG/JPEG seulement) : 300 Ko. Pièce : taille maximale de la connexion. |

**Relevés.** Le résultat porte tous les mouvements : 381 à 421 octets par mouvement sur les jeux synthétiques (CSV, OFX, camt.053), jusqu'à 1 Ko environ avec des libellés et références à leur longueur maximale. La borne de sortie des pièces (8 Mo) refuserait un relevé légitime de plus de 20 000 mouvements environ ; celle des relevés (192 Mo) en admet 200 000. Au-delà, le lot est en échec avec la demande de scinder le relevé. Mesures (2026-11-19, même machine) : camt.053 de 2 000 mouvements 184 ms ; 20 000 mouvements 642 ms (camt.053), 267 ms (OFX), 250 ms (CSV) ; camt.053 de 55 000 mouvements (18,6 Mo, proche de la taille maximale) 1 437 ms ; CSV de 100 000 mouvements (résultat de 36,4 Mo) 690 à 770 ms. Un échec de l'enfant (durée, mémoire, sortie, plantage) met le lot en échec avec un motif en français ; la tâche n'est pas retentée ; le lot peut être relancé.

**FEC.** Contre-pression de bout en bout : tant que le parent n'a pas inséré un lot, il ne lit plus la sortie de l'enfant ; le tube plein bloque l'enfant, qui cesse de lire son entrée ; le parent cesse alors de lire le stockage (vérifié par test : moins de 3 Mo lus sur 14 Mo pendant une pause du parent). La mémoire du worker ne porte qu'un lot à la fois. L'import reste une seule transaction : idempotence (les lignes du lot sont remplacées), reprise (un lot en échec peut être relancé), annulation en cours d'import (point de contrôle toutes les 5 000 lignes, puis à l'activation) et progression sont inchangées. Le rapport rendu par l'enfant n'est accepté que si le nombre de lignes reçues est celui qu'il annonce ; le référentiel de conformité est reposé par le parent. Un échec de l'enfant abandonne la transaction (aucune ligne gardée, données actives intactes) et met le lot en échec avec un motif en français, sans nouvel essai automatique. Mesures sur un FEC synthétique de 106 072 lignes (14,2 Mo) : analyse seule, sans base, 303 à 320 ms dans le processus contre 478 à 587 ms dans l'enfant (lancement du processus, sérialisation et validation des lots compris), soit environ 2 microsecondes de plus par ligne ; import complet avec insertions PostgreSQL, trois passes sur une machine occupée : 6,9 / 9,3 / 17,4 s dans le processus contre 7,3 / 10,1 / 8,3 s dans l'enfant — l'écart est inférieur à la variation d'une passe à l'autre, les insertions dominent. Mémoire résidente du processus de test pendant l'import isolé : pas de croissance mesurable (441 → 466 Mo, puis 574 → 372 et 601 → 389 Mo, le jeu de 14 Mo et ses 106 072 lignes de référence étant déjà en mémoire dans le test).

**Mail : pourquoi pas d'enfant.** Aucune bibliothèque de décodage n'est chargée par `@comtaple/mail` (seule dépendance : zod) ; le découpage MIME, le décodage des encodages de transfert et des jeux de caractères sont faits par Google et Microsoft. Ce que le worker exécute sur des données venues d'un message : `JSON.parse` (moteur JavaScript), un parcours borné de l'arbre des parties, des expressions régulières bornées sur 200 000 caractères de corps au plus, la lecture de deux entiers dans l'en-tête d'une image de 300 Ko au plus, et un calcul d'empreinte. Les octets des pièces jointes ne sont pas interprétés : ils sont transmis au dépôt, et c'est l'analyse des pièces (enfant) qui les décode. Un enfant n'apporterait ici que le coût d'un processus par message.

Essais : `apps/worker/src/isolement-imports.itest.ts` (relevés et FEC sains comparés à la lecture directe, fichiers hostiles, enfant hostile, chaînes `importerReleve` et `importerFec` sur PostgreSQL), `packages/mail/src/hostiles.test.ts`.

## Cycle de vie d'un import comptable

1. Téléversement reprenable avec `usage: fec` → lot d'import (clé d'idempotence = exercice + empreinte).
2. Worker — lecture en flux, normalisation, rapport (lisible / conforme / suffisant), activation du lot, incrément de `version_donnees`, marquage des travaux antérieurs.
3. Exécution des contrôles sur le lot actif → résultats (cinq statuts) et constats.
4. Revue humaine des constats ; dossier de révision (PDF + JSON + inventaire) figé sur une exécution.

## Modèle de données

Le schéma complet et commenté est `packages/db/src/schema.ts` ; les règles de sécurité sont dans `packages/db/migrations/0001_securite.sql`. Tables par domaine :

- Identités : `cabinets`, `utilisateurs`, `appartenances`, `habilitations_dossier`.
- Dossiers : `entites`, `etablissements`, `exercices`, `missions`, `lettres_mission`.
- Collecte : `televersements`, `fichiers`, `documents`, `receptions`, `pages_document`, `extractions`, `echanges_document`.
- Comptabilité : `lots_import`, `lignes_ecriture`, `mouvements_bancaires`, `factures`, `rapprochements`.
- Révision : `executions_controles`, `resultats_controles`, `constats`, `decisions`, `commentaires`, `regles_cabinet`, `exports_revision`.
- IA et veille : `propositions_ia`, `sources_reglementaires`.
- Messagerie : `connexions_mail`, `messages_mail`.
- Abonnements : `abonnements`, `evenements_facturation`.
- Audit et conservation : `journal_audit`, `politiques_conservation`.

Plusieurs de ces tables sont modélisées sans fonctionnalité encore branchée dessus ; l'état réel par fonctionnalité est dans `docs/couverture.md`.
