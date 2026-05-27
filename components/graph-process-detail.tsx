"use client";

import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronUp,
  CircleDot,
  FileText,
  GitMerge,
  Loader2,
  Network,
  RefreshCw,
  ShieldCheck,
  Wrench,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProcessSummary = {
  id: string;
  name: string;
  sector: string | null;
  fingerprint: string | null;
  status: string | null;
  automationReadinessScore: number;
  documentationCoverageScore: number;
  confidenceScore: number;
  recommendedAutomationLevel: string | null;
  graphBacked: boolean;
};

type DocumentRef = { id: string; title: string | null; sector: string | null; status: string | null };

type ApiResponse = {
  process: ProcessSummary;
  documents: DocumentRef[];
  procedures: string[];
  systems: string[];
  concepts: string[];
  regulations: string[];
};

type EntityKind = "document" | "procedure" | "system" | "concept" | "regulation";

type EntitySatellite = {
  key: string;
  kind: EntityKind;
  label: string;
  sublabel?: string;
};

type GraphViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// ─── Visual mapping ───────────────────────────────────────────────────────────

const ENTITY_STYLE: Record<
  EntityKind,
  { fill: string; stroke: string; label: string; icon: typeof FileText }
> = {
  document: { fill: "#fbbf24", stroke: "#d97706", label: "Documento", icon: FileText },
  procedure: { fill: "#c084fc", stroke: "#a855f7", label: "Procedimento", icon: GitMerge },
  system: { fill: "#2dd4bf", stroke: "#14b8a6", label: "Sistema", icon: Wrench },
  concept: { fill: "#60a5fa", stroke: "#3b82f6", label: "Conceito", icon: CircleDot },
  regulation: { fill: "#fbbf24", stroke: "#f59e0b", label: "Regulamento", icon: ShieldCheck },
};

const SECTOR_LABELS: Record<string, string> = {
  desenvolvimento: "Desenvolvimento",
  seguranca: "Segurança",
  suporte: "Suporte",
  desktop: "Desktop",
};

const PROCESS_GRAPH_WIDTH = 800;
const PROCESS_GRAPH_HEIGHT = 520;
const PROCESS_GRAPH_MIN_ZOOM = 0.28;
const PROCESS_GRAPH_VIEWBOX: GraphViewBox = {
  x: 0,
  y: 0,
  width: PROCESS_GRAPH_WIDTH,
  height: PROCESS_GRAPH_HEIGHT,
};

function statusTone(status: string | null | undefined) {
  switch (status) {
    case "mapped":
      return { label: "Mapeado", className: "border-emerald-300/70 bg-emerald-50 text-emerald-700" };
    case "needs_curation":
      return { label: "Precisa curadoria", className: "border-amber-300/70 bg-amber-50 text-amber-700" };
    case "critical_gaps":
      return { label: "Gaps críticos", className: "border-rose-300/70 bg-rose-50 text-rose-700" };
    case "needs_graph_extraction":
      return { label: "Sem grafo", className: "border-slate-300/70 bg-slate-50 text-slate-700" };
    case "archived":
      return { label: "Arquivado", className: "border-slate-300/70 bg-slate-100 text-slate-600" };
    default:
      return {
        label: status ?? "—",
        className: "border-slate-300/70 bg-slate-50 text-slate-700",
      };
  }
}

function automationTone(level: string | null | undefined) {
  switch (level) {
    case "total":
      return { label: "Automação total", className: "border-emerald-300/70 bg-emerald-50 text-emerald-700" };
    case "parcial":
      return { label: "Automação parcial", className: "border-cyan-300/70 bg-cyan-50 text-cyan-700" };
    case "assistida":
      return { label: "Assistida", className: "border-blue-300/70 bg-blue-50 text-blue-700" };
    default:
      return {
        label: level ?? "—",
        className: "border-slate-300/70 bg-slate-50 text-slate-700",
      };
  }
}

function scoreColor(score: number) {
  if (score >= 70) return "text-emerald-700";
  if (score >= 40) return "text-amber-700";
  return "text-rose-700";
}

