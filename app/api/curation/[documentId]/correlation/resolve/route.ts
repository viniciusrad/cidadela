import { randomUUID } from "node:crypto";

import type { DocumentStatus } from "@prisma/client";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  correlationGateFromRun,
  resolveCorrelationFinding,
} from "@/lib/curation/correlation";
import {
  canEditCurationDocument,
  findCurationDocumentForActor,
  latestCorrelationRun,
  metadataFromDocument,
  questionsFromReview,
  recomputeReadiness,
  splitCurationQuestions,
  statusForReadiness,
  toJsonInput,
} from "@/lib/curation/documents";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const { documentId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    findingId?: unknown;
    answer?: unknown;
    decision?: unknown;
  };
  const findingId =
    typeof body.findingId === "string" ? body.findingId.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  const decision =
    typeof body.decision === "string" ? body.decision.trim() : "validated";

  if (!findingId || !answer) {
    return jsonError("Informe findingId e answer.");
  }

  if (
    decision !== "validated" &&
    decision !== "dismissed" &&
    decision !== "revised_staging"
  ) {
    return jsonError("decision invalida.");
  }

  const document = await findCurationDocumentForActor(documentId, session.user);

  if (!document) {
    return jsonError("Documento nao encontrado.", 404);
  }

  if (!canEditCurationDocument(document, session.user)) {
    return jsonError("Sem permissao para resolver a correlacao.", 403);
  }

  if (document.status === "PROMOTED") {
    return jsonError("Documento promovido nao pode ter staging alterado.", 409);
  }

  const run = latestCorrelationRun(document);
  if (!run) {
    return jsonError("Execute a correlacao antes de resolver achados.", 409);
  }

  const updatedRun = await resolveCorrelationFinding({
    document,
    run,
    findingId,
    actorId: session.user.id,
    answer,
    decision,
    traceId: randomUUID(),
  });
  let nextStatus: DocumentStatus | undefined;
  let sopReadinessScore: number | undefined;
  let curationReadinessScore: number | undefined;

  if (decision === "revised_staging") {
    const updatedDocument = await findCurationDocumentForActor(
      documentId,
      session.user,
    );

    if (updatedDocument) {
      const currentQuestions = questionsFromReview(updatedDocument.reviews[0]);
      const readinessInput = recomputeReadiness({
        documentType: updatedDocument.documentType,
        metadata: metadataFromDocument(updatedDocument),
        markdown: updatedDocument.normalizedMarkdown,
        questions: currentQuestions,
      });
      const { derivedQuestions } = splitCurationQuestions(currentQuestions);
      const questionsToStore = [...readinessInput.questions, ...derivedQuestions];
      nextStatus = statusForReadiness(readinessInput.readiness.score);
      sopReadinessScore = readinessInput.readiness.score;
      curationReadinessScore = readinessInput.readiness.score;

      await prisma.curationDocument.update({
        where: { id: updatedDocument.id },
        data: {
          status: nextStatus,
          sopReadinessScore,
          curationReadinessScore,
          curationProfile: toJsonInput({
            documentType: updatedDocument.documentType,
            missing: readinessInput.readiness.missing,
          }),
        },
      });
      await prisma.documentReview.create({
        data: {
          curationDocumentId: updatedDocument.id,
          reviewedById: session.user.id,
          actorType: "human",
          questions: toJsonInput(questionsToStore),
          notes: "Readiness recalculado apos compatibilizacao de correlacao.",
        },
      });
    }
  }

  return Response.json({
    correlationGate: correlationGateFromRun(updatedRun),
    approvalsInvalidated: decision === "revised_staging",
    status: nextStatus,
    sopReadinessScore,
    curationReadinessScore,
  });
}
