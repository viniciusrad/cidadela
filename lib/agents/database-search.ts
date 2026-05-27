import type { DocumentSourceFormat, SearchMatch } from "@/lib/markdown";
import { prepareMarkdownDocument, previewText } from "@/lib/markdown";
import { prisma } from "@/lib/db/client";
import type { Sector } from "@/lib/domain";

const MAX_DOCUMENTS_TO_SCAN = 100;
const MAX_MATCHES = 5;
const MIN_DATABASE_SCORE = 0.3;

const STOPWORDS = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "os",
  "para",
  "por",
  "que",
  "qual",
  "quais",
  "sobre",
  "um",
  "uma",
]);

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractTerms(question: string) {
  return Array.from(
    new Set(
      normalize(question)
        .split(/[^a-z0-9]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3 && !STOPWORDS.has(term)),
    ),
  );
}

function extractTechnicalTerms(question: string) {
  return Array.from(
    new Set(
      question.match(/\b[a-zA-Z]{1,8}\d{2,}[a-zA-Z0-9]*\b/g)?.map(normalize) ??
        [],
    ),
  );
}

function sourceFormat(value: string): DocumentSourceFormat {
  return value === "docx" || value === "doc" || value === "pdf"
    ? value
    : "markdown";
}

function scoreText(input: {
  searchableText: string;
  titleText: string;
  terms: string[];
  technicalTerms: string[];
}) {
  if (input.terms.length === 0) {
    return 0;
  }

  const termHits = input.terms.filter((term) =>
    input.searchableText.includes(term),
  );
  const technicalHits = input.technicalTerms.filter((term) =>
    input.searchableText.includes(term),
  );

  if (input.technicalTerms.length > 0 && technicalHits.length === 0) {
    return 0;
  }

  if (termHits.length === 0) {
    return 0;
  }

  const titleHits = input.terms.filter((term) => input.titleText.includes(term));
  const termRatio = termHits.length / input.terms.length;
  const titleBoost = Math.min(titleHits.length * 0.05, 0.15);
  const technicalBoost = technicalHits.length > 0 ? 0.12 : 0;

  return Math.min(0.95, 0.25 + termRatio * 0.55 + titleBoost + technicalBoost);
}

export async function searchDatabaseDocuments(
  sector: Sector,
  question: string,
): Promise<SearchMatch[]> {
  const terms = extractTerms(question);
  const technicalTerms = extractTechnicalTerms(question);

  if (terms.length === 0) {
    return [];
  }

  const documents = await prisma.curationDocument.findMany({
    where: {
      sector,
      status: "PROMOTED",
    },
    select: {
      documentId: true,
      sourceDocumentId: true,
      fileName: true,
      relativePath: true,
      documentTitle: true,
      sourceFormat: true,
      normalizedMarkdown: true,
      promotedAt: true,
      uploadedAt: true,
    },
    orderBy: [{ promotedAt: "desc" }, { uploadedAt: "desc" }],
    take: MAX_DOCUMENTS_TO_SCAN,
  });

  const matches: SearchMatch[] = [];

  for (const document of documents) {
    const titleText = normalize(
      `${document.documentTitle} ${document.fileName} ${document.sourceDocumentId}`,
    );
    const prepared = prepareMarkdownDocument({
      fileName: document.fileName,
      markdown: document.normalizedMarkdown,
      relativePath: document.relativePath ?? undefined,
      sourceFormat: sourceFormat(document.sourceFormat),
      title: document.documentTitle,
    });

    for (const chunk of prepared.chunks) {
      const searchableText = normalize(
        [
          document.documentTitle,
          document.fileName,
          document.sourceDocumentId,
          chunk.headingPathText,
          chunk.content,
        ].join("\n"),
      );
      const score = scoreText({
        searchableText,
        titleText,
        terms,
        technicalTerms,
      });

      if (score < MIN_DATABASE_SCORE) {
        continue;
      }

      matches.push({
        score,
        documentId: document.documentId,
        sourceDocumentId: document.sourceDocumentId,
        fileName: document.fileName,
        relativePath: document.relativePath ?? undefined,
        documentTitle: document.documentTitle,
        sourceFormat: sourceFormat(document.sourceFormat),
        headingPathText: chunk.headingPathText,
        content: chunk.content,
        contentPreview: previewText(chunk.content),
        chunkIndex: chunk.chunkIndex,
      });
    }
  }

  return matches
    .sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex)
    .slice(0, MAX_MATCHES);
}
