ALTER TABLE "immobilisations" ADD COLUMN "date_acquisition" date;--> statement-breakpoint
-- Point de départ du dégressif : premier jour du mois d'acquisition (BOFiP BOI-BIC-AMT-20-20-30). L'obligation de la saisir en mode dégressif est contrôlée par l'API et le moteur (les lignes antérieures à cette migration n'en ont pas : le moteur s'abstient).
ALTER TABLE immobilisations ADD CONSTRAINT immobilisations_date_acquisition CHECK (date_acquisition IS NULL OR date_acquisition <= date_mise_en_service);
