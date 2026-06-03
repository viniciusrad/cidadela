import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { DocumentStatus, Sector } from "@prisma/client";

import { classifyDocument } from "@/lib/document-classifier";
import { applyQuestionDefaults } from "@/lib/curation/question-defaults";
import { recomputeReadiness, statusForReadiness, toJsonInput } from "@/lib/curation/documents";
import { inferAdditionalQuestions } from "@/lib/curation/inference";
import { createAuditEvent } from "@/lib/db/audit-repo";
import { prisma } from "@/lib/db/client";
import { documentTypeLabel, normalizeDocumentType, sourceTypeForDocumentType, type DocumentType } from "@/lib/document-types";
import { prepareMarkdownDocument, previewText } from "@/lib/markdown";
import { generateJson, getEmbedding } from "@/lib/ollama";
import {
  listSectorChunks,
  listStagedDocumentChunks,
  semanticSearchChunksAcrossSources,
  replaceStagedSourceDocumentChunks,
  type AdminChunkRow,
} from "@/lib/qdrant";

export type ConsolidationSectorFilter = string | "all";
export type ConsolidationSourceScope = "promoted" | "staging" | "both";
export type ConsolidationArtifactType = "sop" | "ddp";

export type ConsolidationDocumentRef = {
  curationDocumentId?: string;
  sourceDocumentId: string;
  documentId: string;
  title: string;
  sector: string;
  status: "promoted" | "staging";
  documentType?: string;
  source: "promoted" | "staging";
};

export type ConsolidationEvidenceChunk = {
  sourceDocumentId: string;
  documentTitle: string;
  sector: string;
  status: "promoted" | "staging";
  source: "promoted" | "staging";
  headingPathText: string;
  chunkIndex: number;
  excerpt: string;
  score: number;
};

export type ExistingArtifactMatch = {
  curationDocumentId: string;
  sourceDocumentId: string;
  title: string;
  documentType: DocumentType;
  sector: string;
  sopPath: string | null;
  markdown?: string;
};

export type ConsolidationCandidate = {
  id: string;
  processName: string;
  confidence: number;
  processSummary: string;
  processObjective: string;
  processContext: string;
  identifiedTriggers: string[];
  sectorRefs: string[];
  documentRefs: ConsolidationDocumentRef[];
  evidenceChunks: ConsolidationEvidenceChunk[];
  identifiedActors: string[];
  identifiedSystems: string[];
  identifiedInputs: string[];
  identifiedOutputs: string[];
  identifiedRules: string[];
  identifiedExceptions: string[];
  identifiedSteps: string[];
  identifiedHandoffs: string[];
  artifactRecommendations: ConsolidationArtifactType[];
  existingArtifactMatches: Partial<Record<ConsolidationArtifactType, ExistingArtifactMatch>>;
  gaps: string[];
  pendingQuestions: string[];
};

export type ConsolidationPreview = {
  artifactType: ConsolidationArtifactType;
  title: string;
  markdown: string;
  existingArtifact?: ExistingArtifactMatch;
};

export type ConsolidationClarificationQuestion = {
  id: string;
  label: string;
  prompt: string;
  placeholder: string;
  required: boolean;
};

export type ConsolidationPreviewRequirement = {
  artifactType: ConsolidationArtifactType;
  title: string;
  requiresClarification: true;
  message: string;
  clarificationQuestions: ConsolidationClarificationQuestion[];
};

export type ConsolidationPreviewResult =
  | ConsolidationPreview
  | ConsolidationPreviewRequirement;

type PreviewSynthesis = {
  processSummary?: string;
  processObjective?: string;
  processContext?: string;
  triggers?: string[];
  actors?: string[];
  systems?: string[];
  inputs?: string[];
  outputs?: string[];
  rules?: string[];
  exceptions?: string[];
  steps?: string[];
  handoffs?: string[];
  pendingQuestions?: string[];
};

