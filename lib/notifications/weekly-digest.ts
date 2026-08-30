import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { appConfig } from "@/lib/config";
import { createAuditEvent } from "@/lib/db/audit-repo";
import { prisma } from "@/lib/db/client";
import { sendTeamsCard } from "@/lib/notifications/teams";

function sinceDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function percentage(part: number, total: number) {
  if (total === 0) {
    return 0;
  }
  return (part / total) * 100;
}

export async function runWeeklyTeamsDigest() {
  const since = sinceDays(7);

  const [
    messages,
    closedGaps,
    openGaps,
    appliedCorrections,
    promotedDocs,
    unanswered,
    fallback,
    agentCalls,
  ] = await Promise.all([
    prisma.message.count({ where: { createdAt: { gte: since } } }),
    prisma.processGapQuestion.count({
      where: {
        answeredAt: { gte: since },
        status: { in: ["answered", "closed"] },
      },
    }),
    prisma.processGapQuestion.count({ where: { status: "promoted" } }),
    prisma.chunkFeedback.count({
      where: { status: "APPROVED", updatedAt: { gte: since } },
    }),
    prisma.curationDocument.count({
      where: { status: "PROMOTED", promotedAt: { gte: since } },
    }),
    prisma.auditEvent.count({
      where: { eventType: "agent.unanswered", createdAt: { gte: since } },
    }),
    prisma.auditEvent.count({
      where: {
        eventType: "delegation.local_fallback",
        createdAt: { gte: since },
      },
    }),
    prisma.agentCall.count({ where: { createdAt: { gte: since } } }),
  ]);

  const fallbackRate = percentage(fallback, agentCalls);
  const sendResult = await sendTeamsCard(appConfig.teamsWebhookDigest, {
    title: "Digest semanal - Cidadela",
    summary: "Resumo semanal de uso, curadoria e qualidade",
    facts: [
      { name: "Mensagens", value: String(messages) },
      { name: "Lacunas fechadas", value: String(closedGaps) },
      { name: "Lacunas abertas", value: String(openGaps) },
      { name: "Correcoes aplicadas", value: String(appliedCorrections) },
      { name: "Documentos promovidos", value: String(promotedDocs) },
      { name: "Perguntas sem resposta", value: String(unanswered) },
      {
        name: "Fallback local",
        value: `${fallback}/${agentCalls} (${fallbackRate.toFixed(1)}%)`,
      },
    ],
    action: {
      label: "Abrir painel",
      url: new URL("/", appConfig.nextAuthUrl).toString(),
    },
    themeColor: fallbackRate > 5 ? "DC2626" : "059669",
  });

  await createAuditEvent({
    traceId: randomUUID(),
    actorType: "system",
    actorId: "notifications.weekly-digest",
    targetType: "teams",
    targetId: "digest",
    eventType: "notification.sent",
    payload: {
      channel: "teams",
      status: sendResult.status,
      kind: "weekly_digest",
      teamsConfigured: Boolean(appConfig.teamsWebhookDigest),
      metrics: {
        messages,
        closedGaps,
        openGaps,
        appliedCorrections,
        promotedDocs,
        unanswered,
        fallback,
        agentCalls,
        fallbackRate,
      },
      result: sendResult,
    } as Prisma.InputJsonValue,
  });

  return {
    metrics: {
      messages,
      closedGaps,
      openGaps,
      appliedCorrections,
      promotedDocs,
      unanswered,
      fallback,
      agentCalls,
      fallbackRate,
    },
    result: sendResult,
  };
}
