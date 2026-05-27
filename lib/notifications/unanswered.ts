import { prisma } from "@/lib/db/client";

/**
 * When a curation document is promoted to production, notify the authors of any
 * unanswered questions that were answered by that document. Idempotent: only
 * questions still missing `notifiedAt` are processed, and the flag is set after
 * the notification is created, so re-promoting never double-notifies.
 *
 * Best-effort by design — the caller wraps this so a notification failure never
 * blocks promotion.
 */
export async function notifyAskersOnPromotion(curationDocumentId: string) {
  const questions = await prisma.unansweredQuestion.findMany({
    where: {
      curationDocumentId,
      status: "answered",
      notifiedAt: null,
    },
  });

  let notified = 0;
  for (const question of questions) {
    await prisma.notification.create({
      data: {
        userId: question.askedById,
        type: "unanswered_resolved",
        title: "Sua pergunta foi respondida",
        body: question.question,
        href: "/chat",
        metadata: {
          unansweredQuestionId: question.id,
          conversationId: question.conversationId,
          curationDocumentId,
          sector: question.sector,
        },
      },
    });
    await prisma.unansweredQuestion.update({
      where: { id: question.id },
      data: { notifiedAt: new Date() },
    });
    notified += 1;
  }

  return { notified };
}
