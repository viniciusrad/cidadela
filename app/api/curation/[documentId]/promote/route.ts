import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  canAdministerCurationDocument,
  findCurationDocumentForActor,
  hasOpenCorrelationBlockersForDocument,
  hasRequiredApprovals,
  questionsFromReview,
} from "@/lib/curation/documents";
import {
  renderCuratedArtifactMarkdown,
  writeCuratedArtifactFile,
} from "@/lib/curation/renderers";
import { createAuditEvent } from "@/lib/db/audit-repo";
import { prisma } from "@/lib/db/client";
import { syncShareableKnowledgeCapabilities } from "@/lib/knowledge/capabilities";
import { notifyAskersOnPromotion } from "@/lib/notifications/unanswered";
import { prepareMarkdownDocument } from "@/lib/markdown";
import { getEmbedding } from "@/lib/ollama";
import {
  deleteStagedDocumentChunks,
  replaceSectorSourceDocumentChunks,
} from "@/lib/qdrant";
import { normalizeSensitivity } from "@/lib/sensitivity";
import { listAllSectorSlugs } from "@/lib/sectors/sector-repo";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

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

  if (!canAdministerCurationDocument(session.user)) {
    return jsonError("Promocao restrita a admin.", 403);
  }

  if (document.status !== "APPROVED") {
    return jsonError("Documento precisa estar APPROVED antes do promote.", 409);
  }

  if (hasOpenCorrelationBlockersForDocument(document)) {
    return jsonError(
      "Promote bloqueado: execute a correlacao e resolva achados high/critical antes de promover.",
      409,
    );
  }

  if (!hasRequiredApprovals(document.approvals)) {
    return jsonError("Aprovacoes obrigatorias ainda nao foram registradas.", 409);
  }

  const questions = questionsFromReview(document.reviews[0]).filter(
    (question) => question.source !== "inferred",
  );
  const rendered = renderCuratedArtifactMarkdown({ document, questions });
  const artifactPath = await writeCuratedArtifactFile({
    sector: document.sector,
    sourceDocumentId: document.sourceDocumentId,
    documentType: rendered.documentType,
    markdown: rendered.markdown,
  });
  const preparedArtifact = prepareMarkdownDocument({
    fileName: `${document.sourceDocumentId}.md`,
    markdown: rendered.markdown,
    relativePath: artifactPath,
    responsibleArea: document.sector,
    sourceFormat: "markdown",
    sourceOrigin: "upload",
    title: document.documentTitle,
  });
  const chunksWithVectors = await Promise.all(
    preparedArtifact.chunks.map(async (chunk) => ({
      ...chunk,
      sourceDocumentId: document.sourceDocumentId,
      sensitivity: normalizeSensitivity(document.sensitivity),
      topic: document.topic,
      owner: document.owner,
      documentType: rendered.documentType,
      authorityLevel: document.authorityLevel,
      sourceType: rendered.sourceType,
      vector: await getEmbedding(chunk.content),
    })),
  );

  await replaceSectorSourceDocumentChunks(
    document.sector,
    document.sourceDocumentId,
    chunksWithVectors,
  );
  const allSectorSlugs = await listAllSectorSlugs();
  await Promise.all(
    allSectorSlugs.filter((sector) => sector !== document.sector).flatMap((sector) => [
      replaceSectorSourceDocumentChunks(sector, document.sourceDocumentId, []),
      deleteStagedDocumentChunks(sector, document.sourceDocumentId),
    ]),
  );
  await deleteStagedDocumentChunks(document.sector, document.sourceDocumentId);

  await prisma.curationDocument.update({
    where: { id: document.id },
    data: {
      status: "PROMOTED",
      promotedAt: new Date(),
      sopPath: artifactPath,
    },
  });
  await prisma.curationDocument.deleteMany({
    where: {
      documentId: document.documentId,
      id: { not: document.id },
    },
  });
  await syncShareableKnowledgeCapabilities();

  // Best-effort: notify the authors of any unanswered questions this document
  // resolves. A failure here must never block the promotion result.
  try {
    await notifyAskersOnPromotion(document.id);
  } catch (notifyError) {
    console.error("[/api/curation/promote] failed to notify askers", {
      documentId: document.id,
      message:
        notifyError instanceof Error ? notifyError.message : String(notifyError),
    });
  }

  await createAuditEvent({
    traceId: randomUUID(),
    actorType: "user",
    actorId: session.user.id,
    targetType: "document",
    targetId: document.documentId,
    eventType: "document.promoted",
    payload: {
      documentId: document.documentId,
      sourceDocumentId: document.sourceDocumentId,
      artifactPath,
      documentType: rendered.documentType,
      sourceType: rendered.sourceType,
      chunksCreated: preparedArtifact.chunks.length,
      replacedSourceDocumentId: document.sourceDocumentId,
    },
  });

  return Response.json({
    documentId: document.documentId,
    status: "PROMOTED",
    artifactPath,
    sopPath: artifactPath,
    documentType: rendered.documentType,
    sourceType: rendered.sourceType,
    chunksCreated: preparedArtifact.chunks.length,
  });
}
