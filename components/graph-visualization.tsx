"use client";

import {
  ExternalLink,
  EyeOff,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DocumentDetailModal } from "@/components/document-detail-modal";

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeType = "Document" | "Concept" | "Procedure" | "System" | "Regulation" | "Person" | "Sector" | "Process";

type GraphNode = { id: string; label: string; type: NodeType; degree: number; sector?: string; status?: string };
type GraphEdge = { source: string; target: string; type: string; weight?: number };
type SectorMeta = { slug: string; displayName: string };

type SimNode = GraphNode & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
};

type Transform = { scale: number; tx: number; ty: number };

// ─── Visuals ──────────────────────────────────────────────────────────────────

const NODE_COLORS: Record<NodeType, { fill: string; stroke: string }> = {
  Document:   { fill: "#94a3b8", stroke: "#64748b" }, // fallback — sector overrides this
  Concept:    { fill: "#60a5fa", stroke: "#3b82f6" },
  Procedure:  { fill: "#c084fc", stroke: "#a855f7" },
  System:     { fill: "#2dd4bf", stroke: "#14b8a6" },
  Regulation: { fill: "#fbbf24", stroke: "#f59e0b" },
  Person:     { fill: "#fb7185", stroke: "#f43f5e" },
  Sector:     { fill: "#e2e8f0", stroke: "#94a3b8" }, // neutral container — sector palette overrides
  Process:    { fill: "#22d3ee", stroke: "#0891b2" }, // distinct cyan accent
};

const NATIVE_SECTOR_COLORS: Record<string, { fill: string; stroke: string }> = {
  desenvolvimento: { fill: "#f472b6", stroke: "#ec4899" },
  seguranca:       { fill: "#f87171", stroke: "#ef4444" },
  suporte:         { fill: "#4ade80", stroke: "#22c55e" },
  desktop:         { fill: "#fb923c", stroke: "#f97316" },
};

// Palette ordered so that sequential pairs are maximally distant in hue:
// [0]51° → [1]239° (+188°) → [2]174° (−65°) → [3]292° (+118°)
// → [4]82° (−150°) → [5]270° (+188°) → [6]199° (−71°)
// Minimum consecutive gap: 65°. All hues avoid native ranges
// (red ~0°, orange ~29°, green ~145°, pink ~325°).
const DYNAMIC_PALETTE: Array<{ fill: string; stroke: string }> = [
  { fill: "#facc15", stroke: "#92400e" }, // [0] amber-yellow  ~51°
  { fill: "#818cf8", stroke: "#3730a3" }, // [1] indigo        ~239°
  { fill: "#2dd4bf", stroke: "#0f766e" }, // [2] teal          ~174°
  { fill: "#e879f9", stroke: "#86198f" }, // [3] fuchsia       ~292°
  { fill: "#a3e635", stroke: "#4d7c0f" }, // [4] lime          ~82°
  { fill: "#c084fc", stroke: "#7e22ce" }, // [5] violet        ~270°
  { fill: "#38bdf8", stroke: "#0284c7" }, // [6] sky-blue      ~199°
];

