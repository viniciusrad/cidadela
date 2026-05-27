import { randomUUID } from "node:crypto";

import { classifyDocument } from "@/lib/document-classifier";
import { createAuditEvent } from "@/lib/db/audit-repo";
import { prisma } from "@/lib/db/client";
import {
  isDocumentType,
  normalizeDocumentType,
  type ClassificationSource,
} from "@/lib/document-types";
import type { parseCurationFrontmatter } from "@/lib/frontmatter";
import type { PreparedDocument } from "@/lib/markdown";
import { getEmbedding } from "@/lib/ollama";
import { replaceStagedDocumentChunks } from "@/lib/qdrant";
import { normalizeSensitivity } from "@/lib/sensitivity";
import { inferAdditionalQuestions } from "./inference";
import { applyQuestionDefaults } from "./question-defaults";
import { recomputeReadiness, statusForReadiness, toJsonInput } from "./documents";

type Frontmatter = ReturnType<typeof parseCurationFrontmatter>;

export type CreateStagedCurationDocumentParams = {
  prepared: PreparedDocument;
  frontmatter: Frontmatter;
  fileName: string;
  detectedFormat: string;
  relativePath?: string | null;
  targetSector: string;
  uploadedById: string;
  fileSizeBytes: number;
  traceId: string;
  rawDocumentType?: unknown;
  rawClassificationConfidence?: unknown;
};

export type CreateStagedCurationDocumentResult = {
  document: Awaited<ReturnType<typeof prisma.curationDocument.create>>;
  documentId: string;
  documentTitle: string;
  sector: string;
  status: string;
  readinessScore: number;
  missingReadiness: string[];
  documentType: string;
  authorityLevel: string;
  classificationSource: ClassificationSource;
  classificationConfidence: number;
  chunksCreated: number;
  questions: ReturnType<typeof applyQuestionDefaults>;
};

/**
 * Persist a STAGED curation document from an already-prepared markdown
 * document. Shared by the file upload route and the "answer an unanswered
 * question" route so both land in `rag_<sector>_staging` + Postgres through the
 * exact same pipeline (classify → readiness → questions → embed → review).
 *
 * Frontmatter parsing and the upload-only sector-mismatch validation stay in
 * the caller; this helper assumes the destination sector is already authorized.
 */
