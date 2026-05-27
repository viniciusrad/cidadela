"use client";

import {
  ArrowRightLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  FileText,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  XCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";

import type { Sector } from "@/lib/domain";
import type { ExistingSop, SopSuggestion } from "@/lib/sop-discovery";

type GenerateResult = {
  id: string;
  status: "pending" | "previewing" | "ready" | "saving" | "done" | "error";
  title?: string;
  sopPath?: string;
  previousSopPath?: string;
  previousSopContent?: string;
  markdown?: string;
  replaced?: boolean;
  sourceDocumentCount?: number;
  error?: string;
};

function AutomationBadge({ potential }: { potential: "high" | "medium" | "low" }) {
  if (potential === "high") {
    return (
      <span className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-emerald-400/15 text-emerald-700">
        <Zap className="h-3 w-3" />
        Alta automação
      </span>
    );
  }

  if (potential === "medium") {
    return (
      <span className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-amber-400/20 text-amber-800">
        <Clock className="h-3 w-3" />
        Pot. automação
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-[var(--surface-muted)] text-[var(--foreground-soft)]">
      <FileText className="h-3 w-3" />
      Documentação
    </span>
  );
}

function ResultStatusIcon({ status }: { status: GenerateResult["status"] }) {
  if (status === "previewing" || status === "saving") {
    return <RefreshCw className="h-4 w-4 animate-spin text-[var(--accent)]" />;
  }
  if (status === "ready") return <Eye className="h-4 w-4 text-[var(--accent)]" />;
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-red-500" />;
  return <div className="h-4 w-4 rounded-full border-2 border-[var(--border)]" />;
}

function SuggestionAction({
  suggestion,
  isSelected,
  isAlreadyGenerated,
  onChange,
}: {
  suggestion: SopSuggestion;
  isSelected: boolean;
  isAlreadyGenerated: boolean;
  onChange: (checked: boolean) => void;
}) {
  const hasMatch = Boolean(suggestion.existingSopMatch);

  if (isAlreadyGenerated) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-emerald-400/15 text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {suggestion.existingSopMatch ? "Substituído" : "Gerado"}
      </div>
    );
  }

  if (hasMatch) {
    return (
      <label className="inline-flex cursor-pointer items-center gap-2">
        <input
          checked={isSelected}
          className="h-4 w-4 shrink-0 accent-amber-600"
          onChange={(e) => onChange(e.target.checked)}
          type="checkbox"
        />
        <span className="text-xs font-bold text-amber-700">Selecionar para substituir</span>
      </label>
    );
  }

  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input
        checked={isSelected}
        className="h-4 w-4 shrink-0 accent-[var(--accent)]"
        onChange={(e) => onChange(e.target.checked)}
        type="checkbox"
      />
      <span className="text-xs font-bold text-[var(--foreground-strong)]">Selecionar para criar</span>
    </label>
  );
}

