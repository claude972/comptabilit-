-- D-133 : les feuillets du régime réel normal (déficits transférés de plein droit, case K4 bis du 2058-B ; détails des réintégrations et déductions diverses du 2058-A) sont
-- servis par saisie ligne par ligne. Additive : seule la contrainte de forme du nom de tableau s'élargit ; aucune donnée n'est touchée.
ALTER TABLE saisies_tableaux DROP CONSTRAINT saisies_tableaux_tableau;
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_tableau CHECK (tableau IN ('2033C_III', '2054BIS_A', '2054BIS_B', '2055_B', '2055_C', '2033D_C', '2033F_NB', '2033F_PM', '2033F_PP', '2033G_NB', '2033G_FIL', '2059A_IM', '2059A_AUT', '2059B_A', '2059B_B', '2059C_I', '2059C_II', '2059D_I', '2059D_II', '2065_C1', '2065_C2', '2065_C3', '2065_C4', '2065_F', '2065_I', '2065_D', '2065_E', '2033E_DATES', '2057_A', '2057_AX', '2057_B', '2057_BX', '2065B_G', '2065B_H', '2065B_I', '2065B_J1', '2065B_J2', '2065B_K', '2033D_982', '2058B_K4BIS', '2058A_REINT', '2058A_DEDUC'));
