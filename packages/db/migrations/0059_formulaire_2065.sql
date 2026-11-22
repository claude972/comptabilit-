-- D-123 : la déclaration de résultats 2065-SD (page 1 : cadres C, D, E, F, I) est servie par saisie rubrique par rubrique. Additive : seule la contrainte
-- de forme du nom de tableau s'élargit (2065_C1, 2065_C2, 2065_C3, 2065_C4, 2065_F, 2065_I, 2065_D, 2065_E) ; aucune donnée n'est touchée.
ALTER TABLE saisies_tableaux DROP CONSTRAINT saisies_tableaux_tableau;
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_tableau CHECK (tableau IN ('2033C_III', '2054BIS_A', '2054BIS_B', '2055_B', '2055_C', '2033D_C', '2033F_NB', '2033F_PM', '2033F_PP', '2033G_NB', '2033G_FIL', '2059A_IM', '2059A_AUT', '2059B_A', '2059B_B', '2059C_I', '2059C_II', '2059D_I', '2059D_II', '2065_C1', '2065_C2', '2065_C3', '2065_C4', '2065_F', '2065_I', '2065_D', '2065_E'));
