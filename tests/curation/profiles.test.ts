import { describe, expect, it } from "vitest";

import {
  calculateCurationReadiness,
  requiredCurationQuestions,
} from "@/lib/curation/profiles";

describe("curation profiles", () => {
  it("gera perguntas de ata sem exigir passos de SOP", () => {
    const questions = requiredCurationQuestions(
      "ata",
      { title: "Ata", sector: "desenvolvimento", owner: "dev@pfrm.local" },
      [],
    );

    expect(questions.map((question) => question.id)).toEqual([
      "ata_date_participants",
      "ata_decisions",
      "ata_actions",
    ]);
    expect(questions.every((question) => question.required === false)).toBe(true);
  });

  it("calcula readiness de documento tecnico sem depender das respostas de perfil", () => {
    const questions = requiredCurationQuestions(
      "doc_tecnica",
      {
        title: "API",
        sector: "desenvolvimento",
        owner: "dev@pfrm.local",
      },
      [
        {
          id: "tech_systems",
          type: "systems",
          prompt: "",
          required: true,
          response: "API de tickets.",
        },
        {
          id: "tech_version_scope",
          type: "scope",
          prompt: "",
          required: true,
          response: "Producao.",
        },
        {
          id: "tech_examples_risks",
          type: "risks",
          prompt: "",
          required: true,
          response: "Falhas retornam 409.",
        },
      ],
    );

    const readiness = calculateCurationReadiness({
      documentType: "doc_tecnica",
      metadata: {
        title: "API",
        sector: "desenvolvimento",
        owner: "dev@pfrm.local",
      },
      markdown: "Endpoint recebe payload JSON para integracao.",
      questions,
    });

    expect(readiness.score).toBeGreaterThanOrEqual(0.8);
    expect(readiness.missing).toEqual([]);
  });

  it("ignora perguntas inferidas no readiness", () => {
    const readiness = calculateCurationReadiness({
      documentType: "faq",
      metadata: {
        title: "FAQ",
        sector: "suporte",
        owner: "suporte@pfrm.local",
      },
      markdown: "FAQ com perguntas e respostas oficiais.",
      questions: [
        {
          id: "faq_scope",
          type: "scope",
          prompt: "",
          required: true,
          response: "Uso interno do suporte.",
        },
        {
          id: "faq_pairs",
          type: "qa_pairs",
          prompt: "",
          required: true,
          response: "Pergunta e resposta principal.",
        },
        {
          id: "faq_authoritative_links",
          type: "references",
          prompt: "",
          required: true,
          response: "Base oficial.",
        },
        {
          id: "inferred_1",
          type: "gaps",
          prompt: "Qual excecao ainda falta?",
          required: false,
          source: "inferred",
        },
      ],
    });

    expect(readiness.score).toBeGreaterThanOrEqual(0.8);
    expect(readiness.missing).toEqual([]);
  });
});
