ALTER TABLE "abonnements_pousses" ADD COLUMN "confirme_le" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

-- ───────────────────────── Complément écrit à la main ─────────────────────────
-- Cycle de vie des abonnements aux notifications poussées :
--  1. un envoi dont le destinataire n'est plus membre actif est clos « destinataire_inactif » (jamais émis) ;
--  2. l'enregistrement d'un abonnement note la confirmation par l'appareil (`confirme_le`) ;
--  3. la désactivation d'un membre, ou la fin d'un accès temporaire, RETIRE ses abonnements pour CE cabinet dans la
--     même transaction, et le journalise (sans point d'accès ni clé) ; à la réactivation, rien n'est recréé ;
--  4. le worker retire les abonnements dont l'appartenance a expiré d'elle-même, et ceux restés inactifs trop longtemps.
ALTER TABLE envois_pousses DROP CONSTRAINT envois_pousses_formes;
--> statement-breakpoint
ALTER TABLE envois_pousses ADD CONSTRAINT envois_pousses_formes CHECK (
  type ~ '^[a-z_]+(\.[a-z_]+)*$' AND nombre >= 1
  AND (issue IS NULL OR issue IN ('distribue', 'sans_abonnement', 'preference_desactivee', 'destinataire_inactif', 'perime'))
  AND ((traite_le IS NULL) = (issue IS NULL)));
--> statement-breakpoint
-- `confirme_le` n'est écrit que par la fonction d'enregistrement (les rôles applicatifs n'ont pas UPDATE sur la table).
CREATE OR REPLACE FUNCTION abonnement_pousse_enregistrer(p_empreinte text, p_service text, p_secrets text, p_agent text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE
  v_id uuid;
BEGIN
  IF app_cabinet_id() IS NULL OR app_utilisateur_id() IS NULL THEN RAISE EXCEPTION 'abonnement_pousse : contexte absent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM appartenances a WHERE a.cabinet_id = app_cabinet_id() AND a.utilisateur_id = app_utilisateur_id() AND a.actif AND (a.expire_le IS NULL OR a.expire_le > now())) THEN
    RAISE EXCEPTION 'abonnement_pousse : membre inactif';
  END IF;
  DELETE FROM abonnements_pousses WHERE empreinte_point_acces = p_empreinte AND utilisateur_id <> app_utilisateur_id();
  IF (SELECT count(*) FROM abonnements_pousses WHERE cabinet_id = app_cabinet_id() AND utilisateur_id = app_utilisateur_id() AND empreinte_point_acces <> p_empreinte) >= 10 THEN
    RAISE EXCEPTION 'abonnement_pousse : trop d''appareils' USING ERRCODE = 'P0001', HINT = 'trop_d_appareils';
  END IF;
  INSERT INTO abonnements_pousses (cabinet_id, utilisateur_id, empreinte_point_acces, service, secrets_chiffres, agent)
  VALUES (app_cabinet_id(), app_utilisateur_id(), p_empreinte, p_service, p_secrets, p_agent)
  ON CONFLICT (cabinet_id, utilisateur_id, empreinte_point_acces)
  DO UPDATE SET service = EXCLUDED.service, secrets_chiffres = EXCLUDED.secrets_chiffres, agent = EXCLUDED.agent, echecs = 0, dernier_echec_le = NULL, confirme_le = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
--> statement-breakpoint

-- Désactivation d'un membre ou fin d'un accès temporaire : quel que soit le chemin (API, outil de l'éditeur), ses
-- abonnements pour CE cabinet sont retirés dans la transaction qui ferme l'accès. Le déclencheur ne se déclenche que
-- sur le passage « actif » → « inactif » ; une réactivation ne recrée rien (la personne réactive son appareil elle-même).
CREATE FUNCTION appartenances_retirer_abonnements_pousses() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE
  a record;
  v_motif text := CASE WHEN NOT NEW.actif THEN 'membre_desactive' ELSE 'acces_expire' END;
BEGIN
  FOR a IN DELETE FROM abonnements_pousses WHERE cabinet_id = NEW.cabinet_id AND utilisateur_id = NEW.utilisateur_id RETURNING id, service LOOP
    INSERT INTO journal_audit (cabinet_id, acteur_id, acteur_type, action, cible_type, cible_id, details)
    VALUES (NEW.cabinet_id, app_utilisateur_id(), CASE WHEN app_utilisateur_id() IS NULL THEN 'systeme' ELSE 'utilisateur' END,
            'notification_poussee.appareil_retire', 'abonnement_pousse', a.id::text,
            jsonb_build_object('service', a.service, 'par', 'systeme', 'motif', v_motif, 'membre', NEW.utilisateur_id));
  END LOOP;
  -- Les envois encore en attente pour cette personne ne seront jamais émis.
  UPDATE envois_pousses SET traite_le = now(), issue = 'destinataire_inactif', appareils = 0
   WHERE cabinet_id = NEW.cabinet_id AND destinataire_id = NEW.utilisateur_id AND traite_le IS NULL;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION appartenances_retirer_abonnements_pousses() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER appartenances_fin_acces_poussees AFTER UPDATE OF actif, expire_le ON appartenances FOR EACH ROW
  WHEN ((OLD.actif AND (OLD.expire_le IS NULL OR OLD.expire_le > now())) AND NOT (NEW.actif AND (NEW.expire_le IS NULL OR NEW.expire_le > now())))
  EXECUTE FUNCTION appartenances_retirer_abonnements_pousses();
--> statement-breakpoint

-- Entretien par le worker (périodique), tous cabinets confondus :
--  - « appartenance_inactive » : la personne n'est plus membre actif du cabinet (accès temporaire arrivé à son terme sans
--    qu'aucune écriture n'ait eu lieu, ou appartenance supprimée) ;
--  - « inactivite » : ni confirmation par l'appareil, ni envoi accepté par le service depuis p_inactivite_jours jours
--    (plancher : 30 jours, pour qu'une valeur erronée ne vide pas la table).
-- Chaque retrait est journalisé dans le cabinet concerné, sans point d'accès ni clé.
CREATE FUNCTION worker_abonnements_pousses_entretenir(p_inactivite_jours integer DEFAULT 180)
RETURNS TABLE (motif text, retires integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE
  a record;
  n_appartenance integer := 0;
  n_inactivite integer := 0;
BEGIN
  FOR a IN
    DELETE FROM abonnements_pousses p
     WHERE NOT EXISTS (SELECT 1 FROM appartenances m WHERE m.cabinet_id = p.cabinet_id AND m.utilisateur_id = p.utilisateur_id AND m.actif AND (m.expire_le IS NULL OR m.expire_le > now()))
    RETURNING p.id, p.cabinet_id, p.utilisateur_id, p.service
  LOOP
    INSERT INTO journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id, details)
    VALUES (a.cabinet_id, 'systeme', 'notification_poussee.appareil_retire', 'abonnement_pousse', a.id::text,
            jsonb_build_object('service', a.service, 'par', 'systeme', 'motif', 'appartenance_inactive', 'membre', a.utilisateur_id));
    n_appartenance := n_appartenance + 1;
  END LOOP;
  FOR a IN
    DELETE FROM abonnements_pousses p
     WHERE greatest(p.cree_le, p.confirme_le, coalesce(p.dernier_succes_le, p.cree_le)) < now() - make_interval(days => greatest(p_inactivite_jours, 30))
    RETURNING p.id, p.cabinet_id, p.utilisateur_id, p.service
  LOOP
    INSERT INTO journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id, details)
    VALUES (a.cabinet_id, 'systeme', 'notification_poussee.appareil_retire', 'abonnement_pousse', a.id::text,
            jsonb_build_object('service', a.service, 'par', 'systeme', 'motif', 'inactivite', 'jours', greatest(p_inactivite_jours, 30), 'membre', a.utilisateur_id));
    n_inactivite := n_inactivite + 1;
  END LOOP;
  RETURN QUERY VALUES ('appartenance_inactive', n_appartenance), ('inactivite', n_inactivite);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION worker_abonnements_pousses_entretenir(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION worker_abonnements_pousses_entretenir(integer) TO comtaple_worker;
