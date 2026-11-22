#!/bin/sh
# CONTRÔLE DU PROFIL COLIMA / LIMA (D-108) : protège les AUTRES projets de la machine.
#
# Constat (2026-11-21) : l'environnement de la session exportait LIMA_HOME vers le dossier d'un autre projet
# (/Volumes/Stockage/colima-dev-home/_lima). Un `colima start` lancé depuis Comtaple a alors créé une machine virtuelle et un
# disque de 80 Go vides DANS CE DOSSIER, au lieu de reprendre la VM de Comtaple. Ce contrôle refuse de poursuivre quand
# l'environnement ne désigne pas, sans ambiguïté, les ressources de Comtaple.
#
# Usage :
#   sh scripts/verifier-profil-colima.sh            vérifie l'environnement courant (aucune commande Colima ni Docker n'est lancée)
#   sh scripts/verifier-profil-colima.sh --demarrer vérifie PUIS lance `colima start` (profil « default » de Comtaple)
# Code de sortie : 0 conforme ; 1 non conforme (aucune VM, aucun disque n'est créé).
#
# Règles (toutes exigées) :
#   1. COLIMA_HOME est défini et se termine par « /comtaple-outils/colima » ou « /.comtaple-outils/colima » (outillage de Comtaple ; le second est le lien du dossier personnel) ;
#   2. LIMA_HOME, s'il est défini, est EXACTEMENT « $COLIMA_HOME/_lima » ; défini ailleurs, c'est le dossier d'un autre projet : refus ;
#   3. DOCKER_HOST, s'il est défini, désigne le socket de Comtaple (« $COLIMA_HOME/default/docker.sock ») ;
#   4. ~/.colima ne doit pas servir de repli silencieux : si COLIMA_HOME n'existe pas, refus (Colima retomberait sur ~/.colima).
# Le script ne supprime ni ne modifie jamais rien : il lit des variables d'environnement et teste l'existence d'un dossier.
set -u
erreurs=0
refuse() { echo "REFUS : $1" >&2; erreurs=$((erreurs + 1)); }

colima_home="${COLIMA_HOME:-}"
if [ -z "$colima_home" ]; then
  refuse "COLIMA_HOME n'est pas défini (faire d'abord : source \"\$HOME/.comtaple-outils/env.sh\"). Sans lui, Colima utiliserait ~/.colima, qui peut appartenir à un autre projet."
else
  case "$colima_home" in
    */comtaple-outils/colima | */.comtaple-outils/colima) ;;
    *) refuse "COLIMA_HOME=$colima_home ne désigne pas l'outillage de Comtaple (attendu : …/comtaple-outils/colima ou …/.comtaple-outils/colima)." ;;
  esac
  [ -d "$colima_home" ] || refuse "COLIMA_HOME=$colima_home n'existe pas : Colima retomberait sur ~/.colima, hors de Comtaple."
fi

if [ -n "${LIMA_HOME:-}" ] && [ -n "$colima_home" ] && [ "$LIMA_HOME" != "$colima_home/_lima" ]; then
  refuse "LIMA_HOME=$LIMA_HOME diffère de $colima_home/_lima : ce dossier n'est pas celui de Comtaple (autre projet ?). Un « colima start » y créerait une VM et un disque. Corriger avec : unset LIMA_HOME (ou source \"\$HOME/.comtaple-outils/env.sh\")."
fi

if [ -n "${DOCKER_HOST:-}" ] && [ -n "$colima_home" ] && [ "$DOCKER_HOST" != "unix://$colima_home/default/docker.sock" ]; then
  refuse "DOCKER_HOST=$DOCKER_HOST ne désigne pas le socket de Comtaple (unix://$colima_home/default/docker.sock) : les commandes docker agiraient sur une autre machine."
fi

if [ "$erreurs" -gt 0 ]; then
  echo "Profil Colima NON conforme ($erreurs problème(s)) : rien n'a été lancé, rien n'a été créé." >&2
  exit 1
fi
echo "Profil Colima conforme : COLIMA_HOME=$colima_home, LIMA_HOME=${LIMA_HOME:-<non défini : Colima utilisera $colima_home/_lima>}."
if [ "${1:-}" = "--demarrer" ]; then
  exec env -u LIMA_HOME LIMA_HOME="$colima_home/_lima" colima start
fi
