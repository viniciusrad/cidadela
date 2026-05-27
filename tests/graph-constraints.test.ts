import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runQuery: vi.fn(),
}));

vi.mock("@/lib/neo4j", () => ({
  runQuery: mocks.runQuery,
}));

describe("ensureGraphConstraints", () => {
  beforeEach(() => {
    mocks.runQuery.mockReset();
  });

  it("applies all constraints when Neo4j accepts every statement", async () => {
    mocks.runQuery.mockResolvedValue([]);
    const { ensureGraphConstraints } = await import("@/lib/graph/persistence");

    const result = await ensureGraphConstraints();

    expect(result.applied).toBe(9);
    expect(result.failed).toEqual([]);
    expect(mocks.runQuery).toHaveBeenCalledTimes(9);

    const statements = mocks.runQuery.mock.calls.map((call) => call[0] as string);
    for (const label of [
      "Document",
      "RagChunk",
      "Concept",
      "Procedure",
      "System",
      "Regulation",
      "Person",
      "Sector",
      "Process",
    ]) {
      expect(statements.some((s) => s.includes(`:${label})`))).toBe(true);
    }
    expect(statements.some((s) => s.includes(":Sector)") && s.includes("slug"))).toBe(true);
    expect(statements.some((s) => s.includes(":Process)") && s.includes("id"))).toBe(true);
    for (const statement of statements) {
      expect(statement).toContain("IF NOT EXISTS");
      expect(statement).toContain("IS UNIQUE");
    }
  });

  it("accumulates failures and continues with the remaining statements", async () => {
    mocks.runQuery
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("duplicate values"))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { ensureGraphConstraints } = await import("@/lib/graph/persistence");

    const result = await ensureGraphConstraints();

    expect(result.applied).toBe(8);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("duplicate values");
    expect(mocks.runQuery).toHaveBeenCalledTimes(9);
  });
});
