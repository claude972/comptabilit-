-- D-150 : justification écrite du cabinet pour le dégressif. Additive : une colonne nullable ; les biens existants gardent null (le moteur s'abstient alors, motif explicite) ; une contrainte de forme borne la longueur. Aucune donnée n'est modifiée.
ALTER TABLE immobilisations ADD COLUMN justification_degressif text;
--> statement-breakpoint
ALTER TABLE immobilisations ADD CONSTRAINT immobilisations_justification_degressif CHECK (justification_degressif IS NULL OR (mode_amortissement = 'degressif' AND char_length(btrim(justification_degressif)) BETWEEN 20 AND 1000));
