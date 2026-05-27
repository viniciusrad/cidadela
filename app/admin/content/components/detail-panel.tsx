"use client";

import { SECTOR_LABELS } from "@/lib/labels";

import { Meta } from "./meta";
import {
  sensitivityClass,
  sensitivityLabel,
  type ChunkRow,
  type ContentListMode,
} from "./types";

type Props = {
  selected: ChunkRow | null;
  listMode: ContentListMode;
  relatedRows: ChunkRow[];
  relatedLoading: boolean;
  relatedError: string | null;
  consolidatedContent: string;
  viewTab: "full" | "chunks";
  onViewTabChange: (tab: "full" | "chunks") => void;
  onSelectRow: (row: ChunkRow) => void;
};

export function DetailPanel({
  selected,
  listMode,
  relatedRows,
  relatedLoading,
  relatedError,
  consolidatedContent,
  viewTab,
  onViewTabChange,
  onSelectRow,
}: Props) {
  return (
    <aside className="premium-panel rounded-[2rem] p-6 flex flex-col">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
          {listMode === "files" ? "Detalhe do arquivo" : "Detalhe do trecho"}
        </p>
        {selected && typeof selected.score === "number" && (
          <span className="text-[11px] font-bold text-[var(--foreground-soft)]">
            score {selected.score.toFixed(4)}
          </span>
        )}
      </div>

      {selected ? (
        <div className="mt-3 flex flex-col gap-4 flex-1 min-h-0">
          <div>
            <p className="text-xl font-black text-[var(--foreground-strong)]">
              {selected.documentTitle}
            </p>
            <p className="text-sm text-[var(--foreground-soft)]">
              {selected.headingPathText}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-[11px] sm:grid-cols-3">
            <Meta label="Setor" value={SECTOR_LABELS[selected.sector]} />
            <Meta
              label="Sensibilidade"
              value={sensitivityLabel(selected.sensitivity)}
            />
            <Meta label="Formato" value={selected.sourceFormat} />
            <Meta label="Trecho #" value={String(selected.chunkIndex)} />
            <Meta label="Arquivo" value={selected.fileName} />
            {selected.topic && <Meta label="Topico" value={selected.topic} />}
            {selected.owner && <Meta label="Owner" value={selected.owner} />}
            <div className="sm:col-span-2">
              <Meta label="Document ID" mono value={selected.documentId} />
            </div>
            {selected.sourceDocumentId &&
              selected.sourceDocumentId !== selected.documentId && (
                <div className="sm:col-span-2">
                  <Meta
                    label="Source Document ID"
                    mono
                    value={selected.sourceDocumentId}
                  />
                </div>
              )}
            {selected.contentHash && (
              <div className="sm:col-span-2">
                <Meta label="Hash" mono value={selected.contentHash} />
              </div>
            )}
            {selected.createdAt && (
              <Meta label="Criado em" value={selected.createdAt} />
            )}
            {selected.relativePath && (
              <div className="sm:col-span-3">
                <Meta
                  label="Caminho relativo"
                  mono
                  value={selected.relativePath}
                />
              </div>
            )}
          </dl>

          <div className="flex gap-1 rounded-xl bg-[var(--surface-muted)] p-1">
            <button
              className={`flex-1 rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-all ${
                viewTab === "full"
                  ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                  : "text-[var(--foreground-soft)] hover:text-[var(--foreground-strong)]"
              }`}
              onClick={() => onViewTabChange("full")}
              type="button"
            >
              Conteudo completo
            </button>
            <button
              className={`flex-1 rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-all ${
                viewTab === "chunks"
                  ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                  : "text-[var(--foreground-soft)] hover:text-[var(--foreground-strong)]"
              }`}
              onClick={() => onViewTabChange("chunks")}
              type="button"
            >
              Trechos
            </button>
          </div>

          {viewTab === "full" ? (
            <div className="flex flex-1 min-h-0 flex-col">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Visao consolidada
                </p>
                <span className="text-[11px] font-bold text-[var(--foreground-soft)]">
                  {relatedLoading
                    ? "Carregando..."
                    : `${relatedRows.length || 1} parte(s)`}
                </span>
              </div>
              <pre className="flex-1 min-h-[420px] overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-5 text-sm whitespace-pre-wrap break-words text-[var(--foreground-strong)] leading-relaxed">
                {consolidatedContent}
              </pre>
            </div>
          ) : (
            <>
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Outros trechos do arquivo
                  </p>
                  <span className="text-[11px] font-bold text-[var(--foreground-soft)]">
                    {relatedLoading
                      ? "Carregando..."
                      : `${relatedRows.length} relacionado(s)`}
                  </span>
                </div>

                {relatedError && (
                  <p className="rounded-2xl border border-red-300 bg-red-50 p-3 text-xs text-red-800">
                    {relatedError}
                  </p>
                )}

                {!relatedError && relatedRows.length > 0 && (
                  <div className="grid max-h-64 gap-3 overflow-auto pr-1 sm:grid-cols-2">
                    {relatedRows.map((row) => {
                      const isCurrent =
                        row.id === selected.id && row.sector === selected.sector;

                      return (
                        <button
                          aria-current={isCurrent ? "true" : undefined}
                          className={`rounded-xl border p-4 text-left transition-all ${
                            isCurrent
                              ? "border-[var(--accent)] bg-[var(--surface-soft)] shadow-sm"
                              : "border-[var(--border)] bg-white hover:border-[var(--accent)]"
                          }`}
                          key={`${row.sector}:${row.id}`}
                          onClick={() => onSelectRow(row)}
                          type="button"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[9px] font-black uppercase tracking-[0.15em] text-[var(--muted)]">
                              trecho #{row.chunkIndex}
                            </span>
                            <div className="flex flex-wrap justify-end gap-1">
                              {isCurrent && (
                                <span className="rounded-full border border-[var(--accent)] bg-white px-2 py-0.5 text-[8px] font-black uppercase text-[var(--accent)]">
                                  Atual
                                </span>
                              )}
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase ${sensitivityClass(row.sensitivity)}`}
                              >
                                {sensitivityLabel(row.sensitivity)}
                              </span>
                            </div>
                          </div>
                          <p className="mt-2 text-xs font-black text-[var(--foreground-strong)] line-clamp-1">
                            {row.headingPathText}
                          </p>
                          <p className="mt-1 text-[11px] font-medium text-[var(--foreground-soft)] line-clamp-2 opacity-80 leading-relaxed">
                            {row.contentPreview || row.content}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}

                {!relatedLoading && !relatedError && relatedRows.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-[var(--border)] p-3 text-xs text-[var(--foreground-soft)]">
                    Nenhum outro trecho foi encontrado para este arquivo.
                  </p>
                )}
              </div>

              <div className="flex flex-1 min-h-0 flex-col">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Conteudo do trecho #{selected.chunkIndex}
                </p>
                <pre className="flex-1 min-h-[360px] overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 text-sm whitespace-pre-wrap break-words text-[var(--foreground-strong)]">
                  {selected.content}
                </pre>
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-[var(--foreground-soft)]">
          Selecione um trecho na lista para ver o conteudo completo e os metadados.
        </p>
      )}
    </aside>
  );
}
