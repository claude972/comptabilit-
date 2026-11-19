CREATE TABLE "executions_rapprochement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"exercice_id" uuid NOT NULL,
	"lot_import_id" uuid NOT NULL,
	"version_donnees" integer NOT NULL,
	"statut" "statut_lot" DEFAULT 'en_attente' NOT NULL,
	"obsolete" boolean DEFAULT false NOT NULL,
	"parametres" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mesures" jsonb,
	"non_rapproches_ecritures" jsonb,
	"non_rapproches_mouvements" jsonb,
	"ambiguites" jsonb,
	"abandons" jsonb,
	"erreur" text,
	"lance_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"termine_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "releves_bancaires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"lot_import_id" uuid NOT NULL,
	"format" text NOT NULL,
	"iban" text,
	"identifiant" text,
	"devise" text,
	"solde_ouverture" numeric(18, 2),
	"date_ouverture" date,
	"solde_cloture" numeric(18, 2),
	"date_cloture" date,
	"total_mouvements" numeric(18, 2) NOT NULL,
	"nb_mouvements" integer NOT NULL,
	"cadrage" text NOT NULL,
	"ecart" numeric(18, 2),
	"brut" jsonb NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rapprochements" ALTER COLUMN "ecart" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mouvements_bancaires" ADD COLUMN "releve_id" uuid;--> statement-breakpoint
ALTER TABLE "mouvements_bancaires" ADD COLUMN "rang" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mouvements_bancaires" ADD COLUMN "cle_idempotence" text NOT NULL;--> statement-breakpoint
ALTER TABLE "mouvements_bancaires" ADD COLUMN "identifiant_compte" text;--> statement-breakpoint
ALTER TABLE "mouvements_bancaires" ADD COLUMN "devise" text;--> statement-breakpoint
ALTER TABLE "mouvements_bancaires" ADD COLUMN "reference_bout_en_bout" text;--> statement-breakpoint
ALTER TABLE "mouvements_bancaires" ADD COLUMN "contrepartie_nom" text;--> statement-breakpoint
ALTER TABLE "mouvements_bancaires" ADD COLUMN "brut" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mouvements_bancaires" ADD COLUMN "cree_le" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rapprochements" ADD COLUMN "exercice_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "rapprochements" ADD COLUMN "execution_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "rapprochements" ADD COLUMN "regle" text NOT NULL;--> statement-breakpoint
ALTER TABLE "rapprochements" ADD COLUMN "cotes_ecritures" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rapprochements" ADD COLUMN "cotes_mouvements" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rapprochements" ADD COLUMN "explication" text NOT NULL;--> statement-breakpoint
ALTER TABLE "rapprochements" ADD COLUMN "motif" text;--> statement-breakpoint
ALTER TABLE "rapprochements" ADD COLUMN "decide_par" uuid;--> statement-breakpoint
ALTER TABLE "rapprochements" ADD COLUMN "decide_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "televersements" ADD COLUMN "parametres" jsonb;--> statement-breakpoint
ALTER TABLE "executions_rapprochement" ADD CONSTRAINT "executions_rapprochement_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions_rapprochement" ADD CONSTRAINT "executions_rapprochement_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions_rapprochement" ADD CONSTRAINT "executions_rapprochement_exercice_id_exercices_id_fk" FOREIGN KEY ("exercice_id") REFERENCES "public"."exercices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions_rapprochement" ADD CONSTRAINT "executions_rapprochement_lot_import_id_lots_import_id_fk" FOREIGN KEY ("lot_import_id") REFERENCES "public"."lots_import"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions_rapprochement" ADD CONSTRAINT "executions_rapprochement_lance_par_utilisateurs_id_fk" FOREIGN KEY ("lance_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releves_bancaires" ADD CONSTRAINT "releves_bancaires_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releves_bancaires" ADD CONSTRAINT "releves_bancaires_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releves_bancaires" ADD CONSTRAINT "releves_bancaires_lot_import_id_lots_import_id_fk" FOREIGN KEY ("lot_import_id") REFERENCES "public"."lots_import"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_bancaires" ADD CONSTRAINT "mouvements_bancaires_releve_id_releves_bancaires_id_fk" FOREIGN KEY ("releve_id") REFERENCES "public"."releves_bancaires"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapprochements" ADD CONSTRAINT "rapprochements_exercice_id_exercices_id_fk" FOREIGN KEY ("exercice_id") REFERENCES "public"."exercices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapprochements" ADD CONSTRAINT "rapprochements_execution_id_executions_rapprochement_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions_rapprochement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapprochements" ADD CONSTRAINT "rapprochements_decide_par_utilisateurs_id_fk" FOREIGN KEY ("decide_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mouvements_idempotence" ON "mouvements_bancaires" USING btree ("entite_id","cle_idempotence");--> statement-breakpoint
CREATE INDEX "mouvements_date" ON "mouvements_bancaires" USING btree ("entite_id","date_operation");--> statement-breakpoint
CREATE INDEX "rapprochements_execution" ON "rapprochements" USING btree ("execution_id","statut");--> statement-breakpoint
ALTER TABLE "rapprochements" DROP COLUMN "elements";