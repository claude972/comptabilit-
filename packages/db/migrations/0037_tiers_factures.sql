CREATE TABLE "liens_factures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"exercice_id" uuid NOT NULL,
	"type" text NOT NULL,
	"objet" text NOT NULL,
	"document_id" uuid,
	"cible" text NOT NULL,
	"decision" text NOT NULL,
	"montant" numeric(18, 2),
	"motif" text,
	"version_extraction" integer,
	"version_donnees" integer NOT NULL,
	"decide_par" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liens_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"cle_comptable" text NOT NULL,
	"cle_piece" text NOT NULL,
	"decision" text NOT NULL,
	"motif" text,
	"decide_par" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "liens_factures" ADD CONSTRAINT "liens_factures_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liens_factures" ADD CONSTRAINT "liens_factures_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liens_factures" ADD CONSTRAINT "liens_factures_exercice_id_exercices_id_fk" FOREIGN KEY ("exercice_id") REFERENCES "public"."exercices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liens_factures" ADD CONSTRAINT "liens_factures_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liens_factures" ADD CONSTRAINT "liens_factures_decide_par_utilisateurs_id_fk" FOREIGN KEY ("decide_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liens_tiers" ADD CONSTRAINT "liens_tiers_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liens_tiers" ADD CONSTRAINT "liens_tiers_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liens_tiers" ADD CONSTRAINT "liens_tiers_decide_par_utilisateurs_id_fk" FOREIGN KEY ("decide_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "liens_factures_unique" ON "liens_factures" USING btree ("exercice_id","type","objet","cible");--> statement-breakpoint
CREATE INDEX "liens_factures_dossier" ON "liens_factures" USING btree ("entite_id");--> statement-breakpoint
CREATE UNIQUE INDEX "liens_tiers_unique" ON "liens_tiers" USING btree ("entite_id","cle_comptable","cle_piece");--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Décisions HUMAINES uniquement (confirmations, infirmations), écrites par l'application : le worker n'y écrit jamais.
-- Les politiques posées par securite_appliquer_rls() donnent la lecture dès le niveau « lecture » et l'écriture à partir
-- du niveau « collaboration » ; les décisions réservées au niveau « révision » sont contrôlées par l'API.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON liens_tiers, liens_factures FROM comtaple_worker;
--> statement-breakpoint
ALTER TABLE liens_tiers ADD CONSTRAINT liens_tiers_valeurs CHECK (
  decision IN ('confirme', 'infirme')
  AND cle_comptable ~ '^aux:.{1,100}$'
  AND cle_piece ~ '^(siren:[0-9]{9}|tva:[A-Z0-9]{4,15}|nom:.{1,140})$'
);
--> statement-breakpoint
ALTER TABLE liens_factures ADD CONSTRAINT liens_factures_valeurs CHECK (
  decision IN ('confirme', 'infirme')
  AND type IN ('comptabilisation', 'imputation', 'suspicion')
  AND char_length(objet) BETWEEN 1 AND 1000
  AND char_length(cible) BETWEEN 1 AND 300
  AND (montant IS NULL OR (type = 'imputation' AND decision = 'confirme' AND montant > 0))
  AND (
    (type = 'suspicion' AND document_id IS NULL AND cible = 'suspicion' AND objet ~ '^[EP]:')
    OR (type <> 'suspicion' AND document_id IS NOT NULL AND objet = document_id::text AND version_extraction IS NOT NULL)
  )
);
