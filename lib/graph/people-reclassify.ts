import { runQuery } from "@/lib/neo4j";

export type ReclassifyTargetType =
  | "Person"
  | "Concept"
  | "Procedure"
  | "System"
  | "Regulation";

export const TARGET_TYPE_LABELS: Record<ReclassifyTargetType, string> = {
  Person: "Pessoa",
  Concept: "Conceito",
  Procedure: "Processo",
  System: "Sistema",
  Regulation: "Regulamentação",
};

const TARGET_RELATION: Record<ReclassifyTargetType, string> = {
  Person: "INVOLVES_PERSON",
  Concept: "HAS_CONCEPT",
  Procedure: "DESCRIBES",
  System: "REFERENCES_SYSTEM",
  Regulation: "COMPLIES_WITH",
};

const TARGET_LOWERCASE_NAME: Record<ReclassifyTargetType, boolean> = {
  Person: false,
  Concept: true,
  Procedure: true,
  System: false,
  Regulation: false,
};

export function normalizeTargetName(
  type: ReclassifyTargetType,
  rawName: string,
) {
  const trimmed = rawName.trim();
  return TARGET_LOWERCASE_NAME[type] ? trimmed.toLowerCase() : trimmed;
}

export type PersonSummary = {
  name: string;
  documentCount: number;
  chunkCount: number;
  sectors: string[];
};

export async function listPersons(sectorFilter?: string | null): Promise<PersonSummary[]> {
  const cypher = sectorFilter
    ? `MATCH (p:Person)
       OPTIONAL MATCH (d:Document)-[:INVOLVES_PERSON]->(p)
       WHERE d.sector = $sector
       OPTIONAL MATCH (c:RagChunk)-[:MENTIONS]->(p)
       WHERE c.sector = $sector
       WITH p, collect(DISTINCT d.id) AS docs, collect(DISTINCT c.id) AS chunks, collect(DISTINCT d.sector) AS sectors
       WHERE size(docs) > 0
       RETURN p.name AS name,
              size(docs) AS documentCount,
              size(chunks) AS chunkCount,
              [s IN sectors WHERE s IS NOT NULL] AS sectors
       ORDER BY documentCount DESC, name ASC`
    : `MATCH (p:Person)
       OPTIONAL MATCH (d:Document)-[:INVOLVES_PERSON]->(p)
       OPTIONAL MATCH (c:RagChunk)-[:MENTIONS]->(p)
       WITH p, collect(DISTINCT d.id) AS docs, collect(DISTINCT c.id) AS chunks, collect(DISTINCT d.sector) AS sectors
       RETURN p.name AS name,
              size(docs) AS documentCount,
              size(chunks) AS chunkCount,
              [s IN sectors WHERE s IS NOT NULL] AS sectors
       ORDER BY documentCount DESC, name ASC`;

  return runQuery<PersonSummary>(cypher, sectorFilter ? { sector: sectorFilter } : {});
}

export type AffectedDocument = {
  documentId: string;
  sourceDocumentId: string;
  title: string;
  sector: string;
  chunkIds: string[];
};

export async function listAffectedDocuments(
  personName: string,
): Promise<AffectedDocument[]> {
  const rows = await runQuery<{
    documentId: string;
    sourceDocumentId: string | null;
    title: string;
    sector: string;
    chunkIds: string[];
  }>(
    `MATCH (d:Document)-[:INVOLVES_PERSON]->(p:Person {name: $name})
     OPTIONAL MATCH (c:RagChunk)-[:MENTIONS]->(p)
     WHERE c.documentId = d.id
     WITH d, collect(DISTINCT c.id) AS chunkIds
     RETURN d.id AS documentId,
            d.sourceDocumentId AS sourceDocumentId,
            d.title AS title,
            d.sector AS sector,
            chunkIds
     ORDER BY d.sector, d.title`,
    { name: personName },
  );

  return rows.map((row) => ({
    documentId: row.documentId,
    sourceDocumentId: row.sourceDocumentId ?? row.documentId,
    title: row.title,
    sector: row.sector,
    chunkIds: row.chunkIds,
  }));
}

/**
 * For a single document, swap (Document)-[INVOLVES_PERSON]->(Person) for
 * (Document)-[<relation>]->(<TargetType>) and re-route the chunk MENTIONS edges
 * accordingly. The Person node itself is not deleted here; cleanup happens via
 * dropPersonIfOrphan() once all documents have been reclassified.
 */
