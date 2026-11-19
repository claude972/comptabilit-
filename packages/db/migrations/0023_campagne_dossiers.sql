-- Nombre de DOSSIERS distincts d'une campagne (et non de lots : un dossier peut avoir plusieurs tentatives).
CREATE FUNCTION campagne_nb_dossiers(p_campagne uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT count(DISTINCT l.entite_id)::int FROM lots_import l WHERE l.campagne_id = p_campagne AND l.cabinet_id = app_cabinet_id() $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION campagne_nb_dossiers(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION campagne_nb_dossiers(uuid) TO comtaple_app;
