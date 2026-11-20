ALTER TABLE "immobilisations" ADD COLUMN "mode_amortissement" text DEFAULT 'lineaire' NOT NULL;--> statement-breakpoint
ALTER TABLE "immobilisations" ADD COLUMN "coefficient_degressif" numeric(4, 2);--> statement-breakpoint
ALTER TABLE "immobilisations" ADD COLUMN "eligibilite_degressif_confirmee" boolean;--> statement-breakpoint
ALTER TABLE "immobilisations" ADD COLUMN "valeur_residuelle" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "immobilisations" ADD COLUMN "date_sortie" date;--> statement-breakpoint
ALTER TABLE "immobilisations" ADD COLUMN "composant_de" uuid;--> statement-breakpoint
ALTER TABLE "immobilisations" ADD CONSTRAINT "immobilisations_composant_de_immobilisations_id_fk" FOREIGN KEY ("composant_de") REFERENCES "public"."immobilisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE immobilisations ADD CONSTRAINT immobilisations_amortissements_valeurs CHECK (
  mode_amortissement IN ('lineaire', 'degressif')
  AND ((mode_amortissement = 'degressif' AND coefficient_degressif IN (1.25, 1.75, 2.25)) OR (mode_amortissement = 'lineaire' AND coefficient_degressif IS NULL AND eligibilite_degressif_confirmee IS NULL))
  AND (mode_amortissement <> 'degressif' OR (compte_immobilisation ~ '^21[0-9]{1,10}$' AND duree_mois % 12 = 0 AND duree_mois BETWEEN 36 AND 600 AND eligibilite_degressif_confirmee IS NOT NULL))
  AND (valeur_residuelle IS NULL OR (valeur_residuelle >= 0 AND valeur_residuelle < base_amortissable))
  AND (date_sortie IS NULL OR date_sortie >= date_mise_en_service)
  AND (composant_de IS NULL OR composant_de <> id)
);
--> statement-breakpoint
CREATE INDEX "immobilisations_composant" ON "immobilisations" USING btree ("composant_de") WHERE "composant_de" IS NOT NULL;
--> statement-breakpoint
-- Droits : les colonnes ajoutées héritent de ceux de la table (écriture réservée à l'API ; le worker n'écrit pas dans ce fichier).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON immobilisations FROM comtaple_worker;
