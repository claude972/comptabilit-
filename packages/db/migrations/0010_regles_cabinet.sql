ALTER TABLE "regles_cabinet" ADD COLUMN "motif" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "regles_cabinet" ADD COLUMN "impact" jsonb;--> statement-breakpoint
ALTER TABLE "regles_cabinet" ADD COLUMN "proposee_par" uuid;--> statement-breakpoint
ALTER TABLE "regles_cabinet" ADD COLUMN "decidee_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "regles_cabinet" ADD CONSTRAINT "regles_cabinet_proposee_par_utilisateurs_id_fk" FOREIGN KEY ("proposee_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;