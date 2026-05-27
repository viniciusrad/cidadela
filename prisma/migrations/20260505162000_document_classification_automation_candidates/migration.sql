-- AlterTable
ALTER TABLE "documents" ADD COLUMN "document_type" TEXT;
ALTER TABLE "documents" ADD COLUMN "classification_source" TEXT;
ALTER TABLE "documents" ADD COLUMN "classification_confidence" DOUBLE PRECISION;
ALTER TABLE "documents" ADD COLUMN "authority_level" TEXT;
ALTER TABLE "documents" ADD COLUMN "curation_readiness_score" DOUBLE PRECISION;
ALTER TABLE "documents" ADD COLUMN "curation_profile" JSONB;
ALTER TABLE "documents" ADD COLUMN "knowledge_extraction" JSONB;

-- Backfill legacy curated documents as SOP-compatible records.
UPDATE "documents"
SET
  "document_type" = COALESCE("document_type", 'sop'),
  "classification_source" = COALESCE("classification_source", 'script'),
  "classification_confidence" = COALESCE("classification_confidence", 0.35),
  "authority_level" = COALESCE("authority_level", 'draft'),
  "curation_readiness_score" = COALESCE("curation_readiness_score", "sop_readiness_score")
WHERE "document_type" IS NULL
   OR "classification_source" IS NULL
   OR "classification_confidence" IS NULL
   OR "authority_level" IS NULL
   OR "curation_readiness_score" IS NULL;

-- CreateTable
CREATE TABLE "automation_candidates" (
    "id" TEXT NOT NULL,
    "curation_document_id" TEXT NOT NULL,
    "sector" "Sector" NOT NULL,
    "title" TEXT NOT NULL,
    "process_name" TEXT,
    "automation_level" TEXT NOT NULL,
    "automation_label" TEXT,
    "suggested_script_type" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "indicated_by_user_id" TEXT,
    "indicated_by_role" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_candidates_sector_status_idx" ON "automation_candidates"("sector", "status");

-- CreateIndex
CREATE INDEX "automation_candidates_curation_document_id_idx" ON "automation_candidates"("curation_document_id");

-- AddForeignKey
ALTER TABLE "automation_candidates" ADD CONSTRAINT "automation_candidates_curation_document_id_fkey" FOREIGN KEY ("curation_document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_candidates" ADD CONSTRAINT "automation_candidates_indicated_by_user_id_fkey" FOREIGN KEY ("indicated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
