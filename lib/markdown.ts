import { createHash } from "node:crypto";

const CHUNK_TARGET_SIZE = 1200;
const CHUNK_OVERLAP_SIZE = 200;

export type DocumentSourceFormat = "markdown" | "docx" | "doc" | "pdf";
export type DocumentSourceOrigin = "upload";

export type PreparedDocumentMetadata = {
  title: string;
  fileName: string;
  relativePath?: string;
  responsibleArea?: string;
  sourceFormat: DocumentSourceFormat;
  sourceOrigin: DocumentSourceOrigin;
  headings: string[];
  wordCount: number;
  conversionWarnings: string[];
  convertedAt?: string;
  generatedFrontmatter?: string;
};

export type PreparedChunk = {
  id: string;
  documentId: string;
  sourceDocumentId: string;
  fileName: string;
  relativePath?: string;
  responsibleArea?: string;
  documentTitle: string;
  sourceFormat: DocumentSourceFormat;
  sourceOrigin: DocumentSourceOrigin;
  chunkIndex: number;
  headingPath: string[];
  headingPathText: string;
  content: string;
  contentPreview: string;
  contentHash: string;
  conversionWarningCount: number;
  createdAt: string;
};

export type PreparedDocument = {
  documentId: string;
  normalizedMarkdown: string;
  metadata: PreparedDocumentMetadata;
  chunks: PreparedChunk[];
};

type MarkdownSection = {
  headingPath: string[];
  text: string;
};

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashToUuid(value: string) {
  const hash = sha256(value);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

function cleanLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n");
}

function getBaseName(fileName: string) {
  return fileName.split(/[\\/]/).pop() ?? fileName;
}

export function normalizeMarkdown(value: string) {
  return cleanLineEndings(value).trim();
}

export function buildDocumentId(normalizedMarkdown: string) {
  return sha256(normalizedMarkdown);
}

function splitMarkdownIntoSections(markdown: string) {
  const sections: MarkdownSection[] = [];
  const lines = markdown.split("\n");
  const headingTrail: string[] = [];
  let activeHeadingPath: string[] = [];
  let buffer: string[] = [];

  const pushBuffer = () => {
    const text = buffer.join("\n").trim();

    if (!text) {
      buffer = [];
      return;
    }

    sections.push({
      headingPath: [...activeHeadingPath],
      text,
    });
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);

    if (!headingMatch) {
      buffer.push(line);
      continue;
    }

    pushBuffer();

    const level = headingMatch[1].length;
    const title = headingMatch[2].trim();

    headingTrail.splice(level - 1);
    headingTrail[level - 1] = title;
    activeHeadingPath = headingTrail.filter(Boolean);
    buffer.push(line);
  }

  pushBuffer();

  if (sections.length === 0 && markdown.trim()) {
    sections.push({
      headingPath: [],
      text: markdown.trim(),
    });
  }

  return sections;
}

export function previewText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 600);
}

export function cleanDocumentSummary(markdown: string, title: string) {
  const genericPatterns = [
    /^#+\s+\*\*Sobre\*\*\s+/i,
    /^#+\s+Sobre\s+/i,
    /^#+\s+\*\*Objetivo\*\*\s+/i,
    /^#+\s+Objetivo\s+/i,
    /^#+\s+\*\*Resumo\*\*\s+/i,
    /^#+\s+Resumo\s+/i,
  ];

  let summary = markdown.trim();

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of genericPatterns) {
      if (pattern.test(summary)) {
        summary = summary.replace(pattern, "").trim();
        changed = true;
      }
    }
  }

  // Se o sumario agora comecar com o proprio titulo, podemos manter.
  // Caso contrario, se comecar com texto util, retornamos o preview.
  const preview = previewText(summary);

  if (!preview || preview === "null") {
    return `Este documento contem informacoes sobre ${title}.`;
  }

  return preview;
}

function getOverlapSeed(chunk: string) {
  return chunk.slice(Math.max(0, chunk.length - CHUNK_OVERLAP_SIZE)).trim();
}

function splitLongUnit(unit: string): string[] {
  if (unit.length <= CHUNK_TARGET_SIZE) {
    return [unit];
  }

  const lineParts = unit
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean);

  if (lineParts.length > 1) {
    const nestedParts: string[] = [];

    for (const linePart of lineParts) {
      nestedParts.push(...splitLongUnit(linePart));
    }

    return nestedParts;
  }

  const parts: string[] = [];
  let start = 0;

  while (start < unit.length) {
    const end = Math.min(unit.length, start + CHUNK_TARGET_SIZE);
    const slice = unit.slice(start, end).trim();

    if (slice) {
      parts.push(slice);
    }

    if (end >= unit.length) {
      break;
    }

    start = Math.max(end - CHUNK_OVERLAP_SIZE, start + 1);
  }

  return parts;
}

