#!/bin/sh
# Sauvegarde logique de la base LOCALE (format personnalisé pg_dump) dans var/sauvegardes/.
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
echo "$CIBLE"
