#!/bin/sh
# Vérifie, sur le site OFFICIEL public du BOFiP, que chaque document cité par les règles de Comtaple est toujours
# « en vigueur » dans la version attendue (docs/sources-officielles.tsv). Lecture seule, aucun compte, aucun contournement :
# ce sont les pages publiques du bulletin. Sortie 1 si une version attendue n'est plus en vigueur ou si une page ne répond pas.
#   sh scripts/verifier-sources-bofip.sh
# Ce que ce script NE vérifie PAS : le texte de loi (Légifrance, accès automatisé refusé : voir docs/sources-officielles.md)
# ni le CONTENU des documents — seulement leur statut « en vigueur » et leur version.
set -eu
cd "$(dirname "$0")/.."
echo "Vérification au $(date +%F) — site officiel https://bofip.impots.gouv.fr"
erreurs=0
grep -v '^#' docs/sources-officielles.tsv | while IFS="$(printf '\t')" read -r id version pgp usage; do
  [ -n "$id" ] || continue
  page="$(curl -sL -m 40 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15' "https://bofip.impots.gouv.fr/bofip/${pgp}-PGP.html/identifiant%3D${version}" || true)"
  etat="$(printf '%s' "$page" | grep -oE "en vigueur du [0-9/]+ (à aujourd(&#039;|')hui|au [0-9/]+)" | head -1 | sed "s/&#039;/'/")"
  case "$etat" in
    *"à aujourd'hui") echo "OK       $version — $etat" ;;
    "")               echo "ÉCHEC    $version — page absente ou illisible"; exit 1 ;;
    *)                echo "OBSOLÈTE $version — $etat"; exit 1 ;;
  esac
done || erreurs=1
[ "$erreurs" = 0 ] && echo "Toutes les versions attendues sont en vigueur." || { echo "AU MOINS UNE VERSION A CHANGÉ OU EST INJOIGNABLE : relire le document concerné."; exit 1; }
