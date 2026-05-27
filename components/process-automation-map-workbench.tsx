"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  FileSearch,
  GitBranch,
  Loader2,
  Network,
  RefreshCw,
  Search,
  Send,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { InfoTooltip } from "@/components/info-tooltip";

import { SECTORS, type Sector } from "@/lib/domain";
import { SECTOR_LABELS } from "@/lib/labels";

type Row = {
  id: string;
  name: string;
  sector: Sector;
  status: string;
  automationReadinessScore: number;
  documentationCoverageScore: number;
  confidenceScore: number;
  summary: string;
  recommendedAutomationLevel: string;
  suggestedScriptType: string | null;
  processSignals: string[];
  systemNames: string[];
  documentRefs: Array<{
    curationDocumentId?: string;
    documentId: string;
    sourceDocumentId: string;
    title: string;
    sector: Sector;
    status: string;
    source: "staging" | "promoted";
    owner?: string | null;
    ownerEmail?: string | null;
    topic?: string | null;
  }>;
  vectorEvidence: Array<{
    sector: Sector;
    sourceDocumentId: string;
    headingPathText: string;
    excerpt: string;
    source: "staging" | "promoted" | "fallback";
  }>;
  candidateCount: number;
  gapCount: number;
  criticalGapCount: number;
  hasHumanCheckpoint: boolean;
  hasSystem: boolean;
  sourceScope: "staging" | "promoted" | "both";
  actionRecommendation: string;
  lastAnalyzedAt: string | null;
};

type ListResponse = {
  kpis: {
    processesMapped: number;
    automationCandidates: number;
    processesWithCriticalGaps: number;
    lowCoverageProcesses: number;
    processesWithHumanInLoop: number;
  };
  rows: Row[];
  backlog: {
    questions: Array<{
      id: string;
      processMapId: string;
      processName: string;
      sector: Sector;
      question: string;
      priority: string;
      status: string;
    }>;
    candidates: Array<{

      id: string;
      title: string;
      status: string;
      sector: Sector;
      processMapId?: string | null;
      processName?: string | null;
      documentTitle: string;
    }>;
  };
  refreshedAt: string | null;
};

type DetailResponse = {
  id: string;
  name: string;
  sector: Sector;
  status: string;
  automationReadinessScore: number;
  documentationCoverageScore: number;
  confidenceScore: number;
  summary: string;
  recommendedAutomationLevel: string;
  suggestedScriptType: string | null;
  processSignals: string[];
  systemNames: string[];
  documentRefs: Row["documentRefs"];
  graphEvidence: {
    graphBacked?: boolean;
    systems?: string[];
    regulations?: string[];
    concepts?: string[];
    docCount?: number;
  };
  vectorEvidence: Row["vectorEvidence"];
  questions: Array<{
    id: string;
    question: string;
    rationale: string;
    priority: string;
    status: string;
    derivedFrom: string;
    targetDocumentId?: string | null;
    targetCurationDocumentId?: string | null;
    answeredAt?: string | null;
  }>;
  candidates: Array<{
    id: string;
    title: string;
    processName?: string | null;
    automationLevel: string;
    suggestedScriptType?: string | null;
    confidence: number;
    status: string;
    document: {
      id: string;
      documentTitle: string;
      sector: Sector;
      status: string;
    };
    runHistory?: Array<{
      id: string;
      createdAt: string;
      traceId: string;
      sourceDocumentId: string | null;
    }>;
  }>;
  actions: {
    openCurationHref: string | null;
    extractToGraphHref: string;
  };
};

type Filters = {
  search: string;
  sector: Sector | "all";
  status: string;
  automationLevel: string;
  hasSystem: "all" | "yes" | "no";
  gaps: "all" | "with" | "without";
  sourceScope: "all" | "staging" | "promoted" | "both";
};

const INITIAL_FILTERS: Filters = {
  search: "",
  sector: "all",
  status: "all",
  automationLevel: "all",
  hasSystem: "all",
  gaps: "all",
  sourceScope: "all",
};

function scoreClass(score: number) {
  if (score >= 70) return "bg-emerald-100 text-emerald-700";
  if (score >= 35) return "bg-amber-100 text-amber-800";
  return "bg-slate-200 text-slate-700";
}

