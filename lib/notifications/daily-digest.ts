import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { appConfig } from "@/lib/config";
import { createAuditEvent } from "@/lib/db/audit-repo";
import { prisma } from "@/lib/db/client";
import { loadPendencyOverviewForActor } from "@/lib/notifications/pendencies";
import { sendTeamsCard, type TeamsCardFact } from "@/lib/notifications/teams";

function appUrl(path: string) {
  return new URL(path, appConfig.nextAuthUrl).toString();
}

function factsFromCounts(input: {
  gaps: number;
  corrections: number;
  unanswered: number;
}): TeamsCardFact[] {
  return [
    { name: "Lacunas de processo", value: String(input.gaps) },
    { name: "Correcoes aguardando revisao", value: String(input.corrections) },
    { name: "Perguntas sem resposta em 7 dias", value: String(input.unanswered) },
  ];
}

export async function runDailyOwnerDigest() {
  const owners = await prisma.knowledgeOwner.findMany({
    orderBy: [{ userEmail: "asc" }, { sector: "asc" }, { topic: "asc" }],
    select: {
      userEmail: true,
      sector: true,
      topic: true,
    },
  });

  const uniqueOwners = Array.from(
    owners
      .reduce((map, owner) => {
        if (!map.has(owner.userEmail)) {
          map.set(owner.userEmail, owner);
        }
        return map;
      }, new Map<string, (typeof owners)[number]>())
      .values(),
  );

  const results = [];

  for (const owner of uniqueOwners) {
    const overview = await loadPendencyOverviewForActor({
      id: owner.userEmail,
      email: owner.userEmail,
      role: "user",
      sector: owner.sector,
    });

    if (overview.counts.total === 0) {
      results.push({ userEmail: owner.userEmail, status: "empty" });
      continue;
    }

    const sendResult = await sendTeamsCard(appConfig.teamsWebhookGaps, {
      title: `Pendencias de conhecimento - ${owner.userEmail}`,
      summary: `${overview.counts.total} pendencias para ${owner.userEmail}`,
      facts: [
        ...factsFromCounts(overview.counts),
        {
          name: "Topicos monitorados",
          value: overview.ownerTopics
            .map((item) => `${item.topic} (${item.sector})`)
            .join(", "),
        },
      ],
      action: {
        label: "Abrir minhas pendencias",
        url: appUrl("/me/pendencias"),
      },
      themeColor: overview.counts.total > 10 ? "DC2626" : "2563EB",
    });

    await createAuditEvent({
      traceId: randomUUID(),
      actorType: "system",
      actorId: "notifications.daily-digest",
      targetType: "knowledge_owner",
      targetId: owner.userEmail,
      eventType: "notification.sent",
      payload: {
        channel: "teams",
        status: sendResult.status,
        kind: "daily_owner_digest",
        userEmail: owner.userEmail,
        counts: overview.counts,
        teamsConfigured: Boolean(appConfig.teamsWebhookGaps),
        result: sendResult,
      } as Prisma.InputJsonValue,
    });

    results.push({ userEmail: owner.userEmail, ...sendResult });
  }

  return {
    owners: uniqueOwners.length,
    results,
  };
}
