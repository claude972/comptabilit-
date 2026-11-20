-- D-095 : politiques de dossier ENSEMBLISTES (évaluées une fois par requête) au lieu de LIGNE À LIGNE. CHANGEMENT DE SÉCURITÉ.
--
-- Constat (D-094, EXPLAIN ANALYZE) : la politique restrictive `acces_dossier` appelait app_niveau_entite(entite_id) pour CHAQUE
-- ligne lue (fonction SQL non inlinable, environ 6 µs par ligne : 3,0 s pour compter 501 713 lignes d'écritures).
--
-- Nouvelle forme : `entite_id IN (SELECT app_entites_niveau_min('<niveau>'))`. La sous-requête n'est pas corrélée : PostgreSQL
-- la calcule UNE fois par requête (« hashed SubPlan ») puis sonde une table de hachage. SÉMANTIQUE D'ACCÈS IDENTIQUE :
--   * app_entites_niveau_min(m) renvoie les dossiers pour lesquels app_niveau_entite(dossier) >= m, avec exactement le même
--     corps de requête (habilitation du cabinet ET de l'utilisateur du contexte, appartenance active et non expirée) ;
--     l'unicité (dossier, utilisateur) de habilitations_dossier garantit au plus une ligne par dossier, comme avant ;
--   * ni SECURITY DEFINER ni changement de rôle : la fonction s'exécute, comme app_niveau_entite, sous l'identité de
--     l'appelant et reste soumise aux politiques de habilitations_dossier et de appartenances ;
--   * entite_id NULL ou dossier sans habilitation : refusé, comme avant (NULL >= 'lecture' et NULL IS NOT NULL ne passent pas) ;
--   * « depot » est le niveau le plus bas de l'énumération : `IS NOT NULL` (tables de collecte) == niveau minimal « depot ».
-- Non touchés : la politique de `entites` (clé `id`, OU gestionnaire), la politique isolation_cabinet, les politiques propres à
-- un utilisateur, les données, le journal d'audit.
--
-- POLITIQUE PRÉCÉDENTE (pour mémoire), sur chaque table portant entite_id, rôle comtaple_app, RESTRICTIVE, FOR ALL :
--   tables courantes : USING (app_niveau_entite(entite_id) >= 'lecture') WITH CHECK (app_niveau_entite(entite_id) >= 'collaboration')
--   tables de collecte (televersements, documents, receptions, pages_document, extractions, echanges_document) :
--                      USING (app_niveau_entite(entite_id) IS NOT NULL) WITH CHECK (app_niveau_entite(entite_id) IS NOT NULL)
--   echanges_assistant : USING et WITH CHECK (app_niveau_entite(entite_id) >= 'lecture')
--
-- RÉVERSIBILITÉ : `SELECT securite_restaurer_rls_ligne_a_ligne();` (définie ci-dessous) rétablit exactement la politique
-- précédente sur toutes les tables et l'ancienne securite_appliquer_rls(). Elle est testée (isolation.itest.ts).

CREATE FUNCTION app_entites_niveau_min(p_min niveau_habilitation) RETURNS SETOF uuid LANGUAGE sql STABLE AS
$$
  SELECT h.entite_id
  FROM habilitations_dossier h
  JOIN appartenances a ON a.cabinet_id = h.cabinet_id AND a.utilisateur_id = h.utilisateur_id
  WHERE h.cabinet_id = app_cabinet_id()
    AND h.utilisateur_id = app_utilisateur_id()
    AND a.actif
    AND (a.expire_le IS NULL OR a.expire_le > now())
    AND h.niveau >= p_min
$$;
--> statement-breakpoint

-- Réécrit les politiques `acces_dossier` EXISTANTES de forme connue ; toute autre forme est laissée telle quelle (NOTICE).
-- Mode 'ensembliste' (migration) ou 'ligne' (retour arrière) : seules les formes attendues de ce mode sont réécrites.
CREATE FUNCTION securite_reecrire_acces_dossier(p_mode text) RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE
  p record;
  n integer := 0;
  l_using text;
  l_check text;
BEGIN
  IF p_mode NOT IN ('ensembliste', 'ligne') THEN RAISE EXCEPTION 'mode inconnu : %', p_mode; END IF;
  FOR p IN
    SELECT c.relname AS t,
           regexp_replace(pg_get_expr(o.polqual, o.polrelid), '::niveau_habilitation', '', 'g') AS q,
           regexp_replace(pg_get_expr(o.polwithcheck, o.polrelid), '::niveau_habilitation', '', 'g') AS w
    FROM pg_policy o JOIN pg_class c ON c.oid = o.polrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND o.polname = 'acces_dossier' AND c.relname <> 'entites'
    ORDER BY c.relname
  LOOP
    IF p_mode = 'ensembliste' THEN
      l_using := CASE p.q
        WHEN '(app_niveau_entite(entite_id) >= ''lecture'')' THEN 'entite_id IN (SELECT app_entites_niveau_min(''lecture''))'
        WHEN '(app_niveau_entite(entite_id) IS NOT NULL)' THEN 'entite_id IN (SELECT app_entites_niveau_min(''depot''))' END;
      l_check := CASE p.w
        WHEN '(app_niveau_entite(entite_id) >= ''collaboration'')' THEN 'entite_id IN (SELECT app_entites_niveau_min(''collaboration''))'
        WHEN '(app_niveau_entite(entite_id) >= ''lecture'')' THEN 'entite_id IN (SELECT app_entites_niveau_min(''lecture''))'
        WHEN '(app_niveau_entite(entite_id) IS NOT NULL)' THEN 'entite_id IN (SELECT app_entites_niveau_min(''depot''))' END;
    ELSE
      l_using := CASE p.q
        WHEN '(entite_id IN ( SELECT app_entites_niveau_min(''lecture'') AS app_entites_niveau_min))' THEN 'app_niveau_entite(entite_id) >= ''lecture'''
        WHEN '(entite_id IN ( SELECT app_entites_niveau_min(''depot'') AS app_entites_niveau_min))' THEN 'app_niveau_entite(entite_id) IS NOT NULL' END;
      l_check := CASE p.w
        WHEN '(entite_id IN ( SELECT app_entites_niveau_min(''collaboration'') AS app_entites_niveau_min))' THEN 'app_niveau_entite(entite_id) >= ''collaboration'''
        WHEN '(entite_id IN ( SELECT app_entites_niveau_min(''lecture'') AS app_entites_niveau_min))' THEN 'app_niveau_entite(entite_id) >= ''lecture'''
        WHEN '(entite_id IN ( SELECT app_entites_niveau_min(''depot'') AS app_entites_niveau_min))' THEN 'app_niveau_entite(entite_id) IS NOT NULL' END;
    END IF;
    IF l_using IS NULL OR l_check IS NULL THEN
      RAISE NOTICE 'acces_dossier sur % : forme non reconnue pour le mode %, laissée telle quelle (%, %)', p.t, p_mode, p.q, p.w;
    ELSE
      EXECUTE format('ALTER POLICY acces_dossier ON %I USING (%s) WITH CHECK (%s)', p.t, l_using, l_check);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $fn$;
--> statement-breakpoint

-- Tables futures : securite_appliquer_rls() pose désormais la forme ensembliste (reste idempotente, mêmes tables, mêmes niveaux).
CREATE OR REPLACE FUNCTION securite_appliquer_rls() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  t record;
  -- Tables de collecte : accessibles dès le niveau « depot » (le filtrage « ses propres dépôts » est applicatif).
  tables_collecte text[] := ARRAY['televersements', 'documents', 'receptions', 'pages_document', 'extractions', 'echanges_document'];
  -- Tables portant entite_id mais régies par une politique spécifique plus bas.
  tables_speciales text[] := ARRAY['habilitations_dossier'];
BEGIN
  FOR t IN
    SELECT c.table_name,
           EXISTS (SELECT 1 FROM information_schema.columns e
                   WHERE e.table_schema = 'public' AND e.table_name = c.table_name AND e.column_name = 'entite_id') AS a_entite
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'cabinet_id' AND c.table_name <> 'appartenances'
      AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.table_name AND p.policyname = 'isolation_cabinet')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.table_name);

    -- Politique de base : le cabinet du contexte, pour tous les rôles.
    EXECUTE format(
      'CREATE POLICY isolation_cabinet ON %I AS PERMISSIVE FOR ALL USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id())',
      t.table_name);

    -- Politique restrictive par dossier, pour le serveur interactif uniquement (forme ensembliste, D-095).
    IF t.a_entite AND NOT (t.table_name = ANY (tables_speciales)) THEN
      IF t.table_name = ANY (tables_collecte) THEN
        EXECUTE format(
          'CREATE POLICY acces_dossier ON %I AS RESTRICTIVE FOR ALL TO comtaple_app USING (entite_id IN (SELECT app_entites_niveau_min(''depot''))) WITH CHECK (entite_id IN (SELECT app_entites_niveau_min(''depot'')))',
          t.table_name);
      ELSE
        EXECUTE format(
          'CREATE POLICY acces_dossier ON %I AS RESTRICTIVE FOR ALL TO comtaple_app USING (entite_id IN (SELECT app_entites_niveau_min(''lecture''))) WITH CHECK (entite_id IN (SELECT app_entites_niveau_min(''collaboration'')))',
          t.table_name);
      END IF;
    END IF;
  END LOOP;
