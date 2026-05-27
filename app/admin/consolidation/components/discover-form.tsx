"use client";

import { FileSearch, Search } from "lucide-react";

import { SECTORS } from "@/lib/domain";
import type {
  ConsolidationSectorFilter,
  ConsolidationSourceScope,
} from "@/lib/consolidation";
import { SECTOR_LABELS } from "@/lib/labels";
import type { Sector } from "@/lib/domain";

import { ALL_SECTOR } from "./types";
import { sourceScopeLabel } from "./utils";

type Props = {
  query: string;
  sector: ConsolidationSectorFilter;
  sourceScope: ConsolidationSourceScope;
  isLoading: boolean;
  errorMessage: string;
  onQueryChange: (value: string) => void;
  onSectorChange: (sector: ConsolidationSectorFilter) => void;
  onSourceScopeChange: (scope: ConsolidationSourceScope) => void;
  onDiscover: () => void;
};

export function DiscoverForm({
  query,
  sector,
  sourceScope,
  isLoading,
  errorMessage,
  onQueryChange,
  onSectorChange,
  onSourceScopeChange,
  onDiscover,
}: Props) {
  return (
    <div className="premium-panel rounded-[2rem] p-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_220px_auto]">
        <label className="space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
            Busca guiada
          </span>
          <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-3">
            <Search className="h-4 w-4 text-[var(--muted)]" />
            <input
              className="w-full bg-transparent text-sm text-[var(--foreground-strong)] outline-none"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Ex.: onboarding de cliente, fechamento fiscal, abertura de chamado"
              value={query}
            />
          </div>
        </label>

        <label className="flex flex-col space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
            Setor
          </span>
          <select
            className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-bold text-[var(--foreground-strong)]"
            onChange={(event) =>
              onSectorChange(event.target.value as ConsolidationSectorFilter)
            }
            value={sector}
          >
            <option value={ALL_SECTOR}>Todos os setores</option>
            {SECTORS.map((item) => (
              <option key={item} value={item}>
                {SECTOR_LABELS[item]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
            Origem
          </span>
          <select
            className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-bold text-[var(--foreground-strong)]"
            onChange={(event) =>
              onSourceScopeChange(event.target.value as ConsolidationSourceScope)
            }
            value={sourceScope}
          >
            <option value="both">Promovidos + staging</option>
            <option value="promoted">Somente promovidos</option>
            <option value="staging">Somente staging</option>
          </select>
        </label>

        <button
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50"
          disabled={isLoading || !query.trim()}
          onClick={onDiscover}
          type="button"
        >
          <FileSearch className={`h-4 w-4 ${isLoading ? "animate-pulse" : ""}`} />
          {isLoading ? "Analisando..." : "Analisar processos"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--foreground-soft)]">
        <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1">
          Visao:{" "}
          {sector === ALL_SECTOR
            ? "Global cross-sector"
            : SECTOR_LABELS[sector as Sector]}
        </span>
        <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1">
          Escopo: {sourceScopeLabel(sourceScope)}
        </span>
      </div>

      {errorMessage ? (
        <div className="mt-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}
