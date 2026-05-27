"use client";

import {
  AlertCircle,
  BookOpen,
  Briefcase,
  ChevronRight,
  CircleDot,
  Compass,
  FileText,
  GitMerge,
  Loader2,
  MessageCircle,
  Network,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConceptDoc = { id: string; title: string; sector: string };

type KnowledgeDomain = "document" | "concept" | "procedure" | "system" | "process";

type ConceptNode = {
  id: string;
  domain: KnowledgeDomain;
  name: string;
  docCount: number;
  sectors: string[];
  documents: ConceptDoc[];
  related: string[];
};

type ListResponse = {
  connected: boolean;
  domain?: KnowledgeDomain;
  domainLabel?: string;
  minConnections?: number;
  items?: ConceptNode[];
  concepts?: ConceptNode[];
};

type DocTypeId =
  | "executive_briefing"
  | "operational_playbook"
  | "onboarding_primer"
  | "risk_compliance";

type DocTypeOption = {
  id: DocTypeId;
  label: string;
  blurb: string;
  audience: string;
  icon: React.ElementType;
  accent: string;
};

type DomainOption = {
  id: KnowledgeDomain;
  label: string;
  description: string;
  itemLabel: string;
  emptyLabel: string;
  icon: React.ElementType;
  borderClass: string;
  panelClass: string;
  activePanelClass: string;
  textClass: string;
  badgeClass: string;
  inactiveBadgeClass: string;
  dotClass: string;
};

const DOMAIN_OPTIONS: DomainOption[] = [
  {
    id: "document",
    label: "Documentos",
    description: "Documentos do grafo e suas entidades compartilhadas.",
    itemLabel: "documento",
    emptyLabel: "documento",
    icon: FileText,
    borderClass: "border-amber-400/60",
    panelClass: "border-amber-400/20 bg-amber-500/[0.035]",
    activePanelClass: "border-amber-400/40 bg-amber-500/[0.07]",
    textClass: "text-amber-700",
    badgeClass: "border-amber-400/70 bg-amber-100/70 text-amber-800",
    inactiveBadgeClass: "border-amber-300/60 bg-[var(--surface)] text-amber-700",
    dotClass: "bg-amber-400",
  },
  {
    id: "concept",
    label: "Conceitos",
    description: "Termos tecnicos com maior conexao entre documentos.",
    itemLabel: "conceito",
    emptyLabel: "conceito",
    icon: CircleDot,
    borderClass: "border-blue-400/60",
    panelClass: "border-blue-400/20 bg-blue-500/[0.035]",
    activePanelClass: "border-blue-400/40 bg-blue-500/[0.07]",
    textClass: "text-blue-700",
    badgeClass: "border-blue-400/70 bg-blue-100/70 text-blue-800",
    inactiveBadgeClass: "border-blue-300/60 bg-[var(--surface)] text-blue-700",
    dotClass: "bg-blue-400",
  },
  {
    id: "procedure",
    label: "Procedimentos",
    description: "Processos operacionais descritos na base.",
    itemLabel: "procedimento",
    emptyLabel: "procedimento",
    icon: GitMerge,
    borderClass: "border-violet-400/60",
    panelClass: "border-violet-400/20 bg-violet-500/[0.035]",
    activePanelClass: "border-violet-400/40 bg-violet-500/[0.07]",
    textClass: "text-violet-700",
    badgeClass: "border-violet-400/70 bg-violet-100/70 text-violet-800",
    inactiveBadgeClass: "border-violet-300/60 bg-[var(--surface)] text-violet-700",
    dotClass: "bg-violet-400",
  },
  {
    id: "system",
    label: "Sistemas",
    description: "Ferramentas, plataformas e sistemas referenciados.",
    itemLabel: "sistema",
    emptyLabel: "sistema",
    icon: Wrench,
    borderClass: "border-teal-400/60",
    panelClass: "border-teal-400/20 bg-teal-500/[0.035]",
    activePanelClass: "border-teal-400/40 bg-teal-500/[0.07]",
    textClass: "text-teal-700",
    badgeClass: "border-teal-400/70 bg-teal-100/70 text-teal-800",
    inactiveBadgeClass: "border-teal-300/60 bg-[var(--surface)] text-teal-700",
    dotClass: "bg-teal-400",
  },
  {
    id: "process",
    label: "Processos",
    description: "Processos consolidados, com documentos e sistemas que os apoiam.",
    itemLabel: "processo",
    emptyLabel: "processo",
    icon: Network,
    borderClass: "border-cyan-400/60",
    panelClass: "border-cyan-400/20 bg-cyan-500/[0.035]",
    activePanelClass: "border-cyan-400/40 bg-cyan-500/[0.07]",
    textClass: "text-cyan-700",
    badgeClass: "border-cyan-400/70 bg-cyan-100/70 text-cyan-800",
    inactiveBadgeClass: "border-cyan-300/60 bg-[var(--surface)] text-cyan-700",
    dotClass: "bg-cyan-400",
  },
];

const DOMAIN_META = Object.fromEntries(
  DOMAIN_OPTIONS.map((option) => [option.id, option]),
) as Record<KnowledgeDomain, DomainOption>;

const DOC_TYPES: DocTypeOption[] = [
  {
    id: "executive_briefing",
    label: "Briefing Executivo",
    blurb: "Síntese estratégica em uma página, com decisões em aberto e próximos passos.",
    audience: "Diretoria / C-level",
    icon: Briefcase,
    accent: "from-amber-500/30 via-amber-400/10 to-transparent",
  },
  {
    id: "operational_playbook",
    label: "Mapa Operacional",
    blurb: "Playbook do conceito: papéis, fluxo, sistemas envolvidos e indicadores.",
    audience: "Gestores e líderes de área",
    icon: GitMerge,
    accent: "from-teal-500/30 via-teal-400/10 to-transparent",
  },
  {
    id: "onboarding_primer",
    label: "Primer de Onboarding",
    blurb: "Explicação simples para um novo colaborador entender em 5 minutos.",
    audience: "Novos colaboradores",
    icon: Compass,
    accent: "from-blue-500/30 via-blue-400/10 to-transparent",
  },
  {
    id: "risk_compliance",
    label: "Riscos & Compliance",
    blurb: "Mapa de riscos, controles, normas e lacunas de cobertura.",
    audience: "Compliance / Auditoria",
    icon: ShieldCheck,
    accent: "from-rose-500/30 via-rose-400/10 to-transparent",
  },
];

// ─── Mermaid diagram renderer ─────────────────────────────────────────────────

type Segment = { type: "md"; text: string } | { type: "mermaid"; src: string };

function splitSegments(md: string): Segment[] {
  const segments: Segment[] = [];
  const regex = /```mermaid\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(md)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "md", text: md.slice(lastIndex, match.index) });
    }
    segments.push({ type: "mermaid", src: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < md.length) {
    segments.push({ type: "md", text: md.slice(lastIndex) });
  }
  return segments;
}

// Mermaid is loaded from CDN at runtime (browser-only) to avoid bundling ~2 MB
// and to work regardless of whether the npm package is installed in the container.
interface MermaidAPI {
  initialize: (cfg: Record<string, unknown>) => void;
  render: (id: string, src: string) => Promise<{ svg: string }>;
}

declare global {
  interface Window {
    mermaid?: MermaidAPI;
  }
}

let mermaidBootstrap: Promise<MermaidAPI> | null = null;

function getMermaid(): Promise<MermaidAPI> {
  if (mermaidBootstrap) return mermaidBootstrap;
  mermaidBootstrap = new Promise<MermaidAPI>((resolve, reject) => {
    if (window.mermaid) {
      resolve(window.mermaid);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
    script.onload = () => {
      if (window.mermaid) resolve(window.mermaid);
      else reject(new Error("mermaid not on window after load"));
    };
    script.onerror = () => {
      mermaidBootstrap = null;
      reject(new Error("Failed to load mermaid from CDN"));
    };
    document.head.appendChild(script);
  });
  return mermaidBootstrap;
}

let mermaidCounter = 0;

function MermaidDiagram({ src, streaming }: { src: string; streaming: boolean }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const id = useRef(`mermaid-${++mermaidCounter}`);

  useEffect(() => {
    if (streaming) return;
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = await getMermaid();
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          fontFamily: "inherit",
          fontSize: 13,
        });
        const { svg: rendered } = await mermaid.render(id.current, src);
        if (!cancelled) setSvg(rendered);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, streaming]);

  if (streaming) {
    return (
      <div className="my-3 flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-4 py-3 text-[11px] text-[var(--muted)]">
        <Loader2 className="h-3 w-3 animate-spin" /> diagrama será renderizado após a geração…
      </div>
    );
  }
  if (failed) return null;
  if (!svg) {
    return (
      <div className="my-3 h-24 animate-pulse rounded-lg bg-[var(--surface)]" />
    );
  }
  return (
    <div
      className="mermaid-diagram my-4 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function MarkdownWithMermaid({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const segments = useMemo(() => splitSegments(text), [text]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "md" ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.text) }} />
        ) : (
          <MermaidDiagram key={i} src={seg.src} streaming={streaming} />
        ),
      )}
    </>
  );
}

// ─── Tiny streaming markdown renderer (safe, no deps) ────────────────────────

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(line: string) {
  let out = escapeHtml(line);
  out = out.replace(/`([^`]+)`/g, '<code class="rounded bg-[var(--surface)] px-1 py-0.5 text-[12px]">$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-[var(--foreground)]">$1</strong>');
  out = out.replace(/(^|\s)\*([^*\s][^*]*[^*\s]|[^*\s])\*(?=\s|$)/g, '$1<em>$2</em>');
  return out;
}

function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }

    // Heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const sizes = ["text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-sm"];
      blocks.push(
        `<h${level} class="${sizes[level - 1]} font-semibold tracking-tight text-[var(--foreground)] mt-5 mb-2">${renderInline(h[2])}</h${level}>`,
      );
      i += 1;
      continue;
    }

    // Table (simple GFM)
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1])) {
      const header = line.trim().slice(1, -1).split("|").map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
        rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim()));
        i += 1;
      }
      const thead = `<thead><tr>${header
        .map((c) => `<th class="border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">${renderInline(c)}</th>`)
        .join("")}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map(
          (r) =>
            `<tr>${r
              .map(
                (c) =>
                  `<td class="border border-[var(--border)] px-2 py-1 text-[12px] text-[var(--foreground-soft)] align-top">${renderInline(c)}</td>`,
              )
              .join("")}</tr>`,
        )
        .join("")}</tbody>`;
      blocks.push(
        `<div class="my-3 overflow-x-auto"><table class="w-full border-collapse text-[12px]">${thead}${tbody}</table></div>`,
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        `<ol class="my-2 ml-5 list-decimal space-y-1 text-[13px] text-[var(--foreground-soft)]">${items
          .map((it) => `<li>${renderInline(it)}</li>`)
          .join("")}</ol>`,
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(
        `<ul class="my-2 ml-5 list-disc space-y-1 text-[13px] text-[var(--foreground-soft)]">${items
          .map((it) => `<li>${renderInline(it)}</li>`)
          .join("")}</ul>`,
      );
      continue;
    }

    // Paragraph
    const paragraph: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s|^\s*[-*]\s|^\s*\d+\.\s|^\s*\|/.test(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push(
      `<p class="my-2 text-[13px] leading-relaxed text-[var(--foreground-soft)]">${renderInline(paragraph.join(" "))}</p>`,
    );
  }
  return blocks.join("");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sectorMix(sectors: string[]) {
  const counts = new Map<string, number>();
  for (const s of sectors) counts.set(s, (counts.get(s) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

function intensityFromCount(count: number) {
  // Visual intensity: more connections → stronger glow
  if (count >= 8) return "shadow-[0_0_36px_-8px_rgba(56,189,248,0.55)]";
  if (count >= 5) return "shadow-[0_0_24px_-10px_rgba(56,189,248,0.45)]";
  return "shadow-none";
}

// ─── Concept card ─────────────────────────────────────────────────────────────

function ConceptCard({
  concept,
  onSelect,
}: {
  concept: ConceptNode;
  onSelect: (c: ConceptNode) => void;
}) {
  const mix = sectorMix(concept.sectors);
  const domainMeta = DOMAIN_META[concept.domain];
  const DomainIcon = domainMeta.icon;
  return (
    <button
      onClick={() => onSelect(concept)}
      className={`group relative overflow-hidden rounded-xl border bg-gradient-to-br from-[var(--surface-raised)] to-[var(--surface)] px-5 py-4 text-left transition-all hover:-translate-y-0.5 ${domainMeta.borderClass} ${intensityFromCount(concept.docCount)}`}
    >
      <div className={`absolute inset-x-0 top-0 h-1 ${domainMeta.dotClass}`} />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <DomainIcon className={`h-3.5 w-3.5 ${domainMeta.textClass}`} />
            <p className="truncate text-[15px] font-semibold text-[var(--foreground)]">
              {concept.name}
            </p>
          </div>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            {concept.docCount} documentos conectados · {mix.length} setor{mix.length !== 1 ? "es" : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums ${domainMeta.badgeClass}`}>
            {domainMeta.itemLabel}
          </div>
          <ChevronRight className={`h-4 w-4 text-[var(--muted)] transition-transform group-hover:translate-x-1 ${domainMeta.textClass}`} />
        </div>
      </div>

      <div className="relative mt-3 flex flex-wrap gap-1.5">
        {mix.slice(0, 4).map(([s, n]) => (
          <span
            key={s}
            className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${domainMeta.dotClass}`} />
            {s} · {n}
          </span>
        ))}
      </div>

      {concept.related.length > 0 && (
        <p className="relative mt-2 truncate text-[10px] text-[var(--muted)]">
          <span className="font-semibold uppercase tracking-widest">vizinhos:</span>{" "}
          {concept.related.slice(0, 4).join(" · ")}
        </p>
      )}
    </button>
  );
}

