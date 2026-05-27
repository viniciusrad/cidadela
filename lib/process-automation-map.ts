import { createHash, randomUUID } from "node:crypto";

import type {
  AutomationCandidate,
  CurationDocument,
  DocumentCorrelationRun,
  Prisma,
  Sector,
} from "@prisma/client";

import { createAuditEvent } from "@/lib/db/audit-repo";
import { prisma } from "@/lib/db/client";
import {
  renderCuratedArtifactMarkdown,
  writeCuratedArtifactFile,
} from "@/lib/curation/renderers";
import { SECTORS } from "@/lib/domain";
import { syncShareableKnowledgeCapabilities } from "@/lib/knowledge/capabilities";
import { prepareMarkdownDocument } from "@/lib/markdown";
import { checkNeo4jHealth, runQuery } from "@/lib/neo4j";
import { syncProcessGraphNode } from "@/lib/graph/process-sync";
import { getEmbedding } from "@/lib/ollama";
import {
  deleteStagedDocumentChunks,
  listSectorChunks,
  listStagedDocumentChunks,
  replaceSectorSourceDocumentChunks,
  type AdminChunkRow,
} from "@/lib/qdrant";
import { questionsFromReview } from "@/lib/curation/documents";
import { normalizeSensitivity } from "@/lib/sensitivity";
import type { CurationQuestion } from "@/lib/sop-readiness";

type ReviewWithQuestions = { questions: Prisma.JsonValue };
type CorrelationWithFindings = Pick<DocumentCorrelationRun, "findings" | "status">;

type ProcessDocumentRecord = Omit<CurationDocument, "sector"> & {
  sector: Sector;
  reviews: ReviewWithQuestions[];
  correlationRuns: CorrelationWithFindings[];
  automationCandidates: AutomationCandidate[];
};

type GraphProcedureRow = {
  procedureName: string | null;
  documents: Array<{
    documentId: string | null;
    title: string | null;
    sector: string | null;
    status: string | null;
  }> | null;
  systems: Array<string | null> | null;
  regulations: Array<string | null> | null;
  concepts: Array<string | null> | null;
};

type ProcessFeedbackSignal = {
  text: string;
  kind: "bad_feedback" | "unanswered";
};

type ProcessGapStatus = "open" | "promoted" | "answered" | "dismissed" | "resolved";

type PromotedGapTargetDocument = CurationDocument & {
  reviews: Array<{ questions: Prisma.JsonValue }>;
};

export type ProcessMapListFilters = {
  search?: string;
  sector?: Sector | "all";
  status?: string | "all";
  automationLevel?: string | "all";
  hasSystem?: "all" | "yes" | "no";
  gaps?: "all" | "with" | "without";
  sourceScope?: "all" | "staging" | "promoted" | "both";
};

export type ProcessMapDocumentRef = {
  curationDocumentId?: string;
  documentId: string;
  sourceDocumentId: string;
  title: string;
  sector: Sector;
  status: string;
  source: "staging" | "promoted";
  owner?: string | null;
  topic?: string | null;
};

export type ProcessMapEvidence = {
  sector: Sector;
  sourceDocumentId: string;
  headingPathText: string;
  excerpt: string;
  source: "staging" | "promoted" | "fallback";
};

type ProcessGapDraft = {
  question: string;
  rationale: string;
  priority: "low" | "medium" | "high";
  derivedFrom: "graph" | "vector" | "candidate" | "coverage";
  targetDocumentId?: string;
  targetCurationDocumentId?: string;
  status?: ProcessGapStatus;
  answeredAt?: Date | null;
};

type ProcessFeatureSet = {
  docCount: number;
  hasGraphStructure: boolean;
  hasAutomationCandidate: boolean;
  hasSystem: boolean;
  hasClearInputs: boolean;
  hasClearOutputs: boolean;
  hasFrequencyEvidence: boolean;
  hasHumanCheckpoint: boolean;
  hasCriticalCorrelation: boolean;
  hasOwner: boolean;
  hasTrigger: boolean;
  hasExceptions: boolean;
  hasSuccessIndicator: boolean;
  hasEndEvidence: boolean;
  hasRegulations: boolean;
  feedbackSignalsCount: number;
  semanticConsistency: boolean;
};

type ProcessComputationInput = {
  sector: Sector;
  name: string;
  graphBacked: boolean;
  documents: ProcessMapDocumentRef[];
  systems: string[];
  regulations: string[];
  concepts: string[];
  vectorEvidence: ProcessMapEvidence[];
  summarySeed?: string;
  candidates: Array<{
    id: string;
    title: string;
    automationLevel: string;
    suggestedScriptType?: string | null;
    confidence: number;
    signals: string[];
    status: string;
  }>;
  features: ProcessFeatureSet;
};

export type ProcessMapDraft = {
  fingerprint: string;
  name: string;
  sector: Sector;
  status: string;
  automationReadinessScore: number;
  documentationCoverageScore: number;
  confidenceScore: number;
  summary: string;
  recommendedAutomationLevel: "assistida" | "parcial" | "total";
  suggestedScriptType: string | null;
  processSignals: string[];
  systemNames: string[];
  documentRefs: ProcessMapDocumentRef[];
  graphEvidence: Record<string, unknown>;
  vectorEvidence: ProcessMapEvidence[];
  gaps: ProcessGapDraft[];
  candidateIds: string[];
  hasHumanCheckpoint: boolean;
  sourceScope: "staging" | "promoted" | "both";
  actionRecommendation: string;
};

type ProcessMapRecordWithRelations = Prisma.ProcessMapGetPayload<{
  include: {
    questions: true;
    automationCandidates: true;
  };
}>;