function statusClass(status: string) {
  if (status === "mapped") return "bg-emerald-100 text-emerald-700";
  if (status === "critical_gaps") return "bg-rose-100 text-rose-700";
  if (status === "needs_graph_extraction") return "bg-cyan-100 text-cyan-700";
  if (status === "needs_curation") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

function priorityClass(priority: string) {
  if (priority === "high") return "bg-rose-100 text-rose-700";
  if (priority === "medium") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

function formatDateTime(value: string | null) {
  if (!value) return "nunca";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function KpiCard({
  label,
  value,
  description,
  tone = "default",
}: {
  label: string;
  value: number;
  description?: string;
  tone?: "default" | "alert";
}) {
  return (
    <div
      className={`rounded-[1.75rem] border px-5 py-4 ${
        tone === "alert"
          ? "border-rose-200 bg-rose-50"
          : "border-[var(--border)] bg-white"
      }`}
    >
      <div className="flex items-center text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
        {label}
        {description && <InfoTooltip text={description} />}
      </div>
      <p className="mt-2 text-3xl font-black text-[var(--foreground-strong)]">
        {value}
      </p>
    </div>
  );
}

function ElegantSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  className = "",
}: {
  value: T;
  onChange: (val: T) => void;
  options: Array<{ value: T; label: string }>;
  placeholder?: string;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        className="flex w-full items-center justify-between rounded-2xl border border-[var(--border)] bg-white px-4 py-2 text-sm text-[var(--foreground-strong)] outline-none transition-all focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent)]/5 hover:border-[var(--border-strong)]"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="truncate">{selectedOption?.label ?? placeholder ?? value}</span>
        <ChevronDown
          className={`h-4 w-4 text-[var(--muted)] transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 z-50 mt-2 max-h-60 overflow-auto rounded-2xl border border-[var(--border)] bg-white/95 p-1 shadow-xl backdrop-blur-sm animate-in fade-in zoom-in duration-200">
          {options.map((opt) => (
            <button
              className={`w-full rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                opt.value === value
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--foreground-soft)] hover:bg-[var(--accent-soft)] hover:text-[var(--foreground-strong)]"
              }`}
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              type="button"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProcessAutomationMapWorkbench() {
  const [activeTab, setActiveTab] = useState<"gaps" | "candidates">("gaps");
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [data, setData] = useState<ListResponse | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [targetQuestionId, setTargetQuestionId] = useState<string | null>(null);
  const [targetCandidateId, setTargetCandidateId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [pendingAction, setPendingAction] = useState("");

  const filteredRows = useMemo(() => {
    if (!data?.rows) return [];
    return data.rows.filter((row) => {
      if (activeTab === "gaps") return row.gapCount > 0;
      return row.gapCount === 0;
    });
  }, [data, activeTab]);

  const gapsCount = data?.rows.filter((r) => r.gapCount > 0).length ?? 0;
  const candidatesCount = data?.rows.filter((r) => r.gapCount === 0).length ?? 0;

  const statusOptions = useMemo(() => {
    const statuses = Array.from(new Set((data?.rows ?? []).map((row) => row.status)));
    return ["all", ...statuses];
  }, [data]);

  const automationLevelOptions = useMemo(() => {
    const levels = Array.from(
      new Set((data?.rows ?? []).map((row) => row.recommendedAutomationLevel)),
    );
    return ["all", ...levels];
  }, [data]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.sector !== "all") params.set("sector", filters.sector);
    if (filters.status !== "all") params.set("status", filters.status);
    if (filters.automationLevel !== "all") params.set("automationLevel", filters.automationLevel);
    if (filters.hasSystem !== "all") params.set("hasSystem", filters.hasSystem);
    if (filters.gaps !== "all") params.set("gaps", filters.gaps);
    if (filters.sourceScope !== "all") params.set("sourceScope", filters.sourceScope);

    async function run() {
      setLoadingList(true);
      setErrorMessage("");
      try {
        const response = await fetch(`/api/admin/process-automation-map?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as ListResponse & { message?: string };
        if (!response.ok) {
          throw new Error(payload.message ?? "Falha ao carregar o mapa.");
        }
        setData(payload);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar o mapa.");
        setData(null);
        setDetail(null);
      } finally {
        setLoadingList(false);
      }
    }

    void run();

    return () => controller.abort();
  }, [filters]);

  useEffect(() => {
    if (!data?.rows) return;

    async function selectInitial() {
      const currentFilteredRows = data!.rows.filter((row) => {
        if (activeTab === "gaps") return row.gapCount > 0;
        return row.gapCount === 0;
      });

      if (currentFilteredRows.length === 0) {
        setSelectedId("");
        setDetail(null);
        return;
      }

      setSelectedId((current) =>
        current && currentFilteredRows.some((row) => row.id === current)
          ? current
          : currentFilteredRows[0].id,
      );
    }

    void selectInitial();
  }, [data, activeTab]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    const controller = new AbortController();

    async function run() {
      setLoadingDetail(true);
      try {
        const response = await fetch(`/api/admin/process-automation-map/${selectedId}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as DetailResponse & { message?: string };
        if (!response.ok) {
          throw new Error(payload.message ?? "Falha ao carregar o detalhe do processo.");
        }
        setDetail(payload);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setErrorMessage(
          error instanceof Error ? error.message : "Falha ao carregar o detalhe do processo.",
        );
        setDetail(null);
      } finally {
        setLoadingDetail(false);
      }
    }

    void run();

    return () => controller.abort();
  }, [selectedId]);

  useEffect(() => {
    if (detail) {
      if (scrollTarget) {
        const timer = setTimeout(() => {
          document
            .getElementById(scrollTarget)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
          setScrollTarget(null);
        }, 100);
        return () => clearTimeout(timer);
      }
      if (targetQuestionId) {
        const timer = setTimeout(() => {
          document
            .getElementById(`question-${targetQuestionId}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
          setTargetQuestionId(null);
        }, 100);
        return () => clearTimeout(timer);
      }
      if (targetCandidateId) {
        const timer = setTimeout(() => {
          document
            .getElementById(`candidate-${targetCandidateId}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
          setTargetCandidateId(null);
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [detail, scrollTarget, targetQuestionId, targetCandidateId]);

  async function refreshAll() {
    setRefreshing(true);
    setErrorMessage("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/process-automation-map/refresh", {
        method: "POST",
      });
      const payload = (await response.json()) as { message?: string; refreshedAt?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao reprocessar o mapa.");
      }
      setMessage(
        payload.refreshedAt
          ? `Mapa reprocessado em ${formatDateTime(payload.refreshedAt)}.`
          : "Mapa reprocessado.",
      );
      setFilters((current) => ({ ...current }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao reprocessar o mapa.");
    } finally {
      setRefreshing(false);
    }
  }

  async function promoteGap(questionId: string) {
    setPendingAction(`promote:${questionId}`);
    setErrorMessage("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/process-automation-map/questions/${questionId}/promote-to-curation`,
        {
          method: "POST",
        },
      );
      const payload = (await response.json()) as { message?: string; alreadyPresent?: boolean };
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao enviar pergunta para curadoria.");
      }
      setMessage(
        payload.alreadyPresent
          ? "A pergunta ja estava na curadoria do documento-alvo."
          : "Pergunta enviada para a curadoria.",
      );
      setDetail((current) =>
        current
          ? {
              ...current,
              questions: current.questions.map((question) =>
                question.id === questionId
                  ? { ...question, status: "promoted" }
                  : question,
              ),
            }
          : current,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Falha ao enviar pergunta para curadoria.",
      );
    } finally {
      setPendingAction("");
    }
  }

  async function promoteAllGaps() {
    if (!detail) return;

    const eligibleQuestions = detail.questions.filter(
      (q) =>
        q.status !== "answered" &&
        q.status !== "promoted" &&
        q.status !== "dismissed" &&
        q.targetCurationDocumentId
    );

    if (eligibleQuestions.length === 0) {
      setMessage("Não há perguntas elegíveis para envio.");
      return;
    }

    setPendingAction("promote-all");
    setErrorMessage("");
    setMessage("");

    const succeededIds = new Set<string>();
    let alreadyPresentCount = 0;

    for (const q of eligibleQuestions) {
      try {
        const response = await fetch(
          `/api/admin/process-automation-map/questions/${q.id}/promote-to-curation`,
          { method: "POST" }
        );
        const payload = (await response.json()) as { message?: string; alreadyPresent?: boolean };
        if (response.ok) {
          succeededIds.add(q.id);
          if (payload.alreadyPresent) alreadyPresentCount++;
        }
      } catch {
        // Ignora erros individuais e tenta os outros
      }
    }

    if (succeededIds.size > 0) {
      setMessage(
        `${succeededIds.size} pergunta(s) enviada(s) para curadoria${
          alreadyPresentCount > 0 ? ` (${alreadyPresentCount} já estavam presentes)` : ""
        }.`
      );
      setDetail((current) =>
        current
          ? {
              ...current,
              questions: current.questions.map((question) =>
                succeededIds.has(question.id) ? { ...question, status: "promoted" } : question
              ),
            }
          : current
      );
    } else {
      setErrorMessage("Falha ao enviar perguntas para curadoria.");
    }

    setPendingAction("");
  }

  async function updateQuestionStatus(questionId: string, status: string) {
    setPendingAction(`question:${questionId}`);
    setErrorMessage("");

    try {
      const response = await fetch(
        `/api/admin/process-automation-map/questions/${questionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao atualizar status da pergunta.");
      }

      setDetail((current) =>
        current
          ? {
              ...current,
              questions: current.questions.map((question) =>
                question.id === questionId ? { ...question, status } : question,
              ),
            }
          : current,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Falha ao atualizar status da pergunta.",
      );
    } finally {
      setPendingAction("");
    }
  }

  async function triageCandidate(candidateId: string) {
    if (!detail) return;

    setPendingAction(`candidate:${candidateId}`);
    setErrorMessage("");

    try {
      const response = await fetch(`/api/admin/automation-candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "triaged",
          processMapId: detail.id,
        }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao atualizar o candidato.");
      }

      setDetail((current) =>
        current
          ? {
              ...current,
              candidates: current.candidates.map((candidate) =>
                candidate.id === candidateId
                  ? { ...candidate, status: "triaged" }
                  : candidate,
              ),
            }
          : current,
      );
      setMessage("Candidato marcado para triagem.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao atualizar o candidato.");
    } finally {
      setPendingAction("");
    }
  }

  return (
    <div className="space-y-6">
      <section className="premium-panel rounded-[2rem] p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              Workbench operacional
            </p>
            <h2 className="mt-2 text-2xl font-black text-[var(--foreground-strong)]">
              Processos consolidados para automacao
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--foreground-soft)]">
              Cada processo aparece com evidencias dos documentos, perguntas em aberto e
              sugestao do que pode virar rotina automatizada.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm text-[var(--foreground-soft)]">
              Ultimo refresh: <strong>{formatDateTime(data?.refreshedAt ?? null)}</strong>
            </div>
            <button
              className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50"
              disabled={refreshing}
              onClick={() => void refreshAll()}
              type="button"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Reprocessando..." : "Refresh manual"}
            </button>
          </div>
        </div>

        {message ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}
        {errorMessage ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}
      </section>

      <div className="premium-panel rounded-[2rem] p-2">
        <div className="grid gap-2 md:grid-cols-2">
          <button
            className={`rounded-[1.5rem] px-5 py-4 text-left transition-colors ${
              activeTab === "gaps"
                ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                : "text-[var(--foreground-soft)] hover:bg-white/70 hover:text-[var(--foreground-strong)]"
            }`}
            onClick={() => setActiveTab("gaps")}
            type="button"
          >
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em]">
              Perguntas em aberto
              {gapsCount > 0 ? (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700">
                  {gapsCount}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block text-sm font-semibold">
              Processos com informacoes pendentes para a curadoria responder.
            </span>
          </button>
          <button
            className={`rounded-[1.5rem] px-5 py-4 text-left transition-colors ${
              activeTab === "candidates"
                ? "bg-white text-[var(--foreground-strong)] shadow-sm"
                : "text-[var(--foreground-soft)] hover:bg-white/70 hover:text-[var(--foreground-strong)]"
            }`}
            onClick={() => setActiveTab("candidates")}
            type="button"
          >
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em]">
              Candidatos de Automação
              {candidatesCount > 0 ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">
                  {candidatesCount}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block text-sm font-semibold">
              Processos prontos ou sem gaps identificados.
            </span>
          </button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          description="Total de processos consolidados a partir dos documentos e do mapa do conhecimento."
          label="Processos mapeados"
          value={data?.kpis.processesMapped ?? 0}
        />
        <KpiCard
          description="Sugestoes de automacao identificadas pela IA nos documentos."
          label="Candidatos de automacao"
          value={data?.kpis.automationCandidates ?? 0}
        />
        <KpiCard
          description="Processos que possuem falhas criticas de informacao."
          label="Lacunas criticas"
          tone="alert"
          value={data?.kpis.processesWithCriticalGaps ?? 0}
        />
        <KpiCard
          description="Processos que possuem poucos documentos ou evidencias inconsistentes."
          label="Baixa cobertura"
          value={data?.kpis.lowCoverageProcesses ?? 0}
        />
        <KpiCard
          description="Processos que explicitamente exigem uma tomada de decisao humana."
          label="Humano no loop"
          value={data?.kpis.processesWithHumanInLoop ?? 0}
        />
      </section>

      <section className="premium-panel rounded-[2rem] border-[var(--border)] p-6 shadow-sm">
        <div className="flex flex-col gap-4">
          {/* Row 1: Search (2/3) and Sector (1/3) */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="group relative lg:col-span-2">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)] transition-colors group-focus-within:text-[var(--accent)]" />
              <input
                className="w-full rounded-2xl border border-[var(--border)] bg-white py-2 pl-11 pr-4 text-sm text-[var(--foreground-strong)] outline-none transition-all focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent)]/5 hover:border-[var(--border-strong)]"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, search: event.target.value }))
                }
                placeholder="Buscar por processo, sistema ou documento"
                value={filters.search}
              />
            </div>

            <ElegantSelect
              className="lg:col-span-1"
              onChange={(val) =>
                setFilters((current) => ({ ...current, sector: val as Sector | "all" }))
              }
              options={[
                { value: "all", label: "Todos os setores" },
                ...SECTORS.map((s) => ({ value: s, label: SECTOR_LABELS[s] })),
              ]}
              value={filters.sector}
            />
          </div>

          {/* Row 2: Specialized Filters (4 side-by-side) */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ElegantSelect
              onChange={(val) => setFilters((current) => ({ ...current, status: val }))}
              options={statusOptions.map((s) => ({
                value: s,
                label: s === "all" ? "Todos os status" : s,
              }))}
              value={filters.status}
            />

            <ElegantSelect
              onChange={(val) => setFilters((current) => ({ ...current, automationLevel: val }))}
              options={automationLevelOptions.map((l) => ({
                value: l,
                label: l === "all" ? "Todos os niveis" : l,
              }))}
              value={filters.automationLevel}
            />

            <ElegantSelect
              onChange={(val) =>
                setFilters((current) => ({ ...current, hasSystem: val as Filters["hasSystem"] }))
              }
              options={[
                { value: "all", label: "Sistema: todos" },
                { value: "yes", label: "Com sistema" },
                { value: "no", label: "Sem sistema" },
              ]}
              value={filters.hasSystem}
            />

            <ElegantSelect
              onChange={(val) =>
                setFilters((current) => ({ ...current, sourceScope: val as Filters["sourceScope"] }))
              }
              options={[
                { value: "all", label: "Fontes: todas" },
                { value: "staging", label: "So em revisao" },
                { value: "promoted", label: "So publicados" },
                { value: "both", label: "Ambos" },
              ]}
              value={filters.sourceScope}
            />
          </div>
        </div>
      </section>

      {/* ===== COCKPIT: THREE COLUMNS ===== */}
      <section className="grid gap-6 xl:grid-cols-[280px_1fr_300px]">

        {/* ===== LEFT COLUMN: Compact Process Navigator ===== */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                Processos
              </p>
              <p className="mt-1 text-xs text-[var(--foreground-soft)]">
                {loadingList
                  ? "Carregando..."
                  : `${filteredRows.length} no recorte`}
              </p>
            </div>
            {loadingList ? <Loader2 className="h-4 w-4 animate-spin text-[var(--muted)]" /> : null}
          </div>

          {loadingList ? (
            <div className="premium-panel rounded-[2rem] p-6 text-sm text-[var(--foreground-soft)]">
              Carregando processos...
            </div>
          ) : filteredRows.length ? (
            <div className="space-y-2">
              {filteredRows.map((row) => {
                const isActive = row.id === selectedId;
                return (
                  <div
                    className={`cursor-pointer rounded-2xl border p-3 transition-all outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent)]/20 ${
                      isActive
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-[var(--border)] bg-white hover:border-[var(--accent)]/40"
                    }`}
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(row.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {/* Status dot + sector + gap count */}
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 flex-shrink-0 rounded-full ${
                          row.status === "mapped"
                            ? "bg-emerald-400"
                            : row.status === "critical_gaps"
                              ? "bg-rose-400"
                              : row.status === "needs_curation"
                                ? "bg-amber-400"
                                : "bg-cyan-400"
                        }`}
                      />
                      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                        {SECTOR_LABELS[row.sector]}
                      </span>
                      {row.gapCount > 0 ? (
                        <span className="ml-auto rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                          {row.gapCount} gap{row.gapCount > 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                          ok
                        </span>
                      )}
                    </div>

                    {/* Process name */}
                    <p className="mt-2 line-clamp-2 text-sm font-black text-[var(--foreground-strong)]">
                      {row.name}
                    </p>

                    {/* Automation level badge */}
                    <div className="mt-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${scoreClass(row.automationReadinessScore)}`}>
                        {row.recommendedAutomationLevel}
                      </span>
                    </div>

                    {/* Readiness progress bar */}
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[10px] text-[var(--muted)]">Prontidão</span>
                        <span className={`text-[10px] font-bold ${
                          row.automationReadinessScore >= 70
                            ? "text-emerald-700"
                            : row.automationReadinessScore >= 35
                              ? "text-amber-700"
                              : "text-slate-500"
                        }`}>
                          {Math.round(row.automationReadinessScore)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            row.automationReadinessScore >= 70
                              ? "bg-emerald-400"
                              : row.automationReadinessScore >= 35
                                ? "bg-amber-400"
                                : "bg-slate-300"
                          }`}
                          style={{ width: `${Math.min(row.automationReadinessScore, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="premium-panel rounded-[2rem] p-8 text-sm text-[var(--foreground-soft)]">
              {activeTab === "gaps"
                ? "Nenhum processo com gaps pendentes no recorte atual."
                : "Nenhum candidato de automacao sem gaps no recorte atual."}
            </div>
          )}
        </div>

        {/* ===== MIDDLE COLUMN: Process Detail Panel (Hero) ===== */}
        <div className="premium-panel rounded-[2rem] p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                Painel de detalhe
              </p>
              <h3 className="mt-1 text-xl font-black text-[var(--foreground-strong)]">
                {detail?.name ?? "Selecione um processo"}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              {loadingDetail ? <Loader2 className="h-4 w-4 animate-spin text-[var(--muted)]" /> : null}
              {detail ? (
                <Link
                  className="inline-flex items-center gap-1 rounded-full border border-cyan-400/50 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-cyan-700 transition-colors hover:bg-cyan-500/20"
                  href={`/admin/graph/process/${detail.id}`}
                  title="Visualizacao completa do processo no grafo"
                >
                  <Network className="h-3 w-3" />
                  Ver no grafo
                </Link>
              ) : null}
            </div>
          </div>

          {detail ? (
            <div className="mt-5 space-y-6">
              {/* Status badges */}
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${statusClass(detail.status)}`}>
                  {detail.status}
                </span>
                <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${scoreClass(detail.automationReadinessScore)}`}>
                  {detail.recommendedAutomationLevel}
                </span>
                <span className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--foreground-soft)]">
                  {SECTOR_LABELS[detail.sector]}
                </span>
                {detail.suggestedScriptType ? (
                  <span className="rounded-full bg-violet-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-700">
                    {detail.suggestedScriptType}
                  </span>
                ) : null}
              </div>

              {/* Summary */}
              <p className="text-sm leading-6 text-[var(--foreground-soft)]">
                {detail.summary}
              </p>

              {/* Score cards with visual progress bars */}
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    {
                      label: "Prontidao",
                      value: detail.automationReadinessScore,
                      tooltip: "Indica o quao pronto o processo esta para automacao baseada em sistemas, clareza de entradas, saidas e regras.",
                    },
                    {
                      label: "Cobertura",
                      value: detail.documentationCoverageScore,
                      tooltip: "Mede a qualidade da documentacao: presenca de donos, gatilhos, excecoes e indicadores de sucesso.",
                    },
                    {
                      label: "Confianca",
                      value: detail.confidenceScore,
                      tooltip: "Score geral de confianca do mapeamento, combinando profundidade do grafo, evidencias e candidatos.",
                    },
                  ] as const
                ).map(({ label, value, tooltip }) => (
                  <div className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3" key={label}>
                    <p className="flex items-center text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                      {label}
                      <InfoTooltip text={tooltip} />
                    </p>
                    <p className="mt-1 text-2xl font-black text-[var(--foreground-strong)]">
                      {Math.round(value)}
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          value >= 70 ? "bg-emerald-400" : value >= 35 ? "bg-amber-400" : "bg-slate-300"
                        }`}
                        style={{ width: `${Math.min(value, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-3">
                {detail.actions.openCurationHref ? (
                  <Link
                    className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-bold text-[var(--foreground-strong)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    href={detail.actions.openCurationHref}
                  >
                    <Send className="h-4 w-4" />
                    Abrir curadoria
                  </Link>
                ) : null}
                <Link
                  className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-bold text-[var(--foreground-strong)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  href={detail.actions.extractToGraphHref}
                >
                  <GitBranch className="h-4 w-4" />
                  Mapear conhecimento
                </Link>
              </div>

              {/* Systems & Documents */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-cyan-700" />
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Sistemas e documentos
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {detail.systemNames.map((system) => (
                    <span
                      className="rounded-full bg-cyan-100 px-3 py-1 text-[11px] font-bold text-cyan-700"
                      key={system}
                    >
                      {system}
                    </span>
                  ))}
                  {!detail.systemNames.length ? (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-700">
                      sem sistema associado
                    </span>
                  ) : null}
                </div>
                <div className="space-y-2">
                  {detail.documentRefs.map((document) => (
                    <div
                      className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3"
                      key={`${document.documentId}-${document.sector}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-[var(--foreground-strong)]">
                            {document.title}
                          </p>
                          <p className="mt-1 text-xs text-[var(--foreground-soft)]">
                            {SECTOR_LABELS[document.sector]} · {document.source} · {document.status}
                          </p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-700">
                          {document.ownerEmail || document.owner || "sem dono"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Vector Evidence */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <FileSearch className="h-4 w-4 text-violet-700" />
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Evidencias textuais
                  </p>
                </div>
                <div className="space-y-2">
                  {detail.vectorEvidence.map((evidence, index) => (
                    <div
                      className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3"
                      key={`${evidence.sourceDocumentId}-${index}`}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                        <span>{SECTOR_LABELS[evidence.sector]}</span>
                        <span>{evidence.source}</span>
                        <span>{evidence.headingPathText}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">
                        {evidence.excerpt}
                      </p>
                    </div>
                  ))}
                  {!detail.vectorEvidence.length ? (
                    <p className="text-sm text-[var(--foreground-soft)]">
                      Nenhuma evidência textual consolidada.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5 flex flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-[var(--border)] px-5 py-12 text-center">
              <Network className="mb-3 h-8 w-8 text-[var(--muted)]" />
              <p className="text-sm font-bold text-[var(--foreground-strong)]">
                Selecione um processo
              </p>
              <p className="mt-1 text-sm text-[var(--foreground-soft)]">
                Clique em um processo na lista para ver resumo, evidencias, documentos e sistemas associados.
              </p>
            </div>
          )}
        </div>

        {/* ===== RIGHT COLUMN: Dynamic Context Panel ===== */}
        <div className="space-y-4">
          {loadingDetail && selectedId ? (
            <div className="premium-panel flex items-center gap-2 rounded-[2rem] p-6 text-sm text-[var(--foreground-soft)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--muted)]" />
              Carregando contexto...
            </div>
          ) : detail ? (
            <>
              {/* Process-specific questions */}
              <div className="premium-panel rounded-[2rem] p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CircleDashed className="h-4 w-4 text-rose-600" />
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Perguntas
                    </p>
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                      {detail.questions.filter(
                        (q) => q.status === "open" || q.status === "promoted",
                      ).length}
                    </span>
                  </div>
                  {detail.questions.some(
                    (q) =>
                      q.status !== "answered" &&
                      q.status !== "promoted" &&
                      q.status !== "dismissed" &&
                      q.targetCurationDocumentId,
                  ) ? (
                    <button
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 py-1.5 text-[10px] font-bold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50"
                      disabled={pendingAction === "promote-all"}
                      onClick={() => void promoteAllGaps()}
                      type="button"
                    >
                      <Send className="h-3 w-3" />
                      {pendingAction === "promote-all" ? "Enviando..." : "Enviar todas"}
                    </button>
                  ) : null}
                </div>

                <div className="mt-4 space-y-2">
                  {detail.questions.map((question) => (
                    <div
                      className={`rounded-2xl border px-3 py-3 ${
                        question.status === "answered"
                          ? "border-emerald-200 bg-emerald-50/70"
                          : question.status === "promoted"
                            ? "border-cyan-200 bg-cyan-50/70"
                            : question.status === "dismissed"
                              ? "border-slate-200 bg-slate-50/50 opacity-60"
                              : "border-[var(--border)] bg-white"
                      }`}
                      id={`question-${question.id}`}
                      key={question.id}
                    >
                      {/* Priority + status */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] ${priorityClass(question.priority)}`}
                        >
                          {question.priority}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] ${
                            question.status === "answered"
                              ? "bg-emerald-100 text-emerald-700"
                              : question.status === "promoted"
                                ? "bg-cyan-100 text-cyan-700"
                                : question.status === "dismissed"
                                  ? "bg-slate-100 text-slate-500"
                                  : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {question.status === "answered"
                            ? "respondida"
                            : question.status === "promoted"
                              ? "na curadoria"
                              : question.status === "dismissed"
                                ? "dispensada"
                                : "aberta"}
                        </span>
                      </div>

                      {/* Question text */}
                      <p className="mt-2 text-xs font-bold leading-5 text-[var(--foreground-strong)]">
                        {question.question}
                      </p>

                      {/* Rationale (condensed) */}
                      <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[var(--foreground-soft)]">
                        {question.rationale}
                      </p>

                      {/* Action buttons */}
                      {question.status !== "answered" && (
                        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[var(--border)] pt-2">
                          {question.targetCurationDocumentId &&
                          question.status !== "promoted" &&
                          question.status !== "dismissed" ? (
                            <button
                              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-white px-2 py-1 text-[10px] font-bold text-[var(--foreground-strong)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                              disabled={pendingAction === `promote:${question.id}`}
                              onClick={() => void promoteGap(question.id)}
                              type="button"
                            >
                              <Send className="h-2.5 w-2.5" />
                              {pendingAction === `promote:${question.id}`
                                ? "Enviando..."
                                : "Enviar"}
                            </button>
                          ) : null}
                          {question.status !== "dismissed" ? (
                            <button
                              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-white px-2 py-1 text-[10px] font-bold text-[var(--foreground-strong)] transition-colors hover:border-rose-300 hover:text-rose-700 disabled:opacity-50"
                              disabled={pendingAction === `question:${question.id}`}
                              onClick={() =>
                                void updateQuestionStatus(question.id, "dismissed")
                              }
                              type="button"
                            >
                              <AlertTriangle className="h-2.5 w-2.5" />
                              Dispensar
                            </button>
                          ) : (
                            <button
                              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-white px-2 py-1 text-[10px] font-bold text-[var(--foreground-strong)] transition-colors hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50"
                              disabled={pendingAction === `question:${question.id}`}
                              onClick={() =>
                                void updateQuestionStatus(question.id, "open")
                              }
                              type="button"
                            >
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              Reabrir
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {!detail.questions.length ? (
                    <p className="text-sm text-[var(--foreground-soft)]">
                      Nenhuma pergunta aberta para este processo.
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Process-specific candidates */}
              {detail.candidates.length > 0 ? (
                <div className="premium-panel rounded-[2rem] p-5">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-[var(--accent)]" />
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Candidatos
                    </p>
                    <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                      {detail.candidates.length}
                    </span>
                  </div>
                  <div className="mt-4 space-y-2">
                    {detail.candidates.map((candidate) => (
                      <div
                        className="rounded-2xl border border-[var(--border)] bg-white px-3 py-3"
                        id={`candidate-${candidate.id}`}
                        key={candidate.id}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] ${scoreClass(candidate.confidence * 100)}`}
                          >
                            {Math.round(candidate.confidence * 100)}%
                          </span>
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-violet-700">
                            {candidate.automationLevel}
                          </span>
                        </div>
                        <p className="mt-2 text-xs font-bold leading-5 text-[var(--foreground-strong)]">
                          {candidate.title}
                        </p>
                        <p className="mt-1 text-[10px] text-[var(--foreground-soft)]">
                          {candidate.document.documentTitle}
                        </p>
                        {candidate.status !== "triaged" ? (
                          <div className="mt-2 border-t border-[var(--border)] pt-2">
                            <button
                              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-white px-2 py-1 text-[10px] font-bold text-[var(--foreground-strong)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                              disabled={pendingAction === `candidate:${candidate.id}`}
                              onClick={() => void triageCandidate(candidate.id)}
                              type="button"
                            >
                              <Bot className="h-2.5 w-2.5" />
                              {pendingAction === `candidate:${candidate.id}`
                                ? "Atualizando..."
                                : "Marcar triagem"}
                            </button>
                          </div>
                        ) : (
                          <div className="mt-2 border-t border-[var(--border)] pt-2">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              Triado
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            /* Global backlog — shown when nothing is selected */
            <>
              <div className="premium-panel rounded-[2rem] p-5">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-600" />
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Perguntas pendentes
                  </p>
                  <span className="ml-auto rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                    {data?.backlog.questions.length ?? 0}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-[var(--foreground-soft)]">
                  Backlog global · selecione um processo para ver o contexto especifico
                </p>
                <div className="mt-4 space-y-2">
                  {(data?.backlog.questions ?? []).slice(0, 10).map((question) => (
                    <div
                      className="cursor-pointer rounded-2xl border border-[var(--border)] bg-white px-3 py-3 transition-colors hover:border-[var(--accent)]/40"
                      key={question.id}
                      onClick={() => {
                        setSelectedId(question.processMapId);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedId(question.processMapId);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] ${priorityClass(question.priority)}`}
                        >
                          {question.priority}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-[var(--muted)]">
                          {SECTOR_LABELS[question.sector]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-bold text-[var(--foreground-strong)]">
                        {question.processName}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[var(--foreground-soft)]">
                        {question.question}
                      </p>
                    </div>
                  ))}
                  {!data?.backlog.questions.length ? (
                    <p className="text-sm text-[var(--foreground-soft)]">
                      Nenhuma pergunta aberta no momento.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="premium-panel rounded-[2rem] p-5">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-[var(--accent)]" />
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Candidatos aguardando triagem
                  </p>
                  <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                    {data?.backlog.candidates.length ?? 0}
                  </span>
                </div>
                <div className="mt-4 space-y-2">
                  {(data?.backlog.candidates ?? []).slice(0, 10).map((candidate) => (
                    <div
                      className="cursor-pointer rounded-2xl border border-[var(--border)] bg-white px-3 py-3 transition-colors hover:border-[var(--accent)]/40"
                      key={candidate.id}
                      onClick={() => {
                        if (candidate.processMapId) {
                          setSelectedId(candidate.processMapId);
                          setTargetCandidateId(candidate.id);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (candidate.processMapId) {
                            setSelectedId(candidate.processMapId);
                            setTargetCandidateId(candidate.id);
                          }
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-700">
                          {candidate.status}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-[var(--muted)]">
                          {SECTOR_LABELS[candidate.sector]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-bold text-[var(--foreground-strong)]">
                        {candidate.title}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[var(--foreground-soft)]">
                        {candidate.processName ?? candidate.documentTitle}
                      </p>
                    </div>
                  ))}
                  {!data?.backlog.candidates.length ? (
                    <p className="text-sm text-[var(--foreground-soft)]">
                      Nenhum candidato aguardando triagem.
                    </p>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
