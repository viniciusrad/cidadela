"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Brain,
  CodeXml,
  Database,
  Gauge,
  Grid3X3,
  Headphones,
  Monitor,
  Network,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Shield,
  Sliders,
  Sparkles,
  Trash2,
} from "lucide-react";

import type { Sector } from "@/lib/domain";
import { getSectorLabel } from "@/lib/labels";
import { CreateAgentDrawer } from "@/components/create-agent-drawer";
import { SectorAccessMatrix } from "@/components/sector-access-matrix";

type Capability = {
  id: string;
  name: string;
  description: string;
  isExposed: boolean;
};

type Persona = {
  name: string;
  summary: string;
  instructions: string;
  capabilities: Capability[];
};

type Params = {
  chatModel: string;
  topK: number;
  localConfidenceThreshold: number;
};

type DocStats = {
  publicChunks: number;
  stagingChunks: number;
};

type AgentRow = {
  sector: Sector;
  persona: Persona;
  params: Params;
  defaults: { persona: Persona; chatModel: string; topK: number; localConfidenceThreshold: number };
  hasOverride: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  docStats?: DocStats;
};

type ProtocolRow = {
  id: string;
  from: Sector;
  to: Sector;
  intent: string;
  template: string;
  maxTokens: number;
  enabled: boolean;
};

type ApiResponse = {
  agents: AgentRow[];
  protocols: ProtocolRow[];
  availableModels: string[];
};

type TabKey =
  | "identity"
  | "capabilities"
  | "params"
  | "protocols"
  | "memory"
  | "telemetry";

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: "identity", label: "Identidade", icon: <Sparkles className="h-3.5 w-3.5" /> },
  { key: "capabilities", label: "Capacidades", icon: <Settings2 className="h-3.5 w-3.5" /> },
  { key: "params", label: "Parametros", icon: <Sliders className="h-3.5 w-3.5" /> },
  { key: "protocols", label: "Protocolos", icon: <Network className="h-3.5 w-3.5" /> },
  { key: "memory", label: "Memoria", icon: <Brain className="h-3.5 w-3.5" /> },
  { key: "telemetry", label: "Telemetria", icon: <Gauge className="h-3.5 w-3.5" /> },
];

const FUTURE_SECTORS = [
  {
    name: "Compras / Negociador",
    description: "Cotacao, fornecedores, condicoes comerciais e historico de negociacao.",
  },
  {
    name: "RH / Concierge",
    description: "Politica interna, beneficios, ferias e onboarding.",
  },
  {
    name: "Financeiro / Tesoureiro",
    description: "Pagamentos, conciliacao, fluxo de caixa e relatorios fiscais.",
  },
  {
    name: "Logistica / Despachante",
    description: "Roteirizacao, transportadoras, status de carga e SLA de entrega.",
  },
];

function getSectorIcon(sector: Sector) {
  switch (sector) {
    case "desenvolvimento":
      return <CodeXml className="h-4 w-4" />;
    case "seguranca":
      return <Shield className="h-4 w-4" />;
    case "suporte":
      return <Headphones className="h-4 w-4" />;
    case "desktop":
      return <Monitor className="h-4 w-4" />;
    default:
      return <Bot className="h-4 w-4" />;
  }
}