type PersistedProcessGapQuestion = Prisma.ProcessGapQuestionGetPayload<Record<string, never>>;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function uniq(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeText(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function slugify(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function fingerprintForProcess(sector: Sector, name: string) {
  return createHash("sha256")
    .update(`${sector}:${normalizeText(name)}`)
    .digest("hex");
}

function safeArray<T>(value: unknown, predicate: (item: unknown) => item is T) {
  if (!Array.isArray(value)) return [] as T[];
  return value.filter(predicate);
}

function safeStringArray(value: unknown) {
  return safeArray(value, (item): item is string => typeof item === "string");
}

function toProcessDocumentRef(document: ProcessDocumentRecord): ProcessMapDocumentRef {
  return {
    curationDocumentId: document.id,
    documentId: document.documentId,
    sourceDocumentId: document.sourceDocumentId,
    title: document.documentTitle,
    sector: document.sector,
    status: document.status,
    source: document.status === "PROMOTED" ? "promoted" : "staging",
    owner: document.owner,
    topic: document.topic,
  };
}

function parseCorrelationFindings(run?: CorrelationWithFindings | null) {
  if (!run || !Array.isArray(run.findings)) {
    return [] as Array<{ severity?: string; status?: string }>;
  }

  return run.findings.filter((finding): finding is { severity?: string; status?: string } => {
    return Boolean(finding) && typeof finding === "object";
  });
}

function hasCriticalCorrelation(document: ProcessDocumentRecord) {
  const latestRun = document.correlationRuns[0];
  if (!latestRun) return false;
  if (latestRun.status === "BLOCKED") return true;

  return parseCorrelationFindings(latestRun).some((finding) => {
    return (
      (finding.status ?? "open") === "open" &&
      (finding.severity === "high" || finding.severity === "critical")
    );
  });
}

function parseKnowledgeExtraction(document: ProcessDocumentRecord) {
  const extraction = document.knowledgeExtraction;
  const empty = {
    summary: "",
    systems: [] as string[],
    processSteps: [] as string[],
    automationCandidates: [] as Array<{
      title?: string;
      automationLevel?: string;
      suggestedScriptType?: string;
      confidence?: number;
      signals?: string[];
      processName?: string;
    }>,
  };

  if (!extraction || typeof extraction !== "object") {
    return empty;
  }

  const raw = extraction as Record<string, unknown>;
  return {
    summary: typeof raw.summary === "string" ? raw.summary : "",
    systems: safeStringArray(raw.systems),
    processSteps: safeStringArray(raw.processSteps),
    automationCandidates: safeArray(raw.automationCandidates, (item): item is {
      title?: string;
      automationLevel?: string;
      suggestedScriptType?: string;
      confidence?: number;
      signals?: string[];
      processName?: string;
    } => Boolean(item) && typeof item === "object"),
  };
}

function extractQuestionSignals(document: ProcessDocumentRecord) {
  const questions = questionsFromReview(document.reviews[0]);
  const answersById = new Map<string, string>();
  const processGapAnswers: string[] = [];

  for (const question of questions) {
    const response = question.response?.trim();
    if (!response) continue;
    answersById.set(question.id, response);
    if (question.source === "process_gap") {
      processGapAnswers.push(response);
    }
  }

  return { questions, answersById, processGapAnswers };
}

function markdownHasAny(markdown: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(markdown));
}

function deriveFeatures(input: {
  documents: ProcessDocumentRecord[];
  systems: string[];
  regulations: string[];
  feedbackSignals: ProcessFeedbackSignal[];
  graphBacked: boolean;
}) {
  const docs = input.documents;
  const docCount = docs.length;
  const markdown = docs.map((document) => document.normalizedMarkdown).join("\n\n");
  const questionSignals = docs.map(extractQuestionSignals);
  const answersById = new Map<string, string>();
  for (const signal of questionSignals) {
    for (const [id, response] of signal.answersById.entries()) {
      answersById.set(id, response);
    }
  }
  const processGapAnswers = questionSignals.flatMap((signal) => signal.processGapAnswers);
  const candidateSignals = docs.flatMap((document) =>
    document.automationCandidates.flatMap((candidate) => {
      if (!candidate.payload || typeof candidate.payload !== "object") return [] as string[];
      return safeStringArray((candidate.payload as Record<string, unknown>).signals);
    }),
  );

  const hasOwner = docs.some((document) => Boolean(document.owner?.trim())) ||
    Boolean(answersById.get("metadata_owner"));
  const hasTrigger =
    Boolean(answersById.get("sop_when")) ||
    markdownHasAny(markdown, [/\bgatilho\b/i, /\bquando\b/i, /\bdisparad[oa]\b/i]);
  const hasClearInputs =
    Boolean(answersById.get("sop_inputs")) ||
    markdownHasAny(markdown, [/\bpre-?requisit/i, /\bentrada(s)?\b/i, /\binsumo(s)?\b/i]);
  const hasClearOutputs =
    Boolean(answersById.get("sop_outputs")) ||
    markdownHasAny(markdown, [/\bsaida(s)?\b/i, /\bevidencia(s)?\b/i, /\bresultado(s)?\b/i]);
  const hasExceptions =
    Boolean(answersById.get("sop_errors")) ||
    markdownHasAny(markdown, [/\bexce(c|ç)(a|ã)o/i, /\berro(s)?\b/i, /\bfalha(s)?\b/i]);
  const hasSuccessIndicator =
    markdownHasAny(markdown, [/\bindicador(es)?\b/i, /\bsucesso\b/i, /\bkpi\b/i]) ||
    processGapAnswers.some((answer) => /sucesso|indicador|kpi/i.test(answer));
  const hasEndEvidence =
    hasClearOutputs ||
    markdownHasAny(markdown, [/\bfim do processo\b/i, /\bencerrament/i, /\bconclu[ií]do\b/i]);
  const hasFrequencyEvidence =
    markdownHasAny(markdown, [
      /\bdiari[ao]\b/i,
      /\bsemanal\b/i,
      /\bmensal\b/i,
      /\brecorrent/i,
      /\bperiodic/i,
      /\brotina\b/i,
    ]);
  const hasHumanCheckpoint =
    markdownHasAny(markdown, [/\baprova(c|ç)(a|ã)o/i, /\bvalida(r|ção)\b/i, /\bhumano\b/i, /\brespons[aá]vel\b/i]) ||
    candidateSignals.some((signal) => normalizeText(signal).includes("checkpoint humano"));

  return {
    docCount,
    hasGraphStructure: input.graphBacked,
    hasAutomationCandidate: docs.some((document) => document.automationCandidates.length > 0),
    hasSystem: input.systems.length > 0,
    hasClearInputs,
    hasClearOutputs,
    hasFrequencyEvidence,
    hasHumanCheckpoint,
    hasCriticalCorrelation: docs.some(hasCriticalCorrelation),
    hasOwner,
    hasTrigger,
    hasExceptions,
    hasSuccessIndicator,
    hasEndEvidence,
    hasRegulations: input.regulations.length > 0,
    feedbackSignalsCount: input.feedbackSignals.length,
    semanticConsistency: input.graphBacked ? docCount >= 2 : false,
  } satisfies ProcessFeatureSet;
}

export function calculateAutomationReadiness(features: ProcessFeatureSet) {
  let score = 0;

  if (features.hasAutomationCandidate) score += 25;
  if (features.semanticConsistency) score += 20;
  if (features.hasSystem) score += 15;
  if (features.hasClearInputs && features.hasClearOutputs) score += 10;
  if (features.hasFrequencyEvidence) score += 10;
  if (features.hasHumanCheckpoint) score -= 15;
  if (features.hasCriticalCorrelation) score -= 20;
  if (!features.hasOwner || !features.hasTrigger || !features.hasExceptions) score -= 15;

  score = Math.max(0, Math.min(100, score));

  let level: "assistida" | "parcial" | "total" =
    score >= 70 ? "total" : score >= 35 ? "parcial" : "assistida";

  if (features.hasHumanCheckpoint && level === "total") {
    level = "parcial";
  }

  return { score, level };
}

export function calculateDocumentationCoverage(features: ProcessFeatureSet) {
  let score = 20;
  if (features.docCount >= 2) score += 15;
  if (features.hasSystem) score += 10;
  if (features.hasOwner) score += 10;
  if (features.hasTrigger) score += 10;
  if (features.hasClearInputs) score += 10;
  if (features.hasClearOutputs) score += 10;
  if (features.hasExceptions) score += 10;
  if (features.hasEndEvidence) score += 5;
  if (features.hasSuccessIndicator) score += 5;
  if (features.hasRegulations) score += 5;

  return Math.max(0, Math.min(100, score));
}

function calculateConfidenceScore(input: {
  graphBacked: boolean;
  docCount: number;
  evidenceCount: number;
  systemsCount: number;
  candidateCount: number;
  feedbackSignalsCount: number;
}) {
  let score = 15;
  if (input.graphBacked) score += 25;
  score += Math.min(20, input.docCount * 8);
  score += Math.min(20, input.evidenceCount * 5);
  score += Math.min(10, input.systemsCount * 5);
  score += Math.min(10, input.candidateCount * 5);
  score -= Math.min(10, input.feedbackSignalsCount * 3);

  return Math.max(0, Math.min(100, score));
}

function inferSuggestedScriptType(input: ProcessComputationInput) {
  const explicit = input.candidates.find((candidate) => candidate.suggestedScriptType)?.suggestedScriptType;
  if (explicit) return explicit;

  const normalizedSystems = input.systems.map((system) => normalizeText(system));
  const signals = input.candidates.flatMap((candidate) => candidate.signals.map(normalizeText));
  const summary = normalizeText(input.summarySeed ?? "");

  if (
    normalizedSystems.some((system) => system.includes("api")) ||
    summary.includes("api") ||
    summary.includes("endpoint")
  ) {
    return "integracao_api";
  }

  if (
    signals.some((signal) => signal.includes("portal")) ||
    normalizedSystems.some((system) => system.includes("portal"))
  ) {
    return "automacao_portal";
  }

  if (
    signals.some((signal) => signal.includes("fila")) ||
    signals.some((signal) => signal.includes("workflow"))
  ) {
    return "workflow_orquestrado";
  }

  if (input.features.hasHumanCheckpoint) {
    return "apoio_operacional";
  }

  return input.candidates.length > 0 ? "script_operacional" : null;
}

function determineSourceScope(documentRefs: ProcessMapDocumentRef[]) {
  const hasPromoted = documentRefs.some((document) => document.source === "promoted");
  const hasStaging = documentRefs.some((document) => document.source === "staging");

  if (hasPromoted && hasStaging) return "both" as const;
  if (hasPromoted) return "promoted" as const;
  return "staging" as const;
}

function summarizeProcess(input: ProcessComputationInput) {
  const sources = `${input.documents.length} documento${input.documents.length === 1 ? "" : "s"}`;
  const systems = input.systems.length > 0 ? `Sistemas: ${input.systems.join(", ")}.` : "Sem sistema consolidado.";
  const automation = input.candidates.length > 0
    ? `${input.candidates.length} candidato${input.candidates.length === 1 ? "" : "s"} de automacao associado${input.candidates.length === 1 ? "" : "s"}.`
    : "Sem candidato explicito de automacao.";
  const seed = input.summarySeed?.trim() ? `${input.summarySeed.trim()} ` : "";

  return `${seed}Processo ${input.name} consolidado a partir de ${sources}. ${systems} ${automation}`.trim();
}

function pickActionRecommendation(input: {
  graphBacked: boolean;
  gapCount: number;
  criticalGapCount: number;
  candidateCount: number;
  automationLevel: "assistida" | "parcial" | "total";
}) {
  if (!input.graphBacked) {
    return "Extrair documento-base para o grafo";
  }

  if (input.criticalGapCount > 0) {
    return "Enviar gaps criticos para curadoria";
  }

  if (input.gapCount > 0) {
    return "Promover perguntas de lacuna para curadoria";
  }

  if (input.candidateCount === 0 && input.automationLevel !== "assistida") {
    return "Marcar processo para triagem operacional";
  }

  return "Revisar backlog e evidencias do processo";
}

function questionKey(gap: Pick<ProcessGapDraft, "question" | "targetDocumentId" | "targetCurationDocumentId" | "derivedFrom">) {
  return [
    normalizeText(gap.question),
    gap.targetDocumentId ?? "",
    gap.targetCurationDocumentId ?? "",
    gap.derivedFrom,
  ].join("|");
}

function relatedFeedbackExists(processName: string, feedbackSignals: ProcessFeedbackSignal[]) {
  const normalizedName = normalizeText(processName);
  const tokens = normalizedName.split(/\s+/).filter((token) => token.length >= 4);

  return feedbackSignals.some((signal) => {
    const haystack = normalizeText(signal.text);
    return haystack.includes(normalizedName) || tokens.some((token) => haystack.includes(token));
  });
}

function getAnswerForPrompt(document: ProcessDocumentRecord | undefined, prompt: string) {
  if (!document) return "";
  const questions = questionsFromReview(document.reviews[0]);
  return (
    questions.find(
      (question) =>
        question.source === "process_gap" &&
        normalizeText(question.prompt) === normalizeText(prompt) &&
        question.response?.trim(),
    )?.response?.trim() ?? ""
  );
}

export function generateProcessGapQuestions(input: {
  processName: string;
  features: ProcessFeatureSet;
  systems: string[];
  regulations: string[];
  docRefs: ProcessMapDocumentRef[];
  vectorEvidence: ProcessMapEvidence[];
  targetDocument?: Pick<ProcessDocumentRecord, "id" | "documentId" | "reviews">;
  feedbackSignals: ProcessFeedbackSignal[];
}) {
  const gaps: ProcessGapDraft[] = [];
  const seen = new Set<string>();

  const pushGap = (gap: ProcessGapDraft) => {
    const key = questionKey(gap);
    if (seen.has(key)) return;
    seen.add(key);
    gaps.push(gap);
  };

  const targetDocumentId = input.targetDocument?.documentId ?? input.docRefs[0]?.documentId;
  const targetCurationDocumentId = input.targetDocument?.id;

  if (!input.features.hasTrigger) {
    const question = `Qual gatilho inicia o processo ${input.processName}?`;
    const answer = getAnswerForPrompt(input.targetDocument as ProcessDocumentRecord | undefined, question);
    pushGap({
      question,
      rationale: "O mapa ainda nao deixa claro quando o processo deve ser iniciado.",
      priority: "high",
      derivedFrom: "coverage",
      targetDocumentId,
      targetCurationDocumentId,
      status: answer ? "answered" : "open",
      answeredAt: answer ? new Date() : null,
    });
  }

  if (!input.features.hasClearInputs) {
    const question = `Quais entradas, pre-requisitos ou dados sao necessarios para executar ${input.processName}?`;
    const answer = getAnswerForPrompt(input.targetDocument as ProcessDocumentRecord | undefined, question);
    pushGap({
      question,
      rationale: "Faltam entradas claras para avaliar orquestracao e automacao do processo.",
      priority: "high",
      derivedFrom: "coverage",
      targetDocumentId,
      targetCurationDocumentId,
      status: answer ? "answered" : "open",
      answeredAt: answer ? new Date() : null,
    });
  }

  if (!input.features.hasClearOutputs) {
    const question = `Quais saidas, evidencias ou entregas comprovam que ${input.processName} terminou corretamente?`;
    const answer = getAnswerForPrompt(input.targetDocument as ProcessDocumentRecord | undefined, question);
    pushGap({
      question,
      rationale: "Sem saidas claras nao e possivel fechar o fluxo ou validar sucesso.",
      priority: "high",
      derivedFrom: "coverage",
      targetDocumentId,
      targetCurationDocumentId,
      status: answer ? "answered" : "open",
      answeredAt: answer ? new Date() : null,
    });
  }

  if (input.systems.length === 0) {
    const question = `Quais sistemas, portais, APIs ou planilhas sao usados no processo ${input.processName}?`;
    const answer = getAnswerForPrompt(input.targetDocument as ProcessDocumentRecord | undefined, question);
    pushGap({
      question,
      rationale: "O processo nao possui sistema associado no grafo nem na curadoria.",
      priority: "high",
      derivedFrom: "graph",
      targetDocumentId,
      targetCurationDocumentId,
      status: answer ? "answered" : "open",
      answeredAt: answer ? new Date() : null,
    });
  }

  if (!input.features.hasHumanCheckpoint) {
    const question = `Existe checkpoint humano, aprovacao manual ou validacao obrigatoria dentro de ${input.processName}?`;
    const answer = getAnswerForPrompt(input.targetDocument as ProcessDocumentRecord | undefined, question);
    pushGap({
      question,
      rationale: "Precisamos confirmar se ha humano no loop antes de sugerir automacao total.",
      priority: "medium",
      derivedFrom: "candidate",
      targetDocumentId,
      targetCurationDocumentId,
      status: answer ? "answered" : "open",
      answeredAt: answer ? new Date() : null,
    });
  }

  if (!input.features.hasExceptions) {
    const question = `Quais excecoes, erros ou desvios operacionais devem ser tratados no processo ${input.processName}?`;
    const answer = getAnswerForPrompt(input.targetDocument as ProcessDocumentRecord | undefined, question);
    pushGap({
      question,
      rationale: "Excecoes ausentes reduzem confianca do desenho de automacao.",
      priority: "high",
      derivedFrom: "coverage",
      targetDocumentId,
      targetCurationDocumentId,
      status: answer ? "answered" : "open",
      answeredAt: answer ? new Date() : null,
    });
  }

  if (!input.features.hasFrequencyEvidence) {
    const question = `Com que frequencia o processo ${input.processName} ocorre e qual volume medio ele movimenta?`;
    const answer = getAnswerForPrompt(input.targetDocument as ProcessDocumentRecord | undefined, question);
    pushGap({
      question,
      rationale: "Frequencia e volume sao sinais chave para priorizacao de automacao.",
      priority: "medium",
      derivedFrom: "vector",
      targetDocumentId,
      targetCurationDocumentId,
      status: answer ? "answered" : "open",
      answeredAt: answer ? new Date() : null,
    });
  }

  if (input.regulations.length === 0) {
    const question = `Quais regras, normas ou restricoes limitam a automacao do processo ${input.processName}?`;
    const answer = getAnswerForPrompt(input.targetDocument as ProcessDocumentRecord | undefined, question);
    pushGap({
      question,
      rationale: "Ainda nao ha restricoes regulatórias ou politicas consolidadas para o processo.",
      priority: "medium",
      derivedFrom: "graph",
      targetDocumentId,
      targetCurationDocumentId,
      status: answer ? "answered" : "open",
      answeredAt: answer ? new Date() : null,
    });
  }

  if (!input.features.hasEndEvidence) {
    const question = `Qual evidencia marca o fim do processo ${input.processName} e onde ela fica registrada?`;
    const answer = getAnswerForPrompt(input.targetDocument as ProcessDocumentRecord | undefined, question);
    pushGap({
      question,
      rationale: "Falta evidencia objetiva de encerramento do processo.",
      priority: "medium",
      derivedFrom: "coverage",
      targetDocumentId,
      targetCurationDocumentId,
      status: answer ? "answered" : "open",
      answeredAt: answer ? new Date() : null,
    });
  }

  if (!input.features.hasSuccessIndicator) {
    const question = `Como medir sucesso, SLA ou qualidade do processo ${input.processName}?`;
    const answer = getAnswerForPrompt(input.targetDocument as ProcessDocumentRecord | undefined, question);
    pushGap({
      question,
      rationale: "Nao ha indicador de sucesso para acompanhar o ganho operacional da automacao.",
      priority: "medium",
      derivedFrom: "coverage",
      targetDocumentId,
      targetCurationDocumentId,
      status: answer ? "answered" : "open",
      answeredAt: answer ? new Date() : null,
    });
  }

  if (input.docRefs.length === 1) {
    const question = `Existe outro documento, SOP ou evidência operacional que tambem descreva o processo ${input.processName}?`;
    const answer = getAnswerForPrompt(input.targetDocument as ProcessDocumentRecord | undefined, question);
    pushGap({
      question,
      rationale: "O processo aparece em apenas um documento e ainda tem baixa corroboracao documental.",
      priority: "medium",
      derivedFrom: "coverage",
      targetDocumentId,
      targetCurationDocumentId,
      status: answer ? "answered" : "open",
      answeredAt: answer ? new Date() : null,
    });
  }

  if (!input.features.hasOwner && input.docRefs.length >= 2) {
    const question = `Quem e o dono operacional do processo ${input.processName} e quem aprova mudancas nele?`;
    const answer = getAnswerForPrompt(input.targetDocument as ProcessDocumentRecord | undefined, question);
    pushGap({
      question,
      rationale: "O processo tem varios documentos associados, mas segue sem dono claro.",
      priority: "high",
      derivedFrom: "coverage",
      targetDocumentId,
      targetCurationDocumentId,
      status: answer ? "answered" : "open",
      answeredAt: answer ? new Date() : null,
    });
  }

  if (relatedFeedbackExists(input.processName, input.feedbackSignals)) {
    const question = `Usuarios relataram dificuldade para obter resposta sobre ${input.processName}. O que ainda falta documentar para esse fluxo ficar claro?`;
    const answer = getAnswerForPrompt(input.targetDocument as ProcessDocumentRecord | undefined, question);
    pushGap({
      question,
      rationale: "Feedback ruim ou pergunta sem resposta sugere lacuna real de entendimento do processo.",
      priority: "high",
      derivedFrom: "coverage",
      targetDocumentId,
      targetCurationDocumentId,
      status: answer ? "answered" : "open",
      answeredAt: answer ? new Date() : null,
    });
  }

  if (input.vectorEvidence.length === 0) {
    const question = `Qual trecho operacional, exemplo real ou passo a passo comprova como ${input.processName} acontece hoje?`;
    const answer = getAnswerForPrompt(input.targetDocument as ProcessDocumentRecord | undefined, question);
    pushGap({
      question,
      rationale: "Nao foi encontrada evidência textual forte para sustentar o processo consolidado.",
      priority: "medium",
      derivedFrom: "vector",
      targetDocumentId,
      targetCurationDocumentId,
      status: answer ? "answered" : "open",
      answeredAt: answer ? new Date() : null,
    });
  }

  return gaps;
}

export function buildProcessMapDraft(input: ProcessComputationInput): ProcessMapDraft {
  const readiness = calculateAutomationReadiness(input.features);
  const documentationCoverageScore = calculateDocumentationCoverage(input.features);
  const confidenceScore = calculateConfidenceScore({
    graphBacked: input.graphBacked,
    docCount: input.documents.length,
    evidenceCount: input.vectorEvidence.length,
    systemsCount: input.systems.length,
    candidateCount: input.candidates.length,
    feedbackSignalsCount: input.features.feedbackSignalsCount,
  });
  const suggestedScriptType = inferSuggestedScriptType(input);
  const summary = summarizeProcess(input);
  const targetDocument = input.documents
    .find((document) => document.source === "staging")
    ?? input.documents[0];
  const gaps = generateProcessGapQuestions({
    processName: input.name,
    features: input.features,
    systems: input.systems,
    regulations: input.regulations,
    docRefs: input.documents,
    vectorEvidence: input.vectorEvidence,
    targetDocument: undefined,
    feedbackSignals: [],
  });
  const graphEvidence = {
    graphBacked: input.graphBacked,
    systems: input.systems,
    regulations: input.regulations,
    concepts: input.concepts,
    docCount: input.documents.length,
  };
  const processSignals = uniq([
    input.graphBacked ? "procedure_neo4j" : "fallback_document",
    input.features.hasAutomationCandidate ? "automation_candidate" : null,
    input.features.hasHumanCheckpoint ? "human_checkpoint" : null,
    input.features.hasCriticalCorrelation ? "critical_correlation" : null,
    input.features.hasFrequencyEvidence ? "recurring_frequency" : null,
    suggestedScriptType,
  ]);
  const status = evaluateProcessStatus({
    graphBacked: input.graphBacked,
    gaps,
  });
  const openQuestions = gaps.filter(
    (gap) =>
      gap.status !== "answered" &&
      gap.status !== "resolved" &&
      gap.status !== "dismissed",
  );
  const criticalGapCount = openQuestions.filter((gap) => gap.priority === "high").length;
  const actionRecommendation = pickActionRecommendation({
    graphBacked: input.graphBacked,
    gapCount: openQuestions.length,
    criticalGapCount,
    candidateCount: input.candidates.length,
    automationLevel: readiness.level,
  });

  return {
    fingerprint: fingerprintForProcess(input.sector, input.name),
    name: input.name,
    sector: input.sector,
    status,
    automationReadinessScore: readiness.score,
    documentationCoverageScore,
    confidenceScore,
    summary,
    recommendedAutomationLevel: readiness.level,
    suggestedScriptType,
    processSignals,
    systemNames: input.systems,
    documentRefs: input.documents,
    graphEvidence,
    vectorEvidence: input.vectorEvidence,
    gaps: gaps.map((gap) => ({
      ...gap,
      targetDocumentId: gap.targetDocumentId ?? targetDocument?.documentId,
      targetCurationDocumentId: gap.targetCurationDocumentId ?? targetDocument?.curationDocumentId,
    })),
    candidateIds: input.candidates.map((candidate) => candidate.id),
    hasHumanCheckpoint: input.features.hasHumanCheckpoint,
    sourceScope: determineSourceScope(input.documents),
    actionRecommendation,
  };
}

function readJsonDocumentRefs(value: Prisma.JsonValue) {
  return safeArray(value, (item): item is ProcessMapDocumentRef => {
    return item !== null && typeof item === "object" && "documentId" in item && "sourceDocumentId" in item;
  });
}

function readJsonStringArray(value: Prisma.JsonValue) {
  return safeArray(value, (item): item is string => typeof item === "string");
}

function readJsonVectorEvidence(value: Prisma.JsonValue) {
  return safeArray(value, (item): item is ProcessMapEvidence => {
    return item !== null && typeof item === "object" && "excerpt" in item;
  });
}

async function fetchGraphProcedures() {
  const healthy = await checkNeo4jHealth().catch(() => false);
  if (!healthy) return [] as GraphProcedureRow[];

  return runQuery<GraphProcedureRow>(
    `MATCH (p:Procedure)
     OPTIONAL MATCH (d:Document)-[:DESCRIBES]->(p)
     OPTIONAL MATCH (d)-[:REFERENCES_SYSTEM]->(s:System)
     OPTIONAL MATCH (d)-[:COMPLIES_WITH]->(r:Regulation)
     OPTIONAL MATCH (d)-[:HAS_CONCEPT]->(c:Concept)
     WITH p,
          collect(DISTINCT CASE
            WHEN d IS NULL THEN NULL
            ELSE {
              documentId: d.id,
              title: d.title,
              sector: d.sector,
              status: d.status
            }
          END) AS documents,
          collect(DISTINCT s.name) AS systems,
          collect(DISTINCT r.name) AS regulations,
          collect(DISTINCT c.name) AS concepts
     RETURN p.name AS procedureName,
            documents,
            systems,
            regulations,
            concepts
     ORDER BY p.name ASC`,
  ).catch(() => [] as GraphProcedureRow[]);
}

async function fetchProcessDocuments() {
  return prisma.curationDocument.findMany({
    where: {
      status: {
        in: [
          "STAGED",
          "IN_REVIEW",
          "NEEDS_REVISION",
          "READY_FOR_APPROVAL",
          "APPROVED",
          "PROMOTED",
        ],
      },
      sector: { in: [...SECTORS] },
    },
    include: {
      reviews: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { questions: true },
      },
      correlationRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { findings: true, status: true },
      },
      automationCandidates: true,
    },
    orderBy: { uploadedAt: "desc" },
  }) as Promise<ProcessDocumentRecord[]>;
}

