import { QdrantClient } from "@qdrant/js-client-rest";

import {
  appConfig,
  collectionForSector,
  stagingCollectionForSector,
} from "@/lib/config";
import { SECTORS, type Sector } from "@/lib/domain";
import type { PreparedChunk, SearchMatch } from "@/lib/markdown";
import { normalizeSensitivity } from "@/lib/sensitivity";

type IndexedChunk = PreparedChunk & {
  vector: number[];
  sensitivity?: string | null;
  topic?: string | null;
  owner?: string | null;
  documentType?: string | null;
  authorityLevel?: string | null;
  sourceType?: string | null;
};

type QdrantPointId = string | number;

const client = new QdrantClient({
  url: appConfig.qdrantUrl,
  apiKey: appConfig.qdrantApiKey,
});

function graphDocumentIdForChunk(chunk: Pick<PreparedChunk, "sourceDocumentId" | "documentId">) {
  return chunk.sourceDocumentId || chunk.documentId;
}

function graphChunkNodeId(collectionName: string, pointId: QdrantPointId) {
  return `${collectionName}:${String(pointId)}`;
}

function provenancePayload(collectionName: string, chunk: PreparedChunk) {
  const graphDocumentId = graphDocumentIdForChunk(chunk);
  const pointId = chunk.id;

  return {
    rag_collection: collectionName,
    rag_point_id: pointId,
    rag_chunk_ref: graphChunkNodeId(collectionName, pointId),
    graph_document_id: graphDocumentId,
    graph_source_document_id: chunk.sourceDocumentId,
    graph_chunk_node_id: graphChunkNodeId(collectionName, pointId),
  };
}

function isQdrantNotFound(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeStatus = (error as { status?: number }).status;
  const maybeData = (error as { data?: { status?: { error?: string } } }).data;

  return (
    maybeStatus === 404 ||
    maybeData?.status?.error?.toLowerCase().includes("not found") === true
  );
}

async function ensureContentTextIndex(collectionName: string) {
  try {
    await client.createPayloadIndex(collectionName, {
      field_name: "content",
      field_schema: {
        type: "text",
        tokenizer: "word",
        lowercase: true,
        min_token_len: 2,
      },
      wait: true,
    });
  } catch {
    // index ja existe ou o servidor nao suporta; ignorar e seguir com fallback
  }
}

export async function ensureCollection(collectionName: string) {
  let created = false;

  try {
    await client.getCollection(collectionName);
  } catch (error) {
    if (!isQdrantNotFound(error)) {
      throw error;
    }

    await client.createCollection(collectionName, {
      vectors: {
        size: appConfig.qdrantVectorSize,
        distance: "Cosine",
      },
    });

    await client.createPayloadIndex(collectionName, {
      field_name: "document_id",
      field_schema: "keyword",
      wait: true,
    });

    created = true;
  }

  if (created) {
    await ensureContentTextIndex(collectionName);
  }
}

export async function ensureContentIndexesForAllSectors() {
  await Promise.all(
    SECTORS.map(async (sector) => {
      const collectionName = collectionForSector(sector);
      await ensureCollection(collectionName);
      await ensureContentTextIndex(collectionName);
    }),
  );
}

export async function ensureAllSectorCollections() {
  await Promise.all(
    SECTORS.flatMap((sector) => [
      ensureCollection(collectionForSector(sector)),
      ensureCollection(stagingCollectionForSector(sector)),
    ]),
  );
}

