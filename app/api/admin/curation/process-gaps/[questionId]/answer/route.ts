import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  answerProcessGapQuestion,
  isProcessAutomationPersistenceError,
  PROCESS_AUTOMATION_SETUP_MESSAGE,
} from "@/lib/process-automation-map";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ questionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  if (session.user.role !== "admin") {
    return jsonError("Acesso restrito a administradores.", 403);
  }

  const { questionId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    response?: unknown;
  };
  const response = typeof body.response === "string" ? body.response.trim() : "";

  if (!response) {
    return jsonError("Informe a resposta da lacuna.");
  }

  try {
    const payload = await answerProcessGapQuestion({
      questionId,
      actorId: session.user.id,
      response,
    });

    return NextResponse.json(payload);
  } catch (error) {
    if (isProcessAutomationPersistenceError(error)) {
      return jsonError(PROCESS_AUTOMATION_SETUP_MESSAGE, 503);
    }
    return jsonError(
      error instanceof Error ? error.message : "Falha ao responder lacuna.",
      409,
    );
  }
}
