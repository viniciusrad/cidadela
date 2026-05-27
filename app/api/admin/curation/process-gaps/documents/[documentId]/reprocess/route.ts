import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  isProcessAutomationPersistenceError,
  PROCESS_AUTOMATION_SETUP_MESSAGE,
  reprocessProcessGapDocumentAnswers,
} from "@/lib/process-automation-map";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  if (session.user.role !== "admin") {
    return jsonError("Acesso restrito a administradores.", 403);
  }

  const { documentId } = await context.params;

  try {
    const payload = await reprocessProcessGapDocumentAnswers({
      curationDocumentId: documentId,
      actorId: session.user.id,
    });

    return NextResponse.json(payload);
  } catch (error) {
    if (isProcessAutomationPersistenceError(error)) {
      return jsonError(PROCESS_AUTOMATION_SETUP_MESSAGE, 503);
    }
    return jsonError(
      error instanceof Error ? error.message : "Falha ao reprocessar documento.",
      409,
    );
  }
}
