#!/bin/sh
# Déploiement de Comtaple sur l'hôte de production (Docker Compose par SSH).
#
# ÉTAT : seul le mode `--a-blanc` a été exécuté (il n'exécute rien). Le déploiement réel n'a JAMAIS été joué : il
# n'existe ni registre, ni hôte, ni base managée. Voir docs/deploiement.md et docs/exploitation.md.
#
# Enchaînement :
#   1. contrôles (variables, dépôt propre, fichiers d'environnement présents sur l'hôte) ;
#   2. construction des images, étiquetées par l'empreinte du commit ;
#   3. envoi vers le registre ;
#   4. copie de la composition sur l'hôte, téléchargement des images ;
#   5. MIGRATION de la base avec la nouvelle image, AVANT la bascule (les services en place tournent encore) ;
#   6. bascule (`docker compose up -d --wait`) ;
#   7. vérification de santé (conteneurs, puis adresses publiques) ;
#   8. enregistrement de la version en service et de la précédente (pour le retour arrière).
#
# Usage :
#   REGISTRE=… HOTE_APPLICATIONS=… ENVIRONNEMENT=… DOMAINE_WEB=… DOMAINE_AUTH=… CONFIRMER_PRODUCTION=oui scripts/deployer.sh
#   … scripts/deployer.sh --a-blanc             affiche les commandes sans rien exécuter (ni construction, ni SSH)
#   … scripts/deployer.sh --retour              remet en service la version précédente enregistrée sur l'hôte
#   … scripts/deployer.sh --retour <version>    remet en service une version donnée (image déjà dans le registre)
#
# Variables OBLIGATOIRES (aucune valeur par défaut) :
#   REGISTRE            adresse du registre et projet, sans barre finale (ex. xxxx.gra7.container-registry.ovh.net/comtaple)
#   HOTE_APPLICATIONS   cible SSH de l'instance applicative (ex. deploiement@203.0.113.10)
#   ENVIRONNEMENT       nom de l'environnement (recette, production) — rappelé à chaque étape
#   DOMAINE_WEB         nom public de l'application (vérification de santé)
#   DOMAINE_AUTH        nom public de Keycloak (vérification de santé)
#   CONFIRMER_PRODUCTION=oui   exigé hors mode à blanc
# Variables facultatives :
#   HOTE_SUPERVISION    cible SSH de l'instance de supervision ; vide = supervision non déployée
#   DOSSIER_DISTANT     dossier de l'hôte (défaut : /srv/comtaple) ; doit contenir production.env et migration.env
#   PLATEFORME          plateforme des images (défaut : linux/amd64)
#   OPTIONS_SSH         options passées à ssh et scp
#
# RETOUR ARRIÈRE : `--retour` relance la composition avec les images de la version précédente. Il NE DÉFAIT PAS les
# migrations de base : il n'est sûr que si la migration de la version retirée est compatible avec la version remise
# en service (ajouts seulement). Sinon, c'est une restauration de la base (docs/exploitation.md, « Reprise »).
#
# Codes de sortie : 0 réussi ; 2 refus (variable manquante, confirmation absente, dépôt non propre) ; autre : échec
# d'une étape (le script s'arrête à la première commande en échec ; la bascule n'a lieu que si la migration a réussi).
set -eu
cd "$(dirname "$0")/.."

A_BLANC=0
RETOUR=0
VERSION_RETOUR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --a-blanc) A_BLANC=1 ;;
    --retour)
      RETOUR=1
      if [ $# -gt 1 ] && [ "${2#--}" = "$2" ]; then VERSION_RETOUR="$2"; shift; fi ;;
    -h | --aide) sed -n '2,42p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Option inconnue : $1 (voir --aide)" >&2; exit 2 ;;
  esac
  shift
done

refuser() { echo "REFUS : $1" >&2; exit 2; }

# ── 1. Contrôles ──
manquantes=""
for v in REGISTRE HOTE_APPLICATIONS ENVIRONNEMENT DOMAINE_WEB DOMAINE_AUTH; do
  eval "valeur=\${$v:-}"
  [ -n "$valeur" ] || manquantes="$manquantes $v"
