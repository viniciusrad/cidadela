-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'STAGED', 'IN_REVIEW', 'NEEDS_REVISION', 'READY_FOR_APPROVAL', 'APPROVED', 'PROMOTED', 'REJECTED');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "relative_path" TEXT,
    "document_title" TEXT NOT NULL,
    "source_format" TEXT NOT NULL,
    "sector" "Sector" NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content_hash" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "normalized_markdown" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3),
    "supersedes" TEXT,
    "owner" TEXT,
    "sensitivity" TEXT,
    "topic" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "sop_readiness_score" DOUBLE PRECISION,
    "sop_path" TEXT,
    "promoted_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_reviews" (
    "id" TEXT NOT NULL,
    "curation_document_id" TEXT NOT NULL,
    "reviewed_by_id" TEXT,
    "actor_type" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "variant_choices" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_approvals" (
    "id" TEXT NOT NULL,
    "curation_document_id" TEXT NOT NULL,
    "approver_id" TEXT NOT NULL,
    "approver_role" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_owners" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "sector" "Sector" NOT NULL,
    "user_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_owners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_document_id_sector_key" ON "documents"("document_id", "sector");

-- CreateIndex
CREATE INDEX "documents_sector_status_uploaded_at_idx" ON "documents"("sector", "status", "uploaded_at");

-- CreateIndex
CREATE INDEX "documents_source_document_id_sector_idx" ON "documents"("source_document_id", "sector");

-- CreateIndex
CREATE INDEX "document_reviews_curation_document_id_created_at_idx" ON "document_reviews"("curation_document_id", "created_at");

-- CreateIndex
CREATE INDEX "document_approvals_curation_document_id_created_at_idx" ON "document_approvals"("curation_document_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_owners_topic_sector_key" ON "knowledge_owners"("topic", "sector");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_curation_document_id_fkey" FOREIGN KEY ("curation_document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_curation_document_id_fkey" FOREIGN KEY ("curation_document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
