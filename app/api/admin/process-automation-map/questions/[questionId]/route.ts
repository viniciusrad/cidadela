import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  isProcessAutomationPersistenceError,
  PROCESS_AUTOMATION_SETUP_MESSAGE,
  updateProcessGapQuestionStatus,
} from "@/lib/process-automation-map";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ questionId: string }>;
};

const ALLOWED_STATUSES = new Set([
  "open",
  "promoted",
  "answered",
  "dismissed",
  "resolved",
]);

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  if (session.user.role !== "admin") {
    return jsonError("Acesso restrito a administradores.", 403);
  }

  const body = (await request.json().catch(() => ({}))) as { status?: unknown };
  const status = typeof body.status === "string" ? body.status.trim() : "";
  if (!ALLOWED_STATUSES.has(status)) {
    return jsonError("Status de lacuna invalido.", 400);
  }

  const { questionId } = await context.params;
  let updated = null;

  try {
    updated = await updateProcessGapQuestionStatus(
      questionId,
      status as "open" | "promoted" | "answered" | "dismissed" | "resolved",
    );
  } catch (error) {
    if (isProcessAutomationPersistenceError(error)) {
      return jsonError(PROCESS_AUTOMATION_SETUP_MESSAGE, 503);
    }
    throw error;
  }

  if (!updated) {
    return jsonError("Pergunta de lacuna nao encontrada.", 404);
  }

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    answeredAt: updated.answeredAt,
  });
}
