import { type NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db/client";
import { extractEntities } from "@/lib/graph/extractor";
import { upsertGraphDocument } from "@/lib/graph/persistence";
import { checkNeo4jHealth } from "@/lib/neo4j";
import {
  fetchDocumentChunkRows,
  markDocumentChunksAsGraphed,
  type RagChunkSource,
} from "@/lib/qdrant";
import { isSectorSlug } from "@/lib/sectors/sector-repo";

type RequestBody =
  | { curationDocumentId: string }
  | {
      sourceDocumentId: string;
      sector: string;
      documentTitle: string;
      fileName: string;
    };

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as RequestBody;

  const healthy = await checkNeo4jHealth();
  if (!healthy) {
    return NextResponse.json({ error: "Neo4j indisponivel" }, { status: 503 });
  }

  if ("curationDocumentId" in body) {
    const document = await prisma.curationDocument.findUnique({
      where: { id: body.curationDocumentId },
      select: {
        id: true,
        documentId: true,
        sourceDocumentId: true,
        documentTitle: true,
        sector: true,
        topic: true,
        documentType: true,
        status: true,
        normalizedMarkdown: true,
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const ragSource: RagChunkSource =
      document.status === "PROMOTED" ? "promoted" : "staging";
    const ragChunks = await fetchDocumentChunkRows(
      document.sector,
      document.sourceDocumentId,
      { source: ragSource },
    ).catch(() => []);
    const markdown =
      ragChunks.length > 0
        ? ragChunks.map((chunk) => chunk.content).join("\n\n")
        : document.normalizedMarkdown;

    const entities = await extractEntities(markdown);
    const graphResult = await upsertGraphDocument({
      documentId: document.sourceDocumentId,
      legacyDocumentId: document.documentId,
      curationDocumentId: document.id,
      sourceDocumentId: document.sourceDocumentId,
      title: document.documentTitle,
      sector: document.sector,
      topic: document.topic ?? null,
      documentType: document.documentType ?? null,
      status: document.status,
      entities,
      ragChunks,
    });
    const qdrantLinkResult = await markDocumentChunksAsGraphed({
      sector: document.sector,
      sourceDocumentId: document.sourceDocumentId,
      source: ragSource,
      graphDocumentId: document.sourceDocumentId,
    }).catch(() => null);

    return NextResponse.json({
      ok: true,
      documentId: document.documentId,
      graphDocumentId: document.sourceDocumentId,
      sourceDocumentId: document.sourceDocumentId,
      entities,
      ragChunksLinked: graphResult.ragChunksLinked,
      qdrantChunksUpdated: qdrantLinkResult?.updated ?? 0,
    });
  }

  const { sourceDocumentId, sector, documentTitle, fileName } = body as {
    sourceDocumentId: string;
    sector: string;
    documentTitle: string;
    fileName: string;
  };

  if (!sourceDocumentId || !sector) {
    return NextResponse.json(
      { error: "sourceDocumentId and sector are required" },
      { status: 400 },
    );
  }

  if (!(await isSectorSlug(sector))) {
    return NextResponse.json({ error: "Invalid sector" }, { status: 400 });
  }

  const ragChunks = await fetchDocumentChunkRows(sector, sourceDocumentId, {
    source: "promoted",
  });
  const markdown = ragChunks.map((chunk) => chunk.content).join("\n\n");
  if (!markdown.trim()) {
    return NextResponse.json(
      { error: "No content found for this document in Qdrant" },
      { status: 404 },
    );
  }

  const entities = await extractEntities(markdown);
  const graphResult = await upsertGraphDocument({
    documentId: sourceDocumentId,
    sourceDocumentId,
    title: documentTitle || fileName,
    sector,
    topic: null,
    documentType: null,
    status: "production",
    entities,
    ragChunks,
  });
  const qdrantLinkResult = await markDocumentChunksAsGraphed({
    sector,
    sourceDocumentId,
    source: "promoted",
    graphDocumentId: sourceDocumentId,
  }).catch(() => null);

  return NextResponse.json({
    ok: true,
    documentId: sourceDocumentId,
    graphDocumentId: sourceDocumentId,
    sourceDocumentId,
    entities,
    ragChunksLinked: graphResult.ragChunksLinked,
    qdrantChunksUpdated: qdrantLinkResult?.updated ?? 0,
  });
}