END $fn$;
--> statement-breakpoint

-- RETOUR ARRIÈRE (jamais appelé par la migration) : rétablit les politiques ligne à ligne et l'ancienne securite_appliquer_rls().
CREATE FUNCTION securite_restaurer_rls_ligne_a_ligne() RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE n integer;
BEGIN
  n := securite_reecrire_acces_dossier('ligne');
  EXECUTE $def$
CREATE OR REPLACE FUNCTION securite_appliquer_rls() RETURNS void LANGUAGE plpgsql AS $inner$
DECLARE
  t record;
  -- Tables de collecte : accessibles dès le niveau « depot » (le filtrage « ses propres dépôts » est applicatif).
  tables_collecte text[] := ARRAY['televersements', 'documents', 'receptions', 'pages_document', 'extractions', 'echanges_document'];
  -- Tables portant entite_id mais régies par une politique spécifique plus bas.
  tables_speciales text[] := ARRAY['habilitations_dossier'];
BEGIN
  FOR t IN
    SELECT c.table_name,
           EXISTS (SELECT 1 FROM information_schema.columns e
                   WHERE e.table_schema = 'public' AND e.table_name = c.table_name AND e.column_name = 'entite_id') AS a_entite
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'cabinet_id' AND c.table_name <> 'appartenances'
      AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.table_name AND p.policyname = 'isolation_cabinet')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.table_name);

    -- Politique de base : le cabinet du contexte, pour tous les rôles.
    EXECUTE format(
      'CREATE POLICY isolation_cabinet ON %I AS PERMISSIVE FOR ALL USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id())',
      t.table_name);

    -- Politique restrictive par dossier, pour le serveur interactif uniquement.
    IF t.a_entite AND NOT (t.table_name = ANY (tables_speciales)) THEN
      IF t.table_name = ANY (tables_collecte) THEN
        EXECUTE format(
          'CREATE POLICY acces_dossier ON %I AS RESTRICTIVE FOR ALL TO comtaple_app USING (app_niveau_entite(entite_id) IS NOT NULL) WITH CHECK (app_niveau_entite(entite_id) IS NOT NULL)',
          t.table_name);
      ELSE
        EXECUTE format(
          'CREATE POLICY acces_dossier ON %I AS RESTRICTIVE FOR ALL TO comtaple_app USING (app_niveau_entite(entite_id) >= ''lecture'') WITH CHECK (app_niveau_entite(entite_id) >= ''collaboration'')',
          t.table_name);
      END IF;
    END IF;
  END LOOP;
END $inner$
  $def$;
  RETURN n;
END $fn$;
--> statement-breakpoint

-- Application : toutes les politiques de forme connue passent à la forme ensembliste (aucune donnée n'est touchée).
SELECT securite_reecrire_acces_dossier('ensembliste');
