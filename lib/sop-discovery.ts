import { readdir, readFile, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { appConfig } from "@/lib/config";
import { classifyDocument } from "@/lib/document-classifier";
import {
  documentTypeLabel,
  sourceTypeForDocumentType,
  type DocumentType,
} from "@/lib/document-types";
import type { Sector } from "@/lib/domain";
import { generateJson, getEmbedding } from "@/lib/ollama";
import type { AdminChunkRow } from "@/lib/qdrant";
import { listSectorChunks, semanticSearchSectorChunks } from "@/lib/qdrant";

const DISCOVERY_QUERIES = [
  "como realizar procedimento passo a passo processo",
  "documentacao conhecimento referencia politica norma faq tecnico",
  "informacoes sobre mesmo assunto atualizar consolidar base conhecimento",
  "configurar instalar implantar sistema etapas",
  "tratamento de erro resolucao problema incidente",
  "fluxo de trabalho etapas responsaveis aprovacao",
  "duvidas frequentes orientacoes comunicado relatorio diagnostico",
  "quando aplicar quem deve executar periodicidade",
];

export type ExistingSop = {
  fileName: string;
  fullPath: string;
  documentType?: DocumentType;
  sopId?: string;
  title?: string;
  generatedAt?: string;
  sourceDocumentIds: string[];
};

export type SourceDocRef = {
  sourceDocumentId: string;
  documentTitle: string;
  chunkCount: number;
};

export type SopSuggestionChunk = {
  chunkIndex: number;
  headingPathText: string;
  content: string;
  contentPreview: string;
  sourceDocumentId: string;
  documentTitle: string;
};

export type SopSuggestion = {
  id: string;
  topic: string;
  documentType: DocumentType;
  documentTypeLabel: string;
  sourceDocuments: SourceDocRef[];
  totalChunkCount: number;
  contentSummary: string;
  automationPotential: "high" | "medium" | "low";
  existingSopMatch?: ExistingSop;
  topChunks: SopSuggestionChunk[];
};

export type GeneratedSop = {
  sopPath: string;
  title: string;
  replaced: boolean;
  previousSopPath?: string;
  sourceDocumentCount: number;
};

export type SopDraft = GeneratedSop & {
  markdown: string;
  previousSopContent?: string;
};

export async function listExistingSops(sector: Sector): Promise<ExistingSop[]> {
  const sectorDir = path.resolve(appConfig.sopOutputDir, sector);

  try {
    const files = await readdir(sectorDir);

    return await Promise.all(
      files
        .filter((f) => f.endsWith(".md"))
        .map(async (fileName) => {
          const fullPath = path.join(sectorDir, fileName);
          try {
            const content = await readFile(fullPath, "utf8");
            const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
            const sopId = frontmatter.match(/sop_id:\s*(.+)/)?.[1]?.trim();
            const title = content.match(/^# (.+)/m)?.[1]?.trim();
            const generatedAt = frontmatter.match(/generated_at:\s*(.+)/)?.[1]?.trim();
            const sourceDocumentIds = frontmatter
              .match(/source_document_ids?:\s*(.+)/g)
              ?.flatMap((line) => line.replace(/source_document_ids?:\s*/, "").split(",").map((s) => s.trim()))
              .filter(Boolean) ?? [];

            return { fileName, fullPath, sopId, title, generatedAt, sourceDocumentIds };
          } catch {
            return { fileName, fullPath, sourceDocumentIds: [] };
          }
        }),
    );
  } catch {
    return [];
  }
}

async function listMarkdownArtifacts(dir: string, documentType: DocumentType): Promise<ExistingSop[]> {
  try {
    const files = await readdir(dir);

    return await Promise.all(
      files
        .filter((f) => f.endsWith(".md"))
        .map(async (fileName) => {
          const fullPath = path.join(dir, fileName);
          try {
            const content = await readFile(fullPath, "utf8");
            const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
            const sopId = frontmatter.match(/(?:sop_id|curated_id):\s*(.+)/)?.[1]?.trim();
            const title = content.match(/^# (.+)/m)?.[1]?.trim();
            const generatedAt = frontmatter.match(/generated_at:\s*(.+)/)?.[1]?.trim();
            const sourceDocumentIds = frontmatter
              .match(/source_document_ids?:\s*(.+)/g)
              ?.flatMap((line) => line.replace(/source_document_ids?:\s*/, "").split(",").map((s) => s.trim()))
              .filter(Boolean) ?? [];

            return { fileName, fullPath, documentType, sopId, title, generatedAt, sourceDocumentIds };
          } catch {
            return { fileName, fullPath, documentType, sourceDocumentIds: [] };
          }
        }),
    );
  } catch {
    return [];
  }
}

export async function listExistingKnowledgeArtifacts(sector: Sector): Promise<ExistingSop[]> {
  const sopArtifacts = await listExistingSops(sector);
  const curatedRoot = path.resolve(appConfig.sopOutputDir, "..", "curated", sector);

  const curatedTypes: DocumentType[] = [
    "norma",
    "ata",
    "doc_tecnica",
    "faq",
    "comunicado",
    "relatorio",
    "contrato",
    "generico",
  ];

  const curatedArtifacts = await Promise.all(
    curatedTypes.map((type) => listMarkdownArtifacts(path.join(curatedRoot, type), type)),
  );

  return [
    ...sopArtifacts.map((artifact) => ({ ...artifact, documentType: "sop" as const })),
    ...curatedArtifacts.flat(),
  ];
}

function detectAutomationPotential(content: string): "high" | "medium" | "low" {
  const lower = content.toLowerCase();
  const highSignals = ["automati", "webhook", "api ", "trigger", "agend", "script", "bot ", "robô", "robo", "integra"];
  const mediumSignals = ["quando", "sempre que", "diariamente", "semanalmente", "todo dia", "cada vez", "periodicament", "recorrent"];

  const high = highSignals.filter((s) => lower.includes(s)).length;
  const medium = mediumSignals.filter((s) => lower.includes(s)).length;

  if (high >= 2) return "high";
  if (high >= 1 || medium >= 3) return "medium";
  return "low";
}

function findExistingSopMatch(
  topic: string,
  existingSops: ExistingSop[],
  documentType?: DocumentType,
): ExistingSop | undefined {
  const words = topic.toLowerCase().split(/\s+/).filter((w) => w.length > 4);

  for (const sop of existingSops) {
    if (documentType && sop.documentType && sop.documentType !== documentType) continue;
    if (!sop.title) continue;
    const sopWords = sop.title.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    const overlap = words.filter((w) => sopWords.includes(w)).length;
    if (overlap >= 2 || (words.length <= 2 && overlap >= 1)) return sop;
  }

  return undefined;
}

type DocGroup = {
  sourceDocumentId: string;
  documentTitle: string;
  topic: string;
  chunks: AdminChunkRow[];
  contentSummary: string;
  automationPotential: "high" | "medium" | "low";
};

type ClusterItem = {
  unifiedTopic: string;
  documentIds: string[];
};

async function clusterDocGroups(groups: DocGroup[]): Promise<ClusterItem[]> {
  if (groups.length <= 1) {
    return groups.map((g) => ({ unifiedTopic: g.topic, documentIds: [g.sourceDocumentId] }));
  }

  const input = groups.map((g) => ({
    id: g.sourceDocumentId.slice(0, 20),
    topic: g.topic,
    title: g.documentTitle,
  }));

  try {
    type ClusterResponse = { clusters: ClusterItem[] };

    const result = await generateJson<ClusterResponse>(
      `Analise a lista de documentos abaixo e agrupe os que tratam do MESMO assunto, processo ou referencia operacional.\nDocumentos sobre o mesmo assunto devem compor UM único cluster — independente de serem arquivos diferentes.\n\nResponda em JSON: {"clusters":[{"unifiedTopic":"nome unificado do assunto ou artefato","documentIds":["id_parcial_1","id_parcial_2"]}]}\n\nDocumentos:\n${JSON.stringify(input)}\n\nResponda SOMENTE com JSON válido em português.`,
      { temperature: 0 },
    );

    if (Array.isArray(result.clusters) && result.clusters.length > 0) {
      // Mapear ids parciais de volta para ids completos
      const idMap = new Map(groups.map((g) => [g.sourceDocumentId.slice(0, 20), g.sourceDocumentId]));

      return result.clusters.map((cluster) => ({
        unifiedTopic: cluster.unifiedTopic,
        documentIds: cluster.documentIds
          .map((partialId) => idMap.get(partialId) ?? partialId)
          .filter((id) => groups.some((g) => g.sourceDocumentId === id)),
      })).filter((c) => c.documentIds.length > 0);
    }
  } catch {
    // fallback: cada documento é seu próprio cluster
  }

  return groups.map((g) => ({ unifiedTopic: g.topic, documentIds: [g.sourceDocumentId] }));
}

export async function discoverSopSuggestions(sector: Sector): Promise<SopSuggestion[]> {
  const vectorResults = await Promise.all(
    DISCOVERY_QUERIES.map(async (query) => {
      const vector = await getEmbedding(query);
      const { rows } = await semanticSearchSectorChunks(sector, vector, { limit: 15 });
      return rows;
    }),
  );

  const seenIds = new Set<string | number>();
  const allChunks: AdminChunkRow[] = [];

  for (const rows of vectorResults) {
    for (const row of rows) {
      if (!seenIds.has(row.id)) {
        seenIds.add(row.id);
        allChunks.push(row);
      }
    }
  }

  const byDoc = new Map<string, AdminChunkRow[]>();
  for (const chunk of allChunks) {
    const key = chunk.sourceDocumentId ?? chunk.documentId;
    if (!byDoc.has(key)) byDoc.set(key, []);
    byDoc.get(key)!.push(chunk);
  }

  if (byDoc.size === 0) return [];

  // Fase 1: extrair tópico por documento
  const docGroups: DocGroup[] = await Promise.all(
    Array.from(byDoc.entries()).map(async ([sourceDocId, chunks]) => {
      const sorted = chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      const representative = sorted[0];
      const sampleText = sorted
        .slice(0, 5)
        .map((c) => c.contentPreview || c.content.slice(0, 200))
        .join("\n\n");

      let topic = representative.documentTitle;

      try {
        const result = await generateJson<{ title: string }>(
          `Analise os trechos e responda em JSON com:\n- "title": título curto do procedimento (máximo 8 palavras, em português)\n\nTrechos:\n${sampleText}\n\nResponda SOMENTE com JSON válido.`,
          { temperature: 0 },
        );
        if (result.title?.trim()) topic = result.title.trim();
      } catch {
        // manter título original
      }

      return {
        sourceDocumentId: sourceDocId,
        documentTitle: representative.documentTitle,
        topic,
        chunks: sorted,
        contentSummary: sampleText.slice(0, 400),
        automationPotential: detectAutomationPotential(chunks.map((c) => c.content).join(" ")),
      };
    }),
  );

  // Fase 2: agrupar documentos por tópico unificado
  const clusters = await clusterDocGroups(docGroups);

  const existingArtifacts = await listExistingKnowledgeArtifacts(sector);
  const suggestions: SopSuggestion[] = [];

  for (const cluster of clusters) {
    const clusterGroups = cluster.documentIds
      .map((id) => docGroups.find((g) => g.sourceDocumentId === id))
      .filter((g): g is DocGroup => Boolean(g));

    if (clusterGroups.length === 0) continue;

    const allChunksInCluster = clusterGroups.flatMap((g) => g.chunks);
    const totalContent = allChunksInCluster.map((c) => c.content).join(" ");

    // Todos os chunks do cluster, agrupados por documento e ordenados por índice
    const topChunks: SopSuggestionChunk[] = clusterGroups.flatMap((g) =>
      g.chunks.map((c) => ({
        chunkIndex: c.chunkIndex,
        headingPathText: c.headingPathText,
        content: c.content,
        contentPreview: c.contentPreview,
        sourceDocumentId: g.sourceDocumentId,
        documentTitle: g.documentTitle,
      })),
    );

    const contentSummary = clusterGroups
      .map((g) => g.contentSummary)
      .join("\n\n")
      .slice(0, 500);

    const automationPotential = detectAutomationPotential(totalContent);
    const classification = classifyDocument({
      fileName: `${cluster.unifiedTopic}.md`,
      markdown: allChunksInCluster.map((c) => c.content).join("\n\n"),
      frontmatter: { title: cluster.unifiedTopic },
    });

    const id = `disc-${cluster.documentIds.map((id) => id.slice(0, 8)).join("-")}`;

    suggestions.push({
      id,
      topic: cluster.unifiedTopic,
      documentType: classification.documentType,
      documentTypeLabel: documentTypeLabel(classification.documentType),
      sourceDocuments: clusterGroups.map((g) => ({
        sourceDocumentId: g.sourceDocumentId,
        documentTitle: g.documentTitle,
        chunkCount: g.chunks.length,
      })),
      totalChunkCount: allChunksInCluster.length,
      contentSummary,
      automationPotential,
      existingSopMatch: findExistingSopMatch(
        cluster.unifiedTopic,
        existingArtifacts,
        classification.documentType,
      ),
      topChunks,
    });
  }

  return suggestions.sort((a, b) => b.totalChunkCount - a.totalChunkCount);
}

function assertSectorSopPath(sector: Sector, sopPath: string) {
  const allowedDirs = [
    path.resolve(appConfig.sopOutputDir, sector),
    path.resolve(appConfig.sopOutputDir, "..", "curated", sector),
  ];
  const resolvedPath = path.resolve(sopPath);
  const isAllowed = allowedDirs.some((dir) => {
    const relativePath = path.relative(dir, resolvedPath);
    return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
  });

  if (!isAllowed) {
    throw new Error("Caminho de artefato fora do diretorio do setor.");
  }

  return resolvedPath;
}

function titleFromMarkdown(markdown: string, fallback: string) {
  return markdown.match(/^# (.+)$/m)?.[1]?.trim() || fallback;
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);
}

function artifactPathForSuggestion(sector: Sector, suggestion: SopSuggestion) {
  const fileId = `disc-${Date.now()}-${sanitizeFilePart(suggestion.topic)}`;

  if (suggestion.documentType === "sop") {
    return path.join(path.resolve(appConfig.sopOutputDir, sector), `${fileId}.md`);
  }

  return path.join(
    path.resolve(appConfig.sopOutputDir, "..", "curated", sector, suggestion.documentType),
    `${fileId}.md`,
  );
}

function renderKnowledgeMarkdown(input: {
  sector: Sector;
  suggestion: SopSuggestion;
  filePath: string;
  diskMatch?: ExistingSop;
  data: {
    title: string;
    summary: string;
    keyInformation: Array<{ topic: string; details: string }>;
    processSteps?: string[];
  };
}) {
  const { sector, suggestion, filePath, diskMatch, data } = input;
  const generatedAt = new Date().toISOString();
  const sourceDocIds = suggestion.sourceDocuments.map((d) => d.sourceDocumentId).join(", ");
  const sourceDocRefs = suggestion.sourceDocuments
    .map((d) => `- ${d.documentTitle} (${d.sourceDocumentId})`)
    .join("\n");

  const keyInfo = data.keyInformation
    .map((info) => `### ${info.topic}\n${info.details}`)
    .join("\n\n");

  const processSection =
    data.processSteps && data.processSteps.length > 0
      ? ["## Processo / Passo a passo", ...data.processSteps.map((s, i) => `${i + 1}. ${s}`), ""].join(
          "\n",
        )
      : "";

  return [
    "---",
    `curated_id: ${path.basename(filePath, ".md")}`,
    `document_type: ${suggestion.documentType}`,
    `source_type: ${sourceTypeForDocumentType(suggestion.documentType)}`,
    `sector: ${sector}`,
    `owner: null`,
    `topic: ${suggestion.topic}`,
    `authority_level: consolidated`,
    `effective_from: ${generatedAt.slice(0, 10)}`,
    `supersedes: ${diskMatch?.sopId ?? "null"}`,
    `sensitivity: internal`,
    `generated_at: ${generatedAt}`,
    "generator_version: 3",
    "generated_by: knowledge-discovery-agent",
    `source_document_ids: ${sourceDocIds}`,
    `automation_potential: ${suggestion.automationPotential}`,
    "---",
    "",
    `# ${data.title}`,
    "",
    "## 1. Objetivo / Resumo",
    data.summary,
    "",
    processSection,
    "## 2. Informacoes principais",
    keyInfo,
    "",
    "## 3. Referencias",
    sourceDocRefs,
    "",
    "## 4. Historico",
    "| Versao | Data | Mudanca | Aprovado por |",
    "| --- | --- | --- | --- |",
    diskMatch
      ? `| 2 | ${generatedAt.slice(0, 10)} | Documento consolidado e substituido por descoberta multi-documento | Sistema |`
      : `| 1 | ${generatedAt.slice(0, 10)} | Documento consolidado por descoberta de base de conhecimento | Sistema |`,
    "",
  ].join("\n");
}

type DocExtract = {
  documentTitle: string;
  context: string;
  steps: string[];
  prerequisites: string[];
  outputs: string;
  errors: string;
};

async function extractFromSingleDocument(
  docTitle: string,
  chunks: AdminChunkRow[],
): Promise<DocExtract> {
  const text = chunks
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .map((c) => (c.headingPathText ? `[${c.headingPathText}]\n${c.content}` : c.content))
    .join("\n\n");

  // Cada documento é processado individualmente com um input gerenciável para o modelo local.
  // Markdown de imagens e separadores visuais são removidos para não poluir a extração.
  const cleaned = text
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/!\[.*?\]/g, "")
    .replace(/\*\s*\*\s*\*/g, "")
    .trim();

  const SINGLE_DOC_LIMIT = 6_000;
  const input = cleaned.length > SINGLE_DOC_LIMIT ? cleaned.slice(0, SINGLE_DOC_LIMIT) : cleaned;

  try {
    type ExtractShape = Omit<DocExtract, "documentTitle">;
    const result = await generateJson<ExtractShape>(
      `Documento: "${docTitle}"\n\nExtraia APENAS informações presentes neste documento. Responda em JSON:\n{\n  "context": "uma frase descrevendo o assunto deste documento",\n  "steps": ["passo exato 1 extraído do documento", "passo exato 2"] (lista vazia [] se não há procedimento),\n  "prerequisites": ["pré-requisito ou acesso necessário 1"] (lista vazia [] se não mencionado),\n  "outputs": "o que é produzido ou gerado (string vazia se não mencionado)",\n  "errors": "erros, exceções ou tratamentos descritos (string vazia se não há)"\n}\n\nConteúdo do documento:\n${input}\n\nJSON válido apenas, em português:`,
      { temperature: 0 },
    );
    return { documentTitle: docTitle, ...result };
  } catch {
    return {
      documentTitle: docTitle,
      context: docTitle,
      steps: [],
      prerequisites: [],
      outputs: "",
      errors: "",
    };
  }
}

export async function previewSopFromSuggestion(
  sector: Sector,
  suggestion: SopSuggestion,
): Promise<SopDraft> {
  await mkdir(path.resolve(appConfig.sopOutputDir, sector), { recursive: true });

  const existingArtifacts = await listExistingKnowledgeArtifacts(sector);
  const diskMatch = findExistingSopMatch(
    suggestion.topic,
    existingArtifacts,
    suggestion.documentType,
  );

  const replaced = Boolean(diskMatch);
  const previousSopPath = diskMatch?.fullPath;
  const previousSopContent = previousSopPath
    ? await readFile(previousSopPath, "utf8").catch(() => undefined)
    : undefined;

  const filePath = diskMatch?.fullPath ?? artifactPathForSuggestion(sector, suggestion);

  // Passo 1 — busca todos os chunks de cada documento-fonte em ordem real.
  const allDocChunks = await Promise.all(
    suggestion.sourceDocuments.map(async (doc) => {
      const { rows } = await listSectorChunks(sector, {
        sourceDocumentId: doc.sourceDocumentId,
        limit: 200,
      });
      const sorted = rows.sort((a, b) => a.chunkIndex - b.chunkIndex);
      return { doc, chunks: sorted };
    }),
  );

  // Passo 2 — extração individual por documento.
  // O modelo local processa um documento de cada vez, mantendo o input dentro do contexto suportado.
  const docExtracts = await Promise.all(
    allDocChunks.map(({ doc, chunks }) =>
      extractFromSingleDocument(doc.documentTitle, chunks),
    ),
  );

  // Passo 3 — monta o input consolidado para a geração final do SOP/artefato.
  // Cada documento contribui apenas com seu resumo estruturado, não com o texto bruto.
  const consolidatedInput = docExtracts
    .map((e) => {
      const parts = [`=== ${e.documentTitle} ===`, `Contexto: ${e.context}`];
      if (e.steps.length > 0)
        parts.push(`Passos:\n${e.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
      if (e.prerequisites.length > 0)
        parts.push(`Pré-requisitos:\n${e.prerequisites.map((p) => `- ${p}`).join("\n")}`);
      if (e.outputs) parts.push(`Saída: ${e.outputs}`);
      if (e.errors) parts.push(`Erros/Exceções: ${e.errors}`);
      return parts.join("\n");
    })
    .join("\n\n");

  const docList = suggestion.sourceDocuments.map((d) => d.documentTitle).join(", ");

  if (suggestion.documentType !== "sop") {
    type KnowledgeData = {
      title: string;
      summary: string;
      keyInformation: Array<{ topic: string; details: string }>;
      processSteps: string[];
    };

    let extractedKnowledge: KnowledgeData = {
      title: suggestion.topic,
      summary: suggestion.contentSummary,
      keyInformation: [],
      processSteps: [],
    };

    try {
      const result = await generateJson<KnowledgeData>(
        `Você é um especialista em gestão de conhecimento. Com base nas informações extraídas de ${suggestion.sourceDocuments.length} documento(s) abaixo, consolide em JSON:\n{\n  "title": "título claro e profissional",\n  "summary": "descrição completa e executiva do assunto — inclua todos os detalhes relevantes",\n  "keyInformation": [{"topic": "assunto específico", "details": "todos os detalhes sobre este assunto"}],\n  "processSteps": ["passo 1 detalhado", "passo 2 detalhado"] (inclua APENAS se houver passos descritos)\n}\n\nDocumentos (${suggestion.sourceDocuments.length} no total — ${docList}):\n${consolidatedInput}\n\nResponda SOMENTE com JSON válido em português.`,
        { temperature: 0.1 },
      );
      if (result.title && result.summary) {
        extractedKnowledge = result;
      }
    } catch {
      // fallback
    }

    const markdown = renderKnowledgeMarkdown({
      sector,
      suggestion,
      filePath,
      diskMatch,
      data: extractedKnowledge,
    });

    return {
      sopPath: filePath,
      title: extractedKnowledge.title,
      replaced,
      previousSopPath: replaced ? previousSopPath : undefined,
      sourceDocumentCount: suggestion.sourceDocuments.length,
      markdown,
      previousSopContent,
    };
  }

  type SopData = {
    title: string;
    objective: string;
    when: string;
    who: string;
    inputs: string[];
    steps: string[];
    outputs: string;
    errors: string;
  };

  let extracted: SopData = {
    title: suggestion.topic,
    objective: "",
    when: "",
    who: "",
    inputs: [],
    steps: [],
    outputs: "",
    errors: "",
  };

  try {
    const result = await generateJson<SopData>(
      `Você é um especialista em processos operacionais. Com base nas informações extraídas de ${suggestion.sourceDocuments.length} documento(s) abaixo, produza um SOP COMPLETO e DETALHADO.\n\nREGRAS OBRIGATÓRIAS:\n- Use APENAS informações reais extraídas — NUNCA invente ou use texto genérico.\n- "steps" deve conter TODOS os passos reais com detalhes técnicos específicos (nomes de transações SAP, campos, menus, valores esperados, variações por projeto/cliente).\n- Cada passo deve ser autoexplicativo — quem lê o SOP pode executar sem consultar os originais.\n- Consolide sem perder detalhes; se houver variações por projeto/cliente, documente-as explicitamente.\n\nResponda APENAS com JSON válido:\n{\n  "title": "Título profissional e específico do processo",\n  "objective": "Descrição completa do que o processo faz, para que serve e qual problema resolve",\n  "when": "Gatilhos e condições precisas que iniciam este processo",\n  "who": "Quem executa, quem aprova, quais acessos/sistemas são necessários",\n  "inputs": ["Pré-requisito ou dado necessário 1", "Pré-requisito 2"],\n  "steps": [\n    "Passo 1: ação específica com todos os detalhes técnicos",\n    "Passo 2: próxima ação com o que verificar, onde clicar, o que preencher"\n  ],\n  "outputs": "O que é produzido ao final: arquivos, registros, notificações, estados",\n  "errors": "Erros conhecidos: sintoma, causa provável e ação corretiva específica"\n}\n\nDocumentos (${suggestion.sourceDocuments.length} no total — ${docList}):\n${consolidatedInput}\n\nResponda SOMENTE com JSON válido em português.`,
      { temperature: 0.1 },
    );

    if (result.title && Array.isArray(result.steps) && result.steps.length > 0) {
      extracted = result;
    }
  } catch {
    // usar campos vazios com mensagem honesta
  }

  const generatedAt = new Date().toISOString();

  const procedure =
    extracted.steps.length > 0
      ? extracted.steps.map((step, i) => `${i + 1}. ${step}`).join("\n")
      : "_Não foi possível extrair os passos automaticamente. Consulte os documentos de referência abaixo._";

  const prerequisitesList =
    extracted.inputs.length > 0
      ? extracted.inputs.map((item) => `- ${item}`).join("\n")
      : "_Verificar pré-requisitos nos documentos de referência._";

  const sourceDocIds = suggestion.sourceDocuments.map((d) => d.sourceDocumentId).join(", ");
  const sourceDocRefs = suggestion.sourceDocuments
    .map((d) => `- ${d.documentTitle} (${d.sourceDocumentId})`)
    .join("\n");

  const markdown = [
    "---",
    `sop_id: ${path.basename(filePath, ".md")}`,
    `sector: ${sector}`,
    `owner: null`,
    `effective_from: ${generatedAt.slice(0, 10)}`,
    `supersedes: ${diskMatch?.sopId ?? "null"}`,
    `sensitivity: internal`,
    `generated_at: ${generatedAt}`,
    "generator_version: 3",
    "generated_by: sop-discovery-agent",
    `source_document_ids: ${sourceDocIds}`,
    `automation_potential: ${suggestion.automationPotential}`,
    "---",
    "",
    `# ${extracted.title || suggestion.topic}`,
    "",
    "## 1. Objetivo",
    extracted.objective || "_Consultar documentos de referência para descrição do objetivo._",
    "",
    "## 2. Quando aplicar",
    extracted.when || "_Consultar documentos de referência para gatilhos de execução._",
    "",
    "## 3. Responsaveis",
    extracted.who || "- Executor: Responsável pelo setor\n- Aprovador: Gestor do setor",
    "",
    "## 4. Pre-requisitos",
    prerequisitesList,
    "",
    "## 5. Procedimento",
    procedure,
    "",
    "## 6. Saidas e evidencias",
    extracted.outputs || "_Consultar documentos de referência para evidências esperadas._",
    "",
    "## 7. Excecoes e tratamento de erro",
    extracted.errors || "_Escalar para o gestor do setor em caso de dúvida ou bloqueio._",
    "",
    "## 8. Referencias",
    sourceDocRefs,
    "",
    "## 9. Historico",
    "| Versao | Data | Mudanca | Aprovado por |",
    "| --- | --- | --- | --- |",
    replaced
      ? `| 2 | ${generatedAt.slice(0, 10)} | SOP consolidado e substituído por descoberta multi-documento | Sistema |`
      : `| 1 | ${generatedAt.slice(0, 10)} | SOP gerado por descoberta de base de conhecimento | Sistema |`,
    "",
  ].join("\n");

  return {
    sopPath: filePath,
    title: extracted.title || suggestion.topic,
    replaced,
    previousSopPath: replaced ? previousSopPath : undefined,
    sourceDocumentCount: suggestion.sourceDocuments.length,
    markdown,
    previousSopContent,
  };
}

export async function saveSopDraft(
  sector: Sector,
  input: {
    sopPath: string;
    markdown: string;
    previousSopPath?: string;
    sourceDocumentCount: number;
    fallbackTitle: string;
  },
): Promise<GeneratedSop> {
  const filePath = assertSectorSopPath(sector, input.sopPath);
  await mkdir(path.dirname(filePath), { recursive: true });

  await writeFile(filePath, input.markdown, "utf8");

  return {
    sopPath: filePath,
    title: titleFromMarkdown(input.markdown, input.fallbackTitle),
    replaced: Boolean(input.previousSopPath),
    previousSopPath: input.previousSopPath,
    sourceDocumentCount: input.sourceDocumentCount,
  };
}
