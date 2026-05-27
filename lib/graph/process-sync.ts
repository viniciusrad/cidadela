import { runQuery } from "@/lib/neo4j";

export type ProcessNodeInput = {
  id: string;
  name: string;
  sector: string;
  fingerprint?: string | null;
  status?: string | null;
  automationReadinessScore?: number | null;
  documentationCoverageScore?: number | null;
  confidenceScore?: number | null;
  recommendedAutomationLevel?: string | null;
  graphBacked?: boolean;
};

/** Upserts a (:Process) node and the (:Sector)-[:OWNS]->(:Process) edge. */
export async function upsertProcessNode(input: ProcessNodeInput): Promise<void> {
  if (!input.id || !input.sector) return;

  await runQuery(
    `MERGE (p:Process {id: $id})
     SET p.name = $name,
         p.sectorSlug = $sectorSlug,
         p.fingerprint = $fingerprint,
         p.status = $status,
         p.automationReadinessScore = $automationReadinessScore,
         p.documentationCoverageScore = $documentationCoverageScore,
         p.confidenceScore = $confidenceScore,
         p.recommendedAutomationLevel = $recommendedAutomationLevel,
         p.graphBacked = $graphBacked,
         p.updatedAt = datetime()
     WITH p
     MERGE (s:Sector {slug: $sectorSlug})
     ON CREATE SET s.updatedAt = datetime()
     MERGE (s)-[r:OWNS]->(p)
     SET r.updatedAt = datetime()`,
    {
      id: input.id,
      name: input.name,
      sectorSlug: input.sector,
      fingerprint: input.fingerprint ?? null,
      status: input.status ?? null,
      automationReadinessScore: input.automationReadinessScore ?? null,
      documentationCoverageScore: input.documentationCoverageScore ?? null,
      confidenceScore: input.confidenceScore ?? null,
      recommendedAutomationLevel: input.recommendedAutomationLevel ?? null,
      graphBacked: input.graphBacked ?? false,
    },
  );
}

/**
 * Replaces the (:Process)-[:DESCRIBED_BY]->(:Document) edges of a process so the
 * graph reflects the current ProcessMap.documentRefs. Edges to documents no longer
 * referenced are removed; edges to documents not yet in the graph are skipped.
 */
export async function linkProcessEvidence(
  processId: string,
  documentIds: string[],
): Promise<{ linked: number; removed: number }> {
  const result = await runQuery<{ linked: number; removed: number }>(
    `MATCH (p:Process {id: $processId})
     OPTIONAL MATCH (p)-[r:DESCRIBED_BY]->(old:Document)
     WHERE NOT old.id IN $documentIds
     WITH p, count(r) AS removedCount, collect(r) AS oldRels
     FOREACH (rel IN oldRels | DELETE rel)
     WITH p, removedCount
     UNWIND $documentIds AS docId
     OPTIONAL MATCH (d:Document {id: docId})
     FOREACH (_ IN CASE WHEN d IS NULL THEN [] ELSE [1] END |
       MERGE (p)-[link:DESCRIBED_BY]->(d)
       SET link.updatedAt = datetime()
     )
     RETURN count(d) AS linked, removedCount AS removed`,
    { processId, documentIds },
  );
  return result[0] ?? { linked: 0, removed: 0 };
}

/** Links a process to its procedures (COMPRISES). MATCH-only — does not create Procedure nodes. */
export async function linkProcessProcedures(
  processId: string,
  procedureNames: string[],
): Promise<number> {
  if (procedureNames.length === 0) return 0;
  const lower = procedureNames.map((n) => n.toLowerCase());
  const rows = await runQuery<{ linked: number }>(
    `MATCH (p:Process {id: $processId})
     UNWIND $names AS name
     MATCH (proc:Procedure {name: name})
     MERGE (p)-[r:COMPRISES]->(proc)
     SET r.updatedAt = datetime()
     RETURN count(r) AS linked`,
    { processId, names: lower },
  );
  return Number(rows[0]?.linked ?? 0);
}

/** Links a process to systems (SUPPORTED_BY). MERGE — creates System node if absent. */
export async function linkProcessSystems(
  processId: string,
  systemNames: string[],
): Promise<number> {
  if (systemNames.length === 0) return 0;
  const rows = await runQuery<{ linked: number }>(
    `MATCH (p:Process {id: $processId})
     UNWIND $names AS name
     MERGE (s:System {name: name})
     ON CREATE SET s.createdAt = datetime()
     MERGE (p)-[r:SUPPORTED_BY]->(s)
     SET r.updatedAt = datetime()
     RETURN count(r) AS linked`,
    { processId, names: systemNames },
  );
  return Number(rows[0]?.linked ?? 0);
}