function AgentKnowledgeStatus({
  pub,
  stg,
}: {
  pub: number;
  stg: number;
}) {
  const total = pub + stg;
  const pubPct = total === 0 ? 0 : (pub / total) * 100;

  return (
    <div className="mt-auto space-y-1.5">
      <div className="flex items-center justify-between gap-1">
        <span
          className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]"
          title={`${total} trechos disponiveis: ${pub} ja no chat, ${stg} ainda em revisao.`}
        >
          Conhecimento
        </span>
        <span className="text-[9px] font-black text-[var(--foreground-soft)]">{total}</span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-muted)] shadow-inner">
        {/* Progress bar with glow for public content */}
        <div
          className="absolute inset-y-0 left-0 bg-[var(--accent)] transition-all duration-500 ease-out"
          style={{ width: `${pubPct}%`, boxShadow: "0 0 8px var(--accent-soft)" }}
        />
        {/* Staging indicator - just a color shift or subtle pattern */}
        {stg > 0 && (
          <div
            className="absolute inset-y-0 bg-white/40 transition-all duration-500"
            style={{ left: `${pubPct}%`, width: `${(stg / total) * 100}%` }}
          />
        )}
      </div>
      <div className="flex justify-between text-[8px] font-medium leading-none">
        <span className="text-[var(--accent)]">{pub} publicados</span>
        <span className="text-[var(--muted)]">{stg} em revisao</span>
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  isSelected,
  onClick,
}: {
  agent: AgentRow;
  isSelected: boolean;
  onClick: () => void;
}) {
  const sectorLabel = getSectorLabel(agent.sector);
  const pub = agent.docStats?.publicChunks ?? 0;
  const stg = agent.docStats?.stagingChunks ?? 0;

  // Format relative time (very simple version)
  const lastUpdate = agent.updatedAt
    ? new Date(agent.updatedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    : null;

  return (
    <button
      className={`group relative flex min-h-[150px] flex-col gap-2.5 rounded-xl border p-3 text-left transition-all duration-300 ${
        isSelected
          ? "border-[var(--accent)] bg-gradient-to-br from-[var(--accent-soft)] via-white/80 to-white backdrop-blur-md shadow-[0_12px_24px_-8px_var(--accent-soft)] ring-1 ring-[var(--accent)]/30 scale-[1.02]"
          : "border-[var(--border)] bg-white/50 backdrop-blur-[2px] hover:border-[var(--accent-soft)] hover:bg-white hover:shadow-lg hover:-translate-y-0.5"
      }`}
      onClick={onClick}
      type="button"
    >
      {agent.hasOverride ? (
        <div className="absolute right-2 top-2 flex items-center gap-1.5">
          {lastUpdate && (
            <span className="text-[8px] font-bold text-[var(--muted)] opacity-0 transition-opacity group-hover:opacity-100">
              {lastUpdate}
            </span>
          )}
          <span
            aria-label="Override ativo"
            className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]"
            title="Personalizacao ativa para este agente."
          />
        </div>
      ) : null}

      {/* Header: Icon + Name */}
      <div className="flex items-start gap-2">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-sm transition-all duration-300 group-hover:scale-110 ${
            isSelected
              ? "bg-[var(--accent)] text-white shadow-[0_4px_10px_var(--accent-soft)]"
              : "bg-[var(--surface-muted)] text-[var(--foreground-soft)] group-hover:bg-[var(--accent-soft)] group-hover:text-[var(--accent)] group-hover:shadow-[0_0_12px_var(--accent-soft)]"
          }`}
        >
          {getSectorIcon(agent.sector)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-black leading-tight text-[var(--foreground-strong)] break-words">
            {agent.persona.name}
          </h3>
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-[var(--muted)] break-words">
            {sectorLabel}
          </p>
        </div>
      </div>

      {/* Summary / Content Preview */}
      <p className="line-clamp-2 min-h-[2.6em] text-[11px] leading-snug text-[var(--foreground-soft)] opacity-80">
        {agent.persona.summary || "Sem resumo definido."}
      </p>

      {/* Knowledge Status Bar */}
      <AgentKnowledgeStatus pub={pub} stg={stg} />

      {/* Hover background glow */}
      {!isSelected && (
        <div className="absolute inset-0 -z-10 rounded-xl bg-[var(--accent-soft)] opacity-0 transition-opacity duration-300 group-hover:opacity-30" />
      )}
    </button>
  );
}

function badge(label: string, tone: "neutral" | "accent" | "muted" = "neutral") {
  const className =
    tone === "accent"
      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--foreground-strong)]"
      : tone === "muted"
        ? "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted)]"
        : "border-[var(--border)] bg-white text-[var(--foreground-soft)]";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${className}`}
    >
      {label}
    </span>
  );
}

