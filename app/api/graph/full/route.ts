import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { checkNeo4jHealth, runQuery } from "@/lib/neo4j";
import { listAllSectors } from "@/lib/sectors/sector-repo";

type RawNode = {
  nid: string;
  type: string;
  name: string | null;
  title: string | null;
  sector: string | null;
  slug: string | null;
  displayName: string | null;
  status: string | null;
};
type RawEdge = { source: string; target: string; relType: string };
type RawDocEdge = { source: string; target: string; shared: number };
type RawEntityEdge = { source: string; target: string; shared: number };

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const healthy = await checkNeo4jHealth();
  if (!healthy) {
    return NextResponse.json({ connected: false });
  }

  const [rawNodes, rawEdges, rawDocEdges, rawEntityEdges, allSectors] = await Promise.all([
    runQuery<RawNode>(
      `MATCH (n)
       RETURN elementId(n) AS nid, labels(n)[0] AS type,
              n.name AS name, n.title AS title, n.sector AS sector,
              n.slug AS slug, n.displayName AS displayName, n.status AS status`,
    ),
    runQuery<RawEdge>(
      `MATCH (a)-[r]->(b)
       RETURN elementId(a) AS source, elementId(b) AS target, type(r) AS relType`,
    ),
    runQuery<RawDocEdge>(
      `MATCH (d1:Document)-[:HAS_CONCEPT|DESCRIBES|REFERENCES_SYSTEM|COMPLIES_WITH|INVOLVES_PERSON]->(e)
             <-[:HAS_CONCEPT|DESCRIBES|REFERENCES_SYSTEM|COMPLIES_WITH|INVOLVES_PERSON]-(d2:Document)
       WHERE elementId(d1) < elementId(d2)
       WITH d1, d2, count(e) AS shared
       WHERE shared >= 1
       RETURN elementId(d1) AS source, elementId(d2) AS target, toInteger(shared) AS shared`,
    ),
    runQuery<RawEntityEdge>(
      `MATCH (d:Document)-[:HAS_CONCEPT|DESCRIBES|REFERENCES_SYSTEM|COMPLIES_WITH|INVOLVES_PERSON]->(e1)
       MATCH (d)-[:HAS_CONCEPT|DESCRIBES|REFERENCES_SYSTEM|COMPLIES_WITH|INVOLVES_PERSON]->(e2)
       WHERE elementId(e1) < elementId(e2)
         AND labels(e1)[0] <> labels(e2)[0]
       WITH e1, e2, count(DISTINCT d) AS shared
       WHERE shared >= 1
       RETURN elementId(e1) AS source, elementId(e2) AS target, toInteger(shared) AS shared`,
    ),
    listAllSectors(),
  ]);

  const degreeMap = new Map<string, number>();
  for (const e of [...rawEdges, ...rawDocEdges, ...rawEntityEdges]) {
    degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
    degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
  }

  const nodes = rawNodes.map((n) => {
    const rawLabel =
      n.type === "Sector"
        ? (n.displayName ?? n.slug ?? n.type)
        : (n.name ?? n.title ?? n.type);
    return {
      id: n.nid,
      label: (rawLabel ?? n.type).trim(),
      type: n.type,
      degree: degreeMap.get(n.nid) ?? 0,
      sector: n.sector ?? n.slug ?? undefined,
      status: n.status ?? undefined,
    };
  });

  const edges = [
    ...rawEdges.map((e) => ({
      source: e.source,
      target: e.target,
      type: e.relType,
      weight: 1,
    })),
    ...rawDocEdges.map((e) => ({
      source: e.source,
      target: e.target,
      type: "SHARES_ENTITY",
      weight: Number(e.shared),
    })),
    ...rawEntityEdges.map((e) => ({
      source: e.source,
      target: e.target,
      type: "CO_MENTIONED",
      weight: Number(e.shared),
    })),
  ];

  return NextResponse.json({
    connected: true,
    nodes,
    edges,
    sectors: allSectors.map((s) => ({ slug: s.slug, displayName: s.displayName })),
  });
}
