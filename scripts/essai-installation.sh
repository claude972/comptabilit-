#!/bin/sh
# ESSAI D'INSTALLATION REPRODUCTIBLE DEPUIS UN DÉPÔT VIERGE (P4, D-102), sur RESSOURCES JETABLES.
#
# Part d'une COPIE PROPRE du dépôt (fichiers suivis par git + fichiers nouveaux non ignorés ; ni node_modules, ni dist, ni .env, ni var)
# dans un dossier temporaire, et refait la procédure d'installation locale à l'identique :
#   1. pnpm install --frozen-lockfile (verrou respecté : refuse toute dérive) ;
#   2. construction (paquets, API, worker ; l'application web avec --avec-web) ;
#   3. scripts/generer-env.sh : .env neuf, secrets aléatoires, PORTS DISTINCTS de la pile en marche ;
#   4. pile jetable : projet Compose `comtaple-essai-install` (PostgreSQL, Redis, stockage S3 ; volumes propres, ports 15432, 16379,
#      18333) — jamais le projet `comtaple` ni ses volumes ;
#   5. migrations + amorçage, démarrage de l'API sur le port 14000 ; contrôle de la sonde de santé (base, files, stockage ; identité
#      « indisponible » attendue : Keycloak n'est pas dans cette pile) ;
#   6. diagnostic de préparation (scripts/verifier-preparation.mjs) contre cette pile : base, Redis et S3 PRÊTS, Keycloak, antivirus
#      et OCR MANQUANTS (non démarrés) ;
#   7. refus de démarrage en production : la même API avec NODE_ENV=production et les valeurs de développement s'arrête avec un
#      message qui nomme les variables ;
#   8. destruction : API arrêtée (par son PID seulement), projet Compose et volumes supprimés, dossier temporaire supprimé.
#
# NE FAIT PAS : l'installation d'une machine de production (OpenTofu, hôte, registre), la construction des images de production
# (scripts/deployer.sh), Keycloak / antivirus / OCR (essais séparés). Les téléchargements de paquets passent par le registre public npm
# (aucun compte). Prérequis : outillage (`. ~/.comtaple-outils/env.sh`), Docker démarré, ≥ 8 Go libres dans la VM Docker.
# Usage : scripts/essai-installation.sh [--avec-web]      Code : 0 conforme ; 1 écart.
set -eu
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
. "$HOME/.comtaple-outils/env.sh"
AVEC_WEB=0; [ "${1:-}" = "--avec-web" ] && AVEC_WEB=1
T="$(mktemp -d "${TMPDIR:-/tmp}/comtaple-essai-install.XXXXXX")"
PROJET=comtaple-essai-install
PID_API=""
ECHECS=0
etape() { echo; echo "--- $1 ---"; }
controle() { if [ "$2" = "$3" ]; then echo "[CONFORME] $1"; else echo "[ÉCHEC   ] $1 — attendu « $3 », obtenu « $2 »"; ECHECS=$((ECHECS + 1)); fi; }
nettoyer() {
  [ -z "$PID_API" ] || kill "$PID_API" 2>/dev/null || true
  (cd "$T/depot" 2>/dev/null && docker compose -p "$PROJET" down -v --remove-orphans >/dev/null 2>&1) || true
  rm -rf "$T"
}
trap nettoyer EXIT INT TERM
DEBUT=$(date +%s)

# Garde : refus si une pile d'essai précédente subsiste, ou si l'espace manque.
docker compose ls -a --format json 2>/dev/null | grep -q "\"$PROJET\"" && { echo "REFUS : le projet $PROJET existe déjà (essai précédent à examiner)."; trap - EXIT; rm -rf "$T"; exit 1; }
LIBRE_KO=$(docker exec comtaple-postgres-1 df -Pk /var/lib/postgresql 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)
[ "${LIBRE_KO:-0}" -ge $((8 * 1024 * 1024)) ] || { echo "REFUS : moins de 8 Go libres dans la VM Docker (${LIBRE_KO:-0} Ko)."; trap - EXIT; rm -rf "$T"; exit 1; }

