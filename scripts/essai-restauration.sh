#!/bin/sh
# Essai de restauration après incident, ENTIÈREMENT ISOLÉ des services de l'application.
#
# La dernière sauvegarde (base + stockage objet, scripts/sauvegarder.sh) est restaurée dans des instances créées pour
# l'essai et détruites ensuite : un PostgreSQL séparé et un stockage objet séparé (autres conteneurs, autres volumes,
# autres identifiants, ressources plafonnées). Rien n'est créé, écrit ni supprimé dans la base ou le stockage de
# l'application ; la base d'origine n'est que LUE, pour comparer.
#
# Vérifications :
#  1) empreintes de la sauvegarde et du manifeste des objets ;
#  2) volumes de lignes restaurés ;
#  3) journal d'audit — (a) fidélité : résultat de la vérification stricte identique à l'origine, cabinet par cabinet ;
#     (b) intégrité : vérification STRICTE, seule référence (D-038). Un diagnostic consigné n'y change rien ;
#  4) RLS activé et forcé sur toutes les tables portant cabinet_id ;
#  5) tous les objets référencés par la base restaurée sont présents dans le stockage restauré, conformes à l'empreinte
#     enregistrée en base ;
#  6) aucun service de l'application n'a redémarré pendant l'essai ;
#  7) si la sauvegarde est un JEU : son descripteur est conforme, et les comptes de la base restaurée sont confrontés à
#     l'export Keycloak du même jeu.
#
# Codes de sortie : 0 réussi ; 3 données restaurées fidèlement mais journal d'audit non intègre ; 4 un service de
# l'application a redémarré pendant l'essai ; 5 essai refusé avant de commencer (pré-contrôle) ; autre : échec.
set -eu
cd "$(dirname "$0")/.."
. "$HOME/.comtaple-outils/env.sh"
set -a; . ./.env; set +a
SAUVEGARDE="${1:-$(ls -t var/sauvegardes/*.dump | head -1)}"
MANIFESTE="${SAUVEGARDE%.dump}.objets.json"
IMAGE_PG="pgvector/pgvector:0.8.7-pg18-trixie"
IMAGE_S3="chrislusf/seaweedfs:4.54"
PSQL_ORIGINE="docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $PG_ADMIN_USER -At"
# Même nom de rôle d'administration que l'origine (la sauvegarde y fait référence), avec un mot de passe propre à l'essai.
PSQL="docker exec -i comtaple-essai-pg psql -v ON_ERROR_STOP=1 -U $PG_ADMIN_USER -At -d comtaple"

nettoyer() {
  docker rm -f comtaple-essai-pg comtaple-essai-s3 >/dev/null 2>&1 || true
  docker volume rm comtaple_essai_pg comtaple_essai_s3 >/dev/null 2>&1 || true
  rm -f var/sauvegardes/.s3-essai.json var/sauvegardes/.references
}
temoins() {
  # Instants de démarrage des services de l'application : s'ils changent, un service a redémarré.
  for c in postgres redis s3 keycloak; do printf '%s=%s ' "$c" "$(docker inspect -f '{{.State.StartedAt}}' "comtaple-$c-1" 2>/dev/null || echo absent)"; done
  printf 'pg=%s' "$($PSQL_ORIGINE -d postgres -c 'select pg_postmaster_start_time()' 2>/dev/null || echo injoignable)"
}

