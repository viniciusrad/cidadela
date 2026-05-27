import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  approvalGateFromApprovals,
  canEditCurationDocument,
  findCurationDocumentForActor,
  hasRequiredApprovals,
  metadataFromDocument,
  questionsFromReview,
  recomputeReadiness,
  splitCurationQuestions,
  statusForReadiness,
  toJsonInput,
} from "@/lib/curation/documents";
import { createAuditEvent } from "@/lib/db/audit-repo";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

function metadataUpdate(questionId: string, response: string) {
  if (questionId === "metadata_title") {
    return { documentTitle: response };
  }

  if (questionId === "metadata_owner") {
    return { owner: response };
  }

  if (questionId === "metadata_sensitivity") {
    return { sensitivity: response };
  }

  if (questionId === "metadata_effective_from") {
    const parsed = new Date(response);
    if (!Number.isNaN(parsed.getTime())) {
      return { effectiveFrom: parsed };
    }
  }

  return {};
}

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const { documentId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    questionId?: unknown;
    response?: unknown;
  };
  const questionId =
    typeof body.questionId === "string" ? body.questionId.trim() : "";
  const answer = typeof body.response === "string" ? body.response.trim() : "";

  if (!questionId || !answer) {
    return jsonError("Informe questionId e response.");
  }

  const document = await findCurationDocumentForActor(documentId, session.user);
  if (!document) {
    return jsonError("Documento nao encontrado.", 404);
  }

  if (!canEditCurationDocument(document, session.user)) {
    return jsonError("Sem permissao para responder a curadoria deste documento.", 403);
  }

  if (document.status === "PROMOTED") {
    return jsonError(
      "Documento ja promovido. Envie uma nova revisao para alterar o conteudo em producao.",
      409,
    );
  }

  const questions = questionsFromReview(document.reviews[0]);
  const existingQuestion = questions.find((question) => question.id === questionId);
  if (!existingQuestion) {
    return jsonError("Pergunta de curadoria nao encontrada.", 404);
  }

  const responseChanged = (existingQuestion.response?.trim() ?? "") !== answer;
  const nextQuestions = questions.map((question) =>
    question.id === questionId
      ? { ...question, response: answer, isDefault: false }
      : question,
  );

  const update = metadataUpdate(questionId, answer);
  const updatedDocument = await prisma.curationDocument.update({
    where: { id: document.id },
    data: update,
  });
  const metadata = metadataFromDocument(updatedDocument);
  const readinessInput = recomputeReadiness({
    documentType: updatedDocument.documentType,
    metadata,
    markdown: updatedDocument.normalizedMarkdown,
    questions: nextQuestions,
  });
  const { derivedQuestions } = splitCurationQuestions(nextQuestions);
  const questionsToStore = [...readinessInput.questions, ...derivedQuestions];
  const approvalsInvalidated = responseChanged && document.approvals.length > 0;
  const statusAfterReadiness = statusForReadiness(readinessInput.readiness.score);
  const nextStatus =
    !responseChanged &&
    document.status === "APPROVED" &&
    hasRequiredApprovals(document.approvals)
      ? "APPROVED"
      : statusAfterReadiness;

  await prisma.curationDocument.update({
    where: { id: document.id },
    data: {
      status: nextStatus,
      sopReadinessScore: readinessInput.readiness.score,
      curationReadinessScore: readinessInput.readiness.score,
      curationProfile: toJsonInput({
        documentType: updatedDocument.documentType,
        missing: readinessInput.readiness.missing,
      }),
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
  if (approvalsInvalidated) {
    await prisma.documentApproval.deleteMany({
      where: { curationDocumentId: document.id },
    });
  }

  const traceId = randomUUID();
  await createAuditEvent({
    traceId,
    actorType: "user",
    actorId: session.user.id,
    targetType: "document",
    targetId: document.documentId,
    eventType: "document.question_answered",
    payload: {
      documentId: document.documentId,
      questionId,
      actorId: session.user.id,
    },
  });
  await createAuditEvent({
    traceId,
    actorType: "system",
    actorId: "curation",
    targetType: "document",
    targetId: document.documentId,
    eventType: "document.readiness_recomputed",
    payload: {
      documentId: document.documentId,
      score: readinessInput.readiness.score,
      missing: readinessInput.readiness.missing,
    },
  });
  if (approvalsInvalidated) {
    await createAuditEvent({
      traceId,
      actorType: "system",
      actorId: "curation",
      targetType: "document",
      targetId: document.documentId,
      eventType: "document.approvals_invalidated",
      payload: {
        documentId: document.documentId,
        questionId,
        approvalsRemoved: document.approvals.length,
      },
    });
  }

  return Response.json({
    documentId: document.documentId,
    status: nextStatus,
    sopReadinessScore: readinessInput.readiness.score,
    curationReadinessScore: readinessInput.readiness.score,
    missingReadiness: readinessInput.readiness.missing,
    questions: questionsToStore,
    approvalsInvalidated,
    approvalGate: approvalGateFromApprovals(approvalsInvalidated ? [] : document.approvals),
  });
}
