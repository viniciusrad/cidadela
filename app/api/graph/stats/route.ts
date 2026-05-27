import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { checkNeo4jHealth, runQuery } from "@/lib/neo4j";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const healthy = await checkNeo4jHealth();
  if (!healthy) {
    return NextResponse.json({ connected: false });
  }

  const [counts, topConcepts, topDocuments, relCounts] = await Promise.all([
    runQuery<{ label: string; count: number }>(`
      CALL {
        MATCH (n:Document) RETURN 'Document' AS label, count(n) AS count
        UNION ALL MATCH (n:Concept) RETURN 'Concept' AS label, count(n) AS count
        UNION ALL MATCH (n:Procedure) RETURN 'Procedure' AS label, count(n) AS count
        UNION ALL MATCH (n:System) RETURN 'System' AS label, count(n) AS count
        UNION ALL MATCH (n:Regulation) RETURN 'Regulation' AS label, count(n) AS count
        UNION ALL MATCH (n:Person) RETURN 'Person' AS label, count(n) AS count
      }
      RETURN label, count
    `),
    runQuery<{ name: string; count: number }>(`
      MATCH (c:Concept)<-[:HAS_CONCEPT]-(d:Document)
      RETURN c.name AS name, count(d) AS count
      ORDER BY count DESC LIMIT 10
    `),
    runQuery<{ title: string; id: string; entityCount: number }>(`
      MATCH (d:Document)-[r:HAS_CONCEPT|DESCRIBES|REFERENCES_SYSTEM|COMPLIES_WITH|INVOLVES_PERSON]->()
      RETURN d.title AS title, d.id AS id, count(r) AS entityCount
      ORDER BY entityCount DESC LIMIT 5
    `),
    runQuery<{ count: number }>(`MATCH ()-[r]->() RETURN count(r) AS count`),
  ]);

  return NextResponse.json({
    connected: true,
    nodeCounts: Object.fromEntries(counts.map((c) => [c.label, c.count])),
    totalRelationships: relCounts[0]?.count ?? 0,
    topConcepts,
    topDocuments,
  });
}