etape "1) copie propre du dépôt"
mkdir "$T/depot"
( cd "$RACINE" && git ls-files -z --cached --others --exclude-standard | xargs -0 -I{} sh -c 'test -e "{}" && echo "{}"' | tar -cf - -T - ) | tar -xf - -C "$T/depot"
echo "$(find "$T/depot" -type f | wc -l | tr -d ' ') fichier(s) copié(s) ; node_modules : $([ -d "$T/depot/node_modules" ] && echo présent || echo absent) ; .env : $([ -f "$T/depot/.env" ] && echo présent || echo absent)"
controle "copie vierge : ni node_modules ni .env" "$([ -d "$T/depot/node_modules" ] || [ -f "$T/depot/.env" ] && echo non || echo oui)" "oui"
cd "$T/depot"

etape "2) installation et construction"
D=$(date +%s)
pnpm install --frozen-lockfile --reporter=silent 2>&1 | tail -3
echo "Installation : $(( $(date +%s) - D )) s"
D=$(date +%s)
if [ "$AVEC_WEB" = "1" ]; then pnpm -r --workspace-concurrency=1 run build >/dev/null 2>&1; else pnpm --filter "@comtaple/api..." --filter "@comtaple/worker..." --workspace-concurrency=1 run build >/dev/null 2>&1; fi
echo "Construction : $(( $(date +%s) - D )) s"
controle "API construite" "$([ -f apps/api/dist/main.js ] && echo oui || echo non)" "oui"
controle "worker construit" "$([ -f apps/worker/dist/main.js ] && echo oui || echo non)" "oui"
[ "$AVEC_WEB" = "0" ] || controle "application web construite (next build)" "$([ -f apps/web/.next/BUILD_ID ] && echo oui || echo non)" "oui"
controle "outil de migration livré" "$([ -f packages/db/dist/migrer.js ] && echo oui || echo non)" "oui"

etape "3) .env neuf, ports distincts"
sh scripts/generer-env.sh >/dev/null
sed -i.bak -e 's/^PG_PORT=.*/PG_PORT=15432/' -e 's#^REDIS_URL=redis://:\(.*\)@127.0.0.1:6379#REDIS_URL=redis://:\1@127.0.0.1:16379#' -e 's#^S3_ENDPOINT=.*#S3_ENDPOINT=http://127.0.0.1:18333#' -e 's#^API_URL=.*#API_URL=http://127.0.0.1:14000#' -e 's#^S3_BUCKET=.*#S3_BUCKET=comtaple-essai-install#' .env
rm -f .env.bak
cat >> .env <<'ENV'
REDIS_PORT=16379
S3_PORT=18333
API_PORT=14000
API_HOTE=127.0.0.1
METRIQUES_PORT_API=0
METRIQUES_PORT_WORKER=0
FILES_PREFIXE=essai-install
# Services NON démarrés dans cette pile : adresses d'un port fermé (jamais ceux de la pile en marche).
OIDC_ISSUER=http://127.0.0.1:18080/realms/comtaple
CLAMAV_PORT=13310
OCR_URL=http://127.0.0.1:18500
ENV
controle ".env en lecture réservée au propriétaire (600)" "$(stat -f '%Lp' .env 2>/dev/null || stat -c '%a' .env)" "600"
SECRETS_IDENTIQUES=$(for n in PG_ADMIN_PASSWORD SESSION_SECRET JETONS_CLE_CHIFFREMENT; do a=$(grep "^$n=" .env | cut -d= -f2-); b=$(grep "^$n=" "$RACINE/.env" | cut -d= -f2-); [ "$a" = "$b" ] && echo mêmes; done | wc -l | tr -d ' ')
controle "secrets neufs (aucun identique à ceux de la pile en marche)" "$SECRETS_IDENTIQUES" "0"

etape "4) pile jetable ($PROJET : PostgreSQL, Redis, S3)"
docker network inspect comtaple_essai_reseau >/dev/null 2>&1 || true
set -a; . ./.env; set +a
docker compose -p "$PROJET" up -d --wait postgres redis s3 2>&1 | tail -4
docker compose -p "$PROJET" ps --format 'table {{.Service}}\t{{.Status}}'
controle "projet distinct : conteneurs d'essai seulement" "$(docker compose -p "$PROJET" ps -q | wc -l | tr -d ' ')" "3"

