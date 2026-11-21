#!/bin/sh
# Exécute une étape de la CI et, si elle échoue, publie la fin de sa sortie en annotation de l'exécution
# (seul retour lisible sans jeton sur la page publique ; voir scripts/ci-diagnostic.sh). Le code de retour est conservé.
#   sh scripts/ci-etape.sh "<titre>" <commande> [arguments…]
titre="$1"; shift
racine="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$racine/var"
sortie="$racine/var/ci-etape-$$.log"
# Pas de « pipefail » en sh : le code de la commande est relevé dans un fichier.
{ "$@" 2>&1; echo $? > "$sortie.code"; } | tee "$sortie"
code="$(cat "$sortie.code")"
if [ "$code" != "0" ]; then
  # Séquences de couleur retirées, valeurs de .env masquées, 3500 derniers caractères.
  node -e '
    const fs = require("fs");
    let t = fs.readFileSync(process.argv[1], "utf8").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
    try {
      for (const l of fs.readFileSync(process.argv[3] + "/.env", "utf8").split("\n")) {
        const s = /^[A-Z0-9_]+=(.{12,})$/.exec(l.trim())?.[1];
        if (s) t = t.split(s).join("***");
      }
    } catch {}
    t = t.slice(-3500).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
    console.log(`::error title=${process.argv[2].replace(/[,:]/g, " ")} - fin de la sortie::${t || "(vide)"}`);' "$sortie" "$titre" "$racine"
fi
rm -f "$sortie" "$sortie.code"
exit "$code"
