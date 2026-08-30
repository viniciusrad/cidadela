import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  canAdministerCurationDocument,
  canApproveAsOwner,
  findCurationDocumentForActor,
  hasRequiredApprovals,
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
  const body = (await request.json().catch(() => ({}))) as {
    role?: unknown;
    decision?: unknown;
    reason?: unknown;
  };
  const approverRole = typeof body.role === "string" ? body.role.trim() : "";
  const decision =
    typeof body.decision === "string" ? body.decision.trim() : "approved";
  const reason = typeof body.reason === "string" ? body.reason.trim() : undefined;

  if (approverRole !== "owner" && approverRole !== "admin") {
    return jsonError("role deve ser 'owner' ou 'admin'.");
  }

  if (
    decision !== "approved" &&
    decision !== "rejected" &&
    decision !== "requested_changes"
  ) {
    return jsonError("decision invalida.");
  }

  const document = await findCurationDocumentForActor(documentId, session.user);
  if (!document) {
    return jsonError("Documento nao encontrado.", 404);
  }

  if (document.status === "PROMOTED" || document.status === "REJECTED") {
    return jsonError("Documento nao aceita novas aprovacoes neste status.", 409);
  }

  if (approverRole === "admin") {
    if (!canAdministerCurationDocument(session.user)) {
      return jsonError("Aprovacao administrativa restrita a admin.", 403);
    }
  } else if (!(await canApproveAsOwner(document, session.user))) {
    return jsonError("Usuario nao e owner deste topico/setor.", 403);
  }

  const existingApproval =
    decision === "approved"
      ? document.approvals.find(
          (approval) =>
            approval.approverRole === approverRole &&
            approval.decision === "approved",
        )
      : undefined;

  if (existingApproval) {
    const nextStatus = hasRequiredApprovals(document.approvals)
      ? "APPROVED"
      : document.status;

    if (nextStatus !== document.status) {
      await prisma.curationDocument.update({
        where: { id: document.id },
        data: { status: nextStatus },
      });
    }

    return Response.json({
      documentId: document.documentId,
      status: nextStatus,
      approvalId: existingApproval.id,
      alreadyApproved: true,
    });
  }

  const approval = await prisma.documentApproval.create({
    data: {
      curationDocumentId: document.id,
      approverId: session.user.id,
      approverRole,
      decision,
      reason,
    },
  });

  const approvals = [...document.approvals, approval];
  const nextStatus =
    decision === "approved" && hasRequiredApprovals(approvals)
      ? "APPROVED"
      : decision === "requested_changes"
        ? "NEEDS_REVISION"
        : document.status;

  await prisma.curationDocument.update({
    where: { id: document.id },
    data: { status: nextStatus },
  });

  await createAuditEvent({
    traceId: randomUUID(),
    actorType: "user",
    actorId: session.user.id,
    targetType: "document",
    targetId: document.documentId,
    eventType: "document.approval_recorded",
    payload: {
      documentId: document.documentId,
      approverId: session.user.id,
      role: approverRole,
      decision,
    },
  });

  return Response.json({
    documentId: document.documentId,
    status: nextStatus,
    approvalId: approval.id,
  });
}