function hashSector(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

function nodeColors(
  node: GraphNode,
  colorMap: Map<string, { fill: string; stroke: string }>,
) {
  if ((node.type === "Document" || node.type === "Sector") && node.sector) {
    const c = colorMap.get(node.sector);
    if (c) return c;
    return DYNAMIC_PALETTE[hashSector(node.sector) % DYNAMIC_PALETTE.length];
  }
  return NODE_COLORS[node.type] ?? NODE_COLORS.Concept;
}

const EDGE_STROKE: Record<string, string> = {
  HAS_CONCEPT:       "#3b82f6",
  DESCRIBES:         "#a855f7",
  REFERENCES_SYSTEM: "#14b8a6",
  COMPLIES_WITH:     "#f59e0b",
  INVOLVES_PERSON:   "#fb7185",
  CO_OCCURS_WITH:    "#fb923c",
  CO_MENTIONED:      "#38bdf8",
  SHARES_ENTITY:     "#e2e8f0",
  HAS_DOCUMENT:      "#cbd5e1",
  OWNS:              "#22d3ee",
  DESCRIBED_BY:      "#0891b2",
  COMPRISES:         "#a855f7",
  SUPPORTED_BY:      "#14b8a6",
  REQUIRES_CONCEPT:  "#3b82f6",
  GOVERNED_BY:       "#f59e0b",
};

const EDGE_LABELS: Record<string, string> = {
  HAS_CONCEPT: "conceito",
  DESCRIBES: "procedimento",
  REFERENCES_SYSTEM: "sistema",
  COMPLIES_WITH: "regra",
  INVOLVES_PERSON: "pessoa",
  CO_OCCURS_WITH: "co-ocorrência",
  CO_MENTIONED: "associado",
  SHARES_ENTITY: "docs relacionados",
  HAS_DOCUMENT: "setor → documento",
  OWNS: "setor → processo",
  DESCRIBED_BY: "processo → documento",
  COMPRISES: "processo → procedimento",
  SUPPORTED_BY: "processo → sistema",
  REQUIRES_CONCEPT: "processo → conceito",
  GOVERNED_BY: "processo → regulamento",
};

const RELATION_FILTERS: { type: string; label: string; description: string }[] = [
  {
    type: "HAS_CONCEPT",
    label: "Documento -> Conceito",
    description: "Temas citados pelo documento",
  },
  {
    type: "DESCRIBES",
    label: "Documento -> Procedimento",
    description: "Processos descritos pelo documento",
  },
  {
    type: "REFERENCES_SYSTEM",
    label: "Documento -> Sistema",
    description: "Sistemas e ferramentas referenciados",
  },
  {
    type: "COMPLIES_WITH",
    label: "Documento -> Regra",
    description: "Normas e politicas citadas",
  },
  {
    type: "INVOLVES_PERSON",
    label: "Documento → Pessoa",
    description: "Pessoas mencionadas no documento",
  },
  {
    type: "CO_OCCURS_WITH",
    label: "Pessoa → Processo/Sistema",
    description: "Co-ocorrência em chunks do mesmo documento",
  },
  {
    type: "CO_MENTIONED",
    label: "Entidades associadas",
    description: "Entidades de tipos diferentes no mesmo documento",
  },
  {
    type: "SHARES_ENTITY",
    label: "Docs relacionados",
    description: "Documentos que compartilham entidades",
  },
  {
    type: "HAS_DOCUMENT",
    label: "Setor → Documento",
    description: "Documentos pertencentes ao setor",
  },
  {
    type: "OWNS",
    label: "Setor → Processo",
    description: "Processos sob a guarda do setor",
  },
  {
    type: "DESCRIBED_BY",
    label: "Processo → Documento",
    description: "Documentos que descrevem o processo",
  },
  {
    type: "COMPRISES",
    label: "Processo → Procedimento",
    description: "Procedimentos que compõem o processo",
  },
  {
    type: "SUPPORTED_BY",
    label: "Processo → Sistema",
    description: "Sistemas que apoiam o processo",
  },
  {
    type: "REQUIRES_CONCEPT",
    label: "Processo → Conceito",
    description: "Conceitos exigidos pelo processo",
  },
  {
    type: "GOVERNED_BY",
    label: "Processo → Regulamento",
    description: "Regulamentos que regem o processo",
  },
];

function isEntityAssociationEdge(edge: GraphEdge) {
  return edge.type === "CO_MENTIONED" || edge.type === "CO_OCCURS_WITH";
}

const ENTITY_LEGEND: { type: NodeType; label: string }[] = [
  { type: "Concept",    label: "Conceitos" },
  { type: "Procedure",  label: "Procedimentos" },
  { type: "System",     label: "Sistemas" },
  { type: "Regulation", label: "Regulamentações" },
  { type: "Person",     label: "Pessoas" },
];

const LEGEND: { type: NodeType; label: string }[] = [
  { type: "Sector",     label: "Setores" },
  { type: "Process",    label: "Processos" },
  { type: "Document",   label: "Documentos" },
  { type: "Concept",    label: "Conceitos" },
  { type: "Procedure",  label: "Procedimentos" },
  { type: "System",     label: "Sistemas" },
  { type: "Regulation", label: "Regulamentações" },
  { type: "Person",     label: "Pessoas" },
];

function nodeRadius(degree: number, type: NodeType) {
  const base = type === "Sector" ? 18 : type === "Process" ? 16 : type === "Document" ? 14 : 8;
  return Math.min(base + degree * 1.8, 30);
}

function nodeSearchText(node: GraphNode, labelMap: Map<string, string>) {
  return [
    node.label,
    node.type,
    node.sector ? (labelMap.get(node.sector) ?? node.sector) : "",
    `grau ${node.degree}`,
  ]
    .join(" ")
    .toLowerCase();
}

// ─── Force simulation ──────────────────────────────────────────────────────────

const K_REP     = 12000;
const K_SPRING  = 0.04;
const L_SPRING  = 220;
const K_CENTER  = 0.003;
const FRICTION  = 0.88;
const MIN_D     = 40;
const STEPS     = 4;       // simulation ticks per animation frame

function simulateStep(
  nodes: SimNode[],
  edges: GraphEdge[],
  w: number,
  h: number,
): number {
  const cx = w / 2, cy = h / 2;
  const fx = new Float64Array(nodes.length);
  const fy = new Float64Array(nodes.length);

  // Repulsion (all pairs) — documents repel each other much harder so hubs spread out
  for (let i = 0; i < nodes.length; i++) {
    const ti = nodes[i].type;
    for (let j = i + 1; j < nodes.length; j++) {
      const tj = nodes[j].type;
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      const d  = Math.max(Math.hypot(dx, dy), MIN_D);
      const bothDocs = ti === "Document" && tj === "Document";
      const oneDoc = !bothDocs && (ti === "Document" || tj === "Document");
      const k = bothDocs ? K_REP * 6 : oneDoc ? K_REP * 1.6 : K_REP;
      const f  = k / (d * d);
      const nx = (dx / d) * f, ny = (dy / d) * f;
      fx[i] -= nx; fy[i] -= ny;
      fx[j] += nx; fy[j] += ny;
    }
  }

  // Spring attraction along edges
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  for (const e of edges) {
    const si = idx.get(e.source), ti = idx.get(e.target);
    if (si === undefined || ti === undefined) continue;
    const dx = nodes[ti].x - nodes[si].x;
    const dy = nodes[ti].y - nodes[si].y;
    const d  = Math.max(Math.hypot(dx, dy), 1);
    // Doc-doc shared-entity edges stay long; entity associations stay close enough
    // to make procedure/system/concept neighborhoods visible without documents.
    const rest = e.type === "SHARES_ENTITY"
      ? L_SPRING * 2.2
      : isEntityAssociationEdge(e)
        ? L_SPRING * 1.25
        : L_SPRING;
    const k = e.type === "SHARES_ENTITY"
      ? K_SPRING * 0.4
      : isEntityAssociationEdge(e)
        ? K_SPRING * 0.7
        : K_SPRING;
    const f  = k * (d - rest);
    const nx = (dx / d) * f, ny = (dy / d) * f;
    fx[si] += nx; fy[si] += ny;
    fx[ti] -= nx; fy[ti] -= ny;
  }

  // Center pull
  for (let i = 0; i < nodes.length; i++) {
    fx[i] += (cx - nodes[i].x) * K_CENTER;
    fy[i] += (cy - nodes[i].y) * K_CENTER;
  }

  // Integrate
  let maxV = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].pinned) continue;
    nodes[i].vx = (nodes[i].vx + fx[i]) * FRICTION;
    nodes[i].vy = (nodes[i].vy + fy[i]) * FRICTION;
    nodes[i].x += nodes[i].vx;
    nodes[i].y += nodes[i].vy;
    maxV = Math.max(maxV, Math.abs(nodes[i].vx), Math.abs(nodes[i].vy));
  }
  return maxV;
}

// ─── Component ────────────────────────────────────────────────────────────────

type TooltipInfo = { nodeId: string; px: number; py: number };

function cloneSimGraph(graph: { nodes: SimNode[]; edges: GraphEdge[] }) {
  return {
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: graph.edges,
  };
}

type RelatedDocumentLink = {
  id: string;
  label: string;
  weight: number;
  relationLabel: string;
};

function getRelatedDocumentLinks(
  node: GraphNode,
  edges: GraphEdge[],
  nodeMap: Map<string, GraphNode>,
): RelatedDocumentLink[] {
  const links = new Map<string, RelatedDocumentLink>();

  for (const edge of edges) {
    if (edge.source !== node.id && edge.target !== node.id) continue;
    const otherId = edge.source === node.id ? edge.target : edge.source;
    const other = nodeMap.get(otherId);
    if (!other || other.type !== "Document" || other.id === node.id) continue;

    const current = links.get(other.id);
    const candidate = {
      id: other.id,
      label: other.label,
      weight: edge.weight ?? 1,
      relationLabel: EDGE_LABELS[edge.type] ?? edge.type.toLowerCase(),
    };

    if (!current || candidate.weight > current.weight) {
      links.set(other.id, candidate);
    }
  }

  return [...links.values()]
    .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label, "pt-BR"))
    .slice(0, 6);
}

