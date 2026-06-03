import { randomUUID } from "node:crypto";

import type { AgentCallStatus, Prisma } from "@prisma/client";

import { AGENT_PERSONAS } from "@/lib/agents/personas";
import { formatProtocolQuestion } from "@/lib/agents/protocols";
import {
  findEffectiveProtocol,
  getEffectiveAgent,
  getEffectiveAvailableTargets,
  getEffectiveProtocols,
} from "@/lib/agents/effective";
import type {
  AgentPersona,
  AgentResponse,
  AgentRunOptions,
  AgentRpcPayload,
  ExternalAgentContext,
} from "@/lib/agents/types";
import { searchDatabaseDocuments } from "@/lib/agents/database-search";
import { searchGraphDocuments } from "@/lib/agents/graph-search";
import {
  buildPersonalityBlock,
  getAgentPersonality,
} from "@/lib/agents/personality";
import {
  buildEpisodesBlock,
  retrieveRelevantEpisodes,
} from "@/lib/memory/episodic";
import {
  buildFewShotBlock,
  retrieveFewShotExamples,
} from "@/lib/memory/procedural";
import { requestAgent, safePublishAuditEvent } from "@/lib/bus/publisher";
import { createAgentCall } from "@/lib/db/audit-repo";
import type { ChatCitation, DelegationTrace, Sector, GenerationMetrics } from "@/lib/domain";
import type { SearchMatch } from "@/lib/markdown";
import { getGraphContextForQuestion } from "@/lib/graph/query-context";
import { getEmbedding, generateAnswerStream, rerankDocuments } from "@/lib/ollama";
import { searchChunks } from "@/lib/qdrant";
import { appConfig } from "@/lib/config";

const MIN_RELEVANT_SCORE = 0.3;

// DOMAIN_ROUTING removed. Using database SectorAccessRules.

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractTechnicalTokens(value: string) {
  return Array.from(
    new Set(
      value.match(/\b[a-zA-Z]{1,8}\d{2,}[a-zA-Z0-9]*\b/g)?.map((token) =>
        normalizeSearchText(token),
      ) ?? [],
    ),
  );
}

function matchContainsTechnicalToken(match: SearchMatch, tokens: string[]) {
  if (tokens.length === 0) {
    return true;
  }

  const searchableText = normalizeSearchText(
    [
      match.documentId,
      match.documentTitle,
      match.fileName,
      match.headingPathText,
      match.content,
      match.contentPreview,
    ].join("\n"),
  );

  return tokens.some((token) => searchableText.includes(token));
}

export const RERANKER_MAX_CANDIDATES = 30;

export async function applyReranker(question: string, matches: SearchMatch[]) {
  if (!appConfig.rerankerEnabled || matches.length === 0) {
    return matches;
  }

  const head = matches.slice(0, RERANKER_MAX_CANDIDATES);
  const tail = matches.slice(RERANKER_MAX_CANDIDATES);

  try {
    const documents = head.map((m) => `${m.headingPathText}\n\n${m.content}`);
    const results = await rerankDocuments(question, documents);

    const reranked = head.map((match, index) => {
      const rerankResult = results.find((r) => r.index === index);
      return {
        ...match,
        score: rerankResult ? rerankResult.relevance_score : match.score,
      };
    });

    reranked.sort((a, b) => b.score - a.score);
    return [...reranked, ...tail];
  } catch (err) {
    console.error("[agent] reranker failed, falling back to vector scores:", err);
    return matches;
  }
}

function filterRelevantMatches(matches: SearchMatch[], question: string) {
  const technicalTokens = extractTechnicalTokens(question);

  return matches.filter((match) => {
    const hasContent = Boolean((match.content || match.contentPreview).trim());
    return (
      hasContent &&
      match.score >= MIN_RELEVANT_SCORE &&
      matchContainsTechnicalToken(match, technicalTokens)
    );
  });
}

function bestMatchScore(matches: SearchMatch[]) {
  return matches.reduce((best, match) => Math.max(best, match.score), 0);
}

function bestCitationScore(citations: ChatCitation[]) {
  return citations.reduce(
    (best, citation) => Math.max(best, citation.score ?? 0),
    0,
  );
}

