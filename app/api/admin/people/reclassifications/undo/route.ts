import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import {
  listUndoAffectedDocuments,
  normalizeTargetName,
  undoReclassificationInGraph,
  type ReclassifyTargetType,
} from "@/lib/graph/people-reclassify";
import { sha256 } from "@/lib/markdown";
import { checkNeo4jHealth } from "@/lib/neo4j";
import { getEmbedding } from "@/lib/ollama";
import {
  findChunksByReclassificationAudit,
  revertChunkContent,
} from "@/lib/qdrant";

export const runtime = "nodejs";

type UndoBody = {
  personName: string;
  targetType: ReclassifyTargetType;
  targetName: string;
};

const VALID_TYPES: ReclassifyTargetType[] = [
  "Person",
  "Concept",
  "Procedure",
  "System",
  "Regulation",
];

function buildReplaceRegex(name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "gi");
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return jsonError("Nao autenticado.", 401);
  if (session.user.role !== "admin")
    return jsonError("Acesso restrito a administradores.", 403);

  const healthy = await checkNeo4jHealth();
  if (!healthy) return jsonError("Neo4j indisponivel.", 503);

  const body = (await request.json().catch(() => null)) as UndoBody | null;
  if (!body) return jsonError("Body invalido.", 400);
  if (!VALID_TYPES.includes(body.targetType))
    return jsonError("targetType invalido.", 400);
  if (!body.personName?.trim()) return jsonError("personName obrigatorio.", 400);
  if (!body.targetName?.trim()) return jsonError("targetName obrigatorio.", 400);

  const targetName = normalizeTargetName(body.targetType, body.targetName);
  const personName = body.personName.trim();

  // 1. Find chunks (across all sectors) whose audit payload matches; revert
  //    text + embedding before we touch the graph so audit info stays
  //    discoverable if the operation needs to be re-tried.
  const affected = await listUndoAffectedDocuments({
    personName,
    targetType: body.targetType,
    targetName,
  });

  const replaceRegex = buildReplaceRegex(targetName);
  const perDocument: Array<{
    documentId: string;
    chunksReverted: number;
    error?: string;
  }> = [];

  for (const doc of affected) {
    try {
      const chunks = await findChunksByReclassificationAudit({
        sector: doc.sector,
        pointIds: doc.chunkPointIds,
      });

      let reverted = 0;
      for (const chunk of chunks) {
        if (!replaceRegex.test(chunk.content)) {
          replaceRegex.lastIndex = 0;
          continue;
        }
        replaceRegex.lastIndex = 0;

        const restored = chunk.content.replace(replaceRegex, personName);
        if (restored === chunk.content) continue;

        const newVector = await getEmbedding(restored);
        await revertChunkContent({
          sector: chunk.sector,
          pointId: chunk.ragPointId ?? chunk.id,
          newContent: restored,
          newVector,
          newContentHash: sha256(restored),
        });
        reverted += 1;
      }

      perDocument.push({ documentId: doc.documentId, chunksReverted: reverted });
    } catch (err) {
      perDocument.push({
        documentId: doc.documentId,
        chunksReverted: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. Reverse the graph: rebuild Person, move edges, drop target if orphan.
  const graphResult = await undoReclassificationInGraph({
    personName,
    targetType: body.targetType,
    targetName,
  });

  return Response.json({
    personName,
    targetType: body.targetType,
    targetName,
    documentsAffected: affected.length,
    perDocument,
    graph: graphResult,
  });
}