type ClarificationAnswers = Partial<Record<string, string>>;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!value?.trim()) continue;
    const trimmed = value.trim();
    const key = normalizeText(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function parseListAnswer(value?: string) {
  if (!value?.trim()) return [];
  return unique(
    value
      .split("\n")
      .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
      .filter(Boolean),
  );
}

function slugify(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function clampStatus(status: DocumentStatus) {
  return status === "READY_FOR_APPROVAL" || status === "APPROVED" || status === "PROMOTED"
    ? "IN_REVIEW"
    : status;
}

function extractList(content: string, patterns: RegExp[]) {
  const items: string[] = [];
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (patterns.some((pattern) => pattern.test(line))) {
      items.push(line.replace(/^[-*\d.\s]+/, "").trim());
    }
  }

  return items;
}

function inferProcessName(row: AdminChunkRow) {
  const heading = row.headingPathText && row.headingPathText !== "Documento" ? row.headingPathText.split(" > ").at(-1) : "";
  const raw = row.documentTitle || heading || row.fileName;
  return raw.replace(/\.(md|docx|doc|pdf)$/i, "").trim();
}

function scoreTokenOverlap(a: string, b: string) {
  const aTokens = new Set(normalizeText(a).split(" ").filter((token) => token.length >= 4));
  const bTokens = new Set(normalizeText(b).split(" ").filter((token) => token.length >= 4));
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  return overlap;
}

async function findExistingArtifactMatches(processName: string, sectorFilter: ConsolidationSectorFilter) {
  if (!prisma.curationDocument) {
    return {} as Partial<Record<ConsolidationArtifactType, ExistingArtifactMatch>>;
  }

  const docs = await prisma.curationDocument.findMany({
    where: {
      status: "PROMOTED",
      documentType: { in: ["sop", "ddp"] },
      ...(sectorFilter === "all" ? {} : { sector: sectorFilter }),
    },
    select: {
      id: true,
      sourceDocumentId: true,
      documentTitle: true,
      documentType: true,
      sector: true,
      sopPath: true,
      topic: true,
    },
    take: 100,
  });

  const matches: Partial<Record<ConsolidationArtifactType, ExistingArtifactMatch>> = {};

  for (const doc of docs) {
    const overlap = Math.max(
      scoreTokenOverlap(processName, doc.documentTitle),
      scoreTokenOverlap(processName, doc.topic ?? ""),
    );
    if (overlap < 2 && normalizeText(processName) !== normalizeText(doc.documentTitle)) {
      continue;
    }

    const documentType = normalizeDocumentType(doc.documentType);
    if (documentType !== "sop" && documentType !== "ddp") {
      continue;
    }

    if (!matches[documentType]) {
      matches[documentType] = {
        curationDocumentId: doc.id,
        sourceDocumentId: doc.sourceDocumentId,
        title: doc.documentTitle,
        documentType,
        sector: doc.sector,
        sopPath: doc.sopPath,
      };
    }
  }

  return matches;
}

function buildRecommendations(input: {
  steps: string[];
  inputs: string[];
  outputs: string[];
  actors: string[];
  rules: string[];
}): ConsolidationArtifactType[] {
  const recommendations: ConsolidationArtifactType[] = [];

  if (input.steps.length >= 3 && (input.inputs.length > 0 || input.outputs.length > 0)) {
    recommendations.push("sop");
  }

  if (
    input.actors.length > 0 ||
    input.rules.length > 0 ||
    input.inputs.length > 0 ||
    input.outputs.length > 0
  ) {
    recommendations.push("ddp");
  }

  return recommendations.length > 0 ? recommendations : ["ddp"];
}

function buildGaps(candidate: Omit<ConsolidationCandidate, "gaps" | "existingArtifactMatches" | "confidence" | "id">) {
  const gaps: string[] = [];
  if (candidate.identifiedSteps.length < 3) gaps.push("Faltam passos operacionais suficientes para um SOP completo.");
  if (candidate.identifiedActors.length === 0) gaps.push("Atores ou responsaveis nao ficaram claros nas evidencias.");
  if (candidate.identifiedInputs.length === 0) gaps.push("Entradas/pre-requisitos nao foram identificados com clareza.");
  if (candidate.identifiedOutputs.length === 0) gaps.push("Saidas/evidencias finais ainda nao estao explicitas.");
  if (candidate.identifiedRules.length === 0) gaps.push("Regras e restricoes do processo precisam de curadoria.");
  if (!candidate.processObjective.trim()) gaps.push("Objetivo e descricao fundamentada do processo ainda precisam de consolidacao.");
  return gaps;
}

function gapsFromSignals(input: {
  steps: string[];
  actors: string[];
  systems: string[];
  inputs: string[];
  outputs: string[];
  rules: string[];
  exceptions: string[];
  handoffs: string[];
}) {
  return [
    ...(input.steps.length === 0 ? ["Qual e a sequencia operacional completa do processo?"] : []),
    ...(input.actors.length === 0 ? ["Quem executa, aprova e recebe o handoff deste processo?"] : []),
    ...(input.systems.length === 0 ? ["Quais sistemas, portais ou dependencias suportam o processo?"] : []),
    ...(input.inputs.length === 0 ? ["Quais entradas, pre-requisitos ou documentos iniciam o fluxo?"] : []),
    ...(input.outputs.length === 0 ? ["Quais saidas, evidencias ou entregaveis confirmam a conclusao?"] : []),
    ...(input.rules.length === 0 ? ["Quais regras, validacoes e restricoes operacionais devem constar?"] : []),
    ...(input.exceptions.length === 0 ? ["Quais excecoes, erros e contingencias precisam ser descritos?"] : []),
    ...(input.handoffs.length === 0 ? ["Quais handoffs entre areas, papeis ou sistemas acontecem no fluxo?"] : []),
  ];
}

export async function discoverConsolidationCandidates(input: {
  query: string;
  sector: ConsolidationSectorFilter;
  sourceScope: ConsolidationSourceScope;
}) {
  const SCORE_THRESHOLD = 0.45;

  const vector = await getEmbedding(input.query.trim());
  const { rows } = await semanticSearchChunksAcrossSources({
    vector,
    sector: input.sector,
    sourceScope: input.sourceScope,
    limit: 60,
    scoreThreshold: SCORE_THRESHOLD,
  });

  const filtered = rows.filter((row) => (row.score ?? 0) >= SCORE_THRESHOLD);
  if (filtered.length === 0) {
    return [];
  }

  const grouped = new Map<string, AdminChunkRow[]>();

  for (const row of filtered) {
    const processName = inferProcessName(row);
    const existingKey = Array.from(grouped.keys()).find((key) => {
      const overlap = scoreTokenOverlap(processName, key);
      return overlap >= 2 || normalizeText(processName) === normalizeText(key);
    });
    const groupKey = existingKey ?? processName;
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey)!.push(row);
  }

  const candidates: ConsolidationCandidate[] = [];

  for (const [processName, cluster] of grouped.entries()) {
    const byDoc = new Map<string, ConsolidationDocumentRef>();
    const allContent = cluster.map((row) => row.content).join("\n\n");
    const actors = unique(extractList(allContent, [/\bator\b/i, /\brespons[aá]vel\b/i, /\bexecuta\b/i, /\baprov/i]));
    const systems = unique(extractList(allContent, [/\bsistema\b/i, /\bportal\b/i, /\bsap\b/i, /\bapi\b/i, /\btransac/i]));
    const inputs = unique(extractList(allContent, [/\bentrada\b/i, /\bpre-?requisito\b/i, /\binsumo\b/i]));
    const outputs = unique(extractList(allContent, [/\bsaida\b/i, /\bevidencia\b/i, /\bresultado\b/i]));
    const rules = unique(extractList(allContent, [/\bregra\b/i, /\bpolitica\b/i, /\bobrig/i, /\brestric/i]));
    const exceptions = unique(extractList(allContent, [/\bexce(c|ç)(a|ã)o/i, /\berro\b/i, /\bfalha\b/i]));
    const steps = unique(
      allContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^(\d+\.|-\s|passo\s+\d+)/i.test(line)),
    );

    for (const row of cluster) {
      const sourceDocumentId = row.sourceDocumentId ?? row.documentId;
      const key = `${row.sector}:${sourceDocumentId}:${row.source ?? "promoted"}`;
      if (!byDoc.has(key)) {
        byDoc.set(key, {
          sourceDocumentId,
          documentId: row.documentId,
          title: row.documentTitle,
          sector: row.sector,
          status: row.source === "staging" ? "staging" : "promoted",
          documentType: row.documentType,
          source: row.source === "staging" ? "staging" : "promoted",
        });
      }
    }

    const docRefs = Array.from(byDoc.values());
    const recommendations = buildRecommendations({
      steps,
      inputs,
      outputs,
      actors,
      rules,
    });
    const processSummary = previewText(allContent).slice(0, 280);
    const processObjective = "";
    const processContext = "";
    const triggers: string[] = [];
    const handoffs: string[] = [];
    const pendingQuestions = unique(gapsFromSignals({
      steps,
      actors,
      systems,
      inputs,
      outputs,
      rules,
      exceptions,
      handoffs,
    }));

    const baseCandidate = {
      processName,
      processSummary,
      processObjective,
      processContext,
      identifiedTriggers: triggers,
      sectorRefs: unique(docRefs.map((doc) => doc.sector)),
      documentRefs: docRefs,
      evidenceChunks: cluster
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 12)
        .map((row) => {
          const evidenceSource: "promoted" | "staging" =
            row.source === "staging" ? "staging" : "promoted";
          return {
            sourceDocumentId: row.sourceDocumentId ?? row.documentId,
            documentTitle: row.documentTitle,
            sector: row.sector,
            status: evidenceSource,
            source: evidenceSource,
            headingPathText: row.headingPathText,
            chunkIndex: row.chunkIndex,
            excerpt: row.contentPreview || previewText(row.content),
            score: Number((row.score ?? 0).toFixed(3)),
          };
        }),
      identifiedActors: actors,
      identifiedSystems: systems,
      identifiedInputs: inputs,
      identifiedOutputs: outputs,
      identifiedRules: rules,
      identifiedExceptions: exceptions,
      identifiedSteps: steps,
      identifiedHandoffs: handoffs,
      artifactRecommendations: recommendations,
      pendingQuestions,
    };

    const existingArtifactMatches = await findExistingArtifactMatches(processName, input.sector);
    const gaps = buildGaps(baseCandidate);

    const avgScore = cluster.reduce((sum, row) => sum + (row.score ?? 0), 0) / cluster.length;
    const confidence = Number(
      Math.min(
        0.98,
        avgScore * 0.65 + docRefs.length * 0.06 + cluster.length * 0.015,
      ).toFixed(2),
    );

    candidates.push({
      id: createHash("sha256").update(`${processName}:${docRefs.map((doc) => `${doc.sector}:${doc.sourceDocumentId}`).join("|")}`).digest("hex").slice(0, 16),
      confidence,
      ...baseCandidate,
      existingArtifactMatches,
      gaps,
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

async function readArtifactMarkdown(match?: ExistingArtifactMatch) {
  if (!match?.sopPath) return undefined;
  try {
    return await readFile(match.sopPath, "utf8");
  } catch {
    return undefined;
  }
}

async function loadCandidateEvidenceText(candidate: ConsolidationCandidate) {
  const documents = await Promise.all(
    candidate.documentRefs.map(async (doc) => {
      const rows =
        doc.source === "staging"
          ? await listStagedDocumentChunks(doc.sector, doc.sourceDocumentId)
          : (await listSectorChunks(doc.sector, {
              sourceDocumentId: doc.sourceDocumentId,
              limit: 200,
            })).rows;

      const ordered = rows
        .slice()
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map((row) => row.content)
        .join("\n\n")
        .trim();

      return [
        `Documento: ${doc.title}`,
        `Setor: ${doc.sector}`,
        `Origem: ${doc.source}`,
        ordered,
      ].join("\n");
    }),
  );

  return documents.filter(Boolean).join("\n\n").slice(0, 16000);
}

async function synthesizePreview(candidate: ConsolidationCandidate) {
  const evidenceText = await loadCandidateEvidenceText(candidate);
  if (!evidenceText.trim()) {
    return null;
  }

  try {
    return await generateJson<PreviewSynthesis>(
      `Consolide o processo "${candidate.processName}" usando apenas o material abaixo. Preencha o maximo possivel com evidencias fundamentadas; quando faltar evidencia, retorne string vazia ou lista vazia.\n\nResponda em JSON:\n{\n  "processSummary": "resumo executivo do processo",\n  "processObjective": "descricao do processo e do resultado esperado",\n  "processContext": "contexto e quando o processo ocorre",\n  "triggers": ["gatilho"],\n  "actors": ["ator ou papel"],\n  "systems": ["sistema"],\n  "inputs": ["entrada ou prerequisito"],\n  "outputs": ["saida ou evidencia"],\n  "rules": ["regra ou validacao"],\n  "exceptions": ["erro, excecao ou contingencia"],\n  "steps": ["passo a passo identificado"],\n  "handoffs": ["handoff ou dependencia"],\n  "pendingQuestions": ["pergunta de curadoria apenas se realmente faltar informacao"]\n}\n\nMaterial:\n${evidenceText}\n\nJSON valido apenas.`,
      { temperature: 0.1 },
    );
  } catch {
    return null;
  }
}

function deriveSopClarificationQuestions(
  candidate: ConsolidationCandidate,
  synthesis?: PreviewSynthesis | null,
) {
  const stepItems = unique(synthesis?.steps ?? candidate.identifiedSteps);
  const actors = unique(synthesis?.actors ?? candidate.identifiedActors);
  const inputs = unique(synthesis?.inputs ?? candidate.identifiedInputs);
  const outputs = unique(synthesis?.outputs ?? candidate.identifiedOutputs);
  const rules = unique(synthesis?.rules ?? candidate.identifiedRules);
  const exceptions = unique(synthesis?.exceptions ?? candidate.identifiedExceptions);

  const questions: ConsolidationClarificationQuestion[] = [];

  if (stepItems.length < 3) {
    questions.push({
      id: "procedure_steps",
      label: "Passo a passo",
      prompt: "Descreva a sequencia operacional completa do processo em ordem, um passo por linha.",
      placeholder: "1. Receber a solicitacao\n2. Validar os dados\n3. Executar no sistema\n4. Registrar a evidencia final",
      required: true,
    });
  }

  if (inputs.length === 0) {
    questions.push({
      id: "required_inputs",
      label: "Entradas e pre-requisitos",
      prompt: "Quais entradas, documentos, acessos ou pre-requisitos sao necessarios antes de iniciar o SOP?",
      placeholder: "- Solicitacao aprovada\n- Cadastro do cliente\n- Acesso ao portal interno",
      required: true,
    });
  }

  if (outputs.length === 0) {
    questions.push({
      id: "expected_outputs",
      label: "Saidas e evidencias",
      prompt: "Quais saidas, comprovantes ou evidencias confirmam que o processo foi concluido com sucesso?",
      placeholder: "- Protocolo gerado\n- Registro salvo no sistema\n- Evidencia anexada",
      required: true,
    });
  }

  if (rules.length === 0) {
    questions.push({
      id: "operational_rules",
      label: "Regras e validacoes",
      prompt: "Quais regras, validacoes ou restricoes precisam ser obedecidas durante a execucao?",
      placeholder: "- Validar aprovacao antes de prosseguir\n- Nao seguir sem anexo obrigatorio",
      required: true,
    });
  }

  if (exceptions.length === 0) {
    questions.push({
      id: "error_handling",
      label: "Erros e excecoes",
      prompt: "Quais excecoes, falhas ou desvios precisam de tratamento no SOP?",
      placeholder: "- Se o sistema estiver indisponivel, abrir chamado\n- Se houver divergencia de dados, devolver ao solicitante",
      required: false,
    });
  }

  if (actors.length === 0) {
    questions.push({
      id: "responsible_roles",
      label: "Responsaveis",
      prompt: "Quem executa, revisa, aprova ou recebe o handoff desse procedimento?",
      placeholder: "- Analista de suporte\n- Supervisor\n- Financeiro",
      required: false,
    });
  }

  return questions;
}

function mergeClarificationsIntoSynthesis(
  candidate: ConsolidationCandidate,
  synthesis: PreviewSynthesis | null | undefined,
  answers: ClarificationAnswers,
) {
  const merged: PreviewSynthesis = {
    ...synthesis,
    actors: unique([...(synthesis?.actors ?? candidate.identifiedActors), ...parseListAnswer(answers.responsible_roles)]),
    inputs: unique([...(synthesis?.inputs ?? candidate.identifiedInputs), ...parseListAnswer(answers.required_inputs)]),
    outputs: unique([...(synthesis?.outputs ?? candidate.identifiedOutputs), ...parseListAnswer(answers.expected_outputs)]),
    rules: unique([...(synthesis?.rules ?? candidate.identifiedRules), ...parseListAnswer(answers.operational_rules)]),
    exceptions: unique([...(synthesis?.exceptions ?? candidate.identifiedExceptions), ...parseListAnswer(answers.error_handling)]),
    steps: unique([...(synthesis?.steps ?? candidate.identifiedSteps), ...parseListAnswer(answers.procedure_steps)]),
  };

  if (!merged.processContext?.trim() && answers.procedure_steps?.trim()) {
    merged.processContext = "Fluxo operacional complementado por curadoria antes da geracao da previa do SOP.";
  }

  return merged;
}

function renderPreviewMarkdown(
  candidate: ConsolidationCandidate,
  artifactType: ConsolidationArtifactType,
  synthesis?: PreviewSynthesis | null,
) {
  const generatedAt = new Date().toISOString();
  const sourceDocs = candidate.documentRefs
    .map((doc) => `- ${doc.title} | setor=${doc.sector} | origem=${doc.source} | sourceDocumentId=${doc.sourceDocumentId}`)
    .join("\n");
  const lineage = candidate.documentRefs.map((doc) => `${doc.sector}:${doc.sourceDocumentId}`).join(", ");
  const summary = synthesis?.processSummary?.trim() || previewText(candidate.evidenceChunks.map((chunk) => chunk.excerpt).join(" "));
  const objective = synthesis?.processObjective?.trim() || `Consolidar a descricao operacional do processo ${candidate.processName}.`;
  const context = synthesis?.processContext?.trim() || candidate.gaps[0] || "";
  const triggers = unique(synthesis?.triggers ?? candidate.identifiedRules).slice(0, 8);
  const actors = unique(synthesis?.actors ?? candidate.identifiedActors);
  const systems = unique(synthesis?.systems ?? candidate.identifiedSystems);
  const inputs = unique(synthesis?.inputs ?? candidate.identifiedInputs);
  const outputs = unique(synthesis?.outputs ?? candidate.identifiedOutputs);
  const rules = unique(synthesis?.rules ?? candidate.identifiedRules);
  const exceptions = unique(synthesis?.exceptions ?? candidate.identifiedExceptions);
  const handoffs = unique(synthesis?.handoffs ?? []);
  const pendingQuestions = unique(synthesis?.pendingQuestions ?? candidate.gaps);
  const stepItems = unique(synthesis?.steps ?? candidate.identifiedSteps);
  const steps = stepItems.length > 0
    ? stepItems.map((step, index) => `${index + 1}. ${step.replace(/^(\d+\.|-\s)/, "").trim()}`).join("\n")
    : "_Curadoria necessaria para detalhar a sequencia operacional._";

  if (artifactType === "sop") {
    return [
      "---",
      `document_type: sop`,
      `source_type: ${sourceTypeForDocumentType("sop")}`,
      "classification_source: script",
      "authority_level: draft",
      `generated_at: ${generatedAt}`,
      `lineage_source_documents: ${lineage}`,
      "---",
      "",
      `# SOP - ${candidate.processName}`,
      "",
      "## 1. Objetivo",
      objective,
      "",
      "## 2. Quando aplicar",
      triggers.length > 0 ? triggers.map((item) => `- ${item}`).join("\n") : "Validar com a curadoria os gatilhos exatos do processo.",
      "",
      "## 3. Responsaveis",
      actors.length > 0 ? actors.map((item) => `- ${item}`).join("\n") : "- Curadoria pendente",
      "",
      "## 4. Pre-requisitos e entradas",
      inputs.length > 0 ? inputs.map((item) => `- ${item}`).join("\n") : "- Curadoria pendente",
      "",
      "## 5. Procedimento",
      steps,
      "",
      "## 6. Saidas e evidencias",
      outputs.length > 0 ? outputs.map((item) => `- ${item}`).join("\n") : "- Curadoria pendente",
      "",
      "## 7. Excecoes e tratamento de erro",
      exceptions.length > 0 ? exceptions.map((item) => `- ${item}`).join("\n") : "- Curadoria pendente",
      "",
      "## 8. Sistemas relacionados",
      systems.length > 0 ? systems.map((item) => `- ${item}`).join("\n") : "- Nao identificado",
      "",
      "## 9. Fundamentacao consolidada",
      summary,
      "",
      "## 10. Lineage e referencias",
      sourceDocs,
      "",
    ].join("\n");
  }

  return [
    "---",
    `document_type: ddp`,
    `source_type: ${sourceTypeForDocumentType("ddp")}`,
    "classification_source: script",
    "authority_level: draft",
    `generated_at: ${generatedAt}`,
    `lineage_source_documents: ${lineage}`,
    "---",
    "",
    `# DDP - ${candidate.processName}`,
    "",
    "## 1. Objetivo do processo",
    objective,
    "",
    "## 2. Gatilhos e contexto",
    [context, triggers.length > 0 ? triggers.map((item) => `- ${item}`).join("\n") : ""].filter(Boolean).join("\n\n") || "- Curadoria pendente",
    "",
    "## 3. Atores",
    actors.length > 0 ? actors.map((item) => `- ${item}`).join("\n") : "- Curadoria pendente",
    "",
    "## 4. Sistemas e dependencias",
    systems.length > 0 ? systems.map((item) => `- ${item}`).join("\n") : "- Curadoria pendente",
    "",
    "## 5. Entradas",
    inputs.length > 0 ? inputs.map((item) => `- ${item}`).join("\n") : "- Curadoria pendente",
    "",
    "## 6. Saidas",
    outputs.length > 0 ? outputs.map((item) => `- ${item}`).join("\n") : "- Curadoria pendente",
    "",
    "## 7. Regras e restricoes",
    rules.length > 0 ? rules.map((item) => `- ${item}`).join("\n") : "- Curadoria pendente",
    "",
    "## 8. Excecoes",
    exceptions.length > 0 ? exceptions.map((item) => `- ${item}`).join("\n") : "- Curadoria pendente",
    "",
    "## 9. Fluxo consolidado",
    steps,
    "",
    "## 10. Handoffs e dependencias",
    handoffs.length > 0 ? handoffs.map((item) => `- ${item}`).join("\n") : "- Curadoria pendente",
    "",
    "## 11. Fundamentacao consolidada",
    summary,
    "",
    "## 12. Perguntas pendentes de curadoria",
    pendingQuestions.length > 0 ? pendingQuestions.map((item) => `- ${item}`).join("\n") : "- Nenhuma pergunta adicional identificada.",
    "",
    "## 13. Lineage e referencias",
    sourceDocs,
    "",
  ].join("\n");
}

export type PreviewProgressEvent = { percent: number; label: string };

export async function previewConsolidationArtifact(input: {
  candidate: ConsolidationCandidate;
  artifactType: ConsolidationArtifactType;
  clarificationAnswers?: ClarificationAnswers;
  onProgress?: (event: PreviewProgressEvent) => void;
}) {
  const { onProgress } = input;
  const existingArtifact = input.candidate.existingArtifactMatches[input.artifactType];

  onProgress?.({ percent: 15, label: "Carregando evidencias do processo" });
  const evidenceText = await loadCandidateEvidenceText(input.candidate);

  onProgress?.({ percent: 45, label: "Sintetizando com inteligencia artificial" });
  let synthesis: PreviewSynthesis | null = null;
  if (evidenceText.trim()) {
    try {
      synthesis = await generateJson<PreviewSynthesis>(
        `Consolide o processo "${input.candidate.processName}" usando apenas o material abaixo. Preencha o maximo possivel com evidencias fundamentadas; quando faltar evidencia, retorne string vazia ou lista vazia.\n\nResponda em JSON:\n{\n  "processSummary": "resumo executivo do processo",\n  "processObjective": "descricao do processo e do resultado esperado",\n  "processContext": "contexto e quando o processo ocorre",\n  "triggers": ["gatilho"],\n  "actors": ["ator ou papel"],\n  "systems": ["sistema"],\n  "inputs": ["entrada ou prerequisito"],\n  "outputs": ["saida ou evidencia"],\n  "rules": ["regra ou validacao"],\n  "exceptions": ["erro, excecao ou contingencia"],\n  "steps": ["passo a passo identificado"],\n  "handoffs": ["handoff ou dependencia"],\n  "pendingQuestions": ["pergunta de curadoria apenas se realmente faltar informacao"]\n}\n\nMaterial:\n${evidenceText}\n\nJSON valido apenas.`,
        { temperature: 0.1 },
      );
    } catch {
      synthesis = null;
    }
  }

  if (input.artifactType === "sop") {
    const clarificationQuestions = deriveSopClarificationQuestions(input.candidate, synthesis);
    const unansweredRequiredQuestions = clarificationQuestions.filter(
      (question) => question.required && !input.clarificationAnswers?.[question.id]?.trim(),
    );

    if (unansweredRequiredQuestions.length > 0) {
      return {
        artifactType: input.artifactType,
        title: `${documentTypeLabel(input.artifactType)} - ${input.candidate.processName}`,
        requiresClarification: true,
        message:
          "Ainda faltam informacoes operacionais para estruturar o SOP. Responda os pontos abaixo antes de gerar a previa.",
        clarificationQuestions,
      } satisfies ConsolidationPreviewRequirement;
    }
  }

  onProgress?.({ percent: 90, label: "Montando o documento" });
  const enrichedSynthesis = mergeClarificationsIntoSynthesis(
    input.candidate,
    synthesis,
    input.clarificationAnswers ?? {},
  );
  const markdown = renderPreviewMarkdown(input.candidate, input.artifactType, enrichedSynthesis);
  return {
    artifactType: input.artifactType,
    title: `${documentTypeLabel(input.artifactType)} - ${input.candidate.processName}`,
    markdown,
    existingArtifact: existingArtifact
      ? {
          ...existingArtifact,
          markdown: await readArtifactMarkdown(existingArtifact),
        }
      : undefined,
  } satisfies ConsolidationPreview;
}

export async function createConsolidationDraft(input: {
  actor: { id: string; sector: Sector };
  sector: Sector;
  candidate: ConsolidationCandidate;
  artifactType: ConsolidationArtifactType;
  title?: string;
  markdown: string;
}) {
  if (!prisma.curationDocument || !prisma.documentReview) {
    throw new Error("Prisma Client sem modelos de curadoria disponiveis.");
  }

  const resolvedTitle =
    input.title?.trim() ||
    `${documentTypeLabel(input.artifactType)} - ${input.candidate.processName}`;
  const prepared = prepareMarkdownDocument({
    fileName: `${slugify(input.candidate.processName)}-${input.artifactType}.md`,
    markdown: input.markdown,
    relativePath: `.generated/consolidation/${slugify(input.candidate.processName)}-${input.artifactType}.md`,
    responsibleArea: input.sector,
    sourceFormat: "markdown",
    sourceOrigin: "upload",
    title: resolvedTitle,
  });
  const existingMatch = input.candidate.existingArtifactMatches[input.artifactType];
  const sourceDocumentId =
    existingMatch?.sourceDocumentId ??
    `consolidation-${input.artifactType}-${slugify(input.candidate.processName)}`;
  const documentType = input.artifactType;
  const classification = classifyDocument({
    fileName: `${sourceDocumentId}.md`,
    markdown: input.markdown,
    frontmatter: {
      title: prepared.metadata.title,
      topic: input.candidate.processName,
      sensitivity: "internal",
    },
  });
  const metadata = {
    title: prepared.metadata.title,
    sector: input.sector,
    owner: undefined,
    sensitivity: "internal" as const,
    topic: input.candidate.processName,
  };
  const readinessInput = recomputeReadiness({
    documentType,
    metadata,
    markdown: input.markdown,
    questions: [],
  });
  const questionsWithDefaults = applyQuestionDefaults(readinessInput.questions, {
    sector: input.sector,
    title: prepared.metadata.title,
    documentType,
  });
  const inferredQuestions = await inferAdditionalQuestions({
    documentType,
    sector: input.sector,
    title: prepared.metadata.title,
    markdown: input.markdown,
    existingQuestions: questionsWithDefaults,
  });
  const allQuestions = [...questionsWithDefaults, ...inferredQuestions];
  const status = clampStatus(statusForReadiness(readinessInput.readiness.score));
  const knowledgeExtraction = {
    documentType,
    authorityLevel: "draft",
    summary: previewText(input.markdown).slice(0, 300),
    processName: input.candidate.processName,
    actors: input.candidate.identifiedActors,
    systems: input.candidate.identifiedSystems,
    inputs: input.candidate.identifiedInputs,
    outputs: input.candidate.identifiedOutputs,
    rules: input.candidate.identifiedRules,
    exceptions: input.candidate.identifiedExceptions,
    processSteps: input.candidate.identifiedSteps,
    sourceLineage: input.candidate.documentRefs.map((doc) => ({
      sector: doc.sector,
      sourceDocumentId: doc.sourceDocumentId,
      documentId: doc.documentId,
      status: doc.status,
      source: doc.source,
    })),
    automationCandidates: [],
    openQuestions: readinessInput.readiness.missing,
  };

  const chunksWithVectors = await Promise.all(
    prepared.chunks.map(async (chunk) => ({
      ...chunk,
      sourceDocumentId,
      sensitivity: "internal",
      topic: input.candidate.processName,
      owner: undefined,
      documentType,
      authorityLevel: "draft",
      sourceType: sourceTypeForDocumentType(documentType),
      vector: await getEmbedding(chunk.content),
    })),
  );

  // Primary lookup: follow the tracked curationDocumentId from the artifact match.
  // Fallback: query by (documentId, sector) unique constraint to catch cases where
  // the same artifact was submitted before but existingMatch wasn't populated
  // (e.g. a second submission without a page reload), which would otherwise
  // cause a unique-constraint violation on create.
  const existingDocument =
    existingMatch?.curationDocumentId
      ? await prisma.curationDocument.findUnique({
          where: { id: existingMatch.curationDocumentId },
        })
      : await prisma.curationDocument.findUnique({
          where: {
            documentId_sector: {
              documentId: prepared.documentId,
              sector: input.sector,
            },
          },
        });

  const baseData = {
    documentId: prepared.documentId,
    sourceDocumentId,
    fileName: `${sourceDocumentId}.md`,
    relativePath: `.generated/consolidation/${sourceDocumentId}.md`,
    documentTitle: prepared.metadata.title,
    sourceFormat: "markdown",
    sector: input.sector,
    uploadedById: input.actor.id,
    uploadedAt: new Date(),
    contentHash: prepared.documentId,
    fileSizeBytes: Buffer.byteLength(input.markdown, "utf8"),
    normalizedMarkdown: input.markdown,
    effectiveFrom: null,
    supersedes: existingMatch?.sourceDocumentId ?? null,
    owner: null,
    sensitivity: "internal",
    topic: input.candidate.processName,
    documentType,
    classificationSource: "script",
    classificationConfidence: classification.confidence,
    authorityLevel: "draft",
    curationReadinessScore: readinessInput.readiness.score,
    curationProfile: toJsonInput({
      documentType,
      missing: readinessInput.readiness.missing,
      source: "consolidation",
    }),
    knowledgeExtraction: toJsonInput(knowledgeExtraction),
    status,
    sopReadinessScore: readinessInput.readiness.score,
    promotedAt: existingDocument?.promotedAt ?? null,
    sopPath: existingDocument?.sopPath ?? null,
    rejectedAt: null,
    rejectionReason: null,
  };

  const document = existingDocument
    ? await prisma.curationDocument.update({
        where: { id: existingDocument.id },
        data: baseData,
      })
    : await prisma.curationDocument.create({
        data: baseData,
      });

  await prisma.documentApproval.deleteMany({
    where: { curationDocumentId: document.id },
  });
  await prisma.documentCorrelationRun.deleteMany({
    where: { curationDocumentId: document.id },
  });
  await prisma.documentReview.create({
    data: {
      curationDocumentId: document.id,
      reviewedById: input.actor.id,
      actorType: "agent",
      questions: toJsonInput(allQuestions),
      notes: `Rascunho de consolidacao ${documentType.toUpperCase()} gerado a partir de busca guiada. Lineage: ${input.candidate.documentRefs.map((doc) => `${doc.sector}:${doc.sourceDocumentId}`).join(", ")}`,
    },
  });

  await replaceStagedSourceDocumentChunks(input.sector, sourceDocumentId, chunksWithVectors);

  await createAuditEvent({
    traceId: randomUUID(),
    actorType: "user",
    actorId: input.actor.id,
    targetType: "document",
    targetId: document.documentId,
    eventType: "document.consolidation_draft_created",
    payload: {
      curationDocumentId: document.id,
      processName: input.candidate.processName,
      artifactType: documentType,
      sourceDocumentId,
      sourceLineage: knowledgeExtraction.sourceLineage,
      chunksCreated: prepared.chunks.length,
      replacedPromotedArtifact: Boolean(existingMatch),
    },
  });

  return {
    curationDocumentId: document.id,
    documentId: document.documentId,
    sourceDocumentId,
    status,
    documentType,
    chunksCreated: prepared.chunks.length,
    replacedExisting: Boolean(existingMatch),
  };
}
