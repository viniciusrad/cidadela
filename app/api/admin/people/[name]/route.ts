import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { listAffectedDocuments } from "@/lib/graph/people-reclassify";
import { checkNeo4jHealth } from "@/lib/neo4j";
import { fetchDocumentChunkRows } from "@/lib/qdrant";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> },
) {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  const healthy = await checkNeo4jHealth();
  if (!healthy) return jsonError("Neo4j indisponivel.", 503);

  const { name: encoded } = await context.params;
  const personName = decodeURIComponent(encoded);

  const docs = await listAffectedDocuments(personName);

  const enriched = await Promise.all(
    docs.map(async (doc) => {
      const chunks = await fetchDocumentChunkRows(
        doc.sector,
        doc.sourceDocumentId,
      ).catch(() => []);

      const mentioning = chunks.filter((chunk) => {
        const haystack = `${chunk.headingPathText}\n${chunk.content}`
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase();
        const needle = personName
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase();
        return needle.length > 0 && haystack.includes(needle);
      });

      return {
        ...doc,
        chunkCount: mentioning.length,
        previewSnippets: mentioning.slice(0, 3).map((chunk) => ({
          pointId: chunk.ragPointId ?? String(chunk.id),
          headingPath: chunk.headingPathText,
          excerpt: extractExcerpt(chunk.content, personName),
        })),
      };
    }),
  );

  return Response.json({ name: personName, documents: enriched });
}

function extractExcerpt(content: string, personName: string) {
  const lower = content.toLowerCase();
  const idx = lower.indexOf(personName.toLowerCase());
  if (idx < 0) return content.slice(0, 240);
  const start = Math.max(0, idx - 80);
  const end = Math.min(content.length, idx + personName.length + 160);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < content.length ? "..." : "";
  return `${prefix}${content.slice(start, end)}${suffix}`;
}
