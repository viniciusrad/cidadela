import { type NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { checkNeo4jHealth, runQuery } from "@/lib/neo4j";

type ProcessRow = {
  id: string;
  name: string;
  sectorSlug: string | null;
  fingerprint: string | null;
  status: string | null;
  automationReadinessScore: number | null;
  documentationCoverageScore: number | null;
  confidenceScore: number | null;
  recommendedAutomationLevel: string | null;
  graphBacked: boolean | null;
};

type RelatedDocRow = { id: string; title: string | null; sector: string | null; status: string | null };
type NamedRow = { name: string };

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const healthy = await checkNeo4jHealth();
  if (!healthy) {
    return NextResponse.json({ error: "Neo4j indisponível" }, { status: 503 });
  }

  const [processRows, documents, procedures, systems, concepts, regulations] =
    await Promise.all([
      runQuery<ProcessRow>(
        `MATCH (p:Process {id: $id})
         RETURN p.id AS id, p.name AS name, p.sectorSlug AS sectorSlug,
                p.fingerprint AS fingerprint, p.status AS status,
                p.automationReadinessScore AS automationReadinessScore,
                p.documentationCoverageScore AS documentationCoverageScore,
                p.confidenceScore AS confidenceScore,
                p.recommendedAutomationLevel AS recommendedAutomationLevel,
                p.graphBacked AS graphBacked
         LIMIT 1`,
        { id },
      ),
      runQuery<RelatedDocRow>(
        `MATCH (p:Process {id: $id})-[:DESCRIBED_BY]->(d:Document)
         RETURN d.id AS id, d.title AS title, d.sector AS sector, d.status AS status
         ORDER BY d.title ASC`,
        { id },
      ),
      runQuery<NamedRow>(
        `MATCH (p:Process {id: $id})-[:COMPRISES]->(proc:Procedure)
         RETURN proc.name AS name ORDER BY proc.name ASC`,
        { id },
      ),
      runQuery<NamedRow>(
        `MATCH (p:Process {id: $id})-[:SUPPORTED_BY]->(s:System)
         RETURN s.name AS name ORDER BY s.name ASC`,
        { id },
      ),
      runQuery<NamedRow>(
        `MATCH (p:Process {id: $id})-[:REQUIRES_CONCEPT]->(c:Concept)
         RETURN c.name AS name ORDER BY c.name ASC`,
        { id },
      ),
      runQuery<NamedRow>(
        `MATCH (p:Process {id: $id})-[:GOVERNED_BY]->(reg:Regulation)
         RETURN reg.name AS name ORDER BY reg.name ASC`,
        { id },
      ),
    ]);

  const process = processRows[0];
  if (!process) {
    return NextResponse.json({ error: "Processo não encontrado no grafo" }, { status: 404 });
  }

  return NextResponse.json({
    process: {
      id: process.id,
      name: process.name,
      sector: process.sectorSlug,
      fingerprint: process.fingerprint,
      status: process.status,
      automationReadinessScore: Number(process.automationReadinessScore ?? 0),
      documentationCoverageScore: Number(process.documentationCoverageScore ?? 0),
      confidenceScore: Number(process.confidenceScore ?? 0),
      recommendedAutomationLevel: process.recommendedAutomationLevel,
      graphBacked: Boolean(process.graphBacked),
    },
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title,
      sector: d.sector,
      status: d.status,
    })),
    procedures: procedures.map((p) => p.name),
    systems: systems.map((s) => s.name),
    concepts: concepts.map((c) => c.name),
    regulations: regulations.map((r) => r.name),
  });
}
