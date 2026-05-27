"use client";

import { useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Name suggestion engine
// Two modes: "display" (sector display names) and "agent" (agent persona names)
// ---------------------------------------------------------------------------

type DomainEntry = {
  keywords: string[];
  displayNames: [string, string, string];
  agentNames: [string, string, string];
};

const DOMAIN_MAP: DomainEntry[] = [
  {
    // Financeiro — cofre guarda o valor, balança equilibra, ledger registra
    keywords: ["financeiro", "finance", "tesoureiro", "pagamento", "conta", "contabil", "orcamento", "fatura", "receita", "despesa", "contabilidade", "fluxo"],
    displayNames: ["Financeiro / Controladoria", "Gestao Financeira", "Contabilidade e Tesouraria"],
    agentNames: ["Cofre", "Balanca", "Ledger"],
  },
  {
    // RH — colmeia (comunidade organizada), teia (conexoes entre pessoas), laço (vinculo)
    keywords: ["rh", "recursos-humanos", "pessoas", "beneficios", "ferias", "folha", "admissao", "demissao", "talentos", "onboarding", "clima", "cultura"],
    displayNames: ["RH / Gestao de Pessoas", "Recursos Humanos", "Talentos e Cultura"],
    agentNames: ["Colmeia", "Teia", "Laco"],
  },
  {
    // Logística — rota (caminho), carteiro (quem entrega), estiva (carga organizada)
    keywords: ["logistica", "entrega", "transporte", "carga", "frete", "expedicao", "armazem", "despacho", "distribuicao", "rota", "rastreamento"],
    displayNames: ["Logistica e Distribuicao", "Supply Chain", "Expedicao e Transporte"],
    agentNames: ["Rota", "Carteiro", "Estiva"],
  },
  {
    // Jurídico — codex (livro da lei), preceito (regra fundamental), escudo (proteção)
    keywords: ["juridico", "legal", "contrato", "compliance", "lei", "norma", "regulatorio", "auditoria", "licenca", "risco", "privacidade", "lgpd"],
    displayNames: ["Juridico / Compliance", "Assessoria Legal", "Governanca e Risco"],
    agentNames: ["Codex", "Preceito", "Escudo"],
  },
  {
    // Compras — barganha (negociação), trilho (caminho da aquisição), mercado (onde se compra)
    keywords: ["compras", "fornecedor", "cotacao", "negociacao", "procurement", "licitacao", "pedido", "aquisicao", "catalogo"],
    displayNames: ["Compras e Suprimentos", "Procurement", "Negociacao e Fornecedores"],
    agentNames: ["Barganha", "Trilho", "Mercado"],
  },
  {
    // Marketing — eco (repercussão), pulso (presença viva), voz (comunicação)
    keywords: ["marketing", "publicidade", "marca", "campanha", "midia", "conteudo", "crm", "relacionamento"],
    displayNames: ["Marketing e Comunicacao", "Gestao de Marca", "CRM e Relacionamento"],
    agentNames: ["Eco", "Pulso", "Voz"],
  },
  {
    // Vendas — impulso (força de venda), alvo (meta), crivo (qualificação do lead)
    keywords: ["vendas", "comercial", "proposta", "oportunidade", "pipeline", "quota", "meta", "prospeccao", "cliente"],
    displayNames: ["Comercial / Vendas", "Forca de Vendas", "Gestao Comercial"],
    agentNames: ["Impulso", "Alvo", "Crivo"],
  },
  {
    // Operações — engrenagem (tudo funcionando), calibre (precisão), malha (rede de processos)
    keywords: ["operacoes", "processo", "qualidade", "melhoria", "kpi", "indicador", "producao", "manufatura", "planta", "lean"],
    displayNames: ["Operacoes e Processos", "Qualidade e Melhoria Continua", "Gestao de Producao"],
    agentNames: ["Engrenagem", "Calibre", "Malha"],
  },
  {
    // Segurança — sentinela (já existente), cipher (criptografia), vigia (observador)
    keywords: ["seguranca", "security", "vulnerabilidade", "incidente", "pentest", "firewall", "cyber", "soc", "iam", "autenticacao"],
    displayNames: ["Seguranca da Informacao", "Ciberseguranca / SOC", "Seguranca e Identidade"],
    agentNames: ["Sentinela", "Cipher", "Vigia"],
  },
  {
    // TI — nucleo (core da infra), backbone (espinha dorsal), stack (camadas de tech)
    keywords: ["ti", "tecnologia", "sistemas", "infraestrutura", "cloud", "servidor", "rede", "datacenter", "devops", "plataforma", "sre"],
    displayNames: ["TI / Infraestrutura", "Tecnologia e Plataformas", "Engenharia de Sistemas"],
    agentNames: ["Nucleo", "Backbone", "Stack"],
  },
  {
    // Suporte — nexo (ponto de conexão), ancora (estabilidade), elo (ligação entre usuário e TI)
    keywords: ["suporte", "helpdesk", "atendimento", "chamado", "ticket", "sla", "service-desk", "nivel1", "nivel2"],
    displayNames: ["Suporte / Help Desk", "Atendimento ao Usuario", "Service Desk N1/N2"],
    agentNames: ["Nexo", "Ancora", "Elo"],
  },
  {
    // Desenvolvimento — forja (já existente), cinzel (ferramenta de escultura/código), kernel (núcleo do sistema)
    keywords: ["desenvolvimento", "dev", "software", "codigo", "programacao", "api", "backend", "frontend", "engenharia", "arquitetura"],
    displayNames: ["Desenvolvimento de Software", "Engenharia de Software", "Dev / Arquitetura"],
    agentNames: ["Forja", "Cinzel", "Kernel"],
  },
  {
    // Desktop — mesa (workstation), bancada (onde se trabalha), oficina (onde se conserta)
    keywords: ["desktop", "workstation", "estacao", "computador", "hardware", "dispositivo", "endpoint", "impressora"],
    displayNames: ["Desktop e Endpoints", "Suporte de Hardware", "Estacoes e Perifericos"],
    agentNames: ["Mesa", "Bancada", "Oficina"],
  },
  {
    // Saúde — cura (objetivo final), balsamo (alívio), remedium (remédio)
    keywords: ["saude", "medico", "clinico", "farmacia", "laboratorio", "enfermagem", "paciente", "prescricao", "hospitalar"],
    displayNames: ["Saude e Clinica", "Gestao de Saude", "Assistencia Clinica"],
    agentNames: ["Cura", "Balsamo", "Remedium"],
  },
  {
    // Educação — agora (praça grega do saber), pergaminho (conhecimento registrado), tribuna (onde se ensina)
    keywords: ["educacao", "treinamento", "capacitacao", "ensino", "aprendizado", "curso", "academico", "formacao", "ead"],
    displayNames: ["Educacao e Treinamento", "Capacitacao e Desenvolvimento", "Gestao do Conhecimento"],
    agentNames: ["Agora", "Pergaminho", "Tribuna"],
  },
  {
    // Dados — oraculo (quem responde com base em dados), prism (refrata a informação), lente (enxergar o que não é óbvio)
    keywords: ["dados", "analytics", "bi", "relatorio", "dashboard", "inteligencia", "estatistica", "machine-learning", "ia", "data", "pipeline"],
    displayNames: ["Dados e Analytics", "Business Intelligence", "Inteligencia de Dados"],
    agentNames: ["Oraculo", "Prism", "Lente"],
  },
  {
    // Inovação — farol (guia o caminho novo), centelha (a faísca inicial), prova (protótipo validado)
    keywords: ["inovacao", "pesquisa", "lab", "prototipo", "startup", "produto", "discovery", "ux", "design"],
    displayNames: ["Inovacao e Produto", "Lab de Inovacao", "Pesquisa e Desenvolvimento"],
    agentNames: ["Farol", "Centelha", "Prova"],
  },
  {
    // Projetos — bussola (direção), prumo (vertical e preciso), compasso (mede e traça)
    keywords: ["projetos", "pmo", "gerenciamento", "cronograma", "escopo", "sprint", "agil", "scrum"],
    displayNames: ["Gestao de Projetos / PMO", "Projetos e Entregas", "Agile / PMO"],
    agentNames: ["Bussola", "Prumo", "Compasso"],
  },
  {
    // Comunicação interna — canal (meio), eco (repercussão interna), tribuna (voz oficial)
    keywords: ["comunicacao-interna", "intranet", "noticias", "avisos", "endomarketing", "engajamento"],
    displayNames: ["Comunicacao Interna", "Endomarketing", "Noticias e Avisos"],
    agentNames: ["Canal", "Tribuno", "Mural"],
  },
  {
    // Visitantes — soleira (limiar de entrada), portal (o ponto de acesso), vestibulo (espaço de chegada)
    keywords: ["visitantes", "visitas", "recepcao", "recepcionist", "portaria", "credenciamento", "badge", "lobby", "convidado"],
    displayNames: ["Visitantes e Recepcao", "Portaria e Controle de Acesso", "Gestao de Visitas"],
    agentNames: ["Soleira", "Portal", "Vestibulo"],
  },
  {
    // Facilities — alicerce (base estrutural), pilar (sustenta tudo), argamassa (une as partes)
    keywords: ["facilities", "predial", "manutencao", "limpeza", "conservacao", "patrimonio", "ativo", "veiculo", "frota"],
    displayNames: ["Facilities / Predial", "Manutencao e Conservacao", "Gestao de Ativos"],
    agentNames: ["Alicerce", "Pilar", "Argamassa"],
  },
  {
    // Fiscal — erário (tesouro público), talao (nota fiscal), cartorio (registro oficial)
    keywords: ["fiscal", "tributario", "imposto", "nota-fiscal", "sped", "obrigacao-acessoria", "efd"],
    displayNames: ["Fiscal / Tributario", "Gestao Tributaria", "Obrigacoes Fiscais"],
    agentNames: ["Erario", "Talao", "Cartorio"],
  },
  {
    // Almoxarifado — arsenal (estoque de recursos), galpao (onde tudo é guardado), estofa (material organizado)
    keywords: ["almoxarifado", "almox", "material", "consumo", "requisicao", "inventario"],
    displayNames: ["Almoxarifado e Materiais", "Gestao de Estoque", "Requisicoes e Consumo"],
    agentNames: ["Arsenal", "Galpao", "Estofa"],
  },
];

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-\s]/g, " ");
}

