CREATE TABLE "confirmations_annexe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"exercice_id" uuid NOT NULL,
	"rubrique" text NOT NULL,
	"etat" text NOT NULL,
	"note" text,
	"version_donnees" integer NOT NULL,
	"confirmee_par" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ecritures_inventaire" ADD COLUMN "origine_detail" jsonb;--> statement-breakpoint
ALTER TABLE "exercices" ADD COLUMN "categorie_annexe" text;--> statement-breakpoint
ALTER TABLE "confirmations_annexe" ADD CONSTRAINT "confirmations_annexe_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmations_annexe" ADD CONSTRAINT "confirmations_annexe_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmations_annexe" ADD CONSTRAINT "confirmations_annexe_exercice_id_exercices_id_fk" FOREIGN KEY ("exercice_id") REFERENCES "public"."exercices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmations_annexe" ADD CONSTRAINT "confirmations_annexe_confirmee_par_utilisateurs_id_fk" FOREIGN KEY ("confirmee_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "confirmations_annexe_unique" ON "confirmations_annexe" USING btree ("exercice_id","rubrique");--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Une confirmation se retire (suppression par l'application) mais le worker n'y touche pas.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON confirmations_annexe FROM comtaple_worker;
--> statement-breakpoint
ALTER TABLE confirmations_annexe ADD CONSTRAINT confirmations_annexe_etat CHECK (etat IN ('complete', 'non_applicable'));
--> statement-breakpoint
ALTER TABLE exercices ADD CONSTRAINT exercices_categorie_annexe CHECK (categorie_annexe IS NULL OR categorie_annexe IN ('micro_entreprise', 'petite_entreprise', 'personne_morale_regime_simplifie', 'moyenne_ou_grande_entreprise'));
--> statement-breakpoint
ALTER TABLE ecritures_inventaire ADD CONSTRAINT ecritures_inventaire_origine CHECK (origine IN ('saisie_humaine', 'proposition_moteur'));