export async function replaceDocumentChunksInCollection(
  collectionName: string,
  sector: string,
  documentId: string,
  chunksWithVectors: IndexedChunk[],
) {
  await ensureCollection(collectionName);

  await client.delete(collectionName, {
    wait: true,
    filter: {
      must: [
        {
          key: "document_id",
          match: { value: documentId },
        },
      ],
    },
  });

  if (chunksWithVectors.length === 0) {
    return;
  }

  await client.upsert(collectionName, {
    wait: true,
    points: chunksWithVectors.map((chunk) => ({
      id: chunk.id,
      vector: chunk.vector,
      payload: {
        sector,
        document_id: chunk.documentId,
        source_document_id: chunk.sourceDocumentId,
        file_name: chunk.fileName,
        relative_path: chunk.relativePath,
        responsible_area: chunk.responsibleArea,
        document_title: chunk.documentTitle,
        source_type: chunk.sourceType ?? "document",
        document_type: chunk.documentType ?? undefined,
        authority_level: chunk.authorityLevel ?? undefined,
        source_format: chunk.sourceFormat,
        source_origin: chunk.sourceOrigin,
        chunk_index: chunk.chunkIndex,
        heading_path: chunk.headingPath,
        heading_path_text: chunk.headingPathText,
        content: chunk.content,
        content_preview: chunk.contentPreview,
        content_hash: chunk.contentHash,
        conversion_warning_count: chunk.conversionWarningCount,
        sensitivity: normalizeSensitivity(chunk.sensitivity),
        topic: chunk.topic ?? undefined,
        owner: chunk.owner ?? undefined,
        created_at: chunk.createdAt,
        ...provenancePayload(collectionName, chunk),
      },
    })),
  });
}

export async function replaceSectorDocumentChunks(
  sector: string,
  documentId: string,
  chunksWithVectors: IndexedChunk[],
) {
  await replaceDocumentChunksInCollection(
    collectionForSector(sector),
    sector,
    documentId,
    chunksWithVectors,
  );
}

export async function replaceStagedDocumentChunks(
  sector: string,
  documentId: string,
  chunksWithVectors: IndexedChunk[],
) {
  await replaceDocumentChunksInCollection(
    stagingCollectionForSector(sector),
    sector,
    documentId,
    chunksWithVectors,
  );
}

export async function replaceStagedSourceDocumentChunks(
  sector: string,
  sourceDocumentId: string,
  chunksWithVectors: IndexedChunk[],
) {
  const collectionName = stagingCollectionForSector(sector);
  await ensureCollection(collectionName);

  await client.delete(collectionName, {
    wait: true,
    filter: {
      must: [
        {
          key: "source_document_id",
          match: { value: sourceDocumentId },
        },
      ],
    },
  });

  if (chunksWithVectors.length === 0) {
    return;
  }

  await client.upsert(collectionName, {
    wait: true,
    points: chunksWithVectors.map((chunk) => ({
      id: chunk.id,
      vector: chunk.vector,
      payload: {
        sector,
        document_id: chunk.documentId,
        source_document_id: sourceDocumentId,
        file_name: chunk.fileName,
        relative_path: chunk.relativePath,
        responsible_area: chunk.responsibleArea,
        document_title: chunk.documentTitle,
        source_type: "document",
        document_type: chunk.documentType ?? undefined,
        authority_level: chunk.authorityLevel ?? undefined,
        source_format: chunk.sourceFormat,
        source_origin: chunk.sourceOrigin,
        chunk_index: chunk.chunkIndex,
        heading_path: chunk.headingPath,
        heading_path_text: chunk.headingPathText,
        content: chunk.content,
        content_preview: chunk.contentPreview,
        content_hash: chunk.contentHash,
        conversion_warning_count: chunk.conversionWarningCount,
        sensitivity: normalizeSensitivity(chunk.sensitivity),
        topic: chunk.topic ?? undefined,
        owner: chunk.owner ?? undefined,
        created_at: chunk.createdAt,
        ...provenancePayload(collectionName, {
          ...chunk,
          sourceDocumentId,
        }),
      },
    })),
  });
}

export async function deleteStagedDocumentChunks(
  sector: string,
  sourceDocumentId: string,
) {
  const collectionName = stagingCollectionForSector(sector);
  await ensureCollection(collectionName);

  await client.delete(collectionName, {
    wait: true,
    filter: {
      must: [
        {
          key: "source_document_id",
          match: { value: sourceDocumentId },
        },
      ],
    },
  });
}

