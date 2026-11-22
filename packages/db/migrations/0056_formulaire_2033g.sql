-- D-117 : le tableau 2033-G (filiales et participations) est servi par saisie ligne par ligne. Additive : seule la contrainte de forme du nom de
-- tableau (2033G_NB, 2033G_FIL) s'élargit ; les lignes NB et 01 à 07 existent déjà ; aucune donnée n'est touchée.
ALTER TABLE saisies_tableaux DROP CONSTRAINT saisies_tableaux_tableau;
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_tableau CHECK (tableau IN ('2033C_III', '2054BIS_A', '2054BIS_B', '2055_B', '2055_C', '2033D_C', '2033F_NB', '2033F_PM', '2033F_PP', '2033G_NB', '2033G_FIL'));
