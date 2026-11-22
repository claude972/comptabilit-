-- D-122 : les tableaux 2059-B, 2059-C et 2059-D sont servis par saisie ligne par ligne. Additive : les contraintes de forme du nom de tableau et de
-- la ligne s'élargissent (identifiants de lignes alphanumériques majuscules de 1 à 8 caractères : E3, T10N1, N10, L1, U…) ; la forme de chaque
-- ligne est validée par l'API ; aucune donnée n'est touchée.
ALTER TABLE saisies_tableaux DROP CONSTRAINT saisies_tableaux_tableau;
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_tableau CHECK (tableau IN ('2033C_III', '2054BIS_A', '2054BIS_B', '2055_B', '2055_C', '2033D_C', '2033F_NB', '2033F_PM', '2033F_PP', '2033G_NB', '2033G_FIL', '2059A_IM', '2059A_AUT', '2059B_A', '2059B_B', '2059C_I', '2059C_II', '2059D_I', '2059D_II'));
--> statement-breakpoint
ALTER TABLE saisies_tableaux DROP CONSTRAINT saisies_tableaux_ligne;
--> statement-breakpoint
ALTER TABLE saisies_tableaux ADD CONSTRAINT saisies_tableaux_ligne CHECK (ligne ~ '^[0-9A-Z]{1,8}$');
