"use client";

import { Eye, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  ConsolidationArtifactType,
  ConsolidationCandidate,
} from "@/lib/consolidation";

import type { PreviewState } from "./types";
import { artifactLabel } from "./utils";

type Props = {
  preview: PreviewState;
  artifactType: ConsolidationArtifactType;
  candidate: ConsolidationCandidate;
  onUpdateTitle: (title: string) => void;
  onUpdateMarkdown: (markdown: string) => void;
  onUpdateClarificationAnswer: (questionId: string, value: string) => void;
  onRequestPreview: (clarificationAnswers?: Record<string, string>) => void;
};

export function ArtifactPreviewPanel({
  preview,
  artifactType,
  onUpdateTitle,
  onUpdateMarkdown,
  onUpdateClarificationAnswer,
  onRequestPreview,
}: Props) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const previewLabel = artifactLabel(artifactType);
  const canOpenFullscreen =
    preview.status !== "needs-clarification" && preview.markdown.trim().length > 0;

  useEffect(() => {
    if (!isFullscreen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  return (
    <div className="rounded-2xl border border-[var(--border)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
            Previa {previewLabel}
          </p>
          <p className="text-sm text-[var(--foreground-soft)]">
            O envio abre ou atualiza um item em curadoria. Nao promove para producao.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {preview.message ? (
            <span
              className={`text-xs font-bold ${preview.isError ? "text-red-500" : "text-[var(--accent)]"}`}
            >
              {preview.message}
            </span>
          ) : null}
          {canOpenFullscreen ? (
            <button
              className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] px-3 py-2 text-xs font-bold text-[var(--foreground-strong)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={preview.status === "preview-loading"}
              onClick={() => setIsFullscreen(true)}
              type="button"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Tela inteira
            </button>
          ) : null}
        </div>
      </div>

      {preview.status === "preview-loading" ? (
        <div className="mt-4 space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3">
          <div className="flex items-center justify-between gap-3 text-xs text-[var(--foreground-soft)]">
            <span>{preview.progressLabel ?? "Gerando previa"}</span>
            <span>{Math.round(preview.progress ?? 0)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 ease-out"
              style={{ width: `${preview.progress ?? 0}%` }}
            />
          </div>
        </div>
      ) : null}

      {preview.status === "needs-clarification" && preview.clarificationQuestions?.length ? (
        <div className="mt-4 space-y-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
              Complementacao necessaria para o SOP
            </p>
            <p className="text-sm text-amber-900">
              Responda os pontos abaixo para gerar uma previa com o passo a passo completo.
            </p>
          </div>

          <div className="space-y-3">
            {preview.clarificationQuestions.map((question) => (
              <label className="block space-y-2" key={question.id}>
                <span className="text-sm font-bold text-[var(--foreground-strong)]">
                  {question.label}
                  {question.required ? " *" : ""}
                </span>
                <p className="text-xs text-[var(--foreground-soft)]">{question.prompt}</p>
                <textarea
                  className="h-28 w-full rounded-2xl border border-amber-200 bg-white p-3 text-sm text-[var(--foreground-strong)] outline-none"
                  onChange={(event) =>
                    onUpdateClarificationAnswer(question.id, event.target.value)
                  }
                  placeholder={question.placeholder}
                  value={preview.clarificationAnswers?.[question.id] ?? ""}
                />
              </label>
            ))}
          </div>

          <button
            className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white"
            onClick={() => onRequestPreview(preview.clarificationAnswers ?? {})}
            type="button"
          >
            <Eye className="h-4 w-4" />
            Gerar previa com respostas
          </button>
        </div>
      ) : null}

      {preview.existingArtifact?.markdown ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
            Artefato existente para comparar
          </p>
          <p className="mt-1 text-sm font-bold text-amber-900">
            {preview.existingArtifact.title}
          </p>
          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs text-amber-950">
            {preview.existingArtifact.markdown}
          </pre>
        </div>
      ) : null}

      {preview.status !== "needs-clarification" ? (
        <textarea
          className="mt-4 h-80 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 font-mono text-xs text-[var(--foreground-strong)] outline-none"
          disabled={preview.status === "preview-loading"}
          onChange={(event) => onUpdateMarkdown(event.target.value)}
          value={preview.markdown}
        />
      ) : null}

      {isFullscreen ? (
        <div
          aria-label={`Previa ${previewLabel} em tela inteira`}
          aria-modal="true"
          className="fixed inset-0 z-50 flex flex-col bg-white"
          role="dialog"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                Previa {previewLabel} — nome do documento
              </p>
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-base font-black text-[var(--foreground-strong)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                disabled={preview.status === "preview-loading" || preview.status === "draft-sending"}
                onChange={(event) => onUpdateTitle(event.target.value)}
                placeholder="Nome do documento"
                type="text"
                value={preview.title}
              />
            </div>
            <button
              className="ml-4 inline-flex shrink-0 items-center gap-2 rounded-2xl border border-[var(--border)] px-4 py-2 text-sm font-bold text-[var(--foreground-strong)]"
              onClick={() => setIsFullscreen(false)}
              type="button"
            >
              <Minimize2 className="h-4 w-4" />
              Sair da tela inteira
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-[var(--surface-soft)] px-4 py-6 sm:px-8">
            <textarea
              autoFocus
              className="mx-auto block min-h-[calc(100vh-9rem)] w-full max-w-[794px] resize-none rounded-sm border border-[var(--border)] bg-white p-6 font-mono text-sm leading-6 text-[var(--foreground-strong)] shadow-xl outline-none sm:p-8"
              disabled={preview.status === "preview-loading" || preview.status === "draft-sending"}
              onChange={(event) => onUpdateMarkdown(event.target.value)}
              value={preview.markdown}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
