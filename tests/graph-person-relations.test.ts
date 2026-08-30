import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runQuery: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@/lib/neo4j", () => ({
  runQuery: mocks.runQuery,
}));

import {
  derivePersonKnowsAbout,
  deriveTypedPersonEdges,
} from "@/lib/graph/persistence";
import {
  fetchProcessBusFactor,
  upsertPersonProcessLinks,
  upsertPersonSectorLinks,
} from "@/lib/graph/process-sync";
import { upsertPersonProfile } from "@/lib/graph/person-registry";

describe("deriveTypedPersonEdges", () => {
  beforeEach(() => mocks.runQuery.mockReset());

  it("runs two queries (PERFORMS + USES) and returns their sum", async () => {
    mocks.runQuery
      .mockResolvedValueOnce([{ count: 3 }]) // PERFORMS
      .mockResolvedValueOnce([{ count: 2 }]); // USES

    const result = await deriveTypedPersonEdges("doc-1");
    expect(result).toBe(5);
    expect(mocks.runQuery).toHaveBeenCalledTimes(2);

    const calls = mocks.runQuery.mock.calls as unknown as Array<[string, ...unknown[]]>;
    expect(calls[0][0]).toContain("PERFORMS");
    expect(calls[0][0]).toContain("executor");
    expect(calls[1][0]).toContain("USES");
  });

  it("returns 0 when no edges are created", async () => {
    mocks.runQuery.mockResolvedValue([{ count: 0 }]);
    const result = await deriveTypedPersonEdges("doc-empty");
    expect(result).toBe(0);
  });
});

describe("derivePersonKnowsAbout", () => {
  beforeEach(() => mocks.runQuery.mockReset());

  it("creates KNOWS_ABOUT edges from Person+Concept via Document", async () => {
    mocks.runQuery.mockResolvedValueOnce([{ count: 4 }]);

    const result = await derivePersonKnowsAbout("doc-1");
    expect(result).toBe(4);
    const calls = mocks.runQuery.mock.calls as unknown as Array<[string, ...unknown[]]>;
    expect(calls[0][0]).toContain("KNOWS_ABOUT");
    expect(calls[0][0]).toContain("Concept");
    expect(calls[0][0]).toContain("strength");
  });
});

describe("upsertPersonSectorLinks", () => {
  beforeEach(() => mocks.runQuery.mockReset());

  it("runs a BELONGS_TO query and returns count", async () => {
    mocks.runQuery.mockResolvedValueOnce([{ count: 7 }]);

    const result = await upsertPersonSectorLinks();
    expect(result).toBe(7);
    const calls = mocks.runQuery.mock.calls as unknown as Array<[string, ...unknown[]]>;
    expect(calls[0][0]).toContain("BELONGS_TO");
    expect(calls[0][0]).toContain("primarySector");
  });

  it("returns 0 and swallows errors", async () => {
    mocks.runQuery.mockRejectedValueOnce(new Error("neo4j down"));
    const result = await upsertPersonSectorLinks("seguranca");
    expect(result).toBe(0);
  });
});

describe("upsertPersonProcessLinks", () => {
  beforeEach(() => mocks.runQuery.mockReset());

  it("creates PARTICIPATES_IN via Person→PERFORMS→Procedure←COMPRISES←Process path", async () => {
    mocks.runQuery.mockResolvedValueOnce([{ count: 2 }]);

    const result = await upsertPersonProcessLinks("proc-123");
    expect(result).toBe(2);
    const calls = mocks.runQuery.mock.calls as unknown as Array<[string, ...unknown[]]>;
    expect(calls[0][0]).toContain("PARTICIPATES_IN");
    expect(calls[0][0]).toContain("COMPRISES");
    expect(calls[0][0]).toContain("PERFORMS");
  });

  it("returns 0 and swallows errors", async () => {
    mocks.runQuery.mockRejectedValueOnce(new Error("neo4j down"));
    const result = await upsertPersonProcessLinks("proc-err");
    expect(result).toBe(0);
  });
});

describe("fetchProcessBusFactor", () => {
  beforeEach(() => mocks.runQuery.mockReset());

  it("returns busFactor=1 and riskProcedures when a procedure has a single executor", async () => {
    mocks.runQuery.mockResolvedValueOnce([
      { procedureName: "fechamento de caixa", executorCount: 1 },
      { procedureName: "abertura de caixa", executorCount: 3 },
    ]);

    const result = await fetchProcessBusFactor("proc-id");
    expect(result.busFactor).toBe(1);
    expect(result.riskProcedures).toContain("fechamento de caixa");
    expect(result.riskProcedures).not.toContain("abertura de caixa");
  });

  it("returns busFactor=0 when no procedures exist", async () => {
    mocks.runQuery.mockResolvedValueOnce([]);
    const result = await fetchProcessBusFactor("proc-empty");
    expect(result.busFactor).toBe(0);
    expect(result.riskProcedures).toHaveLength(0);
  });

  it("returns busFactor=0 on error", async () => {
    mocks.runQuery.mockRejectedValueOnce(new Error("neo4j down"));
    const result = await fetchProcessBusFactor("proc-err");
    expect(result.busFactor).toBe(0);
  });
});

describe("upsertPersonProfile", () => {
  beforeEach(() => mocks.runQuery.mockReset());

  it("upserts Person node with email and manualSector", async () => {
    mocks.runQuery.mockResolvedValue([]);

    await upsertPersonProfile({
      name: "João Silva",
      email: "joao@cidadela.com.br",
      manualSector: "seguranca",
    });

    expect(mocks.runQuery).toHaveBeenCalledTimes(2); // node upsert + BELONGS_TO
    const calls = mocks.runQuery.mock.calls as unknown as Array<[string, ...unknown[]]>;
    expect(calls[0][0]).toContain("MERGE");
    expect(calls[0][0]).toContain("email");
    expect(calls[1][0]).toContain("BELONGS_TO");
    expect(calls[1][0]).toContain("human_validated");
  });

  it("only updates the node (no BELONGS_TO query) when no manualSector given", async () => {
    mocks.runQuery.mockResolvedValue([]);

    await upsertPersonProfile({ name: "Maria Santos", email: "maria@cidadela.com.br" });

    expect(mocks.runQuery).toHaveBeenCalledTimes(1);
  });
});
