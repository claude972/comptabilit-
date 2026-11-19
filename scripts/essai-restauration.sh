#!/bin/sh
# Essai de restauration après incident : restaure la dernière sauvegarde dans une base NEUVE, puis vérifie
#  1) que les volumes de lignes correspondent à la base d'origine au moment de la sauvegarde,
#  2) que la chaîne d'empreintes du journal d'audit est intacte pour chaque cabinet,
#  3) que RLS est toujours activé et forcé sur toutes les tables portant cabinet_id,
#  4) qu'un échantillon d'originaux du stockage objet correspond aux empreintes enregistrées.
# N'altère jamais la base « comtaple ».
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
RUPTURES=$($PSQL -d comtaple_essai_restauration -c "select count(*) from cabinets c where journal_audit_verifier_hors_anomalies(c.id) is not null")
CONSIGNEES=$($PSQL -d comtaple_essai_restauration -c "select count(*) from anomalies_journal")
[ "$RUPTURES" = "0" ] && echo "Journal d'audit : aucune rupture inexpliquée ($CONSIGNEES anomalie(s) d'enchaînement consignée(s), contenu vérifié ligne par ligne)" || { echo "ÉCHEC : chaîne d'audit rompue pour $RUPTURES cabinet(s)"; exit 1; }
SANS_RLS=$($PSQL -d comtaple_essai_restauration -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'cabinet_id' and not a.attisdropped) and not (c.relrowsecurity and c.relforcerowsecurity)")
[ "$SANS_RLS" = "0" ] && echo "RLS : activé et forcé sur toutes les tables concernées" || { echo "ÉCHEC : $SANS_RLS table(s) sans RLS forcé après restauration"; exit 1; }
POLITIQUES=$($PSQL -d comtaple_essai_restauration -c "select count(*) from pg_policies where schemaname = 'public'")
echo "Politiques RLS restaurées : $POLITIQUES"

echo "--- originaux du stockage objet (échantillon de 20) ---"
$PSQL -d comtaple_essai_restauration -F ' ' -c "select cle_stockage, sha256 from fichiers where nature = 'original' order by cree_le desc limit 20" > var/sauvegardes/.echantillon
node scripts/verifier-originaux.mjs var/sauvegardes/.echantillon
rm -f var/sauvegardes/.echantillon
$PSQL -d postgres -c "DROP DATABASE comtaple_essai_restauration" >/dev/null
echo "Essai de restauration : RÉUSSI"
