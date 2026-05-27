"use client";

import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  FileText,
  GitBranch,
  Loader2,
  Network,
  Pencil,
  Share2,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type DocumentMeta = {
  id: string;
  title: string;
  sector: string | null;
  topic: string | null;
  documentType: string | null;
  status: string | null;
};

type EntityRow = { type: string; name: string };

type RelatedRow = {
  id: string;
  title: string;
  sector: string | null;
  sharedConcepts: string[];
  overlap: number;
};

type DetailResponse = {
  document: DocumentMeta;
  content: string;
  entities: EntityRow[];
  related: RelatedRow[];
};

const ENTITY_META: Record<string, { label: string; icon: React.ElementType; cls: string }> = {
  HAS_CONCEPT: {
    label: "Conceitos",
    icon: BookOpen,
    cls: "bg-blue-500/10 text-blue-300 border-blue-400/40",
  },
  DESCRIBES: {
    label: "Procedimentos",
    icon: GitBranch,
    cls: "bg-violet-500/10 text-violet-300 border-violet-400/40",
  },
  REFERENCES_SYSTEM: {
    label: "Sistemas",
    icon: Wrench,
    cls: "bg-teal-500/10 text-teal-300 border-teal-400/40",
  },
  COMPLIES_WITH: {
    label: "Regulamentações",
    icon: Share2,
    cls: "bg-amber-500/10 text-amber-300 border-amber-400/40",
  },
};

