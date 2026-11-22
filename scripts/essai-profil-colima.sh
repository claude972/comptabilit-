#!/bin/sh
# Essai du contrôle de profil Colima (D-108) : environnements simulés, AUCUNE commande Colima ni Docker, aucun dossier créé.
set -u
cd "$(dirname "$0")/.."
base=$(mktemp -d)
trap 'rm -rf "$base"' EXIT
mkdir -p "$base/comtaple-outils/colima" "$base/autre/_lima"
bon="$base/comtaple-outils/colima"
echec=0
verifie() { # nom attendu(0|1) [VAR=val ...]
  nom="$1"; attendu="$2"; shift 2
  sortie=$(env -i PATH="$PATH" "$@" sh scripts/verifier-profil-colima.sh 2>&1); code=$?
  if [ "$code" -eq "$attendu" ]; then echo "OK    $nom (sortie $code)"; else echo "ÉCHEC $nom : sortie $code, attendu $attendu : $sortie"; echo "$sortie" | head -3; echec=1; fi
}
verifie "profil Comtaple, LIMA_HOME non défini" 0 COLIMA_HOME="$bon"
verifie "profil Comtaple, LIMA_HOME conforme" 0 COLIMA_HOME="$bon" LIMA_HOME="$bon/_lima" DOCKER_HOST="unix://$bon/default/docker.sock"
verifie "LIMA_HOME d'un autre projet (le cas du 2026-11-21)" 1 COLIMA_HOME="$bon" LIMA_HOME="$base/autre/_lima"
verifie "DOCKER_HOST d'une autre machine" 1 COLIMA_HOME="$bon" DOCKER_HOST="unix://$base/autre/docker.sock"
verifie "COLIMA_HOME non défini" 1
verifie "COLIMA_HOME hors de l'outillage Comtaple" 1 COLIMA_HOME="$base/autre"
mkdir -p "$base/absent-outils"
verifie "COLIMA_HOME inexistant (repli sur ~/.colima)" 1 COLIMA_HOME="$base/inexistant/comtaple-outils/colima"
# Rien ne doit avoir été créé par le contrôle.
[ ! -e "$base/autre/_lima/_disks" ] && echo "OK    aucun disque ni dossier créé dans le dossier de l'autre projet" || { echo "ÉCHEC un dossier a été créé"; echec=1; }
exit "$echec"