export async function replaceSectorSourceDocumentChunks(
  sector: string,
  sourceDocumentId: string,
  chunksWithVectors: IndexedChunk[],
) {
  const collectionName = collectionForSector(sector);
  await ensureCollection(collectionName);

  await client.delete(collectionName, {
    wait: true,
    filter: {
      must: [
        {
          key: "source_document_id",
          match: { value: sourceDocumentId },
        },
      ],
    },
  });

  if (chunksWithVectors.length === 0) {
    return;
  }

  await client.upsert(collectionName, {
    wait: true,
    points: chunksWithVectors.map((chunk) => ({
      id: chunk.id,
      vector: chunk.vector,
      payload: {
        sector,
        document_id: chunk.documentId,
        source_document_id: sourceDocumentId,
        file_name: chunk.fileName,
        relative_path: chunk.relativePath,
        responsible_area: chunk.responsibleArea,
        document_title: chunk.documentTitle,
        source_type: chunk.sourceType ?? "sop",
        document_type: chunk.documentType ?? undefined,
        authority_level: chunk.authorityLevel ?? undefined,
        source_format: chunk.sourceFormat,
        source_origin: chunk.sourceOrigin,
        chunk_index: chunk.chunkIndex,
        heading_path: chunk.headingPath,
        heading_path_text: chunk.headingPathText,
        content: chunk.content,
        content_preview: chunk.contentPreview,
        content_hash: chunk.contentHash,
        conversion_warning_count: chunk.conversionWarningCount,
        sensitivity: normalizeSensitivity(chunk.sensitivity),
        topic: chunk.topic ?? undefined,
        owner: chunk.owner ?? undefined,
        created_at: chunk.createdAt,
        ...provenancePayload(collectionName, {
          ...chunk,
          sourceDocumentId,
        }),
      },
    })),
  });
}

export async function documentExists(sector: Sector, documentId: string) {
  const collectionName = collectionForSector(sector);
  await ensureCollection(collectionName);

  const response = await client.count(collectionName, {
    filter: {
      must: [
        {
          key: "document_id",
          match: { value: documentId },
        },
      ],
    },
    exact: true,
  });

  return response.count > 0;
}

export async function searchChunks(
  questionVector: number[],
  sector: Sector,
  options: { sourceDocumentIds?: string[]; shareableOnly?: boolean } = {},
) {
  const collectionName = collectionForSector(sector);
  await ensureCollection(collectionName);

  if (options.sourceDocumentIds && options.sourceDocumentIds.length === 0) {
    return [] as SearchMatch[];
  }

  const filter =
    options.sourceDocumentIds || options.shareableOnly
      ? {
          ...(options.sourceDocumentIds
            ? {
                should: options.sourceDocumentIds.map((sourceDocumentId) => ({
                  key: "source_document_id",
                  match: { value: sourceDocumentId },
                })),
              }
            : {}),
          ...(options.shareableOnly
            ? {
                must_not: [
                  {
                    key: "sensitivity",
                    match: { any: ["confidential", "restricted"] },
                  },
                ],
              }
            : {}),
        }
      : undefined;

  const matches = await client.search(collectionName, {
    vector: questionVector,
    limit: appConfig.chatTopK,
    with_payload: true,
    ...(filter ? { filter } : {}),
  });

  return matches.map((match) => {
    const payload = (match.payload ?? {}) as Record<string, unknown>;

    return {
      score: Number(match.score ?? 0),
      documentId: String(payload.document_id ?? ""),
      sourceDocumentId:
        typeof payload.source_document_id === "string"
          ? payload.source_document_id
          : undefined,
      fileName: String(payload.file_name ?? ""),
      relativePath:
        typeof payload.relative_path === "string"
          ? payload.relative_path
          : undefined,
      documentTitle: String(payload.document_title ?? payload.file_name ?? ""),
      sourceFormat:
        String(payload.source_format ?? "markdown") === "docx"
          ? "docx"
          : String(payload.source_format ?? "markdown") === "doc"
            ? "doc"
            : String(payload.source_format ?? "markdown") === "pdf"
              ? "pdf"
              : "markdown",
      headingPathText: String(payload.heading_path_text ?? "Documento"),
      content: String(payload.content ?? ""),
      contentPreview: String(payload.content_preview ?? ""),
      chunkIndex: Number(payload.chunk_index ?? 0),
    } satisfies SearchMatch;
  });
}

export type AdminChunkRow = {
  id: string | number;
  sector: string;
  collectionName?: string;
  ragPointId?: string;
  ragChunkRef?: string;
  graphDocumentId?: string;
  graphSourceDocumentId?: string;
  graphChunkNodeId?: string;
  documentId: string;
  sourceDocumentId?: string;
  documentTitle: string;
  fileName: string;
  relativePath?: string;
  headingPathText: string;
  sourceFormat: string;
  chunkIndex: number;
  contentPreview: string;
  content: string;
  contentHash?: string;
  sensitivity?: string;
  topic?: string;
  owner?: string;
  createdAt?: string;
  score?: number;
  documentType?: string;
  authorityLevel?: string;
  sourceType?: string;
  source?: "promoted" | "staging";
};

