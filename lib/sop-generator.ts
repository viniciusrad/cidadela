import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CurationDocument } from "@prisma/client";

import { appConfig } from "@/lib/config";
import { cleanDocumentSummary, previewText } from "@/lib/markdown";
import { normalizeSensitivity } from "@/lib/sensitivity";
import type { CurationQuestion } from "@/lib/sop-readiness";

function answerFor(questions: CurationQuestion[], type: CurationQuestion["type"]) {
  return questions.find((question) => question.type === type)?.response?.trim();
}

function normalizePrompt(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function inlineAnswer(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("; ");
}

function isNegativeAnswer(value: string) {
  return /^(nao|não|n|no|sem|inexistente)\b/i.test(value.trim());
}

function operationalContextFor(question: CurationQuestion) {
  const prompt = normalizePrompt(question.prompt);
  const response = inlineAnswer(question.response?.trim() ?? "");

  if (!response) {
    return "";
  }

  if (
    prompt.includes("checkpoint") ||
    prompt.includes("aprovacao") ||
    prompt.includes("manual") ||
    prompt.includes("validacao") ||
    prompt.includes("humano")
  ) {
    return isNegativeAnswer(response)
      ? "O fluxo não exige checkpoint humano, aprovação manual ou validação obrigatória; a execução pode seguir sem intervenção adicional."
      : `O fluxo possui controle humano obrigatório: ${response}.`;
  }

  if (prompt.includes("frequencia") || prompt.includes("volume")) {
    return `A recorrência operacional do processo está definida como ${response}.`;
  }

  if (
    prompt.includes("regra") ||
    prompt.includes("norma") ||
    prompt.includes("restric")
  ) {
    return `As restrições e regras operacionais aplicáveis ficam consolidadas como ${response}.`;
  }

  if (
    prompt.includes("sucesso") ||
    prompt.includes("sla") ||
    prompt.includes("qualidade") ||
    prompt.includes("indicador")
  ) {
    return `O acompanhamento de sucesso, SLA e qualidade deve considerar ${response}.`;
  }

  if (
    prompt.includes("outro documento") ||
    prompt.includes("sop") ||
    prompt.includes("evidencia")
  ) {
    return `A rastreabilidade documental complementar fica registrada como ${response}.`;
  }

  if (prompt.includes("falta documentar") || prompt.includes("ficar claro")) {
    return `Para eliminar ambiguidade operacional, fica estabelecido que ${response}.`;
  }

  return `Contexto operacional consolidado: ${response}.`;
}

function renderProcessGapAnswers(questions: CurationQuestion[]) {
  const processGaps = questions.filter(
    (question) => question.source === "process_gap" && question.response?.trim(),
  );

  if (processGaps.length === 0) {
    return "null";
  }

  return processGaps
    .map((question, index) => `${index + 1}. ${operationalContextFor(question)}`)
    .join("\n\n");
}

function markdownDate(value?: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "null";
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function extractProcedure(markdown: string) {
  const numbered = markdown
    .split("\n")
    .filter((line) => /^\s*\d+\.\s+\S+/.test(line))
    .join("\n")
    .trim();

  if (numbered) {
    return numbered;
  }

  return markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((block, index) => `${index + 1}. ${previewText(block)}`)
    .join("\n");
}

export function renderSopMarkdown(input: {
  document: Pick<
    CurationDocument,
    | "sourceDocumentId"
    | "documentTitle"
    | "sector"
    | "owner"
    | "effectiveFrom"
    | "supersedes"
    | "sensitivity"
    | "contentHash"
    | "normalizedMarkdown"
  >;
  questions: CurationQuestion[];
}) {
  const { document, questions } = input;
  const generatedAt = new Date().toISOString();
  const procedure = extractProcedure(document.normalizedMarkdown);

  return [
    "---",
    `sop_id: ${document.sourceDocumentId}`,
    `sector: ${document.sector}`,
    `owner: ${document.owner ?? "null"}`,
    `effective_from: ${markdownDate(document.effectiveFrom)}`,
    `supersedes: ${document.supersedes ?? "null"}`,
    `sensitivity: ${normalizeSensitivity(document.sensitivity)}`,
    `generated_at: ${generatedAt}`,
    "generator_version: 1",
    "generated_by: deterministic-curation-generator",
    `source_document_hash: ${document.contentHash}`,
    "---",
    "",
    `# ${document.documentTitle}`,
    "",
    "## 1. Objetivo",
    cleanDocumentSummary(document.normalizedMarkdown, document.documentTitle),
    "",
    "## 2. Quando aplicar",
    answerFor(questions, "sop_when") ?? "null",
    "",
    "## 3. Responsaveis",
    `- Executor: ${answerFor(questions, "sop_who") ?? "null"}`,
    `- Aprovador: ${answerFor(questions, "sop_who") ?? "null"}`,
    `- Dono do conhecimento: ${document.owner ?? "null"}`,
    "",
    "## 4. Pre-requisitos",
    answerFor(questions, "sop_inputs") ?? "null",
    "",
    "## 5. Procedimento",
    procedure || "null",
    "",
    "## 6. Saidas e evidencias",
    answerFor(questions, "sop_outputs") ?? "null",
    "",
    "## 7. Excecoes e tratamento de erro",
    answerFor(questions, "sop_errors") ?? "null",
    "",
    "## 8. Lacunas operacionais respondidas",
    renderProcessGapAnswers(questions),
    "",
    "## 9. Referencias",
    `- Documento fonte: ${document.sourceDocumentId}`,
    "",
    "## 10. Historico",
    "| Versao | Data | Mudanca | Aprovado por |",
    "| --- | --- | --- | --- |",
    `| 1 | ${generatedAt.slice(0, 10)} | SOP gerado a partir de curadoria aprovada | ${document.owner ?? "admin do setor"} |`,
    "",
  ].join("\n");
}

export async function writeSopFile(input: {
  sector: string;
  sourceDocumentId: string;
  markdown: string;
}) {
  const sectorDir = path.resolve(appConfig.sopOutputDir, input.sector);
  await mkdir(sectorDir, { recursive: true });

  const filePath = path.join(
    sectorDir,
    `${sanitizeFilePart(input.sourceDocumentId)}.md`,
  );
  await writeFile(filePath, input.markdown, "utf8");

  return filePath;
}
