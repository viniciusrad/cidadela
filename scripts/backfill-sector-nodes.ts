/**
 * Backfill Sector nodes and (:Sector)-[:HAS_DOCUMENT]->(:Document) edges in
 * Neo4j. Reads SectorDefinition (Postgres) as the source of truth for sector
 * metadata, then links every existing Document node to its Sector based on
 * the Document.sector property already present in the graph.
 *
 * Does NOT touch Qdrant. Does NOT re-extract entities. No reingestion.
 *
 * Idempotent: all writes use MERGE. Safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/backfill-sector-nodes.ts
 *   npx tsx scripts/backfill-sector-nodes.ts --dry-run
 *   npx tsx scripts/backfill-sector-nodes.ts --sector desenvolvimento
 */

import { runQuery } from "@/lib/neo4j";
import { syncSectorNodes } from "@/lib/graph/sector-sync";
import { ensureSectorDocumentLink } from "@/lib/graph/persistence";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const sectorArg = (() => {
  const idx = args.indexOf("--sector");
  return idx !== -1 ? args[idx + 1] : null;
})();

type DocRow = { id: string; sector: string };

async function listDocumentsWithSector(filter: string | null): Promise<DocRow[]> {
  const cypher = filter
    ? `MATCH (d:Document) WHERE d.sector = $sector AND d.sector IS NOT NULL
       RETURN d.id AS id, d.sector AS sector`
    : `MATCH (d:Document) WHERE d.sector IS NOT NULL
       RETURN d.id AS id, d.sector AS sector`;
  return runQuery<DocRow>(cypher, filter ? { sector: filter } : {});
}

async function main() {
  console.log(
    `\nBackfill Sector nodes${DRY_RUN ? " [DRY RUN]" : ""}${sectorArg ? ` — sector: ${sectorArg}` : ""}\n`,
  );

  if (!DRY_RUN) {
    const sync = await syncSectorNodes();
    console.log(`  Synced ${sync.synced} sector node(s) from SectorDefinition`);
    if (sync.failed.length > 0) {
      console.warn(`  Sector sync failures:`, sync.failed);
    }
  } else {
    console.log(`  (dry-run: skipping SectorDefinition → Sector node sync)`);
  }

  const docs = await listDocumentsWithSector(sectorArg);
  console.log(`  Found ${docs.length} Document node(s) with sector property\n`);

  const bySector = new Map<string, number>();
  let linked = 0;
  let errors = 0;

  for (const doc of docs) {
    bySector.set(doc.sector, (bySector.get(doc.sector) ?? 0) + 1);
    if (DRY_RUN) {
      linked++;
      continue;
    }
    try {
      await ensureSectorDocumentLink(doc.sector, doc.id);
      linked++;
    } catch (err) {
      console.error(`  ERROR linking ${doc.id} → ${doc.sector}:`, err);
      errors++;
    }
  }

  console.log(`─── Summary ───────────────────────────────────`);
  for (const [sector, count] of [...bySector.entries()].sort()) {
    console.log(`  ${sector.padEnd(20)} ${count} documents`);
  }
  console.log(`  ${"".padEnd(20)} ─────`);
  console.log(`  Edges ${DRY_RUN ? "(dry)" : "created/updated"}: ${linked}`);
  if (errors > 0) console.log(`  Errors: ${errors}`);
  if (DRY_RUN) console.log(`\n  Re-run without --dry-run to apply changes.`);
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
