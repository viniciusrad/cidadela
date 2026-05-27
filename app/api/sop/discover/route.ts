import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { isSector } from "@/lib/config";
import { discoverSopSuggestions, listExistingKnowledgeArtifacts } from "@/lib/sop-discovery";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  if (session.user.role !== "admin") {
    return jsonError("Restrito a administradores do setor.", 403);
  }

  let body: { sector?: string };
  try {
    body = (await request.json()) as { sector?: string };
  } catch {
    body = {};
  }

  const sector = body.sector ?? session.user.sector;

  if (!isSector(sector)) {
    return jsonError("Setor invalido.", 400);
  }

  if (session.user.sector !== sector) {
    return jsonError("Acesso restrito ao proprio setor.", 403);
  }

  try {
    const [suggestions, existingSops] = await Promise.all([
      discoverSopSuggestions(sector),
      listExistingKnowledgeArtifacts(sector),
    ]);

    return Response.json({ suggestions, existingSops });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao descobrir SOPs.";
    return jsonError(message, 500);
  }
}
