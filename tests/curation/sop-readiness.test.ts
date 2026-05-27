import { describe, expect, it } from "vitest";

import { calculateSopReadiness } from "@/lib/sop-readiness";

describe("calculateSopReadiness", () => {
  it("nao depende das respostas opcionais para atingir readiness", () => {
    const result = calculateSopReadiness({
      metadata: {
        title: "Deploy",
      },
      markdown: "1. Preparar release.\n2. Executar deploy.",
      questions: [
        {
          id: "sop_when",
          type: "sop_when",
          prompt: "Quando?",
          required: true,
          response: "A cada release aprovada.",
        },
        {
          id: "sop_who",
          type: "sop_who",
          prompt: "Quem?",
          required: true,
          response: "Executor: Forja.",
        },
        {
          id: "sop_inputs",
          type: "sop_inputs",
          prompt: "Entradas?",
          required: true,
          response: "Acesso ao CI.",
        },
        {
          id: "sop_outputs",
          type: "sop_outputs",
          prompt: "Saidas?",
          required: true,
          response: "Release registrada.",
        },
        {
          id: "sop_errors",
          type: "sop_errors",
          prompt: "Erros?",
          required: true,
          response: "Abrir incidente.",
        },
      ],
    });

    expect(result.score).toBe(1);
    expect(result.missing).toEqual([]);
  });

  it("mantem bloqueio apenas quando falta estrutura minima do documento", () => {
    const result = calculateSopReadiness({
      metadata: {
        title: "Deploy",
      },
      markdown: "Texto corrido sem passos numerados.",
      questions: [
        {
          id: "sop_when",
          type: "sop_when",
          prompt: "Quando?",
          required: true,
          response: "A cada release aprovada.",
        },
        {
          id: "sop_who",
          type: "sop_who",
          prompt: "Quem?",
          required: true,
          response: "Executor: Forja.",
        },
        {
          id: "sop_inputs",
          type: "sop_inputs",
          prompt: "Entradas?",
          required: true,
          response: "Acesso ao CI.",
        },
        {
          id: "sop_outputs",
          type: "sop_outputs",
          prompt: "Saidas?",
          required: true,
          response: "Release registrada.",
        },
        {
          id: "sop_errors",
          type: "sop_errors",
          prompt: "Erros?",
          required: true,
          response: "Abrir incidente.",
        },
      ],
    });

    expect(result.score).toBe(0.7);
    expect(result.missing).toEqual(["procedure_steps"]);
  });
});
