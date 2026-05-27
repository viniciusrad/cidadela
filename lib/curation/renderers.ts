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
  return value ? value.toISOString().slice(0, 10) : "null";
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function answerLines(questions: CurationQuestion[]) {
  if (questions.length === 0) {
    return "null";
  }

  return questions
    .map((question) => {
      const response = question.response?.trim() || "null";
      return `- ${question.prompt}: ${response}`;
    })
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

  return [
    "---",
    `curated_id: ${document.sourceDocumentId}`,
    `document_type: ${documentType}`,
    `source_type: ${sourceTypeForDocumentType(documentType)}`,
    `sector: ${document.sector}`,
    `owner: ${document.owner ?? "null"}`,
    `topic: ${document.topic ?? "null"}`,
    `authority_level: ${document.authorityLevel ?? "draft"}`,
    `effective_from: ${markdownDate(document.effectiveFrom)}`,
    `supersedes: ${document.supersedes ?? "null"}`,
    `sensitivity: ${normalizeSensitivity(document.sensitivity)}`,
    `generated_at: ${generatedAt}`,
    "generator_version: 1",
    "generated_by: deterministic-curation-renderer",
    `source_document_hash: ${document.contentHash}`,
    "---",
    "",
    `# ${document.documentTitle}`,
    "",
    `## Tipo`,
    label,
    "",
    "## Resumo",
    cleanDocumentSummary(document.normalizedMarkdown, document.documentTitle),
    "",
    "## Curadoria",
    answerLines(questions),
    "",
    "## Conteudo fonte preservado",
    document.normalizedMarkdown.trim() || "null",
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

  return [
    "---",
    `curated_id: ${document.sourceDocumentId}`,
    "document_type: ddp",
    `source_type: ${sourceTypeForDocumentType("ddp")}`,
    `sector: ${document.sector}`,
    `owner: ${document.owner ?? "null"}`,
    `topic: ${document.topic ?? "null"}`,
    `authority_level: ${document.authorityLevel ?? "draft"}`,
    `effective_from: ${markdownDate(document.effectiveFrom)}`,
    `supersedes: ${document.supersedes ?? "null"}`,
    `sensitivity: ${normalizeSensitivity(document.sensitivity)}`,
    `generated_at: ${generatedAt}`,
    "generator_version: 1",
    "generated_by: deterministic-curation-renderer",
    `source_document_hash: ${document.contentHash}`,
    "---",
    "",
    `# ${document.documentTitle}`,
    "",
    "## 1. Objetivo e contexto",
    summary,
    "",
    "## 2. Regras e observacoes de curadoria",
    answerLines(questions),
    "",
    "## 3. Conteudo consolidado",
    document.normalizedMarkdown.trim() || "null",
    "",
    "## 4. Referencias",
    `- Documento fonte: ${document.sourceDocumentId}`,
    `- Setor: ${document.sector}`,
    "",
  ].join("\n");
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