function payloadToRow(
  sector: string,
  id: string | number,
  payload: Record<string, unknown>,
  score?: number,
  collectionName?: string,
): AdminChunkRow {
  return {
    id,
    sector,
    collectionName,
    ragPointId:
      typeof payload.rag_point_id === "string" || typeof payload.rag_point_id === "number"
        ? String(payload.rag_point_id)
        : String(id),
    ragChunkRef:
      typeof payload.rag_chunk_ref === "string"
        ? payload.rag_chunk_ref
        : collectionName
          ? graphChunkNodeId(collectionName, id)
          : undefined,
    graphDocumentId:
      typeof payload.graph_document_id === "string"
        ? payload.graph_document_id
        : typeof payload.source_document_id === "string"
          ? payload.source_document_id
          : typeof payload.document_id === "string"
            ? payload.document_id
            : undefined,
    graphSourceDocumentId:
      typeof payload.graph_source_document_id === "string"
        ? payload.graph_source_document_id
        : typeof payload.source_document_id === "string"
          ? payload.source_document_id
          : undefined,
    graphChunkNodeId:
      typeof payload.graph_chunk_node_id === "string"
        ? payload.graph_chunk_node_id
        : collectionName
          ? graphChunkNodeId(collectionName, id)
          : undefined,
    documentId: String(payload.document_id ?? ""),
    sourceDocumentId:
      typeof payload.source_document_id === "string"
        ? payload.source_document_id
        : undefined,
    documentTitle: String(payload.document_title ?? payload.file_name ?? ""),
    fileName: String(payload.file_name ?? ""),
    relativePath:
      typeof payload.relative_path === "string" ? payload.relative_path : undefined,
    headingPathText: String(payload.heading_path_text ?? "Documento"),
    sourceFormat: String(payload.source_format ?? "markdown"),
    chunkIndex: Number(payload.chunk_index ?? 0),
    contentPreview: String(payload.content_preview ?? ""),
    content: String(payload.content ?? ""),
    contentHash:
      typeof payload.content_hash === "string" ? payload.content_hash : undefined,
    sensitivity:
      typeof payload.sensitivity === "string"
        ? normalizeSensitivity(payload.sensitivity)
        : undefined,
    topic: typeof payload.topic === "string" ? payload.topic : undefined,
    owner: typeof payload.owner === "string" ? payload.owner : undefined,
    createdAt:
      typeof payload.created_at === "string" ? payload.created_at : undefined,
    score,
    documentType:
      typeof payload.document_type === "string" ? payload.document_type : undefined,
    authorityLevel:
      typeof payload.authority_level === "string" ? payload.authority_level : undefined,
    sourceType:
      typeof payload.source_type === "string" ? payload.source_type : undefined,
  };
}

export async function listSectorChunks(
  sector: string,
  options: {
    limit?: number;
    offset?: string | number | null;
    textQuery?: string;
    sourceDocumentId?: string;
  } = {},
): Promise<{ rows: AdminChunkRow[]; nextOffset: string | number | null; total: number }> {
  const collectionName = collectionForSector(sector);
  await ensureCollection(collectionName);

  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const textQuery = options.textQuery?.trim();

  const must = [
    ...(textQuery
      ? [
          {
            key: "content",
            match: { text: textQuery },
          },
        ]
      : []),
    ...(options.sourceDocumentId
      ? [
          {
            key: "source_document_id",
            match: { value: options.sourceDocumentId },
          },
        ]
      : []),
  ];
  const filter = must.length > 0 ? { must } : undefined;

  const [scrollResult, countResult] = await Promise.all([
    client.scroll(collectionName, {
      limit,
      with_payload: true,
      with_vector: false,
      ...(filter ? { filter } : {}),
      ...(options.offset ? { offset: options.offset } : {}),
    }),
    client.count(collectionName, {
      exact: true,
      ...(filter ? { filter } : {}),
    }),
  ]);

  const rows = scrollResult.points.map((point) =>
    payloadToRow(
      sector,
      point.id as string | number,
      (point.payload ?? {}) as Record<string, unknown>,
      undefined,
      collectionName,
    ),
  );

  return {
    rows,
    nextOffset: (scrollResult.next_page_offset ?? null) as
      | string
      | number
      | null,
    total: countResult.count,
  };
}

