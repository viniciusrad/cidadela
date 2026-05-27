import type { AgentCallStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";

export function createAgentCall(data: {
  traceId: string;
  parentTraceId?: string;
  fromAgent: string;
  toAgent: string;
  intent: string;
  protocol: string;
  request: Prisma.InputJsonValue;
  response?: Prisma.InputJsonValue;
  status: AgentCallStatus;
  latencyMs?: number;
}) {
  return prisma.agentCall.create({
    data: {
      traceId: data.traceId,
      parentTraceId: data.parentTraceId,
      fromAgent: data.fromAgent,
      toAgent: data.toAgent,
      intent: data.intent,
      protocol: data.protocol,
      request: data.request,
      response: data.response,
      status: data.status,
      latencyMs: data.latencyMs,
    },
  });
}

export function createAuditEvent(data: {
  traceId: string;
  actorType: string;
  actorId: string;
  targetType: string;
  targetId: string;
  eventType: string;
  payload?: Prisma.InputJsonValue;
}) {
  return prisma.auditEvent.create({
    data,
  });
}

export function findLatestAutomationApprovalEvent(conversationId: string) {
  return prisma.auditEvent.findFirst({
    where: {
      targetType: "conversation",
      targetId: conversationId,
      eventType: {
        in: [
          "automation.approval_requested",
          "automation.approval_confirmed",
          "automation.approval_cancelled",
        ],
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export function syncProtocols(
  rows: Array<{
    fromSector: string;
    toSector: string;
    intent: string;
    template: string;
    maxTokens: number;
    enabled: boolean;
  }>,
) {
  return prisma.$transaction(
    rows.map((row) =>
      prisma.protocol.upsert({
        where: {
          fromSector_toSector_intent: {
            fromSector: row.fromSector,
            toSector: row.toSector,
            intent: row.intent,
          },
        },
        create: row,
        update: {},
      }),
    ),
  );
}
