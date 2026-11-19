#!/bin/sh
# Sauvegarde puis essai de restauration ISOLÉE du Keycloak LOCAL (royaume, clients, comptes, empreintes de mots de passe).
#
#  1) Export complet du royaume. Le Keycloak local garde ses données dans une base embarquée que l'on ne peut pas lire
#     pendant qu'il tourne : il est ARRÊTÉ une à deux minutes, son état est figé dans une image temporaire, puis il est
#     relancé tel quel ; l'export est fait à partir de l'image, supprimée ensuite.
#  2) L'export est importé dans une instance d'essai SÉPARÉE (autre conteneur, autre port, autre administrateur),
#     sans aucune donnée du Keycloak d'origine.
#  3) Vérifications sur l'instance d'essai : mêmes comptes et mêmes identifiants (« sub ») que l'origine et que la base
#     de l'application, connexion avec le mot de passe d'origine acceptée, mauvais mot de passe refusé, mêmes clients
#     et même secret du client confidentiel.
#  4) L'instance d'essai est détruite.
#
# L'export contient des empreintes de mots de passe et un secret de client : il reste dans var/sauvegardes/ (hors dépôt),
# lisible par son seul propriétaire. En production, Keycloak s'appuie sur PostgreSQL et se sauvegarde avec lui
# (docs/deploiement.md) : cet essai valide la démarche, pas l'exploitation.
set -eu
cd "$(dirname "$0")/.."
. "$HOME/.comtaple-outils/env.sh"
set -a; . ./.env; set +a
ROYAUME="comtaple"
SOURCE="comtaple-keycloak-1"
IMAGE_TMP="comtaple-essai-kc-export:tmp"
PORT="${ESSAI_KC_PORT:-8081}"
mkdir -p var/sauvegardes
EXPORT="var/sauvegardes/keycloak-$(date +%Y%m%d-%H%M%S).json"

nettoyer() {
  docker rm -f comtaple-essai-kc-export comtaple-essai-keycloak >/dev/null 2>&1 || true
  docker image rm "$IMAGE_TMP" >/dev/null 2>&1 || true
  rm -rf var/sauvegardes/.kc-import
}
relancer_source() {
  docker compose start keycloak >/dev/null 2>&1 || true
  i=0; until curl -sf -m 3 -o /dev/null "$OIDC_ISSUER/.well-known/openid-configuration"; do
    i=$((i + 1)); [ "$i" -gt 120 ] && { echo "ATTENTION : le Keycloak local ne répond pas après relance (docker compose up -d keycloak)"; return 1; }; sleep 2
  done
}
nettoyer
trap 'relancer_source; nettoyer' EXIT INT TERM

echo "--- 1) export complet du royaume ---"
ARRET=$(date +%s)
docker compose stop keycloak >/dev/null 2>&1
docker commit "$SOURCE" "$IMAGE_TMP" >/dev/null
relancer_source
echo "Keycloak local arrêté puis relancé : $(( $(date +%s) - ARRET )) s d'interruption"
docker run --name comtaple-essai-kc-export "$IMAGE_TMP" export --dir /opt/keycloak/data/export --realm "$ROYAUME" --users realm_file > var/sauvegardes/.kc-export.log 2>&1 \
  || { echo "ÉCHEC de l'export (voir var/sauvegardes/.kc-export.log)"; exit 1; }
( umask 077; docker cp "comtaple-essai-kc-export:/opt/keycloak/data/export/$ROYAUME-realm.json" "$EXPORT" )
chmod 600 "$EXPORT"
shasum -a 256 "$EXPORT" > "$EXPORT.sha256"
docker rm -f comtaple-essai-kc-export >/dev/null; docker image rm "$IMAGE_TMP" >/dev/null; rm -f var/sauvegardes/.kc-export.log
echo "Export : $EXPORT ($(du -h "$EXPORT" | cut -f1 | tr -d ' '))"

echo "--- 2) import dans une instance d'essai isolée (port $PORT) ---"
export ESSAI_KC_URL="http://127.0.0.1:$PORT" ESSAI_KC_ADMIN="essai-$(openssl rand -hex 4)" ESSAI_KC_MDP="$(openssl rand -hex 24)"
mkdir -p var/sauvegardes/.kc-import && cp "$EXPORT" "var/sauvegardes/.kc-import/$ROYAUME-realm.json" && chmod 755 var/sauvegardes/.kc-import && chmod 644 "var/sauvegardes/.kc-import/$ROYAUME-realm.json"
docker create --name comtaple-essai-keycloak -p "127.0.0.1:$PORT:8080" -e KC_BOOTSTRAP_ADMIN_USERNAME="$ESSAI_KC_ADMIN" -e KC_BOOTSTRAP_ADMIN_PASSWORD="$ESSAI_KC_MDP" \
  quay.io/keycloak/keycloak:26.8.2 start-dev --import-realm >/dev/null
docker cp var/sauvegardes/.kc-import/. comtaple-essai-keycloak:/opt/keycloak/data/import
rm -rf var/sauvegardes/.kc-import
DEBUT=$(date +%s)
docker start comtaple-essai-keycloak >/dev/null
i=0; until curl -sf -m 3 -o /dev/null "$ESSAI_KC_URL/realms/$ROYAUME/.well-known/openid-configuration"; do
  i=$((i + 1)); [ "$i" -gt 120 ] && { echo "ÉCHEC : l'instance d'essai ne démarre pas"; docker logs --tail 30 comtaple-essai-keycloak; exit 1; }; sleep 2
done
echo "Instance d'essai prête en $(( $(date +%s) - DEBUT )) s"

echo "--- 3) vérifications ---"
docker compose exec -T postgres psql -U "$PG_ADMIN_USER" -d comtaple -At -F ' ' -c "select email, sujet_oidc from utilisateurs order by email" > var/sauvegardes/.sujets
RESULTAT=0
ROYAUME="$ROYAUME" node scripts/verifier-keycloak-restaure.mjs var/sauvegardes/.sujets || RESULTAT=1
rm -f var/sauvegardes/.sujets

echo "--- 4) nettoyage ---"
docker rm -f comtaple-essai-keycloak >/dev/null
echo "Instance d'essai détruite."
[ "$RESULTAT" = "0" ] && echo "Essai de restauration de Keycloak : RÉUSSI" || { echo "Essai de restauration de Keycloak : ÉCHEC"; exit 1; }
