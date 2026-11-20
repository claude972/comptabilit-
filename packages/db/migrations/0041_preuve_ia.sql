CREATE TABLE "verifications_connexion_ia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"verifiee_le" timestamp with time zone DEFAULT now() NOT NULL,
	"resultat" text NOT NULL,
	"raisons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"url_base" text NOT NULL,
	"hote" text NOT NULL,
	"urls_appelees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"modele_langage" text,
	"modele_embeddings" text,
	"dimensions_embeddings" integer,
	"reponse_simulateur" boolean DEFAULT false NOT NULL,
	"empreinte_configuration" text NOT NULL,
	"valide_jusqu_au" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "verifications_connexion_ia_courante" ON "verifications_connexion_ia" USING btree ("empreinte_configuration","verifiee_le");--> statement-breakpoint

-- ───────────────────────── Complément écrit à la main ─────────────────────────
-- Vérifications de connexion de la passerelle IA. Table de l'ÉDITEUR, sans cabinet_id (la passerelle est un service
-- commun) : pas de politique par cabinet. Droits minimaux : l'API et le worker LISENT ; aucune écriture ne leur est
-- possible — seule l'opération de vérification de l'éditeur (rôle propriétaire, `scripts/editeur.mjs ia-verifier`)
-- ajoute une ligne. Une ligne ne contient ni prompt ni réponse.
REVOKE ALL ON verifications_connexion_ia FROM comtaple_app, comtaple_worker;
--> statement-breakpoint
GRANT SELECT ON verifications_connexion_ia TO comtaple_app, comtaple_worker;
--> statement-breakpoint
-- Formes : résultat dans une liste fermée, empreinte SHA-256, validité bornée à 90 jours, et une ligne « connecte »
-- porte obligatoirement des modèles, une dimension, au moins une adresse appelée, en https, et n'est jamais une réponse
-- de simulateur. Ces contraintes ne remplacent pas la réévaluation faite à CHAQUE lecture par l'application (hôte
-- officiel, modèles figés, empreinte de la configuration courante, péremption) : elles évitent les lignes absurdes.
ALTER TABLE verifications_connexion_ia ADD CONSTRAINT verifications_connexion_ia_formes CHECK (
  resultat IN ('connecte', 'refusee', 'echec')
  AND empreinte_configuration ~ '^[0-9a-f]{64}$'
  AND length(url_base) BETWEEN 1 AND 500 AND length(hote) BETWEEN 1 AND 255
  AND jsonb_typeof(raisons) = 'array' AND jsonb_typeof(urls_appelees) = 'array'
  AND valide_jusqu_au > verifiee_le AND valide_jusqu_au <= verifiee_le + interval '90 days'
  AND (resultat <> 'connecte' OR (
    NOT reponse_simulateur AND modele_langage IS NOT NULL AND modele_embeddings IS NOT NULL AND dimensions_embeddings IS NOT NULL AND dimensions_embeddings > 0
    AND jsonb_array_length(urls_appelees) > 0 AND url_base ~ '^https://')));
--> statement-breakpoint
-- Ajout seul : une vérification ne se corrige pas, elle se refait. (Le rôle propriétaire peut supprimer une ligne —
-- c'est ainsi que les tests nettoient les leurs ; aucune modification n'est possible, pour personne.)
CREATE FUNCTION verifications_connexion_ia_immuable() RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
  RAISE EXCEPTION 'verifications_connexion_ia : ajout seul (une vérification se refait, elle ne se modifie pas)';
END $$;
--> statement-breakpoint
CREATE TRIGGER verifications_connexion_ia_sans_modification BEFORE UPDATE ON verifications_connexion_ia FOR EACH ROW EXECUTE FUNCTION verifications_connexion_ia_immuable();