export function AgentControlCenter() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState<Sector | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [matrixKey, setMatrixKey] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/agents", { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? `Falha ao carregar (${response.status})`);
      }
      const payload = (await response.json()) as ApiResponse;
      setData(payload);
      setSelectedSector((current) => current ?? payload.agents[0]?.sector ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const selectedAgent = useMemo(
    () => data?.agents.find((agent) => agent.sector === selectedSector) ?? null,
    [data, selectedSector],
  );

  const protocolsForSelected = useMemo(
    () => data?.protocols.filter((p) => p.from === selectedSector) ?? [],
    [data, selectedSector],
  );

  if (loading && !data) {
    return (
      <div className="premium-panel rounded-lg p-8 text-sm text-[var(--foreground-soft)]">
        Carregando agentes...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <>
    <CreateAgentDrawer
      onClose={() => setDrawerOpen(false)}
      onCreated={() => {
        void refresh();
        setMatrixKey((k) => k + 1);
      }}
      open={drawerOpen}
    />
    <div className="space-y-5">
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-3">
        <div className="rounded-lg border border-[var(--border)] bg-white p-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            Agentes ativos
          </p>
          <p className="mt-1 text-xs text-[var(--foreground-soft)]">
            Edicoes refletem em tempo real no chat de cada setor.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {data.agents.map((agent) => (
            <AgentCard
              agent={agent}
              isSelected={agent.sector === selectedSector}
              key={agent.sector}
              onClick={() => setSelectedSector(agent.sector)}
            />
          ))}
        </div>

        <button
          className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed border-[var(--accent)] bg-[var(--accent-soft)]/30 px-3 py-3 text-xs font-bold text-[var(--accent)] transition-all hover:bg-[var(--accent)] hover:text-white hover:shadow-md active:scale-95"
          onClick={() => setDrawerOpen(true)}
          type="button"
        >
          <div className="absolute inset-0 -z-10 translate-x-[-100%] bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 group-hover:translate-x-[100%]" />
          <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" /> Novo agente
        </button>

      </aside>

      <section className="space-y-4">
        {selectedAgent ? (
          <AgentEditor
            agent={selectedAgent}
            availableModels={data.availableModels}
            feedback={feedback}
            key={selectedAgent.sector}
            onFeedback={setFeedback}
            onRefresh={refresh}
            protocols={protocolsForSelected}
          />
        ) : (
          <div className="premium-panel rounded-lg p-8 text-sm text-[var(--foreground-soft)]">
            Selecione um agente para configurar.
          </div>
        )}
      </section>
    </div>

    <section className="rounded-lg border border-[var(--border)] bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <Grid3X3 className="h-4 w-4 text-[var(--accent)]" />
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            Matriz de acesso intersetorial
          </p>
        </div>
        <p className="text-[11px] text-[var(--muted)]">
          Clique em uma celula para editar a regra de roteamento.
        </p>
      </div>
      <div className="mt-3">
        <SectorAccessMatrix key={matrixKey} />
      </div>
    </section>

    <section className="rounded-lg border border-[var(--border)] bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
          Setores planejados
        </p>
        <p className="text-[11px] text-[var(--muted)]">
          Roadmap. Use o botao Novo agente para provisionar.
        </p>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {FUTURE_SECTORS.map((entry) => (
          <li
            className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-3 opacity-80"
            key={entry.name}
          >
            <p className="text-xs font-black text-[var(--foreground-soft)]">{entry.name}</p>
            <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">
              {entry.description}
            </p>
          </li>
        ))}
      </ul>
    </section>
    </div>
    </>
  );
}

function AgentEditor({
  agent,
  availableModels,
  feedback,
  onFeedback,
  onRefresh,
  protocols,
}: {
  agent: AgentRow;
  availableModels: string[];
  feedback: string | null;
  onFeedback: (msg: string | null) => void;
  onRefresh: () => Promise<void>;
  protocols: ProtocolRow[];
}) {
  const [tab, setTab] = useState<TabKey>("identity");
  const [persona, setPersona] = useState<Persona>(() => ({
    name: agent.persona.name,
    summary: agent.persona.summary,
    instructions: agent.persona.instructions,
    capabilities: agent.persona.capabilities.map((c) => ({ ...c })),
  }));
  const [params, setParams] = useState<Params>(() => ({ ...agent.params }));
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(
    () =>
      JSON.stringify({ persona, params }) !==
      JSON.stringify({ persona: agent.persona, params: agent.params }),
    [persona, params, agent.persona, agent.params],
  );

  function updatePersona(updates: Partial<Persona>) {
    setPersona((prev) => ({ ...prev, ...updates }));
  }

  function updateParams(updates: Partial<Params>) {
    setParams((prev) => ({ ...prev, ...updates }));
  }

  function addCapability() {
    updatePersona({
      capabilities: [
        ...persona.capabilities,
        {
          id: `cap-${Math.random().toString(36).slice(2, 8)}`,
          name: "Nova capacidade",
          description: "Descreva a capacidade.",
          isExposed: true,
        },
      ],
    });
  }

  function removeCapability(index: number) {
    updatePersona({
      capabilities: persona.capabilities.filter((_, i) => i !== index),
    });
  }

  function updateCapability(index: number, patch: Partial<Capability>) {
    updatePersona({
      capabilities: persona.capabilities.map((cap, i) =>
        i === index ? { ...cap, ...patch } : cap,
      ),
    });
  }

  async function save() {
    setSaving(true);
    onFeedback(null);
    try {
      const response = await fetch(`/api/admin/agents/${agent.sector}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: persona.name,
          summary: persona.summary,
          instructions: persona.instructions,
          capabilities: persona.capabilities,
          chatModel: params.chatModel,
          topK: params.topK,
          localConfidenceThreshold: params.localConfidenceThreshold,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? `Falha ao salvar (${response.status})`);
      }
      onFeedback("Configuracao salva.");
      await onRefresh();
    } catch (err) {
      onFeedback(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (
      !window.confirm(
        `Restaurar configuracao default do agente ${agent.persona.name}? As edicoes salvas serao removidas.`,
      )
    ) {
      return;
    }
    setSaving(true);
    onFeedback(null);
    try {
      const response = await fetch(`/api/admin/agents/${agent.sector}/reset`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? `Falha ao resetar (${response.status})`);
      }
      onFeedback("Override removido. Voltou ao default.");
      await onRefresh();
    } catch (err) {
      onFeedback(err instanceof Error ? err.message : "Erro ao resetar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="premium-panel rounded-lg p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
              Agente
            </p>
            <h2 className="mt-1 text-2xl font-black text-[var(--foreground-strong)]">
              {agent.persona.name}
            </h2>
            <p className="mt-1 text-sm text-[var(--foreground-soft)]">
              {agent.persona.summary}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {badge(getSectorLabel(agent.sector), "muted")}
              {agent.hasOverride ? badge("Override ativo", "accent") : badge("Default", "muted")}
              {badge(`Modelo: ${agent.params.chatModel}`)}
              {badge(`K=${agent.params.topK}`)}
              {badge(`τ=${agent.params.localConfidenceThreshold.toFixed(2)}`)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-xs font-bold text-[var(--foreground-soft)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
              disabled={!agent.hasOverride || saving}
              onClick={reset}
              type="button"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Restaurar default
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-xs font-black text-white shadow-sm shadow-[var(--accent-soft)] disabled:opacity-50"
              disabled={!dirty || saving}
              onClick={save}
              type="button"
            >
              <Save className="h-3.5 w-3.5" /> {saving ? "Salvando..." : "Salvar alteracoes"}
            </button>
          </div>
        </div>
        {feedback ? (
          <p className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--foreground-soft)]">
            {feedback}
          </p>
        ) : null}
      </header>

      <nav className="flex gap-1 overflow-x-auto rounded-lg border border-[var(--border)] bg-white p-1">
        {TABS.map((entry) => {
          const isActive = entry.key === tab;
          return (
            <button
              className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-xs font-black transition-colors ${
                isActive
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--foreground-soft)] hover:bg-[var(--surface-muted)]"
              }`}
              key={entry.key}
              onClick={() => setTab(entry.key)}
              type="button"
            >
              {entry.icon}
              {entry.label}
            </button>
          );
        })}
      </nav>

      {tab === "identity" ? (
        <IdentityTab persona={persona} onChange={updatePersona} defaults={agent.defaults.persona} />
      ) : null}

      {tab === "capabilities" ? (
        <CapabilitiesTab
          capabilities={persona.capabilities}
          onAdd={addCapability}
          onRemove={removeCapability}
          onUpdate={updateCapability}
        />
      ) : null}

      {tab === "params" ? (
        <ParamsTab
          params={params}
          onChange={updateParams}
          defaults={{
            chatModel: agent.defaults.chatModel,
            topK: agent.defaults.topK,
            localConfidenceThreshold: agent.defaults.localConfidenceThreshold,
          }}
          availableModels={availableModels}
        />
      ) : null}

      {tab === "protocols" ? (
        <ProtocolsTab
          origin={agent.sector}
          protocols={protocols}
          onFeedback={onFeedback}
          onRefresh={onRefresh}
        />
      ) : null}

      {tab === "memory" ? <MemoryPlaceholder /> : null}
      {tab === "telemetry" ? <TelemetryPlaceholder /> : null}
    </>
  );
}

