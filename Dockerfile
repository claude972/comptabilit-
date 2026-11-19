# Images applicatives (API, worker, web). Construction :
#   docker build --target api    -t comtaple-api:dev .
#   docker build --target worker -t comtaple-worker:dev .
#   docker build --target web    -t comtaple-web:dev .
# Aucun secret n'entre dans les images : toute la configuration vient de l'environnement à l'exécution.
FROM node:24.22.3-bookworm-slim AS base
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
ENV API_HOTE=0.0.0.0 METRIQUES_HOTE=0.0.0.0
USER node
EXPOSE 4000 9464
CMD ["node", "apps/api/dist/main.js"]

FROM serveur AS worker
# Chromium et ses bibliothèques système pour le rendu PDF hors ligne du dossier de révision.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright METRIQUES_HOTE=0.0.0.0
RUN pnpm --filter @comtaple/worker exec playwright install --with-deps chromium && chmod -R a+rx /ms-playwright && rm -rf /var/lib/apt/lists/*
USER node
EXPOSE 9465
# Tas plafonné d'après les mesures (D-061) : au-delà, le processus s'arrête et les traitements en cours sont repris au
# redémarrage. À ajuster avec LIGNES_MAX_PAR_TRAITEMENT, jamais l'un sans l'autre.
ENV NODE_OPTIONS=--max-old-space-size=2048
CMD ["node", "apps/worker/dist/main.js"]

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
