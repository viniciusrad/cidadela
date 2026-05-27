import Link from "next/link";
import type { ReactNode } from "react";
import {
  Bot,
  BotMessageSquare,
  Bell,
  ClipboardCheck,
  Database,
  FileUp,
  Gauge,
  GitMerge,
  LayoutDashboard,
  Network,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";

import { LogoutButton } from "@/components/logout-button";
import { PendenciesBadge } from "@/components/pendencies-badge";
import { NotificationsBadge } from "@/components/notifications-badge";
import { SidebarNav } from "@/components/sidebar-nav";
import type { Sector, UserRole } from "@/lib/domain";
import { SECTOR_LABELS } from "@/lib/labels";

type ShellUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  sector: Sector;
  canReviewCorrections?: boolean;
};

type ShellPage =
  | "dashboard"
  | "pendencies"
  | "notifications"
  | "persons"
  | "chat"
  | "files"
  | "audit"
  | "content"
  | "curation"
  | "consolidation"
  | "knowledgeGraph"
  | "peopleReclassify"
  | "governance"
  | "agents"
  | "processAutomationMap";

type NavGroup = "operation" | "knowledge" | "governance";

const PAGE_LINKS: Array<{
  key: ShellPage;
  href: string;
  label: string;
  description: string;
  group: NavGroup;
  icon: ReactNode;
  adminOnly?: boolean;
  reviewerOnly?: boolean;
}> = [
  {
    key: "dashboard",
    href: "/",
    label: "Painel",
    description: "Visao geral",
    group: "operation",
    icon: <LayoutDashboard aria-hidden="true" className="h-4 w-4" />,
  },
  {
    key: "chat",
    href: "/chat",
    label: "Consulta",
    description: "Chat setorial",
    group: "operation",
    icon: <BotMessageSquare aria-hidden="true" className="h-4 w-4" />,
  },
  {
    key: "files",
    href: "/files",
    label: "Ingestão",
    description: "Upload de arquivos",
    group: "operation",
    icon: <FileUp aria-hidden="true" className="h-4 w-4" />,
  },
  {
    key: "pendencies",
    href: "/me/pendencias",
    label: "Pendencias",
    description: "Acoes para voce",
    group: "operation",
    icon: <Bell aria-hidden="true" className="h-4 w-4" />,
  },
  {
    key: "content",
    href: "/admin/content",
    label: "Conteudo indexado",
    description: "Arquivos prontos para busca",
    group: "knowledge",
    icon: <Database aria-hidden="true" className="h-4 w-4" />,
    adminOnly: true,
  },
  {
    key: "consolidation",
    href: "/admin/consolidation",
    label: "Consolidação",
    description: "Procedimentos consolidados",
    group: "knowledge",
    icon: <GitMerge aria-hidden="true" className="h-4 w-4" />,
    adminOnly: true,
  },
  {
    key: "knowledgeGraph",
    href: "/admin/knowledge-graph",
    label: "Mapa do conhecimento",
    description: "Como os assuntos se conectam",
    group: "knowledge",
    icon: <Network aria-hidden="true" className="h-4 w-4" />,
    adminOnly: true,
  },
  {
    key: "processAutomationMap",
    href: "/admin/process-automation-map",
    label: "Processos",
    description: "O que sua area faz, passo a passo",
    group: "knowledge",
    icon: <Workflow aria-hidden="true" className="h-4 w-4" />,
    adminOnly: true,
  },
  {
    key: "persons",
    href: "/admin/persons",
    label: "Pessoas",
    description: "Quem sabe o que e executa o que",
    group: "knowledge",
    icon: <Users aria-hidden="true" className="h-4 w-4" />,
    adminOnly: true,
  },
  {
    key: "curation",
    href: "/admin/curation",
    label: "Curadoria",
    description: "Validar e publicar",
    group: "knowledge",
    icon: <ClipboardCheck aria-hidden="true" className="h-4 w-4" />,
    adminOnly: true,
  },
  {
    key: "governance",
    href: "/admin/governance",
    label: "Governança",
    description: "Feedback, correções e histórico",
    group: "governance",
    icon: <Gauge aria-hidden="true" className="h-4 w-4" />,
    reviewerOnly: true,
  },
  {
    key: "agents",
    href: "/admin/agents",
    label: "Agentes",
    description: "Personalidade e responsaveis por tópico",
    group: "governance",
    icon: <Bot aria-hidden="true" className="h-4 w-4" />,
    adminOnly: true,
  },
];

