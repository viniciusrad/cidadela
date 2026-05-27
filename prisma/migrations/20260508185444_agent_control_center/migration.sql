-- CreateTable
CREATE TABLE "agent_configs" (
    "sector" "Sector" NOT NULL,
    "display_name" TEXT,
    "summary" TEXT,
    "instructions" TEXT,
    "capabilities" JSONB,
    "chat_model" TEXT,
    "top_k" INTEGER,
    "local_confidence_threshold" DOUBLE PRECISION,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_configs_pkey" PRIMARY KEY ("sector")
);