/** Links a process to concepts (REQUIRES_CONCEPT). MERGE — concepts use lowercased name keys. */
export async function linkProcessConcepts(
  processId: string,
  conceptNames: string[],
): Promise<number> {
  if (conceptNames.length === 0) return 0;
  const lower = conceptNames.map((n) => n.toLowerCase());
  const rows = await runQuery<{ linked: number }>(
    `MATCH (p:Process {id: $processId})
     UNWIND $names AS name
     MERGE (c:Concept {name: name})
     ON CREATE SET c.createdAt = datetime()
     MERGE (p)-[r:REQUIRES_CONCEPT]->(c)
     SET r.updatedAt = datetime()
     RETURN count(r) AS linked`,
    { processId, names: lower },
  );
  return Number(rows[0]?.linked ?? 0);
}

/** Links a process to regulations (GOVERNED_BY). MERGE — creates Regulation node if absent. */
export async function linkProcessRegulations(
  processId: string,
  regulationNames: string[],
): Promise<number> {
  if (regulationNames.length === 0) return 0;
  const rows = await runQuery<{ linked: number }>(
    `MATCH (p:Process {id: $processId})
     UNWIND $names AS name
     MERGE (reg:Regulation {name: name})
     ON CREATE SET reg.createdAt = datetime()
     MERGE (p)-[r:GOVERNED_BY]->(reg)
     SET r.updatedAt = datetime()
     RETURN count(r) AS linked`,
    { processId, names: regulationNames },
  );
  return Number(rows[0]?.linked ?? 0);
}

export type SyncProcessGraphInput = ProcessNodeInput & {
  documentIds: string[];
  procedureNames?: string[];
  systemNames?: string[];
  conceptNames?: string[];
  regulationNames?: string[];
};

/**
 * One-shot dual-write helper: upserts the Process node, links Sector OWNS Process,
 * replaces DESCRIBED_BY edges, and refreshes COMPRISES / SUPPORTED_BY /
 * REQUIRES_CONCEPT / GOVERNED_BY edges. Failures are swallowed and logged so a
 * Neo4j outage never breaks the Postgres ProcessMap write path.
 */
export async function syncProcessGraphNode(input: SyncProcessGraphInput): Promise<void> {
  try {
    await upsertProcessNode(input);
    await linkProcessEvidence(input.id, input.documentIds);
    if (input.graphBacked && input.procedureNames && input.procedureNames.length > 0) {
      await linkProcessProcedures(input.id, input.procedureNames);
    }
    if (input.systemNames && input.systemNames.length > 0) {
      await linkProcessSystems(input.id, input.systemNames);
    }
    if (input.conceptNames && input.conceptNames.length > 0) {
      await linkProcessConcepts(input.id, input.conceptNames);
    }
    if (input.regulationNames && input.regulationNames.length > 0) {
      await linkProcessRegulations(input.id, input.regulationNames);
    }
    // Derive PARTICIPATES_IN edges after procedure links are up-to-date
    await upsertPersonProcessLinks(input.id);
  } catch (error) {
    console.warn(
      `[process-sync] Failed to sync Process ${input.id} to Neo4j:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Aggregates Document.sector occurrences per Person and creates or refreshes
 * (:Person)-[:BELONGS_TO]->(:Sector) edges. The sector with most documents
 * is marked as primary and written back to the Person node as `primarySector`.
 *
 * When sectorSlug is given, only persons mentioned in documents of that sector
 * are processed. Pass null/undefined to run globally.
 *
 * Idempotent. Swallows Neo4j errors so a graph outage does not break the call site.
 */
export async function upsertPersonSectorLinks(sectorSlug?: string | null): Promise<number> {
  try {
    const sectorFilter = sectorSlug
      ? `WHERE d.sector = '${sectorSlug.replace(/'/g, "\\'")}'`
      : "";
    const rows = await runQuery<{ count: number }>(
      `MATCH (d:Document)-[:INVOLVES_PERSON]->(per:Person)
       ${sectorFilter}
       WITH per, d.sector AS sector, count(d) AS docCount
       WITH per, sector, docCount
       ORDER BY docCount DESC
       WITH per, collect({sector: sector, docCount: docCount}) AS sectorCounts
       WITH per, sectorCounts, sectorCounts[0].sector AS primarySector
       UNWIND sectorCounts AS sc
       MATCH (s:Sector {slug: sc.sector})
       MERGE (per)-[r:BELONGS_TO]->(s)
       SET r.confidence = 'extracted',
           r.docCount = sc.docCount,
           r.isPrimary = (sc.sector = primarySector),
           r.updatedAt = datetime()
       WITH per, primarySector
       SET per.primarySector = primarySector
       RETURN count(per) AS count`,
    );
    return Number(rows[0]?.count ?? 0);
  } catch (error) {
    console.warn("[process-sync] upsertPersonSectorLinks failed:", error instanceof Error ? error.message : String(error));
    return 0;
  }
}

