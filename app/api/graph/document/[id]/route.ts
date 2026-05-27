import { type NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { isSector } from "@/lib/config";
import { checkNeo4jHealth, runQuery } from "@/lib/neo4j";
import { fetchDocumentChunks } from "@/lib/qdrant";

type DocRow = {
  id: string;
  title: string;
  sector: string | null;
  topic: string | null;
  documentType: string | null;
  status: string | null;
  sourceDocumentId: string | null;
  ragChunkCount: number | null;
};

type EntityRow = { type: string; name: string };
type RagChunkRow = {
  id: string;
  pointId: string | null;
  collection: string | null;
  sourceDocumentId: string | null;
  chunkIndex: number | null;
  headingPathText: string | null;
  contentHash: string | null;
};

type RelatedRow = {
  id: string;
  title: string;
  sector: string | null;
  sharedConcepts: string[];
  overlap: number;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const fallbackSector = request.nextUrl.searchParams.get("sector");
  const fallbackTitle = request.nextUrl.searchParams.get("title");
  const fallbackDocumentType = request.nextUrl.searchParams.get("documentType");
  const fallbackStatus = request.nextUrl.searchParams.get("status");

  const loadFromQdrant = async () => {
    if (!fallbackSector || !isSector(fallbackSector)) {
      return null;
    }

    const content = await fetchDocumentChunks(fallbackSector, id);
    if (!content.trim()) {
      return null;
    }

    return NextResponse.json({
      document: {
        id,
        title: fallbackTitle || id,
        sector: fallbackSector,
        topic: null,
        documentType: fallbackDocumentType || null,
        status: fallbackStatus || "production",
      },
      content,
      entities: [],
      related: [],
    });
  };

  const healthy = await checkNeo4jHealth();
  if (!healthy) {
    const fallback = await loadFromQdrant();
    if (fallback) return fallback;
    return NextResponse.json({ error: "Neo4j indisponível" }, { status: 503 });
  }

  // Accept either elementId (used by /api/graph/full visualization) or the
  // logical id property (used elsewhere). Try elementId first.
  const [docRows, entityRows, ragChunkRows, relatedRows] = await Promise.all([
    runQuery<DocRow>(
      `MATCH (d:Document)
       WHERE elementId(d) = $id OR d.id = $id
       RETURN d.id AS id, d.title AS title, d.sector AS sector,
              d.topic AS topic, d.documentType AS documentType, d.status AS status,
              d.sourceDocumentId AS sourceDocumentId,
              d.ragChunkCount AS ragChunkCount
       LIMIT 1`,
      { id },
    ),
    runQuery<EntityRow>(
      `MATCH (d:Document)-[r:HAS_CONCEPT|DESCRIBES|REFERENCES_SYSTEM|COMPLIES_WITH]->(e)
       WHERE elementId(d) = $id OR d.id = $id
       RETURN type(r) AS type, e.name AS name
       ORDER BY type, name`,
      { id },
    ),
    runQuery<RagChunkRow>(
      `MATCH (d:Document)-[:HAS_RAG_CHUNK]->(chunk:RagChunk)
       WHERE elementId(d) = $id OR d.id = $id
       RETURN chunk.id AS id,
              chunk.pointId AS pointId,
              chunk.collection AS collection,
              chunk.sourceDocumentId AS sourceDocumentId,
              chunk.chunkIndex AS chunkIndex,
              chunk.headingPathText AS headingPathText,
              chunk.contentHash AS contentHash
       ORDER BY chunk.chunkIndex ASC
       LIMIT 200`,
      { id },
    ),
    runQuery<RelatedRow>(
      `MATCH (d:Document)-[:HAS_CONCEPT]->(c:Concept)<-[:HAS_CONCEPT]-(rel:Document)
       WHERE (elementId(d) = $id OR d.id = $id) AND elementId(rel) <> elementId(d)
       RETURN elementId(rel) AS id, rel.title AS title, rel.sector AS sector,
              collect(DISTINCT c.name) AS sharedConcepts, count(DISTINCT c) AS overlap
       ORDER BY overlap DESC
       LIMIT 12`,
      { id },
    ),
  ]);

  const doc = docRows[0];
  if (!doc) {
    const fallback = await loadFromQdrant();
    if (fallback) return fallback;
    return NextResponse.json({ error: "Documento não encontrado no grafo" }, { status: 404 });
  }

  let content = "";
  if (doc.sector && isSector(doc.sector)) {
    try {
      content = await fetchDocumentChunks(doc.sector, doc.id);
    } catch {
      content = "";
    }
  }

  return NextResponse.json({
    document: {
      id: doc.id,
      title: doc.title,
      sector: doc.sector,
      topic: doc.topic,
      documentType: doc.documentType,
      status: doc.status,
      sourceDocumentId: doc.sourceDocumentId,
      ragChunkCount: Number(doc.ragChunkCount ?? ragChunkRows.length),
    },
    content,
    entities: entityRows,
    ragChunks: ragChunkRows.map((chunk) => ({
      id: chunk.id,
      pointId: chunk.pointId,
      collection: chunk.collection,
      sourceDocumentId: chunk.sourceDocumentId,
      chunkIndex: Number(chunk.chunkIndex ?? 0),
      headingPathText: chunk.headingPathText,
      contentHash: chunk.contentHash,
    })),
    related: relatedRows.map((r) => ({
      id: r.id,
      title: r.title,
      sector: r.sector,
      sharedConcepts: r.sharedConcepts ?? [],
      overlap: Number(r.overlap),
    })),
  });
}