export async function reclassifyPersonForDocument(input: {
  personName: string;
  targetType: ReclassifyTargetType;
  targetName: string;
  documentId: string;
}): Promise<{ chunkEdges: number }> {
  const targetLabel = input.targetType;
  const targetRelation = TARGET_RELATION[input.targetType];
  const targetName = normalizeTargetName(input.targetType, input.targetName);

  // 1. Ensure target node exists, link Document to it, record evidence chunks.
  await runQuery(
    `MATCH (d:Document {id: $docId})
     OPTIONAL MATCH (d)-[:INVOLVES_PERSON]->(p:Person {name: $personName})
     OPTIONAL MATCH (c:RagChunk)-[:MENTIONS]->(p)
     WHERE c.documentId = d.id
     WITH d, collect(DISTINCT c.id) AS chunkIds
     MERGE (e:${targetLabel} {name: $targetName})
     ON CREATE SET e.createdAt = datetime()
     MERGE (d)-[r:${targetRelation}]->(e)
     SET r.ragDocumentId = d.id,
         r.ragSourceDocumentId = coalesce(d.sourceDocumentId, d.id),
         r.evidenceChunkIds = chunkIds,
         r.evidenceChunkCount = size(chunkIds),
         r.reclassifiedFromPerson = $personName,
         r.updatedAt = datetime()`,
    {
      docId: input.documentId,
      personName: input.personName,
      targetName,
    },
  );

  // 2. Rewire chunk MENTIONS: drop edges to Person, add to target entity.
  const rewireRows = await runQuery<{ count: number }>(
    `MATCH (c:RagChunk {documentId: $docId})-[m:MENTIONS]->(p:Person {name: $personName})
     WITH c, m
     MATCH (e:${targetLabel} {name: $targetName})
     MERGE (c)-[nm:MENTIONS]->(e)
     SET nm.graphDocumentId = $docId,
         nm.reclassifiedFromPerson = $personName,
         nm.updatedAt = datetime()
     DELETE m
     RETURN count(c) AS count`,
    {
      docId: input.documentId,
      personName: input.personName,
      targetName,
    },
  );

  // 3. Drop the Document -> Person edge for this document.
  await runQuery(
    `MATCH (d:Document {id: $docId})-[r:INVOLVES_PERSON]->(:Person {name: $personName})
     DELETE r`,
    { docId: input.documentId, personName: input.personName },
  );

  // 4. Drop any stale CO_OCCURS_WITH edges that touched the Person for this doc.
  await runQuery(
    `MATCH (:Person {name: $personName})-[r:CO_OCCURS_WITH]->()
     WHERE r.documentId = $docId
     DELETE r`,
    { docId: input.documentId, personName: input.personName },
  );

  return { chunkEdges: Number(rewireRows[0]?.count ?? 0) };
}

/**
 * Delete the :Person node if no INVOLVES_PERSON edges remain pointing at it.
 * Also clears any leftover MENTIONS edges or CO_OCCURS_WITH artifacts.
 */
export type RecentReclassification = {
  personName: string;
  targetType: ReclassifyTargetType;
  targetName: string;
  documentCount: number;
  lastUpdatedAt: string | null;
};

/**
 * Returns the most recent reclassifications, grouped by (originalPerson, target).
 * Uses the audit metadata stored on the Document->Target relationships.
 */
export async function listRecentReclassifications(
  limit = 50,
): Promise<RecentReclassification[]> {
  const rows = await runQuery<{
    personName: string;
    targetLabel: string;
    targetName: string;
    documentCount: number;
    lastUpdatedAt: string | null;
  }>(
    `MATCH (d:Document)-[r]->(e)
     WHERE r.reclassifiedFromPerson IS NOT NULL
     WITH r.reclassifiedFromPerson AS personName,
          labels(e)[0] AS targetLabel,
          e.name AS targetName,
          d,
          r
     WITH personName, targetLabel, targetName,
          count(DISTINCT d) AS documentCount,
          max(toString(r.updatedAt)) AS lastUpdatedAt
     RETURN personName, targetLabel, targetName, documentCount, lastUpdatedAt
     ORDER BY lastUpdatedAt DESC
     LIMIT $limit`,
    { limit },
  );

  return rows
    .filter((row): row is typeof row & { targetLabel: ReclassifyTargetType } =>
      ["Person", "Concept", "Procedure", "System", "Regulation"].includes(
        row.targetLabel,
      ),
    )
    .map((row) => ({
      personName: row.personName,
      targetType: row.targetLabel,
      targetName: row.targetName,
      documentCount: Number(row.documentCount ?? 0),
      lastUpdatedAt: row.lastUpdatedAt,
    }));
}

export type UndoAffectedDocument = {
  documentId: string;
  sourceDocumentId: string;
  sector: string;
  chunkPointIds: string[];
};

/**
 * Finds the documents currently affected by a previous reclassification, so
 * the API can fetch Qdrant chunks to revert the text+embedding rewrite before
 * touching the graph.
 */
