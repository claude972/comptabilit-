#!/bin/sh
# ESSAI DE L'ANCRAGE DU JOURNAL D'AUDIT sur une BASE JETABLE (P4, D-102) : export hors base, ancres chaînées, vérification sans base, et
# DÉTECTION d'altérations. La base de la pile n'est ni lue ni écrite : tout se passe dans `comtaple_essai_ancre_<n>`, détruite à la fin ;
# les ancres et l'export sont écrits dans un dossier temporaire détruit à la fin.
#
# CE QUE CELA PROUVE : l'outil détecte une ligne modifiée, une fin de journal tronquée par rapport à une ancre, et une ancre manquante
# ou altérée. CE QUE CELA NE PROUVE PAS : un ancrage EXTERNE. Aucune destination indépendante n'existe ; tant que les empreintes d'ancre
# ne sont pas déposées chez un tiers que l'administrateur de la base ne contrôle pas, un administrateur pourrait réécrire le journal ET
# les ancres locales (voir la liste de contrôle de docs/exploitation.md, « Ancrage du journal »).
# Code : 0 conforme ; 1 écart.
set -eu
cd "$(dirname "$0")/.."
. "$HOME/.comtaple-outils/env.sh"
set -a; . ./.env; set +a
BASE="comtaple_essai_ancre_$(date +%s)"
CAB=aaaaaaaa-0000-4000-8000-000000000001
ADMIN="docker exec -i comtaple-postgres-1 psql -v ON_ERROR_STOP=1 -U $PG_ADMIN_USER -At"
T="$(mktemp -d)"
nettoyer() { $ADMIN -d postgres -c "drop database if exists $BASE with (force)" >/dev/null 2>&1 || true; rm -rf "$T"; }
trap nettoyer EXIT INT TERM
ECHECS=0
controle() { libelle="$1"; attendu="$2"; shift 2; "$@" > "$T/sortie.txt" 2>&1 && code=0 || code=$?; if [ "$code" = "$attendu" ]; then echo "[CONFORME] $libelle"; else echo "[ÉCHEC   ] $libelle (code $code, attendu $attendu)"; tail -4 "$T/sortie.txt"; ECHECS=$((ECHECS + 1)); fi; }
export PG_DATABASE="$BASE"
ecrire() { node -e '
import("./packages/db/dist/index.js").then(async (d) => {
  const app = d.creerAccesBd(d.urlBd("app"));
  const ctx = { cabinetId: process.argv[1], utilisateurId: "11111111-1111-4111-8111-111111111101", sujet: "11111111-1111-4111-8111-111111111101" };
  for (let i = 0; i < Number(process.argv[2]); i++) await app.avecContexte(ctx, (tx) => d.journaliser(tx, { cabinetId: process.argv[1], acteurId: ctx.utilisateurId, action: "essai.ancrage", details: { i, lot: process.argv[3] } }));
  await app.fermer();
});' "$CAB" "$1" "$2"; }

echo "--- base jetable $BASE ---"
$ADMIN -d postgres -c "create database $BASE" >/dev/null
node -e 'import("./packages/db/dist/migrer.js").then(async (m) => { await m.migrer(process.env); const a = await import("./packages/db/dist/amorcer.js"); await a.amorcer(process.env); })'
ecrire 40 a
echo "--- ancre 1, export, vérification hors base ---"
node scripts/journal-ancre.mjs ancrer "$CAB" "$T/ancres" | sed -n 1,3p
node scripts/journal-ancre.mjs exporter "$CAB" "$T/export1.jsonl"
controle "export 1 conforme à l'ancre 1 (sans base ni réseau)" 0 node scripts/journal-ancre.mjs verifier "$T/export1.jsonl" "$T/ancres/$CAB"
ecrire 15 b
node scripts/journal-ancre.mjs ancrer "$CAB" "$T/ancres" | sed -n 1p
node scripts/journal-ancre.mjs exporter "$CAB" "$T/export2.jsonl"
controle "export 2 conforme aux ancres 1 et 2 (chaînées)" 0 node scripts/journal-ancre.mjs verifier "$T/export2.jsonl" "$T/ancres/$CAB"
echo "--- altérations (chacune doit être DÉTECTÉE) ---"
node -e 'const fs=require("fs");const l=fs.readFileSync(process.argv[1],"utf8").trim().split("\n");const o=JSON.parse(l[10]);o.action="falsifie";l[10]=JSON.stringify(o);fs.writeFileSync(process.argv[2],l.join("\n")+"\n")' "$T/export2.jsonl" "$T/modifie.jsonl"
controle "une ligne modifiée est détectée" 1 node scripts/journal-ancre.mjs verifier "$T/modifie.jsonl" "$T/ancres/$CAB"
head -n 50 "$T/export2.jsonl" > "$T/tronque.jsonl"
controle "une fin de journal tronquée (réécrite plus courte) est détectée par l'ancre 2" 1 node scripts/journal-ancre.mjs verifier "$T/tronque.jsonl" "$T/ancres/$CAB"
mkdir -p "$T/ancres-sans-1/$CAB"; cp "$T/ancres/$CAB/ancre-000002.json" "$T/ancres-sans-1/$CAB/"
controle "ancre intermédiaire manquante : chaîne d'ancres rompue, détectée" 1 node scripts/journal-ancre.mjs verifier "$T/export2.jsonl" "$T/ancres-sans-1/$CAB"
mkdir -p "$T/ancres-alt/$CAB"; cp "$T/ancres/$CAB/"*.json "$T/ancres-alt/$CAB/"
sed -i.bak 's/"nombreLignes": *[0-9]*/"nombreLignes": 3/' "$T/ancres-alt/$CAB/ancre-000002.json"; rm -f "$T/ancres-alt/$CAB/"*.bak
controle "ancre altérée détectée" 1 node scripts/journal-ancre.mjs verifier "$T/export2.jsonl" "$T/ancres-alt/$CAB"
echo "--- le dépôt externe reste à faire ---"
echo "Empreintes d'ancre à déposer chez un tiers indépendant : $(node scripts/journal-ancre.mjs ancrer "$CAB" "$T/ancres-demo" | grep -c "Empreinte de l'ancre") (aucune destination configurée ; rien n'est envoyé)"
nettoyer
trap - EXIT INT TERM
[ "$ECHECS" = "0" ] && echo "Essai d'ancrage : CONFORME (ancrage LOCAL ; ancrage externe non raccordé)" || echo "Essai d'ancrage : $ECHECS ÉCART(S)"
[ "$ECHECS" = "0" ]
