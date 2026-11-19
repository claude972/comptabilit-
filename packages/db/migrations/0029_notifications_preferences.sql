CREATE TABLE "preferences_notification" (
	"cabinet_id" uuid NOT NULL,
	"utilisateur_id" uuid NOT NULL,
	"famille" text NOT NULL,
	"active" boolean NOT NULL,
	"maj_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preferences_notification_cabinet_id_utilisateur_id_famille_pk" PRIMARY KEY("cabinet_id","utilisateur_id","famille")
);
--> statement-breakpoint
ALTER TABLE "preferences_notification" ADD CONSTRAINT "preferences_notification_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferences_notification" ADD CONSTRAINT "preferences_notification_utilisateur_id_utilisateurs_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Chacun ne lit et ne règle que SES préférences.
CREATE POLICY ses_preferences ON preferences_notification AS RESTRICTIVE FOR ALL TO comtaple_app
  USING (utilisateur_id = app_utilisateur_id()) WITH CHECK (utilisateur_id = app_utilisateur_id());
--> statement-breakpoint
ALTER TABLE preferences_notification ADD CONSTRAINT preferences_notification_famille CHECK (famille IN ('regle', 'document', 'restitution', 'restitution_cabinet', 'import', 'constat'));
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON preferences_notification FROM comtaple_app, comtaple_worker;
--> statement-breakpoint
-- notifier() tient désormais compte des préférences : une famille désactivée par le destinataire n'est pas notifiée.
CREATE OR REPLACE FUNCTION notifier(p_destinataires uuid[], p_type text, p_entite uuid, p_cible_type text, p_cible_id text, p_donnees jsonb) RETURNS integer
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
  INSERT INTO notifications (cabinet_id, destinataire_id, type, entite_id_cible, cible_type, cible_id, donnees)
  SELECT DISTINCT app_cabinet_id(), a.utilisateur_id, p_type, p_entite, p_cible_type, p_cible_id, coalesce(p_donnees, '{}'::jsonb)
    FROM appartenances a
   WHERE a.cabinet_id = app_cabinet_id() AND a.utilisateur_id = ANY (p_destinataires) AND a.actif
     AND (a.expire_le IS NULL OR a.expire_le > now())
     AND a.utilisateur_id IS DISTINCT FROM app_utilisateur_id()
     AND NOT EXISTS (SELECT 1 FROM preferences_notification p
                      WHERE p.cabinet_id = a.cabinet_id AND p.utilisateur_id = a.utilisateur_id
                        AND p.famille = split_part(p_type, '.', 1) AND NOT p.active);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
-- Import terminé ou en échec : la personne qui l'a lancé est prévenue, quel que soit l'endroit du code qui clôt l'import.
-- Seule la fin d'un traitement (« en cours » → terminé / échec) notifie : ni une annulation, ni un rétablissement.
-- Les imports d'une campagne ne notifient pas un par un (la campagne a son propre suivi).
-- Une notification ne doit jamais faire échouer un import : toute erreur est rétrogradée en avertissement.
CREATE FUNCTION lots_import_notifier() RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
  IF OLD.statut = 'en_cours' AND NEW.statut IN ('termine', 'termine_avec_erreurs', 'echec')
     AND NEW.lance_par IS NOT NULL AND NEW.campagne_id IS NULL AND app_cabinet_id() IS NOT NULL THEN
    BEGIN
      PERFORM notifier(ARRAY[NEW.lance_par], CASE WHEN NEW.statut = 'echec' THEN 'import.echec' ELSE 'import.termine' END,
                       NEW.entite_id, 'lot_import', NEW.id::text, jsonb_build_object('type', NEW.type, 'version', NEW.version, 'statut', NEW.statut));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notification d''import non émise : %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER lots_import_fin AFTER UPDATE OF statut ON lots_import FOR EACH ROW EXECUTE FUNCTION lots_import_notifier();
