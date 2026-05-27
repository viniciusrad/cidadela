import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminChunkRow } from "@/lib/qdrant";

const mocks = vi.hoisted(() => ({
  runQuery: vi.fn(async () => []),
}));

vi.mock("@/lib/neo4j", () => ({
  runQuery: mocks.runQuery,
}));

import { upsertGraphDocument } from "@/lib/graph/persistence";

describe("graph persistence RAG provenance", () => {
  beforeEach(() => {
    mocks.runQuery.mockClear();
  });

  it("links graph documents to Qdrant chunks and stores entity evidence chunk ids", async () => {
    const ragChunks: AdminChunkRow[] = [
      {
        id: "point-1",
        sector: "desenvolvimento",
        collectionName: "rag_dev",
        ragPointId: "point-1",
        graphChunkNodeId: "rag_dev:point-1",
        documentId: "rendered-doc",
        sourceDocumentId: "source-doc",
        documentTitle: "Pedido eletronico",
        fileName: "source-doc.md",
        headingPathText: "Procedimento",
        sourceFormat: "markdown",
        chunkIndex: 0,
        contentPreview: "Fluxo usa SAP para pedido eletronico.",
        content: "Fluxo usa SAP para pedido eletronico.",
        contentHash: "hash-1",
        source: "promoted",
      },
      {
        id: "point-2",
        sector: "desenvolvimento",
        collectionName: "rag_dev",
        ragPointId: "point-2",
        graphChunkNodeId: "rag_dev:point-2",
        documentId: "rendered-doc",
        sourceDocumentId: "source-doc",
        documentTitle: "Pedido eletronico",
        fileName: "source-doc.md",
        headingPathText: "Regra",
        sourceFormat: "markdown",
        chunkIndex: 1,
        contentPreview: "Validacao operacional.",
        content: "Validacao operacional.",
        contentHash: "hash-2",
        source: "promoted",
      },
    ];

    const result = await upsertGraphDocument({
      documentId: "source-doc",
      legacyDocumentId: "rendered-doc",
      curationDocumentId: "cur-1",
      sourceDocumentId: "source-doc",
      title: "Pedido eletronico",
      sector: "desenvolvimento",
      topic: "pedidos",
      documentType: "sop",
      status: "PROMOTED",
      entities: {
        concepts: ["Pedido eletronico"],
        procedures: ["validar pedido"],
        systems: ["SAP"],
        regulations: [],
        persons: [],
      },
      ragChunks,
    });

    expect(result).toEqual({
      documentId: "source-doc",
      ragChunksLinked: 2,
      entityRelationships: 3,
      coOccurrenceEdges: 0,
    });
    expect(mocks.runQuery).toHaveBeenCalledWith(
      expect.stringContaining("MERGE (c:RagChunk"),
      expect.objectContaining({
        documentId: "source-doc",
        chunks: expect.arrayContaining([
          expect.objectContaining({
            id: "rag_dev:point-1",
            pointId: "point-1",
            collectionName: "rag_dev",
            sourceDocumentId: "source-doc",
            chunkIndex: 0,
          }),
        ]),
      }),
    );
    expect(mocks.runQuery).toHaveBeenCalledWith(
      expect.stringContaining("MERGE (d)-[r:REFERENCES_SYSTEM]->(e)"),
      expect.objectContaining({
        name: "SAP",
        docId: "source-doc",
        sourceDocumentId: "source-doc",
        evidenceChunkIds: ["rag_dev:point-1"],
      }),
    );
    expect(mocks.runQuery).toHaveBeenCalledWith(
      expect.stringContaining("MERGE (s)-[r:HAS_DOCUMENT]->(d)"),
      expect.objectContaining({
        slug: "desenvolvimento",
        documentId: "source-doc",
      }),
    );
  });
});
