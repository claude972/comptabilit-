CREATE TABLE "echanges_assistant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"utilisateur_id" uuid NOT NULL,
	"exercice_id" uuid,
	"question" text NOT NULL,
	"mode" text NOT NULL,
	"statut" text NOT NULL,
	"reponse" jsonb NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evenements_ia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id_cible" uuid,
	"utilisateur_id" uuid,
	"type" text NOT NULL,
	"tache" text NOT NULL,
	"nature" text NOT NULL,
	"modele" text,
	"resultat" text NOT NULL,
	"codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duree_ms" integer,
	"jetons_entree" integer,
	"jetons_sortie" integer,
	"cout_estime" numeric(18, 6),
	"devise" text,
	"empreinte_prompt" text,
	"mesures" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passages_recherche" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"page" integer NOT NULL,
	"rang" integer NOT NULL,
	"texte" text NOT NULL,
	"modele" text,
	"nature_vecteur" text,
	"vecteur" vector(1024),
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "echanges_assistant" ADD CONSTRAINT "echanges_assistant_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echanges_assistant" ADD CONSTRAINT "echanges_assistant_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echanges_assistant" ADD CONSTRAINT "echanges_assistant_utilisateur_id_utilisateurs_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echanges_assistant" ADD CONSTRAINT "echanges_assistant_exercice_id_exercices_id_fk" FOREIGN KEY ("exercice_id") REFERENCES "public"."exercices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenements_ia" ADD CONSTRAINT "evenements_ia_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenements_ia" ADD CONSTRAINT "evenements_ia_entite_id_cible_entites_id_fk" FOREIGN KEY ("entite_id_cible") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenements_ia" ADD CONSTRAINT "evenements_ia_utilisateur_id_utilisateurs_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passages_recherche" ADD CONSTRAINT "passages_recherche_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passages_recherche" ADD CONSTRAINT "passages_recherche_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passages_recherche" ADD CONSTRAINT "passages_recherche_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "echanges_assistant_auteur" ON "echanges_assistant" USING btree ("utilisateur_id","entite_id","cree_le");--> statement-breakpoint
CREATE INDEX "evenements_ia_cabinet" ON "evenements_ia" USING btree ("cabinet_id","cree_le");--> statement-breakpoint
CREATE UNIQUE INDEX "passages_recherche_unique" ON "passages_recherche" USING btree ("document_id","page","rang");--> statement-breakpoint
CREATE INDEX "passages_recherche_dossier" ON "passages_recherche" USING btree ("entite_id");--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Traces IA : ajout seul ; lecture réservée aux gestionnaires du cabinet ; ni l'application ni le worker ne modifient ou suppriment.
CREATE POLICY lecture_gestionnaire ON evenements_ia AS RESTRICTIVE FOR SELECT TO comtaple_app USING (app_est_gestionnaire());
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON evenements_ia FROM comtaple_app, comtaple_worker;
--> statement-breakpoint
ALTER TABLE evenements_ia ADD CONSTRAINT evenements_ia_type CHECK (type IN ('appel_ia', 'fonction_metier'));
--> statement-breakpoint
ALTER TABLE evenements_ia ADD CONSTRAINT evenements_ia_nature CHECK (nature IN ('reel', 'simulateur', 'sans_ia'));
--> statement-breakpoint
-- Échanges avec l'assistant : chacun ne lit et n'écrit que les SIENS, dans la base elle-même ; rien ne se modifie.
CREATE POLICY ses_echanges ON echanges_assistant AS RESTRICTIVE FOR ALL TO comtaple_app
  USING (utilisateur_id = app_utilisateur_id()) WITH CHECK (utilisateur_id = app_utilisateur_id());
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON echanges_assistant FROM comtaple_app, comtaple_worker;
--> statement-breakpoint
REVOKE INSERT ON echanges_assistant FROM comtaple_worker;
--> statement-breakpoint
ALTER TABLE echanges_assistant ADD CONSTRAINT echanges_assistant_mode CHECK (mode IN ('ia', 'simulateur', 'sans_ia'));
--> statement-breakpoint
-- Passages : écrits par le worker (indexation des pièces analysées), lus par l'application sous la politique du dossier.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON passages_recherche FROM comtaple_app;
--> statement-breakpoint
ALTER TABLE passages_recherche ADD CONSTRAINT passages_recherche_nature CHECK (nature_vecteur IS NULL OR nature_vecteur IN ('reel', 'simulateur'));
--> statement-breakpoint
ALTER TABLE passages_recherche ADD CONSTRAINT passages_recherche_vecteur_coherent CHECK ((vecteur IS NULL) = (modele IS NULL) AND (vecteur IS NULL) = (nature_vecteur IS NULL));
--> statement-breakpoint
-- Recherche approchée par similarité cosinus (les lignes sans vecteur ne sont pas indexées).
CREATE INDEX passages_recherche_vecteur ON passages_recherche USING hnsw (vecteur vector_cosine_ops) WHERE vecteur IS NOT NULL;
--> statement-breakpoint
CREATE INDEX passages_recherche_texte ON passages_recherche USING gin (to_tsvector('french', texte));
