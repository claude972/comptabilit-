-- Sécurité : isolation par cabinet et par dossier (RLS), privilèges des rôles techniques, journal d'audit en ajout seul.
--
-- Rôles (créés par src/migrer.ts avant les migrations, mots de passe hors dépôt) :
--   * le propriétaire des tables exécute les migrations ; FORCE ROW LEVEL SECURITY le soumet lui aussi aux politiques ;
--   * comtaple_app    : serveur interactif, NOBYPASSRLS, non propriétaire ; soumis au cabinet ET au dossier ;
--   * comtaple_worker : traitements différés, NOBYPASSRLS ; soumis au cabinet (le cabinet vient de l'enregistrement traité).
-- Le contexte (cabinet, utilisateur) est posé par transaction via set_config(..., true) à partir de l'identité
-- authentifiée ; il n'est jamais fourni par un modèle d'IA ni par le contenu d'une pièce.

CREATE FUNCTION app_cabinet_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.cabinet_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_utilisateur_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.utilisateur_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_sujet() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.sujet', true), '') $$;
--> statement-breakpoint

-- Niveau d'habilitation de l'utilisateur courant sur un dossier (NULL = aucun accès).
CREATE FUNCTION app_niveau_entite(p_entite uuid) RETURNS niveau_habilitation LANGUAGE sql STABLE AS
$$
  SELECT h.niveau
  FROM habilitations_dossier h
  JOIN appartenances a ON a.cabinet_id = h.cabinet_id AND a.utilisateur_id = h.utilisateur_id
  WHERE h.entite_id = p_entite
    AND h.cabinet_id = app_cabinet_id()
    AND h.utilisateur_id = app_utilisateur_id()
    AND a.actif
    AND (a.expire_le IS NULL OR a.expire_le > now())
$$;
--> statement-breakpoint

-- Administrateur ou associé actif du cabinet courant : peut gérer la liste des dossiers et les habilitations,
-- mais n'accède au contenu d'un dossier que s'il y est lui-même habilité.
CREATE FUNCTION app_est_gestionnaire() RETURNS boolean LANGUAGE sql STABLE AS
$$
  SELECT EXISTS (
    SELECT 1 FROM appartenances a
    WHERE a.cabinet_id = app_cabinet_id()
      AND a.utilisateur_id = app_utilisateur_id()
      AND a.actif
      AND (a.expire_le IS NULL OR a.expire_le > now())
      AND a.role IN ('administrateur', 'associe')
  )
$$;
--> statement-breakpoint

DO $$
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
END $$;
--> statement-breakpoint

-- Liste des dossiers : visible si habilité, ou si gestionnaire du cabinet (pour attribuer les habilitations).
CREATE POLICY acces_dossier ON entites AS RESTRICTIVE FOR SELECT TO comtaple_app
  USING (app_niveau_entite(id) IS NOT NULL OR app_est_gestionnaire());
--> statement-breakpoint
CREATE POLICY gestion_dossier_insert ON entites AS RESTRICTIVE FOR INSERT TO comtaple_app WITH CHECK (app_est_gestionnaire());
--> statement-breakpoint
CREATE POLICY gestion_dossier_update ON entites AS RESTRICTIVE FOR UPDATE TO comtaple_app
  USING (app_est_gestionnaire()) WITH CHECK (app_est_gestionnaire());
--> statement-breakpoint
CREATE POLICY gestion_dossier_delete ON entites AS RESTRICTIVE FOR DELETE TO comtaple_app USING (false);
--> statement-breakpoint

-- Habilitations : chacun voit les siennes, le gestionnaire toutes ; écriture réservée au gestionnaire.
CREATE POLICY lecture_habilitations ON habilitations_dossier AS RESTRICTIVE FOR SELECT TO comtaple_app
  USING (utilisateur_id = app_utilisateur_id() OR app_est_gestionnaire());
--> statement-breakpoint
CREATE POLICY ecriture_habilitations_i ON habilitations_dossier AS RESTRICTIVE FOR INSERT TO comtaple_app WITH CHECK (app_est_gestionnaire());
--> statement-breakpoint
CREATE POLICY ecriture_habilitations_u ON habilitations_dossier AS RESTRICTIVE FOR UPDATE TO comtaple_app
  USING (app_est_gestionnaire()) WITH CHECK (app_est_gestionnaire());
--> statement-breakpoint
CREATE POLICY ecriture_habilitations_d ON habilitations_dossier AS RESTRICTIVE FOR DELETE TO comtaple_app USING (app_est_gestionnaire());
--> statement-breakpoint

ALTER TABLE cabinets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cabinets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE appartenances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE appartenances FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE utilisateurs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE utilisateurs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Appartenances : les siennes (quel que soit le cabinet), ou celles du cabinet courant.
CREATE POLICY lecture_appartenances ON appartenances FOR SELECT
  USING (utilisateur_id = app_utilisateur_id() OR cabinet_id = app_cabinet_id());
--> statement-breakpoint
CREATE POLICY ecriture_appartenances_i ON appartenances FOR INSERT WITH CHECK (cabinet_id = app_cabinet_id() AND app_est_gestionnaire());
--> statement-breakpoint
CREATE POLICY ecriture_appartenances_u ON appartenances FOR UPDATE
  USING (cabinet_id = app_cabinet_id() AND app_est_gestionnaire())
  WITH CHECK (cabinet_id = app_cabinet_id() AND app_est_gestionnaire());
--> statement-breakpoint

-- Cabinets : celui du contexte, ou ceux dont l'utilisateur authentifié est membre (choix du cabinet à la connexion).
CREATE POLICY lecture_cabinets ON cabinets FOR SELECT USING (
  id = app_cabinet_id()
  OR EXISTS (SELECT 1 FROM appartenances a WHERE a.cabinet_id = cabinets.id AND a.utilisateur_id = app_utilisateur_id() AND a.actif)
);
--> statement-breakpoint

-- Utilisateurs : soi-même (par le sujet du jeton), ou les membres du cabinet courant.
CREATE POLICY lecture_utilisateurs ON utilisateurs FOR SELECT USING (
  sujet_oidc = app_sujet()
  OR EXISTS (SELECT 1 FROM appartenances a WHERE a.utilisateur_id = utilisateurs.id AND a.cabinet_id = app_cabinet_id())
);
--> statement-breakpoint
CREATE POLICY creation_utilisateur ON utilisateurs FOR INSERT WITH CHECK (sujet_oidc = app_sujet() OR app_est_gestionnaire());
--> statement-breakpoint
CREATE POLICY maj_utilisateur ON utilisateurs FOR UPDATE USING (sujet_oidc = app_sujet()) WITH CHECK (sujet_oidc = app_sujet());
--> statement-breakpoint

-- ───────────── Journal d'audit : ajout seul, chaîné par empreinte SHA-256 par cabinet ─────────────

CREATE FUNCTION journal_audit_empreinte(precedente text, l journal_audit) RETURNS text LANGUAGE sql IMMUTABLE AS
$$
  SELECT encode(sha256(convert_to(
      coalesce(precedente, '') || '|' || l.cabinet_id::text || '|' || coalesce(l.acteur_id::text, '') || '|' ||
      l.acteur_type || '|' || l.action || '|' || coalesce(l.cible_type, '') || '|' || coalesce(l.cible_id, '') || '|' ||
      coalesce(l.entite_id_cible::text, '') || '|' || l.details::text || '|' ||
      to_char(l.horodatage AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'UTF8')), 'hex')
$$;
--> statement-breakpoint
CREATE FUNCTION journal_audit_chainer() RETURNS trigger LANGUAGE plpgsql AS
$$
DECLARE
  precedente text;
BEGIN
  -- Sérialise les insertions d'un même cabinet pour garantir une chaîne linéaire.
  PERFORM pg_advisory_xact_lock(hashtextextended('journal_audit:' || NEW.cabinet_id::text, 0));
  SELECT j.empreinte INTO precedente FROM journal_audit j
   WHERE j.cabinet_id = NEW.cabinet_id ORDER BY j.id DESC LIMIT 1;
  NEW.horodatage := clock_timestamp();
  NEW.empreinte_precedente := precedente;
  NEW.empreinte := journal_audit_empreinte(precedente, NEW);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER journal_audit_avant_insertion BEFORE INSERT ON journal_audit
  FOR EACH ROW EXECUTE FUNCTION journal_audit_chainer();
--> statement-breakpoint
CREATE FUNCTION journal_audit_immuable() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'journal_audit est en ajout seul (% interdit)', TG_OP; END $$;
--> statement-breakpoint
CREATE TRIGGER journal_audit_pas_de_modification BEFORE UPDATE OR DELETE ON journal_audit
  FOR EACH ROW EXECUTE FUNCTION journal_audit_immuable();
--> statement-breakpoint
CREATE TRIGGER journal_audit_pas_de_troncature BEFORE TRUNCATE ON journal_audit
  FOR EACH STATEMENT EXECUTE FUNCTION journal_audit_immuable();
--> statement-breakpoint

-- Vérification d'intégrité de la chaîne du cabinet courant : identifiant de la première ligne incohérente, ou NULL.
CREATE FUNCTION journal_audit_verifier(p_cabinet uuid) RETURNS bigint LANGUAGE plpgsql STABLE AS
$$
DECLARE
  l journal_audit;
  precedente text := NULL;
BEGIN
  FOR l IN SELECT * FROM journal_audit WHERE cabinet_id = p_cabinet ORDER BY id LOOP
    IF l.empreinte IS DISTINCT FROM journal_audit_empreinte(precedente, l)
       OR l.empreinte_precedente IS DISTINCT FROM precedente THEN
      RETURN l.id;
    END IF;
    precedente := l.empreinte;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint

-- ───────────── Privilèges ─────────────

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO comtaple_app, comtaple_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO comtaple_app, comtaple_worker;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO comtaple_app, comtaple_worker;
--> statement-breakpoint
-- Journal d'audit : ajout et lecture seulement.
REVOKE UPDATE, DELETE, TRUNCATE ON journal_audit FROM comtaple_app, comtaple_worker;
--> statement-breakpoint
-- Référentiel réglementaire partagé : lecture seule pour les rôles applicatifs (aucune nouveauté ne modifie seule les règles).
REVOKE INSERT, UPDATE, DELETE ON sources_reglementaires FROM comtaple_app, comtaple_worker;
--> statement-breakpoint
-- Les cabinets sont créés par le provisionnement (rôle propriétaire), pas par l'application.
REVOKE INSERT, UPDATE, DELETE ON cabinets FROM comtaple_app, comtaple_worker;
