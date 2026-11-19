-- Un échange avec l'assistant est un écrit PERSONNEL de son auteur, qui ne modifie aucune donnée du dossier : poser une
-- question exige le niveau « lecture », pas « collaboration ». La politique générale d'écriture par dossier (collaboration)
-- est donc remplacée, pour cette table seulement, par une politique au niveau « lecture ». La politique « ses_echanges »
-- (chacun les siens) reste en place.
DROP POLICY acces_dossier ON echanges_assistant;
--> statement-breakpoint
CREATE POLICY acces_dossier ON echanges_assistant AS RESTRICTIVE FOR ALL TO comtaple_app
  USING (app_niveau_entite(entite_id) >= 'lecture') WITH CHECK (app_niveau_entite(entite_id) >= 'lecture');
