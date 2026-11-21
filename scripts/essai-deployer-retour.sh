#!/bin/sh
# ESSAI LOCAL de la logique de BASCULE et de RETOUR ARRIÈRE de scripts/deployer.sh, sans hôte, sans registre, sans Docker ni réseau.
# `ssh` et `scp` sont remplacés par des fonctions locales qui exécutent la commande dans un dossier jetable (le « dossier distant »),
# `docker` et `curl` par des enregistreurs : on vérifie QUELLE version la bascule demande à Compose et ce que le script écrit dans
# VERSION_COURANTE / VERSION_PRECEDENTE. Ce que l'essai ne prouve PAS : qu'une image démarre, que Compose bascule vraiment, la
# migration, TLS, le SSH réel (voir docs/exploitation.md § 10 bis).
#
# Codes : 0 conforme ; 1 écart.
set -eu
cd "$(dirname "$0")/.."
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT INT TERM
mkdir -p "$T/bin" "$T/distant"
cat > "$T/bin/ssh" <<'SHIM'
#!/bin/sh
shift   # l'hôte ; la commande suit (aucune option SSH n'est passée dans cet essai)
exec sh -c "$1"
SHIM
cat > "$T/bin/scp" <<'SHIM'
#!/bin/sh
cp "$1" "${2#*:}"
SHIM
cat > "$T/bin/docker" <<'SHIM'
#!/bin/sh
echo "VERSION=${VERSION:-} docker $*" >> "$JOURNAL_SHIM"
SHIM
cat > "$T/bin/curl" <<'SHIM'
#!/bin/sh
echo "curl $*" >> "$JOURNAL_SHIM"
SHIM
chmod +x "$T/bin/"*
export JOURNAL_SHIM="$T/journal.txt"
: > "$JOURNAL_SHIM"
D="$T/distant"
echo "aaaa11112222" > "$D/VERSION_PRECEDENTE"; echo "bbbb33334444" > "$D/VERSION_COURANTE"
echo "x" > "$D/production.env"; echo "x" > "$D/migration.env"
ECHECS=0
controle() { if [ "$2" = "$3" ]; then echo "[CONFORME] $1"; else echo "[ÉCHEC   ] $1 — attendu « $3 », obtenu « $2 »"; ECHECS=$((ECHECS + 1)); fi; }
lancer() {
  PATH="$T/bin:$PATH" REGISTRE=registre.essai.test/comtaple HOTE_APPLICATIONS=essai@hote ENVIRONNEMENT=essai DOMAINE_WEB=app.essai.test DOMAINE_AUTH=auth.essai.test \
    DOSSIER_DISTANT="$D" CONFIRMER_PRODUCTION=oui sh scripts/deployer.sh "$@" > "$T/sortie.txt" 2>&1
}
echo "--- retour automatique à la version précédente enregistrée (sans argument) ---"
lancer --retour || { cat "$T/sortie.txt"; exit 1; }
controle "la bascule demande la version précédente à Compose" "$(grep -c 'VERSION=aaaa11112222 docker compose .* up -d --wait' "$JOURNAL_SHIM")" "1"
controle "aucune migration n'est lancée par un retour" "$(grep -c 'run --rm migration' "$JOURNAL_SHIM")" "0"
controle "aucune construction ni envoi d'image" "$(grep -c 'docker build\|docker push' "$JOURNAL_SHIM")" "0"
controle "VERSION_COURANTE = ancienne précédente" "$(cat "$D/VERSION_COURANTE")" "aaaa11112222"
controle "VERSION_PRECEDENTE = ancienne courante (le retour est lui-même réversible)" "$(cat "$D/VERSION_PRECEDENTE")" "bbbb33334444"
grep -q "migrations de base ne sont PAS défaites" "$T/sortie.txt" && echo "[CONFORME] le script rappelle que les migrations ne sont pas défaites" || { echo "[ÉCHEC   ] avertissement sur les migrations absent"; ECHECS=$((ECHECS + 1)); }
echo "--- second retour : on revient à la version d'origine ---"
: > "$JOURNAL_SHIM"
lancer --retour
controle "retour du retour : version demandée" "$(grep -c 'VERSION=bbbb33334444 docker compose .* up -d --wait' "$JOURNAL_SHIM")" "1"
controle "VERSION_COURANTE rétablie" "$(cat "$D/VERSION_COURANTE")" "bbbb33334444"
echo "--- retour vers une version désignée ---"
: > "$JOURNAL_SHIM"
lancer --retour cccc55556666
controle "version désignée demandée à Compose" "$(grep -c 'VERSION=cccc55556666 docker compose .* up -d --wait' "$JOURNAL_SHIM")" "1"
controle "version courante = version désignée" "$(cat "$D/VERSION_COURANTE")" "cccc55556666"
echo "--- refus ---"
rm "$D/VERSION_PRECEDENTE"
if lancer --retour; then echo "[ÉCHEC   ] retour sans version précédente accepté"; ECHECS=$((ECHECS + 1)); else echo "[CONFORME] retour sans version précédente enregistrée : refusé (code $?)"; fi
echo "BAD;rm -rf /" > "$D/VERSION_PRECEDENTE"
: > "$JOURNAL_SHIM"
if lancer --retour; then echo "[ÉCHEC   ] version précédente illisible acceptée"; ECHECS=$((ECHECS + 1)); else echo "[CONFORME] version précédente illisible refusée avant toute bascule"; fi
controle "aucune bascule lancée après refus" "$(grep -c 'up -d --wait' "$JOURNAL_SHIM")" "0"
[ "$ECHECS" = "0" ] && echo "Essai du retour arrière de deployer.sh : CONFORME" || echo "Essai du retour arrière de deployer.sh : $ECHECS ÉCART(S)"
[ "$ECHECS" = "0" ]
