import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { createAuditEvent } from "@/lib/db/audit-repo";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  if (session.user.role !== "admin") {
    return jsonError("Acesso restrito a administradores.", 403);
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const question = await prisma.unansweredQuestion.findUnique({ where: { id } });
  if (!question) {
    return jsonError("Pergunta nao encontrada.", 404);
  }
  if (question.status !== "open") {
    return jsonError("Esta pergunta ja foi respondida ou descartada.", 409);
  }

  await prisma.unansweredQuestion.update({
    where: { id: question.id },
    data: {
      status: "dismissed",
      resolvedById: session.user.id,
      resolvedAt: new Date(),
      answerText: reason || null,
    },
  });

  await createAuditEvent({
    traceId: randomUUID(),
    actorType: "user",
    actorId: session.user.id,
    targetType: "unanswered_question",
    targetId: question.id,
    eventType: "unanswered.dismissed",
    payload: {
      unansweredQuestionId: question.id,
      sector: question.sector,
      reason: reason || null,
    },
  });

  return Response.json({ unansweredQuestionId: question.id, status: "dismissed" });
}
