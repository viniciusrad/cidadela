import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateJsonMock } = vi.hoisted(() => ({
  generateJsonMock: vi.fn(),
}));

vi.mock("@/lib/ollama", () => ({
  generateJson: generateJsonMock,
}));

import { inferAdditionalQuestions } from "@/lib/curation/inference";

describe("inferAdditionalQuestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normaliza a resposta do modelo em ate 3 perguntas opcionais", async () => {
    generateJsonMock.mockResolvedValue({
      questions: [
        { prompt: "Qual sistema oficial valida este fluxo?" },
        { prompt: "Que excecao operacional nao esta documentada?" },
        { prompt: "Quem revisa periodicamente este conteudo?" },
        { prompt: "Pergunta excedente." },
      ],
    });

    const result = await inferAdditionalQuestions({
      documentType: "doc_tecnica",
      sector: "desenvolvimento",
      title: "API de tickets",
      markdown: "Conteudo ".repeat(500),
      existingQuestions: [],
    });

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      id: "inferred_1",
      required: false,
      source: "inferred",
    });
    expect(generateJsonMock).toHaveBeenCalledWith(
      expect.stringContaining("TRECHO DO DOCUMENTO (3000 chars):"),
      expect.objectContaining({ temperature: 0 }),
    );
    expect(generateJsonMock.mock.calls[0]?.[0]).not.toContain("Pergunta excedente.");
  });

  it("falha silenciosamente quando o modelo retorna erro", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    generateJsonMock.mockRejectedValue(new Error("offline"));

    const result = await inferAdditionalQuestions({
      documentType: "faq",
      sector: "suporte",
      title: "FAQ",
      markdown: "Perguntas frequentes",
      existingQuestions: [],
    });

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
