-- Quand une règle de cabinet est approuvée ou retirée, les exécutions de contrôles concernées deviennent obsolètes.
-- Le gestionnaire qui décide n'est pas forcément habilité sur chaque dossier (RLS) : fonction étroite qui ne fait que
-- poser l'indicateur « obsolète », dans le cabinet courant, et seulement pour un gestionnaire.
CREATE FUNCTION regles_rendre_obsolete(p_entite uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE n integer;
BEGIN
  IF NOT app_est_gestionnaire() THEN RAISE EXCEPTION 'réservé aux gestionnaires du cabinet'; END IF;
  UPDATE executions_controles SET obsolete = true
   WHERE cabinet_id = app_cabinet_id() AND (p_entite IS NULL OR entite_id = p_entite) AND NOT obsolete;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION regles_rendre_obsolete(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION regles_rendre_obsolete(uuid) TO comtaple_app;
