CREATE TABLE "restitutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"statut" "statut_lot" DEFAULT 'en_attente' NOT NULL,
	"cle_archive" text,
	"sha256" text,
	"taille" bigint,
	"resume" jsonb,
	"erreur" text,
	"demande_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"termine_le" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "restitutions" ADD CONSTRAINT "restitutions_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restitutions" ADD CONSTRAINT "restitutions_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restitutions" ADD CONSTRAINT "restitutions_demande_par_utilisateurs_id_fk" FOREIGN KEY ("demande_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
SELECT securite_appliquer_rls();
