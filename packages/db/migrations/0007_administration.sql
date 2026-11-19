-- Membres habilités d'un dossier : visibles par toute personne habilitée en lecture (pour affecter un constat) et par
-- les gestionnaires. La politique RLS de `habilitations_dossier` ne montre à chacun que SA ligne ; cette fonction
-- étroite renvoie seulement identité et niveau, après vérification de l'habilitation de l'appelant.
CREATE FUNCTION dossier_membres(p_entite uuid)
RETURNS TABLE (utilisateur_id uuid, nom text, email text, niveau niveau_habilitation, role role_cabinet)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT u.id, u.nom, u.email, h.niveau, a.role
  FROM habilitations_dossier h
  JOIN utilisateurs u ON u.id = h.utilisateur_id
  JOIN appartenances a ON a.cabinet_id = h.cabinet_id AND a.utilisateur_id = h.utilisateur_id
  WHERE h.entite_id = p_entite
    AND h.cabinet_id = app_cabinet_id()
    AND (app_niveau_entite(p_entite) >= 'lecture' OR app_est_gestionnaire())
  ORDER BY u.nom
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dossier_membres(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dossier_membres(uuid) TO comtaple_app;
--> statement-breakpoint

-- Purge des téléversements abandonnés : le worker ne peut pas énumérer les cabinets ; identifiants seuls.
CREATE FUNCTION worker_televersements_expires(p_limite integer DEFAULT 200)
RETURNS TABLE (cabinet_id uuid, televersement_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT t.cabinet_id, t.id FROM televersements t
  WHERE t.statut = 'ouvert' AND t.expire_le < now()
  ORDER BY t.expire_le LIMIT least(p_limite, 1000)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION worker_televersements_expires(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION worker_televersements_expires(integer) TO comtaple_worker;