function IdentityTab({
  persona,
  onChange,
  defaults,
}: {
  persona: Persona;
  onChange: (updates: Partial<Persona>) => void;
  defaults: Persona;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--border)] bg-white p-4">
        <Field label="Nome de exibicao" hint={`Default: ${defaults.name}`}>
          <input
            className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
            onChange={(e) => onChange({ name: e.target.value })}
            value={persona.name}
          />
        </Field>
        <Field label="Resumo" hint={`Default: ${defaults.summary}`}>
          <input
            className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
            onChange={(e) => onChange({ summary: e.target.value })}
            value={persona.summary}
          />
        </Field>
        <Field label="Instructions (system prompt)" hint="Maximo 8000 caracteres.">
          <textarea
            className="min-h-[220px] w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 font-mono text-xs leading-relaxed"
            maxLength={8000}
            onChange={(e) => onChange({ instructions: e.target.value })}
            value={persona.instructions}
          />
        </Field>
      </div>

      <details className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-4">
        <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.18em] text-[var(--muted)]">
          Default original
        </summary>
        <pre className="mt-3 whitespace-pre-wrap rounded-md bg-white p-3 font-mono text-[11px] text-[var(--foreground-soft)]">
{defaults.instructions}
        </pre>
      </details>
    </div>
  );
}

