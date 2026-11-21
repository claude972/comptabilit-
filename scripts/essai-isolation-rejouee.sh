#!/bin/sh
# REJEU DE LA PREUVE D'ISOLATION et ESSAI DE LA REVUE RLS sur une BASE JETABLE (P4, D-102). Ce n'est PAS un audit indépendant.
#
#  1) crée une base neuve `comtaple_essai_rls_<n>` sur le serveur de la pile (migrations rejouées depuis zéro, jeu d'essai amorcé) ;
#  2) revue RLS sur cette base : tous les invariants tiennent ET aucun écart avec docs/rls-reference.json (la référence versionnée
#     correspond donc à ce que produisent les migrations à partir de zéro) ;
#  3) INJECTION D'ÉCARTS dans la base jetable, chacun devant être détecté puis annulé : RLS non forcée, politique permissive qui
#     élargit l'accès, politique restrictive « vraie », table à cabinet_id sans RLS, politique modifiée, fonction retirée ;
#  4) rejeu des tests d'isolation (isolation.itest.ts : rôles, isolation entre cabinets, habilitation par dossier, journal d'audit) et
#     des tests d'équivalence des politiques (rls-ensembliste.itest.ts) CONTRE LA BASE JETABLE ;
#  5) destruction de la base jetable (même en cas d'échec). La base de la pile n'est ni écrite ni modifiée.
# Code : 0 tout conforme ; 1 écart.
set -eu
cd "$(dirname "$0")/.."
. "$HOME/.comtaple-outils/env.sh"
set -a; . ./.env; set +a
BASE="comtaple_essai_rls_$(date +%s)"
ADMIN="docker exec -i comtaple-postgres-1 psql -v ON_ERROR_STOP=1 -U $PG_ADMIN_USER -At"
nettoyer() { $ADMIN -d postgres -c "drop database if exists $BASE with (force)" >/dev/null 2>&1 || true; }
trap nettoyer EXIT INT TERM
ECHECS=0
controle() { # controle <libellé> <code attendu> <motif attendu (regex, facultatif)> -- commande...
  libelle="$1"; attendu="$2"; motif="$3"; shift 4
  sortie="$("$@" 2>&1)" && code=0 || code=$?
  if [ "$code" = "$attendu" ] && { [ -z "$motif" ] || printf '%s' "$sortie" | grep -Eq "$motif"; }; then echo "[CONFORME] $libelle"; else echo "[ÉCHEC   ] $libelle (code $code, attendu $attendu)"; printf '%s\n' "$sortie" | grep -E "MANQUANT|À RELIRE" | head -3; ECHECS=$((ECHECS + 1)); fi
}
revue() { node scripts/revue-rls.mjs --base="$BASE"; }
sql() { $ADMIN -d "$BASE" -c "$1" >/dev/null; }

echo "--- 1) base jetable $BASE (migrations rejouées, jeu d'essai) ---"
$ADMIN -d postgres -c "create database $BASE" >/dev/null
DEBUT=$(date +%s)
PG_DATABASE="$BASE" node -e 'import("./packages/db/dist/migrer.js").then(async (m) => { await m.migrer(process.env); const a = await import("./packages/db/dist/amorcer.js"); await a.amorcer(process.env); })'
echo "Création : $(( $(date +%s) - DEBUT )) s"

echo "--- 2) revue sur la base neuve ---"
controle "invariants tenus et aucun écart avec la référence versionnée" 0 "tous les invariants tiennent" -- revue

echo "--- 3) injection d'écarts (chacun annulé ensuite) ---"
sql "ALTER TABLE constats NO FORCE ROW LEVEL SECURITY"
controle "RLS non forcée détectée" 1 "constats : RLS non forcée" -- revue
sql "ALTER TABLE constats FORCE ROW LEVEL SECURITY"
sql "CREATE POLICY elargie ON constats AS PERMISSIVE FOR SELECT USING (true)"
controle "politique permissive qui élargit l'accès détectée" 1 "PERMISSIVE supplémentaire" -- revue
sql "DROP POLICY elargie ON constats"
sql "CREATE POLICY vraie ON constats AS RESTRICTIVE FOR SELECT USING (true)"
controle "politique restrictive « vraie » détectée" 1 "littéralement vraie" -- revue
sql "DROP POLICY vraie ON constats"
sql "CREATE TABLE essai_sans_rls (id int, cabinet_id uuid)"
controle "table à cabinet_id sans RLS détectée" 1 "essai_sans_rls : RLS non activée" -- revue
sql "DROP TABLE essai_sans_rls"
sql "ALTER POLICY acces_dossier ON constats USING (true)"
controle "politique modifiée signalée À RELIRE" 1 "table à cabinet_id MODIFIÉ\(E\) : constats" -- revue
# Restauration exacte de la politique modifiée : on la remet telle que la migration l'avait créée (copie de la définition d'origine).
sql "ALTER POLICY acces_dossier ON constats USING (entite_id IN (SELECT app_entites_niveau_min('lecture'::niveau_habilitation))) WITH CHECK (entite_id IN (SELECT app_entites_niveau_min('collaboration'::niveau_habilitation)))"
controle "politique remise telle quelle : plus d'écart" 0 "aucun écart avec la référence" -- revue
sql "ALTER FUNCTION worker_traitements_en_attente(integer, integer) SECURITY INVOKER"
controle "fonction retirée du périmètre « droits du propriétaire » signalée" 1 "fonction à droits du propriétaire" -- revue
sql "ALTER FUNCTION worker_traitements_en_attente(integer, integer) SECURITY DEFINER"
controle "état d'origine rétabli : aucun écart" 0 "aucun écart avec la référence" -- revue

echo "--- 4) rejeu des tests d'isolation et d'équivalence contre la base jetable ---"
DEBUT=$(date +%s)
CODE=0
( cd packages/db && PG_DATABASE="$BASE" npx vitest run --config vitest.integration.config.ts src/isolation.itest.ts src/rls-ensembliste.itest.ts ) > var/essai-isolation-rejouee.vitest.log 2>&1 || CODE=$?
grep -E "Test Files|Tests " var/essai-isolation-rejouee.vitest.log || true
echo "Durée : $(( $(date +%s) - DEBUT )) s ; journal : var/essai-isolation-rejouee.vitest.log"
[ "$CODE" = "0" ] && echo "[CONFORME] tests d'isolation et d'équivalence des politiques" || { echo "[ÉCHEC   ] tests d'isolation (code $CODE)"; ECHECS=$((ECHECS + 1)); }

echo "--- 5) destruction de la base jetable ---"
nettoyer
trap - EXIT INT TERM
echo "Base $BASE détruite."
[ "$ECHECS" = "0" ] && echo "Rejeu de la preuve d'isolation et revue RLS : CONFORME (revue automatisée, PAS un audit indépendant)" || echo "Rejeu : $ECHECS ÉCART(S)"
[ "$ECHECS" = "0" ]