# ── Pré-contrôles : on ne commence pas un essai qui mettrait les services locaux en difficulté ──
[ -f "$MANIFESTE" ] || { echo "REFUS : aucune sauvegarde du stockage objet pour cette sauvegarde de base ($MANIFESTE). Relancer scripts/sauvegarder.sh."; exit 5; }
shasum -a 256 -c "$SAUVEGARDE.sha256" >/dev/null && echo "Empreinte de la sauvegarde : conforme"
shasum -a 256 -c "$MANIFESTE.sha256" >/dev/null && echo "Empreinte du manifeste des objets : conforme"
for c in postgres s3; do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "comtaple-$c-1" 2>/dev/null)" = "healthy" ] || { echo "REFUS : le service « $c » de l'application n'est pas en bonne santé ; l'essai n'est pas lancé."; exit 5; }
done
OCTETS_OBJETS=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).octets)' "$MANIFESTE")
OCTETS_BASE=$(wc -c < "$SAUVEGARDE" | tr -d ' ')
# Besoin estimé sur le disque de la machine Docker : objets rechargés + base restaurée (environ 10 fois la sauvegarde
# compressée) + 2 Go de marge laissés aux services de l'application.
# Le stockage est rechargé par TRANCHES de ESSAI_TRANCHE_MO au plus (2 000 Mo par défaut), l'instance d'essai étant recréée
# entre deux tranches : l'espace nécessaire ne dépend plus de la taille totale du stockage sauvegardé.
TRANCHE_MO="${ESSAI_TRANCHE_MO:-2000}"
NB_TRANCHES=$(node scripts/objets.mjs tranches "$MANIFESTE" "$TRANCHE_MO")
OCTETS_TRANCHE=$(( OCTETS_OBJETS / NB_TRANCHES + 256 * 1024 * 1024 ))
BESOIN_KO=$(( (OCTETS_TRANCHE + OCTETS_BASE * 10) / 1024 + 2 * 1024 * 1024 ))
LIBRE_KO=$(docker compose exec -T postgres df -Pk /var/lib/postgresql | awk 'NR==2 {print $4}')
if [ "$LIBRE_KO" -lt "$BESOIN_KO" ]; then
  echo "REFUS : espace libre insuffisant sur la machine Docker ($((LIBRE_KO / 1024)) Mo libres, $((BESOIN_KO / 1024)) Mo nécessaires marge comprise). L'essai n'est pas lancé."
  exit 5
fi
echo "Pré-contrôles : services en bonne santé ; $((LIBRE_KO / 1024)) Mo libres pour $((BESOIN_KO / 1024)) Mo nécessaires (marge comprise)"
nettoyer
trap nettoyer EXIT INT TERM
AVANT="$(temoins)"

# ── Base : PostgreSQL d'essai séparé, sans port publié, ressources plafonnées ──
docker create --name comtaple-essai-pg --init --cpus 1.5 --memory 1g -e POSTGRES_USER="$PG_ADMIN_USER" -e POSTGRES_PASSWORD="$(openssl rand -hex 24)" -e POSTGRES_DB=comtaple \
  -v comtaple_essai_pg:/var/lib/postgresql "$IMAGE_PG" >/dev/null
docker start comtaple-essai-pg >/dev/null
i=0; until docker exec comtaple-essai-pg pg_isready -U "$PG_ADMIN_USER" -d comtaple >/dev/null 2>&1 && docker exec comtaple-essai-pg psql -U "$PG_ADMIN_USER" -d comtaple -Atc 'select 1' >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 90 ] && { echo "ÉCHEC : le PostgreSQL d'essai ne démarre pas"; exit 1; }; sleep 1
done
# Les rôles techniques doivent exister pour que les droits de la sauvegarde se restaurent ; ils ne peuvent pas se connecter.
$PSQL -c "CREATE ROLE comtaple_app NOLOGIN" -c "CREATE ROLE comtaple_worker NOLOGIN" -c "CREATE EXTENSION IF NOT EXISTS vector" >/dev/null
DEBUT=$(date +%s)
docker exec -i comtaple-essai-pg pg_restore -U "$PG_ADMIN_USER" -d comtaple --no-owner --exit-on-error < "$SAUVEGARDE"
echo "Restauration de la base dans une instance séparée : $(( $(date +%s) - DEBUT )) s pour $(du -h "$SAUVEGARDE" | cut -f1 | tr -d ' ')"

echo "--- volumes restaurés ---"
$PSQL -c "select 'documents', count(*) from documents union all select 'fichiers', count(*) from fichiers union all select 'lignes_ecriture', count(*) from lignes_ecriture union all select 'constats', count(*) from constats union all select 'decisions', count(*) from decisions union all select 'journal_audit', count(*) from journal_audit order by 1"