export async function listStagedDocumentChunks(
  sector: string,
  sourceDocumentId: string,
): Promise<AdminChunkRow[]> {
  const collectionName = stagingCollectionForSector(sector);
  await ensureCollection(collectionName);

  const scrollResult = await client.scroll(collectionName, {
    limit: 200,
    with_payload: true,
    with_vector: false,
    filter: {
      must: [
        {
          key: "source_document_id",
          match: { value: sourceDocumentId },
        },
      ],
    },
  });

  return scrollResult.points
    .map((point) =>
      payloadToRow(
        sector,
        point.id as string | number,
        (point.payload ?? {}) as Record<string, unknown>,
        undefined,
        collectionName,
      ),
    )
    .sort((a, b) => a.chunkIndex - b.chunkIndex);
}

export async function semanticSearchSectorChunks(
  sector: string,
  vector: number[],
  options: { limit?: number } = {},
): Promise<{ rows: AdminChunkRow[]; total: number }> {
  const collectionName = collectionForSector(sector);
  await ensureCollection(collectionName);

  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));

  const [matches, countResult] = await Promise.all([
    client.search(collectionName, {
      vector,
      limit,
      with_payload: true,
    }),
    client.count(collectionName, { exact: true }),
  ]);

  const rows = matches.map((match) =>
    payloadToRow(
      sector,
      match.id as string | number,
      (match.payload ?? {}) as Record<string, unknown>,
      Number(match.score ?? 0),
      collectionName,
    ),
  );

  return { rows, total: countResult.count };
}

export async function semanticSearchChunksAcrossSources(input: {
  vector: number[];
  sector?: string | "all";
  sourceScope?: "promoted" | "staging" | "both";
  limit?: number;
  scoreThreshold?: number;
}) {
  const sectors = input.sector && input.sector !== "all" ? [input.sector] : SECTORS;
  const sourceScope = input.sourceScope ?? "both";
  const limit = Math.max(1, Math.min(input.limit ?? 30, 200));
  const scoreThreshold = input.scoreThreshold;
  const searches: Array<Promise<AdminChunkRow[]>> = [];

  for (const sector of sectors) {
    if (sourceScope === "promoted" || sourceScope === "both") {
      searches.push(
        ensureCollection(collectionForSector(sector)).then(() =>
          client
          .search(collectionForSector(sector), {
            vector: input.vector,
            limit,
            with_payload: true,
            ...(scoreThreshold !== undefined ? { score_threshold: scoreThreshold } : {}),
          })
          .then((matches) =>
            matches.map((match) => ({
              ...payloadToRow(
                sector,
                match.id as string | number,
                (match.payload ?? {}) as Record<string, unknown>,
                Number(match.score ?? 0),
                collectionForSector(sector),
              ),
              source: "promoted" as const,
            })),
          )),
      );
    }

    if (sourceScope === "staging" || sourceScope === "both") {
      searches.push(
        ensureCollection(stagingCollectionForSector(sector)).then(() =>
          client
          .search(stagingCollectionForSector(sector), {
            vector: input.vector,
            limit,
            with_payload: true,
            ...(scoreThreshold !== undefined ? { score_threshold: scoreThreshold } : {}),
          })
          .then((matches) =>
            matches.map((match) => ({
              ...payloadToRow(
                sector,
                match.id as string | number,
                (match.payload ?? {}) as Record<string, unknown>,
                Number(match.score ?? 0),
                stagingCollectionForSector(sector),
              ),
              source: "staging" as const,
            })),
          )),
      );
    }
  }

  const rows = (await Promise.all(searches))
    .flat()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);

  return { rows, total: rows.length };
}

export async function checkQdrantHealth() {
  await client.getCollections();
  return true;
}

export async function listQdrantCollections(): Promise<string[]> {
  const { collections } = await client.getCollections();
  return collections.map((collection) => collection.name).sort();
}

