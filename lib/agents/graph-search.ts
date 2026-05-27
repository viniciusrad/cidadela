import type { DocumentSourceFormat, SearchMatch } from "@/lib/markdown";
import { prepareMarkdownDocument, previewText } from "@/lib/markdown";
import { prisma } from "@/lib/db/client";
import type { Sector } from "@/lib/domain";
import { checkNeo4jHealth, runQuery } from "@/lib/neo4j";

const MAX_TERMS = 8;
const MAX_GRAPH_DOCUMENTS = 5;
const MAX_MATCHES = 5;

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

type GraphDocumentHit = {
  docId: string;
  title: string;
  sector: string;
  matchedEntities: string[];
  sharedEntities: string[];
};

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
  ).slice(0, MAX_TERMS);
}

function sourceFormat(value: string): DocumentSourceFormat {
  return value === "docx" || value === "doc" || value === "pdf"
    ? value
    : "markdown";
}

function chunkScore(content: string, questionTerms: string[], graphTerms: string[]) {
  const searchable = normalize(content);
  const questionHits = questionTerms.filter((term) => searchable.includes(term));
  const graphHits = graphTerms.filter((term) => searchable.includes(normalize(term)));

  return Math.min(
    0.95,
    0.35 +
      (questionHits.length / Math.max(questionTerms.length, 1)) * 0.35 +
      Math.min(graphHits.length * 0.05, 0.25),
  );
}

export async function searchGraphDocuments(
  sector: Sector,
  question: string,
): Promise<SearchMatch[]> {
  const healthy = await checkNeo4jHealth();
  if (!healthy) {
    return [];
  }

  const terms = extractTerms(question);
  if (terms.length === 0) {
    return [];
  }

  const graphDocuments = await runQuery<GraphDocumentHit>(
    `MATCH (e)
     WHERE e.name IS NOT NULL
       AND any(term IN $terms WHERE toLower(e.name) CONTAINS toLower(term))
     MATCH (d:Document)-[]->(e)
     WHERE d.sector = $sector
     OPTIONAL MATCH (d)-[]->(related)
     WHERE related.name IS NOT NULL
     RETURN DISTINCT
       d.id AS docId,
       d.title AS title,
       d.sector AS sector,
       collect(DISTINCT e.name) AS matchedEntities,
       collect(DISTINCT related.name) AS sharedEntities
     ORDER BY size(collect(DISTINCT e.name)) DESC
     LIMIT $limit`,
    { terms, sector, limit: MAX_GRAPH_DOCUMENTS },
  );

  if (graphDocuments.length === 0) {
    return [];
  }

  const graphByDocId = new Map(
    graphDocuments.map((document) => [document.docId, document]),
  );
  const graphDocIds = graphDocuments.map((document) => document.docId);
  const documents = await prisma.curationDocument.findMany({
    where: {
      sector,
      status: "PROMOTED",
      OR: [
        { documentId: { in: graphDocIds } },
        { sourceDocumentId: { in: graphDocIds } },
      ],
    },
    select: {
      documentId: true,
      sourceDocumentId: true,
      fileName: true,
      relativePath: true,
      documentTitle: true,
      sourceFormat: true,
      normalizedMarkdown: true,
    },
  });

  const matches: SearchMatch[] = [];

  for (const document of documents) {
    const graphHit =
      graphByDocId.get(document.documentId) ??
      graphByDocId.get(document.sourceDocumentId);
    const graphTerms = [
      ...(graphHit?.matchedEntities ?? []),
      ...(graphHit?.sharedEntities ?? []),
    ];
    const prepared = prepareMarkdownDocument({
      fileName: document.fileName,
      markdown: document.normalizedMarkdown,
      relativePath: document.relativePath ?? undefined,
      sourceFormat: sourceFormat(document.sourceFormat),
      title: document.documentTitle,
    });

    const rankedChunks = prepared.chunks
      .map((chunk) => ({
        chunk,
        score: chunkScore(chunk.content, terms, graphTerms),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    for (const ranked of rankedChunks) {
      matches.push({
        score: ranked.score,
        documentId: document.documentId,
        sourceDocumentId: document.sourceDocumentId,
        fileName: document.fileName,
        relativePath: document.relativePath ?? undefined,
        documentTitle: document.documentTitle,
        sourceFormat: sourceFormat(document.sourceFormat),
        headingPathText: `[grafo] ${ranked.chunk.headingPathText}`,
        content: ranked.chunk.content,
        contentPreview: previewText(ranked.chunk.content),
        chunkIndex: ranked.chunk.chunkIndex,
      });
    }
  }

  return matches
    .sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex)
    .slice(0, MAX_MATCHES);
}
