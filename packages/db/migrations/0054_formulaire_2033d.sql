-- D-114 : le cadre C du 2033-D (dotations non déductibles, sept lignes) est servi par saisie ligne par ligne. Additive : seule la contrainte de
-- forme du nom de tableau s'élargit (tableau 2033D_C) ; les lignes 01 à 07 existent déjà ; aucune donnée n'est touchée.
ALTER TABLE saisies_tableaux DROP CONSTRAINT saisies_tableaux_tableau;
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_tableau CHECK (tableau IN ('2033C_III', '2054BIS_A', '2054BIS_B', '2055_B', '2055_C', '2033D_C'));