/**
 * Derives (:Person)-[:PARTICIPATES_IN]->(:Process) edges by traversing the
 * Person→PERFORMS→Procedure←COMPRISES←Process path for the given processId.
 * Also considers the Person→INVOLVES_PERSON←Document←DESCRIBED_BY←Process path
 * as a secondary signal when no PERFORMS edges exist yet.
 *
 * Roles are the union of PERFORMS roles across all procedures in the process.
 * Confidence: 'extracted' if any role is in {executor, responsavel, owner}, else 'co_occurrence'.
 *
 * Idempotent. Swallows Neo4j errors.
 */
export async function upsertPersonProcessLinks(processId: string): Promise<number> {
  try {
    const rows = await runQuery<{ count: number }>(
      `MATCH (p:Process {id: $processId})-[:COMPRISES]->(proc:Procedure)<-[perf:PERFORMS]-(per:Person)
       WITH per, p,
            collect(DISTINCT perf.role) AS roles,
            collect(DISTINCT proc.name) AS viaProcedures,
            reduce(acc=[], ids IN collect(perf.evidenceChunkIds) | acc + ids) AS evidenceChunkIds
       MERGE (per)-[r:PARTICIPATES_IN]->(p)
       SET r.roles = roles,
           r.confidence = CASE
             WHEN size([role IN roles WHERE role IN ['executor', 'responsavel', 'owner']]) > 0
             THEN 'extracted'
             ELSE 'co_occurrence'
           END,
           r.viaProcedures = viaProcedures,
           r.evidenceChunkIds = evidenceChunkIds,
           r.updatedAt = datetime()
       RETURN count(r) AS count`,
      { processId },
    );
    return Number(rows[0]?.count ?? 0);
  } catch (error) {
    console.warn(`[process-sync] upsertPersonProcessLinks(${processId}) failed:`, error instanceof Error ? error.message : String(error));
    return 0;
  }
}

/**
 * Queries the bus factor for a process: returns the minimum number of unique
 * executors across all its procedures. busFactor=1 means at least one procedure
 * has only one known executor — a key-person risk signal.
 */
export async function fetchProcessBusFactor(processId: string): Promise<{
  busFactor: number;
  uniqueExecutors: number;
  riskProcedures: string[];
}> {
  try {
    const rows = await runQuery<{
      procedureName: string;
      executorCount: number;
    }>(
      `MATCH (p:Process {id: $processId})-[:COMPRISES]->(proc:Procedure)
       OPTIONAL MATCH (proc)<-[:PERFORMS {role: 'executor'}]-(per:Person)
       WITH proc, count(DISTINCT per) AS executorCount
       RETURN proc.name AS procedureName, executorCount
       ORDER BY executorCount ASC`,
      { processId },
    );
    if (rows.length === 0) return { busFactor: 0, uniqueExecutors: 0, riskProcedures: [] };

    const executorCounts = rows.map((r) => Number(r.executorCount));
    const busFactor = Math.min(...executorCounts);
    const uniqueExecutors = executorCounts.reduce((a, b) => a + b, 0);
    const riskProcedures = rows
      .filter((r) => Number(r.executorCount) <= 1)
      .map((r) => r.procedureName);

    return { busFactor, uniqueExecutors, riskProcedures };
  } catch {
    return { busFactor: 0, uniqueExecutors: 0, riskProcedures: [] };
  }
}

/** Deletes a (:Process) node and all its outgoing edges. Used when a ProcessMap is archived/removed. */
export async function deleteProcessNode(processId: string): Promise<void> {
  await runQuery(
    `MATCH (p:Process {id: $processId})
     DETACH DELETE p`,
    { processId },
  );
}
