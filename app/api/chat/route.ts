import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { runSectorAgent } from "@/lib/agents/base-agent";
import { jsonError } from "@/lib/api";
import {
  parseApprovalDecision,
  parseAutomationApprovalPayload,
  type AutomationApprovalRequest,
} from "@/lib/automation/approval";
import {
  detectHumanCaptchaAutomationIntent,
  type HumanCaptchaAutomationIntent,
} from "@/lib/automation/cervello-ticket";
import {
  extractSearchQuery,
  shouldTriggerPharmacyPriceLookup,
} from "@/lib/automation/pharmacy-price-intent";
import { searchPharmacies } from "@/lib/integrations/pharmacy-search";
import {
  describeMcpEdiOutcomeReason,
  detectMcpEdiIntent,
} from "@/lib/automation/mcp-edi-intent";
import {
  callMcpEdiTool,
  formatMcpEdiPayloadAsMarkdown,
} from "@/lib/integrations/mcp-edi";
import type { AgentStreamEvent, ExternalAgentContext } from "@/lib/agents/types";
import { ensureBusBootstrapped } from "@/lib/bus/bootstrap";
import { enqueueChatJob } from "@/lib/bus/chat-queue";
import { getChatQueueStats } from "@/lib/bus/queue-stats";
import { safePublishAuditEvent } from "@/lib/bus/publisher";
import { appConfig } from "@/lib/config";
import {
  createConversation,
  findConversationForUser,
  updateConversationTitle,
} from "@/lib/db/conversations-repo";
import {
  createAuditEvent,
  findLatestAutomationApprovalEvent,
} from "@/lib/db/audit-repo";
import { createMessage } from "@/lib/db/messages-repo";
import type { Sector } from "@/lib/domain";
import {
  launchCervelloElectronicOrderTicket,
  launchPfrmAutomationScript,
  type CervelloTicketLaunchRequest,
  type HumanCaptchaAutomationLaunchResponse,
} from "@/lib/integrations/human-captcha";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";

type ChatRequestBody = {
  question?: unknown;
  conversationId?: unknown;
  agentId?: unknown;
  useRag?: unknown;
  useGraph?: unknown;
};

type AutomationLaunchConfig = {
  intent: HumanCaptchaAutomationIntent;
  processKey: string;
  label: string;
  idempotencySuffix: string;
  statusMessage: string;
  finalMessage: string;
  pendingMessage: string;
  launch: (
    request: CervelloTicketLaunchRequest,
  ) => Promise<HumanCaptchaAutomationLaunchResponse>;
};

function emit(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: unknown,
) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

function buildConversationTitle(question: string) {
  return question.slice(0, 72).trim() || "Nova conversa";
}

function resolveAutomationLaunchConfig(
  intent: HumanCaptchaAutomationIntent,
): AutomationLaunchConfig {
  if (intent === "cervello-electronic-order") {
    return {
      intent,
      processKey: appConfig.humanCaptchaCervelloProcessKey,
      label: "Problemas no Pedido Eletronico",
      idempotencySuffix: "cervello-electronic-order",
      statusMessage: "Acionando criacao de chamado no Cervello...",
      finalMessage:
        "Acionei a criacao do chamado de Problemas no Pedido Eletronico no Cervello.",
      pendingMessage:
        "A tarefa humana ainda sera disponibilizada quando o worker abrir a sessao no Cervello.",
      launch: launchCervelloElectronicOrderTicket,
    };
  }

  if (intent === "medication-price-survey") {
    const processKey = appConfig.humanCaptchaMedicationPriceProcessKey;
    return {
      intent,
      processKey,
      label: "Pesquisa de precos de medicamentos",
      idempotencySuffix: "medication-price-survey",
      statusMessage: "Acionando pesquisa de precos de medicamentos...",
      finalMessage: "Acionei a automacao de pesquisa de precos de medicamentos.",
      pendingMessage:
        "A execucao foi enfileirada; o relatorio sera registrado no dashboard do human-in-captcha.",
      launch: (request) => launchPfrmAutomationScript(processKey, request),
    };
  }

  const processKey = appConfig.humanCaptchaCurrencyIndexProcessKey;
  return {
    intent,
    processKey,
    label: "Coleta de Indices e Moedas",
    idempotencySuffix: "currency-index-collection",
    statusMessage: "Acionando coleta de indices e moedas...",
    finalMessage: "Acionei a automacao de coleta de indices e moedas.",
    pendingMessage:
      "A execucao foi enfileirada; os arquivos gerados serao registrados no dashboard do human-in-captcha.",
    launch: (request) => launchPfrmAutomationScript(processKey, request),
  };
}

