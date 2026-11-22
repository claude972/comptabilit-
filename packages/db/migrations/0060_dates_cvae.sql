-- D-126 : les dates du 2033-E / 2059-E (période de référence, cases 024 et 016 ; date de cessation) sont servies par saisie ligne par ligne. Additive : seule
-- la contrainte de forme du nom de tableau s'élargit (2033E_DATES) ; aucune donnée n'est touchée.
ALTER TABLE saisies_tableaux DROP CONSTRAINT saisies_tableaux_tableau;
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_tableau CHECK (tableau IN ('2033C_III', '2054BIS_A', '2054BIS_B', '2055_B', '2055_C', '2033D_C', '2033F_NB', '2033F_PM', '2033F_PP', '2033G_NB', '2033G_FIL', '2059A_IM', '2059A_AUT', '2059B_A', '2059B_B', '2059C_I', '2059C_II', '2059D_I', '2059D_II', '2065_C1', '2065_C2', '2065_C3', '2065_C4', '2065_F', '2065_I', '2065_D', '2065_E', '2033E_DATES'));
