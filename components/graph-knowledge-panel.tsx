"use client";

import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileStack,
  Filter,
  GitBranch,
  Loader2,
  Network,
  RefreshCw,
  Search,
  ServerCrash,
  Share2,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DocumentDetailModal } from "@/components/document-detail-modal";
import { GraphVisualization } from "@/components/graph-visualization";
import { LivingDocsTab } from "@/components/living-docs-tab";
import { getSectorLabel } from "@/lib/labels";

// ─── Types ────────────────────────────────────────────────────────────────────

// Documents fetched from Qdrant (all sectors, production collections)
type QdrantDoc = {
  sector: string;
  sourceDocumentId: string;
  documentId: string;
  documentTitle: string;
  fileName: string;
  chunkCount: number;
  inGraph: boolean;
};

type SectorOption = {
  slug: string;
  displayName: string;
  agentName: string;
  isNative: boolean;
  qdrantCollection: string;
};

// Keep DocSummary as alias for DocumentRow compatibility
type DocSummary = QdrantDoc;

type Stats = {
  connected: boolean;
  nodeCounts?: Record<string, number>;
  totalRelationships?: number;
  topConcepts?: { name: string; count: number }[];
  topDocuments?: { title: string; id: string; entityCount: number }[];
};

type ExtractedEntities = {
  concepts: string[];
  procedures: string[];
  systems: string[];
  regulations: string[];
};

type RelatedDoc = {
  title: string;
  id: string;
  sector: string;
  sharedConcepts: string[];
  overlap: number;
};

type ExploreData = {
  entities: { type: string; name: string }[];
  related: RelatedDoc[];
};

type ExtractionResult = {
  ok: boolean;
  entities: ExtractedEntities;
};

