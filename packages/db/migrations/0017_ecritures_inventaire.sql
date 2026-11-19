CREATE TABLE "ecritures_inventaire" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"exercice_id" uuid NOT NULL,
	"date_ecriture" date NOT NULL,
	"libelle" text NOT NULL,
	"origine" text DEFAULT 'saisie_humaine' NOT NULL,
	"justification" text NOT NULL,
	"calcul" text NOT NULL,
	"pieces" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lignes" jsonb NOT NULL,
	"total_debit" numeric(18, 2) NOT NULL,
	"statut" text DEFAULT 'proposee' NOT NULL,
	"version_donnees" integer NOT NULL,
	"proposee_par" uuid NOT NULL,
	"decidee_par" uuid,
	"decidee_le" timestamp with time zone,
	"motif_decision" text,
	"exportee_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ecritures_inventaire" ADD CONSTRAINT "ecritures_inventaire_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecritures_inventaire" ADD CONSTRAINT "ecritures_inventaire_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecritures_inventaire" ADD CONSTRAINT "ecritures_inventaire_exercice_id_exercices_id_fk" FOREIGN KEY ("exercice_id") REFERENCES "public"."exercices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecritures_inventaire" ADD CONSTRAINT "ecritures_inventaire_proposee_par_utilisateurs_id_fk" FOREIGN KEY ("proposee_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecritures_inventaire" ADD CONSTRAINT "ecritures_inventaire_decidee_par_utilisateurs_id_fk" FOREIGN KEY ("decidee_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
SELECT securite_appliquer_rls();
