#!/bin/sh
# Démarre ou arrête l'API et le worker en local (journaux dans var/).
# Le tas du worker est plafonné (WORKER_TAS_MAX_MO, 2 048 Mo par défaut) : voir docs/decisions.md, D-061. Usage : scripts/applis.sh demarrer|arreter|etat|web|serveur
set -eu
cd "$(dirname "$0")/.."
. "$HOME/.comtaple-outils/env.sh"
mkdir -p var
arreter() {
  for nom in api worker web; do
    if [ -f "var/$nom.pid" ]; then
      kill "$(cat "var/$nom.pid")" 2>/dev/null || true
      rm -f "var/$nom.pid"
    fi
  done
}
case "${1:-etat}" in
  demarrer)
    arreter
    (cd apps/api && exec node dist/main.js) > var/api.log 2>&1 &
    echo $! > var/api.pid
    (cd apps/worker && NODE_OPTIONS="--max-old-space-size=${WORKER_TAS_MAX_MO:-2048}" exec node dist/main.js) > var/worker.log 2>&1 &
    echo $! > var/worker.pid
    i=0
    until curl -sf -m 2 http://127.0.0.1:4000/v1/sante >/dev/null; do
      i=$((i + 1)); [ "$i" -gt 40 ] && { echo "L'API ne répond pas : voir var/api.log"; exit 1; }
      sleep 0.5
    done
    if [ -d apps/web/.next ]; then
      (cd apps/web && exec node node_modules/next/dist/bin/next start --port 3100) > var/web.log 2>&1 &
      echo $! > var/web.pid
      echo "Web : http://localhost:3100"
    else
      echo "Web : non construit (pnpm --filter @comtaple/web run build)"
    fi
    echo "API : http://127.0.0.1:4000 (documentation /docs) — worker démarré." ;;
  serveur)
    # Redémarre UNIQUEMENT l'API et le worker (sans toucher à l'application web).
    for nom in api worker; do [ -f "var/$nom.pid" ] && kill "$(cat "var/$nom.pid")" 2>/dev/null || true; done
    (cd apps/api && exec node dist/main.js) > var/api.log 2>&1 &
    echo $! > var/api.pid
    (cd apps/worker && NODE_OPTIONS="--max-old-space-size=${WORKER_TAS_MAX_MO:-2048}" exec node dist/main.js) > var/worker.log 2>&1 &
    echo $! > var/worker.pid
    i=0
    until curl -sf -m 2 http://127.0.0.1:4000/v1/sante >/dev/null; do
      i=$((i + 1)); [ "$i" -gt 40 ] && { echo "L'API ne répond pas : voir var/api.log"; exit 1; }
      sleep 0.5
    done
    echo "API et worker redémarrés." ;;
  web)
    # Reconstruit puis redémarre UNIQUEMENT l'application web (sans toucher à l'API ni au worker). La reconstruction évite
    # de servir un build périmé ; WEB_SANS_BUILD=1 la saute.
    [ "${WEB_SANS_BUILD:-0}" = "1" ] || (cd apps/web && pnpm run build > ../../var/web-build.log 2>&1) || { echo "Échec de la construction du web : voir var/web-build.log"; exit 1; }
    [ -f var/web.pid ] && kill "$(cat var/web.pid)" 2>/dev/null || true
    (cd apps/web && exec node node_modules/next/dist/bin/next start --port 3100) > var/web.log 2>&1 &
    echo $! > var/web.pid
    echo "Web : http://localhost:3100" ;;
  arreter) arreter; echo "Arrêtés." ;;
  etat)
    for nom in api worker web; do
      if [ -f "var/$nom.pid" ] && kill -0 "$(cat "var/$nom.pid")" 2>/dev/null; then echo "$nom : en marche"; else echo "$nom : arrêté"; fi
    done ;;
esac