function CapabilitiesTab({
  capabilities,
  onAdd,
  onRemove,
  onUpdate,
}: {
  capabilities: Capability[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, patch: Partial<Capability>) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--foreground-soft)]">
          Capacidades expostas alimentam o prompt e a lista de colaboradores que outros agentes podem consultar.
        </p>
        <button
          className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-xs font-bold hover:bg-[var(--surface-muted)]"
          onClick={onAdd}
          type="button"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar
        </button>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
              <th className="px-2 py-2">Nome</th>
              <th className="px-2 py-2">Descricao</th>
              <th className="px-2 py-2">Exposta</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {capabilities.map((cap, index) => (
              <tr className="border-t border-[var(--border)]" key={`${cap.id}-${index}`}>
                <td className="px-2 py-2">
                  <input
                    className="w-full rounded-md border border-[var(--border)] bg-white px-2 py-1.5 text-sm"
                    onChange={(e) => onUpdate(index, { name: e.target.value })}
                    value={cap.name}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    className="w-full rounded-md border border-[var(--border)] bg-white px-2 py-1.5 text-sm"
                    onChange={(e) => onUpdate(index, { description: e.target.value })}
                    value={cap.description}
                  />
                </td>
                <td className="px-2 py-2">
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-[var(--foreground-soft)]">
                    <input
                      checked={cap.isExposed}
                      onChange={(e) => onUpdate(index, { isExposed: e.target.checked })}
                      type="checkbox"
                    />
                    {cap.isExposed ? "Exposta" : "Interna"}
                  </label>
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-white px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50"
                    onClick={() => onRemove(index)}
                    type="button"
                  >
                    <Trash2 className="h-3 w-3" /> Remover
                  </button>
                </td>
              </tr>
            ))}
            {capabilities.length === 0 ? (
              <tr>
                <td className="px-2 py-4 text-xs text-[var(--muted)]" colSpan={4}>
                  Nenhuma capacidade definida. Adicione ao menos uma para enriquecer o prompt.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ParamsTab({
  params,
  onChange,
  defaults,
  availableModels,
}: {
  params: Params;
  onChange: (updates: Partial<Params>) => void;
  defaults: { chatModel: string; topK: number; localConfidenceThreshold: number };
  availableModels: string[];
}) {
  const modelOptions = useMemo(() => {
    const set = new Set([defaults.chatModel, params.chatModel, ...availableModels]);
    return Array.from(set).filter(Boolean);
  }, [availableModels, defaults.chatModel, params.chatModel]);

  return (
    <div className="grid gap-4 rounded-lg border border-[var(--border)] bg-white p-4 lg:grid-cols-2">
      <Field
        label="Modelo de chat (Ollama)"
        hint={`Default: ${defaults.chatModel}`}
      >
        {availableModels.length > 0 ? (
          <select
            className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
            onChange={(e) => onChange({ chatModel: e.target.value })}
            value={params.chatModel}
          >
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
            onChange={(e) => onChange({ chatModel: e.target.value })}
            placeholder="ex.: qwen3.5:4b"
            value={params.chatModel}
          />
        )}
        {availableModels.length === 0 ? (
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Lista de modelos indisponivel — Ollama offline. Insira manualmente.
          </p>
        ) : null}
      </Field>

      <Field
        label={`top-K = ${params.topK}`}
        hint={`Default: ${defaults.topK} (trechos recuperados para responder)`}
      >
        <input
          className="w-full"
          max={20}
          min={1}
          onChange={(e) => onChange({ topK: Number(e.target.value) })}
          type="range"
          value={params.topK}
        />
      </Field>

      <Field
        label={`Confianca local minima = ${params.localConfidenceThreshold.toFixed(2)}`}
        hint={`Default: ${defaults.localConfidenceThreshold.toFixed(2)} (abaixo disso, busca em outros setores)`}
      >
        <input
          className="w-full"
          max={1}
          min={0}
          onChange={(e) => onChange({ localConfidenceThreshold: Number(e.target.value) })}
          step={0.01}
          type="range"
          value={params.localConfidenceThreshold}
        />
      </Field>
    </div>
  );
}

function ProtocolsTab({
  origin,
  protocols,
  onFeedback,
  onRefresh,
}: {
  origin: Sector;
  protocols: ProtocolRow[];
  onFeedback: (msg: string | null) => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--border)] bg-white p-4">
        <p className="text-xs text-[var(--foreground-soft)]">
          Protocolos de delegacao a partir do agente {getSectorLabel(origin)}. Desativar um hop suspende a consulta intersetorial daquele par.
        </p>
      </div>
      {protocols.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">Nenhum protocolo configurado para este setor.</p>
      ) : null}
      {protocols.map((protocol) => (
        <ProtocolCard
          key={protocol.id}
          onFeedback={onFeedback}
          onRefresh={onRefresh}
          protocol={protocol}
        />
      ))}
    </div>
  );
}

