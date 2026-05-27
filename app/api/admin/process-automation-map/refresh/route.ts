import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  isProcessAutomationPersistenceError,
  PROCESS_AUTOMATION_SETUP_MESSAGE,
  refreshProcessAutomationMap,
} from "@/lib/process-automation-map";

export const runtime = "nodejs";

export async function POST() {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  if (session.user.role !== "admin") {
    return jsonError("Acesso restrito a administradores.", 403);
  }

  try {
    const payload = await refreshProcessAutomationMap();
    return NextResponse.json(payload);
  } catch (error) {
    if (isProcessAutomationPersistenceError(error)) {
      return jsonError(PROCESS_AUTOMATION_SETUP_MESSAGE, 503);
    }
    throw error;
  }
}
