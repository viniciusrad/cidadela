/**
 * Backfill (:Process) nodes in Neo4j from existing ProcessMap rows in Postgres.
 *
 * Does NOT touch Qdrant. Does NOT re-extract entities. No reingestion.
 *
 * For each ProcessMap row, this projects:
 *   - (:Process {id, name, sectorSlug, fingerprint, status, ...})
 *   - (:Sector)-[:OWNS]->(:Process)
 *   - (:Process)-[:DESCRIBED_BY]->(:Document) for every documentRef whose
 *     Document node already exists in the graph
 *   - (:Process)-[:COMPRISES]->(:Procedure) when graphBacked = true (matches the
 *     procedure of same name as the process)
 *   - (:Process)-[:SUPPORTED_BY]->(:System) for each systemName
 *   - (:Process)-[:REQUIRES_CONCEPT]->(:Concept) and -[:GOVERNED_BY]->(:Regulation)
 *     from graphEvidence
 *
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/backfill-process-nodes.ts
 *   npx tsx scripts/backfill-process-nodes.ts --dry-run
 *   npx tsx scripts/backfill-process-nodes.ts --sector desenvolvimento
 */

import { prisma } from "@/lib/db/client";
import { syncProcessGraphNode } from "@/lib/graph/process-sync";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const sectorArg = (() => {
  const idx = args.indexOf("--sector");
  return idx !== -1 ? args[idx + 1] : null;
})();

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function asDocumentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (item && typeof item === "object" && "documentId" in item) {
      const id = (item as { documentId: unknown }).documentId;
      if (typeof id === "string" && id.length > 0) ids.push(id);
    }
  }
  return ids;
}

async function main() {
  console.log(
    `\nBackfill Process nodes${DRY_RUN ? " [DRY RUN]" : ""}${sectorArg ? ` — sector: ${sectorArg}` : ""}\n`,
  );

  const processMaps = await prisma.processMap.findMany({
    where: {
      ...(sectorArg
        ? { sector: sectorArg as "desenvolvimento" | "seguranca" | "suporte" | "desktop" }
        : {}),
      status: { not: "archived" },
    },
    orderBy: [{ sector: "asc" }, { name: "asc" }],
  });

  console.log(`  Found ${processMaps.length} ProcessMap row(s)\n`);

  let synced = 0;
  let errors = 0;
  const bySector = new Map<string, number>();

  for (const map of processMaps) {
    const graphEvidence = (map.graphEvidence ?? {}) as Record<string, unknown>;
    const documentIds = asDocumentIds(map.documentRefs);
    const systemNames = asStringArray(map.systemNames);
    const conceptNames = asStringArray(graphEvidence.concepts);
    const regulationNames = asStringArray(graphEvidence.regulations);
    const graphBacked = Boolean(graphEvidence.graphBacked);

    bySector.set(map.sector, (bySector.get(map.sector) ?? 0) + 1);

    const label = `[${map.sector}] ${map.name} (${map.id.slice(0, 8)}...)`;
    if (DRY_RUN) {
      console.log(
        `  DRY   ${label} — docs: ${documentIds.length}, systems: ${systemNames.length}, ` +
          `concepts: ${conceptNames.length}, regs: ${regulationNames.length}, graphBacked: ${graphBacked}`,
      );
      synced++;
      continue;
    }

    try {
      await syncProcessGraphNode({
        id: map.id,
        name: map.name,
        sector: map.sector,
        fingerprint: map.fingerprint,
        status: map.status,
        automationReadinessScore: map.automationReadinessScore,
        documentationCoverageScore: map.documentationCoverageScore,
        confidenceScore: map.confidenceScore,
        recommendedAutomationLevel: map.recommendedAutomationLevel,
        graphBacked,
        documentIds,
        procedureNames: graphBacked ? [map.name] : [],
        systemNames,
        conceptNames,
        regulationNames,
      });
      console.log(`  WRITE ${label} — docs:${documentIds.length} sys:${systemNames.length}`);
      synced++;
    } catch (err) {
      console.error(`  ERROR ${label}:`, err);
      errors++;
    }
  }

  console.log(`\n─── Summary ───────────────────────────────────`);
  for (const [sector, count] of [...bySector.entries()].sort()) {
    console.log(`  ${sector.padEnd(20)} ${count} processes`);
  }
  console.log(`  ${"".padEnd(20)} ─────`);
  console.log(`  Process nodes ${DRY_RUN ? "(dry)" : "synced"}: ${synced}`);
  if (errors > 0) console.log(`  Errors: ${errors}`);
  if (DRY_RUN) console.log(`\n  Re-run without --dry-run to apply changes.`);
  console.log();

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
