ALTER TABLE "lettres_mission" ADD COLUMN "estimation" jsonb;--> statement-breakpoint
ALTER TABLE "regles_cabinet" ADD COLUMN "motif_decision" text;--> statement-breakpoint
-- Rattrapage des traitements restés en attente (file vidée ou tâche perdue) : imports, contrôles, rapprochements,
-- dossiers de révision, restitutions. Identifiants seuls ; exécutable par le worker uniquement.
CREATE FUNCTION worker_traitements_en_attente(p_minutes integer DEFAULT 10, p_limite integer DEFAULT 200)
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
  LIMIT least(p_limite, 1000)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION worker_traitements_en_attente(integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION worker_traitements_en_attente(integer, integer) TO comtaple_worker;
