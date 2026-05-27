import { redirect } from "next/navigation";
import {
  Archive,
  Bot,
  ClipboardCheck,
  Database,
  FileUp,
  Gauge,
  GitMerge,
  Lightbulb,
  MessageCircle,
  Network,
  ShieldCheck,
  UserCog,
  Workflow,
} from "lucide-react";

import { auth } from "@/auth";
import { KpiCard } from "@/components/admin-kpi-card";
import { DashboardActivityFeed } from "@/components/dashboard-activity-feed";
import { DashboardHealthStrip } from "@/components/dashboard-health-strip";
import { DashboardHero } from "@/components/dashboard-hero";
import { DashboardPillarCard } from "@/components/dashboard-pillar-card";
import { DashboardStartHere } from "@/components/dashboard-start-here";
import { SecureAppShell } from "@/components/secure-app-shell";
import { canReviewCorrections } from "@/lib/corrections/authorization";
import { getGreeting } from "@/lib/dashboard/greeting";
import { loadAdminMetrics, loadUserMetrics } from "@/lib/dashboard/metrics";
import { PERSONA_LABELS, SECTOR_LABELS } from "@/lib/labels";

function formatCount(value: number | null): string {
  if (value === null) {
    return "--";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }
  return value.toLocaleString("pt-BR");
}

