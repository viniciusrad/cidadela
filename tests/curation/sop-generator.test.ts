import { describe, expect, it } from "vitest";

import { renderSopMarkdown } from "@/lib/sop-generator";

describe("renderSopMarkdown", () => {
  it("gera markdown SOP padronizado com metadados e secoes obrigatorias", () => {
    const sop = renderSopMarkdown({
      document: {
        sourceDocumentId: "src-1",
        documentTitle: "Deploy do servico",
        sector: "desenvolvimento",
        owner: "dev@cidadela.local",
        effectiveFrom: new Date("2026-05-04"),
        supersedes: null,
        sensitivity: "internal",
        contentHash: "hash-1",
        normalizedMarkdown: "1. Preparar release.\n2. Executar deploy.",
      },
      questions: [
        {
          id: "sop_when",
          type: "sop_when",
          prompt: "Quando?",
          required: true,
          response: "Quando houver release aprovada.",
        },
        {
          id: "sop_who",
          type: "sop_who",
          prompt: "Quem?",
          required: true,
          response: "Executor: Forja; aprovador: admin.",
        },
      ],
    });

    expect(sop).toContain("sop_id: src-1");
    expect(sop).toContain("# Deploy do servico");
    expect(sop).toContain("## 5. Procedimento");
    expect(sop).toContain("1. Preparar release.");
  });

  it("assume sensibilidade publica quando o documento nao explicita classificacao", () => {
    const sop = renderSopMarkdown({
      document: {
        sourceDocumentId: "src-1",
        documentTitle: "Deploy do servico",
        sector: "desenvolvimento",
        owner: "dev@cidadela.local",
        effectiveFrom: new Date("2026-05-04"),
        supersedes: null,
        sensitivity: null,
        contentHash: "hash-1",
        normalizedMarkdown: "1. Preparar release.\n2. Executar deploy.",
      },
      questions: [],
    });

    expect(sop).toContain("sensitivity: public");
  });

  it("inclui respostas de lacunas operacionais como contexto afirmativo", () => {
    const sop = renderSopMarkdown({
      document: {
        sourceDocumentId: "src-1",
        documentTitle: "Deploy do servico",
        sector: "desenvolvimento",
        owner: "dev@cidadela.local",
        effectiveFrom: new Date("2026-05-04"),
        supersedes: null,
        sensitivity: "internal",
        contentHash: "hash-1",
        normalizedMarkdown: "1. Preparar release.\n2. Executar deploy.",
      },
      questions: [
        {
          id: "process_gap_gap-1",
          type: "gaps",
          prompt: "Qual o volume medio do processo?",
          required: false,
          source: "process_gap",
          response: "sob demanda\nquando o cliente reenvia o pedido",
        },
      ],
    });

    expect(sop).toContain("## 8. Lacunas operacionais respondidas");
    expect(sop).not.toContain("Qual o volume medio do processo?");
    expect(sop).toContain(
      "A recorrência operacional do processo está definida como sob demanda; quando o cliente reenvia o pedido.",
    );
  });
});
