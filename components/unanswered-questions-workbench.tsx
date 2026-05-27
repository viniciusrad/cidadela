"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, HelpCircle, Upload, X } from "lucide-react";
import { useRef, useState } from "react";

import { getSectorLabel } from "@/lib/labels";

export type UnansweredQuestionItem = {
  id: string;
  question: string;
  sector: string;
  status: string;
  answerType: string | null;
  userName: string | null;
  userEmail: string | null;
  conversationTitle: string | null;
  createdAt: string;
  traceId: string;
  resolvedByName: string | null;
  resolvedAt: string | null;
  notifiedAt: string | null;
  curationDocumentId: string | null;
  curationDocumentTitle: string | null;
  curationStatus: string | null;
};

const SENSITIVITY_OPTIONS = [
  { value: "internal", label: "Interno" },
  { value: "public", label: "Publico" },
  { value: "confidential", label: "Confidencial" },
  { value: "restricted", label: "Restrito" },
];

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function ItemMeta({ item }: { item: UnansweredQuestionItem }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
      <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">
        {getSectorLabel(item.sector)}
      </span>
      <span>
        {item.userName ?? "Usuario nao localizado"}
        {item.userEmail ? ` | ${item.userEmail}` : ""}
      </span>
      <span>{formatDateTime(item.createdAt)}</span>
    </div>
  );
}

