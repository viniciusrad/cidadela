import type { CurationFrontmatter } from "@/lib/frontmatter";

export type CurationQuestion = {
  id: string;
  type:
    | "metadata_required"
    | "sop_when"
    | "sop_who"
    | "sop_inputs"
    | "sop_outputs"
    | "sop_errors"
    | "actions"
    | "audience"
    | "authority"
    | "decisions"
    | "findings"
    | "gaps"
    | "impact"
    | "meeting_context"
    | "parties"
    | "period"
    | "qa_pairs"
    | "recommendations"
    | "references"
    | "risks"
    | "rules"
    | "scope"
    | "summary"
    | "systems"
    | "validity";
  prompt: string;
  required: boolean;
  response?: string;
  isDefault?: boolean;
  source?: "template" | "inferred" | "process_gap";
};

export type SopReadinessInput = {
  metadata: CurationFrontmatter;
  markdown: string;
  questions: CurationQuestion[];
};

export type SopReadinessResult = {
  score: number;
  missing: string[];
};

const WEIGHTS = {
  title: 0.7,
  procedure: 0.3,
};

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNumberedProcedure(markdown: string) {
  const matches = markdown.match(/^\s*\d+\.\s+\S+/gm);
  return (matches?.length ?? 0) >= 2;
}

export function calculateSopReadiness(input: SopReadinessInput): SopReadinessResult {
  const { metadata, markdown } = input;
  let score = 0;
  const missing: string[] = [];

  if (hasText(metadata.title)) {
    score += WEIGHTS.title;
  } else {
    missing.push("title");
  }

  if (hasNumberedProcedure(markdown)) {
    score += WEIGHTS.procedure;
  } else {
    missing.push("procedure_steps");
  }

  return {
    score: Number(score.toFixed(2)),
    missing,
  };
}

export function requiredReadinessQuestions(
  metadata: CurationFrontmatter,
  existing: CurationQuestion[] = [],
) {
  const byId = new Map(existing.map((question) => [question.id, question]));
  const questions: CurationQuestion[] = [];

  const add = (question: CurationQuestion) => {
    questions.push(byId.get(question.id) ?? question);
  };

  if (!metadata.title) {
    add({
      id: "metadata_title",
      type: "metadata_required",
      prompt: "Informe o titulo canonico do SOP.",
      required: false,
    });
  }

  if (!metadata.owner) {
    add({
      id: "metadata_owner",
      type: "metadata_required",
      prompt: "E-mail do responsavel pelo conhecimento (dono do SOP).",
      required: false,
    });
  }

  if (!metadata.effectiveFrom) {
    add({
      id: "metadata_effective_from",
      type: "metadata_required",
      prompt: "Data de vigencia do SOP.",
      required: false,
    });
  }

  add({
    id: "sop_when",
    type: "sop_when",
    prompt: "Quando este procedimento deve ser aplicado?",
    required: false,
  });
  add({
    id: "sop_who",
    type: "sop_who",
    prompt: "Quem executa e quem aprova este procedimento?",
    required: false,
  });
  add({
    id: "sop_inputs",
    type: "sop_inputs",
    prompt: "Quais pre-requisitos, acessos, sistemas ou dados sao necessarios?",
    required: false,
  });
  add({
    id: "sop_outputs",
    type: "sop_outputs",
    prompt: "Quais saidas ou evidencias comprovam a execucao correta?",
    required: false,
  });
  add({
    id: "sop_errors",
    type: "sop_errors",
    prompt: "Como tratar excecoes, falhas ou erros do procedimento?",
    required: false,
  });

  return questions;
}