function bestDelegatedCitationScore(trace: DelegationTrace[]) {
  return trace
    .filter((item) => item.status === "ok" && hasRelevantCitations(item.citations))
    .reduce(
      (best, item) => Math.max(best, bestCitationScore(item.citations)),
      0,
    );
}

function hasRelevantCitations(citations: ChatCitation[]) {
  return citations.some((citation) => {
    const hasContent = Boolean(
      (citation.content || citation.contentPreview || "").trim(),
    );
    return hasContent && (citation.score === undefined || citation.score >= MIN_RELEVANT_SCORE);
  });
}

/**
 * Decides whether the agent actually answered the question with grounded
 * evidence, as opposed to declaring a knowledge gap. This is the single source
 * of truth the chat route uses to enqueue unanswered questions for curation.
 *
 * It is deliberately stricter than "did we produce any citation": graph
 * enrichment can inject chunks that clear the vector score floor but do not
 * match the question's technical token (e.g. "ZSD9999"). Those chunks stay in
 * the LLM context, but they must NOT count as an answer — otherwise the agent
 * tells the user "marcada para curadoria" while the row is never created.
 *
 * `relevantMatches` must already be passed through `filterRelevantMatches`, so
 * irrelevant graph/local chunks are excluded from the answered decision while
 * remaining available to the prompt.
 */
export function determineAgentAnswered({
  relevantMatches,
  trace,
  hasExternalContext,
}: {
  relevantMatches: SearchMatch[];
  trace: DelegationTrace[];
  hasExternalContext: boolean;
}): boolean {
  if (hasExternalContext) {
    return true;
  }
  if (relevantMatches.length > 0) {
    return true;
  }
  return trace.some(
    (item) => item.status === "ok" && hasRelevantCitations(item.citations),
  );
}

function matchesToCitations(
  sector: string,
  matches: SearchMatch[],
): ChatCitation[] {
  return matches.map((match) => ({
    sector,
    documentId: match.documentId,
    sourceDocumentId: match.sourceDocumentId,
    documentTitle: match.documentTitle,
    fileName: match.fileName,
    headingPathText: match.headingPathText,
    chunkIndex: match.chunkIndex,
    score: match.score,
    content: match.content,
    contentPreview: match.contentPreview,
  }));
}

function renderMatches(matches: SearchMatch[], sector: string) {
  if (matches.length === 0) {
    return "Nenhum trecho relevante foi recuperado na base do setor.";
  }

  return matches
    .map((match, index) => {
      // Strip [grafo] brackets to avoid confusing the model about citation format.
      // "[grafo]" in the Section line looks identical to a citation marker like "[1]".
      const section = match.headingPathText.replace(/^\[grafo\]\s*/i, "(via grafo) ");
      return [
        `[Trecho ${index + 1}] (setor=${sector})`,
        `Documento: ${match.documentTitle}`,
        `Arquivo: ${match.fileName}`,
        `Secao: ${section}`,
        match.content,
      ].join("\n");
    })
    .join("\n\n");
}

async function renderDelegationContext(trace: DelegationTrace[], startIndex: number) {
  const successfulTrace = trace.filter(
    (item) =>
      item.status === "ok" &&
      item.answer &&
      hasRelevantCitations(item.citations),
  );

  if (successfulTrace.length === 0) {
    return "Nenhum retorno intersetorial foi anexado.";
  }

  let citationIndex = startIndex;

  const { getPersonaForSector } = await import("@/lib/agents/personas");
  
  const renderedTraces = await Promise.all(successfulTrace
    .map(async (item, traceIndex) => {
      const targetPersona = await getPersonaForSector(item.to);
      const targetName = targetPersona?.name ?? item.to;
      const header = [
        `[Consulta ${traceIndex + 1}]`,
        `Agente consultado: ${targetName}`,
        `Setor consultado: ${item.to}`,
        `Intent: ${item.intent}`,
        `Pergunta enviada: ${item.question}`,
        `Resposta recebida: ${item.answer}`,
      ].join("\n");

      if (item.citations.length === 0) {
        return header;
      }

      const renderedCitations = item.citations
        .map((citation) => {
          const content = citation.content ?? citation.contentPreview ?? "";
          const block = [
            `[Trecho ${citationIndex}] (setor=${citation.sector}, via delegacao)`,
            `Documento: ${citation.documentTitle}`,
            `Arquivo: ${citation.fileName}`,
            `Secao: ${citation.headingPathText}`,
            content,
          ].join("\n");
          citationIndex += 1;
          return block;
        })
        .join("\n\n");

      return `${header}\n\nTrechos de origem desta consulta:\n${renderedCitations}`;
    }));
    
  return renderedTraces.join("\n\n");
}