function ProtocolCard({
  protocol,
  onFeedback,
  onRefresh,
}: {
  protocol: ProtocolRow;
  onFeedback: (msg: string | null) => void;
  onRefresh: () => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(protocol.enabled);
  const [template, setTemplate] = useState(protocol.template);
  const [maxTokens, setMaxTokens] = useState(protocol.maxTokens);
  const [saving, setSaving] = useState(false);

  const dirty =
    enabled !== protocol.enabled ||
    template !== protocol.template ||
    maxTokens !== protocol.maxTokens;

  async function patch(payload: Record<string, unknown>) {
    setSaving(true);
    onFeedback(null);
    try {
      const response = await fetch("/api/admin/protocols", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: protocol.from,
          to: protocol.to,
          intent: protocol.intent,
          ...payload,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `Falha ao salvar protocolo (${response.status})`);
      }
      await onRefresh();
    } catch (err) {
      onFeedback(err instanceof Error ? err.message : "Erro ao salvar protocolo");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="space-y-3 rounded-lg border border-[var(--border)] bg-white p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--muted)]">
            {protocol.from} → {protocol.to}
          </p>
          <p className="mt-0.5 text-sm font-black text-[var(--foreground-strong)]">
            {protocol.intent}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-[var(--muted)]">{protocol.id}</p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-bold">
          <input
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            type="checkbox"
          />
          {enabled ? "Ativo" : "Desativado"}
        </label>
      </header>
      <div>
        <Field label="Template" hint={`Max tokens: ${maxTokens}`}>
          <textarea
            className="min-h-[100px] w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 font-mono text-xs"
            onChange={(e) => setTemplate(e.target.value)}
            value={template}
          />
        </Field>
        <Field label={`maxTokens = ${maxTokens}`}>
          <input
            className="w-full"
            max={4096}
            min={32}
            onChange={(e) => setMaxTokens(Number(e.target.value))}
            step={32}
            type="range"
            value={maxTokens}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-xs font-black text-white disabled:opacity-50"
          disabled={!dirty || saving}
          onClick={() => patch({ enabled, template, maxTokens })}
          type="button"
        >
          <Save className="h-3.5 w-3.5" /> Salvar protocolo
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-xs font-bold text-[var(--foreground-soft)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
          disabled={saving}
          onClick={() => patch({ reset: true })}
          type="button"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Restaurar
        </button>
      </div>
    </article>
  );
}

function MemoryPlaceholder() {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-soft)] p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
            <Brain className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-black text-[var(--foreground-strong)]">
              Memoria do agente
            </p>
            <p className="text-xs text-[var(--foreground-soft)]">
              Em desenvolvimento. Permitira manter historico relevante de conversas, licoes do feedback e fatos consolidados por setor.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-xs font-bold text-[var(--muted)] opacity-70"
            disabled
            type="button"
          >
            Configurar politica de retencao
          </button>
          <button
            className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-xs font-bold text-[var(--muted)] opacity-70"
            disabled
            type="button"
          >
            Vincular store vetorial
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-dashed border-[var(--border)] bg-white p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
          Roadmap planejado
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--foreground-soft)]">
          <li>Memoria de curto prazo: ultimos turnos da conversa em cache.</li>
          <li>Memoria episodica: trilhas relevantes promovidas a partir de auditoria.</li>
          <li>Memoria semantica: extracao de fatos validados via curadoria.</li>
          <li>Memoria de feedback: lessons-learned acumuladas por setor.</li>
        </ul>
      </div>
    </div>
  );
}

