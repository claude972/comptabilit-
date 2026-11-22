-- D-113 : le tableau 2055 (cadres B et C) est servi par saisie ligne par ligne comme le 2054 bis (D-112). Additive : seules deux contraintes de
-- forme s'élargissent (tableaux 2055_B et 2055_C, lignes 01 à 13) ; aucune donnée n'est touchée.
ALTER TABLE saisies_tableaux DROP CONSTRAINT saisies_tableaux_tableau;
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_tableau CHECK (tableau IN ('2033C_III', '2054BIS_A', '2054BIS_B', '2055_B', '2055_C'));
--> statement-breakpoint
ALTER TABLE saisies_tableaux DROP CONSTRAINT saisies_tableaux_ligne;
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_ligne CHECK (ligne ~ '^(0[1-9]|1[0-3]|REG|PV19|NEANT|B1|B2)$');
