CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"email" text NOT NULL,
	"nom" text NOT NULL,
	"role" "role_cabinet" NOT NULL,
	"statut" text DEFAULT 'en_attente' NOT NULL,
	"invitee_par" uuid,
	"expire_le" timestamp with time zone NOT NULL,
	"acceptee_par" uuid,
	"acceptee_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitee_par_utilisateurs_id_fk" FOREIGN KEY ("invitee_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_acceptee_par_utilisateurs_id_fk" FOREIGN KEY ("acceptee_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_email" ON "invitations" USING btree ("email","statut");--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Réservée aux gestionnaires du cabinet, en lecture comme en écriture, dans la base elle-même.
CREATE POLICY gestionnaire_seulement ON invitations AS RESTRICTIVE FOR ALL TO comtaple_app
  USING (app_est_gestionnaire()) WITH CHECK (app_est_gestionnaire());
--> statement-breakpoint
-- Une invitation ne se supprime pas (elle s'annule) et le worker n'y touche pas.
REVOKE DELETE, TRUNCATE ON invitations FROM comtaple_app, comtaple_worker;
--> statement-breakpoint
REVOKE INSERT, UPDATE ON invitations FROM comtaple_worker;
--> statement-breakpoint
ALTER TABLE invitations ADD CONSTRAINT invitations_statut CHECK (statut IN ('en_attente', 'acceptee', 'annulee'));
--> statement-breakpoint
ALTER TABLE invitations ADD CONSTRAINT invitations_email_minuscules CHECK (email = lower(email) AND position('@' in email) > 1);
--> statement-breakpoint
-- Le rôle « support » ne s'obtient jamais par invitation (accès temporaire ouvert par l'éditeur, D-036).
ALTER TABLE invitations ADD CONSTRAINT invitations_role CHECK (role <> 'support');
--> statement-breakpoint
-- Une seule invitation en attente par adresse et par cabinet.
CREATE UNIQUE INDEX invitations_en_attente ON invitations (cabinet_id, email) WHERE statut = 'en_attente';
--> statement-breakpoint
/*
 * Acceptation des invitations en attente pour l'adresse ATTESTÉE du compte qui se connecte.
 * Appelée par l'API après vérification du jeton : le sujet vient du contexte (app.sujet), jamais d'un paramètre ;
 * l'adresse est celle du jeton, que l'API ne transmet que si le fournisseur d'identité la déclare vérifiée.
 * Effets, bornés : crée la fiche de l'utilisateur si elle n'existe pas, crée l'appartenance au rôle prévu par
 * l'invitation (sans jamais modifier une appartenance existante), marque l'invitation acceptée, journalise.
 * N'accorde AUCUNE habilitation de dossier : le rôle et l'appartenance ne suffisent pas à ouvrir un dossier.
 */
CREATE FUNCTION invitations_accepter(p_email text, p_nom text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE
  v_sujet text := nullif(current_setting('app.sujet', true), '');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_utilisateur uuid;
  v_invitation record;
  n integer := 0;
BEGIN
  IF v_sujet IS NULL OR v_email = '' THEN RETURN 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM invitations i WHERE i.email = v_email AND i.statut = 'en_attente' AND i.expire_le > now()) THEN RETURN 0; END IF;
  SELECT u.id INTO v_utilisateur FROM utilisateurs u WHERE u.sujet_oidc = v_sujet;
  FOR v_invitation IN
    SELECT i.* FROM invitations i WHERE i.email = v_email AND i.statut = 'en_attente' AND i.expire_le > now() ORDER BY i.cree_le FOR UPDATE
  LOOP
    IF v_utilisateur IS NULL THEN
      INSERT INTO utilisateurs (sujet_oidc, email, nom)
      VALUES (v_sujet, v_email, coalesce(nullif(btrim(p_nom), ''), v_invitation.nom))
      RETURNING id INTO v_utilisateur;
    END IF;
    INSERT INTO appartenances (cabinet_id, utilisateur_id, role)
    VALUES (v_invitation.cabinet_id, v_utilisateur, v_invitation.role)
    ON CONFLICT (cabinet_id, utilisateur_id) DO NOTHING;
    UPDATE invitations SET statut = 'acceptee', acceptee_par = v_utilisateur, acceptee_le = now() WHERE id = v_invitation.id;
    INSERT INTO journal_audit (cabinet_id, acteur_id, acteur_type, action, cible_type, cible_id, details)
    VALUES (v_invitation.cabinet_id, v_utilisateur, 'utilisateur', 'invitation.acceptee', 'invitation', v_invitation.id::text,
            jsonb_build_object('role', v_invitation.role));
    n := n + 1;
  END LOOP;
  RETURN n;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION invitations_accepter(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION invitations_accepter(text, text) TO comtaple_app;
