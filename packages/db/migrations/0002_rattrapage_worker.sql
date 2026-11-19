-- Rattrapage des pièces dont la mise en file a été manquée.
-- Le worker ne peut pas énumérer les cabinets (RLS) : cette fonction étroite, exécutée avec les droits du rôle de
-- migration, ne renvoie QUE des identifiants techniques (cabinet, document), jamais de contenu.
-- Prérequis de déploiement : le rôle de migration possède BYPASSRLS (ou est superutilisateur) et n'est utilisé par
-- aucun service en fonctionnement normal.
CREATE FUNCTION worker_documents_en_retard(p_minutes integer DEFAULT 10, p_limite integer DEFAULT 500)
RETURNS TABLE (cabinet_id uuid, document_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT d.cabinet_id, d.id
  FROM documents d
  WHERE d.statut IN ('recu', 'en_analyse')
    AND d.maj_le < now() - make_interval(mins => p_minutes)
  ORDER BY d.maj_le
  LIMIT least(p_limite, 1000)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION worker_documents_en_retard(integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION worker_documents_en_retard(integer, integer) TO comtaple_worker;
