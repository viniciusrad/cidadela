import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  isProcessAutomationPersistenceError,
  PROCESS_AUTOMATION_SETUP_MESSAGE,
  updateAutomationCandidate,
} from "@/lib/process-automation-map";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ candidateId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  if (session.user.role !== "admin") {
    return jsonError("Acesso restrito a administradores.", 403);
  }

  const body = (await request.json().catch(() => ({}))) as {
    status?: unknown;
    processMapId?: unknown;
  };

  const status = typeof body.status === "string" ? body.status.trim() : undefined;
  const processMapId =
    body.processMapId === null
      ? null
      : typeof body.processMapId === "string" && body.processMapId.trim()
        ? body.processMapId.trim()
        : undefined;

  const { candidateId } = await context.params;

  try {
    const updated = await updateAutomationCandidate({
      candidateId,
      status,
      processMapId,
    });

    if (!updated) {
      return jsonError("Candidato nao encontrado.", 404);
    }

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      processMapId: updated.processMapId,
    });
  } catch (error) {
    if (isProcessAutomationPersistenceError(error)) {
      return jsonError(PROCESS_AUTOMATION_SETUP_MESSAGE, 503);
    }
    return jsonError(
      error instanceof Error ? error.message : "Falha ao atualizar o candidato.",
      400,
    );
  }
}