export async function listUndoAffectedDocuments(input: {
  personName: string;
  targetType: ReclassifyTargetType;
  targetName: string;
}): Promise<UndoAffectedDocument[]> {
  const targetLabel = input.targetType;
  const targetName = normalizeTargetName(input.targetType, input.targetName);

  const rows = await runQuery<{
    documentId: string;
    sourceDocumentId: string | null;
    sector: string;
    chunkPointIds: string[];
  }>(
    `MATCH (d:Document)-[r]->(e:${targetLabel} {name: $targetName})
     WHERE r.reclassifiedFromPerson = $personName
     OPTIONAL MATCH (c:RagChunk)-[m:MENTIONS]->(e)
     WHERE m.reclassifiedFromPerson = $personName AND c.documentId = d.id
     WITH d, collect(DISTINCT c.pointId) AS pointIds
     RETURN d.id AS documentId,
            d.sourceDocumentId AS sourceDocumentId,
            d.sector AS sector,
            [pid IN pointIds WHERE pid IS NOT NULL] AS chunkPointIds`,
    { personName: input.personName, targetName },
  );

  return rows.map((row) => ({
    documentId: row.documentId,
    sourceDocumentId: row.sourceDocumentId ?? row.documentId,
    sector: row.sector,
    chunkPointIds: row.chunkPointIds,
  }));
}

/**
 * Reverse the graph side of a reclassification: rebuilds the Person node, moves
 * Document INVOLVES_PERSON and RagChunk MENTIONS edges back to it, and drops
 * the target entity if it is orphaned after the rollback.
 */
export async function undoReclassificationInGraph(input: {
  personName: string;
  targetType: ReclassifyTargetType;
  targetName: string;
}): Promise<{ documentEdges: number; chunkEdges: number; targetDropped: boolean }> {
  const targetLabel = input.targetType;
  const targetName = normalizeTargetName(input.targetType, input.targetName);

  await runQuery(
    `MERGE (p:Person {name: $personName})
     ON CREATE SET p.createdAt = datetime(), p.restoredAt = datetime()`,
    { personName: input.personName },
  );

  // 1. Move Document edges (roles not preserved on undo — re-extract after re-indexing if needed)
  const docRows = await runQuery<{ count: number }>(
    `MATCH (d:Document)-[r]->(e:${targetLabel} {name: $targetName})
     WHERE r.reclassifiedFromPerson = $personName
     MATCH (p:Person {name: $personName})
     MERGE (d)-[nr:INVOLVES_PERSON]->(p)
     SET nr.ragDocumentId = d.id,
         nr.ragSourceDocumentId = coalesce(d.sourceDocumentId, d.id),
         nr.updatedAt = datetime(),
         nr.restoredFrom = $targetLabel + ':' + $targetName
     DELETE r
     RETURN count(d) AS count`,
    {
      personName: input.personName,
      targetName,
      targetLabel,
    },
  );

  // 2. Move RagChunk edges
  const chunkRows = await runQuery<{ count: number }>(
    `MATCH (c:RagChunk)-[m:MENTIONS]->(e:${targetLabel} {name: $targetName})
     WHERE m.reclassifiedFromPerson = $personName
     MATCH (p:Person {name: $personName})
     MERGE (c)-[nm:MENTIONS]->(p)
     SET nm.graphDocumentId = m.graphDocumentId,
         nm.updatedAt = datetime(),
         nm.restoredFrom = $targetLabel + ':' + $targetName
     DELETE m
     RETURN count(c) AS count`,
    {
      personName: input.personName,
      targetName,
      targetLabel,
    },
  );

  // 3. Drop target node if nothing else points to it.
  let targetDropped = false;
  if (input.targetType !== "Person") {
    const remaining = await runQuery<{ count: number }>(
      `MATCH (e:${targetLabel} {name: $targetName})
       RETURN COUNT { (e)<--() } + COUNT { (e)-->() } AS count`,
      { targetName },
    );
    if (Number(remaining[0]?.count ?? 0) === 0) {
      await runQuery(
        `MATCH (e:${targetLabel} {name: $targetName}) DETACH DELETE e`,
        { targetName },
      );
      targetDropped = true;
    }
  }

  return {
    documentEdges: Number(docRows[0]?.count ?? 0),
    chunkEdges: Number(chunkRows[0]?.count ?? 0),
    targetDropped,
  };
}

export async function dropPersonIfOrphan(personName: string): Promise<boolean> {
  const remaining = await runQuery<{ count: number }>(
    `MATCH (:Document)-[r:INVOLVES_PERSON]->(:Person {name: $personName})
     RETURN count(r) AS count`,
    { personName },
  );

  if (Number(remaining[0]?.count ?? 0) > 0) {
    return false;
  }

  await runQuery(
    `MATCH (p:Person {name: $personName})
     DETACH DELETE p`,
    { personName },
  );

  return true;
}
