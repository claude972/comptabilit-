#!/bin/sh
# ESSAI DE LA RÉTENTION DES TRACES avec une DURÉE D'ESSAI (P4, D-102) : Tempo (image de infra/supervision) avec une rétention de quelques
# minutes, une trace connue envoyée par le collecteur, puis observation de sa SUPPRESSION EFFECTIVE par l'entrepôt.
#
# Ressources jetables : projet Compose `essai-retention` (collecteur + Tempo, ports 127.0.0.1:23200, 24317, 24318), volumes propres,
# supprimés à la fin même en cas d'échec. Ne touche ni à l'application, ni à ses conteneurs, ni à la pile `comtaple`.
#   1. Tempo démarre avec TEMPO_RETENTION=<durée d'essai> (défaut 3m), TEMPO_RETENTION_INTERVALLE=1m, TEMPO_BLOCS_COMPACTES=1m ;
#   2. une trace OTLP/HTTP à identifiant connu est envoyée au collecteur ; elle est retrouvée dans Tempo (GET /api/traces/<id>) ;
#   3. on attend : le temps que Tempo clôture un bloc (ou le force par /flush), puis que la rétention l'échoie ; la trace doit
#      DISPARAÎTRE (HTTP 404) ; l'instant de disparition est mesuré ;
#   4. une seconde trace envoyée APRÈS reste lisible tant qu'elle n'a pas atteint sa propre rétention (la suppression est par âge).
# La durée de production (72 h) n'est PAS éprouvée (trois jours d'attente) : seul le MÉCANISME l'est, avec une durée courte.
# Usage : scripts/essai-retention-traces.sh [durée de rétention d'essai, ex. 3m]     Codes : 0 conforme ; 1 écart ; 2 essai impossible.
set -eu
cd "$(dirname "$0")/.."
. "$HOME/.comtaple-outils/env.sh"
PROJET="${ESSAI_PROJET:-essai-retention}"
PORT_TEMPO="${ESSAI_PORT_TEMPO:-23200}"
PORT_OTLP_HTTP="${ESSAI_PORT_OTLP_HTTP:-24318}"
RETENTION="${1:-3m}"
export GRAFANA_MDP_ADMIN=inutilise VERSION=essai-retention
export TEMPO_PORT=$PORT_TEMPO OTLP_PORT_GRPC="${ESSAI_PORT_OTLP_GRPC:-24317}" OTLP_PORT_HTTP=$PORT_OTLP_HTTP
export TEMPO_RETENTION="$RETENTION" TEMPO_RETENTION_INTERVALLE=1m TEMPO_BLOCS_COMPACTES=1m TEMPO_LIVE_STORE_DUREE="${TEMPO_LIVE_STORE_DUREE:-20m}"
supervision() { docker compose -p "$PROJET" --env-file infra/supervision/local.env -f infra/supervision/compose.supervision.yaml "$@"; }
nettoyer() { supervision down -v --remove-orphans >/dev/null 2>&1 || true; docker image rm "comtaple/comtaple-tempo:essai-retention" >/dev/null 2>&1 || true; }
docker ps -a --format '{{.Names}}' | grep -q "^$PROJET-" && { echo "Des conteneurs $PROJET-* existent déjà : les supprimer d'abord." >&2; exit 2; }
trap nettoyer EXIT INT TERM
echo "Rétention d'essai : $RETENTION (vérification toutes les minutes ; blocs compactés conservés 1 minute) ; live store : ${TEMPO_LIVE_STORE_DUREE:-20m}."
supervision up -d --build --quiet-pull tempo collecteur 2>&1 | grep -v '^$' | tail -3
i=0; until curl -sf -m 2 "http://127.0.0.1:$PORT_TEMPO/ready" >/dev/null; do i=$((i + 1)); [ "$i" -gt 90 ] && { echo "Tempo n'est pas prêt" >&2; docker logs --tail 15 "$PROJET-tempo-1" >&2; exit 2; }; sleep 1; done
T0=$(date +%s)
envoyer() { # envoyer <identifiant de trace sur 32 hex>
  NS=$(node -e 'console.log(String(BigInt(Date.now()) * 1000000n))')
  curl -sf -m 10 -H 'content-type: application/json' "http://127.0.0.1:$PORT_OTLP_HTTP/v1/traces" -d "{\"resourceSpans\":[{\"resource\":{\"attributes\":[{\"key\":\"service.name\",\"value\":{\"stringValue\":\"essai-retention\"}}]},\"scopeSpans\":[{\"spans\":[{\"traceId\":\"$1\",\"spanId\":\"00000000000000a1\",\"name\":\"essai retention\",\"kind\":1,\"startTimeUnixNano\":\"$NS\",\"endTimeUnixNano\":\"$NS\"}]}]}]}" >/dev/null
}
code_trace() { curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT_TEMPO/api/traces/$1"; }
ID1=aaaaaaaa00000000000000000000e001
envoyer "$ID1"
i=0; until [ "$(code_trace $ID1)" = "200" ]; do i=$((i + 1)); [ "$i" -gt 60 ] && { echo "ÉCHEC : la trace envoyée n'est jamais devenue lisible"; exit 1; }; sleep 2; done
echo "Trace 1 lisible dans Tempo après $(( $(date +%s) - T0 )) s."
# Forcer la clôture du bloc (sinon la trace reste dans le journal d'écriture, que la rétention ne vise pas).
curl -s -m 10 -o /dev/null "http://127.0.0.1:$PORT_TEMPO/flush" || true
ECHECS=0
DISPARUE=""
LIMITE=$(( T0 + 60 * ($(echo "$RETENTION" | tr -d 'm') + $(echo "${TEMPO_LIVE_STORE_DUREE:-20m}" | tr -d 'm') + 5) ))
while [ "$(date +%s)" -lt "$LIMITE" ]; do
  if [ "$(code_trace $ID1)" = "404" ]; then DISPARUE=$(( $(date +%s) - T0 )); break; fi
  curl -s -m 10 -o /dev/null "http://127.0.0.1:$PORT_TEMPO/flush" || true
  sleep 15
done
if [ -n "$DISPARUE" ]; then echo "[CONFORME] trace 1 SUPPRIMÉE par la rétention : disparue après $DISPARUE s (rétention d'essai $RETENTION)"; else echo "[ÉCHEC   ] trace 1 toujours lisible après $(( $(date +%s) - T0 )) s"; ECHECS=$((ECHECS + 1)); fi
if [ -n "$DISPARUE" ]; then
  ID2=bbbbbbbb00000000000000000000e002
  envoyer "$ID2"; sleep 8
  [ "$(code_trace $ID2)" = "200" ] && echo "[CONFORME] une trace plus récente reste lisible (suppression par âge, pas en bloc)" || { echo "[ÉCHEC   ] trace récente illisible"; ECHECS=$((ECHECS + 1)); }
fi
echo "Journal de Tempo (lignes d'erreur) : $(docker logs "$PROJET-tempo-1" 2>&1 | grep -ci 'level=error' || true)"
[ "$ECHECS" = "0" ] && echo "Rétention des traces (durée d'essai $RETENTION) : MÉCANISME ÉPROUVÉ ; durée de production non éprouvée" || echo "Rétention des traces : ÉCART"
exit "$ECHECS"
