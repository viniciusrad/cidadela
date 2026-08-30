"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Database, Network, Search } from "lucide-react";

import type { ChatCitation, DelegationTrace, Sector, UserRole, GenerationMetrics } from "@/lib/domain";
import { SECTORS } from "@/lib/domain";
import { PERSONA_LABELS, SECTOR_LABELS, getSectorLabel } from "@/lib/labels";

type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
  lastMessage?: string;
};

type MessageItem = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: ChatCitation[];
  feedback?: "good" | "bad";
  metrics?: GenerationMetrics;
  agentId?: Sector;
  traceId: string;
  createdAt: string;
};

type ChatUser = {
  id: string;
  name: string;
  email: string;
  sector: Sector;
  role: UserRole;
};

type AutomationResult = {
  runId: string;
  processKey: string | null;
  label: string;
  runUrl: string;
  nextTaskUrl: string | null;
  duplicate?: boolean;
  sourceDocumentId?: string | null;
  sourceDocumentTitle?: string | null;
};

type ChatEvent =
  | { type: "status"; data: { message: string } }
  | { type: "message"; data: { chunk: string } }
  | { type: "delegation_start"; data: DelegationTrace }
  | { type: "delegation_result"; data: DelegationTrace }
  | {
      type: "automation_start";
      data: {
        processKey: string;
        label: string;
      };
    }
  | { type: "automation_result"; data: AutomationResult }
  | {
      type: "done";
      data: {
        conversationId: string;
        traceId: string;
        citations: ChatCitation[];
        metrics?: GenerationMetrics;
        messageId?: string;
      };
    }
  | { type: "error"; message: string };

const THUMBS_UP_SVG = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
  </svg>
);

const THUMBS_DOWN_SVG = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2" />
  </svg>
);

const PENCIL_SVG = (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
    <path d="m15 5 4 4"/>
  </svg>
);

const CHEVRON_SVG = (

  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
  </svg>
);

const CHEVRON_LEFT_SVG = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
    <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
  </svg>
);

const CHEVRON_RIGHT_SVG = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
  </svg>
);

const FEEDBACK_PROMPTS = [
  "Sua avaliação nos ajuda a mapear o conhecimento da companhia e facilitar o trabalho de todos. Como foi essa resposta?",
  "Ao classificar esta resposta, você contribui diretamente para a precisão da nossa inteligência. Vamos agregar valor juntos?",
  "Sua colaboração é fundamental para construirmos uma base de conhecimento que facilite seu dia a dia. O que achou?",
];

const NEGATIVE_MODAL_PROMPTS = [
  (q: string) =>
    `Sua pergunta era: "${q.slice(0, 120)}${q.length > 120 ? "..." : ""}". O que ficou faltando nessa resposta? Consegue nos dizer o que esperava receber? Seu comentário vai guiar a melhoria do agente.`,
  (q: string) =>
    `Você perguntou: "${q.slice(0, 120)}${q.length > 120 ? "..." : ""}". Entendemos que a resposta não foi satisfatória. Pode nos dizer o que estava incorreto ou incompleto? Isso ajuda diretamente o trabalho de curadoria.`,
  (q: string) =>
    `Pergunta registrada: "${q.slice(0, 120)}${q.length > 120 ? "..." : ""}". Para melhorar nossa base de conhecimento, seria de grande ajuda saber o que você esperava como resposta ideal.`,
];

function getFeedbackPrompt(messageId: string) {
  let hash = 0;
  for (let i = 0; i < messageId.length; i++) {
    hash = (hash << 5) - hash + messageId.charCodeAt(i);
    hash |= 0;
  }
  return FEEDBACK_PROMPTS[Math.abs(hash) % FEEDBACK_PROMPTS.length];
}

function getNegativeModalPrompt(messageId: string, question: string) {
  let hash = 0;
  for (let i = 0; i < messageId.length; i++) {
    hash = (hash << 5) - hash + messageId.charCodeAt(i);
    hash |= 0;
  }
  return NEGATIVE_MODAL_PROMPTS[Math.abs(hash) % NEGATIVE_MODAL_PROMPTS.length](question);
}

function getCitationSourceLabel() {
  return "Documento oficial";
}

