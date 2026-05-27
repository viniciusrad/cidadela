-- CreateTable
CREATE TABLE "sector_definitions" (
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "agent_name" TEXT NOT NULL,
    "agent_summary" TEXT NOT NULL,
    "agent_instructions" TEXT NOT NULL,
    "capabilities" JSONB,
    "chat_model" TEXT,
    "top_k" INTEGER,
    "local_confidence_threshold" DOUBLE PRECISION,
    "qdrant_collection" TEXT NOT NULL,
    "qdrant_staging_collection" TEXT NOT NULL,
    "is_native" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "provisioned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "sector_definitions_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "sector_access_rules" (
    "id" TEXT NOT NULL,
    "from_sector" TEXT NOT NULL,
    "to_sector" TEXT NOT NULL,
    "access_level" TEXT NOT NULL DEFAULT 'public',
    "routing_keywords" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sector_access_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sector_access_rules_from_sector_enabled_idx" ON "sector_access_rules"("from_sector", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "sector_access_rules_from_sector_to_sector_key" ON "sector_access_rules"("from_sector", "to_sector");

-- AddForeignKey
ALTER TABLE "sector_access_rules" ADD CONSTRAINT "sector_access_rules_from_sector_fkey" FOREIGN KEY ("from_sector") REFERENCES "sector_definitions"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sector_access_rules" ADD CONSTRAINT "sector_access_rules_to_sector_fkey" FOREIGN KEY ("to_sector") REFERENCES "sector_definitions"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
