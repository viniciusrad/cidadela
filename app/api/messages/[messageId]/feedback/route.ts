import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: RouteContext<"/api/messages/[messageId]/feedback">,
) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const { messageId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const value = body.value;
  const comment =
    typeof body.comment === "string" && body.comment.trim()
      ? body.comment.trim().slice(0, 1000)
      : undefined;

  if (value !== "good" && value !== "bad") {
    return jsonError("O valor do feedback deve ser 'good' ou 'bad'.", 400);
  }

  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      conversation: {
        userId: session.user.id,
      },
    },
    include: {
      conversation: true,
    },
  });

  if (!message) {
    return jsonError("Mensagem nao encontrada.", 404);
  }

  await prisma.auditEvent.create({
    data: {
      traceId: message.traceId || randomUUID(),
      actorType: "user",
      actorId: session.user.id,
      targetType: "message",
      targetId: message.id,
      eventType: "user.feedback",
      payload: {
        value,
        conversationId: message.conversationId,
        sector: session.user.sector,
        ...(comment ? { comment } : {}),
      },
    },
  });

  return Response.json({ success: true });
}
