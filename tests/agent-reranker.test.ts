import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchMatch } from "@/lib/markdown";

const mocks = vi.hoisted(() => ({
  rerankDocuments: vi.fn(),
  rerankerEnabled: { value: true },
}));

vi.mock("@/lib/ollama", () => ({
  rerankDocuments: mocks.rerankDocuments,
  // Os demais exports nao sao usados por applyReranker, mas o modulo precisa-os
  getEmbedding: vi.fn(),
  generateAnswerStream: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  appConfig: {
    get rerankerEnabled() {
      return mocks.rerankerEnabled.value;
    },
  },
}));

function buildMatch(score: number, suffix: string): SearchMatch {
  return {
    score,
    documentId: `doc-${suffix}`,
    fileName: `file-${suffix}.md`,
    documentTitle: `Doc ${suffix}`,
    sourceFormat: "markdown",
    headingPathText: `path/${suffix}`,
    content: `content ${suffix}`,
    contentPreview: `preview ${suffix}`,
    chunkIndex: 0,
  };
}

describe("applyReranker", () => {
  beforeEach(() => {
    mocks.rerankDocuments.mockReset();
    mocks.rerankerEnabled.value = true;
  });

  it("returns matches unchanged when reranker is disabled", async () => {
    mocks.rerankerEnabled.value = false;
    const { applyReranker } = await import("@/lib/agents/base-agent");

    const matches = [buildMatch(0.8, "a"), buildMatch(0.5, "b")];
    const result = await applyReranker("pergunta", matches);

    expect(result).toBe(matches);
    expect(mocks.rerankDocuments).not.toHaveBeenCalled();
  });

  it("returns empty array when no matches are provided", async () => {
    const { applyReranker } = await import("@/lib/agents/base-agent");

    const result = await applyReranker("pergunta", []);

    expect(result).toEqual([]);
    expect(mocks.rerankDocuments).not.toHaveBeenCalled();
  });

  it("only sends the head up to RERANKER_MAX_CANDIDATES and preserves the tail", async () => {
    const { applyReranker, RERANKER_MAX_CANDIDATES } = await import(
      "@/lib/agents/base-agent"
    );

    const total = RERANKER_MAX_CANDIDATES + 5;
    const matches = Array.from({ length: total }, (_, i) =>
      buildMatch(1 - i * 0.01, `m${i}`),
    );

    // Reranker inverte os scores do head (último vira primeiro)
    mocks.rerankDocuments.mockResolvedValue(
      Array.from({ length: RERANKER_MAX_CANDIDATES }, (_, i) => ({
        index: i,
        relevance_score: i,
      })),
    );

    const result = await applyReranker("pergunta", matches);

    // O reranker so deve receber os primeiros RERANKER_MAX_CANDIDATES documentos
    expect(mocks.rerankDocuments).toHaveBeenCalledTimes(1);
    const [, documents] = mocks.rerankDocuments.mock.calls[0];
    expect(documents).toHaveLength(RERANKER_MAX_CANDIDATES);

    // O resultado total deve ter o mesmo tamanho da entrada
    expect(result).toHaveLength(total);

    // O head deve estar reordenado pelo novo score (decrescente)
    const headIds = result.slice(0, RERANKER_MAX_CANDIDATES).map((m) => m.documentId);
    expect(headIds[0]).toBe(`doc-m${RERANKER_MAX_CANDIDATES - 1}`);
    expect(headIds[headIds.length - 1]).toBe("doc-m0");

    // O tail deve permanecer na ordem original (sem rerank)
    const tail = result.slice(RERANKER_MAX_CANDIDATES);
    expect(tail.map((m) => m.documentId)).toEqual([
      `doc-m${RERANKER_MAX_CANDIDATES}`,
      `doc-m${RERANKER_MAX_CANDIDATES + 1}`,
      `doc-m${RERANKER_MAX_CANDIDATES + 2}`,
      `doc-m${RERANKER_MAX_CANDIDATES + 3}`,
      `doc-m${RERANKER_MAX_CANDIDATES + 4}`,
    ]);
  });

  it("falls back to vector scores when the reranker fails", async () => {
    const { applyReranker } = await import("@/lib/agents/base-agent");

    const matches = [buildMatch(0.9, "a"), buildMatch(0.7, "b")];
    mocks.rerankDocuments.mockRejectedValue(new Error("reranker down"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await applyReranker("pergunta", matches);
    errorSpy.mockRestore();

    expect(result).toBe(matches);
  });
});
