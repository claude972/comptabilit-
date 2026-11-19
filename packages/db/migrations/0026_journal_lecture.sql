-- Défense en profondeur (D-038 révisée) : la LECTURE du journal d'audit et des anomalies consignées est réservée, dans la
-- base elle-même, aux gestionnaires du cabinet du contexte. Jusqu'ici seule l'API l'imposait : un contexte portant le
-- bon cabinet mais un utilisateur non membre lisait le journal. L'écriture reste ouverte à tout contexte du cabinet.
--
-- Le chaînage lit la dernière empreinte du cabinet : il ne doit pas dépendre du droit de lecture de l'appelant, sans
-- quoi l'écriture d'un non-gestionnaire (déposant, collaborateur) repartirait d'une chaîne vide. Le déclencheur
-- s'exécute donc avec les droits du propriétaire ; il ne lit que l'empreinte de la dernière ligne du cabinet inséré.
ALTER FUNCTION journal_audit_chainer() SECURITY DEFINER SET search_path = public;
--> statement-breakpoint
CREATE POLICY lecture_gestionnaire ON journal_audit AS RESTRICTIVE FOR SELECT TO comtaple_app USING (app_est_gestionnaire());
--> statement-breakpoint
CREATE POLICY lecture_gestionnaire ON anomalies_journal AS RESTRICTIVE FOR SELECT TO comtaple_app USING (app_est_gestionnaire());