async function countCollectionPoints(collectionName: string): Promise<number> {
  try {
    const info = await client.getCollection(collectionName);
    return info.points_count ?? 0;
  } catch {
    return 0;
  }
}

export async function countSectorDocuments(sector: string): Promise<{
  publicChunks: number;
  stagingChunks: number;
}> {
  const [publicChunks, stagingChunks] = await Promise.all([
    countCollectionPoints(collectionForSector(sector)),
    countCollectionPoints(stagingCollectionForSector(sector)),
  ]);
  return { publicChunks, stagingChunks };
}

export type QdrantDocumentSummary = {
  sector: string;
  sourceDocumentId: string;
  documentId: string;
  documentTitle: string;
  fileName: string;
  chunkCount: number;
};

/**
 * Scrolls a production collection and returns one summary entry per unique
 * source document. Stops after reading up to `maxPoints` payload entries.
 */
export async function listUniqueDocumentsInCollection(
  sector: string,
  maxPoints = 1000,
): Promise<QdrantDocumentSummary[]> {
  const collectionName = collectionForSector(sector);
  try {
    await ensureCollection(collectionName);
  } catch {
    return [];
  }

  const seen = new Map<string, QdrantDocumentSummary>();
  let offset: string | number | null = null;
  let fetched = 0;

  while (fetched < maxPoints) {
    const batch = await client.scroll(collectionName, {
      limit: Math.min(200, maxPoints - fetched),
      with_payload: true,
      with_vector: false,
      ...(offset !== null ? { offset } : {}),
    });

    for (const point of batch.points) {
      const p = (point.payload ?? {}) as Record<string, unknown>;
      const srcId = String(p.source_document_id ?? p.document_id ?? "");
      if (!srcId) continue;

      const existing = seen.get(srcId);
      if (existing) {
        existing.chunkCount += 1;
      } else {
        seen.set(srcId, {
          sector,
          sourceDocumentId: srcId,
          documentId: String(p.document_id ?? srcId),
          documentTitle: String(p.document_title ?? p.file_name ?? "Sem título"),
          fileName: String(p.file_name ?? ""),
          chunkCount: 1,
        });
      }
    }

    fetched += batch.points.length;
    const nextOffset = batch.next_page_offset;
    offset = (typeof nextOffset === "string" || typeof nextOffset === "number")
      ? nextOffset
      : null;
    if (offset === null) break;
  }

  return Array.from(seen.values());
}

export type RagChunkSource = "promoted" | "staging";

function collectionForRagChunkSource(sector: string, source: RagChunkSource) {
  return source === "staging"
    ? stagingCollectionForSector(sector)
    : collectionForSector(sector);
}

export async function fetchDocumentChunkRows(
  sector: string,
  sourceDocumentId: string,
  options: { source?: RagChunkSource; limit?: number } = {},
): Promise<AdminChunkRow[]> {
  const source = options.source ?? "promoted";
  const collectionName = collectionForRagChunkSource(sector, source);
  await ensureCollection(collectionName);

  const result = await client.scroll(collectionName, {
    limit: Math.max(1, Math.min(options.limit ?? 500, 1000)),
    with_payload: true,
    with_vector: false,
    filter: {
      should: [
        { key: "source_document_id", match: { value: sourceDocumentId } },
        { key: "document_id", match: { value: sourceDocumentId } },
      ],
    },
  });

  return result.points
    .map((point) => ({
      ...payloadToRow(
        sector as Sector,
        point.id as string | number,
        (point.payload ?? {}) as Record<string, unknown>,
        undefined,
        collectionName,
      ),
      source,
    }))
    .sort((a, b) => a.chunkIndex - b.chunkIndex);
}

export async function markDocumentChunksAsGraphed(input: {
  sector: string;
  sourceDocumentId: string;
  source?: RagChunkSource;
  graphDocumentId: string;
}) {
  const rows = await fetchDocumentChunkRows(input.sector, input.sourceDocumentId, {
    source: input.source,
  });
  if (rows.length === 0) {
    return {
      updated: 0,
      collectionName: collectionForRagChunkSource(
        input.sector,
        input.source ?? "promoted",
      ),
    };
  }

  const collectionName = collectionForRagChunkSource(
    input.sector,
    input.source ?? "promoted",
  );
  const now = new Date().toISOString();

  await client.setPayload(collectionName, {
    wait: true,
    points: rows.map((row) => row.id),
    payload: {
      graph_document_id: input.graphDocumentId,
      graph_source_document_id: input.sourceDocumentId,
      graph_extracted_at: now,
    },
  });

  return { updated: rows.length, collectionName };
}

