-- Indicateurs d'activité du cabinet et du logiciel sur une période.
-- Un gestionnaire n'a pas accès au contenu de tous les dossiers (RLS) : cette fonction ne renvoie que des DÉCOMPTES et
-- des durées agrégés, par cabinet et par dossier — jamais par personne (l'évaluation individuelle des salariés est
-- hors périmètre et exigerait une analyse spécifique).
CREATE FUNCTION cabinet_indicateurs(p_du date, p_au date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS
$$
DECLARE
  c uuid := app_cabinet_id();
  fin timestamptz := (p_au + 1)::timestamptz;
  deb timestamptz := p_du::timestamptz;
BEGIN
  IF NOT app_est_gestionnaire() THEN RAISE EXCEPTION 'réservé aux gestionnaires du cabinet'; END IF;
  RETURN jsonb_build_object(
    'pieces', jsonb_build_object(
      'recues', (SELECT count(*) FROM documents d WHERE d.cabinet_id = c AND d.cree_le >= deb AND d.cree_le < fin),
      'parStatut', (SELECT coalesce(jsonb_object_agg(statut, n), '{}') FROM (SELECT d.statut::text, count(*) n FROM documents d WHERE d.cabinet_id = c AND d.cree_le >= deb AND d.cree_le < fin GROUP BY 1) x),
      'receptionsParCanal', (SELECT coalesce(jsonb_object_agg(canal, n), '{}') FROM (SELECT r.canal::text, count(*) n FROM receptions r WHERE r.cabinet_id = c AND r.recu_le >= deb AND r.recu_le < fin GROUP BY 1) x),
      'doublonsBinaires', (SELECT count(*) FROM receptions r WHERE r.cabinet_id = c AND r.doublon_binaire AND r.recu_le >= deb AND r.recu_le < fin),
      -- Délai entre la réception et la dernière mise à jour des pièces traitées : approximation du délai de traitement.
      'delaiTraitementMedianHeures', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (d.maj_le - d.cree_le))) / 3600)::numeric, 2)
                                      FROM documents d WHERE d.cabinet_id = c AND d.statut = 'traite' AND d.cree_le >= deb AND d.cree_le < fin)
    ),
    'extractions', jsonb_build_object(
      'parMethode', (SELECT coalesce(jsonb_object_agg(methode, n), '{}') FROM (SELECT e.methode, count(*) n FROM extractions e WHERE e.cabinet_id = c AND e.actuelle AND e.cree_le >= deb AND e.cree_le < fin GROUP BY 1) x),
      -- Devenir des extractions automatiques : acceptée telle quelle, corrigée avant validation, rejetée, non examinée.
      'accepteesSansCorrection', (SELECT count(*) FROM extractions e WHERE e.cabinet_id = c AND e.actuelle AND e.statut = 'valide' AND e.methode <> 'saisie_humaine' AND e.cree_le >= deb AND e.cree_le < fin),
      'corrigeesPuisValidees', (SELECT count(*) FROM extractions e WHERE e.cabinet_id = c AND e.actuelle AND e.statut = 'valide' AND e.methode = 'saisie_humaine' AND e.cree_le >= deb AND e.cree_le < fin),
      'rejetees', (SELECT count(*) FROM extractions e WHERE e.cabinet_id = c AND e.actuelle AND e.statut = 'rejete' AND e.cree_le >= deb AND e.cree_le < fin),
      'nonExaminees', (SELECT count(*) FROM extractions e WHERE e.cabinet_id = c AND e.actuelle AND e.statut = 'projet' AND e.cree_le >= deb AND e.cree_le < fin)
    ),
    'imports', jsonb_build_object(
      'parTypeEtStatut', (SELECT coalesce(jsonb_object_agg(cle, n), '{}') FROM (SELECT l.type || ':' || l.statut::text cle, count(*) n FROM lots_import l WHERE l.cabinet_id = c AND l.cree_le >= deb AND l.cree_le < fin GROUP BY 1) x),
      'lignesEcritureImportees', (SELECT coalesce(sum(l.progression), 0) FROM lots_import l WHERE l.cabinet_id = c AND l.type = 'fec' AND l.statut IN ('termine', 'termine_avec_erreurs') AND l.cree_le >= deb AND l.cree_le < fin)
    ),
    'constats', jsonb_build_object(
      'parStatutDeRevue', (SELECT coalesce(jsonb_object_agg(st, n), '{}') FROM (SELECT k.statut_revue::text st, count(*) n FROM constats k JOIN executions_controles e ON e.id = k.execution_id AND NOT e.obsolete WHERE k.cabinet_id = c GROUP BY 1) x),
      'parGravite', (SELECT coalesce(jsonb_object_agg(g, n), '{}') FROM (SELECT k.gravite::text g, count(*) n FROM constats k JOIN executions_controles e ON e.id = k.execution_id AND NOT e.obsolete WHERE k.cabinet_id = c GROUP BY 1) x),
      'parControle', (SELECT coalesce(jsonb_object_agg(controle_id, n), '{}') FROM (SELECT k.controle_id, count(*) n FROM constats k JOIN executions_controles e ON e.id = k.execution_id AND NOT e.obsolete WHERE k.cabinet_id = c GROUP BY 1) x),
      'aRevoir', (SELECT count(*) FROM constats k WHERE k.cabinet_id = c AND k.a_revoir)
    ),
    'controles', jsonb_build_object(
      'parStatut', (SELECT coalesce(jsonb_object_agg(st, n), '{}') FROM (SELECT r.statut::text st, count(*) n FROM resultats_controles r JOIN executions_controles e ON e.id = r.execution_id AND NOT e.obsolete WHERE r.cabinet_id = c GROUP BY 1) x)
    ),
    'rapprochements', jsonb_build_object(
      'parStatut', (SELECT coalesce(jsonb_object_agg(st, n), '{}') FROM (SELECT r.statut st, count(*) n FROM rapprochements r JOIN executions_rapprochement e ON e.id = r.execution_id AND NOT e.obsolete WHERE r.cabinet_id = c GROUP BY 1) x)
    ),
    'temps', jsonb_build_object(
      -- Temps OBSERVÉS saisis sur les travaux, par prestation ; aucune estimation n'est mêlée à ces totaux.
      'observeMinutesParPrestation', (SELECT coalesce(jsonb_object_agg(prestation, m), '{}') FROM (SELECT t.prestation, sum(t.temps_observe_minutes) m FROM travaux t WHERE t.cabinet_id = c AND t.temps_observe_minutes IS NOT NULL AND t.date_travail BETWEEN p_du AND p_au GROUP BY 1) x),
      'travauxSansTempsSaisi', (SELECT count(*) FROM travaux t WHERE t.cabinet_id = c AND t.temps_observe_minutes IS NULL AND t.date_travail BETWEEN p_du AND p_au)
    ),
    'parDossier', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'entiteId', e.id, 'raisonSociale', e.raison_sociale,
        'pieces', (SELECT count(*) FROM documents d WHERE d.entite_id = e.id AND d.cree_le >= deb AND d.cree_le < fin),
        'piecesAControler', (SELECT count(*) FROM documents d WHERE d.entite_id = e.id AND d.statut = 'a_controler'),
        'constatsOuverts', (SELECT count(*) FROM constats k JOIN executions_controles x ON x.id = k.execution_id AND NOT x.obsolete WHERE k.entite_id = e.id AND k.statut_revue IN ('a_examiner', 'en_cours', 'piece_demandee')),
        'tempsObserveMinutes', (SELECT coalesce(sum(t.temps_observe_minutes), 0) FROM travaux t WHERE t.entite_id = e.id AND t.date_travail BETWEEN p_du AND p_au)
      ) ORDER BY e.raison_sociale), '[]') FROM entites e WHERE e.cabinet_id = c AND e.actif)
  );
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION cabinet_indicateurs(date, date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION cabinet_indicateurs(date, date) TO comtaple_app;
