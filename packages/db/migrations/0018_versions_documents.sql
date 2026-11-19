ALTER TYPE "public"."statut_document" ADD VALUE 'remplace';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "remplace_par" uuid;--> statement-breakpoint
ALTER TABLE "televersements" ADD COLUMN "remplace_document_id" uuid;