function approvalPrompt(config: AutomationLaunchConfig) {
  return [
    `Essa automacao pertence a Forja: ${config.label}.`,
    "Para acionar a partir deste agente, confirme e informe um motivo curto.",
    "",
    `Responda no formato: sim, motivo: <motivo da solicitacao>.`,
    "Para cancelar, responda: cancelar.",
  ].join("\n");
}

function buildApprovalRequest(
  config: AutomationLaunchConfig,
  requesterSector: Sector,
  originalQuestion: string,
  originalMessageId: string,
): AutomationApprovalRequest {
  return {
    approvalId: randomUUID(),
    intent: config.intent,
    processKey: config.processKey,
    label: config.label,
    ownerSector: "desenvolvimento",
    requesterSector,
    originalQuestion,
    originalMessageId,
    idempotencySuffix: config.idempotencySuffix,
  };
}

async function persistAssistantAndDone(input: {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  conversationId: string;
  traceId: string;
  sector: Sector;
  answer: string;
}) {
  emit(input.controller, input.encoder, {
    type: "message",
    data: { chunk: input.answer },
  });

  const dbMsg = await createMessage({
    conversationId: input.conversationId,
    role: "assistant",
    content: input.answer,
    citations: [],
    traceId: input.traceId,
    agentId: input.sector,
  });

  emit(input.controller, input.encoder, {
    type: "done",
    data: {
      conversationId: input.conversationId,
      messageId: dbMsg.id,
      traceId: input.traceId,
      citations: [],
    },
  });
}

async function launchAutomation(input: {
  config: AutomationLaunchConfig;
  traceId: string;
  conversationId: string;
  requestedBy: string;
  requesterSector: Sector;
  message: string;
  idempotencySourceMessageId: string;
  approvalReason?: string;
}) {
  return input.config.launch({
    idempotencyKey: `pfrm-secure-agents:${input.idempotencySourceMessageId}:${input.config.idempotencySuffix}`,
    traceId: input.traceId,
    conversationId: input.conversationId,
    requestedBy: input.requestedBy,
    userSector: input.requesterSector,
    message: input.message,
    approvalReason: input.approvalReason,
    requestedByAgent:
      input.requesterSector === "desenvolvimento"
        ? undefined
        : input.requesterSector,
    ownerAgent: "desenvolvimento",
  });
}