async function buildPrompt({
  sector,
  question,
  matches,
  trace,
  preferDelegatedEvidence,
  graphNote,
  persona,
  externalContext,
}: {
  sector: string;
  question: string;
  matches: SearchMatch[];
  trace: DelegationTrace[];
  preferDelegatedEvidence: boolean;
  graphNote?: string | null;
  persona: AgentPersona;
  externalContext?: ExternalAgentContext;
}) {
  const capabilitiesList = persona.capabilities
    .map((c) => `- ${c.name}: ${c.description}`)
    .join("\n");

  const collaborators = await getEffectiveAvailableTargets(sector);
  const { getPersonaForSector } = await import("@/lib/agents/personas");
  const collaboratorsListBlocks = await Promise.all(collaborators
    .map(async (c) => {
      const targetPersona = await getPersonaForSector(c.target);
      if (!targetPersona) return "";
      const exposedCaps = targetPersona.capabilities
        .filter((cap) => cap.isExposed)
        .map((cap) => `  * ${cap.name}: ${cap.description}`)
        .join("\n");
      return `- Setor ${c.target} (Agente ${targetPersona.name}):\n${exposedCaps}`;
    }));
  const collaboratorsList = collaboratorsListBlocks.filter(Boolean).join("\n\n");
  const personality = await getAgentPersonality(sector);
  const episodes = await retrieveRelevantEpisodes(sector, question, { topK: 3 });
  const fewShots = await retrieveFewShotExamples(sector, question, { topK: 2 });

  return [
    persona.instructions,
    personality ? buildPersonalityBlock(personality) : "",
    episodes.length > 0 ? buildEpisodesBlock(episodes) : "",
    fewShots.length > 0 ? buildFewShotBlock(fewShots) : "",
    "",
    "Suas CAPACIDADES EXPLICITAS sao:",
    capabilitiesList,
    "",
    "COLABORADORES DISPONIVEIS (Agentes de outros setores que voce pode consultar):",
    collaboratorsList || "- Nenhum colaborador disponivel para este setor.",
    "",
    "Responda em portugues do Brasil.",
    "Nao invente informacoes fora do contexto recuperado.",
    "Quando uma contribuicao vier de outro setor, atribua explicitamente a informacao ao agente e setor que a forneceram, por exemplo: \"Segundo o agente Helpdesk (setor suporte)...\".",
    "Se outro setor forneceu a unica evidencia relevante ou a evidencia mais forte, identifique esse agente/setor como a origem principal da resposta.",
    preferDelegatedEvidence
      ? "Como o melhor trecho local ficou abaixo do limiar de confianca e outro setor retornou evidencia mais forte, use a evidencia intersetorial como fonte principal da resposta. Use o contexto local apenas como apoio secundario quando nao contradisser o setor mais relevante."
      : "",
    "Se nenhum setor retornou trechos relevantes, diga que a pergunta foi marcada para curadoria/correcao da base de conhecimento.",
    "",
    "=== REGRA OBRIGATORIA DE CITACAO ===",
    "O contexto abaixo contem trechos numerados: [Trecho 1], [Trecho 2], [Trecho 3], etc.",
    "VOCE DEVE citar o numero do trecho entre colchetes imediatamente apos cada afirmacao que usar aquela informacao.",
    "Formato correto: 'O pedido e processado via FTP [1] e o layout e definido pelo cliente [2].'",
    "Formato ERRADO: citar pelo nome do documento, pelo hash, pelo ID ou nao citar nada.",
    "Nao adicione colchetes em frases que nao tem base em nenhum trecho.",
    "Informacao de outro setor (via delegacao) deve ser citada com o numero do trecho de delegacao, nunca com numeros de trechos locais.",
    "=== FIM DAS REGRAS ===",
    "",
    `Contexto do seu setor (${sector}):`,
    renderMatches(matches, sector),
    "",
    ...(graphNote ? [graphNote, ""] : []),
    "Contribuicoes protocoladas de outros agentes:",
    await renderDelegationContext(trace, matches.length + 1),
    "",
    ...(externalContext
      ? [
          `=== ${externalContext.label.toUpperCase()} (FONTE EXTERNA) ===`,
          externalContext.guidance,
          "",
          externalContext.markdown,
          "=== FIM DA FONTE EXTERNA ===",
          "",
        ]
      : []),
    `Pergunta do usuario: ${question}`,
    "Resposta:",
  ].join("\n");
}