export default async function HomePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const userCanReviewCorrections = await canReviewCorrections(session.user);

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    sector: session.user.sector,
    canReviewCorrections: userCanReviewCorrections,
  };

  const salutation = getGreeting();
  const persona = PERSONA_LABELS[user.sector];
  const sectorLabel = SECTOR_LABELS[user.sector];

  const isAdmin = user.role === "admin";

  if (isAdmin) {
    const metrics = await loadAdminMetrics();

    return (
      <SecureAppShell
        currentPage="dashboard"
        description={`${salutation}, ${user.name}. Visao executiva do Secure Agents: cuidado com a base de conhecimento, qualidade das respostas e oportunidades de automacao.`}
        title="Painel"
        user={user}
      >
        <DashboardHero
          name={user.name}
          salutation={salutation}
          sector={user.sector}
        />

        <section className="mb-6">
          <h3 className="mb-3 text-sm font-black uppercase tracking-[0.22em] text-[var(--muted)]">
            Indicadores principais
          </h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <KpiCard
              description="Documentos aguardando aprovacao"
              label="Curadoria pendente"
              tone={
                (metrics.kpis.curationPending ?? 0) > 10 ? "alert" : "default"
              }
              value={formatCount(metrics.kpis.curationPending)}
            />
            <KpiCard
              description="Perguntas de processo abertas"
              label="Gaps de processo"
              tone={(metrics.kpis.gapsOpen ?? 0) > 0 ? "info" : "default"}
              value={formatCount(metrics.kpis.gapsOpen)}
            />
            <KpiCard
              description="Sugestoes de correcao nas ultimas 24h"
              label="Feedback 24h"
              value={formatCount(metrics.kpis.feedback24h)}
            />
            <KpiCard
              description="Mensagens trocadas nas ultimas 24h"
              label="Mensagens 24h"
              value={formatCount(metrics.kpis.messages24h)}
            />
            <KpiCard
              description="Processos mapeados pela ferramenta"
              label="Processos mapeados"
              value={formatCount(metrics.kpis.processesMapped)}
            />
            <KpiCard
              description="Sugestoes de automacao em aberto"
              label="Candidatos auto."
              tone={
                (metrics.kpis.automationCandidates ?? 0) > 0
                  ? "success"
                  : "default"
              }
              value={formatCount(metrics.kpis.automationCandidates)}
            />
          </div>
        </section>

        <section className="mb-6">
          <h3 className="mb-3 text-sm font-black uppercase tracking-[0.22em] text-[var(--muted)]">
            Os cinco pilares do Secure Agents
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DashboardPillarCard
              accent="operation"
              description="Converse com o agente do seu setor e suba documentos para enriquecer o conhecimento da empresa."
              href="/chat"
              icon={MessageCircle}
              metric={{
                label: "Conversa rapida",
                value: persona,
              }}
              title="Operacao"
              bullets={[
                "Chat setorial com delegacao automatica",
                "Upload de PDF, .docx e Markdown em /files",
              ]}
            />
            <DashboardPillarCard
              accent="knowledge"
              description="Curadoria, consolidacao, grafo e reclassificacao de pessoas: tudo que mantem a base limpa e util."
              href="/admin/curation"
              icon={ClipboardCheck}
              metric={{
                label: "Pendentes",
                value: formatCount(metrics.kpis.curationPending),
              }}
              title="Conhecimento"
              bullets={[
                "Curadoria e aprovacao de documentos",
                "Mapa do conhecimento e consolidacao",
                "Reclassificacao de pessoas em entidades",
              ]}
            />
            <DashboardPillarCard
              accent="automation"
              description="Mapeamento de processos, identificacao de candidatos a automacao e gaps de documentacao."
              href="/admin/process-automation-map"
              icon={Workflow}
              metric={{
                label: "Candidatos",
                value: formatCount(metrics.kpis.automationCandidates),
              }}
              title="Automacao"
              bullets={[
                "Ranking por readiness de automacao",
                "Sugestoes do tipo de script ideal",
                "Encadeamento com a curadoria",
              ]}
            />
            <DashboardPillarCard
              accent="agents"
              description="Personas, instrucoes e parametros dos agentes setoriais; trilha completa de delegacoes."
              href="/admin/agents"
              icon={Bot}
              metric={{
                label: "Agentes ativos",
                value: formatCount(metrics.pillars.agentsConfigured),
              }}
              title="Agentes"
              bullets={[
                "Ajuste de persona e capabilities",
                "Historico de encaminhamentos",
                "Conteudo indexado por setor",
              ]}
            />
            <DashboardPillarCard
              accent="quality"
              description="Avaliacoes de respostas, perguntas sem resposta e propostas de correcao em trechos citados."
              href="/admin/governance?tab=feedback"
              icon={Gauge}
              metric={{
                label: "Avaliacoes ruins",
                value: formatCount(metrics.pillars.feedbackBad),
              }}
              title="Qualidade"
              bullets={[
                "Feedback bom/ruim por mensagem",
                "Sugestoes de correcao por setor",
                "Perguntas sem resposta para mapear",
              ]}
            />
            <DashboardPillarCard
              accent="knowledge"
              description="Como conceitos, sistemas, procedimentos e regulamentos se conectam na base."
              href="/admin/knowledge-graph"
              icon={Network}
              metric={{
                label: "Conceitos",
                value: formatCount(metrics.pillars.graphConcepts),
              }}
              title="Mapa do conhecimento"
              bullets={[
                "Visualizacao interativa do grafo",
                "Descoberta de SOPs",
                `${formatCount(metrics.pillars.graphDocuments)} documentos no grafo`,
              ]}
            />
          </div>
        </section>

        <DashboardHealthStrip health={metrics.health} />

        <DashboardActivityFeed events={metrics.activity} />

        <DashboardStartHere role={user.role} sector={user.sector} />

        <section className="rounded-[1.75rem] border border-[var(--border)] bg-white p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <Lightbulb aria-hidden="true" className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-black text-[var(--foreground-strong)]">
                Onde encontro o que?
              </h3>
              <p className="text-xs text-[var(--foreground-soft)]">
                Atalhos diretos para as paginas que sustentam o setor {sectorLabel} e o resto da operacao.
              </p>
            </div>
          </div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { href: "/chat", label: "Chat", icon: MessageCircle },
              { href: "/files", label: "Ingestao", icon: FileUp },
              { href: "/admin/curation", label: "Curadoria", icon: ClipboardCheck },
              { href: "/admin/consolidation", label: "Consolidacao", icon: GitMerge },
              { href: "/admin/knowledge-graph", label: "Mapa do conhecimento", icon: Network },
              { href: "/admin/people-reclassify", label: "Pessoas", icon: UserCog },
              { href: "/admin/process-automation-map", label: "Processos", icon: Workflow },
              { href: "/admin/agents", label: "Agentes", icon: Bot },
              { href: "/admin/governance", label: "Governança", icon: Gauge },
              { href: "/admin/audit", label: "Historico", icon: Archive },
              { href: "/admin/content", label: "Conteudo indexado", icon: Database },
            ].map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <a
                  className="group flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-sm font-black text-[var(--foreground-soft)] transition-colors hover:border-[var(--accent)] hover:bg-white hover:text-[var(--foreground-strong)]"
                  href={href}
                >
                  <Icon aria-hidden="true" className="h-4 w-4 text-[var(--muted)] group-hover:text-[var(--accent)]" />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </SecureAppShell>
    );
  }

  const metrics = await loadUserMetrics({
    id: user.id,
    sector: user.sector,
    role: user.role,
  });

  return (
    <SecureAppShell
      currentPage="dashboard"
      description={`${salutation}, ${user.name}. Visao geral do que voce pode fazer no Secure Agents.`}
      title="Painel"
      user={user}
    >
      <DashboardHero
        name={user.name}
        salutation={salutation}
        sector={user.sector}
      />

      <section className="mb-6">
        <h3 className="mb-3 text-sm font-black uppercase tracking-[0.22em] text-[var(--muted)]">
          Sua atividade
        </h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            description="Conversas iniciadas no seu usuario"
            label="Suas conversas"
            value={formatCount(metrics.kpis.yourConversations)}
          />
          <KpiCard
            description="Mensagens trocadas nos ultimos 7 dias"
            label="Mensagens 7d"
            value={formatCount(metrics.kpis.messages7d)}
          />
          <KpiCard
            description={`Documentos publicados em ${sectorLabel}`}
            label="Docs do setor"
            value={formatCount(metrics.kpis.sectorDocuments)}
          />
          <KpiCard
            description="Correcoes que voce sugeriu"
            label="Correcoes enviadas"
            value={formatCount(metrics.kpis.yourCorrections)}
          />
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-3 text-sm font-black uppercase tracking-[0.22em] text-[var(--muted)]">
          O que voce pode fazer
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <DashboardPillarCard
            accent="operation"
            bullets={[
              "Pergunte em linguagem natural",
              "Veja citacoes dos documentos usados",
              "Avalie respostas e proponha ajustes",
            ]}
            description="Converse com o agente do seu setor. Quando o assunto pertence a outra area, ele encaminha e traz a resposta certa."
            href="/chat"
            icon={MessageCircle}
            metric={{ label: "Agente", value: persona }}
            title="Conversar"
          />
          <DashboardPillarCard
            accent="knowledge"
            bullets={[
              "Aceita PDF, .docx, .doc e Markdown",
              "Documento passa por curadoria antes do chat",
              "Voce acompanha o status na pagina de ingestao",
            ]}
            description="Suba documentos do seu setor. Eles enriquecem a base e ficam disponiveis para todos depois da curadoria."
            href="/files"
            icon={FileUp}
            title="Enviar documentos"
          />
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-3 text-sm font-black uppercase tracking-[0.22em] text-[var(--muted)]">
          Mais sobre o Secure Agents
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <DashboardPillarCard
            accent="knowledge"
            description="Administradores curam, consolidam e mapeiam o conhecimento que voce consome no chat."
            icon={ClipboardCheck}
            interactive={false}
            title="Conhecimento curado"
          />
          <DashboardPillarCard
            accent="automation"
            description="Processos do dia a dia sao mapeados e podem virar automacoes monitoradas."
            icon={Workflow}
            interactive={false}
            title="Automacao de processos"
          />
          <DashboardPillarCard
            accent="agents"
            description={`Cada setor tem seu agente. Voce conversa com ${persona}; outras areas conversam com agentes proprios.`}
            icon={Bot}
            interactive={false}
            title="Agentes setoriais"
          />
        </div>
      </section>

      <DashboardHealthStrip health={metrics.health} />

      <DashboardStartHere role={user.role} sector={user.sector} />

      <section className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--surface-soft)] p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
            <ShieldCheck aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-base font-black text-[var(--foreground-strong)]">
              Tudo isolado pelo seu setor
            </h3>
            <p className="text-xs text-[var(--foreground-soft)]">
              Voce so conversa com {persona}. Quando uma resposta envolve outra area, o sistema delega
              de forma transparente e mostra a trilha de quem respondeu.
            </p>
          </div>
        </div>
      </section>
    </SecureAppShell>
  );
}
