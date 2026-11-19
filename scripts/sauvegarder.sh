#!/bin/sh
# Sauvegarde LOCALE dans var/sauvegardes/ sous forme de JEU : base, export Keycloak et objets du stockage, avec un
# descripteur « .jeu.json » écrit en dernier. La base et Keycloak sont capturés au même instant du point de vue de
# Keycloak (gel bref, sans arrêt) ; les objets sont copiés ensuite. Ce n'est pas une capture atomique de l'ensemble.
# En production, la sauvegarde s'appuie sur les mécanismes de l'hébergeur (voir docs/deploiement.md) ;
# ce script sert au développement et à l'essai de restauration.
set -eu
cd "$(dirname "$0")/.."
. "$HOME/.comtaple-outils/env.sh"
set -a; . ./.env; set +a
# Capture du jeu (base + export Keycloak + objets) : voir scripts/sauvegarder-jeu.mjs pour l'ordre et ses garanties.
RESULTAT="$(node scripts/sauvegarder-jeu.mjs)"
echo "$RESULTAT" | sed '$d'
CIBLE="$(echo "$RESULTAT" | tail -1)"
# Chiffrement (préparation) : seulement si une clé PUBLIQUE est désignée. Les fichiers en clair restent en place.
if [ -n "${SAUVEGARDE_CLE_PUBLIQUE:-}" ]; then
  node scripts/chiffrer-sauvegardes.mjs chiffrer --cle-publique "$SAUVEGARDE_CLE_PUBLIQUE" "$CIBLE" "${CIBLE%.dump}.objets.json" "${CIBLE%.dump}.keycloak.json" "${CIBLE%.dump}.jeu.json"
else
  echo "Sauvegarde EN CLAIR : aucune clé publique désignée (SAUVEGARDE_CLE_PUBLIQUE). Voir docs/deploiement.md."
fi
echo "$CIBLE"
