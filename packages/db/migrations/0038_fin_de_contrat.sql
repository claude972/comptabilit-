-- FIN DE CONTRAT d'un cabinet (docs/conservation.md, « Fin de contrat »). Migration écrite à la main : elle n'ajoute
-- qu'un REGISTRE, tenu par l'éditeur, des procès-verbaux de fin de contrat. Elle ne supprime et ne modifie aucune donnée,
-- et n'active aucune purge : la procédure (packages/db/src/provisionnement.ts, `finDeContrat`) reste une opération
-- explicite de l'outil de l'éditeur, en SIMULATION par défaut.
--
-- La table n'est volontairement pas décrite dans schema.ts : l'application ne la lit ni ne l'écrit jamais.
CREATE TABLE "fins_de_contrat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"nom_cabinet" text NOT NULL,
	"executee_le" timestamp with time zone DEFAULT now() NOT NULL,
	"politique_version" text NOT NULL,
	"empreinte_restitution" text NOT NULL,
	"empreinte_proces_verbal" text NOT NULL,
	-- JSON canonique du procès-verbal, conservé en TEXTE pour que son empreinte reste recalculable à l'octet près.
	"proces_verbal" text NOT NULL,
	CONSTRAINT "fins_de_contrat_empreintes" CHECK ("empreinte_restitution" ~ '^[0-9a-f]{64}$' AND "empreinte_proces_verbal" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "fins_de_contrat" ADD CONSTRAINT "fins_de_contrat_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Une fin de contrat ne s'exécute qu'une fois par cabinet.
CREATE UNIQUE INDEX "fins_de_contrat_cabinet" ON "fins_de_contrat" ("cabinet_id");
--> statement-breakpoint
SELECT securite_appliquer_rls();
--> statement-breakpoint
-- Registre de l'éditeur : aucun droit pour les rôles applicatifs, pas même la lecture. L'exécution d'une fin de contrat
-- se termine par une inscription dans ce registre : un rôle applicatif ne peut donc pas la mener à son terme.
REVOKE ALL ON fins_de_contrat FROM PUBLIC, comtaple_app, comtaple_worker;
--> statement-breakpoint
-- Ajout seul, y compris pour le propriétaire.
CREATE FUNCTION fins_de_contrat_immuable() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'fins_de_contrat est en ajout seul (% interdit)', TG_OP; END $$;
--> statement-breakpoint
CREATE TRIGGER fins_de_contrat_pas_de_modification BEFORE UPDATE OR DELETE ON fins_de_contrat
  FOR EACH ROW EXECUTE FUNCTION fins_de_contrat_immuable();
--> statement-breakpoint
CREATE TRIGGER fins_de_contrat_pas_de_troncature BEFORE TRUNCATE ON fins_de_contrat
  FOR EACH STATEMENT EXECUTE FUNCTION fins_de_contrat_immuable();
