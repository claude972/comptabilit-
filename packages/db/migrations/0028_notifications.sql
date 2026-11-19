CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"destinataire_id" uuid NOT NULL,
	"type" text NOT NULL,
	"entite_id_cible" uuid,
	"cible_type" text,
	"cible_id" text,
	"donnees" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"lue_le" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_destinataire_id_utilisateurs_id_fk" FOREIGN KEY ("destinataire_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_entite_id_cible_entites_id_fk" FOREIGN KEY ("entite_id_cible") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_destinataire" ON "notifications" USING btree ("destinataire_id","lue_le","cree_le");--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Chacun ne lit et ne marque « lue » que SES notifications, dans la base elle-même.
CREATE POLICY ses_notifications ON notifications AS RESTRICTIVE FOR SELECT TO comtaple_app USING (destinataire_id = app_utilisateur_id());
--> statement-breakpoint
CREATE POLICY marquer_ses_notifications ON notifications AS RESTRICTIVE FOR UPDATE TO comtaple_app
  USING (destinataire_id = app_utilisateur_id()) WITH CHECK (destinataire_id = app_utilisateur_id());
--> statement-breakpoint
-- L'application n'écrit pas la table : elle passe par notifier(), qui choisit le cabinet et contrôle les destinataires.
-- Elle ne peut modifier que la date de lecture. Rien ne se supprime par les rôles applicatifs.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON notifications FROM comtaple_app, comtaple_worker;
--> statement-breakpoint
GRANT UPDATE (lue_le) ON notifications TO comtaple_app;
--> statement-breakpoint
CREATE FUNCTION notifier(p_destinataires uuid[], p_type text, p_entite uuid, p_cible_type text, p_cible_id text, p_donnees jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE
  n integer;
BEGIN
  IF app_cabinet_id() IS NULL THEN RAISE EXCEPTION 'notifier : contexte de cabinet absent'; END IF;
  IF p_type IS NULL OR p_type !~ '^[a-z_]+(\.[a-z_]+)+$' THEN RAISE EXCEPTION 'notifier : type invalide'; END IF;
  IF p_entite IS NOT NULL AND NOT EXISTS (SELECT 1 FROM entites e WHERE e.id = p_entite AND e.cabinet_id = app_cabinet_id()) THEN
    RAISE EXCEPTION 'notifier : dossier étranger au cabinet';
  END IF;
  IF pg_column_size(coalesce(p_donnees, '{}'::jsonb)) > 2000 THEN RAISE EXCEPTION 'notifier : données trop volumineuses'; END IF;
  -- Seuls les membres ACTIFS du cabinet du contexte sont notifiés ; l'auteur de l'action ne se notifie pas lui-même.
  INSERT INTO notifications (cabinet_id, destinataire_id, type, entite_id_cible, cible_type, cible_id, donnees)
  SELECT DISTINCT app_cabinet_id(), a.utilisateur_id, p_type, p_entite, p_cible_type, p_cible_id, coalesce(p_donnees, '{}'::jsonb)
    FROM appartenances a
   WHERE a.cabinet_id = app_cabinet_id() AND a.utilisateur_id = ANY (p_destinataires) AND a.actif
     AND (a.expire_le IS NULL OR a.expire_le > now())
     AND a.utilisateur_id IS DISTINCT FROM app_utilisateur_id();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
CREATE FUNCTION notifier_gestionnaires(p_type text, p_entite uuid, p_cible_type text, p_cible_id text, p_donnees jsonb) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$
  SELECT notifier(
    coalesce((SELECT array_agg(a.utilisateur_id) FROM appartenances a WHERE a.cabinet_id = app_cabinet_id() AND a.actif AND a.role IN ('administrateur', 'associe')), '{}'::uuid[]),
    p_type, p_entite, p_cible_type, p_cible_id, p_donnees)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notifier(uuid[], text, uuid, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notifier_gestionnaires(text, uuid, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notifier(uuid[], text, uuid, text, text, jsonb) TO comtaple_app, comtaple_worker;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notifier_gestionnaires(text, uuid, text, text, jsonb) TO comtaple_app, comtaple_worker;
