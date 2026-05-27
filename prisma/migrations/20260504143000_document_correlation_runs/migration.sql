-- CreateTable
CREATE TABLE "document_correlation_runs" (
    "id" TEXT NOT NULL,
    "curation_document_id" TEXT NOT NULL,
    "triggered_by_id" TEXT,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "findings" JSONB NOT NULL,
    "questions" JSONB,
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "document_correlation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_correlation_runs_curation_document_id_created_at_idx" ON "document_correlation_runs"("curation_document_id", "created_at");

-- AddForeignKey
ALTER TABLE "document_correlation_runs" ADD CONSTRAINT "document_correlation_runs_curation_document_id_fkey" FOREIGN KEY ("curation_document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