done
[ -z "$manquantes" ] || refuser "variables obligatoires non définies :$manquantes. Rien n'a été exécuté."
case "$REGISTRE" in */) refuser "REGISTRE ne doit pas se terminer par une barre." ;; esac
if [ "$A_BLANC" -eq 0 ] && [ "${CONFIRMER_PRODUCTION:-}" != "oui" ]; then
  refuser "CONFIRMER_PRODUCTION=oui est exigé pour un déploiement réel (ou utiliser --a-blanc). Rien n'a été exécuté."
fi

DOSSIER_DISTANT="${DOSSIER_DISTANT:-/srv/comtaple}"
PLATEFORME="${PLATEFORME:-linux/amd64}"
OPTIONS_SSH="${OPTIONS_SSH:-}"
HOTE_SUPERVISION="${HOTE_SUPERVISION:-}"

if [ "$RETOUR" -eq 1 ]; then
  VERSION="$VERSION_RETOUR"
  [ -n "$VERSION" ] || VERSION="<version-precedente-lue-sur-hote>"
else
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || refuser "ce dossier n'est pas un dépôt git : l'empreinte du commit sert d'étiquette aux images."
  VERSION=$(git rev-parse --short=12 HEAD)
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    if [ "$A_BLANC" -eq 1 ]; then
      echo "ATTENTION : le dépôt contient des modifications non validées ; un déploiement réel serait REFUSÉ (l'image ne correspondrait pas au commit $VERSION)."
    else
      refuser "le dépôt contient des modifications non validées : l'image ne correspondrait pas au commit $VERSION."
    fi
  fi
fi

# Toute commande passe par l'une de ces deux fonctions : en mode à blanc, elle est affichée et RIEN n'est exécuté.
# shellcheck disable=SC2086
localement() {
  echo "+ $*"
  [ "$A_BLANC" -eq 1 ] || "$@"
}
# shellcheck disable=SC2086,SC2029
sur() { # sur <hôte> <commande>
  echo "+ ssh $OPTIONS_SSH $1 '$2'"
  [ "$A_BLANC" -eq 1 ] || ssh $OPTIONS_SSH "$1" "$2"
}
# shellcheck disable=SC2086
copier() { # copier <fichier local> <hôte> <chemin distant>
  echo "+ scp $OPTIONS_SSH $1 $2:$3"
  [ "$A_BLANC" -eq 1 ] || scp $OPTIONS_SSH "$1" "$2:$3"
}
etape() { echo; echo "── $1 [$ENVIRONNEMENT] ──"; }

if [ "$A_BLANC" -eq 1 ]; then echo "MODE À BLANC : les commandes sont affichées, AUCUNE n'est exécutée (ni construction, ni envoi, ni SSH)."; fi
echo "Environnement : $ENVIRONNEMENT — hôte : $HOTE_APPLICATIONS — registre : $REGISTRE — version : $VERSION"

COMPOSE="docker compose --env-file production.env -f compose.production.yaml"

etape "Contrôle de l'hôte"
sur "$HOTE_APPLICATIONS" "cd $DOSSIER_DISTANT && test -s production.env && test -s migration.env && docker compose version"

if [ "$RETOUR" -eq 1 ]; then
  etape "Retour arrière"
  if [ -z "$VERSION_RETOUR" ]; then
    if [ "$A_BLANC" -eq 1 ]; then
      echo "+ ssh $OPTIONS_SSH $HOTE_APPLICATIONS 'cat $DOSSIER_DISTANT/VERSION_PRECEDENTE'"
    else
      # shellcheck disable=SC2086,SC2029
      VERSION=$(ssh $OPTIONS_SSH "$HOTE_APPLICATIONS" "cat $DOSSIER_DISTANT/VERSION_PRECEDENTE") || refuser "aucune version précédente enregistrée sur l'hôte : préciser --retour <version>."
      case "$VERSION" in *[!0-9a-f]* | "") refuser "version précédente illisible sur l'hôte." ;; esac
    fi
  fi
  echo "Les migrations de base ne sont PAS défaites : voir l'en-tête de ce script."
