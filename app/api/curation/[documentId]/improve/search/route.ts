import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { findCurationDocumentForActor } from "@/lib/curation/documents";
import { searchImprovementSources } from "@/lib/curation/improvement";

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
  const body = (await request.json().catch(() => ({}))) as { limit?: unknown };
  const rawLimit = typeof body.limit === "number" ? body.limit : 3;
  const limit = Math.max(1, Math.min(10, Math.round(rawLimit)));

  const document = await findCurationDocumentForActor(documentId, session.user);

  if (!document) {
    return jsonError("Documento nao encontrado.", 404);
  }

  try {
    const sources = await searchImprovementSources(document, limit);
    return Response.json({ sources });
  } catch (error) {
    console.error("[improve/search] Error:", error);
    return jsonError(
      error instanceof Error ? error.message : "Falha ao buscar referencias.",
      500,
    );
  }
}