function chunkSection(section: MarkdownSection) {
  const units = section.text
    .split(/\n{2,}/)
    .map((unit) => unit.trim())
    .filter(Boolean)
    .flatMap(splitLongUnit);

  if (units.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let current = "";

  for (const unit of units) {
    if (!current) {
      current = unit;
      continue;
    }

    const candidate = `${current}\n\n${unit}`;
    if (candidate.length <= CHUNK_TARGET_SIZE) {
      current = candidate;
      continue;
    }

    chunks.push(current);
    const overlap = getOverlapSeed(current);
    current = overlap ? `${overlap}\n\n${unit}` : unit;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function cleanLeadingJunk(markdown: string) {
  const genericPatterns = [
    /^#+\s+\*\*Sobre\*\*\s+/i,
    /^#+\s+Sobre\s+/i,
    /^#+\s+\*\*Objetivo\*\*\s+/i,
    /^#+\s+Objetivo\s+/i,
    /^#+\s+\*\*Resumo\*\*\s+/i,
    /^#+\s+Resumo\s+/i,
  ];

  let cleaned = markdown.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of genericPatterns) {
      if (pattern.test(cleaned)) {
        cleaned = cleaned.replace(pattern, "").trim();
        changed = true;
      }
    }
  }
  return cleaned;
}

export function prepareMarkdownDocument({
  fileName,
  markdown,
  relativePath,
  responsibleArea,
  sourceFormat = "markdown",
  sourceOrigin = "upload",
  title,
  headings,
  wordCount,
  conversionWarnings = [],
  convertedAt,
  generatedFrontmatter,
}: {
  fileName: string;
  markdown: string;
  relativePath?: string;
  responsibleArea?: string;
  sourceFormat?: DocumentSourceFormat;
  sourceOrigin?: DocumentSourceOrigin;
  title?: string;
  headings?: string[];
  wordCount?: number;
  conversionWarnings?: string[];
  convertedAt?: string;
  generatedFrontmatter?: string;
}): PreparedDocument {
  const rawNormalized = normalizeMarkdown(markdown);
  const normalizedMarkdown = cleanLeadingJunk(rawNormalized);

  const detectedHeadings =
    headings ??
    normalizedMarkdown
      .split("\n")
      .map((line) => /^(#{1,6})\s+(.*\S)\s*$/.exec(line)?.[2]?.trim() ?? "")
      .filter(Boolean);
  const documentTitle =
    title ||
    detectedHeadings[0] ||
    getBaseName(fileName).replace(/\.(md|docx|doc)$/i, "").trim() ||
    "Documento";
  const metadata: PreparedDocumentMetadata = {
    title: documentTitle,
    fileName,
    relativePath,
    responsibleArea,
    sourceFormat,
    sourceOrigin,
    headings: detectedHeadings,
    wordCount:
      wordCount ??
      (normalizedMarkdown.match(/\S+/g)?.length ?? 0),
    conversionWarnings,
    convertedAt,
    generatedFrontmatter,
  };

  if (!normalizedMarkdown) {
    return {
      documentId: "",
      normalizedMarkdown,
      metadata,
      chunks: [] as PreparedChunk[],
    };
  }

  const documentId = buildDocumentId(normalizedMarkdown);
  const createdAt = new Date().toISOString();
  const sections = splitMarkdownIntoSections(normalizedMarkdown);
  const chunks: PreparedChunk[] = [];

  let chunkIndex = 0;

  for (const section of sections) {
    const sectionChunks = chunkSection(section);
    const headingPathText =
      section.headingPath.length > 0 ? section.headingPath.join(" > ") : "Documento";

    for (const content of sectionChunks) {
      chunks.push({
        id: hashToUuid(`${documentId}:${chunkIndex}`),
        documentId,
        sourceDocumentId: documentId,
        fileName,
        relativePath,
        responsibleArea,
        documentTitle,
        sourceFormat,
        sourceOrigin,
        chunkIndex,
        headingPath: section.headingPath,
        headingPathText,
        content,
        contentPreview: previewText(content),
        contentHash: sha256(content),
        conversionWarningCount: conversionWarnings.length,
        createdAt,
      });
      chunkIndex += 1;
    }
  }

  return {
    documentId,
    normalizedMarkdown,
    metadata,
    chunks,
  };
}

export type SearchMatch = {
  score: number;
  documentId: string;
  sourceDocumentId?: string;
  fileName: string;
  relativePath?: string;
  documentTitle: string;
  sourceFormat: DocumentSourceFormat;
  headingPathText: string;
  content: string;
  contentPreview: string;
  chunkIndex: number;
};

export function buildChatPrompt(question: string, matches: SearchMatch[]) {
  const context = matches
    .map((match, index) => {
      return [
        `[Trecho ${index + 1}]`,
        `Documento: ${match.documentTitle || match.fileName}`,
        `Arquivo: ${match.fileName}`,
        `Formato: ${match.sourceFormat}`,
        `Secao: ${match.headingPathText}`,
        match.content,
      ].join("\n");
    })
    .join("\n\n");

  return [
    "Voce e um assistente de recuperacao documental.",
    "Responda em portugues do Brasil.",
    "Use apenas o contexto recuperado abaixo.",
    "Se a evidencia for insuficiente, diga explicitamente que nao encontrou informacao suficiente no material indexado.",
    "",
    "Contexto recuperado:",
    context || "Nenhum contexto recuperado.",
    "",
    `Pergunta: ${question}`,
    "Resposta:",
  ].join("\n");
}
