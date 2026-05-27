import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { createConsolidationDraft, type ConsolidationArtifactType, type ConsolidationCandidate } from "@/lib/consolidation";
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
    sector?: string;
    candidate?: ConsolidationCandidate;
    artifactType?: ConsolidationArtifactType;
    title?: string;
    markdown?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Corpo da requisicao invalido.", 400);
  }

  if (!body.candidate || !body.markdown?.trim()) {
    return jsonError("Candidato e markdown sao obrigatorios.", 400);
  }

  if (body.artifactType !== "sop" && body.artifactType !== "ddp") {
    return jsonError("Tipo de artefato invalido.", 400);
  }

  const sector =
    body.sector && isSector(body.sector)
      ? body.sector
      : body.candidate.documentRefs[0]?.sector;

  if (!sector || !isSector(sector)) {
    return jsonError("Setor de curadoria invalido.", 400);
  }

  try {
    const result = await createConsolidationDraft({
      actor: {
        id: session.user.id,
        sector: session.user.sector,
      },
      sector,
      candidate: body.candidate,
      artifactType: body.artifactType,
      title: body.title,
      markdown: body.markdown,
    });

    return Response.json(result);
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";

    // Never expose raw Prisma internals to the client.
    // P2002 = unique constraint violation (should not happen after the fallback
    // lookup, but kept as a safety net).
    if (raw.includes("Unique constraint failed") || raw.includes("P2002")) {
      return jsonError(
        "Este documento ja existe em curadoria para este setor e foi atualizado.",
        409,
      );
    }

    return jsonError("Falha ao enviar rascunho para curadoria.", 500);
  }
}
