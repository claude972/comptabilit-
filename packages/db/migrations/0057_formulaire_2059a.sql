-- D-121 : le tableau 2059-A (plus et moins-values, régime réel normal) est servi par saisie ligne par ligne. Additive : seule la contrainte de forme du
-- nom de tableau (2059A_IM, 2059A_AUT) s'élargit ; aucune donnée n'est touchée.
ALTER TABLE saisies_tableaux DROP CONSTRAINT saisies_tableaux_tableau;
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_tableau CHECK (tableau IN ('2033C_III', '2054BIS_A', '2054BIS_B', '2055_B', '2055_C', '2033D_C', '2033F_NB', '2033F_PM', '2033F_PP', '2033G_NB', '2033G_FIL', '2059A_IM', '2059A_AUT'));
--> statement-breakpoint
ALTER TABLE saisies_tableaux DROP CONSTRAINT saisies_tableaux_ligne;
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_ligne CHECK (ligne ~ '^(0[1-9]|1[0-9]|20|REG|PV19|NEANT|B1|B2|NB)$');
