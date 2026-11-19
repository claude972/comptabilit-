CREATE TYPE "public"."canal_reception" AS ENUM('telephone', 'ordinateur', 'mail', 'import_lot');--> statement-breakpoint
CREATE TYPE "public"."fournisseur_mail" AS ENUM('microsoft365', 'gmail');--> statement-breakpoint
CREATE TYPE "public"."gravite_constat" AS ENUM('critique', 'elevee', 'moyenne', 'faible');--> statement-breakpoint
CREATE TYPE "public"."nature_document" AS ENUM('facture_achat', 'facture_vente', 'avoir', 'releve_bancaire', 'lettre_mission', 'contrat', 'autre', 'a_qualifier');--> statement-breakpoint
CREATE TYPE "public"."nature_fichier" AS ENUM('original', 'derive');--> statement-breakpoint
CREATE TYPE "public"."niveau_habilitation" AS ENUM('depot', 'lecture', 'collaboration', 'revision', 'validation');--> statement-breakpoint
CREATE TYPE "public"."role_cabinet" AS ENUM('administrateur', 'associe', 'reviseur', 'collaborateur', 'client_deposant', 'client_lecture', 'support');--> statement-breakpoint
CREATE TYPE "public"."statut_connexion" AS ENUM('non_connecte', 'connecte', 'expire', 'revoque', 'erreur');--> statement-breakpoint
CREATE TYPE "public"."statut_controle" AS ENUM('sans_anomalie', 'constat', 'non_applicable', 'non_realise', 'erreur');--> statement-breakpoint
CREATE TYPE "public"."statut_document" AS ENUM('recu', 'en_analyse', 'a_completer', 'a_controler', 'traite', 'quarantaine', 'rejete');--> statement-breakpoint
CREATE TYPE "public"."statut_donnees" AS ENUM('travail_avant_cloture', 'fec');--> statement-breakpoint
CREATE TYPE "public"."statut_lot" AS ENUM('en_attente', 'en_cours', 'termine', 'termine_avec_erreurs', 'echec', 'annule');--> statement-breakpoint
CREATE TYPE "public"."statut_revue" AS ENUM('a_examiner', 'en_cours', 'piece_demandee', 'accepte', 'corrige', 'rejete', 'anomalie_confirmee', 'cloture');--> statement-breakpoint
CREATE TYPE "public"."statut_televersement" AS ENUM('ouvert', 'complet', 'abandonne', 'refuse');--> statement-breakpoint
CREATE TYPE "public"."territoire_fiscal" AS ENUM('metropole', 'guadeloupe', 'martinique', 'guyane', 'reunion', 'mayotte', 'autre', 'a_confirmer');--> statement-breakpoint
CREATE TABLE "abonnements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"offre" text NOT NULL,
	"statut" text NOT NULL,
	"debut" date NOT NULL,
	"fin_essai" date,
	"fin" date,
	"quotas" jsonb NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appartenances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"utilisateur_id" uuid NOT NULL,
	"role" "role_cabinet" NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"expire_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cabinets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" text NOT NULL,
	"siren" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commentaires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"cible_type" text NOT NULL,
	"cible_id" uuid NOT NULL,
	"texte" text NOT NULL,
	"auteur_id" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connexions_mail" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"fournisseur" "fournisseur_mail" NOT NULL,
	"adresse" text NOT NULL,
	"statut" "statut_connexion" DEFAULT 'non_connecte' NOT NULL,
	"scopes_accordes" jsonb,
	"jetons_chiffres" text,
	"filtres" jsonb,
	"date_debut_recuperation" date,
	"curseur" text,
	"derniere_synchro" timestamp with time zone,
	"derniere_erreur" text,
	"cree_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "constats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"exercice_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"resultat_id" uuid NOT NULL,
	"controle_id" text NOT NULL,
	"cle" text NOT NULL,
	"gravite" "gravite_constat" NOT NULL,
	"titre" text NOT NULL,
	"explication" text NOT NULL,
	"action_proposee" text NOT NULL,
	"montant" numeric(18, 2),
	"lignes_concernees" jsonb NOT NULL,
	"preuves" jsonb NOT NULL,
	"statut_revue" "statut_revue" DEFAULT 'a_examiner' NOT NULL,
	"affecte_a" uuid,
	"a_revoir" boolean DEFAULT false NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"cible_type" text NOT NULL,
	"cible_id" uuid NOT NULL,
	"version_cible" integer NOT NULL,
	"action" text NOT NULL,
	"motif" text,
	"auteur_id" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"exercice_id" uuid,
	"fichier_id" uuid NOT NULL,
	"nature" "nature_document" DEFAULT 'a_qualifier' NOT NULL,
	"statut" "statut_document" DEFAULT 'recu' NOT NULL,
	"nom_origine" text NOT NULL,
	"commentaire" text,
	"version" integer DEFAULT 1 NOT NULL,
	"remplace_document_id" uuid,
	"nb_pages" integer,
	"motif_statut" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"maj_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "echanges_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"auteur_id" uuid NOT NULL,
	"resolu" boolean DEFAULT false NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"raison_sociale" text NOT NULL,
	"siren" text,
	"forme_juridique" text,
	"regime_fiscal" text,
	"referentiel_comptable" text DEFAULT 'PCG' NOT NULL,
	"territoire_fiscal" "territoire_fiscal" DEFAULT 'a_confirmer' NOT NULL,
	"code_naf" text,
	"devise" text DEFAULT 'EUR' NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "etablissements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"siret" text,
	"libelle" text NOT NULL,
	"territoire_fiscal" "territoire_fiscal" DEFAULT 'a_confirmer' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evenements_facturation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"abonnement_id" uuid NOT NULL,
	"type" text NOT NULL,
	"montant" numeric(18, 2),
	"detail" jsonb,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions_controles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"exercice_id" uuid NOT NULL,
	"lot_import_id" uuid NOT NULL,
	"version_donnees" integer NOT NULL,
	"statut" "statut_lot" DEFAULT 'en_attente' NOT NULL,
	"obsolete" boolean DEFAULT false NOT NULL,
	"lance_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"termine_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "exercices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"debut" date NOT NULL,
	"fin" date NOT NULL,
	"statut" text DEFAULT 'ouvert' NOT NULL,
	"version_donnees" integer DEFAULT 0 NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"exercice_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"version_donnees" integer NOT NULL,
	"statut" "statut_lot" DEFAULT 'en_attente' NOT NULL,
	"mention" text DEFAULT 'projet' NOT NULL,
	"cle_pdf" text,
	"cle_donnees" text,
	"sha256_pdf" text,
	"sha256_donnees" text,
	"erreur" text,
	"demande_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"termine_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"methode" text NOT NULL,
	"moteur" text,
	"champs" jsonb NOT NULL,
	"verifications" jsonb NOT NULL,
	"statut" text DEFAULT 'projet' NOT NULL,
	"actuelle" boolean DEFAULT true NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"document_id" uuid,
	"sens" text NOT NULL,
	"est_avoir" boolean DEFAULT false NOT NULL,
	"numero" text,
	"tiers_nom" text,
	"tiers_siren" text,
	"date_emission" date,
	"date_echeance" date,
	"total_ht" numeric(18, 2),
	"total_tva" numeric(18, 2),
	"total_ttc" numeric(18, 2),
	"devise" text DEFAULT 'EUR' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fichiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"taille" bigint NOT NULL,
	"type_mime_declare" text,
	"type_mime_detecte" text,
	"cle_stockage" text NOT NULL,
	"nature" "nature_fichier" DEFAULT 'original' NOT NULL,
	"derive_de" uuid,
	"transformation" text,
	"analyse_antivirus" text DEFAULT 'non_analyse' NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "habilitations_dossier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"utilisateur_id" uuid NOT NULL,
	"niveau" "niveau_habilitation" NOT NULL,
	"accordee_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"acteur_id" uuid,
	"acteur_type" text DEFAULT 'utilisateur' NOT NULL,
	"action" text NOT NULL,
	"cible_type" text,
	"cible_id" text,
	"entite_id_cible" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"horodatage" timestamp with time zone DEFAULT now() NOT NULL,
	"empreinte_precedente" text,
	"empreinte" text
);
--> statement-breakpoint
CREATE TABLE "lettres_mission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"avenant_de" uuid,
	"document_id" uuid,
	"date_effet" date,
	"analyse" jsonb,
	"statut" text DEFAULT 'projet' NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lignes_ecriture" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"exercice_id" uuid NOT NULL,
	"lot_import_id" uuid NOT NULL,
	"numero_ligne" integer NOT NULL,
	"journal_code" text NOT NULL,
	"journal_lib" text NOT NULL,
	"ecriture_num" text NOT NULL,
	"ecriture_date" date NOT NULL,
	"compte_num" text NOT NULL,
	"compte_lib" text NOT NULL,
	"comp_aux_num" text,
	"comp_aux_lib" text,
	"piece_ref" text NOT NULL,
	"piece_date" date,
	"ecriture_lib" text NOT NULL,
	"debit" numeric(18, 2) NOT NULL,
	"credit" numeric(18, 2) NOT NULL,
	"ecriture_let" text,
	"date_let" date,
	"valid_date" date,
	"montant_devise" numeric(18, 2),
	"idevise" text
);
--> statement-breakpoint
CREATE TABLE "lots_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"exercice_id" uuid,
	"type" text NOT NULL,
	"statut_donnees" "statut_donnees",
	"fichier_id" uuid,
	"cle_idempotence" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"remplace_lot_id" uuid,
	"actif" boolean DEFAULT true NOT NULL,
	"statut" "statut_lot" DEFAULT 'en_attente' NOT NULL,
	"progression" integer DEFAULT 0 NOT NULL,
	"rapport" jsonb,
	"lance_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"termine_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages_mail" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"connexion_id" uuid NOT NULL,
	"id_fournisseur" text NOT NULL,
	"recu_le" timestamp with time zone,
	"expediteur" text,
	"statut" text NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"libelle" text NOT NULL,
	"debut" date,
	"fin" date,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mouvements_bancaires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"lot_import_id" uuid,
	"iban" text,
	"date_operation" date NOT NULL,
	"date_valeur" date,
	"montant" numeric(18, 2) NOT NULL,
	"libelle" text NOT NULL,
	"reference_banque" text
);
--> statement-breakpoint
CREATE TABLE "pages_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"texte" text,
	"lignes" jsonb,
	"methode" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "politiques_conservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"categorie" text NOT NULL,
	"duree_jours" integer,
	"fondement" text,
	"immuable" boolean DEFAULT false NOT NULL,
	"validee_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "propositions_ia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"tache" text NOT NULL,
	"modele" text NOT NULL,
	"version_prompt" text NOT NULL,
	"cible_type" text NOT NULL,
	"cible_id" uuid NOT NULL,
	"contenu" jsonb NOT NULL,
	"preuves" jsonb NOT NULL,
	"confiance" text DEFAULT 'non_evaluee' NOT NULL,
	"statut" text DEFAULT 'non_examinee' NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rapprochements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"niveau" text NOT NULL,
	"elements" jsonb NOT NULL,
	"criteres" jsonb NOT NULL,
	"ecart" numeric(18, 2),
	"statut" text DEFAULT 'propose' NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"canal" "canal_reception" NOT NULL,
	"deposant_id" uuid,
	"doublon_binaire" boolean DEFAULT false NOT NULL,
	"provenance" jsonb,
	"recu_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regles_cabinet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"controle_id" text NOT NULL,
	"entite_id_cible" uuid,
	"parametres" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"statut" text DEFAULT 'proposee' NOT NULL,
	"approuvee_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resultats_controles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"controle_id" text NOT NULL,
	"version_controle" text NOT NULL,
	"statut" "statut_controle" NOT NULL,
	"motif" text,
	"parametres" jsonb NOT NULL,
	"mesures" jsonb NOT NULL,
	"source" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources_reglementaires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"emetteur" text NOT NULL,
	"url" text,
	"version" text,
	"date_publication" date,
	"date_effet" date,
	"periode_application" text,
	"passage" text,
	"resume" text,
	"etat_verification" text DEFAULT 'non_verifiee' NOT NULL,
	"date_verification" date,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "televersements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"entite_id" uuid NOT NULL,
	"utilisateur_id" uuid NOT NULL,
	"canal" "canal_reception" NOT NULL,
	"nom_fichier" text NOT NULL,
	"type_mime_declare" text,
	"taille_attendue" bigint NOT NULL,
	"sha256_attendu" text NOT NULL,
	"octets_recus" bigint DEFAULT 0 NOT NULL,
	"nature" "nature_document" DEFAULT 'a_qualifier' NOT NULL,
	"commentaire" text,
	"usage" text DEFAULT 'piece' NOT NULL,
	"exercice_id" uuid,
	"statut_donnees" "statut_donnees",
	"lot_import_id" uuid,
	"statut" "statut_televersement" DEFAULT 'ouvert' NOT NULL,
	"document_id" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"expire_le" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "utilisateurs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sujet_oidc" text NOT NULL,
	"email" text NOT NULL,
	"nom" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "utilisateurs_sujet_oidc_unique" UNIQUE("sujet_oidc")
);
--> statement-breakpoint
ALTER TABLE "abonnements" ADD CONSTRAINT "abonnements_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appartenances" ADD CONSTRAINT "appartenances_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appartenances" ADD CONSTRAINT "appartenances_utilisateur_id_utilisateurs_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commentaires" ADD CONSTRAINT "commentaires_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commentaires" ADD CONSTRAINT "commentaires_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commentaires" ADD CONSTRAINT "commentaires_auteur_id_utilisateurs_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connexions_mail" ADD CONSTRAINT "connexions_mail_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connexions_mail" ADD CONSTRAINT "connexions_mail_cree_par_utilisateurs_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constats" ADD CONSTRAINT "constats_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constats" ADD CONSTRAINT "constats_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constats" ADD CONSTRAINT "constats_exercice_id_exercices_id_fk" FOREIGN KEY ("exercice_id") REFERENCES "public"."exercices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constats" ADD CONSTRAINT "constats_execution_id_executions_controles_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions_controles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constats" ADD CONSTRAINT "constats_resultat_id_resultats_controles_id_fk" FOREIGN KEY ("resultat_id") REFERENCES "public"."resultats_controles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constats" ADD CONSTRAINT "constats_affecte_a_utilisateurs_id_fk" FOREIGN KEY ("affecte_a") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_auteur_id_utilisateurs_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_exercice_id_exercices_id_fk" FOREIGN KEY ("exercice_id") REFERENCES "public"."exercices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_fichier_id_fichiers_id_fk" FOREIGN KEY ("fichier_id") REFERENCES "public"."fichiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echanges_document" ADD CONSTRAINT "echanges_document_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echanges_document" ADD CONSTRAINT "echanges_document_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echanges_document" ADD CONSTRAINT "echanges_document_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echanges_document" ADD CONSTRAINT "echanges_document_auteur_id_utilisateurs_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entites" ADD CONSTRAINT "entites_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etablissements" ADD CONSTRAINT "etablissements_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etablissements" ADD CONSTRAINT "etablissements_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenements_facturation" ADD CONSTRAINT "evenements_facturation_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenements_facturation" ADD CONSTRAINT "evenements_facturation_abonnement_id_abonnements_id_fk" FOREIGN KEY ("abonnement_id") REFERENCES "public"."abonnements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions_controles" ADD CONSTRAINT "executions_controles_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions_controles" ADD CONSTRAINT "executions_controles_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions_controles" ADD CONSTRAINT "executions_controles_exercice_id_exercices_id_fk" FOREIGN KEY ("exercice_id") REFERENCES "public"."exercices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions_controles" ADD CONSTRAINT "executions_controles_lot_import_id_lots_import_id_fk" FOREIGN KEY ("lot_import_id") REFERENCES "public"."lots_import"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions_controles" ADD CONSTRAINT "executions_controles_lance_par_utilisateurs_id_fk" FOREIGN KEY ("lance_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercices" ADD CONSTRAINT "exercices_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercices" ADD CONSTRAINT "exercices_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports_revision" ADD CONSTRAINT "exports_revision_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports_revision" ADD CONSTRAINT "exports_revision_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports_revision" ADD CONSTRAINT "exports_revision_exercice_id_exercices_id_fk" FOREIGN KEY ("exercice_id") REFERENCES "public"."exercices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports_revision" ADD CONSTRAINT "exports_revision_execution_id_executions_controles_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions_controles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports_revision" ADD CONSTRAINT "exports_revision_demande_par_utilisateurs_id_fk" FOREIGN KEY ("demande_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factures" ADD CONSTRAINT "factures_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factures" ADD CONSTRAINT "factures_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factures" ADD CONSTRAINT "factures_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fichiers" ADD CONSTRAINT "fichiers_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habilitations_dossier" ADD CONSTRAINT "habilitations_dossier_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habilitations_dossier" ADD CONSTRAINT "habilitations_dossier_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habilitations_dossier" ADD CONSTRAINT "habilitations_dossier_utilisateur_id_utilisateurs_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habilitations_dossier" ADD CONSTRAINT "habilitations_dossier_accordee_par_utilisateurs_id_fk" FOREIGN KEY ("accordee_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lettres_mission" ADD CONSTRAINT "lettres_mission_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lettres_mission" ADD CONSTRAINT "lettres_mission_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lettres_mission" ADD CONSTRAINT "lettres_mission_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lignes_ecriture" ADD CONSTRAINT "lignes_ecriture_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lignes_ecriture" ADD CONSTRAINT "lignes_ecriture_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lignes_ecriture" ADD CONSTRAINT "lignes_ecriture_exercice_id_exercices_id_fk" FOREIGN KEY ("exercice_id") REFERENCES "public"."exercices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lignes_ecriture" ADD CONSTRAINT "lignes_ecriture_lot_import_id_lots_import_id_fk" FOREIGN KEY ("lot_import_id") REFERENCES "public"."lots_import"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots_import" ADD CONSTRAINT "lots_import_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots_import" ADD CONSTRAINT "lots_import_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots_import" ADD CONSTRAINT "lots_import_exercice_id_exercices_id_fk" FOREIGN KEY ("exercice_id") REFERENCES "public"."exercices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots_import" ADD CONSTRAINT "lots_import_fichier_id_fichiers_id_fk" FOREIGN KEY ("fichier_id") REFERENCES "public"."fichiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots_import" ADD CONSTRAINT "lots_import_lance_par_utilisateurs_id_fk" FOREIGN KEY ("lance_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages_mail" ADD CONSTRAINT "messages_mail_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages_mail" ADD CONSTRAINT "messages_mail_connexion_id_connexions_mail_id_fk" FOREIGN KEY ("connexion_id") REFERENCES "public"."connexions_mail"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_bancaires" ADD CONSTRAINT "mouvements_bancaires_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_bancaires" ADD CONSTRAINT "mouvements_bancaires_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_bancaires" ADD CONSTRAINT "mouvements_bancaires_lot_import_id_lots_import_id_fk" FOREIGN KEY ("lot_import_id") REFERENCES "public"."lots_import"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages_document" ADD CONSTRAINT "pages_document_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages_document" ADD CONSTRAINT "pages_document_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages_document" ADD CONSTRAINT "pages_document_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "politiques_conservation" ADD CONSTRAINT "politiques_conservation_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "politiques_conservation" ADD CONSTRAINT "politiques_conservation_validee_par_utilisateurs_id_fk" FOREIGN KEY ("validee_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propositions_ia" ADD CONSTRAINT "propositions_ia_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propositions_ia" ADD CONSTRAINT "propositions_ia_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapprochements" ADD CONSTRAINT "rapprochements_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapprochements" ADD CONSTRAINT "rapprochements_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptions" ADD CONSTRAINT "receptions_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptions" ADD CONSTRAINT "receptions_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptions" ADD CONSTRAINT "receptions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptions" ADD CONSTRAINT "receptions_deposant_id_utilisateurs_id_fk" FOREIGN KEY ("deposant_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regles_cabinet" ADD CONSTRAINT "regles_cabinet_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regles_cabinet" ADD CONSTRAINT "regles_cabinet_approuvee_par_utilisateurs_id_fk" FOREIGN KEY ("approuvee_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resultats_controles" ADD CONSTRAINT "resultats_controles_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resultats_controles" ADD CONSTRAINT "resultats_controles_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resultats_controles" ADD CONSTRAINT "resultats_controles_execution_id_executions_controles_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions_controles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "televersements" ADD CONSTRAINT "televersements_cabinet_id_cabinets_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "televersements" ADD CONSTRAINT "televersements_entite_id_entites_id_fk" FOREIGN KEY ("entite_id") REFERENCES "public"."entites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "televersements" ADD CONSTRAINT "televersements_utilisateur_id_utilisateurs_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "televersements" ADD CONSTRAINT "televersements_exercice_id_exercices_id_fk" FOREIGN KEY ("exercice_id") REFERENCES "public"."exercices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appartenances_unique" ON "appartenances" USING btree ("cabinet_id","utilisateur_id");--> statement-breakpoint
CREATE INDEX "constats_exercice" ON "constats" USING btree ("exercice_id","statut_revue");--> statement-breakpoint
CREATE INDEX "documents_entite" ON "documents" USING btree ("cabinet_id","entite_id","statut");--> statement-breakpoint
CREATE INDEX "entites_cabinet" ON "entites" USING btree ("cabinet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exercices_unique" ON "exercices" USING btree ("entite_id","debut","fin");--> statement-breakpoint
CREATE INDEX "fichiers_empreinte" ON "fichiers" USING btree ("cabinet_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "habilitations_unique" ON "habilitations_dossier" USING btree ("entite_id","utilisateur_id");--> statement-breakpoint
CREATE INDEX "journal_audit_cabinet" ON "journal_audit" USING btree ("cabinet_id","id");--> statement-breakpoint
CREATE INDEX "lignes_lot" ON "lignes_ecriture" USING btree ("lot_import_id","numero_ligne");--> statement-breakpoint
CREATE INDEX "lignes_exercice_compte" ON "lignes_ecriture" USING btree ("exercice_id","compte_num");--> statement-breakpoint
CREATE UNIQUE INDEX "lots_idempotence" ON "lots_import" USING btree ("cabinet_id","cle_idempotence");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_mail_unique" ON "messages_mail" USING btree ("connexion_id","id_fournisseur");