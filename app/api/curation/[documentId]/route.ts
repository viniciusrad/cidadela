import { readFile } from "node:fs/promises";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  approvalGateFromApprovals,
  findCurationDocumentForActor,
  latestCorrelationRun,
  questionsFromReview,
} from "@/lib/curation/documents";
import { correlationGateFromRun } from "@/lib/curation/correlation";
import { listStagedDocumentChunks } from "@/lib/qdrant";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const { documentId } = await context.params;
  const document = await findCurationDocumentForActor(documentId, session.user);

  if (!document) {
    return jsonError("Documento nao encontrado.", 404);
  }

  const chunks = await listStagedDocumentChunks(
    document.sector,
    document.sourceDocumentId,
  );
  const promotedMarkdown = await readPromotedMarkdown(document.sopPath);

  return Response.json({
    document: {
      id: document.id,
      documentId: document.documentId,
      sourceDocumentId: document.sourceDocumentId,
      documentTitle: document.documentTitle,
      fileName: document.fileName,
      relativePath: document.relativePath,
      sector: document.sector,
      status: document.status,
      sopReadinessScore: document.sopReadinessScore,
      curationReadinessScore: document.curationReadinessScore,
      documentType: document.documentType,
      classificationSource: document.classificationSource,
      classificationConfidence: document.classificationConfidence,
      authorityLevel: document.authorityLevel,
      owner: document.owner,
      topic: document.topic,
      sensitivity: document.sensitivity,
      effectiveFrom: document.effectiveFrom,
      sopPath: document.sopPath,
      uploadedAt: document.uploadedAt,
      uploaderEmail: document.uploadedBy?.email ?? null,
      normalizedMarkdown: document.normalizedMarkdown,
      promotedMarkdown,
    },
    chunks,
    questions: questionsFromReview(document.reviews[0]),
    correlationGate: correlationGateFromRun(latestCorrelationRun(document)),
    approvalGate: approvalGateFromApprovals(document.approvals),
    approvals: document.approvals.map((approval) => ({
      id: approval.id,
      approverRole: approval.approverRole,
      decision: approval.decision,
      reason: approval.reason,
      createdAt: approval.createdAt,
    })),
  });
}

async function readPromotedMarkdown(sopPath: string | null) {
  if (!sopPath) {
    return null;
  }

  try {
    return await readFile(sopPath, "utf8");
  } catch {
    return null;
  }
}
