import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { isSector } from "@/lib/config";
import { prisma } from "@/lib/db/client";
import { listSectorChunks } from "@/lib/qdrant";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const url = new URL(request.url);
  const sector = url.searchParams.get("sector");
  const sourceDocumentId = url.searchParams.get("sourceDocumentId");

  if (!sector || !isSector(sector)) {
    return jsonError("Setor invalido.", 400);
  }

  if (!sourceDocumentId) {
    return jsonError("sourceDocumentId obrigatorio.", 400);
  }

  try {
    const result = await listSectorChunks(sector, {
      sourceDocumentId,
      limit: 100, // Limite razoável para visualização
    });

    if (result.rows.length === 0) {
      const document = await prisma.curationDocument.findFirst({
        where: {
          sector,
          status: "PROMOTED",
          OR: [
            { sourceDocumentId },
            { documentId: sourceDocumentId },
          ],
        },
        select: {
          documentTitle: true,
          normalizedMarkdown: true,
        },
      });

      if (document) {
        return Response.json({
          documentTitle: document.documentTitle,
          content: document.normalizedMarkdown,
          chunks: [],
        });
      }
    }

    const consolidatedContent = result.rows
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map((chunk) => {
        const heading = chunk.headingPathText?.trim() || `Parte ${chunk.chunkIndex}`;
        return `### ${heading}\n\n${chunk.content.trim()}`;
      })
      .join("\n\n");

    return Response.json({
      documentTitle: result.rows[0]?.documentTitle || "Documento",
      content: consolidatedContent,
      chunks: result.rows,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Erro ao carregar documento.", 500);
  }
}