function AnswerPanel({
  item,
  onDone,
}: {
  item: UnansweredQuestionItem;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"direct" | "upload">("direct");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [sensitivity, setSensitivity] = useState("internal");
  const [answerText, setAnswerText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function submitDirect() {
    if (!answerText.trim()) {
      setError("Escreva a resposta antes de enviar.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/curation/unanswered/${encodeURIComponent(item.id)}/answer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim() || undefined,
            topic: topic.trim() || undefined,
            sensitivity,
            answerText: answerText.trim(),
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao enviar resposta.");
      }
      onDone();
    } catch (err) {
      setError(normalizeError(err, "Falha ao enviar resposta."));
    } finally {
      setBusy(false);
    }
  }

  async function submitUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Selecione um arquivo (.md, .docx, .doc ou .pdf).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("sector", item.sector);
      formData.append("unansweredQuestionId", item.id);
      const response = await fetch("/api/curation/upload", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao enviar documento.");
      }
      onDone();
    } catch (err) {
      setError(normalizeError(err, "Falha ao enviar documento."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
      <div className="flex gap-2">
        <button
          className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] ${
            mode === "direct"
              ? "bg-[var(--accent)] text-white"
              : "border border-[var(--border-strong)] bg-white text-[var(--foreground-soft)]"
          }`}
          onClick={() => setMode("direct")}
          type="button"
        >
          Responder por texto
        </button>
        <button
          className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] ${
            mode === "upload"
              ? "bg-[var(--accent)] text-white"
              : "border border-[var(--border-strong)] bg-white text-[var(--foreground-soft)]"
          }`}
          onClick={() => setMode("upload")}
          type="button"
        >
          Anexar documento
        </button>
      </div>

      {mode === "direct" ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm"
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Titulo (opcional)"
              value={title}
            />
            <input
              className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm"
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Topico (opcional)"
              value={topic}
            />
            <select
              className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm"
              onChange={(event) => setSensitivity(event.target.value)}
              value={sensitivity}
            >
              {SENSITIVITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <textarea
            className="min-h-32 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm leading-6"
            onChange={(event) => setAnswerText(event.target.value)}
            placeholder="Escreva a resposta que deve virar conhecimento curado..."
            value={answerText}
          />
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            disabled={busy}
            onClick={submitDirect}
            type="button"
          >
            <CheckCircle2 className="h-4 w-4" />
            {busy ? "Enviando..." : "Enviar para curadoria"}
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <input
            accept=".md,.docx,.doc,.pdf"
            className="block w-full text-sm"
            ref={fileRef}
            type="file"
          />
          <p className="text-xs text-[var(--foreground-soft)]">
            O documento entra em staging no setor {getSectorLabel(item.sector)} e segue
            o fluxo normal de revisao e promocao.
          </p>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            disabled={busy}
            onClick={submitUpload}
            type="button"
          >
            <Upload className="h-4 w-4" />
            {busy ? "Enviando..." : "Enviar documento"}
          </button>
        </div>
      )}

      {error ? (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function OpenItem({ item }: { item: UnansweredQuestionItem }) {
  const router = useRouter();
  const [answering, setAnswering] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState("");

  async function dismiss() {
    if (dismissing) return;
    setDismissing(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/curation/unanswered/${encodeURIComponent(item.id)}/dismiss`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? "Falha ao descartar.");
      }
      router.refresh();
    } catch (err) {
      setError(normalizeError(err, "Falha ao descartar."));
      setDismissing(false);
    }
  }

  return (
    <li className="rounded-[1.5rem] bg-white px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[var(--foreground-strong)]">
            {item.question || "(pergunta nao registrada)"}
          </p>
          <p className="mt-1 text-xs text-[var(--foreground-soft)]">
            {item.conversationTitle ?? "Conversa nao localizada"}
          </p>
          <ItemMeta item={item} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="inline-flex items-center gap-1 rounded-xl bg-[var(--accent)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white"
            onClick={() => setAnswering((value) => !value)}
            type="button"
          >
            {answering ? "Fechar" : "Responder"}
          </button>
          <button
            className="inline-flex items-center gap-1 rounded-xl border border-[var(--border-strong)] bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--foreground-soft)] disabled:opacity-50"
            disabled={dismissing}
            onClick={dismiss}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
            Descartar
          </button>
          <a
            className="inline-flex items-center gap-1 rounded-xl border border-[var(--border-strong)] bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]"
            href={`/admin/governance?tab=feedback&value=unanswered&trace=${item.traceId}`}
          >
            Trace
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
      {error ? (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
          {error}
        </p>
      ) : null}
      {answering ? (
        <AnswerPanel item={item} onDone={() => router.refresh()} />
      ) : null}
    </li>
  );
}

function AnsweredItem({ item }: { item: UnansweredQuestionItem }) {
  const isLive = item.curationStatus === "PROMOTED";
  return (
    <li className="rounded-[1.5rem] bg-white px-5 py-4 shadow-sm">
      <p className="text-sm font-bold text-[var(--foreground-strong)]">
        {item.question || "(pergunta nao registrada)"}
      </p>
      <ItemMeta item={item} />
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold">
        <span
          className={`rounded-full px-3 py-1 uppercase tracking-[0.16em] ${
            isLive
              ? "bg-emerald-100 text-emerald-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {item.answerType === "upload" ? "Documento" : "Resposta"}:{" "}
          {item.curationStatus ?? "em curadoria"}
        </span>
        {item.curationDocumentTitle ? (
          <span className="text-[var(--foreground-soft)]">
            {item.curationDocumentTitle}
          </span>
        ) : null}
        <span
          className={`rounded-full px-3 py-1 uppercase tracking-[0.16em] ${
            item.notifiedAt
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-700"
          }`}
        >
          {item.notifiedAt ? "Autor notificado" : "Notifica ao promover"}
        </span>
      </div>
      <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
        {item.resolvedByName ? `Respondido por ${item.resolvedByName}` : "Respondido"}
        {item.resolvedAt ? ` | ${formatDateTime(item.resolvedAt)}` : ""}
      </p>
    </li>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="premium-panel flex flex-col items-center gap-3 rounded-[2rem] px-6 py-16 text-center">
      <HelpCircle className="h-8 w-8 text-[var(--muted)]" />
      <p className="max-w-md text-sm font-semibold text-[var(--foreground-strong)]">
        {message}
      </p>
    </div>
  );
}

export function UnansweredQuestionsWorkbench({
  openItems,
  answeredItems,
}: {
  openItems: UnansweredQuestionItem[];
  answeredItems: UnansweredQuestionItem[];
}) {
  const [subTab, setSubTab] = useState<"open" | "answered">("open");
  const items = subTab === "open" ? openItems : answeredItems;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          className={`rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] transition-colors ${
            subTab === "open"
              ? "bg-white text-[var(--foreground-strong)] shadow-sm"
              : "text-[var(--foreground-soft)] hover:text-[var(--foreground-strong)]"
          }`}
          onClick={() => setSubTab("open")}
          type="button"
        >
          Sem resposta
          {openItems.length > 0 ? (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">
              {openItems.length}
            </span>
          ) : null}
        </button>
        <button
          className={`rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] transition-colors ${
            subTab === "answered"
              ? "bg-white text-[var(--foreground-strong)] shadow-sm"
              : "text-[var(--foreground-soft)] hover:text-[var(--foreground-strong)]"
          }`}
          onClick={() => setSubTab("answered")}
          type="button"
        >
          Respondidas
          {answeredItems.length > 0 ? (
            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">
              {answeredItems.length}
            </span>
          ) : null}
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          message={
            subTab === "open"
              ? "Nenhuma pergunta sem resposta no recorte atual."
              : "Nenhuma pergunta respondida ainda."
          }
        />
      ) : (
        <ul className="space-y-2">
          {subTab === "open"
            ? openItems.map((item) => <OpenItem item={item} key={item.id} />)
            : answeredItems.map((item) => (
                <AnsweredItem item={item} key={item.id} />
              ))}
        </ul>
      )}
    </div>
  );
}
