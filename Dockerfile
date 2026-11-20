# Images applicatives (API, worker, web). Construction :
#   docker build --target api    -t comtaple-api:dev .
#   docker build --target worker -t comtaple-worker:dev .
#   docker build --target web    -t comtaple-web:dev .
#   docker build --target worker-conteneurs -t comtaple-worker-conteneurs:dev .   (worker + client docker, mode conteneur)
#   docker build --target analyse -t comtaple-analyse:dev .     (image d'analyse isolée, D-098 ; jamais téléchargée à l'exécution)
#   docker build --target lanceur -t comtaple-lanceur:dev .     (lanceur restreint des conteneurs d'analyse, D-098)
# Aucun secret n'entre dans les images : toute la configuration vient de l'environnement à l'exécution.
FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NODE_ENV=production
RUN corepack enable
WORKDIR /app

# ── Dépendances et construction des paquets serveur ──
FROM base AS serveur
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
RUN NODE_ENV=development pnpm install --frozen-lockfile --filter "@comtaple/api..." --filter "@comtaple/worker..."
RUN pnpm --filter "@comtaple/api..." --filter "@comtaple/worker..." run build

FROM serveur AS api
# Tas de l'API plafonné EXPLICITEMENT (D-093) : 768 Mo dans un conteneur limité à 1 Go. Sans cette option, la limite de tas de Node dépend de la
# mémoire que Node voit (non mesurée en conteneur) : 264 957 lignes d'écriture font tomber une API dont le tas est à 320 Mo. Le plafond de
# lignes des calculs immédiats (API_LIGNES_MAX_CALCUL) va avec : relever l'un sans l'autre déplace le problème.
ENV API_HOTE=0.0.0.0 METRIQUES_HOTE=0.0.0.0 NODE_OPTIONS=--max-old-space-size=768
USER node
EXPOSE 4000 9464
CMD ["node", "apps/api/dist/main.js"]

FROM serveur AS worker
# Chromium et ses bibliothèques système pour le rendu PDF hors ligne du dossier de révision.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright METRIQUES_HOTE=0.0.0.0
RUN pnpm --filter @comtaple/worker exec playwright install --with-deps chromium && chmod -R a+rx /ms-playwright && rm -rf /var/lib/apt/lists/*
# Point de montage du socket du lanceur restreint (D-098), même propriétaire dans l'image du lanceur : le volume partagé hérite de ces
# droits (utilisateur 65532 du lanceur, groupe 1000 = groupe de `node`). Dossier vide et inutilisé en mode « processus ».
RUN mkdir -p /run/lanceur && chown 65532:1000 /run/lanceur && chmod 2770 /run/lanceur
USER node
EXPOSE 9465
# Tas plafonné d'après les mesures (D-061) : au-delà, le processus s'arrête et les traitements en cours sont repris au
# redémarrage. À ajuster avec LIGNES_MAX_PAR_TRAITEMENT, jamais l'un sans l'autre.
ENV NODE_OPTIONS=--max-old-space-size=2048
CMD ["node", "apps/worker/dist/main.js"]

# ── Worker + client docker, pour le mode `ANALYSE_ISOLATION=conteneur` (D-098) ──
# Le client docker pilote le LANCEUR restreint (DOCKER_HOST = socket du lanceur), jamais le socket du moteur. Variante facultative :
# l'image `worker` ci-dessus reste celle du mode par défaut. Le client est copié depuis l'image officielle du client (étiquette figée).
FROM docker:29.10.0-cli@sha256:34507eb5069d8be82c95dd3b6987d4250fd5fee49b82e2509b7d7a7030740d6d AS client-docker
FROM worker AS worker-conteneurs
COPY --from=client-docker /usr/local/bin/docker /usr/local/bin/docker

# ── Analyse isolée des fichiers non fiables (D-098) ──
# Contenu MINIMAL : les 7 fichiers compilés de l'enfant, le paquet de cœur et la fermeture de leurs dépendances de production
# (scripts/preparer-image-analyse.mjs). Ni le code du worker, ni sources, ni outils de test, ni `.env` (exclu du contexte par
# .dockerignore), ni clé, ni variable de connexion : l'image ne contient rien de secret. Le conteneur est lancé par le worker avec
# des options imposées (sans réseau, sans privilège, racine en lecture seule, bornes de mémoire, de processus et de durée) :
# voir apps/worker/src/analyse-conteneur.ts. Même disposition que le dépôt sous /app, donc mêmes chemins de lecture que le mode processus.
FROM serveur AS analyse-contenu
COPY scripts/preparer-image-analyse.mjs /preparer/preparer-image-analyse.mjs
RUN node /preparer/preparer-image-analyse.mjs /app /analyse && chmod -R a+rX,go-w /analyse

FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS analyse
ENV NODE_ENV=production
COPY --from=analyse-contenu /analyse /app
WORKDIR /app
# Utilisateur numérique sans compte : le worker l'impose aussi à l'exécution (--user 65532:65532).
USER 65532:65532
ENTRYPOINT ["node"]
CMD ["--permission", "--allow-fs-read=/app/apps/worker/dist", "--allow-fs-read=/app/apps/worker/node_modules", "--allow-fs-read=/app/apps/worker/package.json", "--allow-fs-read=/app/node_modules", "--allow-fs-read=/app/packages/core", "--disallow-code-generation-from-strings", "/app/apps/worker/dist/analyse-enfant.js"]

# ── Lanceur restreint des conteneurs d'analyse (D-098) : un seul fichier, aucune dépendance ──
FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS lanceur
ENV NODE_ENV=production
COPY scripts/lanceur-analyse.mjs /app/lanceur.mjs
RUN mkdir -p /run/lanceur && chown 65532:1000 /run/lanceur && chmod 2770 /run/lanceur
WORKDIR /app
USER 65532:65532
ENTRYPOINT ["node", "/app/lanceur.mjs"]

# ── Application web ──
FROM base AS web
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/web apps/web
RUN NODE_ENV=development pnpm install --frozen-lockfile --filter "@comtaple/web..."
RUN pnpm --filter "@comtaple/web..." run build
WORKDIR /app/apps/web
USER node
EXPOSE 3100
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3100", "--hostname", "0.0.0.0"]
