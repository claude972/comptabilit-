-- D-116 : le tableau 2033-F (composition du capital social) est servi par saisie ligne par ligne. Additive : seules les contraintes de forme du nom de
-- tableau (2033F_NB, 2033F_PM, 2033F_PP) et du numéro de ligne (NB : cases 901 à 904) s'élargissent ; aucune donnée n'est touchée.
ALTER TABLE saisies_tableaux DROP CONSTRAINT saisies_tableaux_tableau;
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_tableau CHECK (tableau IN ('2033C_III', '2054BIS_A', '2054BIS_B', '2055_B', '2055_C', '2033D_C', '2033F_NB', '2033F_PM', '2033F_PP'));
--> statement-breakpoint
ALTER TABLE saisies_tableaux DROP CONSTRAINT saisies_tableaux_ligne;
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_ligne CHECK (ligne ~ '^(0[1-9]|1[0-3]|REG|PV19|NEANT|B1|B2|NB)$');
