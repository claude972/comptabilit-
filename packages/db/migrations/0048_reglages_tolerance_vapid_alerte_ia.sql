CREATE TABLE "reglages_tiers_factures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"dossier_id" uuid,
	"tolerance_montant" numeric(18, 2) NOT NULL,
	"motif" text NOT NULL,
	"regle_par" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "abonnements_pousses" ADD COLUMN "empreinte_cle_vapid" text;--> statement-breakpoint
ALTER TABLE "reglages_tiers_factures" ADD CONSTRAINT "reglages_tiers_factures_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reglages_tiers_factures" ADD CONSTRAINT "reglages_tiers_factures_dossier_id_entites_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reglages_tiers_factures" ADD CONSTRAINT "reglages_tiers_factures_regle_par_utilisateurs_id_fk" FOREIGN KEY ("regle_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reglages_tiers_factures_portee" ON "reglages_tiers_factures" USING btree ("cabinet_id","dossier_id","cree_le");
--> statement-breakpoint
-- ───────────────── Complété à la main (D-096) ─────────────────
-- 1. Tolérance de montant des tiers et factures : réglage en AJOUT SEUL, par cabinet (dossier_id nul) ou par dossier.
SELECT securite_appliquer_rls();
--> statement-breakpoint
ALTER TABLE reglages_tiers_factures ADD CONSTRAINT reglages_tiers_factures_valeurs CHECK (
  tolerance_montant >= 0 AND tolerance_montant <= 1000 AND char_length(motif) BETWEEN 1 AND 2000);
--> statement-breakpoint
-- Ajout seul : ni modification ni suppression par l'application ; le worker ne peut que LIRE (la restitution du dossier et celle du
-- cabinet exportent l'historique) et n'écrit jamais. La tolérance en vigueur est la ligne la plus récente de sa portée (dossier d'abord,
-- sinon cabinet, sinon 0 : aucune tolérance sans réglage explicite).
REVOKE UPDATE, DELETE, TRUNCATE ON reglages_tiers_factures FROM comtaple_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON reglages_tiers_factures FROM comtaple_worker;
--> statement-breakpoint
-- `dossier_id` n'est pas `entite_id` : la politique générique par dossier (qui refuse un dossier nul) ne s'applique pas ici ;
-- politiques propres : lecture = réglage du cabinet ou d'un dossier lisible ; écriture = gestionnaire pour le cabinet,
-- niveau « révision » pour un dossier (l'API contrôle les mêmes niveaux).
CREATE POLICY reglage_lecture ON reglages_tiers_factures AS RESTRICTIVE FOR SELECT TO comtaple_app
  USING (dossier_id IS NULL OR dossier_id IN (SELECT app_entites_niveau_min('lecture')));
--> statement-breakpoint
CREATE POLICY reglage_ecriture ON reglages_tiers_factures AS RESTRICTIVE FOR INSERT TO comtaple_app
  WITH CHECK ((dossier_id IS NULL AND app_est_gestionnaire()) OR dossier_id IN (SELECT app_entites_niveau_min('revision')));
--> statement-breakpoint

-- 2. Notifications poussées : empreinte de la clé VAPID au moment de l'abonnement (retrait en masse après rotation).
ALTER TABLE abonnements_pousses ADD CONSTRAINT abonnements_pousses_empreinte_vapid CHECK (empreinte_cle_vapid IS NULL OR empreinte_cle_vapid ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
-- Surcharge à cinq arguments de la fonction d'enregistrement (la version à quatre arguments subsiste, inchangée : elle laisse
-- l'empreinte inconnue). Même corps que la version de la migration 0042, plus l'empreinte.
CREATE FUNCTION abonnement_pousse_enregistrer(p_empreinte text, p_service text, p_secrets text, p_agent text, p_empreinte_cle_vapid text) RETURNS uuid
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
  INSERT INTO abonnements_pousses (cabinet_id, utilisateur_id, empreinte_point_acces, service, secrets_chiffres, agent, empreinte_cle_vapid)
  VALUES (app_cabinet_id(), app_utilisateur_id(), p_empreinte, p_service, p_secrets, p_agent, p_empreinte_cle_vapid)
  ON CONFLICT (cabinet_id, utilisateur_id, empreinte_point_acces)
  DO UPDATE SET service = EXCLUDED.service, secrets_chiffres = EXCLUDED.secrets_chiffres, agent = EXCLUDED.agent, echecs = 0, dernier_echec_le = NULL, confirme_le = now(),
                empreinte_cle_vapid = EXCLUDED.empreinte_cle_vapid
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION abonnement_pousse_enregistrer(text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION abonnement_pousse_enregistrer(text, text, text, text, text) TO comtaple_app;
--> statement-breakpoint

-- 3. Alerte d'expiration de la preuve de connexion de la passerelle IA : notification interne aux gestionnaires.
-- Nouvelle famille « ia » (réglable par chacun comme les autres).
ALTER TABLE preferences_notification DROP CONSTRAINT preferences_notification_famille;
--> statement-breakpoint
ALTER TABLE preferences_notification ADD CONSTRAINT preferences_notification_famille CHECK (famille IN ('regle', 'document', 'restitution', 'restitution_cabinet', 'import', 'constat', 'poussees', 'ia'));
--> statement-breakpoint
-- Appelée par le worker, SANS aucun appel à l'IA ni dépense : la passerelle est un service commun de l'éditeur (la table des
-- vérifications ne porte pas de cabinet) ; il n'existe pas de « cabinet éditeur » dans le modèle. L'alerte va donc aux
-- gestionnaires actifs (administrateurs, associés) de CHAQUE cabinet, les seuls à voir l'écran « IA ». Une seule notification
-- par personne et par vérification (cible = identifiant de la vérification) : rejouable sans doublon. Les préférences de la
-- famille « ia » sont respectées. Le déclencheur des notifications poussées s'applique comme pour toute notification.
CREATE FUNCTION worker_notifier_expiration_preuve_ia(p_verification uuid, p_jours_restants integer, p_expire_le timestamptz, p_seuil_jours integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE
  n integer;
BEGIN
  IF p_verification IS NULL OR p_jours_restants IS NULL OR p_jours_restants < 0 OR p_jours_restants > 90 OR p_seuil_jours IS NULL OR p_seuil_jours < 1 OR p_seuil_jours > 90 THEN
    RAISE EXCEPTION 'alerte d''expiration de la preuve IA : paramètres invalides';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM verifications_connexion_ia v WHERE v.id = p_verification AND v.resultat = 'connecte') THEN
    RAISE EXCEPTION 'alerte d''expiration de la preuve IA : vérification inconnue ou non concluante';
  END IF;
  INSERT INTO notifications (cabinet_id, destinataire_id, type, cible_type, cible_id, donnees)
  SELECT a.cabinet_id, a.utilisateur_id, 'ia.preuve_expire_bientot', 'verification_ia', p_verification::text,
         jsonb_build_object('joursRestants', p_jours_restants, 'expireLe', to_char(p_expire_le AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 'seuilJours', p_seuil_jours)
    FROM appartenances a
   WHERE a.actif AND a.role IN ('administrateur', 'associe') AND (a.expire_le IS NULL OR a.expire_le > now())
     AND NOT EXISTS (SELECT 1 FROM notifications x WHERE x.cabinet_id = a.cabinet_id AND x.destinataire_id = a.utilisateur_id AND x.type = 'ia.preuve_expire_bientot' AND x.cible_id = p_verification::text)
     AND NOT EXISTS (SELECT 1 FROM preferences_notification p WHERE p.cabinet_id = a.cabinet_id AND p.utilisateur_id = a.utilisateur_id AND p.famille = 'ia' AND NOT p.active);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION worker_notifier_expiration_preuve_ia(uuid, integer, timestamptz, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION worker_notifier_expiration_preuve_ia(uuid, integer, timestamptz, integer) TO comtaple_worker;
