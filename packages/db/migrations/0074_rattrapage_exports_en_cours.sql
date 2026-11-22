-- D-165 : le rattrapage reprend aussi les exports (dossier de révision, restitution d'un dossier, restitution d'un cabinet) restés « en cours » (worker tué, file perdue).
--
-- Constat : ces traitements passent en « en_cours » (transaction validée) AVANT leur longue génération ; un worker tué la laissait dans cet état, et si la tâche avait aussi disparu de la file
-- (perte de Redis, tentatives épuisées), le rattrapage — qui ne listait que « en_attente » — ne la reprenait JAMAIS. Les trois traitements prennent désormais un verrou de session PostgreSQL
-- (comme les imports, D-101) : un worker vivant le garde et la tâche en double s'efface, un worker mort le perd avec sa session. Mêmes droits, mêmes autres branches que 0049.
CREATE OR REPLACE FUNCTION worker_traitements_en_attente(p_minutes integer DEFAULT 10, p_limite integer DEFAULT 200)
RETURNS TABLE (cabinet_id uuid, nature text, identifiant uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  (SELECT l.cabinet_id, CASE l.type WHEN 'fec' THEN 'import_fec' ELSE 'import_releve' END, l.id
     FROM lots_import l WHERE l.statut IN ('en_attente', 'en_cours') AND l.type IN ('fec', 'releve_bancaire') AND l.cree_le < now() - make_interval(mins => p_minutes))
  UNION ALL
  (SELECT e.cabinet_id, 'controles', e.id FROM executions_controles e WHERE e.statut = 'en_attente' AND e.cree_le < now() - make_interval(mins => p_minutes))
  UNION ALL
  (SELECT e.cabinet_id, 'rapprochement', e.id FROM executions_rapprochement e WHERE e.statut = 'en_attente' AND e.cree_le < now() - make_interval(mins => p_minutes))
  UNION ALL
  (SELECT e.cabinet_id, 'dossier_revision', e.id FROM exports_revision e WHERE e.statut IN ('en_attente', 'en_cours') AND e.cree_le < now() - make_interval(mins => p_minutes))
  UNION ALL
  (SELECT r.cabinet_id, 'restitution', r.id FROM restitutions r WHERE r.statut IN ('en_attente', 'en_cours') AND r.cree_le < now() - make_interval(mins => p_minutes))
  UNION ALL
  (SELECT r.cabinet_id, 'restitution_cabinet', r.id FROM restitutions_cabinet r WHERE r.statut IN ('en_attente', 'en_cours') AND r.cree_le < now() - make_interval(mins => p_minutes))
  UNION ALL
  (SELECT r.cabinet_id, 'reanalyse_destinataire', r.id FROM reanalyses_destinataire r WHERE r.statut IN ('en_attente', 'en_cours') AND r.maj_le < now() - make_interval(mins => p_minutes))
  LIMIT least(p_limite, 1000)
$$;
