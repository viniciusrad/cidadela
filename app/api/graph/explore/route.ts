import { type NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { checkNeo4jHealth, runQuery } from "@/lib/neo4j";

type EntityRow = { type: string; name: string };
type RelatedRow = {
  title: string;
  id: string;
  sector: string;
  sharedConcepts: string[];
  overlap: number;
};

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const documentId = request.nextUrl.searchParams.get("documentId");
  if (!documentId) {
    return NextResponse.json(
      { error: "documentId required" },
      { status: 400 },
    );
  }

  const healthy = await checkNeo4jHealth();
  if (!healthy) {
    return NextResponse.json({ error: "Neo4j indisponível" }, { status: 503 });
  }

  const [entities, related] = await Promise.all([
    runQuery<EntityRow>(
      `MATCH (d:Document {id: $docId})-[r:HAS_CONCEPT|DESCRIBES|REFERENCES_SYSTEM|COMPLIES_WITH]->(e)
       RETURN type(r) AS type, e.name AS name
       ORDER BY type, name`,
      { docId: documentId },
    ),
    runQuery<RelatedRow>(
      `MATCH (d:Document {id: $docId})-[:HAS_CONCEPT]->(c:Concept)<-[:HAS_CONCEPT]-(rel:Document)
       WHERE rel.id <> $docId
       RETURN rel.title AS title, rel.id AS id, rel.sector AS sector,
              collect(c.name) AS sharedConcepts, count(c) AS overlap
       ORDER BY overlap DESC LIMIT 10`,
      { docId: documentId },
    ),
  ]);

  return NextResponse.json({ entities, related });
}