// ─── Generation modal ─────────────────────────────────────────────────────────

type GenState =
  | { phase: "choose" }
  | { phase: "streaming"; docType: DocTypeId; text: string; meta?: GenMeta }
  | { phase: "done"; docType: DocTypeId; text: string; meta?: GenMeta }
  | { phase: "error"; docType: DocTypeId; message: string };

type GenMeta = {
  concept: string;
  itemName?: string;
  itemDomain?: KnowledgeDomain;
  itemDomainLabel?: string;
  docTypeLabel: string;
  documentsUsed: { id: string; title: string; sector: string }[];
  documentsRequested: number;
  related: string[];
  suggestedQuestions?: string[];
};

function GenerationModal({
  concept,
  onClose,
}: {
  concept: ConceptNode;
  onClose: () => void;
}) {
  const [state, setState] = useState<GenState>({ phase: "choose" });
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const domainMeta = DOMAIN_META[concept.domain];

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // Se o usuário subir mais de 50px do fundo, desabilita o auto-scroll
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      if (autoScrollEnabled !== isAtBottom) {
        setAutoScrollEnabled(isAtBottom);
      }
    }
  };

  useEffect(() => {
    if (state.phase === "streaming" && scrollRef.current && autoScrollEnabled) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state, autoScrollEnabled]);

  const start = useCallback(
    async (docType: DocTypeId) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ phase: "streaming", docType, text: "" });
      setAutoScrollEnabled(true);

      try {
        const res = await fetch("/api/graph/living-docs/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            concept: concept.name,
            itemId: concept.id,
            itemName: concept.name,
            itemDomain: concept.domain,
            docType,
            documents: concept.documents,
            related: concept.related,
          }),
        });

        if (!res.ok || !res.body) {
          const err = await res.text().catch(() => "Erro ao iniciar geração");
          setState({ phase: "error", docType, message: err });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let acc = "";
        let meta: GenMeta | undefined;
        let pendingQuestions: string[] | undefined;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sep = buffer.indexOf("\n\n");
          while (sep >= 0) {
            const block = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            sep = buffer.indexOf("\n\n");

            const lines = block.split("\n");
            let event = "message";
            let data = "";
            for (const ln of lines) {
              if (ln.startsWith("event:")) event = ln.slice(6).trim();
              else if (ln.startsWith("data:")) data += ln.slice(5).trim();
            }
            if (!data) continue;
            try {
              const payload = JSON.parse(data);
              if (event === "meta") {
                meta = { ...(payload as GenMeta), suggestedQuestions: pendingQuestions };
                setState({ phase: "streaming", docType, text: acc, meta });
              } else if (event === "chunk") {
                acc += String(payload.text ?? "");
                setState({ phase: "streaming", docType, text: acc, meta });
              } else if (event === "questions") {
                const qs = (payload as { questions: string[] }).questions;
                if (Array.isArray(qs) && qs.length > 0) {
                  pendingQuestions = qs;
                  meta = meta ? { ...meta, suggestedQuestions: qs } : meta;
                  setState({ phase: "streaming", docType, text: acc, meta });
                }
              } else if (event === "error") {
                setState({ phase: "error", docType, message: String(payload.message ?? "Erro") });
                return;
              } else if (event === "done") {
                setState({ phase: "done", docType, text: acc, meta });
                return;
              }
            } catch {
              // ignore malformed event
            }
          }
        }

        setState({ phase: "done", docType, text: acc, meta });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState({
          phase: "error",
          docType,
          message: err instanceof Error ? err.message : "Falha desconhecida",
        });
      }
    },
    [concept],
  );

  const handleCopy = useCallback(() => {
    if (state.phase === "done" || state.phase === "streaming") {
      void navigator.clipboard.writeText(state.text);
    }
  }, [state]);

  const currentDocType = useMemo(
    () =>
      state.phase === "streaming" || state.phase === "done" || state.phase === "error"
        ? DOC_TYPES.find((d) => d.id === state.docType)
        : null,
    [state],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        {/* Header */}
        <div className="relative shrink-0 overflow-hidden border-b border-[var(--border)] px-6 py-5">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/15 via-transparent to-teal-500/10" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.24em] text-blue-300">
                <Sparkles className="h-3 w-3" />
                Documentação viva
              </div>
              <h2 className="mt-1 truncate text-xl font-semibold text-[var(--foreground)]">
                {concept.name}
              </h2>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                {domainMeta.itemLabel} · {concept.docCount} documentos · setores{" "}
                {Array.from(new Set(concept.sectors)).join(" · ") || "—"}
                {concept.related.length > 0 && (
                  <>
                    <span className="mx-2 text-[var(--border)]">|</span>
                    vizinhos: {concept.related.slice(0, 4).join(" · ")}
                  </>
                )}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-1.5 text-[var(--muted)] hover:text-[var(--foreground)]"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-5">
          {state.phase === "choose" && (
            <ChoosePanel concept={concept} onPick={start} />
          )}

          {(state.phase === "streaming" || state.phase === "done") && (
            <ResultPanel
              concept={concept}
              text={state.text}
              streaming={state.phase === "streaming"}
              meta={state.meta}
              docType={currentDocType ?? undefined}
            />
          )}

          {state.phase === "error" && (
            <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-300">Geração falhou</p>
                <p className="mt-1 text-[11px] text-red-400/80">{state.message}</p>
                <button
                  onClick={() => setState({ phase: "choose" })}
                  className="mt-3 rounded-md border border-red-400/40 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/20"
                >
                  Tentar outro tipo
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {(state.phase === "done" || state.phase === "streaming") && (
          <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface-raised)] px-6 py-3">
            <p className="text-[10px] text-[var(--muted)]">
              {state.phase === "streaming"
                ? "Gerando a partir das inferências do modelo + grafo de conhecimento…"
                : "Gerado dinamicamente. Não persistido. Re-gere quando quiser."}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                Copiar markdown
              </button>
              {state.phase === "done" && (
                <button
                  onClick={() => setState({ phase: "choose" })}
                  className="rounded-md border border-blue-400/40 bg-blue-500/10 px-3 py-1 text-[11px] font-medium text-blue-300 hover:bg-blue-500/20"
                >
                  Gerar outro tipo
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChoosePanel({
  concept,
  onPick,
}: {
  concept: ConceptNode;
  onPick: (id: DocTypeId) => void;
}) {
  const domainMeta = DOMAIN_META[concept.domain];
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
          Como voce quer enxergar este {domainMeta.itemLabel}?
        </p>
        <p className="mt-1 text-[12px] text-[var(--foreground-soft)]">
          O modelo cruza os <strong>{concept.documents.length}</strong> documentos conectados a{" "}
          <strong>{concept.name}</strong> no grafo e produz uma documentacao inedita,
          adaptada ao publico que voce escolher abaixo.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {DOC_TYPES.map((opt) => {
          const Icon = opt.icon;
          return (
            <button
              key={opt.id}
              onClick={() => onPick(opt.id)}
              className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-blue-400/60"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${opt.accent} opacity-60 transition-opacity group-hover:opacity-100`} />
              <div className="relative">
                <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--foreground-soft)]">
                  <Icon className="h-3 w-3" />
                  {opt.audience}
                </div>
                <p className="text-[14px] font-semibold text-[var(--foreground)]">
                  {opt.label}
                </p>
                <p className="mt-1 text-[11px] text-[var(--muted)]">{opt.blurb}</p>
                <div className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-blue-300">
                  Iniciar geração <ChevronRight className="h-3 w-3" />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
          Documentos-fonte que serão cruzados
        </p>
        <ul className="space-y-1.5">
          {concept.documents.slice(0, 6).map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-2 text-[11px] text-[var(--foreground-soft)]"
            >
              <FileText className="h-3 w-3 shrink-0 text-[var(--muted)]" />
              <span className="truncate">{d.title}</span>
              <span className="shrink-0 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0 text-[9px] uppercase tracking-widest text-[var(--muted)]">
                {d.sector}
              </span>
            </li>
          ))}
          {concept.documents.length > 6 && (
            <li className="text-[10px] text-[var(--muted)]">
              … e mais {concept.documents.length - 6} documento(s)
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function ResultPanel({
  concept,
  text,
  streaming,
  meta,
  docType,
}: {
  concept: ConceptNode;
  text: string;
  streaming: boolean;
  meta?: GenMeta;
  docType?: DocTypeOption;
}) {
  return (
    <div className="space-y-4">
      {/* Pipeline stripe */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-[10px] uppercase tracking-widest text-[var(--muted)]">
        <span className="inline-flex items-center gap-1 text-blue-300">
          <Network className="h-3 w-3" /> grafo
        </span>
        <span className="text-[var(--border)]">→</span>
        <span className="inline-flex items-center gap-1">
          <FileText className="h-3 w-3" /> {meta?.documentsUsed.length ?? "…"} documentos extraídos
        </span>
        <span className="text-[var(--border)]">→</span>
        <span className="inline-flex items-center gap-1">
          <BookOpen className="h-3 w-3" /> {docType?.label ?? "documento"}
        </span>
        {streaming && (
          <span className="ml-auto inline-flex items-center gap-1 text-blue-300">
            <Loader2 className="h-3 w-3 animate-spin" /> sintetizando…
          </span>
        )}
      </div>

      {/* Markdown */}
      <article className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-6 py-5">
        {text.length === 0 && streaming ? (
          <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Lendo grafo, baixando trechos e instruindo o modelo…
          </div>
        ) : (
          <div className="living-doc-prose">
            <MarkdownWithMermaid text={text} streaming={streaming} />
            {streaming && (
              <span className="ml-1 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-blue-400" />
            )}
          </div>
        )}
      </article>

      {/* Follow-up chat: only after generation finished */}
      {!streaming && text.trim().length > 0 && (
        <FollowUpChat
          concept={concept}
          generatedDocument={text}
          docTypeLabel={docType?.label}
          suggestedQuestions={meta?.suggestedQuestions}
        />
      )}

      {/* Sources */}
      {meta && meta.documentsUsed.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
            Fontes utilizadas pelo modelo
          </p>
          <ul className="space-y-1">
            {meta.documentsUsed.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-[11px] text-[var(--foreground-soft)]">
                <FileText className="h-3 w-3 shrink-0 text-[var(--muted)]" />
                <span className="truncate">{d.title}</span>
                <span className="shrink-0 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0 text-[9px] uppercase tracking-widest text-[var(--muted)]">
                  {d.sector}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Follow-up chat ───────────────────────────────────────────────────────────

type ChatMsg = { role: "user" | "assistant"; content: string };
type ChatPhase = "idle" | "streaming" | "error";

const FALLBACK_QUESTIONS = [
  "Quais riscos críticos esse documento não cobre?",
  "Como esse conceito se conecta com os vizinhos do grafo?",
  "Quem precisaria aprovar mudanças aqui?",
  "Resuma em 3 bullets para liderança.",
];

function FollowUpChat({
  concept,
  generatedDocument,
  docTypeLabel,
  suggestedQuestions,
}: {
  concept: ConceptNode;
  generatedDocument: string;
  docTypeLabel?: string;
  suggestedQuestions?: string[];
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [phase, setPhase] = useState<ChatPhase>("idle");
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const domainMeta = DOMAIN_META[concept.domain];

  const handleScroll = () => {
    if (listRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = listRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      if (autoScrollEnabled !== isAtBottom) {
        setAutoScrollEnabled(isAtBottom);
      }
    }
  };

  useEffect(() => {
    if (listRef.current && autoScrollEnabled) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, phase, autoScrollEnabled]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || phase === "streaming") return;

      setError(null);
      setInput("");
      const next: ChatMsg[] = [
        ...messages,
        { role: "user", content: trimmed },
        { role: "assistant", content: "" },
      ];
      setMessages(next);
      setPhase("streaming");
      setAutoScrollEnabled(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/graph/living-docs/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            concept: concept.name,
            itemId: concept.id,
            itemName: concept.name,
            itemDomain: concept.domain,
            docTypeLabel,
            generatedDocument,
            documents: concept.documents,
            history: messages,
            question: trimmed,
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error(await res.text().catch(() => "Erro ao consultar"));
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let acc = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sep = buffer.indexOf("\n\n");
          while (sep >= 0) {
            const block = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            sep = buffer.indexOf("\n\n");

            const lines = block.split("\n");
            let event = "message";
            let data = "";
            for (const ln of lines) {
              if (ln.startsWith("event:")) event = ln.slice(6).trim();
              else if (ln.startsWith("data:")) data += ln.slice(5).trim();
            }
            if (!data) continue;
            try {
              const payload = JSON.parse(data);
              if (event === "chunk") {
                acc += String(payload.text ?? "");
                setMessages((prev) => {
                  const copy = [...prev];
                  copy[copy.length - 1] = { role: "assistant", content: acc };
                  return copy;
                });
              } else if (event === "error") {
                throw new Error(String(payload.message ?? "Erro do modelo"));
              } else if (event === "done") {
                setPhase("idle");
                return;
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message) {
                throw parseErr;
              }
            }
          }
        }
        setPhase("idle");
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Falha desconhecida");
        setPhase("error");
        setMessages((prev) => prev.slice(0, -1));
      }
    },
    [concept, docTypeLabel, generatedDocument, messages, phase],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void ask(input);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-blue-400/30 bg-gradient-to-br from-blue-500/5 via-[var(--surface-raised)] to-teal-500/5">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500/15">
            <MessageCircle className="h-3.5 w-3.5 text-blue-300" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">
              Pergunte sobre o documento
            </p>
            <p className="text-[10px] text-[var(--muted)]">
              Usa o documento gerado, os {concept.documents.length} arquivos-fonte e a vizinhanca do {domainMeta.itemLabel} no grafo.
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      {messages.length > 0 && (
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="max-h-80 space-y-3 overflow-y-auto px-4 py-3"
        >
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={
                m.role === "user"
                  ? "flex justify-end"
                  : "flex justify-start"
              }
            >
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl rounded-tr-sm bg-blue-500/15 px-3 py-2 text-[12px] text-[var(--foreground)]"
                    : "max-w-[90%] rounded-2xl rounded-tl-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--foreground-soft)]"
                }
              >
                {m.role === "assistant" ? (
                  <div className="living-doc-prose">
                    <MarkdownWithMermaid
                      text={m.content || "…"}
                      streaming={phase === "streaming" && idx === messages.length - 1}
                    />
                    {phase === "streaming" && idx === messages.length - 1 && (
                      <span className="ml-1 inline-block h-3 w-1 translate-y-0.5 animate-pulse bg-blue-400" />
                    )}
                  </div>
                ) : (
                  <span className="whitespace-pre-wrap">{m.content}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Suggestions */}
      {messages.length === 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {(suggestedQuestions ?? FALLBACK_QUESTIONS).map((q) => (
            <button
              key={q}
              onClick={() => void ask(q)}
              disabled={phase === "streaming"}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[11px] text-[var(--foreground-soft)] hover:border-blue-400/60 hover:text-blue-300 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="mx-4 mb-2 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-3 py-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            phase === "streaming"
              ? "Aguardando resposta…"
              : `Pergunte algo sobre este documento ou ${domainMeta.itemLabel}...`
          }
          disabled={phase === "streaming"}
          className="flex-1 bg-transparent px-2 py-1 text-[12px] text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={phase === "streaming" || !input.trim()}
          className="flex items-center gap-1 rounded-md border border-blue-400/40 bg-blue-500/10 px-3 py-1.5 text-[11px] font-medium text-blue-300 hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {phase === "streaming" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Send className="h-3 w-3" />
          )}
          Enviar
        </button>
      </form>
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function LivingDocsTab() {
  const [items, setItems] = useState<ConceptNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const [minConnectionsByDomain, setMinConnectionsByDomain] = useState<
    Record<KnowledgeDomain, number>
  >({
    document: 1,
    concept: 3,
    procedure: 1,
    system: 1,
    process: 1,
  });
  const [search, setSearch] = useState("");
  const [activeDomain, setActiveDomain] = useState<KnowledgeDomain | "all">(
    "document",
  );
  const [selected, setSelected] = useState<ConceptNode | null>(null);

  const fetchKnowledgeItems = useCallback(async () => {
    setLoading(true);
    try {
      const responses = await Promise.all(
        DOMAIN_OPTIONS.map(async (option) => {
          const res = await fetch(`/api/graph/living-docs?domain=${option.id}`);
          if (!res.ok) return null;
          return {
            domain: option.id,
            data: (await res.json()) as ListResponse,
          };
        }),
      );

      if (responses.some((response) => !response)) {
        setConnected(false);
        setItems([]);
        return;
      }

      const loaded = responses.filter(
        (response): response is { domain: KnowledgeDomain; data: ListResponse } =>
          response !== null,
      );

      setConnected(loaded.every(({ data }) => data.connected));
      setItems(
        loaded.flatMap(({ domain, data }) =>
          (data.items ?? data.concepts ?? []).map((item) => ({
            ...item,
            id: item.id ?? item.name,
            domain: item.domain ?? domain,
          })),
        ),
      );
      setMinConnectionsByDomain((prev) => ({
        ...prev,
        ...Object.fromEntries(
          loaded
            .filter(({ data }) => typeof data.minConnections === "number")
            .map(({ domain, data }) => [domain, data.minConnections]),
        ),
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void fetchKnowledgeItems();
    }, 0);
    return () => window.clearTimeout(t);
  }, [fetchKnowledgeItems]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        (activeDomain === "all" || item.domain === activeDomain) &&
        (!q ||
          DOMAIN_META[item.domain].label.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          item.related.some((r) => r.toLowerCase().includes(q)) ||
          item.documents.some((doc) =>
            [doc.title, doc.sector].join(" ").toLowerCase().includes(q),
          )),
    );
  }, [activeDomain, items, search]);

  const groupedResults = useMemo(
    () =>
      DOMAIN_OPTIONS.map((option) => ({
        option,
        items: filtered.filter((item) => item.domain === option.id),
      })),
    [filtered],
  );

  const hasResults = groupedResults.some((group) => group.items.length > 0);
  const searchQuery = search.trim();
  const concepts = items;
  const domain: KnowledgeDomain = "concept";
  const domainMeta = DOMAIN_META.concept;
  const minConnections = minConnectionsByDomain.concept;
  const fetchConcepts = fetchKnowledgeItems;
  const setDomain = (_domain: KnowledgeDomain) => {
    void _domain;
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <label className="grid flex-1 grid-cols-[44px_1fr] items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] transition-colors focus-within:border-blue-400/60">
            <span className="flex h-full items-center justify-center border-r border-[var(--border)] text-[var(--muted)]">
              <Network className="h-4 w-4" />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar em documentos, conceitos, procedimentos e sistemas..."
              className="min-w-0 bg-transparent py-3 pl-4 pr-4 text-[13px] leading-none text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none"
            />
          </label>
          <button
            onClick={fetchKnowledgeItems}
            disabled={loading}
            className="flex items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveDomain("all")}
            className={[
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors",
              activeDomain === "all"
                ? "border-[var(--foreground-soft)] bg-[var(--surface)] text-[var(--foreground)]"
                : "border-[var(--border)] bg-transparent text-[var(--muted)] hover:text-[var(--foreground-soft)]",
            ].join(" ")}
          >
            Todos
            <span className="rounded-full bg-[var(--surface)] px-1.5 py-0 text-[9px] tabular-nums text-[var(--foreground-soft)]">
              {items.length}
            </span>
          </button>
          {DOMAIN_OPTIONS.map((option) => {
            const Icon = option.icon;
            const count = items.filter((item) => item.domain === option.id).length;
            const active = activeDomain === option.id;
            return (
              <button
                key={option.id}
                onClick={() => setActiveDomain(option.id)}
                className={[
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors",
                  active ? option.badgeClass : option.inactiveBadgeClass,
                ].join(" ")}
              >
                <Icon className="h-3 w-3" />
                {option.label}
                <span className="rounded-full bg-[var(--surface)] px-1.5 py-0 text-[9px] tabular-nums text-[var(--foreground-soft)]">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {/* Hero */}
      <div className="hidden">
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute -left-16 -bottom-16 h-48 w-48 rounded-full bg-teal-500/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.24em] text-blue-300">
              <Sparkles className="h-3 w-3" />
              Documentação viva
            </p>
            <h3 className="mt-1 text-lg font-semibold text-[var(--foreground)]">
              {domainMeta.label} com {minConnections}+ conexoes viram documentos sob demanda
            </h3>
            <p className="mt-1 text-[12px] text-[var(--foreground-soft)]">
              Selecione documentos, conceitos, procedimentos ou sistemas do grafo. O modelo
              cruza os documentos conectados ao item e produz um briefing executivo, mapa
              operacional, primer de onboarding ou analise de riscos sem persistir nada.
            </p>
          </div>
          <button
            onClick={fetchConcepts}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </div>

      <div className="hidden">
        {DOMAIN_OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = domain === option.id;
          return (
            <button
              key={option.id}
              onClick={() => {
                setSelected(null);
                setSearch("");
                setDomain(option.id);
              }}
              className={[
                "flex items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
                active
                  ? "border-blue-400/70 bg-blue-500/10 text-blue-200"
                  : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--foreground-soft)] hover:border-blue-400/50",
              ].join(" ")}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block text-[11px] font-bold uppercase tracking-[0.18em]">
                  {option.label}
                </span>
                <span className="mt-1 block text-[10px] leading-snug text-[var(--muted)]">
                  {option.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Connection state */}
      {!loading && !connected && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div>
            <p className="text-sm font-medium text-red-300">Neo4j indisponível</p>
            <p className="mt-1 text-[11px] text-red-400/80">
              Sem conexao com o grafo, nao ha como mapear os itens conectados.
            </p>
          </div>
        </div>
      )}

      {/* Search */}
      {false && connected && concepts.length > 0 && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Filtrar ${domainMeta.label.toLowerCase()}...`}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-[12px] text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-blue-400/60 focus:outline-none"
        />
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-[11px] text-[var(--muted)] py-6">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Consultando grafo…
        </div>
      )}

      {/* Empty */}
      {!loading && connected && concepts.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-6 py-10 text-center">
          <Network className="mx-auto h-8 w-8 text-[var(--muted)]" />
          <p className="mt-3 text-sm font-medium text-[var(--foreground-soft)]">
            Nenhum item do grafo encontrado ainda
          </p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Extraia entidades de mais documentos na aba <strong>Documentos</strong> e volte aqui.
          </p>
        </div>
      )}

      {!loading && connected && items.length > 0 && !hasResults && (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-6 py-8 text-center">
          <p className="text-sm font-medium text-[var(--foreground-soft)]">
            Nenhum resultado para &quot;{searchQuery}&quot;
          </p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            A busca considera nome, vizinhos, documentos-fonte e setor.
          </p>
        </div>
      )}

      {!loading &&
        connected &&
        groupedResults.map(({ option, items: domainItems }) => {
          if (domainItems.length === 0) return null;
          const Icon = option.icon;
          const minConnections = minConnectionsByDomain[option.id];
          return (
            <section
              key={option.id}
              className={`rounded-xl border p-3 ${
                activeDomain === option.id ? option.activePanelClass : option.panelClass
              }`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg border ${option.badgeClass}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <h4 className={`text-[12px] font-bold uppercase tracking-[0.18em] ${option.textClass}`}>
                      {option.label}
                    </h4>
                    <p className="text-[10px] text-[var(--muted)]">
                      {domainItems.length} resultado{domainItems.length === 1 ? "" : "s"} · minimo {minConnections} conexao{minConnections === 1 ? "" : "es"}
                    </p>
                  </div>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums ${option.badgeClass}`}>
                  {domainItems.length}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {domainItems.map((item) => (
                  <ConceptCard
                    key={`${item.domain}:${item.id}`}
                    concept={item}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            </section>
          );
        })}

      {/* Cards */}
      {false && !loading && filtered.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <ConceptCard key={`${c.domain}:${c.id}`} concept={c} onSelect={setSelected} />
          ))}
        </div>
      )}

      {selected && <GenerationModal concept={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
