"use client";

import { FileSearch } from "lucide-react";

import type { ConsolidationCandidate } from "@/lib/consolidation";

import { artifactLabel } from "./utils";

type Props = {
  candidates: ConsolidationCandidate[];
  onSelectCandidate: (candidateId: string) => void;
};

export function ConsolidationRadar({ candidates, onSelectCandidate }: Props) {
  return (
    <div className="premium-panel rounded-[2rem] p-6">
      <div className="flex items-center gap-2">
        <FileSearch className="h-4 w-4 text-[var(--accent)]" />
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
          Radar de Consolidacao
        </p>
      </div>
      <p className="mt-2 text-sm text-[var(--foreground-soft)]">
        Sugestoes de alta confiança para iniciar a geracao de artefatos.
      </p>

      <div className="mt-6 space-y-3">
        {candidates
          .filter((c) => c.confidence >= 0.7)
          .slice(0, 5)
          .map((candidate) => (
            <button
              className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-left transition-colors hover:border-[var(--accent)]/40"
              key={candidate.id}
              onClick={() => {
                onSelectCandidate(candidate.id);
                document
                  .getElementById(`candidate-${candidate.id}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              type="button"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
                  {Math.round(candidate.confidence * 100)}% conf.
                </span>
                <div className="flex gap-1">
                  {candidate.artifactRecommendations.map((type) => (
                    <span
                      className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-700"
                      key={type}
                    >
                      {artifactLabel(type)}
                    </span>
                  ))}
                </div>
              </div>
              <p className="mt-2 text-sm font-bold text-[var(--foreground-strong)]">
                {candidate.processName}
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-[var(--foreground-soft)]">
                {candidate.processSummary}
              </p>
            </button>
          ))}
        {candidates.length === 0 && (
          <p className="py-4 text-center text-sm text-[var(--foreground-soft)]">
            Nenhum processo analisado.
          </p>
        )}
      </div>
    </div>
  );
}
