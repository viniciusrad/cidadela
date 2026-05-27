import type {
  CurationDocument,
  DocumentCorrelationRun,
  Prisma,
} from "@prisma/client";

import { appConfig } from "@/lib/config";
import { createAuditEvent } from "@/lib/db/audit-repo";
import { prisma } from "@/lib/db/client";
import { type DocumentSourceFormat, prepareMarkdownDocument, previewText, sha256 } from "@/lib/markdown";
import { generateJson, getEmbedding } from "@/lib/ollama";
import {
  type AdminChunkRow,
  listStagedDocumentChunks,
  replaceStagedSourceDocumentChunks,
  semanticSearchSectorChunks,
} from "@/lib/qdrant";

export type CorrelationSeverity = "low" | "medium" | "high" | "critical";
export type CorrelationFindingType =
  | "duplicate"
  | "contradiction"
  | "scope_mismatch"
  | "obsolete_policy"
  | "missing_supersedes"
  | "sensitivity_mismatch"
  | "procedure_gap";
export type CorrelationFindingStatus = "open" | "resolved" | "dismissed";

export type CorrelationRelatedChunk = {
  documentId: string;
  sourceDocumentId?: string;
  documentTitle: string;
  fileName: string;
  headingPathText: string;
  chunkIndex: number;
  score: number;
  contentPreview: string;
};

export type CorrelationResolution = {
  answer: string;
  decision: "validated" | "dismissed" | "revised_staging";
  resolvedById: string;
  resolvedAt: string;
  revisedChunkPreview?: string;
};

export type CorrelationFinding = {
  id: string;
  type: CorrelationFindingType;
  severity: CorrelationSeverity;
  status: CorrelationFindingStatus;
  stagedChunkIndex: number;
  stagedHeadingPathText: string;
  stagedContentPreview: string;
  relatedChunk: CorrelationRelatedChunk;
  issue: string;
  question: string;
  recommendation?: string;
  resolution?: CorrelationResolution;
};

type ModelFinding = {
  candidateId?: unknown;
  type?: unknown;
  severity?: unknown;
  issue?: unknown;
  question?: unknown;
  recommendation?: unknown;
};

type ModelCorrelationResponse = {
  summary?: unknown;
  findings?: ModelFinding[];
};

type Candidate = {
  id: string;
  stagedChunk: AdminChunkRow;
  relatedChunk: AdminChunkRow;
  score: number;
};

const TOP_K_PER_STAGED_CHUNK = 5;
const MAX_MODEL_CANDIDATES = 24;
const MIN_CORRELATION_SCORE = 0.52;
const BLOCKING_SEVERITIES = new Set<CorrelationSeverity>(["high", "critical"]);
const FINDING_TYPES = new Set<CorrelationFindingType>([
  "duplicate",
  "contradiction",
  "scope_mismatch",
  "obsolete_policy",
  "missing_supersedes",
  "sensitivity_mismatch",
  "procedure_gap",
]);
const SEVERITIES = new Set<CorrelationSeverity>([
  "low",
  "medium",
  "high",
  "critical",
]);

function asJsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function asFindings(value: Prisma.JsonValue | undefined): CorrelationFinding[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((finding): finding is CorrelationFinding => {
    if (!finding || typeof finding !== "object") {
      return false;
    }

    return (
      "id" in finding &&
      "type" in finding &&
      "severity" in finding &&
      "status" in finding
    );
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function findingType(value: unknown): CorrelationFindingType {
  const normalized = stringValue(value) as CorrelationFindingType;
  return FINDING_TYPES.has(normalized) ? normalized : "procedure_gap";
}

function severityValue(value: unknown): CorrelationSeverity {
  const normalized = stringValue(value) as CorrelationSeverity;
  return SEVERITIES.has(normalized) ? normalized : "medium";
}

function sourceFormat(value: string): DocumentSourceFormat {
  if (value === "docx" || value === "doc" || value === "pdf") {
    return value;
  }

  return "markdown";
}

function questionFromFinding(finding: CorrelationFinding) {
  return {
    id: `correlation_${finding.id}`,
    findingId: finding.id,
    type: "correlation",
    required: BLOCKING_SEVERITIES.has(finding.severity),
    prompt: finding.question,
  };
}

function correlationStatus(findings: CorrelationFinding[]) {
  return hasOpenCorrelationBlockers(findings) ? "BLOCKED" : "PASSED";
}

function rowPreview(row: AdminChunkRow) {
  return previewText(row.content || row.contentPreview);
}

function buildCorrelationPrompt(input: {
  sector: string;
  documentTitle: string;
  candidates: Candidate[];
}) {
  const candidates = input.candidates
    .map((candidate) =>
      [
        `CANDIDATE_ID: ${candidate.id}`,
        `SIMILARITY: ${candidate.score.toFixed(4)}`,
        `SETOR: ${input.sector}`,
        `NOVO_CHUNK_INDEX: ${candidate.stagedChunk.chunkIndex}`,
        `NOVO_SECAO: ${candidate.stagedChunk.headingPathText}`,
        `NOVO_CONTEUDO: ${rowPreview(candidate.stagedChunk)}`,
        `VALIDADO_DOCUMENTO: ${candidate.relatedChunk.documentTitle}`,
        `VALIDADO_ARQUIVO: ${candidate.relatedChunk.fileName}`,
        `VALIDADO_CHUNK_INDEX: ${candidate.relatedChunk.chunkIndex}`,
        `VALIDADO_SECAO: ${candidate.relatedChunk.headingPathText}`,
        `VALIDADO_CONTEUDO: ${rowPreview(candidate.relatedChunk)}`,
      ].join("\n"),
    )
    .join("\n\n---\n\n");

  return [
    "Voce e um revisor de conformidade de base RAG setorial.",
    "Compare chunks novos em staging contra chunks produtivos ja validados do mesmo setor.",
    "Aponte apenas achados relevantes para consistencia da base: duplicidade, contradicao, escopo divergente, politica obsoleta, supersedes ausente, sensibilidade divergente ou lacuna de procedimento.",
    "Nao invente fatos fora dos trechos. Se nao houver inconformidade relevante, retorne findings vazio.",
    "Se houver contradicao ou incompatibilidade que possa afetar respostas do agente, use severity high ou critical.",
    "Responda somente JSON valido no formato:",
    '{"summary":"...","findings":[{"candidateId":"c1","type":"contradiction","severity":"high","issue":"...","question":"...","recommendation":"..."}]}',
    "",
    `Documento novo: ${input.documentTitle}`,
    "",
    candidates,
  ].join("\n");
}

function normalizeModelFindings(input: {
  modelFindings: ModelFinding[];
  candidates: Candidate[];
}) {
  const candidatesById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const findings: CorrelationFinding[] = [];

  for (const modelFinding of input.modelFindings) {
    const candidateId = stringValue(modelFinding.candidateId);
    const candidate = candidatesById.get(candidateId);

    if (!candidate) {
      continue;
    }

    const issue = stringValue(modelFinding.issue);
    const question = stringValue(modelFinding.question);

    if (!issue || !question) {
      continue;
    }

    const severity = severityValue(modelFinding.severity);
    const type = findingType(modelFinding.type);

    findings.push({
      id: `${candidate.id}_${findings.length + 1}`,
      type,
      severity,
      status: "open",
      stagedChunkIndex: candidate.stagedChunk.chunkIndex,
      stagedHeadingPathText: candidate.stagedChunk.headingPathText,
      stagedContentPreview: rowPreview(candidate.stagedChunk),
      relatedChunk: {
        documentId: candidate.relatedChunk.documentId,
        sourceDocumentId: candidate.relatedChunk.sourceDocumentId,
        documentTitle: candidate.relatedChunk.documentTitle,
        fileName: candidate.relatedChunk.fileName,
        headingPathText: candidate.relatedChunk.headingPathText,
        chunkIndex: candidate.relatedChunk.chunkIndex,
        score: Number(candidate.score.toFixed(4)),
        contentPreview: rowPreview(candidate.relatedChunk),
      },
      issue,
      question,
      recommendation: stringValue(modelFinding.recommendation) || undefined,
    });
  }

  return findings;
}

export function findingsFromCorrelationRun(
  run?: Pick<DocumentCorrelationRun, "findings"> | null,
) {
  return asFindings(run?.findings);
}

export function hasOpenCorrelationBlockers(findings: CorrelationFinding[]) {
  return findings.some(
    (finding) =>
      finding.status === "open" && BLOCKING_SEVERITIES.has(finding.severity),
  );
}

export function correlationGateFromRun(
  run?: Pick<DocumentCorrelationRun, "id" | "status" | "createdAt" | "summary" | "findings"> | null,
) {
  const findings = findingsFromCorrelationRun(run);
  const blockingFindings = findings.filter(
    (finding) =>
      finding.status === "open" && BLOCKING_SEVERITIES.has(finding.severity),
  );

  return {
    runId: run?.id,
    status: run?.status ?? "NOT_RUN",
    createdAt: run?.createdAt,
    summary: run?.summary,
    findings,
    blockingFindings,
    canApprove: Boolean(run) && blockingFindings.length === 0,
  };
}

export async function runDocumentCorrelation(input: {
  document: CurationDocument;
  actorId: string;
  traceId: string;
}) {
  await createAuditEvent({
    traceId: input.traceId,
    actorType: "user",
    actorId: input.actorId,
    targetType: "document",
    targetId: input.document.documentId,
    eventType: "document.correlation_started",
    payload: {
      documentId: input.document.documentId,
      sector: input.document.sector,
      model: appConfig.ollamaClassifierModel,
    },
  });

  const stagedChunks = await listStagedDocumentChunks(
    input.document.sector,
    input.document.sourceDocumentId,
  );
  const candidateBatches = await Promise.all(
    stagedChunks.map(async (stagedChunk) => {
      const vector = await getEmbedding(stagedChunk.content);
      const result = await semanticSearchSectorChunks(input.document.sector, vector, {
        limit: TOP_K_PER_STAGED_CHUNK,
      });

      return result.rows
        .filter((row) => (row.score ?? 0) >= MIN_CORRELATION_SCORE)
        .map((relatedChunk) => ({
          id: `c${stagedChunk.chunkIndex}_${relatedChunk.chunkIndex}_${relatedChunk.documentId.slice(0, 8)}`,
          stagedChunk,
          relatedChunk,
          score: relatedChunk.score ?? 0,
        }));
    }),
  );
  const candidates = candidateBatches
    .flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MODEL_CANDIDATES);

  if (candidates.length === 0) {
    const run = await prisma.documentCorrelationRun.create({
      data: {
        curationDocumentId: input.document.id,
        triggeredById: input.actorId,
        model: appConfig.ollamaClassifierModel,
        status: "PASSED",
        summary: "Nenhum chunk produtivo correlato foi encontrado para revisao.",
        findings: asJsonInput([]),
        questions: asJsonInput([]),
        resolvedAt: new Date(),
      },
    });

    return run;
  }

  const modelResponse = await generateJson<ModelCorrelationResponse>(
    buildCorrelationPrompt({
      sector: input.document.sector,
      documentTitle: input.document.documentTitle,
      candidates,
    }),
  );
  const findings = normalizeModelFindings({
    modelFindings: Array.isArray(modelResponse.findings)
      ? modelResponse.findings
      : [],
    candidates,
  });
  const questions = findings.map(questionFromFinding);
  const status = correlationStatus(findings);

  const run = await prisma.documentCorrelationRun.create({
    data: {
      curationDocumentId: input.document.id,
      triggeredById: input.actorId,
      model: appConfig.ollamaClassifierModel,
      status,
      summary:
        stringValue(modelResponse.summary) ||
        (findings.length > 0
          ? "Correlacao encontrou pontos para validacao humana."
          : "Correlacao sem inconformidades relevantes."),
      findings: asJsonInput(findings),
      questions: asJsonInput(questions),
      resolvedAt: hasOpenCorrelationBlockers(findings) ? undefined : new Date(),
    },
  });

  await createAuditEvent({
    traceId: input.traceId,
    actorType: "agent",
    actorId: "correlation-agent",
    targetType: "document",
    targetId: input.document.documentId,
    eventType: "document.correlation_completed",
    payload: {
      documentId: input.document.documentId,
      runId: run.id,
      status,
      findings: findings.length,
      blockingFindings: findings.filter((finding) =>
        BLOCKING_SEVERITIES.has(finding.severity),
      ).length,
    },
  });

  if (findings.length > 0) {
    await createAuditEvent({
      traceId: input.traceId,
      actorType: "agent",
      actorId: "correlation-agent",
      targetType: "document",
      targetId: input.document.documentId,
      eventType: "document.correlation_findings_emitted",
      payload: {
        documentId: input.document.documentId,
        runId: run.id,
        findings: findings.map((finding) => ({
          id: finding.id,
          type: finding.type,
          severity: finding.severity,
          stagedChunkIndex: finding.stagedChunkIndex,
          relatedDocumentId: finding.relatedChunk.documentId,
        })),
      },
    });
  }

  return run;
}

function buildRevisionPrompt(input: {
  documentTitle: string;
  originalChunk: string;
  relatedChunkPreview: string;
  finding: CorrelationFinding;
  answer: string;
}) {
  return [
    "Voce vai revisar apenas um chunk de um documento em staging.",
    "Preserve a funcionalidade, o escopo e as informacoes que nao conflitam.",
    "Ajuste somente o trecho necessario para ficar compativel com a resposta do curador e com o chunk produtivo validado.",
    "Nao adicione explicacoes fora do conteudo revisado.",
    "Responda JSON valido no formato: {\"revisedChunk\":\"...\"}",
    "",
    `Documento: ${input.documentTitle}`,
    `Achado: ${input.finding.issue}`,
    `Pergunta: ${input.finding.question}`,
    `Resposta do curador: ${input.answer}`,
    "",
    `Chunk produtivo validado relacionado: ${input.relatedChunkPreview}`,
    "",
    `Chunk original em staging:\n${input.originalChunk}`,
  ].join("\n");
}

function replaceChunkInMarkdown(markdown: string, originalChunk: string, revisedChunk: string) {
  if (markdown.includes(originalChunk)) {
    return markdown.replace(originalChunk, revisedChunk);
  }

  return [
    markdown.trim(),
    "",
    "## Ajuste de curadoria aplicado",
    revisedChunk.trim(),
  ].join("\n");
}

export async function resolveCorrelationFinding(input: {
  document: CurationDocument;
  run: DocumentCorrelationRun;
  findingId: string;
  actorId: string;
  answer: string;
  decision: "validated" | "dismissed" | "revised_staging";
  traceId: string;
}) {
  const findings = findingsFromCorrelationRun(input.run);
  const finding = findings.find((item) => item.id === input.findingId);

  if (!finding) {
    throw new Error("Achado de correlacao nao encontrado.");
  }

  let revisedChunkPreview: string | undefined;

  if (input.decision === "revised_staging") {
    const stagedChunks = await listStagedDocumentChunks(
      input.document.sector,
      input.document.sourceDocumentId,
    );
    const stagedChunk = stagedChunks.find(
      (chunk) => chunk.chunkIndex === finding.stagedChunkIndex,
    );

    if (!stagedChunk) {
      throw new Error("Chunk de staging relacionado ao achado nao foi encontrado.");
    }

    const revision = await generateJson<{ revisedChunk?: unknown }>(
      buildRevisionPrompt({
        documentTitle: input.document.documentTitle,
        originalChunk: stagedChunk.content,
        relatedChunkPreview: finding.relatedChunk.contentPreview,
        finding,
        answer: input.answer,
      }),
    );
    const revisedChunk = stringValue(revision.revisedChunk);

    if (!revisedChunk) {
      throw new Error("Modelo nao retornou chunk revisado.");
    }

    const normalizedMarkdown = replaceChunkInMarkdown(
      input.document.normalizedMarkdown,
      stagedChunk.content,
      revisedChunk,
    );
    const prepared = prepareMarkdownDocument({
      fileName: input.document.fileName,
      markdown: normalizedMarkdown,
      relativePath: input.document.relativePath ?? undefined,
      responsibleArea: input.document.sector,
      sourceFormat: sourceFormat(input.document.sourceFormat),
      sourceOrigin: "upload",
      title: input.document.documentTitle,
    });
    const chunksWithVectors = await Promise.all(
      prepared.chunks.map(async (chunk) => ({
        ...chunk,
        sourceDocumentId: input.document.sourceDocumentId,
        vector: await getEmbedding(chunk.content),
      })),
    );

    await replaceStagedSourceDocumentChunks(
      input.document.sector,
      input.document.sourceDocumentId,
      chunksWithVectors,
    );
    await prisma.curationDocument.update({
      where: { id: input.document.id },
      data: {
        normalizedMarkdown,
        contentHash: sha256(normalizedMarkdown),
        status: "NEEDS_REVISION",
      },
    });
    await prisma.documentApproval.deleteMany({
      where: { curationDocumentId: input.document.id },
    });
    revisedChunkPreview = previewText(revisedChunk);
  }

  const resolvedAt = new Date().toISOString();
  const nextFindings = findings.map((item) =>
    item.id === input.findingId
      ? {
          ...item,
          status:
            input.decision === "dismissed"
              ? ("dismissed" as const)
              : ("resolved" as const),
          resolution: {
            answer: input.answer,
            decision: input.decision,
            resolvedById: input.actorId,
            resolvedAt,
            revisedChunkPreview,
          },
        }
      : item,
  );
  const nextStatus = correlationStatus(nextFindings);
  const nextRun = await prisma.documentCorrelationRun.update({
    where: { id: input.run.id },
    data: {
      status: nextStatus,
      findings: asJsonInput(nextFindings),
      questions: asJsonInput(nextFindings.map(questionFromFinding)),
      resolvedAt: hasOpenCorrelationBlockers(nextFindings) ? null : new Date(),
    },
  });

  await createAuditEvent({
    traceId: input.traceId,
    actorType: "user",
    actorId: input.actorId,
    targetType: "document",
    targetId: input.document.documentId,
    eventType: "document.correlation_finding_resolved",
    payload: {
      documentId: input.document.documentId,
      runId: input.run.id,
      findingId: input.findingId,
      decision: input.decision,
      revisedStaging: input.decision === "revised_staging",
    },
  });

  return nextRun;
}
