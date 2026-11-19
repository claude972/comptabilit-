#!/bin/sh
# Essai de restauration À PARTIR DE COPIES CHIFFRÉES, sur environnement isolé, avec une clé ÉPHÉMÈRE de test.
#
#  1) une paire de clés est créée pour l'essai, hors du dépôt, et détruite à la fin : aucune clé durable n'est créée,
#     configurée ni conservée (la garde d'une clé réelle reste à décider — docs/acces-externes.md) ;
#  2) un jeu chiffré complet de la dernière sauvegarde (base, manifeste, chaque objet, dernier export Keycloak) est constitué dans un dossier
#     TEMPORAIRE ; les sauvegardes d'origine ne sont ni chiffrées en place, ni modifiées, ni supprimées ;
#  3) contrôles sur le jeu chiffré : la base n'y est pas lisible, une autre clé ne le déchiffre pas ;
#  4) le jeu est déchiffré dans un second dossier temporaire, à partir des SEULES copies chiffrées et de la clé privée ;
#     l'empreinte de la base déchiffrée est comparée à celle de la sauvegarde d'origine ;
#  5) l'essai de restauration isolé habituel (scripts/essai-restauration.sh : PostgreSQL et stockage d'essai séparés) est
#     exécuté sur ce jeu déchiffré, puis l'export Keycloak déchiffré est restauré dans une instance Keycloak d'essai
#     séparée et comparé au Keycloak d'origine (scripts/essai-restauration-keycloak.sh) ;
#  6) dossiers temporaires et clé éphémère sont détruits ; les sauvegardes d'origine sont recomptées.
#
# Codes de sortie : ceux de scripts/essai-restauration.sh (0 réussi ; 3 restauration fidèle mais journal d'audit non
# intègre ; 4 service redémarré ; 5 refus) ; 1 pour tout échec propre au chiffrement.
set -eu
cd "$(dirname "$0")/.."
. "$HOME/.comtaple-outils/env.sh"
SAUVEGARDE="${1:-$(ls -t var/sauvegardes/*.dump | head -1)}"
NOM="$(basename "$SAUVEGARDE")"
[ -f "${SAUVEGARDE%.dump}.objets.json" ] || { echo "REFUS : pas de manifeste d'objets pour $SAUVEGARDE"; exit 5; }
# Dernier export Keycloak déjà présent dans les sauvegardes (aucun nouvel export n'est produit par cet essai).
KC="$(ls -t var/sauvegardes/keycloak-*.json 2>/dev/null | head -1 || true)"
[ -n "$KC" ] || { echo "REFUS : aucun export Keycloak dans var/sauvegardes (scripts/essai-restauration-keycloak.sh en produit un)"; exit 5; }
NOM_KC="$(basename "$KC")"
AVANT="$(find var/sauvegardes -type f | wc -l | tr -d ' ') fichier(s), $(find var/sauvegardes -type f -name '*.chiffre' | wc -l | tr -d ' ') chiffré(s)"
EMPREINTE_ORIGINE="$(cut -d' ' -f1 "$SAUVEGARDE.sha256")"
mkdir -p var
T="$(mktemp -d "$PWD/var/essai-chiffre.XXXXXX")"
CLES="$(mktemp -d)"
nettoyer() { rm -rf "$T" "$CLES"; }
trap nettoyer EXIT INT TERM
chmod 700 "$T" "$CLES"

echo "--- 1) clé éphémère de test (détruite à la fin de l'essai) ---"
node scripts/chiffrer-sauvegardes.mjs generer-cles "$CLES/a" | head -1 | sed "s#$CLES#<dossier temporaire>#"
node scripts/chiffrer-sauvegardes.mjs generer-cles "$CLES/autre" >/dev/null
PUB="$CLES/a/comtaple-sauvegardes.cle-publique.pem"; PRIV="$CLES/a/comtaple-sauvegardes.cle-privee.pem"

echo "--- 2) jeu chiffré complet, dans un dossier temporaire ---"
DEBUT=$(date +%s)
node scripts/chiffrer-sauvegardes.mjs copie-chiffree --cle-publique "$PUB" --destination "$T/chiffre" --keycloak "$KC" "$SAUVEGARDE"
echo "Chiffrement : $(( $(date +%s) - DEBUT )) s ; jeu chiffré : $(du -sh "$T/chiffre" | cut -f1 | tr -d ' ') dans $(find "$T/chiffre" -type f | wc -l | tr -d ' ') fichier(s)"

echo "--- 3) contrôles sur le jeu chiffré ---"
[ -z "$(find "$T/chiffre" -type f ! -name '*.chiffre')" ] || { echo "ÉCHEC : le jeu chiffré contient un fichier en clair"; exit 1; }
# Une sauvegarde PostgreSQL commence par « PGDMP » ; le manifeste par une accolade : ni l'un ni l'autre ne doit se lire.
[ "$(head -c 5 "$T/chiffre/$NOM.chiffre")" != "PGDMP" ] || { echo "ÉCHEC : la base est lisible dans le jeu chiffré"; exit 1; }
! grep -q '"cle"' "$T/chiffre/${NOM%.dump}.objets.json.chiffre" || { echo "ÉCHEC : le manifeste est lisible dans le jeu chiffré"; exit 1; }
# L'export Keycloak contient des empreintes de mots de passe et un secret de client : rien ne doit s'en lire.
! grep -qE '"realm"|secret|credentials|@cabinet' "$T/chiffre/$NOM_KC.chiffre" || { echo "ÉCHEC : l'export Keycloak est lisible dans le jeu chiffré"; exit 1; }
echo "Aucun fichier en clair ; base, manifeste et export Keycloak illisibles sans la clé"
mkdir "$T/refus"
if node scripts/chiffrer-sauvegardes.mjs dechiffrer --cle-privee "$CLES/autre/comtaple-sauvegardes.cle-privee.pem" "$T/chiffre/$NOM.chiffre" "$T/refus/base" >/dev/null 2>&1; then
  echo "ÉCHEC : une autre clé a déchiffré la base"; exit 1
