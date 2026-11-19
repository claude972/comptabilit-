#!/bin/sh
# Démarre ou arrête l'API et le worker en local (journaux dans var/). Usage : scripts/applis.sh demarrer|arreter|etat
set -eu
cd "$(dirname "$0")/.."
. "$HOME/.comtaple-outils/env.sh"
mkdir -p var
arreter() {
  for nom in api worker; do
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
    (cd apps/worker && exec node dist/main.js) > var/worker.log 2>&1 &
    echo $! > var/worker.pid
    i=0
    until curl -sf -m 2 http://127.0.0.1:4000/v1/sante >/dev/null; do
      i=$((i + 1)); [ "$i" -gt 40 ] && { echo "L'API ne répond pas : voir var/api.log"; exit 1; }
      sleep 0.5
    done
    echo "API : http://127.0.0.1:4000 (documentation /docs) — worker démarré." ;;
  arreter) arreter; echo "Arrêtés." ;;
  etat)
    for nom in api worker; do
      if [ -f "var/$nom.pid" ] && kill -0 "$(cat "var/$nom.pid")" 2>/dev/null; then echo "$nom : en marche"; else echo "$nom : arrêté"; fi
    done ;;
esac
