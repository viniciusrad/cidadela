import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/db/client";
import { syncShareableKnowledgeCapabilities } from "@/lib/knowledge/capabilities";

export const runtime = "nodejs";

async function requireAdmin() {
  const session = await auth();

  if (!session?.user) {
    return { error: jsonError("Nao autenticado.", 401) };
  }

  if (session.user.role !== "admin") {
    return { error: jsonError("Acesso restrito a administradores.", 403) };
  }

  return { session };
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard.error) {
    return guard.error;
  }

  const rows = await prisma.knowledgeCapability.findMany({
    orderBy: [{ sector: "asc" }, { documentTitle: "asc" }],
    select: {
      id: true,
      sector: true,
      documentId: true,
      sourceDocumentId: true,
      documentTitle: true,
      topic: true,
      owner: true,
      sensitivity: true,
      updatedAt: true,
    },
  });

  return Response.json({ rows });
}

export async function POST() {
  const guard = await requireAdmin();
  if (guard.error) {
    return guard.error;
  }

  const result = await syncShareableKnowledgeCapabilities();

  return Response.json({
    ...result,
    message:
      "Catalogo de capacidades intersetoriais atualizado a partir de documentos public/internal promovidos.",
  });
}
