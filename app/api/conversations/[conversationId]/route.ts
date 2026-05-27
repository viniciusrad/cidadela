import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { getConversationWithMessages } from "@/lib/db/conversations-repo";
import type { GenerationMetrics } from "@/lib/domain";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/conversations/[conversationId]">,
) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const { conversationId } = await context.params;
  const conversation = await getConversationWithMessages(
    conversationId,
    session.user.id,
  );

  if (!conversation) {
    return jsonError("Conversa nao encontrada.", 404);
  }

  const messageIds = conversation.messages.map((m) => m.id);
  const auditEvents = await import("@/lib/db/client").then(({ prisma }) =>
    prisma.auditEvent.findMany({
      where: {
        OR: [
          { eventType: "user.feedback", targetId: { in: messageIds } },
          { eventType: "agent.answer", targetId: conversation.id },
        ]
      },
      orderBy: { createdAt: "asc" },
    }),
  );

  const feedbackMap = new Map<string, string>();
  const metricsMap = new Map<string, GenerationMetrics>();
  
  for (const event of auditEvents) {
    if (event.eventType === "user.feedback" && event.payload && typeof event.payload === "object" && "value" in event.payload) {
      feedbackMap.set(event.targetId, String(event.payload.value));
    } else if (event.eventType === "agent.answer" && event.payload && typeof event.payload === "object" && "metrics" in event.payload) {
      metricsMap.set(event.traceId, event.payload.metrics as GenerationMetrics);
    }
  }

  return Response.json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      sector: conversation.sector,
    },
    messages: conversation.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      citations: Array.isArray(message.citations) ? message.citations : [],
      feedback: feedbackMap.get(message.id),
      metrics: metricsMap.get(message.traceId),
      agentId: message.agentId,
      traceId: message.traceId,
      createdAt: message.createdAt.toISOString(),
    })),
  });
}
