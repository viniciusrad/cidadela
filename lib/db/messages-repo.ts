import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";

export function createMessage(data: {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  traceId: string;
  citations?: Prisma.InputJsonValue;
  agentId?: string;
}) {
  return prisma.message.create({
    data: {
      conversationId: data.conversationId,
      role: data.role,
      content: data.content,
      traceId: data.traceId,
      citations: data.citations,
      agentId: data.agentId,
    },
  });
}
