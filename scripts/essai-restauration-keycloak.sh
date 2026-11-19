#!/bin/sh
# Sauvegarde puis essai de restauration ISOLÉE du Keycloak LOCAL (royaume, clients, comptes, empreintes de mots de passe).
#
#  1) Export complet du royaume, SANS arrêter le Keycloak local. Sa base embarquée ne se lit pas pendant qu'il tourne :
#     le conteneur est FIGÉ le temps de copier les fichiers de cette base (environ une seconde ; les requêtes en cours
#     attendent, aucune session n'est perdue), puis repris. L'export est fait à partir de la copie, dans un conteneur
#     temporaire. La copie a la cohérence d'un arrêt brutal : les toutes dernières écritures peuvent manquer, et c'est
#     pourquoi l'étape 3 compare le résultat au Keycloak d'origine.
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
# Variante : KEYCLOAK_EXPORT=<fichier d'export> saute l'étape 1 et restaure CE fichier (par exemple un export déchiffré
# d'un jeu de sauvegardes chiffrées) ; rien n'est alors écrit dans var/sauvegardes et le Keycloak local n'est pas figé.
set -eu
cd "$(dirname "$0")/.."
. "$HOME/.comtaple-outils/env.sh"
set -a; . ./.env; set +a
ROYAUME="comtaple"
SOURCE="comtaple-keycloak-1"
PORT="${ESSAI_KC_PORT:-8081}"
IMPORT_TMP="$(mktemp -d)"
EXPORT="${KEYCLOAK_EXPORT:-var/sauvegardes/keycloak-$(date +%Y%m%d-%H%M%S).json}"

nettoyer() {
  docker rm -f comtaple-essai-kc-export comtaple-essai-keycloak >/dev/null 2>&1 || true
  rm -rf "$IMPORT_TMP"
}
reprendre_source() { docker unpause "$SOURCE" >/dev/null 2>&1 || true; }
nettoyer
trap 'reprendre_source; nettoyer' EXIT INT TERM
DEMARRE_AVANT="$(docker inspect -f '{{.State.StartedAt}}' "$SOURCE")"

if [ -n "${KEYCLOAK_EXPORT:-}" ]; then
  [ -f "$EXPORT" ] || { echo "Export introuvable : $EXPORT"; exit 1; }
  echo "--- 1) export fourni : $(basename "$EXPORT") (aucun nouvel export, Keycloak local non figé) ---"
else
mkdir -p var/sauvegardes
echo "--- 1) export complet du royaume, sans arrêt du service ---"
docker create --name comtaple-essai-kc-export "$(docker inspect -f '{{.Config.Image}}' "$SOURCE")" export --dir /opt/keycloak/data/export --realm "$ROYAUME" --users realm_file >/dev/null
GEL=$(node -e 'console.log(Date.now())')
docker pause "$SOURCE" >/dev/null
# Copie de conteneur à conteneur, sans passer par le disque de l'hôte : les propriétaires des fichiers sont conservés.
docker cp "$SOURCE:/opt/keycloak/data/h2" - | docker cp - comtaple-essai-kc-export:/opt/keycloak/data/
docker unpause "$SOURCE" >/dev/null
echo "Keycloak local figé $(( $(node -e 'console.log(Date.now())') - GEL )) ms pour la copie de sa base, puis repris (aucun arrêt)"
docker start -a comtaple-essai-kc-export > var/sauvegardes/.kc-export.log 2>&1 \
  || { echo "ÉCHEC de l'export (voir var/sauvegardes/.kc-export.log)"; exit 1; }
( umask 077; docker cp "comtaple-essai-kc-export:/opt/keycloak/data/export/$ROYAUME-realm.json" "$EXPORT" )
chmod 600 "$EXPORT"
shasum -a 256 "$EXPORT" > "$EXPORT.sha256"
docker rm -f comtaple-essai-kc-export >/dev/null; rm -f var/sauvegardes/.kc-export.log
echo "Export : $EXPORT ($(du -h "$EXPORT" | cut -f1 | tr -d ' '))"
fi

echo "--- 2) import dans une instance d'essai isolée (port $PORT) ---"
export ESSAI_KC_URL="http://127.0.0.1:$PORT" ESSAI_KC_ADMIN="essai-$(openssl rand -hex 4)" ESSAI_KC_MDP="$(openssl rand -hex 24)"
mkdir -p $IMPORT_TMP && cp "$EXPORT" "$IMPORT_TMP/$ROYAUME-realm.json" && chmod 755 $IMPORT_TMP && chmod 644 "$IMPORT_TMP/$ROYAUME-realm.json"
docker create --name comtaple-essai-keycloak -p "127.0.0.1:$PORT:8080" -e KC_BOOTSTRAP_ADMIN_USERNAME="$ESSAI_KC_ADMIN" -e KC_BOOTSTRAP_ADMIN_PASSWORD="$ESSAI_KC_MDP" \
  quay.io/keycloak/keycloak:26.8.2 start-dev --import-realm >/dev/null
docker cp $IMPORT_TMP/. comtaple-essai-keycloak:/opt/keycloak/data/import
rm -rf $IMPORT_TMP
DEBUT=$(date +%s)
docker start comtaple-essai-keycloak >/dev/null
i=0; until curl -sf -m 3 -o /dev/null "$ESSAI_KC_URL/realms/$ROYAUME/.well-known/openid-configuration"; do
  i=$((i + 1)); [ "$i" -gt 120 ] && { echo "ÉCHEC : l'instance d'essai ne démarre pas"; docker logs --tail 30 comtaple-essai-keycloak; exit 1; }; sleep 2
done
echo "Instance d'essai prête en $(( $(date +%s) - DEBUT )) s"

echo "--- 3) vérifications ---"
docker compose exec -T postgres psql -U "$PG_ADMIN_USER" -d comtaple -At -F ' ' -c "select email, sujet_oidc from utilisateurs order by email" > $IMPORT_TMP.sujets
RESULTAT=0
ROYAUME="$ROYAUME" node scripts/verifier-keycloak-restaure.mjs $IMPORT_TMP.sujets || RESULTAT=1
rm -f $IMPORT_TMP.sujets

echo "--- 4) nettoyage ---"
docker rm -f comtaple-essai-keycloak >/dev/null
echo "Instance d'essai détruite."
trap - EXIT INT TERM
if [ "$(docker inspect -f '{{.State.StartedAt}}' "$SOURCE")" != "$DEMARRE_AVANT" ] || ! curl -sf -m 5 -o /dev/null "$OIDC_ISSUER/.well-known/openid-configuration"; then
  echo "ATTENTION : le Keycloak local a redémarré ou ne répond plus après l'essai."; exit 4
fi
echo "Keycloak local : aucun redémarrage, service joignable"
[ "$RESULTAT" = "0" ] && echo "Essai de restauration de Keycloak : RÉUSSI" || { echo "Essai de restauration de Keycloak : ÉCHEC"; exit 1; }
