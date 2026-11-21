#!/bin/sh
# RESTAURATION CHRONOMÉTRÉE ET ISOLÉE (parcours 10 de la recette ; P4, D-102).
#
# Enchaîne, sur RESSOURCES JETABLES, la restauration complète d'un jeu de sauvegarde À PARTIR DE COPIES CHIFFRÉES avec une clé
# ÉPHÉMÈRE (créée hors du dépôt, détruite à la fin) : chiffrement du jeu, contrôles (rien en clair, autre clé refusée, objet altéré
# refusé), déchiffrement, comparaison des empreintes à l'original, restauration de la base dans un PostgreSQL d'essai séparé,
# rechargement de TOUS les objets dans un stockage d'essai séparé et relecture de chacun contre son empreinte, restauration de
# l'export Keycloak dans une instance d'essai. Voir scripts/essai-restauration-chiffree.sh (détail de chaque étape).
#
# Ce script AJOUTE : le contrôle d'espace avant de commencer (diagnostic de préparation), le chronométrage de chaque phase, un
# tableau final lisible et un code de sortie. Il ne modifie ni la base, ni le stockage, ni Keycloak, ni var/sauvegardes de l'application
# (la base d'origine n'est que LUE pour comparer ; les sauvegardes d'origine sont recomptées avant/après).
#
# Usage : scripts/essai-restauration-chronometree.sh [<sauvegarde>.dump]      (défaut : la plus récente de var/sauvegardes)
# Codes : ceux de essai-restauration-chiffree.sh (0 réussi ; 3 données fidèles mais journal non intègre ; 4 service redémarré ; 5 refus ;
# 1 échec). Journal complet : var/essai-restauration-chronometree.log.
#
# Limites : mesure faite sur le poste de développement (VM Docker locale, disque partagé) ; les durées ne se transposent pas à une base
# managée ni à un hébergeur (ni débit, ni création d'un nouveau service, ni copie réseau). Rien ici n'est un RTO engagé.
set -eu
cd "$(dirname "$0")/.."
. "$HOME/.comtaple-outils/env.sh"
JOURNAL=var/essai-restauration-chronometree.log
DEBUT=$(date +%s)
echo "Début : $(date '+%Y-%m-%d %H:%M:%S')"
SAUV="${1:-$(ls -t var/sauvegardes/*.dump | head -1)}"
echo "Jeu restauré : $(basename "$SAUV") — base $(du -h "$SAUV" | cut -f1 | tr -d ' ')"
node -e 'const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(`Objets : ${m.objets?.length ?? m.nombre ?? "?"} objet(s), ${(m.octets / 2 ** 30).toFixed(2)} Go`)' "${SAUV%.dump}.objets.json" 2>/dev/null || true
echo "--- espace (lecture seule) ---"
node scripts/verifier-preparation.mjs --sans-sondes --sans-empreintes --sauvegardes=var/sauvegardes 2>/dev/null | grep -E "Espace|Hôte|VM Docker" || true
# Réseau d'essai dédié (voir essai-restauration.sh) : créé s'il manque, conservé (il ne contient que des conteneurs d'essai éphémères).
docker network inspect comtaple_essai_reseau >/dev/null 2>&1 || docker network create comtaple_essai_reseau >/dev/null
CODE=0
sh scripts/essai-restauration-chiffree.sh "$SAUV" > "$JOURNAL" 2>&1 || CODE=$?
FIN=$(date +%s)
echo
echo "== Durées mesurées (secondes, poste local) =="
grep -E "^(Chiffrement|Déchiffrement|Restauration de la base dans une instance séparée|Rechargement et vérification du stockage)" "$JOURNAL" || true
echo "Durée totale de l'essai : $((FIN - DEBUT)) s"
echo "== Intégrité =="
grep -E "empreinte identique|Manifeste déchiffré|Export Keycloak déchiffré|Journal d'audit|RLS :|Politiques RLS|Jeu de sauvegarde|Comptes de la base RESTAURÉE|Accès anonyme|Objets référencés|Aucun fichier en clair|Une autre clé|altéré|Services de l'application|Dossiers temporaires|Contrôles conformes|Restauration de Keycloak|Restauration depuis|Essai de restauration|volumes|ÉCHEC|ATTENTION" "$JOURNAL" || true
echo "Code de sortie : $CODE (journal complet : $JOURNAL)"
exit "$CODE"
