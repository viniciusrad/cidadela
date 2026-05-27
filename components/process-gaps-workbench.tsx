"use client";

import {
  CheckCircle2,
  CircleDashed,
  Eye,
  FileText,
  Pencil,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import { useState } from "react";

import type { Sector } from "@/lib/domain";
import { SECTOR_LABELS } from "@/lib/labels";

export type ProcessGapInboxItem = {
  id: string;
  question: string;
  rationale: string;
  priority: string;
  status: string;
  createdAt: string;
  processMapId: string;
  processName: string;
  sector: Sector;
  targetCurationDocumentId: string | null;
  targetDocumentId: string | null;
  targetDocumentTitle: string | null;
  targetFileName: string | null;
  targetStatus: string | null;
  response: string | null;
};

function priorityClass(priority: string) {
  const normalized = priority.toLowerCase();
  if (normalized.includes("critical") || normalized.includes("alta")) {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (normalized.includes("medium") || normalized.includes("media")) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function normalizeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type DocumentPreview = {
  id: string;
  title: string;
  fileName: string;
  status: string;
  markdown: string;
};

export function ProcessGapsWorkbench({
  items,
  setItems,
  selectedSector,
  filter,
}: {
  items: ProcessGapInboxItem[];
  setItems: React.Dispatch<React.SetStateAction<ProcessGapInboxItem[]>>;
  selectedSector: string;
  filter?: "pending" | "answered";
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items
        .filter((gap) => gap.response)
        .map((gap) => [gap.id, gap.response ?? ""]),
    ),
  );
  const [pendingId, setPendingId] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState("");
  const [editingIds, setEditingIds] = useState<Record<string, boolean>>({});
  const [pendingReprocessId, setPendingReprocessId] = useState("");
  const [editingTitleDocId, setEditingTitleDocId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSavingDocId, setTitleSavingDocId] = useState<string | null>(null);

  function startEditTitle(documentId: string, currentTitle: string) {
    setEditingTitleDocId(documentId);
    setTitleDraft(currentTitle);
    setErrorMessage("");
    setMessage("");
  }

  function cancelEditTitle() {
    setEditingTitleDocId(null);
    setTitleDraft("");
  }

  async function saveTitle(documentId: string, previousTitle: string) {
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setErrorMessage("Informe um titulo nao vazio.");
      return;
    }
    if (trimmed === previousTitle) {
      cancelEditTitle();
      return;
    }
    if (trimmed.length > 300) {
      setErrorMessage("Titulo muito longo (max 300 caracteres).");
      return;
    }

    setTitleSavingDocId(documentId);
    setErrorMessage("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/documents/${encodeURIComponent(documentId)}/title`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newTitle: trimmed }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        ok?: boolean;
        warning?: string;
        qdrantChunksUpdated?: number;
      };

      if (!response.ok && response.status !== 207) {
        throw new Error(payload.message ?? "Falha ao renomear documento.");
      }

      setItems((current) =>
        current.map((item) =>
          item.targetDocumentId === documentId
            ? { ...item, targetDocumentTitle: trimmed }
            : item,
        ),
      );
      setMessage(
        payload.warning
          ? payload.warning
          : `Documento renomeado. ${payload.qdrantChunksUpdated ?? 0} trecho(s) atualizados no indice de busca.`,
      );
      cancelEditTitle();
    } catch (error) {
      setErrorMessage(normalizeError(error, "Falha ao renomear documento."));
    } finally {
      setTitleSavingDocId(null);
    }
  }

  async function openDocumentPreview(curationDocumentId: string) {
    setPreviewLoadingId(curationDocumentId);
    setErrorMessage("");

    try {
      const response = await fetch(`/api/curation/${curationDocumentId}`);
      const payload = (await response.json()) as {
        message?: string;
        document?: {
          id: string;
          documentTitle: string;
          fileName: string;
          status: string;
          normalizedMarkdown: string;
          promotedMarkdown?: string | null;
        };
      };

      if (!response.ok || !payload.document) {
        throw new Error(payload.message ?? "Falha ao carregar documento.");
      }

      setPreview({
        id: payload.document.id,
        title: payload.document.documentTitle,
        fileName: payload.document.fileName,
        status: payload.document.status,
        markdown:
          payload.document.promotedMarkdown ??
          payload.document.normalizedMarkdown,
      });
    } catch (error) {
      setErrorMessage(normalizeError(error, "Falha ao carregar documento."));
    } finally {
      setPreviewLoadingId("");
    }
  }

  async function submitAnswer(questionId: string) {
    const answer = answers[questionId]?.trim() ?? "";
    if (!answer) {
      setErrorMessage("Informe a resposta antes de salvar.");
      return;
    }

    setPendingId(questionId);
    setErrorMessage("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/curation/process-gaps/${questionId}/answer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: answer }),
        },
      );
      const payload = (await response.json()) as {
        message?: string;
        status?: string;
        answeredAt?: string | null;
        reindexed?: boolean;
        reindexError?: string | null;
        chunksCreated?: number | null;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao responder pergunta.");
      }

      setItems((current) =>
        current.map((item) =>
          item.id === questionId
            ? {
                ...item,
                status: payload.status ?? "answered",
                response: answer,
              }
            : item,
        ),
      );
      setMessage(
        payload.reindexed
          ? `Resposta registrada, documento publicado reindexado e ${payload.chunksCreated ?? 0} trecho(s) recriado(s).`
          : payload.reindexError
            ? `Resposta registrada. Reprocessamento pendente: ${payload.reindexError}`
          : "Resposta registrada na revisao do documento e pergunta marcada como respondida.",
      );
      setEditingIds((current) => ({ ...current, [questionId]: false }));
    } catch (error) {
      setErrorMessage(normalizeError(error, "Falha ao responder pergunta."));
    } finally {
      setPendingId("");
    }
  }

  async function reprocessDocument(documentId: string) {
    setPendingReprocessId(documentId);
    setErrorMessage("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/curation/process-gaps/documents/${documentId}/reprocess`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        message?: string;
        reindexed?: boolean;
        chunksCreated?: number | null;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao reprocessar documento.");
      }

      setMessage(
        `Documento reprocessado com todas as respostas registradas e ${payload.chunksCreated ?? 0} trecho(s) recriado(s).`,
      );
    } catch (error) {
      setErrorMessage(normalizeError(error, "Falha ao reprocessar documento."));
    } finally {
      setPendingReprocessId("");
    }
  }

  const filteredItems = filter
    ? items.filter((item) =>
        filter === "pending"
          ? item.status === "promoted"
          : item.status !== "promoted",
      )
    : items;

  const pendingItems = items.filter((item) => item.status === "promoted");
  const answeredItems = items.filter((item) => item.status !== "promoted");
  const groupedItems = Array.from(
    filteredItems
      .reduce((map, item) => {
        const key = item.targetCurationDocumentId ?? `unlinked:${item.id}`;
        const current = map.get(key);
        if (current) {
          current.items.push(item);
        } else {
          map.set(key, {
            key,
            documentId: item.targetCurationDocumentId,
            targetDocumentId: item.targetDocumentId,
            title: item.targetDocumentTitle ?? item.targetFileName ?? "Documento nao vinculado",
            currentTitle: item.targetDocumentTitle ?? "",
            fileName: item.targetFileName,
            status: item.targetStatus,
            sector: item.sector,
            items: [item],
          });
        }
        return map;
      }, new Map<string, {
        key: string;
        documentId: string | null;
        targetDocumentId: string | null;
        title: string;
        currentTitle: string;
        fileName: string | null;
        status: string | null;
        sector: Sector;
        items: ProcessGapInboxItem[];
      }>())
      .values(),
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <section className="premium-panel rounded-[2rem] p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
          {filter === "answered" ? "Historico de perguntas" : "Perguntas em aberto"}
        </p>
        <h3 className="mt-2 text-xl font-black text-[var(--foreground-strong)]">
          {selectedSector === "todos"
            ? "Todos os Setores"
            : SECTOR_LABELS[selectedSector as Sector] || selectedSector}
        </h3>
        <p className="mt-3 text-sm leading-6 text-[var(--foreground-soft)]">
          {filter === "answered"
            ? "Registro de perguntas ja respondidas pela curadoria para alimentar a base de conhecimento."
            : "Perguntas enviadas pelo mapa de processos para desbloquear automacoes e fechar pontos de documentacao."}
        </p>

        <div className="mt-6 grid gap-3">
          {filter !== "answered" && (
            <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3">
              <p className="text-2xl font-black text-cyan-800">{pendingItems.length}</p>
              <p className="text-xs font-bold uppercase tracking-wider text-cyan-700">
                Perguntas em aberto
              </p>
            </div>
          )}
          {filter !== "pending" && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-2xl font-black text-emerald-800">
                {answeredItems.length}
              </p>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                Perguntas respondidas
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="premium-panel rounded-[2rem] p-6">
        {message ? (
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {message}
          </div>
        ) : null}
        {errorMessage ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            {errorMessage}
          </div>
        ) : null}

        {filteredItems.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[var(--border)] p-8 text-center">
            <CircleDashed className="mx-auto h-8 w-8 text-[var(--muted)]" />
            <h4 className="mt-4 text-lg font-black text-[var(--foreground-strong)]">
              {filter === "answered"
                ? "Nenhuma pergunta respondida"
                : "Nenhuma pergunta operacional enviada"}
            </h4>
            <p className="mt-2 text-sm text-[var(--foreground-soft)]">
              {filter === "answered"
                ? "As perguntas aparecerao aqui assim que forem respondidas."
                : "Quando uma pergunta for enviada para curadoria pelo mapa de processos, ela aparecera aqui."}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {groupedItems.map((group) => {
              const allAnswered = group.items.every(
                (item) => item.status !== "promoted" && Boolean(item.response?.trim()),
              );
              const canReprocess =
                allAnswered &&
                Boolean(group.documentId) &&
                group.status === "PROMOTED";

              return (
                <article
                  className="rounded-[2rem] border border-[var(--border)] bg-white p-5"
                  key={group.key}
                >
                  <div className="flex flex-col gap-4 border-b border-[var(--border)] pb-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                        Documento-alvo
                      </p>
                      {editingTitleDocId && group.targetDocumentId === editingTitleDocId ? (
                        <div className="mt-1 flex flex-col gap-2 md:flex-row md:items-center">
                          <input
                            autoFocus
                            className="w-full rounded-2xl border border-[var(--border)] bg-white px-3 py-2 text-base font-bold text-[var(--foreground-strong)] outline-none focus:border-cyan-400"
                            maxLength={300}
                            onChange={(event) => setTitleDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" && group.targetDocumentId) {
                                void saveTitle(group.targetDocumentId, group.currentTitle);
                              }
                              if (event.key === "Escape") cancelEditTitle();
                            }}
                            placeholder="Titulo descritivo do documento"
                            value={titleDraft}
                          />
                          <div className="flex shrink-0 gap-2">
                            <button
                              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300 bg-cyan-100 px-3 py-2 text-xs font-bold text-cyan-950 transition-colors hover:border-cyan-400 hover:bg-cyan-200 disabled:opacity-50"
                              disabled={titleSavingDocId === group.targetDocumentId}
                              onClick={() =>
                                group.targetDocumentId
                                  ? void saveTitle(group.targetDocumentId, group.currentTitle)
                                  : undefined
                              }
                              type="button"
                            >
                              {titleSavingDocId === group.targetDocumentId
                                ? "Salvando..."
                                : "Salvar"}
                            </button>
                            <button
                              className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-3 py-2 text-xs font-bold text-[var(--foreground-strong)] transition-colors hover:border-rose-300 hover:text-rose-700 disabled:opacity-50"
                              disabled={titleSavingDocId === group.targetDocumentId}
                              onClick={cancelEditTitle}
                              type="button"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <h4 className="mt-1 inline-flex items-center gap-2 text-lg font-black text-[var(--foreground-strong)]">
                          <FileText className="h-5 w-5 text-[var(--accent)]" />
                          <span className="min-w-0 break-words">{group.title}</span>
                          {group.targetDocumentId ? (
                            <button
                              aria-label="Renomear documento"
                              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)]"
                              onClick={() =>
                                startEditTitle(
                                  group.targetDocumentId as string,
                                  group.currentTitle || group.title,
                                )
                              }
                              type="button"
                            >
                              <Pencil className="h-3 w-3" />
                              Renomear
                            </button>
                          ) : null}
                        </h4>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-700">
                          {SECTOR_LABELS[group.sector]}
                        </span>
                        {group.status ? (
                          <span className="rounded-full bg-cyan-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-700">
                            {group.status}
                          </span>
                        ) : null}
                        <span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">
                          {group.items.length} pergunta(s)
                        </span>
                      </div>
                    </div>
                    {group.documentId ? (
                      <button
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-bold text-[var(--foreground-strong)] transition-colors hover:border-cyan-400 hover:text-cyan-700 disabled:opacity-50"
                        disabled={previewLoadingId === group.documentId}
                        onClick={() => void openDocumentPreview(group.documentId as string)}
                        type="button"
                      >
                        <Eye className="h-4 w-4" />
                        {previewLoadingId === group.documentId
                          ? "Carregando..."
                          : "Ver documento inteiro"}
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-4 space-y-4">
                    {group.items.map((gap) => {
                      const isAnswered = gap.status !== "promoted";
                      const savedResponse = gap.response?.trim() ?? "";
                      const isEditing = editingIds[gap.id] === true;

                      return (
                        <div
                          className={`rounded-3xl border p-5 ${
                            isAnswered
                              ? "border-emerald-200 bg-emerald-50/70"
                              : "border-[var(--border)] bg-[var(--surface-muted)]"
                          }`}
                          key={gap.id}
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${priorityClass(gap.priority)}`}
                                >
                                  {gap.priority}
                                </span>
                                <span
                                  className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${
                                    isAnswered
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-cyan-100 text-cyan-700"
                                  }`}
                                >
                                  {isAnswered ? "respondida" : "em aberto"}
                                </span>
                              </div>
                              <h5 className="mt-3 text-base font-black text-[var(--foreground-strong)]">
                                {gap.question}
                              </h5>
                              <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">
                                {gap.rationale}
                              </p>
                              <p className="mt-3 text-xs font-bold uppercase tracking-widest text-[var(--muted)]">
                                Processo: {gap.processName}
                              </p>
                            </div>
                            {isAnswered ? (
                              <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
                            ) : null}
                          </div>

                          {isAnswered && !isEditing ? (
                            <div className="mt-4 rounded-2xl border border-emerald-200 bg-white px-4 py-3">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                                Resposta registrada
                              </p>
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--foreground-strong)]">
                                {savedResponse || "Sem resposta localizada na revisao mais recente."}
                              </p>
                              {savedResponse ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-bold text-[var(--foreground-strong)] transition-colors hover:border-cyan-300 hover:text-cyan-700 disabled:opacity-50"
                                    disabled={pendingId === gap.id}
                                    onClick={() => {
                                      setAnswers((current) => ({
                                        ...current,
                                        [gap.id]: gap.response ?? "",
                                      }));
                                      setEditingIds((current) => ({
                                        ...current,
                                        [gap.id]: true,
                                      }));
                                    }}
                                    type="button"
                                  >
                                    <Pencil className="h-4 w-4" />
                                    Editar resposta
                                  </button>
                                  <button
                                    className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 transition-colors hover:border-emerald-300 hover:bg-emerald-100 disabled:opacity-50"
                                    disabled={pendingId === gap.id}
                                    onClick={() => void submitAnswer(gap.id)}
                                    type="button"
                                  >
                                    <Send className="h-4 w-4" />
                                    {pendingId === gap.id
                                      ? "Reprocessando..."
                                      : "Reprocessar no documento"}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="mt-4">
                              <label
                                className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]"
                                htmlFor={`gap-answer-${gap.id}`}
                              >
                                Resposta da curadoria
                              </label>
                              <textarea
                                className="mt-2 min-h-28 w-full resize-y rounded-2xl border border-[var(--border)] bg-white p-3 text-sm text-[var(--foreground-strong)] outline-none focus:border-cyan-400"
                                id={`gap-answer-${gap.id}`}
                                onChange={(event) =>
                                  setAnswers((current) => ({
                                    ...current,
                                    [gap.id]: event.target.value,
                                  }))
                                }
                                placeholder="Registre a informacao que responde esta pergunta operacional."
                                value={answers[gap.id] ?? ""}
                              />
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <button
                                  className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300 bg-cyan-100 px-4 py-3 text-sm font-bold text-cyan-950 shadow-sm transition-colors hover:border-cyan-400 hover:bg-cyan-200 disabled:opacity-50"
                                  disabled={pendingId === gap.id}
                                  onClick={() => void submitAnswer(gap.id)}
                                  type="button"
                                >
                                  <Send className="h-4 w-4" />
                                  {pendingId === gap.id
                                    ? "Salvando..."
                                    : isAnswered
                                      ? "Salvar ajuste"
                                      : "Salvar resposta"}
                                </button>
                                {isAnswered ? (
                                  <button
                                    className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-bold text-[var(--foreground-strong)] transition-colors hover:border-rose-300 hover:text-rose-700 disabled:opacity-50"
                                    disabled={pendingId === gap.id}
                                    onClick={() => {
                                      setAnswers((current) => ({
                                        ...current,
                                        [gap.id]: gap.response ?? "",
                                      }));
                                      setEditingIds((current) => ({
                                        ...current,
                                        [gap.id]: false,
                                      }));
                                    }}
                                    type="button"
                                  >
                                    Cancelar
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {allAnswered ? (
                    <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                            Todas as perguntas respondidas
                          </p>
                          <p className="mt-1 text-sm leading-6 text-emerald-900">
                            Reprocesse o documento para reconstruir o artefato produtivo com todas as respostas registradas.
                          </p>
                        </div>
                        <button
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-300 bg-emerald-100 px-4 py-3 text-sm font-bold text-emerald-950 shadow-sm transition-colors hover:border-emerald-400 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!canReprocess || pendingReprocessId === group.documentId}
                          onClick={() =>
                            group.documentId ? void reprocessDocument(group.documentId) : undefined
                          }
                          type="button"
                        >
                          <RefreshCw
                            className={`h-4 w-4 ${
                              pendingReprocessId === group.documentId ? "animate-spin" : ""
                            }`}
                          />
                          {pendingReprocessId === group.documentId
                            ? "Reprocessando..."
                            : "Reprocessar documento"}
                        </button>
                      </div>
                      {!canReprocess ? (
                        <p className="mt-3 text-xs font-semibold text-emerald-800">
                          O reprocessamento manual fica disponivel para documentos publicados; documentos ainda em curadoria aplicam estas respostas ao serem publicados.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {preview ? (
        <div className="fixed inset-0 z-50 flex min-h-0 items-center justify-center overflow-hidden bg-slate-950/55 p-4 backdrop-blur-sm">
          <div
            className="flex min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-[var(--border)] bg-white shadow-2xl"
            style={{
              height: "min(720px, calc(100vh - 2rem))",
              maxHeight: "calc(100vh - 2rem)",
            }}
          >
            <div className="shrink-0 flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Conferencia do documento
                </p>
                <h3 className="mt-1 text-xl font-black text-[var(--foreground-strong)]">
                  {preview.title}
                </h3>
                <p className="mt-1 text-xs font-semibold text-[var(--foreground-soft)]">
                  {preview.fileName} · {preview.status}
                </p>
              </div>
              <button
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-white text-[var(--foreground-strong)] transition-colors hover:border-rose-300 hover:text-rose-700"
                onClick={() => setPreview(null)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
              <pre className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--foreground-strong)]">
                {preview.markdown}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
