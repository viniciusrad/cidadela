import { isNativeSector, type Sector, type UserRole } from "@/lib/domain";
import { prisma } from "@/lib/db/client";

export type PendingActor = {
  id: string;
  email: string;
  role: UserRole;
  sector: Sector;
};

export type PendencyGap = {
  id: string;
  question: string;
  rationale: string;
  priority: string;
  sector: string;
  processName: string;
  targetDocumentTitle: string | null;
  topic: string | null;
  createdAt: string;
  href: string;
};

export type PendencyCorrection = {
  id: string;
  sector: string;
  documentId: string;
  chunkIndex: number;
  createdAt: string;
  href: string;
};

export type PendencyUnanswered = {
  id: string;
  sector: string;
  question: string;
  createdAt: string;
  href: string;
};

export type PendencyOverview = {
  ownerTopics: Array<{ topic: string; sector: string }>;
  counts: {
    gaps: number;
    corrections: number;
    unanswered: number;
    total: number;
  };
  gaps: PendencyGap[];
  corrections: PendencyCorrection[];
  unanswered: PendencyUnanswered[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function sectorFromPayload(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }
  return textValue(payload.sector);
}

function questionFromPayload(payload: unknown) {
  if (!isRecord(payload)) {
    return "(pergunta nao registrada)";
  }
  return textValue(payload.question) ?? "(pergunta nao registrada)";
}

export async function loadPendencyOverviewForActor(
  actor: PendingActor,
  options: { now?: Date; baseUrl?: string; take?: number } = {},
): Promise<PendencyOverview> {
  const take = options.take ?? 50;
  const since = new Date(options.now ?? new Date());
  since.setDate(since.getDate() - 7);

  const [ownerRows, ownedDocuments] = await Promise.all([
    prisma.knowledgeOwner.findMany({
      where: { userEmail: actor.email },
      orderBy: [{ sector: "asc" }, { topic: "asc" }],
      select: { topic: true, sector: true },
    }),
    prisma.curationDocument.findMany({
      where: { owner: actor.email },
      distinct: ["sector"],
      select: { sector: true },
    }),
  ]);

  const scopedSectors = new Set<string>([
    ...ownerRows.map((row) => row.sector),
    ...ownedDocuments.map((row) => row.sector),
  ]);

  if (scopedSectors.size === 0) {
    return {
      ownerTopics: [],
      counts: { gaps: 0, corrections: 0, unanswered: 0, total: 0 },
      gaps: [],
      corrections: [],
      unanswered: [],
    };
  }

  const topicsBySector = new Map<string, Set<string>>();
  for (const owner of ownerRows) {
    const topics = topicsBySector.get(owner.sector) ?? new Set<string>();
    topics.add(owner.topic);
    topicsBySector.set(owner.sector, topics);
  }

  const sectors = Array.from(scopedSectors).filter(isNativeSector);
  if (sectors.length === 0) {
    return {
      ownerTopics: ownerRows.map((row) => ({
        topic: row.topic,
        sector: row.sector,
      })),
      counts: { gaps: 0, corrections: 0, unanswered: 0, total: 0 },
      gaps: [],
      corrections: [],
      unanswered: [],
    };
  }
  const [rawGaps, corrections, unansweredEvents] = await Promise.all([
    prisma.processGapQuestion.findMany({
      where: {
        status: "promoted",
        processMap: { sector: { in: sectors } },
      },
      include: {
        processMap: { select: { name: true, sector: true } },
        targetCurationDocument: {
          select: {
            id: true,
            documentTitle: true,
            topic: true,
          },
        },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: Math.max(take * 2, 100),
    }),
    prisma.chunkFeedback.findMany({
      where: {
        sector: { in: sectors },
        status: "PENDING",
      },
      orderBy: { createdAt: "asc" },
      take,
      select: {
        id: true,
        sector: true,
        documentId: true,
        chunkIndex: true,
        createdAt: true,
      },
    }),
    prisma.auditEvent.findMany({
      where: {
        eventType: "agent.unanswered",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 250,
      select: {
        id: true,
        payload: true,
        createdAt: true,
      },
    }),
  ]);

  const gaps = rawGaps
    .filter((gap) => {
      const sector = gap.processMap.sector;
      const topic = gap.targetCurationDocument?.topic?.trim() || null;
      const ownerTopics = topicsBySector.get(sector);

      if (!topic) {
        return scopedSectors.has(sector);
      }

      return ownerTopics?.has(topic) === true;
    })
    .slice(0, take)
    .map((gap): PendencyGap => ({
      id: gap.id,
      question: gap.question,
      rationale: gap.rationale,
      priority: gap.priority,
      sector: gap.processMap.sector,
      processName: gap.processMap.name,
      targetDocumentTitle: gap.targetCurationDocument?.documentTitle ?? null,
      topic: gap.targetCurationDocument?.topic ?? null,
      createdAt: gap.createdAt.toISOString(),
      href: `/admin/curation?gap=${encodeURIComponent(gap.id)}`,
    }));

  const unanswered = unansweredEvents
    .map((event) => {
      const sector = sectorFromPayload(event.payload);
      if (!sector || !scopedSectors.has(sector)) {
        return null;
      }

      return {
        id: event.id,
        sector,
        question: questionFromPayload(event.payload),
        createdAt: event.createdAt.toISOString(),
        href: `/admin/governance?tab=feedback&value=unanswered`,
      } satisfies PendencyUnanswered;
    })
    .filter((item): item is PendencyUnanswered => item !== null)
    .slice(0, take);

  const mappedCorrections = corrections.map((correction): PendencyCorrection => ({
    id: correction.id,
    sector: correction.sector,
    documentId: correction.documentId,
    chunkIndex: correction.chunkIndex,
    createdAt: correction.createdAt.toISOString(),
    href: `/admin/governance?tab=corrections&status=PENDING`,
  }));

  const counts = {
    gaps: gaps.length,
    corrections: mappedCorrections.length,
    unanswered: unanswered.length,
    total: gaps.length + mappedCorrections.length + unanswered.length,
  };

  return {
    ownerTopics: ownerRows.map((row) => ({
      topic: row.topic,
      sector: row.sector,
    })),
    counts,
    gaps,
    corrections: mappedCorrections,
    unanswered,
  };
}
