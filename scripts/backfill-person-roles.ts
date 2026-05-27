/**
 * Backfill Person roles in Neo4j for documents already indexed.
 *
 * This script iterates over Document nodes, fetches their text from Qdrant,
 * runs extractPersonsWithRoles, and updates the INVOLVES_PERSON edge
 * to include the `roles` array property.
 *
 * Usage:
 *   npx tsx scripts/backfill-person-roles.ts
 *   npx tsx scripts/backfill-person-roles.ts --dry-run
 *   npx tsx scripts/backfill-person-roles.ts --sector desenvolvimento
 */

import { extractPersonsWithRoles } from "@/lib/graph/extractor";
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

async function updatePersonRoles(
  documentId: string,
  personName: string,
  roles: string[],
): Promise<number> {
  const result = await runQuery<{ count: number }>(
    `MATCH (d:Document {id: $docId})-[r:INVOLVES_PERSON]->(p:Person {name: $name})
     SET r.roles = $roles
     RETURN count(r) as count`,
    {
      docId: documentId,
      name: personName,
      roles,
    },
  );
  return result[0]?.count ?? 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nBackfill Person Roles${DRY_RUN ? " [DRY RUN]" : ""}${sectorArg ? ` — sector: ${sectorArg}` : ""}\n`);

  const docs = await listDocumentNodes(sectorArg);
  console.log(`Found ${docs.length} Document node(s) in graph.\n`);

  let skipped = 0;
  let processed = 0;
  let totalRolesUpdated = 0;
  let errors = 0;

  for (const doc of docs) {
    const label = `[${doc.sector}] ${doc.title} (${doc.id.slice(0, 12)}...)`;

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

    let personsWithRoles;
    try {
      personsWithRoles = extractPersonsWithRoles(content);
    } catch (err) {
      console.error(`  ERROR ${label} — extractPersonsWithRoles failed:`, err);
      errors++;
      continue;
    }

    const relevantPersons = personsWithRoles.filter((p) => p.roles.length > 0);
    console.log(`  ${DRY_RUN ? "DRY   " : "WRITE "} ${label} — persons with roles: [${relevantPersons.map(p => `${p.name}(${p.roles.join(',')})`).join(", ") || "none"}]`);

    if (!DRY_RUN) {
      for (const person of relevantPersons) {
        try {
          const updated = await updatePersonRoles(doc.id, person.name, person.roles);
          totalRolesUpdated += updated;
        } catch (err) {
          console.error(`  ERROR ${label} — updatePersonRoles failed:`, err);
          errors++;
        }
      }
    } else {
      totalRolesUpdated += relevantPersons.length;
    }

    processed++;
  }

  console.log(`\n─── Summary ───────────────────────────────────`);
  console.log(`  Documents processed : ${processed}`);
  console.log(`  Documents skipped   : ${skipped}`);
  console.log(`  Errors              : ${errors}`);
  console.log(`  Edges updated${DRY_RUN ? " (dry)" : ""}      : ${totalRolesUpdated}`);
  if (DRY_RUN) console.log(`\n  Re-run without --dry-run to apply changes.`);
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
