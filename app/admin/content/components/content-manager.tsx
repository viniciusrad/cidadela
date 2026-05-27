"use client";

import { useEffect, useMemo, useState } from "react";

import { SECTOR_LABELS } from "@/lib/labels";
import type { Sector } from "@/lib/domain";

import { DetailPanel } from "./detail-panel";
import { SearchPanel } from "./search-panel";
import {
  fetchChunks,
  type ChunkRow,
  type ContentListMode,
  type FileGroup,
  type FetchResponse,
  type SearchMode,
  type SectorFilter,
} from "./types";

export function ContentManager() {
  const [sector, setSector] = useState<SectorFilter>("todos");
  const [mode, setMode] = useState<SearchMode>("text");
  const [queryInput, setQueryInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [rows, setRows] = useState<ChunkRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ChunkRow | null>(null);
  const [relatedRows, setRelatedRows] = useState<ChunkRow[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [viewTab, setViewTab] = useState<"full" | "chunks">("full");
  const [listMode, setListMode] = useState<ContentListMode>("files");

  useEffect(() => {
    let cancelled = false;

    if (mode === "semantic" && !appliedQuery) {
      queueMicrotask(() => {
        if (cancelled) return;
        setRows([]);
        setCursor(null);
        setTotals({});
        setError(null);
        setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }

    fetchChunks({ sector, mode, q: appliedQuery, cursor: null })
      .then((payload: FetchResponse) => {
        if (cancelled) return;
        setRows(payload.rows);
        setCursor(payload.nextCursor);
        setTotals(payload.totals);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Erro ao carregar trechos.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sector, mode, appliedQuery, reloadKey]);

  useEffect(() => {
    let cancelled = false;

    if (!selected) return;

    const sourceDocumentId = selected.sourceDocumentId ?? selected.documentId;

    fetchChunks({
      sector: selected.sector,
      mode: "text",
      q: "",
      cursor: null,
      limit: 200,
      sourceDocumentId,
    })
      .then((payload: FetchResponse) => {
        if (cancelled) return;
        setRelatedRows(
          payload.rows.sort((a: ChunkRow, b: ChunkRow) => a.chunkIndex - b.chunkIndex),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRelatedError(
          err instanceof Error ? err.message : "Erro ao carregar trechos relacionados.",
        );
      })
      .finally(() => {
        if (!cancelled) setRelatedLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  function resetAndReload(nextState: {
    sector?: SectorFilter;
    mode?: SearchMode;
    appliedQuery?: string;
  }) {
    setRows([]);
    setCursor(null);
    setSelected(null);
    setRelatedRows([]);
    setRelatedError(null);
    setRelatedLoading(false);
    setError(null);
    setLoading(true);
    if (nextState.sector !== undefined) setSector(nextState.sector);
    if (nextState.mode !== undefined) setMode(nextState.mode);
    if (nextState.appliedQuery !== undefined) setAppliedQuery(nextState.appliedQuery);
    if (
      nextState.sector === undefined &&
      nextState.mode === undefined &&
      nextState.appliedQuery === undefined
    ) {
      setReloadKey((k) => k + 1);
    }
  }

  function selectRow(row: ChunkRow) {
    setSelected(row);
    setRelatedRows([]);
    setRelatedError(null);
    setRelatedLoading(true);
  }

  function selectFileGroup(group: FileGroup) {
    selectRow(group.representative);
    setViewTab("full");
  }

  function handleSubmitQuery(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = queryInput.trim();
    if (mode === "semantic" && !trimmed) {
      setError("Busca semantica exige um termo.");
      return;
    }
    resetAndReload({ appliedQuery: trimmed });
  }

  function handleClearQuery() {
    setQueryInput("");
    resetAndReload({ appliedQuery: "", mode: "text" });
  }

  function handleModeChange(next: SearchMode) {
    if (next === mode) return;
    if (next === "text") {
      resetAndReload({ mode: next });
    } else {
      setMode(next);
    }
  }

  async function loadMore() {
    if (!cursor || loading || mode === "semantic") return;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchChunks({ sector, mode, q: appliedQuery, cursor });
      setRows((prev) => [...prev, ...payload.rows]);
      setCursor(payload.nextCursor);
      setTotals(payload.totals);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar mais.");
    } finally {
      setLoading(false);
    }
  }

  const consolidatedContent = useMemo(() => {
    if (relatedRows.length === 0) return selected?.content ?? "";
    return [...relatedRows]
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map((chunk) => {
        const heading = chunk.headingPathText?.trim() || `Trecho ${chunk.chunkIndex}`;
        return `### ${heading}\n\n${chunk.content.trim()}`;
      })
      .join("\n\n");
  }, [relatedRows, selected]);

  const fileGroups = useMemo(() => {
    const groups = new Map<string, FileGroup>();

    for (const row of rows) {
      const sourceDocumentId = row.sourceDocumentId ?? row.documentId;
      const key = `${row.sector}:${sourceDocumentId}`;
      const existing = groups.get(key);

      if (!existing) {
        groups.set(key, {
          key,
          sector: row.sector,
          sourceDocumentId,
          documentTitle: row.documentTitle,
          fileName: row.fileName,
          relativePath: row.relativePath,
          sourceFormat: row.sourceFormat,
          sensitivity: row.sensitivity,
          topic: row.topic,
          owner: row.owner,
          loadedChunkCount: 1,
          matchingChunkIndexes: [row.chunkIndex],
          representative: row,
        });
        continue;
      }

      existing.loadedChunkCount += 1;
      existing.matchingChunkIndexes.push(row.chunkIndex);

      if (
        typeof row.score === "number" &&
        (existing.representative.score === undefined ||
          row.score > existing.representative.score)
      ) {
        existing.representative = row;
      }

      if (!existing.sensitivity && row.sensitivity) existing.sensitivity = row.sensitivity;
      if (!existing.topic && row.topic) existing.topic = row.topic;
      if (!existing.owner && row.owner) existing.owner = row.owner;
    }

    return Array.from(groups.values()).map((group) => ({
      ...group,
      matchingChunkIndexes: Array.from(new Set(group.matchingChunkIndexes)).sort(
        (a, b) => a - b,
      ),
    }));
  }, [rows]);

  const totalsLabel = useMemo(() => {
    const parts = Object.entries(totals).map(
      ([key, value]) => `${SECTOR_LABELS[key as Sector] ?? key}: ${value}`,
    );
    return parts.join(" | ");
  }, [totals]);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <SearchPanel
        appliedQuery={appliedQuery}
        cursor={cursor}
        error={error}
        fileGroups={fileGroups}
        listMode={listMode}
        loading={loading}
        mode={mode}
        onClearQuery={handleClearQuery}
        onListModeChange={setListMode}
        onLoadMore={loadMore}
        onModeChange={handleModeChange}
        onQueryChange={setQueryInput}
        onSectorChange={(s) => resetAndReload({ sector: s })}
        onSelectFileGroup={selectFileGroup}
        onSelectRow={selectRow}
        onSubmit={handleSubmitQuery}
        queryInput={queryInput}
        rows={rows}
        sector={sector}
        selected={selected}
        totalsLabel={totalsLabel}
      />

      <DetailPanel
        consolidatedContent={consolidatedContent}
        listMode={listMode}
        onSelectRow={selectRow}
        onViewTabChange={setViewTab}
        relatedError={relatedError}
        relatedLoading={relatedLoading}
        relatedRows={relatedRows}
        selected={selected}
        viewTab={viewTab}
      />
    </div>
  );
}
