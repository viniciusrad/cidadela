import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { isSector } from "@/lib/config";
import { jsonError } from "@/lib/api";
import {
  isProcessAutomationPersistenceError,
  listProcessAutomationMaps,
  PROCESS_AUTOMATION_SETUP_MESSAGE,
} from "@/lib/process-automation-map";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  if (session.user.role !== "admin") {
    return jsonError("Acesso restrito a administradores.", 403);
  }

  const { searchParams } = request.nextUrl;
  const sector = searchParams.get("sector");

  try {
    const payload = await listProcessAutomationMaps({
      search: searchParams.get("search") ?? undefined,
      sector: sector && isSector(sector) ? sector : "all",
      status: searchParams.get("status") ?? "all",
      automationLevel: searchParams.get("automationLevel") ?? "all",
      hasSystem:
        searchParams.get("hasSystem") === "yes" || searchParams.get("hasSystem") === "no"
          ? (searchParams.get("hasSystem") as "yes" | "no")
          : "all",
      gaps:
        searchParams.get("gaps") === "with" || searchParams.get("gaps") === "without"
          ? (searchParams.get("gaps") as "with" | "without")
          : "all",
      sourceScope:
        searchParams.get("sourceScope") === "staging" ||
        searchParams.get("sourceScope") === "promoted" ||
        searchParams.get("sourceScope") === "both"
          ? (searchParams.get("sourceScope") as "staging" | "promoted" | "both")
          : "all",
    });

    return NextResponse.json(payload);
  } catch (error) {
    if (isProcessAutomationPersistenceError(error)) {
      return jsonError(PROCESS_AUTOMATION_SETUP_MESSAGE, 503);
    }
    throw error;
  }
}
