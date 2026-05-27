import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentRpcPayload } from "@/lib/agents/types";
import type { ChatCitation, Sector } from "@/lib/domain";
import type { SearchMatch } from "@/lib/markdown";

const mocks = vi.hoisted(() => ({
  getEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
  searchChunks: vi.fn(),
  searchDatabaseDocuments: vi.fn(),
  searchGraphDocuments: vi.fn(),
  requestAgent: vi.fn(),
  safePublishAuditEvent: vi.fn(),
  createAgentCall: vi.fn(),
  capturedPrompts: [] as string[],
}));

vi.mock("@/lib/ollama", () => ({
  getEmbedding: mocks.getEmbedding,
  generateAnswerStream: vi.fn(async function* (prompt: string) {
    mocks.capturedPrompts.push(prompt);
    yield {
      chunk: "resposta final",
      metrics: {
        totalDurationMs: 1,
        tokensGenerated: 2,
        tokensPerSecond: 2,
      },
    };
  }),
}));

vi.mock("@/lib/qdrant", () => ({
  searchChunks: mocks.searchChunks,
}));

vi.mock("@/lib/agents/database-search", () => ({
  searchDatabaseDocuments: mocks.searchDatabaseDocuments,
}));

vi.mock("@/lib/agents/graph-search", () => ({
  searchGraphDocuments: mocks.searchGraphDocuments,
}));

vi.mock("@/lib/bus/publisher", () => ({
  requestAgent: mocks.requestAgent,
  safePublishAuditEvent: mocks.safePublishAuditEvent,
}));

vi.mock("@/lib/db/audit-repo", () => ({
  createAgentCall: mocks.createAgentCall,
}));

import { runSectorAgent } from "@/lib/agents/base-agent";

function makeMatch(
  sector: Sector,
  score: number,
  content = `conteudo ${sector}`,
): SearchMatch {
  return {
    score,
    documentId: `doc-${sector}`,
    fileName: `${sector}.md`,
    documentTitle: `Documento ${sector}`,
    sourceFormat: "markdown",
    headingPathText: "Secao",
    content,
    contentPreview: content,
    chunkIndex: 0,
  };
}

function makeCitation(sector: Sector, score: number): ChatCitation {
  const match = makeMatch(sector, score);
  return {
    sector,
    documentId: match.documentId,
    fileName: match.fileName,
    documentTitle: match.documentTitle,
    headingPathText: match.headingPathText,
    chunkIndex: match.chunkIndex,
    score: match.score,
    content: match.content,
    contentPreview: match.contentPreview,
  };
}

describe("runSectorAgent low-confidence fanout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capturedPrompts.length = 0;
    mocks.getEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    mocks.searchDatabaseDocuments.mockResolvedValue([]);
    mocks.searchGraphDocuments.mockResolvedValue([]);
    mocks.safePublishAuditEvent.mockResolvedValue(undefined);
    mocks.createAgentCall.mockResolvedValue(undefined);
  });

  it("fans out when the best local match is below the local confidence threshold", async () => {
    mocks.searchChunks.mockResolvedValue([
      makeMatch("desenvolvimento", 0.49, "conteudo local fraco zsd244"),
    ]);
    mocks.requestAgent.mockImplementation(async ({ toAgent }: AgentRpcPayload) => ({
      answer: `retorno de ${toAgent}`,
      citations:
        toAgent === "suporte" ? [makeCitation("suporte", 0.82)] : [],
      status: "ok",
    }));

    const result = await runSectorAgent({
      traceId: "trace-low-confidence",
      sector: "desenvolvimento",
      question: "para que serve a transacao zsd244?",
    });

    expect(mocks.requestAgent).toHaveBeenCalledTimes(3);
    expect(result.trace.map((item) => item.to).sort()).toEqual([
      "desktop",
      "seguranca",
      "suporte",
    ]);
    expect(result.citations.some((citation) => citation.sector === "suporte"))
      .toBe(true);
    expect(mocks.capturedPrompts.at(-1)).toContain(
      "use a evidencia intersetorial como fonte principal",
    );
    expect(mocks.capturedPrompts.at(-1)).toContain(
      "Segundo o agente Helpdesk (setor suporte)",
    );
    expect(mocks.capturedPrompts.at(-1)).toContain("Agente consultado: Helpdesk");
  });

  it("does not fan out when the best local match is just above the confidence threshold", async () => {
    mocks.searchChunks.mockResolvedValue([
      makeMatch("desenvolvimento", 0.51, "conteudo local suficiente"),
    ]);

    await runSectorAgent({
      traceId: "trace-confident-local",
      sector: "desenvolvimento",
      question: "como versionar a api de pedidos?",
    });

    expect(mocks.requestAgent).not.toHaveBeenCalled();
    expect(mocks.capturedPrompts.at(-1)).not.toContain(
      "use a evidencia intersetorial como fonte principal",
    );
  });

  it("preserves fanout when there is no local evidence", async () => {
    mocks.searchChunks.mockResolvedValue([]);
    mocks.requestAgent.mockResolvedValue({
      answer: "sem evidencia",
      citations: [],
      status: "ok",
    });

    await runSectorAgent({
      traceId: "trace-no-local",
      sector: "suporte",
      question: "para que serve a transacao zsd90?",
    });

    expect(mocks.requestAgent).toHaveBeenCalledTimes(3);
  });

  it("uses graph-only search when RAG is disabled and graph is enabled", async () => {
    mocks.searchGraphDocuments.mockResolvedValue([
      makeMatch("suporte", 0.8, "relacao do grafo sobre zsd90"),
    ]);

    const result = await runSectorAgent({
      traceId: "trace-graph-only",
      sector: "suporte",
      question: "para que serve a transacao zsd90?",
      useRag: false,
      useGraph: true,
    });

    expect(mocks.getEmbedding).not.toHaveBeenCalled();
    expect(mocks.searchChunks).not.toHaveBeenCalled();
    expect(mocks.searchDatabaseDocuments).not.toHaveBeenCalled();
    expect(mocks.requestAgent).not.toHaveBeenCalled();
    expect(mocks.searchGraphDocuments).toHaveBeenCalledWith(
      "suporte",
      "para que serve a transacao zsd90?",
    );
    expect(result.citations).toHaveLength(1);
    expect(mocks.capturedPrompts.at(-1)).toContain("relacao do grafo sobre zsd90");
  });

  it("uses database-only search when RAG and graph are disabled", async () => {
    mocks.searchDatabaseDocuments.mockResolvedValue([
      makeMatch("suporte", 0.8, "registro SQL sobre zsd90"),
    ]);

    const result = await runSectorAgent({
      traceId: "trace-sql-only",
      sector: "suporte",
      question: "para que serve a transacao zsd90?",
      useRag: false,
      useGraph: false,
    });

    expect(mocks.getEmbedding).not.toHaveBeenCalled();
    expect(mocks.searchChunks).not.toHaveBeenCalled();
    expect(mocks.requestAgent).not.toHaveBeenCalled();
    expect(mocks.searchGraphDocuments).not.toHaveBeenCalled();
    expect(mocks.searchDatabaseDocuments).toHaveBeenCalledWith(
      "suporte",
      "para que serve a transacao zsd90?",
    );
    expect(result.citations).toHaveLength(1);
    expect(mocks.capturedPrompts.at(-1)).toContain("registro SQL sobre zsd90");
  });
});
