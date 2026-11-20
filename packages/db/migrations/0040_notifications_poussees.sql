CREATE TABLE "abonnements_pousses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"utilisateur_id" uuid NOT NULL,
	"empreinte_point_acces" text NOT NULL,
	"service" text NOT NULL,
	"secrets_chiffres" text NOT NULL,
	"agent" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"dernier_succes_le" timestamp with time zone,
	"dernier_echec_le" timestamp with time zone,
	"echecs" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "envois_pousses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"destinataire_id" uuid NOT NULL,
	"type" text NOT NULL,
	"nombre" integer DEFAULT 1 NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"traite_le" timestamp with time zone,
	"issue" text,
	"appareils" integer
);
--> statement-breakpoint
ALTER TABLE "abonnements_pousses" ADD CONSTRAINT "abonnements_pousses_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abonnements_pousses" ADD CONSTRAINT "abonnements_pousses_utilisateur_id_utilisateurs_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envois_pousses" ADD CONSTRAINT "envois_pousses_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envois_pousses" ADD CONSTRAINT "envois_pousses_destinataire_id_utilisateurs_id_fk" FOREIGN KEY ("destinataire_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "abonnements_pousses_appareil" ON "abonnements_pousses" USING btree ("cabinet_id","utilisateur_id","empreinte_point_acces");--> statement-breakpoint
CREATE INDEX "abonnements_pousses_empreinte" ON "abonnements_pousses" USING btree ("empreinte_point_acces");--> statement-breakpoint
CREATE UNIQUE INDEX "envois_pousses_en_attente" ON "envois_pousses" USING btree ("cabinet_id","destinataire_id") WHERE traite_le is null;--> statement-breakpoint
CREATE INDEX "envois_pousses_releve" ON "envois_pousses" USING btree ("traite_le","cree_le");--> statement-breakpoint
-- ─── Complété à la main : isolation, « chacun les siens », droits minimaux, mise en file, relevé par le worker ───
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Abonnements : chacun ne lit et ne retire que LES SIENS, dans la base elle-même.
CREATE POLICY ses_abonnements ON abonnements_pousses AS RESTRICTIVE FOR ALL TO comtaple_app
  USING (utilisateur_id = app_utilisateur_id()) WITH CHECK (utilisateur_id = app_utilisateur_id());
--> statement-breakpoint
ALTER TABLE abonnements_pousses ADD CONSTRAINT abonnements_pousses_formes CHECK (
  empreinte_point_acces ~ '^[0-9a-f]{64}$' AND service IN ('fcm', 'mozilla', 'apple', 'wns', 'simulateur')
  AND secrets_chiffres ~ '^a1\.[A-Za-z0-9-]{1,64}(\.[A-Za-z0-9_-]+){3}$' AND length(secrets_chiffres) <= 8000 AND length(agent) BETWEEN 1 AND 80);
--> statement-breakpoint
-- L'application n'écrit pas la table : elle passe par abonnement_pousse_enregistrer(). Elle lit et supprime (les siens).
REVOKE INSERT, UPDATE, TRUNCATE ON abonnements_pousses FROM comtaple_app;
--> statement-breakpoint
-- Le worker émet : il lit les abonnements du cabinet de la tâche, note l'issue (trois colonnes) et retire un abonnement
-- que le service de notification déclare périmé. Il ne crée rien et ne modifie ni le point d'accès ni les clés.
REVOKE INSERT, UPDATE, TRUNCATE ON abonnements_pousses FROM comtaple_worker;
--> statement-breakpoint
GRANT UPDATE (dernier_succes_le, dernier_echec_le, echecs) ON abonnements_pousses TO comtaple_worker;
--> statement-breakpoint
-- File des envois : écrite par le seul déclencheur ci-dessous ; l'application n'y a aucun accès ; le worker la lit et
-- n'en modifie que l'issue.
REVOKE ALL ON envois_pousses FROM comtaple_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON envois_pousses FROM comtaple_worker;
--> statement-breakpoint
GRANT UPDATE (traite_le, issue, appareils) ON envois_pousses TO comtaple_worker;
--> statement-breakpoint
ALTER TABLE envois_pousses ADD CONSTRAINT envois_pousses_formes CHECK (
  type ~ '^[a-z_]+(\.[a-z_]+)*$' AND nombre >= 1
  AND (issue IS NULL OR issue IN ('distribue', 'sans_abonnement', 'preference_desactivee', 'perime'))
  AND ((traite_le IS NULL) = (issue IS NULL)));
--> statement-breakpoint
-- Préférence GLOBALE « notifications poussées » : même table que les préférences par famille, sous la clé « poussees »
-- (qui n'est le préfixe d'aucun type de notification : notifier() ne la confond avec aucune famille). Absence de ligne =
-- active ; s'abonner sur un appareil reste de toute façon un geste explicite.
ALTER TABLE preferences_notification DROP CONSTRAINT preferences_notification_famille;
--> statement-breakpoint
ALTER TABLE preferences_notification ADD CONSTRAINT preferences_notification_famille CHECK (famille IN ('regle', 'document', 'restitution', 'restitution_cabinet', 'import', 'constat', 'poussees'));
--> statement-breakpoint
-- Enregistrement d'un abonnement pour la personne et le cabinet DU CONTEXTE. Un appareil (même point d'accès) n'est
-- abonné que pour UN compte à la fois : s'il l'était pour une autre personne (changement de compte sur le même
-- navigateur), cet ancien abonnement est retiré — sinon l'appareil afficherait des notifications destinées à un compte
-- qui n'y est plus connecté. Dix appareils au plus par personne et par cabinet.
CREATE FUNCTION abonnement_pousse_enregistrer(p_empreinte text, p_service text, p_secrets text, p_agent text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE
  v_id uuid;
BEGIN
  IF app_cabinet_id() IS NULL OR app_utilisateur_id() IS NULL THEN RAISE EXCEPTION 'abonnement_pousse : contexte absent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM appartenances a WHERE a.cabinet_id = app_cabinet_id() AND a.utilisateur_id = app_utilisateur_id() AND a.actif AND (a.expire_le IS NULL OR a.expire_le > now())) THEN
    RAISE EXCEPTION 'abonnement_pousse : membre inactif';
  END IF;
  DELETE FROM abonnements_pousses WHERE empreinte_point_acces = p_empreinte AND utilisateur_id <> app_utilisateur_id();
  IF (SELECT count(*) FROM abonnements_pousses WHERE cabinet_id = app_cabinet_id() AND utilisateur_id = app_utilisateur_id() AND empreinte_point_acces <> p_empreinte) >= 10 THEN
    RAISE EXCEPTION 'abonnement_pousse : trop d''appareils' USING ERRCODE = 'P0001', HINT = 'trop_d_appareils';
  END IF;
  INSERT INTO abonnements_pousses (cabinet_id, utilisateur_id, empreinte_point_acces, service, secrets_chiffres, agent)
  VALUES (app_cabinet_id(), app_utilisateur_id(), p_empreinte, p_service, p_secrets, p_agent)
  ON CONFLICT (cabinet_id, utilisateur_id, empreinte_point_acces)
  DO UPDATE SET service = EXCLUDED.service, secrets_chiffres = EXCLUDED.secrets_chiffres, agent = EXCLUDED.agent, echecs = 0, dernier_echec_le = NULL
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION abonnement_pousse_enregistrer(text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION abonnement_pousse_enregistrer(text, text, text, text) TO comtaple_app;
--> statement-breakpoint
-- Mise en file : à la création d'une notification interne, si son destinataire a au moins un appareil abonné dans ce
-- cabinet et n'a pas coupé les notifications poussées, UNE ligne d'envoi est créée — ou la ligne encore en attente de ce
-- destinataire est complétée (regroupement : jamais plus d'un envoi en attente par destinataire). La préférence par
-- famille est déjà appliquée en amont : notifier() ne crée pas la notification interne d'une famille désactivée.
-- Seul le TYPE de la notification est recopié (« mixte » si les types diffèrent) : ni dossier, ni cible, ni données.
-- Une mise en file impossible ne fait jamais échouer la création de la notification interne (avertissement seulement).
CREATE FUNCTION notifications_mettre_en_file_poussee() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM abonnements_pousses a WHERE a.cabinet_id = NEW.cabinet_id AND a.utilisateur_id = NEW.destinataire_id)
       AND NOT EXISTS (SELECT 1 FROM preferences_notification p WHERE p.cabinet_id = NEW.cabinet_id AND p.utilisateur_id = NEW.destinataire_id AND p.famille = 'poussees' AND NOT p.active) THEN
      INSERT INTO envois_pousses (cabinet_id, destinataire_id, type) VALUES (NEW.cabinet_id, NEW.destinataire_id, NEW.type)
      ON CONFLICT (cabinet_id, destinataire_id) WHERE traite_le IS NULL
      DO UPDATE SET nombre = envois_pousses.nombre + 1, type = CASE WHEN envois_pousses.type = EXCLUDED.type THEN envois_pousses.type ELSE 'mixte' END;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notification poussée non mise en file : %', SQLERRM;
  END;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notifications_mettre_en_file_poussee() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER notifications_file_poussee AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION notifications_mettre_en_file_poussee();
--> statement-breakpoint
-- Relevé par le worker (qui ne peut pas énumérer les cabinets) : identifiants seulement, pour les envois en attente
-- depuis au moins la fenêtre de regroupement. Même principe que worker_documents_en_retard (0002).
CREATE FUNCTION worker_envois_pousses_a_distribuer(p_fenetre_s integer DEFAULT 60, p_limite integer DEFAULT 200)
RETURNS TABLE (cabinet_id uuid, envoi_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT e.cabinet_id, e.id
  FROM envois_pousses e
  WHERE e.traite_le IS NULL AND e.cree_le <= now() - make_interval(secs => greatest(p_fenetre_s, 0))
  ORDER BY e.cree_le
  LIMIT least(p_limite, 1000)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION worker_envois_pousses_a_distribuer(integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION worker_envois_pousses_a_distribuer(integer, integer) TO comtaple_worker;
--> statement-breakpoint
-- Purge de la file : les envois TRAITÉS depuis plus de p_jours (7 au moins) sont supprimés. Ils ne portent aucune donnée
-- de dossier ; ne restent que le temps de diagnostiquer un envoi récent.
CREATE FUNCTION worker_envois_pousses_purger(p_jours integer DEFAULT 7) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE
  n integer;
BEGIN
  DELETE FROM envois_pousses WHERE traite_le IS NOT NULL AND traite_le < now() - make_interval(days => greatest(p_jours, 7));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION worker_envois_pousses_purger(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION worker_envois_pousses_purger(integer) TO comtaple_worker;
