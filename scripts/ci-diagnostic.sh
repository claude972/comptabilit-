#!/bin/sh
# Diagnostic d'une exécution CI en échec. N'échoue jamais.
#
# Deux sorties :
#  - le journal de l'étape (détail complet, lisible seulement par un compte autorisé sur le dépôt) ;
#  - des ANNOTATIONS de l'exécution (« ::notice:: », « ::warning:: »), visibles sur la page publique de l'exécution :
#    c'est le seul retour lisible sans jeton. On n'y met que l'état et la fin des journaux des conteneurs qui ne sont
#    PAS sains, et la fin des journaux de l'API, du worker et du web. Les secrets de la CI sont éphémères
#    (scripts/generer-env.sh, détruits avec la machine) ; les valeurs du fichier .env sont malgré tout masquées.
set +e
cd "$(dirname "$0")/.."

masquer() {
  # Remplace chaque valeur de .env d'au moins 12 caractères par « *** ».
  if [ -f .env ]; then
    node -e '
      const fs = require("fs");
      const secrets = fs.readFileSync(".env", "utf8").split("\n").map((l) => /^[A-Z0-9_]+=(.{12,})$/.exec(l.trim())?.[1]).filter(Boolean);
      let t = fs.readFileSync(0, "utf8");
      for (const s of secrets) t = t.split(s).join("***");
      process.stdout.write(t);'
  else cat; fi
}
annoter() { # annoter <niveau> <titre> : lit le texte sur l'entrée, garde les 3500 derniers caractères
  niveau="$1"; titre="$2"
  masquer | tail -c 3500 | node -e '
    const t = require("fs").readFileSync(0, "utf8").replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
    console.log(`::${process.argv[1]} title=${process.argv[2].replace(/[,:]/g, " ")}::${t || "(vide)"}`);' "$niveau" "$titre"
}

echo "::group::État des conteneurs"
docker compose ps -a
echo "::endgroup::"
docker compose ps -a --format '{{.Name}}' | while read -r nom; do
  etat="$(docker inspect -f '{{.State.Status}} / santé {{if .State.Health}}{{.State.Health.Status}}{{else}}sans sonde{{end}} / code {{.State.ExitCode}} / tué pour mémoire {{.State.OOMKilled}} / redémarrages {{.RestartCount}}' "$nom")"
  echo "--- $nom : $etat"
  case "$etat" in
    running\ /\ santé\ healthy*|running\ /\ santé\ sans\ sonde*) ;;
    *)
      { echo "$etat"; echo "Dernières sondes :"; docker inspect -f '{{if .State.Health}}{{range .State.Health.Log}}[{{.ExitCode}}] {{.Output}}{{end}}{{end}}' "$nom" | tail -n 12; } | annoter notice "Conteneur $nom - état et sondes"
      docker logs --tail 60 "$nom" 2>&1 | annoter warning "Conteneur $nom - fin du journal"
      ;;
  esac
done
echo "::group::Journaux des conteneurs"
docker compose logs --tail 80 --no-color
echo "::endgroup::"
{ uname -m; nproc; df -h / | tail -n 1; free -m | head -n 2; } 2>&1 | annoter notice "Machine - architecture, cœurs, disque, mémoire"
for f in var/api.log var/worker.log var/web.log; do
  if [ -f "$f" ]; then
    echo "::group::$f"; tail -n 100 "$f"; echo "::endgroup::"
    tail -n 40 "$f" | annoter notice "Fin de $f"
  else echo "$f : absent (étape non atteinte)"; fi
done
exit 0
