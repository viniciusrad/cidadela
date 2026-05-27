-- AlterTable
ALTER TABLE "automation_candidates" ADD COLUMN "process_map_id" TEXT;

-- CreateTable
CREATE TABLE "process_maps" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector" "Sector" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'mapped',
    "automation_readiness_score" DOUBLE PRECISION NOT NULL,
    "documentation_coverage_score" DOUBLE PRECISION NOT NULL,
    "confidence_score" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "recommended_automation_level" TEXT NOT NULL,
    "suggested_script_type" TEXT,
    "process_signals" JSONB NOT NULL,
    "system_names" JSONB NOT NULL,
    "document_refs" JSONB NOT NULL,
    "graph_evidence" JSONB NOT NULL,
    "vector_evidence" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_analyzed_at" TIMESTAMP(3),

    CONSTRAINT "process_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_gap_questions" (
    "id" TEXT NOT NULL,
    "process_map_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "target_document_id" TEXT,
    "target_curation_document_id" TEXT,
    "derived_from" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMP(3),

    CONSTRAINT "process_gap_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "process_maps_fingerprint_key" ON "process_maps"("fingerprint");

-- CreateIndex
CREATE INDEX "process_maps_sector_status_idx" ON "process_maps"("sector", "status");

-- CreateIndex
CREATE INDEX "process_maps_recommended_automation_level_idx" ON "process_maps"("recommended_automation_level");

-- CreateIndex
CREATE INDEX "process_gap_questions_process_map_id_status_idx" ON "process_gap_questions"("process_map_id", "status");

-- CreateIndex
CREATE INDEX "process_gap_questions_target_curation_document_id_idx" ON "process_gap_questions"("target_curation_document_id");

-- CreateIndex
CREATE INDEX "automation_candidates_process_map_id_idx" ON "automation_candidates"("process_map_id");

-- AddForeignKey
ALTER TABLE "automation_candidates" ADD CONSTRAINT "automation_candidates_process_map_id_fkey" FOREIGN KEY ("process_map_id") REFERENCES "process_maps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_gap_questions" ADD CONSTRAINT "process_gap_questions_process_map_id_fkey" FOREIGN KEY ("process_map_id") REFERENCES "process_maps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_gap_questions" ADD CONSTRAINT "process_gap_questions_target_curation_document_id_fkey" FOREIGN KEY ("target_curation_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
