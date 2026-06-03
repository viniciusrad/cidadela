import type { AdminChunkRow } from "@/lib/qdrant";
import { runQuery } from "@/lib/neo4j";
import type { PersonWithRole } from "@/lib/graph/extractor";

export type GraphEntities = {
  concepts: string[];
  procedures: string[];
  systems: string[];
  regulations: string[];
  persons: string[];
  /** Pessoas com papéis detectados pelo extractor. Campo opcional para retrocompatibilidade. */
  personsWithRoles?: PersonWithRole[];
};

export type UpsertGraphDocumentInput = {
  documentId: string;
  legacyDocumentId?: string | null;
  curationDocumentId?: string | null;
  sourceDocumentId: string;
  title: string;
  sector: string;
  topic: string | null;
  documentType: string | null;
  status: string;
  entities: GraphEntities;
  ragChunks?: AdminChunkRow[];
};

export type UpsertGraphDocumentResult = {
  documentId: string;
  ragChunksLinked: number;
  entityRelationships: number;
  coOccurrenceEdges: number;
  typedPersonEdges: number;
  knowsAboutEdges: number;
};

type EntityGroup = {
  label: "Concept" | "Procedure" | "System" | "Regulation" | "Person";
  relation: "HAS_CONCEPT" | "DESCRIBES" | "REFERENCES_SYSTEM" | "COMPLIES_WITH" | "INVOLVES_PERSON";
  names: string[];
  lowerCaseName?: boolean;
  /** Mapa nome→roles para enriquecer a aresta INVOLVES_PERSON (Onda 3). Apenas para Person. */
  rolesMap?: Map<string, string[]>;
};

type GraphChunk = {
  id: string;
  pointId: string;
  collectionName: string;
  sector: string;
  documentId: string;
  sourceDocumentId: string;
  chunkIndex: number;
  headingPathText: string;
  contentHash: string | null;
  contentPreview: string;
  source: string;
  content: string;
};