function CitationCard({
  citation,
  index,
  highlighted,
  onRef,
  id,
}: {
  citation: ChatCitation;
  index: number;
  highlighted: boolean;
  onRef?: (el: HTMLDivElement | null) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"chunk" | "full">("chunk");
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [isLoadingFull, setIsLoadingFull] = useState(false);
  
  const hasContent = Boolean(citation.content || citation.contentPreview);
  const scorePercent = citation.score ? Math.round(citation.score * 100) : null;

  const loadFullDocument = async () => {
    if (fullContent || isLoadingFull) return;
    
    setIsLoadingFull(true);
    try {
      const sourceId = citation.sourceDocumentId || citation.documentId;
      const response = await fetch(`/api/chat/documents?sector=${citation.sector}&sourceDocumentId=${sourceId}`);
      if (!response.ok) throw new Error("Falha ao carregar documento.");
      const data = await response.json();
      setFullContent(data.content);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingFull(false);
    }
  };

  const handleToggleOpen = () => {
    if (!hasContent) return;
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && viewMode === "full") {
      loadFullDocument();
    }
  };

  const handleSwitchMode = (mode: "chunk" | "full") => {
    setViewMode(mode);
    if (mode === "full") {
      loadFullDocument();
    }
  };

  return (
    <div
      id={id}
      ref={onRef}
      className={`citation-card${highlighted ? " citation-card--highlighted" : ""}`}
    >
      <div
        className="citation-header"
        onClick={handleToggleOpen}
      >
        <div className="citation-meta">
          <span className="citation-number">{index + 1}</span>
          <div className="citation-info">
            <p className="citation-title">
              {getSectorLabel(citation.sector)} | {citation.documentTitle}
            </p>
            <span
              className="mt-1 inline-flex w-fit rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700"
              title="Fonte publicada e disponivel para consulta pelo chat."
            >
              {getCitationSourceLabel()}
            </span>
            <p className="citation-section">{citation.headingPathText}</p>
          </div>
        </div>
        {hasContent ? (
          <button
            className={`citation-toggle${open ? " citation-toggle--open" : ""}`}
            type="button"
            onClick={(e) => { e.stopPropagation(); handleToggleOpen(); }}
          >
            {open ? "Fechar" : "Visualizar"}
            {CHEVRON_SVG}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="citation-content">
          <div className="flex gap-1 rounded-xl bg-[var(--surface-muted)] p-1 mb-4 w-fit">
            <button
              className={`rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
                viewMode === "chunk"
                  ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                  : "text-[var(--foreground-soft)] hover:text-[var(--foreground-strong)]"
              }`}
              onClick={(e) => { e.stopPropagation(); handleSwitchMode("chunk"); }}
              type="button"
            >
              Trecho indexado
            </button>
            <button
              className={`rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
                viewMode === "full"
                  ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                  : "text-[var(--foreground-soft)] hover:text-[var(--foreground-strong)]"
              }`}
              onClick={(e) => { e.stopPropagation(); handleSwitchMode("full"); }}
              type="button"
            >
              Documento completo
            </button>
          </div>

          <pre className="max-h-[400px] overflow-auto">
            {viewMode === "chunk" 
              ? (citation.content || citation.contentPreview || "")
              : (isLoadingFull ? "Carregando documento completo..." : (fullContent || "Erro ao carregar conteúdo."))
            }
          </pre>
          
          {viewMode === "chunk" && scorePercent !== null ? (
            <div className="citation-score">
              <span>Relevancia {scorePercent}%</span>
              <div className="citation-score-bar">
                <div
                  className="citation-score-fill"
                  style={{ width: `${scorePercent}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function renderContentWithRefs(
  content: string,
  citations: ChatCitation[],
  onRefClick: (index: number) => void,
  onEditChunk?: (citation: ChatCitation, index: number) => void,
): ReactNode[] {
  const parts: ReactNode[] = [];
  // Matches markdown link [label](url) OR a citation ref [1] / [Trecho 1].
  // The link alternative comes first so that "[1](http://...)" is treated as a
  // link rather than partially matched as a citation.
  const regex = /\[([^\]\n]+)\]\(([^)\s]+)\)|\[(?:Trecho )?(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const [, linkLabel, linkUrl, refRaw] = match;

    if (linkUrl) {
      const safe = /^(https?:|mailto:)/i.test(linkUrl);
      if (!safe) continue;
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index));
      }
      parts.push(
        <a
          key={`link-${match.index}`}
          href={linkUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[var(--primary)] underline hover:text-[var(--primary-hover)]"
        >
          {linkLabel}
        </a>,
      );
      lastIndex = match.index + match[0].length;
      continue;
    }

    const refNum = parseInt(refRaw, 10);
    if (refNum < 1 || refNum > citations.length) {
      continue;
    }
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={`ref-container-${match.index}`} className="inline-flex items-center gap-1 mx-0.5">
        <span
          key={`ref-${match.index}`}
          className="ref-badge"
          title={`Ver fonte: ${citations[refNum - 1].documentTitle}`}
          onClick={() => onRefClick(refNum - 1)}
          role="button"
          tabIndex={0}
        >
          {refNum}
        </span>
        {onEditChunk && (
          <button
            className="text-[var(--primary)] hover:text-[var(--primary-hover)] opacity-50 hover:opacity-100 transition-opacity flex items-center justify-center"
            title="Sugerir correção para este trecho"
            onClick={() => onEditChunk(citations[refNum - 1], refNum - 1)}
          >
            {PENCIL_SVG}
          </button>
        )}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [content];
}

const CONVERSATIONS_PAGE_SIZE = 5;

export function SecureChatWorkbench({
  initialConversations,
  initialConversationId,
  totalConversations: initialTotal,
  user,
}: {
  initialConversations: ConversationSummary[];
  initialConversationId: string | null;
  totalConversations: number;
  user: ChatUser;
}) {
  const [conversations, setConversations] =
    useState<ConversationSummary[]>(initialConversations);
  const [totalConversations, setTotalConversations] = useState(initialTotal);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    initialConversationId,
  );
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [question, setQuestion] = useState("");
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [streamingTrace, setStreamingTrace] = useState<DelegationTrace[]>([]);
  const [streamingAutomation, setStreamingAutomation] =
    useState<AutomationResult | null>(null);
  const [traceCollapsed, setTraceCollapsed] = useState(true);
  const [statusText, setStatusText] = useState("Ambiente pronto.");
  const [error, setError] = useState("");
  const [highlightedCitation, setHighlightedCitation] = useState<number | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Sector>(user.sector);
  const [useRag, setUseRag] = useState(true);
  const [useGraph, setUseGraph] = useState(true);
  const [editingChunk, setEditingChunk] = useState<{
    citation: ChatCitation;
    messageId: string;
    index: number;
  } | null>(null);
  const [proposedContent, setProposedContent] = useState("");
  const [isSubmittingCorrection, setIsSubmittingCorrection] = useState(false);
  const [badFeedbackModal, setBadFeedbackModal] = useState<{ messageId: string; question: string } | null>(null);
  const [badFeedbackComment, setBadFeedbackComment] = useState("");
  const [isSubmittingBadFeedback, setIsSubmittingBadFeedback] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowStreamRef = useRef(true);

  const handleRefClick = useCallback((messageId: string, index: number) => {
    setHighlightedCitation(index);
    const el = document.getElementById(`citation-${messageId}-${index}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setTimeout(() => setHighlightedCitation(null), 2000);
  }, []);

  const handleEditChunk = useCallback(
    (messageId: string, citation: ChatCitation, index: number) => {
      setEditingChunk({ citation, messageId, index });
      setProposedContent(citation.content ?? "");
    },
    [],
  );

  async function submitCorrection() {
    if (!editingChunk || !proposedContent.trim() || isSubmittingCorrection) {
      return;
    }

    setIsSubmittingCorrection(true);
    try {
      const response = await fetch("/api/feedback/chunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: editingChunk.messageId,
          chunkIndex: editingChunk.citation.chunkIndex,
          documentId: editingChunk.citation.documentId,
          sector: editingChunk.citation.sector,
          originalContent: editingChunk.citation.content,
          proposedContent: proposedContent.trim(),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(payload.message ?? "Falha ao enviar correcao.");
      }

      setEditingChunk(null);
      setStatusText("Sugestao de correcao enviada para analise.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar correcao.");
    } finally {
      setIsSubmittingCorrection(false);
    }
  }

  async function sendFeedback(messageId: string, value: "good" | "bad", comment?: string) {
    setMessages((current) =>
      current.map((msg) =>
        msg.id === messageId ? { ...msg, feedback: value } : msg,
      ),
    );
    try {
      await fetch(`/api/messages/${messageId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value, ...(comment ? { comment } : {}) }),
      });
    } catch {
      // Ignora erro otimista
    }
  }

  function handleFeedback(messageId: string, value: "good" | "bad") {
    if (value === "bad") {
      // Find the user message that preceded this assistant message
      const msgIndex = messages.findIndex((m) => m.id === messageId);
      const prior = msgIndex > 0 ? messages.slice(0, msgIndex).reverse().find((m) => m.role === "user") : undefined;
      setBadFeedbackComment("");
      setBadFeedbackModal({ messageId, question: prior?.content ?? "sua pergunta" });
    } else {
      void sendFeedback(messageId, value);
    }
  }

  async function submitBadFeedback(skipComment: boolean) {
    if (!badFeedbackModal || isSubmittingBadFeedback) return;
    setIsSubmittingBadFeedback(true);
    const comment = skipComment ? undefined : badFeedbackComment.trim() || undefined;
    await sendFeedback(badFeedbackModal.messageId, "bad", comment);
    setIsSubmittingBadFeedback(false);
    setBadFeedbackModal(null);
    setBadFeedbackComment("");
  }

  const sectorClass = useMemo(
    () => `sector-${selectedAgent}`,
    [selectedAgent],
  );
  const effectiveUseGraph = useGraph;
  const retrievalModeText = useMemo(() => {
    if (!useRag && useGraph) {
      return "Mapa do conhecimento sem RAG localiza documentos conectados e le o conteudo validado do banco interno.";
    }

    if (!useRag && !useGraph) {
      return "Sem RAG e sem mapa do conhecimento, a consulta usa busca textual nos documentos publicados do setor.";
    }

    if (effectiveUseGraph) {
      return "RAG busca por significado nos documentos longos. Grafo ajuda quando a pergunta envolve relacoes, dependencias ou impacto entre documentos.";
    }

    return "RAG sem mapa do conhecimento e melhor para perguntas diretas sobre conteudo documental.";
  }, [effectiveUseGraph, useGraph, useRag]);

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }

    const controller = new AbortController();

    void (async () => {
      setIsLoadingMessages(true);
      try {
        const response = await fetch(`/api/conversations/${activeConversationId}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            message?: string;
          };
          throw new Error(
            payload.message ??
              `Falha ao carregar a conversa (${response.status}).`,
          );
        }

        const payload = (await response.json().catch(() => null)) as {
          conversation?: { id: string; title: string; sector: Sector };
          messages?: MessageItem[];
          message?: string;
        } | null;

        if (!payload) {
          throw new Error("Resposta inválida do servidor ao carregar conversa.");
        }

        setMessages(payload.messages ?? []);
        if (payload.conversation?.sector) {
          setSelectedAgent(payload.conversation.sector);
        }
      } catch (fetchError) {
        if (!controller.signal.aborted) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Falha ao carregar a conversa.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingMessages(false);
        }
      }
    })();

    return () => controller.abort();
  }, [activeConversationId]);

  useEffect(() => {
    if (shouldFollowStreamRef.current) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, streamingAnswer, streamingTrace]);

  useEffect(() => {
    function isNearBottom() {
      const root = document.documentElement;
      const distanceFromBottom =
        root.scrollHeight - window.scrollY - window.innerHeight;
      return distanceFromBottom <= 96;
    }

    function handleScroll() {
      shouldFollowStreamRef.current = isNearBottom();
    }

    shouldFollowStreamRef.current = isNearBottom();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  async function createConversation() {
    setError("");

    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Nova conversa" }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      throw new Error(payload.message ?? `Nao foi possivel abrir uma conversa (${response.status}).`);
    }

    const payload = (await response.json().catch(() => null)) as {
      conversation?: ConversationSummary;
      message?: string;
    } | null;

    if (!payload?.conversation) {
      throw new Error(payload?.message ?? "Nao foi possivel abrir uma conversa.");
    }

    startTransition(() => {
      setConversations((current) => [payload.conversation!, ...current]);
      setActiveConversationId(payload.conversation!.id);
      setMessages([]);
    });

    return payload.conversation.id;
  }

  async function handleSendQuestion() {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || isSending) {
      return;
    }

    setError("");
    setIsSending(true);
    setStreamingAnswer("");
    setStreamingTrace([]);
    setStreamingAutomation(null);
    shouldFollowStreamRef.current = true;
    setStatusText("Preparando consulta...");

    let conversationId = activeConversationId;
    let assembledAnswer = "";

    try {
      if (!conversationId) {
        conversationId = await createConversation();
      }

      const optimisticMessage: MessageItem = {
        id: `local-user-${Date.now()}`,
        role: "user",
        content: normalizedQuestion,
        citations: [],
        traceId: "",
        createdAt: new Date().toISOString(),
      };

      setMessages((current) => [...current, optimisticMessage]);
      setQuestion("");

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId,
          question: normalizedQuestion,
          agentId: selectedAgent,
          useRag,
          useGraph: effectiveUseGraph,
        }),
      });

      if (!response.ok) {
        let errorMsg = "Falha ao consultar o agente.";
        try {
          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const errPayload = await response.json().catch(() => ({}));
            if (errPayload && typeof errPayload.message === "string") {
              errorMsg = errPayload.message;
            }
          } else {
            errorMsg = `Erro no servidor (${response.status}). Tente novamente mais tarde.`;
          }
        } catch {
          errorMsg = `Erro no servidor (${response.status}).`;
        }
        throw new Error(errorMsg);
      }

      if (!response.body) {
        throw new Error("O servidor nao retornou stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalTraceId = "";
      let finalCitations: ChatCitation[] = [];
      let finalMetrics: GenerationMetrics | undefined;
      let finalMessageId = "";

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (line) {
            let event: ChatEvent;
            try {
              event = JSON.parse(line) as ChatEvent;
            } catch {
              // Se a linha não for JSON (ex: HTML de erro/timeout), ignora em vez de quebrar a tela
              newlineIndex = buffer.indexOf("\n");
              continue;
            }

            if (event.type === "status") {
              setStatusText(event.data.message);
            }

            if (event.type === "message") {
              assembledAnswer += event.data.chunk;
              setStreamingAnswer(assembledAnswer);
            }

            if (event.type === "delegation_start") {
              setStreamingTrace((current) => [...current, event.data]);
            }

            if (event.type === "delegation_result") {
              setStreamingTrace((current) =>
                current.map((item) =>
                  item.protocol === event.data.protocol && item.to === event.data.to
                    ? event.data
                    : item,
                ),
              );
            }

            if (event.type === "automation_start") {
              setStatusText(`Acionando ${event.data.label}...`);
            }

            if (event.type === "automation_result") {
              setStreamingAutomation(event.data);
            }

            if (event.type === "done") {
              finalTraceId = event.data.traceId;
              finalCitations = event.data.citations;
              finalMetrics = event.data.metrics;
              finalMessageId = event.data.messageId || "";
            }

            if (event.type === "error") {
              throw new Error(event.message);
            }
          }

          newlineIndex = buffer.indexOf("\n");
        }

        if (done) {
          break;
        }
      }

      const assistantMessage: MessageItem = {
        id: finalMessageId || `local-assistant-${Date.now()}`,
        role: "assistant",
        content: assembledAnswer.trim(),
        citations: finalCitations,
        metrics: finalMetrics,
        agentId: selectedAgent,
        traceId: finalTraceId,
        createdAt: new Date().toISOString(),
      };

      setMessages((current) => [...current, assistantMessage]);
      setStreamingAnswer("");

      const visibleCount = Math.max(conversations.length, CONVERSATIONS_PAGE_SIZE);
      try {
        const conversationsResponse = await fetch(
          `/api/conversations?take=${visibleCount}`,
          { cache: "no-store" },
        );
        if (conversationsResponse.ok) {
          const conversationsPayload = (await conversationsResponse.json().catch(() => null)) as {
            conversations?: ConversationSummary[];
            total?: number;
          } | null;
          if (conversationsPayload?.conversations) {
            setConversations(conversationsPayload.conversations);
          }
          if (typeof conversationsPayload?.total === "number") {
            setTotalConversations(conversationsPayload.total);
          }
        }
      } catch {
        // silencioso
      }
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Falha ao enviar a pergunta.",
      );
    } finally {
      setStatusText("Ambiente pronto.");
      setIsSending(false);
    }
  }

  return (
    <div
      className={`${sectorClass} grid gap-6 transition-[grid-template-columns] duration-300 ease-in-out ${
        traceCollapsed
          ? "xl:grid-cols-[320px_minmax(0,1fr)_64px]"
          : "xl:grid-cols-[320px_minmax(0,1fr)_360px]"
      }`}
    >
      <aside className="premium-panel flex flex-col rounded-[2rem] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              Conversas
            </p>
            <p className="mt-1 text-lg font-black text-[var(--foreground-strong)]">
              Historico pessoal
            </p>
          </div>
          <button
            className="rounded-full bg-[var(--accent)] px-3 py-2 text-xs font-bold uppercase tracking-[0.22em] text-white"
            onClick={() => void createConversation()}
            type="button"
          >
            Novo
          </button>
        </div>

        <div className="mt-5 flex-1 min-h-0 space-y-3 overflow-y-auto pr-1 max-h-[420px] xl:max-h-none" style={{ scrollbarWidth: "thin" }}>
          {conversations.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[var(--border)] px-4 py-5 text-sm text-[var(--foreground-soft)]">
              Nenhuma conversa iniciada.
            </div>
          ) : null}

          {conversations.map((conversation) => {
            const isActive = activeConversationId === conversation.id;

            return (
              <button
                key={conversation.id}
                className={`w-full rounded-3xl border px-4 py-4 text-left transition-colors ${
                  isActive
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border)] bg-white/80 hover:border-[var(--accent)]/60"
                }`}
                onClick={() => setActiveConversationId(conversation.id)}
                type="button"
              >
                <p className="text-sm font-bold text-[var(--foreground-strong)]">
                  {conversation.title}
                </p>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--foreground-soft)]">
                  {conversation.lastMessage ?? "Sem mensagens ainda."}
                </p>
              </button>
            );
          })}

          {conversations.length < totalConversations ? (
            <button
              type="button"
              disabled={isLoadingMore}
              className="w-full rounded-2xl border border-dashed border-[var(--border)] px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] text-[var(--foreground-soft)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
              onClick={async () => {
                setIsLoadingMore(true);
                try {
                  const res = await fetch(
                    `/api/conversations?take=${CONVERSATIONS_PAGE_SIZE}&skip=${conversations.length}`,
                    { cache: "no-store" },
                  );
                  if (res.ok) {
                    const payload = (await res.json().catch(() => null)) as {
                      conversations?: ConversationSummary[];
                      total?: number;
                    } | null;
                    if (payload?.conversations?.length) {
                      setConversations((prev) => [...prev, ...payload.conversations!]);
                    }
                    if (typeof payload?.total === "number") {
                      setTotalConversations(payload.total);
                    }
                  }
                } catch {
                  // silently ignore
                } finally {
                  setIsLoadingMore(false);
                }
              }}
            >
              {isLoadingMore ? "Carregando..." : `Carregar mais (${totalConversations - conversations.length})`}
            </button>
          ) : null}
        </div>
      </aside>

      <section className="premium-panel flex self-start flex-col rounded-[2rem] p-5">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              {user.role === "admin" ? "Modo Administrador" : "Chat isolado"}
            </p>
            {user.role === "admin" ? (
              <div className="mt-1 flex items-center gap-2">
                {/* Agent selector */}
                <div className="relative flex-1">
                  <select
                    className="appearance-none block w-full cursor-pointer bg-white/50 border border-[var(--border)] rounded-2xl px-4 py-2 pr-10 text-sm font-bold text-[var(--foreground-strong)] outline-none transition-all hover:border-[var(--accent)] hover:bg-white focus:ring-2 focus:ring-[var(--accent)]/20"
                    onChange={(e) => setSelectedAgent(e.target.value as Sector)}
                    value={selectedAgent}
                  >
                    {SECTORS.map((s) => (
                      <option key={s} value={s}>
                        Agente {PERSONA_LABELS[s]} ({SECTOR_LABELS[s]})
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[var(--muted)]">
                    {CHEVRON_SVG}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-lg font-black text-[var(--foreground-strong)]">
                Somente {SECTOR_LABELS[user.sector]}
              </p>
            )}
            <div className="mt-3 w-fit max-w-full rounded-2xl border border-[var(--border)] bg-white/70 p-2">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setUseRag((value) => !value)}
                title={useRag ? "RAG ativo: busca trechos relevantes nos documentos" : "RAG inativo: nao usa busca semantica nos documentos"}
                  className={[
                    "inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-all",
                    useRag
                      ? "border-[var(--accent)] bg-[var(--accent)] text-white shadow-sm"
                      : "border-[var(--border)] bg-white text-[var(--foreground-soft)] hover:border-[var(--accent)]",
                  ].join(" ")}
                >
                  {useRag ? <Search className="h-3 w-3" /> : <Database className="h-3 w-3" />}
                  RAG
                  <span className={[
                    "rounded-full px-1 py-0.5 text-[8px] font-black",
                    useRag ? "bg-white/20 text-white" : "bg-[var(--surface-muted)] text-[var(--muted)]",
                  ].join(" ")}>
                    {useRag ? "ON" : "OFF"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setUseGraph((value) => !value)}
                  title={
                    effectiveUseGraph
                      ? "Mapa do conhecimento ativo: usa relacoes entre documentos"
                      : "Mapa do conhecimento inativo"
                  }
                  className={[
                    "inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-all",
                    effectiveUseGraph
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      : "border-[var(--border)] bg-white text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--foreground-soft)]",
                  ].join(" ")}
                >
                  <Network className="h-3 w-3" />
                  Mapa
                  <span className={[
                    "rounded-full px-1 py-0.5 text-[8px] font-black",
                    effectiveUseGraph ? "bg-emerald-200 text-emerald-900" : "bg-gray-100 text-gray-500",
                  ].join(" ")}>
                    {effectiveUseGraph ? "ON" : "OFF"}
                  </span>
                </button>
              </div>

              <p className="mt-2 max-w-md text-[11px] leading-4 text-[var(--foreground-soft)]">
                {retrievalModeText}
              </p>
            </div>
          </div>
          <p className="rounded-full bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-[var(--foreground-soft)]">
            {statusText}
          </p>
        </div>

        <div className="mt-5 space-y-4 pr-1">
          {isLoadingMessages ? (
            <div className="rounded-3xl border border-[var(--border)] bg-white/80 px-4 py-5 text-sm text-[var(--foreground-soft)]">
              Carregando conversa...
            </div>
          ) : null}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`rounded-[1.75rem] border px-5 py-4 ${
                message.role === "user"
                  ? "ml-auto max-w-[78%] border-[var(--border)] bg-white"
                  : "max-w-[86%] border-[var(--border)] bg-[var(--surface-soft)]"
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                  {message.role === "user"
                    ? "Usuario"
                    : PERSONA_LABELS[message.agentId ?? user.sector]}
                </p>
              </div>
              
              {message.metrics && message.role === "assistant" ? (
                <div className="metrics-badges">
                  {message.metrics.searchDurationMs !== undefined ? (
                    <span className="metric-badge" title="Tempo gasto pesquisando contexto na base">
                      <span className="metric-badge-icon">🔍</span> Busca
                      <span className="metric-badge-value">{message.metrics.searchDurationMs}ms</span>
                    </span>
                  ) : null}
                  {message.metrics.ttftMs !== undefined ? (
                    <span className="metric-badge" title="Time to First Token (Processamento do prompt)">
                      <span className="metric-badge-icon">⚡</span> TTFT
                      <span className="metric-badge-value">{message.metrics.ttftMs}ms</span>
                    </span>
                  ) : null}
                  <span className="metric-badge" title="Geração total do modelo">
                    <span className="metric-badge-icon">📝</span> Modelo
                    <span className="metric-badge-value">{(message.metrics.totalDurationMs / 1000).toFixed(2)}s</span>
                  </span>
                  <span className="metric-badge" title="Velocidade de geração">
                    <span className="metric-badge-icon">🚀</span>
                    <span className="metric-badge-value">{message.metrics.tokensPerSecond}</span> tokens/s
                  </span>
                </div>
              ) : null}

              <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--foreground)]">
                {message.role === "assistant"
                  ? renderContentWithRefs(
                      message.content,
                      message.citations,
                      (idx) => handleRefClick(message.id, idx),
                      (cit, idx) => handleEditChunk(message.id, cit, idx),
                    )
                  : message.content}
              </p>
              {message.citations.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {message.citations.map((citation, index) => (
                    <CitationCard
                      key={`${message.id}-cit-${index}`}
                      citation={citation}
                      index={index}
                      highlighted={highlightedCitation === index}
                      onRef={undefined}
                      id={`citation-${message.id}-${index}`}
                    />
                  ))}
                </div>
              ) : null}
              {message.role === "assistant" && message.id.startsWith("local-") === false ? (
                <div className="feedback-bar">
                  {message.feedback === undefined && (
                    <p className="flex-1 text-[11px] leading-tight text-[var(--muted)] italic">
                      {getFeedbackPrompt(message.id)}
                    </p>
                  )}
                  <button
                    className={`feedback-btn${message.feedback === "good" ? " feedback-btn--active-good" : ""}`}
                    onClick={() => handleFeedback(message.id, "good")}
                    title="Boa resposta"
                    disabled={message.feedback !== undefined}
                  >
                    {THUMBS_UP_SVG}
                  </button>
                  <button
                    className={`feedback-btn${message.feedback === "bad" ? " feedback-btn--active-bad" : ""}`}
                    onClick={() => handleFeedback(message.id, "bad")}
                    title="Resposta ruim — abrir detalhamento"
                    disabled={message.feedback !== undefined}
                  >
                    {THUMBS_DOWN_SVG}
                  </button>
                </div>
              ) : null}
            </div>
          ))}

          {streamingAnswer ? (
            <div className="max-w-[86%] rounded-[1.75rem] border border-[var(--border)] bg-[var(--surface-soft)] px-5 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                {PERSONA_LABELS[selectedAgent]}
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--foreground)]">
                {renderContentWithRefs(streamingAnswer, [], () => {})}
              </p>
            </div>
          ) : null}

          <div ref={endRef} />
        </div>

        <div className="mt-5 border-t border-[var(--border)] pt-5">
          <textarea
            className="min-h-32 w-full rounded-[1.75rem] border border-[var(--border)] bg-white px-5 py-4 text-sm leading-7 outline-none transition-colors focus:border-[var(--accent)]"
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={`Pergunte ao agente de ${SECTOR_LABELS[selectedAgent]}.`}
            value={question}
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            {error ? (
              <p className="text-sm text-[var(--danger)]">{error}</p>
            ) : (
              <p className="text-sm text-[var(--foreground-soft)]">
                O usuario nao fala com outros setores diretamente. Quando
                necessario, o agente delega por protocolo.
              </p>
            )}
            <button
              className="rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSending || question.trim().length === 0}
              onClick={() => void handleSendQuestion()}
              type="button"
            >
              {isSending ? "Consultando..." : "Enviar pergunta"}
            </button>
          </div>
        </div>
      </section>

      {traceCollapsed ? (
        <aside className="flex self-start">
          <button
            type="button"
            onClick={() => setTraceCollapsed(false)}
            className="premium-panel flex h-full min-h-[260px] w-full flex-col items-center justify-center gap-4 rounded-[2rem] px-2 py-6 text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
            title="Expandir trilha de delegações"
          >
            {CHEVRON_LEFT_SVG}
            <span className="[writing-mode:vertical-rl] text-[11px] font-bold uppercase tracking-[0.28em]">
              Trilha de delegações
            </span>
            {streamingTrace.length > 0 ? (
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-black text-white">
                {streamingTrace.length}
              </span>
            ) : null}
          </button>
        </aside>
      ) : (
      <aside className="space-y-6">
        <div className="flex justify-start">
          <button
            type="button"
            onClick={() => setTraceCollapsed(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white/80 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            title="Recolher trilha de delegações"
          >
            Recolher
            {CHEVRON_RIGHT_SVG}
          </button>
        </div>
        {streamingAutomation ? (
          <section className="premium-panel rounded-[2rem] p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              Automacao
            </p>
            <p className="mt-1 text-lg font-black text-[var(--foreground-strong)]">
              {streamingAutomation.label}
            </p>
            <div className="mt-5 rounded-3xl border border-[var(--border)] bg-white/80 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
                Run {streamingAutomation.runId}
              </p>
              <a
                className="mt-3 block text-sm font-bold text-[var(--accent)]"
                href={streamingAutomation.runUrl}
                rel="noreferrer"
                target="_blank"
              >
                Abrir execucao
              </a>
              {streamingAutomation.nextTaskUrl ? (
                <a
                  className="mt-2 block text-sm font-bold text-[var(--accent)]"
                  href={streamingAutomation.nextTaskUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Abrir etapa humana
                </a>
              ) : null}
              {streamingAutomation.sourceDocumentTitle ? (
                <div className="mt-4 border-t border-[var(--border)] pt-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">Origem</p>
                  <p className="mt-1 text-xs text-[var(--foreground-soft)]">
                    Automação desenhada a partir do Documento <span className="font-bold">&quot;{streamingAutomation.sourceDocumentTitle}&quot;</span>
                  </p>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="premium-panel rounded-[2rem] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
            Trilha da resposta
          </p>
          <p className="mt-1 text-lg font-black text-[var(--foreground-strong)]">
            Delegacoes entre agentes
          </p>

          <div className="mt-5 space-y-3">
            {streamingTrace.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-[var(--border)] px-4 py-5 text-sm text-[var(--foreground-soft)]">
                Nenhuma delegacao ocorreu nesta resposta.
              </div>
            ) : null}

            {streamingTrace.map((trace, index) => (
              <div
                key={`${trace.protocol}-${index}`}
                className="rounded-3xl border border-[var(--border)] bg-white/80 p-4"
              >
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                  {getSectorLabel(trace.from)} {"->"} {getSectorLabel(trace.to)}
                </p>
                <p className="mt-2 text-sm font-bold text-[var(--foreground-strong)]">
                  {trace.intent}
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">
                  {trace.answer ?? trace.question}
                </p>
                <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
                  Status: {trace.status}
                </p>
              </div>
            ))}
          </div>
        </section>
      </aside>
      )}

      {editingChunk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[2rem] bg-white p-8 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-black text-[var(--foreground-strong)]">
                Sugerir Correcao de Base
              </h3>
              <button
                className="text-[var(--muted)] hover:text-[var(--foreground)]"
                onClick={() => setEditingChunk(null)}
              >
                Fechar
              </button>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">
                  Documento Original
                </p>
                <p className="mt-1 text-sm font-bold text-[var(--foreground-strong)]">
                  {editingChunk.citation.documentTitle} (Trecho #{editingChunk.citation.chunkIndex})
                </p>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">
                  Conteudo Original
                </p>
                <div className="mt-2 max-h-40 overflow-y-auto rounded-2xl bg-slate-50 p-4 text-sm italic text-[var(--foreground-soft)]">
                  {editingChunk.citation.content}
                </div>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">
                  Sua Sugestao de Ajuste
                </p>
                <textarea
                  className="mt-2 min-h-[150px] w-full rounded-2xl border border-[var(--border)] p-4 text-sm outline-none focus:border-[var(--accent)]"
                  value={proposedContent}
                  onChange={(e) => setProposedContent(e.target.value)}
                  placeholder="Escreva como a informacao correta deveria ser..."
                />
              </div>
            </div>

            <div className="mt-8 flex justify-end gap-3">
              <button
                className="rounded-xl px-4 py-2 text-sm font-bold text-[var(--muted)] hover:bg-slate-100"
                onClick={() => setEditingChunk(null)}
              >
                Cancelar
              </button>
              <button
                className="rounded-xl bg-[var(--accent)] px-6 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50"
                disabled={isSubmittingCorrection || !proposedContent.trim() || proposedContent.trim() === editingChunk.citation.content}
                onClick={() => void submitCorrection()}
              >
                {isSubmittingCorrection ? "Enviando..." : "Enviar para Revisao"}
              </button>
            </div>
          </div>
        </div>
      )}

      {badFeedbackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[2rem] bg-white p-8 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--danger)]">Resposta insatisfatória</p>
                <h3 className="mt-1 text-lg font-black text-[var(--foreground-strong)]">O que podemos melhorar?</h3>
              </div>
              <button
                className="mt-1 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                onClick={() => void submitBadFeedback(true)}
                title="Fechar sem comentar"
              >
                ✕
              </button>
            </div>

            <p className="mt-4 text-sm leading-6 text-[var(--foreground-soft)]">
              {getNegativeModalPrompt(badFeedbackModal.messageId, badFeedbackModal.question)}
            </p>

            <textarea
              className="mt-4 min-h-[120px] w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-sm leading-6 outline-none transition-colors focus:border-[var(--accent)]"
              placeholder="Descreva o problema ou o que esperava como resposta (opcional)..."
              value={badFeedbackComment}
              onChange={(e) => setBadFeedbackComment(e.target.value)}
              maxLength={1000}
            />
            <p className="mt-1 text-right text-[10px] text-[var(--muted)]">{badFeedbackComment.length}/1000</p>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                className="rounded-xl px-4 py-2 text-sm font-bold text-[var(--muted)] hover:bg-slate-100 transition-colors"
                onClick={() => void submitBadFeedback(true)}
                disabled={isSubmittingBadFeedback}
              >
                Só registrar
              </button>
              <button
                className="rounded-xl bg-[var(--danger)] px-6 py-2 text-sm font-bold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                onClick={() => void submitBadFeedback(false)}
                disabled={isSubmittingBadFeedback}
              >
                {isSubmittingBadFeedback ? "Enviando..." : "Enviar comentário"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
