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

**Limites connues.** Pas d'isolation par le noyau (espaces de noms, seccomp, utilisateur distinct) : l'enfant tourne sous le même utilisateur et dans le même conteneur que le worker ; la barrière réseau forte reste celle du déploiement. Un worker tué brutalement (SIGKILL) pendant une analyse peut laisser un enfant en cours jusqu'à la fin de son propre traitement ; en conteneur, l'arrêt du processus principal emporte tous les processus. La mémoire résidente est relevée par sondage (100 ms) : un dépassement très bref peut précéder l'arrêt. Deux pièces sont analysées à la fois : prévoir jusqu'à 2 × 1 024 Mo pour les enfants, en plus du tas du worker. L'import de relevés bancaires (XML camt.053, CSV…), l'import FEC et la lecture des messages de la collecte par mail s'exécutent toujours dans le processus du worker.

**Coût mesuré** (2026-11-19, machine de développement macOS arm64, Node 24.22.3, médiane de 15 lectures ; « avant » = même lecteur appelé dans le processus, pdf.js déjà chargé) : XML UBL 0 → 106 ms ; PDF 1 page 1 → 135 ms ; PDF 10 pages 12 → 158 ms ; PDF 60 pages denses 62 → 214 ms ; PDF de 48 Mo 2 → 156 ms. Soit 105 à 155 ms par pièce (démarrage de Node et chargement du lecteur), indépendant de la taille. Mémoire résidente maximale de l'enfant : 158 Mo (60 pages denses), 248 Mo (PDF de 48 Mo). Une bombe de décompression PDF (1 Mo déployé en 300 Mo) est arrêtée pour mémoire après 18 s avec les bornes par défaut.

Essais : `apps/worker/src/analyse-isolee.itest.ts` (enfant réel et enfant hostile `apps/worker/essais/enfant-hostile.mjs`, lancé avec les mêmes options).

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
