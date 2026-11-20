CREATE TABLE "reanalyses_destinataire" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"simulation_id" uuid,
	"version_analyseur" text NOT NULL,
	"statut" text DEFAULT 'en_attente' NOT NULL,
	"taille_lot" integer NOT NULL,
	"motif" text NOT NULL,
	"nb_pieces" integer DEFAULT 0 NOT NULL,
	"resume" jsonb,
	"demande_par" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"maj_le" timestamp with time zone DEFAULT now() NOT NULL,
	"termine_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reanalyses_destinataire_pieces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"extraction_avant_id" uuid NOT NULL,
	"version_extraction_avant" integer NOT NULL,
	"version_analyseur" text NOT NULL,
	"execution" boolean NOT NULL,
	"statut" text DEFAULT 'en_attente' NOT NULL,
	"resultat" text,
	"motif" text,
	"extraction_apres_id" uuid,
	"version_extraction_apres" integer,
	"detail" jsonb,
	"traite_le" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "reanalyses_destinataire" ADD CONSTRAINT "reanalyses_destinataire_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reanalyses_destinataire" ADD CONSTRAINT "reanalyses_destinataire_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reanalyses_destinataire" ADD CONSTRAINT "reanalyses_destinataire_simulation_id_reanalyses_destinataire_id_fk" FOREIGN KEY ("simulation_id") REFERENCES "public"."reanalyses_destinataire"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reanalyses_destinataire" ADD CONSTRAINT "reanalyses_destinataire_demande_par_utilisateurs_id_fk" FOREIGN KEY ("demande_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reanalyses_destinataire_pieces" ADD CONSTRAINT "reanalyses_destinataire_pieces_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reanalyses_destinataire_pieces" ADD CONSTRAINT "reanalyses_destinataire_pieces_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reanalyses_destinataire_pieces" ADD CONSTRAINT "reanalyses_destinataire_pieces_lot_id_reanalyses_destinataire_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."reanalyses_destinataire"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reanalyses_destinataire_pieces" ADD CONSTRAINT "reanalyses_destinataire_pieces_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reanalyses_destinataire_pieces" ADD CONSTRAINT "reanalyses_destinataire_pieces_extraction_avant_id_extractions_id_fk" FOREIGN KEY ("extraction_avant_id") REFERENCES "public"."extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reanalyses_destinataire_pieces" ADD CONSTRAINT "reanalyses_destinataire_pieces_extraction_apres_id_extractions_id_fk" FOREIGN KEY ("extraction_apres_id") REFERENCES "public"."extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reanalyses_destinataire_une_execution" ON "reanalyses_destinataire" USING btree ("simulation_id") WHERE mode = 'execution';--> statement-breakpoint
