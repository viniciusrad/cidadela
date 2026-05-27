"use client";

import type {
  ConsolidationCandidate,
  ConsolidationDocumentRef,
  ConsolidationEvidenceChunk,
} from "@/lib/consolidation";
import { getSectorLabel } from "@/lib/labels";

import { documentKey, chunkKey } from "./utils";

type Props = {
  candidate: ConsolidationCandidate;
  filteredCandidate: ConsolidationCandidate;
  selectedDocumentKeys: Set<string>;
  selectedChunkKeys: Set<string>;
  onToggleDocument: (doc: ConsolidationDocumentRef) => void;
  onToggleChunk: (chunk: ConsolidationEvidenceChunk) => void;
};

export function CandidateEvidence({
  candidate,
  filteredCandidate,
  selectedDocumentKeys,
  selectedChunkKeys,
  onToggleDocument,
  onToggleChunk,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
          Cobertura operacional
        </p>
        <div className="mt-3 space-y-2 text-sm text-[var(--foreground-soft)]">
          <p>Atores: {candidate.identifiedActors.length || 0}</p>
          <p>Sistemas: {candidate.identifiedSystems.length || 0}</p>
          <p>Entradas: {candidate.identifiedInputs.length || 0}</p>
          <p>Saidas: {candidate.identifiedOutputs.length || 0}</p>
          <p>Passos extraidos: {candidate.identifiedSteps.length || 0}</p>
          <p>
            Base selecionada: {filteredCandidate.documentRefs.length} documento(s) e{" "}
            {filteredCandidate.evidenceChunks.length} chunk(s)
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
          Proveniencia
        </p>
        <p className="mt-2 text-xs text-[var(--foreground-soft)]">
          Todos os documentos comecam marcados. Desmarque os que nao pertencem ao processo.
        </p>
        <div className="mt-3 space-y-2 text-sm text-[var(--foreground-soft)]">
          {candidate.documentRefs.map((doc) => (
            <div
              className="rounded-xl border border-[var(--border)] bg-white p-3"
              key={`${doc.sector}:${doc.sourceDocumentId}:${doc.source}`}
            >
              <label className="flex items-start gap-3">
                <input
                  checked={selectedDocumentKeys.has(documentKey(doc))}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-[var(--border)] text-[var(--accent)]"
                  onChange={() => onToggleDocument(doc)}
                  type="checkbox"
                />
                <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <p className="font-bold text-[var(--foreground-strong)]">{doc.title}</p>
                  <p className="break-words">
                    {getSectorLabel(doc.sector)} · {doc.source}
                  </p>
                  <p className="break-all font-mono text-[10px] text-[var(--muted)]">
                    {doc.sourceDocumentId}
                  </p>
                </div>
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
          Evidencias
        </p>
        <p className="mt-2 text-xs text-[var(--foreground-soft)]">
          Ajuste tambem os chunks usados na geracao. Chunks de documentos desmarcados ficam
          indisponiveis.
        </p>
        <div className="mt-3 space-y-2">
          {candidate.evidenceChunks.map((chunk, index) => (
            <div
              className="rounded-xl border border-[var(--border)] bg-white p-3"
              key={`${chunk.sourceDocumentId}-${chunk.chunkIndex}-${index}`}
            >
              <label className="flex items-start gap-3">
                <input
                  checked={selectedChunkKeys.has(chunkKey(chunk))}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-[var(--border)] text-[var(--accent)]"
                  disabled={
                    !selectedDocumentKeys.has(
                      `${chunk.sector}:${chunk.source}:${chunk.sourceDocumentId}`,
                    )
                  }
                  onChange={() => onToggleChunk(chunk)}
                  type="checkbox"
                />
                <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                    {chunk.sector} · {chunk.source} · score {chunk.score.toFixed(2)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--foreground-soft)]">
                    {chunk.headingPathText}
                  </p>
                  <p className="mt-2 text-sm text-[var(--foreground-strong)]">{chunk.excerpt}</p>
                </div>
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
