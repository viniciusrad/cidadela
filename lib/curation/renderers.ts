import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CurationDocument } from "@prisma/client";

import { appConfig } from "@/lib/config";
import {
  documentTypeLabel,
  normalizeDocumentType,
  sourceTypeForDocumentType,
  type DocumentType,
} from "@/lib/document-types";
import { cleanDocumentSummary } from "@/lib/markdown";
import { normalizeSensitivity } from "@/lib/sensitivity";
import { renderSopMarkdown, writeSopFile } from "@/lib/sop-generator";
import type { CurationQuestion } from "@/lib/sop-readiness";

type RendererDocument = Pick<
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
  | "documentType"
  | "topic"
  | "authorityLevel"
>;

function markdownDate(value?: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function answerById(questions: CurationQuestion[], id: string) {
  return questions.find((question) => question.id === id)?.response?.trim();
}

function answerLines(questions: CurationQuestion[]) {
  const answered = questions.filter((q) => q.response?.trim());
  if (answered.length === 0) {
    return "";
  }

  return answered
    .map((question) => `- ${question.prompt}: ${question.response!.trim()}`)
    .join("\n");
}

function renderGenericCuratedMarkdown(input: {
  document: RendererDocument;
  questions: CurationQuestion[];
  documentType: DocumentType;
}) {
  const { document, documentType, questions } = input;
  const generatedAt = new Date().toISOString();
  const label = documentTypeLabel(documentType);

  const frontmatter = [
    "---",
    `curated_id: ${document.sourceDocumentId}`,
    `document_type: ${documentType}`,
    `source_type: ${sourceTypeForDocumentType(documentType)}`,
    `sector: ${document.sector}`,
    ...(document.owner ? [`owner: ${document.owner}`] : []),
    ...(document.topic ? [`topic: ${document.topic}`] : []),
    `authority_level: ${document.authorityLevel ?? "draft"}`,
    ...(document.effectiveFrom ? [`effective_from: ${markdownDate(document.effectiveFrom)}`] : []),
    ...(document.supersedes ? [`supersedes: ${document.supersedes}`] : []),
    `sensitivity: ${normalizeSensitivity(document.sensitivity)}`,
    `generated_at: ${generatedAt}`,
    "generator_version: 1",
    "generated_by: deterministic-curation-renderer",
    `source_document_hash: ${document.contentHash}`,
    "---",
  ].join("\n");

  const curationSection = answerLines(questions);
  const sourceContent = document.normalizedMarkdown.trim();
  const summary = cleanDocumentSummary(document.normalizedMarkdown, document.documentTitle);

  return [
    frontmatter,
    "",
    `# ${document.documentTitle}`,
    "",
    `## Tipo`,
    label,
    ...(summary ? ["", "## Resumo", summary] : []),
    ...(curationSection ? ["", "## Curadoria", curationSection] : []),
    ...(sourceContent ? ["", "## Conteudo fonte preservado", sourceContent] : []),
    "",
    "## Referencias",
    `- Documento fonte: ${document.sourceDocumentId}`,
    `- Setor: ${document.sector}`,
    "",
  ].join("\n");
}

function renderDdpMarkdown(input: {
  document: RendererDocument;
  questions: CurationQuestion[];
}) {
  const { document, questions } = input;
  const generatedAt = new Date().toISOString();
  const summary = cleanDocumentSummary(document.normalizedMarkdown, document.documentTitle);

  const curationSection = answerLines(questions);
  const sourceContent = document.normalizedMarkdown.trim();

  return [
    "---",
    `curated_id: ${document.sourceDocumentId}`,
    "document_type: ddp",
    `source_type: ${sourceTypeForDocumentType("ddp")}`,
    `sector: ${document.sector}`,
    ...(document.owner ? [`owner: ${document.owner}`] : []),
    ...(document.topic ? [`topic: ${document.topic}`] : []),
    `authority_level: ${document.authorityLevel ?? "draft"}`,
    ...(document.effectiveFrom ? [`effective_from: ${markdownDate(document.effectiveFrom)}`] : []),
    ...(document.supersedes ? [`supersedes: ${document.supersedes}`] : []),
    `sensitivity: ${normalizeSensitivity(document.sensitivity)}`,
    `generated_at: ${generatedAt}`,
    "generator_version: 1",
    "generated_by: deterministic-curation-renderer",
    `source_document_hash: ${document.contentHash}`,
    "---",
    "",
    `# ${document.documentTitle}`,
    ...(summary ? ["", "## 1. Objetivo e contexto", summary] : []),
    ...(curationSection ? ["", "## 2. Regras e observacoes de curadoria", curationSection] : []),
    ...(sourceContent ? ["", "## 3. Conteudo consolidado", sourceContent] : []),
    "",
    "## 4. Referencias",
    `- Documento fonte: ${document.sourceDocumentId}`,
    `- Setor: ${document.sector}`,
    "",
  ].join("\n");
}

function renderConversaMarkdown(input: {
  document: RendererDocument;
  questions: CurationQuestion[];
}): string {
  const { document, questions } = input;
  const generatedAt = new Date().toISOString();

  const markdown = document.normalizedMarkdown ?? "";

  const perguntaMatch = markdown.match(/##\s*Pergunta\s*\n+([\s\S]*?)(?=\n##|\n---)/i);
  const respostaMatch = markdown.match(/##\s*Resposta\s*\n+([\s\S]*?)(?=\n##|\n---)/i);

  const pergunta = perguntaMatch?.[1]?.trim() ?? document.documentTitle ?? "";
  const resposta = respostaMatch?.[1]?.trim() ?? "";

  const origem = answerById(questions, "conversation_origin");
  const decisoes = answerById(questions, "conversation_decisions");
  const followups = answerById(questions, "conversation_followups");

  const lines: string[] = [
    "---",
    `curated_id: ${document.sourceDocumentId}`,
    "document_type: conversa",
    `source_type: ${sourceTypeForDocumentType("conversa")}`,
    `sector: ${document.sector}`,
    `owner: ${document.owner ?? "null"}`,
    `topic: ${document.topic ?? "null"}`,
    `sensitivity: ${normalizeSensitivity(document.sensitivity)}`,
    `effective_from: ${markdownDate(document.effectiveFrom)}`,
    `generated_at: ${generatedAt}`,
    "generator_version: 1",
    "generated_by: deterministic-curation-renderer",
    `source_document_hash: ${document.contentHash}`,
    "---",
    "",
    `# ${document.documentTitle}`,
    "",
  ];

  if (pergunta) {
    lines.push(`**Pergunta:** ${pergunta}`, "");
  }

  if (resposta) {
    lines.push("**Resposta:**", "", resposta, "");
  }

  if (origem) {
    lines.push("## Contexto", "", origem, "");
  }

  if (decisoes) {
    lines.push("## Decisoes registradas", "", decisoes, "");
  }

  if (followups) {
    lines.push("## Proximos passos", "", followups, "");
  }

  if (document.owner) {
    lines.push("---", "", `**Registrado por:** ${document.owner}`);
    if (document.sector) {
      lines.push(`**Setor:** ${document.sector}`);
    }
  }

  return lines.join("\n").trim();
}

function renderPersonMarkdown(input: {
  document: RendererDocument;
  questions: CurationQuestion[];
}): string {
  const { document, questions } = input;
  const generatedAt = new Date().toISOString();

  const expertise = answerById(questions, "person_expertise");
  const scope = answerById(questions, "person_scope");
  const gotoWhat = answerById(questions, "person_goto_what");
  const gotoNot = answerById(questions, "person_goto_not");
  const network = answerById(questions, "person_network");

  const lines: string[] = [
    "---",
    `curated_id: ${document.sourceDocumentId}`,
    "document_type: person",
    `source_type: ${sourceTypeForDocumentType("person")}`,
    `sector: ${document.sector}`,
    `topic: ${document.topic ?? "null"}`,
    `sensitivity: ${normalizeSensitivity(document.sensitivity)}`,
    `effective_from: ${markdownDate(document.effectiveFrom)}`,
    `generated_at: ${generatedAt}`,
    "generator_version: 1",
    "generated_by: deterministic-curation-renderer",
    `source_document_hash: ${document.contentHash}`,
    "---",
    "",
    `# ${document.documentTitle}`,
    "",
  ];

  const baseContent = document.normalizedMarkdown?.trim();
  if (baseContent) {
    lines.push(baseContent, "");
  }

  if (expertise) {
    lines.push("## Competencias", "", expertise, "");
  }

  if (scope) {
    lines.push("## Escopo de referencia", "", scope, "");
  }

  if (gotoWhat) {
    try {
      const situations = JSON.parse(gotoWhat) as Array<{ when: string; tags: string[] }>;
      if (Array.isArray(situations) && situations.length > 0) {
        lines.push("## Quando recorrer a esta pessoa", "");
        for (const s of situations) {
          const tagStr = s.tags?.length ? ` [${s.tags.join(", ")}]` : "";
          lines.push(`- ${s.when}${tagStr}`);
        }
        lines.push("");
      }
    } catch {
      lines.push("## Quando recorrer a esta pessoa", "", gotoWhat, "");
    }
  }

  if (gotoNot) {
    lines.push("## Nao acionar para", "", gotoNot, "");
  }

  if (network) {
    lines.push("## Rede de conexao", "", network, "");
  }

  if (document.sector) {
    lines.push("---", "", `**Setor:** ${document.sector}`);
    if (document.owner) lines.push(`**Registrado por:** ${document.owner}`);
  }

  return lines.join("\n").trim();
}

function renderOrgChartMarkdown(input: {
  document: RendererDocument;
  questions: CurationQuestion[];
}): string {
  const { document, questions } = input;
  const generatedAt = new Date().toISOString();

  const scope = answerById(questions, "orgchart_scope");
  const top = answerById(questions, "orgchart_top");
  const decisionCenters = answerById(questions, "orgchart_decision_centers");
  const vacancies = answerById(questions, "orgchart_vacancies");
  const validity = answerById(questions, "orgchart_validity");

  const lines: string[] = [
    "---",
    `curated_id: ${document.sourceDocumentId}`,
    "document_type: org_chart",
    `source_type: ${sourceTypeForDocumentType("org_chart")}`,
    `sector: ${document.sector}`,
    `sensitivity: ${normalizeSensitivity(document.sensitivity)}`,
    `effective_from: ${markdownDate(document.effectiveFrom)}`,
    `generated_at: ${generatedAt}`,
    "generator_version: 1",
    "generated_by: deterministic-curation-renderer",
    `source_document_hash: ${document.contentHash}`,
    "---",
    "",
    `# ${document.documentTitle}`,
    "",
  ];

  if (scope) {
    lines.push(`**Escopo:** ${scope}`, "");
  }

  const baseContent = document.normalizedMarkdown?.trim();
  if (baseContent) {
    lines.push(baseContent, "");
  }

  if (top) {
    lines.push("## Topo da estrutura", "", top, "");
  }

  if (decisionCenters) {
    lines.push("## Centros de decisao", "", decisionCenters, "");
  }

  if (vacancies) {
    lines.push("## Posicoes em aberto / transicao", "", vacancies, "");
  }

  if (validity) {
    lines.push("## Validade", "", validity, "");
  }

  if (document.sector) {
    lines.push("---", "", `**Setor:** ${document.sector}`);
    if (document.effectiveFrom) {
      lines.push(
        `**Vigencia:** ${new Date(document.effectiveFrom).toLocaleDateString("pt-BR")}`,
      );
    }
  }

  return lines.join("\n").trim();
}

export function renderCuratedArtifactMarkdown(input: {
  document: RendererDocument;
  questions: CurationQuestion[];
}) {
  const documentType = normalizeDocumentType(input.document.documentType);

  if (documentType === "sop") {
    return {
      markdown: renderSopMarkdown(input),
      documentType,
      sourceType: sourceTypeForDocumentType(documentType),
    };
  }

  if (documentType === "ddp") {
    return {
      markdown: renderDdpMarkdown(input),
      documentType,
      sourceType: sourceTypeForDocumentType(documentType),
    };
  }

  if (documentType === "conversa") {
    return {
      markdown: renderConversaMarkdown(input),
      documentType,
      sourceType: sourceTypeForDocumentType(documentType),
    };
  }

  if (documentType === "person") {
    return {
      markdown: renderPersonMarkdown(input),
      documentType,
      sourceType: sourceTypeForDocumentType(documentType),
    };
  }

  if (documentType === "org_chart") {
    return {
      markdown: renderOrgChartMarkdown(input),
      documentType,
      sourceType: sourceTypeForDocumentType(documentType),
    };
  }

  return {
    markdown: renderGenericCuratedMarkdown({
      ...input,
      documentType,
    }),
    documentType,
    sourceType: sourceTypeForDocumentType(documentType),
  };
}

export async function writeCuratedArtifactFile(input: {
  sector: string;
  sourceDocumentId: string;
  documentType: DocumentType;
  markdown: string;
}) {
  if (input.documentType === "sop") {
    return writeSopFile({
      sector: input.sector,
      sourceDocumentId: input.sourceDocumentId,
      markdown: input.markdown,
    });
  }

  const sectorDir = path.resolve(
    appConfig.sopOutputDir,
    "..",
    "curated",
    input.sector,
    input.documentType,
  );
  await mkdir(sectorDir, { recursive: true });

  const filePath = path.join(
    sectorDir,
    `${sanitizeFilePart(input.sourceDocumentId)}.md`,
  );
  await writeFile(filePath, input.markdown, "utf8");

  return filePath;
}
