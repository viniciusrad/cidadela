import { describe, expect, it } from "vitest";

import { applyQuestionDefaults } from "@/lib/curation/question-defaults";

describe("applyQuestionDefaults", () => {
  it("preenche apenas perguntas mapeadas sem sobrescrever respostas existentes", () => {
    const result = applyQuestionDefaults(
      [
        {
          id: "sop_who",
          type: "sop_who",
          prompt: "Quem executa e quem aprova?",
          required: true,
        },
        {
          id: "norma_scope",
          type: "scope",
          prompt: "Qual e o escopo?",
          required: true,
          response: "Resposta manual.",
        },
        {
          id: "ata_date_participants",
          type: "meeting_context",
          prompt: "Data e participantes?",
          required: true,
        },
      ],
      {
        sector: "suporte",
      },
    );

    expect(result[0]).toMatchObject({
      id: "sop_who",
      isDefault: true,
      response:
        "Executado por: equipe do setor Suporte. Aprovado por: responsavel do setor.",
    });
    expect(result[1]).toMatchObject({
      id: "norma_scope",
      response: "Resposta manual.",
    });
    expect(result[1].isDefault).toBeUndefined();
    expect(result[2].response).toBeUndefined();
  });
});
