#!/bin/sh
# Génère un fichier .env LOCAL avec des secrets aléatoires (jamais versionné). Ne remplace pas un .env existant.
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] && { echo ".env existe déjà : rien n'est modifié."; exit 0; }
alea() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
PGA=$(alea 32); PGP=$(alea 32); PGW=$(alea 32); RED=$(alea 32); S3K=$(alea 20); S3S=$(alea 40); KCA=$(alea 24); KCS=$(alea 40); SES=$(alea 48)
cat > .env <<ENV
# Secrets LOCAUX générés le $(date +%Y-%m-%d). Ne pas réutiliser hors de ce poste.
PG_ADMIN_USER=comtaple_admin
PG_ADMIN_PASSWORD=$PGA
PG_APP_PASSWORD=$PGP
PG_WORKER_PASSWORD=$PGW
PG_HOST=127.0.0.1
PG_PORT=5432
PG_DATABASE=comtaple
REDIS_PASSWORD=$RED
REDIS_URL=redis://:$RED@127.0.0.1:6379
S3_ENDPOINT=http://127.0.0.1:8333
S3_REGION=local
S3_BUCKET=comtaple-dev
S3_ACCESS_KEY=$S3K
S3_SECRET_KEY=$S3S
KC_ADMIN_USER=admin
KC_ADMIN_PASSWORD=$KCA
OIDC_ISSUER=http://localhost:8080/realms/comtaple
OIDC_CLIENT_ID=comtaple-web
OIDC_CLIENT_SECRET=$KCS
OIDC_AUDIENCE=comtaple-api
SESSION_SECRET=$SES
JETONS_CLE_CHIFFREMENT=$(alea 43)
API_URL=http://127.0.0.1:4000
WEB_URL=http://localhost:3100
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
OCR_URL=http://127.0.0.1:8500
ANTIVIRUS_OBLIGATOIRE=true
# Passerelle IA : laisser vide = statut « non connecté » (aucun appel sortant).
IA_OVH_ENDPOINT=
IA_OVH_JETON=
# Collecte par mail (@comtaple/mail). Identifiants OAuth VIDES = connecteurs « non connectés », aucune connexion possible.
# Voir packages/mail/docs/guide-connexion.md. Ne JAMAIS définir MAIL_SIMULATEUR_URL hors des tests (refusé en production).
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_SUJET_PUBSUB=
GOOGLE_PUSH_AUDIENCE=
GOOGLE_PUSH_COMPTE_SERVICE=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_LOCATAIRE=common
MAIL_URI_REDIRECTION=
MAIL_URL_PUBLIQUE_API=
MAIL_PERIODE_RATTRAPAGE_S=900
DEV_MDP_UTILISATEURS=$(alea 20)
ENV
chmod 600 .env
echo ".env généré."
