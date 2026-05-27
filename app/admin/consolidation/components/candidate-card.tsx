"use client";

import { ChevronDown, ChevronUp, Eye, Send } from "lucide-react";

import type {
  ConsolidationArtifactType,
  ConsolidationCandidate,
  ConsolidationDocumentRef,
  ConsolidationEvidenceChunk,
} from "@/lib/consolidation";
import { getSectorLabel } from "@/lib/labels";

import type { PreviewState } from "./types";
import { artifactLabel, documentKey, chunkKey } from "./utils";
import { ArtifactPreviewPanel } from "./artifact-preview-panel";
import { CandidateEvidence } from "./candidate-evidence";

type Props = {
  candidate: ConsolidationCandidate;
  isExpanded: boolean;
  candidatePreviews: Partial<Record<ConsolidationArtifactType, PreviewState>>;
  selectedDocumentKeys: Set<string>;
  selectedChunkKeys: Set<string>;
  filteredCandidate: ConsolidationCandidate;
  onToggleExpand: () => void;
  onRequestPreview: (
    artifactType: ConsolidationArtifactType,
    clarificationAnswers?: Record<string, string>,
  ) => void;
  onSendDraft: (artifactType: ConsolidationArtifactType) => void;
  onToggleDocument: (doc: ConsolidationDocumentRef) => void;
  onToggleChunk: (chunk: ConsolidationEvidenceChunk) => void;
  onUpdateTitle: (artifactType: ConsolidationArtifactType, title: string) => void;
  onUpdateMarkdown: (artifactType: ConsolidationArtifactType, markdown: string) => void;
  onUpdateClarificationAnswer: (
    artifactType: ConsolidationArtifactType,
    questionId: string,
    value: string,
  ) => void;
};

export function CandidateCard({
  candidate,
  isExpanded,
  candidatePreviews,
  selectedDocumentKeys,
  selectedChunkKeys,
  filteredCandidate,
  onToggleExpand,
  onRequestPreview,
  onSendDraft,
  onToggleDocument,
  onToggleChunk,
  onUpdateTitle,
  onUpdateMarkdown,
  onUpdateClarificationAnswer,
}: Props) {
  const ddpPreviewLoading = candidatePreviews.ddp?.status === "preview-loading";
  const sopPreviewLoading = candidatePreviews.sop?.status === "preview-loading";
  const hasLoadingPreview = sopPreviewLoading || ddpPreviewLoading;

  return (
    <article
      className="rounded-3xl border border-[var(--border)] bg-white p-5"
      id={`candidate-${candidate.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-lg font-black text-[var(--foreground-strong)]">
              {candidate.processName}
            </h4>
            <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
              conf. {Math.round(candidate.confidence * 100)}%
            </span>
            {candidate.artifactRecommendations.map((type) => (
              <span
                className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700"
                key={type}
              >
                recomendar {artifactLabel(type)}
              </span>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--foreground-soft)]">
            {filteredCandidate.sectorRefs.map((item) => (
              <span className="rounded-full border border-[var(--border)] px-3 py-1" key={item}>
                {getSectorLabel(item)}
              </span>
            ))}
            <span className="rounded-full border border-[var(--border)] px-3 py-1">
              {filteredCandidate.documentRefs.length}/{candidate.documentRefs.length} documento(s)
            </span>
            <span className="rounded-full border border-[var(--border)] px-3 py-1">
              {filteredCandidate.evidenceChunks.length}/{candidate.evidenceChunks.length} chunk(s)
            </span>
          </div>

          {candidate.gaps.length > 0 ? (
            <p className="mt-3 text-sm text-amber-700">Gap principal: {candidate.gaps[0]}</p>
          ) : null}
        </div>

        <button
          className="text-[var(--foreground-soft)]"
          onClick={onToggleExpand}
          type="button"
        >
          {isExpanded ? (
            <ChevronUp className="h-5 w-5" />
          ) : (
            <ChevronDown className="h-5 w-5" />
          )}
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] px-4 py-2 text-sm font-bold text-[var(--foreground-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={sopPreviewLoading}
            onClick={() => onRequestPreview("sop")}
            type="button"
          >
            <Eye className={`h-4 w-4 ${sopPreviewLoading ? "animate-pulse" : ""}`} />
            {sopPreviewLoading ? "Gerando previa SOP..." : "Previa SOP"}
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] px-4 py-2 text-sm font-bold text-[var(--foreground-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={ddpPreviewLoading}
            onClick={() => onRequestPreview("ddp")}
            type="button"
          >
            <Eye className={`h-4 w-4 ${ddpPreviewLoading ? "animate-pulse" : ""}`} />
            {ddpPreviewLoading ? "Gerando previa DDP..." : "Previa DDP"}
          </button>
        </div>

        <div className="hidden h-10 w-px shrink-0 bg-[var(--border)] xl:block" />
        <div className="h-px w-full bg-[var(--border)] xl:hidden" />

        <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
          <button
            className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45"
            disabled={
              !candidatePreviews.sop?.markdown || candidatePreviews.sop.status !== "ready"
            }
            onClick={() => onSendDraft("sop")}
            type="button"
          >
            <Send className="h-4 w-4" />
            {candidatePreviews.sop?.status === "draft-sending"
              ? "Enviando SOP..."
              : "Enviar SOP para curadoria"}
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45"
            disabled={
              !candidatePreviews.ddp?.markdown || candidatePreviews.ddp.status !== "ready"
            }
            onClick={() => onSendDraft("ddp")}
            type="button"
          >
            <Send className="h-4 w-4" />
            {candidatePreviews.ddp?.status === "draft-sending"
              ? "Enviando DDP..."
              : "Enviar DDP para curadoria"}
          </button>
        </div>
      </div>

      {hasLoadingPreview ? (
        <div className="mt-4 space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3">
          {(["sop", "ddp"] as ConsolidationArtifactType[])
            .filter((type) => candidatePreviews[type]?.status === "preview-loading")
            .map((type) => {
              const preview = candidatePreviews[type] as PreviewState;
              const progress = preview.progress ?? 0;
              return (
                <div className="space-y-2" key={type}>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-bold uppercase tracking-wider text-[var(--foreground-strong)]">
                      {artifactLabel(type)} em geracao
                    </span>
                    <span className="text-[var(--foreground-soft)]">
                      {preview.progressLabel ?? "Processando"} · {Math.round(progress)}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white">
                    <div
                      className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      ) : null}

      {isExpanded ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <CandidateEvidence
            candidate={candidate}
            filteredCandidate={filteredCandidate}
            onToggleChunk={onToggleChunk}
            onToggleDocument={onToggleDocument}
            selectedChunkKeys={selectedChunkKeys}
            selectedDocumentKeys={selectedDocumentKeys}
          />

          <div className="space-y-4">
            {(["sop", "ddp"] as ConsolidationArtifactType[]).map((type) => {
              const preview = candidatePreviews[type];
              if (!preview) return null;
              return (
                <ArtifactPreviewPanel
                  artifactType={type}
                  candidate={candidate}
                  key={type}
                  onRequestPreview={(answers) => onRequestPreview(type, answers)}
                  onUpdateClarificationAnswer={(questionId, value) =>
                    onUpdateClarificationAnswer(type, questionId, value)
                  }
                  onUpdateMarkdown={(markdown) => onUpdateMarkdown(type, markdown)}
                  onUpdateTitle={(title) => onUpdateTitle(type, title)}
                  preview={preview}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </article>
  );
}