function TelemetryPlaceholder() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--foreground-soft)]">
        Em desenvolvimento — integrara com os eventos persistidos em <code>audit_events</code> e <code>agent_calls</code>.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-dashed border-[var(--border)] bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            Latencia media
          </p>
          <p className="mt-2 text-2xl font-black text-[var(--muted)]">—</p>
          <p className="text-[10px] text-[var(--muted)]">tempo medio ate primeira resposta</p>
        </div>
        <div className="rounded-lg border border-dashed border-[var(--border)] bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            Taxa de delegacao
          </p>
          <p className="mt-2 text-2xl font-black text-[var(--muted)]">—</p>
          <p className="text-[10px] text-[var(--muted)]">% de respostas com hop intersetorial</p>
        </div>
        <div className="rounded-lg border border-dashed border-[var(--border)] bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            Qualidade
          </p>
          <p className="mt-2 text-2xl font-black text-[var(--muted)]">—</p>
          <p className="text-[10px] text-[var(--muted)]">apuracao agregada do feedback de usuarios</p>
        </div>
      </div>
      <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-soft)] p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
            <Database className="h-4 w-4" />
          </span>
          <p className="text-xs text-[var(--foreground-soft)]">
            Visao planejada: serie temporal por agente, breakdown por intent, comparativo com baseline default e alertas de regressao.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block py-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
      {hint ? (
        <span className="mt-1 block text-[11px] text-[var(--muted)]">{hint}</span>
      ) : null}
    </label>
  );
}