# Comparaison limitée aux cabinets présents dans la sauvegarde (d'autres ont pu être créés depuis).
CABINETS=$($PSQL -c "select string_agg(quote_literal(id::text), ',') from cabinets")
VERIF="select coalesce(string_agg(c.id::text || ':' || coalesce(journal_audit_verifier(c.id)::text, 'ok'), ',' order by c.id), '') from cabinets c where c.id::text in ($CABINETS)"
[ "$($PSQL -c "$VERIF")" = "$($PSQL_ORIGINE -d comtaple -c "$VERIF")" ] && echo "Journal d'audit : état restauré identique à l'origine (vérification stricte, cabinet par cabinet)" || { echo "ÉCHEC : le journal restauré diffère de l'origine"; exit 1; }
RUPTURES=$($PSQL -c "select count(*) from cabinets c where journal_audit_verifier(c.id) is not null")
JOURNAL_DEGRADE=0
if [ "$RUPTURES" = "0" ]; then echo "Journal d'audit : chaîne intègre pour tous les cabinets"; else
  JOURNAL_DEGRADE=1
  echo "INTÉGRITÉ DU JOURNAL : ÉCHEC — chaîne non intègre pour $RUPTURES cabinet(s) (vérification stricte)"
  $PSQL -c "select '  cabinet ' || c.nom || ' : première ligne incohérente n° ' || journal_audit_verifier(c.id) || coalesce(' ; diagnostic consigné : lignes ' || (select string_agg(a.premiere_ligne || '-' || a.derniere_ligne, ', ') from anomalies_journal a where a.cabinet_id = c.id), ' ; aucun diagnostic consigné') || ' ; rupture non expliquée : ' || coalesce(journal_audit_verifier_hors_anomalies(c.id)::text, 'aucune') from cabinets c where journal_audit_verifier(c.id) is not null"
fi
SANS_RLS=$($PSQL -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'cabinet_id' and not a.attisdropped) and not (c.relrowsecurity and c.relforcerowsecurity)")
[ "$SANS_RLS" = "0" ] && echo "RLS : activé et forcé sur toutes les tables concernées" || { echo "ÉCHEC : $SANS_RLS table(s) sans RLS forcé après restauration"; exit 1; }
echo "Politiques RLS restaurées : $($PSQL -c "select count(*) from pg_policies where schemaname = 'public'")"

# ── Jeu de sauvegarde : descripteur vérifié, et comptes de la base restaurée confrontés à l'export Keycloak du jeu ──
JEU="${SAUVEGARDE%.dump}.jeu.json"
if [ -f "$JEU" ]; then
  node -e 'import(process.argv[1]).then(async (m) => { const v = await m.verifierJeu(process.argv[2]); console.log(v.conforme ? "Jeu de sauvegarde : descripteur conforme (base, objets, export Keycloak)" : "ÉCHEC : jeu non conforme — " + v.ecarts.join(" ; ")); process.exit(v.conforme ? 0 : 1); })' "$PWD/packages/plateforme/dist/jeu-sauvegarde.js" "$JEU"
  $PSQL -c "select sujet_oidc from utilisateurs order by 1" > var/sauvegardes/.references
  node -e 'const fs = require("fs"); const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const k = JSON.parse(fs.readFileSync(process.argv[1].replace(/jeu\.json$/, "keycloak.json"), "utf8")); const ids = new Set((k.users || []).map((u) => u.id)); const base = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean); const dans = base.filter((s) => ids.has(s)).length; console.log(`Comptes de la base RESTAURÉE présents dans l\u0027export Keycloak du jeu : ${dans} sur ${base.length} (à la capture : ${j.coherence.comptesBaseDansKeycloak} sur ${j.coherence.comptesBase})`); if (dans !== j.coherence.comptesBaseDansKeycloak || base.length !== j.coherence.comptesBase) { console.log("ÉCHEC : la base restaurée ne correspond pas à l\u0027état décrit par le jeu"); process.exit(1); }' "$JEU" var/sauvegardes/.references
else
  echo "Sauvegarde sans descripteur de jeu (ancien format) : cohérence base / Keycloak non vérifiable"
fi

