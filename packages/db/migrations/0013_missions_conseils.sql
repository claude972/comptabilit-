CREATE TABLE "baremes_temps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"prestation" text NOT NULL,
	"minutes_reference" integer NOT NULL,
	"defini_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conseils" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"mission_id" uuid,
	"date_conseil" date NOT NULL,
	"auteur_id" uuid NOT NULL,
	"objet" text NOT NULL,
	"contenu" text NOT NULL,
	"destinataire" text NOT NULL,
	"pieces" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"remplace_conseil_id" uuid,
	"statut" text DEFAULT 'projet' NOT NULL,
	"valide_par" uuid,
	"valide_le" timestamp with time zone,
	"envoi_autorise_par" uuid,
	"envoi_autorise_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evenements_conseil" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"conseil_id" uuid NOT NULL,
	"type" text NOT NULL,
	"date_evenement" timestamp with time zone NOT NULL,
	"canal" text NOT NULL,
	"justificatif" text NOT NULL,
	"justificatif_document_id" uuid,
	"saisi_par" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "travaux" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"date_travail" date NOT NULL,
	"prestation" text NOT NULL,
	"description" text NOT NULL,
	"temps_observe_minutes" integer,
	"auteur_id" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lettres_mission" ALTER COLUMN "date_effet" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lettres_mission" ADD COLUMN "contenu" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lettres_mission" ADD COLUMN "origine" text DEFAULT 'saisie_humaine' NOT NULL;--> statement-breakpoint
ALTER TABLE "lettres_mission" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "lettres_mission" ADD COLUMN "redigee_par" uuid;--> statement-breakpoint
ALTER TABLE "lettres_mission" ADD COLUMN "validee_par" uuid;--> statement-breakpoint
ALTER TABLE "lettres_mission" ADD COLUMN "validee_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "baremes_temps" ADD CONSTRAINT "baremes_temps_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baremes_temps" ADD CONSTRAINT "baremes_temps_defini_par_utilisateurs_id_fk" FOREIGN KEY ("defini_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conseils" ADD CONSTRAINT "conseils_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conseils" ADD CONSTRAINT "conseils_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conseils" ADD CONSTRAINT "conseils_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conseils" ADD CONSTRAINT "conseils_auteur_id_utilisateurs_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conseils" ADD CONSTRAINT "conseils_valide_par_utilisateurs_id_fk" FOREIGN KEY ("valide_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conseils" ADD CONSTRAINT "conseils_envoi_autorise_par_utilisateurs_id_fk" FOREIGN KEY ("envoi_autorise_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenements_conseil" ADD CONSTRAINT "evenements_conseil_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenements_conseil" ADD CONSTRAINT "evenements_conseil_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenements_conseil" ADD CONSTRAINT "evenements_conseil_conseil_id_conseils_id_fk" FOREIGN KEY ("conseil_id") REFERENCES "public"."conseils"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenements_conseil" ADD CONSTRAINT "evenements_conseil_saisi_par_utilisateurs_id_fk" FOREIGN KEY ("saisi_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travaux" ADD CONSTRAINT "travaux_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travaux" ADD CONSTRAINT "travaux_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travaux" ADD CONSTRAINT "travaux_auteur_id_utilisateurs_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "baremes_unique" ON "baremes_temps" USING btree ("cabinet_id","prestation");--> statement-breakpoint
ALTER TABLE "lettres_mission" ADD CONSTRAINT "lettres_mission_redigee_par_utilisateurs_id_fk" FOREIGN KEY ("redigee_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lettres_mission" ADD CONSTRAINT "lettres_mission_validee_par_utilisateurs_id_fk" FOREIGN KEY ("validee_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lettres_mission" DROP COLUMN "analyse";--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Les événements constatés autour d'un conseil (envoi, remise, réception, lecture) ne se modifient ni ne se suppriment.
REVOKE UPDATE, DELETE ON evenements_conseil FROM comtaple_app, comtaple_worker;
--> statement-breakpoint
-- Le barème de temps du cabinet est défini par ses gestionnaires.
CREATE POLICY gestion_bareme_i ON baremes_temps AS RESTRICTIVE FOR INSERT TO comtaple_app WITH CHECK (app_est_gestionnaire());
--> statement-breakpoint
CREATE POLICY gestion_bareme_u ON baremes_temps AS RESTRICTIVE FOR UPDATE TO comtaple_app USING (app_est_gestionnaire()) WITH CHECK (app_est_gestionnaire());
--> statement-breakpoint
CREATE POLICY gestion_bareme_d ON baremes_temps AS RESTRICTIVE FOR DELETE TO comtaple_app USING (app_est_gestionnaire());
