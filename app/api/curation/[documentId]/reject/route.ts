import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  canAdministerCurationDocument,
  findCurationDocumentForActor,
} from "@/lib/curation/documents";
import { createAuditEvent } from "@/lib/db/audit-repo";
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
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!reason) {
    return jsonError("Informe o motivo da rejeicao.");
  }

  const document = await findCurationDocumentForActor(documentId, session.user);
  if (!document) {
    return jsonError("Documento nao encontrado.", 404);
  }

  if (!canAdministerCurationDocument(session.user)) {
    return jsonError("Rejeicao restrita a admin.", 403);
  }

  await prisma.curationDocument.update({
    where: { id: document.id },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectionReason: reason,
    },
  });

  await createAuditEvent({
    traceId: randomUUID(),
    actorType: "user",
    actorId: session.user.id,
    targetType: "document",
    targetId: document.documentId,
    eventType: "document.rejected",
    payload: {
      documentId: document.documentId,
      reason,
      actorId: session.user.id,
    },
  });

  return Response.json({
    documentId: document.documentId,
    status: "REJECTED",
  });
}