const NAV_GROUPS: Array<{ key: NavGroup; label: string }> = [
  { key: "operation", label: "Operação" },
  { key: "knowledge", label: "Conhecimento" },
  { key: "governance", label: "Governança" },
];

export function SecureAppShell({
  children,
  currentPage,
  description,
  hideHeader,
  title,
  user,
}: {
  children: ReactNode;
  currentPage: ShellPage;
  description: string;
  hideHeader?: boolean;
  title: string;
  user: ShellUser;
}) {
  const visibleLinks = PAGE_LINKS.filter(
    (link) =>
      (!link.adminOnly || user.role === "admin") &&
      (!link.reviewerOnly ||
        user.role === "admin" ||
        user.canReviewCorrections === true),
  );
  const currentLink = visibleLinks.find((link) => link.key === currentPage);

  return (
    <div className={`sector-${user.sector} min-h-screen`}>
      <aside className="brand-sidebar fixed inset-y-0 left-0 z-40 hidden w-72 flex-col px-4 py-5 lg:flex">
        <Link
          className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--surface-muted)]"
          href="/"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--accent)] text-white shadow-md shadow-[var(--accent-soft)]">
            <ShieldCheck aria-hidden="true" className="h-6 w-6" />
          </span>
          <span className="min-w-0">
            <span className="block text-[10px] font-black uppercase leading-none tracking-[0.28em] text-[var(--muted)]">
              Profarma
            </span>
            <span className="mt-1 block truncate text-lg font-black leading-tight text-[var(--foreground-strong)]">
              Secure Agents
            </span>
          </span>
        </Link>

        <div className="mt-5 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-black text-[var(--foreground-strong)]">
              {user.name}
            </p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
              {SECTOR_LABELS[user.sector]} / {user.role}
            </p>
          </div>
          <NotificationsBadge />
          <PendenciesBadge />
        </div>

        <SidebarNav
          currentPage={currentPage}
          groups={NAV_GROUPS}
          links={visibleLinks}
        />

        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <LogoutButton />
        </div>
      </aside>

      <header className="brand-mobilebar sticky top-0 z-30 lg:hidden">
        <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link className="flex min-w-0 items-center gap-3" href="/">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-white">
              <ShieldCheck aria-hidden="true" className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-[var(--foreground-strong)]">
                Secure Agents
              </span>
              <span className="block truncate text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                {currentLink?.label ?? title}
              </span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <NotificationsBadge />
            <PendenciesBadge />
            <LogoutButton compact />
          </div>
        </div>
        <nav className="flex gap-2 overflow-x-auto border-t border-[var(--border)] px-4 py-2 sm:px-6">
          {visibleLinks.map((link) => {
            const isActive = link.key === currentPage;

            return (
              <Link
                aria-current={isActive ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-black transition-colors ${
                  isActive
                    ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                    : "border-[var(--border)] bg-white text-[var(--foreground-soft)]"
                }`}
                href={link.href}
                key={link.key}
              >
                {link.icon}
                {link.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-[1680px] px-4 py-5 sm:px-6 lg:ml-72 lg:px-8 lg:py-8">
        {!hideHeader && (
          <section className="mb-6 premium-panel rounded-lg p-5 sm:p-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
              Fluxo ativo
            </p>
            <h1 className="mt-2 text-2xl font-black text-[var(--foreground-strong)] sm:text-3xl">
              {title}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--foreground-soft)]">
              {description}
            </p>
          </section>
        )}

        {children}
      </main>
    </div>
  );
}
