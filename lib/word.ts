import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

import type { DocumentSourceOrigin } from "@/lib/markdown";
import {
  buildFrontmatterRecord,
  countWords,
  extractHeadings,
  normalizeMarkdownBody,
  type ConvertedDocument,
} from "@/lib/document-shared";

type ConvertDocxInput = {
  fileName: string;
  buffer: Buffer;
  sourceOrigin: DocumentSourceOrigin;
};

type ConvertDocInput = {
  fileName: string;
  buffer: Buffer;
  sourceOrigin: DocumentSourceOrigin;
};

export type ConvertedDocxDocument = ConvertedDocument;

function trimBlankEdges(value: string) {
  return value.replace(/^\s+|\s+$/g, "");
}

function normalizeHtmlForMarkdown(html: string) {
  const normalizedTableCells = html.replace(
    /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi,
    (fullMatch, tagName: string, attributes: string, innerHtml: string) => {
      const collapsedInnerHtml = innerHtml
        .replace(/<p[^>]*>/gi, "")
        .replace(/<\/p>/gi, "<br />")
        .replace(/(<br \/>)+$/g, "")
        .trim();

      return `<${tagName}${attributes}>${collapsedInnerHtml || innerHtml.trim()}</${tagName}>`;
    },
  );

  return normalizedTableCells.replace(
    /<table([^>]*)>([\s\S]*?)<\/table>/gi,
    (tableMatch, tableAttributes: string, tableInnerHtml: string) => {
      const normalizedTableInnerHtml = tableInnerHtml.replace(
        /<tr([^>]*)>([\s\S]*?)<\/tr>/i,
        (rowMatch, rowAttributes: string, rowInnerHtml: string) => {
          if (/<th\b/i.test(rowInnerHtml)) {
            return rowMatch;
          }

          const headerRowInnerHtml = rowInnerHtml
            .replace(/<td\b/gi, "<th")
            .replace(/<\/td>/gi, "</th>");

          return `<tr${rowAttributes}>${headerRowInnerHtml}</tr>`;
        },
      );

      return `<table${tableAttributes}>${normalizedTableInnerHtml}</table>`;
    },
  );
}

const GENERIC_TITLES = [
  "sobre",
  "introducao",
  "objetivo",
  "resumo",
  "contexto",
  "historico",
  "finalidade",
];

function extractTitle(fileName: string, markdown: string, headings: string[]) {
  for (const heading of headings) {
    const cleanHeading = heading.replace(/\*/g, "").toLowerCase();
    const isGeneric = GENERIC_TITLES.some(
      (generic) =>
        cleanHeading === generic || cleanHeading.startsWith(`${generic} `)
    );

    if (!isGeneric && heading.length > 3) {
      return heading;
    }
  }

  const firstParagraph = markdown
    .split("\n\n")
    .map((part) => trimBlankEdges(part))
    .find(Boolean);

  if (firstParagraph) {
    const firstLine = firstParagraph.split("\n")[0].trim();
    const cleanLine = firstLine.replace(/\*/g, "").toLowerCase();
    const isGeneric = GENERIC_TITLES.some(
      (generic) => cleanLine === generic || cleanLine.startsWith(`${generic} `)
    );

    if (!isGeneric && firstLine.length > 3) {
      return firstLine.slice(0, 120);
    }
  }

  return fileName.replace(/\.docx$|\.doc$/i, "");
}

function formatMammothWarnings(messages: Array<{ type?: string; message?: string }>) {
  return messages
    .map((entry) => {
      const message = entry.message?.trim();

      if (!message) {
        return "";
      }

      return entry.type ? `${entry.type}: ${message}` : message;
    })
    .filter(Boolean)
    .slice(0, 20);
}

export async function convertDocxToMarkdown({
  fileName,
  buffer,
  sourceOrigin,
}: ConvertDocxInput): Promise<ConvertedDocxDocument> {
  const conversion = await mammoth.convertToHtml(
    { buffer },
    {
      includeDefaultStyleMap: true,
    },
  );

  const turndown = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    headingStyle: "atx",
  });
  turndown.use(gfm);

  const normalizedHtml = normalizeHtmlForMarkdown(conversion.value);
  const markdownBody = normalizeMarkdownBody(turndown.turndown(normalizedHtml));
  const headings = extractHeadings(markdownBody);
  const title = extractTitle(fileName, markdownBody, headings);
  const convertedAt = new Date().toISOString();
  const wordCount = countWords(markdownBody);
  const conversionWarnings = formatMammothWarnings(conversion.messages);
  const frontmatter = buildFrontmatterRecord({
    title,
    source_name: fileName,
    source_format: "docx",
    source_origin: sourceOrigin,
    converted_at: convertedAt,
    word_count: wordCount,
    headings,
  });

  const markdown = markdownBody.startsWith("# ")
    ? markdownBody
    : `# ${title}\n\n${markdownBody}`.trim();

  return {
    markdown,
    title,
    headings,
    wordCount,
    conversionWarnings,
    convertedAt,
    frontmatter,
  };
}

export async function convertDocToMarkdown({
  fileName,
  buffer,
  sourceOrigin,
}: ConvertDocInput): Promise<ConvertedDocxDocument> {
  const extractor = new WordExtractor();
  let doc: Awaited<ReturnType<typeof extractor.extract>>;
  try {
    doc = await extractor.extract(buffer);
  } catch {
    throw new Error(
      "Nao foi possivel extrair o conteudo do arquivo .doc. " +
        "O arquivo pode estar protegido, corrompido ou usar uma variante do formato nao suportada. " +
        "Tente converter para .docx no Word (Arquivo > Salvar Como > .docx).",
    );
  }

  const body = doc.getBody();
  const convertedAt = new Date().toISOString();

  const markdownBody = normalizeMarkdownBody(body);
  const headings = extractHeadings(markdownBody);
  const title =
    headings[0] ||
    markdownBody.split("\n")[0].trim().slice(0, 120) ||
    fileName.replace(/\.doc$/i, "").trim() ||
    "Documento";
  const wordCount = countWords(markdownBody);

  const frontmatter = buildFrontmatterRecord({
    title,
    source_name: fileName,
    source_format: "doc",
    source_origin: sourceOrigin,
    converted_at: convertedAt,
    word_count: wordCount,
    headings,
  });

  const markdown = `# ${title}\n\n${markdownBody}`.trim();

  return {
    markdown,
    title,
    headings,
    wordCount,
    conversionWarnings: [],
    convertedAt,
    frontmatter,
  };
}
