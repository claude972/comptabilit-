CREATE TABLE "historique_qualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"exercice_id" uuid NOT NULL,
	"nature" text NOT NULL,
	"cle" text NOT NULL,
	"action" text NOT NULL,
	"montant" text,
	"montant_export" text,
	"note" text,
	"version_donnees" integer NOT NULL,
	"auteur_id" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "historique_qualifications" ADD CONSTRAINT "historique_qualifications_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historique_qualifications" ADD CONSTRAINT "historique_qualifications_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historique_qualifications" ADD CONSTRAINT "historique_qualifications_exercice_id_exercices_id_fk" FOREIGN KEY ("exercice_id") REFERENCES "public"."exercices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historique_qualifications" ADD CONSTRAINT "historique_qualifications_auteur_id_utilisateurs_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "historique_qualifications_exercice" ON "historique_qualifications" USING btree ("exercice_id","nature","cle");
--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- AJOUT SEUL : l'application ne modifie ni ne supprime jamais une ligne d'historique ; le worker n'y touche pas.
REVOKE UPDATE, DELETE, TRUNCATE ON historique_qualifications FROM comtaple_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON historique_qualifications FROM comtaple_worker;
--> statement-breakpoint
ALTER TABLE historique_qualifications ADD CONSTRAINT historique_qualifications_action CHECK (action IN ('saisie', 'retrait'));
--> statement-breakpoint
ALTER TABLE historique_qualifications ADD CONSTRAINT historique_qualifications_nature CHECK (nature IN ('ventilation_ca', 'renvoi'));
--> statement-breakpoint
ALTER TABLE historique_qualifications ADD CONSTRAINT historique_qualifications_coherence CHECK ((action = 'saisie' AND montant IS NOT NULL AND note IS NOT NULL) OR (action = 'retrait' AND montant IS NULL));