// ─── Tiny safe markdown renderer ──────────────────────────────────────────────

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(line: string) {
  let out = escapeHtml(line);
  out = out.replace(
    /`([^`]+)`/g,
    '<code class="rounded bg-[var(--surface)] px-1 py-0.5 text-[12px]">$1</code>',
  );
  out = out.replace(
    /\*\*([^*]+)\*\*/g,
    '<strong class="font-semibold text-[var(--foreground)]">$1</strong>',
  );
  return out;
}

function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }

    // Fenced code block
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(escapeHtml(lines[i]));
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        `<pre class="my-2 overflow-x-auto rounded bg-[var(--surface)] p-3 text-[12px] text-[var(--foreground-soft)]"><code>${buf.join("\n")}</code></pre>`,
      );
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const sizes = ["text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-sm"];
      blocks.push(
        `<h${level} class="${sizes[level - 1]} font-semibold tracking-tight text-[var(--foreground)] mt-5 mb-2">${renderInline(h[2])}</h${level}>`,
      );
      i += 1;
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        `<ol class="my-2 ml-5 list-decimal space-y-1 text-[13px] text-[var(--foreground-soft)]">${items
          .map((it) => `<li>${renderInline(it)}</li>`)
          .join("")}</ol>`,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(
        `<ul class="my-2 ml-5 list-disc space-y-1 text-[13px] text-[var(--foreground-soft)]">${items
          .map((it) => `<li>${renderInline(it)}</li>`)
          .join("")}</ul>`,
      );
      continue;
    }

    const paragraph: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s|^\s*[-*]\s|^\s*\d+\.\s|^```/.test(lines[i])
    ) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push(
      `<p class="my-2 text-[13px] leading-relaxed text-[var(--foreground-soft)]">${renderInline(paragraph.join(" "))}</p>`,
    );
  }
  return blocks.join("");
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DocumentDetailModal({
  documentId,
  documentTitle,
  sector,
  documentType,
  status,
  onClose,
}: {
  documentId: string;
  documentTitle?: string;
  sector?: string;
  documentType?: string | null;
  status?: string | null;
  onClose: () => void;
}) {
  // Stack of doc IDs visited (so user can go back when navigating to related)
  const [stack, setStack] = useState<string[]>([documentId]);
  const currentId = stack[stack.length - 1];

  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [titleSavedNote, setTitleSavedNote] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const params = new URLSearchParams();
      if (sector) params.set("sector", sector);
      if (documentTitle) params.set("title", documentTitle);
      if (documentType) params.set("documentType", documentType);
      if (status) params.set("status", status);
      const qs = params.toString();
      const res = await fetch(
        `/api/graph/document/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`,
      );
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Falha ao carregar documento");
      } else {
        setData(json as DetailResponse);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha desconhecida");
    } finally {
      setLoading(false);
    }
  }, [documentTitle, documentType, sector, status]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load(currentId);
    }, 0);
    return () => window.clearTimeout(t);
  }, [currentId, load]);

  const openRelated = (id: string) => {
    setStack((prev) => [...prev, id]);
  };

  const goBack = () => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  };

  const startEditTitle = () => {
    setTitleDraft(data?.document.title ?? "");
    setTitleError(null);
    setTitleSavedNote(null);
    setEditingTitle(true);
  };

  const cancelEditTitle = () => {
    setEditingTitle(false);
    setTitleError(null);
  };

  const saveTitle = async () => {
    if (!data) return;
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleError("Informe um titulo.");
      return;
    }
    if (trimmed === data.document.title) {
      setEditingTitle(false);
      return;
    }
    setSavingTitle(true);
    setTitleError(null);
    try {
      const res = await fetch(
        `/api/admin/documents/${encodeURIComponent(data.document.id)}/title`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newTitle: trimmed }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        warning?: string;
        qdrantChunksUpdated?: number;
        curationUpdated?: boolean;
        reviewCreated?: boolean;
      };
      if (!res.ok) {
        setTitleError(body.message || `Erro ${res.status}`);
        return;
      }
      setEditingTitle(false);
      const note = body.warning
        ? body.warning
        : `Atualizado em ${body.qdrantChunksUpdated ?? 0} trechos${
            body.curationUpdated
              ? " e enviado para curadoria como NEEDS_REVISION."
              : " (sem entrada na curadoria)."
          }`;
      setTitleSavedNote(note);
      await load(currentId);
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSavingTitle(false);
    }
  };

  const html = data ? renderMarkdown(data.content || "_(sem conteúdo indexado para este documento)_") : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        {/* Header */}
        <div className="relative border-b border-[var(--border)] px-6 py-4">
          <div className="pointer-events-none absolute inset-0 overflow-hidden bg-gradient-to-r from-blue-500/10 via-transparent to-teal-500/10" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.24em] text-blue-300">
                <FileText className="h-3 w-3" />
                Documento integral
                {stack.length > 1 && (
                  <span className="text-[var(--muted)]">
                    · navegação {stack.length}
                  </span>
                )}
              </div>
              {!editingTitle && (
                <div className="mt-1 flex items-start gap-2">
                  <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-[var(--foreground)]">
                    {data?.document.title ?? (loading ? "Carregando…" : "")}
                  </h2>
                  {data && (
                    <button
                      aria-label="Editar titulo"
                      className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)]"
                      onClick={startEditTitle}
                      type="button"
                    >
                      <Pencil className="h-3 w-3" /> Editar titulo
                    </button>
                  )}
                </div>
              )}
              {editingTitle && (
                <div className="mt-1 space-y-2">
                  <input
                    autoFocus
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-base font-semibold text-[var(--foreground)] outline-none focus:border-blue-400"
                    disabled={savingTitle}
                    maxLength={300}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveTitle();
                      if (e.key === "Escape") cancelEditTitle();
                    }}
                    placeholder="Titulo descritivo do documento"
                    type="text"
                    value={titleDraft}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-blue-500 disabled:opacity-40"
                      disabled={savingTitle || !titleDraft.trim()}
                      onClick={() => void saveTitle()}
                      type="button"
                    >
                      {savingTitle ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" /> Salvando...
                        </>
                      ) : (
                        <>Salvar e enviar para curadoria</>
                      )}
                    </button>
                    <button
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-1.5 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)]"
                      disabled={savingTitle}
                      onClick={cancelEditTitle}
                      type="button"
                    >
                      Cancelar
                    </button>
                  </div>
                  {titleError && (
                    <p className="flex items-center gap-1 text-[11px] text-red-400">
                      <AlertCircle className="h-3 w-3" /> {titleError}
                    </p>
                  )}
                </div>
              )}
              {titleSavedNote && !editingTitle && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" /> {titleSavedNote}
                </p>
              )}
              {data && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {data.document.sector && (
                    <span className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-[var(--muted)]">
                      {data.document.sector}
                    </span>
                  )}
                  {data.document.documentType && (
                    <span className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                      {data.document.documentType}
                    </span>
                  )}
                  {data.document.status && (
                    <span className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                      {data.document.status}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {stack.length > 1 && (
                <button
                  onClick={goBack}
                  className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Voltar
                </button>
              )}
              <button
                onClick={onClose}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-1.5 text-[var(--muted)] hover:text-[var(--foreground)]"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div ref={scrollRef} className="flex flex-1 overflow-hidden">
          {/* Main content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {loading && (
              <div className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando conteúdo do documento…
              </div>
            )}

            {error && !loading && (
              <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <p className="text-[12px] text-red-300">{error}</p>
              </div>
            )}

            {data && !loading && (
              <article className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-6 py-5">
                <div
                  className="living-doc-prose"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              </article>
            )}
          </div>

          {/* Sidebar */}
          <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-[var(--border)] bg-[var(--surface-raised)] px-4 py-5 lg:block">
            {data && (
              <>
                {/* Entities */}
                <div className="space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                    Entidades indexadas
                  </p>
                  {Object.entries(ENTITY_META).map(([type, meta]) => {
                    const Icon = meta.icon;
                    const items = data.entities
                      .filter((e) => e.type === type)
                      .map((e) => e.name);
                    if (items.length === 0) return null;
                    return (
                      <div key={type}>
                        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {items.map((name) => (
                            <span
                              key={name}
                              className={`rounded border px-1.5 py-0.5 text-[10px] ${meta.cls}`}
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {data.entities.length === 0 && (
                    <p className="text-[11px] text-[var(--muted)]">
                      Sem entidades indexadas para este documento.
                    </p>
                  )}
                </div>

                {/* Related */}
                <div className="mt-5 border-t border-[var(--border)] pt-4">
                  <p className="mb-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                    <Network className="h-3 w-3" />
                    Documentos relacionados
                  </p>
                  {data.related.length === 0 ? (
                    <p className="text-[11px] text-[var(--muted)]">
                      Nenhum documento compartilha conceitos com este.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {data.related.map((r) => (
                        <li key={r.id}>
                          <button
                            onClick={() => openRelated(r.id)}
                            className="group flex w-full items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-left transition-colors hover:border-blue-400/60"
                          >
                            <FileText className="mt-0.5 h-3 w-3 shrink-0 text-[var(--muted)] group-hover:text-blue-300" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[11px] font-medium text-[var(--foreground)] group-hover:text-blue-300">
                                {r.title}
                              </p>
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                {r.sector && (
                                  <span className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-1 py-0 text-[9px] uppercase tracking-widest text-[var(--muted)]">
                                    {r.sector}
                                  </span>
                                )}
                                <span className="rounded border border-blue-400/40 bg-blue-500/10 px-1 py-0 text-[9px] tabular-nums text-blue-300">
                                  {r.overlap} em comum
                                </span>
                              </div>
                              {r.sharedConcepts.length > 0 && (
                                <p className="mt-1 truncate text-[10px] text-[var(--muted)]">
                                  {r.sharedConcepts.slice(0, 4).join(" · ")}
                                </p>
                              )}
                            </div>
                            <ChevronRight className="h-3 w-3 shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-blue-300" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
