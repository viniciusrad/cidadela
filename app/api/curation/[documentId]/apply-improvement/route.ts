import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { createAuditEvent } from "@/lib/db/audit-repo";
import { prisma } from "@/lib/db/client";
import {
  canEditCurationDocument,
  findCurationDocumentForActor,
} from "@/lib/curation/documents";
import {
  type DocumentSourceFormat,
  prepareMarkdownDocument,
  sha256,
} from "@/lib/markdown";
import { getEmbedding } from "@/lib/ollama";
import { replaceStagedSourceDocumentChunks } from "@/lib/qdrant";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

function sourceFormat(value: string): DocumentSourceFormat {
  if (value === "docx" || value === "doc" || value === "pdf") {
    return value;
  }

  return "markdown";
}

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const { documentId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    content?: unknown;
  };
  const content =
    typeof body.content === "string" ? body.content.trim() : "";

  if (!content) {
    return jsonError("Conteudo nao pode estar vazio.", 400);
  }

  const document = await findCurationDocumentForActor(documentId, session.user);

  if (!document) {
    return jsonError("Documento nao encontrado.", 404);
  }

  if (!canEditCurationDocument(document, session.user)) {
    return jsonError("Sem permissao para editar este documento.", 403);
  }

  if (document.status === "PROMOTED") {
    return jsonError(
      "Documento ja promovido para producao nao pode ser alterado.",
      409,
    );
  }

  const prepared = prepareMarkdownDocument({
    fileName: document.fileName,
    markdown: content,
    relativePath: document.relativePath ?? undefined,
    responsibleArea: document.sector,
    sourceFormat: sourceFormat(document.sourceFormat),
    sourceOrigin: "upload",
    title: document.documentTitle,
  });

  const chunksWithVectors = await Promise.all(
    prepared.chunks.map(async (chunk) => ({
      ...chunk,
      sourceDocumentId: document.sourceDocumentId,
      vector: await getEmbedding(chunk.content),
    })),
  );

  await replaceStagedSourceDocumentChunks(
    document.sector,
    document.sourceDocumentId,
    chunksWithVectors,
  );

  const newHash = sha256(content);

  await prisma.curationDocument.update({
    where: { id: document.id },
    data: {
      normalizedMarkdown: content,
      contentHash: newHash,
      status: "NEEDS_REVISION",
    },
  });

  await prisma.documentApproval.deleteMany({
    where: { curationDocumentId: document.id },
  });
  await prisma.documentCorrelationRun.deleteMany({
    where: { curationDocumentId: document.id },
  });

  const traceId = randomUUID();

  await createAuditEvent({
    traceId,
    actorType: "user",
    actorId: session.user.id,
    targetType: "document",
    targetId: document.documentId,
    eventType: "document.improvement_applied",
    payload: {
      documentId: document.documentId,
      sector: document.sector,
      contentLength: content.length,
      chunks: chunksWithVectors.length,
      approvalsInvalidated: document.approvals.length,
      correlationsInvalidated: document.correlationRuns.length,
    },
  });

  return Response.json({ ok: true, chunks: chunksWithVectors.length });
}