# ── Stockage objet : instance d'essai séparée, ressources plafonnées ──
echo "--- stockage objet : restauration dans une instance isolée, en $NB_TRANCHES tranche(s) ---"
export ESSAI_S3_ENDPOINT="http://127.0.0.1:${ESSAI_S3_PORT:-8334}" ESSAI_S3_BUCKET="comtaple-essai-restauration"
$PSQL -F ' ' -c "select cle_stockage, sha256 from fichiers
  union all select cle_pdf, coalesce(sha256_pdf, '-') from exports_revision where cle_pdf is not null
  union all select cle_donnees, coalesce(sha256_donnees, '-') from exports_revision where cle_donnees is not null
  union all select cle_archive, coalesce(sha256, '-') from restitutions where cle_archive is not null
  union all select cle_archive, coalesce(sha256, '-') from restitutions_cabinet where cle_archive is not null" > var/sauvegardes/.references
OBJETS_OK=1
DEBUT=$(date +%s)
t=1
while [ "$t" -le "$NB_TRANCHES" ]; do
  # Instance d'essai NEUVE pour chaque tranche (conteneur, volume et identifiants propres), détruite ensuite.
  docker rm -f comtaple-essai-s3 >/dev/null 2>&1 || true; docker volume rm comtaple_essai_s3 >/dev/null 2>&1 || true
  export ESSAI_S3_ACCESS_KEY="essai$(openssl rand -hex 8)" ESSAI_S3_SECRET_KEY="$(openssl rand -hex 24)"
  printf '{"identities":[{"name":"essai","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin","Read","Write","List"]}]}' "$ESSAI_S3_ACCESS_KEY" "$ESSAI_S3_SECRET_KEY" > var/sauvegardes/.s3-essai.json
  docker create --name comtaple-essai-s3 --init --cpus 1 --memory 1g -p "127.0.0.1:${ESSAI_S3_PORT:-8334}:8333" -v comtaple_essai_s3:/data "$IMAGE_S3" \
    server -dir=/data -ip.bind=0.0.0.0 -volume.max=60 -master.volumeSizeLimitMB=256 -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json >/dev/null
  docker cp var/sauvegardes/.s3-essai.json comtaple-essai-s3:/etc/seaweedfs/s3.json
  docker start comtaple-essai-s3 >/dev/null
  i=0; until curl -s -o /dev/null -m 2 "$ESSAI_S3_ENDPOINT"; do i=$((i + 1)); [ "$i" -gt 60 ] && { echo "ÉCHEC : le stockage d'essai ne démarre pas"; exit 1; }; sleep 1; done; sleep 3
  # Sans identifiants, l'instance d'essai doit refuser la lecture (elle n'est pas ouverte, même sur la boucle locale).
  [ "$t" = "1" ] && echo "Accès anonyme à l'instance d'essai : HTTP $(curl -s -o /dev/null -w '%{http_code}' -m 5 "$ESSAI_S3_ENDPOINT/$ESSAI_S3_BUCKET/")"
  TRANCHE="$t/$NB_TRANCHES" node scripts/objets.mjs restaurer "$MANIFESTE"
  TRANCHE="$t/$NB_TRANCHES" node scripts/objets.mjs verifier var/sauvegardes/.references "$MANIFESTE" || OBJETS_OK=0
  t=$((t + 1))
done
echo "Rechargement et vérification du stockage : $(( $(date +%s) - DEBUT )) s pour $NB_TRANCHES tranche(s)"

APRES="$(temoins)"
trap - EXIT INT TERM
nettoyer
echo "Instances d'essai détruites (PostgreSQL et stockage objet : conteneurs et volumes)."
if [ "$AVANT" != "$APRES" ]; then
  echo "ATTENTION : un service de l'application a redémarré pendant l'essai."
  echo "  avant : $AVANT"
  echo "  après : $APRES"
  exit 4
fi
echo "Services de l'application : aucun redémarrage pendant l'essai"
[ "$OBJETS_OK" = "1" ] || { echo "Essai de restauration : ÉCHEC — des objets référencés par la base manquent ou diffèrent dans le stockage restauré"; exit 1; }
if [ "$JOURNAL_DEGRADE" = "1" ]; then
  echo "Essai de restauration : DONNÉES RESTAURÉES FIDÈLEMENT, mais CONTRÔLE D'INTÉGRITÉ DU JOURNAL EN ÉCHEC (voir ci-dessus)"
  exit 3
fi
echo "Essai de restauration : RÉUSSI"
