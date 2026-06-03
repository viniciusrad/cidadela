import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { createAuditEvent } from "@/lib/db/audit-repo";
import { prisma } from "@/lib/db/client";
import {
  approvalGateFromApprovals,
  canEditCurationDocument,
  findCurationDocumentForActor,
  metadataFromDocument,
  questionsFromReview,
  recomputeReadiness,
  splitCurationQuestions,
  statusForReadiness,
  toJsonInput,
} from "@/lib/curation/documents";
import { requiredCurationQuestions } from "@/lib/curation/profiles";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/document-types";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const { documentId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    documentType?: unknown;
  };

  const newType = body.documentType;
  if (typeof newType !== "string" || !(DOCUMENT_TYPES as readonly string[]).includes(newType)) {
    return jsonError("Tipo de documento invalido.", 400);
  }

  const document = await findCurationDocumentForActor(documentId, session.user);
  if (!document) {
    return jsonError("Documento nao encontrado.", 404);
  }

  if (!canEditCurationDocument(document, session.user)) {
    return jsonError("Sem permissao.", 403);
  }

  if (document.status === "PROMOTED") {
    return jsonError("Documento promovido nao pode ter tipo alterado.", 409);
  }

  const previousType = document.documentType;

  // Archive existing answers in a new review marked as archived, then build
  // questions for the new type preserving any still-applicable responses.
  const existingQuestions = questionsFromReview(document.reviews[0]);
  const metadata = metadataFromDocument(document);

  const updatedDocument = await prisma.curationDocument.update({
    where: { id: document.id },
    data: {
      documentType: newType as DocumentType,
      classificationSource: "human",
      classificationConfidence: 1,
      status: "NEEDS_REVISION",
    },
    include: {
      reviews: { orderBy: { createdAt: "desc" }, take: 1 },
      approvals: true,
      correlationRuns: { orderBy: { createdAt: "desc" }, take: 1 },
      uploadedBy: { select: { email: true } },
    },
  });

  await prisma.documentApproval.deleteMany({
    where: { curationDocumentId: document.id },
  });

  const newQuestions = requiredCurationQuestions(
    newType as DocumentType,
    metadata,
    existingQuestions,
  );

  const readinessInput = recomputeReadiness({
    documentType: newType as DocumentType,
    metadata,
    markdown: document.normalizedMarkdown,
    questions: newQuestions,
  });

  const { derivedQuestions } = splitCurationQuestions(newQuestions);
  const questionsToStore = [...readinessInput.questions, ...derivedQuestions];
  const nextStatus = statusForReadiness(readinessInput.readiness.score);

  await prisma.curationDocument.update({
    where: { id: document.id },
    data: {
      status: nextStatus,
      sopReadinessScore: readinessInput.readiness.score,
      curationReadinessScore: readinessInput.readiness.score,
    },
  });

  await prisma.documentReview.create({
    data: {
      curationDocumentId: document.id,
      reviewedById: session.user.id,
      actorType: "human",
      questions: toJsonInput(questionsToStore),
    },
  });

  await createAuditEvent({
    traceId: randomUUID(),
    actorType: "user",
    actorId: session.user.id,
    targetType: "document",
    targetId: document.documentId,
    eventType: "document.type_changed",
    payload: {
      documentId: document.documentId,
      sector: document.sector,
      previousType,
      newType,
      approvalsInvalidated: document.approvals.length,
    },
  });

  return Response.json({
    ok: true,
    documentType: newType,
    classificationSource: "human",
    status: nextStatus,
    sopReadinessScore: readinessInput.readiness.score,
    questions: questionsToStore,
    approvalGate: approvalGateFromApprovals(updatedDocument.approvals),
  });
}
