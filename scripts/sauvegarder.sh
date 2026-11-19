#!/bin/sh
# Sauvegarde LOCALE dans var/sauvegardes/ : base (format personnalisé pg_dump) PUIS stockage objet (tous les objets du
# bucket, avec un manifeste d'empreintes). L'ordre compte : les originaux ne sont jamais réécrits ni supprimés, donc un
# stockage copié après la base contient tout ce que la base référence. Keycloak : scripts/essai-restauration-keycloak.sh.
# En production, la sauvegarde s'appuie sur les mécanismes de l'hébergeur (voir docs/deploiement.md) ;
# ce script sert au développement et à l'essai de restauration.
set -eu
cd "$(dirname "$0")/.."
. "$HOME/.comtaple-outils/env.sh"
set -a; . ./.env; set +a
mkdir -p var/sauvegardes
CIBLE="var/sauvegardes/comtaple-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T postgres pg_dump -U "$PG_ADMIN_USER" -d comtaple -Fc --no-owner > "$CIBLE"
shasum -a 256 "$CIBLE" > "$CIBLE.sha256"
node scripts/objets.mjs sauvegarder "${CIBLE%.dump}.objets.json"
shasum -a 256 "${CIBLE%.dump}.objets.json" > "${CIBLE%.dump}.objets.json.sha256"
echo "$CIBLE"
