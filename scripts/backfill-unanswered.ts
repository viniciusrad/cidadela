/**
 * Backfill the UnansweredQuestion queue from historical `agent.unanswered`
 * audit events. Each event carries the conversation id (targetId), the sector
 * and question (payload). The asker is resolved from Conversation.userId.
 *
 * Does NOT touch Qdrant or Neo4j. Idempotent: upsert by traceId, so re-running
 * never duplicates rows and never overwrites a question already answered.
 *
 * Usage:
 *   npx tsx scripts/backfill-unanswered.ts
 *   npx tsx scripts/backfill-unanswered.ts --dry-run
 */

import { prisma } from "@/lib/db/client";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

function payloadField(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

async function main() {
  console.log(`\nBackfill UnansweredQuestion${DRY_RUN ? " [DRY RUN]" : ""}\n`);

  const events = await prisma.auditEvent.findMany({
    where: { eventType: "agent.unanswered" },
    orderBy: { createdAt: "asc" },
  });
  console.log(`  Found ${events.length} agent.unanswered audit event(s)`);

  const conversationIds = [...new Set(events.map((event) => event.targetId))];
  const conversations = await prisma.conversation.findMany({
    where: { id: { in: conversationIds } },
    select: { id: true, userId: true, sector: true },
  });
  const conversationById = new Map(conversations.map((c) => [c.id, c]));

  const existingTraceIds = new Set(
    (
      await prisma.unansweredQuestion.findMany({
        where: { traceId: { in: events.map((event) => event.traceId) } },
        select: { traceId: true },
      })
    ).map((row) => row.traceId),
  );

  let created = 0;
  let skippedMissingConversation = 0;
  let skippedExisting = 0;

  for (const event of events) {
    if (existingTraceIds.has(event.traceId)) {
      skippedExisting++;
      continue;
    }

    const conversation = conversationById.get(event.targetId);
    if (!conversation) {
      skippedMissingConversation++;
      continue;
    }

    const question = payloadField(event.payload, "question") ?? "";
    const sector = payloadField(event.payload, "sector") ?? conversation.sector;

    if (DRY_RUN) {
      created++;
      continue;
    }

    await prisma.unansweredQuestion.create({
      data: {
        traceId: event.traceId,
        conversationId: conversation.id,
        askedById: conversation.userId,
        sector,
        question,
        createdAt: event.createdAt,
      },
    });
    created++;
  }

  console.log(`─── Summary ───────────────────────────────────`);
  console.log(`  Rows ${DRY_RUN ? "(dry)" : "created/kept"}: ${created}`);
  console.log(`  Skipped (already present): ${skippedExisting}`);
  console.log(`  Skipped (conversation missing): ${skippedMissingConversation}`);
  if (DRY_RUN) console.log(`\n  Re-run without --dry-run to apply changes.`);
  console.log();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
