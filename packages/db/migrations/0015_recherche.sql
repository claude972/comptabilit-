-- Recherche documentaire textuelle (PostgreSQL, configuration française) : index d'expression sur le texte des pages
-- de pièces et sur les libellés d'écritures. La recherche s'exécute avec le rôle applicatif : les politiques RLS
-- (cabinet et dossier) s'appliquent AVANT tout résultat.
CREATE INDEX pages_document_recherche ON pages_document USING gin (to_tsvector('french', coalesce(texte, '')));
--> statement-breakpoint
CREATE INDEX lignes_ecriture_recherche ON lignes_ecriture USING gin (to_tsvector('french', ecriture_lib || ' ' || piece_ref || ' ' || compte_lib || ' ' || coalesce(comp_aux_lib, '')));
