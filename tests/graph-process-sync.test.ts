import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runQuery: vi.fn(async () => []),
}));

vi.mock("@/lib/neo4j", () => ({
  runQuery: mocks.runQuery,
}));

import {
  syncProcessGraphNode,
  upsertProcessNode,
  linkProcessEvidence,
  linkProcessProcedures,
  linkProcessSystems,
  linkProcessConcepts,
} from "@/lib/graph/process-sync";

describe("process-sync helpers", () => {
  beforeEach(() => {
    mocks.runQuery.mockClear();
    mocks.runQuery.mockResolvedValue([]);
  });

  it("upsertProcessNode merges Process and Sector OWNS Process edge", async () => {
    await upsertProcessNode({
      id: "proc-1",
      name: "Reset de senha",
      sector: "suporte",
      fingerprint: "abc",
      status: "mapped",
      automationReadinessScore: 55,
      graphBacked: true,
    });
    const [cypher, params] = mocks.runQuery.mock.calls[0];
    expect(cypher).toContain("MERGE (p:Process {id: $id})");
    expect(cypher).toContain("MERGE (s:Sector {slug: $sectorSlug})");
    expect(cypher).toContain("MERGE (s)-[r:OWNS]->(p)");
    expect(params).toMatchObject({
      id: "proc-1",
      name: "Reset de senha",
      sectorSlug: "suporte",
      graphBacked: true,
    });
  });

  it("linkProcessEvidence removes stale edges and links current documents", async () => {
    mocks.runQuery.mockResolvedValueOnce([{ linked: 2, removed: 1 }]);
    const result = await linkProcessEvidence("proc-1", ["doc-a", "doc-b"]);
    const [cypher, params] = mocks.runQuery.mock.calls[0];
    expect(cypher).toContain("MERGE (p)-[link:DESCRIBED_BY]->(d)");
    expect(cypher).toContain("WHERE NOT old.id IN $documentIds");
    expect(params).toEqual({ processId: "proc-1", documentIds: ["doc-a", "doc-b"] });
    expect(result).toEqual({ linked: 2, removed: 1 });
  });

  it("linkProcessProcedures lowercases names and uses MATCH only", async () => {
    await linkProcessProcedures("proc-1", ["Reset DE Senha", "Bloqueio De Conta"]);
    const [cypher, params] = mocks.runQuery.mock.calls[0];
    expect(cypher).toContain("MATCH (proc:Procedure {name: name})");
    expect(cypher).toContain("MERGE (p)-[r:COMPRISES]->(proc)");
    expect(params).toEqual({
      processId: "proc-1",
      names: ["reset de senha", "bloqueio de conta"],
    });
  });

  it("linkProcessSystems MERGEs System nodes when absent", async () => {
    await linkProcessSystems("proc-1", ["SAP", "ServiceNow"]);
    const [cypher] = mocks.runQuery.mock.calls[0];
    expect(cypher).toContain("MERGE (s:System {name: name})");
    expect(cypher).toContain("MERGE (p)-[r:SUPPORTED_BY]->(s)");
  });

  it("linkProcessConcepts lowercases concept names", async () => {
    await linkProcessConcepts("proc-1", ["Pedido Eletrônico"]);
    const [, params] = mocks.runQuery.mock.calls[0];
    expect(params).toEqual({ processId: "proc-1", names: ["pedido eletrônico"] });
  });

  it("syncProcessGraphNode runs upsert + linkers, skips empty arrays", async () => {
    await syncProcessGraphNode({
      id: "proc-1",
      name: "Reset de senha",
      sector: "suporte",
      graphBacked: true,
      documentIds: ["doc-a"],
      procedureNames: ["Reset de senha"],
      systemNames: ["ServiceNow"],
      conceptNames: [],
      regulationNames: [],
    });

    const cyphers = mocks.runQuery.mock.calls.map((call) => call[0] as string);
    expect(cyphers.some((c) => c.includes("MERGE (p:Process"))).toBe(true);
    expect(cyphers.some((c) => c.includes("MERGE (p)-[link:DESCRIBED_BY]"))).toBe(true);
    expect(cyphers.some((c) => c.includes("MERGE (p)-[r:COMPRISES]"))).toBe(true);
    expect(cyphers.some((c) => c.includes("MERGE (p)-[r:SUPPORTED_BY]"))).toBe(true);
    expect(cyphers.some((c) => c.includes("REQUIRES_CONCEPT"))).toBe(false);
    expect(cyphers.some((c) => c.includes("GOVERNED_BY"))).toBe(false);
  });

  it("syncProcessGraphNode swallows Neo4j errors without throwing", async () => {
    mocks.runQuery.mockRejectedValueOnce(new Error("neo4j down"));
    await expect(
      syncProcessGraphNode({
        id: "proc-1",
        name: "Reset",
        sector: "suporte",
        documentIds: [],
      }),
    ).resolves.toBeUndefined();
  });
});