function findBestDomainEntry(slug: string, hint: string): DomainEntry | null {
  const haystack = normalize(`${slug} ${hint}`);
  const tokens = haystack.split(/[\s-]+/);
  let bestMatch: DomainEntry | null = null;
  let bestScore = 0;

  for (const entry of DOMAIN_MAP) {
    let score = 0;
    for (const kw of entry.keywords) {
      const normalKw = normalize(kw);
      if (haystack.includes(normalKw)) score += 2;
      else if (tokens.some((t) => normalKw.startsWith(t) && t.length >= 3)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }
  return bestMatch;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function genericFallback(slug: string, mode: "display" | "agent"): [string, string, string] {
  const tokens = normalize(slug)
    .split(/[\s-]+/)
    .filter((t) => t.length >= 4 && !["para", "com", "dos", "das", "setor", "area"].includes(t));
  const base = cap(tokens[0] ?? slug.slice(0, 8));
  const base2 = tokens[1] ? cap(tokens[1]) : "";
  if (mode === "display") {
    return [
      `Setor de ${base}${base2 ? " / " + base2 : ""}`,
      `Gestao de ${base}`,
      `${base}${base2 ? " e " + base2 : ""}`,
    ];
  }
  // For agent names: derive evocative single words from the slug tokens
  const root = base;
  return [root, `${root}x`, `Agente${root}`];
}

function generateDisplayNameSuggestions(slug: string): [string, string, string] {
  const entry = findBestDomainEntry(slug, "");
  return entry ? entry.displayNames : genericFallback(slug, "display");
}

function generateAgentNameSuggestions(slug: string, displayName: string): [string, string, string] {
  const entry = findBestDomainEntry(slug, displayName);
  return entry ? entry.agentNames : genericFallback(slug, "agent");
}

type Capability = {
  id: string;
  name: string;
  description: string;
  isExposed: boolean;
};

type FormData = {
  slug: string;
  displayName: string;
  description: string;
  agentName: string;
  agentSummary: string;
  agentInstructions: string;
  capabilities: Capability[];
  chatModel: string;
  topK: number;
  localConfidenceThreshold: number;
};

const DEFAULT_INSTRUCTIONS = `Voce e um agente especializado.
Responda apenas com base nos documentos recuperados do seu setor.
Nao invente informacoes fora do contexto recuperado.
Quando consultado por outros agentes, seja preciso e objetivo.`;

const STEPS = [
  { key: "details", label: "Detalhes" },
  { key: "identity", label: "Identidade IA" },
  { key: "capabilities", label: "Capacidades" },
  { key: "provision", label: "Provisionamento" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

function canAdvance(step: StepKey, form: FormData): boolean {
  if (step === "details") {
    return (
      /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/.test(form.slug) &&
      form.displayName.trim().length >= 1
    );
  }
  if (step === "identity") {
    return (
      form.agentName.trim().length >= 1 &&
      form.agentSummary.trim().length >= 1 &&
      form.agentInstructions.trim().length >= 1
    );
  }
  return true;
}

export function CreateAgentDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<StepKey>("details");
  const [form, setForm] = useState<FormData>({
    slug: "",
    displayName: "",
    description: "",
    agentName: "",
    agentSummary: "",
    agentInstructions: DEFAULT_INSTRUCTIONS,
    capabilities: [],
    chatModel: "",
    topK: 6,
    localConfidenceThreshold: 0.35,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  function patch(updates: Partial<FormData>) {
    setForm((prev) => ({ ...prev, ...updates }));
  }

  function addCapability() {
    patch({
      capabilities: [
        ...form.capabilities,
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
    patch({ capabilities: form.capabilities.filter((_, i) => i !== index) });
  }

  function updateCapability(index: number, updates: Partial<Capability>) {
    patch({
      capabilities: form.capabilities.map((cap, i) =>
        i === index ? { ...cap, ...updates } : cap,
      ),
    });
  }

  function goNext() {
    const next = STEPS[stepIndex + 1];
    if (next) setStep(next.key);
  }

  function goBack() {
    const prev = STEPS[stepIndex - 1];
    if (prev) setStep(prev.key);
  }

  function handleClose() {
    setStep("details");
    setError(null);
    onClose();
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        slug: form.slug,
        displayName: form.displayName,
        agentName: form.agentName,
        agentSummary: form.agentSummary,
        agentInstructions: form.agentInstructions,
        topK: form.topK,
        localConfidenceThreshold: form.localConfidenceThreshold,
      };
      if (form.description.trim()) payload.description = form.description;
      if (form.chatModel.trim()) payload.chatModel = form.chatModel;
      if (form.capabilities.length > 0) payload.capabilities = form.capabilities;

      const response = await fetch("/api/admin/sectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `Erro ${response.status}`);
      }
      onCreated();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar agente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        aria-label="Fechar"
        className="flex-1 bg-black/30"
        onClick={handleClose}
        type="button"
      />
      <div className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
              Novo agente
            </p>
            <h2 className="mt-0.5 text-lg font-black text-[var(--foreground-strong)]">
              Provisionar setor
            </h2>
          </div>
          <button
            className="rounded-md p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)]"
            onClick={handleClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex items-center gap-1 border-b border-[var(--border)] bg-[var(--surface-soft)] px-6 py-3">
          {STEPS.map((s, i) => {
            const done = i < stepIndex;
            const active = s.key === step;
            return (
              <div key={s.key} className="flex items-center gap-1.5">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${
                    done || active
                      ? "bg-[var(--accent)] text-white"
                      : "bg-[var(--border)] text-[var(--muted)]"
                  }`}
                >
                  {done ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span
                  className={`text-[11px] font-bold whitespace-nowrap ${
                    active
                      ? "text-[var(--foreground-strong)]"
                      : "text-[var(--muted)]"
                  }`}
                >
                  {s.label}
                </span>
                {i < STEPS.length - 1 ? (
                  <ChevronRight className="mx-1 h-3 w-3 shrink-0 text-[var(--border)]" />
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === "details" && <DetailsStep form={form} onChange={patch} />}
          {step === "identity" && (
            <IdentityStep
              form={form}
              onChange={patch}
              sectorSlug={form.slug}
              sectorDisplayName={form.displayName}
            />
          )}
          {step === "capabilities" && (
            <CapabilitiesStep
              capabilities={form.capabilities}
              onAdd={addCapability}
              onRemove={removeCapability}
              onUpdate={updateCapability}
            />
          )}
          {step === "provision" && (
            <ProvisionStep form={form} onChange={patch} />
          )}
          {error ? (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-between border-t border-[var(--border)] px-6 py-4">
          <button
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 py-2 text-xs font-bold text-[var(--foreground-soft)] hover:bg-[var(--surface-muted)] disabled:opacity-40"
            disabled={stepIndex === 0}
            onClick={goBack}
            type="button"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Voltar
          </button>
          {stepIndex < STEPS.length - 1 ? (
            <button
              className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-xs font-black text-white shadow-sm disabled:opacity-40"
              disabled={!canAdvance(step, form)}
              onClick={goNext}
              type="button"
            >
              Proximo <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-xs font-black text-white shadow-sm disabled:opacity-40"
              disabled={submitting}
              onClick={submit}
              type="button"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Provisionando...
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" /> Criar e provisionar
                </>
              )}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function DetailsStep({
  form,
  onChange,
}: {
  form: FormData;
  onChange: (p: Partial<FormData>) => void;
}) {
  const [displaySuggestions, setDisplaySuggestions] = useState<string[]>([]);
  const [displaySuggestionsVisible, setDisplaySuggestionsVisible] = useState(false);
  const [loadingDisplaySuggestions, setLoadingDisplaySuggestions] = useState(false);
  const [displaySuggestionError, setDisplaySuggestionError] = useState<string | null>(null);

  const slugValid =
    form.slug.length === 0 || /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/.test(form.slug);

  const slugReady = form.slug.length >= 3;

  async function showDisplaySuggestions() {
    setLoadingDisplaySuggestions(true);
    setDisplaySuggestionsVisible(false);
    setDisplaySuggestionError(null);

    try {
      const response = await fetch("/api/admin/agent-name-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: form.slug, displayName: "", mode: "display" }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `Erro ${response.status}`);
      }

      const data = (await response.json()) as { names: string[] };
      if (!data.names?.length) throw new Error("Nenhum nome retornado.");

      setDisplaySuggestions(data.names);
      setDisplaySuggestionsVisible(true);
    } catch (err) {
      const fallback = generateDisplayNameSuggestions(form.slug);
      setDisplaySuggestions(fallback);
      setDisplaySuggestionsVisible(true);
      setDisplaySuggestionError(
        `Modelo indisponivel — sugestoes pre-definidas. (${err instanceof Error ? err.message : "erro"})`,
      );
    } finally {
      setLoadingDisplaySuggestions(false);
    }
  }

  function pickDisplayName(name: string) {
    onChange({ displayName: name });
    setDisplaySuggestionsVisible(false);
    setDisplaySuggestionError(null);
  }

  return (
    <div className="space-y-4">
      <DrawerField
        label="Slug do setor"
        hint="Identificador unico: letras minusculas, numeros e hifens. Ex: financeiro-ap"
      >
        <input
          className={`w-full rounded-md border px-3 py-2 font-mono text-sm ${
            slugValid
              ? "border-[var(--border)] bg-white"
              : "border-red-300 bg-red-50"
          }`}
          maxLength={50}
          onChange={(e) => {
            onChange({
              slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
            });
            setDisplaySuggestionsVisible(false);
          }}
          placeholder="ex: financeiro-ap"
          value={form.slug}
        />
        {!slugValid ? (
          <span className="mt-1 block text-[11px] text-red-600">
            Minimo 3 caracteres, comeca e termina com letra ou numero.
          </span>
        ) : null}
      </DrawerField>

      <div>
        <div className="flex items-center justify-between py-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
            Nome de exibicao
          </span>
          <button
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors ${
              slugReady && !loadingDisplaySuggestions
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white"
                : "cursor-not-allowed border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted)] opacity-50"
            }`}
            disabled={!slugReady || loadingDisplaySuggestions}
            onClick={showDisplaySuggestions}
            title={slugReady ? "Gerar sugestoes com IA" : "Preencha o slug primeiro"}
            type="button"
          >
            {loadingDisplaySuggestions ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Gerando...
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" /> Sugerir nomes
              </>
            )}
          </button>
        </div>
        <input
          className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
          maxLength={80}
          onChange={(e) => {
            onChange({ displayName: e.target.value });
            setDisplaySuggestionsVisible(false);
          }}
          placeholder="ex: Visitantes e Recepcao"
          value={form.displayName}
        />
        <span className="mt-1 block text-[11px] text-[var(--muted)]">
          Nome visivel no painel e nas conversas.
        </span>

        {displaySuggestionsVisible && displaySuggestions.length > 0 ? (
          <div className="mt-2 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">
              Sugestoes para &ldquo;{form.slug}&rdquo;
            </p>
            {displaySuggestionError ? (
              <p className="mb-2 text-[10px] text-amber-700">{displaySuggestionError}</p>
            ) : null}
            <div className="flex flex-col gap-1.5">
              {displaySuggestions.map((name) => (
                <button
                  className="w-full rounded-md border border-[var(--accent)] bg-white px-3 py-2 text-left text-xs font-black text-[var(--foreground-strong)] shadow-sm transition-all hover:bg-[var(--accent)] hover:text-white"
                  key={name}
                  onClick={() => pickDisplayName(name)}
                  type="button"
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[10px] text-[var(--foreground-soft)]">
                Clique para usar. Voce pode editar depois.
              </p>
              <button
                className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--accent)] hover:underline disabled:opacity-50"
                disabled={loadingDisplaySuggestions}
                onClick={showDisplaySuggestions}
                type="button"
              >
                {loadingDisplaySuggestions ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : null}
                Gerar outros
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <DrawerField
        label="Descricao (opcional)"
        hint="Finalidade do setor em ate 400 caracteres."
      >
        <textarea
          className="min-h-[80px] w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
          maxLength={400}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Descreva brevemente o setor..."
          value={form.description}
        />
      </DrawerField>
    </div>
  );
}

function IdentityStep({
  form,
  onChange,
  sectorSlug,
  sectorDisplayName,
}: {
  form: FormData;
  onChange: (p: Partial<FormData>) => void;
  sectorSlug: string;
  sectorDisplayName: string;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsVisible, setSuggestionsVisible] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  async function showSuggestions() {
    setLoadingSuggestions(true);
    setSuggestionsVisible(false);
    setSuggestionError(null);

    try {
      const response = await fetch("/api/admin/agent-name-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: sectorSlug, displayName: sectorDisplayName }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `Erro ${response.status}`);
      }

      const data = (await response.json()) as { names: string[] };
      if (!data.names?.length) throw new Error("Nenhum nome retornado.");

      setSuggestions(data.names);
      setSuggestionsVisible(true);
    } catch (err) {
      // Fallback to hardcoded map so the user is never left empty-handed
      const fallback = generateAgentNameSuggestions(sectorSlug, sectorDisplayName);
      setSuggestions(fallback);
      setSuggestionsVisible(true);
      setSuggestionError(
        `Modelo indisponivel — exibindo sugestoes pre-definidas. (${err instanceof Error ? err.message : "erro"})`,
      );
    } finally {
      setLoadingSuggestions(false);
    }
  }

  function pickSuggestion(name: string) {
    onChange({ agentName: name });
    setSuggestionsVisible(false);
    setSuggestionError(null);
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between py-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
            Nome do agente
          </span>
          <button
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-bold text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loadingSuggestions}
            onClick={showSuggestions}
            type="button"
          >
            {loadingSuggestions ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Gerando...
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" /> Sugerir nomes
              </>
            )}
          </button>
        </div>
        <input
          className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
          maxLength={80}
          onChange={(e) => {
            onChange({ agentName: e.target.value });
            setSuggestionsVisible(false);
          }}
          placeholder="ex: Forja"
          value={form.agentName}
        />
        <span className="mt-1 block text-[11px] text-[var(--muted)]">
          Uma unica palavra evocativa que personifica o agente.
        </span>

        {suggestionsVisible && suggestions.length > 0 ? (
          <div className="mt-2 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">
              Sugestoes para &ldquo;{sectorDisplayName || sectorSlug}&rdquo;
            </p>
            {suggestionError ? (
              <p className="mb-2 text-[10px] text-amber-700">{suggestionError}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {suggestions.map((name) => (
                <button
                  className="rounded-full border border-[var(--accent)] bg-white px-3 py-1.5 text-xs font-black text-[var(--foreground-strong)] shadow-sm transition-all hover:bg-[var(--accent)] hover:text-white"
                  key={name}
                  onClick={() => pickSuggestion(name)}
                  type="button"
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[10px] text-[var(--foreground-soft)]">
                Clique para usar. Voce pode editar depois.
              </p>
              <button
                className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--accent)] hover:underline disabled:opacity-50"
                disabled={loadingSuggestions}
                onClick={showSuggestions}
                type="button"
              >
                <Loader2 className={`h-3 w-3 ${loadingSuggestions ? "animate-spin" : "hidden"}`} />
                Gerar outros
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <DrawerField
        label="Resumo do agente"
        hint="Uma frase descrevendo o papel do agente."
      >
        <input
          className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
          maxLength={400}
          onChange={(e) => onChange({ agentSummary: e.target.value })}
          placeholder="ex: Especialista em pagamentos, conciliacao e fluxo de caixa."
          value={form.agentSummary}
        />
      </DrawerField>
      <DrawerField
        label="Instructions (system prompt)"
        hint="Maximo 8000 caracteres."
      >
        <textarea
          className="min-h-[220px] w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 font-mono text-xs leading-relaxed"
          maxLength={8000}
          onChange={(e) => onChange({ agentInstructions: e.target.value })}
          value={form.agentInstructions}
        />
      </DrawerField>
    </div>
  );
}

function CapabilitiesStep({
  capabilities,
  onAdd,
  onRemove,
  onUpdate,
}: {
  capabilities: Capability[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  onUpdate: (i: number, p: Partial<Capability>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--foreground-soft)]">
          Capacidades alimentam o prompt e sao visiveis para outros agentes quando
          marcadas como expostas.
        </p>
        <button
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-muted)]"
          onClick={onAdd}
          type="button"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar
        </button>
      </div>
      {capabilities.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface-soft)] p-4 text-center text-xs text-[var(--muted)]">
          Nenhuma capacidade definida. Voce pode adicionar depois da criacao.
        </div>
      ) : null}
      <div className="space-y-2">
        {capabilities.map((cap, i) => (
          <div
            className="rounded-md border border-[var(--border)] bg-[var(--surface-soft)] p-3"
            key={cap.id}
          >
            <div className="flex gap-2">
              <div className="flex-1 space-y-2">
                <input
                  className="w-full rounded-md border border-[var(--border)] bg-white px-2 py-1.5 text-xs"
                  onChange={(e) => onUpdate(i, { name: e.target.value })}
                  placeholder="Nome da capacidade"
                  value={cap.name}
                />
                <input
                  className="w-full rounded-md border border-[var(--border)] bg-white px-2 py-1.5 text-xs"
                  onChange={(e) => onUpdate(i, { description: e.target.value })}
                  placeholder="Descricao"
                  value={cap.description}
                />
              </div>
              <div className="flex flex-col items-end justify-between gap-2">
                <button
                  className="rounded-md border border-[var(--border)] p-1.5 text-red-600 hover:bg-red-50"
                  onClick={() => onRemove(i)}
                  type="button"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                <label className="flex items-center gap-1 text-[11px] font-bold text-[var(--foreground-soft)]">
                  <input
                    checked={cap.isExposed}
                    onChange={(e) => onUpdate(i, { isExposed: e.target.checked })}
                    type="checkbox"
                  />
                  Exposta
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProvisionStep({
  form,
  onChange,
}: {
  form: FormData;
  onChange: (p: Partial<FormData>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
          Resumo do provisionamento
        </p>
        <dl className="mt-3 space-y-1.5 text-xs">
          <SummaryRow label="Slug" value={<span className="font-mono">{form.slug}</span>} />
          <SummaryRow label="Setor" value={form.displayName} />
          <SummaryRow label="Agente" value={form.agentName} />
          <SummaryRow label="Resumo" value={form.agentSummary} />
          <SummaryRow
            label="Capacidades"
            value={`${form.capabilities.length} definidas`}
          />
        </dl>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-white p-4">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
          Parametros avancados
        </p>
        <div className="space-y-3">
          <DrawerField
            hint=""
            label="Modelo de chat (vazio = padrao do sistema)"
          >
            <input
              className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
              onChange={(e) => onChange({ chatModel: e.target.value })}
              placeholder="ex: qwen3.5:4b"
              value={form.chatModel}
            />
          </DrawerField>
          <DrawerField
            hint="Quantidade de trechos recuperados para responder"
            label={`top-K = ${form.topK}`}
          >
            <input
              className="w-full"
              max={20}
              min={1}
              onChange={(e) => onChange({ topK: Number(e.target.value) })}
              type="range"
              value={form.topK}
            />
          </DrawerField>
          <DrawerField
            hint="Abaixo disto, busca em outros setores"
            label={`Confianca local minima = ${form.localConfidenceThreshold.toFixed(2)}`}
          >
            <input
              className="w-full"
              max={1}
              min={0}
              onChange={(e) =>
                onChange({ localConfidenceThreshold: Number(e.target.value) })
              }
              step={0.01}
              type="range"
              value={form.localConfidenceThreshold}
            />
          </DrawerField>
        </div>
      </div>

      <div className="rounded-md border border-[var(--border)] bg-[var(--surface-soft)] p-3">
        <p className="text-[11px] text-[var(--foreground-soft)]">
          O sistema criara automaticamente: conteudo publicado, area de revisao,
          fila interna de encaminhamento e registro de acesso intersetorial.
        </p>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 font-bold text-[var(--foreground-soft)]">{label}:</dt>
      <dd className="text-[var(--foreground-strong)]">{value}</dd>
    </div>
  );
}

function DrawerField({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
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
