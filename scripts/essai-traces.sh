#!/bin/sh
# Essai LOCAL, RÉEL et ÉPHÉMÈRE de la chaîne des traces : application → collecteur OpenTelemetry → entrepôt (Tempo).
#
# Ce que fait l'essai :
#   1. démarre, dans un projet Compose à part (`essai-traces`, ports 13200 et 1431x), le collecteur et Tempo de
#      infra/supervision/compose.supervision.yaml ;
#   2. lance une SECONDE API et un SECOND worker (scripts/essai-traces.mjs : port libre, préfixe de files propre), qui
#      exportent vers ce collecteur ; dépose une pièce réelle et attend son analyse ;
#   3. retrouve dans Tempo, par son API HTTP de recherche, la trace de la requête de dépôt ET le span du worker, et
#      exige qu'ils portent le même identifiant de trace ;
#   4. relit ce que Tempo a stocké et y cherche les données interdites (adresse, jeton, nom de fichier, texte SQL…) ;
#   5. arrête et supprime conteneurs, volumes, réseau et image construite de l'essai, même en cas d'échec.
#
# Avec --chaine-production, les traces suivent le chemin prévu en production : application → agent (service
# `agent-traces` de infra/production/compose.production.yaml) → TLS mutuel → `entree-traces` → collecteur → Tempo, avec
# une autorité de certification et des certificats jetables ; l'essai vérifie aussi qu'une connexion SANS certificat
# client est refusée.
#
# Ne touche ni aux services de scripts/applis.sh, ni aux conteneurs `comtaple-*`. Prérequis : pile locale démarrée
# (PostgreSQL, Redis, S3, Keycloak, antivirus, OCR), `pnpm build` fait. Laisse dans la base locale la pièce déposée.
# Grafana n'est PAS démarré (image volumineuse) : la source de données et le tableau provisionnés ne sont pas essayés ici.
#
# Usage : scripts/essai-traces.sh [--chaine-production] [--garder]
#   --garder : laisse le collecteur et Tempo en marche à la fin (API de Tempo : http://127.0.0.1:13200) ; les
#              supprimer ensuite par : scripts/essai-traces.sh --nettoyer
# Codes : 0 réussi ; 1 un contrôle a échoué (dont : trace commune introuvable) ; 2 essai impossible.
set -eu
cd "$(dirname "$0")/.."
. "$HOME/.comtaple-outils/env.sh"

PROJET=essai-traces
PROJET_AGENT=essai-traces-agent
PORT_TEMPO=13200
PORT_OTLP_GRPC=14317
PORT_OTLP_HTTP=14318
PORT_ENTREE=14319
PORT_AGENT=14320
DISQUE_MIN_GO="${ESSAI_DISQUE_MIN_GO:-3}"
CHAINE=0; GARDER=0; NETTOYER_SEUL=0
for option in "$@"; do
  case "$option" in
    --chaine-production) CHAINE=1 ;;
    --garder) GARDER=1 ;;
    --nettoyer) NETTOYER_SEUL=1 ;;
    *) echo "Option inconnue : $option" >&2; exit 2 ;;
  esac
done

TMP=$(mktemp -d)
# Variables exigées par la composition de supervision, sans objet ici (Grafana et Prometheus ne sont pas démarrés).
export GRAFANA_MDP_ADMIN=inutilise VERSION=essai-traces
export TEMPO_PORT=$PORT_TEMPO OTLP_PORT_GRPC=$PORT_OTLP_GRPC OTLP_PORT_HTTP=$PORT_OTLP_HTTP TRACES_PORT_ENTREE=$PORT_ENTREE
# Rétention d'essai : une heure. Débit : valeurs par défaut de la composition.
export TEMPO_RETENTION="${TEMPO_RETENTION:-1h}" TRACES_AC_PEM="${TRACES_AC_PEM:-}"
supervision() { docker compose -p "$PROJET" --env-file infra/supervision/local.env -f infra/supervision/compose.supervision.yaml --profile acheminement "$@"; }
agent() { docker compose -p "$PROJET_AGENT" --env-file infra/production/exemple.env -f infra/production/compose.production.yaml -f "$TMP/surcharge.yaml" --profile traces "$@"; }

