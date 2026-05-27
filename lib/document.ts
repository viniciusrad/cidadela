import {
  prepareMarkdownDocument,
  type DocumentSourceFormat,
  type DocumentSourceOrigin,
} from "@/lib/markdown";
import { convertPdfToMarkdown } from "@/lib/pdf";
import { convertDocToMarkdown, convertDocxToMarkdown } from "@/lib/word";

export type { DocumentSourceFormat, DocumentSourceOrigin } from "@/lib/markdown";

export type DocumentPreparationInput = {
  fileName: string;
  buffer: Buffer;
  sourceFormat: DocumentSourceFormat;
  relativePath?: string;
  responsibleArea?: string;
  sourceOrigin?: DocumentSourceOrigin;
};

export function buildResponsibleAreaContext(responsibleArea: string) {
  return `Setor responsavel pela execucao do processo documentado: ${responsibleArea}.`;
}

export function buildCuratedEmbeddingContent(
  content: string,
  responsibleArea?: string,
) {
  if (!responsibleArea) {
    return content;
  }

  return `${buildResponsibleAreaContext(responsibleArea)}\n\n${content}`;
}

export function getFileExtension(fileName: string) {
  const normalizedName = fileName.trim().toLowerCase();

  if (normalizedName.endsWith(".docx")) {
    return ".docx";
  }

  if (normalizedName.endsWith(".doc")) {
    return ".doc";
  }

  if (normalizedName.endsWith(".md")) {
    return ".md";
  }

  if (normalizedName.endsWith(".pdf")) {
    return ".pdf";
  }

  return "";
}

export async function prepareUploadedDocument({
  fileName,
  buffer,
  sourceFormat,
  relativePath,
  responsibleArea,
  sourceOrigin = "upload",
}: DocumentPreparationInput) {
  if (sourceFormat === "markdown") {
    return prepareMarkdownDocument({
      fileName,
      markdown: buffer.toString("utf8"),
      relativePath,
      responsibleArea,
      sourceFormat,
      sourceOrigin,
      conversionWarnings: [],
    });
  }

  let converted;
  if (sourceFormat === "docx") {
    converted = await convertDocxToMarkdown({ fileName, buffer, sourceOrigin });
  } else if (sourceFormat === "doc") {
    converted = await convertDocToMarkdown({ fileName, buffer, sourceOrigin });
  } else {
    converted = await convertPdfToMarkdown({ fileName, buffer, sourceOrigin });
  }

  return prepareMarkdownDocument({
    fileName,
    markdown: converted.markdown,
    relativePath,
    responsibleArea,
    sourceFormat,
    sourceOrigin,
    title: converted.title,
    headings: converted.headings,
    wordCount: converted.wordCount,
    conversionWarnings: converted.conversionWarnings,
    convertedAt: converted.convertedAt,
    generatedFrontmatter: converted.frontmatter,
  });
}