else
  etape "Construction des images ($PLATEFORME)"
  for cible in api worker web; do
    localement docker build --platform "$PLATEFORME" --target "$cible" -t "$REGISTRE/comtaple-$cible:$VERSION" .
  done
  localement docker build --platform "$PLATEFORME" -t "$REGISTRE/comtaple-ocr:$VERSION" services/ocr
  localement docker build --platform "$PLATEFORME" -f infra/keycloak/Dockerfile.production -t "$REGISTRE/comtaple-keycloak:$VERSION" infra/keycloak
  if [ -n "$HOTE_SUPERVISION" ]; then
    localement docker build --platform "$PLATEFORME" -t "$REGISTRE/comtaple-prometheus:$VERSION" infra/supervision/prometheus
    localement docker build --platform "$PLATEFORME" -t "$REGISTRE/comtaple-grafana:$VERSION" infra/supervision/grafana
  fi

  etape "Envoi vers le registre"
  for image in api worker web ocr keycloak; do
    localement docker push "$REGISTRE/comtaple-$image:$VERSION"
  done
  if [ -n "$HOTE_SUPERVISION" ]; then
    localement docker push "$REGISTRE/comtaple-prometheus:$VERSION"
    localement docker push "$REGISTRE/comtaple-grafana:$VERSION"
  fi

  etape "Composition et images sur l'hôte"
  copier infra/production/compose.production.yaml "$HOTE_APPLICATIONS" "$DOSSIER_DISTANT/compose.production.yaml.$VERSION"
  sur "$HOTE_APPLICATIONS" "cd $DOSSIER_DISTANT && cp compose.production.yaml.$VERSION compose.production.yaml && REGISTRE=$REGISTRE VERSION=$VERSION $COMPOSE config -q && REGISTRE=$REGISTRE VERSION=$VERSION $COMPOSE --profile migration pull"

  # Le rôle de migration n'existe que dans migration.env, lu par cette seule commande ; aucun service ne le reçoit.
  etape "Migration de la base (AVANT la bascule)"
  sur "$HOTE_APPLICATIONS" "cd $DOSSIER_DISTANT && REGISTRE=$REGISTRE VERSION=$VERSION docker compose --env-file production.env --env-file migration.env -f compose.production.yaml --profile migration run --rm migration"
fi

etape "Bascule"
sur "$HOTE_APPLICATIONS" "cd $DOSSIER_DISTANT && REGISTRE=$REGISTRE VERSION=$VERSION $COMPOSE up -d --wait --wait-timeout 900 --remove-orphans"

etape "Vérification de santé"
sur "$HOTE_APPLICATIONS" "cd $DOSSIER_DISTANT && REGISTRE=$REGISTRE VERSION=$VERSION $COMPOSE ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}'"
localement curl -fsS -m 20 -o /dev/null "https://$DOMAINE_WEB/connexion"
localement curl -fsS -m 20 -o /dev/null "https://$DOMAINE_AUTH/realms/comtaple/.well-known/openid-configuration"

etape "Enregistrement de la version en service"
sur "$HOTE_APPLICATIONS" "cd $DOSSIER_DISTANT && { [ ! -f VERSION_COURANTE ] || [ \"\$(cat VERSION_COURANTE)\" = $VERSION ] || cp VERSION_COURANTE VERSION_PRECEDENTE; } && echo $VERSION > VERSION_COURANTE"

if [ -n "$HOTE_SUPERVISION" ] && [ "$RETOUR" -eq 0 ]; then
  etape "Supervision"
  copier infra/supervision/compose.supervision.yaml "$HOTE_SUPERVISION" "$DOSSIER_DISTANT/compose.supervision.yaml"
  sur "$HOTE_SUPERVISION" "cd $DOSSIER_DISTANT && test -s supervision.env && REGISTRE=$REGISTRE VERSION=$VERSION docker compose --env-file supervision.env -f compose.supervision.yaml up -d --no-build --wait --wait-timeout 300"
fi

echo
if [ "$A_BLANC" -eq 1 ]; then
  echo "FIN DU MODE À BLANC : rien n'a été exécuté."
else
  echo "Déploiement terminé : $ENVIRONNEMENT en version $VERSION."
  echo "En cas de problème : scripts/deployer.sh --retour (voir les limites en tête de script)."
fi