nettoyer() {
  if [ -f "$TMP/surcharge.yaml" ]; then agent down -v --remove-orphans >/dev/null 2>&1 || true; fi
  supervision down -v --remove-orphans >/dev/null 2>&1 || true
  docker image rm "comtaple/comtaple-tempo:essai-traces" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}

if [ "$NETTOYER_SEUL" -eq 1 ]; then
  printf 'services: { agent-traces: {} }\n' > "$TMP/surcharge.yaml"
  nettoyer; echo "Conteneurs, volumes et image de l'essai supprimés."; exit 0
fi

if docker ps -a --format '{{.Names}}' | grep -q "^essai-traces-"; then
  echo "Des conteneurs essai-traces-* existent déjà : scripts/essai-traces.sh --nettoyer" >&2
  rm -rf "$TMP"; exit 2
fi
for f in apps/api/dist/main.js apps/worker/dist/main.js; do
  [ -f "$f" ] || { echo "$f absent : lancer pnpm build." >&2; rm -rf "$TMP"; exit 2; }
done

# Espace libre de la machine Docker (Colima) : l'essai refuse de démarrer sous le seuil.
disque_libre_mo() { colima ssh -- df -Pm /mnt/lima-colima 2>/dev/null | awk 'NR==2 { print $4 }'; }
if command -v colima >/dev/null 2>&1; then
  LIBRE=$(disque_libre_mo || true)
  if [ -n "${LIBRE:-}" ]; then
    echo "Machine Docker : $LIBRE Mo libres avant l'essai."
    if [ "$LIBRE" -lt $((DISQUE_MIN_GO * 1024)) ]; then
      echo "Moins de $DISQUE_MIN_GO Go libres : essai refusé (ESSAI_DISQUE_MIN_GO pour changer le seuil)." >&2
      rm -rf "$TMP"; exit 2
    fi
  fi
fi

[ "$GARDER" -eq 1 ] || trap nettoyer EXIT
trap 'exit 2' INT TERM

echo "── Collecteur et entrepôt (projet $PROJET) ──"
supervision up -d --build --quiet-pull tempo collecteur 2>&1 | grep -v "^$" | tail -4
i=0
until curl -sf -m 2 "http://127.0.0.1:$PORT_TEMPO/ready" >/dev/null; do
  i=$((i + 1)); [ "$i" -gt 90 ] && { echo "Tempo n'est pas prêt :" >&2; docker logs --tail 15 "$PROJET-tempo-1" >&2; exit 2; }
  sleep 1
done
echo "Tempo prêt (http://127.0.0.1:$PORT_TEMPO), rétention $TEMPO_RETENTION."
POINT_ACCES="http://127.0.0.1:$PORT_OTLP_HTTP"

if [ "$CHAINE" -eq 1 ]; then
  echo "── Chaîne de production : agent → TLS mutuel → entrée des traces ──"
  # Autorité et certificats JETABLES (2 jours), jamais écrits ailleurs que dans le dossier temporaire de l'essai.
  cle() { openssl ecparam -name prime256v1 -genkey -noout -out "$1"; }
  cle "$TMP/ac.cle"
  openssl req -x509 -new -key "$TMP/ac.cle" -sha256 -days 2 -subj "/CN=AC essai traces Comtaple" -out "$TMP/ac.pem"
  printf 'subjectAltName=DNS:entree-traces,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' > "$TMP/entree.ext"
  printf 'extendedKeyUsage=clientAuth\n' > "$TMP/agent.ext"
  for nom in entree agent; do
    cle "$TMP/$nom.cle"
    openssl req -new -key "$TMP/$nom.cle" -subj "/CN=$nom-traces" -out "$TMP/$nom.csr"
    openssl x509 -req -in "$TMP/$nom.csr" -CA "$TMP/ac.pem" -CAkey "$TMP/ac.cle" -CAcreateserial -sha256 -days 2 -extfile "$TMP/$nom.ext" -out "$TMP/$nom.pem" 2>/dev/null
  done
  TRACES_AC_PEM=$(cat "$TMP/ac.pem"); export TRACES_AC_PEM
  TRACES_ENTREE_CERT_PEM=$(cat "$TMP/entree.pem") TRACES_ENTREE_CLE_PEM=$(cat "$TMP/entree.cle") supervision up -d entree-traces 2>&1 | tail -1
  # L'agent de la composition de PRODUCTION, tel quel ; la surcharge ne fait que le rendre joignable depuis le poste
  # (port sur 127.0.0.1) et le relier au réseau de l'essai, où il joint l'entrée par son nom.
  cat > "$TMP/surcharge.yaml" <<EOF
