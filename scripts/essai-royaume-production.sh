#!/bin/sh
# Essai LOCAL, ÉPHÉMÈRE et ISOLÉ du royaume Keycloak de production (infra/keycloak/realm-comtaple-production.gabarit.json)
# et de l'image de production (infra/keycloak/Dockerfile.production, `start --optimized`, adossée à PostgreSQL).
#
# Ne touche à AUCUN service de l'application : réseau, conteneurs (préfixe `comtaple-essai-`), image, port (8190) et
# secrets sont propres à l'essai, générés à chaque exécution et détruits à la fin, même en cas d'échec.
# Ce que l'essai établit : le gabarit s'importe au démarrage ; ses réglages sont bien ceux lus dans Keycloak ; un
# compte ordinaire est conduit à l'enrôlement du second facteur ; un mot de passe faible est refusé ; l'accès direct
# par mot de passe est refusé. Ce qu'il n'établit pas : une connexion réelle par un fournisseur d'identité (seule la déclaration d'un fournisseur
# d'exemple, désactivé, est essayée), l'envoi de
# courriels, le comportement derrière le proxy et la base managée réels.
#
# Usage : scripts/essai-royaume-production.sh      Codes : 0 réussi ; 1 un contrôle a échoué ; 2 essai impossible.
set -eu
cd "$(dirname "$0")/.."
. "$HOME/.comtaple-outils/env.sh"

PORT=8190
RESEAU=comtaple-essai-royaume
PG=comtaple-essai-royaume-pg
KC=comtaple-essai-royaume-keycloak
IMAGE=comtaple-essai-keycloak:essai
BASE="http://localhost:$PORT"
WEB="https://app.essai.test"
TMP=$(mktemp -d)

alea() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
MDP_PG=$(alea 24); MDP_ADMIN=$(alea 24); SECRET_CLIENT=$(alea 40); MDP_FORT="Zx9$(alea 16)aB"

nettoyer() {
  docker rm -f "$KC" "$PG" >/dev/null 2>&1 || true
  docker network rm "$RESEAU" >/dev/null 2>&1 || true
  docker image rm "$IMAGE" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap nettoyer EXIT INT TERM

if docker ps -a --format '{{.Names}}' | grep -q "^comtaple-essai-royaume-"; then
  echo "Un essai précédent a laissé des conteneurs comtaple-essai-royaume-* : les supprimer d'abord." >&2
  trap - EXIT; rm -rf "$TMP"; exit 2
fi

echo "1/5 Construction de l'image de production (éphémère)…"
docker build -q --network host -f infra/keycloak/Dockerfile.production -t "$IMAGE" infra/keycloak >/dev/null

echo "2/5 Démarrage isolé (PostgreSQL d'essai sans port publié, Keycloak sur 127.0.0.1:$PORT)…"
docker network create "$RESEAU" >/dev/null
docker run -d --name "$PG" --network "$RESEAU" --init --memory 512m --tmpfs /var/lib/postgresql \
  -e POSTGRES_USER=keycloak -e POSTGRES_PASSWORD="$MDP_PG" -e POSTGRES_DB=keycloak \
  pgvector/pgvector:0.8.7-pg18-trixie >/dev/null
i=0; until docker exec "$PG" pg_isready -U keycloak -d keycloak >/dev/null 2>&1; do i=$((i + 1)); [ "$i" -gt 60 ] && { echo "PostgreSQL d'essai ne démarre pas." >&2; exit 2; }; sleep 1; done
sleep 2

# Mêmes contraintes que la composition de production : lecture seule, aucune capacité, pas d'élévation de privilèges.
docker run -d --name "$KC" --network "$RESEAU" -p "127.0.0.1:$PORT:8080" \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true --memory 1536m --pids-limit 512 \
  --tmpfs /tmp:rw,nosuid,size=128m \
  --tmpfs /opt/keycloak/data/tmp:rw,nosuid,size=128m,uid=1000,gid=0,mode=0770 \
  --tmpfs /opt/keycloak/data/transaction-logs:rw,nosuid,size=64m,uid=1000,gid=0,mode=0770 \
  -e KC_DB_URL="jdbc:postgresql://$PG:5432/keycloak" -e KC_DB_USERNAME=keycloak -e KC_DB_PASSWORD="$MDP_PG" \
  -e KC_HOSTNAME=https://auth.essai.test -e KC_HTTP_ENABLED=true -e KC_HTTP_PORT=8080 -e KC_PROXY_HEADERS=xforwarded \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=amorce -e KC_BOOTSTRAP_ADMIN_PASSWORD="$MDP_ADMIN" \
  -e OIDC_CLIENT_SECRET="$SECRET_CLIENT" -e WEB_URL="$WEB" \
  "$IMAGE" start --optimized --import-realm >/dev/null

# Le proxy est simulé par les en-têtes qu'il poserait.
c() { curl -sS -m 20 -H 'X-Forwarded-Proto: https' -H 'X-Forwarded-Host: auth.essai.test' "$@"; }
i=0
until c -o /dev/null -f "$BASE/realms/comtaple/.well-known/openid-configuration" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 120 ] || [ "$(docker inspect -f '{{.State.Running}}' "$KC")" != "true" ]; then
    echo "Keycloak d'essai ne répond pas. Fin de son journal :" >&2; docker logs "$KC" 2>&1 | tail -25 >&2; exit 2
  fi
  sleep 2
