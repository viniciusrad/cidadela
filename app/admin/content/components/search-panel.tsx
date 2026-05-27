"use client";

import { InfoTooltip } from "@/components/info-tooltip";
import { SECTORS } from "@/lib/domain";
import { SECTOR_LABELS } from "@/lib/labels";

import {
  sensitivityClass,
  sensitivityLabel,
  type ChunkRow,
  type ContentListMode,
  type FileGroup,
  type SearchMode,
  type SectorFilter,
} from "./types";

type Props = {
  sector: SectorFilter;
  mode: SearchMode;
  queryInput: string;
  appliedQuery: string;
  loading: boolean;
  cursor: string | null;
  rows: ChunkRow[];
  fileGroups: FileGroup[];
  selected: ChunkRow | null;
  listMode: ContentListMode;
  totalsLabel: string;
  error: string | null;
  onSectorChange: (sector: SectorFilter) => void;
  onModeChange: (mode: SearchMode) => void;
  onQueryChange: (q: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onClearQuery: () => void;
  onListModeChange: (mode: ContentListMode) => void;
  onSelectFileGroup: (group: FileGroup) => void;
  onSelectRow: (row: ChunkRow) => void;
  onLoadMore: () => void;
};

export function SearchPanel({
  sector,
  mode,
  queryInput,
  appliedQuery,
  loading,
  cursor,
  rows,
  fileGroups,
  selected,
  listMode,
  totalsLabel,
  error,
  onSectorChange,
  onModeChange,
  onQueryChange,
  onSubmit,
  onClearQuery,
  onListModeChange,
  onSelectFileGroup,
  onSelectRow,
  onLoadMore,
}: Props) {
  return (
    <section className="premium-panel rounded-[2rem] p-6">
      <div className="mb-6 flex items-center justify-between border-b border-[var(--border)] pb-4">
        <h2 className="text-sm font-black uppercase tracking-[0.24em] text-[var(--foreground-strong)]">
          Filtros e Busca
        </h2>
        <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
          Conteudo indexado
        </span>
      </div>

      <form className="space-y-6" onSubmit={onSubmit}>
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="flex min-w-0 flex-col gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
            Filtrar por Setor
            <select
              className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-bold text-[var(--foreground-strong)] transition-shadow focus:ring-2 focus:ring-[var(--accent-soft)] focus:outline-none"
              onChange={(event) =>
                onSectorChange(event.target.value as SectorFilter)
              }
              value={sector}
            >
              <option value="todos">Todos os setores</option>
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {SECTOR_LABELS[s]}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="flex min-w-0 flex-col gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
            <legend className="mb-2">Modo de busca</legend>
            <div className="flex min-w-0 flex-col gap-2">
              {(["text", "semantic"] as SearchMode[]).map((m) => (
                <div className="flex min-w-0 items-center gap-2" key={m}>
                  <button
                    className={`min-w-0 flex-1 rounded-2xl border px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.15em] transition-all ${
                      mode === m
                        ? "border-[var(--accent)] bg-[var(--accent)] text-white shadow-md"
                        : "border-[var(--border)] bg-white text-[var(--foreground-soft)] hover:border-[var(--accent)]"
                    }`}
                    onClick={() => onModeChange(m)}
                    type="button"
                  >
                    {m === "text" ? "Texto" : "Semantica"}
                  </button>
                  <InfoTooltip
                    text={
                      m === "text"
                        ? "Busca textual: procura correspondencia literal da palavra-chave dentro dos trechos indexados, sem interpretar significado."
                        : "Busca semantica: entende a ideia da pergunta e retorna os trechos mais proximos, mesmo sem usar as mesmas palavras."
                    }
                  />
                </div>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
            {mode === "semantic"
              ? "Busca semantica"
              : "Busca textual (Match Text)"}
          </label>
          <div className="flex flex-col gap-3">
            <input
              className="w-full rounded-2xl border border-[var(--border)] bg-white pl-4 pr-10 py-3 text-sm font-bold text-[var(--foreground-strong)] placeholder:font-normal placeholder:text-[var(--muted)] transition-shadow focus:ring-2 focus:ring-[var(--accent-soft)] focus:outline-none"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={
                mode === "semantic"
                  ? "Descreva o que procura em linguagem natural..."
                  : "Palavra-chave no conteúdo..."
              }
              type="search"
              value={queryInput}
            />
            <div className="flex gap-3">
              <button
                className="rounded-2xl border border-[var(--accent)] bg-[var(--accent)] px-6 py-3 text-xs font-bold uppercase tracking-[0.2em] text-white shadow-sm transition-transform active:scale-95 disabled:opacity-40"
                disabled={loading}
                type="submit"
              >
                {loading ? "..." : "Buscar"}
              </button>
              {(appliedQuery || mode === "semantic") && (
                <button
                  className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--foreground-soft)] hover:bg-[var(--surface-soft)] transition-colors"
                  onClick={onClearQuery}
                  type="button"
                >
                  Limpar
                </button>
              )}
            </div>
          </div>
        </div>
      </form>

      <p className="mt-3 text-xs text-[var(--foreground-soft)]">
        {rows.length} trecho(s) indexado(s) carregado(s).{" "}
        {fileGroups.length > 0 && `${fileGroups.length} arquivo(s) agrupado(s). `}
        {totalsLabel && <>Total disponivel - {totalsLabel}.</>}
        {mode === "semantic" && " (sem paginacao)"}
      </p>

      {error && (
        <p className="mt-3 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="mt-6 flex gap-1 rounded-xl bg-[var(--surface-muted)] p-1">
        {(["files", "chunks"] as ContentListMode[]).map((m) => (
          <button
            className={`flex-1 rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-all ${
              listMode === m
                ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                : "text-[var(--foreground-soft)] hover:text-[var(--foreground-strong)]"
            }`}
            key={m}
            onClick={() => onListModeChange(m)}
            type="button"
          >
            {m === "files" ? "Arquivos" : "Trechos"}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {listMode === "files" &&
          fileGroups.map((group) => {
            const isActive =
              selected?.sector === group.sector &&
              (selected.sourceDocumentId ?? selected.documentId) ===
                group.sourceDocumentId;

            return (
              <button
                className={`block w-full rounded-[1.25rem] border p-4 text-left transition-all ${
                  isActive
                    ? "border-[var(--accent)] bg-[var(--surface-soft)] shadow-md translate-x-1"
                    : "border-[var(--border)] bg-white hover:border-[var(--accent)] hover:shadow-sm"
                }`}
                key={group.key}
                onClick={() => onSelectFileGroup(group)}
                type="button"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                    {SECTOR_LABELS[group.sector]} | {group.loadedChunkCount} trecho(s)
                  </p>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${sensitivityClass(group.sensitivity)}`}
                  >
                    {sensitivityLabel(group.sensitivity)}
                  </span>
                </div>
                <p className="mt-2 text-sm font-black text-[var(--foreground-strong)] line-clamp-2 leading-relaxed">
                  {group.documentTitle}
                </p>
                <p className="mt-1 text-[11px] font-medium text-[var(--foreground-soft)] line-clamp-1 opacity-80">
                  {group.fileName}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-soft)]">
                  <span className="rounded-full bg-[var(--surface-soft)] px-2.5 py-1">
                    {group.sourceFormat}
                  </span>
                  {group.topic && (
                    <span className="rounded-full bg-[var(--surface-soft)] px-2.5 py-1">
                      {group.topic}
                    </span>
                  )}
                  <span className="rounded-full bg-[var(--surface-soft)] px-2.5 py-1">
                    trechos {group.matchingChunkIndexes.join(", ")}
                  </span>
                </div>
              </button>
            );
          })}

        {listMode === "chunks" &&
          rows.map((row) => {
            const isActive =
              selected?.id === row.id && selected?.sector === row.sector;
            return (
              <button
                className={`block w-full rounded-[1.25rem] border p-4 text-left transition-all ${
                  isActive
                    ? "border-[var(--accent)] bg-[var(--surface-soft)] shadow-md translate-x-1"
                    : "border-[var(--border)] bg-white hover:border-[var(--accent)] hover:shadow-sm"
                }`}
                key={`${row.sector}:${row.id}`}
                onClick={() => onSelectRow(row)}
                type="button"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                    {SECTOR_LABELS[row.sector]} | trecho #{row.chunkIndex}
                  </p>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${sensitivityClass(row.sensitivity)}`}
                    >
                      {sensitivityLabel(row.sensitivity)}
                    </span>
                    {typeof row.score === "number" && (
                      <span className="rounded-full bg-[var(--surface-soft)] px-2.5 py-0.5 text-[9px] font-black text-[var(--foreground-soft)] uppercase tracking-wider">
                        score {row.score.toFixed(3)}
                      </span>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-sm font-black text-[var(--foreground-strong)] line-clamp-2 leading-relaxed">
                  {row.documentTitle}
                </p>
                <p className="mt-1 text-[11px] font-medium text-[var(--foreground-soft)] line-clamp-1 opacity-80">
                  {row.headingPathText}
                </p>
              </button>
            );
          })}

        {!loading && listMode === "files" && fileGroups.length === 0 && (
          <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--foreground-soft)]">
            Nenhum arquivo encontrado para a selecao atual.
          </p>
        )}

        {!loading && listMode === "chunks" && rows.length === 0 && (
          <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--foreground-soft)]">
            Nenhum trecho encontrado.
          </p>
        )}
      </div>

      <div className="mt-4">
        <button
          className="w-full rounded-full border border-[var(--border)] bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.24em] text-[var(--foreground-soft)] disabled:opacity-40"
          disabled={!cursor || loading || mode === "semantic"}
          onClick={onLoadMore}
          type="button"
        >
          {mode === "semantic"
            ? "Paginacao indisponivel em semantica"
            : loading
              ? "Carregando..."
              : cursor
                ? "Carregar mais"
                : "Fim da lista"}
        </button>
      </div>
    </section>
  );
}
