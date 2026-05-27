import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { GraphProcessDetail } from "@/components/graph-process-detail";
import { SecureAppShell } from "@/components/secure-app-shell";

export default async function GraphProcessDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "admin") {
    redirect("/chat");
  }

  const { id } = await params;

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    sector: session.user.sector,
  };

  return (
    <SecureAppShell
      currentPage="processAutomationMap"
      description="Visão consolidada do processo no grafo de conhecimento: documentos, procedimentos, sistemas, conceitos e regulamentos que o sustentam."
      title="Processo no grafo"
      user={user}
    >
      <GraphProcessDetail processId={id} />
    </SecureAppShell>
  );
}
