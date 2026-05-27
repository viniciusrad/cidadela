-- CreateEnum
CREATE TYPE "ChunkFeedbackStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "chunk_feedbacks" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sector" "Sector" NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "original_content" TEXT NOT NULL,
    "proposed_content" TEXT NOT NULL,
    "status" "ChunkFeedbackStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chunk_feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chunk_feedbacks_sector_status_idx" ON "chunk_feedbacks"("sector", "status");

-- AddForeignKey
ALTER TABLE "chunk_feedbacks" ADD CONSTRAINT "chunk_feedbacks_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunk_feedbacks" ADD CONSTRAINT "chunk_feedbacks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunk_feedbacks" ADD CONSTRAINT "chunk_feedbacks_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