export function SopDiscoveryPanel({ sector }: { sector: Sector }) {
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SopSuggestion[]>([]);
  const [existingSops, setExistingSops] = useState<ExistingSop[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [generateResults, setGenerateResults] = useState<GenerateResult[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [hasDiscovered, setHasDiscovered] = useState(false);

  const discover = async () => {
    setIsLoading(true);
    setErrorMessage("");
    setSuggestions([]);
    setExistingSops([]);
    setSelected(new Set());
    setGenerateResults([]);
    setExpandedId(null);

    try {
      const response = await fetch("/api/sop/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector }),
      });

      const payload = (await response.json()) as {
        suggestions?: SopSuggestion[];
        existingSops?: ExistingSop[];
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao descobrir artefatos.");
      }

      setSuggestions(payload.suggestions ?? []);
      setExistingSops(payload.existingSops ?? []);
      setHasDiscovered(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao descobrir artefatos.");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelect = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const previewSelected = async () => {
    const toGenerate = suggestions.filter((s) => selected.has(s.id));
    if (toGenerate.length === 0) return;

    setIsGenerating(true);
    setGenerateResults(
      toGenerate.map((s) => ({
        id: s.id,
        status: "pending" as const,
        title: s.topic,
      })),
    );

    for (const suggestion of toGenerate) {
      setGenerateResults((current) =>
        current.map((r) => (r.id === suggestion.id ? { ...r, status: "previewing" as const } : r)),
      );

      try {
        const response = await fetch("/api/sop/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "preview", sector, suggestion }),
        });

        const payload = (await response.json()) as {
          sopPath?: string;
          title?: string;
          replaced?: boolean;
          previousSopPath?: string;
          previousSopContent?: string;
          markdown?: string;
          sourceDocumentCount?: number;
          message?: string;
        };

        if (!response.ok) {
          throw new Error(payload.message ?? "Falha ao gerar prévia.");
        }

        setGenerateResults((current) =>
          current.map((r) =>
            r.id === suggestion.id
              ? {
                  ...r,
                  status: "ready" as const,
                  title: payload.title,
                  sopPath: payload.sopPath,
                  replaced: payload.replaced,
                  previousSopPath: payload.previousSopPath,
                  previousSopContent: payload.previousSopContent,
                  markdown: payload.markdown,
                  sourceDocumentCount: payload.sourceDocumentCount,
                }
              : r,
          ),
        );
      } catch (error) {
        setGenerateResults((current) =>
          current.map((r) =>
            r.id === suggestion.id
              ? {
                  ...r,
                  status: "error" as const,
                  error: error instanceof Error ? error.message : "Erro desconhecido",
                }
              : r,
          ),
        );
      }
    }

    setIsGenerating(false);
    setSelected(new Set());
  };

  const updateDraftMarkdown = (id: string, markdown: string) => {
    setGenerateResults((current) =>
      current.map((result) => (result.id === id ? { ...result, markdown, error: undefined } : result)),
    );
  };

  const saveDraft = async (id: string) => {
    const draft = generateResults.find((result) => result.id === id);
    if (!draft?.sopPath || !draft.markdown) return;

    setGenerateResults((current) =>
      current.map((result) => (result.id === id ? { ...result, status: "saving" as const } : result)),
    );

    try {
      const response = await fetch("/api/sop/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          sector,
          draft: {
            sopPath: draft.sopPath,
            markdown: draft.markdown,
            previousSopPath: draft.previousSopPath,
            sourceDocumentCount: draft.sourceDocumentCount,
            fallbackTitle: draft.title,
          },
        }),
      });

      const payload = (await response.json()) as {
        sopPath?: string;
        title?: string;
        replaced?: boolean;
        previousSopPath?: string;
        sourceDocumentCount?: number;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao salvar artefato.");
      }

      setGenerateResults((current) =>
        current.map((result) =>
          result.id === id
            ? {
                ...result,
                status: "done" as const,
                title: payload.title ?? result.title,
                sopPath: payload.sopPath ?? result.sopPath,
                replaced: payload.replaced ?? result.replaced,
                previousSopPath: payload.previousSopPath ?? result.previousSopPath,
                sourceDocumentCount: payload.sourceDocumentCount ?? result.sourceDocumentCount,
                error: undefined,
              }
            : result,
        ),
      );

      setSuggestions((current) =>
        current.map((suggestion) =>
          suggestion.id === id ? { ...suggestion, existingSopMatch: undefined } : suggestion,
        ),
      );
    } catch (error) {
      setGenerateResults((current) =>
        current.map((result) =>
          result.id === id
            ? {
                ...result,
                status: "ready" as const,
                error: error instanceof Error ? error.message : "Erro desconhecido",
              }
            : result,
        ),
      );
    }
  };

  const selectedCount = selected.size;
  const selectedWithReplacement = suggestions.filter(
    (s) => selected.has(s.id) && s.existingSopMatch,
  );
  const selectedNew = suggestions.filter((s) => selected.has(s.id) && !s.existingSopMatch);
  const doneCount = generateResults.filter((r) => r.status === "done").length;
  const replacedCount = generateResults.filter((r) => r.status === "done" && r.replaced).length;
  const readyCount = generateResults.filter((r) => r.status === "ready").length;

  const buttonLabel = (() => {
    if (isGenerating) return "Gerando prévia...";
    if (selectedCount === 0) return "Selecione itens para prévia";
    const parts: string[] = [];
    if (selectedNew.length > 0) parts.push(`prévia nova ${selectedNew.length}`);
    if (selectedWithReplacement.length > 0) parts.push(`prévia substituição ${selectedWithReplacement.length}`);
    return parts.join(" + ");
  })();

  return (
    <div className="premium-panel rounded-[2rem] p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
            Consolidação de conhecimento
          </p>
          <h3 className="mt-1 text-xl font-black text-[var(--foreground-strong)]">
            Artefatos na base de conhecimento
          </h3>
          <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">
            Pesquisa ampla na base vetorial do setor. Documentos sobre o mesmo assunto são agrupados em um artefato consolidado.
            A nova versão é exibida para ajuste antes de salvar; artefatos existentes aparecem lado a lado para comparação.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-2 text-sm font-bold text-[var(--foreground-strong)] transition-colors hover:border-[var(--accent)] disabled:opacity-50"
            disabled={isLoading || isGenerating}
            onClick={() => void discover()}
            type="button"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            {isLoading ? "Pesquisando..." : hasDiscovered ? "Atualizar pesquisa" : "Iniciar pesquisa"}
          </button>
        </div>
      </div>

      {errorMessage ? (
        <div className="mt-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-[var(--danger)]">
          {errorMessage}
        </div>
      ) : null}

      {isLoading ? (
        <div className="mt-8 space-y-4">
          {[1, 2, 3].map((i) => (
            <div className="h-20 animate-pulse rounded-2xl bg-[var(--surface-muted)]" key={i} />
          ))}
          <p className="text-center text-sm text-[var(--foreground-soft)]">
            Pesquisando e agrupando conhecimentos correlatos na base...
          </p>
        </div>
      ) : null}

      {!isLoading && !hasDiscovered ? (
        <div className="mt-8 rounded-2xl border border-dashed border-[var(--border)] p-10 text-center">
          <Bot className="mx-auto h-10 w-10 text-[var(--muted)]" />
          <p className="mt-4 text-sm font-bold text-[var(--foreground-strong)]">
            Nenhuma pesquisa executada ainda
          </p>
          <p className="mt-2 text-sm text-[var(--foreground-soft)]">
            Clique em &ldquo;Iniciar pesquisa&rdquo; para analisar a base de conhecimento do setor.
          </p>
        </div>
      ) : null}

      {!isLoading && hasDiscovered && suggestions.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-[var(--border)] p-10 text-center">
          <FileText className="mx-auto h-10 w-10 text-[var(--muted)]" />
          <p className="mt-4 text-sm font-bold text-[var(--foreground-strong)]">
            Nenhum agrupamento identificado
          </p>
          <p className="mt-2 text-sm text-[var(--foreground-soft)]">
            Ingira documentos no setor para que a descoberta encontre candidatos a consolidação.
          </p>
        </div>
      ) : null}

      {generateResults.length > 0 ? (
        <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              Prévias e salvamentos
            </p>
            <div className="flex gap-2">
              {readyCount > 0 ? (
                <span className="rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-[var(--accent-soft)] text-[var(--accent)]">
                  {readyCount} aguardando revisão
                </span>
              ) : null}
              {doneCount - replacedCount > 0 ? (
                <span className="rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-emerald-400/15 text-emerald-700">
                  {doneCount - replacedCount} criado(s)
                </span>
              ) : null}
              {replacedCount > 0 ? (
                <span className="rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-amber-400/20 text-amber-800">
                  {replacedCount} substituído(s)
                </span>
              ) : null}
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {generateResults.map((result) => (
              <div
                className={`rounded-xl border bg-white px-4 py-3 ${
                  result.status === "done" && result.replaced
                    ? "border-amber-200"
                    : result.status === "done"
                      ? "border-emerald-200"
                      : "border-[var(--border)]"
                }`}
                key={result.id}
              >
                <div className="flex items-center gap-3">
                  <ResultStatusIcon status={result.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-[var(--foreground-strong)]">
                      {result.title ?? result.id}
                    </p>
                    {result.status === "done" || result.status === "ready" || result.status === "saving" ? (
                      <div className="mt-1 space-y-0.5">
                        {result.replaced && result.previousSopPath ? (
                          <p className="text-xs text-amber-700">
                            Artefato anterior substituído:{" "}
                            <span className="font-mono">{result.previousSopPath.split(/[\\/]/).pop()}</span>
                          </p>
                        ) : null}
                        {result.sopPath ? (
                          <p className="truncate font-mono text-[10px] text-[var(--muted)]">
                            {result.sopPath}
                          </p>
                        ) : null}
                        {result.sourceDocumentCount && result.sourceDocumentCount > 1 ? (
                          <p className="text-[10px] text-[var(--foreground-soft)]">
                            {result.sourceDocumentCount} documentos consolidados neste artefato
                          </p>
                        ) : null}
                        {result.status === "ready" ? (
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                            Revise a prévia abaixo antes de salvar o documento final.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {result.error ? (
                      <p className="mt-0.5 text-xs text-red-600">{result.error}</p>
                    ) : null}
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                      result.status === "done" && result.replaced
                        ? "bg-amber-400/20 text-amber-800"
                        : result.status === "done"
                          ? "bg-emerald-400/15 text-emerald-700"
                          : result.status === "error"
                            ? "bg-red-500/15 text-red-700"
                            : result.status === "previewing" || result.status === "saving" || result.status === "ready"
                              ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                              : "bg-[var(--surface-muted)] text-[var(--foreground-soft)]"
                    }`}
                  >
                    {result.status === "pending"
                      ? "aguardando"
                      : result.status === "previewing"
                        ? "prévia"
                        : result.status === "saving"
                          ? "salvando"
                          : result.status === "ready"
                            ? "revisar"
                            : result.status === "done" && result.replaced
                              ? "substituído"
                              : result.status}
                  </span>
                </div>
                {result.status === "ready" || result.status === "saving" ? (
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    {result.previousSopContent ? (
                      <div className="min-w-0">
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-amber-700">
                          Artefato existente
                        </p>
                        <pre className="h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-amber-200 bg-amber-50/50 p-3 font-mono text-xs leading-5 text-amber-950">
                          {result.previousSopContent}
                        </pre>
                      </div>
                    ) : null}
                    <div className={result.previousSopContent ? "min-w-0" : "min-w-0 lg:col-span-2"}>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
                          Nova versão editável
                        </p>
                        <button
                          className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50"
                          disabled={result.status === "saving" || !result.markdown?.trim()}
                          onClick={() => void saveDraft(result.id)}
                          type="button"
                        >
                          <Save className="h-3.5 w-3.5" />
                          {result.status === "saving" ? "Salvando..." : "Salvar final"}
                        </button>
                      </div>
                      <textarea
                        className="h-80 w-full resize-y rounded-xl border border-[var(--border)] bg-white p-3 font-mono text-xs leading-5 text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-70"
                        disabled={result.status === "saving"}
                        onChange={(event) => updateDraftMarkdown(result.id, event.target.value)}
                        value={result.markdown ?? ""}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!isLoading && suggestions.length > 0 ? (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm text-[var(--foreground-soft)]">
                {suggestions.length} agrupamento(s) sugerido(s) · {existingSops.length} artefato(s) existente(s)
              </p>
              {suggestions.some((s) => s.existingSopMatch) ? (
                <p className="text-xs text-amber-700">
                  Procedimentos marcados com &quot;Artefato existente&quot; exibem o arquivo atual junto da nova versão antes do salvamento.
                </p>
              ) : null}
            </div>

            <button
              className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50"
              disabled={selectedCount === 0 || isGenerating}
              onClick={() => void previewSelected()}
              type="button"
            >
              <Sparkles className="h-4 w-4" />
              {buttonLabel}
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {suggestions.map((suggestion) => {
              const isSelected = selected.has(suggestion.id);
              const isExpanded = expandedId === suggestion.id;
              const result = generateResults.find((r) => r.id === suggestion.id);
              const isAlreadyGenerated = result?.status === "done";
              const hasMatch = Boolean(suggestion.existingSopMatch);

              return (
                <article
                  className={`rounded-2xl border transition-all ${
                    isAlreadyGenerated && result?.replaced
                      ? "border-amber-200 bg-amber-50/40"
                      : isAlreadyGenerated
                        ? "border-emerald-200 bg-emerald-50/40"
                        : hasMatch && isSelected
                          ? "border-amber-400 bg-amber-50/40"
                          : isSelected
                            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                            : "border-[var(--border)] bg-white hover:border-[var(--border-strong)]"
                  }`}
                  key={suggestion.id}
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        <SuggestionAction
                          isAlreadyGenerated={isAlreadyGenerated}
                          isSelected={isSelected}
                          onChange={(checked) => toggleSelect(suggestion.id, checked)}
                          suggestion={suggestion}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-black text-[var(--foreground-strong)]">
                            {suggestion.topic}
                          </h4>
                          <span className="rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-[var(--surface-muted)] text-[var(--foreground-soft)]">
                            {suggestion.documentTypeLabel ?? suggestion.documentType ?? "Documento"}
                          </span>
                          <AutomationBadge potential={suggestion.automationPotential} />
                          {hasMatch ? (
                            <span className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-amber-400/20 text-amber-800">
                              <ArrowRightLeft className="h-3 w-3" />
                              Substituirá artefato existente
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-[var(--surface-muted)] text-[var(--foreground-soft)]">
                              <Plus className="h-3 w-3" />
                              Novo artefato
                            </span>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {suggestion.sourceDocuments.map((doc) => (
                            <span
                              className="rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--foreground-soft)]"
                              key={doc.sourceDocumentId}
                              title={doc.sourceDocumentId}
                            >
                              {doc.documentTitle.slice(0, 40)}{doc.documentTitle.length > 40 ? "…" : ""} · {doc.chunkCount} trecho(s)
                            </span>
                          ))}
                        </div>
                      </div>

                      <button
                        className="shrink-0 text-[var(--foreground-soft)] transition-colors hover:text-[var(--accent)]"
                        onClick={() => setExpandedId(isExpanded ? null : suggestion.id)}
                        type="button"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    {isExpanded ? (
                      <div className="mt-4 space-y-3 pl-0">
                        {suggestion.automationPotential !== "low" ? (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                              Potencial de automação
                            </p>
                            <p className="mt-2 text-xs leading-5 text-emerald-800">
                              {suggestion.automationPotential === "high"
                                ? "Sinais claros de automação (APIs, webhooks, agendamentos, scripts). Candidato prioritário para RPA ou integração de sistemas."
                                : "Padrões periódicos ou condicionais detectados. Avaliar automação parcial ou alertas automáticos."}
                            </p>
                          </div>
                        ) : null}

                        {/* Chunks agrupados por documento */}
                        {suggestion.sourceDocuments.map((doc) => {
                          const docChunks = suggestion.topChunks.filter(
                            (c) => c.sourceDocumentId === doc.sourceDocumentId,
                          );

                          return (
                            <div key={doc.sourceDocumentId}>
                              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                                {doc.documentTitle} · {docChunks.length} trecho(s)
                              </p>
                              <div className="space-y-2">
                                {docChunks.map((chunk) => (
                                  <div
                                    className="rounded-xl border border-[var(--border)] bg-white p-3"
                                    key={`${chunk.sourceDocumentId}-${chunk.chunkIndex}`}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                                        Trecho {chunk.chunkIndex + 1}
                                      </p>
                                      <p className="truncate text-[10px] text-[var(--muted)]">
                                        {chunk.headingPathText}
                                      </p>
                                    </div>
                                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-muted)] p-3 font-mono text-xs leading-5 text-[var(--foreground)]">
                                      {chunk.content}
                                    </pre>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}

                        {hasMatch && suggestion.existingSopMatch ? (
                          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
                              Artefato a ser substituído
                            </p>
                            <p className="mt-2 text-xs leading-5 text-amber-800">
                              Arquivo:{" "}
                              <span className="font-mono">{suggestion.existingSopMatch.fileName}</span>
                            </p>
                            {suggestion.existingSopMatch.title ? (
                              <p className="mt-1 text-xs text-amber-700">
                                Título atual: {suggestion.existingSopMatch.title}
                              </p>
                            ) : null}
                            {suggestion.existingSopMatch.generatedAt ? (
                              <p className="mt-1 text-xs text-amber-700">
                                Gerado em:{" "}
                                {new Date(suggestion.existingSopMatch.generatedAt).toLocaleDateString("pt-BR")}
                              </p>
                            ) : null}
                            <p className="mt-2 text-xs font-bold text-amber-800">
                              O arquivo existente será sobrescrito com o artefato consolidado que inclui todos os documentos listados acima.
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
