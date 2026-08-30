import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authMock,
  createAuditEventMock,
  deleteStagedDocumentChunksMock,
  prismaMock,
  findCurationDocumentForActorMock,
  canAdministerCurationDocumentMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  createAuditEventMock: vi.fn(),
  deleteStagedDocumentChunksMock: vi.fn(),
  prismaMock: {
    curationDocument: {
      delete: vi.fn(),
    },
  },
  findCurationDocumentForActorMock: vi.fn(),
  canAdministerCurationDocumentMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/curation/documents", () => ({
  findCurationDocumentForActor: findCurationDocumentForActorMock,
  canAdministerCurationDocument: canAdministerCurationDocumentMock,
}));

vi.mock("@/lib/db/audit-repo", () => ({
  createAuditEvent: createAuditEventMock,
}));

vi.mock("@/lib/db/client", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/qdrant", () => ({
  deleteStagedDocumentChunks: deleteStagedDocumentChunksMock,
}));

import { POST } from "@/app/api/curation/[documentId]/discard/route";

describe("POST /api/curation/[documentId]/discard", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authMock.mockResolvedValue({
      user: {
        id: "admin-1",
        email: "admin@cidadela.local",
        name: "Admin",
        role: "admin",
        sector: "desenvolvimento",
      },
    });
    canAdministerCurationDocumentMock.mockReturnValue(true);
    findCurationDocumentForActorMock.mockResolvedValue({
      id: "row-1",
      documentId: "doc-1",
      sourceDocumentId: "source-1",
      sector: "suporte",
      status: "REJECTED",
    });
    deleteStagedDocumentChunksMock.mockResolvedValue(undefined);
    createAuditEventMock.mockResolvedValue({ id: "audit-1" });
    prismaMock.curationDocument.delete.mockResolvedValue({ id: "row-1" });
  });

  it("descarta um documento rejeitado removendo staging e registro relacional", async () => {
    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ documentId: "doc-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      documentId: "doc-1",
      discarded: true,
    });
    expect(deleteStagedDocumentChunksMock).toHaveBeenCalledWith(
      "suporte",
      "source-1",
    );
    expect(createAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "document.discarded",
        targetId: "doc-1",
      }),
    );
    expect(prismaMock.curationDocument.delete).toHaveBeenCalledWith({
      where: { id: "row-1" },
    });
  });

  it("bloqueia descarte definitivo para documentos fora do estado rejeitado", async () => {
    findCurationDocumentForActorMock.mockResolvedValue({
      id: "row-1",
      documentId: "doc-1",
      sourceDocumentId: "source-1",
      sector: "suporte",
      status: "APPROVED",
    });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ documentId: "doc-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      message:
        "Somente documentos rejeitados podem ser descartados definitivamente.",
    });
    expect(deleteStagedDocumentChunksMock).not.toHaveBeenCalled();
    expect(prismaMock.curationDocument.delete).not.toHaveBeenCalled();
  });
});
