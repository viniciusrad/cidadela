import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authMock,
  createAuditEventMock,
  inferAdditionalQuestionsMock,
  getEmbeddingMock,
  prismaMock,
  prepareUploadedDocumentMock,
  replaceStagedDocumentChunksMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  createAuditEventMock: vi.fn(),
  inferAdditionalQuestionsMock: vi.fn(),
  getEmbeddingMock: vi.fn(),
  prismaMock: {
    curationDocument: {
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    documentReview: {
      create: vi.fn(),
    },
    documentApproval: {
      deleteMany: vi.fn(),
    },
    documentCorrelationRun: {
      deleteMany: vi.fn(),
    },
    sectorDefinition: {
      findMany: vi.fn(),
    },
  },
  prepareUploadedDocumentMock: vi.fn(),
  replaceStagedDocumentChunksMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/document", () => ({
  prepareUploadedDocument: prepareUploadedDocumentMock,
}));

vi.mock("@/lib/ollama", () => ({
  getEmbedding: getEmbeddingMock,
}));

vi.mock("@/lib/curation/inference", () => ({
  inferAdditionalQuestions: inferAdditionalQuestionsMock,
}));

vi.mock("@/lib/qdrant", () => ({
  replaceStagedDocumentChunks: replaceStagedDocumentChunksMock,
}));

vi.mock("@/lib/db/client", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/db/audit-repo", () => ({
  createAuditEvent: createAuditEventMock,
}));

import { POST } from "@/app/api/ingest/route";

function buildRequest(requestedSector?: string, relativePath?: string) {
  const formData = new FormData();
  formData.set(
    "file",
    new File(["# Guia de atendimento"], "guia.md", {
      type: "text/markdown",
    }),
  );

  if (requestedSector) {
    formData.set("sector", requestedSector);
  }

  if (relativePath) {
    formData.set("relativePath", relativePath);
  }

  return new Request("http://localhost/api/ingest", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prepareUploadedDocumentMock.mockResolvedValue({
      documentId: "doc-1",
      normalizedMarkdown:
        "---\ntitle: Guia de atendimento\nowner: suporte@cidadela.local\nsensitivity: internal\neffective_from: 2026-05-04\n---\n# Guia\n\n1. Abrir ticket.\n2. Registrar evidencia.",
      metadata: { title: "Guia de atendimento" },
      chunks: [
        {
          id: "chunk-1",
          documentId: "doc-1",
          sourceDocumentId: "doc-1",
          content: "Fluxo de atendimento do setor.",
        },
      ],
    });
    getEmbeddingMock.mockResolvedValue([0.12, 0.34, 0.56]);
    inferAdditionalQuestionsMock.mockResolvedValue([
      {
        id: "inferred_1",
        type: "gaps",
        prompt: "Qual excecao nao foi documentada?",
        required: false,
        source: "inferred",
      },
    ]);
    replaceStagedDocumentChunksMock.mockResolvedValue(undefined);
    prismaMock.curationDocument.findMany.mockResolvedValue([]);
    prismaMock.curationDocument.create.mockResolvedValue({
      id: "row-1",
      documentId: "doc-1",
    });
    prismaMock.curationDocument.update.mockResolvedValue({
      id: "row-1",
      documentId: "doc-1",
    });
    prismaMock.documentReview.create.mockResolvedValue({ id: "review-1" });
    prismaMock.sectorDefinition.findMany.mockResolvedValue([
      {
        slug: "juridico",
        displayName: "Juridico",
        agentName: "Agente Juridico",
        enabled: true,
      },
    ]);
    createAuditEventMock.mockResolvedValue({ id: "audit-1" });
  });

  it("envia documentos para staging curado no proprio setor", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user-1",
        email: "suporte@cidadela.local",
        name: "Suporte",
        role: "user",
        sector: "suporte",
      },
    });

    const response = await POST(buildRequest(undefined, "base/sub/guia.md"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      documentId: "doc-1",
      documentTitle: "Guia de atendimento",
      sector: "suporte",
      chunksCreated: 1,
      relativePath: "base/sub/guia.md",
      status: "READY_FOR_APPROVAL",
    });
    expect(prepareUploadedDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "guia.md",
        relativePath: "base/sub/guia.md",
        sourceFormat: "markdown",
      }),
    );
    expect(prismaMock.curationDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          documentId: "doc-1",
        },
      }),
    );
    expect(prismaMock.curationDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentId: "doc-1",
          sector: "suporte",
        }),
      }),
    );
    expect(replaceStagedDocumentChunksMock).toHaveBeenCalledWith(
      "suporte",
      "doc-1",
      [
        expect.objectContaining({
          id: "chunk-1",
          content: "Fluxo de atendimento do setor.",
          vector: [0.12, 0.34, 0.56],
        }),
      ],
    );
    expect(prismaMock.documentReview.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          questions: expect.arrayContaining([
            expect.objectContaining({
              id: "sop_who",
              isDefault: true,
            }),
            expect.objectContaining({
              id: "inferred_1",
              source: "inferred",
            }),
          ]),
        }),
      }),
    );
  });

  it("bloqueia tentativa de ingerir documento em outro setor", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user-2",
        email: "dev@cidadela.local",
        name: "Dev",
        role: "user",
        sector: "desenvolvimento",
      },
    });

    const response = await POST(buildRequest("seguranca"));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({
      message: "Cada usuario so pode ingerir documentos no proprio setor.",
    });
    expect(prepareUploadedDocumentMock).not.toHaveBeenCalled();
    expect(replaceStagedDocumentChunksMock).not.toHaveBeenCalled();
  });

  it("permite admin ingerir documento em setor dinamico existente", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "admin-1",
        email: "admin@cidadela.local",
        name: "Admin",
        role: "admin",
        sector: "desenvolvimento",
      },
    });

    const response = await POST(buildRequest("juridico"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      documentId: "doc-1",
      sector: "juridico",
    });
    expect(prismaMock.curationDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentId: "doc-1",
          sector: "juridico",
        }),
      }),
    );
    expect(replaceStagedDocumentChunksMock).toHaveBeenCalledWith(
      "juridico",
      "doc-1",
      expect.any(Array),
    );
  });

  it("reutiliza o registro global do documento ao reenviar o mesmo arquivo para outro setor", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "admin-1",
        email: "admin@cidadela.local",
        name: "Admin",
        role: "admin",
        sector: "desenvolvimento",
      },
    });
    prismaMock.curationDocument.findMany.mockResolvedValue([
      {
        id: "row-existing",
        documentId: "doc-1",
        sector: "desenvolvimento",
      },
    ]);

    const response = await POST(buildRequest("suporte"));
    expect(response.status).toBe(200);
    expect(prismaMock.curationDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "row-existing" },
        data: expect.objectContaining({
          documentId: "doc-1",
          sector: "suporte",
          promotedAt: null,
          sopPath: null,
        }),
      }),
    );
    expect(prismaMock.documentApproval.deleteMany).toHaveBeenCalledWith({
      where: { curationDocumentId: "row-1" },
    });
    expect(prismaMock.documentCorrelationRun.deleteMany).toHaveBeenCalledWith({
      where: { curationDocumentId: "row-1" },
    });
  });
});
