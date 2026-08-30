import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listAllSectors: vi.fn(),
  listUniqueDocumentsInCollection: vi.fn(),
  checkNeo4jHealth: vi.fn(),
  runQuery: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/sectors/sector-repo", () => ({
  listAllSectors: mocks.listAllSectors,
}));

vi.mock("@/lib/qdrant", () => ({
  listUniqueDocumentsInCollection: mocks.listUniqueDocumentsInCollection,
}));

vi.mock("@/lib/neo4j", () => ({
  checkNeo4jHealth: mocks.checkNeo4jHealth,
  runQuery: mocks.runQuery,
}));

import { GET } from "@/app/api/graph/documents/route";

describe("GET /api/graph/documents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: {
        id: "admin-1",
        email: "admin@cidadela.local",
        role: "admin",
        sector: "desenvolvimento",
      },
    });
    mocks.listAllSectors.mockResolvedValue([
      {
        slug: "desenvolvimento",
        displayName: "Desenvolvimento",
        agentName: "Forja",
        isNative: true,
        qdrantCollection: "rag_dev",
      },
      {
        slug: "financeiro-ap",
        displayName: "Financeiro AP",
        agentName: "Ledger",
        isNative: false,
        qdrantCollection: "rag_financeiro_ap",
      },
    ]);
    mocks.listUniqueDocumentsInCollection.mockImplementation(async (sector: string) => [
      {
        sector,
        sourceDocumentId: `${sector}-source`,
        documentId: `${sector}-doc`,
        documentTitle: `Doc ${sector}`,
        fileName: `${sector}.md`,
        chunkCount: 2,
      },
    ]);
    mocks.checkNeo4jHealth.mockResolvedValue(true);
    mocks.runQuery.mockResolvedValue([
      {
        docId: "financeiro-ap-source",
        sourceDocumentId: "financeiro-ap-source",
        legacyDocumentId: null,
      },
    ]);
  });

  it("lists documents from native and dynamic sector collections", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.listUniqueDocumentsInCollection).toHaveBeenCalledWith("desenvolvimento");
    expect(mocks.listUniqueDocumentsInCollection).toHaveBeenCalledWith("financeiro-ap");
    expect(body.sectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "financeiro-ap",
          displayName: "Financeiro AP",
          agentName: "Ledger",
        }),
      ]),
    );
    expect(body.docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sector: "financeiro-ap",
          inGraph: true,
        }),
        expect.objectContaining({
          sector: "desenvolvimento",
          inGraph: false,
        }),
      ]),
    );
  });
});
