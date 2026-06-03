import type { ChatCitation, DelegationTrace, Sector, GenerationMetrics } from "@/lib/domain";
import type { SearchMatch } from "@/lib/markdown";

export type Capability = {
  id: string;
  name: string;
  description: string;
  isExposed: boolean;
};

export type AgentPersona = {
  name: string;
  summary: string;
  instructions: string;
  capabilities: Capability[];
};

export type DelegationDecision = {
  delegate: boolean;
  target?: string;
  intent?: string;
  protocol?: string;
  question?: string;
  rationale?: string;
  allowedSourceDocumentIds?: string[];
};

export type ExternalAgentContext = {
  label: string;
  markdown: string;
  guidance: string;
};

export type AgentRunOptions = {
  traceId: string;
  parentTraceId?: string;
  sector: string;
  question: string;
  conversationId?: string;
  allowDelegation?: boolean;
  useRag?: boolean;
  useGraph?: boolean;
  externalContext?: ExternalAgentContext;
  emit?: (event: AgentStreamEvent) => void;
};

export type AgentResponse = {
  answer: string;
  citations: ChatCitation[];
  trace: DelegationTrace[];
  matches: SearchMatch[];
  /**
   * True when the agent grounded its answer in relevant evidence (relevant
   * local/graph matches, a relevant cross-sector citation, or an external
   * source). False signals a genuine knowledge gap that should be enqueued for
   * curation — see `determineAgentAnswered`.
   */
  answered: boolean;
};

export type AgentRpcPayload = {
  traceId: string;
  parentTraceId?: string;
  fromAgent: string;
  toAgent: string;
  intent: string;
  protocol: string;
  question: string;
  searchQuestion?: string;
  allowedSourceDocumentIds?: string[];
};

export type AgentStreamEvent =
  | { type: "status"; data: { message: string } }
  | { type: "message"; data: { chunk: string } }
  | { type: "delegation_start"; data: DelegationTrace }
  | { type: "delegation_result"; data: DelegationTrace }
  | {
      type: "done";
      data: {
        traceId: string;
        citations: ChatCitation[];
        metrics?: GenerationMetrics;
        answered?: boolean;
      };
    }
  | { type: "error"; message: string };

/**
 * Events streamed back from the chat-generation consumer to the producer over
 * the RabbitMQ reply queue. Mirrors what `runSectorAgent` emits — see
 * docs/allByQueue.md. Reused rather than duplicated so the contract stays in
 * lock-step with the in-process emit path.
 */
export type ChatStreamEvent = AgentStreamEvent;

/**
 * Serializable job published to the `chat.requests` queue (see docs/allByQueue.md).
 * The consumer reconstructs a `runSectorAgent` call from these fields and wires
 * its own `emit` that publishes each `ChatStreamEvent` to the reply queue.
 */
export type ChatJob = {
  traceId: string;
  parentTraceId?: string;
  sector: string;
  question: string;
  conversationId?: string;
  allowDelegation: boolean;
  useRag: boolean;
  useGraph: boolean;
  externalContext?: ExternalAgentContext;
};
