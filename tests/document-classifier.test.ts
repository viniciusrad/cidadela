import { describe, expect, it } from "vitest";

import { classifyDocument } from "@/lib/document-classifier";

describe("classifyDocument", () => {
  it("classifica ata por decisoes e participantes", () => {
    const result = classifyDocument({
      fileName: "ata-comite.md",
      markdown:
        "# Ata do comite\n\nParticipantes: Ana e Joao.\n\nDecisoes: aprovar nova rotina.\nResponsavel: Ana. Prazo: sexta.",
    });

    expect(result.documentType).toBe("ata");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("classifica documento tecnico por sinais de API", () => {
    const result = classifyDocument({
      fileName: "integracao-api.md",
      markdown:
        "# Integracao\n\nEndpoint POST /tickets recebe payload JSON e retorna protocolo.",
    });

    expect(result.documentType).toBe("doc_tecnica");
  });

  it("marca candidato parcial quando ha checkpoint humano", () => {
    const result = classifyDocument({
      fileName: "workflow.md",
      markdown:
        "# Workflow\n\nProcesso recorrente com script, fila no portal e aprovacao humana antes do envio.",
    });

    expect(result.automationCandidates[0]).toMatchObject({
      automationLevel: "parcial",
      automationLabel: "candidato",
    });
  });
});