export function GraphVisualization() {
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [rawData, setRawData]   = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [sectorMeta, setSectorMeta] = useState<SectorMeta[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  // Progressive layered selection — start empty so canvas is light and intentional.
  const [activeTypes, setActiveTypes] = useState<Set<NodeType>>(new Set());
  // Three-state for documents: auto (shown as parents), active (all shown), excluded (never shown)
  const [documentsExcluded, setDocumentsExcluded] = useState(false);
  const [activeRelationTypes, setActiveRelationTypes] = useState<Set<string>>(
    new Set(RELATION_FILTERS.map((relation) => relation.type)),
  );

  const sectorColorMap = useMemo(() => {
    const map = new Map<string, { fill: string; stroke: string }>(
      Object.entries(NATIVE_SECTOR_COLORS),
    );
    // Sequential assignment: each new dynamic sector gets the next palette slot.
    // Sectors are returned in a stable order (native first, then alphabetical) so
    // the mapping is consistent across renders.
    let nextIdx = 0;
    for (const { slug } of sectorMeta) {
      if (!map.has(slug)) {
        map.set(slug, DYNAMIC_PALETTE[nextIdx % DYNAMIC_PALETTE.length]);
        nextIdx++;
      }
    }
    // Fallback for sectors present in graph data but missing from sectorMeta
    // (e.g. a sector deleted after extraction). Use hash so the color is at
    // least deterministic even without API metadata.
    if (rawData) {
      for (const n of rawData.nodes) {
        if (n.type === "Document" && n.sector && !map.has(n.sector)) {
          map.set(n.sector, DYNAMIC_PALETTE[hashSector(n.sector) % DYNAMIC_PALETTE.length]);
        }
      }
    }
    return map;
  }, [sectorMeta, rawData]);

  const sectorLabelMap = useMemo(() => {
    const map = new Map<string, string>([
      ["desenvolvimento", "Desenvolvimento"],
      ["seguranca", "Segurança"],
      ["suporte", "Suporte"],
      ["desktop", "Desktop"],
    ]);
    for (const { slug, displayName } of sectorMeta) {
      map.set(slug, displayName);
    }
    return map;
  }, [sectorMeta]);

  // Edge types that always connect Document -> Entity.
  const DOC_ENTITY_RELS = new Set(["HAS_CONCEPT", "DESCRIBES", "REFERENCES_SYSTEM", "COMPLIES_WITH", "INVOLVES_PERSON"]);

  // Filtered data based on active types. Edges only kept if BOTH endpoints are visible.
  // When entity types are active but Document is not, document nodes that are directly
  // connected to a visible entity are always auto-included so entities are never orphaned
  // visually — the user can always see what document sourced each entity.
  const data = useMemo(() => {
    if (!rawData) return null;
    if (activeTypes.size === 0) return { nodes: [], edges: [], autoDocIds: new Set<string>() };

    const query = searchTerm.trim().toLowerCase();
    const typeOf = new Map(rawData.nodes.map((n) => [n.id, n.type]));
    const nodeById = new Map(rawData.nodes.map((n) => [n.id, n]));

    const primaryNodes = rawData.nodes.filter((n) => {
      if (!activeTypes.has(n.type)) return false;
      if (!query) return true;
      return nodeSearchText(n, sectorLabelMap).includes(query);
    });
    const primaryIds = new Set(primaryNodes.map((n) => n.id));

    // Auto-include Document nodes linked to visible entities only when Document
    // is not explicitly activated and not explicitly excluded.
    const autoDocIds = new Set<string>();
    if (!activeTypes.has("Document") && !documentsExcluded) {
      for (const edge of rawData.edges) {
        if (!DOC_ENTITY_RELS.has(edge.type)) continue;
        if (typeOf.get(edge.source) === "Document" && primaryIds.has(edge.target)) {
          autoDocIds.add(edge.source);
        }
      }
    }

    const autoDocNodes = [...autoDocIds]
      .map((id) => nodeById.get(id))
      .filter((n): n is GraphNode => n !== undefined);

    const allNodes = [...primaryNodes, ...autoDocNodes];
    const visibleIds = new Set(allNodes.map((n) => n.id));

    return {
      nodes: allNodes,
      autoDocIds,
      edges: rawData.edges.filter((e) => {
        if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) return false;
        if (!activeRelationTypes.has(e.type)) return false;
        return true;
      }),
    };
  }, [rawData, activeTypes, documentsExcluded, activeRelationTypes, searchTerm, sectorLabelMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // Simulation state lives in a ref to avoid stale-closure issues
  const simRef = useRef<{ nodes: SimNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const rafRef = useRef<number | null>(null);

  // Render snapshot mirrors the mutable simulation ref.
  const [renderGraph, setRenderGraph] = useState<{ nodes: SimNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [stable, setStable]   = useState(false);
  const [paused, setPaused]   = useState(false);
  const [resetKey, setResetKey] = useState(0);

  // Pan / zoom
  const [transform, _setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 });
  const transformRef = useRef<Transform>({ scale: 1, tx: 0, ty: 0 });
  const setTransform = useCallback((upd: Transform | ((t: Transform) => Transform)) => {
    const next = typeof upd === "function" ? upd(transformRef.current) : upd;
    transformRef.current = next;
    _setTransform(next);
  }, []);

  // Interaction refs
  const containerRef  = useRef<HTMLDivElement>(null);
  const draggingRef   = useRef<string | null>(null);
  const panningRef    = useRef<{ sx: number; sy: number; stx: number; sty: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Tooltip & highlight
  const [tooltip, setTooltip]     = useState<TooltipInfo | null>(null);
  const [highlighted, setHighlighted] = useState<Set<string> | null>(null);

  // Container size
  const [dims, setDims] = useState({ w: 800, h: 500 });
  const [expanded, setExpanded] = useState(false);

  // Document detail modal
  const [detailDocId, setDetailDocId] = useState<string | null>(null);
  const [pinnedTooltip, setPinnedTooltip] = useState<TooltipInfo | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/graph/full")
      .then((r) => r.json())
      .then((d: { connected?: boolean; nodes?: GraphNode[]; edges?: GraphEdge[]; error?: string; sectors?: SectorMeta[] }) => {
        if (!d.connected || d.error) { setError(d.error ?? "Neo4j indisponível"); return; }
        setRawData({ nodes: d.nodes ?? [], edges: d.edges ?? [] });
        if (d.sectors?.length) setSectorMeta(d.sectors);
      })
      .catch(() => setError("Falha ao carregar grafo"))
      .finally(() => setLoading(false));
  }, []);

  // ── Init simulation ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!data) return;
    const { w, h } = dims;
    const previousNodes = new Map(simRef.current.nodes.map((node) => [node.id, node]));
    simRef.current = {
      nodes: data.nodes.map((n) => ({
        ...n,
        x: previousNodes.get(n.id)?.x ?? (w / 2 + (Math.random() - 0.5) * Math.min(w, h) * 0.6),
        y: previousNodes.get(n.id)?.y ?? (h / 2 + (Math.random() - 0.5) * Math.min(w, h) * 0.6),
        vx: 0, vy: 0,
        pinned: false,
      })),
      edges: data.edges,
    };
    queueMicrotask(() => setRenderGraph(cloneSimGraph(simRef.current)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, resetKey]);

  // ── Animation loop ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!data || paused) return;

    const loop = () => {
      let maxV = 0;
      for (let i = 0; i < STEPS; i++) {
        maxV = simulateStep(simRef.current.nodes, simRef.current.edges, dims.w, dims.h);
      }
      setRenderGraph(cloneSimGraph(simRef.current));
      if (maxV < 0.25) { setStable(true); return; }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [data, paused, dims, resetKey]);

  // ── Resize observer ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.max(width, 300), h: Math.max(height, 300) });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Interaction ────────────────────────────────────────────────────────────

  useEffect(() => {
    // We use a window listener with { passive: false } to reliably block page scroll
    // when the cursor is over the graph container.
    const onWheel = (e: WheelEvent) => {
      const el = containerRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const isOver = (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      );

      if (isOver) {
        e.preventDefault(); // This definitively stops the page from scrolling
        
        const factor = e.deltaY > 0 ? 0.88 : 1.14;
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        setTransform((t) => {
          const s = Math.min(Math.max(t.scale * factor, 0.15), 6);
          return {
            scale: s,
            tx: mx - (mx - t.tx) * (s / t.scale),
            ty: my - (my - t.ty) * (s / t.scale),
          };
        });
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [setTransform]);

  const handleBgMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setPinnedTooltip(null);
    panningRef.current = {
      sx: e.clientX, sy: e.clientY,
      stx: transformRef.current.tx,
      sty: transformRef.current.ty,
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (draggingRef.current) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const t = transformRef.current;
      const mx = (e.clientX - rect.left - t.tx) / t.scale;
      const my = (e.clientY - rect.top  - t.ty) / t.scale;
      const node = simRef.current.nodes.find((n) => n.id === draggingRef.current);
      if (node) { node.x = mx; node.y = my; node.vx = 0; node.vy = 0; }
      setRenderGraph(cloneSimGraph(simRef.current));
    } else if (panningRef.current) {
      const dx = e.clientX - panningRef.current.sx;
      const dy = e.clientY - panningRef.current.sy;
      setTransform(() => ({
        scale: transformRef.current.scale,
        tx: panningRef.current!.stx + dx,
        ty: panningRef.current!.sty + dy,
      }));
    }
  }, [setTransform]);

  const handleMouseUp = useCallback(() => {
    if (draggingRef.current) {
      const node = simRef.current.nodes.find((n) => n.id === draggingRef.current);
      if (node) node.pinned = false;
      draggingRef.current = null;
    }
    panningRef.current = null;
    setIsDragging(false);
  }, []);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const node = simRef.current.nodes.find((n) => n.id === id);
    if (node) node.pinned = true;
    draggingRef.current = id;
    setIsDragging(true);
    setStable(false);
    // Resume if paused
    setPaused(false);
  }, []);

  const pinNodeCard = useCallback((id: string, px: number, py: number) => {
    setPinnedTooltip({
      nodeId: id,
      px,
      py,
    });
  }, []);

  const highlightNodeNeighborhood = useCallback((id: string) => {
    setHighlighted((prev) => {
      if (prev?.has(id) && prev.size === 1) return null;
      const nbrs = new Set<string>([id]);
      for (const ed of simRef.current.edges) {
        if (ed.source === id) nbrs.add(ed.target);
        if (ed.target === id) nbrs.add(ed.source);
      }
      return prev?.has(id) && nbrs.size === 1 ? null : nbrs;
    });
  }, []);

  const handleNodeClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      highlightNodeNeighborhood(id);

      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        pinNodeCard(id, e.clientX - rect.left, e.clientY - rect.top);
      }
    },
    [highlightNodeNeighborhood, pinNodeCard],
  );

  const handleListNodeClick = useCallback(
    (id: string) => {
      highlightNodeNeighborhood(id);
      setPinnedTooltip(null);
    },
    [highlightNodeNeighborhood],
  );

  const resetLayout = useCallback(() => {
    setResetKey((k) => k + 1);
    setPaused(false);
    setStable(false);
    setTransform({ scale: 1, tx: 0, ty: 0 });
    setHighlighted(null);
  }, [setTransform]);

  const zoomIn = useCallback(
    () => setTransform((t) => ({ ...t, scale: Math.min(t.scale * 1.2, 6) })),
    [setTransform],
  );

  const zoomOut = useCallback(
    () => setTransform((t) => ({ ...t, scale: Math.max(t.scale * 0.8, 0.15) })),
    [setTransform],
  );

  // ── Derived render data ────────────────────────────────────────────────────

  const nodes = renderGraph.nodes;
  const edges = renderGraph.edges;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const highlightedEdgeSet = highlighted
    ? new Set(
        edges
          .filter((e) => highlighted.has(e.source) && highlighted.has(e.target))
          .map((e) => `${e.source}|${e.target}`),
      )
    : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-[var(--muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Carregando grafo…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-red-500">
        {error}
      </div>
    );
  }

  if (!rawData || !data || rawData.nodes.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-[var(--muted)]">
        <span className="text-sm">Grafo vazio.</span>
        <span className="text-[11px]">Extraia documentos na aba &ldquo;Documentos&rdquo; para popular o grafo.</span>
      </div>
    );
  }

  const restartSimWithTypes = (next: Set<NodeType>) => {
    setActiveTypes(next);
    setStable(false);
    setHighlighted(null);
    setResetKey((k) => k + 1);
  };

  const restartSimWithDocMode = (next: Set<NodeType>, excluded: boolean) => {
    setActiveTypes(next);
    setDocumentsExcluded(excluded);
    setStable(false);
    setHighlighted(null);
    setResetKey((k) => k + 1);
  };

  const toggleType = (type: NodeType) => {
    if (type === "Document") {
      const isActive = activeTypes.has("Document") && !documentsExcluded;
      const next = new Set(activeTypes);
      if (documentsExcluded) {
        // hidden → auto: clear excluded, keep Document out of activeTypes
        next.delete("Document");
        restartSimWithDocMode(next, false);
      } else if (isActive) {
        // active → hidden: remove from active, set excluded
        next.delete("Document");
        restartSimWithDocMode(next, true);
      } else {
        // auto → active: add Document to activeTypes
        next.add("Document");
        restartSimWithDocMode(next, false);
      }
      return;
    }
    const next = new Set(activeTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    restartSimWithTypes(next);
  };

  const restartSimWithRelations = (next: Set<string>) => {
    setActiveRelationTypes(next);
    setStable(false);
    setHighlighted(null);
    setResetKey((k) => k + 1);
  };

  const toggleRelationType = (type: string) => {
    const next = new Set(activeRelationTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    restartSimWithRelations(next);
  };

  const setAllActive = () => restartSimWithDocMode(new Set(LEGEND.map((l) => l.type)), false);
  const clearActive = () => restartSimWithDocMode(new Set(), false);
  const setAllRelations = () =>
    restartSimWithRelations(new Set(RELATION_FILTERS.map((relation) => relation.type)));
  const clearRelations = () => restartSimWithRelations(new Set());
  const clearSearch = () => setSearchTerm("");
  const clearHighlight = () => {
    setHighlighted(null);
    setPinnedTooltip(null);
  };
  const clearGraphRefinements = () => {
    setSearchTerm("");
    setHighlighted(null);
    setPinnedTooltip(null);
  };

  const canvasHeight = expanded ? 820 : 620;
  const domainNodeIds = new Set(data.nodes.map((node) => node.id));
  const relationCounts = new Map<string, number>();
  for (const edge of rawData.edges) {
    if (!domainNodeIds.has(edge.source) || !domainNodeIds.has(edge.target)) continue;
    relationCounts.set(edge.type, (relationCounts.get(edge.type) ?? 0) + 1);
  }

  const canvasNodes = nodes;
  const listedNodes = [...canvasNodes].sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    const degreeDelta = b.degree - a.degree;
    if (degreeDelta !== 0) return degreeDelta;
    return a.label.localeCompare(b.label, "pt-BR");
  });

  return (
    <>
    <div className="space-y-3">

      {/* ── Controls bar ── */}
      <div className="hidden flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button onClick={zoomIn} title="Zoom in"
            className="rounded border border-[var(--border)] p-1.5 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button onClick={zoomOut} title="Zoom out"
            className="rounded border border-[var(--border)] p-1.5 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button onClick={resetLayout} title="Reiniciar layout"
            className="rounded border border-[var(--border)] p-1.5 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setPaused((v) => !v)} title={paused ? "Retomar" : "Pausar"}
            className="rounded border border-[var(--border)] p-1.5 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors">
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
          <button onClick={() => setExpanded((v) => !v)} title={expanded ? "Recolher" : "Expandir"}
            className="rounded border border-[var(--border)] p-1.5 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors">
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          {highlighted && (
            <button onClick={() => setHighlighted(null)}
              className="ml-1 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
              Limpar seleção
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 text-[10px] text-[var(--muted)]">
          <span>
            {stable ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                Estável
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 inline-block animate-pulse" />
                Simulando…
              </span>
            )}
          </span>
          <span className="tabular-nums">
            {nodes.length}/{rawData.nodes.length} nós · {edges.length}/{rawData.edges.length} arestas · {Math.round(transform.scale * 100)}%
          </span>
        </div>
      </div>

      {/* ── Two-column layout: left = layers/sectors panel, right = canvas ── */}
      <div className="grid gap-3 lg:grid-cols-3">

      {/* ── Sidebar (1/3) ── */}
      <div className="space-y-3 lg:col-span-1">
        {/* Camadas */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
              Domínios
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={setAllActive}
                className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              >
                Tudo
              </button>
              <button
                onClick={clearActive}
                disabled={activeTypes.size === 0}
                className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:opacity-40"
              >
                <EyeOff className="h-3 w-3" />
                Limpar
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            {LEGEND.map(({ type, label }) => {
              const total = rawData.nodes.filter((n) => n.type === type).length;
              const visible = data.nodes.filter((n) => n.type === type).length;
              const isExcluded = type === "Document" && documentsExcluded;
              const isActive = activeTypes.has(type) && !isExcluded;
              const isAutoDoc = type === "Document" && !isActive && !isExcluded && data.autoDocIds.size > 0;
              const color = type === "Document" ? "#94a3b8" : NODE_COLORS[type].fill;

              const borderClass = isExcluded
                ? "border-red-500/30 bg-red-500/5 hover:border-red-400/50"
                : isActive
                  ? "border-blue-400/60 bg-blue-500/10"
                  : isAutoDoc
                    ? "border-amber-500/40 bg-amber-500/5 hover:border-amber-400/60"
                    : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--foreground-soft)]";

              const labelClass = isExcluded
                ? "text-red-400/80"
                : isActive
                  ? "text-blue-300"
                  : isAutoDoc
                    ? "text-amber-400"
                    : "text-[var(--foreground-soft)]";

              const sublabel = isExcluded
                ? "ocultos — sem nós de documento no canvas · clique p/ modo auto"
                : isActive
                  ? `${visible} ${visible === 1 ? "visivel" : "visiveis"} de ${total}`
                  : isAutoDoc
                    ? `${data.autoDocIds.size} relacionado${data.autoDocIds.size === 1 ? "" : "s"} visível${data.autoDocIds.size === 1 ? "" : "is"} · clique p/ ver todos`
                    : total === 0
                      ? "vazio"
                      : `${total} no grafo · clique p/ mostrar`;

              const buttonTitle = type === "Document"
                ? isExcluded
                  ? "Documentos ocultos — clique para modo automático (mostrar como contexto)"
                  : isActive
                    ? "Documentos ativos — clique para ocultar completamente"
                    : "Modo automático — clique para mostrar todos os documentos"
                : undefined;

              return (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  disabled={total === 0}
                  title={buttonTitle}
                  className={
                    "group relative flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed " +
                    borderClass
                  }
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{
                      backgroundColor: color,
                      opacity: isActive || isAutoDoc || total === 0 ? 1 : isExcluded ? 0.3 : 0.45,
                      boxShadow: isActive
                        ? `0 0 8px ${color}`
                        : isAutoDoc
                          ? "0 0 6px #f59e0b"
                          : "none",
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-[11px] font-bold uppercase tracking-wider ${labelClass}`}>
                      {label}
                    </p>
                    <p className="text-[10px] text-[var(--muted)] mt-0.5">{sublabel}</p>
                  </div>
                  {isActive && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.8)]" />
                  )}
                  {isAutoDoc && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]" />
                  )}
                  {isExcluded && (
                    <EyeOff className="h-3 w-3 shrink-0 text-red-400/70" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Setores (só quando Documentos está ativo) */}
        {/* Relações */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
              Relações
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={setAllRelations}
                className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
              >
                Tudo
              </button>
              <button
                onClick={clearRelations}
                disabled={activeRelationTypes.size === 0}
                className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
              >
                <EyeOff className="h-3 w-3" />
                Limpar
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            {RELATION_FILTERS.map(({ type, label, description }) => {
              const count = relationCounts.get(type) ?? 0;
              const isActive = activeRelationTypes.has(type);
              const color = EDGE_STROKE[type] ?? "#94a3b8";
              return (
                <label
                  key={type}
                  className={
                    "group flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-all " +
                    (count === 0
                      ? "cursor-not-allowed border-[var(--border)] bg-[var(--surface)] opacity-45"
                      : isActive
                        ? "cursor-pointer border-blue-400/60 bg-blue-500/10"
                        : "cursor-pointer border-[var(--border)] bg-[var(--surface)] hover:border-[var(--foreground-soft)]")
                  }
                >
                  <input
                    type="checkbox"
                    checked={isActive}
                    disabled={count === 0}
                    onChange={() => toggleRelationType(type)}
                    className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-1.5 w-5 shrink-0 rounded-full"
                        style={{ backgroundColor: color, opacity: isActive ? 1 : 0.5 }}
                      />
                      <p
                        className={
                          "truncate text-[11px] font-bold uppercase tracking-wider " +
                          (isActive ? "text-blue-300" : "text-[var(--foreground-soft)]")
                        }
                      >
                        {label}
                      </p>
                    </div>
                    <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                      {count} aresta{count === 1 ? "" : "s"} · {description}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {(activeTypes.has("Document") || data.autoDocIds.size > 0) && rawData.nodes.some((n) => n.type === "Document") && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
              Setores
            </p>
            <div className="space-y-1.5">
              {[...sectorColorMap.entries()].map(([sector, c]) => {
                const count = data.nodes.filter((n) => n.type === "Document" && n.sector === sector).length;
                if (count === 0) return null;
                const ofSector = new Set(
                  data.nodes.filter((n) => n.type === "Document" && n.sector === sector).map((n) => n.id),
                );
                const isFiltered =
                  highlighted &&
                  [...highlighted].every((id) => ofSector.has(id)) &&
                  highlighted.size === ofSector.size;
                return (
                  <button
                    key={sector}
                    onClick={() => {
                      setHighlighted((prev) => {
                        if (prev && [...prev].every((id) => ofSector.has(id)) && prev.size === ofSector.size)
                          return null;
                        return ofSector;
                      });
                    }}
                    className={
                      "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all " +
                      (isFiltered
                        ? "border-blue-400/60 bg-blue-500/10"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--foreground-soft)]")
                    }
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: c.fill, boxShadow: `0 0 6px ${c.fill}` }}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={
                          "text-[11px] font-bold uppercase tracking-wider " +
                          (isFiltered ? "text-blue-300" : "text-[var(--foreground-soft)]")
                        }
                      >
                        {sectorLabelMap.get(sector) ?? sector}
                      </p>
                      <p className="text-[10px] text-[var(--muted)] mt-0.5">
                        {count} documento{count === 1 ? "" : "s"} · clique p/ isolar
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Estatísticas resumidas */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
            Render atual
          </p>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] py-1.5">
              <p className="text-[9px] uppercase tracking-wider text-[var(--muted)]">nós</p>
              <p className="text-base font-bold tabular-nums text-[var(--foreground)]">
                {nodes.length}
                <span className="text-[10px] font-normal text-[var(--muted)]">/{rawData.nodes.length}</span>
              </p>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] py-1.5">
              <p className="text-[9px] uppercase tracking-wider text-[var(--muted)]">arestas</p>
              <p className="text-base font-bold tabular-nums text-[var(--foreground)]">
                {edges.length}
                <span className="text-[10px] font-normal text-[var(--muted)]">/{rawData.edges.length}</span>
              </p>
            </div>
          </div>
          {highlighted && (
            <button
              onClick={() => setHighlighted(null)}
              className="mt-2 w-full rounded border border-[var(--border)] py-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Limpar isolamento ({highlighted.size})
            </button>
          )}
        </div>
      </div>

      {/* ── Graph canvas (2/3) ── */}
      <div className="space-y-3 lg:col-span-2 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button onClick={zoomIn} title="Zoom in"
            className="rounded border border-[var(--border)] p-1.5 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button onClick={zoomOut} title="Zoom out"
            className="rounded border border-[var(--border)] p-1.5 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button onClick={resetLayout} title="Reiniciar layout"
            className="rounded border border-[var(--border)] p-1.5 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setPaused((v) => !v)} title={paused ? "Retomar" : "Pausar"}
            className="rounded border border-[var(--border)] p-1.5 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors">
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
          <button onClick={() => setExpanded((v) => !v)} title={expanded ? "Recolher" : "Expandir"}
            className="rounded border border-[var(--border)] p-1.5 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors">
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          {highlighted && (
            <button onClick={() => setHighlighted(null)}
              className="ml-1 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
              Limpar seleção
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 text-[10px] text-[var(--muted)]">
          <span>
            {stable ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                Estável
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 inline-block animate-pulse" />
                Simulando…
              </span>
            )}
          </span>
          <span className="tabular-nums">
            {nodes.length}/{rawData.nodes.length} nós · {edges.length}/{rawData.edges.length} arestas · {Math.round(transform.scale * 100)}%
          </span>
        </div>
      </div>
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[#0b1120] select-none"
        style={{ height: canvasHeight, cursor: isDragging ? "grabbing" : "grab" }}
        onMouseDown={handleBgMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg width={dims.w} height={dims.h} style={{ width: "100%", height: "100%" }}>
          <defs>
            {/* Grid pattern */}
            <pattern id="grid-pat" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#1e2d45" strokeWidth="0.5" />
            </pattern>
            {/* Glow for hovered/highlighted nodes */}
            <filter id="glow-filter" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            {/* Radial gradient for node fill depth */}
            {LEGEND.map(({ type }) => (
              <radialGradient key={type} id={`grad-${type}`} cx="35%" cy="30%" r="60%">
                <stop offset="0%" stopColor={NODE_COLORS[type].fill} stopOpacity="1" />
                <stop offset="100%" stopColor={NODE_COLORS[type].stroke} stopOpacity="1" />
              </radialGradient>
            ))}
            {/* Sector gradients for Document nodes */}
            {[...sectorColorMap.entries()].map(([sector, c]) => (
              <radialGradient key={`grad-sector-${sector}`} id={`grad-sector-${sector}`} cx="35%" cy="30%" r="60%">
                <stop offset="0%" stopColor={c.fill} stopOpacity="1" />
                <stop offset="100%" stopColor={c.stroke} stopOpacity="1" />
              </radialGradient>
            ))}
          </defs>

          {/* Background grid */}
          <rect width="100%" height="100%" fill="url(#grid-pat)" />

          <g transform={`translate(${transform.tx},${transform.ty}) scale(${transform.scale})`}>

            {/* ── Edges (entity links first, then doc-doc on top) ── */}
            {edges.filter((e) => e.type !== "SHARES_ENTITY").map((edge, i) => {
              const src = nodeMap.get(edge.source);
              const tgt = nodeMap.get(edge.target);
              if (!src || !tgt) return null;
              const isHit = highlightedEdgeSet
                ? highlightedEdgeSet.has(`${edge.source}|${edge.target}`)
                : true;
              const stroke = EDGE_STROKE[edge.type] ?? "#94a3b8";
              const isAssociation = isEntityAssociationEdge(edge);
              const opacity = highlighted ? (isHit ? 0.75 : 0.04) : 0.3;
              const sw = Math.min(
                (highlighted && isHit ? 2 : 1) + (isAssociation ? (edge.weight ?? 1) * 0.25 : 0),
                3,
              );
              const mx = (src.x + tgt.x) / 2;
              const my = (src.y + tgt.y) / 2 - 15;
              return (
                <path
                  key={`ee-${i}`}
                  d={`M${src.x},${src.y} Q${mx},${my} ${tgt.x},${tgt.y}`}
                  fill="none"
                  stroke={stroke}
                  strokeOpacity={opacity}
                  strokeWidth={sw}
                  strokeDasharray={isAssociation ? "2 4" : undefined}
                />
              );
            })}

            {/* ── Doc→Doc shared-entity edges (dashed, rendered above) ── */}
            {edges.filter((e) => e.type === "SHARES_ENTITY").map((edge, i) => {
              const src = nodeMap.get(edge.source);
              const tgt = nodeMap.get(edge.target);
              if (!src || !tgt) return null;
              const isHit = highlightedEdgeSet
                ? highlightedEdgeSet.has(`${edge.source}|${edge.target}`)
                : true;
              const opacity = highlighted ? (isHit ? 0.9 : 0.05) : 0.55;
              const w = Math.min(1 + (edge.weight ?? 1) * 0.5, 4);
              const mx = (src.x + tgt.x) / 2;
              const my = (src.y + tgt.y) / 2 + 20;
              return (
                <path
                  key={`dd-${i}`}
                  d={`M${src.x},${src.y} Q${mx},${my} ${tgt.x},${tgt.y}`}
                  fill="none"
                  stroke="#e2e8f0"
                  strokeOpacity={opacity}
                  strokeWidth={w}
                  strokeDasharray="4 3"
                />
              );
            })}

            {/* ── Nodes ── */}
            {nodes.map((node) => {
              const r = nodeRadius(node.degree, node.type);
              const colors = nodeColors(node, sectorColorMap);
              const gradId = (node.type === "Document" || node.type === "Sector") && node.sector && sectorColorMap.has(node.sector)
                ? `grad-sector-${node.sector}`
                : `grad-${node.type}`;
              const isHit = highlighted ? highlighted.has(node.id) : true;
              const opacity = highlighted ? (isHit ? 1 : 0.12) : 1;
              const isHovered = tooltip?.nodeId === node.id;
              const shortLabel = node.label.length > 18
                ? node.label.slice(0, 16) + "…"
                : node.label;

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x},${node.y})`}
                  opacity={opacity}
                  style={{ cursor: "pointer" }}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onClick={(e) => handleNodeClick(node.id, e)}
                  onMouseEnter={(e) => {
                    const rect = containerRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    setTooltip({ nodeId: node.id, px: e.clientX - rect.left, py: e.clientY - rect.top });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  {/* Outer glow ring for document nodes or hovered */}
                  {(node.type === "Document" || isHovered) && (
                    <circle
                      r={r + 5}
                      fill="none"
                      stroke={colors.fill}
                      strokeWidth={1.5}
                      strokeOpacity={0.4}
                      filter={isHovered ? "url(#glow-filter)" : undefined}
                    />
                  )}
                  {/* Highlight ring */}
                  {isHit && highlighted && (
                    <circle r={r + 3} fill="none" stroke="#ffffff" strokeWidth={1.5} strokeOpacity={0.25} />
                  )}
                  {/* Main node circle with gradient */}
                  <circle r={r} fill={`url(#${gradId})`} />
                  {/* Inner shine */}
                  <circle
                    r={r * 0.45}
                    cx={-r * 0.2}
                    cy={-r * 0.2}
                    fill="#ffffff"
                    fillOpacity={0.18}
                    style={{ pointerEvents: "none" }}
                  />
                  {/* Label */}
                  <text
                    y={r + 12}
                    textAnchor="middle"
                    fontSize={9}
                    fill="#94a3b8"
                    fontFamily="system-ui, sans-serif"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {shortLabel}
                  </text>
                  {/* Degree badge for hub nodes */}
                  {node.degree >= 3 && (
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={Math.min(r * 0.7, 10)}
                      fill="#ffffff"
                      fontWeight="bold"
                      fontFamily="system-ui, sans-serif"
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {node.degree}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* ── Tooltip ── */}
        {tooltip && (() => {
          const n = nodeMap.get(tooltip.nodeId);
          if (!n) return null;
          const colors = nodeColors(n, sectorColorMap);
          const entityLinks = edges
            .filter((e) => e.type !== "SHARES_ENTITY" && (e.source === n.id || e.target === n.id))
            .map((e) => {
              const otherId = e.source === n.id ? e.target : e.source;
              const other = nodeMap.get(otherId);
              if (!other) return "";
              const label = EDGE_LABELS[e.type] ?? e.type.toLowerCase();
              const suffix = isEntityAssociationEdge(e) ? ` (${e.weight ?? 1} doc)` : "";
              return `${label}: ${other.label}${suffix}`;
            })
            .filter(Boolean)
            .slice(0, 6);
          const docLinks = edges
            .filter((e) => e.type === "SHARES_ENTITY" && (e.source === n.id || e.target === n.id))
            .map((e) => {
              const otherId = e.source === n.id ? e.target : e.source;
              const other = nodeMap.get(otherId);
              return other ? `${other.label} (${e.weight ?? 1} em comum)` : "";
            })
            .filter(Boolean)
            .slice(0, 3);

          const left = tooltip.px + 14 > dims.w - 200 ? tooltip.px - 214 : tooltip.px + 14;
          const top  = tooltip.py - 20;

          return (
            <div
              className="pointer-events-none absolute z-20 min-w-[160px] max-w-[240px] rounded-lg border border-[#1e3a5f] bg-[#0f2040]/95 px-3 py-2.5 shadow-2xl backdrop-blur-sm"
              style={{ left, top }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colors.fill }} />
                <p className="text-[11px] font-bold text-white truncate">{n.label}</p>
              </div>
              <p className="text-[10px] text-[#94a3b8] mb-1.5">
                {n.type}{n.sector ? ` · ${sectorLabelMap.get(n.sector) ?? n.sector}` : ""} · {n.degree} conexã{n.degree === 1 ? "o" : "ões"}
              </p>
              {entityLinks.length > 0 && (
                <div className="border-t border-[#1e3a5f] pt-1.5 space-y-0.5">
                  {entityLinks.map((label) => (
                    <p key={label} className="text-[10px] text-[#64748b] truncate">↳ {label}</p>
                  ))}
                  {n.degree > entityLinks.length && docLinks.length === 0 && (
                    <p className="text-[10px] text-[#475569]">+{n.degree - entityLinks.length} mais…</p>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Pinned action card for Document nodes ── */}
        {pinnedTooltip && (() => {
          const n = nodeMap.get(pinnedTooltip.nodeId);
          if (!n) return null;
          const colors = nodeColors(n, sectorColorMap);
          const docLinks = getRelatedDocumentLinks(n, edges, nodeMap);

          const left = pinnedTooltip.px + 14 > dims.w - 300 ? pinnedTooltip.px - 314 : pinnedTooltip.px + 14;
          const top = Math.min(pinnedTooltip.py - 20, dims.h - 280);

          return (
            <div
              className="absolute z-30 w-[300px] rounded-lg border border-blue-400/40 bg-[#0f2040]/95 px-3 py-2.5 shadow-2xl backdrop-blur-md"
              style={{ left, top }}
              onMouseDown={(ev) => ev.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: colors.fill }}
                  />
                  <p className="text-[12px] font-bold text-white truncate">{n.label}</p>
                </div>
                <button
                  onClick={() => setPinnedTooltip(null)}
                  className="text-[#94a3b8] hover:text-white text-xs leading-none"
                  aria-label="Fechar"
                >
                  ×
                </button>
              </div>
              <p className="text-[10px] text-[#94a3b8] mb-2">
                {n.sector ? sectorLabelMap.get(n.sector) ?? n.sector : "—"} · {n.degree} conexão{n.degree === 1 ? "" : "es"}
              </p>

              {n.type === "Document" ? (
                <button
                  onClick={() => setDetailDocId(n.id)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-blue-400/50 bg-blue-500/15 px-3 py-1.5 text-[11px] font-medium text-blue-200 hover:bg-blue-500/25"
                >
                  <ExternalLink className="h-3 w-3" />
                  Abrir documento integral
                </button>
              ) : (
                <p className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-[10px] text-[var(--muted)]">
                  Clique em um documento relacionado abaixo para abrir a exibição integral.
                </p>
              )}
              <div className="mt-3 border-t border-[#1e3a5f] pt-2">
                <p className="text-[9px] uppercase tracking-wider text-[#64748b] mb-1.5">
                  Documentos relacionados
                </p>
                {docLinks.length === 0 ? (
                  <p className="text-[10px] text-[#94a3b8]">
                    Nenhum documento relacionado encontrado para este nó.
                  </p>
                ) : (
                  <ul className="space-y-1 max-h-40 overflow-y-auto">
                    {docLinks.map((doc) => (
                      <li key={doc.id}>
                        <button
                          onClick={() => setDetailDocId(doc.id)}
                          className="group flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10px] text-[#cbd5e1] hover:bg-blue-500/10 hover:text-blue-200"
                        >
                          <span className="truncate flex-1">↳ {doc.label}</span>
                          <span className="text-[9px] text-[#64748b] tabular-nums">
                            {doc.relationLabel} · {doc.weight}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── Legend ── */}
        <div className="absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border border-[#1e2d45] bg-[#0b1120]/90 px-3 py-2 backdrop-blur-sm">
          {/* Entity types */}
          {ENTITY_LEGEND.map(({ type, label }) => {
            const count = data.nodes.filter((n) => n.type === type).length;
            if (count === 0) return null;
            return (
              <div key={type} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: NODE_COLORS[type].fill }} />
                <span className="text-[10px] text-[#94a3b8]">{label}</span>
                <span className="ml-auto text-[10px] font-bold tabular-nums text-[#64748b]">{count}</span>
              </div>
            );
          })}
          {edges.some(isEntityAssociationEdge) && (
            <div className="flex items-center gap-2 mt-0.5">
              <svg width="16" height="6" className="flex-shrink-0">
                <line x1="0" y1="3" x2="16" y2="3" stroke={EDGE_STROKE.CO_MENTIONED} strokeWidth="1.5" strokeDasharray="2 3" strokeOpacity="0.8" />
              </svg>
              <span className="text-[10px] text-[#64748b]">Entidades associadas</span>
            </div>
          )}
          {/* Sector breakdown for Documents */}
          {data.nodes.some((n) => n.type === "Document") && (
            <>
              <div className="my-1 border-t border-[#1e2d45]" />
              {[...sectorColorMap.entries()].map(([sector, c]) => {
                const count = data.nodes.filter((n) => n.type === "Document" && n.sector === sector).length;
                if (count === 0) return null;
                return (
                  <div key={sector} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-sm flex-shrink-0" style={{ backgroundColor: c.fill }} />
                    <span className="text-[10px] text-[#94a3b8]">{sectorLabelMap.get(sector) ?? sector}</span>
                    <span className="ml-auto text-[10px] font-bold tabular-nums text-[#64748b]">{count}</span>
                  </div>
                );
              })}
              {/* Shared-entity edge legend entry */}
              <div className="flex items-center gap-2 mt-0.5">
                <svg width="16" height="6" className="flex-shrink-0">
                  <line x1="0" y1="3" x2="16" y2="3" stroke="#e2e8f0" strokeWidth="1.5" strokeDasharray="3 2" strokeOpacity="0.7" />
                </svg>
                <span className="text-[10px] text-[#64748b]">Docs relacionados</span>
              </div>
            </>
          )}
        </div>

        {/* ── Hint ── */}
        <div className="absolute bottom-3 right-3 rounded border border-[#1e2d45] bg-[#0b1120]/80 px-2 py-1 text-[9px] text-[#475569]">
          scroll = zoom · drag = pan · clique = isolar vizinhos · clique em documento = abrir
        </div>

        {/* ── Empty selection overlay ── */}
        {activeTypes.size === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto max-w-md rounded-xl border border-[#1e3a5f] bg-[#0f2040]/85 px-6 py-5 text-center backdrop-blur-md">
              <Layers className="mx-auto h-7 w-7 text-blue-400" />
              <p className="mt-2 text-sm font-semibold text-white">
                Visualização vazia por escolha
              </p>
              <p className="mt-1 text-[11px] text-[#94a3b8]">
                Selecione abaixo as camadas que quer ver. Comece por <strong>Documentos</strong> e
                vá adicionando <strong>Conceitos</strong>, <strong>Procedimentos</strong>, etc.
                Quanto menos camadas, mais leve a navegação.
              </p>
              <button
                onClick={setAllActive}
                className="mt-3 rounded-md border border-blue-400/50 bg-blue-500/15 px-3 py-1 text-[11px] font-medium text-blue-300 hover:bg-blue-500/25"
              >
                Mostrar tudo (pode ficar pesado)
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
              Itens visíveis no canvas
            </p>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              {canvasNodes.length} nó{canvasNodes.length === 1 ? "" : "s"} no canvas atual
              {searchTerm.trim() ? ` após filtrar por "${searchTerm.trim()}"` : " com os filtros ativos"}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {searchTerm.trim() && (
              <button
                onClick={clearSearch}
                className="rounded border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              >
                Limpar busca
              </button>
            )}
            {highlighted && (
              <button
                onClick={clearHighlight}
                className="rounded border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              >
                Limpar seleção
              </button>
            )}
            {(searchTerm.trim() || highlighted || pinnedTooltip) && (
              <button
                onClick={clearGraphRefinements}
                className="rounded border border-blue-400/50 bg-blue-500/15 px-2.5 py-1 text-[10px] font-medium text-blue-200 hover:bg-blue-500/25 transition-colors"
              >
                Limpar tudo
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1.4fr)_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar por label, tipo, setor ou grau"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] py-2 pl-8 pr-3 text-[12px] text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-blue-400/70"
            />
          </label>
          <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--muted)]">
            <span>
              {listedNodes.length} visível{listedNodes.length === 1 ? "" : "eis"} nesta lista
            </span>
            <span className="tabular-nums">
              {highlighted ? `${highlighted.size} destacado${highlighted.size === 1 ? "" : "s"}` : "sem destaque"}
            </span>
          </div>
        </div>

        <div className="mt-3 max-h-80 overflow-y-auto pr-1">
          {listedNodes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center">
              <p className="text-[11px] text-[var(--muted)]">
                Nenhum item encontrado para a busca atual.
              </p>
              {searchTerm.trim() && (
                <button
                  onClick={clearSearch}
                  className="mt-3 rounded border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                >
                  Limpar termo
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {listedNodes.map((node) => {
                const colors = nodeColors(node, sectorColorMap);
                const isActive = highlighted?.has(node.id) ?? false;
                return (
                  <button
                    key={node.id}
                    onClick={() => handleListNodeClick(node.id)}
                    className={
                      "flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors " +
                      (isActive
                        ? "border-blue-400/60 bg-blue-500/10"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--foreground-soft)]")
                    }
                  >
                    <span
                      className="mt-0.5 h-3 w-3 shrink-0 rounded-full"
                      style={{
                        backgroundColor: colors.fill,
                        boxShadow: isActive ? `0 0 8px ${colors.fill}` : "none",
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-[12px] font-medium text-[var(--foreground)]">
                          {node.label}
                        </p>
                        {isActive && (
                          <span className="rounded-full border border-blue-400/40 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#111814]">
                            destacado
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-medium text-[#18211f]">
                          {node.type}
                        </span>
                        {node.sector && (
                          <span className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-medium text-[#18211f]">
                            {sectorLabelMap.get(node.sector) ?? node.sector}
                          </span>
                        )}
                        <span className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-medium text-[#18211f]">
                          grau {node.degree}
                        </span>
                      </div>
                    </div>
                    {node.type === "Document" && (
                      <span className="mt-0.5 shrink-0 rounded border border-blue-400/40 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-medium text-[#13201f]">
                        destacar no grafo
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
    </div>

      {detailDocId && (
        <DocumentDetailModal
          documentId={detailDocId}
          onClose={() => setDetailDocId(null)}
        />
      )}
    </>
  );
}