fi
echo "Une autre clé privée ne déchiffre pas la base"
# Un objet chiffré altéré d'un octet doit être refusé au déchiffrement.
UN="$(find "$T/chiffre/objets" -type f -size +2k | head -1)"
cp "$UN" "$T/refus/altere.chiffre"
printf 'X' | dd of="$T/refus/altere.chiffre" bs=1 seek=900 conv=notrunc 2>/dev/null
if node scripts/chiffrer-sauvegardes.mjs dechiffrer --cle-privee "$PRIV" "$T/refus/altere.chiffre" "$T/refus/objet" >/dev/null 2>&1; then
  echo "ÉCHEC : un objet chiffré altéré a été accepté"; exit 1
fi
echo "Un objet chiffré altéré d'un octet est refusé"
rm -rf "$T/refus"

echo "--- 4) déchiffrement à partir des seules copies chiffrées ---"
DEBUT=$(date +%s)
node scripts/chiffrer-sauvegardes.mjs dechiffrer-copie --cle-privee "$PRIV" --source "$T/chiffre" --destination "$T/clair" "$NOM" | sed 's/(sha256 [0-9a-f]*)//'
echo "Déchiffrement : $(( $(date +%s) - DEBUT )) s"
EMPREINTE_RESTAUREE="$(shasum -a 256 "$T/clair/$NOM" | cut -d' ' -f1)"
[ "$EMPREINTE_RESTAUREE" = "$EMPREINTE_ORIGINE" ] && echo "Base déchiffrée : empreinte identique à la sauvegarde d'origine" || { echo "ÉCHEC : la base déchiffrée diffère de la sauvegarde d'origine"; exit 1; }
cmp -s "$T/clair/${NOM%.dump}.objets.json" "${SAUVEGARDE%.dump}.objets.json" && echo "Manifeste déchiffré : identique à l'original" || { echo "ÉCHEC : manifeste déchiffré différent"; exit 1; }
cmp -s "$T/clair/$NOM_KC" "$KC" && echo "Export Keycloak déchiffré : identique à l'original" || { echo "ÉCHEC : export Keycloak déchiffré différent"; exit 1; }
rm -rf "$T/chiffre"   # la suite ne peut plus s'appuyer que sur le jeu déchiffré
shasum -a 256 "$T/clair/$NOM" > "$T/clair/$NOM.sha256"
shasum -a 256 "$T/clair/${NOM%.dump}.objets.json" > "$T/clair/${NOM%.dump}.objets.json.sha256"

echo "--- 5) restauration isolée à partir du jeu déchiffré ---"
CODE=0
SAUVEGARDE_DEPOT_OBJETS="$T/clair/objets" sh scripts/essai-restauration.sh "$T/clair/$NOM" || CODE=$?

echo "--- 5 bis) Keycloak : restauration isolée à partir de l'export déchiffré ---"
CODE_KC=0
KEYCLOAK_EXPORT="$T/clair/$NOM_KC" sh scripts/essai-restauration-keycloak.sh > "$T/keycloak.log" 2>&1 || CODE_KC=$?
echo "Contrôles conformes : $(grep -c "^conforme" "$T/keycloak.log")"; grep -vE "^conforme" "$T/keycloak.log" || true

echo "--- 6) nettoyage ---"
trap - EXIT INT TERM
nettoyer
APRES="$(find var/sauvegardes -type f | wc -l | tr -d ' ') fichier(s), $(find var/sauvegardes -type f -name '*.chiffre' | wc -l | tr -d ' ') chiffré(s)"
echo "Dossiers temporaires et clé éphémère détruits. Sauvegardes d'origine : $AVANT avant, $APRES après."
[ "$AVANT" = "$APRES" ] || { echo "ÉCHEC : les sauvegardes d'origine ont changé pendant l'essai"; exit 1; }
[ "$CODE_KC" = "0" ] || { echo "Restauration de Keycloak depuis la copie chiffrée : ÉCHEC"; exit 1; }
echo "Restauration de Keycloak depuis la copie chiffrée : RÉUSSIE"
case "$CODE" in
  0) echo "Restauration depuis des copies chiffrées : RÉUSSIE" ;;
  3) echo "Restauration depuis des copies chiffrées : DONNÉES RESTAURÉES FIDÈLEMENT ; contrôle d'intégrité du journal en échec, comme pour la sauvegarde en clair (D-038)" ;;
  *) echo "Restauration depuis des copies chiffrées : ÉCHEC (code $CODE)" ;;
esac
exit "$CODE"
