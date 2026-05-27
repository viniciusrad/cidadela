import { describe, expect, it, vi } from "vitest";

import type { ChatCitation, DelegationTrace } from "@/lib/domain";
import type { SearchMatch } from "@/lib/markdown";

// base-agent pulls in ollama/qdrant/graph clients at import time; stub them so
// the module loads in isolation. determineAgentAnswered itself is pure and
// touches none of these.
vi.mock("@/lib/ollama", () => ({
  getEmbedding: vi.fn(),
  generateAnswerStream: vi.fn(),
  rerankDocuments: vi.fn(),
}));
vi.mock("@/lib/qdrant", () => ({ searchChunks: vi.fn() }));
vi.mock("@/lib/agents/database-search", () => ({ searchDatabaseDocuments: vi.fn() }));
vi.mock("@/lib/agents/graph-search", () => ({ searchGraphDocuments: vi.fn() }));
vi.mock("@/lib/graph/query-context", () => ({ getGraphContextForQuestion: vi.fn() }));
vi.mock("@/lib/bus/publisher", () => ({
  requestAgent: vi.fn(),
  safePublishAuditEvent: vi.fn(),
}));
vi.mock("@/lib/db/audit-repo", () => ({ createAgentCall: vi.fn() }));

import { determineAgentAnswered } from "@/lib/agents/base-agent";

function makeMatch(score = 0.8): SearchMatch {
  return {
    score,
    documentId: "doc-1",
    fileName: "doc.md",
    documentTitle: "Documento",
    sourceFormat: "markdown",
    headingPathText: "Secao",
    content: "conteudo relevante",
    contentPreview: "conteudo relevante",
    chunkIndex: 0,
  };
}

function makeCitation(overrides: Partial<ChatCitation> = {}): ChatCitation {
  return {
    sector: "suporte",
    documentId: "doc-1",
    documentTitle: "Documento",
    fileName: "doc.md",
    headingPathText: "Secao",
    chunkIndex: 0,
    score: 0.7,
    content: "trecho relevante",
    contentPreview: "trecho relevante",
    ...overrides,
  };
}

function makeTrace(overrides: Partial<DelegationTrace> = {}): DelegationTrace {
  return {
    from: "desenvolvimento",
    to: "suporte",
    intent: "consulta",
    protocol: "p1",
    question: "pergunta",
    answer: "resposta",
    status: "ok",
    citations: [],
    ...overrides,
  };
}

describe("determineAgentAnswered", () => {
  it("returns false when nothing relevant was retrieved (enqueue for curation)", () => {
    // Reproduces the ZSD9999 case: graph enrichment may have injected a chunk
    // that cleared the score floor but not the technical-token filter, so it is
    // absent from relevantMatches. The agent declares a knowledge gap, and the
    // chat route must enqueue the unanswered question.
    const answered = determineAgentAnswered({
      relevantMatches: [],
      trace: [makeTrace({ citations: [] })],
      hasExternalContext: false,
    });
    expect(answered).toBe(false);
  });

  it("returns true when there is at least one relevant local/graph match", () => {
    const answered = determineAgentAnswered({
      relevantMatches: [makeMatch()],
      trace: [],
      hasExternalContext: false,
    });
    expect(answered).toBe(true);
  });

  it("returns true when an external source grounded the answer", () => {
    // Pharmacy price lookup / MCP-EDI: no RAG citations, but the answer is
    // grounded — it must not be treated as a curation gap.
    const answered = determineAgentAnswered({
      relevantMatches: [],
      trace: [],
      hasExternalContext: true,
    });
    expect(answered).toBe(true);
  });

  it("returns true when a successful delegation returned relevant citations", () => {
    const answered = determineAgentAnswered({
      relevantMatches: [],
      trace: [makeTrace({ status: "ok", citations: [makeCitation()] })],
      hasExternalContext: false,
    });
    expect(answered).toBe(true);
  });

  it("ignores citations from a delegation that did not succeed", () => {
    const answered = determineAgentAnswered({
      relevantMatches: [],
      trace: [makeTrace({ status: "timeout", citations: [makeCitation()] })],
      hasExternalContext: false,
    });
    expect(answered).toBe(false);
  });

  it("ignores delegated citations below the relevance score floor", () => {
    const answered = determineAgentAnswered({
      relevantMatches: [],
      trace: [makeTrace({ status: "ok", citations: [makeCitation({ score: 0.1 })] })],
      hasExternalContext: false,
    });
    expect(answered).toBe(false);
  });
});
