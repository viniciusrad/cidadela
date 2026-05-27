/**
 * Backfill Person entities and Person→Procedure/System co-occurrence edges
 * in Neo4j for documents already indexed.
 *
 * Does NOT touch Qdrant (no re-embedding). For each Document node already in
 * the graph, the script:
 *   1. Fetches the chunk contents from the Qdrant production collection.
 *   2. Runs extractEntities to identify persons mentioned in the document.
 *   3. Creates (:Person) nodes, (Document)-[:INVOLVES_PERSON]->(Person) edges,
 *      and (RagChunk)-[:MENTIONS]->(Person) edges where evidence exists.
 *   4. Creates (Person)-[:CO_OCCURS_WITH]->(Procedure/System) edges for every
 *      Person and Procedure/System pair that share at least one RagChunk.
 *
 * Idempotent: all writes use MERGE, so the script can be re-run safely.
 *
 * Usage:
 *   npx tsx scripts/backfill-person-entities.ts
 *   npx tsx scripts/backfill-person-entities.ts --dry-run
 *   npx tsx scripts/backfill-person-entities.ts --sector desenvolvimento
 */

import { extractEntities } from "@/lib/graph/extractor";
import { linkPersonCoOccurrences } from "@/lib/graph/persistence";
import { runQuery } from "@/lib/neo4j";
import { fetchDocumentChunks } from "@/lib/qdrant";

// ─── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const sectorArg = (() => {
  const idx = args.indexOf("--sector");
  return idx !== -1 ? args[idx + 1] : null;
})();

// ─── Types ────────────────────────────────────────────────────────────────────

type DocumentNode = {
  id: string;
  title: string;
  sector: string;
  sourceDocumentId: string | null;
};

// ─── Neo4j helpers ────────────────────────────────────────────────────────────

async function listDocumentNodes(sector: string | null): Promise<DocumentNode[]> {
  const cypher = sector
    ? `MATCH (d:Document) WHERE d.sector = $sector RETURN d.id AS id, d.title AS title, d.sector AS sector, d.sourceDocumentId AS sourceDocumentId ORDER BY d.extractedAt`
    : `MATCH (d:Document) RETURN d.id AS id, d.title AS title, d.sector AS sector, d.sourceDocumentId AS sourceDocumentId ORDER BY d.extractedAt`;

  return runQuery<DocumentNode>(cypher, sector ? { sector } : {});
}

async function alreadyHasPersons(documentId: string): Promise<boolean> {
  const rows = await runQuery<{ count: number }>(
    `MATCH (d:Document {id: $id})-[:INVOLVES_PERSON]->() RETURN count(*) AS count`,
    { id: documentId },
  );
  return (rows[0]?.count ?? 0) > 0;
}

async function linkPersonEntities(
  documentId: string,
  sourceDocumentId: string,
  persons: string[],
): Promise<number> {
  if (persons.length === 0) return 0;

  // Collect RagChunk ids that mention each person name for evidence links
  type ChunkRow = { id: string; headingPathText: string; content: string };
  const chunkRows = await runQuery<ChunkRow>(
    `MATCH (c:RagChunk {documentId: $documentId}) RETURN c.id AS id, c.headingPathText AS headingPathText, c.content AS content`,
    { documentId },
  );

  function evidenceChunkIds(name: string): string[] {
    const needle = name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
    if (!needle) return [];
    return chunkRows
      .filter((c) => {
        const haystack = `${c.headingPathText}\n${c.content}`
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase();
        return haystack.includes(needle);
      })
      .map((c) => c.id);
  }

  let linked = 0;
  for (const rawName of persons) {
    const chunkIds = evidenceChunkIds(rawName);
    await runQuery(
      `MATCH (d:Document {id: $docId})
       MERGE (p:Person {name: $name})
       ON CREATE SET p.createdAt = datetime()
       MERGE (d)-[r:INVOLVES_PERSON]->(p)
       SET r.ragDocumentId = $docId,
           r.ragSourceDocumentId = $sourceDocumentId,
           r.evidenceChunkIds = $evidenceChunkIds,
           r.evidenceChunkCount = size($evidenceChunkIds),
           r.updatedAt = datetime()
       WITH p
       UNWIND $evidenceChunkIds AS chunkId
       MATCH (c:RagChunk {id: chunkId})
       MERGE (c)-[m:MENTIONS]->(p)
       SET m.graphDocumentId = $docId,
           m.updatedAt = datetime()`,
      {
        name: rawName,
        docId: documentId,
        sourceDocumentId,
        evidenceChunkIds: chunkIds,
      },
    );
    linked++;
  }

  return linked;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nBackfill Person entities${DRY_RUN ? " [DRY RUN]" : ""}${sectorArg ? ` — sector: ${sectorArg}` : ""}\n`);

  const docs = await listDocumentNodes(sectorArg);
  console.log(`Found ${docs.length} Document node(s) in graph.\n`);

  let skipped = 0;
  let processed = 0;
  let totalPersons = 0;
  let totalCoOccurrences = 0;
  let errors = 0;

  for (const doc of docs) {
    const label = `[${doc.sector}] ${doc.title} (${doc.id.slice(0, 12)}...)`;

    const hasPersons = await alreadyHasPersons(doc.id);
    if (hasPersons) {
      console.log(`  SKIP  ${label} — already has Person links`);
      skipped++;
      continue;
    }

    let content: string;
    try {
      content = await fetchDocumentChunks(doc.sector, doc.sourceDocumentId ?? doc.id);
    } catch (err) {
      console.error(`  ERROR ${label} — fetchDocumentChunks failed:`, err);
      errors++;
      continue;
    }

    if (!content.trim()) {
      console.log(`  SKIP  ${label} — no chunk content found in Qdrant`);
      skipped++;
      continue;
    }

    let entities;
    try {
      entities = await extractEntities(content);
    } catch (err) {
      console.error(`  ERROR ${label} — extractEntities failed:`, err);
      errors++;
      continue;
    }

    const persons = entities.persons ?? [];
    console.log(`  ${DRY_RUN ? "DRY   " : "WRITE "} ${label} — persons: [${persons.join(", ") || "none"}]`);

    if (!DRY_RUN) {
      if (persons.length > 0) {
        try {
          const linked = await linkPersonEntities(
            doc.id,
            doc.sourceDocumentId ?? doc.id,
            persons,
          );
          totalPersons += linked;
        } catch (err) {
          console.error(`  ERROR ${label} — linkPersonEntities failed:`, err);
          errors++;
          continue;
        }
      }

      try {
        const coEdges = await linkPersonCoOccurrences(doc.id);
        if (coEdges > 0) {
          console.log(`        co-occurrence edges: ${coEdges}`);
        }
        totalCoOccurrences += coEdges;
      } catch (err) {
        console.error(`  ERROR ${label} — linkPersonCoOccurrences failed:`, err);
      }
    } else {
      totalPersons += persons.length;
    }

    processed++;
  }

  console.log(`\n─── Summary ───────────────────────────────────`);
  console.log(`  Documents processed : ${processed}`);
  console.log(`  Documents skipped   : ${skipped}`);
  console.log(`  Errors              : ${errors}`);
  console.log(`  Person links${DRY_RUN ? " (dry)" : ""}    : ${totalPersons}`);
  console.log(`  Co-occurrence edges${DRY_RUN ? " (dry)" : ""}: ${totalCoOccurrences}`);
  if (DRY_RUN) console.log(`\n  Re-run without --dry-run to apply changes.`);
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