async function emitAutomationResult(input: {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  traceId: string;
  conversationId: string;
  sector: Sector;
  config: AutomationLaunchConfig;
  automation: HumanCaptchaAutomationLaunchResponse;
  prefix?: string;
}) {
  // Onda 3 — trilha narrativa: buscar AutomationCandidate pelo processKey para incluir
  // na auditoria sem exigir migration de schema (payload JSON ja suporta campos extras).
  const candidate = await prisma.automationCandidate
    .findFirst({
      where: {
        OR: [
          { processName: { contains: input.config.processKey, mode: "insensitive" } },
          { title: { contains: input.config.processKey, mode: "insensitive" } },
        ],
        sector: input.sector,
        status: { not: "rejected" },
      },
      select: { id: true, curationDocumentId: true, document: { select: { documentTitle: true } } },
      orderBy: { updatedAt: "desc" },
    })
    .catch((err) => {
      console.warn(
        "[chat] automation candidate lookup failed for processKey=%s sector=%s:",
        input.config.processKey,
        input.sector,
        err instanceof Error ? err.message : err,
      );
      return null;
    });

  emit(input.controller, input.encoder, {
    type: "automation_result",
    data: {
      ...input.automation,
      sourceDocumentId: candidate?.curationDocumentId ?? null,
      sourceDocumentTitle: candidate?.document?.documentTitle ?? null,
    },
  });

  await safePublishAuditEvent({
    traceId: input.traceId,
    actorType: "agent",
    actorId: input.sector,
    targetType: "automation",
    targetId: input.automation.runId,
    eventType: "automation.queued",
    payload: {
      processKey: input.automation.processKey,
      runUrl: input.automation.runUrl,
      nextTaskUrl: input.automation.nextTaskUrl,
      duplicate: input.automation.duplicate ?? false,
      // Campos de trilha narrativa (Onda 3)
      automationCandidateId: candidate?.id ?? null,
      sourceDocumentId: candidate?.curationDocumentId ?? null,
    },
  });

  const finalAnswer = [
    input.prefix ?? input.config.finalMessage,
    "",
    `Execucao: ${input.automation.runUrl}`,
    input.automation.nextTaskUrl
      ? `Proxima etapa humana: ${input.automation.nextTaskUrl}`
      : input.config.pendingMessage,
  ].join("\n");

  await persistAssistantAndDone({
    controller: input.controller,
    encoder: input.encoder,
    conversationId: input.conversationId,
    traceId: input.traceId,
    sector: input.sector,
    answer: finalAnswer,
  });
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return jsonError("Nao autenticado.", 401);
  }

  const body = (await request.json().catch(() => ({}))) as ChatRequestBody;
  const question =
    typeof body.question === "string" ? body.question.trim() : "";

  const selectedSector: Sector =
    session.user.role === "admin" && typeof body.agentId === "string"
      ? (body.agentId as Sector)
      : session.user.sector;

  const useRag = body.useRag === false ? false : true;
  const useGraph = body.useGraph !== false;

  if (!question) {
    return jsonError("Informe uma pergunta antes de consultar o agente.");
  }

  let conversation =
    typeof body.conversationId === "string" && body.conversationId.trim()
      ? await findConversationForUser(body.conversationId.trim(), session.user.id)
      : null;

  if (!conversation) {
    conversation = await createConversation(
      session.user.id,
      selectedSector,
      buildConversationTitle(question),
    );
  } else if (conversation.title === "Nova conversa") {
    conversation = await updateConversationTitle(
      conversation.id,
      buildConversationTitle(question),
    );
  }

  const traceId = randomUUID();

  const userMessage = await createMessage({
    conversationId: conversation.id,
    role: "user",
    content: question,
    traceId,
    agentId: selectedSector,
  });

  await safePublishAuditEvent({
    traceId,
    actorType: "user",
    actorId: session.user.id,
    targetType: "conversation",
    targetId: conversation.id,
    eventType: "user.question",
    payload: {
      sector: selectedSector,
    },
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await ensureBusBootstrapped().catch(() => undefined);

        const latestApprovalEvent = await findLatestAutomationApprovalEvent(
          conversation.id,
        );
        const pendingApproval =
          latestApprovalEvent?.eventType === "automation.approval_requested"
            ? parseAutomationApprovalPayload(latestApprovalEvent.payload)
            : null;

        if (pendingApproval) {
          const decision = parseApprovalDecision(question);
          const config = resolveAutomationLaunchConfig(pendingApproval.intent);

          if (decision.status === "cancelled") {
            await createAuditEvent({
              traceId,
              actorType: "agent",
              actorId: selectedSector,
              targetType: "conversation",
              targetId: conversation.id,
              eventType: "automation.approval_cancelled",
              payload: {
                ...pendingApproval,
                cancelledByMessageId: userMessage.id,
              },
            });

            await persistAssistantAndDone({
              controller,
              encoder,
              conversationId: conversation.id,
              traceId,
              sector: selectedSector,
              answer: `Cancelei a solicitacao para acionar ${pendingApproval.label}.`,
            });
            return;
          }

          if (decision.status === "needs_reason" || decision.status === "unknown") {
            await persistAssistantAndDone({
              controller,
              encoder,
              conversationId: conversation.id,
              traceId,
              sector: selectedSector,
              answer: [
                `Ainda preciso de uma confirmacao com motivo curto para acionar ${pendingApproval.label}.`,
                "",
                "Responda no formato: sim, motivo: <motivo da solicitacao>.",
                "Para cancelar, responda: cancelar.",
              ].join("\n"),
            });
            return;
          }

          await createAuditEvent({
            traceId,
            actorType: "agent",
            actorId: selectedSector,
            targetType: "conversation",
            targetId: conversation.id,
            eventType: "automation.approval_confirmed",
            payload: {
              ...pendingApproval,
              approvalReason: decision.reason,
              confirmedByMessageId: userMessage.id,
            },
          });

          emit(controller, encoder, {
            type: "automation_start",
            data: {
              processKey: config.processKey,
              label: config.label,
            },
          });
          emit(controller, encoder, {
            type: "status",
            data: { message: config.statusMessage },
          });

          const automation = await launchAutomation({
            config,
            traceId,
            conversationId: conversation.id,
            requestedBy: session.user.email,
            requesterSector: selectedSector,
            message: pendingApproval.originalQuestion,
            idempotencySourceMessageId: pendingApproval.originalMessageId,
            approvalReason: decision.reason,
          }).catch(async (error) => {
            await safePublishAuditEvent({
              traceId,
              actorType: "agent",
              actorId: selectedSector,
              targetType: "automation",
              targetId: config.processKey,
              eventType: "automation.failed",
              payload: {
                approvalId: pendingApproval.approvalId,
                error: error instanceof Error ? error.message : String(error),
              },
            });
            throw error;
          });

          await emitAutomationResult({
            controller,
            encoder,
            traceId,
            conversationId: conversation.id,
            sector: selectedSector,
            config,
            automation,
            prefix: `Confirmacao registrada. ${config.finalMessage}`,
          });
          return;
        }

        let pharmacyContext: ExternalAgentContext | undefined;
        let pharmacyPortalLink: string | undefined;

        const pharmacyIntentMatched = shouldTriggerPharmacyPriceLookup(question);
        const pharmacySectorAllowed =
          appConfig.searchPortalAllowedSectors.includes(selectedSector);

        console.log(
          "[chat] pharmacy-price-lookup intent=%s sectorAllowed=%s sector=%s allowedSectors=%o question=%o",
          pharmacyIntentMatched,
          pharmacySectorAllowed,
          selectedSector,
          appConfig.searchPortalAllowedSectors,
          question,
        );

        if (pharmacyIntentMatched && pharmacySectorAllowed) {
          const searchQuery = extractSearchQuery(question);
          console.log(
            "[chat] pharmacy-price-lookup dispatching searchQuery=%o portalUrl=%s",
            searchQuery,
            appConfig.searchPortalUrl,
          );

          emit(controller, encoder, {
            type: "status",
            data: { message: "Consultando precos em farmacias parceiras..." },
          });

          await safePublishAuditEvent({
            traceId,
            actorType: "agent",
            actorId: selectedSector,
            targetType: "conversation",
            targetId: conversation.id,
            eventType: "pharmacy.price_lookup.requested",
            payload: { query: searchQuery },
          });

          const lookup = await searchPharmacies(searchQuery);
          console.log(
            "[chat] pharmacy-price-lookup result ok=%s reason=%s count=%s",
            lookup.ok,
            lookup.ok ? "-" : lookup.reason,
            lookup.ok ? lookup.data.count : "-",
          );

          if (lookup.ok) {
            const portalHome = (() => {
              try {
                return new URL(appConfig.searchPortalPublicUrl).origin;
              } catch {
                return appConfig.searchPortalPublicUrl;
              }
            })();
            const portalWithQuery = `${portalHome}/?q=${encodeURIComponent(searchQuery)}`;
            pharmacyPortalLink = `\n\n[Explorar precos no portal parceiro](${portalWithQuery})`;

            // Extraimos APENAS o item mais barato e o entregamos ao LLM como
            // unica fonte: modelos pequenos (qwen3.5:4b) tendem a ecoar listas
            // grandes, entao reduzir o contexto e a forma mais confiavel de
            // forcar uma resposta curta. O link final e anexado server-side
            // apos o stream do LLM, garantindo que sempre apareca.
            const cheapest = lookup.data.results
              .flatMap((group) =>
                group.items.map((item) => ({ pharmacy: group.pharmacy, item })),
              )
              .filter((entry) => Number.isFinite(entry.item.price))
              .sort((a, b) => a.item.price - b.item.price)[0];

            const BRL = new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: "BRL",
            });

            const guidance =
              lookup.data.count > 0 && cheapest
                ? "Responda em UMA unica frase curta, em texto puro, citando o produto, a farmacia e o preco listados abaixo. Nao adicione listas, tabelas, cabecalhos, secoes, marcadores nem qualquer linha extra. Nao invente outras farmacias ou produtos. Nao consulte nem mencione outros setores."
                : "Responda em UMA unica frase curta informando que nao foi possivel obter precos agora e sugira reformular o nome do produto. Nao adicione listas nem cabecalhos. Nao consulte outros setores.";

            const markdown =
              lookup.data.count > 0 && cheapest
                ? `Melhor preco encontrado: ${cheapest.item.name}${
                    cheapest.item.brand ? ` (${cheapest.item.brand})` : ""
                  } na ${cheapest.pharmacy} por ${BRL.format(
                    cheapest.item.price,
                  )}.`
                : `Nenhum produto disponivel foi retornado para "${searchQuery}".`;

            pharmacyContext = {
              label: "Melhor preco encontrado",
              markdown,
              guidance,
            };

            await safePublishAuditEvent({
              traceId,
              actorType: "agent",
              actorId: selectedSector,
              targetType: "conversation",
              targetId: conversation.id,
              eventType: "pharmacy.price_lookup.completed",
              payload: {
                query: searchQuery,
                count: lookup.data.count,
                pharmacies: lookup.data.results.length,
              },
            });
          } else {
            await safePublishAuditEvent({
              traceId,
              actorType: "agent",
              actorId: selectedSector,
              targetType: "conversation",
              targetId: conversation.id,
              eventType: "pharmacy.price_lookup.failed",
              payload: {
                query: searchQuery,
                reason: lookup.reason,
                status: lookup.status,
              },
            });
          }
        }

        let mcpEdiContext: ExternalAgentContext | undefined;

        if (pharmacyContext === undefined && appConfig.mcpEdiEnabled) {
          const mcpEdiSectorAllowed =
            appConfig.mcpEdiAllowedSectors.includes(selectedSector);
          const mcpIntent = mcpEdiSectorAllowed
            ? detectMcpEdiIntent(question)
            : null;

          if (mcpIntent) {
            console.log(
              "[chat] mcp-edi dispatch sector=%s tool=%s args=%o",
              selectedSector,
              mcpIntent.tool,
              mcpIntent.arguments,
            );

            emit(controller, encoder, {
              type: "status",
              data: {
                message: `Consultando MCP-EDI (${mcpIntent.description})...`,
              },
            });

            await safePublishAuditEvent({
              traceId,
              actorType: "agent",
              actorId: selectedSector,
              targetType: "conversation",
              targetId: conversation.id,
              eventType: "mcp_edi.lookup.requested",
              payload: {
                tool: mcpIntent.tool,
                arguments: mcpIntent.arguments,
                description: mcpIntent.description,
              },
            });

            const outcome = await callMcpEdiTool(
              mcpIntent.tool,
              mcpIntent.arguments,
            );

            if (outcome.ok) {
              const markdown = formatMcpEdiPayloadAsMarkdown(
                mcpIntent.tool,
                outcome.data,
              );
              const guidance =
                outcome.data.total > 0
                  ? [
                      "Responda em portugues do Brasil usando exclusivamente os dados abaixo recuperados via MCP-EDI.",
                      "Cite explicitamente que a fonte e a base EDI consultada por MCP.",
                      "Nao invente campos que nao estao presentes nos registros.",
                      "Se a pergunta exigir interpretacao alem dos dados retornados, deixe claro que so foi possivel consultar a base EDI.",
                    ].join(" ")
                  : "Responda em uma frase curta informando que a consulta MCP-EDI nao retornou registros para os parametros recebidos. Sugira refinar a consulta (CNPJ, codigo, processo ou IDOC).";

              mcpEdiContext = {
                label: `MCP-EDI ${mcpIntent.tool}`,
                markdown,
                guidance,
              };

              await safePublishAuditEvent({
                traceId,
                actorType: "agent",
                actorId: selectedSector,
                targetType: "conversation",
                targetId: conversation.id,
                eventType: "mcp_edi.lookup.completed",
                payload: {
                  tool: mcpIntent.tool,
                  total: outcome.data.total,
                  rows: outcome.data.rows.length,
                },
              });
            } else {
              await safePublishAuditEvent({
                traceId,
                actorType: "agent",
                actorId: selectedSector,
                targetType: "conversation",
                targetId: conversation.id,
                eventType: "mcp_edi.lookup.failed",
                payload: {
                  tool: mcpIntent.tool,
                  reason: outcome.reason,
                  status: outcome.status,
                  message: outcome.message,
                },
              });

              mcpEdiContext = {
                label: `MCP-EDI ${mcpIntent.tool} (falha)`,
                markdown: [
                  `Tentativa de consulta MCP-EDI: ${mcpIntent.description}`,
                  "",
                  `Status: falha (${describeMcpEdiOutcomeReason(outcome.reason)}).`,
                  outcome.message ? `Mensagem do servidor: ${outcome.message}` : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
                guidance:
                  "Informe ao usuario em uma frase curta que a consulta MCP-EDI nao pode ser concluida e sugira tentar novamente ou validar o servidor MCP. Nao tente responder sobre os dados de EDI sem essa fonte.",
              };
            }
          }
        }

        const automationIntent =
          pharmacyContext !== undefined || mcpEdiContext !== undefined
            ? null
            : detectHumanCaptchaAutomationIntent(question);

        if (automationIntent) {
          const automationConfig =
            resolveAutomationLaunchConfig(automationIntent);

          if (selectedSector !== "desenvolvimento") {
            const approval = buildApprovalRequest(
              automationConfig,
              selectedSector,
              question,
              userMessage.id,
            );

            await createAuditEvent({
              traceId,
              actorType: "agent",
              actorId: selectedSector,
              targetType: "conversation",
              targetId: conversation.id,
              eventType: "automation.approval_requested",
              payload: approval,
            });

            await persistAssistantAndDone({
              controller,
              encoder,
              conversationId: conversation.id,
              traceId,
              sector: selectedSector,
              answer: approvalPrompt(automationConfig),
            });
            return;
          }

          emit(controller, encoder, {
            type: "automation_start",
            data: {
              processKey: automationConfig.processKey,
              label: automationConfig.label,
            },
          });
          emit(controller, encoder, {
            type: "status",
            data: { message: automationConfig.statusMessage },
          });

          await safePublishAuditEvent({
            traceId,
            actorType: "agent",
            actorId: selectedSector,
            targetType: "automation",
            targetId: automationConfig.processKey,
            eventType: "automation.requested",
            payload: {
              conversationId: conversation.id,
              messageId: userMessage.id,
            },
          });

          const automation = await launchAutomation({
            config: automationConfig,
            traceId,
            conversationId: conversation.id,
            requestedBy: session.user.email,
            requesterSector: selectedSector,
            message: question,
            idempotencySourceMessageId: userMessage.id,
          }).catch(async (error) => {
            await safePublishAuditEvent({
              traceId,
              actorType: "agent",
              actorId: selectedSector,
              targetType: "automation",
              targetId: automationConfig.processKey,
              eventType: "automation.failed",
              payload: {
                error: error instanceof Error ? error.message : String(error),
              },
            });
            throw error;
          });

          await emitAutomationResult({
            controller,
            encoder,
            traceId,
            conversationId: conversation.id,
            sector: selectedSector,
            config: automationConfig,
            automation,
          });
          return;
        }

        let finalAnswer = "";
        let finalCitations: unknown[] = [];
        let finalMetrics: unknown = undefined;
        let finalAnswered = true;

        // Shared event handler: identical for the inline fallback and the
        // queued path. Accumulates the final answer/citations/metrics and
        // proxies every other event straight to the HTTP stream.
        const handleAgentEvent = (event: AgentStreamEvent) => {
          if (event.type === "message") {
            finalAnswer += event.data.chunk;
          }

          if (event.type === "done") {
            finalCitations = event.data.citations;
            // Fall back to the citation count only if the agent did not emit
            // an explicit signal (older callers / partial streams).
            finalAnswered = event.data.answered ?? finalCitations.length > 0;
            if ("metrics" in event.data) {
              finalMetrics = event.data.metrics;
            }
            return;
          }

          emit(controller, encoder, event);
        };

        const allowDelegation =
          pharmacyContext === undefined && mcpEdiContext === undefined;

        if (appConfig.chatQueueEnabled) {
          // Backpressure path (docs/allByQueue.md): only the heavy
          // runSectorAgent execution is queued; auth/persistence/audit stay
          // here in the authenticated producer. Reply events are proxied
          // verbatim by handleAgentEvent, so the UI contract is unchanged.
          emit(controller, encoder, {
            type: "status",
            data: { message: "Sua pergunta entrou na fila de processamento..." },
          });

          const stats = await getChatQueueStats().catch(() => null);
          if (stats && stats.depth > 0) {
            emit(controller, encoder, {
              type: "status",
              data: {
                message: `Voce esta na fila de atendimento (aprox. ${stats.depth} a frente). Aguardando processamento...`,
              },
            });
          }

          await enqueueChatJob(
            {
              traceId,
              sector: selectedSector,
              question,
              conversationId: conversation.id,
              useRag,
              useGraph,
              allowDelegation,
              externalContext: pharmacyContext ?? mcpEdiContext,
            },
            handleAgentEvent,
          );
        } else {
          await runSectorAgent({
            traceId,
            sector: selectedSector,
            question,
            conversationId: conversation.id,
            useRag,
            useGraph,
            allowDelegation,
            externalContext: pharmacyContext ?? mcpEdiContext,
            emit: handleAgentEvent,
          });
        }

        if (pharmacyPortalLink) {
          emit(controller, encoder, {
            type: "message",
            data: { chunk: pharmacyPortalLink },
          });
          finalAnswer += pharmacyPortalLink;
        }

        const dbMsg = await createMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: finalAnswer.trim(),
          citations: finalCitations as never,
          traceId,
          agentId: selectedSector,
        });

        emit(controller, encoder, {
          type: "done",
          data: {
            traceId,
            citations: finalCitations,
            metrics: finalMetrics,
            conversationId: conversation.id,
            messageId: dbMsg.id,
          },
        });

        await safePublishAuditEvent({
          traceId,
          actorType: "agent",
          actorId: selectedSector,
          targetType: "conversation",
          targetId: conversation.id,
          eventType: "agent.answer",
          payload: {
            sector: selectedSector,
            retrieval: {
              rag: useRag,
              graph: useGraph,
            },
            metrics: finalMetrics,
          },
        });

        if (!finalAnswered) {
          await safePublishAuditEvent({
            traceId,
            actorType: "agent",
            actorId: selectedSector,
            targetType: "conversation",
            targetId: conversation.id,
            eventType: "agent.unanswered",
            payload: {
              sector: selectedSector,
              question,
            },
          });

          // Best-effort: register the unanswered question in the curation queue.
          // Idempotent by traceId; failures here must never break the chat stream.
          try {
            await prisma.unansweredQuestion.upsert({
              where: { traceId },
              update: {},
              create: {
                traceId,
                conversationId: conversation.id,
                askedById: session.user.id,
                sector: selectedSector,
                question,
              },
            });
          } catch (queueError) {
            console.error("[/api/chat] failed to enqueue unanswered question", {
              traceId,
              message:
                queueError instanceof Error ? queueError.message : String(queueError),
            });
          }
        }
      } catch (error) {
        const cause =
          error instanceof Error && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
        console.error("[/api/chat] stream error", {
          traceId,
          sector: selectedSector,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          cause,
        });
        emit(controller, encoder, {
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Falha inesperada ao consultar o agente.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
