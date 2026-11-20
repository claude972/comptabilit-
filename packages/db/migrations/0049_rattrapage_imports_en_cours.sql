-- D-101 : le rattrapage reprend aussi les imports restés « en cours » (worker tué, file perdue).
--
-- Constat (essai d'arrêt brutal du worker, `parcours-reprise-worker.itest.ts`) : un lot d'import laissé « en cours » par un
-- worker tué (SIGKILL) n'était JAMAIS repris : la prise en charge atomique n'acceptait que « en_attente » et « echec », et le
-- rattrapage ne listait que « en_attente ». Le worker applique désormais un verrou de session PostgreSQL pendant un import :
-- un lot « en cours » dont le verrou est libre est celui d'un worker mort et se reprend ; un worker vivant garde le sien.
-- Remettre en file un lot réellement en cours dans un worker vivant est donc SANS EFFET (la tâche s'efface).
--
-- Seule différence avec la version 0045 : la première branche accepte aussi l'état « en_cours » pour les imports de FEC et de
-- relevés. Identifiants seulement, mêmes droits, mêmes autres branches.
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
  (SELECT e.cabinet_id, 'dossier_revision', e.id FROM exports_revision e WHERE e.statut = 'en_attente' AND e.cree_le < now() - make_interval(mins => p_minutes))
  UNION ALL
  (SELECT r.cabinet_id, 'restitution', r.id FROM restitutions r WHERE r.statut = 'en_attente' AND r.cree_le < now() - make_interval(mins => p_minutes))
  UNION ALL
  (SELECT r.cabinet_id, 'restitution_cabinet', r.id FROM restitutions_cabinet r WHERE r.statut = 'en_attente' AND r.cree_le < now() - make_interval(mins => p_minutes))
  UNION ALL
  (SELECT r.cabinet_id, 'reanalyse_destinataire', r.id FROM reanalyses_destinataire r WHERE r.statut IN ('en_attente', 'en_cours') AND r.maj_le < now() - make_interval(mins => p_minutes))
  LIMIT least(p_limite, 1000)
$$;
