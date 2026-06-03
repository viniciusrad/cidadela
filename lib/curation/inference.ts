import type { DocumentType } from "@/lib/document-types";
import { getSectorLabel } from "@/lib/labels";
import { generateJson } from "@/lib/ollama";
import type { CurationQuestion } from "@/lib/sop-readiness";

type AnswerResult = {
  answers?: Array<{
    id?: unknown;
    answer?: unknown;
    found?: unknown;
  }>;
};

type InferenceResult = {
  questions?: Array<{
    prompt?: unknown;
    rationale?: unknown;
  }>;
};

const MAX_MARKDOWN_CHARS = 3000;

function normalizePrompt(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function inferAdditionalQuestions(input: {
  documentType: DocumentType;
  sector: string;
  title?: string;
  markdown: string;
  existingQuestions?: CurationQuestion[];
}): Promise<CurationQuestion[]> {
  const markdownExcerpt = input.markdown.trim().slice(0, MAX_MARKDOWN_CHARS);
  if (!markdownExcerpt) {
    return [];
  }

  const sectorLabel = getSectorLabel(input.sector);
  const existingPrompts = (input.existingQuestions ?? [])
    .map((question) => `- ${question.prompt}`)
    .join("\n");

  const prompt = [
    "Voce e um assistente de curadoria de documentos empresariais.",
    `Tipo: ${input.documentType} | Setor: ${sectorLabel} | Titulo: ${input.title?.trim() || "Sem titulo"}`,
    "",
    "Perguntas ja existentes:",
    existingPrompts || "- Nenhuma pergunta existente.",
    "",
    "Analise o trecho do documento e identifique ate 3 lacunas especificas NAO cobertas pelas perguntas acima.",
    "Seja objetivo e direto ao ponto.",
    'Responda SOMENTE em JSON: {"questions":[{"prompt":"...","rationale":"..."}]}',
    'Se nao houver lacunas, retorne {"questions":[]}.',
    "",
    `TRECHO DO DOCUMENTO (${MAX_MARKDOWN_CHARS} chars):`,
    markdownExcerpt,
  ].join("\n");

  try {
    const result = await generateJson<InferenceResult>(prompt, {
      temperature: 0,
    });
    const questions = Array.isArray(result.questions) ? result.questions : [];

    return questions.slice(0, 3).reduce<CurationQuestion[]>((acc, question, index) => {
        const normalized = normalizePrompt(question.prompt);
        if (!normalized) {
          return acc;
        }

        acc.push({
          id: `inferred_${index + 1}`,
          type: "gaps" as const,
          prompt: normalized,
          required: false,
          source: "inferred" as const,
        });

        return acc;
      }, []);
  } catch (error) {
    console.warn("Falha ao inferir perguntas adicionais de curadoria.", error);
    return [];
  }
}

export async function inferTemplateAnswers(input: {
  questions: CurationQuestion[];
  markdown: string;
  title?: string;
  sector: string;
}): Promise<Array<{ questionId: string; answer: string }>> {
  const unanswered = input.questions.filter((q) => !q.response?.trim());
  if (!unanswered.length) {
    return [];
  }

  // Perguntas marcadas com neverInfer=true exigem conhecimento humano/tribal
  // e nao devem ser enviadas ao LLM para inferencia automatica
  const inferableQuestions = unanswered.filter(
    (q) => !(q as { neverInfer?: boolean }).neverInfer,
  );
  if (!inferableQuestions.length) {
    return [];
  }

  const markdownExcerpt = input.markdown.trim().slice(0, MAX_MARKDOWN_CHARS);
  if (!markdownExcerpt) {
    return [];
  }

  const sectorLabel = getSectorLabel(input.sector);
  const questionList = inferableQuestions
    .map((q) => `{"id":"${q.id}","prompt":${JSON.stringify(q.prompt)}}`)
    .join(",\n");

  const prompt = [
    "Voce e um assistente de curadoria de documentos empresariais.",
    `Setor: ${sectorLabel} | Titulo: ${input.title?.trim() || "Sem titulo"}`,
    "",
    "Analise o documento abaixo e tente responder as perguntas listadas APENAS com informacoes presentes no proprio documento.",
    "Para cada pergunta:",
    '  - Se a resposta estiver claramente no documento, defina "found": true e "answer" com uma resposta concisa.',
    '  - Se a resposta NAO estiver no documento, defina "found": false e omita "answer".',
    "",
    `PERGUNTAS: [${questionList}]`,
    "",
    'Responda SOMENTE em JSON: {"answers":[{"id":"<id>","found":true,"answer":"..."},...]}',
    "Inclua SOMENTE entradas onde found=true.",
    "",
    `DOCUMENTO (${MAX_MARKDOWN_CHARS} chars):`,
    markdownExcerpt,
  ].join("\n");

  try {
    const result = await generateJson<AnswerResult>(prompt, { temperature: 0 });
    const answers = Array.isArray(result.answers) ? result.answers : [];

    return answers.reduce<Array<{ questionId: string; answer: string }>>(
      (acc, item) => {
        const id = typeof item.id === "string" ? item.id.trim() : "";
        const answer = typeof item.answer === "string" ? item.answer.trim() : "";
        if (id && answer && item.found === true) {
          acc.push({ questionId: id, answer });
        }

        return acc;
      },
      [],
    );
  } catch (error) {
    console.warn("Falha ao inferir respostas das perguntas template.", error);
    return [];
  }
}
