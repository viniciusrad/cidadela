import type { Sector } from "@prisma/client";

import { isSector } from "@/lib/config";
import { prisma } from "@/lib/db/client";
import { normalizeSensitivity } from "@/lib/sensitivity";

export const SHAREABLE_SENSITIVITIES = ["public", "internal"] as const;

export type ShareableSensitivity = (typeof SHAREABLE_SENSITIVITIES)[number];

export type KnowledgeCapabilityCandidate = {
  sector: Sector;
  sourceDocumentId: string;
  documentTitle: string;
  topic?: string | null;
  sensitivity?: string | null;
  capabilityText: string;
};

export type KnowledgeTargetMatch = {
  sector: Sector;
  score: number;
  sourceDocumentIds: string[];
  rationale: string;
};

function isShareableSensitivity(value: string | null | undefined) {
  return SHAREABLE_SENSITIVITIES.includes(
    normalizeSensitivity(value) as ShareableSensitivity,
  );
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenize(value: string) {
  return Array.from(new Set(normalize(value).match(/[a-z0-9]{2,}/g) ?? []));
}

function technicalTokens(value: string) {
  return Array.from(
    new Set(
      value.match(/\b[a-zA-Z]{1,8}\d{2,}[a-zA-Z0-9]*\b/g)?.map((token) =>
        normalize(token),
      ) ?? [],
    ),
  );
}

function buildCapabilityText(input: {
  documentTitle: string;
  topic: string | null;
  owner: string | null;
  sensitivity: string;
  documentType?: string | null;
  normalizedMarkdown: string;
}) {
  const signals = technicalTokens(input.normalizedMarkdown).slice(0, 80);
  return [
    input.documentTitle,
    input.topic ?? "",
    input.owner ?? "",
    input.sensitivity,
    input.documentType ?? "",
    signals.join(" "),
    input.normalizedMarkdown.slice(0, 12000),
  ]
    .filter(Boolean)
    .join("\n");
}

function scoreCandidate(question: string, candidate: KnowledgeCapabilityCandidate) {
  if (!isShareableSensitivity(candidate.sensitivity)) {
    return 0;
  }

  const normalizedCapability = normalize(candidate.capabilityText);
  const queryTokens = tokenize(question).filter((token) => token.length >= 3);
  const queryTechnicalTokens = technicalTokens(question);

  let score = 0;
  let technicalMatches = 0;
  for (const token of queryTokens) {
    if (normalizedCapability.includes(token)) {
      score += token.length >= 5 ? 2 : 1;
    }
  }

  for (const token of queryTechnicalTokens) {
    if (normalizedCapability.includes(token)) {
      score += 8;
      technicalMatches += 1;
    }
  }

  if (queryTechnicalTokens.length > 0 && technicalMatches === 0) {
    return 0;
  }

  return score;
}

export function rankShareableKnowledgeTargets(
  origin: Sector,
  question: string,
  candidates: KnowledgeCapabilityCandidate[],
  allowedTargets: Sector[],
): KnowledgeTargetMatch | null {
  const allowed = new Set(allowedTargets);
  const perSector = new Map<
    Sector,
    { score: number; documents: KnowledgeCapabilityCandidate[] }
  >();

  for (const candidate of candidates) {
    if (candidate.sector === origin || !allowed.has(candidate.sector)) {
      continue;
    }

    const score = scoreCandidate(question, candidate);
    if (score < 2) {
      continue;
    }

    const current = perSector.get(candidate.sector) ?? {
      score: 0,
      documents: [],
    };
    current.score += score;
    current.documents.push(candidate);
    perSector.set(candidate.sector, current);
  }

  const best = Array.from(perSector.entries()).sort(
    (a, b) => b[1].score - a[1].score,
  )[0];

  if (!best) {
    return null;
  }

  const [sector, match] = best;
  const sourceDocumentIds = Array.from(
    new Set(
      match.documents
        .sort(
          (a, b) =>
            scoreCandidate(question, b) - scoreCandidate(question, a),
        )
        .slice(0, 5)
        .map((document) => document.sourceDocumentId),
    ),
  );

  const titles = match.documents
    .slice(0, 3)
    .map((document) => document.documentTitle)
    .join(", ");

  return {
    sector,
    score: match.score,
    sourceDocumentIds,
    rationale: `Catalogo compartilhaveis encontrou evidencia em ${sector}: ${titles}.`,
  };
}

export async function syncShareableKnowledgeCapabilities() {
  const maybePrisma = prisma as typeof prisma & {
    knowledgeCapability?: typeof prisma.knowledgeCapability;
  };

  if (!maybePrisma.knowledgeCapability) {
    return { synced: 0, skipped: true };
  }

  const documents = await prisma.curationDocument.findMany({
    where: {
      status: "PROMOTED",
      OR: [
        { sensitivity: { in: [...SHAREABLE_SENSITIVITIES] } },
        { sensitivity: null },
      ],
    },
    select: {
      documentId: true,
      sourceDocumentId: true,
      documentTitle: true,
      sector: true,
      topic: true,
      owner: true,
      sensitivity: true,
      documentType: true,
      normalizedMarkdown: true,
    },
  });

  const data = documents
    .filter(
      (document) =>
        isSector(document.sector) && isShareableSensitivity(document.sensitivity),
    )
    .map((document) => ({
      sector: document.sector as Sector,
      documentId: document.documentId,
      sourceDocumentId: document.sourceDocumentId,
      documentTitle: document.documentTitle,
      topic: document.topic,
      owner: document.owner,
      sensitivity: normalizeSensitivity(document.sensitivity),
      capabilityText: buildCapabilityText({
        documentTitle: document.documentTitle,
        topic: document.topic,
        owner: document.owner,
        sensitivity: normalizeSensitivity(document.sensitivity),
        documentType: document.documentType,
        normalizedMarkdown: document.normalizedMarkdown,
      }),
    }));

  await prisma.$transaction([
    prisma.knowledgeCapability.deleteMany({}),
    ...(data.length > 0
      ? [
          prisma.knowledgeCapability.createMany({
            data,
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  return { synced: data.length, skipped: false };
}

export async function listShareableSourceDocumentIds(sector: Sector) {
  const rows = await prisma.curationDocument.findMany({
    where: {
      sector,
      status: "PROMOTED",
      OR: [
        { sensitivity: { in: [...SHAREABLE_SENSITIVITIES] } },
        { sensitivity: null },
      ],
    },
    select: {
      sourceDocumentId: true,
    },
  });

  return rows.map((row) => row.sourceDocumentId);
}

export async function findShareableKnowledgeTarget(
  origin: Sector,
  question: string,
  allowedTargets: Sector[],
) {
  const maybePrisma = prisma as typeof prisma & {
    knowledgeCapability?: typeof prisma.knowledgeCapability;
  };

  if (!maybePrisma.knowledgeCapability || allowedTargets.length === 0) {
    return null;
  }

  let candidates = await prisma.knowledgeCapability.findMany({
    where: {
      sector: {
        in: allowedTargets,
      },
      sensitivity: {
        in: [...SHAREABLE_SENSITIVITIES],
      },
    },
    select: {
      sector: true,
      sourceDocumentId: true,
      documentTitle: true,
      topic: true,
      sensitivity: true,
      capabilityText: true,
    },
  });

  if (candidates.length === 0) {
    await syncShareableKnowledgeCapabilities();
    candidates = await prisma.knowledgeCapability.findMany({
      where: {
        sector: {
          in: allowedTargets,
        },
        sensitivity: {
          in: [...SHAREABLE_SENSITIVITIES],
        },
      },
      select: {
        sector: true,
        sourceDocumentId: true,
        documentTitle: true,
        topic: true,
        sensitivity: true,
        capabilityText: true,
      },
    });
  }

  return rankShareableKnowledgeTargets(
    origin,
    question,
    candidates,
    allowedTargets,
  );
}
