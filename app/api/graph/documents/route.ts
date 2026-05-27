import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { checkNeo4jHealth, runQuery } from "@/lib/neo4j";
import { listUniqueDocumentsInCollection } from "@/lib/qdrant";
import { listAllSectors } from "@/lib/sectors/sector-repo";

type GraphedDoc = {
  docId: string;
  sourceDocumentId: string | null;
  legacyDocumentId: string | null;
};

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sectors = await listAllSectors();

  // Fetch all documents from all enabled production Qdrant collections in parallel
  const perSector = await Promise.all(
    sectors.map((sector) => listUniqueDocumentsInCollection(sector.slug)),
  );

  const allDocs = perSector.flat();

  // Check which documents are already indexed in Neo4j
  let graphedIds = new Set<string>();
  try {
    const neo4jHealthy = await checkNeo4jHealth();
    if (neo4jHealthy) {
      const rows = await runQuery<GraphedDoc>(
        "MATCH (d:Document) RETURN d.id AS docId, d.sourceDocumentId AS sourceDocumentId, d.legacyDocumentId AS legacyDocumentId",
      );
      graphedIds = new Set(
        rows.flatMap((row) =>
          [row.docId, row.sourceDocumentId, row.legacyDocumentId].filter(
            (value): value is string => typeof value === "string" && value.length > 0,
          ),
        ),
      );
    }
  } catch {
    // Non-blocking: if Neo4j is down, just show no docs as "in graph"
  }

  const docs = allDocs.map((d) => ({
    ...d,
    inGraph: graphedIds.has(d.sourceDocumentId) || graphedIds.has(d.documentId),
  }));

  // Sort: already-in-graph first, then by sector, then by title
  docs.sort((a, b) => {
    if (a.inGraph !== b.inGraph) return a.inGraph ? -1 : 1;
    if (a.sector !== b.sector) return a.sector.localeCompare(b.sector);
    return a.documentTitle.localeCompare(b.documentTitle);
  });

  return NextResponse.json({
    docs,
    sectors: sectors.map((sector) => ({
      slug: sector.slug,
      displayName: sector.displayName,
      agentName: sector.agentName,
      isNative: sector.isNative,
      qdrantCollection: sector.qdrantCollection,
    })),
    total: docs.length,
  });
}
