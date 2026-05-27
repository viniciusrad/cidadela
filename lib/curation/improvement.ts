import type { CurationDocument } from "@prisma/client";

import { previewText } from "@/lib/markdown";
import { generateAnswerStream, getEmbedding } from "@/lib/ollama";
import { listStagedDocumentChunks, semanticSearchSectorChunks } from "@/lib/qdrant";
import { listAllSectorSlugs } from "@/lib/sectors/sector-repo";

export type ImprovementSource = {
  sector: string;
  documentId: string;
  documentTitle: string;
  fileName: string;
  headingPathText: string;
  chunkIndex: number;
  score: number;
  content: string;
  contentPreview: string;
};

export const MIN_SOURCE_SCORE = 0.6;
export const AUTO_SELECT_SCORE = 0.75;

function buildImprovementPrompt({
  documentTitle,
  sector,
  stagingMarkdown,
  sources,
}: {
  documentTitle: string;
  sector: string;
  stagingMarkdown: string;
  sources: ImprovementSource[];
}): string {
  const sourceBlocks =
    sources.length > 0
      ? sources
          .map((s, i) =>
            [
              `[Ref ${i + 1}] Setor: ${s.sector} | Documento: ${s.documentTitle} | Secao: ${s.headingPathText} | Similaridade: ${Math.round(s.score * 100)}%`,
              s.contentPreview,
            ].join("\n"),
          )
          .join("\n\n---\n\n")
      : "Nenhum conteudo de referencia foi selecionado para este documento.";

  return [
    "Voce e um especialista em gestao do conhecimento corporativo.",
    "Sua tarefa: produzir uma versao enriquecida do documento em staging a seguir.",
    "Use o conhecimento de referencia para complementar, corrigir ou aprofundar o conteudo existente.",
    "",
    "Regras:",
    "- Mantenha a estrutura Markdown original: cabecalhos, listas e escopo.",
    "- Integre o conhecimento de referencia de forma organica, como parte natural do documento.",
    "- Nao cite fontes no texto final. O documento deve fluir como se fosse escrito por um unico especialista.",
    "- Reforce e complemente o conteudo existente a partir das referencias, sem copiar textos literalmente.",
    "- Corrija contradicoes com o conteudo de referencia priorizando sempre o conhecimento validado em producao.",
    "- Se nenhuma referencia for pertinente a um trecho especifico, mantenha o original sem alteracao.",
    "- Nao invente informacoes. Use apenas o que esta presente nos trechos de referencia.",
    "- Responda APENAS com o documento Markdown melhorado. Nenhum texto fora do documento.",
    "",
    `Documento: ${documentTitle}`,
    `Setor principal: ${sector}`,
    "",
    "=== DOCUMENTO ORIGINAL EM STAGING ===",
    stagingMarkdown.trim(),
    "",
    "=== TRECHOS DE REFERENCIA SELECIONADOS PELO CURADOR ===",
    sourceBlocks,
    "",
    "=== DOCUMENTO MELHORADO ===",
  ].join("\n");
}

export async function searchImprovementSources(
  document: CurationDocument,
  limitPerSector: number,
): Promise<ImprovementSource[]> {
  const stagedChunks = await listStagedDocumentChunks(
    document.sector,
    document.sourceDocumentId,
  );

  const sources: ImprovementSource[] = [];
  const seen = new Set<string>();
  const sectors = await listAllSectorSlugs();

  for (const targetSector of sectors) {
    const sectorSources: ImprovementSource[] = [];

    for (const staged of stagedChunks) {
      const vector = await getEmbedding(staged.content);
      const { rows } = await semanticSearchSectorChunks(targetSector, vector, {
        limit: limitPerSector * 2,
      });

      for (const row of rows) {
        const score = row.score ?? 0;
        if (score < MIN_SOURCE_SCORE) continue;
        const uid = `${row.documentId}:${row.chunkIndex}`;
        if (seen.has(uid)) continue;
        seen.add(uid);
        const rawContent = row.content || row.contentPreview;
        sectorSources.push({
          sector: targetSector,
          documentId: row.documentId,
          documentTitle: row.documentTitle,
          fileName: row.fileName,
          headingPathText: row.headingPathText,
          chunkIndex: row.chunkIndex,
          score: Number(score.toFixed(4)),
          content: rawContent,
          contentPreview: previewText(rawContent),
        });
      }
    }

    sectorSources.sort((a, b) => b.score - a.score);
    sources.push(...sectorSources.slice(0, limitPerSector));
  }

  return sources;
}

export async function generateDocumentImprovement(
  document: CurationDocument,
  selectedSources: ImprovementSource[],
): Promise<AsyncGenerator<{ chunk: string }>> {
  const prompt = buildImprovementPrompt({
    documentTitle: document.documentTitle,
    sector: document.sector,
    stagingMarkdown: document.normalizedMarkdown,
    sources: selectedSources,
  });

  return generateAnswerStream(prompt);
}
