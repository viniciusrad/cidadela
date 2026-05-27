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
  } catch (error) {
    console.warn(
      `[process-sync] Failed to sync Process ${input.id} to Neo4j:`,
      error instanceof Error ? error.message : String(error),
    );
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
