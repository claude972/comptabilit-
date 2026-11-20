CREATE TABLE "lignes_reprise_immobilisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"reprise_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"numero_ligne" integer NOT NULL,
	"statut" text NOT NULL,
	"cause" text,
	"motif" text,
	"valeurs_lues" jsonb NOT NULL,
	"immobilisation_id" uuid
);
--> statement-breakpoint
CREATE TABLE "reprises_immobilisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"fichier_id" uuid NOT NULL,
	"nom_fichier" text NOT NULL,
	"sha256" text NOT NULL,
	"taille" integer NOT NULL,
	"encodage" text NOT NULL,
	"separateur" text NOT NULL,
	"correspondance" jsonb NOT NULL,
	"empreinte_correspondance" text NOT NULL,
	"empreinte_apercu" text NOT NULL,
	"version_analyseur" text NOT NULL,
	"nb_lignes" integer NOT NULL,
	"nb_creees" integer NOT NULL,
	"nb_ignorees" integer NOT NULL,
	"nb_rejetees" integer NOT NULL,
	"importe_par" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "immobilisations" ADD COLUMN "reprise_id" uuid;--> statement-breakpoint
ALTER TABLE "immobilisations" ADD COLUMN "reprise_ligne" integer;--> statement-breakpoint
ALTER TABLE "lignes_reprise_immobilisations" ADD CONSTRAINT "lignes_reprise_immobilisations_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lignes_reprise_immobilisations" ADD CONSTRAINT "lignes_reprise_immobilisations_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lignes_reprise_immobilisations" ADD CONSTRAINT "lignes_reprise_immobilisations_reprise_id_reprises_immobilisations_id_fk" FOREIGN KEY ("reprise_id") REFERENCES "public"."reprises_immobilisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reprises_immobilisations" ADD CONSTRAINT "reprises_immobilisations_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reprises_immobilisations" ADD CONSTRAINT "reprises_immobilisations_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reprises_immobilisations" ADD CONSTRAINT "reprises_immobilisations_fichier_id_fichiers_id_fk" FOREIGN KEY ("fichier_id") REFERENCES "public"."fichiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reprises_immobilisations" ADD CONSTRAINT "reprises_immobilisations_importe_par_utilisateurs_id_fk" FOREIGN KEY ("importe_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lignes_reprise_unique" ON "lignes_reprise_immobilisations" USING btree ("reprise_id","numero_ligne");--> statement-breakpoint
CREATE UNIQUE INDEX "lignes_reprise_idempotence" ON "lignes_reprise_immobilisations" USING btree ("entite_id","sha256","numero_ligne") WHERE statut = 'creee';--> statement-breakpoint
CREATE INDEX "lignes_reprise_statut" ON "lignes_reprise_immobilisations" USING btree ("reprise_id","statut","numero_ligne");--> statement-breakpoint
CREATE UNIQUE INDEX "reprises_immobilisations_unique" ON "reprises_immobilisations" USING btree ("entite_id","sha256","empreinte_correspondance");--> statement-breakpoint
CREATE INDEX "reprises_immobilisations_dossier" ON "reprises_immobilisations" USING btree ("entite_id","cree_le");--> statement-breakpoint
ALTER TABLE "immobilisations" ADD CONSTRAINT "immobilisations_reprise_id_reprises_immobilisations_id_fk" FOREIGN KEY ("reprise_id") REFERENCES "public"."reprises_immobilisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Provenance d'une immobilisation reprise par import : renseignées toutes deux ou aucune (saisie manuelle).
ALTER TABLE immobilisations ADD CONSTRAINT immobilisations_reprise CHECK ((reprise_id IS NULL) = (reprise_ligne IS NULL) AND (reprise_ligne IS NULL OR reprise_ligne >= 2));
--> statement-breakpoint
CREATE INDEX "immobilisations_reprise" ON "immobilisations" USING btree ("reprise_id") WHERE "reprise_id" IS NOT NULL;
--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- RLS forcée par securite_appliquer_rls() : lecture dès le niveau « lecture », écriture dès « collaboration » par dossier pour l'API
-- (le niveau « collaboration » exigé pour importer, comme pour la saisie manuelle, est aussi contrôlé par l'API).
ALTER TABLE reprises_immobilisations ADD CONSTRAINT reprises_immobilisations_valeurs CHECK (
  sha256 ~ '^[0-9a-f]{64}$' AND empreinte_apercu ~ '^[0-9a-f]{64}$' AND empreinte_correspondance ~ '^[0-9a-f]{64}$'
  AND taille BETWEEN 1 AND 5242880
  AND separateur IN (';', ',', E'\t')
  AND char_length(nom_fichier) BETWEEN 1 AND 255
  AND nb_lignes BETWEEN 1 AND 5000
  AND nb_creees >= 1 AND nb_ignorees >= 0 AND nb_rejetees >= 0
  AND nb_creees + nb_ignorees + nb_rejetees = nb_lignes
);
--> statement-breakpoint
ALTER TABLE lignes_reprise_immobilisations ADD CONSTRAINT lignes_reprise_valeurs CHECK (
  numero_ligne >= 2
  AND sha256 ~ '^[0-9a-f]{64}$'
  AND (
    (statut = 'creee' AND immobilisation_id IS NOT NULL AND cause IS NULL AND motif IS NULL)
    OR (statut = 'ignoree_doublon' AND cause IN ('doublon_dossier', 'doublon_fichier', 'deja_repris') AND motif IS NOT NULL AND immobilisation_id IS NULL)
    OR (statut = 'rejetee' AND cause IS NULL AND motif IS NOT NULL AND immobilisation_id IS NULL)
  )
);
--> statement-breakpoint
-- Ajout seul : l'application ne modifie ni ne supprime jamais une reprise ni son rapport ; le worker n'écrit pas dans ces tables.
REVOKE UPDATE, DELETE, TRUNCATE ON reprises_immobilisations, lignes_reprise_immobilisations FROM comtaple_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON reprises_immobilisations, lignes_reprise_immobilisations FROM comtaple_worker;
