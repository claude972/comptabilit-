CREATE TABLE "echanges_portefeuille" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"utilisateur_id" uuid NOT NULL,
	"question" text NOT NULL,
	"mode" text NOT NULL,
	"statut" text NOT NULL,
	"dossiers" jsonb NOT NULL,
	"contenu" jsonb NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggestions_ecartees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"empreinte" text NOT NULL,
	"categorie" text NOT NULL,
	"controle_id" text,
	"entite_id_cible" uuid,
	"version_criteres" text NOT NULL,
	"decomptes" jsonb NOT NULL,
	"motif" text NOT NULL,
	"ecartee_par" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "echanges_portefeuille" ADD CONSTRAINT "echanges_portefeuille_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echanges_portefeuille" ADD CONSTRAINT "echanges_portefeuille_utilisateur_id_utilisateurs_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions_ecartees" ADD CONSTRAINT "suggestions_ecartees_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions_ecartees" ADD CONSTRAINT "suggestions_ecartees_ecartee_par_utilisateurs_id_fk" FOREIGN KEY ("ecartee_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "echanges_portefeuille_auteur" ON "echanges_portefeuille" USING btree ("utilisateur_id","cree_le");--> statement-breakpoint
CREATE INDEX "suggestions_ecartees_cabinet" ON "suggestions_ecartees" USING btree ("cabinet_id","empreinte","cree_le");--> statement-breakpoint
-- ─── Complété à la main : isolation, « chacun les siens », ajout seul ───
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Échanges de portefeuille : un échange n'appartient à aucun dossier unique (pas de colonne entite_id, donc pas de
-- politique par dossier). Chacun ne lit et n'écrit que LES SIENS, dans la base elle-même ; rien ne se modifie.
-- Le filtrage par dossier selon les habilitations DU MOMENT est fait à la relecture par l'application (chaque source
-- conservée porte son dossier) : voir apps/api/src/assistant-portefeuille.service.ts.
CREATE POLICY ses_echanges ON echanges_portefeuille AS RESTRICTIVE FOR ALL TO comtaple_app
  USING (utilisateur_id = app_utilisateur_id()) WITH CHECK (utilisateur_id = app_utilisateur_id());
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON echanges_portefeuille FROM comtaple_app, comtaple_worker;
--> statement-breakpoint
REVOKE INSERT, SELECT ON echanges_portefeuille FROM comtaple_worker;
--> statement-breakpoint
ALTER TABLE echanges_portefeuille ADD CONSTRAINT echanges_portefeuille_mode CHECK (mode IN ('ia', 'simulateur', 'sans_ia'));
--> statement-breakpoint
-- Suggestions écartées : décision d'une personne habilitée (réviseur, associé, administrateur), en son nom, en ajout seul.
CREATE POLICY ecriture_reviseurs ON suggestions_ecartees AS RESTRICTIVE FOR INSERT TO comtaple_app
  WITH CHECK (
    ecartee_par = app_utilisateur_id()
    AND EXISTS (
      SELECT 1 FROM appartenances a
      WHERE a.cabinet_id = app_cabinet_id() AND a.utilisateur_id = app_utilisateur_id() AND a.actif
        AND (a.expire_le IS NULL OR a.expire_le > now())
        AND a.role IN ('administrateur', 'associe', 'reviseur')
    )
  );
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON suggestions_ecartees FROM comtaple_app, comtaple_worker;
--> statement-breakpoint
REVOKE INSERT ON suggestions_ecartees FROM comtaple_worker;
--> statement-breakpoint
ALTER TABLE suggestions_ecartees ADD CONSTRAINT suggestions_ecartees_categorie CHECK (categorie IN ('exception_dossier', 'preference_cabinet', 'nouvelle_regle_metier', 'modification_regle_reglementaire'));
--> statement-breakpoint
ALTER TABLE suggestions_ecartees ADD CONSTRAINT suggestions_ecartees_motif CHECK (length(btrim(motif)) >= 5);
