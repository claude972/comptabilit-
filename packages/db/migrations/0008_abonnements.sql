CREATE TABLE "echeances_abonnement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"abonnement_id" uuid NOT NULL,
	"periode_debut" date NOT NULL,
	"periode_fin" date NOT NULL,
	"offre" text NOT NULL,
	"dossiers_actifs" integer NOT NULL,
	"lignes" jsonb NOT NULL,
	"total_ht" numeric(18, 2) NOT NULL,
	"fictif" boolean NOT NULL,
	"statut_paiement" text DEFAULT 'en_attente_virement' NOT NULL,
	"reference_virement" text NOT NULL,
	"paye_le" date,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offres_abonnement" (
	"code" text PRIMARY KEY NOT NULL,
	"definition" jsonb NOT NULL,
	"fictif" boolean DEFAULT true NOT NULL,
	"proposee" boolean DEFAULT true NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "abonnements" ADD COLUMN "offre_demandee" text;--> statement-breakpoint
ALTER TABLE "abonnements" ADD COLUMN "motif_resiliation" text;--> statement-breakpoint
ALTER TABLE "echeances_abonnement" ADD CONSTRAINT "echeances_abonnement_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echeances_abonnement" ADD CONSTRAINT "echeances_abonnement_abonnement_id_abonnements_id_fk" FOREIGN KEY ("abonnement_id") REFERENCES "public"."abonnements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "echeances_periode" ON "echeances_abonnement" USING btree ("cabinet_id","periode_debut");--> statement-breakpoint
ALTER TABLE "abonnements" ADD CONSTRAINT "abonnements_offre_offres_abonnement_code_fk" FOREIGN KEY ("offre") REFERENCES "public"."offres_abonnement"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abonnements" ADD CONSTRAINT "abonnements_offre_demandee_offres_abonnement_code_fk" FOREIGN KEY ("offre_demandee") REFERENCES "public"."offres_abonnement"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "abonnements_cabinet" ON "abonnements" USING btree ("cabinet_id");