function normalizeForEvidence(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function toGraphChunk(row: AdminChunkRow): GraphChunk {
  const pointId = row.ragPointId ?? String(row.id);
  const collectionName = row.collectionName ?? "";

  return {
    id: row.graphChunkNodeId ?? `${collectionName}:${pointId}`,
    pointId,
    collectionName,
    sector: row.sector,
    documentId: row.documentId,
    sourceDocumentId: row.sourceDocumentId ?? row.documentId,
    chunkIndex: row.chunkIndex,
    headingPathText: row.headingPathText,
    contentHash: row.contentHash ?? null,
    contentPreview: row.contentPreview || row.content.slice(0, 600),
    source: row.source ?? "promoted",
    content: row.content,
  };
}

function evidenceChunkIds(name: string, chunks: GraphChunk[]) {
  const normalizedName = normalizeForEvidence(name);
  if (!normalizedName) return [];

  return chunks
    .filter((chunk) => {
      const haystack = normalizeForEvidence(
        `${chunk.headingPathText}\n${chunk.content}`,
      );
      return haystack.includes(normalizedName);
    })
    .map((chunk) => chunk.id);
}

const GRAPH_CONSTRAINTS: ReadonlyArray<string> = [
  "CREATE CONSTRAINT document_id_unique IF NOT EXISTS FOR (n:Document) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT rag_chunk_id_unique IF NOT EXISTS FOR (n:RagChunk) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT concept_name_unique IF NOT EXISTS FOR (n:Concept) REQUIRE n.name IS UNIQUE",
  "CREATE CONSTRAINT procedure_name_unique IF NOT EXISTS FOR (n:Procedure) REQUIRE n.name IS UNIQUE",
  "CREATE CONSTRAINT system_name_unique IF NOT EXISTS FOR (n:System) REQUIRE n.name IS UNIQUE",
  "CREATE CONSTRAINT regulation_name_unique IF NOT EXISTS FOR (n:Regulation) REQUIRE n.name IS UNIQUE",
  "CREATE CONSTRAINT person_name_unique IF NOT EXISTS FOR (n:Person) REQUIRE n.name IS UNIQUE",
  "CREATE CONSTRAINT sector_slug_unique IF NOT EXISTS FOR (n:Sector) REQUIRE n.slug IS UNIQUE",
  "CREATE CONSTRAINT process_id_unique IF NOT EXISTS FOR (n:Process) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT topic_label_unique IF NOT EXISTS FOR (n:Topic) REQUIRE n.label IS UNIQUE",
];

export type SectorNodeInput = {
  slug: string;
  displayName?: string | null;
  agentName?: string | null;
  qdrantCollection?: string | null;
};

/**
 * Upserts a (:Sector) node keyed by slug. Idempotent.
 * The Postgres SectorDefinition is the source of truth; the graph node is a
 * projection kept in sync so Cypher queries can traverse Sector→Document/Process.
 */
export async function upsertSectorNode(input: SectorNodeInput): Promise<void> {
  if (!input.slug) return;
  await runQuery(
    `MERGE (s:Sector {slug: $slug})
     SET s.displayName = coalesce($displayName, s.displayName),
         s.agentName = coalesce($agentName, s.agentName),
         s.qdrantCollection = coalesce($qdrantCollection, s.qdrantCollection),
         s.updatedAt = datetime()`,
    {
      slug: input.slug,
      displayName: input.displayName ?? null,
      agentName: input.agentName ?? null,
      qdrantCollection: input.qdrantCollection ?? null,
    },
  );
}

/**
 * Ensures the (:Sector)-[:HAS_DOCUMENT]->(:Document) edge exists. The Sector
 * node is created on demand (slug only) if it does not already exist; richer
 * metadata is populated by syncSectorNodes() from Postgres.
 */
export async function ensureSectorDocumentLink(
  sectorSlug: string,
  documentId: string,
): Promise<void> {
  if (!sectorSlug || !documentId) return;
  await runQuery(
    `MERGE (s:Sector {slug: $slug})
     ON CREATE SET s.updatedAt = datetime()
     WITH s
     MATCH (d:Document {id: $documentId})
     MERGE (s)-[r:HAS_DOCUMENT]->(d)
     SET r.linkedAt = coalesce(r.linkedAt, datetime()),
         r.updatedAt = datetime()`,
    { slug: sectorSlug, documentId },
  );
}

export async function ensureGraphConstraints(): Promise<{
  applied: number;
  failed: Array<{ statement: string; error: string }>;
}> {
  const failed: Array<{ statement: string; error: string }> = [];
  let applied = 0;
  for (const statement of GRAPH_CONSTRAINTS) {
    try {
      await runQuery(statement);
      applied += 1;
    } catch (error) {
      failed.push({
        statement,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { applied, failed };
}

async function linkRagChunks(documentId: string, chunks: GraphChunk[]) {
  if (chunks.length === 0) return;

  await runQuery(
    `MATCH (d:Document {id: $documentId})
     WITH d
     UNWIND $chunks AS chunk
     MERGE (c:RagChunk {id: chunk.id})
     SET c.pointId = chunk.pointId,
         c.collection = chunk.collectionName,
         c.sector = chunk.sector,
         c.documentId = chunk.documentId,
         c.sourceDocumentId = chunk.sourceDocumentId,
         c.chunkIndex = chunk.chunkIndex,
         c.headingPathText = chunk.headingPathText,
         c.contentHash = chunk.contentHash,
         c.contentPreview = chunk.contentPreview,
         c.source = chunk.source,
         c.updatedAt = datetime()
     MERGE (d)-[r:HAS_RAG_CHUNK]->(c)
     SET r.linkedAt = datetime()`,
    { documentId, chunks },
  );
}

async function linkEntities(input: {
  documentId: string;
  sourceDocumentId: string;
  chunks: GraphChunk[];
  group: EntityGroup;
}) {
  await Promise.all(
    input.group.names.map((rawName) => {
      const name = input.group.lowerCaseName ? rawName.toLowerCase() : rawName;
      const chunkIds = evidenceChunkIds(name, input.chunks);

      // Para INVOLVES_PERSON, persistir roles se disponíveis (Onda 3)
      const roles = input.group.rolesMap?.get(rawName) ?? input.group.rolesMap?.get(rawName.toLowerCase()) ?? [];
      const hasRoles = input.group.relation === "INVOLVES_PERSON" && roles.length > 0;

      const rolesSuffix = hasRoles ? `r.roles = $roles,\n             ` : "";

      return runQuery(
        `MATCH (d:Document {id: $docId})
         MERGE (e:${input.group.label} {name: $name})
         ON CREATE SET e.createdAt = datetime()
         MERGE (d)-[r:${input.group.relation}]->(e)
         SET r.ragDocumentId = $docId,
             r.ragSourceDocumentId = $sourceDocumentId,
             r.evidenceChunkIds = $evidenceChunkIds,
             r.evidenceChunkCount = size($evidenceChunkIds),
             ${rolesSuffix}r.updatedAt = datetime()
         WITH e
         UNWIND $evidenceChunkIds AS chunkId
         MATCH (c:RagChunk {id: chunkId})
         MERGE (c)-[m:MENTIONS]->(e)
         SET m.graphDocumentId = $docId,
             m.updatedAt = datetime()`,
        {
          name,
          docId: input.documentId,
          sourceDocumentId: input.sourceDocumentId,
          evidenceChunkIds: chunkIds,
          ...(hasRoles ? { roles } : {}),
        },
      );
    }),
  );
}

/**
 * Derives typed PERFORMS and USES edges using Document-level edges as the bridge.
 *
 * PERFORMS: Person has role {executor, responsavel, owner} on a Document via
 * INVOLVES_PERSON, and that Document DESCRIBES a Procedure.
 * USES: Any Person linked to a Document via INVOLVES_PERSON where that Document
 * REFERENCES_SYSTEM a System.
 *
 * Using Document-level edges (not same-chunk co-occurrence) is required because
 * persons and procedures/systems typically appear in different sections of a
 * document and therefore land in different chunks.
 */
export async function deriveTypedPersonEdges(documentId: string): Promise<number> {
  const [performsRows, usesRows] = await Promise.all([
    runQuery<{ count: number }>(
      `MATCH (d:Document {id: $docId})-[ip:INVOLVES_PERSON]->(per:Person)
       WHERE size([role IN coalesce(ip.roles, []) WHERE role IN ['executor', 'responsavel', 'owner']]) > 0
       WITH per, ip.roles AS roles, d
       MATCH (d)-[:DESCRIBES]->(proc:Procedure)
       MERGE (per)-[r:PERFORMS]->(proc)
       SET r.role = CASE
             WHEN 'executor'   IN roles THEN 'executor'
             WHEN 'responsavel' IN roles THEN 'responsavel'
             ELSE 'owner'
           END,
           r.confidence = 'extracted',
           r.updatedAt = datetime()
       RETURN count(r) AS count`,
      { docId: documentId },
    ),
    runQuery<{ count: number }>(
      `MATCH (d:Document {id: $docId})-[:INVOLVES_PERSON]->(per:Person)
       MATCH (d)-[:REFERENCES_SYSTEM]->(sys:System)
       MERGE (per)-[r:USES]->(sys)
       SET r.confidence = 'extracted',
           r.updatedAt = datetime()
       RETURN count(r) AS count`,
      { docId: documentId },
    ),
  ]);
  return Number(performsRows[0]?.count ?? 0) + Number(usesRows[0]?.count ?? 0);
}

/**
 * Derives KNOWS_ABOUT edges between Person nodes and Concept nodes via the
 * Document they share. A Person involved in a Document that HAS_CONCEPT a
 * Concept is inferred to know about that concept.
 *
 * Using Document-level edges (not same-chunk co-occurrence) because persons
 * and concepts typically appear in different sections of a document.
 */
export async function derivePersonKnowsAbout(documentId: string): Promise<number> {
  const rows = await runQuery<{ count: number }>(
    `MATCH (d:Document {id: $docId})-[:INVOLVES_PERSON]->(per:Person)
     MATCH (d)-[:HAS_CONCEPT]->(concept:Concept)
     MERGE (per)-[r:KNOWS_ABOUT]->(concept)
     SET r.strength = coalesce(r.strength, 0) + 1,
         r.confidence = 'extracted',
         r.updatedAt = datetime()
     RETURN count(r) AS count`,
    { docId: documentId },
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * For a given document, finds all (Person, Procedure/System) pairs that share
 * at least one RagChunk via MENTIONS edges, and creates direct CO_OCCURS_WITH
 * edges between them. This makes Person→Procedure and Person→System queries
 * possible without traversing through Document nodes.
 *
 * Idempotent: uses MERGE, safe to call multiple times per document.
 */
export async function linkPersonCoOccurrences(documentId: string): Promise<number> {
  const rows = await runQuery<{ count: number }>(
    `MATCH (c:RagChunk)-[:MENTIONS]->(p:Person)
     WHERE c.documentId = $documentId
     MATCH (c)-[:MENTIONS]->(e)
     WHERE (e:Procedure OR e:System)
     WITH p, e, collect(DISTINCT c.id) AS chunkIds, head(labels(e)) AS relatedType
     MERGE (p)-[r:CO_OCCURS_WITH]->(e)
     SET r.evidenceChunkIds = chunkIds,
         r.documentId = $documentId,
         r.relatedType = relatedType,
         r.updatedAt = datetime()
     RETURN count(*) AS count`,
    { documentId },
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Creates (:Topic) nodes and (:Person)-[:IS_GO_TO_FOR]->(:Topic) edges from
 * the structured `person_goto_what` JSON produced by RelationTagInput.
 * Each situation can have multiple tags; each tag becomes a Topic label.
 * Idempotent: uses MERGE and increments strength on each curator confirmation.
 */
export async function upsertPersonGoToRelations(input: {
  personName: string;
  situations: Array<{ when: string; tags: string[] }>;
  confirmedBy: string;
  sector: string;
}): Promise<number> {
  if (!input.situations.length) return 0;

  let count = 0;
  for (const situation of input.situations) {
    const topics = situation.tags.length > 0
      ? situation.tags.map((t) => t.toLowerCase().trim())
      : [situation.when.slice(0, 50).toLowerCase().trim()];

    for (const topicLabel of topics) {
      if (!topicLabel) continue;
      await runQuery(
        `MERGE (p:Person {name: $name})
         MERGE (t:Topic {label: $label})
         ON CREATE SET t.createdAt = datetime(), t.sector = $sector
         MERGE (p)-[r:IS_GO_TO_FOR]->(t)
         SET r.situation = $situation,
             r.isTribal = true,
             r.confirmedBy = $confirmedBy,
             r.strength = coalesce(r.strength, 0) + 1,
             r.updatedAt = datetime()`,
        {
          name: input.personName,
          label: topicLabel,
          situation: situation.when,
          confirmedBy: input.confirmedBy,
          sector: input.sector,
        },
      );
      count++;
    }
  }
  return count;
}

/**
 * Creates (:Person)-[:COVERS_FOR]->(:Person) edges from the person_network field.
 * The list is expected to contain canonical person names already resolved by the
 * caller (e.g., extracted from free text with best-effort regex).
 */
export async function upsertPersonCoversFor(input: {
  personName: string;
  coversForNames: string[];
}): Promise<number> {
  if (!input.coversForNames.length) return 0;

  await runQuery(
    `MATCH (p:Person {name: $name})
     UNWIND $coversFor AS coverName
     MERGE (other:Person {name: coverName})
     ON CREATE SET other.createdAt = datetime()
     MERGE (p)-[r:COVERS_FOR]->(other)
     SET r.confidence = 'human_validated',
         r.updatedAt = datetime()`,
    { name: input.personName, coversFor: input.coversForNames },
  );
  return input.coversForNames.length;
}

export async function upsertGraphDocument(
  input: UpsertGraphDocumentInput,
): Promise<UpsertGraphDocumentResult> {
  const chunks = (input.ragChunks ?? []).map(toGraphChunk);
  const ragCollections = Array.from(
    new Set(chunks.map((chunk) => chunk.collectionName).filter(Boolean)),
  );

  await runQuery(
    `MERGE (d:Document {id: $id})
     SET d.title = $title,
         d.sector = $sector,
         d.topic = $topic,
         d.documentType = $documentType,
         d.status = $status,
         d.sourceDocumentId = $sourceDocumentId,
         d.legacyDocumentId = $legacyDocumentId,
         d.curationDocumentId = $curationDocumentId,
         d.ragCollections = $ragCollections,
         d.ragChunkCount = $ragChunkCount,
         d.extractedAt = datetime()`,
    {
      id: input.documentId,
      title: input.title,
      sector: input.sector,
      topic: input.topic,
      documentType: input.documentType,
      status: input.status,
      sourceDocumentId: input.sourceDocumentId,
      legacyDocumentId: input.legacyDocumentId ?? null,
      curationDocumentId: input.curationDocumentId ?? null,
      ragCollections,
      ragChunkCount: chunks.length,
    },
  );

  if (input.sector) {
    await ensureSectorDocumentLink(input.sector, input.documentId);
  }

  await linkRagChunks(input.documentId, chunks);

  const groups: EntityGroup[] = [
    {
      label: "Concept",
      relation: "HAS_CONCEPT",
      names: input.entities.concepts,
      lowerCaseName: true,
    },
    {
      label: "Procedure",
      relation: "DESCRIBES",
      names: input.entities.procedures,
      lowerCaseName: true,
    },
    {
      label: "System",
      relation: "REFERENCES_SYSTEM",
      names: input.entities.systems,
    },
    {
      label: "Regulation",
      relation: "COMPLIES_WITH",
      names: input.entities.regulations,
    },
    {
      label: "Person",
      relation: "INVOLVES_PERSON",
      names: input.entities.persons ?? [],
      rolesMap: input.entities.personsWithRoles
        ? new Map(input.entities.personsWithRoles.map((p) => [p.name, p.roles as string[]]))
        : undefined,
    },
  ];

  await Promise.all(
    groups.map((group) =>
      linkEntities({
        documentId: input.documentId,
        sourceDocumentId: input.sourceDocumentId,
        chunks,
        group,
      }),
    ),
  );

  const coOccurrenceEdges = await linkPersonCoOccurrences(input.documentId);
  const [typedPersonEdges, knowsAboutEdges] = await Promise.all([
    deriveTypedPersonEdges(input.documentId),
    derivePersonKnowsAbout(input.documentId),
  ]);

  return {
    documentId: input.documentId,
    ragChunksLinked: chunks.length,
    entityRelationships: groups.reduce(
      (total, group) => total + group.names.length,
      0,
    ),
    coOccurrenceEdges,
    typedPersonEdges,
    knowsAboutEdges,
  };
}
