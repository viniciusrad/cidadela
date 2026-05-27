import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { checkNeo4jHealth, runQuery } from "@/lib/neo4j";

type Row = {
  id: string;
  name: string;
  docCount: number;
  sectors: string[];
  documents: { id: string; title: string; sector: string }[];
  related: string[];
};

type KnowledgeDomain = "document" | "concept" | "procedure" | "system" | "process";

const DOMAIN_CONFIG: Record<
  KnowledgeDomain,
  {
    label: string;
    nodeLabel: "Concept" | "Procedure" | "System";
    relType: "HAS_CONCEPT" | "DESCRIBES" | "REFERENCES_SYSTEM";
    minConnections: number;
  }
> = {
  concept: {
    label: "Conceitos",
    nodeLabel: "Concept",
    relType: "HAS_CONCEPT",
    minConnections: 3,
  },
  procedure: {
    label: "Procedimentos",
    nodeLabel: "Procedure",
    relType: "DESCRIBES",
    minConnections: 1,
  },
  system: {
    label: "Sistemas",
    nodeLabel: "System",
    relType: "REFERENCES_SYSTEM",
    minConnections: 1,
  },
  document: {
    label: "Documentos",
    nodeLabel: "Concept",
    relType: "HAS_CONCEPT",
    minConnections: 1,
  },
  process: {
    label: "Processos",
    nodeLabel: "Concept", // unused for the process branch — has its own Cypher
    relType: "HAS_CONCEPT",
    minConnections: 0,
  },
};

function normalizeDomain(value: string | null): KnowledgeDomain {
  if (
    value === "document" ||
    value === "concept" ||
    value === "procedure" ||
    value === "system" ||
    value === "process"
  ) {
    return value;
  }
  return "concept";
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const domain = normalizeDomain(new URL(request.url).searchParams.get("domain"));

  const healthy = await checkNeo4jHealth();
  if (!healthy) {
    return NextResponse.json({ connected: false, concepts: [], items: [] });
  }

  const config = DOMAIN_CONFIG[domain];
  const rows =
    domain === "process"
      ? await runQuery<Row>(
          `MATCH (p:Process)
           WHERE coalesce(p.status, '') <> 'archived'
           OPTIONAL MATCH (s:Sector)-[:OWNS]->(p)
           OPTIONAL MATCH (p)-[:DESCRIBED_BY]->(d:Document)
           WITH p, s,
                collect(DISTINCT CASE WHEN d IS NULL THEN NULL ELSE
                  {id: d.id, title: coalesce(d.title, d.id), sector: coalesce(d.sector, p.sectorSlug, 'desconhecido')}
                END) AS rawDocs
           WITH p, s, [doc IN rawDocs WHERE doc IS NOT NULL] AS documents
           OPTIONAL MATCH (p)-[:COMPRISES]->(proc:Procedure)
           OPTIONAL MATCH (p)-[:SUPPORTED_BY]->(sys:System)
           WITH p, s, documents,
                (collect(DISTINCT proc.name) + collect(DISTINCT sys.name))[0..6] AS related
           RETURN p.id AS id,
                  p.name AS name,
                  size(documents) AS docCount,
                  [coalesce(p.sectorSlug, s.slug, 'desconhecido')] AS sectors,
                  documents,
                  [r IN related WHERE r IS NOT NULL] AS related
           ORDER BY p.automationReadinessScore DESC, p.name ASC
           LIMIT 100`,
        )
      : domain === "document"
      ? await runQuery<Row>(
          `MATCH (d:Document)
           WITH d,
                [(d)-[:HAS_CONCEPT|DESCRIBES|REFERENCES_SYSTEM|COMPLIES_WITH]->(e) | e.name][0..6] AS related
           OPTIONAL MATCH (d)-[:HAS_CONCEPT|DESCRIBES|REFERENCES_SYSTEM|COMPLIES_WITH]->(shared)
                  <-[:HAS_CONCEPT|DESCRIBES|REFERENCES_SYSTEM|COMPLIES_WITH]-(other:Document)
           WHERE other.id <> d.id
           WITH d, related, collect(DISTINCT other)[0..8] AS relatedDocs
           WITH d, related,
                [doc IN relatedDocs WHERE doc IS NOT NULL |
                  {id: doc.id, title: coalesce(doc.title, doc.id), sector: coalesce(doc.sector, 'desconhecido')}
                ] AS relatedDocRefs
           WITH d, related,
                ([{id: d.id, title: coalesce(d.title, d.id), sector: coalesce(d.sector, 'desconhecido')}]
                 + relatedDocRefs) AS documents
           RETURN d.id AS id,
                  coalesce(d.title, d.id) AS name,
                  size(documents) AS docCount,
                  [doc IN documents | doc.sector] AS sectors,
                  documents,
                  related
           ORDER BY name ASC
           LIMIT 100`,
        )
      : await runQuery<Row>(
          `MATCH (item:${config.nodeLabel})<-[:${config.relType}]-(d:Document)
           WITH item, collect(DISTINCT {id: d.id, title: coalesce(d.title, d.id), sector: coalesce(d.sector, 'desconhecido')}) AS documents
           WHERE size(documents) >= $minConnections
           OPTIONAL MATCH (item)<-[:${config.relType}]-(:Document)-[:${config.relType}]->(other:${config.nodeLabel})
           WHERE other.name <> item.name
           WITH item, documents, collect(DISTINCT other.name)[0..6] AS related
           RETURN item.name AS id,
                  item.name AS name,
                  size(documents) AS docCount,
                  [doc IN documents | doc.sector] AS sectors,
                  documents,
                  related
           ORDER BY docCount DESC, item.name ASC
           LIMIT 100`,
          { minConnections: config.minConnections },
        );

  const items = rows.map((r) => ({
    id: r.id,
    domain,
    name: r.name,
    docCount: Number(r.docCount),
    sectors: Array.from(new Set(r.sectors ?? [])),
    documents: r.documents ?? [],
    related: r.related ?? [],
  }));

  return NextResponse.json({
    connected: true,
    domain,
    domainLabel: config.label,
    minConnections: config.minConnections,
    items,
    concepts: domain === "concept" ? items : [],
  });
}