// ─── Radial layout for satellites ─────────────────────────────────────────────

function layoutSatellites(
  satellites: EntitySatellite[],
  cx: number,
  cy: number,
  radius: number,
) {
  if (satellites.length === 0) return [] as Array<EntitySatellite & { x: number; y: number; angle: number }>;
  const step = (2 * Math.PI) / satellites.length;
  const offset = -Math.PI / 2; // start at the top
  return satellites.map((s, i) => {
    const angle = offset + i * step;
    return { ...s, angle, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GraphProcessDetail({ processId }: { processId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [graphViewBox, setGraphViewBox] = useState(PROCESS_GRAPH_VIEWBOX);
  const [graphPanning, setGraphPanning] = useState(false);
  const graphSvgRef = useRef<SVGSVGElement>(null);
  const graphPanRef = useRef<{ pointerId: number; point: DOMPoint } | null>(null);

  const fetchProcess = useCallback(async (): Promise<ApiResponse> => {
    const res = await fetch(`/api/graph/process/${encodeURIComponent(processId)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as ApiResponse;
  }, [processId]);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProcess()
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchProcess]);

  useEffect(() => {
    let cancelled = false;
    fetchProcess()
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchProcess]);

  const satellites = useMemo<EntitySatellite[]>(() => {
    if (!data) return [];
    return [
      ...data.documents.map<EntitySatellite>((d) => ({
        key: `doc-${d.id}`,
        kind: "document",
        label: d.title ?? d.id,
        sublabel: d.sector ? SECTOR_LABELS[d.sector] ?? d.sector : undefined,
      })),
      ...data.procedures.map<EntitySatellite>((name) => ({
        key: `proc-${name}`,
        kind: "procedure",
        label: name,
      })),
      ...data.systems.map<EntitySatellite>((name) => ({
        key: `sys-${name}`,
        kind: "system",
        label: name,
      })),
      ...data.concepts.map<EntitySatellite>((name) => ({
        key: `concept-${name}`,
        kind: "concept",
        label: name,
      })),
      ...data.regulations.map<EntitySatellite>((name) => ({
        key: `reg-${name}`,
        kind: "regulation",
        label: name,
      })),
    ];
  }, [data]);

  const graphPointFromClient = useCallback((clientX: number, clientY: number) => {
    const svg = graphSvgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;

    return new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  }, []);

  const resetGraphView = useCallback(() => {
    graphPanRef.current = null;
    setGraphPanning(false);
    setGraphViewBox(PROCESS_GRAPH_VIEWBOX);
  }, []);

  const zoomGraphAtPoint = useCallback((point: DOMPoint, zoomFactor: number) => {
    setGraphViewBox((current) => {
      const minWidth = PROCESS_GRAPH_WIDTH * PROCESS_GRAPH_MIN_ZOOM;
      const nextWidth = Math.min(
        PROCESS_GRAPH_WIDTH,
        Math.max(minWidth, current.width * zoomFactor),
      );
      const factor = nextWidth / current.width;

      if (factor === 1) return current;

      return {
        x: point.x - (point.x - current.x) * factor,
        y: point.y - (point.y - current.y) * factor,
        width: nextWidth,
        height: nextWidth * (PROCESS_GRAPH_HEIGHT / PROCESS_GRAPH_WIDTH),
      };
    });
  }, []);

  const zoomGraphFromCenter = useCallback((zoomFactor: number) => {
    zoomGraphAtPoint(
      new DOMPoint(
        graphViewBox.x + graphViewBox.width / 2,
        graphViewBox.y + graphViewBox.height / 2,
      ),
      zoomFactor,
    );
  }, [graphViewBox, zoomGraphAtPoint]);

  const handleGraphPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;

    const point = graphPointFromClient(event.clientX, event.clientY);
    if (!point) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    graphPanRef.current = { pointerId: event.pointerId, point };
    setGraphPanning(true);
  }, [graphPointFromClient]);

  const handleGraphPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const pan = graphPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;

    const point = graphPointFromClient(event.clientX, event.clientY);
    if (!point) return;

    setGraphViewBox((current) => ({
      ...current,
      x: current.x + pan.point.x - point.x,
      y: current.y + pan.point.y - point.y,
    }));
  }, [graphPointFromClient]);

  const stopGraphPan = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (graphPanRef.current?.pointerId !== event.pointerId) return;

    graphPanRef.current = null;
    setGraphPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  // Native wheel listener with passive:false so preventDefault() actually blocks page scroll.
  // Depends on `data` so the effect re-runs after the SVG is added to the DOM (the SVG only
  // renders when data is loaded; on mount graphSvgRef.current is still null).
  useEffect(() => {
    const svg = graphSvgRef.current;
    if (!svg) return;

    const onWheel = (event: WheelEvent) => {
      const point = graphPointFromClient(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      zoomGraphAtPoint(point, event.deltaY > 0 ? 1.14 : 0.88);
    };

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [data, graphPointFromClient, zoomGraphAtPoint]);

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-[var(--muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Carregando processo…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-[2rem] border border-rose-300/70 bg-rose-50/70 p-8 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-rose-500" />
        <h2 className="mt-3 text-lg font-black text-rose-700">
          Não foi possível abrir o processo
        </h2>
        <p className="mt-1 text-sm text-rose-600">{error ?? "Resposta vazia"}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            onClick={reload}
            className="inline-flex items-center gap-1.5 rounded-full border border-rose-300 bg-white px-4 py-1.5 text-[12px] font-bold uppercase tracking-[0.18em] text-rose-700 hover:bg-rose-100"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Tentar novamente
          </button>
          <Link
            href="/admin/process-automation-map"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-4 py-1.5 text-[12px] font-bold uppercase tracking-[0.18em] text-[var(--foreground-soft)] hover:border-[var(--accent)]/40"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar ao mapa
          </Link>
        </div>
      </div>
    );
  }

  const { process, documents, procedures, systems, concepts, regulations } = data;
  const status = statusTone(process.status);
  const auto = automationTone(process.recommendedAutomationLevel);

  // ── SVG dimensions ──────────────────────────────────────────────────────────
  const VB_W = PROCESS_GRAPH_WIDTH;
  const VB_H = PROCESS_GRAPH_HEIGHT;
  const CENTER_X = VB_W / 2;
  const CENTER_Y = VB_H / 2;
  const RADIUS = Math.min(VB_W, VB_H) / 2 - 60;
  const laid = layoutSatellites(satellites, CENTER_X, CENTER_Y, RADIUS);

  const counts = {
    document: documents.length,
    procedure: procedures.length,
    system: systems.length,
    concept: concepts.length,
    regulation: regulations.length,
  };

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <header className="premium-panel rounded-[2rem] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Link
              href="/admin/process-automation-map"
              className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)] hover:text-[var(--foreground-strong)]"
            >
              <ArrowLeft className="h-3 w-3" />
              Voltar ao mapa de processos
            </Link>
            <h1 className="mt-2 text-3xl font-black text-[var(--foreground-strong)]">
              {process.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${status.className}`}>
                {status.label}
              </span>
              {process.sector && (
                <span className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--foreground-soft)]">
                  {SECTOR_LABELS[process.sector] ?? process.sector}
                </span>
              )}
              <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${auto.className}`}>
                {auto.label}
              </span>
              {process.graphBacked ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/70 bg-cyan-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-700">
                  <Network className="h-3 w-3" />
                  Grafo ativo
                </span>
              ) : (
                <span className="rounded-full border border-slate-300/70 bg-slate-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">
                  Sem ancoragem no grafo
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={reload}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-4 py-1.5 text-[12px] font-bold uppercase tracking-[0.18em] text-[var(--foreground-soft)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--foreground-strong)]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Recarregar
            </button>
          </div>
        </div>

        {/* Scores */}
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <ScoreBox
            label="Prontidão"
            value={process.automationReadinessScore}
            hint="Quanto este processo está pronto para automação."
          />
          <ScoreBox
            label="Cobertura"
            value={process.documentationCoverageScore}
            hint="Quão completa é a documentação do processo."
          />
          <ScoreBox
            label="Confiança"
            value={process.confidenceScore}
            hint="Confiança nas evidências usadas para consolidar este processo."
          />
        </div>
      </header>

      {/* ── Graph view ── */}
      <section className="premium-panel rounded-[2rem] p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
              Visão do grafo
            </p>
            <p className="mt-1 text-sm text-[var(--foreground-soft)]">
              O processo no centro, com cada entidade relacionada como satélite.
              Passe o mouse, use a roda para aproximar e arraste para navegar.
            </p>
          </div>
          <span className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--foreground-soft)]">
            {satellites.length} entidade{satellites.length === 1 ? "" : "s"}
          </span>
        </div>

        {satellites.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center">
            <Network className="mx-auto h-10 w-10 text-[var(--muted)]" />
            <p className="mt-3 text-sm font-bold text-[var(--foreground-strong)]">
              Este processo ainda não tem entidades ligadas no grafo.
            </p>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              Promova documentos, sistemas ou conceitos para enriquecer a visão.
            </p>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[#0b1120]">
            <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-[#1e2d45] bg-[#0b1120]/90 p-1 shadow-lg backdrop-blur-sm">
              <GraphViewButton label="Aproximar" onClick={() => zoomGraphFromCenter(0.84)}>
                <ZoomIn className="h-3.5 w-3.5" />
              </GraphViewButton>
              <GraphViewButton label="Afastar" onClick={() => zoomGraphFromCenter(1.18)}>
                <ZoomOut className="h-3.5 w-3.5" />
              </GraphViewButton>
              <GraphViewButton label="Reenquadrar" onClick={resetGraphView}>
                <RefreshCw className="h-3.5 w-3.5" />
              </GraphViewButton>
            </div>
            <svg
              ref={graphSvgRef}
              viewBox={`${graphViewBox.x} ${graphViewBox.y} ${graphViewBox.width} ${graphViewBox.height}`}
              className={`block h-[420px] w-full touch-none select-none ${
                graphPanning ? "cursor-grabbing" : "cursor-grab"
              }`}
              onDoubleClick={resetGraphView}
              onPointerCancel={stopGraphPan}
              onPointerDown={handleGraphPointerDown}
              onPointerMove={handleGraphPointerMove}
              onPointerUp={stopGraphPan}
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <pattern id="proc-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e2d45" strokeWidth="0.5" />
                </pattern>
                <radialGradient id="proc-center-grad" cx="35%" cy="30%" r="60%">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity="1" />
                  <stop offset="100%" stopColor="#0891b2" stopOpacity="1" />
                </radialGradient>
                {(Object.keys(ENTITY_STYLE) as EntityKind[]).map((k) => (
                  <radialGradient key={k} id={`proc-grad-${k}`} cx="35%" cy="30%" r="60%">
                    <stop offset="0%" stopColor={ENTITY_STYLE[k].fill} stopOpacity="1" />
                    <stop offset="100%" stopColor={ENTITY_STYLE[k].stroke} stopOpacity="1" />
                  </radialGradient>
                ))}
              </defs>
              <rect width="100%" height="100%" fill="url(#proc-grid)" />

              {/* Edges */}
              {laid.map((s) => (
                <line
                  key={`edge-${s.key}`}
                  x1={CENTER_X}
                  y1={CENTER_Y}
                  x2={s.x}
                  y2={s.y}
                  stroke={ENTITY_STYLE[s.kind].fill}
                  strokeOpacity={0.45}
                  strokeWidth={1.4}
                />
              ))}

              {/* Satellites */}
              {laid.map((s) => {
                const r = 14;
                // Label position pushed outward from center so it doesn't overlap the node
                const labelDx = Math.cos(s.angle) * (r + 10);
                const labelDy = Math.sin(s.angle) * (r + 10);
                const anchor = Math.cos(s.angle) > 0.3 ? "start" : Math.cos(s.angle) < -0.3 ? "end" : "middle";
                const truncated = s.label.length > 24 ? s.label.slice(0, 22) + "…" : s.label;
                return (
                  <g key={s.key}>
                    <circle
                      cx={s.x}
                      cy={s.y}
                      r={r}
                      fill={`url(#proc-grad-${s.kind})`}
                      stroke={ENTITY_STYLE[s.kind].stroke}
                      strokeWidth={1.5}
                    />
                    <text
                      x={s.x + labelDx}
                      y={s.y + labelDy}
                      textAnchor={anchor}
                      dominantBaseline="middle"
                      fontSize={11}
                      fill="#cbd5e1"
                      fontFamily="system-ui, sans-serif"
                    >
                      {truncated}
                    </text>
                  </g>
                );
              })}

              {/* Center process node */}
              <circle
                cx={CENTER_X}
                cy={CENTER_Y}
                r={36}
                fill="url(#proc-center-grad)"
                stroke="#0e7490"
                strokeWidth={2}
              />
              <text
                x={CENTER_X}
                y={CENTER_Y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={12}
                fontWeight="bold"
                fill="#ffffff"
                fontFamily="system-ui, sans-serif"
              >
                Processo
              </text>
              <text
                x={CENTER_X}
                y={CENTER_Y + 58}
                textAnchor="middle"
                fontSize={13}
                fontWeight="bold"
                fill="#e2e8f0"
                fontFamily="system-ui, sans-serif"
              >
                {process.name.length > 40 ? process.name.slice(0, 38) + "…" : process.name}
              </text>
            </svg>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#1e2d45] bg-[#0b1120] px-4 py-2">
              {(Object.entries(ENTITY_STYLE) as [EntityKind, (typeof ENTITY_STYLE)[EntityKind]][]).map(
                ([kind, style]) => {
                  const count = counts[kind];
                  return (
                    <div key={kind} className="flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: style.fill }}
                      />
                      <span className="text-[10px] text-[#94a3b8]">
                        {style.label} <span className="tabular-nums text-[#64748b]">({count})</span>
                      </span>
                    </div>
                  );
                },
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Entity cards ── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <EntityCard
          title="Documentos"
          icon={FileText}
          accent="amber"
          empty="Nenhum documento vinculado."
        >
          {documents.length === 0 ? null : (
            <ul className="space-y-2">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold text-[var(--foreground-strong)]">
                      {doc.title ?? doc.id}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                      {doc.sector ? SECTOR_LABELS[doc.sector] ?? doc.sector : "—"}
                      {doc.status ? ` · ${doc.status}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </EntityCard>

        <EntityCard
          title="Procedimentos"
          icon={GitMerge}
          accent="violet"
          empty="Nenhum procedimento ligado."
        >
          {procedures.length === 0 ? null : (
            <TagList items={procedures} tone="violet" />
          )}
        </EntityCard>

        <EntityCard
          title="Sistemas"
          icon={Wrench}
          accent="teal"
          empty="Nenhum sistema mapeado."
        >
          {systems.length === 0 ? null : <TagList items={systems} tone="teal" />}
        </EntityCard>

        <EntityCard
          title="Conceitos"
          icon={CircleDot}
          accent="blue"
          empty="Nenhum conceito relacionado."
        >
          {concepts.length === 0 ? null : <TagList items={concepts} tone="blue" />}
        </EntityCard>

        <EntityCard
          title="Regulamentos"
          icon={ShieldCheck}
          accent="amber"
          empty="Sem regulamento aplicável."
        >
          {regulations.length === 0 ? null : <TagList items={regulations} tone="amber" />}
        </EntityCard>

        <EntityCard
          title="Metadados"
          icon={BookOpen}
          accent="slate"
          empty="—"
        >
          <dl className="grid grid-cols-1 gap-1.5 text-[12px] text-[var(--foreground-soft)] sm:grid-cols-2">
            <MetaRow label="ID" value={process.id} mono />
            <MetaRow label="Setor" value={process.sector ?? "—"} />
            <MetaRow label="Fingerprint" value={process.fingerprint ?? "—"} mono truncate />
            <MetaRow label="Status" value={process.status ?? "—"} />
            <MetaRow label="Automação" value={process.recommendedAutomationLevel ?? "—"} />
            <MetaRow label="Graph-backed" value={process.graphBacked ? "sim" : "não"} />
          </dl>
        </EntityCard>
      </section>

      {/* ── JSON viewer ── */}
      <section className="premium-panel rounded-[2rem] p-4">
        <button
          onClick={() => setShowJson((v) => !v)}
          className="flex w-full items-center justify-between gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-[var(--surface)]"
        >
          <span className="flex items-center gap-2">
            <span className="rounded-md border border-[var(--border)] bg-white p-1.5">
              <BookOpen className="h-3.5 w-3.5 text-[var(--foreground-soft)]" />
            </span>
            <span className="text-[12px] font-bold uppercase tracking-[0.18em] text-[var(--foreground-soft)]">
              Resposta bruta (JSON)
            </span>
          </span>
          {showJson ? (
            <ChevronUp className="h-4 w-4 text-[var(--muted)]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[var(--muted)]" />
          )}
        </button>
        {showJson && (
          <pre className="mt-3 max-h-[420px] overflow-auto rounded-2xl border border-[#1e2d45] bg-[#0b1120] p-4 text-[11px] leading-5 text-[#cbd5e1]">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function ScoreBox({ label, value, hint }: { label: string; value: number; hint: string }) {
  const rounded = Math.round(value);
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
        {label}
      </p>
      <p className={`mt-1 text-3xl font-black tabular-nums ${scoreColor(rounded)}`}>
        {rounded}
        <span className="text-base font-bold text-[var(--muted)]">/100</span>
      </p>
      <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">{hint}</p>
    </div>
  );
}

function GraphViewButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      className="rounded-md border border-transparent p-1.5 text-[#cbd5e1] transition-colors hover:border-[#31527a] hover:bg-[#173253] hover:text-white"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

const ACCENT_RING: Record<string, string> = {
  amber: "border-amber-300/60 bg-amber-50/40",
  violet: "border-violet-300/60 bg-violet-50/40",
  teal: "border-teal-300/60 bg-teal-50/40",
  blue: "border-blue-300/60 bg-blue-50/40",
  slate: "border-slate-300/60 bg-slate-50/40",
};

const ACCENT_ICON: Record<string, string> = {
  amber: "text-amber-600",
  violet: "text-violet-600",
  teal: "text-teal-600",
  blue: "text-blue-600",
  slate: "text-slate-600",
};

function EntityCard({
  title,
  icon: Icon,
  accent,
  empty,
  children,
}: {
  title: string;
  icon: typeof FileText;
  accent: keyof typeof ACCENT_RING;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border ${ACCENT_RING[accent]} p-4`}>
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-md border border-[var(--border)] bg-white p-1.5">
          <Icon className={`h-3.5 w-3.5 ${ACCENT_ICON[accent]}`} />
        </span>
        <h3 className="text-[12px] font-bold uppercase tracking-[0.18em] text-[var(--foreground-strong)]">
          {title}
        </h3>
      </div>
      {children ?? (
        <p className="rounded-xl border border-dashed border-[var(--border)] bg-white/60 px-3 py-3 text-center text-[11px] text-[var(--muted)]">
          {empty}
        </p>
      )}
    </div>
  );
}

const TAG_TONE: Record<string, string> = {
  amber: "border-amber-300 bg-amber-50 text-amber-800",
  violet: "border-violet-300 bg-violet-50 text-violet-800",
  teal: "border-teal-300 bg-teal-50 text-teal-800",
  blue: "border-blue-300 bg-blue-50 text-blue-800",
};

function TagList({ items, tone }: { items: string[]; tone: keyof typeof TAG_TONE }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${TAG_TONE[tone]}`}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function MetaRow({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] pb-1.5 last:border-b-0 last:pb-0">
      <dt className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--muted)]">
        {label}
      </dt>
      <dd
        className={`min-w-0 text-right ${mono ? "font-mono" : ""} ${truncate ? "truncate" : ""}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