etape "5) migrations, amorçage, API"
D=$(date +%s)
node packages/db/dist/migrer.js
echo "Migrations : $(( $(date +%s) - D )) s"
node -e 'import("./packages/db/dist/amorcer.js").then((m) => m.amorcer(process.env)).then(() => console.log("Jeu d’essai amorcé."))'
node apps/api/dist/main.js > "$T/api.log" 2>&1 &
PID_API=$!
i=0; until curl -sf -m 2 http://127.0.0.1:14000/v1/sante >/dev/null 2>&1; do i=$((i + 1)); [ "$i" -gt 40 ] && { echo "L'API ne répond pas ; fin du journal :"; tail -15 "$T/api.log"; ECHECS=$((ECHECS + 1)); break; }; sleep 1; done
SANTE="$(curl -s -m 5 http://127.0.0.1:14000/v1/sante || true)"
echo "GET /v1/sante → $SANTE"
controle "sonde : base, files, stockage ok ; identité indisponible (Keycloak absent de cette pile) ; statut dégradé" "$SANTE" '{"statut":"degrade","dependances":{"base":"ok","files":"ok","stockage":"ok","identite":"indisponible"}}'

etape "6) diagnostic de préparation contre cette pile"
node scripts/verifier-preparation.mjs --sans-empreintes --sans-docker --sauvegardes="$T/aucune" > "$T/diag.txt" 2>&1 || true
grep -E "^\[(PRÊT|MANQUANT|NON VÉRIFIÉ)" "$T/diag.txt" | grep -E "Base de données \(Post|Migrations|RLS forcée|Rôles|Files|Stockage objet|Keycloak|Antivirus|OCR" | cut -c1-170
controle "base, migrations, RLS, files, S3 : prêts" "$(grep -E "^\[PRÊT" "$T/diag.txt" | grep -cE "Base de données \(Post|Migrations appliquées|RLS forcée|Rôles applicatifs|Files \(Redis\) — PING|Stockage objet \(S3\)")" "6"
controle "services non démarrés signalés MANQUANT (Keycloak, antivirus, OCR)" "$(grep -E "^\[MANQUANT" "$T/diag.txt" | grep -cE "Keycloak|Antivirus|OCR")" "3"

etape "7) refus de démarrage en production avec les valeurs de développement"
SORTIE="$(NODE_ENV=production API_PORT=14001 node apps/api/dist/main.js 2>&1 || true)"
echo "$SORTIE" | grep -E "Configuration refusée" | cut -c1-400 | head -2
controle "démarrage refusé, variables nommées" "$(echo "$SORTIE" | grep -c "Configuration refusée en production")" "1"
LEAK=0; for n in SESSION_SECRET PG_ADMIN_PASSWORD JETONS_CLE_CHIFFREMENT S3_SECRET_KEY; do v=$(grep "^$n=" .env | cut -d= -f2-); echo "$SORTIE" | grep -qF "$v" && LEAK=$((LEAK + 1)); done
controle "aucun secret dans le message de refus" "$LEAK" "0"
curl -sf -m 2 http://127.0.0.1:14001/v1/sante >/dev/null 2>&1 && R=oui || R=non
controle "aucun serveur n'a démarré sur le port de l'essai de refus" "$R" "non"

etape "8) destruction"
kill "$PID_API" 2>/dev/null || true; PID_API=""
cd "$RACINE"
trap - EXIT INT TERM
nettoyer
docker volume ls -q | grep -c "^${PROJET}_" | grep -q '^0$' && echo "Volumes d'essai supprimés." || { echo "[ÉCHEC   ] des volumes d'essai subsistent"; ECHECS=$((ECHECS + 1)); }
echo "Durée totale : $(( $(date +%s) - DEBUT )) s"
[ "$ECHECS" = "0" ] && echo "Installation reproductible depuis un dépôt vierge (locale) : CONFORME" || echo "Installation : $ECHECS ÉCART(S)"
[ "$ECHECS" = "0" ]
