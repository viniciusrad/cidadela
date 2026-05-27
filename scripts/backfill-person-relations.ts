/**
 * Backfill typed person relations in Neo4j for all documents and processes
 * already indexed. Runs purely on graph data — no Qdrant re-embedding.
 *
 * What this script does:
 *   1. For each Document node: derives PERFORMS/USES (via Document→Procedure/System paths)
 *      and KNOWS_ABOUT (via Document→Concept paths) from existing INVOLVES_PERSON data.
 *   2. Globally: derives BELONGS_TO (Person→Sector) by aggregating Document.sector.
 *   3. For each Process node: derives PARTICIPATES_IN (Person→Process) via the
 *      Person→PERFORMS→Procedure←COMPRISES←Process path.
 *
 * Usage:
 *   npx tsx scripts/backfill-person-relations.ts
 *   npx tsx scripts/backfill-person-relations.ts --dry-run
 *   npx tsx scripts/backfill-person-relations.ts --sector desenvolvimento
 *   npx tsx scripts/backfill-person-relations.ts --step performs   (only step 1)
 *   npx tsx scripts/backfill-person-relations.ts --step sectors     (only step 2)
 *   npx tsx scripts/backfill-person-relations.ts --step processes   (only step 3)
 */

import { runQuery } from "@/lib/neo4j";
import {
  derivePersonKnowsAbout,
  deriveTypedPersonEdges,
} from "@/lib/graph/persistence";
import { upsertPersonProcessLinks, upsertPersonSectorLinks } from "@/lib/graph/process-sync";

// ─── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const sectorArg = (() => {
  const idx = args.indexOf("--sector");
  return idx !== -1 ? args[idx + 1] : null;
})();
const stepArg = (() => {
  const idx = args.indexOf("--step");
  return idx !== -1 ? args[idx + 1] : null;
})();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function listDocumentIds(sector: string | null): Promise<Array<{ id: string; title: string; sector: string }>> {
  const cypher = sector
    ? `MATCH (d:Document) WHERE d.sector = $sector RETURN d.id AS id, d.title AS title, d.sector AS sector ORDER BY d.extractedAt`
    : `MATCH (d:Document) RETURN d.id AS id, d.title AS title, d.sector AS sector ORDER BY d.extractedAt`;
  return runQuery<{ id: string; title: string; sector: string }>(cypher, sector ? { sector } : {});
}

async function listProcessIds(): Promise<Array<{ id: string; name: string; sector: string }>> {
  return runQuery<{ id: string; name: string; sector: string }>(
    `MATCH (p:Process) RETURN p.id AS id, p.name AS name, p.sectorSlug AS sector ORDER BY p.name`,
  );
}

// ─── Steps ────────────────────────────────────────────────────────────────────

async function runStepPerforms() {
  console.log("\n── Step 1: PERFORMS / USES / KNOWS_ABOUT (per document) ─────────────────");
  const docs = await listDocumentIds(sectorArg);
  console.log(`  ${docs.length} document(s) found.\n`);

  let totalPerforms = 0;
  let totalKnows = 0;
  let errors = 0;

  for (const doc of docs) {
    const label = `[${doc.sector}] ${doc.title?.slice(0, 60)} (${doc.id.slice(0, 10)}…)`;
    if (DRY_RUN) {
      console.log(`  DRY   ${label}`);
      continue;
    }
    try {
      const [performs, knows] = await Promise.all([
        deriveTypedPersonEdges(doc.id),
        derivePersonKnowsAbout(doc.id),
      ]);
      if (performs > 0 || knows > 0) {
        console.log(`  WRITE ${label} → PERFORMS/USES: ${performs}, KNOWS_ABOUT: ${knows}`);
      }
      totalPerforms += performs;
      totalKnows += knows;
    } catch (err) {
      console.error(`  ERROR ${label}:`, err instanceof Error ? err.message : String(err));
      errors++;
    }
  }

  console.log(`\n  PERFORMS/USES edges written : ${totalPerforms}`);
  console.log(`  KNOWS_ABOUT edges written   : ${totalKnows}`);
  console.log(`  Errors                      : ${errors}`);
}

async function runStepSectors() {
  console.log("\n── Step 2: BELONGS_TO (Person → Sector) ─────────────────────────────────");
  if (DRY_RUN) {
    const persons = await runQuery<{ name: string }>(
      `MATCH (p:Person) RETURN p.name AS name ORDER BY p.name`,
    );
    console.log(`  DRY — would process ${persons.length} person(s).`);
    return;
  }
  const count = await upsertPersonSectorLinks(sectorArg);
  console.log(`  BELONGS_TO edges refreshed : ${count}`);
}

async function runStepProcesses() {
  console.log("\n── Step 3: PARTICIPATES_IN (Person → Process) ────────────────────────────");
  const processes = await listProcessIds();
  const filtered = sectorArg
    ? processes.filter((p) => p.sector === sectorArg)
    : processes;
  console.log(`  ${filtered.length} process(es) found.\n`);

  let totalLinks = 0;
  let errors = 0;

  for (const proc of filtered) {
    const label = `[${proc.sector}] ${proc.name} (${proc.id.slice(0, 10)}…)`;
    if (DRY_RUN) {
      console.log(`  DRY   ${label}`);
      continue;
    }
    try {
      const count = await upsertPersonProcessLinks(proc.id);
      if (count > 0) console.log(`  WRITE ${label} → ${count} PARTICIPATES_IN`);
      totalLinks += count;
    } catch (err) {
      console.error(`  ERROR ${label}:`, err instanceof Error ? err.message : String(err));
      errors++;
    }
  }

  console.log(`\n  PARTICIPATES_IN edges written : ${totalLinks}`);
  console.log(`  Errors                        : ${errors}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nBackfill Person Relations${DRY_RUN ? " [DRY RUN]" : ""}${sectorArg ? ` — sector: ${sectorArg}` : ""}${stepArg ? ` — step: ${stepArg}` : ""}`);
  console.log("No Qdrant re-embedding. Graph-only backfill.\n");

  if (!stepArg || stepArg === "performs") await runStepPerforms();
  if (!stepArg || stepArg === "sectors") await runStepSectors();
  if (!stepArg || stepArg === "processes") await runStepProcesses();

  console.log("\n─── Done ───────────────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
