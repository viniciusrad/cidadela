import { describe, expect, it } from "vitest";

import { rankShareableKnowledgeTargets } from "@/lib/knowledge/capabilities";

const candidates = [
  {
    sector: "desenvolvimento" as const,
    sourceDocumentId: "dev-zsd90",
    documentTitle: "Transacao ZSD90",
    topic: "sap",
    sensitivity: "internal",
    capabilityText:
      "Transacao ZSD90\nA ZSD90 serve para consultar pedidos enviados em duplicidade.",
  },
  {
    sector: "seguranca" as const,
    sourceDocumentId: "sec-001",
    documentTitle: "Politica de senhas",
    topic: "acesso",
    sensitivity: "public",
    capabilityText: "Politica de senhas e MFA.",
  },
  {
    sector: "desenvolvimento" as const,
    sourceDocumentId: "dev-secret",
    documentTitle: "Transacao ZSD91",
    topic: "sap",
    sensitivity: "restricted",
    capabilityText: "ZSD91 contem procedimento restrito.",
  },
];

describe("rankShareableKnowledgeTargets", () => {
  it("routes support questions to the sector that owns a matching internal document", () => {
    const match = rankShareableKnowledgeTargets(
      "suporte",
      "Para que serve a transacao zsd90?",
      candidates,
      ["desenvolvimento", "seguranca"],
    );

    expect(match?.sector).toBe("desenvolvimento");
    expect(match?.sourceDocumentIds).toEqual(["dev-zsd90"]);
  });

  it("does not expose confidential or restricted documents as capabilities", () => {
    const match = rankShareableKnowledgeTargets(
      "suporte",
      "Para que serve a transacao zsd91?",
      candidates,
      ["desenvolvimento"],
    );

    expect(match).toBeNull();
  });

  it("does not route to sectors that are not protocol targets", () => {
    const match = rankShareableKnowledgeTargets(
      "suporte",
      "Para que serve a transacao zsd90?",
      candidates,
      ["seguranca"],
    );

    expect(match).toBeNull();
  });

  it("treats missing sensitivity as public for shareable capability ranking", () => {
    const match = rankShareableKnowledgeTargets(
      "suporte",
      "Para que serve a transacao zsd92?",
      [
        {
          sector: "desenvolvimento",
          sourceDocumentId: "dev-zsd92",
          documentTitle: "Transacao ZSD92",
          topic: "sap",
          sensitivity: null,
          capabilityText: "A ZSD92 consulta status de pedidos integrados.",
        },
      ],
      ["desenvolvimento"],
    );

    expect(match?.sector).toBe("desenvolvimento");
    expect(match?.sourceDocumentIds).toEqual(["dev-zsd92"]);
  });
});
