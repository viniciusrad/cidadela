import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AgentControlCenter } from "@/components/agent-control-center";
import { KnowledgeOwnersManager } from "@/app/admin/knowledge-owners/components/knowledge-owners-manager";
import { SecureAppShell } from "@/components/secure-app-shell";
import { TabNav, type TabDef } from "@/components/ui/tabs";
import { prisma } from "@/lib/db/client";

type AgentsTab = "agents" | "owners";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TAB_META: Record<
  AgentsTab,
  { label: string; description: string; title: string; shellDescription: string }
> = {
  agents: {
    label: "Agentes",
    description: "Personalidade, capacidades e parametros por setor.",
    title: "Central de agentes",
    shellDescription:
      "Ajuste a personalidade, as regras e os limites de cada agente setorial.",
  },
  owners: {
    label: "Responsaveis por topico",
    description: "Donos por topico e setor para validar conhecimento.",
    title: "Responsaveis pelo conhecimento",
    shellDescription:
      "Mantenha a relacao entre topicos, setores e pessoas responsaveis pela validacao do conhecimento.",
  },
};

function firstString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseTab(value: string | string[] | undefined): AgentsTab {
  const raw = firstString(value);
  return raw === "owners" ? "owners" : "agents";
}

export default async function AgentsAdminPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "admin") {
    redirect("/chat");
  }

  const params = await searchParams;
  const activeTab = parseTab(params.tab);

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    sector: session.user.sector,
  };

  const tabs: TabDef[] = (Object.keys(TAB_META) as AgentsTab[]).map((key) => ({
    key,
    label: TAB_META[key].label,
    description: TAB_META[key].description,
    href: `/admin/agents?tab=${key}`,
  }));

  const meta = TAB_META[activeTab];

  const ownersData =
    activeTab === "owners"
      ? await Promise.all([
          prisma.knowledgeOwner.findMany({
            orderBy: [{ sector: "asc" }, { topic: "asc" }],
          }),
          prisma.curationDocument.findMany({
            where: { topic: { not: null } },
            distinct: ["topic", "sector"],
            orderBy: [{ sector: "asc" }, { topic: "asc" }],
            select: { topic: true, sector: true },
          }),
        ])
      : null;

  return (
    <SecureAppShell
      currentPage="agents"
      description={meta.shellDescription}
      title={meta.title}
      user={user}
    >
      <div className="space-y-6">
        <TabNav activeKey={activeTab} tabs={tabs} />

        {activeTab === "agents" ? <AgentControlCenter /> : null}
        {activeTab === "owners" && ownersData ? (
          <KnowledgeOwnersManager
            initialOwners={ownersData[0].map((owner) => ({
              id: owner.id,
              topic: owner.topic,
              sector: owner.sector,
              userEmail: owner.userEmail,
              createdAt: owner.createdAt.toISOString(),
            }))}
            initialTopics={ownersData[1]
              .filter(
                (item): item is { topic: string; sector: string } => Boolean(item.topic),
              )
              .map((item) => ({ topic: item.topic, sector: item.sector }))}
          />
        ) : null}
      </div>
    </SecureAppShell>
  );
}
