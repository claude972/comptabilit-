ALTER TYPE "public"."statut_connexion" ADD VALUE 'active';--> statement-breakpoint
ALTER TYPE "public"."statut_connexion" ADD VALUE 'supprimee';--> statement-breakpoint
CREATE TABLE "demandes_connexion_mail" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"utilisateur_id" uuid NOT NULL,
	"empreinte_state" text NOT NULL,
	"donnees_chiffrees" text NOT NULL,
	"expire_le" timestamp with time zone NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demandes_connexion_mail_empreinte_state_unique" UNIQUE("empreinte_state")
);
--> statement-breakpoint
CREATE TABLE "pieces_a_qualifier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"connexion_id" uuid NOT NULL,
	"fichier_id" uuid NOT NULL,
	"nom_fichier" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"raisons" jsonb NOT NULL,
	"candidats" jsonb NOT NULL,
	"extrait" jsonb,
	"statut" text DEFAULT 'en_attente' NOT NULL,
	"dossier_affecte_id" uuid,
	"document_id" uuid,
	"affectee_par" uuid,
	"affectee_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pieces_mail_vues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"connexion_id" uuid NOT NULL,
	"id_message" text NOT NULL,
	"id_piece_jointe" text NOT NULL,
	"issue" text NOT NULL,
	"document_id" uuid,
	"nom_fichier" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signalements_mail" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"connexion_id" uuid NOT NULL,
	"id_message" text NOT NULL,
	"type" text NOT NULL,
	"id_piece_jointe" text DEFAULT '' NOT NULL,
	"detail" jsonb NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connexions_mail" ADD COLUMN "etat" jsonb;--> statement-breakpoint
ALTER TABLE "connexions_mail" ADD COLUMN "surveillance_echeance" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connexions_mail" ADD COLUMN "derniere_issue" text;--> statement-breakpoint
ALTER TABLE "connexions_mail" ADD COLUMN "preuve" jsonb;--> statement-breakpoint
ALTER TABLE "demandes_connexion_mail" ADD CONSTRAINT "demandes_connexion_mail_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demandes_connexion_mail" ADD CONSTRAINT "demandes_connexion_mail_utilisateur_id_utilisateurs_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieces_a_qualifier" ADD CONSTRAINT "pieces_a_qualifier_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieces_a_qualifier" ADD CONSTRAINT "pieces_a_qualifier_connexion_id_connexions_mail_id_fk" FOREIGN KEY ("connexion_id") REFERENCES "public"."connexions_mail"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieces_a_qualifier" ADD CONSTRAINT "pieces_a_qualifier_fichier_id_fichiers_id_fk" FOREIGN KEY ("fichier_id") REFERENCES "public"."fichiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieces_a_qualifier" ADD CONSTRAINT "pieces_a_qualifier_dossier_affecte_id_entites_id_fk" FOREIGN KEY ("dossier_affecte_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieces_a_qualifier" ADD CONSTRAINT "pieces_a_qualifier_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieces_a_qualifier" ADD CONSTRAINT "pieces_a_qualifier_affectee_par_utilisateurs_id_fk" FOREIGN KEY ("affectee_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieces_mail_vues" ADD CONSTRAINT "pieces_mail_vues_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieces_mail_vues" ADD CONSTRAINT "pieces_mail_vues_connexion_id_connexions_mail_id_fk" FOREIGN KEY ("connexion_id") REFERENCES "public"."connexions_mail"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signalements_mail" ADD CONSTRAINT "signalements_mail_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signalements_mail" ADD CONSTRAINT "signalements_mail_connexion_id_connexions_mail_id_fk" FOREIGN KEY ("connexion_id") REFERENCES "public"."connexions_mail"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pieces_mail_vues_unique" ON "pieces_mail_vues" USING btree ("connexion_id","id_message","id_piece_jointe");--> statement-breakpoint
CREATE UNIQUE INDEX "signalements_mail_unique" ON "signalements_mail" USING btree ("connexion_id","id_message","type","id_piece_jointe");