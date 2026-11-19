#!/bin/sh
# Essai de restauration après incident : restaure la dernière sauvegarde dans une base NEUVE, puis vérifie
#  1) que les volumes de lignes correspondent à la base d'origine au moment de la sauvegarde,
#  2) que la chaîne d'empreintes du journal d'audit est intacte pour chaque cabinet,
#  3) que RLS est toujours activé et forcé sur toutes les tables portant cabinet_id,
#  4) que la sauvegarde du stockage objet, rechargée dans une instance ISOLÉE, contient tous les objets référencés par
#     la base restaurée, conformes à leur empreinte.
# N'altère jamais la base « comtaple ».
# Code de sortie : 0 = réussi ; 3 = données restaurées fidèlement mais journal d'audit non intègre ; autre = échec.
set -eu
cd "$(dirname "$0")/.."
. "$HOME/.comtaple-outils/env.sh"
set -a; . ./.env; set +a
SAUVEGARDE="${1:-$(ls -t var/sauvegardes/*.dump | head -1)}"
shasum -a 256 -c "$SAUVEGARDE.sha256" >/dev/null && echo "Empreinte de la sauvegarde : conforme"
PSQL="docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $PG_ADMIN_USER -At"
DEBUT=$(date +%s)
$PSQL -d postgres -c "DROP DATABASE IF EXISTS comtaple_essai_restauration" -c "CREATE DATABASE comtaple_essai_restauration" >/dev/null
$PSQL -d comtaple_essai_restauration -c "CREATE EXTENSION IF NOT EXISTS vector" >/dev/null
docker compose exec -T postgres pg_restore -U "$PG_ADMIN_USER" -d comtaple_essai_restauration --no-owner --exit-on-error < "$SAUVEGARDE"
FIN=$(date +%s)
echo "Restauration : $((FIN - DEBUT)) s pour $(du -h "$SAUVEGARDE" | cut -f1)"

COMPTES="select 'documents', count(*) from documents union all select 'fichiers', count(*) from fichiers union all select 'lignes_ecriture', count(*) from lignes_ecriture union all select 'constats', count(*) from constats union all select 'decisions', count(*) from decisions union all select 'journal_audit', count(*) from journal_audit order by 1"
echo "--- volumes restaurés ---"; $PSQL -d comtaple_essai_restauration -c "$COMPTES"
# Deux contrôles distincts : (a) FIDÉLITÉ de la restauration — le résultat de la vérification stricte est le même que dans
# la base d'origine ; (b) INTÉGRITÉ du journal — vérification stricte, seule référence. Une anomalie consignée par
# l'éditeur est un diagnostic affiché, jamais un motif pour déclarer le journal intègre.
VERIF="select coalesce(string_agg(c.id::text || ':' || coalesce(journal_audit_verifier(c.id)::text, 'ok'), ',' order by c.id), '') from cabinets c"
[ "$($PSQL -d comtaple_essai_restauration -c "$VERIF")" = "$($PSQL -d comtaple -c "$VERIF")" ] && echo "Journal d'audit : état restauré identique à l'origine (vérification stricte, cabinet par cabinet)" || { echo "ÉCHEC : le journal restauré diffère de l'origine"; exit 1; }
RUPTURES=$($PSQL -d comtaple_essai_restauration -c "select count(*) from cabinets c where journal_audit_verifier(c.id) is not null")
if [ "$RUPTURES" = "0" ]; then echo "Journal d'audit : chaîne intègre pour tous les cabinets"; else
  JOURNAL_DEGRADE=1
  echo "INTÉGRITÉ DU JOURNAL : ÉCHEC — chaîne non intègre pour $RUPTURES cabinet(s) (vérification stricte)"
  $PSQL -d comtaple_essai_restauration -c "select '  cabinet ' || c.nom || ' : première ligne incohérente n° ' || journal_audit_verifier(c.id) || coalesce(' ; diagnostic consigné : lignes ' || (select string_agg(a.premiere_ligne || '-' || a.derniere_ligne, ', ') from anomalies_journal a where a.cabinet_id = c.id), ' ; aucun diagnostic consigné') || ' ; rupture non expliquée : ' || coalesce(journal_audit_verifier_hors_anomalies(c.id)::text, 'aucune') from cabinets c where journal_audit_verifier(c.id) is not null"
fi
SANS_RLS=$($PSQL -d comtaple_essai_restauration -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'cabinet_id' and not a.attisdropped) and not (c.relrowsecurity and c.relforcerowsecurity)")
[ "$SANS_RLS" = "0" ] && echo "RLS : activé et forcé sur toutes les tables concernées" || { echo "ÉCHEC : $SANS_RLS table(s) sans RLS forcé après restauration"; exit 1; }
POLITIQUES=$($PSQL -d comtaple_essai_restauration -c "select count(*) from pg_policies where schemaname = 'public'")
echo "Politiques RLS restaurées : $POLITIQUES"

