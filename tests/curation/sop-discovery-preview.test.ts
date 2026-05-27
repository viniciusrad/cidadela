import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sopOutputDir: "",
}));

vi.mock("@/lib/config", () => ({
  appConfig: {
    get sopOutputDir() {
      return state.sopOutputDir;
    },
  },
}));

vi.mock("@/lib/ollama", () => ({
  generateJson: vi.fn(async () => ({
    title: "Procedimento revisado",
    summary: "Resumo consolidado.",
    keyInformation: [],
    processSteps: [],
    context: "Contexto extraido.",
    when: "Quando houver solicitacao operacional.",
    who: "Analista responsavel.",
    prerequisites: [],
    inputs: ["Chamado e dados do solicitante."],
    steps: ["Validar dados.", "Executar procedimento.", "Registrar evidencia."],
    outputs: "Solicitacao atendida.",
    errors: "Escalar excecoes para o gestor.",
  })),
  getEmbedding: vi.fn(),
}));

vi.mock("@/lib/qdrant", () => ({
  semanticSearchSectorChunks: vi.fn(),
  listSectorChunks: vi.fn(async (_sector: string, input: { sourceDocumentId?: string }) => ({
    rows: [
      {
        chunkIndex: 0,
        headingPathText: "Documento",
        content: `Conteudo do documento ${input.sourceDocumentId ?? "doc"}.`,
        contentPreview: `Conteudo do documento ${input.sourceDocumentId ?? "doc"}.`,
        sourceDocumentId: input.sourceDocumentId ?? "doc",
        documentTitle: "Documento",
      },
    ],
  })),
}));

import { previewSopFromSuggestion, saveSopDraft, type SopSuggestion } from "@/lib/sop-discovery";

describe("SOP discovery preview", () => {
  beforeEach(async () => {
    state.sopOutputDir = await mkdtemp(path.join(os.tmpdir(), "sop-discovery-"));
  });

  afterEach(async () => {
    await rm(state.sopOutputDir, { recursive: true, force: true });
  });

  it("gera previa sem salvar o arquivo final", async () => {
    const suggestion: SopSuggestion = {
      id: "disc-1",
      topic: "Procedimento de atendimento",
      documentType: "sop",
      documentTypeLabel: "SOP",
      sourceDocuments: [
        {
          sourceDocumentId: "doc-1",
          documentTitle: "Atendimento",
          chunkCount: 1,
        },
      ],
      totalChunkCount: 1,
      contentSummary: "Fluxo de atendimento ao usuario.",
      automationPotential: "low",
      topChunks: [
        {
          chunkIndex: 0,
          headingPathText: "Atendimento",
          content: "Validar dados, executar atendimento e registrar evidencia.",
          contentPreview: "Validar dados",
          sourceDocumentId: "doc-1",
          documentTitle: "Atendimento",
        },
      ],
    };

    const draft = await previewSopFromSuggestion("desenvolvimento", suggestion);

    expect(draft.markdown).toContain("# Procedimento revisado");
    expect(draft.sopPath).toContain("Procedimento-de-atendimento");
    await expect(stat(draft.sopPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("salva somente o markdown confirmado", async () => {
    const sopPath = path.join(state.sopOutputDir, "desenvolvimento", "confirmado.md");
    const markdown = "# SOP ajustado\n\nConteudo aprovado pelo curador.";

    const result = await saveSopDraft("desenvolvimento", {
      sopPath,
      markdown,
      sourceDocumentCount: 2,
      fallbackTitle: "Fallback",
    });

    await expect(readFile(sopPath, "utf8")).resolves.toBe(markdown);
    expect(result.title).toBe("SOP ajustado");
    expect(result.sourceDocumentCount).toBe(2);
  });

  it("gera previa de artefato consolidado quando nao for SOP", async () => {
    const suggestion: SopSuggestion = {
      id: "disc-faq",
      topic: "Duvidas de acesso",
      documentType: "faq",
      documentTypeLabel: "FAQ",
      sourceDocuments: [
        {
          sourceDocumentId: "doc-faq",
          documentTitle: "Perguntas de acesso",
          chunkCount: 1,
        },
      ],
      totalChunkCount: 1,
      contentSummary: "Perguntas e respostas sobre acesso.",
      automationPotential: "low",
      topChunks: [
        {
          chunkIndex: 0,
          headingPathText: "FAQ",
          content: "Pergunta: Como acessar? Resposta: Use seu usuario corporativo.",
          contentPreview: "Pergunta: Como acessar?",
          sourceDocumentId: "doc-faq",
          documentTitle: "Perguntas de acesso",
        },
      ],
    };

    const draft = await previewSopFromSuggestion("desenvolvimento", suggestion);

    expect(draft.markdown).toContain("document_type: faq");
    expect(draft.markdown).toContain("# Procedimento revisado");
    expect(draft.sopPath).toContain(path.join("curated", "desenvolvimento", "faq"));
    await expect(stat(draft.sopPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recusa salvar fora do diretorio do setor", async () => {
    const outsidePath = path.join(state.sopOutputDir, "..", "fora.md");

    await expect(
      saveSopDraft("desenvolvimento", {
        sopPath: outsidePath,
        markdown: "# Fora",
        sourceDocumentCount: 1,
        fallbackTitle: "Fora",
      }),
    ).rejects.toThrow("Caminho de artefato fora do diretorio do setor.");
  });
});
