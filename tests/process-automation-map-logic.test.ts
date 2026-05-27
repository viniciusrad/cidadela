import { describe, expect, it } from "vitest";

import {
  buildProcessMapDraft,
  calculateAutomationReadiness,
  generateProcessGapQuestions,
} from "@/lib/process-automation-map";

describe("process automation map logic", () => {
  it("rebaixa processo com humano no loop para parcial mesmo com score alto", () => {
    const result = calculateAutomationReadiness({
      docCount: 3,
      hasGraphStructure: true,
      hasAutomationCandidate: true,
      hasSystem: true,
      hasClearInputs: true,
      hasClearOutputs: true,
      hasFrequencyEvidence: true,
      hasHumanCheckpoint: true,
      hasCriticalCorrelation: false,
      hasOwner: true,
      hasTrigger: true,
      hasExceptions: true,
      hasSuccessIndicator: true,
      hasEndEvidence: true,
      hasRegulations: true,
      feedbackSignalsCount: 0,
      semanticConsistency: true,
    });

    expect(result.score).toBe(65);
    expect(result.level).toBe("parcial");
  });

  it("gera lacuna de sistema e eleva prioridade quando ha feedback ruim ligado ao tema", () => {
    const gaps = generateProcessGapQuestions({
      processName: "Fechamento de pedido",
      features: {
        docCount: 1,
        hasGraphStructure: false,
        hasAutomationCandidate: true,
        hasSystem: false,
        hasClearInputs: false,
        hasClearOutputs: false,
        hasFrequencyEvidence: false,
        hasHumanCheckpoint: false,
        hasCriticalCorrelation: false,
        hasOwner: false,
        hasTrigger: false,
        hasExceptions: false,
        hasSuccessIndicator: false,
        hasEndEvidence: false,
        hasRegulations: false,
        feedbackSignalsCount: 1,
        semanticConsistency: false,
      },
      systems: [],
      regulations: [],
      docRefs: [
        {
          curationDocumentId: "doc-row-1",
          documentId: "doc-1",
          sourceDocumentId: "doc-1",
          title: "Pedido eletrônico",
          sector: "desenvolvimento",
          status: "NEEDS_REVISION",
          source: "staging",
        },
      ],
      vectorEvidence: [],
      feedbackSignals: [
        {
          kind: "bad_feedback",
          text: "O fechamento de pedido ainda esta confuso para o usuario",
        },
      ],
    });

    expect(
      gaps.some((gap) => gap.question.includes("Quais sistemas, portais, APIs")),
    ).toBe(true);
    expect(
      gaps.some(
        (gap) =>
          gap.priority === "high" &&
          gap.question.includes("Usuarios relataram dificuldade"),
      ),
    ).toBe(true);
  });

  it("monta draft de processo com backlog de candidatos e fontes mistas", () => {
    const draft = buildProcessMapDraft({
      sector: "suporte",
      name: "Abertura de incidente",
      graphBacked: true,
      documents: [
        {
          curationDocumentId: "cur-1",
          documentId: "doc-1",
          sourceDocumentId: "doc-1",
          title: "SOP incidente",
          sector: "suporte",
          status: "PROMOTED",
          source: "promoted",
        },
        {
          curationDocumentId: "cur-2",
          documentId: "doc-2",
          sourceDocumentId: "doc-2",
          title: "Rascunho incidente",
          sector: "suporte",
          status: "NEEDS_REVISION",
          source: "staging",
        },
      ],
      systems: ["ServiceNow"],
      regulations: ["ITIL"],
      concepts: ["incidente"],
      vectorEvidence: [
        {
          sector: "suporte",
          sourceDocumentId: "doc-1",
          headingPathText: "Passos",
          excerpt: "Registrar chamado no ServiceNow",
          source: "promoted",
        },
      ],
      summarySeed: "Fluxo principal para abertura e roteamento de incidentes.",
      candidates: [
        {
          id: "cand-1",
          title: "Automatizar triagem",
          automationLevel: "parcial",
          confidence: 0.88,
          signals: ["menciona script/robo/fila/portal"],
          status: "suggested",
        },
      ],
      features: {
        docCount: 2,
        hasGraphStructure: true,
        hasAutomationCandidate: true,
        hasSystem: true,
        hasClearInputs: true,
        hasClearOutputs: true,
        hasFrequencyEvidence: true,
        hasHumanCheckpoint: false,
        hasCriticalCorrelation: false,
        hasOwner: true,
        hasTrigger: true,
        hasExceptions: true,
        hasSuccessIndicator: true,
        hasEndEvidence: true,
        hasRegulations: true,
        feedbackSignalsCount: 0,
        semanticConsistency: true,
      },
    });

    expect(draft.sourceScope).toBe("both");
    expect(draft.candidateIds).toEqual(["cand-1"]);
    expect(draft.recommendedAutomationLevel).toBe("total");
    expect(draft.actionRecommendation).toBe("Promover perguntas de lacuna para curadoria");
  });
});