export async function createStagedCurationDocument(
  params: CreateStagedCurationDocumentParams,
): Promise<CreateStagedCurationDocumentResult> {
  const {
    prepared,
    frontmatter,
    fileName,
    detectedFormat,
    relativePath,
    targetSector,
    uploadedById,
    fileSizeBytes,
    traceId,
    rawDocumentType,
    rawClassificationConfidence,
  } = params;

  const classification = classifyDocument({
    fileName,
    markdown: prepared.normalizedMarkdown,
    frontmatter: frontmatter.metadata,
  });
  const documentType = normalizeDocumentType(
    isDocumentType(rawDocumentType) ? rawDocumentType : classification.documentType,
  );
  const classificationSource: ClassificationSource = isDocumentType(rawDocumentType)
    ? "human"
    : "heuristic";
  const parsedConfidence =
    typeof rawClassificationConfidence === "string"
      ? Number(rawClassificationConfidence)
      : Number.NaN;
  const classificationConfidence = Number.isFinite(parsedConfidence)
    ? Math.max(0, Math.min(1, parsedConfidence))
    : classification.confidence;
  const authorityLevel = documentType === "sop" ? "authoritative" : "draft";

  const knowledgeExtraction = {
    documentType,
    authorityLevel,
    summary: classification.title ?? frontmatter.metadata.title ?? prepared.metadata.title ?? "",
    keyFacts: classification.signals,
    decisions: [],
    actions: [],
    rules: [],
    systems: [],
    processSteps: [],
    risks: [],
    openQuestions: [] as string[],
    automationCandidates: classification.automationCandidates,
  };

  const metadata = {
    ...frontmatter.metadata,
    title:
      frontmatter.metadata.title ??
      classification.title ??
      prepared.metadata.title,
    sector: targetSector,
    sensitivity: normalizeSensitivity(frontmatter.metadata.sensitivity),
    topic: frontmatter.metadata.topic ?? classification.topic,
  };
  const readinessInput = recomputeReadiness({
    documentType,
    metadata,
    markdown: prepared.normalizedMarkdown,
    questions: [],
  });
  const questionsWithDefaults = applyQuestionDefaults(readinessInput.questions, {
    sector: targetSector,
    title: metadata.title,
  });
  const inferredQuestions = await inferAdditionalQuestions({
    documentType,
    sector: targetSector,
    title: metadata.title,
    markdown: prepared.normalizedMarkdown,
    existingQuestions: questionsWithDefaults,
  });
  const allQuestions = [...questionsWithDefaults, ...inferredQuestions];
  knowledgeExtraction.openQuestions = readinessInput.readiness.missing;
  const nextStatus = statusForReadiness(readinessInput.readiness.score);

  const chunksWithVectors = await Promise.all(
    prepared.chunks.map(async (chunk) => ({
      ...chunk,
      sensitivity: metadata.sensitivity,
      topic: metadata.topic,
      owner: metadata.owner,
      documentType,
      authorityLevel,
      vector: await getEmbedding(chunk.content),
    })),
  );

  const existingDocuments = await prisma.curationDocument.findMany({
    where: { documentId: prepared.documentId },
    orderBy: { uploadedAt: "desc" },
  });
  const existingDocument =
    existingDocuments.find((document) => document.sector === targetSector) ??
    existingDocuments[0];
  const baseDocumentData = {
    documentId: prepared.documentId,
    sourceDocumentId: prepared.documentId,
    fileName,
    relativePath,
    documentTitle: metadata.title ?? prepared.metadata.title,
    sourceFormat: detectedFormat,
    sector: targetSector,
    uploadedById,
    uploadedAt: new Date(),
    contentHash: prepared.documentId,
    fileSizeBytes,
    normalizedMarkdown: prepared.normalizedMarkdown,
    effectiveFrom: metadata.effectiveFrom,
    supersedes: metadata.supersedes,
    owner: metadata.owner,
    sensitivity: metadata.sensitivity,
    topic: metadata.topic,
    documentType,
    classificationSource,
    classificationConfidence,
    authorityLevel,
    curationReadinessScore: readinessInput.readiness.score,
    curationProfile: toJsonInput({
      documentType,
      missing: readinessInput.readiness.missing,
    }),
    knowledgeExtraction: toJsonInput(knowledgeExtraction),
    status: nextStatus,
    sopReadinessScore: readinessInput.readiness.score,
    promotedAt: null,
    sopPath: null,
    rejectedAt: null,
    rejectionReason: null,
  };
  const document = existingDocument
    ? await prisma.curationDocument.update({
        where: { id: existingDocument.id },
        data: baseDocumentData,
      })
    : await prisma.curationDocument.create({
        data: baseDocumentData,
      });
  if (existingDocument) {
    await prisma.documentApproval.deleteMany({
      where: { curationDocumentId: document.id },
    });
    await prisma.documentCorrelationRun.deleteMany({
      where: { curationDocumentId: document.id },
    });
  }

  await prisma.documentReview.create({
    data: {
      curationDocumentId: document.id,
      actorType: "agent",
      questions: toJsonInput(allQuestions),
      notes:
        frontmatter.issues.length > 0
          ? `Frontmatter com pendencias: ${frontmatter.issues
              .map((issue) => `${issue.field}: ${issue.message}`)
              .join("; ")}`
          : undefined,
    },
  });

  const maybePrisma = prisma as typeof prisma & {
    automationCandidate?: typeof prisma.automationCandidate;
  };
  if (
    maybePrisma.automationCandidate &&
    classification.automationCandidates.length > 0
  ) {
    await maybePrisma.automationCandidate.deleteMany({
      where: { curationDocumentId: document.id, status: "suggested" },
    });
    await maybePrisma.automationCandidate.createMany({
      data: classification.automationCandidates.map((candidate) => ({
        curationDocumentId: document.id,
        sector: targetSector,
        title: candidate.title,
        automationLevel: candidate.automationLevel,
        automationLabel: candidate.automationLabel,
        confidence: candidate.confidence,
        status: "suggested",
        payload: toJsonInput(candidate),
      })),
    });
  }

  await replaceStagedDocumentChunks(
    targetSector,
    prepared.documentId,
    chunksWithVectors,
  );

  await createAuditEvent({
    traceId,
    actorType: "user",
    actorId: uploadedById,
    targetType: "document",
    targetId: prepared.documentId,
    eventType: "document.uploaded",
    payload: {
      documentId: prepared.documentId,
      sector: targetSector,
      fileName,
      contentHash: prepared.documentId,
      fileSizeBytes,
      documentType,
      classificationSource,
      classificationConfidence,
    },
  });

  await createAuditEvent({
    traceId,
    actorType: "system",
    actorId: "curation",
    targetType: "document",
    targetId: prepared.documentId,
    eventType: "document.staged",
    payload: {
      documentId: prepared.documentId,
      chunksCreated: prepared.chunks.length,
      documentType,
    },
  });

  await createAuditEvent({
    traceId,
    actorType: "agent",
    actorId: "review-agent",
    targetType: "document",
    targetId: prepared.documentId,
    eventType: "document.review_questions_emitted",
    payload: {
      documentId: prepared.documentId,
      questions: allQuestions.map((question) => ({
        id: question.id,
        type: question.type,
      })),
      readinessScore: readinessInput.readiness.score,
      missing: readinessInput.readiness.missing,
      documentType,
    },
  });

  return {
    document,
    documentId: prepared.documentId,
    documentTitle: metadata.title ?? prepared.metadata.title,
    sector: targetSector,
    status: nextStatus,
    readinessScore: readinessInput.readiness.score,
    missingReadiness: readinessInput.readiness.missing,
    documentType,
    authorityLevel,
    classificationSource,
    classificationConfidence,
    chunksCreated: prepared.chunks.length,
    questions: allQuestions,
  };
}

/**
 * Link an unanswered question to the curation document that answers it and
 * flip it to the "answered" queue. Only transitions questions that are still
 * "open" so an already-resolved/dismissed item is never silently overwritten.
 * Returns the updated row, or null when the id is unknown or not open.
 */
export async function linkUnansweredToCuration(params: {
  unansweredQuestionId: string;
  curationDocumentId: string;
  resolvedById: string;
  answerType: "direct" | "upload";
  answerText?: string | null;
}) {
  const existing = await prisma.unansweredQuestion.findUnique({
    where: { id: params.unansweredQuestionId },
  });
  if (!existing || existing.status !== "open") {
    return null;
  }

  const updated = await prisma.unansweredQuestion.update({
    where: { id: existing.id },
    data: {
      status: "answered",
      answerType: params.answerType,
      answerText: params.answerText ?? null,
      resolvedById: params.resolvedById,
      resolvedAt: new Date(),
      curationDocumentId: params.curationDocumentId,
    },
  });

  await createAuditEvent({
    traceId: randomUUID(),
    actorType: "user",
    actorId: params.resolvedById,
    targetType: "unanswered_question",
    targetId: existing.id,
    eventType: "unanswered.answered",
    payload: {
      unansweredQuestionId: existing.id,
      curationDocumentId: params.curationDocumentId,
      answerType: params.answerType,
      sector: existing.sector,
    },
  });

  return updated;
}
