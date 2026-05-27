import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AuditPanel } from "@/components/governance/audit-panel";
import { CorrectionsPanel } from "@/components/governance/corrections-panel";
import { FeedbackPanel } from "@/components/governance/feedback-panel";
import { SecureAppShell } from "@/components/secure-app-shell";
import { TabNav, type TabDef } from "@/components/ui/tabs";
import { correctionReviewSectors } from "@/lib/corrections/authorization";
import { prisma } from "@/lib/db/client";

type GovernanceTab = "feedback" | "corrections" | "audit";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TAB_META: Record<
  GovernanceTab,
  { label: string; description: string; title: string; shellDescription: string }
> = {
  feedback: {
    label: "Feedback",
    description: "Avaliacoes e perguntas sem resposta.",
    title: "Feedback de respostas",
    shellDescription:
      "Avaliacoes e perguntas sem resposta em um recorte operacional para revisar qualidade sem perder contexto.",
  },
  corrections: {
    label: "Correcoes",
    description: "Sugestoes de edicao aguardando aprovacao.",
    title: "Correcoes de conteudo",
    shellDescription:
      "Quando alguem sinaliza um erro numa resposta do chat, a correcao chega aqui. Nada e alterado sem sua aprovacao.",
  },
  audit: {
    label: "Historico",
    description: "Decisoes e encaminhamentos entre agentes.",
    title: "Historico operacional",
    shellDescription:
      "Acompanhe quem perguntou o que, quais agentes foram acionados e como cada resposta foi montada.",
  },
};

function firstString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseTab(value: string | string[] | undefined): GovernanceTab | null {
  const raw = firstString(value);
  if (raw === "feedback" || raw === "corrections" || raw === "audit") {
    return raw;
  }
  return null;
}

export default async function GovernancePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const params = await searchParams;
  const requestedTab = parseTab(params.tab);
  const isAdmin = session.user.role === "admin";
  const reviewSectors = await correctionReviewSectors(session.user);
  const canReviewCorrections = reviewSectors.length > 0;

  const allowedTabs: GovernanceTab[] = [];
  if (isAdmin) allowedTabs.push("feedback");
  if (canReviewCorrections) allowedTabs.push("corrections");
  if (isAdmin) allowedTabs.push("audit");

  if (allowedTabs.length === 0) {
    redirect("/chat");
  }

  const activeTab: GovernanceTab =
    requestedTab && allowedTabs.includes(requestedTab) ? requestedTab : allowedTabs[0];

  const pendingCorrections = canReviewCorrections
    ? await prisma.chunkFeedback.count({
        where: {
          status: "PENDING",
          sector: { in: reviewSectors },
        },
      })
    : 0;

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    sector: session.user.sector,
    canReviewCorrections: canReviewCorrections && !isAdmin ? true : undefined,
  };

  const tabs: TabDef[] = allowedTabs.map((key) => ({
    key,
    label: TAB_META[key].label,
    description: TAB_META[key].description,
    href: `/admin/governance?tab=${key}`,
    count: key === "corrections" ? pendingCorrections : undefined,
    countTone: key === "corrections" && pendingCorrections > 0 ? "alert" : "default",
  }));

  const meta = TAB_META[activeTab];

  const stringParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "tab") continue;
    const single = firstString(value);
    if (typeof single === "string") {
      stringParams[key] = single;
    }
  }

  return (
    <SecureAppShell
      currentPage="governance"
      description={meta.shellDescription}
      title={meta.title}
      user={user}
    >
      <div className="space-y-6">
        <TabNav activeKey={activeTab} tabs={tabs} />

        {activeTab === "feedback" ? <FeedbackPanel searchParams={stringParams} /> : null}
        {activeTab === "corrections" ? (
          <CorrectionsPanel
            reviewSectors={reviewSectors}
            searchParams={stringParams}
          />
        ) : null}
        {activeTab === "audit" ? <AuditPanel /> : null}
      </div>
    </SecureAppShell>
  );
}