type DocState =
  | { phase: "idle" }
  | { phase: "extracting" }
  | { phase: "done"; entities: ExtractedEntities }
  | { phase: "error"; message: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ENTITY_META: Record<
  string,
  { label: string; color: string; icon: React.ElementType }
> = {
  HAS_CONCEPT: {
    label: "Conceitos",
    color: "bg-blue-100 text-blue-800 border-blue-300",
    icon: BookOpen,
  },
  DESCRIBES: {
    label: "Procedimentos",
    color: "bg-violet-100 text-violet-800 border-violet-300",
    icon: GitBranch,
  },
  REFERENCES_SYSTEM: {
    label: "Sistemas",
    color: "bg-teal-100 text-teal-800 border-teal-300",
    icon: Wrench,
  },
  COMPLIES_WITH: {
    label: "Regulamentações",
    color: "bg-amber-100 text-amber-800 border-amber-300",
    icon: Share2,
  },
};

type GraphFilter = "all" | "inGraph" | "missing";

function documentKey(doc: QdrantDoc) {
  return `${doc.sector}:${doc.sourceDocumentId}`;
}

function countEntities(entities: ExtractedEntities) {
  return (
    entities.concepts.length +
    entities.procedures.length +
    entities.systems.length +
    entities.regulations.length
  );
}

function Badge({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${className}`}
    >
      {children}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--foreground)]">
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-[10px] text-[var(--muted)]">{sub}</p>
      )}
    </div>
  );
}

// ─── Document row ──────────────────────────────────────────────────────────────

function DocumentRow({
  doc,
  inGraph,
  sectorLabel,
  onExtract,
  onOpen,
  onOpenRelated,
}: {
  doc: DocSummary;
  inGraph: boolean;
  sectorLabel: string;
  onExtract: (doc: DocSummary) => void;
  onOpen: (doc: DocSummary) => void;
  onOpenRelated: (id: string) => void;
}) {
  const [state, setState] = useState<DocState>({ phase: "idle" });
  const [explore, setExplore] = useState<ExploreData | null>(null);
  const [showExplore, setShowExplore] = useState(false);
  const [loadingExplore, setLoadingExplore] = useState(false);

  const handleExtract = async () => {
    setState({ phase: "extracting" });
    try {
      const res = await fetch("/api/graph/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Path B: Qdrant-direct extraction (no Postgres dependency)
        body: JSON.stringify({
          sourceDocumentId: doc.sourceDocumentId,
          sector: doc.sector,
          documentTitle: doc.documentTitle,
          fileName: doc.fileName,
        }),
      });
      const data = (await res.json()) as ExtractionResult | { error: string };
      if (!res.ok || "error" in data) {
        setState({
          phase: "error",
          message: "error" in data ? data.error : "Erro desconhecido",
        });
      } else {
        setState({ phase: "done", entities: data.entities });
        onExtract(doc);
      }
    } catch {
      setState({ phase: "error", message: "Falha na requisição" });
    }
  };

  const handleExplore = async () => {
    if (explore) {
      setShowExplore((v) => !v);
      return;
    }
    setLoadingExplore(true);
    setShowExplore(true);
    try {
      const res = await fetch(
        `/api/graph/explore?documentId=${encodeURIComponent(doc.sourceDocumentId)}`,
      );
      if (res.ok) {
        setExplore((await res.json()) as ExploreData);
      }
    } finally {
      setLoadingExplore(false);
    }
  };

  const extractedEntities =
    state.phase === "done" ? state.entities : null;

  const totalEntities = extractedEntities ? countEntities(extractedEntities) : 0;
  const canViewRelated = inGraph || state.phase === "done";

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] overflow-hidden">
      {/* Header row */}
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-[var(--foreground)]">
            {doc.documentTitle}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge className="bg-[var(--surface)] text-[var(--foreground-soft)] border-[var(--border)]">
              {sectorLabel}
            </Badge>
            {sectorLabel !== doc.sector && (
              <Badge className="bg-[var(--surface)] text-[var(--foreground-soft)] border-[var(--border)]">
                {doc.sector}
              </Badge>
            )}
            <Badge className="bg-[var(--surface)] text-[var(--foreground-soft)] border-[var(--border)]">
              {doc.chunkCount} trecho{doc.chunkCount !== 1 ? "s" : ""} indexado{doc.chunkCount !== 1 ? "s" : ""}
            </Badge>
            {inGraph && state.phase === "idle" && (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">
                Mapeado
              </Badge>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => onOpen(doc)}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Abrir
          </button>

          <button
            onClick={handleExplore}
            disabled={!canViewRelated}
            title={
              canViewRelated
                ? "Visualizar arquivos relacionados"
                : "Mapeie este documento antes de visualizar relacionados"
            }
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--muted)]"
          >
            {showExplore ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Network className="h-3 w-3" />
            Relacionados
          </button>

          {/* Extract button */}
          {state.phase === "idle" && (
            <button
              onClick={handleExtract}
              title="Identifica conceitos, sistemas e regras citados neste documento e adiciona ao mapa."
              className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-medium text-[var(--foreground-soft)] hover:border-blue-500/50 hover:text-blue-400 transition-colors"
            >
              <Zap className="h-3 w-3" />
              {inGraph ? "Mapear novamente" : "Mapear documento"}
            </button>
          )}
          {state.phase === "extracting" && (
            <span className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Extraindo…
            </span>
          )}
          {state.phase === "done" && (
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              {totalEntities} itens mapeados
            </span>
          )}
          {state.phase === "error" && (
            <span
              className="flex items-center gap-1.5 text-[11px] text-red-400 cursor-pointer"
              onClick={() => setState({ phase: "idle" })}
              title={state.message}
            >
              <AlertCircle className="h-3 w-3" />
              Erro – tentar novamente
            </span>
          )}
        </div>
      </div>

      {/* Extracted entities (just after extraction) */}
      {state.phase === "done" && extractedEntities && (
        <div className="border-t border-[var(--border)] px-4 py-3 space-y-2 bg-[var(--surface)]">
          {(
            [
              ["Conceitos", extractedEntities.concepts, "bg-blue-100 text-blue-800 border-blue-300"],
              ["Procedimentos", extractedEntities.procedures, "bg-violet-100 text-violet-800 border-violet-300"],
              ["Sistemas", extractedEntities.systems, "bg-teal-100 text-teal-800 border-teal-300"],
              ["Regulamentações", extractedEntities.regulations, "bg-amber-100 text-amber-800 border-amber-300"],
            ] as [string, string[], string][]
          )
            .filter(([, items]) => items.length > 0)
            .map(([label, items, cls]) => (
              <div key={label} className="flex flex-wrap gap-1 items-center">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] w-24 shrink-0">
                  {label}
                </span>
                {items.map((item) => (
                  <Badge key={item} className={cls}>
                    {item}
                  </Badge>
                ))}
              </div>
            ))}
        </div>
      )}

      {/* Explore panel */}
      {showExplore && (
        <div className="border-t border-[var(--border)] px-4 py-3 bg-[var(--surface)] space-y-3">
          {loadingExplore && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Consultando mapa...
            </div>
          )}

          {explore && !loadingExplore && (
            <>
              {/* Entities in graph */}
              {Object.entries(ENTITY_META).map(([type, meta]) => {
                const Icon = meta.icon;
                const items = explore.entities
                  .filter((e) => e.type === type)
                  .map((e) => e.name);
                if (!items.length) return null;
                return (
                  <div key={type} className="flex flex-wrap gap-1 items-center">
                    <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] w-24 shrink-0">
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </span>
                    {items.map((item) => (
                      <Badge key={item} className={meta.color}>
                        {item}
                      </Badge>
                    ))}
                  </div>
                );
              })}

              {/* Related documents */}
              {explore.related.length > 0 && (
                <div className="pt-2 border-t border-[var(--border)]">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] mb-2">
                    Documentos relacionados por conceito compartilhado
                  </p>
                  <div className="space-y-1.5">
                    {explore.related.map((rel) => (
                      <button
                        key={rel.id}
                        onClick={() => onOpenRelated(rel.id)}
                        className="group flex w-full items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-left transition-colors hover:border-blue-400/60"
                      >
                        <Network className="h-3 w-3 mt-0.5 shrink-0 text-blue-400" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium text-[var(--foreground)] truncate group-hover:text-blue-300">
                            {rel.title}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge className="bg-[var(--surface)] text-[var(--foreground-soft)] border-[var(--border)]">
                              {rel.sector}
                            </Badge>
                            <Badge className="bg-blue-100 text-blue-800 border-blue-300">
                              {rel.overlap} conceito{rel.overlap !== 1 ? "s" : ""} em comum
                            </Badge>
                            {rel.sharedConcepts.slice(0, 3).map((c) => (
                              <Badge
                                key={c}
                                className="bg-blue-100 text-blue-800 border-blue-300"
                              >
                                {c}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[10px] text-[var(--muted)] group-hover:text-blue-300">
                          <ExternalLink className="h-3 w-3" />
                          Abrir
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {explore.entities.length > 0 && explore.related.length === 0 && (
                <p className="border-t border-[var(--border)] pt-2 text-[11px] text-[var(--muted)]">
                  Nenhum arquivo relacionado encontrado por conceito compartilhado.
                </p>
              )}

              {explore.entities.length === 0 && (
                <p className="text-[11px] text-[var(--muted)]">
                  Nenhum item mapeado. Use &quot;Mapear novamente&quot; para atualizar.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

type PanelTab = "documents" | "visualization" | "living-docs";

export function GraphKnowledgePanel() {
  const [panelTab, setPanelTab] = useState<PanelTab>("documents");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [documents, setDocuments] = useState<QdrantDoc[]>([]);
  const [sectors, setSectors] = useState<SectorOption[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [sectorFilter, setSectorFilter] = useState<string | "all">("all");
  const [graphFilter, setGraphFilter] = useState<GraphFilter>("all");
  const [selectedDocument, setSelectedDocument] = useState<QdrantDoc | null>(null);
  const [selectedRelatedDocumentId, setSelectedRelatedDocumentId] = useState<string | null>(null);
  const [batchExtracting, setBatchExtracting] = useState(false);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const res = await fetch("/api/graph/stats");
      if (res.ok) {
        const data = (await res.json()) as Stats;
        setStats(data);
      }
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const fetchDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const res = await fetch("/api/graph/documents");
      if (res.ok) {
        const data = (await res.json()) as {
          docs: QdrantDoc[];
          sectors?: SectorOption[];
        };
        setDocuments(data.docs ?? []);
        setSectors(data.sectors ?? []);
      }
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchStats();
      void fetchDocuments();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [fetchStats, fetchDocuments]);

  const extractDocument = useCallback(
    async (doc: QdrantDoc) => {
      const res = await fetch("/api/graph/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceDocumentId: doc.sourceDocumentId,
          sector: doc.sector,
          documentTitle: doc.documentTitle,
          fileName: doc.fileName,
        }),
      });
      const data = (await res.json()) as ExtractionResult | { error: string };
      if (!res.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "Erro desconhecido");
      }
      setDocuments((prev) =>
        prev.map((item) =>
          documentKey(item) === documentKey(doc) ? { ...item, inGraph: true } : item,
        ),
      );
      void fetchStats();
      return data.entities;
    },
    [fetchStats],
  );

  const handleExtracted = (doc: DocSummary) => {
    // Mark the doc as inGraph locally and refresh stats
    setDocuments((prev) =>
      prev.map((d) =>
        documentKey(d) === documentKey(doc) ? { ...d, inGraph: true } : d,
      ),
    );
    void fetchStats();
  };

  const sectorLabelMap = useMemo(
    () =>
      new Map(
        sectors.map((sector) => [sector.slug, sector.displayName] as const),
      ),
    [sectors],
  );

  const labelForSector = useCallback(
    (slug: string) => sectorLabelMap.get(slug) ?? getSectorLabel(slug),
    [sectorLabelMap],
  );

  const nc = stats?.nodeCounts ?? {};
  const totalNodes = Object.values(nc).reduce((a, b) => a + b, 0);
  const graphDocsCount = documents.filter((doc) => doc.inGraph).length;
  const missingDocsCount = documents.length - graphDocsCount;

  const filteredDocuments = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return documents.filter((doc) => {
      if (sectorFilter !== "all" && doc.sector !== sectorFilter) return false;
      if (graphFilter === "inGraph" && !doc.inGraph) return false;
      if (graphFilter === "missing" && doc.inGraph) return false;
      if (!query) return true;
      return [
        doc.documentTitle,
        doc.fileName,
        doc.sourceDocumentId,
        doc.sector,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [documents, graphFilter, searchTerm, sectorFilter]);

  const recommendedDocs = useMemo(() => {
    const graphedTerms = new Set(
      documents
        .filter((doc) => doc.inGraph)
        .flatMap((doc) => doc.documentTitle.toLowerCase().split(/[^a-z0-9]+/))
        .filter((term) => term.length >= 4),
    );

    return documents
      .filter((doc) => !doc.inGraph)
      .map((doc) => {
        const terms = doc.documentTitle.toLowerCase().split(/[^a-z0-9]+/);
        const overlap = terms.filter((term) => graphedTerms.has(term)).length;
        return {
          doc,
          score: doc.chunkCount * 2 + overlap * 5,
          reason:
            overlap > 0
              ? `${overlap} termo${overlap === 1 ? "" : "s"} ja aparecem no mapa`
              : `${doc.chunkCount} trecho${doc.chunkCount === 1 ? "" : "s"} para ampliar cobertura`,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [documents]);

  const extractRecommended = async () => {
    if (recommendedDocs.length === 0) return;
    setBatchExtracting(true);
    setBatchMessage(null);
    let ok = 0;
    try {
      for (const item of recommendedDocs) {
        await extractDocument(item.doc);
        ok += 1;
      }
      setBatchMessage(`${ok} documento${ok === 1 ? "" : "s"} mapeado${ok === 1 ? "" : "s"}.`);
    } catch (err) {
      setBatchMessage(err instanceof Error ? err.message : "Falha no mapeamento sugerido.");
    } finally {
      setBatchExtracting(false);
    }
  };

  return (
    <div className="space-y-4">

      {/* ── Sub-tabs ── */}
      <div className="flex items-center gap-1 border-b border-[var(--border)]">
        {(
          [
            { id: "documents"     as PanelTab, label: "Documentos",         icon: FileStack },
            { id: "visualization" as PanelTab, label: "Visualização",       icon: Network  },
            { id: "living-docs"   as PanelTab, label: "Documentação viva",  icon: Zap      },
          ] as { id: PanelTab; label: string; icon: React.ElementType }[]
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setPanelTab(id)}
            className={[
              "flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] border-b-2 -mb-px transition-colors",
              panelTab === id
                ? "border-[var(--foreground)] text-[var(--foreground)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--foreground-soft)]",
            ].join(" ")}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Visualização tab ── */}
      {panelTab === "visualization" && <GraphVisualization />}

      {/* ── Documentação viva tab ── */}
      {panelTab === "living-docs" && <LivingDocsTab />}

      {/* ── Documentos tab ── */}
      {panelTab === "documents" && <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
            Mapeamento do conhecimento
          </p>
          <p className="mt-1 text-sm text-[var(--foreground-soft)]">
            Identifica conceitos, procedimentos, sistemas e regras nos documentos para mostrar
            como os assuntos da empresa se conectam.
          </p>
        </div>
        <button
          onClick={fetchStats}
          disabled={loadingStats}
          className="flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loadingStats ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </div>

      {/* Connection status */}
      {loadingStats && (
        <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Verificando conexao do mapa...
        </div>
      )}

      {!loadingStats && stats && !stats.connected && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
          <ServerCrash className="h-4 w-4 mt-0.5 shrink-0 text-red-400" />
          <div>
            <p className="text-sm font-medium text-red-300">Mapa indisponivel</p>
            <p className="mt-0.5 text-[11px] text-red-400/80">
              Verifique se o container está rodando:{" "}
              <code className="font-mono">docker compose up -d neo4j</code>
            </p>
          </div>
        </div>
      )}

      {!loadingStats && stats?.connected && (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Nós totais" value={totalNodes} />
            <StatCard
              label="Documentos"
              value={nc["Document"] ?? 0}
              sub="mapeados"
            />
            <StatCard label="Conceitos" value={nc["Concept"] ?? 0} />
            <StatCard label="Sistemas" value={nc["System"] ?? 0} />
            <StatCard label="Pessoas" value={nc["Person"] ?? 0} />
            <StatCard
              label="Relações"
              value={stats.totalRelationships ?? 0}
              sub="conexoes"
            />
          </div>

          {/* Top concepts */}
          {(stats.topConcepts?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] mb-2">
                Conceitos mais conectados
              </p>
              <div className="flex flex-wrap gap-1.5">
                {stats.topConcepts!.map((c) => (
                  <span
                    key={c.name}
                    className="inline-flex items-center gap-1 rounded border border-blue-300 bg-blue-100 px-2 py-0.5 text-[11px] text-blue-800"
                  >
                    {c.name}
                    <span className="rounded-full bg-blue-200 px-1 text-[9px] font-bold tabular-nums text-blue-900">
                      {c.count}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {totalNodes === 0 && (
            <div className="rounded-lg border border-dashed border-[var(--border)] px-6 py-8 text-center">
              <Network className="mx-auto h-8 w-8 text-[var(--muted)] mb-3" />
              <p className="text-sm font-medium text-[var(--foreground-soft)]">
                Grafo vazio
              </p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                Mapeie os documentos abaixo para comecar a conectar assuntos, sistemas e regras.
              </p>
            </div>
          )}
        </>
      )}

      {/* Document list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
              Documentos disponiveis ({filteredDocuments.length}/{documents.length})
            </p>
            {documents.length > 0 && (
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                {graphDocsCount} mapeado{graphDocsCount === 1 ? "" : "s"}, {missingDocsCount} pendente{missingDocsCount === 1 ? "" : "s"} de mapeamento.
              </p>
            )}
          </div>
          <button
            onClick={fetchDocuments}
            disabled={loadingDocs}
            className="flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            <RefreshCw className={`h-3 w-3 ${loadingDocs ? "animate-spin" : ""}`} />
            Recarregar lista
          </button>
        </div>

        <div className="grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 lg:grid-cols-[1.2fr_0.8fr_0.8fr]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar por titulo, arquivo, id ou setor"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] py-2 pl-8 pr-3 text-[12px] text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-blue-400/70"
            />
          </label>
          <label className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3">
            <Filter className="h-3.5 w-3.5 text-[var(--muted)]" />
            <select
              value={sectorFilter}
              onChange={(event) => setSectorFilter(event.target.value)}
              className="w-full bg-transparent py-2 text-[12px] text-[var(--foreground)] outline-none"
            >
              <option value="all">Todos os setores</option>
              {sectors.map((sector) => (
                <option key={sector.slug} value={sector.slug}>
                  {sector.displayName} / {sector.agentName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3">
            <Network className="h-3.5 w-3.5 text-[var(--muted)]" />
            <select
              value={graphFilter}
              onChange={(event) => setGraphFilter(event.target.value as GraphFilter)}
              className="w-full bg-transparent py-2 text-[12px] text-[var(--foreground)] outline-none"
            >
              <option value="all">Todos</option>
              <option value="inGraph">Ja mapeados</option>
              <option value="missing">Pendentes de mapeamento</option>
            </select>
          </label>
        </div>

        {recommendedDocs.length > 0 && (
          <div className="rounded-lg border border-blue-300 bg-blue-50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-blue-700">
                  <Sparkles className="h-3.5 w-3.5" />
                  Radar de prioridade
                </p>
                <p className="mt-1 text-[11px] text-[var(--foreground-soft)]">
                  Sugestao automatica dos proximos documentos que mais ampliam o mapa.
                </p>
              </div>
              <button
                onClick={extractRecommended}
                disabled={batchExtracting}
                className="flex items-center gap-1.5 rounded-md border border-blue-400 bg-blue-100 px-3 py-1.5 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-200 disabled:opacity-50"
              >
                {batchExtracting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Zap className="h-3 w-3" />
                )}
                Mapear lote sugerido
              </button>
            </div>
            <div className="mt-3 grid gap-2 lg:grid-cols-3">
              {recommendedDocs.map(({ doc, reason }) => (
                <button
                  key={documentKey(doc)}
                  onClick={() => setSelectedDocument(doc)}
                  className="rounded-md border border-blue-200 bg-white px-3 py-2 text-left transition-colors hover:border-blue-400"
                >
                  <p className="truncate text-[11px] font-semibold text-[var(--foreground)]">
                    {doc.documentTitle}
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--muted)]">
                    {labelForSector(doc.sector)} · {reason}
                  </p>
                </button>
              ))}
            </div>
            {batchMessage && (
              <p className="mt-2 text-[11px] text-blue-700">{batchMessage}</p>
            )}
          </div>
        )}

        {loadingDocs && (
          <div className="flex items-center gap-2 text-[11px] text-[var(--muted)] py-4">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Carregando documentos de todos os setores…
          </div>
        )}

        {!loadingDocs && documents.length === 0 && (
          <p className="text-[11px] text-[var(--muted)] py-4">
            Nenhum documento encontrado no conteudo indexado.
          </p>
        )}

        {!loadingDocs && documents.length > 0 && filteredDocuments.length === 0 && (
          <p className="text-[11px] text-[var(--muted)] py-4">
            Nenhum documento corresponde aos filtros atuais.
          </p>
        )}

        {!loadingDocs && filteredDocuments.length > 0 && (
          <div className="space-y-2">
            {filteredDocuments.map((doc) => (
              <DocumentRow
                key={documentKey(doc)}
                doc={doc}
                inGraph={doc.inGraph}
                sectorLabel={labelForSector(doc.sector)}
                onExtract={handleExtracted}
                onOpen={setSelectedDocument}
                onOpenRelated={setSelectedRelatedDocumentId}
              />
            ))}
          </div>
        )}
      </div>

      {/* Value proposition */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
          O que esta tela responde que o chat sozinho nao responde
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            [
              "Dependencias entre documentos",
              "Quais documentos dependem do sistema X ou citam a mesma regra operacional?",
            ],
            [
              "Normas e setores afetados",
              "Qual norma e mais citada, em quais setores ela aparece e quem precisa revisar quando ela muda?",
            ],
            [
              "Contradicoes e perguntas em aberto",
              "Onde dois procedimentos falam de forma diferente sobre o mesmo assunto?",
            ],
            [
              "Impacto de mudancas",
              "Se o sistema Y mudar, quais processos, documentos e areas precisam ser revistos?",
            ],
          ].map(([title, desc]) => (
            <div key={title} className="flex gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400" />
              <div>
                <p className="text-[11px] font-semibold text-[var(--foreground-soft)]">
                  {title}
                </p>
                <p className="text-[11px] text-[var(--muted)]">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      </div>} {/* end documents tab */}

      {selectedDocument && (
        <DocumentDetailModal
          documentId={selectedDocument.sourceDocumentId}
          documentTitle={selectedDocument.documentTitle}
          sector={selectedDocument.sector}
          status={selectedDocument.inGraph ? "Mapeado" : "Conteudo indexado"}
          onClose={() => setSelectedDocument(null)}
        />
      )}

      {selectedRelatedDocumentId && (
        <DocumentDetailModal
          documentId={selectedRelatedDocumentId}
          onClose={() => setSelectedRelatedDocumentId(null)}
        />
      )}
    </div>
  );
}
