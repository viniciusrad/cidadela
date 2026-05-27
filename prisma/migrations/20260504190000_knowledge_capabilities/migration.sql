-- CreateTable
CREATE TABLE "knowledge_capabilities" (
    "id" TEXT NOT NULL,
    "sector" "Sector" NOT NULL,
    "document_id" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "document_title" TEXT NOT NULL,
    "topic" TEXT,
    "owner" TEXT,
    "sensitivity" TEXT NOT NULL,
    "capability_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_capabilities_source_document_id_sector_key" ON "knowledge_capabilities"("source_document_id", "sector");

-- CreateIndex
CREATE INDEX "knowledge_capabilities_sector_sensitivity_idx" ON "knowledge_capabilities"("sector", "sensitivity");