done

echec=0
ok() { echo "  conforme     : $1"; }
ko() { echo "  NON CONFORME : $1"; echec=1; }
verifier() { if [ "$2" = "$3" ]; then ok "$1"; else ko "$1 (attendu « $3 », lu « $2 »)"; fi; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const v=(new Function("j","return "+process.argv[1]))(j);console.log(typeof v==="object"?JSON.stringify(v):String(v))})' "$1"; }

echo "3/5 Réglages lus dans Keycloak après import…"
JETON=$(c -d grant_type=password -d client_id=admin-cli -d username=amorce --data-urlencode "password=$MDP_ADMIN" "$BASE/realms/master/protocol/openid-connect/token" | json 'j.access_token')
a() { c -H "Authorization: Bearer $JETON" "$@"; }
a "$BASE/admin/realms/comtaple" > "$TMP/royaume.json"
r() { json "$1" < "$TMP/royaume.json"; }
verifier "flux de connexion par navigateur" "$(r 'j.browserFlow')" "navigateur comtaple"
verifier "HTTPS exigé partout" "$(r 'j.sslRequired')" "all"
verifier "inscription libre fermée" "$(r 'j.registrationAllowed')" "false"
verifier "protection contre la force brute" "$(r 'j.bruteForceProtected')" "true"
verifier "échecs avant temporisation" "$(r 'j.failureFactor')" "5"
verifier "politique de mot de passe" "$(r 'j.passwordPolicy.includes("length(12)") && j.passwordPolicy.includes("passwordHistory(5)")')" "true"
verifier "second facteur de type TOTP" "$(r 'j.otpPolicyType')" "totp"
verifier "jeton d'accès : 5 min" "$(r 'j.accessTokenLifespan')" "300"
verifier "session inactive : 30 min" "$(r 'j.ssoSessionIdleTimeout')" "1800"
verifier "session maximale : 10 h" "$(r 'j.ssoSessionMaxLifespan')" "36000"
verifier "aucun compte importé" "$(a "$BASE/admin/realms/comtaple/users/count")" "0"
verifier "aucun fournisseur d'identité déclaré" "$(a "$BASE/admin/realms/comtaple/identity-provider/instances" | json 'j.length')" "0"

a "$BASE/admin/realms/comtaple/clients" > "$TMP/clients.json"
verifier "pas de client de tests" "$(json 'j.some(c=>c.clientId==="comtaple-tests")' < "$TMP/clients.json")" "false"
verifier "aucun client n'autorise l'accès direct par mot de passe" "$(json 'j.filter(c=>c.directAccessGrantsEnabled&&!["admin-cli"].includes(c.clientId)).map(c=>c.clientId).join(",")' < "$TMP/clients.json")" ""
verifier "URI de retour issue de l'environnement" "$(json 'j.find(c=>c.clientId==="comtaple-web").redirectUris.join(",")' < "$TMP/clients.json")" "$WEB/api/auth/retour"
ID_CLIENT=$(json 'j.find(c=>c.clientId==="comtaple-web").id' < "$TMP/clients.json")
if [ "$(a "$BASE/admin/realms/comtaple/clients/$ID_CLIENT/client-secret" | json 'j.value')" = "$SECRET_CLIENT" ]; then ok "secret du client issu de l'environnement"; else ko "secret du client différent de celui de l'environnement"; fi

a "$BASE/admin/realms/comtaple/authentication/flows/navigateur%20comtaple/executions" > "$TMP/flux.json"
verifier "formulaire TOTP requis dans le flux" "$(json 'j.find(e=>e.providerId==="auth-otp-form").requirement' < "$TMP/flux.json")" "REQUIRED"
verifier "condition de rôle présente" "$(json 'j.some(e=>e.providerId==="conditional-user-role"&&e.requirement==="REQUIRED")' < "$TMP/flux.json")" "true"
verifier "redirection vers un fournisseur d'identité prévue" "$(json 'j.some(e=>e.providerId==="identity-provider-redirector")' < "$TMP/flux.json")" "true"

# Emplacement de la fédération SSO : l'exemple de fournisseur d'identité (désactivé, adresses fictives) est accepté.
verifier "exemple de fournisseur d'identité OIDC accepté" "$(a -o /dev/null -w '%{http_code}' -H 'content-type: application/json' --data-binary @infra/keycloak/fournisseur-identite.exemple.json "$BASE/admin/realms/comtaple/identity-provider/instances")" "201"
verifier "fournisseur d'exemple désactivé, liaison de comptes existants seulement" "$(a "$BASE/admin/realms/comtaple/identity-provider/instances/sso-cabinet-exemple" | json '[j.enabled,j.linkOnly].join(",")')" "false,true"

