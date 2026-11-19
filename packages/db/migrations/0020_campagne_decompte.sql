-- Nombre total de lots d'une campagne du cabinet courant, y compris ceux des dossiers où l'appelant n'est pas
-- habilité : un simple décompte, pour dire « N dossiers hors de votre habilitation » sans rien en révéler.
CREATE FUNCTION campagne_nb_lots(p_campagne uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT count(*)::int FROM lots_import l WHERE l.campagne_id = p_campagne AND l.cabinet_id = app_cabinet_id() $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION campagne_nb_lots(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION campagne_nb_lots(uuid) TO comtaple_app;
