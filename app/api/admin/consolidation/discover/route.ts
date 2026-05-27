import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { discoverConsolidationCandidates, type ConsolidationSectorFilter, type ConsolidationSourceScope } from "@/lib/consolidation";
import { isSector } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  if (session.user.role !== "admin") {
    return jsonError("Restrito a administradores.", 403);
  }

  let body: {
    query?: string;
    sector?: string;
    sourceScope?: ConsolidationSourceScope;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Corpo da requisicao invalido.", 400);
  }

  const query = body.query?.trim() ?? "";
  if (!query) {
    return jsonError("Informe a busca guiada da consolidacao.", 400);
  }

  const sector: ConsolidationSectorFilter =
    body.sector === "all"
      ? "all"
      : body.sector && isSector(body.sector)
        ? body.sector
        : "all";
  const sourceScope: ConsolidationSourceScope =
    body.sourceScope === "promoted" || body.sourceScope === "staging" || body.sourceScope === "both"
      ? body.sourceScope
      : "both";

  try {
    const candidates = await discoverConsolidationCandidates({
      query,
      sector,
      sourceScope,
    });

    return Response.json({ candidates });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Falha ao descobrir processos.",
      500,
    );
  }
}
