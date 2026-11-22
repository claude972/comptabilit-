CREATE TABLE "qualifications_resultat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"exercice_id" uuid NOT NULL,
	"nature" text NOT NULL,
	"cle" text NOT NULL,
	"montant" text NOT NULL,
	"montant_export" text,
	"note" text NOT NULL,
	"version_donnees" integer NOT NULL,
	"qualifiee_par" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qualifications_resultat" ADD CONSTRAINT "qualifications_resultat_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications_resultat" ADD CONSTRAINT "qualifications_resultat_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications_resultat" ADD CONSTRAINT "qualifications_resultat_exercice_id_exercices_id_fk" FOREIGN KEY ("exercice_id") REFERENCES "public"."exercices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications_resultat" ADD CONSTRAINT "qualifications_resultat_qualifiee_par_utilisateurs_id_fk" FOREIGN KEY ("qualifiee_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qualifications_resultat_unique" ON "qualifications_resultat" USING btree ("exercice_id","nature","cle");
--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Une qualification se remplace ou se retire par l'application ; le worker n'y touche pas.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON qualifications_resultat FROM comtaple_worker;
--> statement-breakpoint
ALTER TABLE qualifications_resultat ADD CONSTRAINT qualifications_resultat_nature CHECK (nature IN ('ventilation_ca', 'renvoi'));
--> statement-breakpoint
ALTER TABLE qualifications_resultat ADD CONSTRAINT qualifications_resultat_montants CHECK (montant ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$' AND (montant_export IS NULL OR montant_export ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$') AND ((nature = 'ventilation_ca') = (montant_export IS NOT NULL)));
--> statement-breakpoint
ALTER TABLE qualifications_resultat ADD CONSTRAINT qualifications_resultat_note CHECK (length(btrim(note)) >= 5);
