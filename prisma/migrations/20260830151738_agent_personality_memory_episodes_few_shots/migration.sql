-- CreateTable
CREATE TABLE "agent_personalities" (
    "sector" TEXT NOT NULL,
    "tone" INTEGER NOT NULL DEFAULT 3,
    "verbosity" INTEGER NOT NULL DEFAULT 3,
    "formality" INTEGER NOT NULL DEFAULT 3,
    "proactivity" INTEGER NOT NULL DEFAULT 3,
    "escalation_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.40,
    "domain_emphasis" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "agent_personalities_pkey" PRIMARY KEY ("sector")
);

-- CreateTable
CREATE TABLE "memory_episodes" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "feedback_score" DOUBLE PRECISION,
    "review_status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by" TEXT,
    "qdrant_point_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "few_shot_examples" (
    "id" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "inputPattern" TEXT NOT NULL,
    "agentResponse" TEXT NOT NULL,
    "domainTags" TEXT[],
    "score" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "approved_by" TEXT,
    "promoted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "few_shot_examples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memory_episodes_sector_review_status_idx" ON "memory_episodes"("sector", "review_status");

-- CreateIndex
CREATE INDEX "memory_episodes_conversation_id_idx" ON "memory_episodes"("conversation_id");

-- CreateIndex
CREATE INDEX "few_shot_examples_sector_active_idx" ON "few_shot_examples"("sector", "active");

-- AddForeignKey
ALTER TABLE "memory_episodes" ADD CONSTRAINT "memory_episodes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