echo "4/5 Comportement à la connexion (comptes fictifs créés pour l'essai)…"
creer() { # nom → identifiant
  a -o /dev/null -H 'content-type: application/json' -d "{\"username\":\"$1@essai.test\",\"email\":\"$1@essai.test\",\"firstName\":\"Essai\",\"lastName\":\"$1\",\"enabled\":true,\"emailVerified\":true}" "$BASE/admin/realms/comtaple/users"
  a "$BASE/admin/realms/comtaple/users?username=$1@essai.test&exact=true" | json 'j[0].id'
}
mdp() { a -o /dev/null -w '%{http_code}' -X PUT -H 'content-type: application/json' -d "{\"type\":\"password\",\"temporary\":false,\"value\":\"$2\"}" "$BASE/admin/realms/comtaple/users/$1/reset-password"; }
ID_CABINET=$(creer cabinet); ID_DISPENSE=$(creer dispense)
verifier "mot de passe faible refusé" "$(mdp "$ID_CABINET" 'azerty')" "400"
verifier "mot de passe conforme accepté" "$(mdp "$ID_CABINET" "$MDP_FORT")" "204"
mdp "$ID_DISPENSE" "$MDP_FORT" >/dev/null
ROLE=$(a "$BASE/admin/realms/comtaple/roles/dispense-second-facteur")
a -o /dev/null -H 'content-type: application/json' -d "[$ROLE]" "$BASE/admin/realms/comtaple/users/$ID_DISPENSE/role-mappings/realm"

connexion() { # nom → écrit en-têtes et corps de la réponse au formulaire
  rm -f "$TMP/cookies"
  c -c "$TMP/cookies" -b "$TMP/cookies" -o "$TMP/page.html" \
    "$BASE/realms/comtaple/protocol/openid-connect/auth?client_id=comtaple-web&response_type=code&scope=openid&redirect_uri=$WEB/api/auth/retour&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256"
  action=$(grep -o 'action="[^"]*"' "$TMP/page.html" | head -1 | sed -e 's/^action="//' -e 's/"$//' -e 's/&amp;/\&/g' -e "s#https://auth.essai.test#$BASE#")
  [ -n "$action" ] || { echo "(formulaire de connexion introuvable)" > "$TMP/reponse.html"; : > "$TMP/entetes"; return; }
  c -c "$TMP/cookies" -b "$TMP/cookies" -D "$TMP/entetes" -o "$TMP/reponse.html" --data-urlencode "username=$1@essai.test" --data-urlencode "password=$MDP_FORT" "$action"
}
connexion cabinet
if grep -qi '^location:.*required-action?execution=CONFIGURE_TOTP' "$TMP/entetes" && ! grep -qi '^location:.*[?&]code=' "$TMP/entetes"; then ok "compte ordinaire sans TOTP : renvoyé vers l'enrôlement du second facteur, aucun code d'autorisation délivré"; else ko "compte ordinaire sans TOTP : l'enrôlement du second facteur n'est pas exigé"; sed -n '1p;/^[Ll]ocation:/p' "$TMP/entetes" | cut -c1-120; fi
connexion dispense
if grep -qi "^location: $WEB/api/auth/retour.*code=" "$TMP/entetes"; then ok "compte portant le rôle de dispense : connecté sans second facteur (exception voulue)"; else ko "compte portant le rôle de dispense : comportement inattendu"; fi
verifier "accès direct par mot de passe refusé" "$(c -o /dev/null -w '%{http_code}' -d grant_type=password -d client_id=comtaple-web --data-urlencode "client_secret=$SECRET_CLIENT" -d "username=dispense@essai.test" --data-urlencode "password=$MDP_FORT" "$BASE/realms/comtaple/protocol/openid-connect/token")" "400"

echo "4 bis/5 Second facteur : enrôlement TOTP jusqu'au bout, puis connexions avec code (D-102)…"
ID_MFA=$(creer mfa); mdp "$ID_MFA" "$MDP_FORT" >/dev/null
if node scripts/essai-mfa.mjs "$BASE" "$WEB" "mfa@essai.test" "$MDP_FORT" "$SECRET_CLIENT"; then ok "parcours complet du second facteur (voir les lignes ci-dessus)"; else ko "parcours du second facteur en échec (voir ci-dessus)"; fi

echo "5/5 Destruction de l'essai (conteneurs, réseau, image, fichiers temporaires)."
if [ "$echec" -eq 0 ]; then echo "ESSAI RÉUSSI : le royaume de production s'importe, se comporte comme décrit et impose le TOTP (enrôlement et connexions avec code)."; else echo "ESSAI EN ÉCHEC : au moins un contrôle non conforme."; fi
exit "$echec"
