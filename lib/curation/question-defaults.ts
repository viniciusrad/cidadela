import { getSectorLabel } from "@/lib/labels";
import type { CurationQuestion } from "@/lib/sop-readiness";

type DefaultContext = {
  sector: string;
  title?: string;
};

function hasResponse(question: CurationQuestion) {
  return typeof question.response === "string" && question.response.trim().length > 0;
}

function buildDefaultResponse(
  question: CurationQuestion,
  context: DefaultContext,
) {
  const sectorLabel = getSectorLabel(context.sector);
  const sectorText = `setor ${sectorLabel}`;

  switch (question.id) {
    case "norma_authority":
    case "generic_authority":
      return sectorLabel;
    case "sop_who":
      return `Executado por: equipe do ${sectorText}. Aprovado por: responsavel do setor.`;
    case "norma_scope":
    case "faq_scope":
    case "tech_version_scope":
      return `Aplica-se ao ${sectorText}. ${question.prompt}`;
    case "norma_obligations":
    case "contract_obligations":
      return `Todos os usuarios do ${sectorText} devem cumprir as disposicoes deste documento.`;
    case "announcement_audience":
      return `Todos os usuarios do ${sectorText}`;
    case "contract_parties":
      return sectorText;
    default:
      return "";
  }
}

export function applyQuestionDefaults(
  questions: CurationQuestion[],
  context: DefaultContext,
): CurationQuestion[] {
  return questions.map((question) => {
    if (hasResponse(question)) {
      return question;
    }

    const response = buildDefaultResponse(question, context);
    if (!response) {
      return question;
    }

    return {
      ...question,
      response,
      isDefault: true,
    };
  });
}
