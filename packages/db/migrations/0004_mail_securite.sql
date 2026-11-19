-- Sécurité de la collecte par mail.
-- 1) RLS activé et forcé + politique par cabinet sur les nouvelles tables.
SELECT securite_appliquer_rls();
--> statement-breakpoint

-- 2) Côté serveur interactif, les connexions de messagerie et leurs données ne sont accessibles qu'aux gestionnaires
--    du cabinet (administrateur, associé). Le worker reste borné au cabinet de la tâche traitée.
CREATE POLICY gestion_mail ON connexions_mail AS RESTRICTIVE FOR ALL TO comtaple_app
  USING (app_est_gestionnaire()) WITH CHECK (app_est_gestionnaire());
--> statement-breakpoint
CREATE POLICY gestion_mail ON demandes_connexion_mail AS RESTRICTIVE FOR ALL TO comtaple_app
  USING (app_est_gestionnaire() AND utilisateur_id = app_utilisateur_id())
  WITH CHECK (app_est_gestionnaire() AND utilisateur_id = app_utilisateur_id());
--> statement-breakpoint
CREATE POLICY gestion_mail ON pieces_a_qualifier AS RESTRICTIVE FOR ALL TO comtaple_app
  USING (app_est_gestionnaire()) WITH CHECK (app_est_gestionnaire());
--> statement-breakpoint
CREATE POLICY gestion_mail ON signalements_mail AS RESTRICTIVE FOR ALL TO comtaple_app
  USING (app_est_gestionnaire()) WITH CHECK (app_est_gestionnaire());
--> statement-breakpoint
CREATE POLICY gestion_mail ON pieces_mail_vues AS RESTRICTIVE FOR ALL TO comtaple_app
  USING (app_est_gestionnaire()) WITH CHECK (app_est_gestionnaire());
--> statement-breakpoint
CREATE POLICY gestion_mail ON messages_mail AS RESTRICTIVE FOR ALL TO comtaple_app
  USING (app_est_gestionnaire()) WITH CHECK (app_est_gestionnaire());
--> statement-breakpoint

-- 3) Fonctions étroites (droits du rôle de migration, voir D-007) : elles ne renvoient QUE des identifiants techniques.
--    Les statuts sont comparés en texte : les valeurs d'énumération ajoutées par la migration précédente ne sont pas
--    utilisables comme littéraux typés dans la même transaction.

-- Notification Pub/Sub (Gmail) : retrouver les connexions actives d'une boîte, pour mettre une synchronisation en file.
CREATE FUNCTION mail_connexions_par_adresse(p_fournisseur text, p_adresse text)
RETURNS TABLE (cabinet_id uuid, connexion_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT c.cabinet_id, c.id FROM connexions_mail c
  WHERE c.fournisseur::text = p_fournisseur AND lower(c.adresse) = lower(p_adresse) AND c.statut::text = 'active'
  LIMIT 200
$$;
--> statement-breakpoint
-- Notification Graph : retrouver la connexion qui détient un abonnement, avec son enveloppe de jetons CHIFFRÉE
-- (le serveur la déchiffre pour comparer le secret clientState ; l'identifiant d'abonnement n'est pas devinable).
CREATE FUNCTION mail_connexions_par_abonnement(p_abonnement text)
RETURNS TABLE (cabinet_id uuid, connexion_id uuid, jetons_chiffres text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT c.cabinet_id, c.id, c.jetons_chiffres FROM connexions_mail c
  WHERE c.statut::text = 'active' AND c.jetons_chiffres IS NOT NULL
    AND c.etat -> 'surveillance' -> 'abonnements' @> jsonb_build_array(jsonb_build_object('id', p_abonnement))
  LIMIT 10
$$;
--> statement-breakpoint
-- Tâches planifiées du worker : connexions actives à synchroniser et à entretenir.
CREATE FUNCTION worker_connexions_mail_actives(p_limite integer DEFAULT 5000)
RETURNS TABLE (cabinet_id uuid, connexion_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT c.cabinet_id, c.id FROM connexions_mail c
  WHERE c.statut::text = 'active' AND c.jetons_chiffres IS NOT NULL
  ORDER BY c.derniere_synchro NULLS FIRST
  LIMIT least(p_limite, 20000)
$$;
--> statement-breakpoint
-- État des intégrations : preuves de connexion du cabinet courant (aucun jeton, aucune adresse).
CREATE FUNCTION mail_preuves_integration()
RETURNS TABLE (fournisseur text, preuve jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT c.fournisseur::text, c.preuve FROM connexions_mail c
  WHERE c.cabinet_id = app_cabinet_id() AND c.preuve IS NOT NULL AND c.statut::text = 'active'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION mail_connexions_par_adresse(text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION mail_connexions_par_abonnement(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION worker_connexions_mail_actives(integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION mail_preuves_integration() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION mail_connexions_par_adresse(text, text) TO comtaple_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION mail_connexions_par_abonnement(text) TO comtaple_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION worker_connexions_mail_actives(integer) TO comtaple_worker;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION mail_preuves_integration() TO comtaple_app;
