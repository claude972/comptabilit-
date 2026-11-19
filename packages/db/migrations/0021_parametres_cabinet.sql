CREATE TABLE "parametres_cabinet" (
	"cabinet_id" uuid PRIMARY KEY NOT NULL,
	"cout_horaire_interne_ht" numeric(18, 2),
	"maj_par" uuid,
	"maj_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parametres_cabinet" ADD CONSTRAINT "parametres_cabinet_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parametres_cabinet" ADD CONSTRAINT "parametres_cabinet_maj_par_utilisateurs_id_fk" FOREIGN KEY ("maj_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Le coût horaire interne est une donnée de gestion du cabinet : lecture et écriture réservées à ses gestionnaires.
CREATE POLICY gestionnaires_parametres ON parametres_cabinet AS RESTRICTIVE FOR ALL TO comtaple_app USING (app_est_gestionnaire()) WITH CHECK (app_est_gestionnaire());
