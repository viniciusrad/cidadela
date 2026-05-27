import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  dropPersonIfOrphan,
  normalizeTargetName,
  reclassifyPersonForDocument,
  type ReclassifyTargetType,
} from "@/lib/graph/people-reclassify";
import { sha256 } from "@/lib/markdown";
import { checkNeo4jHealth } from "@/lib/neo4j";
import { getEmbedding } from "@/lib/ollama";
import { fetchDocumentChunkRows, updateChunkContent } from "@/lib/qdrant";

export const runtime = "nodejs";

type ReclassifyBody = {
  targetType: ReclassifyTargetType;
  targetName: string;
  documentIds: string[];
  deleteOriginal?: boolean;
};

const VALID_TYPES: ReclassifyTargetType[] = [
  "Person",
  "Concept",
  "Procedure",
  "System",
  "Regulation",
];

function buildReplaceRegex(personName: string) {
  const escaped = personName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "gi");
}

export async function POST(
  request: Request,
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

  const body = (await request.json().catch(() => null)) as ReclassifyBody | null;
  if (!body) return jsonError("Body invalido.", 400);
  if (!VALID_TYPES.includes(body.targetType))
    return jsonError("targetType invalido.", 400);
  if (!body.targetName || !body.targetName.trim())
    return jsonError("targetName obrigatorio.", 400);
  if (!Array.isArray(body.documentIds) || body.documentIds.length === 0)
    return jsonError("documentIds obrigatorios.", 400);

  const targetName = normalizeTargetName(body.targetType, body.targetName);

  if (body.targetType === "Person" && targetName === personName) {
    return jsonError(
      "O nome alvo e identico ao da pessoa atual. Para corrigir, informe o nome novo.",
      400,
    );
  }

  const replacementRegex = buildReplaceRegex(personName);

  const perDocument: Array<{
    documentId: string;
    chunksRewritten: number;
    chunkEdges: number;
    error?: string;
  }> = [];

  for (const documentId of body.documentIds) {
    try {
      // 1. Rewrite chunks in Qdrant: only those that contain the person name.
      // We need to discover sector from the document row in graph; using the
      // graph's INVOLVES_PERSON edge would require another query. The chunks
      // fetched by sector require the sector slug, so we infer it from the
      // first chunk row we can find. To keep things simple, query each known
      // sector lazily until we get rows.
      const chunkRows = await fetchChunksForDocument(documentId);

      let rewritten = 0;
      for (const chunk of chunkRows) {
        if (!replacementRegex.test(chunk.content)) {
          replacementRegex.lastIndex = 0;
          continue;
        }
        replacementRegex.lastIndex = 0;

        const newContent = chunk.content.replace(replacementRegex, targetName);
        if (newContent === chunk.content) continue;

        const newVector = await getEmbedding(newContent);
        const newHash = sha256(newContent);

        await updateChunkContent({
          sector: chunk.sector,
          pointId: chunk.ragPointId ?? chunk.id,
          newContent,
          newVector,
          newContentHash: newHash,
          auditNote: {
            reclassified_from_person: personName,
            reclassified_to: `${body.targetType}:${targetName}`,
            reclassified_at: new Date().toISOString(),
          },
        });
        rewritten += 1;
      }

      const { chunkEdges } = await reclassifyPersonForDocument({
        personName,
        targetType: body.targetType,
        targetName,
        documentId,
      });

      perDocument.push({
        documentId,
        chunksRewritten: rewritten,
        chunkEdges,
      });
    } catch (err) {
      perDocument.push({
        documentId,
        chunksRewritten: 0,
        chunkEdges: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let personDropped = false;
  if (body.deleteOriginal) {
    personDropped = await dropPersonIfOrphan(personName);
  }

  return Response.json({
    personName,
    targetType: body.targetType,
    targetName,
    perDocument,
    personDropped,
  });
}

async function fetchChunksForDocument(documentId: string) {
  // The Document.id in the graph equals the sourceDocumentId for promoted docs.
  // We don't know the sector up front, so query Neo4j for it.
  const { runQuery } = await import("@/lib/neo4j");
  const rows = await runQuery<{ sector: string; sourceDocumentId: string | null }>(
    `MATCH (d:Document {id: $id}) RETURN d.sector AS sector, d.sourceDocumentId AS sourceDocumentId LIMIT 1`,
    { id: documentId },
  );
  if (rows.length === 0) return [];
  const sector = rows[0].sector;
  const sourceDocumentId = rows[0].sourceDocumentId ?? documentId;
  return fetchDocumentChunkRows(sector, sourceDocumentId);
}
