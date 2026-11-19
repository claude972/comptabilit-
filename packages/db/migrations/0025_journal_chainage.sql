CREATE TABLE "anomalies_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"premiere_ligne" bigint NOT NULL,
	"derniere_ligne" bigint NOT NULL,
	"cause" text NOT NULL,
	"consignee_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anomalies_journal" ADD CONSTRAINT "anomalies_journal_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Écrite par le provisionnement (rôle propriétaire) uniquement ; ajout seul.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON anomalies_journal FROM comtaple_app, comtaple_worker;
--> statement-breakpoint
CREATE FUNCTION anomalies_journal_immuable() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'anomalies_journal est en ajout seul (% interdit)', TG_OP; END $$;
--> statement-breakpoint
CREATE TRIGGER anomalies_journal_pas_de_modification BEFORE UPDATE OR DELETE ON anomalies_journal
  FOR EACH ROW EXECUTE FUNCTION anomalies_journal_immuable();
--> statement-breakpoint
CREATE TRIGGER anomalies_journal_pas_de_troncature BEFORE TRUNCATE ON anomalies_journal
  FOR EACH STATEMENT EXECUTE FUNCTION anomalies_journal_immuable();
--> statement-breakpoint

-- CORRECTIF DE CHAÎNAGE. Le numéro de ligne était attribué (valeur par défaut) AVANT la prise du verrou du cabinet :
-- deux écritures simultanées pouvaient être chaînées dans un ordre différent de celui de leurs numéros, et la ligne
-- suivante se rattacher deux fois au même prédécesseur. Le numéro est désormais attribué SOUS le verrou : pour un
-- cabinet, l'ordre des numéros est celui de la chaîne. (Le numéro pris par la valeur par défaut est perdu : des trous
-- dans la numérotation sont normaux et sans signification.)
CREATE OR REPLACE FUNCTION journal_audit_chainer() RETURNS trigger LANGUAGE plpgsql AS
$$
DECLARE
  precedente text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('journal_audit:' || NEW.cabinet_id::text, 0));
  NEW.id := nextval('journal_audit_id_seq');
  SELECT j.empreinte INTO precedente FROM journal_audit j
   WHERE j.cabinet_id = NEW.cabinet_id ORDER BY j.id DESC LIMIT 1;
  NEW.horodatage := clock_timestamp();
  NEW.empreinte_precedente := precedente;
  NEW.empreinte := journal_audit_empreinte(precedente, NEW);
  RETURN NEW;
END $$;
--> statement-breakpoint

-- Vérification tenant compte des anomalies consignées. `journal_audit_verifier` (stricte) reste inchangée.
-- Dans une plage consignée : l'empreinte de chaque ligne est toujours recalculée (le CONTENU reste vérifié) et son
-- prédécesseur déclaré doit exister dans le journal du cabinet ; seul l'ordre n'est pas exigé. Hors plage : chaîne stricte.
CREATE FUNCTION journal_audit_verifier_hors_anomalies(p_cabinet uuid) RETURNS bigint LANGUAGE plpgsql STABLE AS
$$
DECLARE
  l journal_audit;
  precedente text := NULL;
  consignee boolean;
BEGIN
  FOR l IN SELECT * FROM journal_audit WHERE cabinet_id = p_cabinet ORDER BY id LOOP
    IF l.empreinte IS DISTINCT FROM journal_audit_empreinte(l.empreinte_precedente, l) THEN RETURN l.id; END IF;
    consignee := EXISTS (SELECT 1 FROM anomalies_journal a WHERE a.cabinet_id = p_cabinet AND l.id BETWEEN a.premiere_ligne AND a.derniere_ligne);
    IF consignee THEN
      IF l.empreinte_precedente IS NOT NULL AND NOT EXISTS (SELECT 1 FROM journal_audit j WHERE j.cabinet_id = p_cabinet AND j.empreinte = l.empreinte_precedente) THEN RETURN l.id; END IF;
    ELSIF l.empreinte_precedente IS DISTINCT FROM precedente THEN
      RETURN l.id;
    END IF;
    precedente := l.empreinte;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint

-- Diagnostic : lignes dont le prédécesseur déclaré n'est pas la ligne précédente (par numéro), ou dont l'empreinte est fausse.
CREATE FUNCTION journal_audit_ecarts(p_cabinet uuid) RETURNS TABLE (ligne bigint, empreinte_valide boolean, enchainement_valide boolean) LANGUAGE sql STABLE AS
$$
  SELECT x.id, x.empreinte_valide, x.enchainement_valide FROM (
    SELECT j.id,
           j.empreinte IS NOT DISTINCT FROM journal_audit_empreinte(j.empreinte_precedente, j) AS empreinte_valide,
           j.empreinte_precedente IS NOT DISTINCT FROM lag(j.empreinte) OVER (ORDER BY j.id) AS enchainement_valide
    FROM journal_audit j WHERE j.cabinet_id = p_cabinet) x
  WHERE NOT x.empreinte_valide OR NOT x.enchainement_valide ORDER BY x.id
$$;