services:
  agent-traces:
    ports: ["127.0.0.1:$PORT_AGENT:4318"]
    networks: [traces, sortie-traces, essai]
networks:
  essai:
    external: true
    name: ${PROJET}_default
EOF
  TRACES_ENTREE_SUPERVISION="https://entree-traces:4318" TRACES_AGENT_CERT_PEM=$(cat "$TMP/agent.pem") TRACES_AGENT_CLE_PEM=$(cat "$TMP/agent.cle") \
    agent up -d --no-deps agent-traces 2>&1 | tail -1
  sleep 3
  for c in "$PROJET-entree-traces-1" "$PROJET_AGENT-agent-traces-1"; do
    [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ] || { echo "$c n'a pas démarré :" >&2; docker logs --tail 10 "$c" >&2; exit 2; }
  done
  # Sans certificat client, l'entrée doit refuser la connexion ; avec celui de l'agent, l'accepter.
  SANS=$(curl -s -m 5 -o /dev/null -w '%{http_code}' --cacert "$TMP/ac.pem" -H 'content-type: application/json' -d '{"resourceSpans":[]}' "https://127.0.0.1:$PORT_ENTREE/v1/traces" || true)
  AVEC=$(curl -s -m 5 -o /dev/null -w '%{http_code}' --cacert "$TMP/ac.pem" --cert "$TMP/agent.pem" --key "$TMP/agent.cle" -H 'content-type: application/json' -d '{"resourceSpans":[]}' "https://127.0.0.1:$PORT_ENTREE/v1/traces" || true)
  EN_CLAIR=$(curl -s -m 5 -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"resourceSpans":[]}' "http://127.0.0.1:$PORT_ENTREE/v1/traces" || true)
  echo "Entrée des traces : sans certificat client → $SANS (attendu 000, poignée de main refusée) ; avec → $AVEC (attendu 200) ; en clair → $EN_CLAIR (attendu 400 ou 000)."
  if [ "$SANS" != "000" ] || [ "$AVEC" != "200" ] || [ "$EN_CLAIR" = "200" ]; then echo "ÉCHEC : l'authentification par certificat ne se comporte pas comme attendu." >&2; exit 1; fi
  POINT_ACCES="http://127.0.0.1:$PORT_AGENT"
fi

echo "── Parcours réel et contrôles ──"
CODE=0
ESSAI_POINT_ACCES="$POINT_ACCES" ESSAI_TEMPO_URL="http://127.0.0.1:$PORT_TEMPO" node scripts/essai-traces.mjs || CODE=$?

if [ "$CHAINE" -eq 1 ]; then
  echo "── Journaux de l'agent et de l'entrée (erreurs) ──"
  for c in "$PROJET_AGENT-agent-traces-1" "$PROJET-entree-traces-1"; do
    N=$(docker logs "$c" 2>&1 | grep -c -i "error" || true); echo "$c : $N ligne(s) d'erreur"
  done
fi
echo "── Occupation ──"
docker system df -v 2>/dev/null | awk '$1 ~ /^essai-traces_/ { print "volume " $1 " : " $3 }'
if command -v colima >/dev/null 2>&1; then echo "Machine Docker : $(disque_libre_mo || echo '?') Mo libres après l'essai (avant nettoyage)."; fi
if [ "$GARDER" -eq 1 ]; then echo "Collecteur et Tempo laissés en marche : scripts/essai-traces.sh --nettoyer pour les supprimer."; rm -rf "$TMP"; fi
exit "$CODE"
