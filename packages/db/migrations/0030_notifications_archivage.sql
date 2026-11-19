ALTER TABLE "notifications" ADD COLUMN "archivee_le" timestamp with time zone;--> statement-breakpoint
-- Le destinataire peut aussi archiver et désarchiver ses notifications (toujours rien d'autre).
GRANT UPDATE (archivee_le) ON notifications TO comtaple_app;
--> statement-breakpoint
CREATE INDEX notifications_archivage ON notifications (cabinet_id, archivee_le, lue_le);
--> statement-breakpoint

-- POLITIQUE DE RÉTENTION des notifications (docs/conservation.md). Deux temps, du réversible vers l'irréversible :
--   1) ARCHIVAGE (réversible) des notifications LUES depuis plus de p_archiver_apres ;
--   2) SUPPRESSION (irréversible) des notifications ARCHIVÉES depuis plus de p_supprimer_apres.
-- Une notification NON LUE n'est jamais archivée ni supprimée par cette politique.
-- p_simuler (vrai par défaut) : ne modifie RIEN et renvoie ce qui serait fait. Réservée au rôle propriétaire (outil de
-- l'éditeur) : ni l'application ni le worker ne peuvent l'appeler, et aucun traitement ne l'exécute automatiquement.
CREATE FUNCTION notifications_appliquer_retention(
  p_archiver_apres interval DEFAULT interval '30 days',
  p_supprimer_apres interval DEFAULT interval '180 days',
  p_simuler boolean DEFAULT true
) RETURNS TABLE (cabinet_id uuid, a_archiver bigint, a_supprimer bigint, simulation boolean)
LANGUAGE plpgsql AS
$$
BEGIN
  IF p_archiver_apres < interval '1 day' OR p_supprimer_apres < interval '30 days' THEN
    RAISE EXCEPTION 'rétention : durées trop courtes (archivage ≥ 1 jour, suppression ≥ 30 jours après archivage)';
  END IF;
  RETURN QUERY
    SELECT n.cabinet_id,
           count(*) FILTER (WHERE n.archivee_le IS NULL AND n.lue_le IS NOT NULL AND n.lue_le < now() - p_archiver_apres),
           count(*) FILTER (WHERE n.archivee_le IS NOT NULL AND n.archivee_le < now() - p_supprimer_apres),
           p_simuler
      FROM notifications n
     GROUP BY n.cabinet_id
    HAVING count(*) FILTER (WHERE n.archivee_le IS NULL AND n.lue_le IS NOT NULL AND n.lue_le < now() - p_archiver_apres) > 0
        OR count(*) FILTER (WHERE n.archivee_le IS NOT NULL AND n.archivee_le < now() - p_supprimer_apres) > 0;
  IF p_simuler THEN RETURN; END IF;
  -- L'ordre compte : on supprime d'abord ce qui était DÉJÀ archivé depuis assez longtemps, puis on archive. Une
  -- notification archivée par cette exécution n'est donc jamais supprimée par la même exécution.
  DELETE FROM notifications n WHERE n.archivee_le IS NOT NULL AND n.archivee_le < now() - p_supprimer_apres;
  UPDATE notifications n SET archivee_le = now() WHERE n.archivee_le IS NULL AND n.lue_le IS NOT NULL AND n.lue_le < now() - p_archiver_apres;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notifications_appliquer_retention(interval, interval, boolean) FROM PUBLIC, comtaple_app, comtaple_worker;
