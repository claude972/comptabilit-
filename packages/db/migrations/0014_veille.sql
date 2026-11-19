CREATE TABLE "evolutions_reglementaires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"surveillance_id" uuid,
	"emetteur" text NOT NULL,
	"reference" text NOT NULL,
	"url" text NOT NULL,
	"passage" text,
	"date_publication" date,
	"date_effet" date,
	"conditions" text,
	"resume" text,
	"criteres" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"etat_verification" text DEFAULT 'detectee_a_qualifier' NOT NULL,
	"verifiee_le" date,
	"detectee_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suivis_evolution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"evolution_id" uuid NOT NULL,
	"statut" text NOT NULL,
	"note" text,
	"auteur_id" uuid NOT NULL,
	"maj_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surveillances_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"emetteur" text NOT NULL,
	"libelle" text NOT NULL,
	"url" text NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"dernier_essai_le" timestamp with time zone,
	"dernier_succes_le" timestamp with time zone,
	"dernier_statut" text DEFAULT 'jamais_verifiee' NOT NULL,
	"dernier_detail" text,
	"empreinte_contenu" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "surveillances_sources_url_unique" UNIQUE("url")
);
--> statement-breakpoint
ALTER TABLE "evolutions_reglementaires" ADD CONSTRAINT "evolutions_reglementaires_surveillance_id_surveillances_sources_id_fk" FOREIGN KEY ("surveillance_id") REFERENCES "public"."surveillances_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suivis_evolution" ADD CONSTRAINT "suivis_evolution_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suivis_evolution" ADD CONSTRAINT "suivis_evolution_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suivis_evolution" ADD CONSTRAINT "suivis_evolution_evolution_id_evolutions_reglementaires_id_fk" FOREIGN KEY ("evolution_id") REFERENCES "public"."evolutions_reglementaires"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suivis_evolution" ADD CONSTRAINT "suivis_evolution_auteur_id_utilisateurs_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "suivis_evolution_unique" ON "suivis_evolution" USING btree ("entite_id","evolution_id");--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Référentiel de veille partagé : lecture seule pour l'application. Le worker met à jour le suivi des sources et
-- enregistre les détections ; la qualification d'une évolution est une opération de l'éditeur.
REVOKE INSERT, UPDATE, DELETE ON surveillances_sources, evolutions_reglementaires FROM comtaple_app;
--> statement-breakpoint
REVOKE INSERT, DELETE ON surveillances_sources FROM comtaple_worker;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON evolutions_reglementaires FROM comtaple_worker;
