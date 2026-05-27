import { DocumentStatus, ChunkFeedbackStatus } from "@prisma/client";

import { ensureBusBootstrapped } from "@/lib/bus/bootstrap";
import { createBusChannel } from "@/lib/bus/connection";
import { prisma } from "@/lib/db/client";
import type { Sector, UserRole } from "@/lib/domain";
import { runQuery, checkNeo4jHealth } from "@/lib/neo4j";
import { checkOllamaHealth } from "@/lib/ollama";
import { checkQdrantHealth, countSectorDocuments } from "@/lib/qdrant";
import { listAllSectorSlugs } from "@/lib/sectors/sector-repo";

const CHECK_TIMEOUT_MS = 1500;

export type HealthStatus = {
  postgres: boolean;
  qdrant: boolean;
  ollama: boolean;
  rabbitmq: boolean;
  neo4j: boolean;
};

export type ActivityEvent = {
  id: string;
  eventType: string;
  actorType: string;
  actorId: string;
  targetType: string;
  targetId: string;
  createdAt: string;
};

export type AdminMetrics = {
  kpis: {
    curationPending: number | null;
    gapsOpen: number | null;
    feedback24h: number | null;
    messages24h: number | null;
    processesMapped: number | null;
    automationCandidates: number | null;
  };
  pillars: {
    chunksInProduction: number | null;
    chunksInStaging: number | null;
    graphConcepts: number | null;
    graphDocuments: number | null;
    agentsConfigured: number | null;
    feedbackBad: number | null;
  };
  health: HealthStatus | null;
  activity: ActivityEvent[] | null;
};

export type UserMetrics = {
  kpis: {
    yourConversations: number | null;
    messages7d: number | null;
    sectorDocuments: number | null;
    yourCorrections: number | null;
  };
  health: HealthStatus | null;
};

type ShellUser = {
  id: string;
  sector: Sector;
  role: UserRole;
};

function withTimeout<T>(promise: Promise<T>, ms = CHECK_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);
}

async function safe<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await withTimeout(work());
  } catch {
    return null;
  }
}

function startOfDaysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

async function checkPostgresHealth(): Promise<boolean> {
  await prisma.$queryRaw`SELECT 1`;
  return true;
}

async function checkRabbitMqHealth(): Promise<boolean> {
  await ensureBusBootstrapped().catch(() => undefined);
  const channel = await createBusChannel();
  await channel.close();
  return true;
}

async function loadHealth(): Promise<HealthStatus> {
  const results = await Promise.allSettled([
    withTimeout(checkPostgresHealth()),
    withTimeout(checkQdrantHealth()),
    withTimeout(checkOllamaHealth()),
    withTimeout(checkRabbitMqHealth()),
    withTimeout(checkNeo4jHealth()),
  ]);

  return {
    postgres: results[0].status === "fulfilled",
    qdrant: results[1].status === "fulfilled",
    ollama: results[2].status === "fulfilled",
    rabbitmq: results[3].status === "fulfilled",
    neo4j:
      results[4].status === "fulfilled" && results[4].value === true,
  };
}

async function loadRecentActivity(take = 10): Promise<ActivityEvent[]> {
  const events = await prisma.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      eventType: true,
      actorType: true,
      actorId: true,
      targetType: true,
      targetId: true,
      createdAt: true,
    },
  });
  return events.map((event) => ({
    ...event,
    createdAt: event.createdAt.toISOString(),
  }));
}

async function loadGraphCount(label: "Document" | "Concept"): Promise<number> {
  const rows = await runQuery<{ total: number }>(
    `MATCH (n:${label}) RETURN count(n) AS total`,
  );
  return Number(rows[0]?.total ?? 0);
}

async function loadChunksAcrossSectors(): Promise<{
  publicChunks: number;
  stagingChunks: number;
}> {
  const sectors = await listAllSectorSlugs();
  const counts = await Promise.all(
    sectors.map((sector) =>
      countSectorDocuments(sector).catch(() => ({
        publicChunks: 0,
        stagingChunks: 0,
      })),
    ),
  );
  return counts.reduce(
    (acc, current) => ({
      publicChunks: acc.publicChunks + current.publicChunks,
      stagingChunks: acc.stagingChunks + current.stagingChunks,
    }),
    { publicChunks: 0, stagingChunks: 0 },
  );
}

export async function loadAdminMetrics(): Promise<AdminMetrics> {
  const since24h = startOfDaysAgo(1);
  const pendingStatuses: DocumentStatus[] = [
    "UPLOADED",
    "STAGED",
    "IN_REVIEW",
    "NEEDS_REVISION",
    "READY_FOR_APPROVAL",
    "APPROVED",
  ];

  const [
    curationPending,
    gapsOpen,
    feedback24h,
    messages24h,
    processesMapped,
    automationCandidates,
    chunks,
    graphConcepts,
    graphDocuments,
    agentsConfigured,
    feedbackBad,
    health,
    activity,
  ] = await Promise.all([
    safe(() =>
      prisma.curationDocument.count({
        where: { status: { in: pendingStatuses } },
      }),
    ),
    safe(() =>
      prisma.processGapQuestion.count({ where: { status: "open" } }),
    ),
    safe(() =>
      prisma.chunkFeedback.count({ where: { createdAt: { gte: since24h } } }),
    ),
    safe(() =>
      prisma.message.count({ where: { createdAt: { gte: since24h } } }),
    ),
    safe(() => prisma.processMap.count()),
    safe(() =>
      prisma.automationCandidate.count({ where: { status: "suggested" } }),
    ),
    safe(() => loadChunksAcrossSectors()),
    safe(() => loadGraphCount("Concept")),
    safe(() => loadGraphCount("Document")),
    safe(() => prisma.sectorDefinition.count({ where: { enabled: true } })),
    safe(() =>
      prisma.chunkFeedback.count({
        where: { status: ChunkFeedbackStatus.REJECTED },
      }),
    ),
    safe(() => loadHealth()),
    safe(() => loadRecentActivity()),
  ]);

  return {
    kpis: {
      curationPending,
      gapsOpen,
      feedback24h,
      messages24h,
      processesMapped,
      automationCandidates,
    },
    pillars: {
      chunksInProduction: chunks?.publicChunks ?? null,
      chunksInStaging: chunks?.stagingChunks ?? null,
      graphConcepts,
      graphDocuments,
      agentsConfigured,
      feedbackBad,
    },
    health,
    activity,
  };
}

export async function loadUserMetrics(user: ShellUser): Promise<UserMetrics> {
  const since7d = startOfDaysAgo(7);

  const [
    yourConversations,
    messages7d,
    sectorDocuments,
    yourCorrections,
    health,
  ] = await Promise.all([
    safe(() => prisma.conversation.count({ where: { userId: user.id } })),
    safe(() =>
      prisma.message.count({
        where: {
          createdAt: { gte: since7d },
          conversation: { userId: user.id },
        },
      }),
    ),
    safe(() =>
      prisma.curationDocument.count({
        where: { sector: user.sector, status: DocumentStatus.PROMOTED },
      }),
    ),
    safe(() => prisma.chunkFeedback.count({ where: { userId: user.id } })),
    safe(() => loadHealth()),
  ]);

  return {
    kpis: {
      yourConversations,
      messages7d,
      sectorDocuments,
      yourCorrections,
    },
    health,
  };
}
