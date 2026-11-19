#!/bin/sh
# DESTRUCTIF — environnement LOCAL uniquement : efface toutes les données de la base de développement, puis rejoue les
# migrations et l'amorçage de démonstration. Utile quand les parcours de test ont accumulé des dossiers d'essai.
# Refuse de s'exécuter si la base n'est pas sur le poste local, et demande une confirmation explicite.
set -eu
cd "$(dirname "$0")/.."
. "$HOME/.comtaple-outils/env.sh"
set -a; . ./.env; set +a
case "${PG_HOST:-127.0.0.1}" in 127.0.0.1|localhost) ;; *) echo "Refusé : PG_HOST n'est pas local."; exit 1 ;; esac
[ "${NODE_ENV:-}" = "production" ] && { echo "Refusé en production."; exit 1; }
printf 'Toutes les données de la base LOCALE « comtaple » vont être effacées. Tapez « effacer » pour confirmer : '
read -r reponse
[ "$reponse" = "effacer" ] || { echo "Annulé."; exit 1; }
scripts/applis.sh arreter >/dev/null
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$PG_ADMIN_USER" -d comtaple -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
pnpm run db:migrate && pnpm run db:seed
echo "Base locale réinitialisée. Relancer : scripts/applis.sh demarrer"