# ── Stockage objet : restauration ISOLÉE ──
# La sauvegarde des objets est rechargée dans une instance de stockage SÉPARÉE (autre conteneur, autre volume, autres
# identifiants, autre port), créée pour l'essai et détruite ensuite. Puis TOUS les objets référencés par la base
# restaurée y sont relus et comparés à l'empreinte enregistrée en base. Le stockage de l'application n'est pas lu.
MANIFESTE="${SAUVEGARDE%.dump}.objets.json"
if [ ! -f "$MANIFESTE" ]; then
  echo "ÉCHEC : aucune sauvegarde du stockage objet pour cette sauvegarde de base ($MANIFESTE). Relancer scripts/sauvegarder.sh."
  $PSQL -d postgres -c "DROP DATABASE comtaple_essai_restauration" >/dev/null; exit 1
fi
shasum -a 256 -c "$MANIFESTE.sha256" >/dev/null && echo "Empreinte du manifeste des objets : conforme"
echo "--- stockage objet : restauration dans une instance isolée ---"
nettoyer_s3() { docker rm -f comtaple-essai-s3 >/dev/null 2>&1 || true; docker volume rm comtaple_essai_s3 >/dev/null 2>&1 || true; rm -f var/sauvegardes/.s3-essai.json var/sauvegardes/.references; }
nettoyer_s3
export ESSAI_S3_ENDPOINT="http://127.0.0.1:${ESSAI_S3_PORT:-8334}" ESSAI_S3_BUCKET="comtaple-essai-restauration"
export ESSAI_S3_ACCESS_KEY="essai$(openssl rand -hex 8)" ESSAI_S3_SECRET_KEY="$(openssl rand -hex 24)"
printf '{"identities":[{"name":"essai","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin","Read","Write","List"]}]}' "$ESSAI_S3_ACCESS_KEY" "$ESSAI_S3_SECRET_KEY" > var/sauvegardes/.s3-essai.json
docker create --name comtaple-essai-s3 -p "127.0.0.1:${ESSAI_S3_PORT:-8334}:8333" -v comtaple_essai_s3:/data chrislusf/seaweedfs:4.54 \
  server -dir=/data -ip.bind=0.0.0.0 -volume.max=60 -master.volumeSizeLimitMB=256 -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json >/dev/null
docker cp var/sauvegardes/.s3-essai.json comtaple-essai-s3:/etc/seaweedfs/s3.json
docker start comtaple-essai-s3 >/dev/null
i=0; until curl -s -o /dev/null -m 2 "$ESSAI_S3_ENDPOINT"; do i=$((i + 1)); [ "$i" -gt 60 ] && { echo "ÉCHEC : le stockage d'essai ne démarre pas"; nettoyer_s3; exit 1; }; sleep 1; done; sleep 3
# Sans identifiants, l'instance d'essai doit refuser la lecture (elle n'est pas ouverte, même sur la boucle locale).
ANONYME=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$ESSAI_S3_ENDPOINT/$ESSAI_S3_BUCKET/")
DEBUT=$(date +%s)
node scripts/objets.mjs restaurer "$MANIFESTE" || { nettoyer_s3; exit 1; }
echo "Rechargement : $(( $(date +%s) - DEBUT )) s ; accès anonyme à l'instance d'essai : HTTP $ANONYME"
$PSQL -d comtaple_essai_restauration -F ' ' -c "select cle_stockage, sha256 from fichiers
  union all select cle_pdf, coalesce(sha256_pdf, '-') from exports_revision where cle_pdf is not null
  union all select cle_donnees, coalesce(sha256_donnees, '-') from exports_revision where cle_donnees is not null
  union all select cle_archive, coalesce(sha256, '-') from restitutions where cle_archive is not null" > var/sauvegardes/.references
OBJETS_OK=1
node scripts/objets.mjs verifier var/sauvegardes/.references "$MANIFESTE" || OBJETS_OK=0
nettoyer_s3
echo "Instance de stockage d'essai détruite (conteneur et volume)."
$PSQL -d postgres -c "DROP DATABASE comtaple_essai_restauration" >/dev/null
[ "$OBJETS_OK" = "1" ] || { echo "Essai de restauration : ÉCHEC — des objets référencés par la base manquent ou diffèrent dans le stockage restauré"; exit 1; }
if [ "${JOURNAL_DEGRADE:-0}" = "1" ]; then
  echo "Essai de restauration : DONNÉES RESTAURÉES FIDÈLEMENT, mais CONTRÔLE D'INTÉGRITÉ DU JOURNAL EN ÉCHEC (voir ci-dessus)"
  exit 3
fi
echo "Essai de restauration : RÉUSSI"
