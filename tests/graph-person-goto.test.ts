import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runQuery: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@/lib/neo4j", () => ({
  runQuery: mocks.runQuery,
}));

import {
  upsertPersonGoToRelations,
  upsertPersonCoversFor,
} from "@/lib/graph/persistence";
import {
  listGoToPersonsByDomain,
  getBusFactorRisk,
} from "@/lib/graph/person-registry";

describe("upsertPersonGoToRelations", () => {
  beforeEach(() => mocks.runQuery.mockReset());

  it("creates one Topic+IS_GO_TO_FOR edge per tag per situation", async () => {
    const count = await upsertPersonGoToRelations({
      personName: "Ana Lima",
      situations: [
        { when: "Incidentes no servidor legado", tags: ["infra", "prod"] },
        { when: "Configuracao de SSH", tags: ["acesso"] },
      ],
      confirmedBy: "admin@pfrm.local",
      sector: "desenvolvimento",
    });

    // 2 tags in first situation + 1 tag in second = 3 runQuery calls
    expect(count).toBe(3);
    expect(mocks.runQuery).toHaveBeenCalledTimes(3);

    const calls = mocks.runQuery.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    expect(calls[0][0]).toContain("IS_GO_TO_FOR");
    expect(calls[0][0]).toContain("Topic");
    expect(calls[0][1].label).toBe("infra");
    expect(calls[0][1].name).toBe("Ana Lima");
    expect(calls[2][1].label).toBe("acesso");
  });

  it("falls back to truncated situation text when tags array is empty", async () => {
    const count = await upsertPersonGoToRelations({
      personName: "Carlos Melo",
      situations: [{ when: "Problemas com pagamentos via pix", tags: [] }],
      confirmedBy: "admin@pfrm.local",
      sector: "financeiro",
    });

    expect(count).toBe(1);
    const calls = mocks.runQuery.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    expect(typeof calls[0][1].label).toBe("string");
    expect((calls[0][1].label as string).length).toBeGreaterThan(0);
  });

  it("returns 0 and does not call runQuery for empty situations", async () => {
    const count = await upsertPersonGoToRelations({
      personName: "Maria",
      situations: [],
      confirmedBy: "admin@pfrm.local",
      sector: "suporte",
    });

    expect(count).toBe(0);
    expect(mocks.runQuery).not.toHaveBeenCalled();
  });
});

describe("upsertPersonCoversFor", () => {
  beforeEach(() => mocks.runQuery.mockReset());

  it("creates COVERS_FOR edges with MERGE", async () => {
    const count = await upsertPersonCoversFor({
      personName: "Pedro Souza",
      coversForNames: ["Ana Lima", "Carlos Melo"],
    });

    expect(count).toBe(2);
    expect(mocks.runQuery).toHaveBeenCalledTimes(1);
    const [query, params] = mocks.runQuery.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(query).toContain("COVERS_FOR");
    expect(params.coversFor).toEqual(["Ana Lima", "Carlos Melo"]);
  });

  it("returns 0 and skips runQuery for empty list", async () => {
    const count = await upsertPersonCoversFor({ personName: "X", coversForNames: [] });
    expect(count).toBe(0);
    expect(mocks.runQuery).not.toHaveBeenCalled();
  });
});

describe("listGoToPersonsByDomain", () => {
  beforeEach(() => mocks.runQuery.mockReset());

  it("queries IS_GO_TO_FOR by domain and maps rows", async () => {
    mocks.runQuery.mockResolvedValueOnce([
      { personName: "Ana Lima", email: "ana@pfrm.local", situation: "Incidentes no servidor legado", topicLabel: "infra", strength: 3 },
    ]);

    const result = await listGoToPersonsByDomain("infra");
    expect(result).toHaveLength(1);
    expect(result[0].personName).toBe("Ana Lima");
    expect(result[0].strength).toBe(3);

    const [query, params] = mocks.runQuery.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(query).toContain("IS_GO_TO_FOR");
    expect(params.domain).toBe("infra");
  });

  it("returns empty array when neo4j throws", async () => {
    mocks.runQuery.mockRejectedValueOnce(new Error("connection refused"));
    const result = await listGoToPersonsByDomain("prod");
    expect(result).toEqual([]);
  });
});

describe("getBusFactorRisk", () => {
  beforeEach(() => mocks.runQuery.mockReset());

  it("maps riskLevel high for uniqueProcedures >= 2", async () => {
    mocks.runQuery.mockResolvedValueOnce([
      { personName: "Ana Lima", email: null, uniqueProcedures: 3 },
      { personName: "Carlos", email: "c@pfrm.local", uniqueProcedures: 1 },
    ]);

    const result = await getBusFactorRisk("desenvolvimento");
    expect(result[0].riskLevel).toBe("high");
    expect(result[1].riskLevel).toBe("medium");

    const [query, params] = mocks.runQuery.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(query).toContain("PERFORMS");
    expect(params.sector).toBe("desenvolvimento");
  });

  it("returns empty array on neo4j error", async () => {
    mocks.runQuery.mockRejectedValueOnce(new Error("timeout"));
    const result = await getBusFactorRisk("seguranca");
    expect(result).toEqual([]);
  });
});