/**
 * Fetches all chunk contents for a given source document from a sector
 * collection, ordered by chunk_index. Used for graph extraction without
 * needing the Postgres curation record.
 */
export async function fetchDocumentChunks(
  sector: string,
  sourceDocumentId: string,
): Promise<string> {
  const rows = await fetchDocumentChunkRows(sector, sourceDocumentId);

  return rows.map((row) => row.content).join("\n\n");
}

/**
 * Update content + vector of a single chunk in the production collection of a
 * sector, preserving the existing payload (except content/preview/hash and a
 * small audit field). Used by people-reclassify to rewrite chunks where a
 * person name was replaced by another entity name.
 */
export async function updateChunkContent(input: {
  sector: string;
  pointId: string | number;
  newContent: string;
  newVector: number[];
  newContentHash: string;
  auditNote?: Record<string, unknown>;
}): Promise<void> {
  const collectionName = collectionForSector(input.sector);
  await ensureCollection(collectionName);

  await client.updateVectors(collectionName, {
    wait: true,
    points: [
      {
        id: input.pointId,
        vector: input.newVector,
      },
    ],
  });

  await client.setPayload(collectionName, {
    wait: true,
    points: [input.pointId],
    payload: {
      content: input.newContent,
      content_preview: input.newContent.slice(0, 600),
      content_hash: input.newContentHash,
      ...(input.auditNote ?? {}),
    },
  });
}

/**
 * Fetch chunks in a sector whose audit payload matches a previous
 * reclassification, so we can reverse text+embedding.
 */
export async function findChunksByReclassificationAudit(input: {
  sector: string;
  pointIds: Array<string | number>;
}): Promise<AdminChunkRow[]> {
  if (input.pointIds.length === 0) return [];
  const collectionName = collectionForSector(input.sector);
  await ensureCollection(collectionName);

  const result = await client.retrieve(collectionName, {
    ids: input.pointIds,
    with_payload: true,
    with_vector: false,
  });

  return result.map((point) =>
    payloadToRow(
      input.sector,
      point.id as string | number,
      (point.payload ?? {}) as Record<string, unknown>,
      undefined,
      collectionName,
    ),
  );
}

/**
 * Updates the document_title in the payload of every chunk that belongs to a
 * source document, in the production collection of a sector. Vectors and
 * content are left untouched.
 */
export async function updateDocumentTitleInQdrant(input: {
  sector: string;
  sourceDocumentId: string;
  newTitle: string;
}): Promise<{ updated: number }> {
  const collectionName = collectionForSector(input.sector);
  await ensureCollection(collectionName);

  const rows = await fetchDocumentChunkRows(input.sector, input.sourceDocumentId, {
    source: "promoted",
  });

  if (rows.length === 0) return { updated: 0 };

  await client.setPayload(collectionName, {
    wait: true,
    points: rows.map((row) => row.id),
    payload: {
      document_title: input.newTitle,
      title_updated_at: new Date().toISOString(),
    },
  });

  return { updated: rows.length };
}

/**
 * Clears the reclassification audit fields and resets content/hash. Vector is
 * provided by the caller (already re-embedded from the restored text).
 */
export async function revertChunkContent(input: {
  sector: string;
  pointId: string | number;
  newContent: string;
  newVector: number[];
  newContentHash: string;
}): Promise<void> {
  const collectionName = collectionForSector(input.sector);
  await ensureCollection(collectionName);

  await client.updateVectors(collectionName, {
    wait: true,
    points: [
      {
        id: input.pointId,
        vector: input.newVector,
      },
    ],
  });

  await client.setPayload(collectionName, {
    wait: true,
    points: [input.pointId],
    payload: {
      content: input.newContent,
      content_preview: input.newContent.slice(0, 600),
      content_hash: input.newContentHash,
      reclassified_from_person: null,
      reclassified_to: null,
      reclassified_at: null,
      reverted_at: new Date().toISOString(),
    },
  });
}
