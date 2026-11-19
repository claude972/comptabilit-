CREATE TABLE "immobilisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"libelle" text NOT NULL,
	"compte_immobilisation" text NOT NULL,
	"base_amortissable" numeric(18, 2) NOT NULL,
	"date_mise_en_service" date NOT NULL,
	"duree_mois" integer NOT NULL,
	"amortissements_anterieurs" numeric(18, 2),
	"saisie_par" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "immobilisations" ADD CONSTRAINT "immobilisations_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "immobilisations" ADD CONSTRAINT "immobilisations_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "immobilisations" ADD CONSTRAINT "immobilisations_saisie_par_utilisateurs_id_fk" FOREIGN KEY ("saisie_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "immobilisations_dossier" ON "immobilisations" USING btree ("entite_id");--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON immobilisations FROM comtaple_worker;
--> statement-breakpoint
ALTER TABLE immobilisations ADD CONSTRAINT immobilisations_valeurs CHECK (base_amortissable > 0 AND duree_mois BETWEEN 1 AND 1200 AND compte_immobilisation ~ '^2[0-9]{2,11}$' AND (amortissements_anterieurs IS NULL OR amortissements_anterieurs >= 0));