function summarizeMatchesForRpc(targetSector: string, matches: SearchMatch[]) {
  if (matches.length === 0) {
    return `O setor ${targetSector} nao encontrou evidencia suficiente na propria base para responder com seguranca.`;
  }

  const bulletPoints = matches
    .slice(0, 3)
    .map((match) => match.content.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((content) => `- ${content}`);

  return [
    `Retorno do setor ${targetSector}:`,
    ...bulletPoints,
  ].join("\n");
}
async function resolveLocalMatches(
  sector: string,
  question: string,
  options: { sourceDocumentIds?: string[]; shareableOnly?: boolean } = {},
) {
  const vector = await getEmbedding(question);
  return searchChunks(vector, sector as Sector, options);
}

// Like resolveLocalMatches but accepts a pre-computed vector to avoid a
// redundant embedding call when the caller already has it.
async function resolveLocalMatchesWithVector(
  sector: string,
  vector: number[],
  options: { sourceDocumentIds?: string[]; shareableOnly?: boolean } = {},
) {
  return searchChunks(vector, sector as Sector, options);
}

export async function answerAgentInternally(payload: AgentRpcPayload) {
  const protocolDefinition = await findEffectiveProtocol(
    payload.fromAgent as Sector,
    payload.toAgent as Sector,
    payload.intent,
  );

  if (!protocolDefinition || protocolDefinition.id !== payload.protocol) {
    return {
      answer:
        "Nao foi possivel processar a consulta porque o protocolo informado nao e valido para este par de setores.",
      citations: [] as ChatCitation[],
      trace: [] as DelegationTrace[],
      matches: [] as SearchMatch[],
      status: "protocol_violation" as const,
    };
  }

  const sourceDocumentIds = payload.allowedSourceDocumentIds;
  const searchQuestion = payload.searchQuestion ?? payload.question;

  console.log(
    "[agent-rpc] search start from=%s to=%s intent=%s sourceFilter=%s shareableOnly=%o query=%o",
    payload.fromAgent,
    payload.toAgent,
    payload.intent,
    sourceDocumentIds ? sourceDocumentIds.length : "none",
    payload.fromAgent !== payload.toAgent,
    searchQuestion,
  );

  const rawMatches = await resolveLocalMatches(
    payload.toAgent,
    searchQuestion,
    {
      sourceDocumentIds:
        sourceDocumentIds && sourceDocumentIds.length > 0
          ? sourceDocumentIds
          : undefined,
      shareableOnly: payload.fromAgent !== payload.toAgent,
    },
  );

  const rerankedMatches = await applyReranker(searchQuestion, rawMatches);
  const matches = filterRelevantMatches(rerankedMatches, searchQuestion);

  console.log(
    "[agent-rpc] search result from=%s to=%s relevantMatches=%d top=%o",
    payload.fromAgent,
    payload.toAgent,
    matches.length,
    matches.slice(0, 3).map((match) => ({
      score: match.score,
      documentId: match.documentId,
      chunkIndex: match.chunkIndex,
      title: match.documentTitle,
    })),
  );
  const answer = summarizeMatchesForRpc(payload.toAgent, matches);

  return {
    answer,
    citations: matchesToCitations(payload.toAgent, matches),
    trace: [] as DelegationTrace[],
    matches,
    status: "ok" as const,
  };
}

type RunnableDelegationDecision = {
  delegate: true;
  target: string;
  intent: string;
  protocol: string;
  question: string;
  allowedSourceDocumentIds?: string[];
};

async function buildRequiredDelegations(
  origin: string,
  question: string,
): Promise<RunnableDelegationDecision[]> {
  const { getOutboundRules } = await import("@/lib/sectors/access-rules");
  const outboundRules = await getOutboundRules(origin);
  const normalizedQ = normalizeSearchText(question);
  const requiredTargets = new Set<string>();

  for (const rule of outboundRules) {
    if (rule.accessLevel === "denied") continue;
    
    if (rule.routingKeywords.some((kw) => normalizedQ.includes(normalizeSearchText(kw)))) {
      requiredTargets.add(rule.toSector);
    }
  }

  const protocols = await getEffectiveProtocols();
  const decisions: RunnableDelegationDecision[] = [];
  for (const target of requiredTargets) {
    const candidates = protocols.filter(
      (p) => p.from === origin && p.to === target && p.enabled,
    );
    if (candidates.length === 0) continue;
    const protocol = candidates[0];
    decisions.push({
      delegate: true,
      target,
      intent: protocol.intent,
      protocol: protocol.id,
      question,
    });
  }
  return decisions;
}

async function buildFanoutDecisions(
  origin: string,
  question: string,
): Promise<RunnableDelegationDecision[]> {
  const decisions: RunnableDelegationDecision[] = [];
  const targets = await getEffectiveAvailableTargets(origin);

  for (const target of targets) {
    const protocol = await findEffectiveProtocol(origin as Sector, target.target as Sector, target.intent);
    if (!protocol) {
      continue;
    }

    decisions.push({
      delegate: true,
      target: target.target,
      intent: protocol.intent,
      protocol: protocol.id,
      question,
    });
  }

  return decisions;
}

async function consultDelegatedAgent({
  traceId,
  parentTraceId,
  sector,
  decision,
  emit,
}: {
  traceId: string;
  parentTraceId?: string;
  sector: string;
  decision: RunnableDelegationDecision;
  emit?: AgentRunOptions["emit"];
}) {
  const startedTrace: DelegationTrace = {
    from: sector,
    to: decision.target,
    intent: decision.intent,
    protocol: decision.protocol,
    question: decision.question,
    status: "pending",
    citations: [],
  };

  emit?.({
    type: "delegation_start",
    data: startedTrace,
  });

  const { getPersonaForSector } = await import("@/lib/agents/personas");
  const targetPersona = await getPersonaForSector(decision.target);
  const targetName = targetPersona?.name ?? decision.target;
  emit?.({
    type: "status",
    data: { message: `Consultando o setor ${decision.target}...` },
  });
  emit?.({
    type: "message",
    data: {
      chunk: `\n\n*(Consultando ${targetName}, agente do setor ${decision.target}...)*\n\n`,
    },
  });

  const startedAt = Date.now();
  let agentCallStatus: AgentCallStatus = "ok";
  let agentCallResponse: unknown = null;

  try {
    const protocolDefinition = await findEffectiveProtocol(
      sector as Sector,
      decision.target as Sector,
      decision.intent,
    );

    if (!protocolDefinition) {
      throw new Error("Protocolo nao encontrado.");
    }

    const payload: AgentRpcPayload = {
      traceId: randomUUID(),
      parentTraceId: traceId,
      fromAgent: sector,
      toAgent: decision.target,
      intent: decision.intent,
      protocol: decision.protocol,
      question: formatProtocolQuestion(
        protocolDefinition.template,
        decision.question,
      ),
      searchQuestion: decision.question,
      allowedSourceDocumentIds: decision.allowedSourceDocumentIds,
    };

    const delegatedResponse = await requestAgent(payload);
    agentCallResponse = delegatedResponse;

    const resolvedTrace: DelegationTrace = {
      ...startedTrace,
      answer: delegatedResponse.answer,
      citations: delegatedResponse.citations,
      status: delegatedResponse.status,
    };

    emit?.({
      type: "delegation_result",
      data: resolvedTrace,
    });

    return resolvedTrace;
  } catch (error) {
    const originalStatus =
      error instanceof Error && error.message.toLowerCase().includes("timeout")
        ? "timeout"
        : error instanceof Error &&
            error.message.toLowerCase().includes("rabbitmq")
          ? "bus_unavailable"
          : "error";

    const fallbackResponse = await answerAgentInternally({
      traceId: randomUUID(),
      parentTraceId: traceId,
      fromAgent: sector,
      toAgent: decision.target,
      intent: decision.intent,
      protocol: decision.protocol,
      question: decision.question,
      searchQuestion: decision.question,
      allowedSourceDocumentIds: decision.allowedSourceDocumentIds,
    });

    if (fallbackResponse.status === "ok") {
      agentCallStatus = "ok";
      agentCallResponse = {
        ...fallbackResponse,
        transport: "local-fallback",
        originalStatus,
      };

      const recoveredTrace: DelegationTrace = {
        ...startedTrace,
        answer: fallbackResponse.answer,
        citations: fallbackResponse.citations,
        status: "ok",
      };

      emit?.({
        type: "delegation_result",
        data: recoveredTrace,
      });

      await safePublishAuditEvent({
        traceId,
        actorType: "agent",
        actorId: sector,
        targetType: "agent",
        targetId: decision.target,
        eventType: "delegation.local_fallback",
        payload: {
          intent: decision.intent,
          protocol: decision.protocol,
          originalStatus,
        },
      });

      return recoveredTrace;
    }

    agentCallStatus = originalStatus;

    const failedTrace: DelegationTrace = {
      ...startedTrace,
      answer:
        "A consulta intersetorial nao retornou a tempo. A resposta final seguira apenas com o contexto local disponivel.",
      citations: [],
      status:
        agentCallStatus === "timeout"
          ? "timeout"
          : agentCallStatus === "bus_unavailable"
            ? "bus_unavailable"
            : "error",
    };

    emit?.({
      type: "delegation_result",
      data: failedTrace,
    });

    return failedTrace;
  } finally {
    await createAgentCall({
      traceId,
      parentTraceId,
      fromAgent: sector,
      toAgent: decision.target,
      intent: decision.intent,
      protocol: decision.protocol,
      request: {
        question: decision.question,
        allowedSourceDocumentIds: decision.allowedSourceDocumentIds,
      },
      response: agentCallResponse as Prisma.InputJsonValue | undefined,
      status: agentCallStatus,
      latencyMs: Date.now() - startedAt,
    });

    await safePublishAuditEvent({
      traceId,
      actorType: "agent",
      actorId: sector,
      targetType: "agent",
      targetId: decision.target,
      eventType: `delegation.${agentCallStatus}`,
      payload: {
        intent: decision.intent,
        protocol: decision.protocol,
      },
    });
  }
}

export async function runSectorAgent({
  traceId,
  parentTraceId,
  sector,
  question,
  allowDelegation = true,
  useRag = true,
  useGraph = true,
  externalContext,
  emit,
}: AgentRunOptions): Promise<AgentResponse> {
  const effective = await getEffectiveAgent(sector);
  emit?.({
    type: "status",
    data: {
      message: useRag
        ? `Recuperando contexto do setor ${sector}...`
        : `Consultando documentos validados no banco SQL do setor ${sector}...`,
    },
  });

  const startSearch = performance.now();
  const questionVector = useRag ? await getEmbedding(question) : null;
  const initialMatches = questionVector
    ? await resolveLocalMatchesWithVector(sector, questionVector)
    : useGraph
      ? await searchGraphDocuments(sector as Sector, question)
      : await searchDatabaseDocuments(sector as Sector, question);
  
  const rawMatches = await applyReranker(question, initialMatches);
  const matches = filterRelevantMatches(rawMatches, question);
  const bestLocalEvidenceScore = bestMatchScore(matches);

  // Graph enrichment depends on the vector path because it adds Qdrant chunks.
  const graphCtx = useRag && useGraph && questionVector
    ? await getGraphContextForQuestion(question, questionVector, matches, sector as Sector)
    : { extraMatches: [], graphNote: null };
  const allMatches = [...matches, ...graphCtx.extraMatches];

  console.log(
    "[agent] graph-enrichment sector=%s extraMatches=%d graphNote=%s",
    sector,
    graphCtx.extraMatches.length,
    graphCtx.graphNote ? "yes" : "no",
  );

  const searchDurationMs = Math.round(performance.now() - startSearch);
  const trace: DelegationTrace[] = [];

  console.log(
    "[agent] local search sector=%s traceId=%s rawMatches=%d relevantMatches=%d bestLocalScore=%d threshold=%d top=%o",
    sector,
    traceId,
    rawMatches.length,
    matches.length,
    bestLocalEvidenceScore,
    effective.params.localConfidenceThreshold,
    rawMatches.slice(0, 3).map((match) => ({
      score: match.score,
      documentId: match.documentId,
      chunkIndex: match.chunkIndex,
      title: match.documentTitle,
    })),
  );

  if (allowDelegation && useRag) {
    const hasLocalEvidence = matches.length > 0;
    const hasConfidentLocalEvidence =
      hasLocalEvidence &&
      bestLocalEvidenceScore >= effective.params.localConfidenceThreshold;

    // Always run domain-required delegations regardless of local evidence.
    // This prevents the LLM from reading a routing rule from a document and
    // reporting it as the answer instead of actually delegating.
    const requiredDecisions = await buildRequiredDelegations(sector, question);

    if (requiredDecisions.length > 0) {
      console.log(
        "[agent] required-delegation start sector=%s traceId=%s targets=%o question=%o",
        sector,
        traceId,
        requiredDecisions.map((d) => d.target),
        question,
      );

      emit?.({
        type: "status",
        data: {
          message: "Consultando setor especializado para este topico...",
        },
      });

      const requiredTrace = await Promise.all(
        requiredDecisions.map((decision) =>
          consultDelegatedAgent({
            traceId,
            parentTraceId,
            sector,
            decision,
            emit,
          }),
        ),
      );

      trace.push(...requiredTrace);
    }

    const alreadyTargeted = new Set(requiredDecisions.map((d) => d.target));

    if (!hasConfidentLocalEvidence) {
      const fanoutReason = hasLocalEvidence
        ? "low_local_confidence"
        : "no_local_evidence";
      const fanoutDecisions = (await buildFanoutDecisions(sector, question)).filter(
        (d) => !alreadyTargeted.has(d.target),
      );

      console.log(
        "[agent] fanout start sector=%s traceId=%s reason=%s bestLocalScore=%d threshold=%d targets=%o question=%o",
        sector,
        traceId,
        fanoutReason,
        bestLocalEvidenceScore,
        effective.params.localConfidenceThreshold,
        fanoutDecisions.map((decision) => decision.target),
        question,
      );

      if (fanoutDecisions.length > 0) {
        emit?.({
          type: "status",
          data: {
            message:
              fanoutReason === "low_local_confidence"
                ? "Evidencia local abaixo do limiar de confianca; consultando os demais setores disponiveis..."
                : "Sem evidencia local suficiente; consultando os demais setores disponiveis...",
          },
        });
      }

      const fanoutTrace = await Promise.all(
        fanoutDecisions.map((fanoutDecision) =>
          consultDelegatedAgent({
            traceId,
            parentTraceId,
            sector,
            decision: fanoutDecision,
            emit,
          }),
        ),
      );

      trace.push(...fanoutTrace);

      console.log(
        "[agent] fanout complete sector=%s traceId=%s results=%o",
        sector,
        traceId,
        trace.map((item) => ({
          target: item.to,
          status: item.status,
          citations: item.citations.length,
          hasRelevantCitations: hasRelevantCitations(item.citations),
        })),
      );
    }
  }

  emit?.({
    type: "status",
    data: { message: "Redigindo resposta final..." },
  });

  const prompt = await buildPrompt({
    sector,
    question,
    matches: allMatches,
    trace,
    preferDelegatedEvidence:
      bestLocalEvidenceScore < effective.params.localConfidenceThreshold &&
      bestDelegatedCitationScore(trace) > bestLocalEvidenceScore,
    graphNote: graphCtx.graphNote,
    persona: effective.persona,
    externalContext,
  });

  let answer = "";
  let finalMetrics: GenerationMetrics | undefined;

  for await (const chunk of generateAnswerStream(prompt, { model: effective.params.chatModel })) {
    answer += chunk.chunk;
    if (chunk.metrics) {
      finalMetrics = {
        ...chunk.metrics,
        searchDurationMs,
      };
    }
    emit?.({
      type: "message",
      data: { chunk: chunk.chunk },
    });
  }

  const citations = [
    ...matchesToCitations(sector, allMatches),
    ...trace.flatMap((item) => item.citations),
  ];

  // Apply the strict relevance filter (score floor + technical-token match) to
  // ALL matches, including graph-enriched ones. The chunks themselves stayed in
  // the prompt, but only token-relevant evidence counts as a real answer.
  const relevantMatches = filterRelevantMatches(allMatches, question);
  const answered = determineAgentAnswered({
    relevantMatches,
    trace,
    hasExternalContext: externalContext !== undefined,
  });

  emit?.({
    type: "done",
    data: {
      traceId,
      citations,
      metrics: finalMetrics,
      answered,
    },
  });

  return {
    answer,
    citations,
    trace,
    matches: allMatches,
    answered,
  };
}
