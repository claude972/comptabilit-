CREATE TABLE "saisies_tableaux" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"exercice_id" uuid NOT NULL,
	"tableau" text NOT NULL,
	"ligne" text NOT NULL,
	"valeurs" jsonb NOT NULL,
	"note" text NOT NULL,
	"version_donnees" integer NOT NULL,
	"auteur_id" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saisies_tableaux" ADD CONSTRAINT "saisies_tableaux_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saisies_tableaux" ADD CONSTRAINT "saisies_tableaux_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saisies_tableaux" ADD CONSTRAINT "saisies_tableaux_exercice_id_exercices_id_fk" FOREIGN KEY ("exercice_id") REFERENCES "public"."exercices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saisies_tableaux" ADD CONSTRAINT "saisies_tableaux_auteur_id_utilisateurs_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saisies_tableaux_unique" ON "saisies_tableaux" USING btree ("exercice_id","tableau","ligne");
--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Une ligne se remplace ou se retire par l'application ; le worker n'y touche pas.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON saisies_tableaux FROM comtaple_worker;
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_tableau CHECK (tableau IN ('2033C_III', '2054BIS_A', '2054BIS_B'));
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_ligne CHECK (ligne ~ '^(0[1-9]|10|REG|PV19|NEANT|B1|B2)$');
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_valeurs CHECK (jsonb_typeof(valeurs) = 'object');
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_note CHECK (length(btrim(note)) >= 5);
--> statement-breakpoint
-- L'historique en ajout seul accepte aussi les saisies de tableaux (montant = valeurs en JSON).
ALTER TABLE historique_qualifications DROP CONSTRAINT historique_qualifications_nature;
--> statement-breakpoint
ALTER TABLE historique_qualifications ADD CONSTRAINT historique_qualifications_nature CHECK (nature IN ('ventilation_ca', 'renvoi', 'tableau'));
