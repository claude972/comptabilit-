CREATE TABLE "campagnes_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"libelle" text NOT NULL,
	"type" text NOT NULL,
	"statut" text DEFAULT 'ouverte' NOT NULL,
	"cree_par" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mouvements_lots" (
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"mouvement_id" uuid NOT NULL,
	"lot_import_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lots_import" ADD COLUMN "campagne_id" uuid;--> statement-breakpoint
ALTER TABLE "lots_import" ADD COLUMN "statut_avant_annulation" text;--> statement-breakpoint
ALTER TABLE "lots_import" ADD COLUMN "annule_par" uuid;--> statement-breakpoint
ALTER TABLE "lots_import" ADD COLUMN "annule_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lots_import" ADD COLUMN "motif_annulation" text;--> statement-breakpoint
ALTER TABLE "televersements" ADD COLUMN "campagne_id" uuid;--> statement-breakpoint
ALTER TABLE "campagnes_import" ADD CONSTRAINT "campagnes_import_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campagnes_import" ADD CONSTRAINT "campagnes_import_cree_par_utilisateurs_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_lots" ADD CONSTRAINT "mouvements_lots_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_lots" ADD CONSTRAINT "mouvements_lots_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_lots" ADD CONSTRAINT "mouvements_lots_mouvement_id_mouvements_bancaires_id_fk" FOREIGN KEY ("mouvement_id") REFERENCES "public"."mouvements_bancaires"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_lots" ADD CONSTRAINT "mouvements_lots_lot_import_id_lots_import_id_fk" FOREIGN KEY ("lot_import_id") REFERENCES "public"."lots_import"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mouvements_lots_unique" ON "mouvements_lots" USING btree ("mouvement_id","lot_import_id");--> statement-breakpoint
CREATE INDEX "mouvements_lots_lot" ON "mouvements_lots" USING btree ("lot_import_id");--> statement-breakpoint
ALTER TABLE "lots_import" ADD CONSTRAINT "lots_import_campagne_id_campagnes_import_id_fk" FOREIGN KEY ("campagne_id") REFERENCES "public"."campagnes_import"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots_import" ADD CONSTRAINT "lots_import_annule_par_utilisateurs_id_fk" FOREIGN KEY ("annule_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Reprise de l'existant : chaque mouvement est rattaché au lot qui l'a introduit.
INSERT INTO mouvements_lots (cabinet_id, entite_id, mouvement_id, lot_import_id)
SELECT m.cabinet_id, m.entite_id, m.id, m.lot_import_id FROM mouvements_bancaires m WHERE m.lot_import_id IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Mouvements pris en compte d'un dossier : ceux vus dans au moins un lot de relevé actif.
CREATE FUNCTION mouvement_pris_en_compte(p_mouvement uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT EXISTS (SELECT 1 FROM mouvements_lots ml JOIN lots_import l ON l.id = ml.lot_import_id AND l.actif WHERE ml.mouvement_id = p_mouvement) $$;
