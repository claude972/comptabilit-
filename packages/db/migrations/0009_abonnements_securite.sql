-- Isolation des tables d'abonnement par cabinet ; lecture réservée aux gestionnaires côté serveur interactif.
SELECT securite_appliquer_rls();
--> statement-breakpoint
CREATE POLICY gestionnaire_abonnement ON abonnements AS RESTRICTIVE FOR SELECT TO comtaple_app USING (app_est_gestionnaire());
--> statement-breakpoint
CREATE POLICY gestionnaire_echeances ON echeances_abonnement AS RESTRICTIVE FOR ALL TO comtaple_app USING (app_est_gestionnaire()) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY gestionnaire_evenements ON evenements_facturation AS RESTRICTIVE FOR SELECT TO comtaple_app USING (app_est_gestionnaire());
--> statement-breakpoint
-- La grille tarifaire et les échéances sont produites par l'éditeur (provisionnement) : jamais écrites par l'application.
REVOKE INSERT, UPDATE, DELETE ON offres_abonnement FROM comtaple_app, comtaple_worker;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON echeances_abonnement FROM comtaple_app, comtaple_worker;
--> statement-breakpoint
REVOKE INSERT, DELETE ON abonnements FROM comtaple_app, comtaple_worker;
--> statement-breakpoint
-- Situation de l'abonnement du cabinet courant, lisible par tout membre (pour savoir si la collecte est ouverte),
-- sans exposer ni l'offre ni les montants aux non-gestionnaires.
CREATE FUNCTION abonnement_situation()
RETURNS TABLE (statut text, debut date, fin_essai date, fin date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT a.statut, a.debut, a.fin_essai, a.fin FROM abonnements a WHERE a.cabinet_id = app_cabinet_id() $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION abonnement_situation() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION abonnement_situation() TO comtaple_app, comtaple_worker;
--> statement-breakpoint
-- Demande de changement d'offre ou de résiliation : réservée aux gestionnaires.
CREATE POLICY gestionnaire_abonnement_maj ON abonnements AS RESTRICTIVE FOR UPDATE TO comtaple_app USING (app_est_gestionnaire()) WITH CHECK (app_est_gestionnaire());
--> statement-breakpoint
-- Consommation du cabinet courant pour les quotas. Un gestionnaire ne voit pas le contenu des dossiers où il n'est pas
-- habilité : cette fonction ne renvoie que des DÉCOMPTES, et seulement à un gestionnaire.
CREATE FUNCTION abonnement_usage()
RETURNS TABLE (dossiers_actifs integer, pieces_mois integer, octets_stockes bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT
    (SELECT count(*)::int FROM entites e WHERE e.cabinet_id = app_cabinet_id() AND e.actif),
    (SELECT count(*)::int FROM documents d WHERE d.cabinet_id = app_cabinet_id() AND d.cree_le >= date_trunc('month', now())),
    (SELECT coalesce(sum(f.taille), 0)::bigint FROM fichiers f WHERE f.cabinet_id = app_cabinet_id())
  WHERE app_est_gestionnaire()
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION abonnement_usage() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION abonnement_usage() TO comtaple_app;