CREATE INDEX "reanalyses_destinataire_dossier" ON "reanalyses_destinataire" USING btree ("entite_id","cree_le");--> statement-breakpoint
CREATE UNIQUE INDEX "reanalyses_destinataire_pieces_unique" ON "reanalyses_destinataire_pieces" USING btree ("lot_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reanalyses_destinataire_pieces_version" ON "reanalyses_destinataire_pieces" USING btree ("document_id","version_analyseur") WHERE execution AND resultat IN ('destinataire_trouve', 'abstention');--> statement-breakpoint
CREATE INDEX "reanalyses_destinataire_pieces_lot" ON "reanalyses_destinataire_pieces" USING btree ("lot_id","statut");
--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- RLS forcée par securite_appliquer_rls() : lecture dès le niveau « lecture », écriture dès « collaboration » par dossier pour l'API ;
-- le niveau exigé pour DEMANDER une réanalyse (révision) est contrôlé par l'API, comme pour les autres décisions.
ALTER TABLE reanalyses_destinataire ADD CONSTRAINT reanalyses_destinataire_valeurs CHECK (
  mode IN ('simulation', 'execution')
  AND statut IN ('en_attente', 'en_cours', 'termine')
  AND taille_lot BETWEEN 1 AND 50
  AND nb_pieces BETWEEN 0 AND 50
  AND char_length(motif) BETWEEN 1 AND 2000
  AND ((mode = 'simulation' AND simulation_id IS NULL) OR (mode = 'execution' AND simulation_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE reanalyses_destinataire_pieces ADD CONSTRAINT reanalyses_destinataire_pieces_valeurs CHECK (
  statut IN ('en_attente', 'termine')
  AND (resultat IS NULL OR resultat IN ('inchangee', 'destinataire_trouve', 'abstention', 'erreur'))
  AND ((statut = 'en_attente' AND resultat IS NULL AND traite_le IS NULL) OR (statut = 'termine' AND resultat IS NOT NULL AND traite_le IS NOT NULL))
  AND (extraction_apres_id IS NULL) = (version_extraction_apres IS NULL)
  AND (extraction_apres_id IS NULL OR (execution AND resultat IN ('destinataire_trouve', 'abstention')))
  AND (resultat IS DISTINCT FROM 'erreur' OR (motif IS NOT NULL AND extraction_apres_id IS NULL))
);
--> statement-breakpoint
-- Ajout seul : l'application ne modifie ni ne supprime jamais une demande ni son rapport ; le worker ne crée aucune ligne
-- (la sélection des pièces est faite à la demande, par l'API) et ne supprime rien.
REVOKE UPDATE, DELETE, TRUNCATE ON reanalyses_destinataire, reanalyses_destinataire_pieces FROM comtaple_app;
--> statement-breakpoint
REVOKE INSERT, DELETE, TRUNCATE ON reanalyses_destinataire, reanalyses_destinataire_pieces FROM comtaple_worker;
--> statement-breakpoint
-- Un rapport de pièce terminé est figé ; une demande terminée aussi ; les éléments de la demande ne changent jamais.
CREATE FUNCTION reanalyses_destinataire_figees() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'reanalyses_destinataire_pieces' THEN
    IF OLD.statut = 'termine' THEN RAISE EXCEPTION 'Le rapport d''une pièce réanalysée ne se modifie plus'; END IF;
    IF NEW.lot_id <> OLD.lot_id OR NEW.document_id <> OLD.document_id OR NEW.extraction_avant_id <> OLD.extraction_avant_id
       OR NEW.version_analyseur <> OLD.version_analyseur OR NEW.execution <> OLD.execution OR NEW.cabinet_id <> OLD.cabinet_id OR NEW.entite_id <> OLD.entite_id THEN
      RAISE EXCEPTION 'Les éléments de sélection d''une pièce réanalysée ne se modifient pas';
    END IF;
  ELSE
    IF OLD.statut = 'termine' THEN RAISE EXCEPTION 'Une réanalyse terminée ne se modifie plus'; END IF;
    IF NEW.mode <> OLD.mode OR NEW.motif <> OLD.motif OR NEW.demande_par <> OLD.demande_par OR NEW.version_analyseur <> OLD.version_analyseur
       OR NEW.entite_id <> OLD.entite_id OR NEW.cabinet_id <> OLD.cabinet_id OR NEW.simulation_id IS DISTINCT FROM OLD.simulation_id OR NEW.taille_lot <> OLD.taille_lot OR NEW.nb_pieces <> OLD.nb_pieces THEN
      RAISE EXCEPTION 'Les éléments d''une demande de réanalyse ne se modifient pas';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
--> statement-breakpoint
CREATE TRIGGER reanalyses_destinataire_figees BEFORE UPDATE ON reanalyses_destinataire FOR EACH ROW EXECUTE FUNCTION reanalyses_destinataire_figees();
--> statement-breakpoint
CREATE TRIGGER reanalyses_destinataire_pieces_figees BEFORE UPDATE ON reanalyses_destinataire_pieces FOR EACH ROW EXECUTE FUNCTION reanalyses_destinataire_figees();
--> statement-breakpoint
-- Rattrapage : une réanalyse restée en attente, ou interrompue en cours de traitement, est remise en file comme les autres
-- traitements ; le traitement reprend aux seules pièces non terminées (aucun doublon : index unique par pièce et version).
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
  UNION ALL
  (SELECT r.cabinet_id, 'reanalyse_destinataire', r.id FROM reanalyses_destinataire r WHERE r.statut IN ('en_attente', 'en_cours') AND r.maj_le < now() - make_interval(mins => p_minutes))
  LIMIT least(p_limite, 1000)
$$;
