import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
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
import { inferTemplateAnswers } from "@/lib/curation/inference";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

function metadataUpdate(questionId: string, answer: string) {
  if (questionId === "metadata_title") return { documentTitle: answer };
  if (questionId === "metadata_owner") return { owner: answer };
  if (questionId === "metadata_sensitivity") return { sensitivity: answer };
  if (questionId === "metadata_effective_from") {
    const parsed = new Date(answer);
    if (!Number.isNaN(parsed.getTime())) return { effectiveFrom: parsed };
  }

  return {};
}

export async function POST(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const { documentId } = await context.params;
  const document = await findCurationDocumentForActor(documentId, session.user);
  if (!document) {
    return jsonError("Documento nao encontrado.", 404);
  }

  if (!canEditCurationDocument(document, session.user)) {
    return jsonError("Sem permissao.", 403);
  }

  if (document.status === "PROMOTED") {
    return Response.json({ answeredQuestions: [] });
  }

  const questions = questionsFromReview(document.reviews[0]);
  const { templateQuestions } = splitCurationQuestions(questions);
  const unanswered = templateQuestions.filter((q) => !q.response?.trim());

  if (!unanswered.length) {
    return Response.json({ answeredQuestions: [] });
  }

  const inferred = await inferTemplateAnswers({
    questions: unanswered,
    markdown: document.normalizedMarkdown,
    title: document.documentTitle,
    sector: document.sector,
  });

  if (!inferred.length) {
    return Response.json({ answeredQuestions: [] });
  }

  // Apply inferred answers one by one, accumulating document state
  let currentDocument = document;
  let currentQuestions = questions;

  for (const { questionId, answer } of inferred) {
    const exists = currentQuestions.find((q) => q.id === questionId);
    if (!exists) continue;

    const nextQuestions = currentQuestions.map((q) =>
      q.id === questionId ? { ...q, response: answer, isDefault: true } : q,
    );

    const metaUpdate = metadataUpdate(questionId, answer);
    if (Object.keys(metaUpdate).length > 0) {
      currentDocument = await prisma.curationDocument.update({
        where: { id: document.id },
        data: metaUpdate,
        include: {
          reviews: { orderBy: { createdAt: "desc" }, take: 1 },
          approvals: true,
          correlationRuns: { orderBy: { createdAt: "desc" }, take: 1 },
          uploadedBy: { select: { email: true } },
        },
      });
    }

    currentQuestions = nextQuestions;
  }

  const metadata = metadataFromDocument(currentDocument);
  const readinessInput = recomputeReadiness({
    documentType: currentDocument.documentType,
    metadata,
    markdown: currentDocument.normalizedMarkdown,
    questions: currentQuestions,
  });
  const { derivedQuestions } = splitCurationQuestions(currentQuestions);
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
      actorType: "system",
      questions: toJsonInput(questionsToStore),
    },
  });

  const answeredIds = new Set(inferred.map((i) => i.questionId));
  const answeredQuestions = questionsToStore
    .filter((q) => answeredIds.has(q.id))
    .map((q) => ({ id: q.id, prompt: q.prompt, answer: q.response ?? "" }));

  return Response.json({
    answeredQuestions,
    status: nextStatus,
    sopReadinessScore: readinessInput.readiness.score,
    curationReadinessScore: readinessInput.readiness.score,
    questions: questionsToStore,
    approvalGate: approvalGateFromApprovals(currentDocument.approvals),
  });
}
