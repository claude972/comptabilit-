CREATE TABLE "restitutions_cabinet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"statut" "statut_lot" DEFAULT 'en_attente' NOT NULL,
	"perimetre" jsonb NOT NULL,
	"cle_archive" text,
	"sha256" text,
	"taille" bigint,
	"resume" jsonb,
	"erreur" text,
	"demande_par" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"termine_le" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "restitutions_cabinet" ADD CONSTRAINT "restitutions_cabinet_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restitutions_cabinet" ADD CONSTRAINT "restitutions_cabinet_demande_par_utilisateurs_id_fk" FOREIGN KEY ("demande_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Réservée aux gestionnaires du cabinet, en lecture comme en écriture, dans la base elle-même.
CREATE POLICY gestionnaire_seulement ON restitutions_cabinet AS RESTRICTIVE FOR ALL TO comtaple_app
  USING (app_est_gestionnaire()) WITH CHECK (app_est_gestionnaire());
--> statement-breakpoint
-- L'application ne supprime jamais une restitution.
REVOKE DELETE, TRUNCATE ON restitutions_cabinet FROM comtaple_app, comtaple_worker;
--> statement-breakpoint
-- Rattrapage : la restitution d'un cabinet restée en attente est remise en file comme les autres traitements.
CREATE OR REPLACE FUNCTION worker_traitements_en_attente(p_minutes integer DEFAULT 10, p_limite integer DEFAULT 200)
RETURNS TABLE (cabinet_id uuid, nature text, identifiant uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  (SELECT l.cabinet_id, CASE l.type WHEN 'fec' THEN 'import_fec' ELSE 'import_releve' END, l.id
     FROM lots_import l WHERE l.statut = 'en_attente' AND l.type IN ('fec', 'releve_bancaire') AND l.cree_le < now() - make_interval(mins => p_minutes))
  UNION ALL
  (SELECT e.cabinet_id, 'controles', e.id FROM executions_controles e WHERE e.statut = 'en_attente' AND e.cree_le < now() - make_interval(mins => p_minutes))
  UNION ALL
  (SELECT e.cabinet_id, 'rapprochement', e.id FROM executions_rapprochement e WHERE e.statut = 'en_attente' AND e.cree_le < now() - make_interval(mins => p_minutes))
  UNION ALL
  (SELECT e.cabinet_id, 'dossier_revision', e.id FROM exports_revision e WHERE e.statut = 'en_attente' AND e.cree_le < now() - make_interval(mins => p_minutes))
  UNION ALL
  (SELECT r.cabinet_id, 'restitution', r.id FROM restitutions r WHERE r.statut = 'en_attente' AND r.cree_le < now() - make_interval(mins => p_minutes))
  UNION ALL
  (SELECT r.cabinet_id, 'restitution_cabinet', r.id FROM restitutions_cabinet r WHERE r.statut = 'en_attente' AND r.cree_le < now() - make_interval(mins => p_minutes))
  LIMIT least(p_limite, 1000)
$$;
