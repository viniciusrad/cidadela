import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  getProcessAutomationMapDetail,
  isProcessAutomationPersistenceError,
  PROCESS_AUTOMATION_SETUP_MESSAGE,
} from "@/lib/process-automation-map";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ processId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  if (session.user.role !== "admin") {
    return jsonError("Acesso restrito a administradores.", 403);
  }

  const { processId } = await context.params;
  let payload = null;

  try {
    payload = await getProcessAutomationMapDetail(processId);
  } catch (error) {
    if (isProcessAutomationPersistenceError(error)) {
      return jsonError(PROCESS_AUTOMATION_SETUP_MESSAGE, 503);
    }
    throw error;
  }

  if (!payload) {
    return jsonError("Processo nao encontrado.", 404);
  }

  return NextResponse.json(payload);
}
