import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  canAdministerCurationDocument,
  findCurationDocumentForActor,
} from "@/lib/curation/documents";
import { createAuditEvent } from "@/lib/db/audit-repo";
import { prisma } from "@/lib/db/client";
import { deleteStagedDocumentChunks } from "@/lib/qdrant";

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
    return jsonError("Descarte restrito a admin.", 403);
  }

  if (document.status !== "REJECTED") {
    return jsonError(
      "Somente documentos rejeitados podem ser descartados definitivamente.",
      409,
    );
  }

  await deleteStagedDocumentChunks(document.sector, document.sourceDocumentId);

  await createAuditEvent({
    traceId: randomUUID(),
    actorType: "user",
    actorId: session.user.id,
    targetType: "document",
    targetId: document.documentId,
    eventType: "document.discarded",
    payload: {
      documentId: document.documentId,
      sourceDocumentId: document.sourceDocumentId,
      sector: document.sector,
      actorId: session.user.id,
    },
  });

  await prisma.curationDocument.delete({
    where: { id: document.id },
  });

  return Response.json({
    documentId: document.documentId,
    discarded: true,
  });
}