async function fetchFeedbackSignals() {
  const [unansweredEvents, feedbackEvents] = await Promise.all([
    prisma.auditEvent.findMany({
      where: { eventType: "agent.unanswered" },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.auditEvent.findMany({
      where: { eventType: "user.feedback" },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const badFeedbackEvents = feedbackEvents.filter((event) => {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    return payload.value === "bad";
  });
  const feedbackMessageIds = badFeedbackEvents.map((event) => event.targetId);
  const feedbackMessages = feedbackMessageIds.length
    ? await prisma.message.findMany({
        where: { id: { in: feedbackMessageIds } },
        select: { id: true, traceId: true },
      })
    : [];
  const traces = feedbackMessages.map((message) => message.traceId);
  const userMessages = traces.length
    ? await prisma.message.findMany({
        where: {
          traceId: { in: traces },
          role: "user",
        },
        select: { traceId: true, content: true },
      })
    : [];
  const userMessagesByTrace = new Map(userMessages.map((message) => [message.traceId, message.content]));

  return [
    ...unansweredEvents.map((event) => {
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      return {
        kind: "unanswered" as const,
        text: typeof payload.question === "string" ? payload.question : "",
      };
    }),
    ...badFeedbackEvents.map((event) => {
      const message = feedbackMessages.find((item) => item.id === event.targetId);
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      return {
        kind: "bad_feedback" as const,
        text: [
          typeof payload.comment === "string" ? payload.comment : "",
          message ? userMessagesByTrace.get(message.traceId) ?? "" : "",
        ]
          .filter(Boolean)
          .join(" "),
      };
    }),
  ].filter((signal) => signal.text.trim().length > 0);
}

async function collectVectorEvidenceForDocument(
  document: ProcessDocumentRecord,
  processName: string,
  systems: string[],
) {
  const terms = uniq([processName, ...systems]).map(normalizeText);
  let chunks: AdminChunkRow[] = [];

  try {
    if (document.status === "PROMOTED") {
      const result = await listSectorChunks(document.sector, {
        limit: 60,
        sourceDocumentId: document.sourceDocumentId,
      });
      chunks = result.rows;
    } else {
      chunks = await listStagedDocumentChunks(document.sector, document.sourceDocumentId);
    }
  } catch {
    chunks = [];
  }

  if (chunks.length === 0) {
    return [
      {
        sector: document.sector,
        sourceDocumentId: document.sourceDocumentId,
        headingPathText: "Documento",
        excerpt: document.normalizedMarkdown.trim(),
        source: document.status === "PROMOTED" ? "promoted" : "staging",
      } satisfies ProcessMapEvidence,
    ];
  }

  const scored = chunks
    .map((chunk) => {
      const haystack = normalizeText(`${chunk.headingPathText} ${chunk.contentPreview} ${chunk.content}`);
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { chunk, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex)
    .slice(0, 2);

  const source = document.status === "PROMOTED" ? "promoted" : "staging";
  const base = scored.length > 0 ? scored.map((item) => item.chunk) : chunks.slice(0, 1);

  return base.map((chunk) => ({
    sector: document.sector,
    sourceDocumentId: document.sourceDocumentId,
    headingPathText: chunk.headingPathText,
    excerpt: (chunk.content || chunk.contentPreview || "").trim(),
    source,
  }));
}

function primaryProcessNameFromDocument(document: ProcessDocumentRecord) {
  const extraction = parseKnowledgeExtraction(document);
  const candidateProcessName = document.automationCandidates.find((candidate) => candidate.processName)?.processName;

  return (
    extraction.processSteps[0] ||
    candidateProcessName ||
    extraction.summary ||
    document.documentTitle
  );
}

function buildCandidateRecord(candidate: AutomationCandidate) {
  const payload = candidate.payload && typeof candidate.payload === "object"
    ? (candidate.payload as Record<string, unknown>)
    : {};

  return {
    id: candidate.id,
    title: candidate.title,
    automationLevel: candidate.automationLevel,
    suggestedScriptType: candidate.suggestedScriptType,
    confidence: candidate.confidence,
    signals: safeStringArray(payload.signals),
    status: candidate.status,
  };
}

function parseExistingGapStatus(question?: PersistedProcessGapQuestion | null) {
  return (question?.status || "open") as ProcessGapStatus;
}

async function assembleProcessDrafts() {
  const [graphProcedures, documents, feedbackSignals] = await Promise.all([
    fetchGraphProcedures(),
    fetchProcessDocuments(),
    fetchFeedbackSignals(),
  ]);

  const documentsByLookup = new Map<string, ProcessDocumentRecord>();
  for (const document of documents) {
    documentsByLookup.set(document.documentId, document);
    documentsByLookup.set(document.sourceDocumentId, document);
  }

  const contexts = new Map<string, {
    sector: Sector;
    name: string;
    graphBacked: boolean;
    documents: ProcessDocumentRecord[];
    systems: string[];
    regulations: string[];
    concepts: string[];
  }>();
  const usedDocumentIds = new Set<string>();

  for (const row of graphProcedures) {
    const name = row.procedureName?.trim();
    if (!name) continue;

    const docsBySector = new Map<Sector, ProcessDocumentRecord[]>();
    for (const graphDocument of row.documents ?? []) {
      const sector = graphDocument?.sector;
      if (
        !sector ||
        (sector !== "desenvolvimento" &&
          sector !== "seguranca" &&
          sector !== "suporte" &&
          sector !== "desktop")
      ) {
        continue;
      }

      const record = graphDocument.documentId
        ? documentsByLookup.get(graphDocument.documentId)
        : undefined;
      if (!record) continue;

      const list = docsBySector.get(sector) ?? [];
      list.push(record);
      docsBySector.set(sector, list);
      usedDocumentIds.add(record.id);
    }

    for (const [sector, sectorDocuments] of docsBySector.entries()) {
      const key = `${sector}:${slugify(name)}`;
      const current = contexts.get(key);
      const systems = uniq([...(current?.systems ?? []), ...(row.systems ?? []).filter(Boolean) as string[]]);
      const regulations = uniq([...(current?.regulations ?? []), ...(row.regulations ?? []).filter(Boolean) as string[]]);
      const concepts = uniq([...(current?.concepts ?? []), ...(row.concepts ?? []).filter(Boolean) as string[]]);
      const mergedDocs = uniq([
        ...(current?.documents ?? []).map((document) => document.id),
        ...sectorDocuments.map((document) => document.id),
      ]).map((id) => documents.find((document) => document.id === id)).filter(Boolean) as ProcessDocumentRecord[];

      contexts.set(key, {
        sector,
        name,
        graphBacked: true,
        documents: mergedDocs,
        systems,
        regulations,
        concepts,
      });
    }
  }

  for (const document of documents) {
    if (usedDocumentIds.has(document.id)) continue;

    const extraction = parseKnowledgeExtraction(document);
    const fallbackName = primaryProcessNameFromDocument(document).trim();
    if (!fallbackName) continue;

    const qualifies =
      extraction.processSteps.length > 0 ||
      extraction.systems.length > 0 ||
      document.automationCandidates.length > 0;
    if (!qualifies) continue;

    const key = `${document.sector}:${slugify(fallbackName)}`;
    const current = contexts.get(key);
    contexts.set(key, {
      sector: document.sector,
      name: fallbackName,
      graphBacked: current?.graphBacked ?? false,
      documents: uniq([...(current?.documents ?? []).map((item) => item.id), document.id])
        .map((id) => documents.find((item) => item.id === id))
        .filter(Boolean) as ProcessDocumentRecord[],
      systems: uniq([...(current?.systems ?? []), ...extraction.systems]),
      regulations: current?.regulations ?? [],
      concepts: current?.concepts ?? [],
    });
  }

  const drafts: ProcessMapDraft[] = [];

  for (const context of contexts.values()) {
    const docRefs = context.documents.map(toProcessDocumentRef);
    const vectorEvidence = uniq(
      (
        await Promise.all(
          context.documents.map((document) =>
            collectVectorEvidenceForDocument(document, context.name, context.systems),
          ),
        )
      ).flat().map((evidence) => JSON.stringify(evidence)),
    ).map((item) => JSON.parse(item) as ProcessMapEvidence);
    const candidates = uniq(
      context.documents.flatMap((document) => document.automationCandidates.map((candidate) => candidate.id)),
    )
      .map((id) => context.documents.flatMap((document) => document.automationCandidates).find((candidate) => candidate.id === id))
      .filter(Boolean)
      .map((candidate) => buildCandidateRecord(candidate as AutomationCandidate));
    const features = deriveFeatures({
      documents: context.documents,
      systems: context.systems,
      regulations: context.regulations,
      feedbackSignals,
      graphBacked: context.graphBacked,
    });
    const targetDocument =
      context.documents.find((document) => document.status !== "PROMOTED" && document.status !== "REJECTED")
      ?? context.documents[0];
    const summarySeed = [
      ...context.documents.map((document) => parseKnowledgeExtraction(document).summary),
      context.documents[0]?.documentTitle ?? "",
    ]
      .find((value) => value.trim().length > 0);

    const draft = buildProcessMapDraft({
      sector: context.sector,
      name: context.name,
      graphBacked: context.graphBacked,
      documents: docRefs,
      systems: context.systems,
      regulations: context.regulations,
      concepts: context.concepts,
      vectorEvidence,
      summarySeed,
      candidates,
      features,
    });
    draft.gaps = generateProcessGapQuestions({
      processName: context.name,
      features,
      systems: context.systems,
      regulations: context.regulations,
      docRefs,
      vectorEvidence,
      targetDocument,
      feedbackSignals,
    });
    draft.status = evaluateProcessStatus({
      graphBacked: context.graphBacked,
      gaps: draft.gaps,
    });
    const openQuestions = draft.gaps.filter(
      (gap) =>
        gap.status !== "answered" &&
        gap.status !== "resolved" &&
        gap.status !== "dismissed",
    );
    const criticalGapCount = openQuestions.filter((gap) => gap.priority === "high").length;
    draft.actionRecommendation = pickActionRecommendation({
      graphBacked: context.graphBacked,
      gapCount: openQuestions.length,
      criticalGapCount,
      candidateCount: draft.candidateIds.length,
      automationLevel: draft.recommendedAutomationLevel,
    });
    drafts.push(draft);
  }

  return drafts.sort((a, b) => {
    if (b.automationReadinessScore !== a.automationReadinessScore) {
      return b.automationReadinessScore - a.automationReadinessScore;
    }
    return a.name.localeCompare(b.name);
  });
}

function toJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

export async function refreshProcessAutomationMap() {
  const drafts = await assembleProcessDrafts();
  const now = new Date();
  const activeFingerprints = drafts.map((draft) => draft.fingerprint);
  const existingMaps = activeFingerprints.length > 0
    ? await prisma.processMap.findMany({
        where: { fingerprint: { in: activeFingerprints } },
        include: { questions: true, automationCandidates: true },
      })
    : [];
  const existingByFingerprint = new Map(existingMaps.map((processMap) => [processMap.fingerprint, processMap]));
  const candidateAssignments = new Map<string, string>();
  const refreshedIds: string[] = [];

  for (const draft of drafts) {
    const persisted = await prisma.processMap.upsert({
      where: { fingerprint: draft.fingerprint },
      update: {
        name: draft.name,
        sector: draft.sector,
        status: draft.status,
        automationReadinessScore: draft.automationReadinessScore,
        documentationCoverageScore: draft.documentationCoverageScore,
        confidenceScore: draft.confidenceScore,
        summary: draft.summary,
        recommendedAutomationLevel: draft.recommendedAutomationLevel,
        suggestedScriptType: draft.suggestedScriptType,
        processSignals: toJson(draft.processSignals),
        systemNames: toJson(draft.systemNames),
        documentRefs: toJson(draft.documentRefs),
        graphEvidence: toJson(draft.graphEvidence),
        vectorEvidence: toJson(draft.vectorEvidence),
        lastAnalyzedAt: now,
      },
      create: {
        fingerprint: draft.fingerprint,
        name: draft.name,
        sector: draft.sector,
        status: draft.status,
        automationReadinessScore: draft.automationReadinessScore,
        documentationCoverageScore: draft.documentationCoverageScore,
        confidenceScore: draft.confidenceScore,
        summary: draft.summary,
        recommendedAutomationLevel: draft.recommendedAutomationLevel,
        suggestedScriptType: draft.suggestedScriptType,
        processSignals: toJson(draft.processSignals),
        systemNames: toJson(draft.systemNames),
        documentRefs: toJson(draft.documentRefs),
        graphEvidence: toJson(draft.graphEvidence),
        vectorEvidence: toJson(draft.vectorEvidence),
        lastAnalyzedAt: now,
      },
    });
    refreshedIds.push(persisted.id);

    const graphEvidence = (draft.graphEvidence ?? {}) as Record<string, unknown>;
    await syncProcessGraphNode({
      id: persisted.id,
      name: draft.name,
      sector: draft.sector,
      fingerprint: draft.fingerprint,
      status: draft.status,
      automationReadinessScore: draft.automationReadinessScore,
      documentationCoverageScore: draft.documentationCoverageScore,
      confidenceScore: draft.confidenceScore,
      recommendedAutomationLevel: draft.recommendedAutomationLevel,
      graphBacked: Boolean(graphEvidence.graphBacked),
      documentIds: draft.documentRefs.map((document) => document.documentId),
      procedureNames: graphEvidence.graphBacked ? [draft.name] : [],
      systemNames: draft.systemNames,
      conceptNames: safeStringArray(graphEvidence.concepts),
      regulationNames: safeStringArray(graphEvidence.regulations),
    });

    for (const candidateId of draft.candidateIds) {
      candidateAssignments.set(candidateId, persisted.id);
    }

    const existing = existingByFingerprint.get(draft.fingerprint);
    const existingQuestions = new Map(
      (existing?.questions ?? []).map((question) => [
        questionKey({
          question: question.question,
          targetDocumentId: question.targetDocumentId ?? undefined,
          targetCurationDocumentId: question.targetCurationDocumentId ?? undefined,
          derivedFrom: question.derivedFrom as ProcessGapDraft["derivedFrom"],
        }),
        question,
      ]),
    );
    const touchedQuestionIds = new Set<string>();

    for (const gap of draft.gaps) {
      const key = questionKey(gap);
      const current = existingQuestions.get(key);
      const status = gap.status ?? parseExistingGapStatus(current as PersistedProcessGapQuestion);

      if (current) {
        touchedQuestionIds.add(current.id);
        await prisma.processGapQuestion.update({
          where: { id: current.id },
          data: {
            question: gap.question,
            rationale: gap.rationale,
            priority: gap.priority,
            status,
            targetDocumentId: gap.targetDocumentId,
            targetCurationDocumentId: gap.targetCurationDocumentId,
            derivedFrom: gap.derivedFrom,
            answeredAt: status === "answered" ? (gap.answeredAt ?? current.answeredAt ?? now) : null,
          },
        });
      } else {
        const created = await prisma.processGapQuestion.create({
          data: {
            processMapId: persisted.id,
            question: gap.question,
            rationale: gap.rationale,
            priority: gap.priority,
            status,
            targetDocumentId: gap.targetDocumentId,
            targetCurationDocumentId: gap.targetCurationDocumentId,
            derivedFrom: gap.derivedFrom,
            answeredAt: status === "answered" ? (gap.answeredAt ?? now) : null,
          },
        });
        touchedQuestionIds.add(created.id);
      }
    }

    for (const question of existing?.questions ?? []) {
      if (touchedQuestionIds.has(question.id)) continue;
      if (question.status === "answered") continue;
      await prisma.processGapQuestion.update({
        where: { id: question.id },
        data: {
          status: "resolved",
          answeredAt: question.answeredAt,
        },
      });
    }

    await syncProcessMapStatus(persisted.id);
  }

  const allCandidateIds = Array.from(candidateAssignments.keys());
  if (allCandidateIds.length > 0) {
    for (const [candidateId, processMapId] of candidateAssignments.entries()) {
      await prisma.automationCandidate.updateMany({
        where: {
          id: candidateId,
          OR: [{ processMapId: null }, { status: "suggested" }],
        },
        data: { processMapId },
      });
    }
  }

  if (activeFingerprints.length > 0) {
    await prisma.processMap.updateMany({
      where: { fingerprint: { notIn: activeFingerprints } },
      data: {
        status: "archived",
        lastAnalyzedAt: now,
      },
    });

    try {
      await runQuery(
        `MATCH (p:Process)
         WHERE p.fingerprint IS NOT NULL AND NOT p.fingerprint IN $activeFingerprints
         SET p.status = 'archived', p.updatedAt = datetime()`,
        { activeFingerprints },
      );
    } catch (error) {
      console.warn(
        `[process-sync] Failed to archive Process nodes in Neo4j:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return {
    refreshed: true,
    processes: drafts.length,
    linkedCandidates: allCandidateIds.length,
    refreshedAt: now.toISOString(),
    processIds: refreshedIds,
  };
}

function formatProcessMapRow(processMap: ProcessMapRecordWithRelations) {
  const documentRefs = readJsonDocumentRefs(processMap.documentRefs);
  const systemNames = readJsonStringArray(processMap.systemNames);
  const vectorEvidence = readJsonVectorEvidence(processMap.vectorEvidence);
  const openQuestions = processMap.questions.filter(
    (question) =>
      question.status !== "answered" &&
      question.status !== "resolved" &&
      question.status !== "dismissed",
  );
  const criticalGapCount = openQuestions.filter((question) => question.priority === "high").length;
  const sourceScope = determineSourceScope(documentRefs);
  const processSignals = readJsonStringArray(processMap.processSignals);

  return {
    id: processMap.id,
    name: processMap.name,
    sector: processMap.sector,
    status: processMap.status,
    automationReadinessScore: processMap.automationReadinessScore,
    documentationCoverageScore: processMap.documentationCoverageScore,
    confidenceScore: processMap.confidenceScore,
    summary: processMap.summary,
    recommendedAutomationLevel: processMap.recommendedAutomationLevel,
    suggestedScriptType: processMap.suggestedScriptType,
    processSignals,
    systemNames,
    documentRefs,
    vectorEvidence,
    candidateCount: processMap.automationCandidates.length,
    gapCount: openQuestions.length,
    criticalGapCount,
    hasHumanCheckpoint: processSignals.includes("human_checkpoint"),
    hasSystem: systemNames.length > 0,
    sourceScope,
    actionRecommendation: pickActionRecommendation({
      graphBacked: processSignals.includes("procedure_neo4j"),
      gapCount: openQuestions.length,
      criticalGapCount,
      candidateCount: processMap.automationCandidates.length,
      automationLevel: processMap.recommendedAutomationLevel as "assistida" | "parcial" | "total",
    }),
    lastAnalyzedAt: processMap.lastAnalyzedAt?.toISOString() ?? null,
  };
}

export function evaluateProcessStatus(input: {
  graphBacked: boolean;
  gaps: Array<{ priority: string; status?: string | null }>;
}) {
  if (!input.graphBacked) return "needs_graph_extraction";

  const openGaps = input.gaps.filter(
    (gap) =>
      gap.status !== "answered" &&
      gap.status !== "resolved" &&
      gap.status !== "dismissed",
  );

  const criticalGapCount = openGaps.filter((gap) => gap.priority === "high").length;

  if (criticalGapCount > 0) return "critical_gaps";
  if (openGaps.length > 0) return "needs_curation";
  return "mapped";
}

export async function syncProcessMapStatus(processMapId: string) {
  const processMap = await prisma.processMap.findUnique({
    where: { id: processMapId },
    include: { questions: true },
  });

  if (!processMap) return null;

  const processSignals = readJsonStringArray(processMap.processSignals);
  const graphBacked = processSignals.includes("procedure_neo4j");

  const newStatus = evaluateProcessStatus({
    graphBacked,
    gaps: processMap.questions,
  });

  if (newStatus !== processMap.status) {
    return prisma.processMap.update({
      where: { id: processMapId },
      data: { status: newStatus },
    });
  }

  return processMap;
}

export async function listProcessAutomationMaps(filters: ProcessMapListFilters = {}) {
  const rows = await prisma.processMap.findMany({
    include: {
      questions: true,
      automationCandidates: true,
    },
    orderBy: [{ automationReadinessScore: "desc" }, { name: "asc" }],
  }) as ProcessMapRecordWithRelations[];

  const normalizedSearch = filters.search ? normalizeText(filters.search) : "";
  const filteredRows = rows
    .map(formatProcessMapRow)
    .filter((row) => {
      if (filters.sector && filters.sector !== "all" && row.sector !== filters.sector) {
        return false;
      }
      if (filters.status && filters.status !== "all" && row.status !== filters.status) {
        return false;
      }
      if (
        filters.automationLevel &&
        filters.automationLevel !== "all" &&
        row.recommendedAutomationLevel !== filters.automationLevel
      ) {
        return false;
      }
      if (filters.hasSystem === "yes" && !row.hasSystem) return false;
      if (filters.hasSystem === "no" && row.hasSystem) return false;
      if (filters.gaps === "with" && row.gapCount === 0) return false;
      if (filters.gaps === "without" && row.gapCount > 0) return false;
      if (filters.sourceScope && filters.sourceScope !== "all" && row.sourceScope !== filters.sourceScope) {
        return false;
      }
      if (!normalizedSearch) return true;

      const haystack = normalizeText([
        row.name,
        row.summary,
        row.sector,
        row.systemNames.join(" "),
        row.documentRefs.map((document) => document.title).join(" "),
      ].join(" "));

      return haystack.includes(normalizedSearch);
    });

  const kpis = {
    processesMapped: filteredRows.length,
    automationCandidates: filteredRows.reduce((total, row) => total + row.candidateCount, 0),
    processesWithCriticalGaps: filteredRows.filter((row) => row.criticalGapCount > 0).length,
    lowCoverageProcesses: filteredRows.filter((row) => row.documentationCoverageScore < 60).length,
    processesWithHumanInLoop: filteredRows.filter((row) => row.hasHumanCheckpoint).length,
  };

  const backlogQuestions = await prisma.processGapQuestion.findMany({
    where: {
      status: {
        notIn: ["answered", "resolved"],
      },
    },
    include: {
      processMap: true,
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 20,
  });
  const backlogCandidates = await prisma.automationCandidate.findMany({
    where: {
      status: {
        in: ["suggested", "triage", "triagem", "triaged"],
      },
    },
    include: {
      processMap: true,
      document: {
        select: {
          documentTitle: true,
          sector: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 20,
  });

  return {
    kpis,
    rows: filteredRows,
    backlog: {
      questions: backlogQuestions.map((question) => ({
        id: question.id,
        processMapId: question.processMapId,
        processName: question.processMap.name,
        sector: question.processMap.sector,
        question: question.question,
        priority: question.priority,
        status: question.status,
      })),
      candidates: backlogCandidates.map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        status: candidate.status,
        sector: candidate.sector,
        processMapId: candidate.processMapId,
        processName: candidate.processMap?.name ?? candidate.processName,
        documentTitle: candidate.document.documentTitle,
      })),
    },
    refreshedAt:
      filteredRows
        .map((row) => row.lastAnalyzedAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
  };
}

export async function getProcessAutomationMapDetail(processId: string) {
  const processMap = await prisma.processMap.findUnique({
    where: { id: processId },
    include: {
      questions: {
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      },
      automationCandidates: {
        include: {
          document: {
            select: {
              id: true,
              documentTitle: true,
              sector: true,
              status: true,
            },
          },
        },
      },
    },
  }) as Prisma.ProcessMapGetPayload<{
    include: {
      questions: true;
      automationCandidates: {
        include: {
          document: {
            select: {
              id: true;
              documentTitle: true;
              sector: true;
              status: true;
            };
          };
        };
      };
    };
  }> | null;

  if (!processMap) {
    return null;
  }

  const documentRefs = readJsonDocumentRefs(processMap.documentRefs);
  const systemNames = readJsonStringArray(processMap.systemNames);
  const vectorEvidence = readJsonVectorEvidence(processMap.vectorEvidence);
  const processSignals = readJsonStringArray(processMap.processSignals);

  const topics = documentRefs
    .map((doc) => doc.topic)
    .filter((topic): topic is string => Boolean(topic));
  const knowledgeOwners =
    topics.length > 0
      ? await prisma.knowledgeOwner.findMany({
          where: { sector: processMap.sector, topic: { in: topics } },
        })
      : [];

  const documentRefsWithOwners = documentRefs.map((doc) => {
    const ownerRecord = knowledgeOwners.find((ko) => ko.topic === doc.topic);
    return {
      ...doc,
      ownerEmail: ownerRecord?.userEmail ?? null,
    };
  });

  const candidateIds = processMap.automationCandidates.map((c) => c.id);
  const auditEvents =
    candidateIds.length > 0
      ? await prisma.auditEvent.findMany({
          where: { eventType: "automation.queued" },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      : [];

  return {
    id: processMap.id,
    name: processMap.name,
    sector: processMap.sector,
    status: processMap.status,
    automationReadinessScore: processMap.automationReadinessScore,
    documentationCoverageScore: processMap.documentationCoverageScore,
    confidenceScore: processMap.confidenceScore,
    summary: processMap.summary,
    recommendedAutomationLevel: processMap.recommendedAutomationLevel,
    suggestedScriptType: processMap.suggestedScriptType,
    processSignals,
    systemNames,
    documentRefs: documentRefsWithOwners,
    graphEvidence: processMap.graphEvidence,
    vectorEvidence,
    questions: processMap.questions.map((question) => ({
      id: question.id,
      question: question.question,
      rationale: question.rationale,
      priority: question.priority,
      status: question.status,
      derivedFrom: question.derivedFrom,
      targetDocumentId: question.targetDocumentId,
      targetCurationDocumentId: question.targetCurationDocumentId,
      answeredAt: question.answeredAt?.toISOString() ?? null,
    })),
    candidates: processMap.automationCandidates.map((candidate) => {
      const history = auditEvents
        .filter((event) => {
          if (!event.payload || typeof event.payload !== "object") return false;
          return (event.payload as Record<string, unknown>).automationCandidateId === candidate.id;
        })
        .map((event) => ({
          id: event.id,
          createdAt: event.createdAt.toISOString(),
          traceId: event.traceId,
          sourceDocumentId:
            (event.payload as Record<string, unknown>).sourceDocumentId ?? null,
        }));

      return {
        id: candidate.id,
        title: candidate.title,
        processName: candidate.processName,
        automationLevel: candidate.automationLevel,
        suggestedScriptType: candidate.suggestedScriptType,
        confidence: candidate.confidence,
        status: candidate.status,
        document: candidate.document,
        runHistory: history,
      };
    }),
    actions: {
      openCurationHref: documentRefs.find((document) => document.source === "staging")
        ? `/admin/curation?sector=${documentRefs.find((document) => document.source === "staging")?.sector ?? processMap.sector}`
        : null,
      extractToGraphHref: `/admin/knowledge-graph`,
    },
  };
}

export async function updateProcessGapQuestionStatus(
  questionId: string,
  status: ProcessGapStatus,
) {
  const question = await prisma.processGapQuestion.findUnique({
    where: { id: questionId },
  });
  if (!question) {
    return null;
  }

  const updated = await prisma.processGapQuestion.update({
    where: { id: questionId },
    data: {
      status,
      answeredAt: status === "answered" ? new Date() : question.answeredAt,
    },
  });

  await syncProcessMapStatus(question.processMapId);

  return updated;
}

export async function promoteProcessGapQuestionToCuration(input: {
  questionId: string;
  actorId: string;
}) {
  const question = await prisma.processGapQuestion.findUnique({
    where: { id: input.questionId },
    include: {
      processMap: true,
      targetCurationDocument: {
        include: {
          reviews: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { questions: true },
          },
        },
      },
    },
  });

  if (!question) {
    throw new Error("Pergunta de lacuna nao encontrada.");
  }

  if (!question.targetCurationDocument) {
    throw new Error("Esta lacuna ainda nao possui documento-alvo na curadoria.");
  }

  if (question.targetCurationDocument.status === "REJECTED") {
    throw new Error("O documento-alvo nao aceita novas respostas de curadoria.");
  }

  const existingQuestions = questionsFromReview(question.targetCurationDocument.reviews[0]);
  const alreadyPresent = existingQuestions.some(
    (item) =>
      item.source === "process_gap" &&
      normalizeText(item.prompt) === normalizeText(question.question),
  );

  if (!alreadyPresent) {
    await prisma.documentReview.create({
      data: {
        curationDocumentId: question.targetCurationDocument.id,
        reviewedById: input.actorId,
        actorType: "agent",
        questions: toJson([
          ...existingQuestions,
          {
            id: `process_gap_${question.id}`,
            type: "gaps",
            prompt: question.question,
            required: false,
            source: "process_gap",
          },
        ]),
        notes: `Pergunta promovida automaticamente do mapa de processos: ${question.processMap.name}`,
      },
    });
  }

  await prisma.processGapQuestion.update({
    where: { id: question.id },
    data: { status: "promoted" },
  });

  await createAuditEvent({
    traceId: `process-gap-${question.id}`,
    actorType: "user",
    actorId: input.actorId,
    targetType: "document",
    targetId: question.targetCurationDocument.documentId,
    eventType: "process_gap.promoted_to_curation",
    payload: {
      processMapId: question.processMapId,
      processName: question.processMap.name,
      processGapQuestionId: question.id,
      targetCurationDocumentId: question.targetCurationDocument.id,
    },
  });

  return {
    questionId: question.id,
    targetCurationDocumentId: question.targetCurationDocument.id,
    targetDocumentId: question.targetCurationDocument.documentId,
    promoted: true,
    alreadyPresent,
  };
}

async function refreshPromotedDocumentFromGapAnswer(input: {
  document: PromotedGapTargetDocument;
  questions: CurationQuestion[];
  actorId: string;
  processMapId: string;
  processName: string;
  processGapQuestionId: string;
}) {
  const questionsForArtifact = input.questions.filter(
    (question) => question.source !== "inferred",
  );
  const rendered = renderCuratedArtifactMarkdown({
    document: input.document,
    questions: questionsForArtifact,
  });
  const artifactPath = await writeCuratedArtifactFile({
    sector: input.document.sector,
    sourceDocumentId: input.document.sourceDocumentId,
    documentType: rendered.documentType,
    markdown: rendered.markdown,
  });
  const preparedArtifact = prepareMarkdownDocument({
    fileName: `${input.document.sourceDocumentId}.md`,
    markdown: rendered.markdown,
    relativePath: artifactPath,
    responsibleArea: input.document.sector,
    sourceFormat: "markdown",
    sourceOrigin: "upload",
    title: input.document.documentTitle,
  });
  const chunksWithVectors = await Promise.all(
    preparedArtifact.chunks.map(async (chunk) => ({
      ...chunk,
      sourceDocumentId: input.document.sourceDocumentId,
      sensitivity: normalizeSensitivity(input.document.sensitivity),
      topic: input.document.topic,
      owner: input.document.owner,
      documentType: rendered.documentType,
      authorityLevel: input.document.authorityLevel,
      sourceType: rendered.sourceType,
      vector: await getEmbedding(chunk.content),
    })),
  );

  await replaceSectorSourceDocumentChunks(
    input.document.sector,
    input.document.sourceDocumentId,
    chunksWithVectors,
  );
  await Promise.all(
    SECTORS.filter((sector) => sector !== input.document.sector).flatMap((sector) => [
      replaceSectorSourceDocumentChunks(sector, input.document.sourceDocumentId, []),
      deleteStagedDocumentChunks(sector, input.document.sourceDocumentId),
    ]),
  );
  await deleteStagedDocumentChunks(
    input.document.sector,
    input.document.sourceDocumentId,
  );
  await prisma.curationDocument.update({
    where: { id: input.document.id },
    data: {
      sopPath: artifactPath,
      promotedAt: new Date(),
    },
  });
  await syncShareableKnowledgeCapabilities();

  await createAuditEvent({
    traceId: randomUUID(),
    actorType: "system",
    actorId: "curation",
    targetType: "document",
    targetId: input.document.documentId,
    eventType: "document.reindexed_from_process_gap_answer",
    payload: {
      processMapId: input.processMapId,
      processName: input.processName,
      processGapQuestionId: input.processGapQuestionId,
      sourceDocumentId: input.document.sourceDocumentId,
      artifactPath,
      documentType: rendered.documentType,
      sourceType: rendered.sourceType,
      chunksCreated: preparedArtifact.chunks.length,
      actorId: input.actorId,
    },
  });

  return {
    artifactPath,
    chunksCreated: preparedArtifact.chunks.length,
    documentType: rendered.documentType,
    sourceType: rendered.sourceType,
  };
}

export async function answerProcessGapQuestion(input: {
  questionId: string;
  actorId: string;
  response: string;
}) {
  const answer = input.response.trim();
  if (!answer) {
    throw new Error("Informe a resposta da lacuna.");
  }

  const question = await prisma.processGapQuestion.findUnique({
    where: { id: input.questionId },
    include: {
      processMap: true,
      targetCurationDocument: {
        include: {
          reviews: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { questions: true },
          },
        },
      },
    },
  });

  if (!question) {
    throw new Error("Pergunta de lacuna nao encontrada.");
  }

  if (!question.targetCurationDocument) {
    throw new Error("Esta lacuna ainda nao possui documento-alvo na curadoria.");
  }

  if (question.targetCurationDocument.status === "REJECTED") {
    throw new Error("O documento-alvo nao aceita novas respostas de curadoria.");
  }

  const reviewQuestionId = `process_gap_${question.id}`;
  const existingQuestions = questionsFromReview(question.targetCurationDocument.reviews[0]);
  const hasQuestion = existingQuestions.some(
    (item) =>
      item.id === reviewQuestionId ||
      (item.source === "process_gap" &&
        normalizeText(item.prompt) === normalizeText(question.question)),
  );
  const nextQuestions: CurationQuestion[] = hasQuestion
    ? existingQuestions.map((item) =>
        item.id === reviewQuestionId ||
        (item.source === "process_gap" &&
          normalizeText(item.prompt) === normalizeText(question.question))
          ? {
              ...item,
              id: reviewQuestionId,
              type: "gaps" as const,
              prompt: question.question,
              required: false,
              source: "process_gap" as const,
              response: answer,
              isDefault: false,
            }
          : item,
      )
    : [
        ...existingQuestions,
        {
          id: reviewQuestionId,
          type: "gaps" as const,
          prompt: question.question,
          required: false,
          source: "process_gap" as const,
          response: answer,
          isDefault: false,
        },
      ];

  await prisma.documentReview.create({
    data: {
      curationDocumentId: question.targetCurationDocument.id,
      reviewedById: input.actorId,
      actorType: "human",
      questions: toJson(nextQuestions),
      notes: `Resposta registrada pela inbox de lacunas do processo: ${question.processMap.name}`,
    },
  });

  const updatedQuestion = await prisma.processGapQuestion.update({
    where: { id: question.id },
    data: {
      status: "answered",
      answeredAt: new Date(),
    },
  });

  await syncProcessMapStatus(question.processMapId);

  let reindexResult: Awaited<
    ReturnType<typeof refreshPromotedDocumentFromGapAnswer>
  > | null = null;
  let reindexError: string | null = null;

  if (question.targetCurationDocument.status === "PROMOTED") {
    try {
      reindexResult = await refreshPromotedDocumentFromGapAnswer({
        document: question.targetCurationDocument,
        questions: nextQuestions,
        actorId: input.actorId,
        processMapId: question.processMapId,
        processName: question.processMap.name,
        processGapQuestionId: question.id,
      });
    } catch (error) {
      reindexError =
        error instanceof Error
          ? error.message
          : "Falha ao reprocessar documento produtivo.";
    }
  }

  await createAuditEvent({
    traceId: `process-gap-answer-${question.id}`,
    actorType: "user",
    actorId: input.actorId,
    targetType: "document",
    targetId: question.targetCurationDocument.documentId,
    eventType: "process_gap.answered",
    payload: {
      processMapId: question.processMapId,
      processName: question.processMap.name,
      processGapQuestionId: question.id,
      targetCurationDocumentId: question.targetCurationDocument.id,
    },
  });

  return {
    questionId: updatedQuestion.id,
    status: updatedQuestion.status,
    answeredAt: updatedQuestion.answeredAt?.toISOString() ?? null,
    targetCurationDocumentId: question.targetCurationDocument.id,
    targetDocumentId: question.targetCurationDocument.documentId,
    reindexed: Boolean(reindexResult),
    reindexError,
    artifactPath: reindexResult?.artifactPath ?? null,
    chunksCreated: reindexResult?.chunksCreated ?? null,
  };
}

export async function reprocessProcessGapDocumentAnswers(input: {
  curationDocumentId: string;
  actorId: string;
}) {
  const document = await prisma.curationDocument.findUnique({
    where: { id: input.curationDocumentId },
    include: {
      reviews: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { questions: true },
      },
    },
  });

  if (!document) {
    throw new Error("Documento de curadoria nao encontrado.");
  }

  if (document.status === "REJECTED") {
    throw new Error("O documento-alvo nao aceita reprocessamento.");
  }

  if (document.status !== "PROMOTED") {
    throw new Error(
      "Somente documentos promovidos precisam ser reprocessados. Para documentos em curadoria, as respostas serao aplicadas na promocao.",
    );
  }

  const questions = questionsFromReview(document.reviews[0]);
  const processGapQuestions = questions.filter(
    (question) => question.source === "process_gap",
  );
  const unansweredQuestion = processGapQuestions.find(
    (question) =>
      typeof question.response !== "string" || !question.response.trim(),
  );

  if (!processGapQuestions.length) {
    throw new Error("Nenhuma resposta de lacuna operacional foi encontrada para este documento.");
  }

  if (unansweredQuestion) {
    throw new Error("Responda todas as lacunas operacionais antes de reprocessar o documento.");
  }

  const reindexResult = await refreshPromotedDocumentFromGapAnswer({
    document,
    questions,
    actorId: input.actorId,
    processMapId: "document-wide",
    processName: "Reprocessamento consolidado de lacunas operacionais",
    processGapQuestionId: "all",
  });

  return {
    targetCurationDocumentId: document.id,
    targetDocumentId: document.documentId,
    reindexed: true,
    artifactPath: reindexResult.artifactPath,
    chunksCreated: reindexResult.chunksCreated,
  };
}

export async function updateAutomationCandidate(input: {
  candidateId: string;
  status?: string;
  processMapId?: string | null;
}) {
  const candidate = await prisma.automationCandidate.findUnique({
    where: { id: input.candidateId },
  });

  if (!candidate) {
    return null;
  }

  if (input.processMapId) {
    const processMap = await prisma.processMap.findUnique({
      where: { id: input.processMapId },
      select: { id: true },
    });
    if (!processMap) {
      throw new Error("Processo informado nao existe.");
    }
  }

  return prisma.automationCandidate.update({
    where: { id: input.candidateId },
    data: {
      ...(typeof input.status === "string" && input.status.trim()
        ? { status: input.status.trim() }
        : {}),
      ...(input.processMapId !== undefined ? { processMapId: input.processMapId } : {}),
    },
  });
}

export const PROCESS_AUTOMATION_SETUP_MESSAGE =
  "O mapa de processos ainda nao esta pronto neste ambiente. Rode `npm run db:migrate` e, se o dev server ja estava aberto antes da mudanca de schema, reinicie o `npm run dev`.";

export function isProcessAutomationPersistenceError(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybeError = error as {
    code?: unknown;
    message?: unknown;
    meta?: { table?: unknown; column?: unknown } | null;
  };

  if (maybeError.code === "P2021" || maybeError.code === "P2022") {
    return true;
  }

  const message =
    typeof maybeError.message === "string" ? maybeError.message.toLowerCase() : "";
  const table =
    typeof maybeError.meta?.table === "string"
      ? maybeError.meta.table.toLowerCase()
      : "";
  const column =
    typeof maybeError.meta?.column === "string"
      ? maybeError.meta.column.toLowerCase()
      : "";

  return (
    message.includes("process_maps") ||
    message.includes("process_gap_questions") ||
    message.includes("process_map_id") ||
    table.includes("process_maps") ||
    table.includes("process_gap_questions") ||
    column.includes("process_map_id")
  );
}
